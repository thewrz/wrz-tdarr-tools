// Stage 2: Comprehensive Media Analysis
// Analyzes all streams and determines what processing is needed
module.exports = async (args) => {
  console.log('═══════════════════════════════════════');
  console.log('   STAGE 2: COMPREHENSIVE MEDIA ANALYSIS');
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
  
  const videoTracks = args.variables.videoTracks || [];
  const audioTracks = args.variables.audioTracks || [];
  const subtitleTracks = args.variables.subtitleTracks || [];
  
  // Initialize comprehensive analysis
  const analysis = {
    video: {
      tracksToKeep: [],
      needsProcessing: false
    },
    audio: {
      englishStreams: [],
      otherLanguageStreams: [],
      undefinedStreams: [],
      commentaryStreams: [],
      streamsToKeep: [],
      streamsToRemove: [],
      needsProcessing: false
    },
    subtitles: {
      toConvert: [],
      toDiscard: [],
      toKeep: [],
      englishTrackId: null,
      needsProcessing: false
    }
  };
  
  console.log(`Analyzing streams:`);
  console.log(`  - Video: ${videoTracks.length}`);
  console.log(`  - Audio: ${audioTracks.length}`);
  console.log(`  - Subtitles: ${subtitleTracks.length}\n`);
  
  // === VIDEO ANALYSIS ===
  console.log('━━━ Video Stream Analysis ━━━');
  if (videoTracks.length > 0) {
    // Keep only the first video track
    analysis.video.tracksToKeep = [videoTracks[0]];
    console.log(`✓ Keeping first video track (ID: ${videoTracks[0].id}, Codec: ${videoTracks[0].codec})`);
    
    if (videoTracks.length > 1) {
      console.log(`⚠️ Found ${videoTracks.length} video tracks - will keep only the first one`);
    }
  } else {
    console.log('❌ No video tracks found');
  }
  
  // === AUDIO ANALYSIS ===
  console.log('\n━━━ Audio Stream Analysis ━━━');
  
  // Enhanced commentary detection patterns
  const commentaryPatterns = [
    /commentary/i,
    /director.?s?\s+commentary/i,
    /cast\s+commentary/i,
    /production.*commentary/i,
    /design.*commentary/i,
    /audio\s+commentary/i,
    /filmmaker.*commentary/i,
    /writer.*commentary/i,
    /producer.*commentary/i,
    /behind.*scenes/i,
    /making.*of/i,
    /^commentary$/i,
    /\bcomm\b/i,
    /director.*track/i,
    /bonus.*audio/i,
    /audio\s+description/i,
    /descriptive\s+audio/i,
    /described\s+video/i,
    /\bad\b/i,
    /vision.*impaired/i,
    /accessibility/i
  ];

  function isCommentaryTrack(trackName, handlerName = '') {
    const textToCheck = `${trackName} ${handlerName}`.toLowerCase().trim();
    if (!textToCheck) return false;
    
    return commentaryPatterns.some(pattern => pattern.test(textToCheck));
  }

  // Language detection patterns for title inspection
  const languagePatterns = {
    eng: [
      /\benglish\b/i,
      /\beng\b/i,
      /\ben\b/i,
      /\ben-us\b/i,
      /\ben-gb\b/i,
      /\ben-au\b/i,
      /\ben-ca\b/i
    ],
    jpn: [
      /\bjapanese\b/i,
      /\bjpn\b/i,
      /\bja\b/i,
      /\bja-jp\b/i,
      /\bnihongo\b/i,
      /\b日本語\b/i
    ],
    kor: [
      /\bkorean\b/i,
      /\bkor\b/i,
      /\bko\b/i,
      /\bko-kr\b/i,
      /\bhangul\b/i,
      /\b한국어\b/i
    ],
    deu: [
      /\bgerman\b/i,
      /\bdeu\b/i,
      /\bger\b/i,
      /\bde\b/i,
      /\bde-de\b/i,
      /\bdeutsch\b/i
    ],
    fra: [
      /\bfrench\b/i,
      /\bfra\b/i,
      /\bfre\b/i,
      /\bfr\b/i,
      /\bfr-fr\b/i,
      /\bfrancais\b/i,
      /\bfrançais\b/i
    ]
  };

  function detectLanguageFromTitle(title) {
    if (!title) return null;
    
    const titleLower = title.toLowerCase().trim();
    
    for (const [isoCode, patterns] of Object.entries(languagePatterns)) {
      if (patterns.some(pattern => pattern.test(titleLower))) {
        return isoCode;
      }
    }
    
    return null;
  }

  // Analyze audio streams
  audioTracks.forEach((track, index) => {
    let language = (track.language || '').toLowerCase();
    const channels = track.channels || 0;
    const codec = track.codec || 'unknown';
    const trackName = track.name || '';
    let languageSource = 'tag';
    
    // If no language tag or language is 'und', try to detect from title
    if (!language || language === 'und' || language === 'undefined') {
      const detectedLanguage = detectLanguageFromTitle(trackName);
      if (detectedLanguage) {
        language = detectedLanguage;
        languageSource = 'title';
        console.log(`Track ${track.id}: ${codec} (${channels}ch) - ${language} (detected from title)`);
      } else {
        language = 'und';
        languageSource = 'undefined';
        console.log(`Track ${track.id}: ${codec} (${channels}ch) - und (no language detected)`);
      }
    } else {
      console.log(`Track ${track.id}: ${codec} (${channels}ch) - ${language}`);
    }
    
    if (trackName) {
      console.log(`  Title: "${trackName}"`);
    }

    const streamInfo = {
      index: track.id,
      streamIndex: index,
      language: language,
      languageSource: languageSource,
      channels: channels,
      codec: codec,
      trackName: trackName,
      track: track
    };

    // Check if this is a commentary or audio description track
    if (isCommentaryTrack(trackName)) {
      analysis.audio.commentaryStreams.push(streamInfo);
      console.log(`  → Commentary/Audio Description detected - will be removed`);
    } else if (language === 'eng' || language === 'en' || language === 'english') {
      analysis.audio.englishStreams.push(streamInfo);
      console.log(`  → English stream detected (${languageSource})`);
    } else if (language === 'und' || language === 'undefined') {
      analysis.audio.undefinedStreams.push(streamInfo);
      console.log(`  → Undefined language stream`);
    } else {
      analysis.audio.otherLanguageStreams.push(streamInfo);
      console.log(`  → Other language stream (${language}) (${languageSource})`);
    }
  });

  // Handle undefined streams - keep only the first one, mark others for removal
  if (analysis.audio.undefinedStreams.length > 1) {
    console.log(`⚠️ Found ${analysis.audio.undefinedStreams.length} undefined language streams - keeping only the first one`);
    const firstUndefined = analysis.audio.undefinedStreams[0];
    const extraUndefined = analysis.audio.undefinedStreams.slice(1);
    
    // Keep only the first undefined stream
    analysis.audio.undefinedStreams = [firstUndefined];
    
    // Add extra undefined streams to commentary streams for removal
    analysis.audio.commentaryStreams.push(...extraUndefined);
    
    extraUndefined.forEach(stream => {
      console.log(`  → Extra undefined stream ${stream.streamIndex} marked for removal`);
    });
  }

  // Determine audio streams to keep/remove with English stream first
  if (analysis.audio.englishStreams.length > 0) {
    // Always put the English stream first
    analysis.audio.streamsToKeep.push(analysis.audio.englishStreams[0]);
  }
  
  // Add other language streams after English
  analysis.audio.streamsToKeep.push(...analysis.audio.otherLanguageStreams);
  
  // Add undefined streams last
  analysis.audio.streamsToKeep.push(...analysis.audio.undefinedStreams);
  
  // Streams to remove
  analysis.audio.streamsToRemove = [
    ...analysis.audio.englishStreams.slice(1), // Remove duplicate English streams
    ...analysis.audio.commentaryStreams // Remove all commentary streams
  ];

  // Check if audio processing is needed
  analysis.audio.needsProcessing = analysis.audio.englishStreams.length > 1 || 
                                   analysis.audio.commentaryStreams.length > 0;

  if (analysis.audio.needsProcessing) {
    if (analysis.audio.englishStreams.length > 1) {
      console.log(`🔄 Multiple English streams detected (${analysis.audio.englishStreams.length}) - deduplication needed`);
    }
    if (analysis.audio.commentaryStreams.length > 0) {
      console.log(`🔄 Commentary/Audio Description tracks detected (${analysis.audio.commentaryStreams.length}) - removal needed`);
    }
  } else {
    console.log('✓ Audio streams are already optimized');
  }
  
  // === SUBTITLE ANALYSIS ===
  console.log('\n━━━ Subtitle Stream Analysis ━━━');
  
  // Helper functions for subtitle analysis
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

  function isEnglishSubtitle(language, trackName) {
    const lang = (language || '').toLowerCase();
    const name = (trackName || '').toLowerCase();
    
    // Check language tag
    if (lang === 'eng' || lang === 'en' || lang === 'english') {
      return true;
    }
    
    // Check track name for English indicators
    const englishPatterns = [
      /\benglish\b/i,
      /\beng\b/i,
      /\ben\b/i
    ];
    
    return englishPatterns.some(pattern => pattern.test(name));
  }
  
  // Analyze subtitle streams - only process English subtitles
  // First, filter to only English subtitles to avoid processing hundreds of non-English tracks
  const englishSubtitles = subtitleTracks.filter(track => {
    const lang = track.language || '';
    const trackName = track.name || '';
    return isEnglishSubtitle(lang, trackName);
  });
  
  console.log(`Found ${subtitleTracks.length} total subtitle tracks, ${englishSubtitles.length} English tracks`);
  
  if (subtitleTracks.length > 20) {
    console.log(`⚠️ Large number of subtitle tracks detected (${subtitleTracks.length}) - processing only English tracks for efficiency`);
  }
  
  // Process only English subtitle tracks
  englishSubtitles.forEach(track => {
    const codec = track.codec.toLowerCase();
    const lang = track.language || '';
    const trackName = track.name || '';
    
    console.log(`Track ${track.id}: ${track.codec}`);
    console.log(`  Language: ${lang || 'undefined'}`);
    if (trackName) {
      console.log(`  Title: "${trackName}"`);
    }
    
    // Check if it's English (for default flag)
    if (!analysis.subtitles.englishTrackId) {
      analysis.subtitles.englishTrackId = track.id;
      console.log(`  → Marked as English default`);
    }
    
    // Categorize by type
    if (isBitmapSubtitle(codec)) {
      // Bitmap subtitle - discard
      analysis.subtitles.toDiscard.push({
        id: track.id,
        codec: track.codec,
        language: track.language,
        name: trackName
      });
      console.log(`  → DISCARD (bitmap subtitle)`);
      
    } else if (isSRTSubtitle(codec)) {
      // Already SRT - keep as is
      analysis.subtitles.toKeep.push({
        id: track.id,
        codec: track.codec,
        language: track.language,
        name: trackName
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
      
      analysis.subtitles.toConvert.push({
        id: track.id,
        codec: track.codec,
        language: track.language,
        name: trackName,
        format: format
      });
      console.log(`  → CONVERT (${format} to SRT)`);
      
    } else {
      // Unknown - try to convert
      analysis.subtitles.toConvert.push({
        id: track.id,
        codec: track.codec,
        language: track.language,
        name: trackName,
        format: 'unknown'
      });
      console.log(`  → CONVERT (unknown format)`);
    }
  });
  
  // Log non-English tracks that will be ignored
  const nonEnglishCount = subtitleTracks.length - englishSubtitles.length;
  if (nonEnglishCount > 0) {
    console.log(`  → Ignoring ${nonEnglishCount} non-English subtitle tracks`);
  }
  
  // Check if subtitle processing is needed
  analysis.subtitles.needsProcessing = analysis.subtitles.toConvert.length > 0 || 
                                       analysis.subtitles.toDiscard.length > 0;
  
 // === OVERALL PROCESSING DECISION ===
 console.log('\n━━━ Processing Decision Summary ━━━');
 
 // Video processing is only needed if we have multiple video tracks to filter
 const needsVideoProcessing = videoTracks.length > 1;
 const needsAudioProcessing = analysis.audio.needsProcessing;
 const needsSubtitleProcessing = analysis.subtitles.needsProcessing;
 const needsAnyProcessing = needsVideoProcessing || needsAudioProcessing || needsSubtitleProcessing;
 
 console.log(`Video processing needed: ${needsVideoProcessing ? 'YES' : 'NO'}`);
 console.log(`Audio processing needed: ${needsAudioProcessing ? 'YES' : 'NO'}`);
 console.log(`Subtitle processing needed: ${needsSubtitleProcessing ? 'YES' : 'NO'}`);
 
 if (needsAudioProcessing) {
   console.log(` - English streams to keep: ${analysis.audio.englishStreams.length > 0 ? 1 : 0}`);
   console.log(` - English streams to remove: ${Math.max(0, analysis.audio.englishStreams.length - 1)}`);
   console.log(` - Commentary streams to remove: ${analysis.audio.commentaryStreams.length}`);
   console.log(` - Other language streams to keep: ${analysis.audio.otherLanguageStreams.length}`);
 }
 
 if (needsSubtitleProcessing) {
   console.log(` - Subtitles to convert: ${analysis.subtitles.toConvert.length}`);
   console.log(` - Subtitles to keep: ${analysis.subtitles.toKeep.length}`);
   console.log(` - Subtitles to discard: ${analysis.subtitles.toDiscard.length}`);
 }
 
 if (!needsAnyProcessing) {
   console.log('✓ No processing needed - file is already optimized');
   args.variables.skipProcessing = true;
 } else {
   console.log('✓ Processing needed - will proceed to extraction and muxing');
   args.variables.skipProcessing = false;
 }
 
 // Store comprehensive analysis
 args.variables.mediaAnalysis = analysis;
 args.variables.needsProcessing = needsAnyProcessing;
  
  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables,
  };
};
