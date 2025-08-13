#!/usr/bin/env node

// Audio Channel Manager - CLI tool to generate Tdarr plugins for managing English audio channels
// Generates plugins that remove duplicate English audio streams while preserving other languages

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Configuration
const CONFIG = {
  outputDir: './tdarr-plugins',
  pluginPrefix: 'Cline_Audio_',
  version: '1.0.0'
};

// Plugin templates
const PLUGIN_TEMPLATES = {
  deduplicator: {
    id: 'Cline_Audio_English_Deduplicator',
    name: 'Remove Duplicate English Audio Streams',
    stage: 'Pre-processing',
    type: 'Audio',
    tooltip: 'Keeps only the first English audio track while preserving all other languages',
    category: 'Audio Management'
  },
  processor: {
    id: 'Cline_Audio_English_Processor', 
    name: 'Process Audio Stream Removal',
    stage: 'Pre-processing',
    type: 'Audio',
    tooltip: 'Processes files to remove duplicate English audio streams using MKVToolsNix or FFmpeg',
    category: 'Audio Management'
  }
};

class AudioChannelManager {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async run() {
    console.log('═══════════════════════════════════════');
    console.log('   CLINE AUDIO CHANNEL MANAGER');
    console.log('═══════════════════════════════════════');
    console.log('Generate Tdarr plugins for managing English audio channels\n');

    try {
      const args = this.parseArgs();
      
      if (args.help) {
        this.showHelp();
        return;
      }

      if (args.interactive) {
        await this.runInteractive();
      } else {
        await this.runDirect(args);
      }

    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      process.exit(1);
    } finally {
      this.rl.close();
    }
  }

  parseArgs() {
    const args = {
      interactive: false,
      outputDir: CONFIG.outputDir,
      toolPreference: 'auto',
      dryRun: false,
      help: false,
      verbose: false
    };

    for (let i = 2; i < process.argv.length; i++) {
      const arg = process.argv[i];
      
      switch (arg) {
        case '--help':
        case '-h':
          args.help = true;
          break;
        case '--interactive':
        case '-i':
          args.interactive = true;
          break;
        case '--output':
        case '-o':
          args.outputDir = process.argv[++i];
          break;
        case '--tool':
        case '-t':
          args.toolPreference = process.argv[++i];
          break;
        case '--dry-run':
        case '-d':
          args.dryRun = true;
          break;
        case '--verbose':
        case '-v':
          args.verbose = true;
          break;
        default:
          if (arg.startsWith('-')) {
            throw new Error(`Unknown option: ${arg}`);
          }
      }
    }

    return args;
  }

  showHelp() {
    console.log(`
Usage: node audio-channel-manager.js [options]

Options:
  -h, --help          Show this help message
  -i, --interactive   Run in interactive mode
  -o, --output DIR    Output directory for plugins (default: ${CONFIG.outputDir})
  -t, --tool TOOL     Preferred tool (mkvtoolnix|ffmpeg|auto) (default: auto)
  -d, --dry-run       Preview generated plugins without creating files
  -v, --verbose       Enable verbose logging

Examples:
  node audio-channel-manager.js --interactive
  node audio-channel-manager.js --output ./my-plugins --tool mkvtoolnix
  node audio-channel-manager.js --dry-run --verbose

Description:
  This tool generates Tdarr JavaScript plugins that manage multiple English
  audio channels in media files. The generated plugins will:
  
  • Analyze audio streams and identify duplicate English tracks
  • Keep only the first English audio track
  • Preserve all other language tracks
  • Use MKVToolsNix for MKV files, FFmpeg for MP4 and other formats
  • Skip processing when no duplicates are found or undefined languages exist
`);
  }

  async runInteractive() {
    console.log('🔧 Interactive Plugin Generator\n');

    const config = {
      outputDir: await this.prompt('Output directory', CONFIG.outputDir),
      toolPreference: await this.promptChoice('Preferred tool', [
        'auto (detect best tool for container)',
        'mkvtoolnix (recommended for MKV)',
        'ffmpeg (universal)'
      ], 0),
      includeComments: await this.promptYesNo('Include detailed comments in plugins', true),
      generateBoth: await this.promptYesNo('Generate both analyzer and processor plugins', true)
    };

    // Clean up tool preference
    config.toolPreference = config.toolPreference.split(' ')[0];

    console.log('\n━━━ Configuration Summary ━━━');
    console.log(`Output directory: ${config.outputDir}`);
    console.log(`Tool preference: ${config.toolPreference}`);
    console.log(`Include comments: ${config.includeComments ? 'Yes' : 'No'}`);
    console.log(`Generate both plugins: ${config.generateBoth ? 'Yes' : 'No'}`);

    const proceed = await this.promptYesNo('\nProceed with plugin generation', true);
    if (!proceed) {
      console.log('❌ Cancelled by user');
      return;
    }

    await this.generatePlugins(config);
  }

  async runDirect(args) {
    const config = {
      outputDir: args.outputDir,
      toolPreference: args.toolPreference,
      includeComments: !args.dryRun, // Include comments unless dry run
      generateBoth: true,
      dryRun: args.dryRun,
      verbose: args.verbose
    };

    if (config.verbose) {
      console.log('━━━ Configuration ━━━');
      console.log(`Output directory: ${config.outputDir}`);
      console.log(`Tool preference: ${config.toolPreference}`);
      console.log(`Dry run: ${config.dryRun ? 'Yes' : 'No'}`);
      console.log('');
    }

    await this.generatePlugins(config);
  }

  async generatePlugins(config) {
    console.log('\n🔨 Generating Tdarr plugins...\n');

    try {
      // Ensure output directory exists
      if (!config.dryRun && !fs.existsSync(config.outputDir)) {
        fs.mkdirSync(config.outputDir, { recursive: true });
        console.log(`✓ Created output directory: ${config.outputDir}`);
      }

      // Generate deduplicator plugin
      const deduplicatorPlugin = this.generateDeduplicatorPlugin(config);
      const deduplicatorPath = path.join(config.outputDir, `${PLUGIN_TEMPLATES.deduplicator.id}.js`);
      
      if (config.dryRun) {
        console.log(`📄 Would create: ${deduplicatorPath}`);
        console.log('━━━ Preview: Deduplicator Plugin ━━━');
        console.log(deduplicatorPlugin.substring(0, 500) + '...\n');
      } else {
        fs.writeFileSync(deduplicatorPath, deduplicatorPlugin);
        console.log(`✓ Generated: ${deduplicatorPath}`);
      }

      // Generate processor plugin if requested
      if (config.generateBoth) {
        const processorPlugin = this.generateProcessorPlugin(config);
        const processorPath = path.join(config.outputDir, `${PLUGIN_TEMPLATES.processor.id}.js`);
        
        if (config.dryRun) {
          console.log(`📄 Would create: ${processorPath}`);
          console.log('━━━ Preview: Processor Plugin ━━━');
          console.log(processorPlugin.substring(0, 500) + '...\n');
        } else {
          fs.writeFileSync(processorPath, processorPlugin);
          console.log(`✓ Generated: ${processorPath}`);
        }
      }

      // Generate README
      const readme = this.generateReadme(config);
      const readmePath = path.join(config.outputDir, 'README.md');
      
      if (config.dryRun) {
        console.log(`📄 Would create: ${readmePath}`);
      } else {
        fs.writeFileSync(readmePath, readme);
        console.log(`✓ Generated: ${readmePath}`);
      }

      console.log('\n🎉 Plugin generation completed successfully!');
      
      if (!config.dryRun) {
        console.log('\n📋 Next steps:');
        console.log(`1. Copy the generated plugins from ${config.outputDir} to your Tdarr plugins directory`);
        console.log('2. Restart Tdarr Server to load the new plugins');
        console.log('3. Create a new flow in Tdarr using the generated plugins');
        console.log('4. Test with a sample file that has multiple English audio tracks');
      }

    } catch (error) {
      console.error(`❌ Plugin generation failed: ${error.message}`);
      throw error;
    }
  }

  generateDeduplicatorPlugin(config) {
    const template = PLUGIN_TEMPLATES.deduplicator;
    const includeComments = config.includeComments;
    
    return `${includeComments ? `// ${template.name}
// Generated by Cline Audio Channel Manager v${CONFIG.version}
// 
// This plugin analyzes audio streams in media files and identifies duplicate
// English audio tracks. It will skip processing if:
// - No audio streams are found
// - No English streams are found  
// - Only one English stream exists
// - Undefined language streams are present (to avoid data loss)
//
// When multiple English streams are detected, it prepares the file for processing
// by the companion processor plugin.

` : ''}const details = () => ({
  id: "${template.id}",
  Stage: "${template.stage}",
  Name: "${template.name}",
  Type: "${template.type}",
  Operation: "Transcode",
  Description: "${template.tooltip}",
  Version: "${CONFIG.version}",
  Tags: "pre-processing,audio,english,deduplication",
  Inputs: []
});

const plugin = (file, librarySettings, inputs, otherArguments) => {
  const response = {
    processFile: false,
    preset: "",
    container: "",
    handBrakeMode: false,
    FFmpegMode: false,
    reQueueAfter: false,
    infoLog: ""
  };

  try {
    ${includeComments ? '// Get audio streams from file metadata' : ''}
    const audioStreams = file.ffProbeData.streams.filter(stream => stream.codec_type === 'audio');
    
    if (audioStreams.length === 0) {
      response.infoLog += "❓ No audio streams found - skipping\\n";
      return response;
    }

    response.infoLog += \`✓ Found \${audioStreams.length} audio streams\\n\`;

    ${includeComments ? '// Analyze audio streams by language' : ''}
    const analysis = {
      englishStreams: [],
      otherLanguageStreams: [],
      undefinedStreams: []
    };

    audioStreams.forEach((stream, index) => {
      const tags = stream.tags || {};
      const language = (tags.language || 'und').toLowerCase();
      const channels = stream.channels || 0;
      const codec = stream.codec_name || 'unknown';
      
      response.infoLog += \`Stream \${index}: \${codec} (\${channels}ch) - \${language}\\n\`;

      if (language === 'eng' || language === 'en' || language === 'english') {
        analysis.englishStreams.push({
          index: stream.index,
          streamIndex: index,
          language: language,
          channels: channels,
          codec: codec
        });
      } else if (language === 'und' || language === 'undefined') {
        analysis.undefinedStreams.push({
          index: stream.index,
          streamIndex: index,
          language: language,
          channels: channels,
          codec: codec
        });
      } else {
        analysis.otherLanguageStreams.push({
          index: stream.index,
          streamIndex: index,
          language: language,
          channels: channels,
          codec: codec
        });
      }
    });

    ${includeComments ? '// Decision logic - skip processing in these cases:' : ''}
    
    ${includeComments ? '// Skip if undefined language streams exist (avoid data loss)' : ''}
    if (analysis.undefinedStreams.length > 0) {
      response.infoLog += "⚠️ Found undefined language streams - skipping to avoid data loss\\n";
      return response;
    }

    ${includeComments ? '// Skip if no English streams found' : ''}
    if (analysis.englishStreams.length === 0) {
      response.infoLog += "⚠️ No English audio streams found - skipping\\n";
      return response;
    }

    ${includeComments ? '// Skip if only one English stream (no duplicates)' : ''}
    if (analysis.englishStreams.length === 1) {
      response.infoLog += "✓ Only one English audio stream - no deduplication needed\\n";
      return response;
    }

    ${includeComments ? '// Multiple English streams detected - processing needed' : ''}
    response.infoLog += \`🔄 Multiple English streams detected (\${analysis.englishStreams.length}) - deduplication needed\\n\`;
    response.infoLog += \`✓ Keeping first English stream (index \${analysis.englishStreams[0].index})\\n\`;
    response.infoLog += \`✓ Keeping \${analysis.otherLanguageStreams.length} other language streams\\n\`;
    response.infoLog += \`❌ Removing \${analysis.englishStreams.length - 1} duplicate English streams\\n\`;

    ${includeComments ? '// Set up for processing' : ''}
    response.processFile = true;
    response.preset = \`${config.toolPreference === 'mkvtoolnix' ? '-f matroska' : '-c copy'}\`;
    response.container = file.container;
    response.handBrakeMode = false;
    response.FFmpegMode = ${config.toolPreference === 'ffmpeg' ? 'true' : 'false'};
    response.reQueueAfter = true;

    return response;

  } catch (error) {
    response.infoLog += \`❌ Error analyzing audio streams: \${error.message}\\n\`;
    return response;
  }
};

module.exports.details = details;
module.exports.plugin = plugin;
`;
  }

  generateProcessorPlugin(config) {
    const template = PLUGIN_TEMPLATES.processor;
    const includeComments = config.includeComments;
    
    return `${includeComments ? `// ${template.name}
// Generated by Cline Audio Channel Manager v${CONFIG.version}
//
// This plugin processes media files to remove duplicate English audio streams.
// It uses MKVToolsNix for MKV files and FFmpeg for MP4 and other formats.
// 
// The plugin will:
// - Keep only the first English audio track
// - Preserve all other language audio tracks
// - Maintain all video and subtitle streams
// - Use stream copying to avoid quality loss

` : ''}const details = () => ({
  id: "${template.id}",
  Stage: "${template.stage}",
  Name: "${template.name}",
  Type: "${template.type}",
  Operation: "Transcode",
  Description: "${template.tooltip}",
  Version: "${CONFIG.version}",
  Tags: "pre-processing,audio,english,processing",
  Inputs: []
});

const plugin = (file, librarySettings, inputs, otherArguments) => {
  const response = {
    processFile: false,
    preset: "",
    container: "",
    handBrakeMode: false,
    FFmpegMode: false,
    reQueueAfter: false,
    infoLog: ""
  };

  try {
    ${includeComments ? '// Re-analyze audio streams to determine processing needs' : ''}
    const audioStreams = file.ffProbeData.streams.filter(stream => stream.codec_type === 'audio');
    
    if (audioStreams.length === 0) {
      response.infoLog += "❓ No audio streams found - skipping\\n";
      return response;
    }

    const analysis = {
      englishStreams: [],
      otherLanguageStreams: [],
      undefinedStreams: []
    };

    audioStreams.forEach((stream, index) => {
      const tags = stream.tags || {};
      const language = (tags.language || 'und').toLowerCase();
      
      if (language === 'eng' || language === 'en' || language === 'english') {
        analysis.englishStreams.push({
          index: stream.index,
          streamIndex: index,
          language: language,
          channels: stream.channels || 0,
          codec: stream.codec_name || 'unknown'
        });
      } else if (language === 'und' || language === 'undefined') {
        analysis.undefinedStreams.push({
          index: stream.index,
          streamIndex: index,
          language: language,
          channels: stream.channels || 0,
          codec: stream.codec_name || 'unknown'
        });
      } else {
        analysis.otherLanguageStreams.push({
          index: stream.index,
          streamIndex: index,
          language: language,
          channels: stream.channels || 0,
          codec: stream.codec_name || 'unknown'
        });
      }
    });

    ${includeComments ? '// Skip processing if conditions not met' : ''}
    if (analysis.undefinedStreams.length > 0 || 
        analysis.englishStreams.length <= 1) {
      response.infoLog += "⚠️ No processing needed - skipping\\n";
      return response;
    }

    ${includeComments ? '// Build stream selection for processing' : ''}
    const streamsToKeep = [];
    streamsToKeep.push(analysis.englishStreams[0]); ${includeComments ? '// Keep first English stream' : ''}
    streamsToKeep.push(...analysis.otherLanguageStreams); ${includeComments ? '// Keep all other languages' : ''}

    response.infoLog += \`🔄 Processing \${audioStreams.length} audio streams\\n\`;
    response.infoLog += \`✓ Keeping \${streamsToKeep.length} audio streams\\n\`;
    response.infoLog += \`❌ Removing \${analysis.englishStreams.length - 1} duplicate English streams\\n\`;

    ${includeComments ? '// Determine processing method based on container and preference' : ''}
    const container = file.container.toLowerCase();
    const isMKV = container === 'mkv' || container === 'matroska';
    const useFFmpeg = ${config.toolPreference === 'ffmpeg' ? 'true' : '!isMKV'};

    if (useFFmpeg) {
      ${includeComments ? '// Use FFmpeg for processing' : ''}
      response.processFile = true;
      response.FFmpegMode = true;
      response.handBrakeMode = false;
      
      ${includeComments ? '// Build FFmpeg stream mapping' : ''}
      let preset = "-map 0:v"; ${includeComments ? '// Map all video streams' : ''}
      
      ${includeComments ? '// Map selected audio streams' : ''}
      streamsToKeep.forEach((stream) => {
        preset += \` -map 0:a:\${stream.streamIndex}\`;
      });
      
      preset += " -map 0:s?"; ${includeComments ? '// Map subtitle streams if present' : ''}
      preset += " -c copy"; ${includeComments ? '// Copy streams without re-encoding' : ''}
      
      response.preset = preset;
      response.container = file.container;
      
    } else {
      ${includeComments ? '// Use MKVToolsNix for MKV files' : ''}
      response.processFile = true;
      response.FFmpegMode = false;
      response.handBrakeMode = false;
      
      ${includeComments ? '// Build mkvmerge audio track selection' : ''}
      const audioTracks = streamsToKeep.map(stream => stream.streamIndex).join(',');
      
      response.preset = \`-f matroska --audio-tracks \${audioTracks} --video-tracks all --subtitle-tracks all\`;
      response.container = "mkv";
    }

    response.reQueueAfter = true;
    return response;

  } catch (error) {
    response.infoLog += \`❌ Error processing audio streams: \${error.message}\\n\`;
    return response;
  }
};

module.exports.details = details;
module.exports.plugin = plugin;
`;
  }

  generateReadme(config) {
    return `# Cline Audio Channel Management Plugins

Generated by Cline Audio Channel Manager v${CONFIG.version}

## Overview

These Tdarr plugins manage multiple English audio channels in media files by keeping only the first English audio track while preserving all other language tracks.

## Generated Plugins

### ${PLUGIN_TEMPLATES.deduplicator.name}
- **ID**: \`${PLUGIN_TEMPLATES.deduplicator.id}\`
- **Purpose**: Analyzes audio streams and identifies files with duplicate English tracks
- **Stage**: ${PLUGIN_TEMPLATES.deduplicator.stage}

### ${PLUGIN_TEMPLATES.processor.name}
- **ID**: \`${PLUGIN_TEMPLATES.processor.id}\`
- **Purpose**: Processes files to remove duplicate English audio streams
- **Stage**: ${PLUGIN_TEMPLATES.processor.stage}

## Installation

1. Copy the generated \`.js\` files to your Tdarr plugins directory
2. Restart Tdarr Server to load the new plugins
3. The plugins will appear in the plugin library under "${PLUGIN_TEMPLATES.deduplicator.category}"

## Usage

### Recommended Flow Setup

1. **Input**: Media files with multiple audio streams
2. **Plugin 1**: ${PLUGIN_TEMPLATES.deduplicator.name}
   - Analyzes audio streams
   - Skips files that don't need processing
3. **Plugin 2**: ${PLUGIN_TEMPLATES.processor.name}
   - Processes files identified by the analyzer
   - Removes duplicate English audio streams

### Processing Logic

The plugins will:
- ✅ **Keep**: First English audio track
- ✅ **Keep**: All non-English audio tracks  
- ❌ **Remove**: Duplicate English audio tracks
- ⚠️ **Skip**: Files with undefined language streams (to avoid data loss)
- ⚠️ **Skip**: Files with no English streams
- ⚠️ **Skip**: Files with only one English stream

### Tool Selection

- **MKV files**: Uses MKVToolsNix (mkvmerge) when available
- **MP4 files**: Uses FFmpeg
- **Other formats**: Uses FFmpeg
- **Fallback**: Automatically falls back to FFmpeg if MKVToolsNix is unavailable

## Configuration

### Tool Preference
Current configuration: **${config.toolPreference}**

- \`auto\`: Automatically selects best tool for container type
- \`mkvtoolnix\`: Prefers MKVToolsNix (recommended for MKV files)
- \`ffmpeg\`: Uses FFmpeg for all processing

### Required Tools

Ensure these tools are installed and accessible:

- **FFmpeg**: Required for MP4 and fallback processing
  - Windows: \`C:\\\\programdata\\\\chocolatey\\\\bin\\\\ffmpeg.exe\`
  - Or available in system PATH
  
- **MKVToolsNix**: Recommended for MKV processing
  - Windows: \`C:\\\\Program Files\\\\MKVToolNix\\\\mkvmerge.exe\`
  - Or available in system PATH

## Examples

### Example 1: Movie with Multiple English Tracks
**Input**: Movie.mkv
- Video: H.264
- Audio 1: English 5.1 (DTS)
- Audio 2: English 2.0 (AC3)  
- Audio 3: Spanish 5.1 (DTS)
- Subtitles: English, Spanish

**Output**: Movie_processed.mkv
- Video: H.264 (unchanged)
- Audio 1: English 5.1 (DTS) ← **Kept**
- Audio 2: Spanish 5.1 (DTS) ← **Kept** 
- Subtitles: English, Spanish (unchanged)

### Example 2: TV Show with Commentary
**Input**: Episode.mp4
- Video: H.264
- Audio 1: English 2.0 (AAC)
- Audio 2: English Commentary (AAC)
- Audio 3: French 2.0 (AAC)

**Output**: Episode_processed.mp4
- Video: H.264 (unchanged)
- Audio 1: English 2.0 (AAC) ← **Kept**
- Audio 2: French 2.0 (AAC) ← **Kept**

## Troubleshooting

### Plugin Not Processing Files
- Check that files have multiple English audio streams
- Verify no undefined language streams exist
- Check Tdarr logs for detailed processing information

### Tool Not Found Errors
- Ensure FFmpeg and/or MKVToolsNix are properly installed
- Check that tools are accessible from the configured paths
- Verify Tdarr has permissions to execute the tools

### Processing Failures
- Check available disk space for output files
- Verify input files are not corrupted
- Review Tdarr worker logs for detailed error messages

## Support

These plugins were generated automatically. For issues:
1. Check the processing logs in Tdarr
2. Verify tool installations (FFmpeg, MKVToolsNix)
3. Test with a simple file first
4. Regenerate plugins with different settings if needed

---
Generated on: ${new Date().toISOString()}
Configuration: ${JSON.stringify(config, null, 2)}
`;
  }

  async prompt(question, defaultValue = '') {
    return new Promise((resolve) => {
      const prompt = defaultValue ? `${question} (${defaultValue}): ` : `${question}: `;
      this.rl.question(prompt, (answer) => {
        resolve(answer.trim() || defaultValue);
      });
    });
  }

  async promptChoice(question, choices, defaultIndex = 0) {
    console.log(`${question}:`);
    choices.forEach((choice, index) => {
      const marker = index === defaultIndex ? '→' : ' ';
      console.log(`  ${marker} ${index + 1}. ${choice}`);
    });

    return new Promise((resolve) => {
      this.rl.question(`Select (1-${choices.length}, default ${defaultIndex + 1}): `, (answer) => {
        const choice = parseInt(answer.trim()) || (defaultIndex + 1);
        const index = Math.max(0, Math.min(choices.length - 1, choice - 1));
        resolve(choices[index]);
      });
    });
  }

  async promptYesNo(question, defaultValue = true) {
    const defaultText = defaultValue ? 'Y/n' : 'y/N';
    return new Promise((resolve) => {
      this.rl.question(`${question} (${defaultText}): `, (answer) => {
        const response = answer.trim().toLowerCase();
        if (response === '') {
          resolve(defaultValue);
        } else {
          resolve(response === 'y' || response === 'yes');
        }
      });
    });
  }
}

// Run the tool
if (require.main === module) {
  const manager = new AudioChannelManager();
  manager.run().catch(error => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = AudioChannelManager;
