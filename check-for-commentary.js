// Enhanced Commentary Track Inspector & Remover
// Inspects audio tracks for commentary and removes them directly
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
  console.log('   COMMENTARY TRACK INSPECTOR & REMOVER');
  console.log('═══════════════════════════════════════');
  console.log(`File: ${inputFile}`);
  console.log(`Container: ${args.inputFileObj.container}`);

  // Enhanced commentary detection patterns
  const commentaryPatterns = [
    /commentary/i,
    /director.?s?\s+commentary/i,
    /cast\s+commentary/i,
    /production.*commentary/i,
    /design.*commentary/i,
    /audio\s+commentary/i,
    /filmmaker.*commentary/i,
    /writer.*commentary/i,
    /producer.*commentary/i,
    /behind.*scenes/i,
    /making.*of/i,
    /^commentary$/i,
    /\bcomm\b/i,  // common abbreviation
    /director.*track/i,
    /bonus.*audio/i
  ];

  function resolveBin(candidates) {
    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }
    return null;
  }

  function isCommentaryTrack(trackName, handlerName = '') {
    const textToCheck = `${trackName} ${handlerName}`.toLowerCase().trim();
    if (!textToCheck) return false;
    
    return commentaryPatterns.some(pattern => pattern.test(textToCheck));
  }

  // Skip if not supported container
  if (!isMKV && !isMP4) {
    console.log('❌ Not MKV or MP4 — skipping commentary removal');
    args.variables.skipProcessing = true;
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables,
      processFile: false
    };
  }

  let audioTracks = [];
  let commentaryTracks = [];

  try {
    if (isMKV) {
      // Use mkvmerge for MKV files
      const mkvmergeExe =
        resolveBin([
          'C:\\Program Files\\MKVToolNix\\mkvmerge.exe',
          'C:\\Program Files (x86)\\MKVToolNix\\mkvmerge.exe'
        ]) || 'mkvmerge';

      console.log(`Using mkvmerge: ${mkvmergeExe}`);

      // Test accessibility
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

      console.log('\n━━━ Running mkvmerge -i (JSON) ━━━');
      const out = execFileSync(
        mkvmergeExe,
        ['--identification-format', 'json', '-i', inputFile],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );

      const info = JSON.parse(out);
      const tracks = info.tracks || [];
      
      audioTracks = tracks.filter(t => t.type === 'audio').map(t => {
        const props = t.properties || {};
        return {
          id: t.id,
          type: t.type,
          codec: t.codec || props.codec_id || 'unknown',
          language: props.language || 'und',
          name: props.track_name || '',
          default: props.default_track === true,
          forced: props.forced_track === true
        };
      });

      // Find commentary tracks
      commentaryTracks = audioTracks.filter(track => 
        isCommentaryTrack(track.name)
      );

      if (commentaryTracks.length > 0) {
        console.log(`\n🎯 Found ${commentaryTracks.length} commentary track(s):`);
        commentaryTracks.forEach(track => {
          console.log(`  - Track ${track.id}: "${track.name}" (${track.language})`);
        });

        // Build mkvmerge command to remove commentary tracks
        const outputFile = inputFile.replace(/(\.[^.]+)$/, '_no_commentary$1');
        const keepAudioTracks = audioTracks
          .filter(track => !commentaryTracks.some(ct => ct.id === track.id))
          .map(track => track.id);

        if (keepAudioTracks.length === 0) {
          console.log('⚠️ All audio tracks are commentary - keeping original file');
          args.variables.hasCommentary = false;
          args.variables.commentaryNote = 'All audio tracks are commentary - no removal performed';
        } else {
          // Use mkvmerge to create new file without commentary
          const mkvArgs = [
            '-o', outputFile,
            '--audio-tracks', keepAudioTracks.join(','),
            inputFile
          ];

          console.log('\n━━━ Removing commentary with mkvmerge ━━━');
          console.log(`Command: ${mkvmergeExe} ${mkvArgs.join(' ')}`);
          
          execFileSync(mkvmergeExe, mkvArgs, { 
            encoding: 'utf8', 
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 300000 // 5 minutes
          });

          // Update file object to point to new file
          args.inputFileObj._id = outputFile;
          args.inputFileObj.path = outputFile;
          args.inputFileObj.sourceFile = outputFile;
          
          args.variables.hasCommentary = true;
          args.variables.commentaryRemoved = true;
          args.variables.originalFile = inputFile;
          args.variables.processedFile = outputFile;
          args.variables.commentaryNote = `Removed ${commentaryTracks.length} commentary track(s) using mkvmerge`;
          
          console.log(`✅ Commentary removed: ${outputFile}`);
        }
      }

    } else if (isMP4) {
      // Use ffprobe for MP4 files
      const ffprobeExe =
        resolveBin([
          'C:\\programdata\\chocolatey\\bin\\ffprobe.exe',
          'C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe',
          'C:\\ffmpeg\\bin\\ffprobe.exe'
        ]) || 'ffprobe';

      const ffmpegExe =
        resolveBin([
          'C:\\programdata\\chocolatey\\bin\\ffmpeg.exe',
          'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
          'C:\\ffmpeg\\bin\\ffmpeg.exe'
        ]) || 'ffmpeg';

      console.log(`Using ffprobe: ${ffprobeExe}`);
      console.log(`Using ffmpeg: ${ffmpegExe}`);

      // Test accessibility
      try {
        execFileSync(ffprobeExe, ['-version'], { encoding: 'utf8', timeout: 10000 });
        execFileSync(ffmpegExe, ['-version'], { encoding: 'utf8', timeout: 10000 });
        console.log('✓ ffprobe and ffmpeg are accessible');
      } catch (testError) {
        console.error('❌ ffmpeg tools not accessible:', testError.message);
        args.variables.skipProcessing = true;
        args.variables.error = `ffmpeg tools not accessible: ${testError.message}`;
        return {
          outputFileObj: args.inputFileObj,
          outputNumber: 2,
          variables: args.variables,
          processFile: false
        };
      }

      console.log('\n━━━ Running ffprobe (JSON) ━━━');
      const out = execFileSync(
        ffprobeExe,
        ['-v', 'quiet', '-print_format', 'json', '-show_streams', inputFile],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );

      const info = JSON.parse(out);
      const streams = info.streams || [];
      
      audioTracks = streams
        .filter(s => s.codec_type === 'audio')
        .map((stream, index) => {
          const tags = stream.tags || {};
          const disp = stream.disposition || {};
          return {
            id: stream.index,
            streamIndex: index,
            type: 'audio',
            codec: stream.codec_name || 'unknown',
            language: tags.language || stream.language || 'und',
            name: tags.title || tags.name || tags.handler_name || '',
            default: disp.default === 1,
            forced: disp.forced === 1
          };
        });

      // Find commentary tracks
      commentaryTracks = audioTracks.filter(track => 
        isCommentaryTrack(track.name)
      );

      if (commentaryTracks.length > 0) {
        console.log(`\n🎯 Found ${commentaryTracks.length} commentary track(s):`);
        commentaryTracks.forEach(track => {
          console.log(`  - Stream ${track.id}: "${track.name}" (${track.language})`);
        });

        const keepAudioTracks = audioTracks
          .filter(track => !commentaryTracks.some(ct => ct.id === track.id));

        if (keepAudioTracks.length === 0) {
          console.log('⚠️ All audio tracks are commentary - keeping original file');
          args.variables.hasCommentary = false;
          args.variables.commentaryNote = 'All audio tracks are commentary - no removal performed';
        } else {
          // Build ffmpeg command to remove commentary tracks
          const outputFile = inputFile.replace(/(\.[^.]+)$/, '_no_commentary$1');
          
          // Build map arguments to exclude commentary tracks
          const ffmpegArgs = ['-i', inputFile];
          
          // Map all video streams
          const videoStreams = streams.filter(s => s.codec_type === 'video');
          videoStreams.forEach(stream => {
            ffmpegArgs.push('-map', `0:${stream.index}`);
          });
          
          // Map only non-commentary audio streams
          keepAudioTracks.forEach(track => {
            ffmpegArgs.push('-map', `0:${track.id}`);
          });
          
          // Map all subtitle streams
          const subtitleStreams = streams.filter(s => s.codec_type === 'subtitle');
          subtitleStreams.forEach(stream => {
            ffmpegArgs.push('-map', `0:${stream.index}`);
          });
          
          // Copy codecs
          ffmpegArgs.push('-c', 'copy', '-y', outputFile);

          console.log('\n━━━ Removing commentary with ffmpeg ━━━');
          console.log(`Command: ${ffmpegExe} ${ffmpegArgs.join(' ')}`);
          
          execFileSync(ffmpegExe, ffmpegArgs, { 
            encoding: 'utf8', 
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 300000 // 5 minutes
          });

          // Update file object to point to new file
          args.inputFileObj._id = outputFile;
          args.inputFileObj.path = outputFile;
          args.inputFileObj.sourceFile = outputFile;
          
          args.variables.hasCommentary = true;
          args.variables.commentaryRemoved = true;
          args.variables.originalFile = inputFile;
          args.variables.processedFile = outputFile;
          args.variables.commentaryNote = `Removed ${commentaryTracks.length} commentary track(s) using ffmpeg`;
          
          console.log(`✅ Commentary removed: ${outputFile}`);
        }
      }
    }

    if (commentaryTracks.length === 0) {
      console.log('✅ No commentary tracks detected');
      args.variables.hasCommentary = false;
      args.variables.commentaryNote = 'No commentary tracks detected';
    }

    console.log(`\n📊 Audio Track Summary:`);
    console.log(`  Total audio tracks: ${audioTracks.length}`);
    console.log(`  Commentary tracks: ${commentaryTracks.length}`);
    console.log(`  Remaining tracks: ${audioTracks.length - commentaryTracks.length}`);

  } catch (err) {
    const msg = (err && (err.stderr?.toString() || err.stdout?.toString() || err.message)) || 'unknown error';
    console.error('❌ Error during commentary processing:', msg);
    args.variables.skipProcessing = true;
    args.variables.error = msg;
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
