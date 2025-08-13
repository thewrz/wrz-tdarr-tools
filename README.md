# Cline Audio Channel Management Tools

A comprehensive suite of tools for managing multiple English audio channels in media files using Tdarr Flow plugins. These tools automatically remove duplicate English audio streams while preserving all other language tracks.

## 🎯 Overview

This toolkit provides:
- **Flow Analysis Tools**: Detect and route files with duplicate English audio streams
- **Flow Processing Tools**: Remove duplicate English audio streams using MKVToolsNix or FFmpeg
- **Legacy Plugin Generator**: Create custom Tdarr plugins with configurable options
- **Test Suites**: Validate functionality across various scenarios

## 📁 Repository Structure

```
wrz-tdarr-tools/
├── custom-js-check-audio-duplicates.js  # Custom JS: Analysis and routing
├── custom-js-audio-deduplicator.js      # Custom JS: Complete processing
├── check-audio-english-duplicates.js    # Flow plugin: Analysis and routing
├── audio-english-deduplicator-flow.js   # Flow plugin: Complete processing
├── audio-english-deduplicator.js        # Legacy: Core analysis tool
├── audio-english-processor.js           # Legacy: Core processing tool
├── check-audio-language.js              # Existing language detection tool
├── check-audio-multichannel.js          # Existing multichannel detection tool
├── subtitle-tool-stage*.js              # Existing subtitle management tools
├── CUSTOM-JS-USAGE-GUIDE.md             # Complete setup guide for Custom JS
└── README.md                            # This documentation
```

## 🚀 Quick Start

### Option 1: Custom JS Functions (Recommended)

**No file copying required!** Use the code directly in Tdarr Flow:

1. **Open** the Custom JS Function files:
   - `custom-js-check-audio-duplicates.js` (analysis/routing)
   - `custom-js-audio-deduplicator.js` (complete processing)

2. **Create** "Custom JS Function" blocks in Tdarr Flow

3. **Copy/paste** the JavaScript code into the blocks

4. **Connect** the blocks in your flow

📖 **See detailed instructions**: [CUSTOM-JS-USAGE-GUIDE.md](CUSTOM-JS-USAGE-GUIDE.md)

### Option 2: Use Individual Custom JS Functions

All these files can be pasted directly into Custom JS Function blocks:

- `audio-english-deduplicator.js` - Analysis and routing
- `audio-english-processor.js` - Processing with external tools
- `check-audio-english-duplicates.js` - Lightweight analysis
- `audio-english-deduplicator-flow.js` - All-in-one processing

### Option 3: Use as Flow Plugins (File-based)

Copy these files to your Tdarr Flow plugins directory:
- `check-audio-english-duplicates.js` (analysis/routing)
- `audio-english-deduplicator-flow.js` (complete processing)
- `audio-english-deduplicator.js` (legacy analysis)
- `audio-english-processor.js` (legacy processing)

### Installation Options

**For Custom JS Functions (Recommended):**
1. Open any of the audio processing files
2. Create "Custom JS Function" blocks in Tdarr Flow
3. Copy/paste the code into the respective blocks
4. Configure outputs and connect blocks as described in the usage guide

**For Flow Plugins:**
1. Copy desired `.js` files to your Tdarr Flow plugins directory
2. Create a flow using these plugins as blocks
3. Connect outputs appropriately (see Flow Setup below)

## 🔧 Tools Description

### Flow Plugins (Recommended)

#### Check Audio English Duplicates (`check-audio-english-duplicates.js`)

**Purpose**: Flow plugin that analyzes and routes files based on English audio stream count

**Logic**:
- ✅ **Output 1**: Files with multiple English audio streams (route to processing)
- ⚠️ **Output 2**: Files with single/no English streams (skip processing)
- ⚠️ **Output 3**: Files with undefined language streams (skip for data safety)

**Features**:
- Lightweight analysis only
- Sets flow variables for downstream plugins
- Detailed logging of stream analysis
- Compatible with Tdarr Flow visual interface

#### Audio English Deduplicator Flow (`audio-english-deduplicator-flow.js`)

**Purpose**: Complete processing plugin that removes duplicate English audio streams

**Features**:
- Analyzes audio streams and processes in one step
- Keeps first English audio track
- Preserves all other language tracks
- Maintains video and subtitle streams
- Uses stream copying (no quality loss)
- Automatic tool selection (MKVToolsNix/FFmpeg)
- Comprehensive error handling and logging

**Tool Selection**:
- **MKV files**: MKVToolsNix (mkvmerge) preferred
- **MP4 files**: FFmpeg
- **Fallback**: Automatic fallback to FFmpeg if MKVToolsNix unavailable

**Output Numbers**:
- `1`: Success - continue to next plugin
- `2`: Skip - no processing needed
- `3`: Error - route to error handling

### Legacy Tools

#### Audio English Deduplicator (`audio-english-deduplicator.js`)

**Purpose**: Legacy analysis tool for traditional Tdarr plugins

**Logic**:
- ✅ **Process**: Files with multiple English audio streams
- ⚠️ **Skip**: Files with single/no English streams
- ⚠️ **Skip**: Files with undefined language streams (data safety)
- ⚠️ **Skip**: Files with no audio streams

**Output Numbers**:
- `1`: Continue to processing (multiple English streams detected)
- `2`: Skip processing (no action needed)

#### Audio English Processor (`audio-english-processor.js`)

**Purpose**: Legacy processing tool for traditional Tdarr plugins

**Features**:
- Keeps first English audio track
- Preserves all other language tracks
- Maintains video and subtitle streams
- Uses stream copying (no quality loss)

**Tool Selection**:
- **MKV files**: MKVToolsNix (mkvmerge) preferred
- **MP4 files**: FFmpeg
- **Fallback**: Automatic fallback to FFmpeg if MKVToolsNix unavailable

### Custom JS Functions

#### Custom JS Check Audio Duplicates (`custom-js-check-audio-duplicates.js`)

**Purpose**: Custom JS Function for analysis and routing based on English audio stream count

**Features**:
- Paste directly into Tdarr Custom JS Function blocks
- Lightweight analysis only
- Sets flow variables for downstream blocks
- Detailed logging of stream analysis
- No file copying required

#### Custom JS Audio Deduplicator (`custom-js-audio-deduplicator.js`)

**Purpose**: Complete processing Custom JS Function that removes duplicate English audio streams

**Features**:
- Paste directly into Tdarr Custom JS Function blocks
- All-in-one analysis and processing
- Keeps first English audio track
- Preserves all other language tracks
- Uses MKVToolsNix for MKV, FFmpeg for MP4
- No file copying required

## 📋 Processing Logic

### Decision Tree

```
Input File
├── No audio streams? → SKIP
├── Undefined language streams? → SKIP (safety)
├── No English streams? → SKIP
├── Single English stream? → SKIP
└── Multiple English streams? → PROCESS
    ├── Keep: First English stream
    ├── Keep: All other language streams
    └── Remove: Duplicate English streams
```

### Stream Selection Example

**Input**: Movie with 4 audio streams
- Stream 0: English 5.1 DTS
- Stream 1: English 2.0 AC3  
- Stream 2: Spanish 5.1 DTS
- Stream 3: French 2.0 AC3

**Output**: Movie with 3 audio streams
- Stream 0: English 5.1 DTS ← **Kept**
- Stream 1: Spanish 5.1 DTS ← **Kept**
- Stream 2: French 2.0 AC3 ← **Kept**

## 🛠️ Tool Requirements

### Required Software

**FFmpeg** (Required for MP4 and fallback processing)
- Windows: `C:\programdata\chocolatey\bin\ffmpeg.exe`
- Or available in system PATH

**MKVToolsNix** (Recommended for MKV processing)
- Windows: `C:\Program Files\MKVToolNix\mkvmerge.exe`
- Or available in system PATH

### Installation Verification

The tools automatically detect and test available software:
```bash
# Test tool availability
node -e "
const { execFileSync } = require('child_process');
try {
  execFileSync('ffmpeg', ['-version'], { timeout: 5000 });
  console.log('✓ FFmpeg available');
} catch { console.log('❌ FFmpeg not found'); }
try {
  execFileSync('mkvmerge', ['--version'], { timeout: 5000 });
  console.log('✓ MKVToolsNix available');
} catch { console.log('❌ MKVToolsNix not found'); }
"
```

## 📊 Usage Examples

### Example 1: Movie with Commentary Track

**Scenario**: Blu-ray rip with main audio and commentary

**Input**:
```
Movie.mkv
├── Video: H.264 1080p
├── Audio 1: English 7.1 DTS-HD (Main)
├── Audio 2: English 2.0 AAC (Commentary)
├── Audio 3: Spanish 5.1 DTS
└── Subtitles: English, Spanish
```

**Processing**:
- Deduplicator: Detects 2 English streams → Process
- Processor: Keeps first English (main), removes commentary
- Result: Main English + Spanish audio preserved

**Output**:
```
Movie_processed.mkv
├── Video: H.264 1080p (unchanged)
├── Audio 1: English 7.1 DTS-HD ← Kept
├── Audio 2: Spanish 5.1 DTS ← Kept
└── Subtitles: English, Spanish (unchanged)
```

### Example 2: TV Episode with Multiple Formats

**Scenario**: TV episode with different English audio formats

**Input**:
```
Episode.mp4
├── Video: H.264 720p
├── Audio 1: English 5.1 AC3
├── Audio 2: English 2.0 AAC (Stereo mix)
├── Audio 3: English 2.0 AAC (Descriptive)
└── Audio 4: French 2.0 AAC
```

**Processing**:
- Deduplicator: Detects 3 English streams → Process
- Processor: Keeps first English, removes duplicates
- Result: Primary English + French audio preserved

**Output**:
```
Episode_processed.mp4
├── Video: H.264 720p (unchanged)
├── Audio 1: English 5.1 AC3 ← Kept
└── Audio 2: French 2.0 AAC ← Kept
```

## 🔄 Tdarr Integration

### Flow Plugin Setup (Recommended)

#### Option 1: Two-Stage Flow (Analysis + Processing)
```
[Input Files]
    ↓
[check-audio-english-duplicates.js]
    ├── Output 1 → [audio-english-deduplicator-flow.js] → [Success]
    ├── Output 2 → [Skip/Next Plugin]
    └── Output 3 → [Skip/Next Plugin] (Safety)
```

#### Option 2: Single-Stage Flow (All-in-One)
```
[Input Files]
    ↓
[audio-english-deduplicator-flow.js]
    ├── Output 1 → [Success/Next Plugin]
    ├── Output 2 → [Skip/Next Plugin]
    └── Output 3 → [Error Handling]
```

### Flow Plugin Configuration

**For check-audio-english-duplicates.js:**
- **Type**: Analysis/Routing
- **Purpose**: Lightweight stream analysis and routing
- **Outputs**: 1=Process, 2=Skip, 3=Safety Skip

**For audio-english-deduplicator-flow.js:**
- **Type**: Processing
- **Purpose**: Complete audio stream deduplication
- **Outputs**: 1=Success, 2=Skip, 3=Error

### Legacy Plugin Setup

```
[Input Files]
    ↓
[Audio English Deduplicator]
    ├── Output 1 → [Audio English Processor] → [Success]
    └── Output 2 → [Skip/Next Plugin]
```

### Flow Variables

The flow plugins use these variables for communication:
- `audioStreamAnalysis`: Detailed stream analysis results
- `audioDeduplicationApplied`: Flag indicating processing was completed
- `originalFile`: Original input file path
- `englishStreamsRemoved`: Count of duplicate streams removed
- `totalStreamsKept`: Count of streams preserved

### Legacy Variables

Legacy tools use these variables:
- `audioAnalysis`: Stream analysis results
- `skipProcessing`: Skip flag for processor
- `needsProcessing`: Processing requirement flag
- `containerType`: Container format (mkv/mp4/other)
- `preferredTool`: Tool preference (mkvtoolnix/ffmpeg)

## 🧪 Testing

### Manual Testing

Test your Custom JS Functions with sample files:

1. **Create test files** with different audio configurations:
   - Multiple English streams (main + commentary)
   - Single English stream
   - No English streams (foreign language)
   - Undefined language streams

2. **Test in Tdarr Flow**:
   - Create Custom JS Function blocks
   - Paste the code from the repository files
   - Process test files and verify results

### Expected Behavior

- ✅ **Multiple English streams**: Should process and remove duplicates
- ✅ **Single English stream**: Should skip processing
- ✅ **No English streams**: Should skip processing
- ✅ **Undefined language streams**: Should skip for safety
- ✅ **No audio streams**: Should skip processing

## 🚨 Troubleshooting

### Common Issues

**Plugin Not Processing Files**
```
Symptoms: Files pass through without changes
Solutions:
- Verify files have multiple English audio streams
- Check for undefined language streams
- Review Tdarr logs for detailed analysis
```

**Tool Not Found Errors**
```
Symptoms: "mkvmerge not found" or "ffmpeg not found"
Solutions:
- Install missing tools (FFmpeg/MKVToolsNix)
- Verify tools are in system PATH
- Check file permissions for tool executables
```

**Processing Failures**
```
Symptoms: Processing starts but fails
Solutions:
- Check available disk space
- Verify input files are not corrupted
- Review worker logs for detailed errors
- Test with simpler files first
```

### Debug Mode

Enable verbose logging by adding debug statements to your Custom JS Functions:
```javascript
// Add at the beginning of your Custom JS Function
args.jobLog(`DEBUG: Input file: ${args.inputFileObj._id}`);
args.jobLog(`DEBUG: Container: ${args.inputFileObj.container}`);
args.jobLog(`DEBUG: Stream count: ${args.inputFileObj.ffProbeData.streams.length}`);
```

### Log Analysis

Check these log patterns in Tdarr:
```
✓ Found X audio streams          # Stream detection working
🔄 Multiple English streams      # Processing triggered
✓ Keeping first English stream   # Correct stream selection
❌ Removing X duplicate streams   # Duplicates identified
```

## 🔧 Development

### Repository Integration

This toolkit follows the existing repository patterns:
- **Consistent naming**: `audio-*` prefix for audio tools
- **Error handling**: Comprehensive try-catch blocks
- **Logging**: Detailed console output with emojis
- **Tool detection**: Automatic binary path resolution
- **Cross-platform**: Windows path support with fallbacks

### Extending the Tools

**Adding New Language Support**:
```javascript
// In deduplicator, extend language detection
if (language === 'eng' || language === 'en' || language === 'english' ||
    language === 'fra' || language === 'fr' || language === 'french') {
  // Handle French as primary language
}
```

**Adding New Container Support**:
```javascript
// In processor, extend container detection
const isAVI = ext === 'avi' || container === 'avi';
if (isAVI) {
  // Handle AVI-specific processing
}
```

### Code Style

- **ES6+ features**: Use modern JavaScript
- **Async/await**: For asynchronous operations
- **Error handling**: Always include try-catch blocks
- **Documentation**: JSDoc comments for functions
- **Testing**: Add test cases for new features

## 📈 Performance Considerations

### Processing Speed

- **Stream copying**: No re-encoding for maximum speed
- **Tool selection**: MKVToolsNix faster for MKV files
- **Parallel processing**: Tools support Tdarr's worker system
- **Memory usage**: Minimal memory footprint

### Optimization Tips

1. **Use MKVToolsNix for MKV files** (faster than FFmpeg)
2. **Process in batches** using Tdarr's queue system
3. **Monitor disk space** during processing
4. **Use SSD storage** for temporary files

## 🤝 Contributing

### Development Setup

1. Clone the repository
2. Install Node.js (if not already installed)
3. Test Custom JS Functions manually in Tdarr Flow
4. Make changes and test thoroughly
5. Follow existing code patterns

### Submitting Changes

1. Test all scenarios manually with sample files
2. Verify Custom JS Functions work in Tdarr Flow
3. Update documentation if needed
4. Follow repository commit conventions

## 📄 License

This project follows the same license as the parent repository.

## 🙏 Acknowledgments

- Built on the foundation of existing `wrz-tdarr-tools`
- Follows patterns established by subtitle management tools
- Integrates with Tdarr's plugin architecture
- Uses MKVToolsNix and FFmpeg for media processing

---

**Generated by**: Cline Audio Channel Manager v1.0.0  
**Last Updated**: January 2025  
**Compatibility**: Tdarr v2.x, Node.js 14+
