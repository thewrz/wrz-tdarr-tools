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

    // Helper function to validate if an audio stream contains actual data and can be safely muxed
    function validateAudioStream(stream, index) {
      const codec = stream.codec_name || '';
      const duration = parseFloat(stream.duration) || 0;
      const tags = stream.tags || {};
      
      // Get audio properties from multiple sources for cross-validation
      const streamBitRate = parseInt(stream.bit_rate || '0', 10);
      const tagBitRate = parseInt(tags.BPS || tags['BPS-eng'] || '0', 10);
      const sampleRate = parseInt(stream.sample_rate || '0', 10);
      const channels = parseInt(stream.channels || '0', 10);
      
      // Extract frame and byte counts from tags
      const frameCount = parseInt(tags.NUMBER_OF_FRAMES || tags['NUMBER_OF_FRAMES-eng'] || '0', 10);
      const byteCount = parseInt(tags.NUMBER_OF_BYTES || tags['NUMBER_OF_BYTES-eng'] || '0', 10);
      
      // Cross-reference with MediaInfo data if available
      let mediaInfoAudio = null;
      if (args.inputFileObj?.mediaInfo?.track) {
        // Find corresponding audio track in MediaInfo (by stream order)
        const audioTracks = args.inputFileObj.mediaInfo.track.filter(t => t['@type'] === 'Audio');
        if (audioTracks[index]) {
          mediaInfoAudio = audioTracks[index];
        }
      }
      
      // Get MediaInfo properties for cross-validation
      let mediaInfoBitRate = 0;
      let mediaInfoSampleRate = 0;
      let mediaInfoChannels = 0;
      let mediaInfoStreamSize = 0;
      let mediaInfoFrameCount = 0;
      
      if (mediaInfoAudio) {
        mediaInfoBitRate = parseInt(mediaInfoAudio.BitRate || '0', 10);
        mediaInfoSampleRate = parseInt(mediaInfoAudio.SamplingRate || '0', 10);
        mediaInfoChannels = parseInt(mediaInfoAudio.Channels || '0', 10);
        mediaInfoStreamSize = parseInt(mediaInfoAudio.StreamSize || '0', 10);
        mediaInfoFrameCount = parseInt(mediaInfoAudio.FrameCount || '0', 10);
      }
      
      // Use the best available bitrate (prefer stream, then MediaInfo, then tags)
      const bestBitRate = streamBitRate > 0 ? streamBitRate : 
                         mediaInfoBitRate > 0 ? mediaInfoBitRate : 
                         tagBitRate;
      
      // Use the best available sample rate
      const bestSampleRate = sampleRate > 0 ? sampleRate : mediaInfoSampleRate;
      
      // Use the best available channel count
      const bestChannels = channels > 0 ? channels : mediaInfoChannels;
      
      // Use the best available stream size (prefer MediaInfo, then tags)
      const bestStreamSize = mediaInfoStreamSize > 0 ? mediaInfoStreamSize : byteCount;
      
      // Use the best available frame count (prefer MediaInfo, then tags)
      const bestFrameCount = mediaInfoFrameCount > 0 ? mediaInfoFrameCount : frameCount;
      
      args.jobLog(`    → Audio validation data:`);
      args.jobLog(`      FFprobe: ${streamBitRate} bps, ${sampleRate} Hz, ${channels} ch, ${frameCount} frames, ${byteCount} bytes`);
      if (mediaInfoAudio) {
        args.jobLog(`      MediaInfo: ${mediaInfoBitRate} bps, ${mediaInfoSampleRate} Hz, ${mediaInfoChannels} ch, ${mediaInfoFrameCount} frames, ${mediaInfoStreamSize} bytes`);
      }
      args.jobLog(`      Best values: ${bestBitRate} bps, ${bestSampleRate} Hz, ${bestChannels} ch, ${bestFrameCount} frames, ${bestStreamSize} bytes`);
      
      // Check for missing essential stream properties first
      if (!stream.codec_name || stream.codec_name.trim() === '') {
        args.jobLog(`    → Validation FAILED: Audio stream missing codec information`);
        return false;
      }
      
      // Check for invalid channel count (must have at least 1 channel)
      if (bestChannels === 0) {
        args.jobLog(`    → Validation FAILED: Audio stream has 0 channels`);
        return false;
      }
      
      // Check for unreasonable channel counts (more than 32 channels is suspicious)
      if (bestChannels > 32) {
        args.jobLog(`    → Validation FAILED: Audio stream has unreasonable channel count (${bestChannels})`);
        return false;
      }
      
      // Check for invalid sample rates
      if (bestSampleRate > 0 && (bestSampleRate < 8000 || bestSampleRate > 192000)) {
        args.jobLog(`    → Validation FAILED: Audio stream has invalid sample rate (${bestSampleRate} Hz)`);
        return false;
      }
      
      // Check for completely empty streams (all indicators are zero)
      if (bestFrameCount === 0 && bestStreamSize === 0 && bestBitRate === 0) {
        args.jobLog(`    → Validation FAILED: Audio stream is completely empty (0 frames, 0 bytes, 0 bitrate)`);
        return false;
      }
      
      // Check for streams with zero duration AND zero frames (but be more lenient with cross-validation)
      if (duration === 0 && bestFrameCount === 0 && bestStreamSize === 0) {
        args.jobLog(`    → Validation FAILED: Audio stream has 0 duration, 0 frames, and 0 bytes`);
        return false;
      }
      
      // Check for suspiciously small audio streams (but only if we have reliable data)
      if (bestStreamSize > 0 && bestStreamSize < 1000 && bestFrameCount === 0 && duration > 10) {
        args.jobLog(`    → Validation FAILED: Audio stream too small (${bestStreamSize} bytes, 0 frames) for ${duration.toFixed(2)}s duration - likely corrupted`);
        return false;
      }
      
      // Validate bitrate reasonableness (if we have duration and size)
      if (duration > 0 && bestStreamSize > 0) {
        const calculatedBitRate = Math.round((bestStreamSize * 8) / duration);
        const reportedBitRate = bestBitRate;
        
        // Allow for some variance in bitrate calculations (±50% tolerance)
        if (reportedBitRate > 0 && calculatedBitRate > 0) {
          const variance = Math.abs(calculatedBitRate - reportedBitRate) / reportedBitRate;
          if (variance > 0.5 && reportedBitRate < 1000) {
            args.jobLog(`    → Validation WARNING: Large bitrate variance (calculated: ${calculatedBitRate}, reported: ${reportedBitRate})`);
            // Don't fail on this alone, just warn
          }
        }
      }
      
      // Additional validation for specific codecs
      if (['mp3', 'aac', 'ac3', 'eac3', 'dts', 'flac', 'pcm'].includes(codec.toLowerCase())) {
        // For common audio codecs, we expect reasonable bitrates
        if (bestBitRate > 0 && bestBitRate < 32000 && duration > 60) {
          args.jobLog(`    → Validation WARNING: Low bitrate (${bestBitRate} bps) for ${codec} codec`);
          // Don't fail on this alone for common codecs, just warn
        }
      }
      
      // CRITICAL: Enhanced validation using FFprobe to detect muxing-level corruption
      // This catches streams that will cause "Error submitting a packet to the muxer" errors
      try {
        args.jobLog(`    → Running deep FFprobe validation for audio stream ${index}...`);
        
        // Test the stream by attempting to read a few packets
        const deepProbeResult = execFileSync(ffprobePath, [
          '-v', 'error',
          '-select_streams', `a:${index}`,
          '-show_entries', 'packet=pts,dts,size,flags',
          '-read_intervals', '%+#5',  // Read only first 5 packets for speed
          '-of', 'csv=p=0',
          sourceFile
        ], { encoding: 'utf8', timeout: 10000 });
        
        const packets = deepProbeResult.trim().split('\n').filter(line => line.trim());
        args.jobLog(`    → Deep probe found ${packets.length} packets in first 5 frames`);
        
        if (packets.length === 0) {
          args.jobLog(`    → Validation FAILED: No audio packets found - stream is empty or corrupted`);
          return false;
        }
        
        // Analyze packet data for corruption indicators
        let corruptedPackets = 0;
        let validPackets = 0;
        
        packets.forEach((packet, packetIndex) => {
          const parts = packet.split(',');
          if (parts.length >= 3) {
            const pts = parts[0] || 'N/A';
            const dts = parts[1] || 'N/A';
            const size = parseInt(parts[2] || '0', 10);
            
            // Check for invalid packet sizes
            if (size === 0) {
              corruptedPackets++;
              args.jobLog(`    → Packet ${packetIndex}: size=0 (corrupted)`);
            } else if (size > 0 && size < 1000000) { // Reasonable size limit
              validPackets++;
            } else {
              corruptedPackets++;
              args.jobLog(`    → Packet ${packetIndex}: size=${size} (suspicious)`);
            }
            
            // Check for invalid timestamps (both PTS and DTS are N/A)
            if (pts === 'N/A' && dts === 'N/A') {
              args.jobLog(`    → Packet ${packetIndex}: missing timestamps (potential corruption)`);
            }
          }
        });
        
        // If more than 50% of packets are corrupted, fail validation
        if (corruptedPackets > validPackets) {
          args.jobLog(`    → Validation FAILED: ${corruptedPackets}/${packets.length} packets corrupted - stream will cause muxing errors`);
          return false;
        }
        
        args.jobLog(`    → Deep probe validation: ${validPackets} valid, ${corruptedPackets} corrupted packets`);
        
      } catch (deepProbeError) {
        args.jobLog(`    → Deep probe validation failed: ${deepProbeError.message}`);
        
        // If we can't probe the stream at packet level, it's likely corrupted
        // But only fail if we also have other indicators of corruption
        if (bestFrameCount === 0 || bestStreamSize === 0) {
          args.jobLog(`    → Validation FAILED: Cannot probe packets AND stream has empty indicators - likely corrupted`);
          return false;
        } else {
          args.jobLog(`    → Deep probe failed but stream has valid indicators - allowing with warning`);
        }
      }
      
      // CRITICAL: Additional muxing compatibility test for problematic codecs
      if (['eac3', 'ac3', 'dts', 'truehd'].includes(codec.toLowerCase())) {
        try {
          args.jobLog(`    → Testing muxing compatibility for ${codec} codec...`);
          
          // Test if the stream can be copied without errors by doing a very short test mux
          const testOutputFile = path.join(path.dirname(sourceFile), `test_audio_${index}_${Date.now()}.mkv`);
          
          const testResult = execFileSync(ffmpegPath, [
            '-v', 'error',
            '-i', sourceFile,
            '-map', `0:a:${index}`,
            '-c:a', 'copy',
            '-t', '1',  // Only process 1 second
            '-f', 'matroska',
            '-y', testOutputFile
          ], { encoding: 'utf8', timeout: 15000 });
          
          // Clean up test file
          if (fs.existsSync(testOutputFile)) {
            fs.unlinkSync(testOutputFile);
          }
          
          args.jobLog(`    → Muxing compatibility test PASSED for ${codec}`);
          
        } catch (muxTestError) {
          args.jobLog(`    → Muxing compatibility test FAILED for ${codec}: ${muxTestError.message}`);
          
          // Check if the error is related to muxing issues that would cause our main problem
          const errorOutput = muxTestError.stderr || muxTestError.stdout || muxTestError.message || '';
          if (errorOutput.includes('Error submitting a packet to the muxer') ||
              errorOutput.includes('Invalid argument') ||
              errorOutput.includes('Error muxing a packet')) {
            args.jobLog(`    → Validation FAILED: Stream will cause muxing errors - ${errorOutput.substring(0, 200)}`);
            return false;
          } else {
            args.jobLog(`    → Muxing test failed but not due to packet submission errors - allowing with warning`);
          }
        }
      }
      
      // Final validation: if we have MediaInfo data that contradicts FFprobe significantly, prefer MediaInfo
      if (mediaInfoAudio && bestStreamSize === 0 && mediaInfoStreamSize > 0) {
        args.jobLog(`    → Validation NOTE: Using MediaInfo data over FFprobe (MediaInfo shows ${mediaInfoStreamSize} bytes)`);
      }
      
      args.jobLog(`    → Validation PASSED: ${bestFrameCount} frames, ${bestStreamSize} bytes, ${bestBitRate} bps, ${bestChannels} ch, ${bestSampleRate} Hz`);
      return true;
    }

    audioStreams.forEach((stream, index) => {
      const detectedLang = detectLanguage(stream);
      const title = stream.tags?.title || '';
      const language = stream.tags?.language || 'und';
      
      args.jobLog(`  Stream ${index}: "${title}" (${language}) → ${detectedLang}`);
      
      // Validate that the audio stream contains actual data
      if (!validateAudioStream(stream, index)) {
        args.jobLog(`    → Skipping (failed validation - empty or corrupted audio stream)`);
        return;
      }
      
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

    // Helper function to validate if a subtitle stream contains actual data and has proper codec parameters
    function validateSubtitleStream(stream, index) {
      const codec = stream.codec_name || '';
      const duration = parseFloat(stream.duration) || 0;
      const tags = stream.tags || {};
      
      // Extract frame and byte counts from tags (common in many containers)
      const frameCount = parseInt(tags.NUMBER_OF_FRAMES || tags['NUMBER_OF_FRAMES-eng'] || '0', 10);
      const byteCount = parseInt(tags.NUMBER_OF_BYTES || tags['NUMBER_OF_BYTES-eng'] || '0', 10);
      const bitRate = parseInt(tags.BPS || tags['BPS-eng'] || stream.bit_rate || '0', 10);
      
      // Get additional stream properties for comprehensive validation
      const streamDuration = parseFloat(tags.DURATION || tags['DURATION-eng'] || '0');
      const width = parseInt(stream.width || '0', 10);
      const height = parseInt(stream.height || '0', 10);
      
      args.jobLog(`    → Subtitle validation data: ${frameCount} frames, ${byteCount} bytes, ${bitRate} bps, ${duration.toFixed(2)}s duration, ${width}x${height}`);
      
      // Check for missing essential stream properties first
      if (!stream.codec_name || stream.codec_name.trim() === '') {
        args.jobLog(`    → Validation FAILED: Stream missing codec information`);
        return false;
      }
      
      // CRITICAL: Check for streams that will cause "unspecified size" errors in FFmpeg
      // This is the exact issue from the error log: "Could not find codec parameters for stream 3 (Subtitle: hdmv_pgs_subtitle (pgssub)): unspecified size"
      if (['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle'].includes(codec)) {
        // For bitmap subtitles, missing width/height indicates codec parameter issues
        if (width === 0 && height === 0) {
          args.jobLog(`    → Validation FAILED: Bitmap subtitle ${codec} has unspecified size (${width}x${height}) - will cause FFmpeg "unspecified size" error`);
          return false;
        }
        
        // Additional check: if width OR height is missing (not both zero, but one missing)
        if ((width === 0 && height > 0) || (width > 0 && height === 0)) {
          args.jobLog(`    → Validation FAILED: Bitmap subtitle ${codec} has incomplete dimensions (${width}x${height}) - codec parameter issue`);
          return false;
        }
        
        // Check for unreasonable dimensions that indicate codec issues
        if (width > 0 && height > 0 && (width > 8192 || height > 8192)) {
          args.jobLog(`    → Validation FAILED: Bitmap subtitle ${codec} has unreasonable dimensions (${width}x${height}) - likely codec parameter corruption`);
          return false;
        }
        
        // Check for dimensions that are too small to be valid
        if (width > 0 && height > 0 && (width < 16 || height < 16)) {
          args.jobLog(`    → Validation FAILED: Bitmap subtitle ${codec} has suspiciously small dimensions (${width}x${height}) - likely corrupted`);
          return false;
        }
      }
      
      // CRITICAL: Check for completely empty streams (the exact case from the FFmpeg error)
      // This is the primary issue causing the muxing failure
      if (frameCount === 0 && byteCount === 0 && bitRate === 0) {
        args.jobLog(`    → Validation FAILED: Stream is completely empty (0 frames, 0 bytes, 0 bitrate) - will cause FFmpeg muxing error`);
        return false;
      }
      
      // Additional critical check: streams with zero duration in tags but non-zero stream duration
      if (streamDuration === 0 && frameCount === 0 && byteCount === 0) {
        args.jobLog(`    → Validation FAILED: Stream has 0 tag duration, 0 frames, and 0 bytes - empty stream`);
        return false;
      }
      
      // Check for streams with zero duration AND zero frames (another indicator of empty streams)
      if (duration === 0 && frameCount === 0 && byteCount === 0) {
        args.jobLog(`    → Validation FAILED: Stream has 0 duration, 0 frames, and 0 bytes`);
        return false;
      }
      
      // Enhanced validation: check for any combination of multiple zero indicators
      const zeroIndicators = [
        frameCount === 0,
        byteCount === 0,
        bitRate === 0,
        duration === 0 && streamDuration === 0,
        width === 0 && height === 0 && ['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle'].includes(codec)
      ];
      const zeroCount = zeroIndicators.filter(Boolean).length;
      
      if (zeroCount >= 3) {
        args.jobLog(`    → Validation FAILED: Stream has ${zeroCount} zero/missing indicators - likely empty/corrupted`);
        return false;
      }
      
      // Specific validation for bitmap subtitles (the problematic type in the log)
      if (['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle'].includes(codec)) {
        // For bitmap subtitles, we absolutely need frame data
        if (frameCount === 0) {
          args.jobLog(`    → Validation FAILED: Bitmap subtitle ${codec} has no frames - will cause muxing issues`);
          return false;
        }
        
        // For bitmap subtitles, we also need actual data
        if (byteCount === 0) {
          args.jobLog(`    → Validation FAILED: Bitmap subtitle ${codec} has no data (0 bytes) - empty stream`);
          return false;
        }
        
        // Additional check for bitmap subtitles with suspiciously low data
        if (byteCount > 0 && byteCount < 1000 && frameCount < 10) {
          args.jobLog(`    → Validation FAILED: Bitmap subtitle ${codec} too small (${byteCount} bytes, ${frameCount} frames) - likely corrupted`);
          return false;
        }
        
        // Check for bitmap subtitles with zero bitrate (common issue)
        if (bitRate === 0 && frameCount > 0 && byteCount > 0) {
          args.jobLog(`    → Validation WARNING: Bitmap subtitle ${codec} has 0 bitrate but has frames/data - may be metadata issue`);
          // Don't fail on this alone, the stream might still be valid
        }
        
        // CRITICAL: Additional validation using FFprobe to detect codec parameter issues
        // This catches streams that FFmpeg will report as "unspecified size"
        try {
          const probeResult = execFileSync(ffprobePath, [
            '-v', 'error',
            '-select_streams', `s:${index}`,
            '-show_entries', 'stream=width,height,codec_name,codec_parameters',
            '-of', 'csv=p=0',
            sourceFile
          ], { encoding: 'utf8', timeout: 5000 });
          
          const probeLines = probeResult.trim().split('\n');
          if (probeLines.length > 0 && probeLines[0]) {
            const probeData = probeLines[0].split(',');
            const probeWidth = parseInt(probeData[0] || '0', 10);
            const probeHeight = parseInt(probeData[1] || '0', 10);
            
            // If FFprobe also reports 0x0 dimensions, this confirms codec parameter issues
            if (probeWidth === 0 && probeHeight === 0) {
              args.jobLog(`    → Validation FAILED: FFprobe confirms ${codec} has unspecified size (${probeWidth}x${probeHeight}) - codec parameter issue`);
              return false;
            }
            
            // Cross-validate dimensions between stream metadata and FFprobe
            if (width > 0 && height > 0 && (probeWidth !== width || probeHeight !== height)) {
              args.jobLog(`    → Validation WARNING: Dimension mismatch - stream: ${width}x${height}, FFprobe: ${probeWidth}x${probeHeight}`);
              // Use FFprobe data as more reliable
              if (probeWidth === 0 && probeHeight === 0) {
                args.jobLog(`    → Validation FAILED: FFprobe shows unspecified size despite stream metadata - codec parameter corruption`);
                return false;
              }
            }
          }
        } catch (probeError) {
          args.jobLog(`    → Validation WARNING: Could not probe subtitle stream ${index} - ${probeError.message}`);
          // If we can't probe the stream, it's likely problematic
          if (frameCount === 0 || byteCount === 0) {
            args.jobLog(`    → Validation FAILED: Cannot probe stream and has empty indicators - likely corrupted`);
            return false;
          }
        }
      }
      
      // For text-based subtitles, check if we have reasonable data
      if (['subrip', 'ass', 'ssa', 'webvtt', 'mov_text'].includes(codec)) {
        if (byteCount > 0 && byteCount < 50) {
          args.jobLog(`    → Validation FAILED: Text subtitle too small (${byteCount} bytes) - likely empty`);
          return false;
        }
        
        // Text subtitles should have some content
        if (frameCount === 0 && byteCount === 0) {
          args.jobLog(`    → Validation FAILED: Text subtitle has no frames and no data`);
          return false;
        }
      }
      
      // Check for suspiciously small streams (likely corrupted)
      if (byteCount > 0 && byteCount < 100 && frameCount === 0) {
        args.jobLog(`    → Validation FAILED: Stream too small (${byteCount} bytes, 0 frames) - likely corrupted`);
        return false;
      }
      
      // Additional check for streams that report duration but have no actual content
      if ((duration > 0 || streamDuration > 0) && frameCount === 0 && byteCount === 0) {
        args.jobLog(`    → Validation FAILED: Stream reports duration but has no content (0 frames, 0 bytes)`);
        return false;
      }
      
      // Final safety check: if stream has a start time but no content, it's likely empty
      const startTime = parseFloat(stream.start_time || '0');
      if (startTime >= 0 && frameCount === 0 && byteCount === 0 && bitRate === 0) {
        args.jobLog(`    → Validation FAILED: Stream has start time but no content - empty placeholder stream`);
        return false;
      }
      
      args.jobLog(`    → Validation PASSED: ${frameCount} frames, ${byteCount} bytes, ${duration.toFixed(2)}s duration, ${bitRate} bps, ${width}x${height}`);
      return true;
    }

    subtitleStreams.forEach((stream, index) => {
      const title = (stream.tags?.title || '').toLowerCase();
      const language = (stream.tags?.language || '').toLowerCase();
      const codec = stream.codec_name || '';
      
      args.jobLog(`  Stream ${index}: "${stream.tags?.title || ''}" (${language}, ${codec})`);

      // First, validate that the stream contains actual data
      if (!validateSubtitleStream(stream, index)) {
        args.jobLog(`    → Skipping (failed validation - empty or corrupted stream)`);
        return;
      }

      // Skip bitmap subtitles (not convertible to SRT) - but only after validation
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

    // === STEP 4: CRITICAL SAFETY CHECKS AND PROCESSING VALIDATION ===
    args.jobLog('\n━━━ Critical Safety Checks ━━━');
    
    // CRITICAL: Ensure we have at least one video stream
    if (videoStreams.length === 0) {
      args.jobLog('❌ CRITICAL ERROR: No video streams found - cannot process file');
      return {
        outputFileObj: args.inputFileObj,
        outputNumber: 3,
        variables: args.variables,
      };
    }
    
    // CRITICAL: Ensure we have at least one valid audio stream after filtering
    if (keptAudioStreams.length === 0) {
      args.jobLog('❌ CRITICAL ERROR: No valid audio streams remain after filtering');
      args.jobLog('   This would result in a video-only file, which may not be desired');
      
      // Conservative fallback: if we filtered out all audio, keep the first original audio stream
      if (audioStreams.length > 0) {
        args.jobLog('🔄 FALLBACK: Adding first original audio stream to prevent audio-less output');
        const firstAudioStream = audioStreams[0];
        keptAudioStreams.push({ stream: firstAudioStream, index: 0 });
        args.jobLog(`   Added fallback audio stream: ${firstAudioStream.codec_name || 'unknown codec'}`);
      } else {
        args.jobLog('❌ CRITICAL ERROR: No audio streams exist in source file');
        return {
          outputFileObj: args.inputFileObj,
          outputNumber: 3,
          variables: args.variables,
        };
      }
    }
    
    // Log final stream counts after safety checks
    args.jobLog(`Final stream counts after safety checks:`);
    args.jobLog(`  Video streams: ${videoStreams.length} (keeping all)`);
    args.jobLog(`  Audio streams: ${keptAudioStreams.length} (filtered from ${audioStreams.length})`);
    args.jobLog(`  Subtitle streams: ${keptSubtitleStreams.length} (filtered from ${subtitleStreams.length})`);
    
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

    // CRITICAL FIX: Identify problematic streams that need to be excluded from input analysis
    // This prevents FFmpeg from analyzing corrupted streams that cause "unspecified size" errors
    const problematicStreams = [];
    
    // Find all subtitle streams that failed validation (these cause muxing errors)
    subtitleStreams.forEach((stream, index) => {
      const codec = stream.codec_name || '';
      const width = parseInt(stream.width || '0', 10);
      const height = parseInt(stream.height || '0', 10);
      const frameCount = parseInt(stream.tags?.NUMBER_OF_FRAMES || stream.tags?.['NUMBER_OF_FRAMES-eng'] || '0', 10);
      const byteCount = parseInt(stream.tags?.NUMBER_OF_BYTES || stream.tags?.['NUMBER_OF_BYTES-eng'] || '0', 10);
      
      // Mark streams that would cause "unspecified size" or muxing errors
      const isProblematic = (
        // Bitmap subtitles with unspecified size (the exact error from the log)
        (['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle'].includes(codec) && width === 0 && height === 0) ||
        // Completely empty streams
        (frameCount === 0 && byteCount === 0) ||
        // Streams that weren't kept (filtered out by validation)
        !keptSubtitleStreams.some(kept => kept.stream.index === stream.index)
      );
      
      if (isProblematic) {
        problematicStreams.push(stream.index);
        args.jobLog(`  🚫 Marking stream ${stream.index} (${codec}) as problematic - will exclude from input analysis`);
      }
    });
    
    // Build FFmpeg command with enhanced error tolerance and explicit stream exclusion
    const ffmpegArgs = [
      // Enhanced input error handling flags - handle corrupted packets and streams gracefully
      '-fflags', '+discardcorrupt+genpts+igndts+flush_packets',
      '-err_detect', 'ignore_err',
      '-analyzeduration', '10000000',  // Increase analysis duration for problematic files
      '-probesize', '10000000',        // Increase probe size for better stream detection
      '-max_error_rate', '1.0',        // Allow up to 100% error rate (very tolerant)
      '-ignore_unknown',               // Ignore unknown streams/codecs
      // Enhanced progress reporting flags for Tdarr compatibility
      '-progress', 'pipe:2',           // Send progress to stderr for better parsing
      '-stats_period', '1',            // Update progress every 1 second
      '-v', 'info',                    // Set verbosity to info level for progress data
    ];
    
    // CRITICAL FIX: Add input-level stream exclusion to prevent analysis of problematic streams
    // This prevents FFmpeg from analyzing corrupted streams during the input probe phase
    if (problematicStreams.length > 0) {
      args.jobLog(`🔧 CRITICAL FIX: Excluding ${problematicStreams.length} problematic streams from input analysis`);
      
      // Method 1: Use -discard to ignore problematic streams at input level
      problematicStreams.forEach(streamIndex => {
        ffmpegArgs.push('-discard', `${streamIndex}`);
      });
      
      // Method 2: Add additional input flags to handle codec parameter issues
      ffmpegArgs.push('-f', 'matroska');  // Force container format to avoid auto-detection issues
      ffmpegArgs.push('-avoid_negative_ts', 'disabled');  // Disable timestamp adjustment that can cause issues
    }
    
    // Add input file
    ffmpegArgs.push('-i', sourceFile);
    
    // Add metadata and chapter preservation
    ffmpegArgs.push('-map_metadata', '0'); // Preserve metadata
    ffmpegArgs.push('-map_chapters', '0');  // Preserve chapters
    ffmpegArgs.push('-max_muxing_queue_size', '1024'); // Increase muxing queue size for problematic streams (OUTPUT option)
    
    // CRITICAL FIX: If no subtitles are being kept, explicitly disable subtitle processing
    if (keptSubtitleStreams.length === 0) {
      args.jobLog(`🔧 CRITICAL FIX: No compatible subtitles found - explicitly disabling subtitle processing`);
      ffmpegArgs.push('-sn');  // Disable subtitle streams entirely
    }

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
        
        // Enhanced progress parsing to extract comprehensive FFmpeg statistics
        // Parse the full FFmpeg progress line: frame=15659 fps=195 q=16.0 size= 239616KiB time=00:10:53.94 bitrate=3001.7kbits/s speed=8.13x
        const fullProgressMatch = text.match(/frame=\s*(\d+)\s+fps=\s*([\d.]+)\s+q=\s*([\d.-]+)\s+size=\s*(\d+)(\w+)\s+time=(\d{2}:\d{2}:\d{2}\.\d{2})\s+bitrate=\s*([\d.]+)(\w+\/s)\s+speed=\s*([\d.]+)x/);
        
        if (fullProgressMatch) {
          const [, frame, fps, quality, sizeValue, sizeUnit, timeStr, bitrateValue, bitrateUnit, speed] = fullProgressMatch;
          
          // Convert size to consistent units (KiB)
          let sizeKiB = parseInt(sizeValue, 10);
          if (sizeUnit.toLowerCase() === 'mib') {
            sizeKiB = Math.round(sizeKiB * 1024);
          } else if (sizeUnit.toLowerCase() === 'gib') {
            sizeKiB = Math.round(sizeKiB * 1024 * 1024);
          }
          
          // Log in Tdarr-compatible format (matches the standard plugin output)
          const progressLine = `frame=${frame} fps=${fps} q=${quality} size=${sizeKiB}KiB time=${timeStr} bitrate=${bitrateValue}${bitrateUnit} speed=${speed}x`;
          args.jobLog(progressLine);
          
          // Calculate percentage for Tdarr progress tracking
          try {
            const currentTimeSeconds = timeToSeconds(timeStr);
            const inputDuration = args.inputFileObj?.ffProbeData?.format?.duration || 
                                 parseFloat(mediaInfo?.format?.duration || '0');
            
            if (inputDuration && currentTimeSeconds > 0) {
              const percentage = Math.min(Math.round((currentTimeSeconds / inputDuration) * 100), 100);
              
              // Update Tdarr worker with comprehensive progress data
              if (args.updateWorker && (percentage !== lastPercentage || percentage % 5 === 0)) {
                lastPercentage = percentage;
                args.updateWorker({
                  CLIType: ffmpegPath,
                  preset: ffmpegArgs.join(' '),
                  percentage: percentage,
                  frame: parseInt(frame, 10),
                  fps: parseFloat(fps),
                  speed: parseFloat(speed),
                  bitrate: `${bitrateValue}${bitrateUnit}`,
                  time: timeStr,
                  size: `${sizeKiB}KiB`
                });
                
                // Log percentage in the same format as the example
                args.jobLog(`Re-muxing progress: ${percentage}%`);
              }
            }
          } catch (error) {
            // Fallback to basic progress reporting
            if (args.updateWorker) {
              args.updateWorker({
                CLIType: ffmpegPath,
                preset: ffmpegArgs.join(' '),
                progress: timeStr,
                frame: parseInt(frame, 10),
                fps: parseFloat(fps),
                speed: parseFloat(speed)
              });
            }
          }
          
          lastProgress = timeStr;
        } else {
          // Fallback: Extract basic time-based progress if full progress line not found
          const basicProgressMatch = text.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
          if (basicProgressMatch && basicProgressMatch[1] !== lastProgress) {
            lastProgress = basicProgressMatch[1];
            args.jobLog(`Progress: ${lastProgress}`);
            
            // Report basic progress to Tdarr server
            if (args.updateWorker) {
              try {
                const currentTimeSeconds = timeToSeconds(basicProgressMatch[1]);
                const inputDuration = args.inputFileObj?.ffProbeData?.format?.duration || 
                                     parseFloat(mediaInfo?.format?.duration || '0');
                
                if (inputDuration && currentTimeSeconds > 0) {
                  const percentage = Math.min(Math.round((currentTimeSeconds / inputDuration) * 100), 100);
                  
                  if (percentage !== lastPercentage && percentage % 5 === 0) {
                    lastPercentage = percentage;
                    args.updateWorker({
                      CLIType: ffmpegPath,
                      preset: ffmpegArgs.join(' '),
                      percentage: percentage,
                      time: lastProgress
                    });
                    args.jobLog(`Re-muxing progress: ${percentage}%`);
                  }
                }
              } catch (error) {
                args.updateWorker({
                  CLIType: ffmpegPath,
                  preset: ffmpegArgs.join(' '),
                  progress: lastProgress,
                });
              }
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
