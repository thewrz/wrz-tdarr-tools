// Custom JS Function: Check for Duplicate English Audio Streams
// Paste this code into a "Custom JS Function" block in Tdarr Flow
// This block analyzes audio streams and routes files based on English audio count
// Output 1: Multiple English streams (needs processing)
// Output 2: Single/no English streams (skip processing) 
// Output 3: Undefined language streams (skip for safety)

module.exports = async (args) => {
  try {
    args.jobLog('🔍 Checking for duplicate English audio streams...');

    // Get audio streams from ffProbeData
    const audioStreams = args.inputFileObj.ffProbeData.streams.filter(stream => stream.codec_type === 'audio');
    
    if (audioStreams.length === 0) {
      args.jobLog('❓ No audio streams found');
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 2, // Skip - no audio
        variables: args.variables,
      };
    }

    args.jobLog(`✓ Found ${audioStreams.length} audio streams`);

    // Analyze streams by language
    let englishCount = 0;
    let undefinedCount = 0;
    let otherLanguageCount = 0;
    const streamDetails = [];

    audioStreams.forEach((stream, index) => {
      const tags = stream.tags || {};
      const language = (tags.language || 'und').toLowerCase();
      const channels = stream.channels || 0;
      const codec = stream.codec_name || 'unknown';
      
      streamDetails.push({
        index: index,
        language: language,
        channels: channels,
        codec: codec
      });

      if (language === 'eng' || language === 'en' || language === 'english') {
        englishCount++;
        args.jobLog(`  Stream ${index}: ${codec} (${channels}ch) - English`);
      } else if (language === 'und' || language === 'undefined') {
        undefinedCount++;
        args.jobLog(`  Stream ${index}: ${codec} (${channels}ch) - Undefined`);
      } else {
        otherLanguageCount++;
        args.jobLog(`  Stream ${index}: ${codec} (${channels}ch) - ${language.toUpperCase()}`);
      }
    });

    // Store analysis in flow variables for potential use by downstream blocks
    const newVariables = { ...args.variables };
    newVariables.audioStreamAnalysis = {
      totalStreams: audioStreams.length,
      englishStreams: englishCount,
      undefinedStreams: undefinedCount,
      otherLanguageStreams: otherLanguageCount,
      streamDetails: streamDetails
    };

    // Decision logic
    if (undefinedCount > 0) {
      args.jobLog(`⚠️ Found ${undefinedCount} undefined language streams - skipping to avoid data loss`);
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 3, // Skip - undefined languages present
        variables: newVariables,
      };
    }

    if (englishCount === 0) {
      args.jobLog('⚠️ No English audio streams found - skipping');
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 2, // Skip - no English streams
        variables: newVariables,
      };
    }

    if (englishCount === 1) {
      args.jobLog('✓ Only one English audio stream - no deduplication needed');
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 2, // Skip - single English stream
        variables: newVariables,
      };
    }

    // Multiple English streams found
    args.jobLog(`🔄 Multiple English streams detected (${englishCount}) - routing for deduplication`);
    args.jobLog(`📊 Summary: ${englishCount} English, ${otherLanguageCount} other languages, ${undefinedCount} undefined`);
    
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1, // Process - multiple English streams
      variables: newVariables,
    };

  } catch (error) {
    args.jobLog(`❌ Error checking audio streams: ${error.message}`);
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 3, // Error
      variables: args.variables,
    };
  }
};
