// Smart Media Preprocessor
// Single-stage preprocessing for problematic media files before standard Tdarr transcoding
// Handles: language detection from titles, subtitle conversion, stream filtering, compatibility optimization
module.exports = async (args) => {
  const fs = require('fs');
  const path = require('path');
  const { spawn, execFileSync } = require('child_process');

  args.jobLog('═══════════════════════════════════════');
  args.jobLog('   SMART MEDIA PREPROCESSOR');
  args.jobLog('═══════════════════════════════════════');

  const inputFile = args.inputFileObj._id || args.inputFileObj.file;
  const fileName = path.basename(inputFile);
  const ext = path.extname(fileName).toLowerCase().replace('.', '');
  const container = (args.inputFileObj.container || '').toLowerCase();
  
  // Support MKV, MP4, and AVI containers
  const isMKV = ext === 'mkv' || container === 'mkv' || container === 'matroska';
  const isMP4 = ext === 'mp4' || container === 'mp4' || ext === 'm4v';
  const isAVI = ext === 'avi' || container === 'avi';

  args.jobLog(`Input file: ${inputFile}`);
  args.jobLog(`Container: ${container} (${isMKV ? 'MKV' : isMP4 ? 'MP4' : isAVI ? 'AVI' : 'Unknown'})`);

  // Only process MKV, MP4, and AVI files
  if (!isMKV && !isMP4 && !isAVI) {
    args.jobLog('❌ Not MKV, MP4, or AVI — skipping preprocessing');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables,
    };
  }

  // Use Tdarr's ffmpeg path
  const ffmpegPath = args.deps.ffmpegPath || 'ffmpeg';
  const ffprobePath = args.deps.ffprobePath || 'ffprobe';
  
  args.jobLog(`Using ffmpeg: ${ffmpegPath}`);
  args.jobLog(`Using ffprobe: ${ffprobePath}`);

  try {
    // === STEP 1: DETERMINE FILE LOCATIONS AND WORKING DIRECTORY ===
    args.jobLog('\n━━━ Determining File Locations ━━━');
    
    // Get the original library file path
    const originalLibraryFile = args.originalLibraryFile?._id || inputFile;
    args.jobLog(`Original library file: ${originalLibraryFile}`);
    
    // Check if working directory exists and is provided
    const hasWorkingDir = args.workDir && args.workDir.trim() !== '';
    args.jobLog(`Working directory provided: ${hasWorkingDir ? 'Yes' : 'No'}`);
    if (hasWorkingDir) {
      args.jobLog(`Working directory: ${args.workDir}`);
    }
    
    // Determine working file path
    let workingDir, workingFile, sourceFile;
    
    if (hasWorkingDir) {
      workingDir = path.normalize(args.workDir);
      
      // Extract just the filename - be extremely aggressive about this
      let baseFileName = path.basename(inputFile);
      
      // Additional safety: if the basename still contains separators, extract manually
      if (baseFileName.includes('\\') || baseFileName.includes('/')) {
        const parts = baseFileName.split(/[\\\/]/);
        baseFileName = parts[parts.length - 1];
      }
      
      // Final safety: remove any remaining path artifacts using regex
      baseFileName = baseFileName.replace(/^.*[\\\/]/, '');
      
      // Ensure we have a valid filename
      if (!baseFileName || baseFileName.trim() === '') {
        throw new Error('Could not extract valid filename from input file path');
      }
      
      // Create the working file path using ONLY the filename
      workingFile = path.join(workingDir, baseFileName);
      
      // Normalize to prevent any path issues
      workingFile = path.normalize(workingFile);
      
      // Additional validation: ensure the working file path doesn't contain the input file's directory
      const inputFileDir = path.dirname(inputFile);
      if (workingFile.includes(inputFileDir) && inputFileDir !== workingDir) {
        args.jobLog(`⚠️ WARNING: Detected potential path nesting issue`);
        args.jobLog(`   Input file dir: ${inputFileDir}`);
        args.jobLog(`   Working dir: ${workingDir}`);
        args.jobLog(`   Reconstructing working file path...`);
        
        // Force reconstruction with just the filename
        workingFile = path.join(workingDir, baseFileName);
        workingFile = path.normalize(workingFile);
      }
      
      args.jobLog(`Extracted base filename: ${baseFileName}`);
      args.jobLog(`Normalized working directory: ${workingDir}`);
      args.jobLog(`Constructed working file path: ${workingFile}`);
      
      // Check if working directory exists
      if (!fs.existsSync(workingDir)) {
        args.jobLog(`⚠️ Working directory doesn't exist, creating: ${workingDir}`);
        try {
          fs.mkdirSync(workingDir, { recursive: true });
          args.jobLog(`✅ Created working directory`);
        } catch (error) {
          args.jobLog(`❌ Failed to create working directory: ${error.message}`);
          throw new Error(`Cannot create working directory: ${error.message}`);
        }
      }
      
      // Check if working file already exists
      const workingFileExists = fs.existsSync(workingFile);
      args.jobLog(`Working file exists: ${workingFileExists ? 'Yes' : 'No'}`);
      
      if (workingFileExists) {
        // Use existing working file
        sourceFile = workingFile;
        args.jobLog(`📁 Using existing working file: ${sourceFile}`);
      } else {
        // Use current input file (which may be library or already in working dir)
        sourceFile = inputFile;
        args.jobLog(`📚 Using input file, will output to working directory`);
        args.jobLog(`   Source: ${sourceFile}`);
        args.jobLog(`   Output: ${workingFile}`);
      }
    } else {
      // No working directory, work in-place with input file
      workingDir = path.dirname(inputFile);
      workingFile = inputFile;
      sourceFile = inputFile;
      args.jobLog(`📚 No working directory, processing input file in-place`);
    }
    
    // Verify source file exists
    if (!fs.existsSync(sourceFile)) {
      throw new Error(`Source file does not exist: ${sourceFile}`);
    }
    
    args.jobLog(`Final configuration:`);
    args.jobLog(`  Source file: ${sourceFile}`);
    args.jobLog(`  Output file: ${workingFile}`);
    args.jobLog(`  Working directory: ${workingDir}`);

    // === STEP 2: ANALYZE INPUT FILE ===
    args.jobLog('\n━━━ Analyzing Input File ━━━');
    
    let mediaInfo;
    try {
      const probeResult = execFileSync(ffprobePath, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        '-show_format',
        sourceFile
      ], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 });
      
      mediaInfo = JSON.parse(probeResult);
    } catch (error) {
      args.jobLog(`❌ Failed to analyze source file: ${error.message}`);
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 3,
        variables: args.variables,
      };
    }

    const streams = mediaInfo.streams || [];
    args.jobLog(`Found ${streams.length} streams total`);

    // Categorize streams
    const videoStreams = streams.filter(s => s.codec_type === 'video');
    const audioStreams = streams.filter(s => s.codec_type === 'audio');
    const subtitleStreams = streams.filter(s => s.codec_type === 'subtitle');

    args.jobLog(`  Video streams: ${videoStreams.length}`);
    args.jobLog(`  Audio streams: ${audioStreams.length}`);
    args.jobLog(`  Subtitle streams: ${subtitleStreams.length}`);

    // === STEP 2: ANALYZE AUDIO STREAMS ===
    args.jobLog('\n━━━ Analyzing Audio Streams ━━━');

    // Enhanced language detection patterns
    const languagePatterns = {
      eng: [
        /\benglish\b/i, /\beng\b/i, /\ben\b/i, /\ben[-_]us\b/i, /\ben[-_]gb\b/i,
        /\ben[-_]au\b/i, /\ben[-_]ca\b/i, /\benglish\s+audio\b/i
      ],
      jpn: [
        /\bjapanese\b/i, /\bjpn\b/i, /\bja\b/i, /\bja[-_]jp\b/i,
        /\bnihongo\b/i, /\b日本語\b/i, /\bjapanese\s+audio\b/i
      ],
      kor: [
        /\bkorean\b/i, /\bkor\b/i, /\bko\b/i, /\bko[-_]kr\b/i,
        /\bhangul\b/i, /\b한국어\b/i, /\bkorean\s+audio\b/i
      ],
      fre: [
        /\bfrench\b/i, /\bfre\b/i, /\bfr\b/i, /\bfr[-_]fr\b/i,
        /\bfrancais\b/i, /\bfrançais\b/i, /\bfrench\s+audio\b/i
      ]
    };

    // Commentary detection patterns
    const commentaryPatterns = [
      /commentary/i, /director.?s?\s+commentary/i, /cast\s+commentary/i,
      /production.*commentary/i, /design.*commentary/i, /audio\s+commentary/i,
      /filmmaker.*commentary/i, /writer.*commentary/i, /producer.*commentary/i,
      /behind.*scenes/i, /making.*of/i, /^commentary$/i, /\bcomm\b/i,
      /director.*track/i, /bonus.*audio/i, /audio\s+description/i,
      /descriptive\s+audio/i, /described\s+video/i, /\bad\b/i,
      /vision.*impaired/i, /accessibility/i
    ];

    function detectLanguage(stream) {
      const title = (stream.tags?.title || '').toLowerCase();
      const language = (stream.tags?.language || '').toLowerCase();
      
      // Check for commentary first (highest priority)
      const textToCheck = `${title} ${language}`.trim();
      if (commentaryPatterns.some(pattern => pattern.test(textToCheck))) {
        return 'commentary';
      }

      // Check if language tag is already a known ISO code (second priority)
      if (['eng', 'en', 'english'].includes(language)) return 'eng';
      if (['jpn', 'ja', 'japanese'].includes(language)) return 'jpn';
      if (['kor', 'ko', 'korean'].includes(language)) return 'kor';
      if (['fre', 'fr', 'french', 'fra'].includes(language)) return 'fre';

      // Check title for language patterns (third priority - more thorough)
      for (const [langCode, patterns] of Object.entries(languagePatterns)) {
        // Check title first (more specific)
        if (title && patterns.some(pattern => pattern.test(title))) {
          return langCode;
        }
      }

      // Check combined text as fallback (fourth priority)
      for (const [langCode, patterns] of Object.entries(languagePatterns)) {
        if (patterns.some(pattern => pattern.test(textToCheck))) {
          return langCode;
        }
      }

      // If we still can't detect, check for common language indicators in title
      if (title) {
        // Additional title-based detection for edge cases
        if (/\b(dub|dubbed)\b/i.test(title) && !/\b(sub|subtitle)\b/i.test(title)) {
          // If it says "dub" but no specific language, assume English dub
          return 'eng';
        }
        if (/\b(original|org)\b/i.test(title)) {
          // Original audio - could be any language, but often Japanese for anime
          // We'll still mark as unknown to let other logic handle it
        }
      }

      return 'unknown';
    }

    // Categorize audio streams
    const audioCategories = {
      english: [],
      japanese: [],
      korean: [],
      french: [],
      unknown: [],
      commentary: [],
      other: []
    };

    audioStreams.forEach((stream, index) => {
      const detectedLang = detectLanguage(stream);
      const title = stream.tags?.title || '';
      const language = stream.tags?.language || 'und';
      
      args.jobLog(`  Stream ${index}: "${title}" (${language}) → ${detectedLang}`);
      
      if (detectedLang === 'commentary') {
        audioCategories.commentary.push({ stream, index });
      } else if (detectedLang === 'eng') {
        audioCategories.english.push({ stream, index });
      } else if (detectedLang === 'jpn') {
        audioCategories.japanese.push({ stream, index });
      } else if (detectedLang === 'kor') {
        audioCategories.korean.push({ stream, index });
      } else if (detectedLang === 'fre') {
        audioCategories.french.push({ stream, index });
      } else if (detectedLang === 'unknown') {
        audioCategories.unknown.push({ stream, index });
      } else {
        audioCategories.other.push({ stream, index });
      }
    });

    args.jobLog(`Audio categorization:`);
    args.jobLog(`  English: ${audioCategories.english.length}`);
    args.jobLog(`  Japanese: ${audioCategories.japanese.length}`);
    args.jobLog(`  Korean: ${audioCategories.korean.length}`);
    args.jobLog(`  French: ${audioCategories.french.length}`);
    args.jobLog(`  Unknown: ${audioCategories.unknown.length}`);
    args.jobLog(`  Commentary: ${audioCategories.commentary.length}`);
    args.jobLog(`  Other: ${audioCategories.other.length}`);

    // Determine which audio streams to keep - prioritize single primary English track
    const keptAudioStreams = [];
    
    // Keep only the first English audio track (primary)
    if (audioCategories.english.length > 0) {
      keptAudioStreams.push(audioCategories.english[0]);
      args.jobLog(`Selected primary English audio track: stream ${audioCategories.english[0].index}`);
      
      if (audioCategories.english.length > 1) {
        args.jobLog(`⚠️ Skipping ${audioCategories.english.length - 1} additional English audio track(s)`);
      }
    }
    
    // Add other language tracks (Japanese, Korean, French)
    keptAudioStreams.push(
      ...audioCategories.japanese,
      ...audioCategories.korean,
      ...audioCategories.french
    );

    // Handle unknown language streams - if language is undetectable, keep only the first one
    if (audioCategories.unknown.length > 0) {
      if (audioCategories.unknown.length === 1) {
        // Only one unknown stream, keep it
        keptAudioStreams.push(audioCategories.unknown[0]);
        args.jobLog(`Keeping single unknown audio stream: stream ${audioCategories.unknown[0].index}`);
      } else {
        // Multiple unknown streams - keep only the first one
        keptAudioStreams.push(audioCategories.unknown[0]);
        args.jobLog(`⚠️ Multiple unknown audio streams detected (${audioCategories.unknown.length})`);
        args.jobLog(`   Language undetectable - keeping only first stream: ${audioCategories.unknown[0].index}`);
        args.jobLog(`   Skipping ${audioCategories.unknown.length - 1} additional unknown audio stream(s)`);
      }
    }

    // If no streams detected, keep all non-commentary streams as fallback
    if (keptAudioStreams.length === 0) {
      args.jobLog('⚠️ No supported language streams detected, keeping all non-commentary streams');
      keptAudioStreams.push(...audioCategories.other);
    }

    args.jobLog(`Keeping ${keptAudioStreams.length} audio streams`);

    // === STEP 3: ANALYZE SUBTITLE STREAMS ===
    args.jobLog('\n━━━ Analyzing Subtitle Streams ━━━');

    const keptSubtitleStreams = [];
    const subtitleConversions = [];
    const subtitleCategories = {
      english: [],
      unknown: []
    };

    subtitleStreams.forEach((stream, index) => {
      const title = (stream.tags?.title || '').toLowerCase();
      const language = (stream.tags?.language || '').toLowerCase();
      const codec = stream.codec_name || '';
      
      args.jobLog(`  Stream ${index}: "${stream.tags?.title || ''}" (${language}, ${codec})`);

      // Skip bitmap subtitles (not convertible to SRT)
      if (['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle'].includes(codec)) {
        args.jobLog(`    → Skipping (bitmap subtitle: ${codec})`);
        return;
      }

      // Check if it's English using enhanced detection
      const isEnglish = language === 'eng' || language === 'en' ||
                       languagePatterns.eng.some(pattern => pattern.test(`${title} ${language}`));

      if (isEnglish) {
        // Categorize as English
        const streamData = { stream, index, codec };
        subtitleCategories.english.push(streamData);
        args.jobLog(`    → Detected as English`);
      } else if (language === 'und' || language === '' || !language) {
        // Unknown/undefined language - could be English but undetectable
        const streamData = { stream, index, codec };
        subtitleCategories.unknown.push(streamData);
        args.jobLog(`    → Language undetectable (${language || 'undefined'})`);
      } else {
        // Non-English language, skip
        args.jobLog(`    → Skipping (not English: ${language})`);
        return;
      }
    });

    // Process English subtitle streams
    subtitleCategories.english.forEach(({ stream, index, codec }) => {
      if (['ass', 'ssa', 'webvtt', 'mov_text'].includes(codec)) {
        args.jobLog(`    → Will convert ${codec} to SRT (English)`);
        subtitleConversions.push({ stream, index, codec });
        keptSubtitleStreams.push({ stream, index, needsConversion: true });
      } else if (codec === 'subrip') {
        args.jobLog(`    → Keeping (already SRT, English)`);
        keptSubtitleStreams.push({ stream, index, needsConversion: false });
      } else {
        args.jobLog(`    → Keeping (${codec}, English)`);
        keptSubtitleStreams.push({ stream, index, needsConversion: false });
      }
    });

    // Handle unknown language subtitle streams - if language is undetectable, keep only the first one
    if (subtitleCategories.unknown.length > 0) {
      if (subtitleCategories.unknown.length === 1) {
        // Only one unknown stream, keep it
        const { stream, index, codec } = subtitleCategories.unknown[0];
        if (['ass', 'ssa', 'webvtt', 'mov_text'].includes(codec)) {
          args.jobLog(`    → Will convert ${codec} to SRT (unknown language)`);
          subtitleConversions.push({ stream, index, codec });
          keptSubtitleStreams.push({ stream, index, needsConversion: true });
        } else if (codec === 'subrip') {
          args.jobLog(`    → Keeping (already SRT, unknown language)`);
          keptSubtitleStreams.push({ stream, index, needsConversion: false });
        } else {
          args.jobLog(`    → Keeping (${codec}, unknown language)`);
          keptSubtitleStreams.push({ stream, index, needsConversion: false });
        }
      } else {
        // Multiple unknown streams - keep only the first one
        const { stream, index, codec } = subtitleCategories.unknown[0];
        args.jobLog(`⚠️ Multiple unknown subtitle streams detected (${subtitleCategories.unknown.length})`);
        args.jobLog(`   Language undetectable - keeping only first stream: ${index}`);
        args.jobLog(`   Skipping ${subtitleCategories.unknown.length - 1} additional unknown subtitle stream(s)`);
        
        if (['ass', 'ssa', 'webvtt', 'mov_text'].includes(codec)) {
          args.jobLog(`    → Will convert ${codec} to SRT (first unknown)`);
          subtitleConversions.push({ stream, index, codec });
          keptSubtitleStreams.push({ stream, index, needsConversion: true });
        } else if (codec === 'subrip') {
          args.jobLog(`    → Keeping (already SRT, first unknown)`);
          keptSubtitleStreams.push({ stream, index, needsConversion: false });
        } else {
          args.jobLog(`    → Keeping (${codec}, first unknown)`);
          keptSubtitleStreams.push({ stream, index, needsConversion: false });
        }
      }
    }

    args.jobLog(`Subtitle categorization:`);
    args.jobLog(`  English: ${subtitleCategories.english.length}`);
    args.jobLog(`  Unknown: ${subtitleCategories.unknown.length}`);
    args.jobLog(`Keeping ${keptSubtitleStreams.length} subtitle streams`);
    args.jobLog(`Need conversion: ${subtitleConversions.length} streams`);

    // === STEP 4: CHECK IF PROCESSING IS NEEDED ===
    const totalKeptStreams = videoStreams.length + keptAudioStreams.length + keptSubtitleStreams.length;
    const totalOriginalStreams = streams.length;
    const needsProcessing = totalKeptStreams < totalOriginalStreams || subtitleConversions.length > 0;

    if (!needsProcessing) {
      args.jobLog('\n✅ No preprocessing needed - file is already optimized');
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 1,
        variables: args.variables,
      };
    }

    args.jobLog(`\n🔄 Processing needed: ${totalOriginalStreams} → ${totalKeptStreams} streams`);

    // === STEP 5: BUILD FFMPEG COMMAND ===
    args.jobLog('\n━━━ Building FFmpeg Command ━━━');

    // Determine if we need MKV container for compatibility
    const needsSubtitleConversion = subtitleConversions.length > 0;
    const needsMKV = isAVI || needsSubtitleConversion;
    
    // Force MKV extension if needed for subtitle compatibility
    let outputFile = workingFile;
    if (needsMKV && !workingFile.toLowerCase().endsWith('.mkv')) {
      const baseName = workingFile.replace(/\.[^.]+$/, '');
      outputFile = baseName + '.mkv';
      args.jobLog(`⚠️ Container compatibility: Changing output to MKV format`);
      args.jobLog(`   Original: ${workingFile}`);
      args.jobLog(`   New: ${outputFile}`);
    }

    // Build FFmpeg command with error tolerance and timestamp normalization
    const ffmpegArgs = [
      // Input error handling flags - handle corrupted packets gracefully
      '-fflags', '+discardcorrupt+genpts+igndts',
      '-err_detect', 'ignore_err',
      '-i', sourceFile,
      '-map_metadata', '0', // Preserve metadata
      '-map_chapters', '0'  // Preserve chapters
    ];

    let outputStreamIndex = 0;

    // Map video streams (keep only the first one)
    if (videoStreams.length > 0) {
      ffmpegArgs.push('-map', '0:v:0');
      ffmpegArgs.push(`-c:v:${outputStreamIndex}`, 'copy');
      args.jobLog(`  Video ${outputStreamIndex}: stream 0:v:0 (copy)`);
      
      if (videoStreams.length > 1) {
        args.jobLog(`  ⚠️ Skipping ${videoStreams.length - 1} additional video stream(s)`);
      }
      
      outputStreamIndex++;
    }

    // Map audio streams (filtered) - use safer stream mapping
    let audioOutputIndex = 0;
    keptAudioStreams.forEach(({ stream, index }) => {
      // Use original stream index for safer mapping
      const audioIndex = audioStreams.findIndex(s => s.index === stream.index);
      if (audioIndex < 0) {
        throw new Error(`Internal mapping error: audio stream ${stream.index} not found`);
      }
      
      const streamSpec = `0:a:${audioIndex}`;
      ffmpegArgs.push('-map', streamSpec);
      ffmpegArgs.push(`-c:a:${audioOutputIndex}`, 'copy');
      
      // Set language metadata
      const detectedLang = detectLanguage(stream);
      const langCode = detectedLang === 'eng' ? 'eng' :
                      detectedLang === 'jpn' ? 'jpn' :
                      detectedLang === 'kor' ? 'kor' :
                      detectedLang === 'fre' ? 'fre' : 'und';
      
      ffmpegArgs.push(`-metadata:s:a:${audioOutputIndex}`, `language=${langCode}`);
      
      // Set first English stream as default
      if (audioOutputIndex === 0 && detectedLang === 'eng') {
        ffmpegArgs.push(`-disposition:a:${audioOutputIndex}`, 'default');
      } else {
        ffmpegArgs.push(`-disposition:a:${audioOutputIndex}`, '0');
      }
      
      args.jobLog(`  Audio ${audioOutputIndex}: ${streamSpec} (${langCode}, ${audioOutputIndex === 0 ? 'default' : 'non-default'})`);
      audioOutputIndex++;
    });

    // Map subtitle streams (filtered and converted) - use safer stream mapping
    let subtitleOutputIndex = 0;
    keptSubtitleStreams.forEach(({ stream, index, needsConversion }) => {
      // Use original stream index for safer mapping
      const subtitleIndex = subtitleStreams.findIndex(s => s.index === stream.index);
      if (subtitleIndex < 0) {
        throw new Error(`Internal mapping error: subtitle stream ${stream.index} not found`);
      }
      
      const streamSpec = `0:s:${subtitleIndex}`;
      ffmpegArgs.push('-map', streamSpec);
      
      if (needsConversion) {
        ffmpegArgs.push(`-c:s:${subtitleOutputIndex}`, 'srt');
        args.jobLog(`  Subtitle ${subtitleOutputIndex}: ${streamSpec} (convert to SRT)`);
      } else {
        ffmpegArgs.push(`-c:s:${subtitleOutputIndex}`, 'copy');
        args.jobLog(`  Subtitle ${subtitleOutputIndex}: ${streamSpec} (copy)`);
      }
      
      ffmpegArgs.push(`-metadata:s:s:${subtitleOutputIndex}`, 'language=eng');
      
      // Set first subtitle as default
      if (subtitleOutputIndex === 0) {
        ffmpegArgs.push(`-disposition:s:${subtitleOutputIndex}`, 'default');
      } else {
        ffmpegArgs.push(`-disposition:s:${subtitleOutputIndex}`, '0');
      }
      
      subtitleOutputIndex++;
    });

    // Add output muxing flags for better error tolerance and timestamp handling
    ffmpegArgs.push('-avoid_negative_ts', 'make_zero');
    ffmpegArgs.push('-max_interleave_delta', '0');
    
    // Add output file and overwrite flag
    ffmpegArgs.push('-y', outputFile);

    // Additional path validation and debugging
    args.jobLog(`\n━━━ Path Validation ━━━`);
    args.jobLog(`Input file path: ${inputFile}`);
    args.jobLog(`Source file path: ${sourceFile}`);
    args.jobLog(`Working directory: ${workingDir}`);
    args.jobLog(`Working file path: ${workingFile}`);
    args.jobLog(`Working file normalized: ${path.normalize(workingFile)}`);
    args.jobLog(`Working file resolved: ${path.resolve(workingFile)}`);
    
    // Validate that the working file path doesn't contain nested paths
    const workingFileDir = path.dirname(workingFile);
    const workingFileName = path.basename(workingFile);
    args.jobLog(`Working file directory: ${workingFileDir}`);
    args.jobLog(`Working file name: ${workingFileName}`);
    
    // Check if the working file path looks suspicious (contains the working dir twice)
    if (workingFile.includes(workingDir) && workingFile.indexOf(workingDir) !== workingFile.lastIndexOf(workingDir)) {
      args.jobLog(`⚠️ WARNING: Working file path may contain nested directories!`);
      args.jobLog(`   This could cause FFmpeg to fail with "No such file or directory"`);
    }
    
    // Ensure the working directory exists before FFmpeg execution
    if (!fs.existsSync(workingFileDir)) {
      args.jobLog(`⚠️ Working file directory doesn't exist, creating: ${workingFileDir}`);
      try {
        fs.mkdirSync(workingFileDir, { recursive: true });
        args.jobLog(`✅ Created working file directory`);
      } catch (error) {
        args.jobLog(`❌ Failed to create working file directory: ${error.message}`);
        throw new Error(`Cannot create working file directory: ${error.message}`);
      }
    }

    args.jobLog(`\nFinal FFmpeg command:`);
    args.jobLog(`${ffmpegPath} ${ffmpegArgs.join(' ')}`);

    // === STEP 6: EXECUTE FFMPEG ===
    args.jobLog('\n━━━ Executing FFmpeg ━━━');

    // Update worker status to show we're starting FFmpeg processing
    if (args.updateWorker) {
      args.updateWorker({
        CLIType: ffmpegPath,
        preset: ffmpegArgs.join(' '),
      });
    }

    await new Promise((resolve, reject) => {
      const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);
      
      let stderrData = '';
      let lastProgress = '';
      let lastPercentage = 0;
      
      ffmpegProcess.stderr.on('data', (data) => {
        const text = data.toString();
        stderrData += text;
        
        // Extract progress information for time-based progress
        const progressMatch = text.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
        if (progressMatch && progressMatch[1] !== lastProgress) {
          lastProgress = progressMatch[1];
          args.jobLog(`Progress: ${lastProgress}`);
          
          // Report progress to Tdarr server if updateWorker is available
          if (args.updateWorker) {
            // Convert time to percentage if we have duration info
            try {
              const currentTimeSeconds = timeToSeconds(progressMatch[1]);
              const inputDuration = args.inputFileObj?.ffProbeData?.format?.duration;
              
              if (inputDuration && currentTimeSeconds > 0) {
                const percentage = Math.min(Math.round((currentTimeSeconds / inputDuration) * 100), 100);
                
                // Only update if percentage changed significantly (avoid spam)
                if (percentage !== lastPercentage && percentage % 5 === 0) {
                  lastPercentage = percentage;
                  args.updateWorker({
                    CLIType: ffmpegPath,
                    preset: ffmpegArgs.join(' '),
                    percentage: percentage,
                  });
                  args.jobLog(`Re-muxing progress: ${percentage}%`);
                }
              }
            } catch (error) {
              // Fallback to basic progress reporting without percentage
              args.updateWorker({
                CLIType: ffmpegPath,
                preset: ffmpegArgs.join(' '),
                progress: lastProgress,
              });
            }
          }
        }
        
        // Log errors and warnings
        if (text.includes('Error') || text.includes('Warning')) {
          args.jobLog(`FFmpeg: ${text.trim()}`);
        }
      });
      
      ffmpegProcess.on('close', (code) => {
        if (code !== 0) {
          args.jobLog(`❌ FFmpeg failed with exit code ${code}`);
          args.jobLog(`Error output: ${stderrData}`);
          
          // Report failure to server
          if (args.updateWorker) {
            args.updateWorker({
              CLIType: ffmpegPath,
              preset: ffmpegArgs.join(' '),
              percentage: 0,
              error: `FFmpeg failed with exit code ${code}`,
            });
          }
          
          reject(new Error(`FFmpeg failed: ${stderrData}`));
        } else {
          args.jobLog('✅ FFmpeg completed successfully');
          
          // Report completion to server
          if (args.updateWorker) {
            args.updateWorker({
              CLIType: ffmpegPath,
              preset: ffmpegArgs.join(' '),
              percentage: 100,
            });
          }
          
          resolve();
        }
      });
      
      ffmpegProcess.on('error', (err) => {
        args.jobLog(`❌ Failed to start FFmpeg: ${err.message}`);
        
        // Report error to server
        if (args.updateWorker) {
          args.updateWorker({
            CLIType: ffmpegPath,
            preset: ffmpegArgs.join(' '),
            percentage: 0,
            error: `Failed to start FFmpeg: ${err.message}`,
          });
        }
        
        reject(err);
      });
    });

    // Helper function to convert time string to seconds
    function timeToSeconds(timeString) {
      const parts = timeString.split(':');
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      const seconds = parseFloat(parts[2]);
      return hours * 3600 + minutes * 60 + seconds;
    }

    // === STEP 7: VERIFY OUTPUT ===
    args.jobLog('\n━━━ Verifying Output ━━━');

    if (!fs.existsSync(outputFile)) {
      throw new Error(`Output file was not created: ${outputFile}`);
    }

    const sourceStats = fs.statSync(sourceFile);
    const outputStats = fs.statSync(outputFile);
    
    args.jobLog(`✅ Processing complete:`);
    args.jobLog(`  Source size: ${(sourceStats.size / 1024 / 1024).toFixed(2)} MB`);
    args.jobLog(`  Output size: ${(outputStats.size / 1024 / 1024).toFixed(2)} MB`);
    args.jobLog(`  Size change: ${((outputStats.size - sourceStats.size) / 1024 / 1024).toFixed(2)} MB`);
    args.jobLog(`  Streams: ${totalOriginalStreams} → ${totalKeptStreams}`);

    // === STEP 8: RETURN WORKING FILE ===
    args.jobLog('\n═══════════════════════════════════════');
    args.jobLog('   PREPROCESSING COMPLETE');
    args.jobLog('═══════════════════════════════════════');
    
    args.jobLog('✅ OPTIMIZATIONS APPLIED:');
    if (audioCategories.commentary.length > 0) {
      args.jobLog(`  🗑️ Removed ${audioCategories.commentary.length} commentary track(s)`);
    }
    if (audioCategories.other.length > 0) {
      args.jobLog(`  🗑️ Removed ${audioCategories.other.length} unwanted language track(s)`);
    }
    if (subtitleConversions.length > 0) {
      args.jobLog(`  🔄 Converted ${subtitleConversions.length} subtitle(s) to SRT`);
    }
    args.jobLog(`  📋 Kept ${keptAudioStreams.length} audio + ${keptSubtitleStreams.length} subtitle streams`);
    args.jobLog(`  🎯 English content prioritized for maximum compatibility`);

    // Signal that file was processed and needs replacement
    args.jobLog('🚨 IMPORTANT: File has been remuxed and MUST replace the original library file');
    args.jobLog('   Subsequent flow plugins should process this file regardless of other conditions');

    // Update the input file object to point to the processed output file
    // CRITICAL: Must return the full path to the output file, not just filename
    // Subsequent plugins expect _id to be a valid file path they can access
    // IMPORTANT: Normalize path separators to forward slashes for Tdarr compatibility
    
    const normalizedOutputFile = outputFile.replace(/\\/g, '/');
    
    args.jobLog(`Returning output file path: ${normalizedOutputFile}`);
    args.jobLog(`Output file created at: ${outputFile}`);
    
    const updatedFileObj = {
      ...args.inputFileObj,
      _id: normalizedOutputFile
    };

    return {
      outputFileObj: updatedFileObj,
      outputNumber: 2,
      variables: {
        ...args.variables,
        requiresReplacement: true,   // Custom flag for replacement
        remuxed: true,              // Indicate remuxing occurred
        preprocessed: true,         // General processing flag
        streamsRemoved: audioCategories.commentary.length + audioCategories.other.length + (subtitleStreams.length - keptSubtitleStreams.length),
        subtitlesConverted: subtitleConversions.length
      }
    };

  } catch (error) {
    args.jobLog(`❌ Preprocessing failed: ${error.message}`);
    
    // Clean up working file if it exists
    try {
      const hasWorkingDir = args.workDir && args.workDir.trim() !== '';
      
      let cleanupWorkingFile;
      if (hasWorkingDir) {
        const baseFileName = path.basename(inputFile);
        cleanupWorkingFile = path.join(args.workDir, baseFileName);
      } else {
        cleanupWorkingFile = inputFile;
      }
      
      // Only delete if it's a working file (not the original input file)
      if (fs.existsSync(cleanupWorkingFile) && cleanupWorkingFile !== inputFile) {
        fs.unlinkSync(cleanupWorkingFile);
        args.jobLog('✓ Cleaned up partial working file');
      }
    } catch (cleanupError) {
      args.jobLog('⚠️ Could not clean up working file');
    }
    
    // Return original file on failure
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 3,
      variables: args.variables,
    };
  }
};
