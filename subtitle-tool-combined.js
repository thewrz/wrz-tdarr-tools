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

  args.jobLog('═══════════════════════════════════════');
  args.jobLog('   COMBINED SUBTITLE PROCESSOR');
  args.jobLog('═══════════════════════════════════════');
  args.jobLog(`File: ${inputFile}`);
  args.jobLog(`Container: ${args.inputFileObj.container}`);

  // Early exit for unsupported containers
  if (!isMKV && !isMP4) {
    args.jobLog('❌ Not MKV or MP4 — skipping');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables,
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

  // Use Tdarr's working directory (cache) - no need to create custom directories
  const workingDir = args.workDir;
  
  // Create unique session ID for file naming
  const inputFileHash = crypto.createHash('md5').update(inputFile).digest('hex').substring(0, 8);
  const sessionId = `${inputFileHash}_${process.pid}_${Date.now()}`;
  
  args.jobLog(`Session ID: ${sessionId}`);
  args.jobLog(`Working directory (cache): ${workingDir}`);
  args.jobLog(`Working with cache-based operations`);

  // ═══════════════════════════════════════
  // STAGE 1: INSPECT SUBTITLE TRACKS
  // ═══════════════════════════════════════
  args.jobLog('\n━━━ STAGE 1: INSPECTING TRACKS ━━━');
  
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
    args.jobLog(`✓ Found ${subtitleTracks.length} subtitle tracks`);

    if (subtitleTracks.length === 0) {
      args.jobLog('⚠️ No subtitle tracks — skipping');
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 2,
        variables: args.variables,
      };
    }

  } catch (err) {
    const msg = (err && (err.stderr?.toString() || err.stdout?.toString() || err.message)) || 'unknown error';
    console.error('❌ Error inspecting tracks:', msg);
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 3,
      variables: args.variables,
    };
  }

  // ═══════════════════════════════════════
  // STAGE 2: ANALYZE SUBTITLE TRACKS
  // ═══════════════════════════════════════
  args.jobLog('\n━━━ STAGE 2: ANALYZING TRACKS ━━━');
  
  const analysis = {
    toConvert: [],
    toDiscard: [],
    toKeep: [],
    englishTrackId: null
  };

  subtitleTracks.forEach(track => {
    const codec = track.codec.toLowerCase();
    const lang = (track.language || '').toLowerCase();
    
    args.jobLog(`Track ${track.id}: ${track.codec} (${track.language || 'und'})`);
    
    // Mark English track for default flag
    if ((lang === 'eng' || lang === 'en' || lang === 'english') && !analysis.englishTrackId) {
      analysis.englishTrackId = track.id;
    }
    
    // Categorize by type
    if (isBitmapSubtitle(codec)) {
      analysis.toDiscard.push({ id: track.id, codec: track.codec, language: track.language });
      args.jobLog(`  → DISCARD (bitmap)`);
    } else if (isSRTSubtitle(codec)) {
      analysis.toKeep.push({ id: track.id, codec: track.codec, language: track.language });
      args.jobLog(`  → KEEP (already SRT)`);
    } else if (isTextSubtitle(codec)) {
      let format = 'text';
      if (codec.includes('ass') || codec.includes('ssa')) format = 'ass';
      else if (codec.includes('webvtt') || codec.includes('vtt')) format = 'webvtt';
      else if (codec.includes('mov_text')) format = 'mov_text';
      
      analysis.toConvert.push({ id: track.id, codec: track.codec, language: track.language, format: format });
      args.jobLog(`  → CONVERT (${format} to SRT)`);
    } else {
      analysis.toConvert.push({ id: track.id, codec: track.codec, language: track.language, format: 'unknown' });
      args.jobLog(`  → CONVERT (unknown format)`);
    }
  });

  const needsProcessing = analysis.toConvert.length > 0 || analysis.toDiscard.length > 0;
  args.jobLog(`\nProcessing needed: ${needsProcessing ? 'YES' : 'NO'}`);
  args.jobLog(`  Convert: ${analysis.toConvert.length}, Keep: ${analysis.toKeep.length}, Discard: ${analysis.toDiscard.length}`);

  if (!needsProcessing) {
    args.jobLog('✓ All subtitles are already in SRT format');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables
    };
  }

  // ═══════════════════════════════════════
  // STAGE 3: EXTRACT SUBTITLE TRACKS
  // ═══════════════════════════════════════
  args.jobLog('\n━━━ STAGE 3: EXTRACTING TRACKS ━━━');
  
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
    
    const outputFile = path.join(workingDir, `${sessionId}_subtitle_${track.id}.${extension}`);
    args.jobLog(`Extracting Track ${track.id} (${track.format || track.codec}) → ${path.basename(outputFile)}`);
    
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
        args.jobLog(`  ✓ Extracted: ${stats.size} bytes`);
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
        args.jobLog(`  ❌ Extraction failed`);
      }
      
    } catch (error) {
      args.jobLog(`  ❌ Error: ${error.message}`);
    }
  }

  args.jobLog(`✓ Extracted ${extractedFiles.length}/${tracksToExtract.length} tracks`);

  // ═══════════════════════════════════════
  // STAGE 4: CONVERT TO SRT
  // ═══════════════════════════════════════
  args.jobLog('\n━━━ STAGE 4: CONVERTING TO SRT ━━━');
  
  const finalSrtFiles = [];
  const ffmpegExe = resolveBin([
    'C:\\programdata\\chocolatey\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\ffmpeg\\bin\\ffmpeg.exe'
  ]) || 'ffmpeg';

  for (const file of extractedFiles) {
    const outputFile = path.join(workingDir, `${sessionId}_subtitle_${file.trackId}.srt`);
    
    try {
      if (file.trackType === 'keep') {
        // Already SRT - just copy
        fs.copyFileSync(file.inputFile, outputFile);
        args.jobLog(`Track ${file.trackId}: Copied existing SRT`);
      } else {
        // Convert to SRT
        const ffmpegCmd = `"${ffmpegExe}" -i "${file.inputFile}" -c:s srt "${outputFile}" -y`;
        const { execSync } = require('child_process');
        execSync(ffmpegCmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10, timeout: 120000 });
        args.jobLog(`Track ${file.trackId}: Converted ${file.format} → SRT`);
      }
      
      if (fs.existsSync(outputFile)) {
        const stats = fs.statSync(outputFile);
        args.jobLog(`  ✓ ${stats.size} bytes`);
        
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
      args.jobLog(`  ❌ Error converting track ${file.trackId}: ${error.message}`);
    }
  }

  args.jobLog(`✓ Created ${finalSrtFiles.length} SRT files`);

  // ═══════════════════════════════════════
  // STAGE 5: REMUX WITH SRT SUBTITLES
  // ═══════════════════════════════════════
  args.jobLog('\n━━━ STAGE 5: REMUXING FILE ━━━');
  
  // Create output file in cache directory - this becomes the working file
  const outputFile = path.join(workingDir, `${sessionId}_remuxed_${fileName}`);
  args.jobLog(`Creating: ${path.basename(outputFile)}`);

  try {
    if (isMKV) {
      const mkvmergeExe = resolveBin([
        'C:\\Program Files\\MKVToolNix\\mkvmerge.exe',
        'C:\\Program Files (x86)\\MKVToolNix\\mkvmerge.exe'
      ]) || 'mkvmerge';

      let mkvmergeCmd = `"${mkvmergeExe}" -o "${outputFile}" --no-subtitles "${inputFile}"`;
      
      finalSrtFiles.forEach(file => {
        const lang = file.language || 'und';
        const isDefault = file.trackId === analysis.englishTrackId ? 'yes' : 'no';
        mkvmergeCmd += ` --language 0:${lang} --default-track 0:${isDefault} --track-name 0:"" "${file.srtFile}"`;
      });
      
      const { execSync } = require('child_process');
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
      
      ffmpegCmd += ` -y "${outputFile}"`;
      const { execSync } = require('child_process');
      execSync(ffmpegCmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });
    }

    // Verify output file was created
    if (fs.existsSync(outputFile)) {
      const inputStats = fs.statSync(inputFile);
      const outputStats = fs.statSync(outputFile);
      
      args.jobLog(`✓ Remux complete: ${(inputStats.size / 1024 / 1024).toFixed(2)} MB → ${(outputStats.size / 1024 / 1024).toFixed(2)} MB`);
      
      // Clean up session-based temporary SRT files (but keep the remuxed file)
      args.jobLog('\nCleaning up temporary files...');
      for (const file of finalSrtFiles) {
        try {
          if (fs.existsSync(file.srtFile)) {
            fs.unlinkSync(file.srtFile);
          }
        } catch (error) {
          // Ignore cleanup errors
        }
      }
      
      // Update variables
      args.variables.subtitleChangesApplied = true;
      
      // Final summary
      args.jobLog('\n═══════════════════════════════════════');
      args.jobLog('   SUBTITLE PROCESSING COMPLETE');
      args.jobLog('═══════════════════════════════════════');
      
      const totalOriginalSubs = analysis.toConvert.length + analysis.toKeep.length + analysis.toDiscard.length;
      args.jobLog(`✓ Original tracks: ${totalOriginalSubs} → Final SRT tracks: ${finalSrtFiles.length}`);
      args.jobLog(`✓ Converted: ${analysis.toConvert.length}, Preserved: ${analysis.toKeep.length}, Discarded: ${analysis.toDiscard.length}`);
      args.jobLog('✓ File now contains ONLY SRT subtitles');
      args.jobLog(`✓ Working file: ${path.basename(outputFile)}`);
      
      // Return the cache file as the working file - Tdarr will handle the rest
      return {
        outputFileObj: { _id: outputFile },
        outputNumber: 1,
        variables: args.variables
      };
      
    } else {
      throw new Error('Output file was not created');
    }

  } catch (error) {
    console.error('❌ Error during remux:', error.message);
    
    // Clean up temp files on error
    if (fs.existsSync(outputFile)) {
      fs.unlinkSync(outputFile);
    }
    
    // Clean up SRT files
    for (const file of finalSrtFiles) {
      try {
        if (fs.existsSync(file.srtFile)) {
          fs.unlinkSync(file.srtFile);
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 3,
      variables: args.variables,
    };
  }
};
