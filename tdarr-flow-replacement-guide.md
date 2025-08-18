# Tdarr Flow: Forcing File Replacement After Remuxing

## The Problem
When smart-media-preprocessor.js performs remuxing (removing streams, converting subtitles), subsequent flow plugins might skip processing because other requirements (bitrate, codec, channels) are already met. However, the remuxed file still needs to replace the original library file.

## Solutions

### 1. Use outputNumber: 2 (Current Implementation)
Your current code returns `outputNumber: 2`, which signals that processing occurred:

```javascript
return {
  outputFileObj: updatedFileObj,
  outputNumber: 2,  // Indicates processing occurred
  variables: args.variables,
};
```

### 2. Set processFile Variable (Recommended Addition)
Add a variable to force subsequent plugins to process:

```javascript
return {
  outputFileObj: updatedFileObj,
  outputNumber: 2,
  variables: {
    ...args.variables,
    processFile: true,           // Force processing
    requiresReplacement: true,   // Custom flag
    remuxed: true               // Indicate remuxing occurred
  }
};
```

### 3. Use infoLog to Signal Processing
Add logging that subsequent plugins can check:

```javascript
args.infoLog('File was remuxed and requires replacement');
```

### 4. Modify File Metadata
Set a custom metadata field that subsequent plugins can detect:

```javascript
// In your FFmpeg command, add:
ffmpegArgs.push('-metadata', 'tdarr_processed=remuxed');
ffmpegArgs.push('-metadata', 'tdarr_requires_replacement=true');
```

## Recommended Implementation

Modify your return statement in smart-media-preprocessor.js:

```javascript
// === STEP 8: RETURN WORKING FILE ===
args.jobLog('\n═══════════════════════════════════════');
args.jobLog('   PREPROCESSING COMPLETE');
args.jobLog('═══════════════════════════════════════');

// Signal that file was processed and needs replacement
args.infoLog('File was remuxed and requires library replacement');

const updatedFileObj = {
  ...args.inputFileObj,
  _id: normalizedWorkingFile
};

return {
  outputFileObj: updatedFileObj,
  outputNumber: 2,
  variables: {
    ...args.variables,
    processFile: true,           // Force subsequent processing
    requiresReplacement: true,   // Custom flag for replacement
    remuxed: true,              // Indicate remuxing occurred
    preprocessed: true          // General processing flag
  }
};
```

## For Subsequent Flow Plugins

In your other flow plugins, check for these variables:

```javascript
// Check if file was preprocessed and needs replacement
if (args.variables.requiresReplacement || args.variables.remuxed || args.variables.processFile) {
  // Force processing even if other conditions are met
  args.jobLog('File was preprocessed - forcing replacement');
  
  // Continue with processing logic...
  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 2,  // Ensure replacement occurs
    variables: args.variables
  };
}
```

## Alternative: Use Flow Conditions

In your Tdarr flow, add a condition node that checks:
- `args.variables.requiresReplacement === true`
- `args.variables.remuxed === true`
- `args.variables.processFile === true`

This ensures the flow continues to replacement nodes even when other conditions fail.

## Best Practice

The most reliable approach is to combine multiple methods:
1. Use `outputNumber: 2`
2. Set `processFile: true` variable
3. Add custom variables for specific conditions
4. Use `args.infoLog()` for debugging
5. Check these variables in subsequent plugins
