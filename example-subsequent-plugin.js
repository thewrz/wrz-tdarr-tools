// Example: How to check for remuxed files in subsequent flow plugins
// This shows how to detect when smart-media-preprocessor has processed a file
// and ensure it gets replaced even when other conditions are met

module.exports = (args) => {
  args.jobLog('=== CHECKING FOR PREPROCESSED FILES ===');

  // Check if file was preprocessed and needs replacement
  const wasRemuxed = args.variables.remuxed === true;
  const requiresReplacement = args.variables.requiresReplacement === true;
  const wasPreprocessed = args.variables.preprocessed === true;
  const forceProcess = args.variables.processFile === true;

  args.jobLog(`Variables check:`);
  args.jobLog(`  remuxed: ${wasRemuxed}`);
  args.jobLog(`  requiresReplacement: ${requiresReplacement}`);
  args.jobLog(`  preprocessed: ${wasPreprocessed}`);
  args.jobLog(`  processFile: ${forceProcess}`);

  // If any of these flags are set, force processing
  if (wasRemuxed || requiresReplacement || wasPreprocessed || forceProcess) {
    args.jobLog('🚨 File was preprocessed - FORCING REPLACEMENT regardless of other conditions');
    
    if (args.variables.streamsRemoved > 0) {
      args.jobLog(`   → ${args.variables.streamsRemoved} streams were removed`);
    }
    if (args.variables.subtitlesConverted > 0) {
      args.jobLog(`   → ${args.variables.subtitlesConverted} subtitles were converted`);
    }

    // Example: Even if bitrate/codec/channels are already correct,
    // we still need to process because the file structure changed
    
    // Your normal plugin logic here...
    // For example, checking bitrate, codec, etc.
    
    // But regardless of those checks, return outputNumber: 2 to ensure replacement
    args.jobLog('✅ Processing file to ensure library replacement');
    
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,  // Force replacement
      variables: args.variables
    };
  }

  // Normal plugin logic for non-preprocessed files
  args.jobLog('File was not preprocessed - applying normal conditions');
  
  // Your regular plugin conditions here...
  // Check bitrate, codec, channels, etc.
  
  // Example normal return (no processing needed)
  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,  // No processing
    variables: args.variables
  };
};
