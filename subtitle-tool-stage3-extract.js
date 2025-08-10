// Stage 3: Extract ALL subtitle tracks (for conversion, preservation, or analysis)
// This block uses mkvextract for MKV or ffmpeg for MP4

module.exports = async (args) => {
  const path = require('path');
  const { spawn } = require('child_process');
  const fs = require('fs');
  
  console.log('═══════════════════════════════════════');
  console.log('   STAGE 3: EXTRACT ALL SUBTITLES');
  console.log('═══════════════════════════════════════');
  
  // Check if we should skip
  if (args.variables.skipProcessing || !args.variables.needsProcessing) {
    console.log('⚠️ Skipping extraction - no processing needed');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables,
    };
  }
  
  const analysis = args.variables.subtitleAnalysis;
  const inputFile = args.variables.originalFile;
  
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
  args.variables.extractedFiles = [];
  args.variables.workDir = workDir;
  args.variables.uniqueId = uniqueId;
  
  // Extract ALL subtitle tracks (convert + keep + discard for analysis)
  const allSubtitleTracks = [
    ...analysis.toConvert,
    ...analysis.toKeep,
    ...analysis.toDiscard
  ];
  
  if (allSubtitleTracks.length === 0) {
    console.log('No subtitle tracks found');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables,
    };
  }
  
  const containerType = args.variables.containerType || 'mkv';
  console.log(`Container type: ${containerType}`);
  console.log(`Extracting ${allSubtitleTracks.length} subtitle tracks:\n`);
  
  // Helper function to resolve binary paths
  function resolveBin(candidates) {
    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }
    return null;
  }
  
  // Extract each track individually
  for (const track of allSubtitleTracks) {
    // Determine file extension based on format/codec
    let extension = 'sub';
    let trackType = 'convert'; // default
    
    // Determine track type and extension
    if (analysis.toKeep.find(t => t.id === track.id)) {
      trackType = 'keep';
      extension = 'srt'; // Already SRT
    } else if (analysis.toDiscard.find(t => t.id === track.id)) {
      trackType = 'discard';
      extension = 'sup'; // Bitmap subtitle
    } else {
      // Must be in toConvert
      trackType = 'convert';
      if (track.format === 'ass' || track.format === 'ssa') {
        extension = 'ass';
      } else if (track.format === 'webvtt') {
        extension = 'vtt';
      } else if (track.format === 'mov_text') {
        extension = 'txt';
      }
    }
    
    const outputFile = path.join(workDir, `subtitle_${uniqueId}_${track.id}.${extension}`);
    
    console.log(`Extracting Track ${track.id}:`);
    console.log(`  Type: ${trackType}`);
    console.log(`  Format: ${track.format || track.codec}`);
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
        
        // For MP4, we need to map by absolute stream index, not subtitle-relative index
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
      
      // Store info for conversion/mux stages
      args.variables.extractedFiles.push({
        trackId: track.id,
        inputFile: outputFile,
        format: track.format || track.codec,
        language: track.language,
        codec: track.codec,
        trackType: trackType, // 'convert', 'keep', or 'discard'
        extension: extension
      });
    } else {
      console.log(`  ❌ Extraction failed`);
      
      // For bitmap subtitles, extraction failure is expected and OK
      if (trackType === 'discard') {
        console.log(`  → This is expected for bitmap subtitles`);
      }
    }
    
    console.log('');
  }
  
  // Summary
  console.log('━━━ Extraction Summary ━━━');
  const extracted = args.variables.extractedFiles;
  const convertCount = extracted.filter(f => f.trackType === 'convert').length;
  const keepCount = extracted.filter(f => f.trackType === 'keep').length;
  const discardCount = extracted.filter(f => f.trackType === 'discard').length;
  
  console.log(`✓ Successfully extracted: ${extracted.length}/${allSubtitleTracks.length} tracks`);
  console.log(`  - To convert: ${convertCount}`);
  console.log(`  - To keep (SRT): ${keepCount}`);
  console.log(`  - Discarded (bitmap): ${discardCount}`);
  
  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables,
  };
};
