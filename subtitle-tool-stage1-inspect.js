// Stage 1: Run mkvmerge -i (JSON) and parse tracks
module.exports = async (args) => {
  const fs = require('fs');
  const path = require('path');
  const { execFileSync } = require('child_process');

  args.variables = args.variables || {};

  const inputFile =
    args.inputFileObj._id ||
    args.inputFileObj.path ||
    args.inputFileObj.sourceFile; // fallback safety
  const fileName = path.basename(inputFile);
  const ext = path.extname(fileName).toLowerCase().replace('.', '');
  const container = (args.inputFileObj.container || '').toLowerCase();
  const isMKV = ext === 'mkv' || container === 'mkv' || container === 'matroska';

  console.log('═══════════════════════════════════════');
  console.log('   STAGE 1: MKVMERGE INSPECTION');
  console.log('═══════════════════════════════════════');
  console.log(`File: ${inputFile}`);
  console.log(`Container: ${args.inputFileObj.container}`);

  if (!isMKV) {
    console.log('❌ Not MKV — skipping');
    args.variables.skipProcessing = true;
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,          // wire this to your Skip node
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

  const mkvmergeExe =
    resolveBin([
      'C:\\Program Files\\MKVToolNix\\mkvmerge.exe',
      'C:\\Program Files (x86)\\MKVToolNix\\mkvmerge.exe'
    ]) || 'mkvmerge'; // last resort: PATH

  console.log(`Using mkvmerge: ${mkvmergeExe}`);

  // Test if mkvmerge is accessible
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
    // console.log(out); // uncomment if you want raw JSON in logs

    const info = JSON.parse(out);
    const tracks = (info.tracks || []).map(t => {
      const props = t.properties || {};
      const codec = t.codec || props.codec_id || 'unknown';

      return {
        id: t.id,
        type: t.type,                  // 'video' | 'audio' | 'subtitles'
        codec,
        language: props.language || 'und',
        default: props.default_track === true || props.default_track === 1 || props.default_track === '1' || props.default_track === 'yes',
        forced: props.forced_track === true || props.forced_track === 1 || props.forced_track === '1' || props.forced_track === 'yes',
        name: props.track_name || '',
        properties: props
      };
    });

    console.log(`✓ Found ${tracks.length} total tracks`);
    const subtitleTracks = tracks.filter(t => t.type === 'subtitles');
    console.log(`✓ Found ${subtitleTracks.length} subtitle tracks`);

    args.variables.mkvmergeInfo = info;         // keep full JSON if later stages need more detail
    args.variables.mkvTracks = tracks;
    args.variables.subtitleTracks = subtitleTracks;
    args.variables.originalFile = inputFile;

    if (subtitleTracks.length === 0) {
      console.log('⚠️ No subtitle tracks — skipping');
      args.variables.skipProcessing = true;
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 2,          // to Skip node
        variables: args.variables,
        processFile: false
      };
    }

    args.variables.skipProcessing = false;
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,            // continue to Extract/Convert
      variables: args.variables
    };

  } catch (err) {
    const msg = (err && (err.stderr?.toString() || err.stdout?.toString() || err.message)) || 'unknown error';
    console.error('❌ Error running mkvmerge:', msg);
    args.variables.skipProcessing = true;
    args.variables.error = msg;
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,            // to Skip node
      variables: args.variables,
      processFile: false
    };
  }
};
