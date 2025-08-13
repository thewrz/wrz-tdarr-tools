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

    // Language detection patterns for title inspection
    const languagePatterns = {
      eng: [
        /\benglish\b/i,
        /\beng\b/i,
        /\ben\b/i,
        /\ben-us\b/i,
        /\ben-gb\b/i,
        /\ben-au\b/i,
        /\ben-ca\b/i
      ],
      jpn: [
        /\bjapanese\b/i,
        /\bjpn\b/i,
        /\bja\b/i,
        /\bja-jp\b/i,
        /\bnihongo\b/i,
        /\b日本語\b/i
      ],
      kor: [
        /\bkorean\b/i,
        /\bkor\b/i,
        /\bko\b/i,
        /\bko-kr\b/i,
        /\bhangul\b/i,
        /\b한국어\b/i
      ],
      deu: [
        /\bgerman\b/i,
        /\bdeu\b/i,
        /\bger\b/i,
        /\bde\b/i,
        /\bde-de\b/i,
        /\bdeutsch\b/i
      ],
      fra: [
        /\bfrench\b/i,
        /\bfra\b/i,
        /\bfre\b/i,
        /\bfr\b/i,
        /\bfr-fr\b/i,
        /\bfrancais\b/i,
        /\bfrançais\b/i
      ]
    };

    function detectLanguageFromTitle(title) {
      if (!title) return null;
      
      const titleLower = title.toLowerCase().trim();
      
      for (const [isoCode, patterns] of Object.entries(languagePatterns)) {
        if (patterns.some(pattern => pattern.test(titleLower))) {
          return isoCode;
        }
      }
      
      return null;
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
      let language = (tags.language || '').toLowerCase();
      const channels = stream.channels || 0;
      const codec = stream.codec_name || 'unknown';
      const trackName = tags.title || tags.name || tags.handler_name || '';
      let languageSource = 'tag';
      
      // If no language tag or language is 'und', try to detect from title
      if (!language || language === 'und' || language === 'undefined') {
        const detectedLanguage = detectLanguageFromTitle(trackName);
        if (detectedLanguage) {
          language = detectedLanguage;
          languageSource = 'title';
          args.jobLog(`Stream ${index}: ${codec} (${channels}ch) - ${language} (detected from title)`);
        } else {
          language = 'und';
          languageSource = 'undefined';
          args.jobLog(`Stream ${index}: ${codec} (${channels}ch) - und (no language detected)`);
        }
      } else {
        args.jobLog(`Stream ${index}: ${codec} (${channels}ch) - ${language}`);
      }
      
      if (trackName) {
        args.jobLog(`  Title: "${trackName}"`);
      }

      const streamInfo = {
        index: stream.index,
        streamIndex: index,
        language: language,
        languageSource: languageSource,
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
        args.jobLog(`  → English stream detected (${languageSource})`);
      } else if (language === 'und' || language === 'undefined') {
        analysis.undefinedStreams.push(streamInfo);
        args.jobLog(`  → Undefined language stream`);
      } else {
        analysis.otherLanguageStreams.push(streamInfo);
        args.jobLog(`  → Other language stream (${language}) (${languageSource})`);
      }
    });

    // Handle undefined streams - keep only the first one, mark others for removal
    if (analysis.undefinedStreams.length > 1) {
      args.jobLog(`⚠️ Found ${analysis.undefinedStreams.length} undefined language streams - keeping only the first one`);
      const firstUndefined = analysis.undefinedStreams[0];
      const extraUndefined = analysis.undefinedStreams.slice(1);
      
      // Keep only the first undefined stream
      analysis.undefinedStreams = [firstUndefined];
      
      // Add extra undefined streams to commentary streams for removal
      analysis.commentaryStreams.push(...extraUndefined);
      
      extraUndefined.forEach(stream => {
        args.jobLog(`  → Extra undefined stream ${stream.streamIndex} marked for removal`);
      });
    }

    // Log commentary detection results
    if (analysis.commentaryStreams.length > 0) {
      args.jobLog(`🎯 Found ${analysis.commentaryStreams.length} commentary/audio description track(s) to remove:`);
      analysis.commentaryStreams.forEach(track => {
        args.jobLog(`  - Stream ${track.streamIndex}: "${track.trackName}" (${track.language})`);
      });
    }

    args.jobLog('━━━ Processing Decision ━━━');
    
    // Check if we need processing (duplicates, commentary, or multiple undefined streams)
    const needsProcessing = analysis.englishStreams.length > 1 || 
                           analysis.commentaryStreams.length > 0;

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

    // Additional safety check: ensure we have streams to keep
    if (analysis.englishStreams.length === 0 && analysis.otherLanguageStreams.length === 0 && analysis.undefinedStreams.length === 0) {
      args.jobLog('❌ No valid audio streams found to keep - this should not happen');
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 3, // Error
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
    
    // Safety check: ensure we have English streams before accessing
    if (analysis.englishStreams.length > 0) {
      // Always put the English stream first
      streamsToKeep.push(analysis.englishStreams[0]); // Keep first English stream as primary
    }
    
    // Add other language streams after English
    streamsToKeep.push(...analysis.otherLanguageStreams); // Keep all other languages
    
    // Add undefined streams last (if any - though we skip processing when these exist)
    streamsToKeep.push(...analysis.undefinedStreams);
    
    // Note: Commentary streams are automatically excluded from streamsToKeep
    
    const streamsToRemove = [
      ...analysis.englishStreams.slice(1), // Remove duplicate English streams
      ...analysis.commentaryStreams // Remove all commentary streams
    ];

    if (analysis.englishStreams.length > 0) {
      args.jobLog(`✓ Keeping first English stream (index ${analysis.englishStreams[0].index}) - will be positioned as first audio track`);
    }
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
    let workDir = 'Y:/cache'; // Default fallback
    
    // Try to get from library settings first
    if (args.librarySettings && args.librarySettings.cache) {
      workDir = args.librarySettings.cache;
    }
    
    // Fix malformed cache paths (like 'Y:Y:/cache' -> 'Y:/cache')
    if (workDir.includes('Y:Y:/')) {
      workDir = workDir.replace('Y:Y:/', 'Y:/');
      args.jobLog(`Fixed malformed cache path to: ${workDir}`);
    }
    
    // Handle Tdarr's cache workflow - work with the current file (which may already be a cache file)
    // Tdarr automatically handles cache file creation and replacement
    const currentFile = args.inputFileObj._id;
    args.jobLog(`Current working file: ${currentFile}`);
    
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
        // For MKV files, we need to map FFprobe stream indices to mkvmerge track IDs
        // Get mkvmerge track info from variables (set by subtitle tools)
        const mkvTracks = args.variables.mkvTracks || [];
        
        if (mkvTracks.length === 0) {
          args.jobLog('❌ No mkvmerge track information available - falling back to FFmpeg');
          resolve({ success: false, error: 'No mkvmerge track information' });
          return;
        }
        
        // Map FFprobe audio streams to mkvmerge track IDs
        const audioTrackIds = [];
        
        streamsToKeep.forEach(streamToKeep => {
          // Find corresponding mkvmerge track by matching the stream index from FFprobe
          // Note: FFprobe stream.index corresponds to the actual stream index in the file
          const mkvTrack = mkvTracks.find(track => 
            track.type === 'audio' && 
            track.id === streamToKeep.index
          );
          
          if (mkvTrack) {
            audioTrackIds.push(mkvTrack.id);
            args.jobLog(`✓ Mapping FFprobe stream ${streamToKeep.index} to mkvmerge track ${mkvTrack.id}`);
          } else {
            // Try alternative mapping by stream position
            const audioStreamsInMkv = mkvTracks.filter(t => t.type === 'audio');
            const streamPosition = streamToKeep.streamIndex; // 0-based position in audio streams
            
            if (streamPosition < audioStreamsInMkv.length) {
              const alternativeTrack = audioStreamsInMkv[streamPosition];
              audioTrackIds.push(alternativeTrack.id);
              args.jobLog(`✓ Alternative mapping: FFprobe stream ${streamToKeep.index} (pos ${streamPosition}) to mkvmerge track ${alternativeTrack.id}`);
            } else {
              args.jobLog(`❌ Could not find mkvmerge track for FFprobe stream ${streamToKeep.index} (pos ${streamPosition})`);
            }
          }
        });
        
        if (audioTrackIds.length === 0) {
          args.jobLog('❌ No valid audio track IDs found for mkvmerge - falling back to FFmpeg');
          resolve({ success: false, error: 'No valid audio track IDs' });
          return;
        }
        
        const audioTracks = audioTrackIds.join(',');

        const mkvArgs = [
          '-o', tempOutput,
          '--verbose',
          '--audio-tracks', audioTracks,
          // '--video-tracks', 'all',
          // '--subtitle-tracks', 'all',
          // '--chapters', 'all',
          // '--attachments', 'all',
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
          const text = data.toString();
          stdoutData += text;
          args.jobLog(text.trim());
        });

        process.stderr.on('data', (data) => {
          const text = data.toString();
          stderrData += text;
          args.jobLog(text.trim());
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
