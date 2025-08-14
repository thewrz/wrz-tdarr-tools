// Stage 4: Convert extracted subtitles to SRT format
// This block uses FFmpeg to convert various subtitle formats to SRT
// Now handles both conversion and preservation of existing SRT files

module.exports = async (args) => {
  const path = require('path');
  const { execSync } = require('child_process');
  const fs = require('fs');
  
  console.log('═══════════════════════════════════════');
  console.log('   STAGE 4: CONVERT TO SRT');
  console.log('═══════════════════════════════════════');
  
  // Check if we should skip
  if (args.variables.skipProcessing) {
    console.log('⚠️ Skipping conversion');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables,
    };
  }
  
  const extractedFiles = args.variables.extractedFiles || [];
  const workDir = args.variables.workDir;
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
  
  if (extractedFiles.length === 0) {
    console.log('No files to process');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables,
    };
  }
  
  // Store final SRT files info for muxing stage
  args.variables.finalSrtFiles = [];
  
  // Find FFmpeg executable
  function resolveBin(candidates) {
    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }
    return null;
  }

  const ffmpegExe =
    resolveBin([
      'C:\\programdata\\chocolatey\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\ffmpeg\\bin\\ffmpeg.exe'
    ]) || 'ffmpeg'; // last resort: PATH

  console.log(`Using FFmpeg: ${ffmpegExe}`);
  
  // Separate files by type
  const toConvert = extractedFiles.filter(f => f.trackType === 'convert');
  const toKeep = extractedFiles.filter(f => f.trackType === 'keep');
  const toDiscard = extractedFiles.filter(f => f.trackType === 'discard');
  
  console.log(`Files to convert: ${toConvert.length}`);
  console.log(`Files to keep (already SRT): ${toKeep.length}`);
  console.log(`Files to discard (bitmap): ${toDiscard.length}\n`);
  
  // Process files that need conversion
  if (toConvert.length > 0) {
    console.log('━━━ Converting subtitle files ━━━');
    
    for (const file of toConvert) {
      const outputFile = path.join(workDir, `subtitle_${uniqueId}_${file.trackId}.srt`);
      
      console.log(`Track ${file.trackId} (${file.format}):`);
      console.log(`  Input: ${path.basename(file.inputFile)}`);
      console.log(`  Output: ${path.basename(outputFile)}`);
      
      try {
        let ffmpegCmd = '';
        
        // Build FFmpeg command based on format
        switch(file.format) {
          case 'ass':
          case 'ssa':
            // ASS/SSA to SRT
            ffmpegCmd = `"${ffmpegExe}" -i "${file.inputFile}" -c:s srt "${outputFile}" -y`;
            console.log(`  Method: ASS/SSA to SRT`);
            break;
            
          case 'webvtt':
            // WebVTT to SRT
            ffmpegCmd = `"${ffmpegExe}" -i "${file.inputFile}" -c:s srt "${outputFile}" -y`;
            console.log(`  Method: WebVTT to SRT`);
            break;
            
          case 'mov_text':
            // MOV_TEXT to SRT
            ffmpegCmd = `"${ffmpegExe}" -i "${file.inputFile}" -c:s srt "${outputFile}" -y`;
            console.log(`  Method: MOV_TEXT to SRT`);
            break;
            
          default:
            // Generic conversion
            ffmpegCmd = `"${ffmpegExe}" -i "${file.inputFile}" -c:s srt "${outputFile}" -y`;
            console.log(`  Method: Generic to SRT`);
        }
        
        console.log(`  Running: ${ffmpegCmd}`);
        
        // Execute conversion with timeout and better error handling
        const result = execSync(ffmpegCmd, {
          encoding: 'utf8',
          maxBuffer: 1024 * 1024 * 10,
          timeout: 120000 // 2 minute timeout
        });
        
        // Verify output file exists
        if (fs.existsSync(outputFile)) {
          const stats = fs.statSync(outputFile);
          console.log(`  ✓ Converted successfully: ${stats.size} bytes`);
          
          // Store info for muxing stage
          args.variables.finalSrtFiles.push({
            trackId: file.trackId,
            srtFile: outputFile,
            language: file.language,
            originalCodec: file.codec
          });
        } else {
          console.log(`  ❌ Conversion failed - output file not created`);
        }
        
      } catch (error) {
        console.error(`  ❌ Error converting track ${file.trackId}:`, error.message);
        // Continue with other files even if one fails
      }
      
      console.log('');
    }
  }
  
  // Process files that are already SRT (just rename/copy them)
  if (toKeep.length > 0) {
    console.log('━━━ Processing existing SRT files ━━━');
    
    for (const file of toKeep) {
      const outputFile = path.join(workDir, `subtitle_${uniqueId}_${file.trackId}.srt`);
      
      console.log(`Track ${file.trackId} (already SRT):`);
      console.log(`  Input: ${path.basename(file.inputFile)}`);
      console.log(`  Output: ${path.basename(outputFile)}`);
      
      try {
        // Copy the existing SRT file to the standardized name
        fs.copyFileSync(file.inputFile, outputFile);
        
        const stats = fs.statSync(outputFile);
        console.log(`  ✓ Copied successfully: ${stats.size} bytes`);
        
        // Store info for muxing stage
        args.variables.finalSrtFiles.push({
          trackId: file.trackId,
          srtFile: outputFile,
          language: file.language,
          originalCodec: file.codec
        });
        
      } catch (error) {
        console.error(`  ❌ Error copying track ${file.trackId}:`, error.message);
      }
      
      console.log('');
    }
  }
  
  // Note about discarded files
  if (toDiscard.length > 0) {
    console.log('━━━ Bitmap subtitles (discarded) ━━━');
    for (const file of toDiscard) {
      console.log(`Track ${file.trackId}: ${file.codec} (bitmap - will be removed)`);
    }
    console.log('');
  }
  
  console.log(`━━━ Conversion Summary ━━━`);
  console.log(`✓ Successfully processed: ${args.variables.finalSrtFiles.length} SRT files`);
  console.log(`  - Converted: ${toConvert.length}`);
  console.log(`  - Preserved: ${toKeep.length}`);
  console.log(`  - Discarded: ${toDiscard.length}`);
  
  // Clean up original extracted files that are no longer needed
  console.log('\nCleaning up original extracted files...');
  for (const file of extractedFiles) {
    // Only delete if we successfully created an SRT version
    const hasSuccessfulSrt = args.variables.finalSrtFiles.some(srt => srt.trackId === file.trackId);
    
    if (hasSuccessfulSrt || file.trackType === 'discard') {
      try {
        if (fs.existsSync(file.inputFile)) {
          fs.unlinkSync(file.inputFile);
          console.log(`  Deleted: ${path.basename(file.inputFile)}`);
        }
      } catch (error) {
        console.log(`  Could not delete: ${path.basename(file.inputFile)}`);
      }
    }
  }
  
  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables,
  };
};
