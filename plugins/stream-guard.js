// Tdarr Flow Custom JS Plugin: Robust A/V Stream Guard (lock-aware)
// - Verifies audio/video streams on the current working file (prefers outputFileObj, else inputFileObj)
// - Retries around transient file locks (EBUSY/EPERM/ENOENT) before probing
// - Uses ffprobe with larger buffer + timeout and path overrides
// - Optional "synthetic streams" fallback via args.variables.avguard_allowSynthetic (default: false)
// - Detects dropped streams by comparing to original input
//
// ---- Runtime knobs (set in Flow variables or previous blocks) ----
// variables.avguard_allowSynthetic: boolean  (default: false)
// variables.avguard_ffprobePath:   string   (default: args.deps.ffprobePath || process.env.FFPROBE_PATH || 'ffprobe')
// variables.avguard_retryTries:    number   (default: 6)            // total attempts for lock/ffprobe
// variables.avguard_retryDelayMs:  number   (default: 300)          // initial backoff (exponential)
// variables.avguard_probeTimeout:  number   (default: 15000)        // ms
// variables.avguard_maxBufferMB:   number   (default: 64)           // ffprobe JSON max buffer
//
// Notes:
// - Place Tdarr work/cache on a local, AV-excluded path to minimize EBUSY.
// - Give each worker a unique workDir to avoid temp-file collisions.

module.exports = async (args) => {
  try {
    const fileObj = args.outputFileObj ?? args.inputFileObj;
    if (!fileObj) {
      args.jobLog('❌ No file object provided to stream-check block.');
      return {
        outputFileObj: args.outputFileObj ?? args.inputFileObj,
        outputNumber: 2,
        error: 'No file to inspect',
      };
    }

    // --- Config from variables with sane defaults ---
    const v = args.variables || {};
    const allowSynthetic = Boolean(v.avguard_allowSynthetic ?? false);
    const ffprobePath =
      v.avguard_ffprobePath ||
      args?.deps?.ffprobePath ||
      process.env.FFPROBE_PATH ||
      'ffprobe';

    const retryTries   = Number.isFinite(v.avguard_retryTries)   ? v.avguard_retryTries   : 6;
    const retryDelayMs = Number.isFinite(v.avguard_retryDelayMs) ? v.avguard_retryDelayMs : 300;
    const probeTimeout = Number.isFinite(v.avguard_probeTimeout) ? v.avguard_probeTimeout : 15000;
    const maxBufferMB  = Number.isFinite(v.avguard_maxBufferMB)  ? v.avguard_maxBufferMB  : 64;

    // Prefer filesystem path; _id can be a DB id in some contexts.
    const srcPath = fileObj.file || fileObj._id || '(unknown path)';
    const used = (args.outputFileObj ? 'outputFileObj' : 'inputFileObj');
    args.jobLog(`🔎 Inspecting ${used}: ${srcPath}`);
    args.jobLog(`🛠️ ffprobe path: ${ffprobePath} | retries: ${retryTries} | timeout: ${probeTimeout} ms`);

    const { execFileSync } = require('child_process');
    const fs = require('fs');
    const path = require('path');

    // ---------- Helpers ----------
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Errors considered transient/lock-related on Windows/SMB
    const isTransient = (err) => {
      const msg = String(err && err.message || '').toUpperCase();
      return (
        msg.includes('EBUSY') ||
        msg.includes('EPERM') ||
        msg.includes('RESOURCE BUSY') ||
        msg.includes('PERMISSION DENIED') ||
        msg.includes('ENOENT') // brand-new file on SMB can briefly "not exist"
      );
    };

    // Try opening the file for read to ensure the share/AV released it.
    async function waitForReadable(file, tries, delayMs) {
      let attempt = 0;
      let backoff = delayMs;
      while (attempt < tries) {
        try {
          // Also check directory exists to reduce ENOENT flapping
          const dir = path.dirname(file);
          if (!fs.existsSync(dir)) throw new Error(`ENOENT: dir missing ${dir}`);
          const fd = fs.openSync(file, 'r');
          fs.closeSync(fd);
          return; // success
        } catch (e) {
          if (!isTransient(e)) throw e;
          attempt++;
          if (attempt >= tries) {
            throw e;
          }
          await sleep(backoff);
          backoff = Math.min(backoff * 2, 5000); // cap backoff growth
        }
      }
    }

    // Run ffprobe with retries/backoff
    async function ffprobeJson(probePath, file, tries, delayMs) {
      let attempt = 0;
      let backoff = delayMs;
      while (attempt < tries) {
        try {
          const out = execFileSync(
            probePath,
            [
              '-v', 'quiet',
              '-print_format', 'json',
              '-show_streams',
              '-show_format',
              file,
            ],
            {
              encoding: 'utf8',
              maxBuffer: maxBufferMB * 1024 * 1024,
              timeout: probeTimeout, // ms
            }
          );
          return JSON.parse(out);
        } catch (e) {
          // If buffer overflow, suggest increasing maxBufferMB explicitly.
          if (String(e && e.message).includes('stdout maxBuffer length exceeded')) {
            throw new Error(`ffprobe JSON exceeded ${maxBufferMB}MB; raise variables.avguard_maxBufferMB`);
          }
          if (!isTransient(e)) {
            throw e; // hard error (bad binary, invalid args, real corruption)
          }
          attempt++;
          if (attempt >= tries) {
            throw e;
          }
          await sleep(backoff);
          backoff = Math.min(backoff * 2, 5000);
        }
      }
    }

    // Parse attached_pic safely (number or string)
    const isRealVideo = (s) =>
      s?.codec_type === 'video' && !(String(s?.disposition?.attached_pic) === '1');

    // --- Primary: prefer existing ffProbeData on the object ---
    function streamsFromObj(obj) {
      const streams = obj?.ffProbeData?.streams;
      return Array.isArray(streams) && streams.length > 0 ? streams : null;
    }

    // --- MediaInfo hints (counts only) ---
    function mediaInfoHints(obj) {
      const mi = obj?.mediaInfo?.track || [];
      const miHasVideo = mi.some(t => (t['@type'] || '').toLowerCase() === 'video');
      const miHasAudio = mi.some(t => (t['@type'] || '').toLowerCase() === 'audio');
      return { miHasVideo, miHasAudio };
    }

    async function getStreamsLockAware(obj, pathToFile) {
      // 1) Already scanned?
      const fromObj = streamsFromObj(obj);
      if (fromObj) return { streams: fromObj, source: 'object' };

      // 2) Wait until readable (handles transient locks)
      try {
        await waitForReadable(pathToFile, retryTries, retryDelayMs);
      } catch (e) {
        args.jobLog(`⏳ File not readable after retries: ${e.message}`);
        // Fall through to decide based on allowSynthetic + MediaInfo hints
      }

      // 3) Try ffprobe (with retries/backoff)
      try {
        const parsed = await ffprobeJson(ffprobePath, pathToFile, retryTries, retryDelayMs);
        if (Array.isArray(parsed?.streams) && parsed.streams.length > 0) {
          args.jobLog('🛰️ Re-probed file with ffprobe (fallback).');
          return { streams: parsed.streams, source: 'ffprobe' };
        }
      } catch (e) {
        args.jobLog(`⚠️ ffprobe failed after retries: ${e.message}`);
      }

      // 4) Optional: synthetic streams based on MediaInfo counts
      const { miHasVideo, miHasAudio } = mediaInfoHints(obj);
      if (allowSynthetic && (miHasVideo || miHasAudio)) {
        args.jobLog('🧪 Using synthetic streams from MediaInfo hints (allowSynthetic=true).');
        const synthetic = [];
        if (miHasVideo) synthetic.push({ codec_type: 'video', disposition: {} });
        if (miHasAudio) synthetic.push({ codec_type: 'audio', disposition: {} });
        return { streams: synthetic, source: 'synthetic' };
      }

      return { streams: [], source: 'none' };
    }

    // ---------- Execute ----------
    const { streams, source } = await getStreamsLockAware(fileObj, srcPath);

    if (!Array.isArray(streams) || streams.length === 0) {
      args.jobLog(`❌ No streams available after probing (source=${source}).`);
      return {
        outputFileObj: fileObj,
        outputNumber: 2,
        error: 'Probe missing/empty',
      };
    }

    const hasVideo = streams.some(isRealVideo);
    const hasAudio = streams.some(s => s?.codec_type === 'audio');

    // Compare against original input to catch drop after ffmpeg block
    const inStreams = args.inputFileObj?.ffProbeData?.streams || [];
    const hadVideoIn = inStreams.some(isRealVideo);
    const hadAudioIn = inStreams.some(s => s?.codec_type === 'audio');

    const vars = {
      ...args.variables,
      avguard_used: used,
      avguard_src: srcPath,
      avguard_probeSource: source,
      avguard_hasAudio: hasAudio,
      avguard_hasVideo: hasVideo,
      avguard_inputHadAudio: hadAudioIn,
      avguard_inputHadVideo: hadVideoIn,
      avguard_audioDropped: hadAudioIn && !hasAudio,
      avguard_videoDropped: hadVideoIn && !hasVideo,
    };

    // Enforce stream presence
    if (!hasAudio && !hasVideo) {
      args.jobLog('❌ No audio AND no video streams present.');
      return { outputFileObj: fileObj, outputNumber: 2, error: 'No A/V streams', variables: vars };
    }
    if (hadAudioIn && !hasAudio) {
      args.jobLog('❌ Missing audio stream (audio dropped since input).');
      return { outputFileObj: fileObj, outputNumber: 2, error: 'Missing audio (dropped)', variables: vars };
    }
    if (!hadAudioIn && !hasAudio) {
      args.jobLog('❌ Missing audio stream.');
      return { outputFileObj: fileObj, outputNumber: 2, error: 'Missing audio', variables: vars };
    }
    if (hadVideoIn && !hasVideo) {
      args.jobLog('❌ Missing video stream (video dropped since input).');
      return { outputFileObj: fileObj, outputNumber: 2, error: 'Missing video (dropped)', variables: vars };
    }
    if (!hadVideoIn && !hasVideo) {
      args.jobLog('❌ Missing video stream.');
      return { outputFileObj: fileObj, outputNumber: 2, error: 'Missing video', variables: vars };
    }

    // Success
    args.jobLog('✅ Audio and video streams are intact.');
    return { outputFileObj: fileObj, outputNumber: 1, variables: vars };

  } catch (err) {
    args.jobLog(`❌ Stream check crashed: ${err.message}`);
    return {
      outputFileObj: args.outputFileObj ?? args.inputFileObj,
      outputNumber: 2,
      error: 'Stream check crashed',
      variables: args.variables,
    };
  }
};
