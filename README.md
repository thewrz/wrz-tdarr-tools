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

## Node Setup (production: wrz-desk, unmapped mode)

The production transcoding node runs on `wrz-desk` in **unmapped mode**. In
unmapped mode the node copies the source file to its local SSD first, encodes
from local storage, then copies the result back. This eliminates sustained
SMB read/write pressure on the Synology server during the encode window —
one burst read at the start, one burst write at the end, **zero SMB traffic
during the encode itself**. On a contended Synology (e.g. DS415+ running
50+ containers) this is the difference between "transcodes trigger disk I/O
storms" and "transcodes are invisible to other services".

### 1. Node config — `~/Tdarr/configs/Tdarr_Node_Config.json`

Relevant fields (leave everything else at defaults):

```jsonc
{
  "nodeName": "wrz-desk",
  "serverURL": "http://192.168.1.105:8266",
  "nodeType": "unmapped",
  "unmappedNodeCache": "/home/adam/Tdarr/unmappedNodeCache"
  // pathTranslators are present but ignored in unmapped mode
}
```

The `unmappedNodeCache` directory **must exist** and must live on a volume
with enough headroom for the worst-case source file × the node's worker
limit. Rule of thumb: budget ~30 GB per concurrent 4K worker. With 3
concurrent NVENC workers that's ~90 GB minimum. On wrz-desk it lives on
`/dev/sdb4` (system SSD) which has ~500 GB free.

### 2. Server-side requirement — `enableUnmappedNodes: True`

**By default the Tdarr server rejects unmapped node registrations.** Symptoms:
the node logs show

> `"Node wrz-desk is trying to register but Unmapped nodes and API file access are disabled. You can enable this on the Options tab."`

…and `get-nodes` returns an empty object. The server-side flag lives in
`SettingsGlobalJSONDB.globalsettings.enableUnmappedNodes`. Flip it either
from the Tdarr Web UI (Options tab → enable "Unmapped nodes / API file
access") or via the `cruddb` API:

```python
import json, urllib.request

def cruddb(body, timeout=30):
    return json.loads(urllib.request.urlopen(urllib.request.Request(
        'http://192.168.1.105:8265/api/v2/cruddb',
        data=json.dumps({'data': body}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST'),
        timeout=timeout).read())

doc = cruddb({'collection': 'SettingsGlobalJSONDB',
              'mode': 'getById', 'docID': 'globalsettings'})
doc['enableUnmappedNodes'] = True
cruddb({'collection': 'SettingsGlobalJSONDB', 'mode': 'update',
        'docID': 'globalsettings', 'obj': doc})
```

**Caution**: if this flag gets flipped back to `False` (e.g. someone toggles
the Options setting in the Web UI), wrz-desk will fail to register on its
next poll cycle and no jobs will run. Check
`journalctl --user -u app-Tdarr_Node_Tray@autostart.service` on wrz-desk
for the "Unmapped nodes … are disabled" error to diagnose.

### 3. Service management on wrz-desk

`Tdarr_Node` is started by `Tdarr_Node_Tray`, which is launched via XDG
autostart (`~/.config/autostart/Tdarr_Node_Tray.desktop`). systemd
auto-generates a user unit named `app-Tdarr_Node_Tray@autostart.service`
that wraps it. Stop/start via:

```bash
systemctl --user stop  app-Tdarr_Node_Tray@autostart.service
systemctl --user start app-Tdarr_Node_Tray@autostart.service
```

The stop cascade cleanly terminates the tray, its child `Tdarr_Node`
process, and any orphaned `Tdarr_Node` processes still tracked by the
user session scope.

### 4. Verifying the node is registered correctly

```bash
curl -s http://192.168.1.105:8265/api/v2/get-nodes \
  | python3 -c "import json,sys; n=json.load(sys.stdin); \
    [print(v['config']['nodeName'], '->', v['config']['nodeType']) \
     for v in n.values()]"
```

Expected output:

```
wrz-desk -> unmapped
```

On first job after switching, Tdarr will lazily create a per-node subdir
at `~/Tdarr/unmappedNodeCache/wrz-desk/`. During a transcode you should
see the source file briefly materialize there, then the encoded output,
then both disappear when the job completes.

## License

MIT
