/* eslint-disable */
/**
 * 本机原生 ffmpeg 合成器（桌面端）。
 * 按服务器下发的 manifest 把「素材片段 → 拼接 → 烧录字幕 → 混入 BGM」
 * 合成一条真实 MP4。素材 / BGM 通过 manifest 里的 url 现拉到临时目录再喂给 ffmpeg。
 *
 * manifest 字段缺失时优雅退化：
 *   - 没有素材片段 → 用纯色背景兜底，仍出片
 *   - 没有 BGM     → 用静音轨
 * voiceover.url 与 bgm.url 均会下载并混入最终音轨；声明了音轨却下载失败时必须终止，
 * 避免用户拿到“字幕正常但没有声音”的静默成片。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

let ffmpegPath = null;
try { ffmpegPath = require('ffmpeg-static'); } catch { ffmpegPath = null; }

/** 画面比例 → 分辨率 */
function resolution(ratio) {
  switch (ratio) {
    case '1:1': return [1080, 1080];
    case '16:9': return [1920, 1080];
    case '9:16':
    default: return [1080, 1920];
  }
}

const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp|svg)(\?|$)/i;

const DEFAULT_VIDEO_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_AUDIO_MAX_BYTES = 128 * 1024 * 1024;
const DEFAULT_IMAGE_MAX_BYTES = 32 * 1024 * 1024;
const ABSOLUTE_ASSET_MAX_BYTES = 1024 * 1024 * 1024;

function safeOrigin(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

function safeAssetLabel(value) {
  try {
    const parsed = new URL(String(value || ''));
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return 'invalid asset URL';
  }
}

function assetHeadersFor(origin, assetOrigin, supplied) {
  if (!assetOrigin || origin !== assetOrigin || !supplied || typeof supplied !== 'object') return {};
  const output = {};
  for (const name of ['authorization', 'cookie']) {
    const value = supplied[name] ?? supplied[name[0].toUpperCase() + name.slice(1)];
    if (typeof value === 'string' && value.length > 0 && value.length <= 8192) output[name] = value;
  }
  return output;
}

function downloadByteLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_VIDEO_MAX_BYTES;
  return Math.max(1, Math.min(ABSOLUTE_ASSET_MAX_BYTES, Math.floor(parsed)));
}

/**
 * Download one server-authorized asset without leaking credentials across origins.
 * Redirects are handled manually so every hop is checked before a request is sent.
 */
async function downloadTo(url, dest, options = {}) {
  const assetOrigin = safeOrigin(options.assetOrigin);
  const allowedOrigins = new Set([
    assetOrigin,
    ...(Array.isArray(options.allowedAssetOrigins) ? options.allowedAssetOrigins.map(safeOrigin) : []),
  ].filter(Boolean));
  if (!assetOrigin || !allowedOrigins.size) throw new Error('render asset origin is missing');
  const byteLimit = downloadByteLimit(options.maxBytes);
  let current;
  try { current = new URL(String(url)); } catch { throw new Error('render asset URL is invalid'); }
  if (!/^https?:$/.test(current.protocol) || current.username || current.password) throw new Error('render asset URL protocol or credentials are not allowed');
  let res = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    for (let redirect = 0; redirect <= 3; redirect++) {
      if (!allowedOrigins.has(current.origin)) throw new Error(`render asset origin is not authorized: ${current.origin}`);
      res = await fetch(current, {
        headers: assetHeadersFor(current.origin, assetOrigin, options.assetHeaders),
        redirect: 'manual',
        signal: controller.signal,
      });
      if (![301, 302, 303, 307, 308].includes(res.status)) break;
      const location = res.headers.get('location');
      if (!location || redirect === 3) throw new Error('render asset redirect is invalid or too deep');
      current = new URL(location, current);
      if (!/^https?:$/.test(current.protocol) || current.username || current.password) throw new Error('render asset redirect protocol or credentials are not allowed');
    }
  } finally {
    clearTimeout(timer);
  }
  if (!res || !res.ok || !res.body) throw new Error(`download ${safeAssetLabel(current)} -> ${res ? res.status : 'no response'}`);
  const declaredBytes = Number(res.headers.get('content-length') || 0);
  if (Number.isFinite(declaredBytes) && declaredBytes > byteLimit) throw new Error(`render asset exceeds ${byteLimit} byte limit`);

  let receivedBytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > byteLimit) callback(new Error(`render asset exceeds ${byteLimit} byte limit`));
      else callback(null, chunk);
    },
  });
  const bodyTimer = setTimeout(() => controller.abort(), 45_000);
  try {
    await pipeline(Readable.fromWeb(res.body), limiter, fs.createWriteStream(dest, { flags: 'w' }));
    if (receivedBytes <= 0) throw new Error('render asset is empty');
    return dest;
  } catch (error) {
    try { fs.rmSync(dest, { force: true }); } catch { /* best effort */ }
    throw error;
  } finally {
    clearTimeout(bodyTimer);
  }
}

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function assTime(sec) {
  const n = Math.max(0, Number(sec) || 0);
  const totalCs = Math.round(n * 100);
  const h = Math.floor(totalCs / 360000);
  const m = Math.floor((totalCs % 360000) / 6000);
  const s = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function assText(value) {
  return String(value || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[{}]/g, '')
    .trim();
}

function subtitleUnit(char) {
  if (/\s/.test(char)) return 0.35;
  if (/[\x00-\xff]/.test(char)) return 0.55;
  return 1;
}

function subtitleUnits(value) {
  return Array.from(String(value || '')).reduce((sum, char) => sum + subtitleUnit(char), 0);
}

/**
 * Break a subtitle into mobile-safe pages. Each page contains at most two
 * lines, and every line is constrained by visual width rather than JS string
 * length so Chinese and Latin copy behave consistently.
 */
function subtitlePages(value, maxUnitsPerLine = 15, maxLines = 2) {
  const source = assText(value);
  if (!source) return [];
  const chars = Array.from(source);
  const lines = [];
  let line = '';
  let units = 0;
  let lastSoftBreak = -1;
  const flush = () => {
    const next = line.trim();
    if (next) lines.push(next);
    line = '';
    units = 0;
    lastSoftBreak = -1;
  };
  for (const char of chars) {
    const nextUnits = units + subtitleUnit(char);
    if (line && nextUnits > maxUnitsPerLine) {
      if (lastSoftBreak >= Math.ceil(line.length * 0.45)) {
        const head = line.slice(0, lastSoftBreak + 1).trim();
        const tail = line.slice(lastSoftBreak + 1).trimStart();
        if (head) lines.push(head);
        line = tail;
        units = subtitleUnits(tail);
      } else {
        flush();
      }
    }
    line += char;
    units += subtitleUnit(char);
    if (/[\s，。！？；：、,.!?;:]/.test(char)) lastSoftBreak = line.length - 1;
  }
  flush();
  const pages = [];
  for (let index = 0; index < lines.length; index += maxLines) {
    pages.push(lines.slice(index, index + maxLines));
  }
  return pages;
}

function normalizeSubtitleCues(cues, options = {}) {
  const maxUnitsPerLine = Math.max(8, finiteNumber(options.maxUnitsPerLine, 15));
  const maxLines = Math.max(1, Math.min(2, Math.round(finiteNumber(options.maxLines, 2))));
  return (Array.isArray(cues) ? cues : []).flatMap(cue => {
    const start = Math.max(0, Number(cue && cue.start) || 0);
    const end = Math.max(0, Number(cue && cue.end) || 0);
    const pages = subtitlePages(cue && cue.text, maxUnitsPerLine, maxLines);
    if (!pages.length || end <= start) return [];
    const weights = pages.map(page => Math.max(1, subtitleUnits(page.join(''))));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let cursor = start;
    return pages.map((page, index) => {
      const pageEnd = index === pages.length - 1
        ? end
        : cursor + (end - start) * weights[index] / totalWeight;
      const normalized = { start: cursor, end: pageEnd, text: page.join('\\N') };
      cursor = pageEnd;
      return normalized;
    });
  });
}

function filterPath(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,');
}

const AI_DISCLOSURE_LABEL = 'AI生成 · 非真人代言';
const AI_DISCLOSURE_PROVIDER = 'lingshu-digital-human';

function sanitizeMetadataValue(value, fallback, maxLength = 180) {
  const clean = candidate => String(candidate == null ? '' : candidate)
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return clean(value) || clean(fallback);
}

function isDigitalHumanTimelineItem(item) {
  return Boolean(item && (
    item.digitalHumanGenerated === true
    || item.sourceType === 'digital-human'
    || item.assetRole === 'generated_clip'
  ));
}

/**
 * 渲染器做最后一道披露判定：既接受服务器给出的明确标记，也根据时间线来源兜底，
 * 避免中间层遗漏 aiDisclosure 导致数字人成片无标识。
 */
function resolveAiDisclosure(manifest) {
  const supplied = manifest && manifest.aiDisclosure && typeof manifest.aiDisclosure === 'object'
    ? manifest.aiDisclosure
    : null;
  const explicitlyRequired = Boolean(
    supplied
    && supplied.required === true
    && supplied.containsDigitalHuman === true
  );
  const inferredFromTimeline = (Array.isArray(manifest && manifest.timeline) ? manifest.timeline : [])
    .some(isDigitalHumanTimelineItem);
  if (!explicitlyRequired && !inferredFromTimeline) return null;

  // 只在完整、明确的披露对象上接受上游内容 ID / provider；来源兜底时使用本机可审计默认值。
  const source = explicitlyRequired ? supplied : {};
  const safeJobId = sanitizeMetadataValue(manifest && manifest.jobId, 'unknown-job', 96);
  const contentId = sanitizeMetadataValue(
    source.contentId || source.content_id,
    `lingshu-render:${safeJobId}`,
  );
  const provider = sanitizeMetadataValue(source.provider, AI_DISCLOSURE_PROVIDER, 96);
  return {
    required: true,
    containsDigitalHuman: true,
    label: AI_DISCLOSURE_LABEL,
    contentId,
    provider,
  };
}

function aiDisclosureFontSize(width, height) {
  return Math.ceil(Math.min(width, height) * 0.05);
}

function cuesToAss(cues, width, height, aiDisclosure, duration) {
  const valid = normalizeSubtitleCues(cues)
    .map(cue => ({
      start: Math.max(0, Number(cue && cue.start) || 0),
      end: Math.max(0, Number(cue && cue.end) || 0),
      text: assText(cue && cue.text),
    }))
    .filter(cue => cue.text && cue.end > cue.start);
  const showAiDisclosure = Boolean(aiDisclosure);
  if (!valid.length && !showAiDisclosure) return '';

  const fontSize = Math.max(34, Math.round(width / 22));
  const marginV = Math.round(height / 3);
  const events = valid.map(cue =>
    `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,${cue.text}`
  );
  const disclosureStyle = showAiDisclosure
    ? [`Style: AIGenerated,Arial Unicode MS,${aiDisclosureFontSize(width, height)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H70000000,-1,0,0,0,100,100,0,0,3,2,0,9,0,${Math.ceil(Math.min(width, height) * 0.035)},${Math.ceil(Math.min(width, height) * 0.035)},1`]
    : [];
  const disclosureEvents = showAiDisclosure
    ? [`Dialogue: 10,${assTime(0)},${assTime(Math.max(0.1, finiteNumber(duration, 0.1)))},AIGenerated,,0,0,0,,${AI_DISCLOSURE_LABEL}`]
    : [];
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Arial Unicode MS,${fontSize},&H00FFFFFF,&H00FFFFFF,&HAA000000,&H66000000,-1,0,0,0,100,100,0,0,1,4,1,2,80,80,${marginV},1`,
    ...disclosureStyle,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    ...disclosureEvents,
    '',
  ].join('\n');
}

/**
 * 合成成片。
 * @param {object} manifest 服务器下发的渲染清单
 * @param {(pct:number)=>void} onProgress 进度回调（0-100）
 * @param {string} [outDir] 输出目录，默认 ~/Downloads/lingshu-ai-exports
 * @returns {Promise<{ok:boolean, outputPath?:string, error?:string}>}
 */
async function composite(manifest, onProgress = () => {}, outDir) {
  if (!ffmpegPath) {
    return { ok: false, error: 'ffmpeg-static binary not found（请先 npm install ffmpeg-static）' };
  }

  const spec = (manifest && manifest.spec) || {};
  const duration = Math.max(1, Number(spec.duration) || 20);
  const [w, h] = resolution(spec.ratio);
  const jobId = String((manifest && manifest.jobId) || `job-${Date.now()}`)
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 120) || `job-${Date.now()}`;
  const aiDisclosure = resolveAiDisclosure(manifest);
  const dir = outDir || path.join(os.homedir(), 'Downloads', 'lingshu-ai-exports');
  fs.mkdirSync(dir, { recursive: true });
  const outputPath = path.join(dir, `studio-${jobId}.mp4`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'));
  const downloadOptions = {
    assetOrigin: String(manifest && manifest.assetOrigin || ''),
    allowedAssetOrigins: Array.isArray(manifest && manifest.allowedAssetOrigins) ? manifest.allowedAssetOrigins : [],
    assetHeaders: manifest && manifest.assetHeaders && typeof manifest.assetHeaders === 'object' ? manifest.assetHeaders : {},
  };

  try {
    // 1) 拉取真实素材片段与 BGM
    const requestedTimeline = Array.isArray(manifest && manifest.timeline) ? manifest.timeline.filter(Boolean) : [];
    if (requestedTimeline.some(item => !item.url)) throw new Error('渲染清单包含缺少 URL 的必需画面素材');
    if (manifest.requireVisualAssets && !requestedTimeline.length) throw new Error('渲染清单缺少必需画面素材');
    const timeline = requestedTimeline;
    const localClips = [];
    for (let i = 0; i < timeline.length; i++) {
      const u = timeline[i].url;
      const rawExt = (() => { try { return path.extname(new URL(u).pathname).slice(1).toLowerCase(); } catch { return ''; } })();
      const ext = /^(?:jpe?g|png|webp|gif|bmp|svg|mp4|mov|webm|mkv|avi)$/.test(rawExt) ? rawExt : 'bin';
      const dest = path.join(tmp, `clip${i}.${ext}`);
      const image = timeline[i].type === 'image' || IMAGE_RE.test(u);
      await downloadTo(u, dest, { ...downloadOptions, maxBytes: image ? DEFAULT_IMAGE_MAX_BYTES : DEFAULT_VIDEO_MAX_BYTES });
      localClips.push({ ...timeline[i], file: dest, image });
    }

    let bgmFile = null;
    const bgmUrl = manifest && manifest.bgm && manifest.bgm.url;
    if (bgmUrl) {
      bgmFile = path.join(tmp, `bgm${path.extname(bgmUrl.split('?')[0]) || '.wav'}`);
      try { await downloadTo(bgmUrl, bgmFile, { ...downloadOptions, maxBytes: DEFAULT_AUDIO_MAX_BYTES }); }
      catch (error) { throw new Error(`背景音乐读取失败：${error && error.message || error}`); }
    }

    let voFile = null;
    const voUrl = manifest && manifest.voiceover && manifest.voiceover.url;
    if (voUrl) {
      voFile = path.join(tmp, `vo${path.extname(voUrl.split('?')[0]) || '.wav'}`);
      try { await downloadTo(voUrl, voFile, { ...downloadOptions, maxBytes: DEFAULT_AUDIO_MAX_BYTES }); }
      catch (error) { throw new Error(`口播配音读取失败：${error && error.message || error}`); }
    }

    if (process.env.RENDER_DEBUG) console.error(`[render] downloaded clips=${localClips.length} bgm=${bgmFile ? 'yes' : 'no'} voiceover=${voFile ? 'yes' : 'no'}`);

    // 2) 组装 ffmpeg 参数
    const n = localClips.length;
    const args = ['-hide_banner', '-nostdin', '-fflags', '+genpts']; // -nostdin：别等键盘输入，否则 spawn 的 stdin 管道会让 ffmpeg 永久挂起
    const filters = [];
    let vlabel;

    if (n > 0) {
      localClips.forEach(c => {
        const target = Math.max(0.5, finiteNumber(c.targetDuration, duration / n));
        if (c.image) args.push('-loop', '1', '-t', target.toFixed(3), '-i', c.file);
        else args.push('-i', c.file);
      });
      localClips.forEach((c, i) => {
        const target = Math.max(0.5, finiteNumber(c.targetDuration, duration / n));
        const trimStart = Math.max(0, finiteNumber(c.trimStart, 0));
        const rawTrimEnd = finiteNumber(c.trimEnd, trimStart + target);
        const trimEnd = Math.max(trimStart + 0.1, rawTrimEnd);
        const speed = Math.min(4, Math.max(0.25, finiteNumber(c.speed, 1)));
        // Without a trusted focal anchor, preserve the entire source on top of
        // a blurred fill. Blind center-cropping is especially destructive when
        // a landscape factory/product shot is rendered to a 9:16 canvas.
        const padding = manifest.requireVisualAssets ? '' : `tpad=stop_mode=clone:stop_duration=${target.toFixed(3)},`;
        const source = c.image
          ? `[${i}:v]trim=duration=${target.toFixed(3)},setpts=PTS-STARTPTS`
          : `[${i}:v]trim=start=${trimStart.toFixed(3)}:end=${trimEnd.toFixed(3)},setpts=(PTS-STARTPTS)/${speed.toFixed(3)},${padding}trim=duration=${target.toFixed(3)},setpts=PTS-STARTPTS`;
        const focusX = Math.max(0, Math.min(1, finiteNumber(c.focusX, 0.5)));
        const focusY = Math.max(0, Math.min(1, finiteNumber(c.focusY, 0.5)));
        const trustedFocus = c.cropMode === 'cover' || (c.cropMode === 'smart' && Number.isFinite(Number(c.focusX)) && Number.isFinite(Number(c.focusY)));
        if (trustedFocus) {
          filters.push(`${source},scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}:(iw-ow)*${focusX.toFixed(4)}:(ih-oh)*${focusY.toFixed(4)},setsar=1,fps=30,settb=AVTB,setpts=N/(30*TB),format=yuv420p[v${i}]`);
        } else {
          filters.push(`${source},split=2[bg${i}raw][fg${i}raw]`);
          filters.push(`[bg${i}raw]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:2[bg${i}]`);
          filters.push(`[fg${i}raw]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg${i}]`);
          filters.push(`[bg${i}][fg${i}]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30,settb=AVTB,setpts=N/(30*TB),format=yuv420p[v${i}]`);
        }
      });
      filters.push(`${localClips.map((_, i) => `[v${i}]`).join('')}concat=n=${n}:v=1:a=0[vcat]`);
      vlabel = '[vcat]';
    } else {
      // 兜底：纯色背景
      args.push('-f', 'lavfi', '-t', String(duration), '-i', `color=c=0x141A2E:s=${w}x${h}:r=30`);
      vlabel = '[0:v]';
    }

    // 音轨输入：BGM(或静音) 固定一路，配音可选第二路。视频输入占 0..(vInputs-1)
    const vInputs = n > 0 ? n : 1;
    const bgmIdx = vInputs;
    if (bgmFile) args.push('-stream_loop', '-1', '-i', bgmFile);
    else args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
    let voIdx = -1;
    if (voFile) { args.push('-i', voFile); voIdx = bgmIdx + 1; }

    // 3) 烧录口播字幕。每条 cue 单行显示，位置在画面下方 1/3。
    const subtitleCues = manifest && manifest.subtitles && manifest.subtitles.mode !== 'off'
      ? manifest.subtitles.cues
      : [];
    const ass = cuesToAss(subtitleCues, w, h, aiDisclosure, duration);
    if (ass) {
      const assFile = path.join(tmp, 'subtitles.ass');
      fs.writeFileSync(assFile, ass, 'utf8');
      filters.push(`${vlabel}subtitles='${filterPath(assFile)}'[vout]`);
    } else {
      filters.push(`${vlabel}null[vout]`);
    }

    // 4) 音轨混音：有配音时把 BGM 压低垫底，配音按用户设置音量叠上
    const rawBgmVol = Number(spec.bgmVol);
    const rawVoiceVol = Number(spec.voiceVol);
    const vol = Math.min(1, Math.max(0, (Number.isFinite(rawBgmVol) ? rawBgmVol : 35) / 100));
    const voiceVol = Math.min(1.5, Math.max(0, (Number.isFinite(rawVoiceVol) ? rawVoiceVol : 100) / 100));
    if (voFile) {
      const duck = (vol * 0.5).toFixed(2); // 有人声时 BGM 再降一档
      filters.push(`[${bgmIdx}:a]volume=${duck},aresample=async=1:first_pts=0,aformat=sample_rates=44100:channel_layouts=stereo[abgm]`);
      filters.push(`[${voIdx}:a]volume=${voiceVol.toFixed(2)},aresample=async=1:first_pts=0,aformat=sample_rates=44100:channel_layouts=stereo[avo]`);
      filters.push(`[abgm][avo]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0[aout]`);
    } else {
      filters.push(`[${bgmIdx}:a]volume=${vol.toFixed(2)},aresample=async=1:first_pts=0,aformat=sample_rates=44100:channel_layouts=stereo[aout]`);
    }

    args.push(
      '-filter_complex', filters.join(';'),
      '-map', '[vout]', '-map', '[aout]',
      '-t', String(duration),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-r', '30', '-g', '60', '-keyint_min', '30', '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '128k',
      '-avoid_negative_ts', 'make_zero',
    );
    if (aiDisclosure) {
      const comment = sanitizeMetadataValue(
        `AI-generated content; label=${AI_DISCLOSURE_LABEL}; content_id=${aiDisclosure.contentId}; provider=${aiDisclosure.provider}`,
        'AI-generated content',
        512,
      );
      args.push(
        '-metadata', 'ai_generated=true',
        '-metadata', 'contains_digital_human=true',
        '-metadata', `content_id=${aiDisclosure.contentId}`,
        '-metadata', `provider=${aiDisclosure.provider}`,
        '-metadata', `comment=${comment}`,
      );
    }
    args.push(
      '-movflags', aiDisclosure ? '+faststart+use_metadata_tags' : '+faststart',
      '-y', outputPath,
    );

    // 5) 跑 ffmpeg
    if (process.env.RENDER_DEBUG) console.error('[render] ARGV=' + JSON.stringify(args));

    return await new Promise(resolve => {
      // stdin 忽略（双保险防挂起）、stdout 忽略、只读 stderr 解析进度
      const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      const maxRenderMs = Math.max(120_000, duration * 15_000);
      const killTimer = setTimeout(() => proc.kill('SIGKILL'), maxRenderMs);
      proc.stderr.on('data', chunk => {
        const s = chunk.toString();
        stderr += s;
        const m = s.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m) {
          const secs = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
          onProgress(Math.min(99, (secs / duration) * 100));
        }
      });
      proc.on('error', err => resolve({ ok: false, error: String(err) }));
      proc.on('close', code => {
        clearTimeout(killTimer);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
        if (code === 0) {
          onProgress(100);
          resolve({ ok: true, outputPath });
        } else {
          try { fs.rmSync(outputPath, { force: true }); } catch { /* remove partial output */ }
          resolve({ ok: false, error: code === null ? 'ffmpeg 合成超时，请缩短素材或重试' : `ffmpeg exited ${code}\n${stderr.slice(-1200)}` });
        }
      });
    });
  } catch (err) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
    try { fs.rmSync(outputPath, { force: true }); } catch { /* remove partial output */ }
    return { ok: false, error: String(err && err.message || err) };
  }
}

module.exports = {
  composite,
  downloadTo,
  resolution,
  ffmpegPath,
  aiDisclosureFontSize,
  cuesToAss,
  subtitlePages,
  normalizeSubtitleCues,
  isDigitalHumanTimelineItem,
  resolveAiDisclosure,
  sanitizeMetadataValue,
};
