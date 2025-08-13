// Audio English Deduplicator Flow Plugin
// Removes duplicate English audio streams while preserving all other language tracks
// Uses MKVToolsNix for MKV files, FFmpeg for MP4 and other formats

module.exports = async (args) => {
  const fs = require('fs');
  const path = require('path');
  const { spawn } = require('child_process');
  const crypto = require('crypto');

  try {
    args.jobLog('═══════════════════════════════════════');
    args.jobLog('   AUDIO ENGLISH DEDUPLICATOR');
    args.jobLog('═══════════════════════════════════════');

    // Get audio streams from ffProbeData
    const audioStreams = args.inputFileObj.ffProbeData.streams.filter(stream => stream.codec_type === 'audio');
    
    if (audioStreams.length === 0) {
      args.jobLog('❓ No audio streams found - skipping');
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 2, // Skip processing
        variables: args.variables,
      };
    }

    args.jobLog(`✓ Found ${audioStreams.length} audio streams`);

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
      /bonus.*audio/i,
      /audio\s+description/i,
      /descriptive\s+audio/i,
      /described\s+video/i,
      /\bad\b/i,  // audio description abbreviation
      /vision.*impaired/i,
      /accessibility/i
    ];

    function isCommentaryTrack(trackName, handlerName = '') {
      const textToCheck = `${trackName} ${handlerName}`.toLowerCase().trim();
      if (!textToCheck) return false;
      
      return commentaryPatterns.some(pattern => pattern.test(textToCheck));
    }

    // Analyze audio streams by language and filter out commentary
    const analysis = {
      englishStreams: [],
      otherLanguageStreams: [],
      undefinedStreams: [],
      commentaryStreams: []
    };

    args.jobLog('━━━ Analyzing Audio Streams ━━━');

    audioStreams.forEach((stream, index) => {
      const tags = stream.tags || {};
      const language = (tags.language || 'und').toLowerCase();
      const channels = stream.channels || 0;
      const codec = stream.codec_name || 'unknown';
      const trackName = tags.title || tags.name || tags.handler_name || '';
      
      args.jobLog(`Stream ${index}: ${codec} (${channels}ch) - ${language}`);
      if (trackName) {
        args.jobLog(`  Title: "${trackName}"`);
      }

      const streamInfo = {
        index: stream.index,
        streamIndex: index,
        language: language,
        channels: channels,
        codec: codec,
        trackName: trackName,
        stream: stream
      };

      // Check if this is a commentary or audio description track
      if (isCommentaryTrack(trackName)) {
        analysis.commentaryStreams.push(streamInfo);
        args.jobLog(`  → Commentary/Audio Description detected - will be removed`);
      } else if (language === 'eng' || language === 'en' || language === 'english') {
        analysis.englishStreams.push(streamInfo);
        args.jobLog(`  → English stream detected`);
      } else if (language === 'und' || language === 'undefined') {
        analysis.undefinedStreams.push(streamInfo);
        args.jobLog(`  → Undefined language stream`);
      } else {
        analysis.otherLanguageStreams.push(streamInfo);
        args.jobLog(`  → Other language stream (${language})`);
      }
    });

    // Log commentary detection results
    if (analysis.commentaryStreams.length > 0) {
      args.jobLog(`🎯 Found ${analysis.commentaryStreams.length} commentary/audio description track(s) to remove:`);
      analysis.commentaryStreams.forEach(track => {
        args.jobLog(`  - Stream ${track.streamIndex}: "${track.trackName}" (${track.language})`);
      });
    }

    args.jobLog('━━━ Processing Decision ━━━');
    
    // Skip if undefined language streams exist (avoid data loss)
    if (analysis.undefinedStreams.length > 0) {
      args.jobLog('⚠️ Found undefined language streams - skipping to avoid data loss');
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 2, // Skip processing
        variables: args.variables,
      };
    }

    // Check if we need processing (duplicates or commentary)
    const needsProcessing = analysis.englishStreams.length > 1 || analysis.commentaryStreams.length > 0;

    if (!needsProcessing) {
      if (analysis.englishStreams.length === 0) {
        args.jobLog('⚠️ No English audio streams found - skipping');
      } else if (analysis.englishStreams.length === 1 && analysis.commentaryStreams.length === 0) {
        args.jobLog('✓ Only one English audio stream and no commentary - no processing needed');
      }
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 2, // Skip processing
        variables: args.variables,
      };
    }

    // Processing needed - either duplicates or commentary removal
    if (analysis.englishStreams.length > 1) {
      args.jobLog(`🔄 Multiple English streams detected (${analysis.englishStreams.length}) - deduplication needed`);
    }
    if (analysis.commentaryStreams.length > 0) {
      args.jobLog(`🔄 Commentary/Audio Description tracks detected (${analysis.commentaryStreams.length}) - removal needed`);
    }
    
    // Determine streams to keep/remove with English stream first
    const streamsToKeep = [];
    
    // Always put the English stream first
    streamsToKeep.push(analysis.englishStreams[0]); // Keep first English stream as primary
    
    // Add other language streams after English
    streamsToKeep.push(...analysis.otherLanguageStreams); // Keep all other languages
    
    // Add undefined streams last (if any - though we skip processing when these exist)
    streamsToKeep.push(...analysis.undefinedStreams);
    
    // Note: Commentary streams are automatically excluded from streamsToKeep
    
    const streamsToRemove = [
      ...analysis.englishStreams.slice(1), // Remove duplicate English streams
      ...analysis.commentaryStreams // Remove all commentary streams
    ];

    args.jobLog(`✓ Keeping first English stream (index ${analysis.englishStreams[0].index}) - will be positioned as first audio track`);
    args.jobLog(`✓ Keeping ${analysis.otherLanguageStreams.length} other language streams`);
    if (analysis.undefinedStreams.length > 0) {
      args.jobLog(`✓ Keeping ${analysis.undefinedStreams.length} undefined language streams`);
    }
    args.jobLog(`❌ Removing ${analysis.englishStreams.length - 1} duplicate English streams`);
    args.jobLog(`❌ Removing ${analysis.commentaryStreams.length} commentary/audio description streams`);

    // Determine container type and processing method
    const inputFile = args.inputFileObj._id;
    const ext = path.extname(inputFile).toLowerCase().replace('.', '');
    const container = (args.inputFileObj.container || '').toLowerCase();
    const isMKV = ext === 'mkv' || container === 'mkv' || container === 'matroska';
    const isMP4 = ext === 'mp4' || container === 'mp4' || ext === 'm4v';

    args.jobLog(`Container: ${container}, Extension: ${ext}`);
    args.jobLog(`Processing method: ${isMKV ? 'MKVToolsNix' : 'FFmpeg'}`);

    // Determine working directory - use the cache directory from library settings
    let workDir = 'Y:/cache'; // Default from your log
    
    // Try to get from library settings first
    if (args.librarySettings && args.librarySettings.cache) {
      workDir = args.librarySettings.cache;
    }
    
    // Ensure working directory exists
    try {
      if (!fs.existsSync(workDir)) {
        fs.mkdirSync(workDir, { recursive: true });
        args.jobLog(`Created working directory: ${workDir}`);
      }
    } catch (error) {
      args.jobLog(`❌ Failed to create working directory: ${error.message}`);
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 3, // Error
        variables: args.variables,
      };
    }
    
    args.jobLog(`Working directory: ${workDir}`);

    // Helper function to resolve binary paths
    function resolveBin(candidates) {
      for (const p of candidates) {
        try { 
          if (fs.existsSync(p)) return p; 
        } catch {}
      }
      return null;
    }

    // Create unique identifier for this processing session to avoid conflicts
    const inputFileHash = crypto.createHash('md5').update(inputFile).digest('hex').substring(0, 8);
    const processId = process.pid;
    const timestamp = Date.now();
    const uniqueId = `${inputFileHash}_${processId}_${timestamp}`;
    
    args.jobLog(`Unique processing ID: ${uniqueId}`);
    
    // Create temp output file path with unique ID to prevent conflicts
    const fileName = path.basename(inputFile);
    const tempOutput = path.join(workDir, `temp_${uniqueId}_${fileName}`);
    
    args.jobLog(`Input file: ${inputFile}`);
    args.jobLog(`Temp output: ${tempOutput}`);

    let processingResult;

    // Process with MKVToolsNix for MKV files
    if (isMKV) {
      args.jobLog('━━━ Using MKVToolsNix (mkvmerge) ━━━');
      
      const mkvmergePath = resolveBin([
        'C:\\Program Files\\MKVToolNix\\mkvmerge.exe',
        'C:\\Program Files (x86)\\MKVToolNix\\mkvmerge.exe',
        'mkvmerge'
      ]);

      if (!mkvmergePath) {
        args.jobLog('❌ mkvmerge not found - falling back to FFmpeg');
        processingResult = await processWithFFmpeg();
      } else {
        args.jobLog(`Found mkvmerge at: ${mkvmergePath !== 'mkvmerge' ? mkvmergePath : 'PATH'}`);
        
        // Test if mkvmerge is accessible
        try {
          const { execFileSync } = require('child_process');
          execFileSync(mkvmergePath, ['--version'], { encoding: 'utf8', timeout: 10000 });
          args.jobLog('✓ mkvmerge is accessible');
          processingResult = await processWithMKVToolsNix(mkvmergePath);
        } catch (testError) {
          args.jobLog(`❌ mkvmerge test failed: ${testError.message}`);
          args.jobLog('Falling back to FFmpeg');
          processingResult = await processWithFFmpeg();
        }
      }
    } else {
      // Use FFmpeg for MP4 and other formats
      args.jobLog('━━━ Using FFmpeg ━━━');
      processingResult = await processWithFFmpeg();
    }

    // MKVToolsNix processing function
    async function processWithMKVToolsNix(mkvmergePath) {
      return new Promise((resolve) => {
        // Build audio track selection - use streamIndex for mkvmerge
        const audioTracks = streamsToKeep
          .map(stream => stream.streamIndex)
          .join(',');

        const mkvArgs = [
          '-o', tempOutput,
          '--audio-tracks', audioTracks,
          '--video-tracks', 'all',
          '--subtitle-tracks', 'all',
          '--chapters', 'all',
          '--attachments', 'all',
          inputFile
        ];

        args.jobLog(`Command: mkvmerge ${mkvArgs.join(' ')}`);

        const process = spawn(mkvmergePath, mkvArgs);
        
        let stdoutData = '';
        let stderrData = '';
        let timedOut = false;

        const timeout = setTimeout(() => {
          timedOut = true;
          args.jobLog('⚠️ Processing taking too long, killing process...');
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
            args.jobLog('❌ Processing timed out');
            resolve({ success: false, error: 'timeout' });
          } else if (code !== 0) {
            args.jobLog(`❌ mkvmerge exited with code ${code}`);
            if (stderrData) {
              args.jobLog(`Error: ${stderrData}`);
            }
            resolve({ success: false, error: stderrData });
          } else {
            args.jobLog('✓ Processing completed successfully');
            resolve({ success: true, outputFile: tempOutput });
          }
        });

        process.on('error', (err) => {
          clearTimeout(timeout);
          args.jobLog(`❌ Failed to start mkvmerge: ${err.message}`);
          resolve({ success: false, error: err.message });
        });
      });
    }

    // FFmpeg processing function
    async function processWithFFmpeg() {
      return new Promise((resolve) => {
        const ffmpegPath = resolveBin([
          'C:\\programdata\\chocolatey\\bin\\ffmpeg.exe',
          'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
          'C:\\ffmpeg\\bin\\ffmpeg.exe',
          'ffmpeg'
        ]);

        if (!ffmpegPath) {
          args.jobLog('❌ ffmpeg not found');
          resolve({ success: false, error: 'ffmpeg not found' });
          return;
        }

        args.jobLog(`Found ffmpeg at: ${ffmpegPath !== 'ffmpeg' ? ffmpegPath : 'PATH'}`);

        // Build stream mapping
        const mapArgs = [];
        
        // Map video streams (copy all)
        mapArgs.push('-map', '0:v');
        
        // Map selected audio streams
        streamsToKeep.forEach((stream) => {
          mapArgs.push('-map', `0:a:${stream.streamIndex}`);
        });
        
        // Map subtitle streams (copy all)
        mapArgs.push('-map', '0:s?');

        const ffmpegArgs = [
          '-i', inputFile,
          ...mapArgs,
          '-c', 'copy', // Copy all streams without re-encoding
          '-y', // Overwrite output file
          tempOutput
        ];

        args.jobLog(`Command: ffmpeg ${ffmpegArgs.join(' ')}`);

        const process = spawn(ffmpegPath, ffmpegArgs);
        
        let stdoutData = '';
        let stderrData = '';
        let timedOut = false;

        const timeout = setTimeout(() => {
          timedOut = true;
          args.jobLog('⚠️ Processing taking too long, killing process...');
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
            args.jobLog('❌ Processing timed out');
            resolve({ success: false, error: 'timeout' });
          } else if (code !== 0) {
            args.jobLog(`❌ ffmpeg exited with code ${code}`);
            if (stderrData) {
              args.jobLog(`Error: ${stderrData}`);
            }
            resolve({ success: false, error: stderrData });
          } else {
            args.jobLog('✓ Processing completed successfully');
            resolve({ success: true, outputFile: tempOutput });
          }
        });

        process.on('error', (err) => {
          clearTimeout(timeout);
          args.jobLog(`❌ Failed to start ffmpeg: ${err.message}`);
          resolve({ success: false, error: err.message });
        });
      });
    }

    // Check processing result and replace original file
    if (processingResult && processingResult.success && fs.existsSync(processingResult.outputFile)) {
      const inputStats = fs.statSync(inputFile);
      const outputStats = fs.statSync(processingResult.outputFile);
      
      args.jobLog('\n✓ Processing complete');
      args.jobLog(`  Original size: ${(inputStats.size / 1024 / 1024).toFixed(2)} MB`);
      args.jobLog(`  New size: ${(outputStats.size / 1024 / 1024).toFixed(2)} MB`);
      
      // Replace original file with new one
      args.jobLog('\nReplacing original file...');
      
      // Use copy + delete approach for cross-device compatibility
      try {
        // Copy temp file to original location
        fs.copyFileSync(processingResult.outputFile, inputFile);
        args.jobLog('✓ File copied to original location');
        
        // Delete temp file after successful copy
        fs.unlinkSync(processingResult.outputFile);
        args.jobLog('✓ Temporary file cleaned up');
        
        args.jobLog('✓ File replaced successfully');
      } catch (copyError) {
        args.jobLog(`❌ Failed to replace original file: ${copyError.message}`);
        
        // Clean up temp file if it exists
        if (fs.existsSync(processingResult.outputFile)) {
          try {
            fs.unlinkSync(processingResult.outputFile);
            args.jobLog('✓ Cleaned up temporary file');
          } catch (cleanupError) {
            args.jobLog('⚠️ Could not clean up temporary file');
          }
        }
        
        return {
          outputFileObj: args.inputFileObj,
          outputNumber: 3, // Error - route to error handling
          variables: args.variables,
        };
      }
      
      // Update file object to reflect changes
      args.inputFileObj.file_size = outputStats.size / 1024 / 1024; // Convert to MB
      
      // Mark that audio changes were applied - this helps downstream stages
      // know that the file has been modified and should be considered "processed"
      const newVariables = { ...args.variables };
      newVariables.audioDeduplicationApplied = true;
      newVariables.originalFile = inputFile;
      newVariables.englishStreamsRemoved = analysis.englishStreams.length - 1;
      newVariables.commentaryStreamsRemoved = analysis.commentaryStreams.length;
      newVariables.totalStreamsRemoved = streamsToRemove.length;
      newVariables.totalStreamsKept = streamsToKeep.length;
      
      // CRITICAL: Set flag to force file replacement even if subsequent stages skip
      // This ensures that when other stages determine no conversion is needed,
      // the audio-modified cache file still replaces the original library file
      newVariables.forceReplaceOriginal = true;
      
      args.jobLog('\n═══════════════════════════════════════');
      args.jobLog('   AUDIO PROCESSING COMPLETE');
      args.jobLog('═══════════════════════════════════════');
      if (analysis.englishStreams.length > 1) {
        args.jobLog(`✓ Removed: ${analysis.englishStreams.length - 1} duplicate English stream(s)`);
      }
      if (analysis.commentaryStreams.length > 0) {
        args.jobLog(`✓ Removed: ${analysis.commentaryStreams.length} commentary/audio description stream(s)`);
      }
      args.jobLog(`✓ Total streams removed: ${streamsToRemove.length}`);
      args.jobLog(`✓ Total streams kept: ${streamsToKeep.length}`);
      args.jobLog(`✓ File updated successfully`);
      
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 1, // Success - continue to next plugin
        variables: newVariables,
      };
    } else {
      args.jobLog('❌ Processing failed');
      
      // Clean up temp file if it exists
      if (fs.existsSync(tempOutput)) {
        try {
          fs.unlinkSync(tempOutput);
          args.jobLog('✓ Cleaned up temporary file');
        } catch (cleanupError) {
          args.jobLog('⚠️ Could not clean up temporary file');
        }
      }
      
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 3, // Error - route to error handling
        variables: args.variables,
      };
    }

  } catch (error) {
    args.jobLog(`❌ Error in audio deduplication: ${error.message}`);
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 3, // Error
      variables: args.variables,
    };
  }
};
