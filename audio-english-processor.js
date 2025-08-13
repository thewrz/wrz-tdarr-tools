// Audio English Processor - Processes files to remove duplicate English audio streams
// Uses MKVToolsNix for MKV files, FFmpeg for MP4 and other formats

module.exports = async (args) => {
  const fs = require('fs');
  const path = require('path');
  const { spawn } = require('child_process');
  const crypto = require('crypto');

  console.log('═══════════════════════════════════════');
  console.log('   AUDIO ENGLISH PROCESSOR');
  console.log('═══════════════════════════════════════');

  // Check if we should skip processing
  if (args.variables.skipProcessing || !args.variables.needsProcessing) {
    console.log('⚠️ Skipping processing - no changes needed');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2, // Skip
      variables: args.variables,
      processFile: false
    };
  }

  const analysis = args.variables.audioAnalysis;
  const inputFile = args.variables.originalFile;
  const containerType = args.variables.containerType;
  const preferredTool = args.variables.preferredTool;

  if (!analysis || !analysis.streamsToKeep) {
    console.log('❌ No audio analysis data found - skipping');
    args.variables.skipProcessing = true;
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2, // Skip
      variables: args.variables,
      processFile: false
    };
  }

  console.log(`Input file: ${inputFile}`);
  console.log(`Container: ${containerType}`);
  console.log(`Preferred tool: ${preferredTool}`);
  console.log(`Streams to keep: ${analysis.streamsToKeep.length}`);
  console.log(`Streams to remove: ${analysis.streamsToRemove.length}`);

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
  
  const outputFile = path.join(inputDir, `${inputName}_audio_processed_${uniqueId}${inputExt}`);
  
  console.log(`Output file: ${outputFile}`);

  let processingResult;

  if (preferredTool === 'mkvtoolnix' && containerType === 'mkv') {
    // Use MKVToolsNix for MKV files
    console.log('\n━━━ Using MKVToolsNix (mkvmerge) ━━━');
    
    const mkvmergePath = resolveBin([
      'C:\\Program Files\\MKVToolNix\\mkvmerge.exe',
      'C:\\Program Files (x86)\\MKVToolNix\\mkvmerge.exe',
      'mkvmerge'
    ]);

    if (!mkvmergePath) {
      console.log('❌ mkvmerge not found - falling back to FFmpeg');
      processingResult = await processWithFFmpeg();
    } else {
      console.log(`Found mkvmerge at: ${mkvmergePath !== 'mkvmerge' ? mkvmergePath : 'PATH'}`);
      
      // Test if mkvmerge is accessible
      try {
        const { execFileSync } = require('child_process');
        execFileSync(mkvmergePath, ['--version'], { encoding: 'utf8', timeout: 10000 });
        console.log('✓ mkvmerge is accessible');
        processingResult = await processWithMKVToolsNix(mkvmergePath);
      } catch (testError) {
        console.log(`❌ mkvmerge test failed: ${testError.message}`);
        console.log('Falling back to FFmpeg');
        processingResult = await processWithFFmpeg();
      }
    }
  } else {
    // Use FFmpeg for MP4 and other formats
    console.log('\n━━━ Using FFmpeg ━━━');
    processingResult = await processWithFFmpeg();
  }

  async function processWithMKVToolsNix(mkvmergePath) {
    return new Promise((resolve) => {
      // Build audio track selection
      const audioTracks = analysis.streamsToKeep
        .map(stream => stream.streamIndex)
        .join(',');

      const args = [
        '-o', outputFile,
        '--audio-tracks', audioTracks,
        '--video-tracks', 'all',
        '--subtitle-tracks', 'all',
        '--chapters', 'all',
        '--attachments', 'all',
        inputFile
      ];

      console.log(`Command: mkvmerge ${args.join(' ')}`);

      const process = spawn(mkvmergePath, args);
      
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
        const progress = data.toString().trim();
        if (progress.includes('Progress:') || progress.includes('%')) {
          process.stdout.write(`\r${progress}`);
        }
      });

      process.stderr.on('data', (data) => {
        stderrData += data.toString();
        const progress = data.toString().trim();
        if (progress.includes('Progress:') || progress.includes('%')) {
          process.stdout.write(`\r${progress}`);
        }
      });

      process.on('close', (code) => {
        clearTimeout(timeout);
        console.log('');

        if (timedOut) {
          console.log('❌ Processing timed out');
          resolve({ success: false, error: 'timeout' });
        } else if (code !== 0) {
          console.log(`❌ mkvmerge exited with code ${code}`);
          if (stderrData) {
            console.log(`Error: ${stderrData}`);
          }
          resolve({ success: false, error: stderrData });
        } else {
          console.log('✓ Processing completed successfully');
          resolve({ success: true, outputFile: outputFile });
        }
      });

      process.on('error', (err) => {
        clearTimeout(timeout);
        console.log(`❌ Failed to start mkvmerge: ${err.message}`);
        resolve({ success: false, error: err.message });
      });
    });
  }

  async function processWithFFmpeg() {
    return new Promise((resolve) => {
      const ffmpegPath = resolveBin([
        'C:\\programdata\\chocolatey\\bin\\ffmpeg.exe',
        'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
        'ffmpeg'
      ]);

      if (!ffmpegPath) {
        console.log('❌ ffmpeg not found');
        resolve({ success: false, error: 'ffmpeg not found' });
        return;
      }

      console.log(`Found ffmpeg at: ${ffmpegPath !== 'ffmpeg' ? ffmpegPath : 'PATH'}`);

      // Build stream mapping
      const mapArgs = [];
      
      // Map video streams (copy all)
      mapArgs.push('-map', '0:v');
      
      // Map selected audio streams
      analysis.streamsToKeep.forEach((stream) => {
        mapArgs.push('-map', `0:a:${stream.streamIndex}`);
      });
      
      // Map subtitle streams (copy all)
      mapArgs.push('-map', '0:s?');

      const args = [
        '-i', inputFile,
        ...mapArgs,
        '-c', 'copy', // Copy all streams without re-encoding
        '-y', // Overwrite output file
        outputFile
      ];

      console.log(`Command: ffmpeg ${args.join(' ')}`);

      const process = spawn(ffmpegPath, args);
      
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
        const progress = data.toString().trim();
        if (progress.includes('time=') || progress.includes('frame=')) {
          const lines = progress.split('\n');
          const lastLine = lines[lines.length - 1] || lines[lines.length - 2];
          if (lastLine && lastLine.trim()) {
            process.stdout.write(`\r${lastLine.trim()}`);
          }
        }
      });

      process.on('close', (code) => {
        clearTimeout(timeout);
        console.log('');

        if (timedOut) {
          console.log('❌ Processing timed out');
          resolve({ success: false, error: 'timeout' });
        } else if (code !== 0) {
          console.log(`❌ ffmpeg exited with code ${code}`);
          if (stderrData) {
            console.log(`Error: ${stderrData}`);
          }
          resolve({ success: false, error: stderrData });
        } else {
          console.log('✓ Processing completed successfully');
          resolve({ success: true, outputFile: outputFile });
        }
      });

      process.on('error', (err) => {
        clearTimeout(timeout);
        console.log(`❌ Failed to start ffmpeg: ${err.message}`);
        resolve({ success: false, error: err.message });
      });
    });
  }

  // Check processing result
  if (processingResult && processingResult.success && fs.existsSync(processingResult.outputFile)) {
    const stats = fs.statSync(processingResult.outputFile);
    console.log(`✓ Output file created: ${stats.size} bytes`);
    
    // Update the file object to point to the new file
    args.inputFileObj.path = processingResult.outputFile;
    args.inputFileObj._id = processingResult.outputFile;
    
    // Store processing info
    args.variables.processedFile = processingResult.outputFile;
    args.variables.originalFile = inputFile;
    args.variables.processingSuccess = true;
    
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1, // Success
      variables: args.variables,
      processFile: true
    };
  } else {
    console.log('❌ Processing failed');
    args.variables.processingSuccess = false;
    args.variables.error = processingResult ? processingResult.error : 'Unknown error';
    
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 3, // Error
      variables: args.variables,
      processFile: false
    };
  }
};
