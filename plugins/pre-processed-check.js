// Check if preprocessed and needs replacement
module.exports = (args) => {
  const wasPreprocessed = args.variables.preprocessed === true || args.variables.requiresReplacement === true;
  if (wasPreprocessed) {
    args.jobLog('File was preprocessed - forcing replacement');
    return { outputFileObj: args.inputFileObj, outputNumber: 2, variables: args.variables };
  }
  args.jobLog('File not preprocessed - no replacement needed');
  return { outputFileObj: args.inputFileObj, outputNumber: 1, variables: args.variables };
};