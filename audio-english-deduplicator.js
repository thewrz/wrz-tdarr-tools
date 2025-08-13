// Audio English Deduplicator - Removes duplicate English audio streams
// Keeps only the first English audio track while preserving all other language tracks

module.exports = async (args) => {
  const fs = require('fs');
  const path = require('path');
  const { execFileSync } = require('child_process');

  args.variables = args.variables || {};

  const inputFile =
    args.inputFileObj._id ||
    args.inputFileObj.path ||
    args.inputFileObj.sourceFile;
  const fileName = path.basename(inputFile);
  const ext = path.extname(fileName).toLowerCase().replace('.', '');
  const container = (args.inputFileObj.container || '').toLowerCase();

  console.log('═══════════════════════════════════════');
  console.log('   AUDIO ENGLISH DEDUPLICATOR');
  console.log('═══════════════════════════════════════');
  console.log(`File: ${inputFile}`);
  console.log(`Container: ${args.inputFileObj.container}`);

  // Get audio streams from ffProbeData
  const audioStreams = args.inputFileObj.ffProbeData.streams.filter(stream => stream.codec_type === 'audio');
  
  if (audioStreams.length === 0) {
    console.log('❓ No audio streams found - skipping');
    args.variables.skipProcessing = true;
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2, // Skip processing
      variables: args.variables,
      processFile: false
    };
  }

  console.log(`✓ Found ${audioStreams.length} audio streams`);

  // Analyze audio streams
  const analysis = {
    englishStreams: [],
    otherLanguageStreams: [],
    undefinedStreams: [],
    streamsToKeep: [],
    streamsToRemove: []
  };

  console.log('\n━━━ Analyzing Audio Streams ━━━');

  audioStreams.forEach((stream, index) => {
    const tags = stream.tags || {};
    const language = (tags.language || 'und').toLowerCase();
    const channels = stream.channels || 0;
    const codec = stream.codec_name || 'unknown';
    
    console.log(`Stream ${index}: ${codec} (${channels}ch)`);
    console.log(`  Language: ${language}`);
    console.log(`  Index: ${stream.index}`);

    // Categorize streams by language
    if (language === 'eng' || language === 'en' || language === 'english') {
      analysis.englishStreams.push({
        index: stream.index,
        streamIndex: index,
        language: language,
        channels: channels,
        codec: codec,
        stream: stream
      });
      console.log(`  → English stream detected`);
    } else if (language === 'und' || language === 'undefined') {
      analysis.undefinedStreams.push({
        index: stream.index,
        streamIndex: index,
        language: language,
        channels: channels,
        codec: codec,
        stream: stream
      });
      console.log(`  → Undefined language stream`);
    } else {
      analysis.otherLanguageStreams.push({
        index: stream.index,
        streamIndex: index,
        language: language,
        channels: channels,
        codec: codec,
        stream: stream
      });
      console.log(`  → Other language stream (${language})`);
    }
    
    console.log('');
  });

  // Decision logic
  console.log('━━━ Processing Decision ━━━');
  
  // If we have undefined language streams, skip processing to avoid data loss
  if (analysis.undefinedStreams.length > 0) {
    console.log('⚠️ Found undefined language streams - skipping to avoid data loss');
    args.variables.skipProcessing = true;
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2, // Skip processing
      variables: args.variables,
      processFile: false
    };
  }

  // If no English streams, skip processing
  if (analysis.englishStreams.length === 0) {
    console.log('⚠️ No English audio streams found - skipping');
    args.variables.skipProcessing = true;
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2, // Skip processing
      variables: args.variables,
      processFile: false
    };
  }

  // If only one English stream, skip processing
  if (analysis.englishStreams.length === 1) {
    console.log('✓ Only one English audio stream - no deduplication needed');
    args.variables.skipProcessing = true;
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2, // Skip processing
      variables: args.variables,
      processFile: false
    };
  }

  // Multiple English streams detected - need processing
  console.log(`🔄 Multiple English streams detected (${analysis.englishStreams.length}) - deduplication needed`);
  
  // Keep first English stream, remove duplicates
  analysis.streamsToKeep.push(analysis.englishStreams[0]);
  analysis.streamsToRemove = analysis.englishStreams.slice(1);
  
  // Keep all other language streams
  analysis.streamsToKeep.push(...analysis.otherLanguageStreams);

  console.log(`✓ Keeping first English stream (index ${analysis.englishStreams[0].index})`);
  console.log(`✓ Keeping ${analysis.otherLanguageStreams.length} other language streams`);
  console.log(`❌ Removing ${analysis.streamsToRemove.length} duplicate English streams`);

  // Store analysis for processing
  args.variables.audioAnalysis = analysis;
  args.variables.skipProcessing = false;
  args.variables.needsProcessing = true;
  args.variables.originalFile = inputFile;

  // Determine container type for tool selection
  const isMKV = ext === 'mkv' || container === 'mkv' || container === 'matroska';
  const isMP4 = ext === 'mp4' || container === 'mp4' || ext === 'm4v';
  
  args.variables.containerType = isMKV ? 'mkv' : (isMP4 ? 'mp4' : 'other');
  args.variables.preferredTool = isMKV ? 'mkvtoolnix' : 'ffmpeg';

  console.log(`Container type: ${args.variables.containerType}`);
  console.log(`Preferred tool: ${args.variables.preferredTool}`);

  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1, // Continue to processing
    variables: args.variables,
    processFile: true
  };
};
