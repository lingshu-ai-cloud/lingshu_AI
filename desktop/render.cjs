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
const { fileURLToPath } = require('node:url');

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
const DATA_URL_RE = /^data:([^;,]+)?((?:;[^,]*)*),(.*)$/is;

function dataUrlParts(value) {
  const match = String(value || '').match(DATA_URL_RE);
  if (!match) return null;
  const mime = String(match[1] || 'application/octet-stream').toLowerCase();
  const metadata = String(match[2] || '');
  try {
    return {
      mime,
      bytes: /;base64/i.test(metadata)
        ? Buffer.from(match[3] || '', 'base64')
        : Buffer.from(decodeURIComponent(match[3] || ''), 'utf8'),
    };
  } catch {
    return null;
  }
}

function extensionForAsset(value, declaredType) {
  const data = dataUrlParts(value);
  const mime = data && data.mime;
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'video/quicktime') return 'mov';
  if (mime === 'video/webm') return 'webm';
  if (mime === 'video/mp4') return 'mp4';
  if (mime === 'audio/mpeg') return 'mp3';
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return 'wav';
  let pathname = '';
  try {
    pathname = new URL(String(value || ''), 'http://local').pathname;
  } catch {
    pathname = String(value || '').split(/[?#]/)[0];
  }
  const ext = path.extname(pathname).slice(1).toLowerCase();
  if (/^[a-z0-9]{1,8}$/.test(ext)) return ext;
  if (declaredType === 'image') return 'png';
  if (declaredType === 'audio') return 'wav';
  return 'mp4';
}

function isImageAsset(value, declaredType) {
  if (declaredType === 'image') return true;
  if (declaredType === 'video') return false;
  const data = dataUrlParts(value);
  if (data) return data.mime.startsWith('image/');
  return IMAGE_RE.test(String(value || ''));
}

/** 下载远端 url 到本地文件（桌面端与本机 express 同机，localhost 直连） */
async function downloadTo(url, dest, options = {}) {
  const source = String(url || '');
  const data = dataUrlParts(source);
  if (data) {
    if (!data.bytes.length) throw new Error('empty data URL');
    fs.writeFileSync(dest, data.bytes);
    return dest;
  }
  if (source.startsWith('file://')) {
    const localPath = fileURLToPath(source);
    if (!fs.existsSync(localPath) || fs.statSync(localPath).size <= 0) throw new Error(`missing local file ${localPath}`);
    fs.copyFileSync(localPath, dest);
    return dest;
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(source) && fs.existsSync(source)) {
    if (fs.statSync(source).size <= 0) throw new Error(`empty local file ${source}`);
    fs.copyFileSync(source, dest);
    return dest;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  const headers = options.assetOrigin && String(url).startsWith(options.assetOrigin)
    ? options.assetHeaders || {}
    : {};
  let res;
  try {
    res = await fetch(source, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`download ${source} -> ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function assTime(sec) {
  const n = Math.max(0, Number(sec) || 0);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = Math.floor(n % 60);
  const cs = Math.floor((n - Math.floor(n)) * 100);
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
  if (/[ilI.,!:'`|]/.test(char)) return 0.28;
  if (/[frt()]/.test(char)) return 0.36;
  if (/[MWmw@]/.test(char)) return 0.82;
  if (/[A-Z]/.test(char)) return 0.66;
  if (/[\x00-\xff]/.test(char)) return 0.54;
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
  // Keep space-delimited words intact; CJK still permits breaks between glyphs.
  const tokens = source.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) || [];
  const join = words => words.join(' ').replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}，。！？；：、])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}，。！？；：、])/gu, '$1');
  const badEnd = /\b(a|an|the|of|to|for|with|which|your|our|is|are|not|before|while)\s*$/i;
  const wrap = words => {
    if (subtitleUnits(join(words)) <= maxUnitsPerLine || words.length === 1) return [join(words)];
    let best = null, bestCost = Infinity;
    for (let split = 1; split < words.length; split++) {
      const left = join(words.slice(0, split)), right = join(words.slice(split));
      const lw = subtitleUnits(left), rw = subtitleUnits(right);
      if (lw > maxUnitsPerLine || rw > maxUnitsPerLine) continue;
      const score = (lw - rw) ** 2 + (badEnd.test(left) ? 25 : 0);
      if (score < bestCost) { bestCost = score; best = [left, right]; }
    }
    return best;
  };
  const cost = Array(tokens.length + 1).fill(Infinity), next = [], layouts = [];
  cost[tokens.length] = 0;
  const capacity = maxUnitsPerLine * maxLines;
  for (let i = tokens.length - 1; i >= 0; i--) {
    for (let j = i + 1; j <= tokens.length; j++) {
      const words = tokens.slice(i, j), phrase = join(words), width = subtitleUnits(phrase);
      if (width > capacity && j > i + 1) break;
      const lines = wrap(words);
      if (!lines || lines.length > maxLines) continue;
      const dangling = j < tokens.length && badEnd.test(phrase);
      const penalty = capacity * capacity + (capacity - width) ** 2 + (dangling ? 250 : 0);
      if (penalty + cost[j] < cost[i]) { cost[i] = penalty + cost[j]; next[i] = j; layouts[i] = lines; }
    }
  }
  const pages = [];
  for (let i = 0; i < tokens.length;) { const j = next[i] || i + 1; pages.push(layouts[i] || [tokens[i]]); i = j; }
  return pages;
}

function groupSpokenCues(cues, options = {}) {
  const gapLimit = finiteNumber(options.pauseThreshold, .28);
  const maxDuration = finiteNumber(options.maxPhraseDuration, 4.2);
  const groups = [];
  for (const cue of Array.isArray(cues) ? cues : []) {
    const text = assText(cue.text), start = Number(cue.start), end = Number(cue.end);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0) continue;
    const previous = groups.at(-1);
    const gap = previous ? start - previous.end : Infinity;
    const terminal = previous && /[.!?。！？]["'”’]?\s*$/.test(previous.text);
    if (previous && !terminal && gap >= 0 && gap <= gapLimit && end - previous.start <= maxDuration) {
      previous.text += (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) ? '' : ' ') + text;
      previous.end = end; previous.parts.push({ start, end, text });
    } else groups.push({ start, end, text, parts: [{ start, end, text }] });
  }
  return groups;
}

function normalizeSubtitleCues(cues, options = {}) {
  const maxUnitsPerLine = Math.max(8, finiteNumber(options.maxUnitsPerLine, 15));
  const maxLines = Math.max(1, Math.min(2, Math.round(finiteNumber(options.maxLines, 2))));
  return groupSpokenCues(cues, options).flatMap(group => {
    const pages = subtitlePages(group.text, maxUnitsPerLine, maxLines);
    // Preserve measured cue boundaries. A break inside one provider cue is
    // an estimate within that cue, never a new word-level alignment claim.
    const units = value => subtitleUnits(value.replace(/\s/g, ''));
    const parts = group.parts.map(part => ({ ...part, weight: units(part.text) }));
    const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
    const at = (position, endBoundary) => {
      let offset = 0;
      for (const part of parts) {
        if (position < offset + part.weight - 1e-6 || (endBoundary && position <= offset + part.weight + 1e-6))
          return part.start + (part.end - part.start) * Math.max(0, Math.min(1, (position - offset) / Math.max(.001, part.weight)));
        offset += part.weight;
      }
      return group.end;
    };
    let offset = 0;
    return pages.map((page, index) => {
      const start = index === 0 ? group.start : at(offset, false);
      offset += units(page.join(''));
      return { start, end: index === pages.length - 1 ? group.end : at(Math.min(totalWeight, offset), true), text: page.join('\\N') };
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

function cuesToAss(cues, width, height, disclaimer = '', duration = 0, style = {}) {
  const fontSize = Math.round(Math.min(width / 15, height / 18) * Math.max(.7, Math.min(1.4, Number(style.fontScale) || 1)));
  const marginX = Math.round(width * .085);
  const valid = normalizeSubtitleCues(cues, { maxUnitsPerLine: (width - marginX * 2) / fontSize })
    .map(cue => ({
      start: Math.max(0, Number(cue && cue.start) || 0),
      end: Math.max(0, Number(cue && cue.end) || 0),
      text: String(cue && cue.text || '').replace(/[{}]/g, '').trim(),
    }))
    .filter(cue => cue.text && cue.end > cue.start);
  if (!valid.length && !disclaimer) return '';

  const marginV = Math.round(height * Math.max(.08, Math.min(.35, Number(style.bottomRatio) || .20)));
  const outline = Math.max(2, Math.round(width * .003));
  const events = valid.map(cue =>
    `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,${cue.text}`
  );
  if (disclaimer && duration > 0) events.push(`Dialogue: 1,0:00:00.00,${assTime(duration)},Default,,0,0,0,,{\\an8\\pos(${Math.round(width / 2)},${Math.round(height * 0.08)})\\fs${Math.round(width * 0.035)}}${assText(disclaimer).replace(/[{}]/g, '')}`);
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
    `Style: Default,Arial,${fontSize},&H00FFFFFF,&H00FFFFFF,&HAA000000,&H66000000,-1,0,0,0,100,100,0,0,1,${outline},1,2,${marginX},${marginX},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
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
  const [baseW, baseH] = resolution(spec.ratio);
    const scale = spec.resolution === '720p' ? 2 / 3 : 1;
    const [w, h] = [Math.round(baseW * scale / 2) * 2, Math.round(baseH * scale / 2) * 2];
  const jobId = (manifest && manifest.jobId) || `job-${Date.now()}`;
  const dir = outDir || path.join(os.homedir(), 'Downloads', 'lingshu-ai-exports');
  fs.mkdirSync(dir, { recursive: true });
  const outputPath = path.join(dir, `studio-${jobId}.mp4`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'));
  const downloadOptions = {
    assetOrigin: String(manifest && manifest.assetOrigin || ''),
    assetHeaders: manifest && manifest.assetHeaders && typeof manifest.assetHeaders === 'object' ? manifest.assetHeaders : {},
  };

  try {
    // 1) 拉取真实素材片段与 BGM
    const declaredTimeline = Array.isArray(manifest && manifest.timeline) ? manifest.timeline : [];
    const timeline = declaredTimeline.filter(t => t && t.url);
    if (manifest && manifest.requireVisualAssets === true && !declaredTimeline.length) {
      throw new Error('自动成片没有视觉时间线，已停止纯色画面降级');
    }
    if (manifest && manifest.requireVisualAssets === true && timeline.length !== declaredTimeline.length) {
      throw new Error('视觉时间线存在未绑定素材地址的片段，已停止渲染');
    }
    const localClips = [];
    const clipErrors = [];
    for (let i = 0; i < timeline.length; i++) {
      const u = timeline[i].url;
      const ext = extensionForAsset(u, timeline[i].type);
      const dest = path.join(tmp, `clip${i}.${ext}`);
      try {
        await downloadTo(u, dest, downloadOptions);
        localClips.push({ ...timeline[i], file: dest, image: isImageAsset(u, timeline[i].type) });
      } catch (error) {
        clipErrors.push(`片段 ${i + 1}（${String(timeline[i].name || '未命名素材')}）: ${error && error.message || error}`);
      }
    }
    if (timeline.length && !localClips.length) {
      throw new Error(`时间线素材全部读取失败，已停止纯色画面降级：${clipErrors.join('；')}`);
    }
    if (manifest && manifest.requireVisualAssets === true && clipErrors.length) {
      throw new Error(`时间线素材不完整，已停止渲染：${clipErrors.join('；')}`);
    }

    let bgmFile = null;
    const bgmUrl = manifest && manifest.bgm && manifest.bgm.url;
    if (bgmUrl) {
      bgmFile = path.join(tmp, `bgm.${extensionForAsset(bgmUrl, 'audio')}`);
      try { await downloadTo(bgmUrl, bgmFile, downloadOptions); }
      catch (error) { throw new Error(`背景音乐读取失败：${error && error.message || error}`); }
    }

    let voFile = null;
    const voUrl = manifest && manifest.voiceover && manifest.voiceover.url;
    if (voUrl) {
      voFile = path.join(tmp, `vo.${extensionForAsset(voUrl, 'audio')}`);
      try { await downloadTo(voUrl, voFile, downloadOptions); }
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
        const source = c.image
          ? `[${i}:v]trim=duration=${target.toFixed(3)},setpts=PTS-STARTPTS`
          : `[${i}:v]trim=start=${trimStart.toFixed(3)}:end=${trimEnd.toFixed(3)},setpts=(PTS-STARTPTS)/${speed.toFixed(3)},tpad=stop_mode=clone:stop_duration=${target.toFixed(3)},trim=duration=${target.toFixed(3)},setpts=PTS-STARTPTS`;
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
    const ass = cuesToAss(subtitleCues, w, h, manifest.disclaimer || '', duration, manifest.subtitles?.style || {});
    if (ass) {
      const assFile = path.join(tmp, 'subtitles.ass');
      fs.writeFileSync(assFile, ass, 'utf8');
      filters.push(`${vlabel}subtitles='${filterPath(assFile)}'[vout]`);
    } else {
      filters.push(`${vlabel}null[vout]`);
    }

    // 4) 音轨混音：有配音时把 BGM 压低垫底，配音按用户设置音量叠上
    const musicNormalize = bgmFile ? 'loudnorm=I=-16:TP=-2:LRA=11,' : '';
    const rawBgmVol = Number(spec.bgmVol);
    const rawVoiceVol = Number(spec.voiceVol);
    const vol = Math.min(1, Math.max(0, (Number.isFinite(rawBgmVol) ? rawBgmVol : 35) / 100));
    const voiceVol = Math.min(1.5, Math.max(0, (Number.isFinite(rawVoiceVol) ? rawVoiceVol : 100) / 100));
    if (voFile) {
      const duck = (vol * 0.5).toFixed(2); // 有人声时 BGM 再降一档
      filters.push(`[${bgmIdx}:a]${musicNormalize}volume=${duck},aresample=async=1:first_pts=0,aformat=sample_rates=44100:channel_layouts=stereo[abgm]`);
      filters.push(`[${voIdx}:a]volume=${voiceVol.toFixed(2)},aresample=async=1:first_pts=0,aformat=sample_rates=44100:channel_layouts=stereo[avo]`);
      filters.push(`[abgm][avo]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0[aout]`);
    } else {
      filters.push(`[${bgmIdx}:a]${musicNormalize}volume=${vol.toFixed(2)},aresample=async=1:first_pts=0,aformat=sample_rates=44100:channel_layouts=stereo[aout]`);
    }

    args.push(
      '-filter_complex', filters.join(';'),
      '-map', '[vout]', '-map', '[aout]',
      '-t', String(duration),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-r', '30', '-g', '60', '-keyint_min', '30', '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '128k',
      '-avoid_negative_ts', 'make_zero',
      '-movflags', '+faststart',
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
          resolve({ ok: false, error: code === null ? 'ffmpeg 合成超时，请缩短素材或重试' : `ffmpeg exited ${code}\n${stderr.slice(-1200)}` });
        }
      });
    });
  } catch (err) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
    return { ok: false, error: String(err && err.message || err) };
  }
}

module.exports = { composite, resolution, ffmpegPath, dataUrlParts, extensionForAsset, isImageAsset, subtitlePages, groupSpokenCues, normalizeSubtitleCues, cuesToAss };
