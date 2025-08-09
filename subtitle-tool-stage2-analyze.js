// Stage 2: Analyze subtitle tracks and determine what needs processing
// This block categorizes subtitles and decides what to convert/discard

module.exports = async (args) => {
  console.log('═══════════════════════════════════════');
  console.log('   STAGE 2: ANALYZE SUBTITLE TRACKS');
  console.log('═══════════════════════════════════════');
  
  // Check if we should skip
  if (args.variables.skipProcessing) {
    console.log('⚠️ Skipping - no processing needed');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables,
    };
  }
  
  const tracks = args.variables.mkvTracks || [];
  const subtitleTracks = tracks.filter(t => t.type === 'subtitles');
  
  // Initialize analysis results
  const analysis = {
    toConvert: [],    // Text subs that need conversion to SRT
    toDiscard: [],    // Bitmap subs to remove
    toKeep: [],       // Already SRT format
    englishTrackId: null
  };
  
  console.log(`Analyzing ${subtitleTracks.length} subtitle tracks:\n`);
  
  // Helper functions
  function isBitmapSubtitle(codec) {
    const bitmapFormats = [
      'hdmv_pgs', 'pgs', 'dvb_subtitle', 'dvb', 'dvd_subtitle',
      'vobsub', 'xsub', 'cc_dec', 'arib_caption'
    ];
    const codecLower = codec.toLowerCase();
    return bitmapFormats.some(format => codecLower.includes(format));
  }
  
  function isSRTSubtitle(codec) {
    const codecLower = codec.toLowerCase();
    return codecLower.includes('subrip') || codecLower === 'srt';
  }
  
  function isTextSubtitle(codec) {
    const textFormats = [
      'subrip', 'srt', 'ass', 'ssa', 'webvtt', 'vtt', 
      'ttml', 'mov_text', 'text', 'subtitle'
    ];
    const codecLower = codec.toLowerCase();
    return textFormats.some(format => codecLower.includes(format));
  }
  
  // Analyze each subtitle track
  subtitleTracks.forEach(track => {
    const codec = track.codec.toLowerCase();
    const lang = (track.language || '').toLowerCase();
    
    console.log(`Track ${track.id}: ${track.codec}`);
    console.log(`  Language: ${track.language || 'undefined'}`);
    
    // Check if it's English (for default flag)
    if ((lang === 'eng' || lang === 'en' || lang === 'english') && !analysis.englishTrackId) {
      analysis.englishTrackId = track.id;
      console.log(`  → Marked as English default`);
    }
    
    // Categorize by type
    if (isBitmapSubtitle(codec)) {
      // Bitmap subtitle - discard
      analysis.toDiscard.push({
        id: track.id,
        codec: track.codec,
        language: track.language
      });
      console.log(`  → DISCARD (bitmap subtitle)`);
      
    } else if (isSRTSubtitle(codec)) {
      // Already SRT - keep as is
      analysis.toKeep.push({
        id: track.id,
        codec: track.codec,
        language: track.language
      });
      console.log(`  → KEEP (already SRT)`);
      
    } else if (isTextSubtitle(codec)) {
      // Text subtitle but not SRT - convert
      let format = 'text';
      if (codec.includes('ass') || codec.includes('ssa')) {
        format = 'ass';
      } else if (codec.includes('webvtt') || codec.includes('vtt')) {
        format = 'webvtt';
      } else if (codec.includes('mov_text')) {
        format = 'mov_text';
      }
      
      analysis.toConvert.push({
        id: track.id,
        codec: track.codec,
        language: track.language,
        format: format
      });
      console.log(`  → CONVERT (${format} to SRT)`);
      
    } else {
      // Unknown - try to convert
      analysis.toConvert.push({
        id: track.id,
        codec: track.codec,
        language: track.language,
        format: 'unknown'
      });
      console.log(`  → CONVERT (unknown format)`);
    }
    
    console.log('');
  });
  
  // Summary
  console.log('━━━ Analysis Summary ━━━');
  console.log(`Tracks to keep: ${analysis.toKeep.length}`);
  console.log(`Tracks to convert: ${analysis.toConvert.length}`);
  console.log(`Tracks to discard: ${analysis.toDiscard.length}`);
  
  // Determine if processing is needed
  const needsProcessing = analysis.toConvert.length > 0 || analysis.toDiscard.length > 0;
  
  if (!needsProcessing && analysis.toKeep.length === subtitleTracks.length) {
    console.log('\n✓ All subtitles are already in SRT format');
    args.variables.skipProcessing = true;
  } else {
    console.log('\n✓ Processing needed');
    args.variables.skipProcessing = false;
  }
  
  // Store analysis in flow variables
  args.variables.subtitleAnalysis = analysis;
  args.variables.needsProcessing = needsProcessing;
  
  // Ensure uniqueId is preserved if it exists from previous stages
  if (args.variables.uniqueId) {
    console.log(`Preserving unique ID: ${args.variables.uniqueId}`);
  }
  
  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables,
  };
};
