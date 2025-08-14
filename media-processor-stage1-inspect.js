// Stage 1: Comprehensive Media Inspection
// Analyzes video, audio, and subtitle streams to determine processing needs
module.exports = async (args) => {
  const fs = require('fs');
  const path = require('path');
  const { execFileSync } = require('child_process');

  args.variables = args.variables || {};

  const inputFile =
    args.inputFileObj._id ||
    args.inputFileObj.path ||
    args.inputFileObj.sourceFile;
  const fileName = path.basename(inputFile);
  const ext = path.extname(fileName).toLowerCase().replace('.', '');
  const container = (args.inputFileObj.container || '').toLowerCase();
  const isMKV = ext === 'mkv' || container === 'mkv' || container === 'matroska';
  const isMP4 = ext === 'mp4' || container === 'mp4' || ext === 'm4v';

  console.log('═══════════════════════════════════════');
  console.log('   STAGE 1: COMPREHENSIVE MEDIA INSPECTION');
  console.log('═══════════════════════════════════════');
  console.log(`File: ${inputFile}`);
  console.log(`Container: ${args.inputFileObj.container}`);

  if (!isMKV && !isMP4) {
    console.log('❌ Not MKV or MP4 — skipping');
    args.variables.skipProcessing = true;
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables,
      processFile: false
    };
  }

  function resolveBin(candidates) {
    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }
    return null;
  }

  // Store container type for later stages
  args.variables.containerType = isMKV ? 'mkv' : 'mp4';
  args.variables.originalFile = inputFile;

  let tracks = [];
  let videoTracks = [];
  let audioTracks = [];
  let subtitleTracks = [];

  if (isMKV) {
    // Use mkvmerge for MKV files
    const mkvmergeExe =
      resolveBin([
        'C:\\Program Files\\MKVToolNix\\mkvmerge.exe',
        'C:\\Program Files (x86)\\MKVToolNix\\mkvmerge.exe'
      ]) || 'mkvmerge';

    console.log(`Using mkvmerge: ${mkvmergeExe}`);

    try {
      execFileSync(mkvmergeExe, ['--version'], { encoding: 'utf8', timeout: 10000 });
      console.log('✓ mkvmerge is accessible');
    } catch (testError) {
      console.error('❌ mkvmerge not accessible:', testError.message);
      args.variables.skipProcessing = true;
      args.variables.error = `mkvmerge not accessible: ${testError.message}`;
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 2,
        variables: args.variables,
        processFile: false
      };
    }

    try {
      console.log('\n━━━ Running mkvmerge -i (JSON) ━━━');
      const out = execFileSync(
        mkvmergeExe,
        ['--identification-format', 'json', '-i', inputFile],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );

      const info = JSON.parse(out);
      tracks = (info.tracks || []).map(t => {
        const props = t.properties || {};
        const codec = t.codec || props.codec_id || 'unknown';

        return {
          id: t.id,
          type: t.type,
          codec,
          language: props.language || 'und',
          default: props.default_track === true || props.default_track === 1 || props.default_track === '1' || props.default_track === 'yes',
          forced: props.forced_track === true || props.forced_track === 1 || props.forced_track === '1' || props.forced_track === 'yes',
          name: props.track_name || '',
          channels: props.audio_channels || 0,
          properties: props
        };
      });

      args.variables.mkvmergeInfo = info;
    } catch (err) {
      const msg = (err && (err.stderr?.toString() || err.stdout?.toString() || err.message)) || 'unknown error';
      console.error('❌ Error running mkvmerge:', msg);
      args.variables.skipProcessing = true;
      args.variables.error = msg;
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 2,
        variables: args.variables,
        processFile: false
      };
    }

  } else if (isMP4) {
    // Use ffprobe for MP4 files
    const ffprobeExe =
      resolveBin([
        'C:\\programdata\\chocolatey\\bin\\ffprobe.exe',
        'C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe',
        'C:\\ffmpeg\\bin\\ffprobe.exe'
      ]) || 'ffprobe';

    console.log(`Using ffprobe: ${ffprobeExe}`);

    try {
      execFileSync(ffprobeExe, ['-version'], { encoding: 'utf8', timeout: 10000 });
      console.log('✓ ffprobe is accessible');
    } catch (testError) {
      console.error('❌ ffprobe not accessible:', testError.message);
      args.variables.skipProcessing = true;
      args.variables.error = `ffprobe not accessible: ${testError.message}`;
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 2,
        variables: args.variables,
        processFile: false
      };
    }

    try {
      console.log('\n━━━ Running ffprobe (JSON) ━━━');
      const out = execFileSync(
        ffprobeExe,
        ['-v', 'quiet', '-print_format', 'json', '-show_streams', inputFile],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );

      const info = JSON.parse(out);
      tracks = (info.streams || []).map((stream, index) => {
        const codec = stream.codec_name || 'unknown';
        let type = 'unknown';
        
        if (stream.codec_type === 'video') type = 'video';
        else if (stream.codec_type === 'audio') type = 'audio';
        else if (stream.codec_type === 'subtitle') type = 'subtitles';

        const disp = stream.disposition || {};
        const tags = stream.tags || {};

        return {
          id: index,
          type: type,
          codec: codec,
          language: tags.language || stream.language || 'und',
          default: disp.default === 1,
          forced: disp.forced === 1,
          name: tags.title || tags.name || '',
          channels: stream.channels || 0,
          properties: {
            codec_id: codec,
            language: tags.language || stream.language || 'und',
            default_track: disp.default === 1,
            forced_track: disp.forced === 1,
            track_name: tags.title || tags.name || '',
            audio_channels: stream.channels || 0
          }
        };
      });

      args.variables.ffprobeInfo = info;
    } catch (err) {
      const msg = (err && (err.stderr?.toString() || err.stdout?.toString() || err.message)) || 'unknown error';
      console.error('❌ Error running ffprobe:', msg);
      args.variables.skipProcessing = true;
      args.variables.error = msg;
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 2,
        variables: args.variables,
        processFile: false
      };
    }
  }

  // Separate tracks by type
  videoTracks = tracks.filter(t => t.type === 'video');
  audioTracks = tracks.filter(t => t.type === 'audio');
  subtitleTracks = tracks.filter(t => t.type === 'subtitles');

  console.log(`✓ Found ${tracks.length} total tracks`);
  console.log(`  - Video: ${videoTracks.length}`);
  console.log(`  - Audio: ${audioTracks.length}`);
  console.log(`  - Subtitles: ${subtitleTracks.length}`);

  // Store all track information
  args.variables.allTracks = tracks;
  args.variables.videoTracks = videoTracks;
  args.variables.audioTracks = audioTracks;
  args.variables.subtitleTracks = subtitleTracks;

  // Check if any processing is needed
  const hasSubtitles = subtitleTracks.length > 0;
  const hasMultipleAudio = audioTracks.length > 1;
  
  if (!hasSubtitles && !hasMultipleAudio) {
    console.log('⚠️ No subtitles or multiple audio tracks — skipping');
    args.variables.skipProcessing = true;
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables,
      processFile: false
    };
  }

  args.variables.skipProcessing = false;
  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables
  };
};
