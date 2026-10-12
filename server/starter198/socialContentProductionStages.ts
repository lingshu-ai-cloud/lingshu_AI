import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream, existsSync } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { assertCurrentContentExecutionActive, readCurrentContentExecutionCheckpoint, recordCurrentContentExecutionCheckpoint } from '../contentExecution/context.js';
import type { SocialContentAutoProductionRuntime } from './socialContentProductionExecution.js';
import { socialRequestHash } from './socialContentValidation.js';
import type { SocialDirectorContentHandoff } from './socialContentDirectorPlan.js';
import type { ProductionAsset } from './socialContentProductionMaterials.js';

export type SocialProductionGraphPhase = 'assets' | 'render' | 'quality';
type RenderPort = NonNullable<SocialContentAutoProductionRuntime['renderComposite']>;
async function mediaHash(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

/** Bind the render to actual bytes, rather than OS-temporary path names. */
async function stableMediaInput(value: unknown): Promise<unknown> {
  if (typeof value === 'string' && path.isAbsolute(value) && existsSync(value)) {
    const stat = await fsp.stat(value);
    if (stat.isFile()) return { mediaSha256: await mediaHash(value) };
  }
  if (Array.isArray(value)) return Promise.all(value.map(stableMediaInput));
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(
    Object.entries(value).map(async ([key, item]) => [key, await stableMediaInput(item)] as const),
  ));
  return value;
}

export interface SocialRenderStageReceipt {
  cachePath: string;
  sha256: string;
  inputHash: string;
}

/** Director records retain immutable semantic lineage. OS workspace locations
 * are rehydrated only from the same verified asset identity and content bytes. */
export async function rebindSocialGraphRenderSources(handoff: SocialDirectorContentHandoff, assets: ProductionAsset[]): Promise<SocialDirectorContentHandoff> {
  const rebound = structuredClone(handoff);
  for (const scene of rebound.scenes) {
    const asset = assets.find(item => item.id === scene.source.assetId && item.sourceId === scene.source.sourceId);
    if (!asset || asset.contentHash !== scene.source.contentHash) throw new Error(`user_input_required:graph_director_asset_changed:${scene.sceneId}`);
    const renderUrl = asset.localPath || asset.url;
    if (path.isAbsolute(renderUrl)) {
      if (!existsSync(renderUrl) || await mediaHash(renderUrl) !== scene.source.contentHash)
        throw new Error(`user_input_required:graph_director_asset_bytes_changed:${scene.sceneId}`);
    }
    scene.source.renderUrl = renderUrl;
  }
  return rebound;
}

/** Rendering is its own real stage. Its output survives cleanup of the render
 * workspace; restoration validates bytes before downstream QA consumes them.
 * A missing worker-local cache permits a local rerender, never paid resubmission.
 */
export async function executeSocialRenderStage(input: {
  tenantId: string; taskId: string; runId: string;
  manifest: Parameters<RenderPort>[0]; outputDirectory: string; render: RenderPort;
  checkpointEnabled?: boolean;
}): Promise<{ ok: true; outputPath: string; receipt: SocialRenderStageReceipt; reused: boolean }> {
  if (input.checkpointEnabled === false) {
    const rendered = await input.render(input.manifest, undefined, input.outputDirectory);
    if (!rendered.ok || !rendered.outputPath || !existsSync(rendered.outputPath)) throw new Error(rendered.error || '视频渲染没有生成输出文件');
    return { ok: true, outputPath: rendered.outputPath, receipt: { cachePath: '', sha256: '', inputHash: '' }, reused: false };
  }
  const inputHash = socialRequestHash(await stableMediaInput(input.manifest));
  const scope = createHash('sha256').update(JSON.stringify([input.tenantId, input.taskId, input.runId])).digest('hex');
  const directory = path.resolve('data/content-execution-render', scope);
  const saved = readCurrentContentExecutionCheckpoint<SocialRenderStageReceipt>({ stage: 'social.graph_render', version: '1', inputHash });
  if (saved && saved.inputHash === inputHash && /^[a-f0-9]{64}$/.test(saved.sha256)
    && saved.cachePath === path.join(directory, `${saved.sha256}.mp4`)) {
    try {
      if (await mediaHash(saved.cachePath) === saved.sha256) {
        await assertCurrentContentExecutionActive();
        return { ok: true, outputPath: saved.cachePath, receipt: saved, reused: true };
      }
    } catch { /* Rebuild local rendering from verified domain inputs. */ }
  }
  await assertCurrentContentExecutionActive();
  const rendered = await input.render(input.manifest, undefined, input.outputDirectory);
  if (!rendered.ok || !rendered.outputPath || !existsSync(rendered.outputPath)) throw new Error(rendered.error || '视频渲染没有生成输出文件');
  const sha256 = await mediaHash(rendered.outputPath);
  await fsp.mkdir(directory, { recursive: true });
  const cachePath = path.join(directory, `${sha256}.mp4`);
  const temporary = path.join(directory, `${sha256}.${randomUUID()}.tmp`);
  try {
    await fsp.copyFile(rendered.outputPath, temporary, constants.COPYFILE_EXCL);
    await fsp.link(temporary, cachePath).catch(async error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await mediaHash(cachePath) !== sha256) throw new Error('graph_render_cache_integrity_conflict');
    });
  } finally { await fsp.rm(temporary, { force: true }); }
  const receipt = { cachePath, sha256, inputHash };
  await recordCurrentContentExecutionCheckpoint({ stage: 'social.graph_render', version: '1', inputHash, payload: receipt });
  return { ok: true, outputPath: cachePath, receipt, reused: false };
}

/** Technical QA can resume independently of rendering. A cached report is
 * valid only for these exact output bytes and scene timings. */
export async function executeSocialQualityStage(input: {
  outputPath: string; duration: number;
  scenes: Parameters<NonNullable<SocialContentAutoProductionRuntime['inspectScenes']>>[0]['scenes'];
  expectedUniqueScenes: number;
  inspectVisuals: NonNullable<SocialContentAutoProductionRuntime['inspectVisuals']>;
  inspectScenes: NonNullable<SocialContentAutoProductionRuntime['inspectScenes']>;
  runFfmpeg: NonNullable<SocialContentAutoProductionRuntime['runFfmpeg']>;
  checkpointEnabled?: boolean;
  verifyDuration?: boolean;
}) {
  const sha256 = input.checkpointEnabled === false ? '' : await mediaHash(input.outputPath);
  const inputHash = socialRequestHash({ sha256, duration: input.duration, scenes: input.scenes, expectedUniqueScenes: input.expectedUniqueScenes, verifyDuration: input.verifyDuration === true });
  type Report = { quality: Awaited<ReturnType<typeof input.inspectVisuals>>; sceneQuality: Awaited<ReturnType<typeof input.inspectScenes>>; audio: { ok: boolean }; measuredDurationSeconds?: number };
  const saved = input.checkpointEnabled === false ? null : readCurrentContentExecutionCheckpoint<Report>({ stage: 'social.graph_quality', version: '1', inputHash });
  if (input.checkpointEnabled !== false) await assertCurrentContentExecutionActive();
  if (saved) return saved;
  const quality = await input.inspectVisuals({ outputPath: input.outputPath, expectedDuration: input.duration, expectedUniqueScenes: input.expectedUniqueScenes });
  const sceneQuality = await input.inspectScenes({ outputPath: input.outputPath, scenes: input.scenes, requireDistinct: true });
  const audio = await input.runFfmpeg(['-i', input.outputPath, '-map', '0:a:0', '-t', String(Math.min(2, input.duration)), '-f', 'null', '-']);
  let measuredDurationSeconds: number | undefined;
  if (input.verifyDuration) {
    // Decode the video stream through EOF: container/audio duration cannot prove
    // that the visual timeline actually reached the locked end.
    const decoded = await input.runFfmpeg(['-i', input.outputPath, '-map', '0:v:0', '-an', '-f', 'null', '-', '-progress', 'pipe:1', '-nostats'], true);
    const progress = decoded.stdout.toString();
    const times = [...progress.matchAll(/out_time_us=(\d+)/g)].map(match => Number(match[1]) / 1e6);
    measuredDurationSeconds = decoded.ok && /progress=end/.test(progress) && times.length ? Math.max(...times) : 0;
    if (!measuredDurationSeconds || Math.abs(measuredDurationSeconds - input.duration) > 0.25) {
      quality.passed = false;
      quality.failures.push(`实际视频时长 ${measuredDurationSeconds.toFixed(3)} 秒与锁定 ${input.duration.toFixed(3)} 秒不一致`);
    }
  }
  const report: Report = { quality, sceneQuality, audio: { ok: audio.ok }, ...(input.verifyDuration ? { measuredDurationSeconds } : {}) };
  if (input.checkpointEnabled !== false) await recordCurrentContentExecutionCheckpoint({ stage: 'social.graph_quality', version: '1', inputHash, payload: report });
  return report;
}
