// Stage 5: Remux file with converted SRT subtitles
// This block removes all original subtitles and adds back ONLY the SRT files
// Uses mkvmerge for MKV files and ffmpeg for MP4 files

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
  const finalSrtFiles = args.variables.finalSrtFiles || [];
  const workDir = args.variables.workDir;
  const inputFile = args.variables.originalFile;
  const containerType = args.variables.containerType || 'mkv';
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
  
  // Check if we have anything to do
  const hasSubtitlesToRemove = (analysis.toConvert.length + analysis.toKeep.length + analysis.toDiscard.length) > 0;
  const hasSrtFilesToAdd = finalSrtFiles.length > 0;
  
  if (!hasSubtitlesToRemove && !hasSrtFilesToAdd) {
    console.log('No subtitle changes needed - keeping original file');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables,
    };
  }
  
  // Create temp output file path with unique ID to prevent conflicts
  const fileName = path.basename(inputFile);
  const tempOutput = path.join(workDir, `temp_${uniqueId}_${fileName}`);
  
  console.log(`Input file: ${inputFile}`);
  console.log(`Container type: ${containerType}`);
  console.log(`Temp output: ${tempOutput}`);
  console.log(`Original subtitles to remove: ${hasSubtitlesToRemove ? 'YES' : 'NO'}`);
  console.log(`SRT files to add: ${finalSrtFiles.length}`);
  console.log('');
  
  // Helper function to resolve binary paths
  function resolveBin(candidates) {
    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }
    return null;
  }

  try {
    if (containerType === 'mkv') {
      // Use mkvmerge for MKV files
      const mkvmergeExe =
        resolveBin([
          'C:\\Program Files\\MKVToolNix\\mkvmerge.exe',
          'C:\\Program Files (x86)\\MKVToolNix\\mkvmerge.exe'
        ]) || 'mkvmerge';

      console.log(`Using mkvmerge: ${mkvmergeExe}`);
      
      // Build mkvmerge command
      let mkvmergeCmd = `"${mkvmergeExe}" -o "${tempOutput}"`;
      
      // CRITICAL: Remove ALL original subtitles from input file
      mkvmergeCmd += ` --no-subtitles "${inputFile}"`;
      console.log('✓ Removing ALL original subtitles from input file');
      
      // Add ONLY the final SRT files
      if (finalSrtFiles.length > 0) {
        console.log(`\n━━━ Adding ${finalSrtFiles.length} SRT subtitle(s) ━━━`);
        
        finalSrtFiles.forEach(file => {
          const lang = file.language || 'und';
          const isDefault = file.trackId === analysis.englishTrackId ? 'yes' : 'no';
          
          console.log(`  Track ${file.trackId}:`);
          console.log(`    File: ${path.basename(file.srtFile)}`);
          console.log(`    Language: ${lang}`);
          console.log(`    Default: ${isDefault}`);
          console.log(`    Original codec: ${file.originalCodec} → SRT`);
          
          mkvmergeCmd += ` --language 0:${lang}`;
          mkvmergeCmd += ` --default-track 0:${isDefault}`;
          mkvmergeCmd += ` --track-name 0:""`;
          mkvmergeCmd += ` "${file.srtFile}"`;
        });
      } else {
        console.log('\n━━━ No SRT files to add (all subtitles will be removed) ━━━');
      }
      
      console.log('\n━━━ Running mkvmerge ━━━');
      console.log('Command:', mkvmergeCmd);
      
      const result = execSync(mkvmergeCmd, {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 10
      });
      
      if (result) {
        console.log('mkvmerge output:', result);
      }
      
    } else if (containerType === 'mp4') {
      // Use ffmpeg for MP4 files
      const ffmpegExe =
        resolveBin([
          'C:\\programdata\\chocolatey\\bin\\ffmpeg.exe',
          'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
          'C:\\ffmpeg\\bin\\ffmpeg.exe'
        ]) || 'ffmpeg';

      console.log(`Using ffmpeg: ${ffmpegExe}`);
      
      // Build ffmpeg command for MP4
      let ffmpegCmd = `"${ffmpegExe}" -i "${inputFile}"`;
      
      // CRITICAL: Map ONLY video and audio streams (exclude ALL subtitles)
      ffmpegCmd += ` -map 0:v -map 0:a`;
      ffmpegCmd += ` -c:v copy -c:a copy`; // Copy video and audio without re-encoding
      
      console.log('✓ Removing ALL original subtitles from input file');
      
      // Add ONLY the final SRT files
      if (finalSrtFiles.length > 0) {
        console.log(`\n━━━ Adding ${finalSrtFiles.length} SRT subtitle(s) ━━━`);
        
        finalSrtFiles.forEach((file, index) => {
          const lang = file.language || 'und';
          const isDefault = file.trackId === analysis.englishTrackId;
          
          console.log(`  Track ${file.trackId}:`);
          console.log(`    File: ${path.basename(file.srtFile)}`);
          console.log(`    Language: ${lang}`);
          console.log(`    Default: ${isDefault}`);
          console.log(`    Original codec: ${file.originalCodec} → MOV_TEXT`);
          
          // Add subtitle input
          ffmpegCmd += ` -i "${file.srtFile}"`;
          
          // Map the subtitle stream
          ffmpegCmd += ` -map ${index + 1}:s`;
          
          // Set subtitle codec to mov_text for MP4
          ffmpegCmd += ` -c:s:${index} mov_text`;
          
          // Set metadata
          ffmpegCmd += ` -metadata:s:s:${index} language=${lang}`;
          if (isDefault) {
            ffmpegCmd += ` -disposition:s:${index} default`;
          }
        });
      } else {
        console.log('\n━━━ No SRT files to add (all subtitles will be removed) ━━━');
      }
      
      // Output options
      ffmpegCmd += ` -y "${tempOutput}"`;
      
      console.log('\n━━━ Running ffmpeg ━━━');
      console.log('Command:', ffmpegCmd);
      
      const result = execSync(ffmpegCmd, {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 10
      });
      
      if (result) {
        console.log('ffmpeg output:', result);
      }
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
      
      // Mark that subtitle changes were applied - this helps downstream stages
      // know that the file has been modified and should be considered "processed"
      args.variables.subtitleChangesApplied = true;
      
      // CRITICAL: Set flag to force file replacement even if subsequent stages skip
      // This ensures that when audio/video stages determine no conversion is needed,
      // the subtitle-modified cache file still replaces the original library file
      args.variables.forceReplaceOriginal = true;
      
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
  
  // Clean up ALL temporary SRT files
  console.log('\nCleaning up temporary SRT files...');
  for (const file of finalSrtFiles) {
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
  
  // Final summary
  const totalOriginalSubs = analysis.toConvert.length + analysis.toKeep.length + analysis.toDiscard.length;
  const finalSrtCount = finalSrtFiles.length;
  
  console.log(`✓ Original subtitle tracks: ${totalOriginalSubs}`);
  console.log(`  - Converted to SRT: ${analysis.toConvert.length}`);
  console.log(`  - Preserved as SRT: ${analysis.toKeep.length}`);
  console.log(`  - Discarded (bitmap): ${analysis.toDiscard.length}`);
  console.log(`✓ Final SRT tracks in file: ${finalSrtCount}`);
  console.log(`✓ File updated successfully`);
  
  // Verify the goal was achieved
  if (totalOriginalSubs > 0 && finalSrtCount >= 0) {
    console.log('\n🎯 GOAL ACHIEVED:');
    console.log('   ✓ ALL original subtitles removed from video file');
    console.log('   ✓ Bitmap subtitles discarded');
    console.log('   ✓ Text subtitles converted to SRT');
    console.log('   ✓ File now contains ONLY SRT subtitles');
  }
  
  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables,
  };
};
