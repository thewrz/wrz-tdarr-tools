// Stage 2: Clean and Organize Extracted Streams
// Inspects extracted files, deletes unwanted ones, converts subtitles to SRT
module.exports = async (args) => {
  const fs = require('fs');
  const path = require('path');
  const { spawn, execFileSync } = require('child_process');

  args.jobLog('═══════════════════════════════════════');
  args.jobLog('   STAGE 2: CLEAN AND ORGANIZE');
  args.jobLog('═══════════════════════════════════════');

  const extractDir = args.variables.extractDir;
  const sessionId = args.variables.sessionId;
  const containerType = args.variables.containerType;

  if (!extractDir || !fs.existsSync(extractDir)) {
    args.jobLog('❌ No extraction directory found');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables,
      processFile: false
    };
  }

  args.jobLog(`Session ID: ${sessionId}`);
  args.jobLog(`Working directory: ${extractDir}`);

  // Get original track metadata (needed for both audio and subtitle processing)
  const trackMetadata = args.variables.trackMetadata || {};

  // Get all extracted files
  const allFiles = fs.readdirSync(extractDir);
  args.jobLog(`Found ${allFiles.length} extracted files`);

  // Categorize files
  const videoFiles = [];
  const audioFiles = [];
  const subtitleFiles = [];

  allFiles.forEach(file => {
    const filePath = path.join(extractDir, file);
    const stats = fs.statSync(filePath);
    
    if (file.includes('_video_') || file.includes('_h264') || file.includes('_h265') || file.includes('_vp9')) {
      videoFiles.push({ file, path: filePath, size: stats.size });
    } else if (file.includes('_audio_') || file.includes('_aac') || file.includes('_ac3') || file.includes('_dts') || file.includes('_flac')) {
      audioFiles.push({ file, path: filePath, size: stats.size });
    } else if (file.includes('_subtitle') || file.includes('_srt') || file.includes('_ass') || file.includes('_vtt') || file.includes('_sup') || file.includes('_sub') || file.includes('_txt')) {
      subtitleFiles.push({ file, path: filePath, size: stats.size });
    }
  });

  args.jobLog(`\nCategorized files:`);
  args.jobLog(`  Video: ${videoFiles.length}`);
  args.jobLog(`  Audio: ${audioFiles.length}`);
  args.jobLog(`  Subtitles: ${subtitleFiles.length}`);

  // Helper function to resolve binary paths
  function resolveBin(candidates) {
    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }
    return null;
  }

  // === CLEAN VIDEO FILES ===
  args.jobLog('\n━━━ Processing Video Files ━━━');
  let keptVideoFile = null;

  if (videoFiles.length === 0) {
    args.jobLog('❌ No video files found');
  } else if (videoFiles.length === 1) {
    keptVideoFile = videoFiles[0];
    args.jobLog(`✓ Keeping single video file: ${keptVideoFile.file}`);
  } else {
    // Keep the first (usually main) video file, delete others
    keptVideoFile = videoFiles[0];
    args.jobLog(`✓ Keeping first video file: ${keptVideoFile.file}`);
    
    for (let i = 1; i < videoFiles.length; i++) {
      try {
        fs.unlinkSync(videoFiles[i].path);
        args.jobLog(`  🗑️ Deleted extra video file: ${videoFiles[i].file}`);
      } catch (error) {
        args.jobLog(`  ⚠️ Could not delete ${videoFiles[i].file}: ${error.message}`);
      }
    }
  }

  // === CLEAN AUDIO FILES ===
  args.jobLog('\n━━━ Processing Audio Files ━━━');
  const keptAudioFiles = [];

  if (audioFiles.length === 0) {
    args.jobLog('❌ No audio files found');
  } else {
    args.jobLog(`Processing ${audioFiles.length} audio files...`);

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

    function isCommentaryTrack(title, language) {
      const textToCheck = `${title} ${language}`.toLowerCase().trim();
      if (!textToCheck) return false;
      
      return commentaryPatterns.some(pattern => pattern.test(textToCheck));
    }

    // Language detection patterns for title/language inspection
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
      ]
    };

    function detectLanguageFromTitleOrTag(title, languageTag) {
      const textToCheck = `${title} ${languageTag}`.toLowerCase().trim();
      
      for (const [isoCode, patterns] of Object.entries(languagePatterns)) {
        if (patterns.some(pattern => pattern.test(textToCheck))) {
          return isoCode;
        }
      }
      
      // Check if language tag is already a known code
      const langLower = (languageTag || '').toLowerCase();
      if (langLower === 'eng' || langLower === 'en' || langLower === 'english') return 'eng';
      if (langLower === 'jpn' || langLower === 'ja' || langLower === 'japanese') return 'jpn';
      if (langLower === 'kor' || langLower === 'ko' || langLower === 'korean') return 'kor';
      
      return null;
    }

    // Categorize audio files by language/type using original metadata
    const englishAudio = [];
    const japaneseAudio = [];
    const koreanAudio = [];
    const untaggedAudio = [];
    const otherAudio = [];
    const commentaryAudio = [];

    audioFiles.forEach(audioFile => {
      // Extract track ID from filename (e.g., "track_1_audio_ac3" -> track ID 1)
      const trackIdMatch = audioFile.file.match(/track_(\d+)_/);
      const trackId = trackIdMatch ? parseInt(trackIdMatch[1]) : null;
      
      // Get original metadata for this track
      const metadata = trackId !== null ? trackMetadata[trackId] : null;
      const originalTitle = metadata ? metadata.title : '';
      const originalLanguage = metadata ? metadata.language : '';
      
      args.jobLog(`  Analyzing track ${trackId}: "${originalTitle}" (${originalLanguage})`);
      
      // Check for commentary first using original title and language
      if (isCommentaryTrack(originalTitle, originalLanguage)) {
        commentaryAudio.push(audioFile);
        args.jobLog(`    → Commentary detected`);
        return;
      }

      // Detect language from original title and language tag
      const detectedLanguage = detectLanguageFromTitleOrTag(originalTitle, originalLanguage);
      
      if (detectedLanguage === 'eng') {
        englishAudio.push(audioFile);
        args.jobLog(`    → English detected`);
      } else if (detectedLanguage === 'jpn') {
        japaneseAudio.push(audioFile);
        args.jobLog(`    → Japanese detected`);
      } else if (detectedLanguage === 'kor') {
        koreanAudio.push(audioFile);
        args.jobLog(`    → Korean detected`);
      } else if (!originalLanguage || originalLanguage === 'und' || originalLanguage === 'undefined') {
        // No language information available
        untaggedAudio.push(audioFile);
        args.jobLog(`    → Untagged (no language info)`);
      } else {
        // Check if it's a common foreign language to exclude
        const foreignLanguages = ['spa', 'fre', 'ger', 'ita', 'chi', 'rus', 'por', 'dut', 'swe', 'nor', 'dan', 'fin', 'pol', 'cze', 'hun', 'gre', 'tur', 'ara', 'heb', 'hin', 'tha', 'vie'];
        const isKnownForeign = foreignLanguages.some(lang => 
          originalLanguage.toLowerCase().includes(lang) || originalTitle.toLowerCase().includes(lang)
        );
        
        if (isKnownForeign) {
          otherAudio.push(audioFile);
          args.jobLog(`    → Other foreign language`);
        } else {
          // Unknown language, treat as untagged
          untaggedAudio.push(audioFile);
          args.jobLog(`    → Unknown language, treating as untagged`);
        }
      }
    });

    args.jobLog(`  Categorized audio streams:`);
    args.jobLog(`    English: ${englishAudio.length}`);
    args.jobLog(`    Japanese: ${japaneseAudio.length}`);
    args.jobLog(`    Korean: ${koreanAudio.length}`);
    args.jobLog(`    Untagged: ${untaggedAudio.length}`);
    args.jobLog(`    Other languages: ${otherAudio.length}`);
    args.jobLog(`    Commentary: ${commentaryAudio.length}`);

    // Delete commentary tracks
    commentaryAudio.forEach(audioFile => {
      try {
        fs.unlinkSync(audioFile.path);
        args.jobLog(`  🗑️ Deleted commentary audio: ${audioFile.file}`);
      } catch (error) {
        args.jobLog(`  ⚠️ Could not delete ${audioFile.file}: ${error.message}`);
      }
    });

    // Delete other language tracks (not English, Japanese, Korean, or untagged)
    otherAudio.forEach(audioFile => {
      try {
        fs.unlinkSync(audioFile.path);
        args.jobLog(`  🗑️ Deleted other language audio: ${audioFile.file}`);
      } catch (error) {
        args.jobLog(`  ⚠️ Could not delete ${audioFile.file}: ${error.message}`);
      }
    });

    // Keep desired audio tracks in priority order: English first, then Japanese, Korean, untagged
    const audioOrder = [
      ...englishAudio,
      ...japaneseAudio, 
      ...koreanAudio,
      ...untaggedAudio
    ];

    audioOrder.forEach((audioFile, index) => {
      keptAudioFiles.push(audioFile);
      const type = englishAudio.includes(audioFile) ? 'English' :
                   japaneseAudio.includes(audioFile) ? 'Japanese' :
                   koreanAudio.includes(audioFile) ? 'Korean' : 'Untagged';
      args.jobLog(`  ✓ Keeping audio file ${index + 1}: ${audioFile.file} (${type})`);
    });
  }

  // === CLEAN AND CONVERT SUBTITLE FILES ===
  args.jobLog('\n━━━ Processing Subtitle Files ━━━');
  const keptSubtitleFiles = [];

  if (subtitleFiles.length === 0) {
    args.jobLog('No subtitle files found');
  } else {
    args.jobLog(`Processing ${subtitleFiles.length} subtitle files...`);

    for (const subFile of subtitleFiles) {
      // Extract track ID from filename (e.g., "track_12_subtitles_srt" -> track ID 12)
      const trackIdMatch = subFile.file.match(/track_(\d+)_/);
      const trackId = trackIdMatch ? parseInt(trackIdMatch[1]) : null;
      
      // Get original metadata for this track
      const metadata = trackId !== null ? trackMetadata[trackId] : null;
      const originalTitle = metadata ? metadata.title : '';
      const originalLanguage = metadata ? metadata.language : '';
      
      args.jobLog(`  Analyzing track ${trackId}: "${originalTitle}" (${originalLanguage})`);
      
      // Check if it's English using original metadata
      const isEnglish = originalLanguage === 'eng' || 
                       originalLanguage === 'en' ||
                       /\benglish\b/i.test(originalTitle) ||
                       /\beng\b/i.test(originalTitle);

      if (!isEnglish) {
        try {
          fs.unlinkSync(subFile.path);
          args.jobLog(`    🗑️ Deleted non-English subtitle: ${subFile.file}`);
        } catch (error) {
          args.jobLog(`    ⚠️ Could not delete ${subFile.file}: ${error.message}`);
        }
        continue;
      }

      // Check if it's a bitmap subtitle (PGS/SUP) - delete these
      const fileName = subFile.file.toLowerCase();
      if (fileName.includes('_sup') || fileName.includes('pgs')) {
        try {
          fs.unlinkSync(subFile.path);
          args.jobLog(`    🗑️ Deleted bitmap subtitle: ${subFile.file}`);
        } catch (error) {
          args.jobLog(`    ⚠️ Could not delete ${subFile.file}: ${error.message}`);
        }
        continue;
      }

      // If it's already SRT, keep it
      if (fileName.includes('_srt')) {
        keptSubtitleFiles.push(subFile);
        args.jobLog(`    ✓ Keeping English SRT subtitle: ${subFile.file}`);
        continue;
      }

      // Convert other text formats to SRT
      if (fileName.includes('_ass') || fileName.includes('_vtt') || fileName.includes('_txt')) {
        const ffmpegExe = 'ffmpeg';

        const srtFileName = subFile.file.replace(/\.(ass|vtt|txt|sub)$/, '.srt');
        const srtFilePath = path.join(extractDir, srtFileName);

        try {
          args.jobLog(`    🔄 Converting ${subFile.file} to SRT...`);
          
          args.jobLog(`Starting ffmpeg subtitle conversion: ${ffmpegExe} -v verbose -i ${subFile.path} -c:s srt -y ${srtFilePath}`);
          await new Promise((resolve, reject) => {
            const convertProcess = spawn(ffmpegExe, [
              '-v', 'verbose',
              '-i', subFile.path,
              '-c:s', 'srt',
              '-y',
              srtFilePath
            ]);

            let stderrData = '';
            
            convertProcess.stderr.on('data', (data) => {
              const text = data.toString();
              stderrData += text;
              args.jobLog(`ffmpeg subtitle conversion stderr: ${text.trim()}`);
            });

            convertProcess.on('close', (code) => {
              args.jobLog(`ffmpeg subtitle conversion completed with exit code: ${code}`);
              if (code !== 0) {
                args.jobLog(`      ❌ Conversion failed: ${stderrData}`);
                args.jobLog(`Subtitle conversion failed: ${stderrData}`);
                reject(new Error(`Conversion failed: ${stderrData}`));
              } else {
                args.jobLog(`      ✓ Converted to ${srtFileName}`);
                args.jobLog(`Successfully converted subtitle to ${srtFileName}`);
                resolve();
              }
            });

            convertProcess.on('error', (err) => {
              args.jobLog(`      ❌ Conversion error: ${err.message}`);
              args.jobLog(`ffmpeg subtitle conversion error: ${err.message}`);
              reject(err);
            });
          });

          // Delete original file and add converted SRT
          fs.unlinkSync(subFile.path);
          const srtStats = fs.statSync(srtFilePath);
          keptSubtitleFiles.push({ 
            file: srtFileName, 
            path: srtFilePath, 
            size: srtStats.size 
          });

        } catch (error) {
          args.jobLog(`      ❌ Failed to convert ${subFile.file}: ${error.message}`);
          // Keep original file if conversion fails
          keptSubtitleFiles.push(subFile);
        }
      } else {
        // Unknown subtitle format, keep it for now
        keptSubtitleFiles.push(subFile);
        args.jobLog(`    ⚠️ Unknown subtitle format, keeping: ${subFile.file}`);
      }
    }
  }

  // === SUMMARY ===
  args.jobLog('\n━━━ Cleaning Summary ━━━');
  args.jobLog(`✓ Video files: ${keptVideoFile ? 1 : 0}`);
  args.jobLog(`✓ Audio files: ${keptAudioFiles.length}`);
  args.jobLog(`✓ Subtitle files: ${keptSubtitleFiles.length}`);

  // Store results for next stage
  args.variables.finalVideoFile = keptVideoFile;
  args.variables.finalAudioFiles = keptAudioFiles;
  args.variables.finalSubtitleFiles = keptSubtitleFiles;

  // Check if we have anything to work with
  if (!keptVideoFile && keptAudioFiles.length === 0) {
    args.jobLog('❌ No video or audio files to process');
    
    // Clean up
    try {
      fs.rmSync(extractDir, { recursive: true, force: true });
    } catch (error) {
      args.jobLog(`⚠️ Could not clean up directory: ${error.message}`);
    }
    
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables,
      processFile: false
    };
  }

  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables
  };
};
