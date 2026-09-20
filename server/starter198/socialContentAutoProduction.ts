import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import type {
  SocialTaskSource,
} from '../../shared/contracts/socialContentWorkflow.js';
import { inspectRenderedVisuals, runVisualFfmpeg } from '../lib/renderVisualQuality.js';
import { readMaterialLibrary, type MaterialRecord } from '../lib/materialLibrary.js';
import { resolveSourceDurations } from '../lib/videoSourcePlan.js';
import { readTenantEnterpriseProfile, type EnterpriseProfile } from '../routes/enterprise.js';
import { synthesizeStudioVoiceForAutomation } from '../routes/studio.js';
import { objectStorageEnabled, r2SignedGetUrl } from '../storage/r2.js';
import { createSocialContentArtifact } from './socialContentOutputs.js';
import {
  registerSocialContentFile,
  storeSocialContentFile,
} from './socialContentFiles.js';
import { readSocialTaskDetail, requireSocialTask } from './socialContentRecords.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import { socialJson, socialObject, socialRequestHash, socialText } from './socialContentValidation.js';
import {
  freezeSocialScriptBaseline,
  parseStoredSocialScriptBaseline,
  type StoredSocialScriptBaseline,
} from './socialContentScriptBaseline.js';
import { resolveSocialContentFormulaReference } from './socialContentFormulas.js';
import { runOutsideSocialContentMutationScope } from './socialContentMutation.js';

const require = createRequire(import.meta.url);
const { composite } = require('../../desktop/render.cjs') as {
  composite: (
    manifest: unknown,
    onProgress?: (progress: number) => void,
    outputDir?: string,
  ) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
};

const MEDIA_ROOT = path.resolve(process.cwd(), 'data', 'media');
const OUTPUT_ROOT = path.resolve(process.cwd(), 'data', 'social-content-renders');
const AUTO_TASK_KEY = 'social_content_auto_production';
const AUTO_SCHEMA = 'social-content.auto-production.v1';

export type ProductionAsset = {
  id: string;
  name: string;
  type: 'video' | 'image';
  sourceId: string;
  url: string;
  localPath?: string;
  duration: number;
};

export type SocialProductionBaseline = StoredSocialScriptBaseline;

export type SocialProductionAdaptation = {
  narrationChanged: false;
  limitedMaterialFallback: boolean;
  sourceAssetCount: number;
  notes: string[];
  sceneAssets: Array<{ sceneId: string; assetId: string; assetName: string; reuseIndex: number }>;
};

function safeNextVersion(record: StarterRecord): string {
  const version = Number(record.version);
  return Number.isSafeInteger(version) && version > 0 ? String(version + 1) : '1';
}

function productFacts(profile: EnterpriseProfile, productRef: string | null): string[] {
  const reference = socialText(productRef).toLocaleLowerCase();
  const items = profile.products.items ?? [];
  const matched = items.find(item => {
    const name = socialText(item.name).toLocaleLowerCase();
    const sku = socialText(item.sku).toLocaleLowerCase();
    return Boolean(reference && (reference === name || reference === sku));
  });
  const product = matched ?? (items.length === 1 ? items[0] : undefined);
  if (!product) return [];
  return [
    socialText(product.name) ? `产品：${socialText(product.name)}` : '',
    socialText(product.category) ? `类别：${socialText(product.category)}` : '',
    socialText(product.material) ? `材质：${socialText(product.material)}` : '',
    socialText(product.highlights) ? `已确认卖点：${socialText(product.highlights)}` : '',
    socialText(product.certifications) ? `已确认资质：${socialText(product.certifications)}` : '',
    socialText(product.moq) ? `起订量：${socialText(product.moq)}` : '',
  ].filter(Boolean).slice(0, 4);
}

/** Bind real uploaded material without changing the approved narration. */
export function adaptBaselineToMaterials(
  baseline: SocialProductionBaseline,
  assets: Array<Pick<ProductionAsset, 'id' | 'name'>>,
): SocialProductionAdaptation {
  if (!assets.length) {
    return {
      narrationChanged: false,
      limitedMaterialFallback: true,
      sourceAssetCount: 0,
      notes: ['未发现可读取的视觉素材，使用“已确认资料卡”完成可验收降级成片；资料卡不代表产品实物。'],
      sceneAssets: baseline.scenes.map((scene, index) => ({
        sceneId: scene.sceneId,
        assetId: 'verified-fact-card',
        assetName: '已确认资料卡',
        reuseIndex: index,
      })),
    };
  }
  const counts = new Map<string, number>();
  const sceneAssets = baseline.scenes.map((scene, index) => {
    const asset = assets[index % assets.length]!;
    const reuseIndex = counts.get(asset.id) ?? 0;
    counts.set(asset.id, reuseIndex + 1);
    return { sceneId: scene.sceneId, assetId: asset.id, assetName: asset.name, reuseIndex };
  });
  const limited = assets.length < baseline.scenes.length;
  return {
    narrationChanged: false,
    limitedMaterialFallback: limited,
    sourceAssetCount: assets.length,
    notes: limited
      ? [`${baseline.scenes.length} 个脚本镜头使用 ${assets.length} 份真实素材完成适配；同一素材按不同时间段复用，不新增产品事实。`]
      : ['每个脚本镜头均已绑定客户上传的真实素材，口播脚本未重写。'],
    sceneAssets,
  };
}

function decodeMaterialRef(value: string): string {
  const encoded = value.match(/^socialmaterial:([A-Za-z0-9_-]+)$/)?.[1];
  if (!encoded) return '';
  try { return Buffer.from(encoded, 'base64url').toString('utf8'); }
  catch { return ''; }
}

function safeLocalMediaPath(value: unknown): string {
  const relative = socialText(value);
  if (!relative) return '';
  const local = path.resolve(MEDIA_ROOT, relative.replace(/^\/+/, ''));
  return local.startsWith(`${MEDIA_ROOT}${path.sep}`) && existsSync(local) && statSync(local).isFile() ? local : '';
}

async function materialUrl(record: MaterialRecord): Promise<{ url: string; localPath?: string }> {
  const localPath = safeLocalMediaPath(record.file)
    || (socialText(record.url).startsWith('/media/') ? safeLocalMediaPath(socialText(record.url).slice('/media/'.length)) : '');
  if (localPath) return { url: localPath, localPath };
  const objectKey = socialText(record.objectKey);
  if (objectKey && objectStorageEnabled()) return { url: await r2SignedGetUrl(objectKey, 15 * 60) };
  const url = socialText(record.url);
  return /^(?:https?:|data:)/i.test(url) ? { url } : { url: '' };
}

async function taskProductionAssets(input: {
  tenantId: string;
  sources: SocialTaskSource[];
}): Promise<ProductionAsset[]> {
  const inventory = await readMaterialLibrary(input.tenantId);
  const byId = new Map(inventory.items.map(item => [socialText(item.id), item]));
  const assets: ProductionAsset[] = [];
  for (const source of input.sources.filter(item => item.status === 'active' && item.kind === 'material')) {
    const id = decodeMaterialRef(source.sourceRef);
    const record = byId.get(id);
    const type = socialText(record?.type);
    if (!record || !['video', 'image'].includes(type)) continue;
    const location = await materialUrl(record);
    if (!location.url) continue;
    assets.push({
      id,
      name: socialText(record.name) || source.label || '客户上传素材',
      type: type as ProductionAsset['type'],
      sourceId: source.sourceId,
      url: location.url,
      ...(location.localPath ? { localPath: location.localPath } : {}),
      duration: Math.max(0, Number(record.duration || 0)),
    });
  }
  return resolveSourceDurations(assets);
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]!);
}

async function verifiedFactCard(input: { title: string; product: string; facts: string[] }): Promise<ProductionAsset> {
  const lines = [input.product, ...input.facts].map(value => socialText(value)).filter(Boolean).slice(0, 4);
  const svg = `<svg width="720" height="1280" viewBox="0 0 720 1280" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0b3b31"/><stop offset="1" stop-color="#198754"/></linearGradient></defs>
    <rect width="720" height="1280" fill="url(#g)"/><circle cx="620" cy="150" r="190" fill="#ffffff" opacity=".08"/>
    <circle cx="80" cy="1120" r="230" fill="#ffffff" opacity=".06"/><rect x="64" y="160" width="592" height="840" rx="36" fill="#ffffff" opacity=".96"/>
    <text x="104" y="250" font-size="28" font-family="sans-serif" fill="#16845d">已确认资料</text>
    <text x="104" y="330" font-size="42" font-weight="700" font-family="sans-serif" fill="#173d34">${escapeXml(input.title.slice(0, 22))}</text>
    ${lines.map((line, index) => `<text x="104" y="${440 + index * 100}" font-size="28" font-family="sans-serif" fill="#365b52">${escapeXml(line.slice(0, 28))}</text>`).join('')}
    <text x="104" y="920" font-size="22" font-family="sans-serif" fill="#738c85">资料卡不代表产品实物，具体以企业确认信息为准</text>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return {
    id: 'verified-fact-card',
    name: '已确认资料卡',
    type: 'image',
    sourceId: 'system-verified-facts',
    url: `data:image/png;base64,${png.toString('base64')}`,
    duration: 0,
  };
}

export function buildSocialAutoProductionTimeline(input: {
  baseline: SocialProductionBaseline;
  adaptation: SocialProductionAdaptation;
  assets: ProductionAsset[];
  cues: Array<{ start: number; end: number; text: string }>;
  duration: number;
}) {
  const byId = new Map(input.assets.map(asset => [asset.id, asset]));
  const starts = input.cues.map(cue => cue.start);
  const boundaries = [0, ...starts.slice(1), input.duration];
  return input.baseline.scenes.map((scene, index) => {
    const binding = input.adaptation.sceneAssets[index]!;
    const asset = byId.get(binding.assetId)!;
    const targetStart = boundaries[index] ?? (input.duration * index / input.baseline.scenes.length);
    const targetEnd = boundaries[index + 1] ?? input.duration;
    const targetDuration = Math.max(0.5, targetEnd - targetStart);
    if (asset.type === 'image') {
      return { name: asset.name, type: 'image', url: asset.url, targetStart, targetEnd, targetDuration };
    }
    const available = Math.max(0, asset.duration);
    // A short upload may serve several script scenes. Start each reuse at a
    // different real frame and vary pacing slightly; tpad then holds the last
    // real frame when the spoken scene is longer than the remaining footage.
    // No synthetic product visual or unverified fact is introduced.
    const trimStart = available > 0.7
      ? Math.min(available - 0.35, available * binding.reuseIndex / input.baseline.scenes.length)
      : 0;
    const sourceDuration = available > 0 ? Math.max(0.35, Math.min(targetDuration, available - trimStart)) : targetDuration;
    const trimEnd = trimStart + sourceDuration;
    const speedPattern = [1, 1.08, 0.94, 1.14];
    return {
      name: asset.name,
      type: 'video',
      url: asset.url,
      trimStart,
      trimEnd,
      speed: speedPattern[binding.reuseIndex % speedPattern.length],
      targetStart,
      targetEnd,
      targetDuration,
    };
  });
}

export function buildSocialSceneTimingCues(
  baseline: SocialProductionBaseline,
  duration: number,
): Array<{ start: number; end: number; text: string }> {
  const weights = baseline.scenes.map(scene => Math.max(1, [...scene.narration].length));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let elapsed = 0;
  return baseline.scenes.map((scene, index) => {
    const start = elapsed;
    elapsed = index === baseline.scenes.length - 1
      ? duration
      : Math.min(duration, elapsed + duration * weights[index]! / total);
    return { start, end: elapsed, text: scene.narration };
  });
}

function scriptText(input: {
  baseline: SocialProductionBaseline;
  adaptation: SocialProductionAdaptation;
  duration: number;
  cues: Array<{ start: number; end: number; text: string }>;
}): string {
  return input.baseline.scenes.map((scene, index) => {
    const cue = input.cues[index];
    const start = cue?.start ?? input.duration * index / input.baseline.scenes.length;
    const end = input.cues[index + 1]?.start ?? input.duration * (index + 1) / input.baseline.scenes.length;
    const material = input.adaptation.sceneAssets[index];
    return `[${start.toFixed(2)}-${end.toFixed(2)}s]\n镜头功能：${scene.shotFunction}\n画面：使用“${material?.assetName || '已确认资料卡'}”适配${scene.subject}\n口播：${scene.narration}\n字幕：${scene.narration}`;
  }).join('\n\n');
}

async function executionTask(input: {
  repository: Starter198Repository;
  tenantId: string;
  runId: string;
}): Promise<StarterRecord | null> {
  const result = await input.repository.list(STARTER_COLLECTIONS.tasks, input.tenantId, {
    where: { run_id: input.runId, task_key: AUTO_TASK_KEY }, perPage: 2,
  });
  return result.items.length === 1 ? result.items[0]! : null;
}

async function writeExecutionStage(input: {
  repository: Starter198Repository;
  tenantId: string;
  runId: string;
  stage: string;
  status?: string;
  message: string;
  extra?: Record<string, unknown>;
}): Promise<void> {
  const task = await executionTask(input);
  if (!task) return;
  const output = socialObject(socialJson(task.output)) ?? {};
  await input.repository.update(STARTER_COLLECTIONS.tasks, input.tenantId, task.id, {
    status: input.status ?? 'running',
    output: {
      ...output,
      production: {
        schemaVersion: AUTO_SCHEMA,
        stage: input.stage,
        message: input.message,
        updatedAt: new Date().toISOString(),
        ...(input.extra ?? {}),
      },
    },
    blocked_reason: input.status === 'waiting_external' ? input.message : '',
    updated_at: new Date().toISOString(),
  });
}

async function finishExecution(input: {
  repository: Starter198Repository;
  tenantId: string;
  runId: string;
  artifactId: string;
}): Promise<void> {
  await writeExecutionStage({
    ...input,
    stage: 'review_ready',
    status: 'completed',
    message: '成品视频已生成，等待用户验收。',
    extra: { artifactId: input.artifactId },
  });
  const run = await input.repository.get(STARTER_COLLECTIONS.runs, input.tenantId, input.runId);
  if (run) await input.repository.update(STARTER_COLLECTIONS.runs, input.tenantId, run.id, {
    status: 'completed', current_controller: 'system', pause_reason: '', completed_at: new Date().toISOString(),
  });
}

async function failExecution(input: {
  repository: Starter198Repository;
  tenantId: string;
  taskId: string;
  runId: string;
  userId: string;
  error: unknown;
}): Promise<void> {
  const detail = await readSocialTaskDetail(input).catch(() => null);
  if (detail?.artifacts.some(artifact => artifact.origin === 'agent' && artifact.kind === 'short_video')) return;
  const message = String(input.error instanceof Error ? input.error.message : input.error || '自动成片失败').slice(0, 800);
  await writeExecutionStage({
    ...input,
    stage: 'failed',
    status: 'waiting_external',
    message: `自动成片失败，可直接重试：${message}`,
    extra: { reasonCode: 'social_content_auto_production_failed' },
  }).catch(() => undefined);
  const record = await requireSocialTask(input).catch(() => null);
  if (record && socialText(record.status) === 'producing') {
    await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, record.id, {
      status: 'attention',
      version: safeNextVersion(record),
      updated_by: input.userId,
      updated_at: new Date().toISOString(),
    }).catch(() => undefined);
  }
  const run = await input.repository.get(STARTER_COLLECTIONS.runs, input.tenantId, input.runId).catch(() => null);
  if (run) await input.repository.update(STARTER_COLLECTIONS.runs, input.tenantId, run.id, {
    status: 'waiting_external', current_controller: 'agent', pause_reason: message,
  }).catch(() => undefined);
}

export async function runSocialContentAutoProduction(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  runId: string;
}): Promise<void> {
  const detail = await readSocialTaskDetail(input);
  if (!detail) throw new Error('社媒内容任务不存在');
  const existing = detail.artifacts.find(artifact => artifact.origin === 'agent'
    && artifact.kind === 'short_video'
    && socialText(artifact.content?.workflowSchema) === AUTO_SCHEMA
    && artifact.status !== 'superseded');
  if (existing) {
    await finishExecution({ ...input, artifactId: existing.artifactId });
    return;
  }
  const taskRecord = await requireSocialTask(input);
  const profile = await readTenantEnterpriseProfile(input.tenantId);
  const facts = productFacts(profile, detail.brief.productRef);
  let baseline = parseStoredSocialScriptBaseline(taskRecord.script_baseline);
  if (!baseline) {
    // Compatibility path for tasks created before script baselines were
    // persisted. It runs once, before material fitting, and saves the result.
    const storedReference = socialObject(socialJson(taskRecord.formula_reference));
    const formulaId = socialText(storedReference?.formulaId);
    const formulaVersion = socialText(storedReference?.version);
    const formula = formulaId && formulaVersion
      ? await resolveSocialContentFormulaReference({
          repository: input.repository,
          formulaId,
          version: formulaVersion,
        })
      : null;
    baseline = freezeSocialScriptBaseline({
      brief: detail.brief,
      theme: detail.theme ?? null,
      formula,
      lockedAt: new Date().toISOString(),
    });
    await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, taskRecord.id, {
      script_baseline: baseline,
      updated_at: new Date().toISOString(),
    });
  }
  const language = baseline.language;
  await writeExecutionStage({
    ...input,
    stage: 'material_adaptation',
    message: '脚本基线已锁定，内容 Agent 正在根据已上传素材调整镜头。',
    extra: { baselineOrigin: baseline.source, baselineVersion: baseline.version },
  });

  let assets = await taskProductionAssets({ tenantId: input.tenantId, sources: detail.sources });
  const adaptation = adaptBaselineToMaterials(baseline, assets);
  if (!assets.length) {
    assets = [await verifiedFactCard({
      title: detail.brief.title,
      product: socialText(detail.brief.productRef) || '本次产品',
      facts,
    })];
  }
  await writeExecutionStage({
    ...input,
    stage: 'voice_subtitles',
    message: '内容 Agent 正在生成口播和字幕，无需用户重新制作脚本。',
    extra: { adaptationNotes: adaptation.notes, narrationChanged: false },
  });
  const narration = baseline.scenes.map(scene => scene.narration).join('');
  const voice = await synthesizeStudioVoiceForAutomation({
    tenantId: input.tenantId,
    text: narration,
    language,
    voice: 'v1',
    targetDuration: 20,
    style: { preset: 'professional_b2b', speed: 1, pauseStyle: 'natural' },
  });
  if (!voice.ok || !voice.localPath || !existsSync(voice.localPath) || !voice.cues?.length) {
    throw new Error(voice.error || '口播服务未返回可用音频和字幕时间轴');
  }
  const duration = Math.max(1, Number(voice.duration || voice.cues.at(-1)?.end || 20));
  const sceneCues = buildSocialSceneTimingCues(baseline, duration);
  const timeline = buildSocialAutoProductionTimeline({ baseline, adaptation, assets, cues: sceneCues, duration });
  const adaptedScript = scriptText({ baseline, adaptation, duration, cues: sceneCues });
  await writeExecutionStage({
    ...input,
    stage: 'rendering',
    message: '内容 Agent 正在自动剪辑、混音并烧录字幕。',
    extra: { duration, sceneCount: timeline.length },
  });
  const outputDir = path.join(OUTPUT_ROOT, input.tenantId.replace(/[^\w.-]+/g, '-'));
  mkdirSync(outputDir, { recursive: true });
  const result = await composite({
    jobId: `social-${input.taskId}-${createHash('sha256').update(input.runId).digest('hex').slice(0, 12)}`,
    requireVisualAssets: true,
    spec: {
      ratio: detail.brief.aspectRatio || '9:16',
      resolution: '720p',
      duration,
      platform: detail.brief.platforms[0] || 'douyin',
      language,
      bgmVol: 0,
      voiceVol: 100,
    },
    timeline,
    voiceover: { url: voice.localPath },
    bgm: { id: null, url: null },
    subtitles: {
      mode: 'target',
      cues: voice.cues,
      style: { fontScale: 1, bottomRatio: 0.18 },
    },
  }, undefined, outputDir);
  if (!result.ok || !result.outputPath || !existsSync(result.outputPath)) {
    throw new Error(result.error || '视频渲染没有生成输出文件');
  }
  await writeExecutionStage({
    ...input,
    stage: 'quality_check',
    message: '内容 Agent 正在检查成片画面、音轨和字幕。',
  });
  const quality = await inspectRenderedVisuals({
    outputPath: result.outputPath,
    expectedDuration: duration,
    expectedUniqueScenes: Math.max(1, Math.min(assets.length, baseline.scenes.length)),
  });
  if (!quality.passed) throw new Error(`成片画面质检未通过：${quality.failures.join('；')}`);
  const audio = await runVisualFfmpeg([
    '-i', result.outputPath, '-map', '0:a:0', '-t', String(Math.min(2, duration)), '-f', 'null', '-',
  ]);
  if (!audio.ok) throw new Error('成片音轨无法解码，已停止提交验收');

  const stored = await storeSocialContentFile({
    stream: createReadStream(result.outputPath),
    tenantId: input.tenantId,
    name: `${detail.brief.title || '社媒内容'}-成品.mp4`,
    mimeType: 'video/mp4',
    declaredLength: statSync(result.outputPath).size,
    materialLibrary: false,
  });
  const file = await registerSocialContentFile({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    taskId: input.taskId,
    usage: 'artifact_media',
    idempotencyKey: `social-auto-file:${input.taskId}:${stored.sha256}`,
    stored,
  });
  const artifactResult = await createSocialContentArtifact({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    taskId: input.taskId,
    idempotencyKey: `social-auto-artifact:${input.runId}`,
    trustedAgentOrigin: true,
    value: {
      kind: 'short_video',
      platform: detail.brief.platforms[0] || null,
      language,
      origin: 'agent',
      resourceRef: file.fileRef,
      content: {
        workflowSchema: AUTO_SCHEMA,
        sourceKey: `social_task_auto:${input.taskId}`,
        contentType: 'short_video',
        scriptBaseline: {
          version: baseline.version,
          source: baseline.source,
          language: baseline.language,
          lockedAt: baseline.lockedAt,
          scenes: baseline.scenes.map(scene => ({
            sceneId: scene.sceneId,
            shotFunction: scene.shotFunction,
            subject: scene.subject,
            action: scene.action,
            narration: scene.narration,
          })),
        },
        adaptedScript,
        scriptAdaptation: adaptation,
        narration: {
          changedFromBaseline: false,
          source: voice.source || 'unknown',
          duration,
          cueCount: voice.cues.length,
        },
        render: {
          completed: true,
          materialSourceIds: detail.sources.filter(source => source.kind === 'material').map(source => source.sourceId),
          qualityPassed: true,
          qualityMetrics: quality.metrics,
          audioDecoded: true,
          degradation: adaptation.limitedMaterialFallback ? adaptation.notes : [],
        },
        review: { state: 'requires_user_approval', automatedChecksPassed: true },
        productionHash: socialRequestHash({ baseline, adaptation, sha256: stored.sha256 }),
      },
    },
  });
  await finishExecution({ ...input, artifactId: artifactResult.artifact.artifactId });
}

const activeProductions = new Map<string, Promise<void>>();

/** Fire-and-observe entry point: API admission returns immediately while the worker renders in-process. */
export function enqueueSocialContentAutoProduction(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  runId: string;
}): void {
  const key = `${input.tenantId}\u0000${input.taskId}`;
  if (activeProductions.has(key)) return;
  const pending = runOutsideSocialContentMutationScope(() => (
    new Promise<void>(resolve => setImmediate(resolve))
      .then(() => runSocialContentAutoProduction(input))
      .catch(error => failExecution({ ...input, error }))
      .finally(() => activeProductions.delete(key))
  ));
  activeProductions.set(key, pending);
}

export function socialContentAutoProductionActive(tenantId: string, taskId: string): boolean {
  return activeProductions.has(`${tenantId}\u0000${taskId}`);
}
