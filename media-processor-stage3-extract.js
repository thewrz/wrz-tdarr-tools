// Stage 3: Unified Stream Extraction
// Extracts only the streams we need: first video track, cleaned audio tracks, and English subtitles for conversion
module.exports = async (args) => {
  const path = require('path');
  const { spawn } = require('child_process');
  const fs = require('fs');
  
  console.log('═══════════════════════════════════════');
  console.log('   STAGE 3: UNIFIED STREAM EXTRACTION');
  console.log('═══════════════════════════════════════');
  
  // Check if we should skip
  if (args.variables.skipProcessing) {
    console.log('⚠️ Skipping extraction - no processing needed');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables,
    };
  }
  
  const analysis = args.variables.mediaAnalysis;
  const inputFile = args.variables.originalFile;
  const containerType = args.variables.containerType || 'mkv';
  
  // Determine working directory - use the cache directory from library settings
  let workDir = 'Y:/cache'; // Default from your log
  
  // Try to get from library settings first
  if (args.librarySettings && args.librarySettings.cache) {
    workDir = args.librarySettings.cache;
  }
  
  // Fix malformed cache paths (like 'Y:Y:/cache' -> 'Y:/cache')
  if (workDir.includes('Y:Y:/')) {
    workDir = workDir.replace('Y:Y:/', 'Y:/');
    console.log(`Fixed malformed cache path to: ${workDir}`);
  }
  
  // Ensure working directory exists
  try {
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
      console.log(`Created working directory: ${workDir}`);
    }
  } catch (error) {
    console.error(`❌ Failed to create working directory: ${error.message}`);
    args.variables.skipProcessing = true;
    args.variables.error = `Failed to create working directory: ${error.message}`;
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables,
    };
  }
  
  console.log(`Working directory: ${workDir}`);
  
  // Create unique identifier for this processing session to avoid conflicts
  const crypto = require('crypto');
  const inputFileHash = crypto.createHash('md5').update(inputFile).digest('hex').substring(0, 8);
  const processId = process.pid;
  const timestamp = Date.now();
  const uniqueId = `${inputFileHash}_${processId}_${timestamp}`;
  
  console.log(`Unique processing ID: ${uniqueId}`);
  
  // Store extraction info for next stages
  args.variables.extractedSubtitles = [];
  args.variables.workDir = workDir;
  args.variables.uniqueId = uniqueId;
  
  // Helper function to resolve binary paths
  function resolveBin(candidates) {
    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }
    return null;
  }
  
  // Only extract subtitles that need conversion (not bitmap or already SRT)
  const subtitlesToExtract = (analysis && analysis.subtitles && analysis.subtitles.toConvert) || [];
  
  if (subtitlesToExtract.length === 0) {
    console.log('No subtitles need extraction for conversion');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables,
    };
  }
  
  console.log(`Container type: ${containerType}`);
  console.log(`Extracting ${subtitlesToExtract.length} subtitle tracks for conversion:\n`);
  
  // Extract each subtitle track that needs conversion
  for (const track of subtitlesToExtract) {
    // Determine file extension based on format/codec
    let extension = 'sub';
    
    if (track.format === 'ass' || track.format === 'ssa') {
      extension = 'ass';
    } else if (track.format === 'webvtt') {
      extension = 'vtt';
    } else if (track.format === 'mov_text') {
      extension = 'txt';
    }
    
    const outputFile = path.join(workDir, `subtitle_${uniqueId}_${track.id}.${extension}`);
    
    console.log(`Extracting Track ${track.id}:`);
    console.log(`  Format: ${track.format || track.codec}`);
    console.log(`  Language: ${track.language || 'undefined'}`);
    console.log(`  Output: ${path.basename(outputFile)}`);
    
    let extractResult;
    
    if (containerType === 'mkv') {
      // Use mkvextract for MKV files
      extractResult = await new Promise((resolve) => {
        const args = [
          'tracks',
          inputFile,
          `${track.id}:${outputFile}`
        ];
        
        console.log(`  Command: mkvextract ${args.join(' ')}`);
        
        const mkvextractPath = resolveBin([
          'C:\\Program Files\\MKVToolNix\\mkvextract.exe',
          'C:\\Program Files (x86)\\MKVToolNix\\mkvextract.exe',
          'mkvextract'
        ]);
        
        if (mkvextractPath !== 'mkvextract') {
          console.log(`  Found mkvextract at: ${mkvextractPath}`);
        }
        
        const extractProcess = spawn(mkvextractPath, args);
        
        let stdoutData = '';
        let stderrData = '';
        let timedOut = false;
        
        const timeout = setTimeout(() => {
          timedOut = true;
          console.log('  ⚠️ Extraction taking too long, killing process...');
          extractProcess.kill('SIGTERM');
        }, 60000);
        
        extractProcess.stdout.on('data', (data) => {
          stdoutData += data.toString();
        });
        
        extractProcess.stderr.on('data', (data) => {
          stderrData += data.toString();
          const progress = data.toString().trim();
          if (progress.includes('Progress:') || progress.includes('%')) {
            process.stdout.write(`\r  ${progress}`);
          }
        });
        
        extractProcess.on('close', (code) => {
          clearTimeout(timeout);
          console.log('');
          
          if (timedOut) {
            console.log(`  ❌ Extraction timed out`);
            resolve({ success: false, error: 'timeout' });
          } else if (code !== 0) {
            console.log(`  ❌ mkvextract exited with code ${code}`);
            if (stderrData) {
              console.log(`  Error: ${stderrData}`);
            }
            resolve({ success: false, error: stderrData });
          } else {
            resolve({ success: true });
          }
        });
        
        extractProcess.on('error', (err) => {
          clearTimeout(timeout);
          console.log(`  ❌ Failed to start mkvextract: ${err.message}`);
          resolve({ success: false, error: err.message });
        });
      });
      
    } else if (containerType === 'mp4') {
      // Use ffmpeg for MP4 files
      extractResult = await new Promise((resolve) => {
        const ffmpegPath = resolveBin([
          'C:\\programdata\\chocolatey\\bin\\ffmpeg.exe',
          'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
          'C:\\ffmpeg\\bin\\ffmpeg.exe',
          'ffmpeg'
        ]);
        
        if (ffmpegPath !== 'ffmpeg') {
          console.log(`  Found ffmpeg at: ${ffmpegPath}`);
        }
        
        // For MP4, we need to map by absolute stream index
        const args = [
          '-i', inputFile,
          '-map', `0:${track.id}`,    // Map stream by absolute index
          '-c:s', 'copy',             // Copy subtitle codec
          '-y',                       // Overwrite output
          outputFile
        ];
        
        console.log(`  Command: ffmpeg ${args.join(' ')}`);
        
        const extractProcess = spawn(ffmpegPath, args);
        
        let stdoutData = '';
        let stderrData = '';
        let timedOut = false;
        
        const timeout = setTimeout(() => {
          timedOut = true;
          console.log('  ⚠️ Extraction taking too long, killing process...');
          extractProcess.kill('SIGTERM');
        }, 60000);
        
        extractProcess.stdout.on('data', (data) => {
          stdoutData += data.toString();
        });
        
        extractProcess.stderr.on('data', (data) => {
          stderrData += data.toString();
          // ffmpeg outputs progress to stderr
          const progress = data.toString().trim();
          if (progress.includes('time=') || progress.includes('frame=')) {
            process.stdout.write(`\r  ${progress.split('\n').pop()}`);
          }
        });
        
        extractProcess.on('close', (code) => {
          clearTimeout(timeout);
          console.log('');
          
          if (timedOut) {
            console.log(`  ❌ Extraction timed out`);
            resolve({ success: false, error: 'timeout' });
          } else if (code !== 0) {
            console.log(`  ❌ ffmpeg exited with code ${code}`);
            if (stderrData) {
              console.log(`  Error: ${stderrData}`);
            }
            resolve({ success: false, error: stderrData });
          } else {
            resolve({ success: true });
          }
        });
        
        extractProcess.on('error', (err) => {
          clearTimeout(timeout);
          console.log(`  ❌ Failed to start ffmpeg: ${err.message}`);
          resolve({ success: false, error: err.message });
        });
      });
    }
    
    // Check if extraction succeeded
    if (extractResult && extractResult.success && fs.existsSync(outputFile)) {
      const stats = fs.statSync(outputFile);
      console.log(`  ✓ Extracted successfully: ${stats.size} bytes`);
      
      // Store info for conversion stage
      args.variables.extractedSubtitles.push({
        trackId: track.id,
        inputFile: outputFile,
        format: track.format || track.codec,
        language: track.language,
        codec: track.codec,
        extension: extension
      });
    } else {
      console.log(`  ❌ Extraction failed`);
    }
    
    console.log('');
  }
  
  // Summary
  console.log('━━━ Extraction Summary ━━━');
  const extracted = args.variables.extractedSubtitles;
  
  console.log(`✓ Successfully extracted: ${extracted.length}/${subtitlesToExtract.length} subtitle tracks for conversion`);
  
  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables,
  };
};
