module.exports = async (args) => {
  try {
    const fileObj = args.outputFileObj; // working file from previous block

    if (!fileObj) {
      args.jobLog('❌ No outputFileObj provided to check block.');
      return {
        outputFileObj: args.outputFileObj || args.inputFileObj,
        outputNumber: 2,
        error: 'No working file to inspect',
      };
    }

    const streams = (fileObj.ffProbeData && fileObj.ffProbeData.streams) || [];
    if (!Array.isArray(streams) || streams.length === 0) {
      args.jobLog('❌ Probe has no streams array on working file.');
      return {
        outputFileObj: fileObj,
        outputNumber: 2,
        error: 'Probe missing/empty',
      };
    }

    const hasAudio = streams.some(s => s.codec_type === 'audio');
    const hasVideo = streams.some(s => s.codec_type === 'video');

    if (!hasAudio || !hasVideo) {
      args.jobLog('❌ Missing audio or video stream in working file!');
      return {
        outputFileObj: fileObj,
        outputNumber: 2,                 // route to your Fail node
        error: 'Missing required streams' // also hard-fails the job
      };
    }

    args.jobLog('✅ Audio and video streams are intact.');
    return {
      outputFileObj: fileObj,
      outputNumber: 1,
      variables: args.variables,
    };

  } catch (err) {
    args.jobLog(`❌ Error during stream check: ${err.message}`);
    return {
      outputFileObj: args.outputFileObj || args.inputFileObj,
      outputNumber: 2,
      error: 'Stream check crashed',
    };
  }
};
