// Stage 4: Convert extracted subtitles to SRT format
// This block uses FFmpeg to convert various subtitle formats to SRT

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
  
  if (extractedFiles.length === 0) {
    console.log('No files to convert');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables,
    };
  }
  
  // Store converted files info
  args.variables.convertedFiles = [];
  
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
  console.log(`Converting ${extractedFiles.length} subtitle files:\n`);
  
  for (const file of extractedFiles) {
    const outputFile = path.join(workDir, `subtitle_${file.trackId}.srt`);
    
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
        args.variables.convertedFiles.push({
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
  
  console.log(`━━━ Conversion Summary ━━━`);
  console.log(`✓ Successfully converted: ${args.variables.convertedFiles.length}/${extractedFiles.length} files`);
  
  // Clean up extracted files that are no longer needed
  console.log('\nCleaning up extracted files...');
  for (const file of extractedFiles) {
    try {
      if (fs.existsSync(file.inputFile)) {
        fs.unlinkSync(file.inputFile);
        console.log(`  Deleted: ${path.basename(file.inputFile)}`);
      }
    } catch (error) {
      console.log(`  Could not delete: ${path.basename(file.inputFile)}`);
    }
  }
  
  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables,
  };
};
