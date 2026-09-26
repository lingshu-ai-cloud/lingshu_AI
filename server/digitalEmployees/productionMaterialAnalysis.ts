import { analyzeMaterialFramesWithQwen, verifyMaterialFramesWithQwen } from '../agents/qwen.js';
import { extractQwenAnalysisFrames } from '../routes/videos.js';
import { normalizeMaterialObservations } from '../lib/materialObservation.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { analyzeImagePostEvidenceWithGemini } from '../agents/gemini.js';
import { analyzeImagePostEvidenceWithQwen } from '../agents/qwen.js';
import { analyzeMaterialVideo, productionAnalysisSegments } from '../routes/studio.js';
import { runVisualFfmpeg } from '../lib/renderVisualQuality.js';
import { resolveSourceDurations } from '../lib/videoSourcePlan.js';
import { objectStorageGetObject } from '../storage/objectStorage.js';
import { fetchCloudMaterial } from '../lib/cloudMaterials.js';
import { evidenceClips, observationStrings } from './sceneEvidence.js';
import type { AssetCandidate } from './contentProduction.js';
import { enrichMaterialSegmentsWithEditBoundaries } from '../lib/videoBoundaryAnalysis.js';

export type MaterialAnalysis = { revision: string; duration: number; observations: string[]; segments: Array<Record<string, unknown>> };
export function materialRevision(asset: AssetCandidate): string {
  let stat: fs.Stats | undefined;
  try { if (asset.localPath) stat = fs.statSync(asset.localPath); } catch { /* missing files invalidate the revision and fail analysis/render explicitly */ }
  return crypto.createHash('sha256').update(JSON.stringify([asset.id, asset.localPath, stat?.size, stat?.mtimeMs,
    asset.objectKey, asset.cloudRecordId, asset.url, asset.duration, asset.segments, asset.visualObservations])).digest('hex');
}
export function applyMaterialAnalysis(asset: AssetCandidate, cached?: MaterialAnalysis): AssetCandidate {
  return cached?.revision === materialRevision(asset) ? { ...asset, duration: cached.duration, visualObservations: cached.observations,
    observations: cached.observations, segments: cached.segments } : asset;
}
const MAX_BYTES = 110 * 1024 * 1024;
export async function readMaterialBytes(body: AsyncIterable<Uint8Array>, options: { limit?: number; timeoutMs?: number; cancel?: () => void | Promise<unknown> } = {}): Promise<Buffer> {
  const iterator = body[Symbol.asyncIterator]();
  const chunks: Buffer[] = [];
  let size = 0, complete = false;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('素材下载超时，请稍后重试')), options.timeoutMs || 30000); });
  try {
    for (;;) {
      const item = await Promise.race([iterator.next(), timeout]);
      if (item.done) { complete = true; return Buffer.concat(chunks); }
      size += item.value.byteLength;
      if (size > (options.limit || MAX_BYTES)) throw Error('production_input_required:素材超过自动分析大小限制，请先在素材库分段处理');
      chunks.push(Buffer.from(item.value));
    }
  } finally {
    clearTimeout(timer!);
    if (!complete) {
      if (options.cancel) void Promise.resolve().then(options.cancel).catch(() => {});
      else void Promise.resolve(iterator.return?.()).catch(() => {});
    }
  }
}
/** Called for one asset per worker tick. No display-name facts enter the vision prompt. */
export async function analyzeProductionMaterial(asset: AssetCandidate, tenantId: string, allowReview = false): Promise<MaterialAnalysis> {
  let bytes: Buffer;
  if (asset.localPath) {
    if (fs.statSync(asset.localPath).size > MAX_BYTES) throw Error('production_input_required:素材超过110MB上传限制，请先拆分文件');
    bytes = fs.readFileSync(asset.localPath);
  } else if (asset.objectKey) {
    const media = await objectStorageGetObject(asset.objectKey, `bytes=0-${MAX_BYTES}`);
    if (!media) throw Error('素材文件不可读');
    bytes = await readMaterialBytes(media.body, { cancel: () => { (media.body as { destroy?: () => void }).destroy?.(); } });
  } else if (asset.cloudRecordId) {
    const response = await fetchCloudMaterial(asset.cloudRecordId, asset.type === 'video' ? 'videoFile' : 'posterFile', undefined, tenantId);
    if (!response?.ok || !response.body) throw Error('素材文件不可读');
    const reader = response.body.getReader();
    const body: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({ next: () => reader.read() as Promise<IteratorResult<Uint8Array>> }) };
    try { bytes = await readMaterialBytes(body, { cancel: () => reader.cancel() }); }
    finally { reader.releaseLock(); }
  } else throw Error('production_input_required:请将外链素材导入当前租户素材库后分析，不能只凭链接名称生成分镜');
  if (!bytes.length || bytes.length > MAX_BYTES) throw Error('production_input_required:素材为空或超过110MB上传限制，请先拆分文件');
  const revision = materialRevision(asset);
  if (asset.type === 'image') {
    const mimeType = /\.png$/i.test(asset.localPath || asset.name) ? 'image/png' : /\.webp$/i.test(asset.localPath || asset.name) ? 'image/webp' : 'image/jpeg';
    const analyze = (process.env.VIDEO_ANALYSIS_PROVIDER || 'qwen').toLowerCase() === 'qwen' ? analyzeImagePostEvidenceWithQwen : analyzeImagePostEvidenceWithGemini;
    const result = await analyze({ images: [{ base64: bytes.toString('base64'), mimeType, imageIndex: 1 }] });
    const observations = result.observedFacts
      .filter(fact => Number(fact.confidence) >= .65)
      .flatMap(fact => [
        ...(Array.isArray(fact.subjects) ? fact.subjects : []),
        fact.scene,
        fact.composition,
      ])
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
    if (!observations.length) throw Error('production_input_required:图片没有足够可信的视觉观察，请补充清晰素材');
    return { revision, duration: 0, observations, segments: [] };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-material-analysis-'));
  try {
    const file = path.join(dir, 'source.mp4');
    fs.writeFileSync(file, bytes);
    const [resolved] = await resolveSourceDurations([{ ...asset, localPath: file }]);
    if (!resolved.duration) throw Error('production_input_required:无法验证素材视频时长，请检查文件');
    const proxy = path.join(dir, 'analysis-proxy.mp4');
    const prepared = await runVisualFfmpeg(['-i', file, '-map', '0:v:0', '-an', '-vf', "scale='min(960,iw)':-2", '-r', '6', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-y', proxy], false, { timeoutMs: 120000 });
    if (!prepared.ok || !fs.existsSync(proxy)) throw Error('分析代理视频生成失败，请重试');
    // Time stays in original seconds. The high-resolution original remains the render source.
    let segments: Array<Record<string, unknown>>;
    if ((process.env.VIDEO_ANALYSIS_PROVIDER || 'qwen').trim().toLowerCase() === 'qwen') {
      // Pay the visual-analysis cost once at ingestion. Short clips keep a small
      // request; longer reels receive enough temporal samples to locate clean
      // action boundaries instead of asking every production task to re-analyse.
      const frameBudget = Math.max(18, Math.min(48, Math.ceil(resolved.duration * 2)));
      const frames = await extractQwenAnalysisFrames(proxy, frameBudget, resolved.duration);
      const draft = await analyzeMaterialFramesWithQwen({frames,duration:resolved.duration});
      normalizeMaterialObservations(asset.id,resolved.duration,draft);
      const reviewed = await verifyMaterialFramesWithQwen({frames,duration:resolved.duration,draft});
      segments = normalizeMaterialObservations(asset.id,resolved.duration,reviewed);
    } else segments = productionAnalysisSegments(asset.id, resolved.duration, await analyzeMaterialVideo(proxy, fs.readFileSync(proxy), resolved.duration));
    segments = await enrichMaterialSegmentsWithEditBoundaries({ inputPath: file, duration: resolved.duration, segments });
    if (!allowReview && !evidenceClips({ ...asset, duration: resolved.duration, segments }).length) throw Error('production_input_required:视频分析缺少已确认的可用片段，请复核素材分析');
    return { revision, duration: resolved.duration, segments, observations: segments.flatMap(observationStrings) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
