# Custom JS Functions Usage Guide

This guide explains how to use the Audio English Deduplicator tools as Custom JS Functions in Tdarr Flow.

## 🎯 Overview

Instead of copying files to the Tdarr plugins directory, you can paste the JavaScript code directly into "Custom JS Function" blocks in the Tdarr Flow interface.

## 📋 Available Custom JS Functions

### 1. Check Audio English Duplicates (Analysis Block)
**File**: `custom-js-check-audio-duplicates.js`
**Purpose**: Lightweight analysis and routing based on English audio stream count

### 2. Audio English Deduplicator (Processing Block)
**File**: `custom-js-audio-deduplicator.js`
**Purpose**: Complete processing to remove duplicate English audio streams

## 🚀 Setup Instructions

### Step 1: Create Custom JS Function Blocks

1. Open Tdarr Flow interface
2. Add a "Custom JS Function" block to your flow
3. Double-click the block to open the configuration dialog
4. Configure the block as shown below

### Step 2: Configure Analysis Block

**Block Configuration:**
- **Name**: `Check Audio English Duplicates`
- **Description**: `Analyzes audio streams and routes files based on English audio count`
- **Outputs**: 
  - `1: Continue to output 1` (Multiple English streams - needs processing)
  - `2: Continue to output 2` (Single/no English streams - skip processing)
  - `3: Continue to output 3` (Undefined language streams - skip for safety)
  - `4: Continue to output 4` (Not used)

**JS Code**: Copy and paste the entire contents of `custom-js-check-audio-duplicates.js`

### Step 3: Configure Processing Block

**Block Configuration:**
- **Name**: `Audio English Deduplicator`
- **Description**: `Removes duplicate English audio streams while preserving other languages`
- **Outputs**:
  - `1: Continue to output 1` (Success - continue to next block)
  - `2: Continue to output 2` (Skip - no processing needed)
  - `3: Continue to output 3` (Error - route to error handling)
  - `4: Continue to output 4` (Not used)

**JS Code**: Copy and paste the entire contents of `custom-js-audio-deduplicator.js`

## 🔄 Flow Setup Options

### Option 1: Two-Stage Flow (Recommended)

```
[Input Files]
    ↓
[Custom JS: Check Audio English Duplicates]
    ├── Output 1 → [Custom JS: Audio English Deduplicator] → [Success/Next Block]
    ├── Output 2 → [Skip/Next Block]
    └── Output 3 → [Skip/Next Block] (Safety)
```

**Benefits:**
- Lightweight analysis first
- Only processes files that need it
- Clear separation of concerns
- Better logging and debugging

### Option 2: Single-Stage Flow (Simplified)

```
[Input Files]
    ↓
[Custom JS: Audio English Deduplicator]
    ├── Output 1 → [Success/Next Block]
    ├── Output 2 → [Skip/Next Block]
    └── Output 3 → [Error Handling]
```

**Benefits:**
- Fewer blocks in flow
- Single point of processing
- Simpler setup

## 📊 Output Routing Guide

### Analysis Block Outputs

| Output | Condition | Action | Next Block |
|--------|-----------|--------|------------|
| 1 | Multiple English streams found | Process | Audio Deduplicator |
| 2 | Single/no English streams | Skip | Next processing step |
| 3 | Undefined language streams | Skip (Safety) | Next processing step |

### Processing Block Outputs

| Output | Condition | Action | Next Block |
|--------|-----------|--------|------------|
| 1 | Processing successful | Continue | Next processing step |
| 2 | No processing needed | Skip | Next processing step |
| 3 | Processing failed | Error | Error handling |

## 🔧 Configuration Examples

### Example 1: Movie Processing Flow

```
[Input Files]
    ↓
[Custom JS: Check Audio English Duplicates]
    ├── 1 → [Custom JS: Audio English Deduplicator]
    │           ├── 1 → [Video Processing]
    │           ├── 2 → [Video Processing]
    │           └── 3 → [Error Log]
    ├── 2 → [Video Processing]
    └── 3 → [Video Processing]
```

### Example 2: Complete Media Processing

```
[Input Files]
    ↓
[Custom JS: Check Audio English Duplicates]
    ├── 1 → [Custom JS: Audio English Deduplicator]
    │           ├── 1 → [Subtitle Processing]
    │           ├── 2 → [Subtitle Processing]
    │           └── 3 → [Error Handling]
    ├── 2 → [Subtitle Processing]
    └── 3 → [Subtitle Processing]
```

## 📝 Code Customization

### Modifying Language Detection

To support additional languages, modify the language detection logic:

```javascript
// In both custom JS functions, find this section:
if (language === 'eng' || language === 'en' || language === 'english') {
  // Add more English variants if needed
  // language === 'en-us' || language === 'en-gb'
}

// To prioritize a different language, change the logic:
if (language === 'fra' || language === 'fr' || language === 'french') {
  // This would prioritize French instead of English
}
```

### Adjusting Tool Paths

If your tools are installed in different locations, modify the path arrays:

```javascript
// For MKVToolsNix
const mkvmergePath = resolveBin([
  'C:\\Program Files\\MKVToolNix\\mkvmerge.exe',
  'C:\\Program Files (x86)\\MKVToolNix\\mkvmerge.exe',
  'D:\\Tools\\MKVToolNix\\mkvmerge.exe', // Add your custom path
  'mkvmerge'
]);

// For FFmpeg
const ffmpegPath = resolveBin([
  'C:\\programdata\\chocolatey\\bin\\ffmpeg.exe',
  'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
  'C:\\ffmpeg\\bin\\ffmpeg.exe',
  'D:\\Tools\\ffmpeg\\bin\\ffmpeg.exe', // Add your custom path
  'ffmpeg'
]);
```

## 🧪 Testing Your Setup

### Test Files

Create test files with these characteristics:

1. **Multiple English Streams**: Movie with main audio + commentary
2. **Single English Stream**: Regular movie file
3. **No English Streams**: Foreign language film
4. **Undefined Languages**: File with untagged audio streams

### Expected Behavior

| Test File Type | Analysis Output | Processing Output | Result |
|----------------|-----------------|-------------------|---------|
| Multiple English | 1 (Process) | 1 (Success) | Duplicates removed |
| Single English | 2 (Skip) | N/A | No processing |
| No English | 2 (Skip) | N/A | No processing |
| Undefined Languages | 3 (Safety) | N/A | No processing |

## 🚨 Troubleshooting

### Common Issues

**Block Not Executing**
- Check that the block is enabled
- Verify the JS code was pasted completely
- Check for syntax errors in the code

**Tool Not Found Errors**
- Verify FFmpeg/MKVToolsNix installation
- Check tool paths in the code
- Ensure tools are accessible from Tdarr worker

**Processing Failures**
- Check available disk space
- Verify input file permissions
- Review Tdarr worker logs

### Debug Mode

Add debug logging to troubleshoot issues:

```javascript
// Add at the beginning of the function
args.jobLog(`DEBUG: Input file: ${args.inputFileObj._id}`);
args.jobLog(`DEBUG: Container: ${args.inputFileObj.container}`);
args.jobLog(`DEBUG: Stream count: ${args.inputFileObj.ffProbeData.streams.length}`);
```

## 📈 Performance Tips

1. **Use Analysis Block First**: Avoid unnecessary processing
2. **Monitor Disk Space**: Processing creates temporary files
3. **Batch Processing**: Process similar files together
4. **Tool Selection**: MKVToolsNix is faster for MKV files

## 🔄 Flow Variables

The blocks set these variables for downstream use:

### Analysis Block Variables
- `audioStreamAnalysis.totalStreams`: Total audio stream count
- `audioStreamAnalysis.englishStreams`: English stream count
- `audioStreamAnalysis.undefinedStreams`: Undefined stream count
- `audioStreamAnalysis.streamDetails`: Detailed stream information

### Processing Block Variables
- `audioDeduplicationApplied`: Boolean flag indicating processing occurred
- `originalFile`: Path to original input file
- `englishStreamsRemoved`: Count of duplicate streams removed
- `totalStreamsKept`: Count of streams preserved

## 📋 Best Practices

1. **Always Test First**: Test with sample files before production use
2. **Monitor Logs**: Check Tdarr logs for processing details
3. **Backup Important Files**: Keep originals safe during testing
4. **Use Descriptive Names**: Name your blocks clearly
5. **Document Changes**: Keep notes on any code modifications

## 🎉 Ready to Use

Your Custom JS Functions are now ready for production use in Tdarr Flow! The blocks will automatically:

- ✅ Detect files with multiple English audio streams
- ✅ Remove duplicate English tracks while preserving others
- ✅ Skip processing when not needed
- ✅ Handle errors gracefully
- ✅ Provide detailed logging

Simply paste the code into Custom JS Function blocks and connect them in your flow as described above.
