module.exports = async (args) => {
  try {
    // Get audio streams from ffProbeData
    const audioStreams = args.inputFileObj.ffProbeData.streams.filter(stream => stream.codec_type === 'audio');
    
    if (audioStreams.length === 0) {
      // No audio streams found - output 3
      args.jobLog('❓ No audio streams found');
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 3,
        variables: args.variables,
      };
    }
    
    const firstAudioStream = audioStreams[0];
    
    // Check if language tags are present
    if (!firstAudioStream.tags || !firstAudioStream.tags.language) {
      // No language tags present - output 3
      args.jobLog('🏷️ No language tags present for audio streams');
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 3,
        variables: args.variables,
      };
    }
    
    const language = firstAudioStream.tags.language.toLowerCase();
    
    // Check if first audio stream is English or Undefined
    if (language === 'eng' || language === 'en' || language === 'english' || 
        language === 'und' || language === 'undefined') {
      // English or Undefined detected - output 1
      args.jobLog(`🇺🇸 First audio stream is English/Undefined (${language}) - proceeding`);
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 1,
        variables: args.variables,
      };
    } else {
      // First audio stream is not English or Undefined - output 2
      args.jobLog(`🌍 First audio stream is not English/Undefined (${language}) - routing to alternate path`);
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 2,
        variables: args.variables,
      };
    }
    
  } catch (error) {
    args.jobLog(`❌ Error checking audio language: ${error.message}`);
    // Default to output 3 on error (treat as no language tags)
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 3,
      variables: args.variables,
    };
  }
}
