// Stage 5: Remux file with converted SRT subtitles
// This block removes all original subtitles and adds back the converted SRT files

module.exports = async (args) => {
  const path = require('path');
  const { execSync } = require('child_process');
  const fs = require('fs');
  
  console.log('═══════════════════════════════════════');
  console.log('   STAGE 5: REMUX WITH SRT SUBTITLES');
  console.log('═══════════════════════════════════════');
  
  // Check if we should skip
  if (args.variables.skipProcessing) {
    console.log('⚠️ Skipping remux');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables,
    };
  }
  
  const analysis = args.variables.subtitleAnalysis;
  const convertedFiles = args.variables.convertedFiles || [];
  const workDir = args.variables.workDir;
  const inputFile = args.variables.originalFile;
  
  // Check if we have anything to do
  const hasConversions = convertedFiles.length > 0;
  const hasDiscards = analysis.toDiscard.length > 0;
  
  if (!hasConversions && !hasDiscards) {
    console.log('No changes needed - keeping original file');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables,
    };
  }
  
  // Create temp output file path
  const fileName = path.basename(inputFile);
  const tempOutput = path.join(workDir, `temp_${fileName}`);
  
  console.log(`Input file: ${inputFile}`);
  console.log(`Temp output: ${tempOutput}`);
  console.log('');
  
  // Find mkvmerge executable
  function resolveBin(candidates) {
    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }
    return null;
  }

  const mkvmergeExe =
    resolveBin([
      'C:\\Program Files\\MKVToolNix\\mkvmerge.exe',
      'C:\\Program Files (x86)\\MKVToolNix\\mkvmerge.exe'
    ]) || 'mkvmerge'; // last resort: PATH

  console.log(`Using mkvmerge: ${mkvmergeExe}`);
  
  // Build mkvmerge command
  let mkvmergeCmd = `"${mkvmergeExe}" -o "${tempOutput}"`;
  
  // Add input file without subtitles
  mkvmergeCmd += ` --no-subtitles "${inputFile}"`;
  console.log('Removing all original subtitles');
  
  // Add converted SRT files
  if (convertedFiles.length > 0) {
    console.log(`\nAdding ${convertedFiles.length} converted subtitle(s):`);
    
    convertedFiles.forEach(file => {
      const lang = file.language || 'und';
      const isDefault = file.trackId === analysis.englishTrackId ? 'yes' : 'no';
      
      console.log(`  Track ${file.trackId}:`);
      console.log(`    File: ${path.basename(file.srtFile)}`);
      console.log(`    Language: ${lang}`);
      console.log(`    Default: ${isDefault}`);
      
      mkvmergeCmd += ` --language 0:${lang}`;
      mkvmergeCmd += ` --default-track 0:${isDefault}`;
      mkvmergeCmd += ` --track-name 0:""`;
      mkvmergeCmd += ` "${file.srtFile}"`;
    });
  }
  
  try {
    console.log('\n━━━ Running mkvmerge ━━━');
    console.log('Command:', mkvmergeCmd);
    
    const result = execSync(mkvmergeCmd, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10
    });
    
    if (result) {
      console.log('mkvmerge output:', result);
    }
    
    // Verify output file exists
    if (fs.existsSync(tempOutput)) {
      const inputStats = fs.statSync(inputFile);
      const outputStats = fs.statSync(tempOutput);
      
      console.log('\n✓ Remux complete');
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
        
        // If copy failed, don't delete the original file
        // The temp file still exists in cache, so we can recover
        throw new Error(`Failed to replace original file: ${copyError.message}`);
      }
      
      // Update file object to reflect changes
      args.inputFileObj.file_size = outputStats.size / 1024 / 1024; // Convert to MB
      
    } else {
      throw new Error('Output file was not created');
    }
    
  } catch (error) {
    console.error('❌ Error during remux:', error.message);
    
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
    
    // Don't continue processing if remux failed
    args.variables.skipProcessing = true;
    
    // Return error to stop the flow
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2, // Route to error/skip output
      variables: args.variables,
      processFile: false
    };
  }
  
  // Clean up converted SRT files
  console.log('\nCleaning up temporary files...');
  for (const file of convertedFiles) {
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
  console.log('   SUBTITLE PROCESSING COMPLETE');
  console.log('═══════════════════════════════════════');
  console.log(`✓ Converted: ${convertedFiles.length} subtitle(s)`);
  console.log(`✓ Discarded: ${analysis.toDiscard.length} bitmap subtitle(s)`);
  console.log(`✓ File updated successfully`);
  
  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables,
  };
};
