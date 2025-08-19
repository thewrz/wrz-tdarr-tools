module.exports = async (args) => {
  try {
    const streams = args.inputFileObj?.ffProbeData?.streams || [];
    const audioStreams = streams.filter(
      s => (s.codec_type || s.codecType) === 'audio'
    );

    if (audioStreams.length === 0) {
      args.jobLog('❓ No audio streams found');
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 3, // route for "no audio"
        variables: args.variables,
      };
    }

    const channels = Number(audioStreams[0].channels) || 0;

    if (channels > 2) {
      args.jobLog(`🔉🌌 Multi-channel audio detected (${channels} ch)`);
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 2, // route for multichannel
        variables: args.variables,
      };
    } else {
      args.jobLog(`🎧 Stereo/Mono audio detected (${channels} ch)`);
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 1, // route for stereo/mono
        variables: args.variables,
      };
    }
  } catch (error) {
    args.jobLog(`❌ Error checking audio channels: ${error?.message || error}`);
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 4, // safe default
      variables: args.variables,
    };
  }
};
