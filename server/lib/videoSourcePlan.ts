import fs from 'node:fs';
import { runVisualFfmpeg } from './renderVisualQuality.js';

export type TimedSourceAsset = {
  id: string; type: 'video' | 'image'; name?: string; duration: number;
  localPath?: string; objectKey?: string; url?: string;
};
export type SourceSegment = {
  assetId: string; targetDuration: number;
  trimStart?: number; trimEnd?: number; speed?: number;
};
const durationCache = new Map<string, number>();

/**
 * Resolve the displayed end of the video stream from FFmpeg showinfo output.
 * Some FFmpeg builds report duration_time=0 for the final frame. In that case
 * the final PTS alone is one frame short, so use the recent observed cadence
 * for that frame instead of treating valid footage as missing.
 */
export function resolveShowinfoVisualDuration(stderr: string): number {
  const frames = [...stderr.matchAll(/pts_time:([\d.e+-]+).*?duration_time:([\d.e+-]+)/gi)]
    .map(match => ({ pts: Number(match[1]), duration: Number(match[2]) }))
    .filter(frame => Number.isFinite(frame.pts) && Number.isFinite(frame.duration));
  if (!frames.length) return 0;
  const explicitEnd = Math.max(0, ...frames.map(frame => frame.pts + Math.max(0, frame.duration)));
  const last = frames.at(-1)!;
  if (last.duration > 0 || frames.length < 2) return explicitEnd;
  const recentDeltas = frames.slice(-6).flatMap((frame, index, tail) => {
    if (index === 0) return [];
    const delta = frame.pts - tail[index - 1]!.pts;
    return Number.isFinite(delta) && delta > 0 ? [delta] : [];
  }).sort((a, b) => a - b);
  const cadence = recentDeltas[Math.floor(recentDeltas.length / 2)] || 0;
  return Math.max(explicitEnd, last.pts + cadence);
}

/** Validate the video stream, not container/audio length; cache by local file revision. */
export async function resolveSourceDurations<T extends TimedSourceAsset>(assets: T[]): Promise<T[]> {
  const resolved = new Map<string, number>();
  for (const asset of assets) {
    if (asset.type !== 'video' || !asset.localPath || resolved.has(asset.localPath)) continue;
    const stat = fs.statSync(asset.localPath);
    const key = `${fs.realpathSync(asset.localPath)}:${stat.size}:${stat.mtimeMs}`;
    let duration = durationCache.get(key);
    if (duration === undefined) {
      const probe = await runVisualFfmpeg([
        '-loglevel', 'info', '-progress', 'pipe:1', '-i', asset.localPath, '-map', '0:v:0',
        '-vf', 'setpts=PTS-STARTPTS,showinfo=checksum=0', '-an', '-f', 'null', '-',
      ], true, { timeoutMs: 15_000 });
      duration = probe.ok && /progress=end/.test(probe.stdout.toString())
        ? resolveShowinfoVisualDuration(probe.stderr)
        : 0;
      if (duration > 0) {
        if (durationCache.size >= 256) durationCache.clear();
        durationCache.set(key, duration);
      }
    }
    resolved.set(asset.localPath, duration);
  }
  return assets.map(asset => ({ ...asset, duration: asset.localPath && asset.type === 'video'
    ? resolved.get(asset.localPath) || 0 : asset.duration }));
}

/** Allocate original-speed, non-overlapping footage. Never loop or pad a short source. */
export function planVideoSourceSegments(assets: TimedSourceAsset[], durations: number[]): { segments: SourceSegment[]; gaps: string[] } {
  if (!assets.length || assets.length !== durations.length) return { segments: [], gaps: ['分镜与素材数量不一致'] };
  const consumed = new Map<string, number>();
  const gaps: string[] = [];
  const segments = assets.map((asset, index): SourceSegment => {
    const targetDuration = durations[index]!;
    if (!Number.isFinite(targetDuration) || targetDuration < 0.5) gaps.push(`第 ${index + 1} 镜头时长无效或不足 0.5 秒`);
    if (asset.type === 'image') return { assetId: asset.id, targetDuration };
    // Repeated aliases of the same file/object must share the source cursor.
    const identity = asset.localPath ? fs.realpathSync(asset.localPath) : asset.objectKey || asset.url || asset.id;
    const trimStart = consumed.get(identity) || 0;
    const trimEnd = trimStart + targetDuration;
    consumed.set(identity, trimEnd);
    if (!Number.isFinite(asset.duration) || asset.duration <= 0) {
      gaps.push(`素材「${asset.name || asset.id}」缺少已验证视频时长`);
    } else if (trimEnd > asset.duration + 1e-6) {
      gaps.push(`素材「${asset.name || asset.id}」仅 ${asset.duration.toFixed(2)} 秒，第 ${index + 1} 镜头累计需要 ${trimEnd.toFixed(2)} 秒；请补充同产品已授权素材或缩短脚本`);
    }
    return { assetId: asset.id, targetDuration, trimStart, trimEnd, speed: 1 };
  });
  return { segments: gaps.length ? [] : segments, gaps: [...new Set(gaps)] };
}
