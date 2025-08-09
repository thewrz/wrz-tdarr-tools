module.exports = async (args) => {
  try {
    // Get the primary audio stream from ffProbeData
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
    
    const primaryAudioStream = audioStreams[0];
    const channels = primaryAudioStream.channels;
    
    if (channels > 2) {
      // Multi-channel audio detected - needs transcoding to stereo - output 2
      args.jobLog('🔉🌌 Multi-channel audio detected - needs transcoding');
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 2,
        variables: args.variables,
      };
    } else {
      // Stereo or mono audio - already correct, skip processing - output 1
      args.jobLog('🎧 Stereo audio detected - skipping (already optimized)');
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 1,
        variables: args.variables,
      };
    }
    
  } catch (error) {
    args.jobLog(`❌ Error checking audio channels: ${error.message}`);
    // Default to output 4 on error
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 4,
      variables: args.variables,
    };
  }
}
