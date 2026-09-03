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
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

/** 下载远端 url 到本地文件（桌面端与本机 express 同机，localhost 直连） */
async function downloadTo(url, dest, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Math.max(1, Math.min(10 * 60_000, finiteNumber(options.timeoutMs, 45_000)));
  const maxBytes = Math.max(1, finiteNumber(options.maxBytes, 512 * 1024 * 1024));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('asset download timed out'));
  }, timeoutMs);
  const parentSignal = options.signal;
  const abortFromParent = () => controller.abort(parentSignal.reason);
  if (parentSignal) {
    if (parentSignal.aborted) abortFromParent();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }
  const headers = (() => {
    if (!options.assetOrigin) return {};
    try {
      return new URL(String(url)).origin === new URL(String(options.assetOrigin)).origin
        ? options.assetHeaders || {}
        : {};
    } catch {
      return {};
    }
  })();
  let destinationHandle = null;
  let createdDestination = false;
  let completed = false;
  try {
    const parsed = new URL(String(url));
    if (!['data:', 'http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`unsupported asset URL protocol: ${parsed.protocol}`);
    }
    const printableUrl = parsed.protocol === 'data:' ? `data:${String(url).slice(5).split(/[;,]/, 1)[0] || 'asset'};[redacted]` : `${parsed.origin}${parsed.pathname}`;
    const res = await fetch(url, { headers, signal: controller.signal, redirect: 'error' });
    if (!res.ok) throw new Error(`download ${printableUrl} -> ${res.status}`);
    const declaredLength = Number(res.headers.get('content-length') || 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error(`asset exceeds ${maxBytes} byte limit`);
    }
    if (!res.body) throw new Error(`download ${printableUrl} returned an empty body`);
    destinationHandle = await fs.promises.open(dest, 'wx', 0o600);
    createdDestination = true;
    const reader = res.body.getReader();
    let received = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      received += chunk.length;
      if (received > maxBytes) {
        await reader.cancel('asset too large').catch(() => {});
        throw new Error(`asset exceeds ${maxBytes} byte limit`);
      }
      let offset = 0;
      while (offset < chunk.length) {
        const written = await destinationHandle.write(chunk, offset, chunk.length - offset);
        if (!written.bytesWritten) throw new Error('asset download write stalled');
        offset += written.bytesWritten;
      }
    }
    if (controller.signal.aborted) throw controller.signal.reason || new Error('asset download aborted');
    completed = true;
    return dest;
  } catch (error) {
    if (timedOut) throw new Error(`asset download timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
    await destinationHandle?.close().catch(() => {});
    if (createdDestination && !completed) await fs.promises.rm(dest, { force: true }).catch(() => {});
  }
}

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeJobId(value) {
  const raw = String(value || '').trim() || `job-${Date.now()}`;
  const clean = raw.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 120) || 'job';
  if (clean === raw && raw.length <= 120) return clean;
  return `${clean.slice(0, 103)}-${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`;
}

function safeAssetExtension(url, declaredType = '') {
  const mime = String(url || '').match(/^data:([^;,]+)/i)?.[1]?.toLowerCase() || '';
  const knownMimes = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
    'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
    'audio/ogg': 'ogg', 'audio/webm': 'webm',
  };
  if (knownMimes[mime]) return knownMimes[mime];
  const rawExtension = (() => {
    try { return path.extname(new URL(String(url)).pathname).slice(1).toLowerCase(); }
    catch { return ''; }
  })();
  const allowed = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'webm', 'mkv', 'avi', 'mp3', 'm4a', 'wav', 'ogg', 'aac']);
  if (allowed.has(rawExtension)) return rawExtension === 'jpeg' ? 'jpg' : rawExtension;
  if (String(declaredType).toLowerCase() === 'image') return 'png';
  if (String(declaredType).toLowerCase() === 'video') return 'mp4';
  return 'bin';
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

function filterPath(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,');
}

function cuesToAss(cues, width, height) {
  const valid = (Array.isArray(cues) ? cues : [])
    .map(cue => ({
      start: Math.max(0, Number(cue && cue.start) || 0),
      end: Math.max(0, Number(cue && cue.end) || 0),
      text: assText(cue && cue.text),
    }))
    .filter(cue => cue.text && cue.end > cue.start);
  if (!valid.length) return '';

  const fontSize = Math.max(34, Math.round(width / 22));
  const marginV = Math.round(height / 3);
  const events = valid.map(cue =>
    `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,${cue.text}`
  );
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Arial Unicode MS,${fontSize},&H00FFFFFF,&H00FFFFFF,&HAA000000,&H66000000,-1,0,0,0,100,100,0,0,1,4,1,2,80,80,${marginV},1`,
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
async function composite(manifest, onProgress = () => {}, outDir, runtimeOptions = {}) {
  if (!ffmpegPath) {
    return { ok: false, error: 'ffmpeg-static binary not found（请先 npm install ffmpeg-static）' };
  }

  const spec = (manifest && manifest.spec) || {};
  const duration = Math.min(60 * 60, Math.max(1, finiteNumber(spec.duration, 20)));
  const [w, h] = resolution(spec.ratio);
  const jobId = safeJobId(manifest && manifest.jobId);
  const dir = path.resolve(outDir || path.join(os.homedir(), 'Downloads', 'lingshu-ai-exports'));
  fs.mkdirSync(dir, { recursive: true });
  const outputPath = path.resolve(dir, `studio-${jobId}.mp4`);
  if (path.dirname(outputPath) !== dir) return { ok: false, error: 'invalid render output path' };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'));
  const downloadOptions = {
    assetOrigin: String(manifest && manifest.assetOrigin || ''),
    assetHeaders: manifest && manifest.assetHeaders && typeof manifest.assetHeaders === 'object' ? manifest.assetHeaders : {},
    signal: runtimeOptions.signal,
    timeoutMs: runtimeOptions.downloadTimeoutMs,
    maxBytes: Math.max(1, finiteNumber(runtimeOptions.maxDownloadBytes, 512 * 1024 * 1024)),
  };

  try {
    // 1) 拉取真实素材片段与 BGM
    const rawTimeline = Array.isArray(manifest && manifest.timeline) ? manifest.timeline : [];
    const maximumTimelineAssets = Math.max(1, Math.min(200, Math.floor(finiteNumber(runtimeOptions.maxTimelineAssets, 60))));
    if (rawTimeline.length > maximumTimelineAssets) throw new Error(`timeline exceeds ${maximumTimelineAssets} asset limit`);
    const requireTimelineAssets = Boolean(runtimeOptions.requireTimelineAssets || manifest && manifest.requireTimelineAssets);
    if (requireTimelineAssets && rawTimeline.some(item => !item || (!item.url && !Buffer.isBuffer(item.bytes)))) {
      throw new Error('required timeline asset URL or bytes missing');
    }
    const timeline = rawTimeline.filter(t => t && (t.url || Buffer.isBuffer(t.bytes)));
    const localClips = [];
    const failedClips = [];
    for (let i = 0; i < timeline.length; i++) {
      if (runtimeOptions.signal?.aborted) throw runtimeOptions.signal.reason || new Error('render aborted');
      const u = timeline[i].url || '';
      const declaredType = String(timeline[i].type || '').toLowerCase();
      const dataMime = String(u).match(/^data:([^;,]+)/i)?.[1]?.toLowerCase() || '';
      const ext = safeAssetExtension(u, declaredType);
      const dest = path.join(tmp, `clip${i}.${ext}`);
      try {
        if (Buffer.isBuffer(timeline[i].bytes)) {
          if (!timeline[i].bytes.length || timeline[i].bytes.length > downloadOptions.maxBytes) {
            throw new Error('inline asset exceeds byte limit');
          }
          fs.writeFileSync(dest, timeline[i].bytes);
        } else {
          await downloadTo(u, dest, downloadOptions);
        }
        localClips.push({ ...timeline[i], bytes: undefined, file: dest, image: declaredType === 'image' || dataMime.startsWith('image/') || IMAGE_RE.test(u) });
      }
      catch (error) {
        if (runtimeOptions.signal?.aborted) throw error;
        failedClips.push({ index: i, error: String(error && error.message || error) });
      }
    }
    if (requireTimelineAssets && failedClips.length) {
      throw new Error(`required timeline assets failed: ${failedClips.map(item => `${item.index}:${item.error}`).join('; ').slice(0, 800)}`);
    }

    let bgmFile = null;
    const bgmUrl = manifest && manifest.bgm && manifest.bgm.url;
    if (bgmUrl) {
      bgmFile = path.join(tmp, `bgm.${safeAssetExtension(bgmUrl, 'audio')}`);
      try { await downloadTo(bgmUrl, bgmFile, downloadOptions); }
      catch (error) { throw new Error(`背景音乐读取失败：${error && error.message || error}`); }
    }

    let voFile = null;
    const voUrl = manifest && manifest.voiceover && manifest.voiceover.url;
    if (voUrl) {
      voFile = path.join(tmp, `vo.${safeAssetExtension(voUrl, 'audio')}`);
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
        // 所有素材统一铺满目标画幅，避免横竖素材混用时出现黑边和画面尺寸跳变。
        const source = c.image
          ? `[${i}:v]trim=duration=${target.toFixed(3)},setpts=PTS-STARTPTS`
          : `[${i}:v]trim=start=${trimStart.toFixed(3)}:end=${trimEnd.toFixed(3)},setpts=(PTS-STARTPTS)/${speed.toFixed(3)},tpad=stop_mode=clone:stop_duration=${target.toFixed(3)},trim=duration=${target.toFixed(3)},setpts=PTS-STARTPTS`;
        filters.push(`${source},scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30,settb=AVTB,setpts=N/(30*TB),format=yuv420p[v${i}]`);
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
    const ass = cuesToAss(subtitleCues, w, h);
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
      '-movflags', '+faststart',
      '-y', outputPath,
    );

    // 5) 跑 ffmpeg
    if (process.env.RENDER_DEBUG) console.error('[render] ARGV=' + JSON.stringify(args));

    return await new Promise(resolve => {
      // stdin 忽略（双保险防挂起）、stdout 忽略、只读 stderr 解析进度
      const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      const abortRender = () => proc.kill('SIGKILL');
      if (runtimeOptions.signal) {
        if (runtimeOptions.signal.aborted) abortRender();
        else runtimeOptions.signal.addEventListener('abort', abortRender, { once: true });
      }
      let stderr = '';
      let settled = false;
      let timedOut = false;
      const maxRenderMs = Math.max(120_000, duration * 15_000);
      const killTimer = setTimeout(() => { timedOut = true; proc.kill('SIGKILL'); }, maxRenderMs);
      const finish = result => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        runtimeOptions.signal?.removeEventListener('abort', abortRender);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
        resolve(result);
      };
      proc.stderr.on('data', chunk => {
        const s = chunk.toString();
        stderr = (stderr + s).slice(-64 * 1024);
        const m = s.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m) {
          const secs = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
          onProgress(Math.min(99, (secs / duration) * 100));
        }
      });
      proc.on('error', err => finish({ ok: false, error: String(err) }));
      proc.on('close', code => {
        if (runtimeOptions.signal?.aborted) {
          finish({ ok: false, error: String(runtimeOptions.signal.reason && runtimeOptions.signal.reason.message || runtimeOptions.signal.reason || 'render aborted') });
        } else if (code === 0) {
          onProgress(100);
          finish({ ok: true, outputPath });
        } else {
          finish({ ok: false, error: timedOut || code === null ? 'ffmpeg 合成超时，请缩短素材或重试' : `ffmpeg exited ${code}\n${stderr.slice(-1200)}` });
        }
      });
    });
  } catch (err) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
    return { ok: false, error: String(err && err.message || err) };
  }
}

module.exports = { composite, resolution, ffmpegPath, downloadTo, safeJobId, safeAssetExtension };
