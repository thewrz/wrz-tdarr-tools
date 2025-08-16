// example Custom JS plug-in for Tdarr flows


module.exports = async (args) => {

// see args object data here https://github.com/HaveAGitGat/Tdarr_Plugins/blob/master/FlowPluginsTs/FlowHelpers/1.0.0/interfaces/interfaces.ts
// example setting flow variable: https://github.com/HaveAGitGat/Tdarr/issues/1147#issuecomment-2593348443
// example reading ffmpeg metadata: https://github.com/HaveAGitGat/Tdarr_Plugins/issues/737#issuecomment-2581536112
// example setting working file as previous working file: https://github.com/HaveAGitGat/Tdarr/issues/1106#issuecomment-2622177459

// some example file data:
console.log(args.inputFileObj._id)
console.log(args.inputFileObj.file_size)
console.log(args.inputFileObj.ffProbeData.streams[0].codec_name)
console.log(args.inputFileObj.mediaInfo.track[0].BitRate)

// access global variable:
console.log(args.userVariables.global.test)
// access library variable:
console.log(args.userVariables.library.test)



// do something here

  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables,
  };
}
      