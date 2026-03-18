// Smart Analyzer v3
// Analysis-only node: inspects streams, makes routing decisions, stores results in args.variables.
// Does NOT run ffmpeg. Downstream executor nodes consume the variables.
//
// Output routing:
//   1 = File already perfect (skip)
//   2 = Audio needs work, video is fine (audio-only executor)
//   3 = Video needs re-encoding too (AV executor)
//   4 = Error (no video, no audio, ffprobe failed)

// === MODULE-LEVEL CONSTANTS ===

const ALLOWED_LANGUAGES = ['eng', 'jpn', 'kor', 'fre'];

const languagePatterns = {
  eng: [
    /\benglish\b/i, /\beng\b/i, /\ben\b/i, /\ben[-_]us\b/i, /\ben[-_]gb\b/i,
    /\ben[-_]au\b/i, /\ben[-_]ca\b/i, /\benglish\s+audio\b/i
  ],
  jpn: [
    /\bjapanese\b/i, /\bjpn\b/i, /\bja\b/i, /\bja[-_]jp\b/i,
    /\bnihongo\b/i, /\b日本語\b/i, /\bjapanese\s+audio\b/i
  ],
  kor: [
    /\bkorean\b/i, /\bkor\b/i, /\bko\b/i, /\bko[-_]kr\b/i,
    /\bhangul\b/i, /\b한국어\b/i, /\bkorean\s+audio\b/i
  ],
  fre: [
    /\bfrench\b/i, /\bfre\b/i, /\bfr\b/i, /\bfr[-_]fr\b/i,
    /\bfrancais\b/i, /\bfrançais\b/i, /\bfrench\s+audio\b/i
  ]
};

const commentaryPatterns = [
  /commentary/i, /director.?s?\s+commentary/i, /cast\s+commentary/i,
  /production.*commentary/i, /design.*commentary/i, /audio\s+commentary/i,
  /filmmaker.*commentary/i, /writer.*commentary/i, /producer.*commentary/i,
  /behind.*scenes/i, /making.*of/i, /^commentary$/i, /\bcomm\b/i,
  /director.*track/i, /bonus.*audio/i, /audio\s+description/i,
  /descriptive\s+audio/i, /described\s+video/i, /\bad\b/i,
  /vision.*impaired/i, /accessibility/i
];

const BITMAP_SUBTITLE_CODECS = ['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle'];
const CONVERTIBLE_SUBTITLE_CODECS = ['ass', 'ssa', 'webvtt', 'mov_text'];

// Bitrate thresholds (kbps) for determining if video re-encode is needed
const VIDEO_BITRATE_THRESHOLDS = {
  '720p_and_below': 3000,
  '1080p': 5000
};

// === HELPER FUNCTIONS ===

function detectLanguage(stream) {
  const title = (stream.tags?.title || '').toLowerCase();
  const language = (stream.tags?.language || '').toLowerCase();

  const textToCheck = `${title} ${language}`.trim();
  if (commentaryPatterns.some(p => p.test(textToCheck))) return 'commentary';

  if (['eng', 'en', 'english'].includes(language)) return 'eng';
  if (['jpn', 'ja', 'japanese'].includes(language)) return 'jpn';
  if (['kor', 'ko', 'korean'].includes(language)) return 'kor';
  if (['fre', 'fr', 'french', 'fra'].includes(language)) return 'fre';

  for (const [langCode, patterns] of Object.entries(languagePatterns)) {
    if (title && patterns.some(p => p.test(title))) return langCode;
  }
  for (const [langCode, patterns] of Object.entries(languagePatterns)) {
    if (patterns.some(p => p.test(textToCheck))) return langCode;
  }

  if (title) {
    if (/\b(dub|dubbed)\b/i.test(title) && !/\b(sub|subtitle)\b/i.test(title)) return 'eng';
  }

  return 'unknown';
}

function validateAudioStream(stream, index, args, sourceFile, ffprobePath, ffmpegPath) {
  const codec = stream.codec_name || '';
  const duration = parseFloat(stream.duration) || 0;
  const tags = stream.tags || {};
  const channels = parseInt(stream.channels || '0', 10);
  const sampleRate = parseInt(stream.sample_rate || '0', 10);

  const streamBitRate = parseInt(stream.bit_rate || '0', 10);
  const tagBitRate = parseInt(tags.BPS || tags['BPS-eng'] || '0', 10);
  const frameCount = parseInt(tags.NUMBER_OF_FRAMES || tags['NUMBER_OF_FRAMES-eng'] || '0', 10);
  const byteCount = parseInt(tags.NUMBER_OF_BYTES || tags['NUMBER_OF_BYTES-eng'] || '0', 10);

  const bestBitRate = streamBitRate > 0 ? streamBitRate : tagBitRate;
  const bestChannels = channels;

  if (!codec || codec.trim() === '') {
    args.jobLog(`    -> Validation FAILED: missing codec`);
    return false;
  }
  if (bestChannels === 0) {
    args.jobLog(`    -> Validation FAILED: 0 channels`);
    return false;
  }
  if (bestChannels > 32) {
    args.jobLog(`    -> Validation FAILED: unreasonable channel count (${bestChannels})`);
    return false;
  }
  if (sampleRate > 0 && (sampleRate < 8000 || sampleRate > 192000)) {
    args.jobLog(`    -> Validation FAILED: invalid sample rate (${sampleRate})`);
    return false;
  }
  if (frameCount === 0 && byteCount === 0 && bestBitRate === 0) {
    args.jobLog(`    -> Validation FAILED: completely empty stream`);
    return false;
  }
  if (duration === 0 && frameCount === 0 && byteCount === 0) {
    args.jobLog(`    -> Validation FAILED: 0 duration + 0 frames + 0 bytes`);
    return false;
  }
  if (byteCount > 0 && byteCount < 1000 && frameCount === 0 && duration > 10) {
    args.jobLog(`    -> Validation FAILED: suspiciously small (${byteCount} bytes)`);
    return false;
  }

  // Deep packet-level probe
  try {
    const { execFileSync } = require('child_process');
    const deepProbeResult = execFileSync(ffprobePath, [
      '-v', 'error',
      '-select_streams', `a:${index}`,
      '-show_entries', 'packet=pts,dts,size,flags',
      '-read_intervals', '%+#5',
      '-of', 'csv=p=0',
      sourceFile
    ], { encoding: 'utf8', timeout: 10000 });

    const packets = deepProbeResult.trim().split('\n').filter(l => l.trim());
    if (packets.length === 0) {
      args.jobLog(`    -> Validation FAILED: no audio packets found`);
      return false;
    }

    let corrupted = 0;
    let valid = 0;
    for (const packet of packets) {
      const parts = packet.split(',');
      if (parts.length >= 3) {
        const size = parseInt(parts[2] || '0', 10);
        if (size === 0 || size >= 1000000) corrupted++;
        else valid++;
      }
    }
    if (corrupted > valid) {
      args.jobLog(`    -> Validation FAILED: ${corrupted}/${packets.length} packets corrupted`);
      return false;
    }
  } catch (e) {
    if (frameCount === 0 || byteCount === 0) {
      args.jobLog(`    -> Validation FAILED: cannot probe packets and empty indicators`);
      return false;
    }
  }

  // Muxing compatibility test for problematic codecs
  if (['eac3', 'ac3', 'dts', 'truehd'].includes(codec.toLowerCase())) {
    try {
      const { execFileSync } = require('child_process');
      const path = require('path');
      const fs = require('fs');
      const testFile = path.join(path.dirname(sourceFile), `test_audio_${index}_${Date.now()}.mkv`);

      execFileSync(ffmpegPath, [
        '-v', 'error', '-i', sourceFile,
        '-map', `0:a:${index}`, '-c:a', 'copy',
        '-t', '1', '-f', 'matroska', '-y', testFile
      ], { encoding: 'utf8', timeout: 15000 });

      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    } catch (muxErr) {
      const errMsg = muxErr.stderr || muxErr.stdout || muxErr.message || '';
      if (errMsg.includes('Error submitting a packet') || errMsg.includes('Invalid argument') || errMsg.includes('Error muxing')) {
        args.jobLog(`    -> Validation FAILED: muxing test error - ${errMsg.substring(0, 200)}`);
        return false;
      }
    }
  }

  return true;
}

function validateSubtitleStream(stream, index, args, sourceFile, ffprobePath) {
  const codec = stream.codec_name || '';
  const tags = stream.tags || {};
  const duration = parseFloat(stream.duration) || 0;
  const frameCount = parseInt(tags.NUMBER_OF_FRAMES || tags['NUMBER_OF_FRAMES-eng'] || '0', 10);
  const byteCount = parseInt(tags.NUMBER_OF_BYTES || tags['NUMBER_OF_BYTES-eng'] || '0', 10);
  const bitRate = parseInt(tags.BPS || tags['BPS-eng'] || stream.bit_rate || '0', 10);
  const streamDuration = parseFloat(tags.DURATION || tags['DURATION-eng'] || '0');
  const width = parseInt(stream.width || '0', 10);
  const height = parseInt(stream.height || '0', 10);

  if (!codec || codec.trim() === '') {
    args.jobLog(`    -> Sub validation FAILED: missing codec`);
    return false;
  }

  if (BITMAP_SUBTITLE_CODECS.includes(codec)) {
    if (width === 0 && height === 0) {
      args.jobLog(`    -> Sub validation FAILED: bitmap ${codec} unspecified size`);
      return false;
    }
    if ((width === 0) !== (height === 0)) {
      args.jobLog(`    -> Sub validation FAILED: bitmap ${codec} incomplete dimensions`);
      return false;
    }
    if (width > 8192 || height > 8192 || (width > 0 && width < 16) || (height > 0 && height < 16)) {
      args.jobLog(`    -> Sub validation FAILED: bitmap ${codec} unreasonable dimensions (${width}x${height})`);
      return false;
    }
  }

  if (frameCount === 0 && byteCount === 0 && bitRate === 0) {
    args.jobLog(`    -> Sub validation FAILED: completely empty`);
    return false;
  }

  const zeroIndicators = [
    frameCount === 0,
    byteCount === 0,
    bitRate === 0,
    duration === 0 && streamDuration === 0,
    width === 0 && height === 0 && BITMAP_SUBTITLE_CODECS.includes(codec)
  ];
  if (zeroIndicators.filter(Boolean).length >= 3) {
    args.jobLog(`    -> Sub validation FAILED: too many zero indicators`);
    return false;
  }

  if (BITMAP_SUBTITLE_CODECS.includes(codec)) {
    if (frameCount === 0) {
      args.jobLog(`    -> Sub validation FAILED: bitmap ${codec} no frames`);
      return false;
    }
    if (byteCount === 0) {
      args.jobLog(`    -> Sub validation FAILED: bitmap ${codec} no data`);
      return false;
    }
    if (byteCount > 0 && byteCount < 1000 && frameCount < 10) {
      args.jobLog(`    -> Sub validation FAILED: bitmap ${codec} too small`);
      return false;
    }

    // FFprobe dimension validation for bitmap subs
    try {
      const { execFileSync } = require('child_process');
      const probeResult = execFileSync(ffprobePath, [
        '-v', 'error', '-select_streams', `s:${index}`,
        '-show_entries', 'stream=width,height,codec_name',
        '-of', 'csv=p=0', sourceFile
      ], { encoding: 'utf8', timeout: 5000 });

      const parts = probeResult.trim().split(',');
      const pw = parseInt(parts[0] || '0', 10);
      const ph = parseInt(parts[1] || '0', 10);
      if (Number.isNaN(pw) || Number.isNaN(ph) || (pw === 0 && ph === 0)) {
        args.jobLog(`    -> Sub validation FAILED: ffprobe confirms unspecified size`);
        return false;
      }
    } catch (e) {
      if (frameCount === 0 || byteCount === 0) {
        args.jobLog(`    -> Sub validation FAILED: cannot probe and empty indicators`);
        return false;
      }
    }
  }

  if (['subrip', 'ass', 'ssa', 'webvtt', 'mov_text'].includes(codec)) {
    if (byteCount > 0 && byteCount < 50) {
      args.jobLog(`    -> Sub validation FAILED: text sub too small (${byteCount} bytes)`);
      return false;
    }
    if (frameCount === 0 && byteCount === 0) {
      args.jobLog(`    -> Sub validation FAILED: text sub no frames and no data`);
      return false;
    }
  }

  if (byteCount > 0 && byteCount < 100 && frameCount === 0) {
    args.jobLog(`    -> Sub validation FAILED: too small (${byteCount} bytes, 0 frames)`);
    return false;
  }

  return true;
}

function analyzeAVDesync(videoStreams, audioStreams, args) {
  const primaryVideo = videoStreams[0];
  if (!primaryVideo) return { needsOffset: false, reason: 'No video stream', desyncResults: [] };

  const videoStartTime = parseFloat(primaryVideo.start_time || '0');
  const DESYNC_THRESHOLD_MS = 40;

  const desyncResults = audioStreams.map(({ stream, index, lang }) => {
    const audioStartTime = parseFloat(stream.start_time || '0');
    return {
      streamIndex: index,
      audioStartTime,
      desyncOffset: videoStartTime - audioStartTime,
      language: lang || 'unknown'
    };
  });

  const maxAbsOffsetMs = Math.max(0, ...desyncResults.map(r => Math.abs(r.desyncOffset))) * 1000;
  const needsOffset = maxAbsOffsetMs >= DESYNC_THRESHOLD_MS;

  return {
    needsOffset,
    videoStartTime,
    desyncResults,
    maxAbsOffsetMs,
    threshold: DESYNC_THRESHOLD_MS,
    reason: needsOffset
      ? `Max offset ${maxAbsOffsetMs.toFixed(1)}ms exceeds ${DESYNC_THRESHOLD_MS}ms threshold`
      : `Max offset ${maxAbsOffsetMs.toFixed(1)}ms within threshold`
  };
}

function getVideoQualityTier(height) {
  return height > 720 ? '1080p' : '720p_and_below';
}

// === MAIN MODULE ===

module.exports = async (args) => {
  const { execFileSync } = require('child_process');
  const path = require('path');

  args.jobLog('='.repeat(50));
  args.jobLog('   SMART ANALYZER v3');
  args.jobLog('='.repeat(50));

  const inputFile = args.inputFileObj._id || args.inputFileObj.file;
  const fileName = path.basename(inputFile);
  const ext = path.extname(fileName).toLowerCase().replace('.', '');
  const container = (args.inputFileObj.container || '').toLowerCase();
  const isMKV = ext === 'mkv' || container === 'mkv' || container === 'matroska';
  const isMP4 = ext === 'mp4' || container === 'mp4' || ext === 'm4v';
  const isAVI = ext === 'avi' || container === 'avi';

  args.jobLog(`Input: ${inputFile}`);
  args.jobLog(`Container: ${container} (${isMKV ? 'MKV' : isMP4 ? 'MP4' : isAVI ? 'AVI' : 'Unknown'})`);

  if (!isMKV && !isMP4 && !isAVI) {
    args.jobLog('Not MKV/MP4/AVI -- skipping');
    return { outputFileObj: args.inputFileObj, outputNumber: 1, variables: args.variables };
  }

  const ffprobePath = args.deps.ffprobePath || 'ffprobe';
  const ffmpegPath = args.deps.ffmpegPath || 'ffmpeg';

  // Determine source file (respect workDir if provided)
  const fs = require('fs');
  let sourceFile = inputFile;
  if (args.workDir && args.workDir.trim() !== '') {
    const workingFile = path.join(path.normalize(args.workDir), path.basename(inputFile));
    if (fs.existsSync(workingFile)) {
      sourceFile = workingFile;
      args.jobLog(`Using working file: ${sourceFile}`);
    }
  }

  if (!fs.existsSync(sourceFile)) {
    args.jobLog(`ERROR: Source file does not exist: ${sourceFile}`);
    return { outputFileObj: args.inputFileObj, outputNumber: 4, variables: args.variables };
  }

  // ─── STEP 1: FFPROBE ───
  args.jobLog('\n--- FFprobe Analysis ---');
  let mediaInfo;
  try {
    const probeResult = execFileSync(ffprobePath, [
      '-v', 'quiet', '-print_format', 'json',
      '-show_streams', '-show_format', sourceFile
    ], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });
    mediaInfo = JSON.parse(probeResult);
  } catch (e) {
    args.jobLog(`ERROR: ffprobe failed: ${e.message}`);
    return { outputFileObj: args.inputFileObj, outputNumber: 4, variables: args.variables };
  }

  const streams = mediaInfo.streams || [];
  const duration = parseFloat(mediaInfo.format?.duration || '0');
  const overallBitrate = parseInt(mediaInfo.format?.bit_rate || '0', 10);
  args.jobLog(`Found ${streams.length} streams, duration ${duration.toFixed(1)}s, bitrate ${Math.round(overallBitrate / 1000)}kbps`);

  // ─── STEP 2: CLASSIFY STREAMS ───
  const rawVideoStreams = streams.filter(s => s.codec_type === 'video');
  const coverArtStreams = rawVideoStreams.filter(s => s.disposition && s.disposition.attached_pic);
  const videoStreams = rawVideoStreams.filter(s => !(s.disposition && s.disposition.attached_pic));
  const audioStreams = streams.filter(s => s.codec_type === 'audio');
  const subtitleStreams = streams.filter(s => s.codec_type === 'subtitle');

  if (coverArtStreams.length > 0) {
    args.jobLog(`Removing ${coverArtStreams.length} cover-art stream(s)`);
  }

  args.jobLog(`Video: ${videoStreams.length}, Audio: ${audioStreams.length}, Subtitle: ${subtitleStreams.length}`);

  if (videoStreams.length === 0) {
    args.jobLog('ERROR: No video streams found');
    return { outputFileObj: args.inputFileObj, outputNumber: 4, variables: args.variables };
  }

  // ─── STEP 3: VIDEO ANALYSIS ───
  args.jobLog('\n--- Video Analysis ---');
  const primaryVideo = videoStreams[0];
  const videoCodec = (primaryVideo.codec_name || '').toLowerCase();
  const videoHeight = parseInt(primaryVideo.height || '0', 10);
  const videoWidth = parseInt(primaryVideo.width || '0', 10);
  const videoQualityTier = getVideoQualityTier(videoHeight);

  // Calculate video bitrate (overall - audio bitrates)
  let audioBitrateSum = 0;
  audioStreams.forEach(s => {
    audioBitrateSum += parseInt(s.bit_rate || '0', 10);
  });
  const estimatedVideoBitrate = Math.max(0, overallBitrate - audioBitrateSum);
  const estimatedVideoBitrateKbps = Math.round(estimatedVideoBitrate / 1000);

  const isHEVC = videoCodec === 'hevc' || videoCodec === 'h265';
  const bitrateThreshold = VIDEO_BITRATE_THRESHOLDS[videoQualityTier];
  const videoBitrateOk = estimatedVideoBitrateKbps <= bitrateThreshold;
  const needsVideoReencode = !isHEVC || !videoBitrateOk;

  // Determine target resolution for downscaling
  // Only downscale if the source is significantly above the target (>10% taller).
  // This avoids pointless quality loss on files like 1920x800 (cinema 2.4:1) that are
  // technically "above 720p" but close enough to keep as-is.
  let targetResolution = null;
  if (needsVideoReencode) {
    if (videoHeight > 1080) {
      // 4K/1440p: keep original (no scaling)
    } else if (videoHeight > 900) {
      // True 1080p content (>900 lines) — downscale to 720p
      // This preserves cinema crops like 1920x800 (2.4:1) which are 720p-class
      targetResolution = '720p';
    } else if (videoHeight > 600 && videoHeight <= 720) {
      // True 720p content (>600 lines, <=720) — downscale to 480p
      targetResolution = '480p';
    }
    // Otherwise (<=600, or 721-900 like cinema crops): keep original resolution
  }

  args.jobLog(`Video: ${videoCodec} ${videoWidth}x${videoHeight} (~${estimatedVideoBitrateKbps}kbps)`);
  args.jobLog(`Quality tier: ${videoQualityTier}, threshold: ${bitrateThreshold}kbps`);
  args.jobLog(`HEVC: ${isHEVC}, bitrate OK: ${videoBitrateOk}, needs re-encode: ${needsVideoReencode}`);
  if (targetResolution) args.jobLog(`Target resolution: ${targetResolution}`);

  // ─── STEP 4: AUDIO ANALYSIS ───
  args.jobLog('\n--- Audio Analysis ---');

  const audioCategories = {
    english: [], japanese: [], korean: [], french: [],
    unknown: [], commentary: [], other: []
  };

  audioStreams.forEach((stream, arrayIndex) => {
    const lang = detectLanguage(stream);
    const title = stream.tags?.title || '';
    const language = stream.tags?.language || 'und';
    const idx = stream.index;

    args.jobLog(`  Stream ${idx}: "${title}" (${language}) -> ${lang}`);

    if (!validateAudioStream(stream, arrayIndex, args, sourceFile, ffprobePath, ffmpegPath)) {
      args.jobLog(`    -> Skipping (failed validation)`);
      return;
    }

    const cat = lang === 'commentary' ? 'commentary'
      : lang === 'eng' ? 'english'
      : lang === 'jpn' ? 'japanese'
      : lang === 'kor' ? 'korean'
      : lang === 'fre' ? 'french'
      : lang === 'unknown' ? 'unknown'
      : 'other';
    audioCategories[cat].push({ stream, index: idx });
  });

  // Select audio streams to keep
  const keptAudioStreams = [];

  if (audioCategories.english.length > 0) {
    keptAudioStreams.push(audioCategories.english[0]);
    if (audioCategories.english.length > 1) {
      args.jobLog(`Skipping ${audioCategories.english.length - 1} extra English track(s)`);
    }
  }
  keptAudioStreams.push(
    ...audioCategories.japanese,
    ...audioCategories.korean,
    ...audioCategories.french
  );

  if (audioCategories.unknown.length > 0) {
    keptAudioStreams.push(audioCategories.unknown[0]);
    if (audioCategories.unknown.length > 1) {
      args.jobLog(`Keeping only first of ${audioCategories.unknown.length} unknown audio streams`);
    }
  }

  if (keptAudioStreams.length === 0) {
    if (audioCategories.other.length > 0) {
      keptAudioStreams.push(...audioCategories.other);
      args.jobLog('No supported language detected, keeping all non-commentary streams');
    } else if (audioStreams.length > 0) {
      keptAudioStreams.push({ stream: audioStreams[0], index: audioStreams[0].index });
      args.jobLog('FALLBACK: keeping first original audio stream');
    } else {
      args.jobLog('ERROR: No audio streams available');
      return { outputFileObj: args.inputFileObj, outputNumber: 4, variables: args.variables };
    }
  }

  args.jobLog(`Keeping ${keptAudioStreams.length} audio stream(s)`);

  // Check if primary audio is multichannel
  const primaryAudioChannels = parseInt(keptAudioStreams[0].stream.channels || '0', 10);
  const isMultichannel = primaryAudioChannels > 2;
  args.jobLog(`Primary audio: ${primaryAudioChannels} channels (${isMultichannel ? 'multichannel' : 'stereo/mono'})`);

  // ─── STEP 5: SUBTITLE ANALYSIS ───
  args.jobLog('\n--- Subtitle Analysis ---');

  const keptSubtitleStreams = [];

  const subCategories = { english: [], unknown: [] };

  subtitleStreams.forEach((stream) => {
    const title = (stream.tags?.title || '').toLowerCase();
    const language = (stream.tags?.language || '').toLowerCase();
    const codec = stream.codec_name || '';
    const idx = stream.index;
    const arrayIndex = subtitleStreams.indexOf(stream);

    args.jobLog(`  Stream ${idx}: "${stream.tags?.title || ''}" (${language}, ${codec})`);

    if (!validateSubtitleStream(stream, arrayIndex, args, sourceFile, ffprobePath)) {
      args.jobLog(`    -> Skipping (failed validation)`);
      return;
    }

    if (BITMAP_SUBTITLE_CODECS.includes(codec)) {
      args.jobLog(`    -> Skipping (bitmap: ${codec})`);
      return;
    }

    const isEnglish = language === 'eng' || language === 'en' ||
      languagePatterns.eng.some(p => p.test(`${title} ${language}`));

    if (isEnglish) {
      subCategories.english.push({ stream, index: idx, codec });
    } else if (!language || language === 'und' || language === '') {
      subCategories.unknown.push({ stream, index: idx, codec });
    } else {
      args.jobLog(`    -> Skipping (not English: ${language})`);
    }
  });

  // Process English subs
  subCategories.english.forEach(({ stream, index, codec }) => {
    const needsConversion = CONVERTIBLE_SUBTITLE_CODECS.includes(codec);
    keptSubtitleStreams.push({ stream, index, needsConversion, codec });
    args.jobLog(`    -> Keeping${needsConversion ? ` (convert ${codec} to SRT)` : ''}`);
  });

  // Process unknown subs (keep only first)
  if (subCategories.unknown.length > 0) {
    const { stream, index, codec } = subCategories.unknown[0];
    const needsConversion = CONVERTIBLE_SUBTITLE_CODECS.includes(codec);
    keptSubtitleStreams.push({ stream, index, needsConversion, codec });
    if (subCategories.unknown.length > 1) {
      args.jobLog(`Keeping only first of ${subCategories.unknown.length} unknown subtitle streams`);
    }
  }

  args.jobLog(`Keeping ${keptSubtitleStreams.length} subtitle stream(s)`);

  // ─── STEP 6: DESYNC ANALYSIS ───
  args.jobLog('\n--- Desync Analysis ---');

  const keptAudioWithLang = keptAudioStreams.map(({ stream, index }) => ({
    stream, index, lang: detectLanguage(stream)
  }));

  const desyncAnalysis = analyzeAVDesync(videoStreams, keptAudioWithLang, args);
  args.jobLog(`Desync: ${desyncAnalysis.reason}`);

  // ─── STEP 7: ROUTING DECISION ───
  args.jobLog('\n--- Routing Decision ---');

  // Determine if audio processing is needed
  const primaryAudioCodec = (keptAudioStreams[0].stream.codec_name || '').toLowerCase();
  const primaryAudioBitrate = parseInt(keptAudioStreams[0].stream.bit_rate || '0', 10);
  const primaryAudioBitrateKbps = Math.round(primaryAudioBitrate / 1000);

  // Audio is "perfect" if: AAC, stereo, <=128kbps, and we're not dropping streams or fixing desync
  const audioIsAAC = primaryAudioCodec === 'aac';
  const audioIsStereo = primaryAudioChannels <= 2;
  // Check if bitrate is close to our target (128k) -- allow up to 129k for rounding
  const audioBitrateOk = primaryAudioBitrateKbps > 0 && primaryAudioBitrateKbps <= 129;

  const streamsBeingDropped = streams.length > (videoStreams.length + keptAudioStreams.length + keptSubtitleStreams.length);
  const hasSubConversions = keptSubtitleStreams.some(s => s.needsConversion);
  const hasDesync = desyncAnalysis.needsOffset;

  // Check if ALL kept audio streams are already perfect
  let allAudioPerfect = true;
  for (const { stream } of keptAudioStreams) {
    const c = (stream.codec_name || '').toLowerCase();
    const ch = parseInt(stream.channels || '0', 10);
    const br = Math.round(parseInt(stream.bit_rate || '0', 10) / 1000);
    // br === 0 means ffprobe couldn't determine bitrate (common in MKV) -- treat as OK for AAC stereo
    if (c !== 'aac' || ch > 2 || (br > 0 && br > 129)) {
      allAudioPerfect = false;
      break;
    }
  }

  const needsAudioWork = !allAudioPerfect || streamsBeingDropped || hasSubConversions || hasDesync;

  args.jobLog(`Video: ${isHEVC ? 'HEVC' : videoCodec}, re-encode: ${needsVideoReencode}`);
  args.jobLog(`Audio: ${primaryAudioCodec} ${primaryAudioChannels}ch ${primaryAudioBitrateKbps}kbps, all perfect: ${allAudioPerfect}`);
  args.jobLog(`Streams dropped: ${streamsBeingDropped}, sub conversions: ${hasSubConversions}, desync: ${hasDesync}`);
  args.jobLog(`Needs audio work: ${needsAudioWork}, needs video re-encode: ${needsVideoReencode}`);

  // Build the serializable analyzer variables
  const analyzerAudioStreams = keptAudioStreams.map(({ stream, index }) => ({
    index,
    language: detectLanguage(stream),
    channels: parseInt(stream.channels || '0', 10),
    codec: (stream.codec_name || '').toLowerCase(),
    isDefault: index === keptAudioStreams[0].index,
    // Store the audio-relative index for -map commands
    audioRelativeIndex: audioStreams.findIndex(s => s.index === index)
  }));

  const analyzerSubtitleStreams = keptSubtitleStreams.map(({ stream, index, needsConversion, codec }) => ({
    index,
    needsConversion,
    codec,
    // Store the subtitle-relative index for -map commands
    subtitleRelativeIndex: subtitleStreams.findIndex(s => s.index === index)
  }));

  const vars = {
    ...args.variables,
    analyzer_audioStreams: JSON.stringify(analyzerAudioStreams),
    analyzer_subtitleStreams: JSON.stringify(analyzerSubtitleStreams),
    analyzer_videoStreamIndex: primaryVideo.index,
    analyzer_desync: JSON.stringify({
      needsOffset: desyncAnalysis.needsOffset,
      videoStartTime: desyncAnalysis.videoStartTime,
      results: desyncAnalysis.desyncResults
    }),
    analyzer_isMultichannel: isMultichannel,
    analyzer_needsVideoReencode: needsVideoReencode,
    analyzer_videoQualityTier: videoQualityTier,
    analyzer_targetResolution: targetResolution || '',
    analyzer_duration: duration,
    analyzer_videoCodec: videoCodec,
    analyzer_sourceFile: sourceFile
  };

  let outputNumber;
  if (!needsAudioWork && !needsVideoReencode) {
    outputNumber = 1;
    args.jobLog('ROUTE: 1 (skip -- file is perfect)');
  } else if (needsAudioWork && !needsVideoReencode) {
    outputNumber = 2;
    args.jobLog('ROUTE: 2 (audio-only executor)');
  } else {
    outputNumber = 3;
    args.jobLog('ROUTE: 3 (AV executor)');
  }

  args.jobLog('='.repeat(50));
  args.jobLog('   ANALYSIS COMPLETE');
  args.jobLog('='.repeat(50));

  return {
    outputFileObj: args.inputFileObj,
    outputNumber,
    variables: vars
  };
};
