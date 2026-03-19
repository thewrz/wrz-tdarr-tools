# wrz-tdarr-tools

Custom [Tdarr](https://tdarr.io/) flows and plugins for optimizing media libraries — primarily targeting Roku playback (HEVC video, AAC stereo audio, SRT subtitles in MKV containers).

## Flows

Import these JSON files directly into Tdarr via the Flows UI.

| Flow | Description |
|------|-------------|
| `roku-hevc-tv-v3.json` | Full media optimization pipeline: analyzes streams, re-encodes video to HEVC (NVENC), downmixes multichannel audio to AAC stereo with center-channel boost and loudnorm, converts subtitles to SRT via mkvmerge, corrects A/V desync, and strips unnecessary streams. |

## Plugins

These are the custom JS plugins used by the flows above. Place them in your Tdarr plugins directory.

| Plugin | Description |
|--------|-------------|
| `plugins/smart-analyzer-v3.js` | Analysis-only node that inspects all streams via ffprobe, classifies languages, validates audio/subtitle integrity (including deep packet probing), detects A/V desync, and routes to the appropriate executor path. |
| `plugins/single-pass-executor-v3.js` | Builds and executes a single ffmpeg command for A/V processing (HEVC NVENC video, AAC stereo audio with loudnorm and center-channel boost), then uses mkvmerge to add subtitles as proper S_TEXT/UTF8 (works around VLC 3.0's "Unidentified codec" bug). |
| `plugins/stream-guard.js` | Post-processing verification node that probes the output file to confirm audio and video streams are intact, with retry/backoff logic for transient file locks (EBUSY/EPERM on SMB/NAS). |
| `plugins/pre-processed-check.js` | Simple gate that checks if a file was already preprocessed and flags it for replacement. |

## Scripts

| Script | Description |
|--------|-------------|
| `scripts/analyze-tdarr.js` | Offline troubleshooting tool — reads Tdarr log/library/cache JSON exports and generates a diagnostic report with failure classification, remediation suggestions, and ffmpeg snippets. |

## Key Features

- **NVENC hardware encoding** with quality presets per resolution tier
- **Multichannel to stereo downmix** with 1.414x center-channel boost (dialog clarity)
- **EBU R128 loudnorm** normalization (-16 LUFS)
- **A/V desync detection and correction** via start_time analysis and `-itsoffset`
- **Subtitle handling** via mkvmerge (avoids VLC 3.0 codec identification bugs)
- **Stream validation** with deep packet probing and muxing compatibility tests
- **Language detection** for English, Japanese, Korean, and French audio/subtitle tracks
- **Commentary and accessibility track filtering**

## Requirements

- Tdarr with custom plugin support
- ffmpeg/ffprobe with NVENC support (GPU encoding) or CPU fallback
- mkvmerge (from MKVToolNix) for subtitle muxing

## License

MIT
