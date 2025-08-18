// Stage 1: Extract All Streams
// Simple extraction of all video, audio, and subtitle streams to temporary folder
module.exports = async (args) => {
  const fs = require('fs');
  const path = require('path');
  const { spawn } = require('child_process');
  const crypto = require('crypto');

  args.variables = args.variables || {};

  const inputFile = args.inputFileObj._id || args.inputFileObj.path || args.inputFileObj.sourceFile;
  const fileName = path.basename(inputFile);
  const ext = path.extname(fileName).toLowerCase().replace('.', '');
  const container = (args.inputFileObj.container || '').toLowerCase();
  const isMKV = ext === 'mkv' || container === 'mkv' || container === 'matroska';
  const isMP4 = ext === 'mp4' || container === 'mp4' || ext === 'm4v';

  args.jobLog('═══════════════════════════════════════');
  args.jobLog('   STAGE 1: EXTRACT ALL STREAMS');
  args.jobLog('═══════════════════════════════════════');
  args.jobLog(`File: ${inputFile}`);
  args.jobLog(`Container: ${container}`);

  if (!isMKV && !isMP4) {
    args.jobLog('❌ Not MKV or MP4 — skipping');
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables,
    };
  }

  // Create unique session ID for file naming
  const inputFileHash = crypto.createHash('md5').update(inputFile).digest('hex').substring(0, 8);
  const sessionId = `${inputFileHash}_${process.pid}_${Date.now()}`;
  
  // Use Tdarr's working directory (cache) - no need to create custom directories
  const workingDir = args.workDir;
  
  args.jobLog(`Session ID: ${sessionId}`);
  args.jobLog(`Working directory (cache): ${workingDir}`);
  args.jobLog(`Input file: ${inputFile}`);
  args.jobLog(`Working with cache-based operations`);

  // Store session info
  args.variables.sessionId = sessionId;
  args.variables.workingDir = workingDir;
  args.variables.originalFile = inputFile;
  args.variables.containerType = isMKV ? 'mkv' : 'mp4';

  // Helper function to resolve binary paths
  function resolveBin(candidates) {
    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }
    return null;
  }

  try {
    if (isMKV) {
      // Use mkvextract for MKV files (use PATH commands)
      const mkvextractExe = 'mkvextract';
      const mkvmergeExe = 'mkvmerge';

      args.jobLog(`Using mkvextract: ${mkvextractExe}`);

      args.jobLog('\n━━━ Getting track information ━━━');
      args.jobLog(`Getting track information with mkvmerge --verbose`);
      const { execFileSync } = require('child_process');
      const trackInfo = execFileSync(mkvmergeExe, ['--verbose', '--identification-format', 'json', '-i', inputFile], { encoding: 'utf8' });
      const info = JSON.parse(trackInfo);
      
      args.jobLog(`Found ${info.tracks.length} tracks total`);

      // Extract all tracks
      args.jobLog('\n━━━ Extracting all tracks ━━━');
      
      const extractArgs = ['tracks', inputFile];
      
      const trackMetadata = {};
      
      info.tracks.forEach(track => {
        let extension = 'unknown';
        
        // Store original metadata for later use
        const props = track.properties || {};
        trackMetadata[track.id] = {
          id: track.id,
          type: track.type,
          codec: track.codec,
          language: props.language || 'und',
          title: props.track_name || '',
          default: props.default_track === true || props.default_track === 1 || props.default_track === '1' || props.default_track === 'yes',
          forced: props.forced_track === true || props.forced_track === 1 || props.forced_track === '1' || props.forced_track === 'yes',
          channels: props.audio_channels || 0
        };
        
        // Determine file extension based on codec
        if (track.type === 'video') {
          if (track.codec.includes('AVC') || track.codec.includes('H.264')) extension = 'h264';
          else if (track.codec.includes('HEVC') || track.codec.includes('H.265')) extension = 'h265';
          else if (track.codec.includes('VP9')) extension = 'vp9';
          else extension = 'video';
        } else if (track.type === 'audio') {
          if (track.codec.includes('AAC')) extension = 'aac';
          else if (track.codec.includes('AC-3') || track.codec.includes('E-AC-3')) extension = 'ac3';
          else if (track.codec.includes('DTS')) extension = 'dts';
          else if (track.codec.includes('FLAC')) extension = 'flac';
          else extension = 'audio';
        } else if (track.type === 'subtitles') {
          if (track.codec.includes('SubRip')) extension = 'srt';
          else if (track.codec.includes('ASS') || track.codec.includes('SSA')) extension = 'ass';
          else if (track.codec.includes('WebVTT')) extension = 'vtt';
          else if (track.codec.includes('PGS')) extension = 'sup';
          else extension = 'sub';
        }
        
        const outputFile = path.join(workingDir, `${sessionId}_track_${track.id}_${track.type}_${extension}`);
        extractArgs.push(`${track.id}:${outputFile}`);
        
        const title = props.track_name ? ` "${props.track_name}"` : '';
        const lang = props.language ? ` (${props.language})` : '';
        args.jobLog(`  Track ${track.id}: ${track.type} (${track.codec})${lang}${title} → ${path.basename(outputFile)}`);
      });
      
      // Store metadata for next stage
      args.variables.trackMetadata = trackMetadata;

      // Execute extraction with verbose logging
      args.jobLog(`Starting mkvextract with command: ${mkvextractExe} ${extractArgs.join(' ')}`);
      await new Promise((resolve, reject) => {
        const extractProcess = spawn(mkvextractExe, ['--verbose'].concat(extractArgs));
        
        let stdoutData = '';
        let stderrData = '';
        
        extractProcess.stdout.on('data', (data) => {
          const text = data.toString();
          stdoutData += text;
          args.jobLog(`mkvextract stdout: ${text.trim()}`);
        });
        
        extractProcess.stderr.on('data', (data) => {
          const text = data.toString();
          stderrData += text;
          args.jobLog(`mkvextract stderr: ${text.trim()}`);
          if (text.includes('Progress:') || text.includes('%')) {
            process.stdout.write(`\r${text.trim()}`);
          }
        });
        
        extractProcess.on('close', (code) => {
          args.jobLog('');
          args.jobLog(`mkvextract completed with exit code: ${code}`);
          if (code !== 0) {
            args.jobLog(`❌ mkvextract failed with code ${code}`);
            if (stderrData) args.jobLog(`Error: ${stderrData}`);
            args.jobLog(`mkvextract failed: ${stderrData}`);
            reject(new Error(`mkvextract failed: ${stderrData}`));
          } else {
            args.jobLog('✓ All tracks extracted successfully');
            args.jobLog('All tracks extracted successfully');
            resolve();
          }
        });
        
        extractProcess.on('error', (err) => {
          args.jobLog(`❌ Failed to start mkvextract: ${err.message}`);
          args.jobLog(`Failed to start mkvextract: ${err.message}`);
          reject(err);
        });
      });

    } else if (isMP4) {
      // Use ffmpeg for MP4 files (use PATH commands)
      const ffmpegExe = 'ffmpeg';
      const ffprobeExe = 'ffprobe';

      args.jobLog(`Using ffmpeg: ${ffmpegExe}`);

      args.jobLog('\n━━━ Getting stream information ━━━');
      const { execFileSync } = require('child_process');
      const streamInfo = execFileSync(ffprobeExe, ['-v', 'quiet', '-print_format', 'json', '-show_streams', inputFile], { encoding: 'utf8' });
      const info = JSON.parse(streamInfo);
      
      args.jobLog(`Found ${info.streams.length} streams total`);

      // Extract all streams
      args.jobLog('\n━━━ Extracting all streams ━━━');
      
      for (let i = 0; i < info.streams.length; i++) {
        const stream = info.streams[i];
        let extension = 'unknown';
        
        // Determine file extension based on codec
        if (stream.codec_type === 'video') {
          if (stream.codec_name === 'h264') extension = 'h264';
          else if (stream.codec_name === 'hevc') extension = 'h265';
          else if (stream.codec_name === 'vp9') extension = 'vp9';
          else extension = 'video';
        } else if (stream.codec_type === 'audio') {
          if (stream.codec_name === 'aac') extension = 'aac';
          else if (stream.codec_name === 'ac3' || stream.codec_name === 'eac3') extension = 'ac3';
          else if (stream.codec_name === 'dts') extension = 'dts';
          else if (stream.codec_name === 'flac') extension = 'flac';
          else extension = 'audio';
        } else if (stream.codec_type === 'subtitle') {
          if (stream.codec_name === 'subrip') extension = 'srt';
          else if (stream.codec_name === 'ass') extension = 'ass';
          else if (stream.codec_name === 'webvtt') extension = 'vtt';
          else if (stream.codec_name === 'mov_text') extension = 'txt';
          else extension = 'sub';
        }
        
        const outputFile = path.join(workingDir, `${sessionId}_stream_${i}_${stream.codec_type}_${extension}`);
        
        args.jobLog(`  Stream ${i}: ${stream.codec_type} (${stream.codec_name}) → ${path.basename(outputFile)}`);
        
        // Extract this stream with verbose logging
        const extractArgs = [
          '-v', 'verbose',
          '-i', inputFile,
          '-map', `0:${i}`,
          '-c', 'copy',
          '-y',
          outputFile
        ];
        
        args.jobLog(`Starting ffmpeg extraction for stream ${i}: ${ffmpegExe} ${extractArgs.join(' ')}`);
        await new Promise((resolve, reject) => {
          const extractProcess = spawn(ffmpegExe, extractArgs);
          
          let stderrData = '';
          
          extractProcess.stderr.on('data', (data) => {
            const text = data.toString();
            stderrData += text;
            args.jobLog(`ffmpeg stream ${i} stderr: ${text.trim()}`);
          });
          
          extractProcess.on('close', (code) => {
            args.jobLog(`ffmpeg stream ${i} completed with exit code: ${code}`);
            if (code !== 0) {
              args.jobLog(`    ❌ Failed to extract stream ${i}`);
              args.jobLog(`Failed to extract stream ${i}: ${stderrData}`);
              // Continue with other streams even if one fails
            } else {
              args.jobLog(`    ✓ Extracted successfully`);
              args.jobLog(`Stream ${i} extracted successfully`);
            }
            resolve();
          });
          
          extractProcess.on('error', (err) => {
            args.jobLog(`    ❌ Error: ${err.message}`);
            args.jobLog(`ffmpeg stream ${i} error: ${err.message}`);
            resolve(); // Continue with other streams
          });
        });
      }
    }

    // List extracted files
    args.jobLog('\n━━━ Extraction Summary ━━━');
    const extractedFiles = fs.readdirSync(workingDir).filter(file => file.startsWith(sessionId));
    args.jobLog(`✓ Extracted ${extractedFiles.length} files to cache directory`);
    
    extractedFiles.forEach(file => {
      const filePath = path.join(workingDir, file);
      const stats = fs.statSync(filePath);
      args.jobLog(`  ${file} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    });

  } catch (error) {
    console.error(`❌ Extraction failed: ${error.message}`);
    
    // Clean up on failure - remove session files from cache
    try {
      const sessionFiles = fs.readdirSync(workingDir).filter(file => file.startsWith(sessionId));
      sessionFiles.forEach(file => {
        fs.unlinkSync(path.join(workingDir, file));
      });
      args.jobLog(`✓ Cleaned up ${sessionFiles.length} session files from cache`);
    } catch (cleanupError) {
      args.jobLog(`⚠️ Could not clean up session files: ${cleanupError.message}`);
    }
    
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 2,
      variables: args.variables,
    };
  }

  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables
  };
};
