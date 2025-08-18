// Stage 3: Remux with Proper Ordering and Tagging
// Combines cleaned streams in correct order: video first, English audio, English subtitles
module.exports = async (args) => {
  const fs = require('fs');
  const path = require('path');
  const { spawn } = require('child_process');

  args.jobLog('═══════════════════════════════════════');
  args.jobLog('   STAGE 3: REMUX WITH PROPER ORDERING');
  args.jobLog('═══════════════════════════════════════');

  const workingDir = args.variables.workingDir || args.workDir;
  const sessionId = args.variables.sessionId;
  const originalFile = args.variables.originalFile;
  const containerType = args.variables.containerType;
  const finalVideoFile = args.variables.finalVideoFile;
  const finalAudioFiles = args.variables.finalAudioFiles || [];
  const finalSubtitleFiles = args.variables.finalSubtitleFiles || [];

  if (!workingDir || !fs.existsSync(workingDir)) {
    args.jobLog('❌ No working directory found');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables,
    };
  }

  args.jobLog(`Session ID: ${sessionId}`);
  args.jobLog(`Working directory (cache): ${workingDir}`);
  args.jobLog(`Original file: ${originalFile}`);
  args.jobLog(`Container type: ${containerType}`);

  // Check if we have anything to remux
  if (!finalVideoFile && finalAudioFiles.length === 0) {
    args.jobLog('❌ No streams to remux');
    
    // Clean up session files from cache
    try {
      const sessionFiles = fs.readdirSync(workingDir).filter(file => file.startsWith(sessionId));
      sessionFiles.forEach(file => {
        fs.unlinkSync(path.join(workingDir, file));
      });
      args.jobLog(`✓ Cleaned up ${sessionFiles.length} session files from cache`);
    } catch (error) {
      args.jobLog(`⚠️ Could not clean up session files: ${error.message}`);
    }
    
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables,
    };
  }

  // Create output file path in cache (working directory)
  const outputFile = path.join(workingDir, `remuxed_${sessionId}_${path.basename(originalFile)}`);
  
  args.jobLog(`Output file: ${outputFile}`);
  args.jobLog('\nStreams to include:');
  if (finalVideoFile) {
    args.jobLog(`  📹 Video: ${finalVideoFile.file} (${(finalVideoFile.size / 1024 / 1024).toFixed(2)} MB)`);
  }
  finalAudioFiles.forEach((audioFile, index) => {
    args.jobLog(`  🔊 Audio ${index + 1}: ${audioFile.file} (${(audioFile.size / 1024 / 1024).toFixed(2)} MB)`);
  });
  finalSubtitleFiles.forEach((subFile, index) => {
    args.jobLog(`  💬 Subtitle ${index + 1}: ${subFile.file} (${(subFile.size / 1024 / 1024).toFixed(2)} MB)`);
  });

  // Helper function to resolve binary paths
  function resolveBin(candidates) {
    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }
    return null;
  }

  try {
    if (containerType === 'mkv') {
      // Use mkvmerge for MKV files (use PATH command)
      const mkvmergeExe = 'mkvmerge';

      args.jobLog(`\nUsing mkvmerge: ${mkvmergeExe}`);
      args.jobLog('\n━━━ Building mkvmerge command ━━━');

      let mkvmergeCmd = `${mkvmergeExe} --verbose -o "${outputFile}"`;

      // Add video file first
      if (finalVideoFile) {
        mkvmergeCmd += ` "${finalVideoFile.path}"`;
        args.jobLog(`✓ Added video stream`);
      }

      // Add audio files with proper language tagging
      const trackMetadata = args.variables.trackMetadata || {};
      
      finalAudioFiles.forEach((audioFile, index) => {
        // Extract track ID from filename
        const trackIdMatch = audioFile.file.match(/track_(\d+)_/);
        const trackId = trackIdMatch ? parseInt(trackIdMatch[1]) : null;
        
        // Get original metadata for this track
        const metadata = trackId !== null ? trackMetadata[trackId] : null;
        const originalTitle = metadata ? metadata.title : '';
        const originalLanguage = metadata ? metadata.language : '';
        
        let languageCode = 'und'; // undefined/untagged
        let languageName = 'Untagged';
        
        // Use the same language detection logic as Stage 2
        function detectLanguageFromTitleOrTag(title, languageTag) {
          const textToCheck = `${title} ${languageTag}`.toLowerCase().trim();
          
          const languagePatterns = {
            eng: [/\benglish\b/i, /\beng\b/i, /\ben\b/i, /\ben-us\b/i, /\ben-gb\b/i, /\ben-au\b/i, /\ben-ca\b/i],
            jpn: [/\bjapanese\b/i, /\bjpn\b/i, /\bja\b/i, /\bja-jp\b/i, /\bnihongo\b/i, /\b日本語\b/i],
            kor: [/\bkorean\b/i, /\bkor\b/i, /\bko\b/i, /\bko-kr\b/i, /\bhangul\b/i, /\b한국어\b/i]
          };
          
          for (const [isoCode, patterns] of Object.entries(languagePatterns)) {
            if (patterns.some(pattern => pattern.test(textToCheck))) {
              return isoCode;
            }
          }
          
          // Check if language tag is already a known code
          const langLower = (languageTag || '').toLowerCase();
          if (langLower === 'eng' || langLower === 'en' || langLower === 'english') return 'eng';
          if (langLower === 'jpn' || langLower === 'ja' || langLower === 'japanese') return 'jpn';
          if (langLower === 'kor' || langLower === 'ko' || langLower === 'korean') return 'kor';
          
          return null;
        }
        
        // Determine language based on original metadata
        const detectedLanguage = detectLanguageFromTitleOrTag(originalTitle, originalLanguage);
        
        if (detectedLanguage === 'eng') {
          languageCode = 'eng';
          languageName = 'English';
        } else if (detectedLanguage === 'jpn') {
          languageCode = 'jpn';
          languageName = 'Japanese';
        } else if (detectedLanguage === 'kor') {
          languageCode = 'kor';
          languageName = 'Korean';
        }
        
        mkvmergeCmd += ` --language 0:${languageCode} --default-track 0:${index === 0 ? 'yes' : 'no'} "${audioFile.path}"`;
        args.jobLog(`✓ Added audio stream ${index + 1} (${languageName}, ${index === 0 ? 'default' : 'non-default'})`);
      });

      // Add subtitle files with proper language tagging
      finalSubtitleFiles.forEach((subFile, index) => {
        mkvmergeCmd += ` --language 0:eng --default-track 0:${index === 0 ? 'yes' : 'no'} "${subFile.path}"`;
        args.jobLog(`✓ Added subtitle stream ${index + 1} (English, ${index === 0 ? 'default' : 'non-default'})`);
      });

      args.jobLog('\n━━━ Executing mkvmerge ━━━');
      args.jobLog(`Command: ${mkvmergeCmd}`);
      args.jobLog(`Starting mkvmerge with verbose output: ${mkvmergeCmd}`);

      // Execute mkvmerge with verbose logging
      await new Promise((resolve, reject) => {
        const muxProcess = spawn('cmd', ['/c', mkvmergeCmd], { shell: true });
        
        let stdoutData = '';
        let stderrData = '';
        let timedOut = false;
        
        const timeout = setTimeout(() => {
          timedOut = true;
          args.jobLog('⚠️ Muxing taking too long, killing process...');
          args.jobLog('mkvmerge process timed out after 15 minutes');
          muxProcess.kill('SIGTERM');
        }, 900000); // 15 minutes timeout
        
        muxProcess.stdout.on('data', (data) => {
          const text = data.toString();
          stdoutData += text;
          args.jobLog(`mkvmerge stdout: ${text.trim()}`);
          // Show progress
          if (text.includes('Progress:') || text.includes('%')) {
            process.stdout.write(`\r${text.trim()}`);
          } else {
            args.jobLog(text.trim());
          }
        });
        
        muxProcess.stderr.on('data', (data) => {
          const text = data.toString();
          stderrData += text;
          args.jobLog(`mkvmerge stderr: ${text.trim()}`);
          args.jobLog(text.trim());
        });
        
        muxProcess.on('close', (code) => {
          clearTimeout(timeout);
          args.jobLog('');
          args.jobLog(`mkvmerge completed with exit code: ${code}`);
          
          if (timedOut) {
            args.jobLog('❌ Muxing timed out');
            args.jobLog('mkvmerge process timed out');
            reject(new Error('timeout'));
          } else if (code !== 0) {
            args.jobLog(`❌ mkvmerge failed with code ${code}`);
            if (stderrData) {
              args.jobLog(`Error: ${stderrData}`);
            }
            args.jobLog(`mkvmerge failed with code ${code}: ${stderrData}`);
            reject(new Error(`mkvmerge failed: ${stderrData}`));
          } else {
            args.jobLog('✓ Muxing completed successfully');
            args.jobLog('mkvmerge completed successfully');
            resolve();
          }
        });
        
        muxProcess.on('error', (err) => {
          clearTimeout(timeout);
          args.jobLog(`❌ Failed to start mkvmerge: ${err.message}`);
          args.jobLog(`Failed to start mkvmerge: ${err.message}`);
          reject(err);
        });
      });

    } else if (containerType === 'mp4') {
      // Use ffmpeg for MP4 files (use PATH command)
      const ffmpegExe = 'ffmpeg';

      args.jobLog(`\nUsing ffmpeg: ${ffmpegExe}`);
      args.jobLog('\n━━━ Building ffmpeg command ━━━');

      let ffmpegCmd = `${ffmpegExe}`;
      let inputIndex = 0;
      let mapArgs = [];
      let codecArgs = ['-c', 'copy']; // Copy all streams without re-encoding
      let metadataArgs = [];
      let dispositionArgs = [];

      // Add video file as input
      if (finalVideoFile) {
        ffmpegCmd += ` -i "${finalVideoFile.path}"`;
        mapArgs.push('-map', `${inputIndex}:0`);
        args.jobLog(`✓ Added video input (index ${inputIndex})`);
        inputIndex++;
      }

      // Add audio files as inputs
      const trackMetadata = args.variables.trackMetadata || {};
      
      finalAudioFiles.forEach((audioFile, index) => {
        ffmpegCmd += ` -i "${audioFile.path}"`;
        mapArgs.push('-map', `${inputIndex}:0`);
        
        // Extract track ID from filename
        const trackIdMatch = audioFile.file.match(/track_(\d+)_/);
        const trackId = trackIdMatch ? parseInt(trackIdMatch[1]) : null;
        
        // Get original metadata for this track
        const metadata = trackId !== null ? trackMetadata[trackId] : null;
        const originalTitle = metadata ? metadata.title : '';
        const originalLanguage = metadata ? metadata.language : '';
        
        let languageCode = 'und'; // undefined/untagged
        let languageName = 'Untagged';
        
        // Use the same language detection logic as Stage 2
        function detectLanguageFromTitleOrTag(title, languageTag) {
          const textToCheck = `${title} ${languageTag}`.toLowerCase().trim();
          
          const languagePatterns = {
            eng: [/\benglish\b/i, /\beng\b/i, /\ben\b/i, /\ben-us\b/i, /\ben-gb\b/i, /\ben-au\b/i, /\ben-ca\b/i],
            jpn: [/\bjapanese\b/i, /\bjpn\b/i, /\bja\b/i, /\bja-jp\b/i, /\bnihongo\b/i, /\b日本語\b/i],
            kor: [/\bkorean\b/i, /\bkor\b/i, /\bko\b/i, /\bko-kr\b/i, /\bhangul\b/i, /\b한국어\b/i]
          };
          
          for (const [isoCode, patterns] of Object.entries(languagePatterns)) {
            if (patterns.some(pattern => pattern.test(textToCheck))) {
              return isoCode;
            }
          }
          
          // Check if language tag is already a known code
          const langLower = (languageTag || '').toLowerCase();
          if (langLower === 'eng' || langLower === 'en' || langLower === 'english') return 'eng';
          if (langLower === 'jpn' || langLower === 'ja' || langLower === 'japanese') return 'jpn';
          if (langLower === 'kor' || langLower === 'ko' || langLower === 'korean') return 'kor';
          
          return null;
        }
        
        // Determine language based on original metadata
        const detectedLanguage = detectLanguageFromTitleOrTag(originalTitle, originalLanguage);
        
        if (detectedLanguage === 'eng') {
          languageCode = 'eng';
          languageName = 'English';
        } else if (detectedLanguage === 'jpn') {
          languageCode = 'jpn';
          languageName = 'Japanese';
        } else if (detectedLanguage === 'kor') {
          languageCode = 'kor';
          languageName = 'Korean';
        }
        
        metadataArgs.push(`-metadata:s:a:${index}`, `language=${languageCode}`);
        if (index === 0) {
          dispositionArgs.push(`-disposition:a:${index}`, 'default');
        }
        args.jobLog(`✓ Added audio input ${index + 1} (index ${inputIndex}, ${languageName}, ${index === 0 ? 'default' : 'non-default'})`);
        inputIndex++;
      });

      // Add subtitle files as inputs
      finalSubtitleFiles.forEach((subFile, index) => {
        ffmpegCmd += ` -i "${subFile.path}"`;
        mapArgs.push('-map', `${inputIndex}:0`);
        metadataArgs.push(`-metadata:s:s:${index}`, 'language=eng');
        if (index === 0) {
          dispositionArgs.push(`-disposition:s:${index}`, 'default');
        }
        args.jobLog(`✓ Added subtitle input ${index + 1} (index ${inputIndex}, English, ${index === 0 ? 'default' : 'non-default'})`);
        inputIndex++;
      });

      // Build complete command
      const allArgs = [
        ...mapArgs,
        ...codecArgs,
        ...metadataArgs,
        ...dispositionArgs,
        '-y', // Overwrite output
        `"${outputFile}"`
      ];

      ffmpegCmd += ' ' + allArgs.join(' ');

      args.jobLog('\n━━━ Executing ffmpeg ━━━');
      args.jobLog(`Command: ${ffmpegCmd}`);
      args.jobLog(`Starting ffmpeg with verbose output: ${ffmpegCmd.replace(ffmpegExe, `${ffmpegExe} -v verbose`)}`);

      // Execute ffmpeg with verbose logging
      await new Promise((resolve, reject) => {
        const verboseCmd = ffmpegCmd.replace(ffmpegExe, `${ffmpegExe} -v verbose`);
        const muxProcess = spawn('cmd', ['/c', verboseCmd], { shell: true });
        
        let stdoutData = '';
        let stderrData = '';
        let timedOut = false;
        
        const timeout = setTimeout(() => {
          timedOut = true;
          args.jobLog('⚠️ Muxing taking too long, killing process...');
          args.jobLog('ffmpeg process timed out after 5 minutes');
          muxProcess.kill('SIGTERM');
        }, 300000); // 5 minutes timeout
        
        muxProcess.stdout.on('data', (data) => {
          const text = data.toString();
          stdoutData += text;
          args.jobLog(`ffmpeg stdout: ${text.trim()}`);
        });
        
        muxProcess.stderr.on('data', (data) => {
          const text = data.toString();
          stderrData += text;
          args.jobLog(`ffmpeg stderr: ${text.trim()}`);
          // Show progress from ffmpeg stderr
          if (text.includes('time=') || text.includes('frame=')) {
            const lines = text.split('\n');
            const progressLine = lines.find(line => line.includes('time='));
            if (progressLine) {
              process.stdout.write(`\r${progressLine.trim()}`);
            }
          }
        });
        
        muxProcess.on('close', (code) => {
          clearTimeout(timeout);
          args.jobLog('');
          args.jobLog(`ffmpeg completed with exit code: ${code}`);
          
          if (timedOut) {
            args.jobLog('❌ Muxing timed out');
            args.jobLog('ffmpeg process timed out');
            reject(new Error('timeout'));
          } else if (code !== 0) {
            args.jobLog(`❌ ffmpeg failed with code ${code}`);
            if (stderrData) {
              args.jobLog(`Error: ${stderrData}`);
            }
            args.jobLog(`ffmpeg failed with code ${code}: ${stderrData}`);
            reject(new Error(`ffmpeg failed: ${stderrData}`));
          } else {
            args.jobLog('✓ Muxing completed successfully');
            args.jobLog('ffmpeg completed successfully');
            resolve();
          }
        });
        
        muxProcess.on('error', (err) => {
          clearTimeout(timeout);
          args.jobLog(`❌ Failed to start ffmpeg: ${err.message}`);
          args.jobLog(`Failed to start ffmpeg: ${err.message}`);
          reject(err);
        });
      });
    }

    // Verify output file was created
    if (!fs.existsSync(outputFile)) {
      throw new Error('Output file was not created');
    }

    const outputStats = fs.statSync(outputFile);
    const originalStats = fs.statSync(originalFile);
    
    args.jobLog('\n━━━ Muxing Results ━━━');
    args.jobLog(`✓ Output file created: ${path.basename(outputFile)}`);
    args.jobLog(`  Original size: ${(originalStats.size / 1024 / 1024).toFixed(2)} MB`);
    args.jobLog(`  New size: ${(outputStats.size / 1024 / 1024).toFixed(2)} MB`);
    args.jobLog(`  Size difference: ${((outputStats.size - originalStats.size) / 1024 / 1024).toFixed(2)} MB`);

    // Set remuxed file as the new working file (cache-based approach)
    args.jobLog('\n━━━ Setting Remuxed File as Working File ━━━');
    args.jobLog('✓ Remuxed file created in cache - will be used as working file');
    args.jobLog('✓ Original library file remains untouched during processing');
    args.jobLog('✓ Cache-based operations complete - ready for transcoding stages');
    
    // Update file object to point to the remuxed cache file
    args.inputFileObj.file_size = outputStats.size / 1024 / 1024; // Convert to MB

  } catch (error) {
    args.jobLog(`❌ Remuxing failed: ${error.message}`);
    
    // Clean up temporary output file if it exists
    if (fs.existsSync(outputFile)) {
      try {
        fs.unlinkSync(outputFile);
        args.jobLog('✓ Cleaned up temporary output file');
      } catch (cleanupError) {
        args.jobLog('⚠️ Could not clean up temporary output file');
      }
    }
    
    // Clean up session files from cache
    try {
      const sessionFiles = fs.readdirSync(workingDir).filter(file => file.startsWith(sessionId));
      sessionFiles.forEach(file => {
        fs.unlinkSync(path.join(workingDir, file));
      });
      args.jobLog(`✓ Cleaned up ${sessionFiles.length} session files from cache`);
    } catch (cleanupError) {
      args.jobLog('⚠️ Could not clean up session files');
    }
    
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables,
    };
  }

  // Note: Session cleanup is handled in the final return section below
  // No need for additional cleanup here as we're working with cache files

  args.jobLog('\n═══════════════════════════════════════');
  args.jobLog('   MEDIA PROCESSING COMPLETE');
  args.jobLog('═══════════════════════════════════════');
  
  args.jobLog('✓ PROCESSING SUMMARY:');
  if (finalVideoFile) {
    args.jobLog('  📹 Video: Optimized and included');
  }
  if (finalAudioFiles.length > 0) {
    args.jobLog(`  🔊 Audio: ${finalAudioFiles.length} English stream(s) included`);
  }
  if (finalSubtitleFiles.length > 0) {
    args.jobLog(`  💬 Subtitles: ${finalSubtitleFiles.length} English SRT stream(s) included`);
  }
  
  args.jobLog('\n🎯 OPTIMIZATION GOALS ACHIEVED:');
  args.jobLog('   ✓ Simple 3-stage process (extract → clean → remux)');
  args.jobLog('   ✓ Only English content preserved');
  args.jobLog('   ✓ Proper stream ordering (video → audio → subtitles)');
  args.jobLog('   ✓ Correct language tagging and default flags');
  args.jobLog('   ✓ Cache-based operations (no library file replacement during processing)');

  // Clean up session files (except the final remuxed file)
  args.jobLog('\n━━━ Session Cleanup ━━━');
  try {
    const sessionFiles = fs.readdirSync(workingDir).filter(file => 
      file.startsWith(sessionId) && file !== path.basename(outputFile)
    );
    sessionFiles.forEach(file => {
      fs.unlinkSync(path.join(workingDir, file));
    });
    args.jobLog(`✓ Cleaned up ${sessionFiles.length} intermediate session files`);
    args.jobLog(`✓ Kept final remuxed file: ${path.basename(outputFile)}`);
  } catch (error) {
    args.jobLog(`⚠️ Could not clean up session files: ${error.message}`);
  }

  // Return the remuxed cache file as the new working file
  return {
    outputFileObj: {
      _id: outputFile
    },
    outputNumber: 1,
    variables: args.variables
  };
};
