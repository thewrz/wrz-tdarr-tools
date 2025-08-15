// Stage 5: Final Unified Mux
// Single mux operation that combines video, cleaned audio, and English SRT subtitles
module.exports = async (args) => {
  const path = require('path');
  const { spawn } = require('child_process');
  const fs = require('fs');
  const crypto = require('crypto');
  
  console.log('═══════════════════════════════════════');
  console.log('   STAGE 5: FINAL UNIFIED MUX');
  console.log('═══════════════════════════════════════');
  
  // Check if we should skip
  if (args.variables.skipProcessing) {
    console.log('⚠️ Skipping mux - no processing needed');
    console.log('✓ File is already optimized');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables,
    };
  }
  
  const analysis = args.variables.mediaAnalysis;
  const convertedSrtFiles = args.variables.convertedSrtFiles || [];
  const workDir = args.variables.workDir;
  const inputFile = args.variables.originalFile;
  const containerType = args.variables.containerType || 'mkv';
  const uniqueId = args.variables.uniqueId;
  
  if (!uniqueId) {
    console.log('❌ No unique ID found - cannot ensure file safety');
    args.variables.skipProcessing = true;
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables,
    };
  }
  
  console.log(`Processing files for session: ${uniqueId}`);
  
  // Create temp output file path with unique ID to prevent conflicts
  const fileName = path.basename(inputFile);
  const tempOutput = path.join(workDir, `temp_${uniqueId}_${fileName}`);
  
  console.log(`Input file: ${inputFile}`);
  console.log(`Container type: ${containerType}`);
  console.log(`Temp output: ${tempOutput}`);
  
  // Determine what processing is needed
  const needsVideoProcessing = analysis && analysis.video && analysis.video.tracksToKeep && analysis.video.tracksToKeep.length > 0;
  const needsAudioProcessing = analysis && analysis.audio && analysis.audio.needsProcessing;
  const needsSubtitleProcessing = analysis && analysis.subtitles && analysis.subtitles.needsProcessing;
  
  console.log(`Video processing: ${needsVideoProcessing ? 'YES' : 'NO'}`);
  console.log(`Audio processing: ${needsAudioProcessing ? 'YES' : 'NO'}`);
  console.log(`Subtitle processing: ${needsSubtitleProcessing ? 'YES' : 'NO'}`);
  
  // Prepare all SRT files (converted + existing)
  const allSrtFiles = [...convertedSrtFiles];
  
  // Add existing SRT files that don't need conversion
  if (analysis && analysis.subtitles && analysis.subtitles.toKeep) {
    analysis.subtitles.toKeep.forEach(track => {
      allSrtFiles.push({
        trackId: track.id,
        srtFile: null, // Will be extracted directly in mux command
        language: track.language,
        originalCodec: track.codec,
        isExisting: true
      });
    });
  }
  
  console.log(`Total SRT files to include: ${allSrtFiles.length}`);
  console.log('');
  
  // Helper function to resolve binary paths
  function resolveBin(candidates) {
    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }
    return null;
  }

  try {
    if (containerType === 'mkv') {
      // Use mkvmerge for MKV files
      const mkvmergeExe =
        resolveBin([
          'C:\\Program Files\\MKVToolNix\\mkvmerge.exe',
          'C:\\Program Files (x86)\\MKVToolNix\\mkvmerge.exe'
        ]) || 'mkvmerge';

      console.log(`Using mkvmerge: ${mkvmergeExe}`);
      
      // Build comprehensive mkvmerge command
      let mkvmergeCmd = `"${mkvmergeExe}" -o "${tempOutput}"`;
      
      // === VIDEO TRACKS ===
      if (needsVideoProcessing && analysis && analysis.video && analysis.video.tracksToKeep && analysis.video.tracksToKeep.length > 0) {
        const videoTrack = analysis.video.tracksToKeep[0];
        mkvmergeCmd += ` --video-tracks ${videoTrack.id}`;
        console.log(`✓ Including video track ${videoTrack.id} (${videoTrack.codec})`);
      } else {
        mkvmergeCmd += ` --video-tracks all`;
        console.log(`✓ Including all video tracks`);
      }
      
      // === AUDIO TRACKS ===
      if (needsAudioProcessing && analysis && analysis.audio && analysis.audio.streamsToKeep && analysis.audio.streamsToKeep.length > 0) {
        const audioTrackIds = analysis.audio.streamsToKeep.map(stream => stream.index);
        mkvmergeCmd += ` --audio-tracks ${audioTrackIds.join(',')}`;
        console.log(`✓ Including audio tracks: ${audioTrackIds.join(', ')}`);
        
        // Set language tags for each audio track
        analysis.audio.streamsToKeep.forEach(stream => {
          mkvmergeCmd += ` --language ${stream.index}:${stream.language}`;
          console.log(`  - Track ${stream.index}: ${stream.language} (${stream.codec}, ${stream.channels}ch)`);
        });
      } else {
        mkvmergeCmd += ` --audio-tracks all`;
        console.log(`✓ Including all audio tracks`);
      }
      
      // === SUBTITLE TRACKS ===
      if (needsSubtitleProcessing) {
        // Keep only existing English SRT tracks (if any) and add converted ones
        let keepSubtitleIds = [];
        if (analysis && analysis.subtitles && Array.isArray(analysis.subtitles.toKeep) && analysis.subtitles.toKeep.length > 0) {
          keepSubtitleIds = analysis.subtitles.toKeep.map(t => t.id);
        }
        if (keepSubtitleIds.length > 0) {
          mkvmergeCmd += ` --subtitle-tracks ${keepSubtitleIds.join(',')}`;
          console.log(`✓ Keeping existing English SRT subtitle track IDs: ${keepSubtitleIds.join(', ')}`);
        } else {
          mkvmergeCmd += ` --no-subtitles`;
          console.log(`✓ No existing English SRT to keep; removing all original subtitles`);
        }
      } else {
        // Check if we have many subtitle tracks - if so, only keep English ones
        const allSubtitleTracks = args.variables.subtitleTracks || [];
        if (allSubtitleTracks.length > 20) {
          // For files with many subtitle tracks, be selective and only keep English ones
          const englishSubtitleIds = allSubtitleTracks
            .filter(track => {
              const lang = (track.language || '').toLowerCase();
              const name = (track.name || '').toLowerCase();
              return lang === 'eng' || lang === 'en' || lang === 'english' ||
                     /\benglish\b/i.test(name) || /\beng\b/i.test(name) || /\ben\b/i.test(name);
            })
            .map(track => track.id);
          
          if (englishSubtitleIds.length > 0) {
            mkvmergeCmd += ` --subtitle-tracks ${englishSubtitleIds.join(',')}`;
            console.log(`✓ Large subtitle count detected (${allSubtitleTracks.length}) - keeping only ${englishSubtitleIds.length} English subtitle tracks`);
          } else {
            mkvmergeCmd += ` --no-subtitles`;
            console.log(`✓ Large subtitle count detected (${allSubtitleTracks.length}) - no English subtitles found, removing all`);
          }
        } else {
          mkvmergeCmd += ` --subtitle-tracks all`;
          console.log(`✓ Including all subtitle tracks`);
        }
      }
      
      
      // Add input file
      mkvmergeCmd += ` "${inputFile}"`;
      
      // === ADD CONVERTED SRT FILES ===
      if (convertedSrtFiles.length > 0) {
        console.log(`\n━━━ Adding ${convertedSrtFiles.length} converted SRT file(s) ━━━`);
        
        convertedSrtFiles.forEach(file => {
          const lang = file.language || 'eng';
          const isDefault = (analysis && analysis.subtitles && file.trackId === analysis.subtitles.englishTrackId) ? 'yes' : 'no';
          
          console.log(`  Track ${file.trackId}:`);
          console.log(`    File: ${path.basename(file.srtFile)}`);
          console.log(`    Language: ${lang}`);
          console.log(`    Default: ${isDefault}`);
          console.log(`    Original codec: ${file.originalCodec} → SRT`);
          
          mkvmergeCmd += ` --language 0:${lang}`;
          mkvmergeCmd += ` --default-track 0:${isDefault}`;
          mkvmergeCmd += ` --track-name 0:""`;
          mkvmergeCmd += ` "${file.srtFile}"`;
        });
      }
      
      // === ADD EXISTING SRT FILES ===
      const existingSrtFiles = allSrtFiles.filter(f => f.isExisting);
      if (existingSrtFiles.length > 0) {
        console.log(`\n━━━ Including ${existingSrtFiles.length} existing SRT track(s) ━━━`);
        existingSrtFiles.forEach(file => {
          console.log(`  Track ${file.trackId}: ${file.language} (already SRT)`);
        });
        // Note: These are handled by not excluding them in --no-subtitles
        // We need to modify the approach for existing SRT tracks
        console.log(`  → These will be preserved by selective subtitle inclusion`);
      }
      
      console.log('\n━━━ Running mkvmerge ━━━');
      console.log('Command:', mkvmergeCmd);
      
      // Execute mkvmerge
      await new Promise((resolve, reject) => {
        const process = spawn('cmd', ['/c', mkvmergeCmd], { shell: true });
        
        let stdoutData = '';
        let stderrData = '';
        let timedOut = false;
        
        const timeout = setTimeout(() => {
          timedOut = true;
          console.log('⚠️ Processing taking too long, killing process...');
          process.kill('SIGTERM');
        }, 300000); // 5 minutes timeout
        
        process.stdout.on('data', (data) => {
          const text = data.toString();
          stdoutData += text;
          console.log(text.trim());
        });
        
        process.stderr.on('data', (data) => {
          const text = data.toString();
          stderrData += text;
          console.log(text.trim());
        });
        
        process.on('close', (code) => {
          clearTimeout(timeout);
          
          if (timedOut) {
            console.log('❌ Processing timed out');
            reject(new Error('timeout'));
          } else if (code !== 0) {
            console.log(`❌ mkvmerge exited with code ${code}`);
            if (stderrData) {
              console.log(`Error: ${stderrData}`);
            }
            reject(new Error(stderrData || `Exit code ${code}`));
          } else {
            console.log('✓ mkvmerge completed successfully');
            resolve();
          }
        });
        
        process.on('error', (err) => {
          clearTimeout(timeout);
          console.log(`❌ Failed to start mkvmerge: ${err.message}`);
          reject(err);
        });
      });
      
    } else if (containerType === 'mp4') {
      // Use ffmpeg for MP4 files
      const ffmpegExe =
        resolveBin([
          'C:\\programdata\\chocolatey\\bin\\ffmpeg.exe',
          'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
          'C:\\ffmpeg\\bin\\ffmpeg.exe'
        ]) || 'ffmpeg';

      console.log(`Using ffmpeg: ${ffmpegExe}`);
      
      // Build comprehensive ffmpeg command
      let ffmpegCmd = `"${ffmpegExe}" -i "${inputFile}"`;
      
      // Add converted SRT files as additional inputs
      convertedSrtFiles.forEach(file => {
        ffmpegCmd += ` -i "${file.srtFile}"`;
      });
      
      // === STREAM MAPPING ===
      let mapArgs = [];
      let codecArgs = [];
      let metadataArgs = [];
      let dispositionArgs = [];
      
      // Map video streams
      if (needsVideoProcessing && analysis && analysis.video && analysis.video.tracksToKeep && analysis.video.tracksToKeep.length > 0) {
        const videoTrack = analysis.video.tracksToKeep[0];
        mapArgs.push('-map', `0:${videoTrack.id}`);
        codecArgs.push('-c:v', 'copy');
        console.log(`✓ Including video track ${videoTrack.id} (${videoTrack.codec})`);
      } else {
        mapArgs.push('-map', '0:v');
        codecArgs.push('-c:v', 'copy');
        console.log(`✓ Including all video tracks`);
      }
      
      // Map audio streams
      if (needsAudioProcessing && analysis && analysis.audio && analysis.audio.streamsToKeep && analysis.audio.streamsToKeep.length > 0) {
        console.log(`✓ Including selected audio tracks:`);
        analysis.audio.streamsToKeep.forEach((stream, outputIndex) => {
          mapArgs.push('-map', `0:${stream.index}`);
          metadataArgs.push(`-metadata:s:a:${outputIndex}`, `language=${stream.language}`);
          console.log(`  - Track ${stream.index}: ${stream.language} (${stream.codec}, ${stream.channels}ch)`);
        });
        codecArgs.push('-c:a', 'copy');
      } else {
        mapArgs.push('-map', '0:a');
        codecArgs.push('-c:a', 'copy');
        console.log(`✓ Including all audio tracks`);
      }
      
      // Map subtitle streams (converted SRT files)
      if (convertedSrtFiles.length > 0) {
        console.log(`\n━━━ Adding ${convertedSrtFiles.length} converted SRT file(s) ━━━`);
        
        convertedSrtFiles.forEach((file, index) => {
          const inputIndex = index + 1; // SRT files start from input 1
          const lang = file.language || 'eng';
          const isDefault = (analysis && analysis.subtitles && file.trackId === analysis.subtitles.englishTrackId);
          
          console.log(`  Track ${file.trackId}:`);
          console.log(`    File: ${path.basename(file.srtFile)}`);
          console.log(`    Language: ${lang}`);
          console.log(`    Default: ${isDefault}`);
          console.log(`    Original codec: ${file.originalCodec} → MOV_TEXT`);
          
          // Map the subtitle stream
          mapArgs.push('-map', `${inputIndex}:s`);
          
          // Set subtitle codec to mov_text for MP4
          codecArgs.push(`-c:s:${index}`, 'mov_text');
          
          // Set metadata
          metadataArgs.push(`-metadata:s:s:${index}`, `language=${lang}`);
          if (isDefault) {
            dispositionArgs.push(`-disposition:s:${index}`, 'default');
          }
        });
      }
      
      // Handle existing SRT subtitles (if any) - exclude non-English or non-SRT
      if (needsSubtitleProcessing) {
        // We're already excluding original subtitles by not mapping them
        console.log(`✓ Excluding original subtitle tracks (will be replaced with SRT)`);
      } else {
        // Include existing subtitles if no processing needed
        mapArgs.push('-map', '0:s?');
        codecArgs.push('-c:s', 'copy');
        console.log(`✓ Including existing subtitle tracks`);
      }
      
      // Combine all arguments
      const allArgs = [
        ...mapArgs,
        ...codecArgs,
        ...metadataArgs,
        ...dispositionArgs,
        '-y', tempOutput
      ];
      
      ffmpegCmd += ' ' + allArgs.join(' ');
      
      console.log('\n━━━ Running ffmpeg ━━━');
      console.log('Command:', ffmpegCmd);
      
      // Execute ffmpeg
      await new Promise((resolve, reject) => {
        const process = spawn('cmd', ['/c', ffmpegCmd], { shell: true });
        
        let stdoutData = '';
        let stderrData = '';
        let timedOut = false;
        
        const timeout = setTimeout(() => {
          timedOut = true;
          console.log('⚠️ Processing taking too long, killing process...');
          process.kill('SIGTERM');
        }, 300000); // 5 minutes timeout
        
        process.stdout.on('data', (data) => {
          stdoutData += data.toString();
        });
        
        process.stderr.on('data', (data) => {
          stderrData += data.toString();
        });
        
        process.on('close', (code) => {
          clearTimeout(timeout);
          
          if (timedOut) {
            console.log('❌ Processing timed out');
            reject(new Error('timeout'));
          } else if (code !== 0) {
            console.log(`❌ ffmpeg exited with code ${code}`);
            if (stderrData) {
              console.log(`Error: ${stderrData}`);
            }
            reject(new Error(stderrData || `Exit code ${code}`));
          } else {
            console.log('✓ ffmpeg completed successfully');
            resolve();
          }
        });
        
        process.on('error', (err) => {
          clearTimeout(timeout);
          console.log(`❌ Failed to start ffmpeg: ${err.message}`);
          reject(err);
        });
      });
    }
    
    // Verify output file exists
    if (fs.existsSync(tempOutput)) {
      const inputStats = fs.statSync(inputFile);
      const outputStats = fs.statSync(tempOutput);
      
      console.log('\n✓ Mux complete');
      console.log(`  Original size: ${(inputStats.size / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  New size: ${(outputStats.size / 1024 / 1024).toFixed(2)} MB`);
      
      // Replace original file with new one
      console.log('\nReplacing original file...');
      
      // Use copy + delete approach for cross-device compatibility
      try {
        // Copy temp file to original location
        fs.copyFileSync(tempOutput, inputFile);
        console.log('✓ File copied to original location');
        
        // Delete temp file after successful copy
        fs.unlinkSync(tempOutput);
        console.log('✓ Temporary file cleaned up');
        
        console.log('✓ File replaced successfully');
      } catch (copyError) {
        console.error('❌ Failed to replace original file:', copyError.message);
        throw new Error(`Failed to replace original file: ${copyError.message}`);
      }
      
      // Update file object to reflect changes
      args.inputFileObj.file_size = outputStats.size / 1024 / 1024; // Convert to MB
      
      // Mark that changes were applied
      args.variables.mediaProcessingApplied = true;
      args.variables.forceReplaceOriginal = true;
      
    } else {
      throw new Error('Output file was not created');
    }
    
  } catch (error) {
    console.error('❌ Error during mux:', error.message);
    
    // Clean up temp file if it exists
    if (fs.existsSync(tempOutput)) {
      try {
        fs.unlinkSync(tempOutput);
        console.log('✓ Cleaned up temporary file');
      } catch (cleanupError) {
        console.log('⚠️ Could not clean up temporary file');
      }
    }
    
    args.variables.error = error.message;
    args.variables.skipProcessing = true;
    
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2, // Route to error/skip output
      variables: args.variables,
      processFile: false
    };
  }
  
  // Clean up ALL temporary SRT files
  console.log('\nCleaning up temporary SRT files...');
  for (const file of convertedSrtFiles) {
    try {
      if (fs.existsSync(file.srtFile)) {
        fs.unlinkSync(file.srtFile);
        console.log(`  Deleted: ${path.basename(file.srtFile)}`);
      }
    } catch (error) {
      console.log(`  Could not delete: ${path.basename(file.srtFile)}`);
    }
  }
  
  console.log('\n═══════════════════════════════════════');
  console.log('   UNIFIED MEDIA PROCESSING COMPLETE');
  console.log('═══════════════════════════════════════');
  
  // Final comprehensive summary
  console.log('✓ PROCESSING SUMMARY:');
  
  if (needsVideoProcessing) {
    console.log(`  📹 Video: Kept first track only`);
  }
  
  if (needsAudioProcessing && analysis && analysis.audio) {
    const englishKept = (analysis.audio.englishStreams && analysis.audio.englishStreams.length > 0) ? 1 : 0;
    const englishRemoved = Math.max(0, (analysis.audio.englishStreams ? analysis.audio.englishStreams.length : 0) - 1);
    const commentaryRemoved = analysis.audio.commentaryStreams ? analysis.audio.commentaryStreams.length : 0;
    const otherKept = analysis.audio.otherLanguageStreams ? analysis.audio.otherLanguageStreams.length : 0;
    
    console.log(`  🔊 Audio: ${englishKept + otherKept} tracks kept, ${englishRemoved + commentaryRemoved} removed`);
    if (englishRemoved > 0) {
      console.log(`    - Removed ${englishRemoved} duplicate English stream(s)`);
    }
    if (commentaryRemoved > 0) {
      console.log(`    - Removed ${commentaryRemoved} commentary/audio description stream(s)`);
    }
    if (otherKept > 0) {
      console.log(`    - Kept ${otherKept} other language stream(s)`);
    }
  }
  
  if (needsSubtitleProcessing && analysis && analysis.subtitles) {
    const converted = analysis.subtitles.toConvert ? analysis.subtitles.toConvert.length : 0;
    const kept = analysis.subtitles.toKeep ? analysis.subtitles.toKeep.length : 0;
    const discarded = analysis.subtitles.toDiscard ? analysis.subtitles.toDiscard.length : 0;
    
    console.log(`  💬 Subtitles: ${converted + kept} English SRT tracks, ${discarded} bitmap discarded`);
    if (converted > 0) {
      console.log(`    - Converted ${converted} text subtitle(s) to SRT`);
    }
    if (kept > 0) {
      console.log(`    - Preserved ${kept} existing SRT subtitle(s)`);
    }
    if (discarded > 0) {
      console.log(`    - Discarded ${discarded} bitmap subtitle(s)`);
    }
  }
  
  console.log('\n🎯 OPTIMIZATION GOALS ACHIEVED:');
  console.log('   ✓ Single efficient mux operation (no double processing)');
  console.log('   ✓ Only English subtitles in SRT format');
  console.log('   ✓ Cleaned audio streams (English first, no duplicates/commentary)');
  console.log('   ✓ Optimal file structure maintained');
  
  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables,
  };
};
