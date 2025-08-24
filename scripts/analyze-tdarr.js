const fs = require('fs');
const path = require('path');

const FILES = {
  lib: 'logs/Vikings.S02E06-library-file.json',
  cache: 'logs/Vikings.S02E06-resulting-pre-processed-file-in-cache.json',
  log: 'logs/Vikings.S02E06-08y9yCN47-log.txt',
};

const LIMITS = {
  MAX_CHAT_LINES: 80,
  MAX_LOG_ERRORS: 5,
  CONTEXT_RADIUS: 6,
  MAX_REPORT_BYTES: 60 * 1024,
  CHUNK: 256 * 1024,
};

function readAll(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function tryParseJSONLoose(txt) {
  try { return JSON.parse(txt); } catch {}
  // Extract largest {...} block
  let best = '', depth = 0, start = -1;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const cand = txt.slice(start, i + 1);
        if (cand.length > best.length) best = cand;
        start = -1;
      }
    }
  }
  if (best) { try { return JSON.parse(best); } catch {} }
  return null;
}

function pluck(o, p, d=undefined) {
  return p.split('.').reduce((x,k)=> (x && k in x) ? x[k] : d, o);
}

function summarize(ffpLike) {
  const streams = pluck(ffpLike, 'streams', []) || [];
  const fmt = pluck(ffpLike, 'format', {}) || {};
  const v = streams.find(s => s.codec_type === 'video') || {};
  const a = streams.find(s => s.codec_type === 'audio') || {};
  const subs = streams.filter(s => s.codec_type === 'subtitle');
  return {
    nb_streams: streams.length,
    duration: Number(fmt.duration ?? 0) || 0,
    bit_rate: Number(fmt.bit_rate ?? 0) || 0,
    size: Number(fmt.size ?? 0) || 0,
    format_name: fmt.format_name,
    writing_app: pluck(fmt, 'tags.ENCODER') || pluck(fmt, 'tags.WritingApp'),
    video: {
      codec_name: v.codec_name, profile: v.profile, pix_fmt: v.pix_fmt,
      width: v.width, height: v.height, r_frame_rate: v.r_frame_rate,
      start_time: Number(v.start_time ?? 0) || 0
    },
    audio: {
      codec_name: a.codec_name, channels: a.channels, layout: a.channel_layout,
      bit_rate: Number(a.bit_rate ?? 0) || 0,
      start_time: Number(a.start_time ?? 0) || 0
    },
    subs: subs.map(x => (x.codec_name||'') + ':' + (x.tags?.language || 'und')),
  };
}

function diff(a,b){
  return {
    streams_delta: (b.nb_streams||0)-(a.nb_streams||0),
    duration_delta: (b.duration||0)-(a.duration||0),
    bitrate_delta: (b.bit_rate||0)-(a.bit_rate||0),
    size_delta: (b.size||0)-(a.size||0),
    video_start_shift_ms: Math.round(((b.video?.start_time||0)-(a.video?.start_time||0))*1000),
    audio_start_shift_ms: Math.round(((b.audio?.start_time||0)-(a.audio?.start_time||0))*1000),
    subs_removed: (a.subs?.length||0)-(b.subs?.length||0),
  };
}

function scanLog(log) {
  const lines = log.split(/\r?\n/);
  const re = /(error|failed|invalid|unknown|not found|no such file|conversion failed|unknown encoder|device not found|permission|access is denied|exit code|signal)/i;
  const hits = [];
  for (let i=0;i<lines.length;i++) {
    if (re.test(lines[i])) {
      const s = Math.max(0, i - LIMITS.CONTEXT_RADIUS);
      const e = Math.min(lines.length, i + LIMITS.CONTEXT_RADIUS + 1);
      hits.push({ line: i+1, context: lines.slice(s,e).join('\n') });
      if (hits.length >= LIMITS.MAX_LOG_ERRORS) break;
    }
  }
  return { hits, meta: {
    hasNVENC: /nvenc/i.test(log),
    hasHandBrake: /HandBrake/i.test(log),
    hasFFmpeg: /ffmpeg/i.test(log),
  }};
}

function classify(hits) {
  if (!hits.length) return { kind:'none-detected', note:'No explicit error signatures found.' };
  const t = hits.map(h=>h.context.toLowerCase()).join('\n');
  if (t.includes('unknown encoder')) return { kind:'encoder-missing', note:'Requested encoder not in ffmpeg build.' };
  if (t.includes('no such file') || t.includes('not found')) return { kind:'io-path', note:'Path/filename translation issue.' };
  if (t.includes('device') && t.includes('not found')) return { kind:'gpu-device', note:'GPU device unavailable to worker.' };
  if (t.includes('permission') || t.includes('access is denied')) return { kind:'permissions', note:'Filesystem permissions problem.' };
  if (t.includes('conversion failed')) return { kind:'generic-conversion-failure', note:'Encoder reported failure.' };
  return { kind:'other', note:'Potential failure indicated; see evidence.' };
}

function remediation(lib, cache, d, failure) {
  const R = [];
  if (d.subs_removed > 0) R.push('Subtitles dropped. If PGS caused issues, extract→SRT in a dedicated subtitle stage before A/V steps.');
  if (Math.abs(d.video_start_shift_ms)>40 || Math.abs(d.audio_start_shift_ms)>40) {
    R.push(`Start_time drift detected (v ${d.video_start_shift_ms} ms, a ${d.audio_start_shift_ms} ms). Consider resync (-itsoffset) if downstream A/V desync occurs.`);
  }
  const vCodec = (lib.video?.codec_name||'').toLowerCase();
  const aCodec = (lib.audio?.codec_name||'').toLowerCase();

  // Audio-only guidance
  if (aCodec === 'eac3') {
    R.push('Audio: keep E-AC-3 5.1 (copy) AND add AAC-LC 2.0 fallback (Roku/legacy). Do this in an **audio-only** plugin (no -c:v / -vn).');
  }

  // Video-only guidance
  if (vCodec === 'hevc') {
    R.push('Video: if HEVC compatibility issues, use **video-only** H.264 fallback (CRF ~20, preset veryfast). Otherwise stream copy to preserve quality.');
  }

  switch (failure.kind) {
    case 'encoder-missing':
      R.push('Install/enable encoder (e.g., nvenc, qsv, vaapi) or fallback to CPU; verify with `ffmpeg -encoders`.');
      break;
    case 'gpu-device':
      R.push('Ensure GPU visibility (drivers, Docker `--gpus all`); provide CPU fallback in flow.');
      break;
    case 'io-path':
      R.push('Validate path translators and existence/permissions of source/cache paths before invoking encoder.');
      break;
    case 'permissions':
      R.push('Fix ACLs on source/cache/temp; avoid read-only mounts.');
      break;
    case 'generic-conversion-failure':
      R.push('Log exact CLI; pre-validate stream maps with ffprobe; consider `-xerror` for early abort visibility.');
      break;
  }
  return R;
}

function report(libSum, cacheSum, d, failure, hits) {
  const L = [];
  L.push('# Tdarr Troubleshooting Report');
  L.push('## Summary');
  if (libSum) L.push(`Library: streams=${libSum.nb_streams} dur=${libSum.duration}s br=${libSum.bit_rate} video=${libSum.video.codec_name}/${libSum.video.pix_fmt} ${libSum.video.width}x${libSum.video.height} @${libSum.video.r_frame_rate} audio=${libSum.audio.codec_name} ${libSum.audio.channels}ch`);
  if (cacheSum) L.push(`Cache:   streams=${cacheSum.nb_streams} dur=${cacheSum.duration}s br=${cacheSum.bit_rate} video=${cacheSum.video.codec_name}/${cacheSum.video.pix_fmt} ${cacheSum.video.width}x${cacheSum.video.height} @${cacheSum.video.r_frame_rate} audio=${cacheSum.audio.codec_name} ${cacheSum.audio.channels}ch`);
  if (libSum && cacheSum) {
    L.push('## Diffs');
    L.push(`- streams delta: ${d.streams_delta}`);
    L.push(`- duration delta: ${d.duration_delta.toFixed(3)} s`);
    L.push(`- bitrate delta: ${d.bitrate_delta}`);
    L.push(`- size delta: ${d.size_delta}`);
    L.push(`- video start shift: ${d.video_start_shift_ms} ms`);
    L.push(`- audio start shift: ${d.audio_start_shift_ms} ms`);
    L.push(`- subtitles removed: ${d.subs_removed}`);
  }
  L.push('## Failure classification');
  L.push(`- kind: ${failure.kind}`);
  L.push(`- note: ${failure.note}`);
  if (hits.length) {
    L.push('## Evidence (top log snippets)');
    hits.forEach((h,i)=>{
      L.push(`### Hit ${i+1} @ line ~${h.line}`);
      L.push('```');
      L.push(h.context);
      L.push('```');
    });
  }
  // Modular Tdarr snippets (short)
  L.push('## Remediation (modular flow)');
  remediation(libSum||{}, cacheSum||{}, d, failure).forEach(x=>L.push(`- ${x}`));

  L.push('## Tdarr snippet: Audio-only AAC fallback (keep original EAC3)');
  L.push('```bash');
  L.push('# In audio-only plugin args (no -c:v or -vn):');
  L.push('-map 0:a:0 -c:a:0 copy -map 0:a:0 -c:a:1 aac -ac:a:1 2 -b:a:1 160k');
  L.push('```');

  L.push('## Tdarr snippet: Video-only H.264 fallback (if HEVC problematic)');
  L.push('```bash');
  L.push('# In video-only plugin args (no audio flags):');
  L.push('-map 0:v:0 -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p');
  L.push('```');

  L.push('## Checklist');
  L.push('- `ffmpeg -encoders` shows required encoders (e.g., h264_nvenc)?');
  L.push('- GPU visible to worker (drivers / Docker `--gpus all`)? CPU fallback set?');
  L.push('- Paths translate and exist (source/cache/temp writable)?');
  L.push('- Pre-validate with `ffprobe -show_streams` and explicit `-map`.');
  return L.join('\n');
}

function main() {
  const libRaw = readAll(FILES.lib);
  const cacheRaw = readAll(FILES.cache);
  const logRaw = readAll(FILES.log);

  const libObj = tryParseJSONLoose(libRaw);
  const cacheObj = tryParseJSONLoose(cacheRaw);

  const libFFP = libObj?.ffProbeData || libObj || null;
  const cacheFFP = cacheObj?.ffProbeData || cacheObj || null;

  const libSum = libFFP ? summarize(libFFP) : null;
  const cacheSum = cacheFFP ? summarize(cacheFFP) : null;
  const d = (libSum && cacheSum) ? diff(libSum, cacheSum) : {};
  const { hits } = scanLog(logRaw);
  const failure = classify(hits);

  const md = report(libSum, cacheSum, d, failure, hits);

  fs.mkdirSync('reports', { recursive: true });
  const trimmed = Buffer.from(md, 'utf8');
  const out = trimmed.length > LIMITS.MAX_REPORT_BYTES ? md.slice(0, LIMITS.MAX_REPORT_BYTES) + '\n\n[Report truncated due to size limit]\n' : md;
  fs.writeFileSync('reports/analysis.md', out, 'utf8');

  const findings = { libSum, cacheSum, diffs: d, failure, hitsCount: hits.length };
  fs.writeFileSync('reports/findings.json', JSON.stringify(findings, null, 2), 'utf8');

  // Chat-safe console summary (<= MAX_CHAT_LINES)
  const summary = [
    '=== Tdarr Troubleshooting Summary ===',
    libSum ? `Library video/audio: ${libSum.video?.codec_name} / ${libSum.audio?.codec_name}` : 'Library: N/A',
    cacheSum ? `Cache   video/audio: ${cacheSum.video?.codec_name} / ${cacheSum.audio?.codec_name}` : 'Cache: N/A',
    (libSum && cacheSum) ? `Δstreams=${d.streams_delta}, Δdur=${(d.duration_delta||0).toFixed(3)}s, vShift=${d.video_start_shift_ms}ms, aShift=${d.audio_start_shift_ms}ms, subsRemoved=${d.subs_removed}` : 'Diffs: N/A',
    `Failure: ${failure.kind} (${failure.note})`,
    `Log evidence hits: ${hits.length} (see reports/analysis.md)`,
    'Remediation key points:',
  ];
  remediation(libSum||{}, cacheSum||{}, d, failure).slice(0,6).forEach((r,i)=>summary.push(`  ${i+1}. ${r}`));
  console.log(summary.slice(0, LIMITS.MAX_CHAT_LINES).join('\n'));
  console.log('Report: reports/analysis.md');
  console.log('JSON:   reports/findings.json');
}

main();
