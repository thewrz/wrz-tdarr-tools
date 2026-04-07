// Single-Pass Executor v3
// Reads analyzer variables and builds ONE ffmpeg command for A/V, then uses
// mkvmerge to add subtitles (avoids VLC 3.0 "Unidentified codec" bug).
// - Stream filtering (via -map)
// - A/V desync correction (via -itsoffset)
// - Audio: center-channel boost (pan) + loudnorm + AAC encode (single transcode)
// - Video: copy or HEVC NVENC re-encode
// - Subtitles: mkvmerge adds from source (or converts ASS/SSA/WebVTT -> SRT first)
//
// Used by both audio-only and AV flow paths. Reads analyzer_needsVideoReencode
// from variables to determine behavior.

const VIDEO_QUALITY = {
  '720p_and_below': '-preset p4 -tune hq -rc vbr -b:v 0 -cq 26 -maxrate 2M -bufsize 4M -spatial_aq 1 -temporal_aq 1 -aq-strength 7 -rc-lookahead 16 -g 240 -pix_fmt yuv420p -profile:v main',
  '1080p': '-preset p4 -tune hq -rc vbr -b:v 0 -cq 26 -maxrate 4M -bufsize 8M -spatial_aq 1 -temporal_aq 1 -aq-strength 7 -rc-lookahead 16 -g 240 -pix_fmt yuv420p -profile:v main'
};

const RESOLUTION_SCALE = {
  '480p': '-2:480',
  '720p': '-2:720',
  '1080p': '-2:1080'
};

function timeToSeconds(timeString) {
  const parts = timeString.split(':');
  return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
}

module.exports = async (args) => {
  const fs = require('fs');
  const path = require('path');
  const { spawn } = require('child_process');

  args.jobLog('='.repeat(50));
  args.jobLog('   SINGLE-PASS EXECUTOR v3');
  args.jobLog('='.repeat(50));

  const v = args.variables || {};

  // Parse analyzer variables
  let analyzerAudio, analyzerSubs, desync;
  try {
    analyzerAudio = JSON.parse(v.analyzer_audioStreams || '[]');
    analyzerSubs = JSON.parse(v.analyzer_subtitleStreams || '[]');
    desync = JSON.parse(v.analyzer_desync || '{"needsOffset":false,"results":[]}');
  } catch (e) {
    args.jobLog(`ERROR: Failed to parse analyzer variables: ${e.message}`);
    return { outputFileObj: args.inputFileObj, outputNumber: 2, variables: v };
  }

  const needsVideoReencode = v.analyzer_needsVideoReencode === true || v.analyzer_needsVideoReencode === 'true';
  const videoQualityTier = v.analyzer_videoQualityTier || '1080p';
  const targetResolution = v.analyzer_targetResolution || '';
  const totalDuration = parseFloat(v.analyzer_duration) || 0;
  const sourceFile = v.analyzer_sourceFile || args.inputFileObj._id || args.inputFileObj.file;

  const ffmpegPath = args.deps.ffmpegPath || 'ffmpeg';
  const ffprobePath = args.deps.ffprobePath || 'ffprobe';

  args.jobLog(`Source: ${sourceFile}`);
  args.jobLog(`Video re-encode: ${needsVideoReencode}`);
  args.jobLog(`Audio streams: ${analyzerAudio.length}`);
  args.jobLog(`Subtitle streams: ${analyzerSubs.length}`);
  args.jobLog(`Desync correction: ${desync.needsOffset}`);

  if (!fs.existsSync(sourceFile)) {
    args.jobLog(`ERROR: Source file does not exist: ${sourceFile}`);
    return { outputFileObj: args.inputFileObj, outputNumber: 2, variables: v };
  }

  // Determine output file path
  let workingDir;
  if (args.workDir && args.workDir.trim() !== '') {
    workingDir = path.normalize(args.workDir);
  } else {
    workingDir = path.dirname(sourceFile);
  }

  if (!fs.existsSync(workingDir)) {
    fs.mkdirSync(workingDir, { recursive: true });
  }

  const baseName = path.basename(sourceFile).replace(/\.[^.]+$/, '');
  const outputFile = path.join(workingDir, `${baseName}.mkv`);
  args.jobLog(`Output: ${outputFile}`);

  // ─── BUILD FFMPEG COMMAND ───
  const ffmpegArgs = [
    '-fflags', '+discardcorrupt+genpts+igndts+flush_packets',
    '-err_detect', 'ignore_err',
    '-analyzeduration', '10000000',
    '-probesize', '10000000',
    '-max_error_rate', '1.0',
    '-ignore_unknown',
    '-progress', 'pipe:2',
    '-stats_period', '1',
    '-v', 'info'
  ];

  // ── Input(s) ──
  // Build a map of audio stream offsets for desync correction
  const audioOffsetMap = new Map();
  if (desync.needsOffset && desync.results) {
    desync.results.forEach(r => audioOffsetMap.set(r.streamIndex, r.desyncOffset));
  }

  // Determine if we need multiple inputs for desync correction
  const needsSplitInputs = desync.needsOffset &&
    analyzerAudio.some(a => Math.abs(audioOffsetMap.get(a.index) || 0) >= 0.001);

  if (needsSplitInputs) {
    // Input 0: video + subtitles (no offset)
    ffmpegArgs.push('-i', sourceFile);
    args.jobLog(`Input 0: ${path.basename(sourceFile)} (video + subs, no offset)`);

    // One additional input per audio stream that needs offset
    let inputIdx = 1;
    const audioInputMap = new Map();

    for (const audio of analyzerAudio) {
      const offset = audioOffsetMap.get(audio.index) || 0;
      if (Math.abs(offset) >= 0.001) {
        ffmpegArgs.push('-itsoffset', offset.toFixed(3));
        args.jobLog(`Input ${inputIdx}: audio stream ${audio.index}, offset ${offset.toFixed(3)}s`);
      } else {
        args.jobLog(`Input ${inputIdx}: audio stream ${audio.index}, no offset`);
      }
      ffmpegArgs.push('-i', sourceFile);
      audioInputMap.set(audio.index, inputIdx);
      inputIdx++;
    }

    // Store for mapping phase
    args._audioInputMap = audioInputMap;
  } else {
    // Single input
    ffmpegArgs.push('-i', sourceFile);
    args.jobLog(`Input 0: ${path.basename(sourceFile)} (all streams)`);
  }

  // Don't copy source metadata — stale BPS/codec stats from the original file
  // confuse some players (VLC "unidentified codec" warning). Only write explicit tags.
  ffmpegArgs.push('-map_metadata', '-1');
  // Preserve chapters from input
  ffmpegArgs.push('-map_chapters', '0');
  ffmpegArgs.push('-max_muxing_queue_size', '1024');

  // ── Video mapping ──
  ffmpegArgs.push('-map', '0:v:0');

  if (needsVideoReencode) {
    ffmpegArgs.push('-c:v', 'hevc_nvenc');

    // Add resolution scaling if specified
    if (targetResolution && RESOLUTION_SCALE[targetResolution]) {
      ffmpegArgs.push('-vf', `scale=${RESOLUTION_SCALE[targetResolution]}`);
      args.jobLog(`Video: HEVC NVENC, scale to ${targetResolution}`);
    } else {
      args.jobLog(`Video: HEVC NVENC, keep resolution`);
    }

    // Quality preset
    const qualityArgs = VIDEO_QUALITY[videoQualityTier] || VIDEO_QUALITY['1080p'];
    ffmpegArgs.push(...qualityArgs.split(' '));
    args.jobLog(`Quality tier: ${videoQualityTier}`);
  } else {
    ffmpegArgs.push('-c:v', 'copy');
    args.jobLog('Video: copy');
  }

  // ── Audio mapping ──
  if (analyzerAudio.length === 0) {
    ffmpegArgs.push('-an');
    args.jobLog('Audio: none');
  } else {
    for (let i = 0; i < analyzerAudio.length; i++) {
      const audio = analyzerAudio[i];

      if (needsSplitInputs) {
        // Map from the corresponding input
        const inputIdx = args._audioInputMap.get(audio.index);
        ffmpegArgs.push('-map', `${inputIdx}:a:${audio.audioRelativeIndex}`);
      } else {
        // Map from single input
        ffmpegArgs.push('-map', `0:a:${audio.audioRelativeIndex}`);
      }

      // Audio filter: center-channel boost for multichannel, loudnorm for all
      if (audio.channels > 2) {
        // Multichannel -> stereo downmix with center boost + loudnorm
        ffmpegArgs.push(
          `-filter:a:${i}`,
          'pan=stereo|FL<1.0*FL+1.2*FC+0.6*BL+0.6*SL|FR<1.0*FR+1.2*FC+0.6*BR+0.6*SR,loudnorm=I=-16:LRA=11:TP=-1.5'
        );
        args.jobLog(`Audio ${i}: stream ${audio.index} (${audio.language}, ${audio.channels}ch -> stereo, center boost + loudnorm)`);
      } else {
        // Stereo/mono -> loudnorm only
        ffmpegArgs.push(`-filter:a:${i}`, 'loudnorm=I=-16:LRA=11:TP=-1.5');
        args.jobLog(`Audio ${i}: stream ${audio.index} (${audio.language}, ${audio.channels}ch, loudnorm)`);
      }

      // AAC encoding
      ffmpegArgs.push(`-c:a:${i}`, 'aac');
      ffmpegArgs.push(`-b:a:${i}`, '128k');
      ffmpegArgs.push(`-ar:a:${i}`, '48000');

      // Language metadata
      const langCode = ['eng', 'jpn', 'kor', 'fre'].includes(audio.language) ? audio.language : 'und';
      ffmpegArgs.push(`-metadata:s:a:${i}`, `language=${langCode}`);

      // Default disposition
      if (audio.isDefault) {
        ffmpegArgs.push(`-disposition:a:${i}`, 'default');
      } else {
        ffmpegArgs.push(`-disposition:a:${i}`, '0');
      }
    }
  }

  // ── Subtitles: always exclude from ffmpeg (added via mkvmerge later) ──
  // ffmpeg's matroska muxer writes subtitle CodecID entries that VLC 3.0's
  // avformat demuxer can't map to a valid fourcc, causing "Unidentified codec".
  // mkvmerge writes proper S_TEXT/UTF8 entries that work everywhere.
  ffmpegArgs.push('-sn');
  if (analyzerSubs.length > 0) {
    args.jobLog(`Subtitles: ${analyzerSubs.length} track(s) deferred to mkvmerge step`);
  } else {
    args.jobLog('Subtitles: none');
  }

  // ── Output flags ──
  ffmpegArgs.push('-avoid_negative_ts', 'make_zero');
  ffmpegArgs.push('-y', outputFile);

  // Log the full command
  args.jobLog(`\nFFmpeg command:\n${ffmpegPath} ${ffmpegArgs.join(' ')}`);

  // Clean up temp property
  delete args._audioInputMap;

  // ─── EXECUTE FFMPEG ───
  args.jobLog('\n--- Executing FFmpeg ---');

  if (args.updateWorker) {
    args.updateWorker({
      CLIType: ffmpegPath,
      preset: ffmpegArgs.join(' ')
    });
  }

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ffmpegArgs);

    let stderrData = '';
    let lastPercentage = 0;

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderrData += text;

      // Parse full progress line
      const match = text.match(
        /frame=\s*(\d+)\s+fps=\s*([\d.]+)\s+q=\s*([\d.-]+)\s+size=\s*(\d+)(\w+)\s+time=(\d{2}:\d{2}:\d{2}\.\d{2})\s+bitrate=\s*([\d.]+)(\w+\/s)\s+speed=\s*([\d.]+)x/
      );

      if (match) {
        const [, frame, fps, quality, sizeVal, sizeUnit, timeStr, brVal, brUnit, speed] = match;

        let sizeKiB = parseInt(sizeVal, 10);
        if (sizeUnit.toLowerCase() === 'mib') sizeKiB = Math.round(sizeKiB * 1024);
        else if (sizeUnit.toLowerCase() === 'gib') sizeKiB = Math.round(sizeKiB * 1024 * 1024);

        args.jobLog(`frame=${frame} fps=${fps} q=${quality} size=${sizeKiB}KiB time=${timeStr} bitrate=${brVal}${brUnit} speed=${speed}x`);

        if (totalDuration > 0) {
          try {
            const currentSec = timeToSeconds(timeStr);
            const pct = Math.min(Math.round((currentSec / totalDuration) * 100), 100);

            if (args.updateWorker && (pct !== lastPercentage || pct % 5 === 0)) {
              lastPercentage = pct;
              args.updateWorker({
                CLIType: ffmpegPath,
                preset: ffmpegArgs.join(' '),
                percentage: pct,
                frame: parseInt(frame, 10),
                fps: parseFloat(fps),
                speed: parseFloat(speed),
                bitrate: `${brVal}${brUnit}`,
                time: timeStr,
                size: `${sizeKiB}KiB`
              });
              args.jobLog(`Progress: ${pct}%`);
            }
          } catch (_) {
            // ignore parse errors in progress
          }
        }
      } else {
        // Fallback: basic time parsing
        const timeMatch = text.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
        if (timeMatch && totalDuration > 0) {
          try {
            const currentSec = timeToSeconds(timeMatch[1]);
            const pct = Math.min(Math.round((currentSec / totalDuration) * 100), 100);
            if (args.updateWorker && pct !== lastPercentage && pct % 5 === 0) {
              lastPercentage = pct;
              args.updateWorker({
                CLIType: ffmpegPath,
                preset: ffmpegArgs.join(' '),
                percentage: pct,
                time: timeMatch[1]
              });
              args.jobLog(`Progress: ${pct}%`);
            }
          } catch (_) {}
        }
      }

      // Log errors/warnings
      if (text.includes('Error') || text.includes('Warning')) {
        args.jobLog(`FFmpeg: ${text.trim()}`);
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        args.jobLog(`ERROR: FFmpeg exit code ${code}`);
        args.jobLog(`Stderr (last 2000 chars): ${stderrData.slice(-2000)}`);
        if (args.updateWorker) {
          args.updateWorker({ CLIType: ffmpegPath, percentage: 0, error: `FFmpeg exit ${code}` });
        }
        reject(new Error(`FFmpeg failed with exit code ${code}`));
      } else {
        args.jobLog('FFmpeg completed successfully');
        if (args.updateWorker) {
          args.updateWorker({ CLIType: ffmpegPath, percentage: 100 });
        }
        resolve();
      }
    });

    proc.on('error', (err) => {
      args.jobLog(`ERROR: Failed to start FFmpeg: ${err.message}`);
      reject(err);
    });
  });

  // ─── MKVMERGE: ADD SUBTITLES ───
  // mkvmerge produces proper S_TEXT/UTF8 codec entries that VLC 3.0 recognises,
  // unlike ffmpeg's matroska muxer which writes entries that trigger
  // "Unidentified codec" in VLC's avformat demuxer.
  if (analyzerSubs.length > 0) {
    args.jobLog('\n--- Adding subtitles via mkvmerge ---');

    const { execFileSync } = require('child_process');

    // Locate mkvmerge — same dir as mkvpropedit if available
    let mkvmergePath = 'mkvmerge';
    if (args.deps.mkvpropeditPath) {
      const mkvDir = path.dirname(args.deps.mkvpropeditPath);
      const candidate = path.join(mkvDir, 'mkvmerge');
      if (fs.existsSync(candidate)) {
        mkvmergePath = candidate;
      }
    }
    args.jobLog(`mkvmerge path: ${mkvmergePath}`);

    const tempSubFiles = [];
    const mkvmergeArgs = ['-o', `${outputFile}.mux.mkv`, outputFile];

    // Extract each subtitle via ffmpeg to a temp SRT file, then add via mkvmerge.
    // This avoids ffprobe-index vs mkvmerge-TID mapping issues and ensures all
    // subs end up as proper S_TEXT/UTF8 regardless of source format.
    for (let i = 0; i < analyzerSubs.length; i++) {
      const sub = analyzerSubs[i];
      const langCode = sub.language || 'eng';
      // Always set default_track to 'no' — VLC 3.0's avformat demuxer auto-selects
      // default subtitle tracks and fails with "Unidentified codec" (undf fourcc).
      // Setting to 'no' prevents auto-selection while keeping subs available.
      const isDefault = 'no';
      const tempSrt = path.join(workingDir, `_temp_sub_${i}.srt`);

      const action = sub.needsConversion
        ? `converting stream ${sub.index} (${sub.codec}) -> SRT`
        : `extracting stream ${sub.index} (${sub.codec}) as SRT`;
      args.jobLog(`Subtitle ${i}: ${action}`);

      try {
        execFileSync(ffmpegPath, [
          '-i', sourceFile,
          '-map', `0:${sub.index}`,
          '-c:s', 'srt',
          '-y', tempSrt
        ], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });
      } catch (e) {
        args.jobLog(`WARNING: Sub extraction failed for stream ${sub.index}: ${e.message}`);
        continue;
      }

      tempSubFiles.push(tempSrt);
      mkvmergeArgs.push(
        '--language', `0:${langCode}`,
        '--default-track-flag', `0:${isDefault}`,
        tempSrt
      );
      args.jobLog(`Subtitle ${i}: queued temp SRT (lang=${langCode}, default=${isDefault})`);
    }

    args.jobLog(`mkvmerge command:\n${mkvmergePath} ${mkvmergeArgs.join(' ')}`);

    try {
      const mkvResult = execFileSync(mkvmergePath, mkvmergeArgs, {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 10
      });
      args.jobLog(`mkvmerge output: ${mkvResult.trim()}`);

      // Replace ffmpeg output with mkvmerge output
      fs.unlinkSync(outputFile);
      fs.renameSync(`${outputFile}.mux.mkv`, outputFile);
      args.jobLog('mkvmerge: replaced ffmpeg output with muxed file');
    } catch (e) {
      args.jobLog(`ERROR: mkvmerge failed: ${e.message}`);
      // Clean up temp mux file if it exists
      try { fs.unlinkSync(`${outputFile}.mux.mkv`); } catch (_) {}
      // Fall back to ffmpeg-only output (no subs, but at least A/V work)
      args.jobLog('WARNING: Falling back to ffmpeg output without subtitles');
    }

    // Clean up temp subtitle files
    for (const tmp of tempSubFiles) {
      try { fs.unlinkSync(tmp); } catch (_) {}
    }
  }

  // ─── VERIFY OUTPUT ───
  args.jobLog('\n--- Verifying Output ---');

  if (!fs.existsSync(outputFile)) {
    args.jobLog('ERROR: Output file not created');
    return { outputFileObj: args.inputFileObj, outputNumber: 2, variables: v };
  }

  // Probe output
  let outputProbe;
  try {
    const { execFileSync } = require('child_process');
    const probeResult = execFileSync(ffprobePath, [
      '-v', 'quiet', '-print_format', 'json',
      '-show_streams', '-show_format', outputFile
    ], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });
    outputProbe = JSON.parse(probeResult);
  } catch (e) {
    args.jobLog(`ERROR: Cannot probe output: ${e.message}`);
    return { outputFileObj: args.inputFileObj, outputNumber: 2, variables: v };
  }

  const outStreams = outputProbe.streams || [];
  const outVideo = outStreams.filter(s => s.codec_type === 'video');
  const outAudio = outStreams.filter(s => s.codec_type === 'audio');
  const outSubs = outStreams.filter(s => s.codec_type === 'subtitle');

  args.jobLog(`Output streams: ${outVideo.length} video, ${outAudio.length} audio, ${outSubs.length} subtitle`);

  // Validate streams
  if (outVideo.length === 0) {
    args.jobLog('ERROR: No video in output');
    return { outputFileObj: args.inputFileObj, outputNumber: 2, variables: v };
  }
  if (analyzerAudio.length > 0 && outAudio.length === 0) {
    args.jobLog('ERROR: No audio in output');
    return { outputFileObj: args.inputFileObj, outputNumber: 2, variables: v };
  }

  // Log output details
  outAudio.forEach((s, i) => {
    args.jobLog(`  Audio ${i}: ${s.codec_name} ${s.channels}ch ${Math.round((parseInt(s.bit_rate || '0', 10)) / 1000)}kbps ${s.tags?.language || 'und'}`);
  });
  if (needsVideoReencode) {
    args.jobLog(`  Video: ${outVideo[0].codec_name} ${outVideo[0].width}x${outVideo[0].height}`);
  }

  const sourceStats = fs.statSync(sourceFile);
  const outputStats = fs.statSync(outputFile);
  args.jobLog(`Size: ${(sourceStats.size / 1024 / 1024).toFixed(1)}MB -> ${(outputStats.size / 1024 / 1024).toFixed(1)}MB`);

  args.jobLog('='.repeat(50));
  args.jobLog('   EXECUTION COMPLETE');
  args.jobLog('='.repeat(50));

  // Return processed file
  const normalizedOutput = outputFile.replace(/\\/g, '/');

  return {
    outputFileObj: {
      ...args.inputFileObj,
      _id: normalizedOutput
    },
    outputNumber: 1,
    variables: {
      ...v,
      requiresReplacement: true,
      preprocessed: true
    }
  };
};
