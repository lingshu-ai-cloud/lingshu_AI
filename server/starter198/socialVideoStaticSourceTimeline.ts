import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runVisualFfmpeg } from '../lib/renderVisualQuality.js';
import type { VideoTimelineMeasurementPort } from './socialVideoQualityReview.js';

const PIXELS = 24 * 24 * 3;
const RATE = 30;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
type StaticSource = { sceneId: string; path: string; sha256: string };

/** A deliberately narrow actual-pixel detector for distinct, static JPEG/PNG
 * sources. Callers must provide scene ownership and immutable source hashes
 * from the execution's trusted asset binding, never from client input. Unmatched frames, transitions, uncertainty and repeated sources yield no result. */
export function createStaticSourceTimelineMeasurement(sources: StaticSource[], run = runVisualFfmpeg): VideoTimelineMeasurementPort {
  return async ({ outputPath, mediaSha256, expectedScenes }) => {
    const unknown = (): never => { throw Error('static_source_timeline_unmeasurable'); };
    if (!sources.length || sources.length !== expectedScenes.length || sources.length > 64
      || sources.some((s, i) => s.sceneId !== expectedScenes[i]?.sceneId || !/^[a-f0-9]{64}$/.test(s.sha256))
      || new Set(sources.map(s => s.sha256)).size !== sources.length
      || new Set(sources.map(s => s.sceneId)).size !== sources.length) return unknown();
    if (hash(await readFile(outputPath)) !== mediaSha256) return unknown();
    const refs: Buffer[] = [];
    for (const source of sources) {
      const bytes = await readFile(source.path);
      // Accept only still PNG or JPEG bytes; video/container frame sampling is
      // not sufficient evidence of the whole source and is intentionally excluded.
      if (hash(bytes) !== source.sha256 || !(bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        || bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')))
        || bytes.includes(Buffer.from('acTL'))) return unknown();
      const decoded = await run(['-i', source.path, '-frames:v', '1', '-vf', 'scale=24:24:flags=area,format=rgb24', '-f', 'rawvideo', '-'], true);
      if (!decoded.ok || decoded.stdout.length !== PIXELS || hash(await readFile(source.path)) !== source.sha256) return unknown();
      refs.push(decoded.stdout);
    }
    const distance = (a: Buffer, b: Buffer) => {
      let sum = 0;
      for (let i = 0; i < PIXELS; i++) sum += Math.abs(a[i]! - b[i]!);
      return sum / PIXELS;
    };
    // Similar-looking sources are ambiguous even when their file hashes differ.
    if (refs.some((ref, i) => refs.slice(i + 1).some(other => distance(ref, other) < 30))) return unknown();
    const video = await run(['-i', outputPath, '-map', '0:v:0', '-vf', `fps=${RATE},scale=24:24:flags=area,format=rgb24`, '-an', '-f', 'rawvideo', '-'], true);
    if (!video.ok || !video.stdout.length || video.stdout.length % PIXELS || video.stdout.length / PIXELS > 901
      || hash(await readFile(outputPath)) !== mediaSha256) return unknown();
    const count = video.stdout.length / PIXELS;
    const labels: number[] = [];
    for (let frame = 0; frame < count; frame++) {
      const pixels = video.stdout.subarray(frame * PIXELS, (frame + 1) * PIXELS);
      const matches = refs.flatMap((ref, i) => distance(ref, pixels) <= 3 ? [i] : []);
      if (matches.length !== 1) return unknown();
      labels.push(matches[0]!);
    }
    const scenes: Array<{sceneId: string; targetStart: number; targetEnd: number}> = [];
    let start = 0;
    for (let i = 1; i <= count; i++) {
      if (i < count && labels[i] === labels[start]) continue;
      const index = labels[start]!;
      if (index !== scenes.length) return unknown();
      scenes.push({ sceneId: sources[index]!.sceneId, targetStart: start / RATE, targetEnd: i / RATE });
      start = i;
    }
    if (scenes.length !== sources.length) return unknown();
    // Sampling at 30 Hz has up to 1/30 s uncertainty. Only return evidence
    // when even the worst-case boundary remains inside the 0.3 s tolerance.
    if (scenes.some((scene, i) => Math.abs(scene.targetStart - expectedScenes[i]!.targetStart) > 0.26 + 1e-9
      || Math.abs(scene.targetEnd - expectedScenes[i]!.targetEnd) > 0.26 + 1e-9)) return unknown();
    const evidenceRef = `static-pixel-timeline-sha256:${hash(Buffer.from(JSON.stringify({ mediaSha256,
      sources: sources.map(({ sceneId, sha256 }) => ({ sceneId, sha256 })), rate: RATE, labels })))}`;
    return { mediaSha256, durationSeconds: count / RATE, scenes, evidenceRef };
  };
}

/** Resolve solely from server-side handoff asset IDs and server-loaded asset
 * metadata. Missing hashes, paths, duplicate IDs and non-images do not enable
 * this optional detector; manifest URLs are not consulted. */
export function staticSourceTimelineForHandoff(input: {
  scenes: Array<{ sceneId: string; source: { assetId: string; type: string } }>;
  assets: Array<{ id: string; type: string; localPath?: string; contentHash?: string }>;
  runFfmpeg?: typeof runVisualFfmpeg;
}): VideoTimelineMeasurementPort | undefined {
  const sources: StaticSource[] = [];
  for (const scene of input.scenes) {
    const assets = input.assets.filter(asset => asset.id === scene.source.assetId);
    const asset = assets[0];
    if (scene.source.type !== 'image' || assets.length !== 1 || asset?.type !== 'image'
      || !asset.localPath || !/^[a-f0-9]{64}$/.test(asset.contentHash ?? '')) return undefined;
    sources.push({ sceneId: scene.sceneId, path: asset.localPath, sha256: asset.contentHash! });
  }
  return sources.length ? createStaticSourceTimelineMeasurement(sources, input.runFfmpeg) : undefined;
}
