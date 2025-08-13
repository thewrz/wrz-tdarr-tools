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

    // Analyze audio streams by language
    const analysis = {
      englishStreams: [],
      otherLanguageStreams: [],
      undefinedStreams: []
    };

    args.jobLog('━━━ Analyzing Audio Streams ━━━');

    audioStreams.forEach((stream, index) => {
      const tags = stream.tags || {};
      const language = (tags.language || 'und').toLowerCase();
      const channels = stream.channels || 0;
      const codec = stream.codec_name || 'unknown';
      
      args.jobLog(`Stream ${index}: ${codec} (${channels}ch) - ${language}`);

      const streamInfo = {
        index: stream.index,
        streamIndex: index,
        language: language,
        channels: channels,
        codec: codec,
        stream: stream
      };

      if (language === 'eng' || language === 'en' || language === 'english') {
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

    // Skip if no English streams found
    if (analysis.englishStreams.length === 0) {
      args.jobLog('⚠️ No English audio streams found - skipping');
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 2, // Skip processing
        variables: args.variables,
      };
    }

    // Skip if only one English stream (no duplicates)
    if (analysis.englishStreams.length === 1) {
      args.jobLog('✓ Only one English audio stream - no deduplication needed');
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 2, // Skip processing
        variables: args.variables,
      };
    }

    // Multiple English streams detected - processing needed
    args.jobLog(`🔄 Multiple English streams detected (${analysis.englishStreams.length}) - deduplication needed`);
    
    // Determine streams to keep/remove
    const streamsToKeep = [];
    streamsToKeep.push(analysis.englishStreams[0]); // Keep first English stream
    streamsToKeep.push(...analysis.otherLanguageStreams); // Keep all other languages
    const streamsToRemove = analysis.englishStreams.slice(1); // Remove duplicate English streams

    args.jobLog(`✓ Keeping first English stream (index ${analysis.englishStreams[0].index})`);
    args.jobLog(`✓ Keeping ${analysis.otherLanguageStreams.length} other language streams`);
    args.jobLog(`❌ Removing ${streamsToRemove.length} duplicate English streams`);

    // Determine container type and processing method
    const inputFile = args.inputFileObj._id;
    const ext = path.extname(inputFile).toLowerCase().replace('.', '');
    const container = (args.inputFileObj.container || '').toLowerCase();
    const isMKV = ext === 'mkv' || container === 'mkv' || container === 'matroska';
    const isMP4 = ext === 'mp4' || container === 'mp4' || ext === 'm4v';

    args.jobLog(`Container: ${container}, Extension: ${ext}`);
    args.jobLog(`Processing method: ${isMKV ? 'MKVToolsNix' : 'FFmpeg'}`);

    // Helper function to resolve binary paths
    function resolveBin(candidates) {
      for (const p of candidates) {
        try { 
          if (fs.existsSync(p)) return p; 
        } catch {}
      }
      return null;
    }

    // Generate output filename
    const inputDir = path.dirname(inputFile);
    const inputName = path.basename(inputFile, path.extname(inputFile));
    const inputExt = path.extname(inputFile);
    
    // Create unique identifier for this processing session
    const inputFileHash = crypto.createHash('md5').update(inputFile).digest('hex').substring(0, 8);
    const timestamp = Date.now();
    const uniqueId = `${inputFileHash}_${timestamp}`;
    
    const outputFile = path.join(inputDir, `${inputName}_audio_dedup_${uniqueId}${inputExt}`);
    
    args.jobLog(`Output file: ${outputFile}`);

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
          '-o', outputFile,
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
            resolve({ success: true, outputFile: outputFile });
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
          outputFile
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
            resolve({ success: true, outputFile: outputFile });
          }
        });

        process.on('error', (err) => {
          clearTimeout(timeout);
          args.jobLog(`❌ Failed to start ffmpeg: ${err.message}`);
          resolve({ success: false, error: err.message });
        });
      });
    }

    // Check processing result
    if (processingResult && processingResult.success && fs.existsSync(processingResult.outputFile)) {
      const stats = fs.statSync(processingResult.outputFile);
      args.jobLog(`✓ Output file created: ${stats.size} bytes`);
      
      // Update the file object to point to the new file
      const newFileObj = { ...args.inputFileObj };
      newFileObj._id = processingResult.outputFile;
      newFileObj.file = processingResult.outputFile;
      
      // Store processing info in variables
      const newVariables = { ...args.variables };
      newVariables.audioDeduplicationApplied = true;
      newVariables.originalFile = inputFile;
      newVariables.englishStreamsRemoved = streamsToRemove.length;
      newVariables.totalStreamsKept = streamsToKeep.length;
      
      args.jobLog('🎉 Audio deduplication completed successfully!');
      
      return {
        outputFileObj: newFileObj,
        outputNumber: 1, // Success - continue to next plugin
        variables: newVariables,
      };
    } else {
      args.jobLog('❌ Processing failed');
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
