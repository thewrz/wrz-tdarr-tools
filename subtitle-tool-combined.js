// Combined Subtitle Tool - All Stages in One
// Optimized for memory efficiency and resource usage
// Processes subtitles: Inspect → Analyze → Extract → Convert → Remux

module.exports = async (args) => {
  const fs = require('fs');
  const path = require('path');
  const { execFileSync, spawn } = require('child_process');
  const crypto = require('crypto');

  // Initialize variables
  args.variables = args.variables || {};
  
  const inputFile = args.inputFileObj._id || args.inputFileObj.path || args.inputFileObj.sourceFile;
  const fileName = path.basename(inputFile);
  const ext = path.extname(fileName).toLowerCase().replace('.', '');
  const container = (args.inputFileObj.container || '').toLowerCase();
  const isMKV = ext === 'mkv' || container === 'mkv' || container === 'matroska';
  const isMP4 = ext === 'mp4' || container === 'mp4' || ext === 'm4v';

  console.log('═══════════════════════════════════════');
  console.log('   COMBINED SUBTITLE PROCESSOR');
  console.log('═══════════════════════════════════════');
  console.log(`File: ${inputFile}`);
  console.log(`Container: ${args.inputFileObj.container}`);

  // Early exit for unsupported containers
  if (!isMKV && !isMP4) {
    console.log('❌ Not MKV or MP4 — skipping');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables,
      processFile: false
    };
  }

  // Helper functions
  function resolveBin(candidates) {
    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }
    return null;
  }

  function isBitmapSubtitle(codec) {
    const bitmapFormats = ['hdmv_pgs', 'pgs', 'dvb_subtitle', 'dvb', 'dvd_subtitle', 'vobsub', 'xsub', 'cc_dec', 'arib_caption'];
    return bitmapFormats.some(format => codec.toLowerCase().includes(format));
  }

  function isSRTSubtitle(codec) {
    const codecLower = codec.toLowerCase();
    return codecLower.includes('subrip') || codecLower === 'srt';
  }

  function isTextSubtitle(codec) {
    const textFormats = ['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'vtt', 'ttml', 'mov_text', 'text', 'subtitle'];
    return textFormats.some(format => codec.toLowerCase().includes(format));
  }

  // Setup working directory
  let workDir = 'Y:/cache';
  if (args.librarySettings && args.librarySettings.cache) {
    workDir = args.librarySettings.cache;
  }

  try {
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }
  } catch (error) {
    console.error(`❌ Failed to create working directory: ${error.message}`);
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables,
      processFile: false
    };
  }

  // Create unique session ID
  const inputFileHash = crypto.createHash('md5').update(inputFile).digest('hex').substring(0, 8);
  const uniqueId = `${inputFileHash}_${process.pid}_${Date.now()}`;
  console.log(`Session ID: ${uniqueId}`);

  // ═══════════════════════════════════════
  // STAGE 1: INSPECT SUBTITLE TRACKS
  // ═══════════════════════════════════════
  console.log('\n━━━ STAGE 1: INSPECTING TRACKS ━━━');
  
  let tracks = [];
  let subtitleTracks = [];

  try {
    if (isMKV) {
      const mkvmergeExe = resolveBin([
        'C:\\Program Files\\MKVToolNix\\mkvmerge.exe',
        'C:\\Program Files (x86)\\MKVToolNix\\mkvmerge.exe'
      ]) || 'mkvmerge';

      // Test accessibility
      execFileSync(mkvmergeExe, ['--version'], { encoding: 'utf8', timeout: 10000 });
      
      const out = execFileSync(mkvmergeExe, ['--identification-format', 'json', '-i', inputFile], 
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

      const info = JSON.parse(out);
      tracks = (info.tracks || []).map(t => {
        const props = t.properties || {};
        return {
          id: t.id,
          type: t.type,
          codec: t.codec || props.codec_id || 'unknown',
          language: props.language || 'und',
          default: props.default_track === true || props.default_track === 1 || props.default_track === '1' || props.default_track === 'yes',
          forced: props.forced_track === true || props.forced_track === 1 || props.forced_track === '1' || props.forced_track === 'yes',
          name: props.track_name || '',
          properties: props
        };
      });

    } else if (isMP4) {
      const ffprobeExe = resolveBin([
        'C:\\programdata\\chocolatey\\bin\\ffprobe.exe',
        'C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe',
        'C:\\ffmpeg\\bin\\ffprobe.exe'
      ]) || 'ffprobe';

      // Test accessibility
      execFileSync(ffprobeExe, ['-version'], { encoding: 'utf8', timeout: 10000 });
      
      const out = execFileSync(ffprobeExe, ['-v', 'quiet', '-print_format', 'json', '-show_streams', inputFile],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

      const info = JSON.parse(out);
      tracks = (info.streams || []).map((stream, index) => {
        let type = 'unknown';
        if (stream.codec_type === 'video') type = 'video';
        else if (stream.codec_type === 'audio') type = 'audio';
        else if (stream.codec_type === 'subtitle') type = 'subtitles';

        const disp = stream.disposition || {};
        const tags = stream.tags || {};

        return {
          id: index,
          type: type,
          codec: stream.codec_name || 'unknown',
          language: tags.language || stream.language || 'und',
          default: disp.default === 1,
          forced: disp.forced === 1,
          name: tags.title || tags.name || '',
          properties: {
            codec_id: stream.codec_name || 'unknown',
            language: tags.language || stream.language || 'und',
            default_track: disp.default === 1,
            forced_track: disp.forced === 1,
            track_name: tags.title || tags.name || ''
          }
        };
      });
    }

    subtitleTracks = tracks.filter(t => t.type === 'subtitles');
    console.log(`✓ Found ${subtitleTracks.length} subtitle tracks`);

    if (subtitleTracks.length === 0) {
      console.log('⚠️ No subtitle tracks — skipping');
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 2,
        variables: args.variables,
        processFile: false
      };
    }

  } catch (err) {
    const msg = (err && (err.stderr?.toString() || err.stdout?.toString() || err.message)) || 'unknown error';
    console.error('❌ Error inspecting tracks:', msg);
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables,
      processFile: false
    };
  }

  // ═══════════════════════════════════════
  // STAGE 2: ANALYZE SUBTITLE TRACKS
  // ═══════════════════════════════════════
  console.log('\n━━━ STAGE 2: ANALYZING TRACKS ━━━');
  
  const analysis = {
    toConvert: [],
    toDiscard: [],
    toKeep: [],
    englishTrackId: null
  };

  subtitleTracks.forEach(track => {
    const codec = track.codec.toLowerCase();
    const lang = (track.language || '').toLowerCase();
    
    console.log(`Track ${track.id}: ${track.codec} (${track.language || 'und'})`);
    
    // Mark English track for default flag
    if ((lang === 'eng' || lang === 'en' || lang === 'english') && !analysis.englishTrackId) {
      analysis.englishTrackId = track.id;
    }
    
    // Categorize by type
    if (isBitmapSubtitle(codec)) {
      analysis.toDiscard.push({ id: track.id, codec: track.codec, language: track.language });
      console.log(`  → DISCARD (bitmap)`);
    } else if (isSRTSubtitle(codec)) {
      analysis.toKeep.push({ id: track.id, codec: track.codec, language: track.language });
      console.log(`  → KEEP (already SRT)`);
    } else if (isTextSubtitle(codec)) {
      let format = 'text';
      if (codec.includes('ass') || codec.includes('ssa')) format = 'ass';
      else if (codec.includes('webvtt') || codec.includes('vtt')) format = 'webvtt';
      else if (codec.includes('mov_text')) format = 'mov_text';
      
      analysis.toConvert.push({ id: track.id, codec: track.codec, language: track.language, format: format });
      console.log(`  → CONVERT (${format} to SRT)`);
    } else {
      analysis.toConvert.push({ id: track.id, codec: track.codec, language: track.language, format: 'unknown' });
      console.log(`  → CONVERT (unknown format)`);
    }
  });

  const needsProcessing = analysis.toConvert.length > 0 || analysis.toDiscard.length > 0;
  console.log(`\nProcessing needed: ${needsProcessing ? 'YES' : 'NO'}`);
  console.log(`  Convert: ${analysis.toConvert.length}, Keep: ${analysis.toKeep.length}, Discard: ${analysis.toDiscard.length}`);

  if (!needsProcessing) {
    console.log('✓ All subtitles are already in SRT format');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables
    };
  }

  // ═══════════════════════════════════════
  // STAGE 3: EXTRACT SUBTITLE TRACKS
  // ═══════════════════════════════════════
  console.log('\n━━━ STAGE 3: EXTRACTING TRACKS ━━━');
  
  const extractedFiles = [];
  const tracksToExtract = [...analysis.toConvert, ...analysis.toKeep]; // Skip bitmap tracks

  for (const track of tracksToExtract) {
    let extension = 'sub';
    let trackType = 'convert';
    
    if (analysis.toKeep.find(t => t.id === track.id)) {
      trackType = 'keep';
      extension = 'srt';
    } else {
      if (track.format === 'ass' || track.format === 'ssa') extension = 'ass';
      else if (track.format === 'webvtt') extension = 'vtt';
      else if (track.format === 'mov_text') extension = 'txt';
    }
    
    const outputFile = path.join(workDir, `subtitle_${uniqueId}_${track.id}.${extension}`);
    console.log(`Extracting Track ${track.id} (${track.format || track.codec}) → ${path.basename(outputFile)}`);
    
    try {
      let success = false;
      
      if (isMKV) {
        const mkvextractPath = resolveBin([
          'C:\\Program Files\\MKVToolNix\\mkvextract.exe',
          'C:\\Program Files (x86)\\MKVToolNix\\mkvextract.exe',
          'mkvextract'
        ]);
        
        await new Promise((resolve) => {
          const extractProcess = spawn(mkvextractPath, ['tracks', inputFile, `${track.id}:${outputFile}`]);
          const timeout = setTimeout(() => extractProcess.kill('SIGTERM'), 60000);
          
          extractProcess.on('close', (code) => {
            clearTimeout(timeout);
            success = code === 0 && fs.existsSync(outputFile);
            resolve();
          });
          
          extractProcess.on('error', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
        
      } else if (isMP4) {
        const ffmpegPath = resolveBin([
          'C:\\programdata\\chocolatey\\bin\\ffmpeg.exe',
          'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
          'C:\\ffmpeg\\bin\\ffmpeg.exe',
          'ffmpeg'
        ]);
        
        await new Promise((resolve) => {
          const extractProcess = spawn(ffmpegPath, [
            '-i', inputFile, '-map', `0:${track.id}`, '-c:s', 'copy', '-y', outputFile
          ]);
          const timeout = setTimeout(() => extractProcess.kill('SIGTERM'), 60000);
          
          extractProcess.on('close', (code) => {
            clearTimeout(timeout);
            success = code === 0 && fs.existsSync(outputFile);
            resolve();
          });
          
          extractProcess.on('error', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
      
      if (success) {
        const stats = fs.statSync(outputFile);
        console.log(`  ✓ Extracted: ${stats.size} bytes`);
        extractedFiles.push({
          trackId: track.id,
          inputFile: outputFile,
          format: track.format || track.codec,
          language: track.language,
          codec: track.codec,
          trackType: trackType,
          extension: extension
        });
      } else {
        console.log(`  ❌ Extraction failed`);
      }
      
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }

  console.log(`✓ Extracted ${extractedFiles.length}/${tracksToExtract.length} tracks`);

  // ═══════════════════════════════════════
  // STAGE 4: CONVERT TO SRT
  // ═══════════════════════════════════════
  console.log('\n━━━ STAGE 4: CONVERTING TO SRT ━━━');
  
  const finalSrtFiles = [];
  const ffmpegExe = resolveBin([
    'C:\\programdata\\chocolatey\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\ffmpeg\\bin\\ffmpeg.exe'
  ]) || 'ffmpeg';

  for (const file of extractedFiles) {
    const outputFile = path.join(workDir, `subtitle_${uniqueId}_${file.trackId}.srt`);
    
    try {
      if (file.trackType === 'keep') {
        // Already SRT - just copy
        fs.copyFileSync(file.inputFile, outputFile);
        console.log(`Track ${file.trackId}: Copied existing SRT`);
      } else {
        // Convert to SRT
        const ffmpegCmd = `"${ffmpegExe}" -i "${file.inputFile}" -c:s srt "${outputFile}" -y`;
        execSync(ffmpegCmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10, timeout: 120000 });
        console.log(`Track ${file.trackId}: Converted ${file.format} → SRT`);
      }
      
      if (fs.existsSync(outputFile)) {
        const stats = fs.statSync(outputFile);
        console.log(`  ✓ ${stats.size} bytes`);
        
        finalSrtFiles.push({
          trackId: file.trackId,
          srtFile: outputFile,
          language: file.language,
          originalCodec: file.codec
        });
        
        // Clean up original extracted file immediately to save space
        if (fs.existsSync(file.inputFile) && file.inputFile !== outputFile) {
          fs.unlinkSync(file.inputFile);
        }
      }
      
    } catch (error) {
      console.log(`  ❌ Error converting track ${file.trackId}: ${error.message}`);
    }
  }

  console.log(`✓ Created ${finalSrtFiles.length} SRT files`);

  // ═══════════════════════════════════════
  // STAGE 5: REMUX WITH SRT SUBTITLES
  // ═══════════════════════════════════════
  console.log('\n━━━ STAGE 5: REMUXING FILE ━━━');
  
  const tempOutput = path.join(workDir, `temp_${uniqueId}_${fileName}`);
  console.log(`Creating: ${path.basename(tempOutput)}`);

  try {
    if (isMKV) {
      const mkvmergeExe = resolveBin([
        'C:\\Program Files\\MKVToolNix\\mkvmerge.exe',
        'C:\\Program Files (x86)\\MKVToolNix\\mkvmerge.exe'
      ]) || 'mkvmerge';

      let mkvmergeCmd = `"${mkvmergeExe}" -o "${tempOutput}" --no-subtitles "${inputFile}"`;
      
      finalSrtFiles.forEach(file => {
        const lang = file.language || 'und';
        const isDefault = file.trackId === analysis.englishTrackId ? 'yes' : 'no';
        mkvmergeCmd += ` --language 0:${lang} --default-track 0:${isDefault} --track-name 0:"" "${file.srtFile}"`;
      });
      
      execSync(mkvmergeCmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });
      
    } else if (isMP4) {
      const ffmpegExe = resolveBin([
        'C:\\programdata\\chocolatey\\bin\\ffmpeg.exe',
        'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\ffmpeg\\bin\\ffmpeg.exe'
      ]) || 'ffmpeg';

      let ffmpegCmd = `"${ffmpegExe}" -i "${inputFile}" -map 0:v -map 0:a -c:v copy -c:a copy`;
      
      finalSrtFiles.forEach((file, index) => {
        const lang = file.language || 'und';
        const isDefault = file.trackId === analysis.englishTrackId;
        
        ffmpegCmd += ` -i "${file.srtFile}" -map ${index + 1}:s -c:s:${index} mov_text`;
        ffmpegCmd += ` -metadata:s:s:${index} language=${lang}`;
        if (isDefault) {
          ffmpegCmd += ` -disposition:s:${index} default`;
        }
      });
      
      ffmpegCmd += ` -y "${tempOutput}"`;
      execSync(ffmpegCmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });
    }

    // Verify and replace original file
    if (fs.existsSync(tempOutput)) {
      const inputStats = fs.statSync(inputFile);
      const outputStats = fs.statSync(tempOutput);
      
      console.log(`✓ Remux complete: ${(inputStats.size / 1024 / 1024).toFixed(2)} MB → ${(outputStats.size / 1024 / 1024).toFixed(2)} MB`);
      
      // Replace original file
      fs.copyFileSync(tempOutput, inputFile);
      fs.unlinkSync(tempOutput);
      console.log('✓ File replaced successfully');
      
      // Update file object
      args.inputFileObj.file_size = outputStats.size / 1024 / 1024;
      args.variables.subtitleChangesApplied = true;
      args.variables.forceReplaceOriginal = true;
      
    } else {
      throw new Error('Output file was not created');
    }

  } catch (error) {
    console.error('❌ Error during remux:', error.message);
    
    // Clean up temp file
    if (fs.existsSync(tempOutput)) {
      fs.unlinkSync(tempOutput);
    }
    
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables,
      processFile: false
    };
  }

  // Clean up ALL temporary SRT files
  console.log('\nCleaning up temporary files...');
  for (const file of finalSrtFiles) {
    try {
      if (fs.existsSync(file.srtFile)) {
        fs.unlinkSync(file.srtFile);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  // Final summary
  console.log('\n═══════════════════════════════════════');
  console.log('   SUBTITLE PROCESSING COMPLETE');
  console.log('═══════════════════════════════════════');
  
  const totalOriginalSubs = analysis.toConvert.length + analysis.toKeep.length + analysis.toDiscard.length;
  console.log(`✓ Original tracks: ${totalOriginalSubs} → Final SRT tracks: ${finalSrtFiles.length}`);
  console.log(`✓ Converted: ${analysis.toConvert.length}, Preserved: ${analysis.toKeep.length}, Discarded: ${analysis.toDiscard.length}`);
  console.log('✓ File now contains ONLY SRT subtitles');

  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables
  };
};
