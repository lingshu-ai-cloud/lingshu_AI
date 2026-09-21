import { createPersonSwapRouter } from './personSwap.js';
import { finalizeMaterialScript } from '../lib/materialScriptFinalizer.js';
import { createShootingTasksRouter } from './shootingTasks.js';
import { auditShotEvidence } from '../lib/shotEvidenceAudit.js';
import { validateSpeechCues } from '../../src/lib/narrationAlignment.js';
import { studioRenderMediaRouter } from '../lib/studioRenderMedia.js';
import { createStudioAsrRouter } from '../lib/studioAsrRouter.js';
import type { AvatarMediaCheck } from '../lib/avatarMediaCheck.js';
import { createStudioAvatarProductionRouter } from '../lib/studioAvatarProduction.js';
import { refreshStudioProjectAssetUrls, studioProjectSpecForStorage } from '../lib/studioProjectAssets.js';
export { refreshStudioProjectAssetUrls, studioProjectSpecForStorage } from '../lib/studioProjectAssets.js';
import { matchedReferenceIndustryLeaks } from '../lib/referenceIndustryLeak.js';
export { matchedReferenceIndustryLeaks } from '../lib/referenceIndustryLeak.js';
import { materialRoleFromFolder, safeMaterialScenes, safeMaterialVoicePlan } from '../lib/studioMaterialPresentation.js';
import { productIdentity } from '../digitalEmployees/contentProduction.js';
import { requestMaterialAnalysis, waitForMaterialAnalysis, isMaterialAnalysisActive } from '../lib/materialLibraryAnalysis.js';
import { readMaterialLibrary, readLocalMaterials, saveLocalMaterials, updateLocalMaterial } from '../lib/materialLibrary.js';
import { mixedStoryboardRules, mixedStoryboardIssues } from './mixedStoryboardContract.js';
import { alignQwenFile } from '../integrations/qwenAlignment.js';
import { contentLibraryRouter } from './contentLibrary.js';
import { spokenLanguageMatches } from '../../shared/contracts/videoCreationPlan.js';
import { normalizeVideoLanguage, VIDEO_LANGUAGES } from '../../shared/contracts/videoLanguages.js';
import { inspectRenderedVisuals } from '../lib/renderVisualQuality.js';
import { downloadHeygenSubtitles, heygenConfigured, heygenRequest, listHeygenAvatars, submitHeygenVideo, downloadHeygenOutput } from '../integrations/heygen.js';
import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'node:os';
import { fileURLToPath } from 'url';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile, spawn } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import ffmpegStatic from 'ffmpeg-static';
import { callLLM } from '../agents/llm.js';
import { SCRIPT_CREATIVE_QUALITY_RULES, SCRIPT_FACT_TO_VALUE_EXAMPLES, scriptUnusedFacts, scriptSelectedFactPhrase, scriptSelectedFactProductName, scriptNarrationLinesFromPlan, scriptNarrationBudget, scriptEndingRules, scriptCreativeModeRule, scriptVariantDirection } from '../prompts/scriptCreativeQuality.js';
import { buildEnterpriseContext, readTenantEnterpriseProfile } from './enterprise.js';
import { auth, store } from '../storage/index.js';
import {
  entitlementGate,
  getTenantSubscription,
  isEntitled,
  isSubscriptionEnforced,
} from '../middleware/subscription.js';
import { signRenderToken } from '../lib/renderToken.js';
import { consumeDemoQuota, isDemoMode } from '../lib/demo.js';
import { generatePosterImage, imageExt, type ReferenceImage } from '../lib/imageGen.js';
import { getPublicOrigin } from '../lib/oauthConfig.js';
import { releaseSeedanceBudget, reserveSeedanceBudget, type SeedanceBudgetReservation } from '../lib/seedanceBudget.js';
import { createLinkedAbort } from '../lib/abort.js';
import { invalidatePublishingApprovalForProject } from '../digitalEmployees/publishingExecution.js';
import { verifiedStudioGenerationFromSpec } from '../lib/studioGenerationVerification.js';
import {
  assessScriptQualityV2,
  isBusinessRoleEntity,
  productInfoSupportsNumericClaim,
} from '../lib/studioScriptQualityV2.js';
import {
  auditCommercialClaims,
  confirmationFields,
  confirmedEnterpriseContextForProduct,
  hasConfirmedEnterpriseFacts,
  normalizedFactValue,
  referenceForbiddenTerms,
  referenceIndustryLeakTerms,
  storyboardReferenceLeakIssues,
  stripStoryboardHashtags,
  stripStoryboardReferenceLeaks,
  unconfirmedEnterpriseProductFields,
  unsupportedNumericClaims,
  upstreamGenerationFailure,
  userFacingLeadPackageText,
  userFacingPosterText,
} from '../lib/studioGenerationTruthfulness.js';
export {
  auditCommercialClaims,
  confirmedEnterpriseContextForProduct,
  hasConfirmedEnterpriseFacts,
  storyboardReferenceLeakIssues,
  stripStoryboardHashtags,
  stripStoryboardReferenceLeaks,
  unconfirmedEnterpriseProductFields,
  unsupportedNumericClaims,
} from '../lib/studioGenerationTruthfulness.js';
import { canAppearInSharedLibrary, isReferenceOnlyMaterial, materialUsage, type MaterialUsage } from '../lib/materialPolicy.js';
import { cloudMaterialView, createCloudMaterial, deleteOwnedCloudMaterial, fetchCloudMaterial, getCloudMaterialRecord, getOwnedCloudMaterialRecord, listCloudMaterials, updateCloudMaterial } from '../lib/cloudMaterials.js';
import { analyzeVideo } from '../agents/gemini.js';
import {
  analyzeVideoFramesWithQwen,
  classifyMaterialFramesWithQwen,
  qualityCheckStoryboardFramesWithQwen,
  transcribeAudioWithQwen,
} from '../agents/qwen.js';
import { extractQwenAnalysisFrames } from './videos.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { signAssetUrl, signPathAssetUrl, sharedAssetRelativePath, tenantAssetDir, tenantAssetRelativePath } from '../lib/assetAccess.js';
import { requireAdminUser } from '../lib/demoAccounts.js';
import { listPublishRecords, recommendPublish, type PublishPlatform } from '../lib/publishHistory.js';
import { assessTransformation, commercialDigitalHumanGate, type TransformationAssessmentInput } from '../lib/creativeTransformation.js';
import { objectStorageEnabled, r2Delete, r2Download, r2GetObject, r2Head, r2SignedGetUrl, r2Upload } from '../storage/r2.js';
import { materialAssetContentType, materialAssetObjectKey, materialAssetTypeAllowed, sharedObjectKey, tenantPrivateObjectKey } from '../storage/materialAssets.js';
import { isSyntheticMaterial } from '../lib/materialTruthfulness.js';
import { bindSocialProjectSpec, socialProjectBelongs, socialProjectTaskId } from '../starter198/socialProjectScope.js';
import {
  THEME_PROMPT_CONSTRAINTS,
  buildScriptContentPlan,
  createScriptStrategyBrief,
  renderScriptContentPlan,
  type ContentTheme,
  type CooperationRoute,
} from '../strategy/scriptBrief.js';

/* ──────────────────────────────────────────────────────────────────────────
   Studio 路由 —— 服务于「社媒 / AI 生成内容」混剪工作台
   负责脚本 / 文案 / 封面标题 / 智能选材 / Seedance 视频生成等工作台能力。
   视频生成必须真实调用外部模型；失败时返回明确错误，不生成本地假预览。
─────────────────────────────────────────────────────────────────────────── */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioTenantContext = new AsyncLocalStorage<string>();
function scopedStudioAssetDir(root: string): string {
  const tenantId = studioTenantContext.getStore();
  if (!tenantId) throw new Error('studio tenant context unavailable');
  return tenantAssetDir(root, tenantId);
}
function scopedStudioAssetUrl(prefix: string, file: string): string {
  const tenantId = studioTenantContext.getStore();
  if (!tenantId) throw new Error('studio tenant context unavailable');
  return signAssetUrl(`/${prefix}/${tenantAssetRelativePath(tenantId, file)}`, tenantId);
}
const require = createRequire(import.meta.url);
const { composite } = require('../../desktop/render.cjs') as {
  composite: (manifest: unknown, onProgress?: (pct: number) => void, outDir?: string) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
};
function publishingRenderDir(tenantId: string): string {
  const tenantFolder = String(tenantId || 'local').replace(/[^\w.-]+/g, '-');
  return path.resolve(process.cwd(), 'data', 'publishing-uploads', tenantFolder);
}

function publishingRenderPreviewUrl(tenantId: string, outputPath: string): string {
  const route = `/api/overseas/studio/local-renders/${encodeURIComponent(path.basename(outputPath))}`;
  return signAssetUrl(route, tenantId, 24 * 60 * 60 * 1000);
}

function execFileAsync(file: string, args: string[], timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout }, (err, stdout) => (err ? reject(err) : resolve(String(stdout || ''))));
  });
}

async function enterpriseCtx(): Promise<string> {
  const tenantId = studioTenantContext.getStore();
  if (!tenantId) return '';
  try { return buildEnterpriseContext(await readTenantEnterpriseProfile(tenantId)); }
  catch { return ''; }
}

const LANG_NAME: Record<string, string> = {
  en: 'English', zh: 'Chinese (Simplified)', es: 'Spanish', fr: 'French',
  de: 'German', pt: 'Portuguese', it: 'Italian', ru: 'Russian',
  ja: 'Japanese', ko: 'Korean', ar: 'Arabic', hi: 'Hindi',
  id: 'Indonesian', th: 'Thai', vi: 'Vietnamese', tr: 'Turkish',
  nl: 'Dutch', pl: 'Polish', sv: 'Swedish', fil: 'Filipino',
  ms: 'Malay', uk: 'Ukrainian', el: 'Greek', cs: 'Czech',
  ro: 'Romanian', hu: 'Hungarian',
};

function langName(code: string): string {
  return LANG_NAME[code] ?? 'English';
}

type ReferenceTimelineRange = { start: number; end: number };

function referenceTimelineQuality(referenceAnalysis: unknown, requestedDuration: unknown): {
  valid: boolean;
  issues: string[];
  ranges: ReferenceTimelineRange[];
  duration: number;
} {
  const raw = String(referenceAnalysis || '');
  // Only treat a line-leading range as a shot. Beat timestamps embedded inside
  // the shot description must not inflate density or create false overlaps.
  const ranges = Array.from(raw.matchAll(/^\s*\[\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—~至]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\]/gim))
    .map(match => ({ start: Number(match[1]), end: Number(match[2]) }))
    .filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const requested = Number(requestedDuration || 0);
  const analyzedEnd = ranges.reduce((max, item) => Math.max(max, item.end), 0);
  // The source duration is normally reflected by the last exact-analysis range.
  // Do not let the studio's default target duration make a shorter source look incomplete.
  const duration = analyzedEnd > 0 ? analyzedEnd : Math.max(0, requested);
  const issues: string[] = [];
  if (!ranges.length) issues.push('缺少可解析的逐镜时间戳');
  if (ranges.length && ranges[0]!.start > 0.75) issues.push(`时间线未从片头开始（首段 ${ranges[0]!.start.toFixed(1)}s）`);
  for (let index = 0; index < ranges.length; index += 1) {
    const item = ranges[index]!;
    if (item.end - item.start > 5.5) issues.push(`存在过长分镜 [${item.start}-${item.end}s]`);
    const next = ranges[index + 1];
    if (next && next.start - item.end > 0.75) issues.push(`时间线存在空档 ${item.end.toFixed(1)}-${next.start.toFixed(1)}s`);
    if (next && item.end - next.start > 0.75) issues.push(`时间线存在重叠 ${next.start.toFixed(1)}-${item.end.toFixed(1)}s`);
  }
  const minShots = duration > 0 ? Math.ceil(duration / 5) : 1;
  if (ranges.length < minShots) issues.push(`分镜密度不足（${ranges.length} 段，至少需要 ${minShots} 段）`);
  // A review flag records honest uncertainty about names, prices, handedness
  // or ASR and does not make the visual timeline incomplete. Only genuine
  // timeout/missing-evidence placeholders should block storyboard generation.
  if (/分析超时|缺少真实片段/.test(raw)) {
    issues.push('分析包含超时或缺少真实片段');
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)], ranges, duration };
}

function analysisDetailsTimelineQuality(details: unknown, duration: unknown) {
  const rows = Array.isArray(details)
    ? details.map(item => `[${String((item as { time?: unknown })?.time || '').replace(/^\s*\[|\]\s*$/g, '')}]`).join('\n')
    : '';
  return referenceTimelineQuality(rows, duration);
}

const GENERATED_MEDIA_DIR = path.join(__dirname, '../../data/media/generated');
const GEMINI_VIDEO_WORKER = path.join(__dirname, '../../scripts/gemini-video-worker.mjs');
const SEEDANCE_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';

function geminiVideoConfig() {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  const model = (process.env.GEMINI_VIDEO_MODEL || 'veo-2.0-generate-001').trim();
  return { apiKey, model };
}

function isGeminiVideoEnabled(): boolean {
  return process.env.GEMINI_VIDEO_ENABLED === 'true';
}

function seedanceVideoConfig() {
  const apiKey = (process.env.SEEDANCE_API_KEY || '').trim();
  const baseUrl = (process.env.SEEDANCE_BASE_URL || SEEDANCE_BASE_URL).replace(/\/+$/, '');
  const model = (process.env.SEEDANCE_MODEL || 'doubao-seedance-2-0-fast-260128').trim();
  const timeoutMs = Math.max(60_000, Number(process.env.SEEDANCE_VIDEO_TIMEOUT_MS || 600_000));
  const pollIntervalMs = Math.max(2_000, Number(process.env.SEEDANCE_VIDEO_POLL_INTERVAL_MS || 8_000));
  return { apiKey, baseUrl, model, timeoutMs, pollIntervalMs };
}

function isSeedanceVideoEnabled(): boolean {
  return process.env.SEEDANCE_VIDEO_ENABLED === 'true';
}

function normalizeGeminiVideoDuration(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 8;
  // Current Gemini/Veo API accepts only 5-8 seconds for durationSeconds.
  return Math.max(5, Math.min(8, Math.round(n)));
}

function normalizeSeedanceVideoDuration(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 8;
  // Seedance 2.0 supports integer durations from 4 to 15 seconds.
  return Math.max(4, Math.min(15, Math.round(n)));
}

function generatedMediaUrl(tenantId: string, file: string): string {
  return `/media/${tenantAssetRelativePath(tenantId, file)}`;
}

async function createGeneratedVideoMaterial(input: {
  title: string;
  filename: string;
  duration: number;
  tenantId: string;
  sourceType?: string;
}): Promise<Material | null> {
  const filePath = path.join(tenantAssetDir(MEDIA_DIR, input.tenantId), input.filename);
  if (!fs.existsSync(filePath)) return null;
  const id = randomUUID();
  const posterFile = `${id}.poster.jpg`;
  const posterPath = path.join(tenantAssetDir(MEDIA_DIR, input.tenantId), posterFile);
  const material: Material = {
    id,
    name: input.title || 'Seedance 生成视频',
    folder: 'upload',
    type: 'video',
    duration: Number(input.duration) || 0,
    size: humanSize(fs.statSync(filePath).size),
    file: tenantAssetRelativePath(input.tenantId, input.filename),
    url: generatedMediaUrl(input.tenantId, input.filename),
    scope: 'own',
    tenantId: input.tenantId,
    sourceType: input.sourceType || 'ai-generated',
    createdAt: new Date().toISOString(),
  };
  const posterOk = await extractPoster(filePath, posterPath, material.duration > 1 ? 1 : 0);
  if (posterOk) material.poster = generatedMediaUrl(input.tenantId, posterFile);
  if (objectStorageEnabled()) {
    material.objectKey = materialAssetObjectKey(input.tenantId, input.filename);
    await r2Upload({ key: material.objectKey, body: fs.readFileSync(filePath), contentType: materialAssetContentType(input.filename) });
    material.url = '';
    if (posterOk) {
      material.posterObjectKey = materialAssetObjectKey(input.tenantId, posterFile);
      await r2Upload({ key: material.posterObjectKey, body: fs.readFileSync(posterPath), contentType: 'image/jpeg' });
      material.poster = undefined;
    }
    fs.rmSync(filePath, { force: true });
    fs.rmSync(posterPath, { force: true });
  }
  const list = loadMaterials().filter(item => item.url !== material.url);
  list.push(material);
  persistMaterials(list);
  return material;
}

async function createGeneratedImageMaterial(input: {
  title: string;
  bytes: Buffer;
  mimeType: string;
  source?: string;
  tenantId: string;
}): Promise<Material> {
  const outputDir = tenantAssetDir(MEDIA_DIR, input.tenantId);
  fs.mkdirSync(outputDir, { recursive: true });
  const id = randomUUID();
  const ext = imageExt(input.mimeType);
  const filename = `${id}.${ext}`;
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, input.bytes);
  const material: Material = {
    id,
    name: input.title || 'AI 图文海报',
    folder: 'product',
    type: 'image',
    duration: 0,
    size: humanSize(input.bytes.length),
    file: tenantAssetRelativePath(input.tenantId, filename),
    url: generatedMediaUrl(input.tenantId, filename),
    poster: generatedMediaUrl(input.tenantId, filename),
    scope: 'own',
    tenantId: input.tenantId,
    createdAt: new Date().toISOString(),
  };
  if (objectStorageEnabled()) {
    material.objectKey = materialAssetObjectKey(input.tenantId, filename);
    material.posterObjectKey = material.objectKey;
    await r2Upload({ key: material.objectKey, body: input.bytes, contentType: input.mimeType });
    material.url = '';
    material.poster = undefined;
    fs.rmSync(filePath, { force: true });
  }
  const list = loadMaterials().filter(item => item.url !== material.url);
  list.push(material);
  persistMaterials(list);
  console.log(`[studio] generated poster image material ${material.id} via ${input.source || 'image-model'}`);
  return material;
}

async function seedanceFetchJson(url: string, apiKey: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await response.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const detail = json?.error?.message || json?.message || json?.error || text || response.statusText;
    throw new Error(`Seedance API ${response.status}: ${String(detail).slice(0, 500)}`);
  }
  return json;
}

function findUrlDeep(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return /^https?:\/\/.+/i.test(value) ? value : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUrlDeep(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['url', 'video_url', 'videoUrl', 'content_url', 'contentUrl']) {
      const found = findUrlDeep(obj[key]);
      if (found) return found;
    }
    for (const item of Object.values(obj)) {
      const found = findUrlDeep(item);
      if (found) return found;
    }
  }
  return null;
}

function seedanceTaskStatus(task: any): string {
  return String(task?.status || task?.data?.status || task?.task?.status || '').toLowerCase();
}

function seedanceTaskId(task: any): string {
  return String(task?.id || task?.data?.id || task?.task?.id || '').trim();
}

function summarizeSeedanceError(error: unknown): string {
  const text = String((error as any)?.message ?? error);
  if (/not activated the model|do not have access|model or endpoint/i.test(text)) {
    return '当前方舟账号尚未开通所选 Seedance 模型服务。请在火山方舟控制台开通 Seedance 2.0 模型，或把 SEEDANCE_MODEL 改成已开通的模型/接入点 ID。';
  }
  if (/api key/i.test(text)) {
    return 'Seedance API Key 无效或不属于当前区域，请检查火山方舟 API Key 和 SEEDANCE_BASE_URL。';
  }
  return text.slice(0, 500);
}

async function waitForSeedanceTask(config: ReturnType<typeof seedanceVideoConfig>, taskId: string): Promise<any> {
  const deadline = Date.now() + config.timeoutMs;
  let lastTask: any = null;
  while (Date.now() < deadline) {
    lastTask = await seedanceFetchJson(`${config.baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`, config.apiKey);
    const status = seedanceTaskStatus(lastTask);
    if (['succeeded', 'success', 'completed', 'done'].includes(status)) return lastTask;
    if (['failed', 'error', 'expired', 'cancelled', 'canceled'].includes(status)) {
      const reason = lastTask?.error?.message || lastTask?.message || lastTask?.error || status;
      throw new Error(`Seedance 任务失败：${String(reason).slice(0, 500)}`);
    }
    await new Promise(resolve => setTimeout(resolve, config.pollIntervalMs));
  }
  throw new Error(`Seedance 任务超时${lastTask ? `，最后状态：${seedanceTaskStatus(lastTask) || 'unknown'}` : ''}`);
}

async function downloadGeneratedVideo(url: string, filename: string, tenantId: string): Promise<string> {
  const outputDir = tenantAssetDir(MEDIA_DIR, tenantId);
  fs.mkdirSync(outputDir, { recursive: true });
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`视频下载失败：${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(path.join(outputDir, filename), Buffer.from(arrayBuffer));
  return generatedMediaUrl(tenantId, filename);
}

function proxyEnvDefaults() {
  const proxy = process.env.GEMINI_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7890';
  return {
    NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY || '1',
    HTTPS_PROXY: process.env.HTTPS_PROXY || proxy,
    HTTP_PROXY: process.env.HTTP_PROXY || proxy,
    https_proxy: process.env.https_proxy || process.env.HTTPS_PROXY || proxy,
    http_proxy: process.env.http_proxy || process.env.HTTP_PROXY || proxy,
  };
}

async function runGeminiVideoWorker(job: Record<string, unknown>, timeoutMs: number) {
  fs.mkdirSync(GENERATED_MEDIA_DIR, { recursive: true });
  const jobFile = path.join(GENERATED_MEDIA_DIR, `gemini-job-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(jobFile, JSON.stringify(job), 'utf8');
  try {
    const result = await new Promise<any>((resolve, reject) => {
      const child = spawn(process.execPath, [GEMINI_VIDEO_WORKER, jobFile], {
        cwd: path.join(__dirname, '../..'),
        env: { ...process.env, ...proxyEnvDefaults() },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Gemini video worker timed out'));
      }, timeoutMs + 30_000);
      child.stdout.on('data', chunk => { stdout += chunk.toString(); });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.on('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', code => {
        clearTimeout(timer);
        const text = stdout.trim();
        if (!text) {
          reject(new Error((stderr || `Gemini video worker exited with code ${code}`).slice(0, 500)));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          const jsonStart = text.lastIndexOf('{"ok"');
          if (jsonStart >= 0) {
            try {
              resolve(JSON.parse(text.slice(jsonStart)));
              return;
            } catch {}
          }
          reject(new Error(`Gemini video worker returned invalid JSON: ${text.slice(0, 300)}`));
        }
      });
    });
    return result;
  } finally {
    try { fs.unlinkSync(jobFile); } catch {}
  }
}

/** 从 LLM 输出里抽取第一个 JSON（对象或数组） */
function extractJSON<T>(text: string): T | null {
  const match = text.match(/[[{][\s\S]*[\]}]/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}


function stripScriptAnalysisSummary(text: string): string {
  const value = String(text || '').trim();
  const forbiddenBlockRe = /^\s*(?:【?\s*)?(?:基础要求|分析摘要|竞品识别|产品替换|参考爆款|成片目标|指定画风|核心情绪|参考品牌|口播语言|爆点拆解|产品承接|Purpose|Creative style|Core emotion|Product replacement|Voiceover language|Goal|Storyboard)(?:\s*】)?\s*[：:].*$/i;
  const firstTimestamp = value.search(/(?:^|\n)\s*(?:\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\]|Scene\s+\d+\s*\()/i);
  if (firstTimestamp > 0) {
    const head = value.slice(0, firstTimestamp);
    if (/基础要求|分析摘要|竞品识别|产品替换|参考爆款|成片目标|指定画风|核心情绪|对标视频|参考品牌|口播语言/.test(head)) {
      return value.slice(firstTimestamp).trim();
    }
  }
  return value
    .split(/\n+/)
    .filter(line => !forbiddenBlockRe.test(line))
    .join('\n')
    .trim();
}

function normalizeScriptTimestamps(value: string): string {
  const clean = (raw: string) => {
    const number = Number(raw);
    return Number.isFinite(number)
      ? number.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
      : raw;
  };
  return String(value || '').replace(
    /\[\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\]/gi,
    (_match, start, end) => `[${clean(start)}-${clean(end)}s]`,
  );
}

function enforceProductNameInScript(script: string, productInfo: string): string {
  const productName = compactProductLabel(productInfo).trim();
  if (!productName || /^(this product|主推产品|企业产品组合)$/i.test(productName)) return script;
  return String(script || '')
    .replace(/「企业产品组合」|“企业产品组合”|企业产品组合/g, `「${productName}」`)
    .replace(/「主推产品」|“主推产品”|主推产品/g, `「${productName}」`)
    .replace(/\bthis product\b/gi, productName);
}

export function ensureSelectedProductNamesInScript(script: string, productInfo: string): string {
  const names = selectedProductNames(productInfo);
  let next = String(script || '');
  for (const name of names) {
    if (!name || normalizeProductIdentity(next).includes(normalizeProductIdentity(name))) continue;
    const blocks = next.split(/(?=^\[[^\]\r\n]+\][ \t]*$)/m);
    const index = blocks.findIndex(block => /^\[[^\]]+\]/.test(block) && /^画面[：:]/m.test(block)
      && !/^画面[：:]\s*数字人[：:]/m.test(block));
    if (index < 0) continue;
    // Put identity in a visual direction, not the subtitle. Subtitles are
    // mechanically synchronized from voiceover later and would otherwise
    // erase the injected product names again.
    blocks[index] = blocks[index]!.replace(/^(画面[：:]\s*)([^\n]*)/m, (_line, prefix, visual) => `${prefix}${visual ? `${visual}；` : ''}展示 ${name}`);
    next = blocks.join('');
  }
  return next;
}

function selectedProductNames(productInfo: string): string[] {
  return Array.from(String(productInfo || '').matchAll(/产品名称[：:]\s*([^\n]+)/g))
    .map(match => String(match[1] || '').trim())
    .filter(Boolean);
}

function productFactCandidates(productInfo: string): string[] {
  const factLines = String(productInfo || '').split('\n').flatMap(line => {
    const match = line.match(/^(?:产品卖点|核心优势|已核实事实|产品规格|规格参数)[：:]\s*(.+)$/i);
    if (!match?.[1]) return [];
    return match[1].split(/[；;。]\s*/);
  });
  return Array.from(new Set(factLines.map(item => item.trim()).filter(Boolean)));
}

function dedupeStoryboardProductNameSubtitles(script: string, productInfo: string): string {
  const names = selectedProductNames(productInfo);
  if (!names.length) return script;
  const seen = new Set<string>();
  return String(script || '').split('\n').map(line => {
    if (!/^字幕[：:]/.test(line)) return line;
    let next = line;
    for (const name of names) {
      if (!next.includes(name)) continue;
      if (seen.has(name)) next = next.replace(name, '产品');
      else seen.add(name);
    }
    return next;
  }).join('\n');
}

function normalizeProductIdentity(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u00a0「」“”"'（）()【】\[\]·•・,，。；;：:!！?？/_-]+/g, '');
}

function normalizeScriptPart(value: string): string {
  return String(value || '')
    .replace(/\d+(?:\.\d+)?\s*(?:s|秒|天|day|days|%|个|pcs|件|箱|元|美元)?/gi, '#')
    .replace(/[「」"“”'（）()【】\[\],，。；;：:\s/]+/g, '')
    .replace(/企业产品组合|主推产品|thisproduct/gi, '产品')
    .toLowerCase();
}

function extractField(block: string, labels: string[]): string {
  for (const label of labels) {
    const match = block.match(new RegExp(`${label}\\s*[：:]\\s*([^\\n]+)`, 'i'));
    if (match?.[1]) return match[1].trim();
  }
  return block.trim();
}

function jaccardSimilarity(a: string, b: string): number {
  const grams = (text: string) => {
    const normalized = normalizeScriptPart(text);
    const out = new Set<string>();
    for (let i = 0; i < Math.max(1, normalized.length - 1); i += 1) out.add(normalized.slice(i, i + 2));
    return out;
  };
  const left = grams(a);
  const right = grams(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  left.forEach(item => { if (right.has(item)) overlap += 1; });
  return overlap / Math.max(left.size, right.size);
}

function hasRepetitiveStoryboard(script: string): boolean {
  const blocks = String(script || '')
    .split(/(?=\n?\s*(?:\[\s*\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?\s*s?\s*\]|Scene\s+\d+\s*\())/i)
    .map(item => item.trim())
    .filter(item => item.length > 20);
  if (blocks.length < 3) return false;
  const visualKeys = blocks.map(block => normalizeScriptPart(extractField(block, ['画面', 'Visual'])));
  const voiceKeys = blocks.map(block => normalizeScriptPart(extractField(block, ['人物说', '台词', 'Voiceover'])));
  const repeatedVisuals = visualKeys.filter((key, index) => key && visualKeys.indexOf(key) !== index).length;
  const repeatedVoices = voiceKeys.filter((key, index) => key && voiceKeys.indexOf(key) !== index).length;
  if (repeatedVisuals >= 2 || repeatedVoices >= 2) return true;
  let similarPairs = 0;
  for (let i = 1; i < blocks.length; i += 1) {
    if (jaccardSimilarity(blocks[i - 1]!, blocks[i]!) > 0.72) similarPairs += 1;
  }
  return similarPairs >= Math.max(2, Math.floor(blocks.length / 2));
}

const TECH_TERM_RE = /\b(?:CE|RoHS|UKCA|ETL|IES\/?LDT|LDT|IP\d{2,}|BSCI|REACH|ISO\d*|MOQ|OEM|ODM|SKU)\b|认证资质|认证|型号|光学文件|检测报告|参数|色温|显指|防护等级/gi;

function techTermCount(value: string): number {
  return Array.from(String(value || '').matchAll(TECH_TERM_RE)).length;
}

function hasUnnaturalVoiceover(script: string): boolean {
  return String(script || '')
    .split(/\n+/)
    .some(line => {
      const match = line.match(/(?:台词|人物说|Voiceover|VO|口播)\s*[：:]\s*(.+)$/i);
      if (!match?.[1]) return false;
      const text = match[1].replace(/\s+/g, ' ').trim();
      const tooLong = /[\u3400-\u9fff]/.test(text)
        ? Array.from(text.replace(/\s/g, '')).length > 72
        : text.split(/\s+/).filter(Boolean).length > 20;
      return techTermCount(text) >= 3 || tooLong || /CE[、,，\s]+RoHS[、,，\s]+UKCA/i.test(text);
    });
}

export function storyboardSpeechIssues(script: string): string[] {
  const issues: string[] = [];
  const blocks = String(script || '').split(/(?=\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\])/i);
  for (const block of blocks) {
    const range = block.match(/\[\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\]/i);
    const voice = block.match(/(?:人物说|台词|Voiceover|VO|口播)\s*[：:]\s*[“"]?([^\n”"]+)/i)?.[1]?.trim();
    if (!range || !voice) continue;
    const duration = Math.max(0, Number(range[2]) - Number(range[1]));
    if (!duration) {
      issues.push(`${range[0]} 时间段无效`);
      continue;
    }
    const cjkChars = Array.from(voice).filter(char => /[\u3400-\u9fff]/.test(char)).length;
    const latinWords = voice.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length || 0;
    const estimated = cjkChars > 0
      ? cjkChars / 4.5 + latinWords / 2.5 + 0.6
      : latinWords / 2.5 + 0.5;
    if (estimated > duration + 0.35) {
      issues.push(`${range[0]} 口播预计${estimated.toFixed(1)}秒，超过镜头${duration.toFixed(1)}秒`);
    }
  }
  return issues;
}

export function fitSpeechToShot(value: string, duration: number): string {
  const text = String(value || '').replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim();
  if (!text || text === '无') return '无';
  const hasCjk = /[\u3400-\u9fff]/.test(text);
  if (!hasCjk) {
    const maxWords = Math.max(1, Math.floor(Math.max(0.5, duration - 0.15) * 2.5));
    const words = text.split(/\s+/);
    if (words.length <= maxWords) return text;
    const complete = words.slice(0, maxWords).join(' ').match(/^(.+[.!?])(?:\s|$)/)?.[1]?.trim();
    if (complete) return complete;
    const estimated = words.length / 2.5 + 0.5;
    if (estimated <= duration + 1.5) {
      const terminal = /[.!?]$/.test(text) ? text.slice(-1) : '';
      const candidates = [
        text.replace(/[.!?]$/, '').replace(/^(?:brand (?:founder|owner)|product manager|procurement|buyer|importer|distributor)[,:]\s*/i, '').replace(/\b(?:really|clearly|simply|carefully|directly|actually|currently|now|first|just|please)\b[,.]?\s*/gi, ''),
        text.replace(/[.!?]$/, '').replace(/^(?:brand (?:founder|owner)|product manager|procurement|buyer|importer|distributor)[,:]\s*/i, ''),
        text.replace(/[.!?]$/, '').replace(/\b(?:really|clearly|simply|carefully|directly|actually|currently|now|first|just|please)\b[,.]?\s*/gi, ''),
        text.replace(/[.!?]$/, '').replace(/\bhow can you\b/gi, 'how do you').replace(/\bdo you want to\b/gi, 'want to'),
      ].map(candidate => candidate.replace(/\s+/g, ' ').replace(/^[,:]\s*|\s*[,:]$/g, '').trim());
      for (const candidate of candidates) {
        if (candidate && candidate.split(/\s+/).length <= maxWords) return `${candidate}${terminal || (/^(?:how|why|which|what|can|do|is|are|should|would)\b/i.test(candidate) ? '?' : '.')}`;
      }
    }
    return text;
  }
  const maxChars = Math.max(2, Math.floor(Math.max(0.5, duration - 0.6) * 4));
  const chars = Array.from(text);
  const spokenCharCount = (candidate: string) => Array.from(candidate).filter(char => !/[\s，。！？、；：,.!?;:“”"'（）()]/.test(char)).length;
  const originalChars = spokenCharCount(text);
  if (originalChars <= maxChars) return text;
  let count = 0;
  let result = '';
  let lastComplete = '';
  for (const char of chars) {
    if (!/[\s，。！？、；：,.!?;:“”"'（）()]/.test(char)) count += 1;
    if (count > maxChars) break;
    result += char;
    if (/[。！？!?]/.test(char)) lastComplete = result.trim();
  }
  if (lastComplete) return lastComplete;

  // A small timing miss should not reject the whole material storyboard. For
  // a single Chinese sentence, remove only discourse fillers and redundant
  // modifiers, then keep the original terminal punctuation. This is semantic
  // compaction rather than character slicing, so it cannot create a fragment.
  const estimated = originalChars / 4.5 + 0.6;
  if (estimated <= duration + 1.5) {
    const terminal = /[。！？!?]$/.test(text) ? text.slice(-1) : '';
    let compact = text.replace(/[。！？!?]$/, '')
      .replace(/^(?:各位)?(?:品牌方|品牌创始人|产品经理|采购|买家)[，,：:]\s*/, '')
      .replace(/你是否正在/g, '是否')
      .replace(/我们(?:先|来)?(?:一起)?看看/g, '看看')
      .replace(/是否能够/g, '能否')
      .replace(/如何才能/g, '如何')
      .replace(/(?:到底|真正|具体|现在|首先|其实|本次|当前|这款)/g, '')
      .replace(/可以帮助/g, '能')
      .replace(/[，,]{2,}/g, '，')
      .replace(/^[，,：:]|[，,：:]$/g, '')
      .trim();
    if (compact && spokenCharCount(compact) <= maxChars) return `${compact}${terminal || (/^(?:怎么|如何|是否|能否|哪|什么|为什么)/.test(compact) ? '？' : '。')}`;
  }
  return text;
}

export function ctaSemanticallySatisfied(candidate: string, primaryCta: string): boolean {
  if (!primaryCta || candidate.includes(primaryCta)) return true;
  const requestedWhatsApp = /whatsapp|\bwa\b/i.test(primaryCta);
  const usedWhatsApp = /whatsapp|\bwa\b/i.test(candidate);
  // A named channel is part of the enterprise's single CTA. Generic contact
  // wording may not silently replace WhatsApp, or introduce it when unverified.
  if (requestedWhatsApp !== usedWhatsApp) return false;
  if (requestedWhatsApp) return /message|contact|联系|触达|咨询/i.test(candidate);
  const intentPatterns: Array<[RegExp, RegExp]> = [
    [/发送|提交|发来|分享|\bsend\b|\bshare\b|\bsubmit\b/i, /发送|提交|发来|分享|\bsend\b|\bshare\b|\bsubmit\b/i],
    [/工件|节拍|缺陷|样本|布局|参数|需求|workpiece|cycle|defect|sample|layout|specification|requirement/i, /工件|节拍|缺陷|样本|布局|参数|需求|workpiece|cycle|defect|sample|layout|specification|requirement/i],
    [/预约|安排|\bbook\b|\bschedule\b/i, /预约|安排|\bbook\b|\bschedule\b/i],
    [/诊断|评估|方案|咨询|diagnos|assessment|consult|solution/i, /诊断|评估|方案|咨询|diagnos|assessment|consult|solution/i],
    [/目录|资料|catalog|verified details|product details/i, /目录|资料|catalog|verified details|product details/i],
    [/报价|价格|quote|pricing/i, /报价|价格|quote|pricing/i],
    [/私信|联系|message|\bdm\b|contact/i, /私信|联系|message|\bdm\b|contact/i],
  ];
  const required = intentPatterns.filter(([primary]) => primary.test(primaryCta));
  if (!required.length) return false;
  const matched = required.filter(([, output]) => output.test(candidate)).length;
  return matched >= Math.min(2, required.length);
}

function safeStoryboardCta(primaryCta: string, language: string): string {
  const cta = String(primaryCta || '').trim();
  if (/whatsapp/i.test(cta)) return language === 'zh' ? '请用WhatsApp联系。' : 'Message us on WhatsApp.';
  if (language === 'zh') {
    if (/(?:发送|提交|发来|分享)/.test(cta) && /预约/.test(cta) && /(?:诊断|评估|方案|咨询)/.test(cta)) {
      const detail = /工件/.test(cta) && /节拍/.test(cta) ? '工件和节拍' : /缺陷/.test(cta) ? '缺陷样本' : '关键参数';
      return `发${detail}，预约方案诊断。`;
    }
    if (/预约/.test(cta) && /(?:诊断|评估|方案|咨询)/.test(cta)) return '预约一次方案诊断。';
    if (/(?:发送|提交|发来|分享)/.test(cta) && /工件|节拍|缺陷|样本|布局|参数|需求/.test(cta)) return '发送关键资料，获取方案建议。';
    if (/报价|价格/.test(cta)) return '发送需求，获取报价。';
    if (/目录|资料/.test(cta)) return '联系获取已核实资料。';
    return cta || '请联系我们了解已核实资料。';
  }
  if (/(?:send|share|submit)/i.test(cta) && /(?:book|schedule)/i.test(cta) && /(?:diagnos|assessment|consult|solution)/i.test(cta)) {
    return 'Share key details and book a solution review.';
  }
  if (/(?:book|schedule)/i.test(cta) && /(?:diagnos|assessment|consult|solution)/i.test(cta)) return 'Book a solution review.';
  if (/quote|pricing/i.test(cta)) return 'Share your needs for a quote.';
  if (/catalog|product details/i.test(cta)) return 'Message us for verified product details.';
  return cta || 'Message us for verified details.';
}

function shortStoryboardCta(primaryCta: string, language: string): string {
  const cta = String(primaryCta || '');
  if (/whatsapp/i.test(cta)) return language === 'zh' ? 'WhatsApp联系。' : 'Message us on WhatsApp.';
  if (language === 'zh') {
    if (/预约/.test(cta) && /(?:诊断|评估|方案|咨询)/.test(cta)) return '预约方案诊断。';
    if (/报价|价格/.test(cta)) return '发送需求报价。';
    if (/目录|资料/.test(cta)) return '联系获取资料。';
    return '联系了解详情。';
  }
  if (/(?:book|schedule)/i.test(cta) && /(?:diagnos|assessment|consult|solution)/i.test(cta)) return 'Book a solution review.';
  if (/quote|pricing/i.test(cta)) return 'Send needs for a quote.';
  return 'Message us for details.';
}

/** Keep an otherwise valid strategy script renderable even after a rewrite pass. */
export function fitStoryboardSpeech(script: string): string {
  return String(script || '').replace(
    /(\[\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\][\s\S]*?)(人物说|台词|Voiceover|VO|口播)(\s*[：:]\s*[“"]?)([^\n”"]+)([”"]?)/gi,
    (_full, prefix, start, end, label, separator, voice, quote) => `${prefix}${label}${separator}${fitSpeechToShot(voice, Math.max(0.5, Number(end) - Number(start)))}${quote}`,
  );
}

export function syncStoryboardSubtitles(script: string): string {
  return String(script || '').split(/(?=^[ \t]*\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\][ \t]*$)/m).map(block => {
    if (!/^\s*\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\]/.test(block)) return block;
    const voice = block.match(/^台词[：:]\s*(.+)$/m)?.[1]?.trim() || '';
    if (!voice || /^(无|none)$/i.test(voice)) return block;
    if (/^字幕[：:]/m.test(block)) return block.replace(/^字幕[：:].*$/m, `字幕：${voice}`);
    return block.replace(/^(台词[：:].*)$/m, `$1\n字幕：${voice}`);
  }).join('');
}

export function normalizeStoryboardFieldLines(script: string): string {
  const labels = '素材|环境|景别|运镜|构图|镜头功能|画面|配乐|台词|字幕';
  return String(script || '')
    .replace(/^[ \t]*(?:[-*•][ \t]+|\d+[.)][ \t]+)?(?=\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\][ \t]*$)/gm, '')
    .replace(/(\[[^\]\r\n]+\])[ \t]+(?=(?:素材|环境|景别|运镜|构图|镜头功能|画面|配乐|台词|字幕)[：:])/g, '$1\n')
    .replace(new RegExp(`[ \\t]+(?=(?:${labels})[：:])`, 'g'), '\n')
    .trim();
}

export function dedupeStoryboardFieldLines(script: string): string {
  const fields = new Set(['素材', '环境', '景别', '运镜', '构图', '镜头功能', '画面', '配乐', '台词', '字幕']);
  return String(script || '').split(/(?=^[ \t]*\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\][ \t]*$)/m).map(block => {
    if (!/^\s*\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]/.test(block)) return block;
    const seen = new Set<string>();
    return block.split('\n').filter(line => {
      const field = line.match(/^\s*([^：:\n]+)[：:]/)?.[1]?.trim() || '';
      if (!fields.has(field)) return true;
      if (seen.has(field)) return false;
      seen.add(field);
      return true;
    }).join('\n');
  }).join('');
}

export function restoreProductStoryboardBoundaries(script: string): string {
  const scenes: string[][] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.some(line => /^(?:环境|景别|运镜|构图|镜头功能|画面|配乐|台词|字幕)[：:]/.test(line))) scenes.push(current);
    current = [];
  };
  for (const rawLine of normalizeStoryboardFieldLines(script).split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^\[[^\]]+\]$/.test(line)) {
      flush();
      continue;
    }
    if (/^环境[：:]/.test(line) && current.some(item => /^环境[：:]/.test(item))) flush();
    current.push(line);
  }
  flush();
  if (scenes.length < 2) return normalizeStoryboardFieldLines(script);
  let cursor = 0;
  return scenes.map(lines => {
    const voice = lines.find(line => /^台词[：:]/.test(line))?.replace(/^台词[：:]\s*/, '').trim() || '';
    const cjk = Array.from(voice.replace(/[\s，。！？、；：,.!?;:“”"'（）()]/g, '')).length;
    const words = voice.split(/\s+/).filter(Boolean).length;
    const spoken = /[\u3400-\u9fff]/.test(voice) ? cjk / 4.5 + 0.6 : words / 2.5 + 0.5;
    const duration = Math.max(2.4, +(spoken + 0.35).toFixed(1));
    const end = +(cursor + duration).toFixed(1);
    const output = `[${cursor}-${end}s]\n${lines.join('\n')}`;
    cursor = end;
    return output;
  }).join('\n');
}

function duplicateStoryboardFieldIssues(script: string): string[] {
  const required = ['素材', '环境', '景别', '运镜', '构图', '镜头功能', '画面', '配乐', '台词', '字幕'];
  return String(script || '').split(/(?=^[ \t]*\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\][ \t]*$)/m).flatMap(block => {
    if (!/^\s*\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?/.test(block)) return [];
    const range = block.match(/^\s*(\[[^\]]+\])/)?.[1] || '分镜';
    return required.flatMap(field => {
      const count = (block.match(new RegExp(`^${field}[：:]`, 'gm')) || []).length;
      return count > 1 ? [`${range} 重复输出“${field}”字段`] : [];
    });
  });
}

function subtitleVoiceMismatchIssues(script: string, allowedFinalCtaCaption = ''): string[] {
  const blocks = String(script || '').split(/(?=^[ \t]*\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\][ \t]*$)/m);
  const lastSceneIndex = blocks.map((block, index) => /^\s*\[\s*\d/.test(block) ? index : -1).filter(index => index >= 0).pop();
  return blocks.flatMap((block, index) => {
    if (!/^\s*\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?/.test(block)) return [];
    const range = block.match(/^\s*(\[[^\]]+\])/)?.[1] || '分镜';
    const voice = block.match(/^台词[：:]\s*(.+)$/m)?.[1]?.trim() || '';
    const caption = block.match(/^字幕[：:]\s*(.+)$/m)?.[1]?.trim() || '';
    if (!voice || /^(无|none)$/i.test(voice)) return [];
    if (allowedFinalCtaCaption && index === lastSceneIndex && caption.includes(allowedFinalCtaCaption)) return [];
    const normalize = (value: string) => value.replace(/[\s，。！？、；：,.!?;:“”"'（）()—–-]/g, '').toLowerCase();
    return normalize(voice) === normalize(caption) ? [] : [`${range} 字幕必须逐字反映口播`];
  });
}

function retimeStoryboardFromVoice(script: string): string {
  const blocks = String(script || '').split(/(?=^\[[^\]\r\n]+\][ \t]*$)/m);
  let cursor = 0;
  return blocks.map(block => {
    if (!/^\[[^\]]+\]/.test(block.trim())) return block;
    const voice = block.match(/^台词[：:]\s*(.+)$/m)?.[1]?.trim() || '';
    const cjk = Array.from(voice.replace(/[\s，。！？、；：,.!?;:“”"'（）()]/g, '')).length;
    const words = voice.split(/\s+/).filter(Boolean).length;
    const spoken = /[\u3400-\u9fff]/.test(voice) ? cjk / 4.5 + 0.6 : words / 2.5 + 0.5;
    const duration = Math.max(2.4, +(spoken + 0.35).toFixed(1));
    const end = +(cursor + duration).toFixed(1);
    let next = block.replace(/^\[[^\]]+\]/, `[${cursor}-${end}s]`);
    if (voice && !/^(无|none)$/i.test(voice)) {
      const lines = next.split('\n');
      const captionIndex = lines.findIndex(line => /^字幕[：:]/.test(line));
      if (captionIndex >= 0) {
        let endIndex = captionIndex + 1;
        while (endIndex < lines.length && !/^(环境|景别|运镜|构图|镜头功能|画面|配乐|台词|素材)[：:]|^\[/.test(lines[endIndex]!)) endIndex += 1;
        lines.splice(captionIndex, endIndex - captionIndex, `字幕：${voice}`);
        next = lines.join('\n');
      }
    }
    cursor = end;
    return next;
  }).join('');
}

function applyLockedVoicePlan(script: string, lines: string[]): string {
  if (!lines.length) return script;
  let cursor = 0;
  return String(script || '').split(/(?=^\[[^\]\r\n]+\][ \t]*$)/m).map(block => {
    if (!/^\[[^\]]+\]/.test(block.trim()) || cursor >= lines.length) return block;
    const line = lines[cursor++]!;
    let next = block.replace(/^台词[：:].*$/m, `台词：${line}`);
    const parts = next.split('\n');
    const captionIndex = parts.findIndex(item => /^字幕[：:]/.test(item));
    if (captionIndex >= 0) {
      let endIndex = captionIndex + 1;
      while (endIndex < parts.length && !/^(环境|景别|运镜|构图|镜头功能|画面|配乐|台词|素材)[：:]|^\[/.test(parts[endIndex]!)) endIndex += 1;
      parts.splice(captionIndex, endIndex - captionIndex, `字幕：${line}`);
      next = parts.join('\n');
    }
    return next;
  }).join('');
}

function parseLockedVoicePlan(raw: string, expectedCount: number): string[] {
  try {
    const parsed = JSON.parse(String(raw).replace(/```json|```/gi, '').trim()) as { lines?: unknown };
    if (Array.isArray(parsed.lines)) {
      const lines = parsed.lines.map(item => String(item || '').trim()).filter(Boolean);
      if (lines.length === expectedCount) return lines;
    }
  } catch {
    // A second-stage storyboard can still run if the upstream model ignored JSON.
  }
  return [];
}

type LockedStoryboardScene = { environment: string; shot: string; camera: string; composition: string; purpose: string; visual: string; music: string };
export function isPackagingOnlyProductInfo(productInfo: string): boolean {
  const text = String(productInfo || '').toLowerCase();
  const hasPackagingIdentity = /滴管瓶|泵霜瓶|真空泵(?:霜)?瓶|包装(?:展示|容器)?|瓶器|空瓶|包材|容器|dropper bottle|airless (?:pump )?jar|empty (?:bottle|jar)|packaging|container/.test(text);
  const hasFinishedBeautyProduct = /膏体|质地|配方|精华液本体|面霜本体|润唇膏|上唇|涂抹|试涂|formula|texture|lip balm|apply to (?:skin|lips)/.test(text);
  return hasPackagingIdentity && !hasFinishedBeautyProduct;
}

export function isBeautyProductInfo(productInfo: string): boolean {
  return /美妆|护肤|彩妆|口红|唇膏|润唇|精华|面霜|乳液|面膜|洁面|防晒|粉底|睫毛|眼影|beauty|cosmetic|skincare|lip(?:stick| balm)|serum|face cream|lotion|mascara|foundation/i
    .test(String(productInfo || ''));
}

export function productVoicePlanSupportsTheme(lines: string[], theme: ContentTheme): boolean {
  const opening = String(lines[0] || '');
  const patterns: Record<ContentTheme, RegExp> = {
    buyer_pain: /担心|难|问题|选择|判断|拖慢|concern|risk|problem|choice|decision|slowing/i,
    product_proof: /目录|实物|细节|核实|验证|确认|catalog|physical|detail|verify|check|confirm|proof/i,
    use_case: /场景|陈列|使用|适用|适合|适配|scene|display|use|fit|suit/i,
    supplier_capability: /供应|交付|质检|生产|执行|supply|delivery|quality|production|execution/i,
    customization: /定制|标签|外盒|包装触点|custom|label|carton|packaging touchpoint/i,
    comparison: /比较|对比|两种|怎么选|compare|comparison|two .*options|choose between/i,
    customer_case: /案例|客户|合作过程|case|customer|collaboration process/i,
    trend: /趋势|信号|来源|trend|signal|sourced/i,
    talking_head: /我|回答|讲解|let me|answer|explain/i,
  };
  return patterns[theme].test(opening);
}

export function openingMatchesCooperationRoute(opening: string, route: CooperationRoute): boolean {
  const patterns: Record<CooperationRoute, RegExp> = {
    oem_odm: /品牌方|品牌创始人|产品经理|采购|\bbrand(?:s)?\b|brand founder|product manager|procurement|sourcing manager/i,
    wholesale_distribution: /进口商|经销商|渠道采购|importer|distributor|channel buyer/i,
    consumer_retail: /你|消费者|用户|customer|consumer/i,
  };
  return patterns[route].test(opening);
}

export function openingMatchesTargetBuyer(opening: string, audience: string): boolean {
  if (!String(audience || '').trim()) return true;
  const roleGroups = [
    ['工厂厂长', '厂长', 'factory manager', 'plant manager'],
    ['自动化负责人', '自动化', 'automation manager', 'automation lead'],
    ['设备负责人', '设备经理', 'equipment manager'],
    ['生产经理', 'production manager'], ['工艺经理', 'process manager', 'process engineer'],
    ['质量经理', 'quality manager', 'qa manager'],
    ['采购', '采购经理', 'procurement', 'buyer', 'sourcing manager'],
    ['供应链负责人', '供应链经理', 'supply chain manager'],
    ['系统集成商', 'system integrator'],
    ['品牌创始人', 'brand founder'], ['产品经理', 'product manager'],
    ['进口商', 'importer'], ['经销商', 'distributor'],
  ];
  const expected = roleGroups.filter(group => group.some(term => audience.toLowerCase().includes(term.toLowerCase())));
  return expected.length === 0 || expected.some(group => group.some(term => opening.toLowerCase().includes(term.toLowerCase())));
}

function targetBuyerVoiceLabel(audience: string, language: string): string {
  const text = String(audience || '').toLowerCase();
  if (language === 'zh') {
    if (/自动化|automation/.test(text)) return '自动化经理';
    if (/工程|engineering|engineer/.test(text)) return '工程经理';
    if (/质量|quality|\bqa\b/.test(text)) return '质量经理';
    if (/工厂|厂长|plant|factory/.test(text)) return '工厂经理';
    if (/采购|procurement|buyer|sourcing/.test(text)) return '采购经理';
    if (/经销|distributor/.test(text)) return '经销商';
    if (/进口|importer/.test(text)) return '进口商';
    return '采购';
  }
  if (/自动化|automation/.test(text)) return 'Automation managers';
  if (/工程|engineering|engineer/.test(text)) return 'Engineering managers';
  if (/质量|quality|\bqa\b/.test(text)) return 'Quality managers';
  if (/工厂|厂长|plant|factory/.test(text)) return 'Plant managers';
  if (/经销|distributor/.test(text)) return 'Distributors';
  if (/进口|importer/.test(text)) return 'Importers';
  return 'Buyers';
}

export function safeProductVoicePlan(theme: ContentTheme, productInfo: string, cta: string, language: string, audience = ''): string[] {
  const names = selectedProductNames(productInfo);
  const first = names[0] || 'the selected product';
  const facts = productFactCandidates(productInfo);
  const buyer = targetBuyerVoiceLabel(audience, language);
  if (language === 'zh') {
    const hooks: Record<ContentTheme, string> = {
      buyer_pain: `${buyer}，这个风险怎么判断？`, product_proof: `${buyer}，如何核实产品实证？`, use_case: `${buyer}，现场是否适用？`,
      supplier_capability: `${buyer}，交付能力怎么核实？`, customization: `${buyer}，哪些项目能定制？`, comparison: `${buyer}，两种方案怎么选？`,
      customer_case: `${buyer}，这个案例可靠吗？`, trend: `${buyer}，这个趋势有依据吗？`, talking_head: `${buyer}，我来讲解判断重点。`,
    };
    return [
      hooks[theme],
      facts[0] ? `${facts[0]}。` : `核对${first}的真实细节。`,
      facts[1] ? `${facts[1]}。` : '确认资料支持的第二项证据。',
      safeStoryboardCta(cta, language),
    ];
  }
  const hooks: Record<ContentTheme, string> = {
    buyer_pain: `${buyer}, how do you judge this risk?`, product_proof: `${buyer}, how do you verify the proof?`, use_case: `${buyer}, does this fit your site?`,
    supplier_capability: `${buyer}, how do you verify delivery?`, customization: `${buyer}, which items can be customized?`, comparison: `${buyer}, how do these options compare?`,
    customer_case: `${buyer}, is this case verifiable?`, trend: `${buyer}, is this trend sourced?`, talking_head: `${buyer}, let me explain the key checks.`,
  };
  return [
    hooks[theme],
    facts[0] || `Review the verified details of ${first}.`,
    facts[1] || 'Confirm the second supported product fact.',
    safeStoryboardCta(cta, language),
  ];
}

export function applySafeStoryboardSpeechFallback(
  script: string,
  productInfo: string,
  theme: ContentTheme,
  primaryCta: string,
  language: string,
): string {
  const blocks = String(script || '').split(/(?=^[ \t]*\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\][ \t]*$)/m);
  const sceneIndexes = blocks.map((block, index) => /^\s*\[\s*\d/.test(block) ? index : -1).filter(index => index >= 0);
  if (!sceneIndexes.length) return script;
  const safePlan = safeProductVoicePlan(theme, productInfo, primaryCta, language);
  const cta = safeStoryboardCta(primaryCta, language);
  const middleCount = Math.max(0, sceneIndexes.length - 2);
  const middleLines = Array.from({ length: middleCount }, (_, index) => {
    if (index % 2 === 0) return language === 'zh' ? '查看产品现场。' : 'Review the visible product.';
    return language === 'zh' ? '核对可见证据。' : 'Check the visible evidence.';
  });
  const lines = [safePlan[0]!, ...middleLines, cta];
  for (let position = 0; position < sceneIndexes.length; position += 1) {
    const index = sceneIndexes[position]!;
    const range = blocks[index]!.match(/^\s*\[\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—]\s*(\d+(?:\.\d+)?)/);
    const duration = range ? Math.max(0.5, Number(range[2]) - Number(range[1])) : 4;
    const plannedVoice = lines[position] || cta;
    let voice = fitSpeechToShot(plannedVoice, duration);
    let block = blocks[index]!;
    if (/^台词[：:]/m.test(block)) block = block.replace(/^台词[：:].*$/m, `台词：${voice}`);
    else block = `${block.replace(/\s+$/, '')}\n台词：${voice}\n`;
    if (/^字幕[：:]/m.test(block)) block = block.replace(/^字幕[：:].*$/m, `字幕：${voice}`);
    else block = block.replace(/^(台词[：:].*)$/m, `$1\n字幕：${voice}`);
    if (storyboardSpeechIssues(block).length > 0) {
      voice = position === 0
        ? (language === 'zh' ? '采购，怎么判断？' : 'Buyers, how do you judge it?')
        : position === sceneIndexes.length - 1
          ? shortStoryboardCta(primaryCta, language)
          : (language === 'zh' ? (position % 2 ? '查看产品现场。' : '核对可见证据。') : 'Review visible evidence.');
      block = block.replace(/^台词[：:].*$/m, `台词：${voice}`).replace(/^字幕[：:].*$/m, `字幕：${voice}`);
    }
    blocks[index] = block;
  }
  return blocks.join('');
}

export function ensureStoryboardPrimaryCta(
  script: string,
  primaryCta: string,
  language: string,
  includeVoice = true,
): string {
  if (!primaryCta || ctaSemanticallySatisfied(script, primaryCta)) return script;
  const blocks = String(script || '').split(/(?=^[ \t]*\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\][ \t]*$)/m);
  const lastSceneIndex = blocks.map((block, index) => /^\s*\[\s*\d/.test(block) ? index : -1).filter(index => index >= 0).pop();
  if (lastSceneIndex == null) return script;
  const range = blocks[lastSceneIndex]!.match(/^\s*\[\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—]\s*(\d+(?:\.\d+)?)/);
  const duration = range ? Math.max(0.5, Number(range[2]) - Number(range[1])) : 3;
  let voice = fitSpeechToShot(safeStoryboardCta(primaryCta, language), duration);
  if (!includeVoice) voice = safeStoryboardCta(primaryCta, language);
  const voiceFits = (candidate: string) => storyboardSpeechIssues(`[0-${duration}s]\n台词：${candidate}`).length === 0;
  if (!ctaSemanticallySatisfied(voice, primaryCta) || (includeVoice && !voiceFits(voice))) voice = shortStoryboardCta(primaryCta, language);
  if ((!ctaSemanticallySatisfied(voice, primaryCta) || (includeVoice && !voiceFits(voice))) && language === 'zh' && /预约/.test(primaryCta)) voice = '预约诊断。';
  let block = blocks[lastSceneIndex]!;
  const spokenLine = includeVoice ? voice : '无';
  if (/^[ \t]*台词[：:]/m.test(block)) block = block.replace(/^[ \t]*台词[：:].*$/m, `台词：${spokenLine}`);
  else block = `${block.replace(/\s+$/, '')}\n台词：${spokenLine}\n`;
  if (/^[ \t]*字幕[：:]/m.test(block)) block = block.replace(/^[ \t]*字幕[：:].*$/m, `字幕：${voice}`);
  else block = block.replace(/^(台词[：:].*)$/m, `$1\n字幕：${voice}`);
  blocks[lastSceneIndex] = block;
  return blocks.join('');
}

export function canonicalMaterialPrimaryCta(primaryCta: string, language: string): string {
  const cta = String(primaryCta || '').replace(/\s+/g, ' ').trim();
  if (!cta) return '';
  if (/whatsapp|\bwa\b/i.test(cta)) return language === 'zh' ? '通过 WhatsApp 联系我们。' : 'Message us on WhatsApp.';
  // Enterprise settings sometimes store workflow language rather than public
  // copy. Normalize those cases, while preserving an already publishable CTA
  // verbatim so every configured action, qualifier and duration remains visible.
  if (/引导跳转|以触达|触达客户/.test(cta)) {
    if (/目录|资料/.test(cta)) return language === 'zh' ? '联系我们获取已核实的产品资料。' : 'Message us for verified product details.';
    return language === 'zh' ? '联系我们了解已核实的产品信息。' : 'Message us for verified product details.';
  }
  return cta;
}

function compactMaterialCtaVoice(primaryCta: string, language: string): string {
  const cta = canonicalMaterialPrimaryCta(primaryCta, language);
  if (!cta) return '无';
  if (language === 'zh') {
    if (/发送|提交|发来|分享/.test(cta) && /预约/.test(cta) && /30\s*分钟/.test(cta) && /英文/.test(cta) && /诊断|评估|方案|咨询/.test(cta)) {
      const item = /工件/.test(cta) ? '工件' : /节拍/.test(cta) ? '节拍' : /缺陷/.test(cta) ? '缺陷样本' : /布局/.test(cta) ? '现场布局' : '关键资料';
      return `发${item}，预约30分钟英文方案诊断。`;
    }
    return safeStoryboardCta(cta, language);
  }
  if (/send|share|submit/i.test(cta) && /book|schedule|预约/i.test(cta) && /30\s*(?:minutes?|mins?)/i.test(cta)) {
    return 'Share one key input and book a 30-minute solution review.';
  }
  return safeStoryboardCta(cta, language);
}

/**
 * Material scripts must carry the complete enterprise CTA deterministically.
 * A short spoken CTA may differ from the full on-screen CTA; the final caption
 * remains the canonical source of truth and is exempt from voice/caption parity.
 */
export function ensureMaterialCanonicalCta(
  script: string,
  primaryCta: string,
  language: string,
  includeVoice = true,
): string {
  const canonical = canonicalMaterialPrimaryCta(primaryCta, language);
  if (!canonical) return script;
  const blocks = String(script || '').split(/(?=^[ \t]*\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\][ \t]*$)/m);
  const lastSceneIndex = blocks.map((block, index) => /^\s*\[\s*\d/.test(block) ? index : -1).filter(index => index >= 0).pop();
  if (lastSceneIndex == null) return script;
  let block = blocks[lastSceneIndex]!;
  const voice = includeVoice ? compactMaterialCtaVoice(primaryCta, language) : '无';
  const setField = (field: string, value: string) => {
    const pattern = new RegExp(`^[ \\t]*${field}[：:].*$`, 'm');
    if (pattern.test(block)) block = block.replace(pattern, `${field}：${value}`);
    else block = `${block.replace(/\s+$/, '')}\n${field}：${value}\n`;
  };
  setField('镜头功能', 'CTA');
  setField('台词', voice);
  setField('字幕', canonical);
  blocks[lastSceneIndex] = block;
  return blocks.join('');
}

export function buildSafeCloneStoryboard(
  script: string,
  productInfo: string,
  primaryCta: string,
  language: string,
  voiceoverMode: string,
  targetAudience = '',
): string {
  const ranges = Array.from(String(script || '').matchAll(/\[\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\]/g))
    .map(match => ({ start: Number(match[1]), end: Number(match[2]) }))
    .filter((range, index, all) => range.end > range.start && all.findIndex(item => item.start === range.start && item.end === range.end) === index);
  if (!ranges.length) return script;
  const names = selectedProductNames(productInfo);
  const productName = names[0] || (language === 'zh' ? '已选产品' : 'the selected product');
  const audienceHook = /automation/i.test(targetAudience)
    ? '采购，自动化风险怎么判断？'
    : /engineering|engineer/i.test(targetAudience)
      ? '采购，工程风险怎么判断？'
      : /plant/i.test(targetAudience)
        ? '采购，工厂风险怎么判断？'
        : '采购，这个风险怎么判断？';
  const silent = voiceoverMode === 'none';
  return ranges.map((range, index) => {
    const last = index === ranges.length - 1;
    const duration = Math.max(0.5, range.end - range.start);
    let caption = last
      ? safeStoryboardCta(primaryCta, language)
      : index === 0
        ? (language === 'zh' ? audienceHook : 'Buyers, how do you judge this risk?')
        : (language === 'zh' ? `核对${productName}可见细节。` : `Check the visible details of ${productName}.`);
    if (!silent) {
      caption = fitSpeechToShot(caption, duration);
      if (storyboardSpeechIssues(`[0-${duration}s]\n台词：${caption}`).length > 0) {
        caption = last
          ? shortStoryboardCta(primaryCta, language)
          : index === 0
            ? (language === 'zh' ? '采购，怎么判断？' : 'Buyers, how do you judge it?')
            : (language === 'zh' ? '核对可见细节。' : 'Check visible details.');
      }
    }
    const purpose = index === 0 ? '主题钩子' : last ? 'CTA' : '产品证据';
    const visual = index === 0
      ? `展示${productName}实际可见的现场状态`
      : last
        ? `展示${productName}并叠加唯一行动提示`
        : `展示${productName}实际可见细节`;
    return `[${range.start}-${range.end}s]\n环境：企业产品现场\n景别：${index === 0 ? '中景' : '特写'}\n运镜：${index % 2 ? '固定镜头' : '缓慢推进'}\n构图：产品主体居中\n镜头功能：${purpose}\n画面：${visual}\n配乐：轻量中性节奏\n台词：${silent ? '无' : caption}\n字幕：${caption}`;
  }).join('\n\n');
}

export function clearStoryboardSpeech(script: string): string {
  const blocks = String(script || '').split(/(?=^[ \t]*\[\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?\s*\][ \t]*$)/m);
  return blocks.map(block => {
    if (!/^\s*\[\s*\d/.test(block)) return block;
    let next = block;
    if (/^[ \t]*台词[：:]/m.test(next)) next = next.replace(/^[ \t]*台词[：:].*$/m, '台词：无');
    else next = `${next.replace(/\s+$/, '')}\n台词：无\n`;
    if (/^[ \t]*字幕[：:]/m.test(next)) next = next.replace(/^[ \t]*字幕[：:].*$/m, '字幕：无');
    else next = next.replace(/^(台词[：:]无)$/m, '$1\n字幕：无');
    return next;
  }).join('');
}

export function safeProductScenes(productInfo: string, count: number): LockedStoryboardScene[] {
  const names = selectedProductNames(productInfo);
  const facts = productFactCandidates(productInfo);
  return Array.from({ length: count }, (_, index) => {
    const nameIndex = index <= 1 ? 0 : Math.min(1, Math.max(0, names.length - 1));
    const productName = names[nameIndex] || '已选产品';
    const last = index === count - 1;
    const fact = facts[Math.max(0, index - 1)] || '';
    return ({
    environment: '待匹配真实产品或现场素材', shot: index === 0 ? '中近景' : index === count - 1 ? '全景' : '特写',
    camera: index % 2 ? '固定镜头' : '缓慢推进', composition: '产品主体与资料可验证的细节清晰可见',
    purpose: index === 0 ? '主题钩子' : last ? 'CTA' : '产品证据',
    visual: index === 0
      ? `待匹配${productName}的真实整机或现场全貌；外观、颜色与环境完全以素材为准`
      : last
        ? `待匹配${productName}的真实产品画面并叠加唯一行动提示`
        : fact
          ? `待匹配能够证明“${fact}”的真实操作、结构或数据界面；素材无法证明时标记待补`
          : `待匹配${productName}的真实产品细节；仅展示资料与素材共同支持的内容`,
    music: last ? '轻提示音' : '轻量中性节奏',
    });
  });
}
function parseLockedStoryboardScenes(raw: string, expectedCount: number): LockedStoryboardScene[] {
  try {
    const parsed = JSON.parse(String(raw).replace(/```json|```/gi, '').trim()) as { scenes?: unknown };
    if (!Array.isArray(parsed.scenes) || parsed.scenes.length !== expectedCount) return [];
    return parsed.scenes.map(item => {
      const scene = item as Record<string, unknown>;
      return {
        environment: String(scene.environment || '').trim(), shot: String(scene.shot || '').trim(), camera: String(scene.camera || '').trim(),
        composition: String(scene.composition || '').trim(), purpose: String(scene.purpose || '').trim(), visual: String(scene.visual || '').trim(), music: String(scene.music || '无').trim() || '无',
      };
    }).filter(scene => Object.values(scene).every(Boolean));
  } catch { return []; }
}
export function lockedVoiceDurations(lines: string[]): number[] {
  return lines.map(voice => {
    const chars = Array.from(voice.replace(/[\s，。！？、；：,.!?;:“”"'（）()]/g, '')).length;
    const words = voice.split(/\s+/).filter(Boolean).length;
    const spoken = /[\u3400-\u9fff]/.test(voice) ? chars / 4.5 : words / 2.5;
    return Math.max(2.4, +(spoken + 0.95).toFixed(1));
  });
}
export function serializeLockedStoryboard(scenes: LockedStoryboardScene[], lines: string[], targetDuration = 0): string {
  const naturalDurations = lockedVoiceDurations(lines);
  const naturalTotal = naturalDurations.reduce((sum, duration) => sum + duration, 0);
  const requestedTotal = Number(targetDuration) || 0;
  const scaleToRequestedTotal = requestedTotal >= scenes.length * 2.4 && requestedTotal >= naturalTotal;
  const durations = scaleToRequestedTotal
    ? naturalDurations.map(duration => duration * requestedTotal / naturalTotal)
    : naturalDurations;
  let cursor = 0;
  return scenes.map((scene, index) => {
    const voice = lines[index] || '';
    const duration = durations[index] || 2.4;
    const end = scaleToRequestedTotal && index === scenes.length - 1
      ? requestedTotal
      : +(cursor + duration).toFixed(1);
    const block = `[${cursor}-${end}s]\n环境：${scene.environment}\n景别：${scene.shot}\n运镜：${scene.camera}\n构图：${scene.composition}\n镜头功能：${scene.purpose}\n画面：${scene.visual}\n配乐：${scene.music}\n台词：${voice}\n字幕：${voice}`;
    cursor = end;
    return block;
  }).join('\n\n');
}

export function repairMaterialScript(script: string, productInfo: string, materialsText: string): string {
  let repaired = dedupeStoryboardFieldLines(normalizeStoryboardFieldLines(script));
  const unsupportedNumbers = Array.from(repaired.matchAll(/\d+(?:\.\d+)?\s*(?:瓶|ml|ML|毫升|kg|KG|g|克|斤|cm|厘米|mm|毫米|天|day|days|Days|秒|%|个|pcs|件|箱|元|美元)/g))
    .map(match => match[0])
    .filter(claim => !productInfoSupportsNumericClaim(claim, productInfo));
  for (const claim of unsupportedNumbers) repaired = repaired.replaceAll(claim, '');
  const evidence = `${productInfo}\n${materialsText}`.toLowerCase();
  const unsupportedEffects: Array<[RegExp, string[], string]> = [
    [/迅速吸收|快速吸收|瞬时渗透|即时渗透|一触即融|吸收|渗透/g, ['迅速吸收', '快速吸收', '瞬时渗透', '即时渗透', '一触即融', '吸收', '渗透'], '质地细节'],
    [/淡纹|去皱|紧致|抗衰|抗老/g, ['淡纹', '去皱', '紧致', '抗衰', '抗老'], '产品细节'],
    [/美白|提亮|祛斑/g, ['美白', '提亮', '祛斑'], '外观表现'],
    [/祛痘|抗炎|修复屏障|无刺激|敏感肌可用/g, ['祛痘', '抗炎', '修复屏障', '无刺激', '敏感肌可用'], '使用展示'],
  ];
  for (const [pattern, terms, neutral] of unsupportedEffects) {
    if (!terms.some(term => evidence.includes(term.toLowerCase()))) repaired = repaired.replace(pattern, neutral);
  }
  repaired = repaired.replace(/[：:]\s*([，。；,.!?！？])+/g, '：无').replace(/[ ]{2,}/g, ' ').trim();
  return fitStoryboardSpeech(repaired);
}

export function materialGroundingIssues(script: string, productInfo: string, materialsText: string, targetBuyerText = ''): string[] {
  const evidence = `${productInfo}\n${materialsText}`.toLowerCase();
  const claimGroups = [
    ['迅速吸收', '快速吸收', '瞬时渗透', '即时渗透', '一触即融', '吸收', '渗透'],
    ['淡纹', '去皱', '紧致', '抗衰', '抗老'],
    ['美白', '提亮', '祛斑'],
    ['祛痘', '抗炎', '修复屏障', '无刺激', '敏感肌可用'],
    ['防水', '耐摔', '不易破损', '承重'],
  ];
  const issues: string[] = [];
  for (const group of claimGroups) {
    const used = group.filter(term => script.toLowerCase().includes(term.toLowerCase()));
    if (used.length && !group.some(term => evidence.includes(term.toLowerCase()))) {
      issues.push(`素材/产品资料未支持的效果描述：${used.join('、')}`);
    }
  }
  // Closed-world visual facts: these nouns/states are commonly hallucinated
  // from an unrelated recommended benchmark. They are allowed only when the
  // selected material observations or approved product facts mention them.
  const visualFactGroups = [
    ['展会', '展馆', '展台', '观众', 'imtex', 'exhibition', 'trade show'],
    ['展板', '标识', 'logo', 'brand mark'],
    ['屏幕', '界面', '检测结果', '识别结果', 'dashboard', 'interface', 'inspection result'],
    ['正在运行', '实时运行', '运转中', 'running live', 'in operation'],
    ['划伤', '字符识别', 'scratch detection', 'ocr'],
  ];
  for (const group of visualFactGroups) {
    const used = group.filter(term => script.toLowerCase().includes(term));
    if (used.length && !group.some(term => evidence.includes(term))) {
      issues.push(`已选素材观察未支持的画面事实：${used.join('、')}`);
    }
  }
  const outputEntities = Array.from(script.matchAll(/\b[A-Z][A-Za-z0-9]*(?:[- ][A-Z][A-Za-z0-9]*)+\b/g))
    .map(match => match[0]!.trim())
    .filter(term => !/^(CTA|AI|OEM|ODM|B2B|VO)$/i.test(term))
    .filter(term => !isBusinessRoleEntity(term, targetBuyerText));
  for (const entity of outputEntities) {
    if (!evidence.includes(entity.toLowerCase())) issues.push(`已选素材/产品资料未支持的品牌或设备名：${entity}`);
  }
  return Array.from(new Set(issues));
}

export function materialTimelineIssues(script: string, infos: ScriptMaterialInfo[]): string[] {
  const ranges = Array.from(String(script).matchAll(/^\s*\[\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\]/gm))
    .map(match => ({ start: Number(match[1]), end: Number(match[2]) }));
  const issues: string[] = [];
  if (ranges.length !== infos.length) issues.push(`分镜数量与已选素材不一致（${ranges.length}/${infos.length}）`);
  ranges.forEach((range, index) => {
    const info = infos[index];
    if (!info) return;
    const expectedStart = Number(info.targetStart || 0);
    const expectedEnd = Number(info.targetEnd || expectedStart);
    if (Math.abs(range.start - expectedStart) > 0.05 || Math.abs(range.end - expectedEnd) > 0.05) {
      issues.push(`第${index + 1}段时间线超出已选素材可用区间（应为 ${expectedStart}-${expectedEnd}s）`);
    }
  });
  return issues;
}

type ScriptMaterialInfo = {
  name?: string;
  type?: string;
  folder?: string;
  duration?: number;
  effectiveDuration?: number;
  role?: string;
  targetStart?: number;
  targetEnd?: number;
  industry?: string;
  shotFunction?: string;
  tags?: string;
  observations?: string[];
};

export function requiresMinimumVoiceoverLines(voiceoverMode: unknown, generationMode: unknown): boolean {
  return voiceoverMode === 'ai' && generationMode !== 'clone';
}

export const MAX_INTERACTIVE_SCRIPT_REPAIR_ATTEMPTS = 1;

/** Keep editorial preferences visible without discarding a safe storyboard. */
export function isNonBlockingScriptQualityIssue(issue: string): boolean {
  return /^(?:未使用本条唯一主 CTA|已选择 AI 口播，但有效台词不足两段|首段没有|分镜功能重复|美妆产品本体镜头不足|本次脚本与上一版本过于相似|爆款分镜包含不可执行的泛化镜头描述)/.test(String(issue || '').trim());
}

export function normalizeMaterialInfos(value: unknown, fallbackNames: unknown, totalDuration: number): ScriptMaterialInfo[] {
  const raw = Array.isArray(value) ? value : [];
  const selectedNames = new Set(Array.isArray(fallbackNames) ? fallbackNames.map(item => String(item).trim()).filter(Boolean) : []);
  const selectedRaw = selectedNames.size
    ? raw.filter(item => selectedNames.has(String(item && typeof item === 'object' ? (item as Record<string, unknown>).name || '' : '').trim()))
    : raw;
  let cursor = 0;
  const fromInfos = selectedRaw.reduce<ScriptMaterialInfo[]>((acc, item) => {
    const obj = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const name = String(obj.name || '').trim();
    if (!name) return acc;
    const slot = Math.max(0.5, totalDuration / Math.max(1, selectedRaw.length || 1));
    const sourceDuration = Math.max(0.1, Number(obj.duration) || slot);
    const usableDuration = Math.min(sourceDuration, Math.max(0.1, Number(obj.effectiveDuration) || sourceDuration));
    const requestedLength = Math.max(0.1, Number(obj.targetEnd) - Number(obj.targetStart));
    const clipLength = Math.min(usableDuration, Number.isFinite(requestedLength) ? requestedLength : usableDuration);
    const start = +cursor.toFixed(1);
    const end = +(cursor + clipLength).toFixed(1);
    cursor = end;
    acc.push({
      name,
      type: String(obj.type || 'video'),
      folder: String(obj.folder || 'upload'),
      duration: sourceDuration,
      effectiveDuration: usableDuration,
      role: String(obj.role || ''),
      targetStart: start,
      targetEnd: end,
      industry: String(obj.industry || ''),
      shotFunction: String(obj.shotFunction || ''),
      tags: String(obj.tags || ''),
      observations: Array.isArray(obj.observations) ? obj.observations.map(String).filter(Boolean).slice(0, 6) : [],
    });
    return acc;
  }, []);
  if (fromInfos.length) return fromInfos.slice(0, 8);

  const names = Array.isArray(fallbackNames) ? fallbackNames.map(String).filter(Boolean) : [];
  const slot = Math.max(2, totalDuration / Math.max(1, names.length || 1));
  return names.slice(0, 8).map((name, index) => ({
    name,
    type: 'video',
    folder: 'upload',
    duration: slot,
    effectiveDuration: slot,
    role: '素材片段',
    targetStart: +(index * slot).toFixed(1),
    targetEnd: +(index === names.length - 1 ? totalDuration : (index + 1) * slot).toFixed(1),
  }));
}

function materialInfoLines(infos: ScriptMaterialInfo[]): string {
  return infos.map((info, index) => [
    `${index + 1}. 素材名：${info.name}`,
    `类型：${info.type || 'video'}`,
    `角色：${materialRoleFromFolder(info)}`,
    `原始时长：${Number(info.duration || 0).toFixed(1)}s`,
    `建议有效时长：${Number(info.effectiveDuration || Math.max(0, Number(info.targetEnd || 0) - Number(info.targetStart || 0))).toFixed(1)}s`,
    `建议时间段：${Number(info.targetStart || 0).toFixed(1)}-${Number(info.targetEnd || 0).toFixed(1)}s`,
    info.industry ? `行业：${info.industry}` : '',
    info.shotFunction ? `镜头功能标签：${info.shotFunction}` : '',
    info.tags ? `人工/运营标签：${info.tags}` : '',
    info.observations?.length ? `已确认或待复核的分段观察：${info.observations.join(' | ')}` : '没有视频级分段观察，只能依据素材名和标签做保守剪辑',
  ].filter(Boolean).join('；')).join('\n');
}

export const studioRouter = Router();
studioRouter.use(requireAuth);
studioRouter.use('/person-swap', createPersonSwapRouter(store));
studioRouter.use('/local-renders', studioRenderMediaRouter(path.resolve(process.cwd(), 'data/publishing-uploads')));
studioRouter.use((_req, res, next) => {
  studioTenantContext.run((res.locals as AuthLocals).tenantId, next);
});

// POST /studio/map-product-columns Body: { headers, sampleRows, candidateRows?, currentHeaderRowIndex? }
studioRouter.post('/map-product-columns', async (req, res) => {
  const headers = Array.isArray(req.body?.headers) ? req.body.headers.map(String) : [];
  const sampleRows = Array.isArray(req.body?.sampleRows) ? req.body.sampleRows.slice(0, 5) : [];
  const candidateRows = Array.isArray(req.body?.candidateRows)
    ? req.body.candidateRows.slice(0, 10).map((row: unknown) => Array.isArray(row) ? row.map(String) : [])
    : [];
  const currentHeaderRowIndex = Number.isInteger(req.body?.currentHeaderRowIndex) ? Number(req.body.currentHeaderRowIndex) : 0;
  if (!headers.length) {
    res.status(400).json({ ok: false, error: 'headers required' });
    return;
  }

  const allowed = new Set(['sku', 'name', 'color', 'size', 'tagPrice', 'retailPrice', 'moq', 'brand', 'material', 'imageUrl', 'highlights', '']);
  try {
    const text = await callLLM(JSON.stringify({ headers, sampleRows, candidateRows, currentHeaderRowIndex }), {
      systemPrompt: `你是 B2B 商品表格字段映射助手。先检查 currentHeaderRowIndex 指向的是否是真正表头；如果 headers 看起来是货号、商品内容或数字而不是列名，就从 candidateRows 中找出真正表头的 0 基行号。然后根据表头和前 5 行样本，把客户列名映射到产品 schema。
真正表头通常包含货号、品名、颜色、尺码、价格、材质、图片等字段名；公司抬头、Logo、大标题和第一条商品数据都不是表头。
可用目标字段：
- sku: 货号/款号/SKU/商品编码，用于 upsert 去重
- name: 商品名称
- color: 颜色
- size: 尺码/规格
- tagPrice: 吊牌价/标签价
- retailPrice: 零售价/建议零售价
- moq: 起订量/最小订单量
- brand: 品牌
- material: 面料/材质/成分
- imageUrl: 图片 URL/主图链接
- highlights: 一句话卖点/描述
不确定或无关列映射为空字符串。只输出 JSON，不要 markdown。headerRowIndex 必须是 candidateRows 的 0 基行号；当前表头正确时沿用 currentHeaderRowIndex。格式：
{"headerRowIndex":2,"mapping":{"客户列名":"sku"},"notes":"简短说明"}`,
    });
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) as { headerRowIndex?: unknown; mapping?: Record<string, unknown>; notes?: unknown } : {};
    const mapping: Record<string, string> = {};
    for (const header of headers) {
      const value = parsed.mapping?.[header];
      mapping[header] = typeof value === 'string' && allowed.has(value) ? value : '';
    }
    const headerRowIndex = Number.isInteger(parsed.headerRowIndex)
      && Number(parsed.headerRowIndex) >= 0
      && Number(parsed.headerRowIndex) < candidateRows.length
      ? Number(parsed.headerRowIndex)
      : currentHeaderRowIndex;
    res.json({ ok: true, headerRowIndex, mapping, notes: typeof parsed.notes === 'string' ? parsed.notes : '' });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

/* ── 订阅状态查询 ──────────────────────────────────────────────────────────
   放在收费墙之前：即使未订阅，用户/客户端也要能查到自己的状态与原因。
   返回 entitled，供桌面客户端在合成前判断是否放行。
─────────────────────────────────────────────────────────────────────────── */
// GET /studio/subscription → { ok, enforced, entitled, status, plan, expiresAt }
studioRouter.get('/subscription', async (req, res) => {
  const enforced = isSubscriptionEnforced();

  // 未启用强制：一律视为有权限（保持开放）
  if (!enforced) {
    res.json({ ok: true, enforced: false, entitled: true, status: 'active', plan: null, expiresAt: null });
    return;
  }

  const { tenantId } = res.locals as AuthLocals;
  const sub = await getTenantSubscription(tenantId);
  res.json({
    ok: true,
    enforced: true,
    entitled: isEntitled(sub),
    status: sub.status,
    plan: sub.plan,
    expiresAt: sub.expiresAt,
  });
});

/* 收费墙：以下所有 AI / 渲染路由都需有效订阅（未启用强制时直通）。 */
studioRouter.use(contentLibraryRouter);
studioRouter.use(entitlementGate());

studioRouter.use('/shooting-tasks', createShootingTasksRouter(store, async (id, tenantId) => {
  return loadMaterials().some(item => item.id === id && item.tenantId === tenantId && item.type === 'video' && !isReferenceOnlyMaterial(item));
}));

studioRouter.use('/production', createStudioAvatarProductionRouter(store));

/* ── Seedance 视频生成 ─────────────────────────────────────────────────── */
// POST /studio/seedance-video  Body: { script, productInfo, language, ratio, duration, resolution, title? }
studioRouter.post('/seedance-video', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  if (!isSeedanceVideoEnabled()) {
    res.status(423).json({
      ok: false,
      locked: true,
      source: 'seedance',
      error: 'Seedance 视频生成接口未启用。请配置 SEEDANCE_API_KEY 并设置 SEEDANCE_VIDEO_ENABLED=true。',
    });
    return;
  }
  const {
    script = '',
    productInfo = '',
    language = 'en',
    ratio = '9:16',
    duration: rawDuration = 8,
    resolution = '720p',
    title = 'Seedance 生成视频',
    referenceImageUrl = '',
    generationGroupKey = '',
    generationContext = {},
    parentVersionId = '',
  } = req.body ?? {};
  const duration = normalizeSeedanceVideoDuration(rawDuration);
  const config = seedanceVideoConfig();
  if (!config.apiKey) {
    res.json({ ok: false, source: 'seedance', error: 'SEEDANCE_API_KEY not set' });
    return;
  }
  if (!await consumeDemoQuota(req, res, 'videoGeneration')) return;

  const subscription = await getTenantSubscription(tenantId);
  const plan = String(subscription?.plan || '').toLowerCase();
  const isFormalTenant = subscription?.status === 'active' && !['admin', 'local', 'trial'].includes(plan);
  let budget: SeedanceBudgetReservation | null = null;
  if (isFormalTenant) {
    budget = reserveSeedanceBudget({ tenantId, duration, resolution: String(resolution) });
    if (!budget.ok) {
      res.status(429).json({
        ok: false,
        code: 'seedance_monthly_budget_exceeded',
        error: `本月 Seedance 成本额度已不足：剩余 ¥${budget.remainingCny.toFixed(2)}，本次预计需要 ¥${budget.reservedCny.toFixed(2)}。`,
        message: `本月 Seedance 预算剩余 ¥${budget.remainingCny.toFixed(2)}，本次预计需要 ¥${budget.reservedCny.toFixed(2)}。`,
        budget,
      });
      return;
    }
  }

  const prompt = [
    `Create a ${duration}-second vertical commercial social video in ${langName(language)}.`,
    `Aspect ratio: ${ratio}. Resolution: ${resolution}.`,
    `Use this script/storyboard as the primary direction:\n${String(script).slice(0, 4000)}`,
    productInfo ? `Product and brand context:\n${String(productInfo).slice(0, 1800)}` : '',
    'Style: realistic UGC product video, clear product focus, clean lighting, smooth camera movement, high conversion pacing.',
    'Generate synchronized natural audio. Dialogue or voiceover lines should follow the quoted script language.',
    '固定提示词：全程不要出现任何文字、符号、标识。',
    'No text, symbols, logos, captions, subtitles, labels, UI, watermarks, brand marks, written characters, numbers, or signage may appear at any point in the video.',
    'Keep visual actions aligned with the spoken lines.',
  ].filter(Boolean).join('\n\n');

  let taskAccepted = false;
  try {
    const content: any[] = [{ type: 'text', text: prompt }];
    const rawReferenceImageUrl = String(referenceImageUrl).trim();
    const resolvedReferenceImageUrl = rawReferenceImageUrl.startsWith('/')
      ? `${getPublicOrigin(req)}${signAssetUrl(rawReferenceImageUrl, tenantId)}`
      : rawReferenceImageUrl;
    if (resolvedReferenceImageUrl) {
      content.push({
        type: 'image_url',
        image_url: { url: resolvedReferenceImageUrl },
      });
    }
    const created = await seedanceFetchJson(`${config.baseUrl}/contents/generations/tasks`, config.apiKey, {
      method: 'POST',
      body: JSON.stringify({
        model: config.model,
        content,
        ratio,
        duration,
        resolution,
        generate_audio: true,
        watermark: false,
      }),
    });
    const taskId = seedanceTaskId(created);
    if (!taskId) throw new Error('Seedance 未返回任务 ID');
    taskAccepted = true;
    const task = await waitForSeedanceTask(config, taskId);
    const remoteUrl = findUrlDeep(task);
    if (!remoteUrl) throw new Error('Seedance 未返回可下载的视频地址');
    const filename = `seedance-${taskId.replace(/[^\w.-]+/g, '-')}-${Date.now()}.mp4`;
    let url = remoteUrl;
    let material: Material | null = null;
    try {
      url = await downloadGeneratedVideo(remoteUrl, filename, tenantId);
      material = await createGeneratedVideoMaterial({ title, filename, duration, tenantId, sourceType: 'ai-seedance' });
    } catch (downloadError) {
      console.warn('[studio] Seedance video download failed, returning remote url:', downloadError);
    }
    const version = String(generationGroupKey).trim()
      ? appendVideoVersion({
          tenantId,
          groupKey: String(generationGroupKey).trim(),
          parentVersionId: String(parentVersionId).trim() || undefined,
          materialId: material?.id,
          taskId,
          title: String(title),
          url,
          poster: material?.poster,
          duration,
          source: 'seedance',
          model: config.model,
          promptSnapshot: {
            script: String(script), productInfo: String(productInfo), language: String(language),
            ratio: String(ratio), resolution: String(resolution),
          },
          context: generationContext && typeof generationContext === 'object' && !Array.isArray(generationContext)
            ? generationContext as Record<string, unknown> : {},
        })
      : undefined;
    res.json({
      ok: true,
      source: 'seedance',
      id: material?.id || taskId,
      taskId,
      title,
      url,
      poster: material?.poster,
      duration,
      model: config.model,
      budget,
      material,
      version,
      createdAt: new Date().toISOString(),
    });
  } catch (e: any) {
    if (!taskAccepted && budget?.reservationId) {
      releaseSeedanceBudget(tenantId, budget.reservationId);
    }
    const reason = summarizeSeedanceError(e);
    console.error('[studio] Seedance video generation failed:', e);
    res.json({ ok: false, source: 'seedance', error: `Seedance 视频生成失败：${reason}` });
  }
});

// POST /studio/storyboard-quality-check
// 对单个已生成分镜抽帧质检，返回结构化评分和需要人工关注的问题。
studioRouter.post('/storyboard-quality-check', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { materialId = '', storyboard = '', productInfo = '', critical = false } = req.body ?? {};
  const material = loadMaterials().find(item => item.id === String(materialId) && (item.scope === 'shared' || item.tenantId === tenantId));
  if (!material || material.type !== 'video' || !material.file) {
    res.status(404).json({ ok: false, error: '找不到可质检的本地视频素材' });
    return;
  }
  fs.mkdirSync(GENERATED_MEDIA_DIR, { recursive: true });
  const cosTempPath = material.objectKey ? path.join(GENERATED_MEDIA_DIR, `quality-source-${material.id}${path.extname(material.file) || '.mp4'}`) : '';
  const filePath = cosTempPath || path.join(MEDIA_DIR, material.file);
  if (material.objectKey) {
    const downloaded = await r2Download(material.objectKey);
    if (downloaded?.buf.length) fs.writeFileSync(filePath, downloaded.buf);
  }
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ ok: false, error: '质检视频文件不存在' });
    return;
  }
  const tempDir = fs.mkdtempSync(path.join(GENERATED_MEDIA_DIR, 'quality-'));
  try {
    const framePattern = path.join(tempDir, 'frame-%02d.jpg');
    await execFileAsync(String(ffmpegStatic), [
      '-hide_banner', '-loglevel', 'error', '-i', filePath,
      '-vf', 'fps=1/2,scale=640:-2', '-frames:v', '5', '-q:v', '4', framePattern,
    ], 90_000);
    const frames = fs.readdirSync(tempDir)
      .filter(name => /^frame-\d+\.jpg$/i.test(name))
      .sort()
      .slice(0, 5)
      .map((name, index) => ({ base64: fs.readFileSync(path.join(tempDir, name)).toString('base64'), mimeType: 'image/jpeg', timeLabel: `${index * 2}s` }));
    if (!frames.length) throw new Error('没有提取到可分析画面');
    const parsed = await qualityCheckStoryboardFramesWithQwen({
      frames,
      storyboard: String(storyboard),
      productInfo: String(productInfo),
      critical: Boolean(critical),
    });
    const score = parsed.score;
    res.json({
      ok: true,
      quality: {
        score,
        passed: Boolean(parsed.passed) && score >= (critical ? 85 : 75),
        issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 8).map(String) : [],
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 6).map(String) : [],
        recommendation: String(parsed.recommendation || ''),
        checks: parsed.checks && typeof parsed.checks === 'object' ? parsed.checks : {},
        checkedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : '分镜质检失败' });
  } finally {
    try {
      for (const name of fs.readdirSync(tempDir)) fs.unlinkSync(path.join(tempDir, name));
      fs.rmdirSync(tempDir);
    } catch { /* best effort */ }
    if (cosTempPath) fs.rmSync(cosTempPath, { force: true });
  }
});

/* ── Gemini / Veo 视频生成 ──────────────────────────────────────────────── */
// POST /studio/gemini-video  Body: { script, productInfo, language, ratio, duration, resolution, title? }
studioRouter.post('/gemini-video', async (req, res) => {
  if (!isGeminiVideoEnabled() || isDemoMode()) {
    res.status(423).json({
      ok: false,
      locked: true,
      source: 'gemini',
      error: '当前视频生成服务暂未启用。请先配置可用的生成模型 Key 后重试。',
    });
    return;
  }
  const {
    script = '',
    productInfo = '',
    language = 'zh',
    ratio = '9:16',
    duration: rawDuration = 8,
    resolution = '720p',
    title = 'Gemini 生成视频',
  } = req.body ?? {};
  const duration = normalizeGeminiVideoDuration(rawDuration);
  if (!await consumeDemoQuota(req, res, 'videoGeneration')) return;
  const { apiKey, model } = geminiVideoConfig();
  if (!apiKey) {
    res.json({ ok: false, source: 'gemini', error: 'GEMINI_API_KEY not set' });
    return;
  }

  const prompt = [
    `Generate one ${duration}-second vertical commercial social video in ${langName(language)}, aspect ratio ${ratio}.`,
    'Treat the storyboard timecodes and the fields named Omni prompt / Omni negative prompt as the highest-priority visual instructions.',
    `Storyboard:\n${String(script).slice(0, 7000)}`,
    productInfo ? `Identity and product context (preserve appearance exactly; do not invent claims):\n${String(productInfo).slice(0, 1800)}` : '',
    'Reproduce only explicitly observed actions. An inferred intent explains why an image works, but it is not permission to invent a missing action. Never turn a causal gap into an on-screen event.',
    'For every beat, preserve the exact object state before and after the action, hand visibility, physical contact, gaze direction, head pose, framing, and whether the camera is static. Fast actions must start and end at the written sub-second boundary.',
    'Use realistic UGC optics, skin texture, eye reflections, tissue deformation and moisture. Preserve temporal continuity and subject identity. Do not beautify, recolor eyes, add tears, wiping, extra fingers, extra hand motion, camera moves, captions, platform UI, logos, or transitions unless explicitly requested.',
    'Do not render interface overlays or unreadable text into the video; overlays and verified captions are added in post-production.',
  ].filter(Boolean).join('\n\n');

  try {
    const timeoutMs = Math.max(30_000, Number(process.env.GEMINI_VIDEO_TIMEOUT_MS || 360_000));
    const output = await runGeminiVideoWorker({
      prompt,
      model,
      title,
      ratio,
      duration,
      resolution,
      outputDir: GENERATED_MEDIA_DIR,
      timeoutMs,
    }, timeoutMs);
    res.json(output);
    console.log(`[studio] TTS response sent headers=${res.headersSent} ended=${res.writableEnded}`);
  } catch (e: any) {
    const reason = String(e?.message ?? e).slice(0, 500);
    console.error('[studio] Gemini video generation failed:', e);
    res.json({ ok: false, source: 'gemini', error: `Gemini 视频生成失败：${reason}` });
  }
});

/* ── ③ 口播脚本 ────────────────────────────────────────────────────────── */
// POST /studio/script  Body: { materials?, productInfo?, language?, platform?, duration? }
studioRouter.post('/script', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const {
    materials = [],
    productInfo = '',
    language = 'en',
    platform = 'tiktok',
    duration = 20,
    scriptType = 'voiceover',
    generationMode = '',
    audience = '',
    sellingPoints = '',
    tone = 'high-converting',
    videoTheme = {},
    referenceTitle = '',
    referenceAnalysis = '',
    referenceHighlights = [],
    materialInfos = [],
    existingScripts = [],
    variantSeed = 0,
    voiceoverMode = 'unselected',
    cooperationRoute = '',
    provider,
  } = req.body ?? {};
  const lang = langName(language);
  const clips = (materials as string[]).join(', ') || '(generic product clips)';
  const normalizedMaterialInfos = normalizeMaterialInfos(materialInfos, materials, Number(duration) || 20);
  const structuredMaterials = materialInfoLines(normalizedMaterialInfos);
  const product = productInfo || '';
  const confirmedEnterprise = await enterpriseCtx();
  if (!String(product).trim()) {
    res.status(422).json({
      ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
      code: 'ENTERPRISE_PRODUCT_REQUIRED', script: '', fieldsToConfirm: ['企业产品资料'],
      validationIssues: ['缺少企业中心已确认的产品选择'], validationWarnings: [],
      error: '请先选择企业中心已确认产品；未调用模型生成脚本。',
    });
    return;
  }
  const confirmedProductEnterprise = confirmedEnterpriseContextForProduct(productInfo, confirmedEnterprise);
  const unconfirmedProductFields = unconfirmedEnterpriseProductFields(productInfo, confirmedEnterprise);
  if (String(sellingPoints || '').trim()
    && !normalizedFactValue(confirmedProductEnterprise).includes(normalizedFactValue(String(sellingPoints)))) {
    unconfirmedProductFields.push('创作卖点');
  }
  if (unconfirmedProductFields.length) {
    res.status(422).json({
      ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
      code: 'UNCONFIRMED_ENTERPRISE_PRODUCT_INPUT', script: '', fieldsToConfirm: Array.from(new Set(unconfirmedProductFields)),
      validationIssues: ['请求中的产品或卖点信息无法在当前企业中心已确认资料中核对'], validationWarnings: [],
      error: '所选产品或卖点资料尚未在企业中心确认，未调用模型生成脚本。',
    });
    return;
  }
  // Long benchmark videos can easily exceed 8k characters once every shot,
  // beat, dialogue and sound cue is serialized. Preserve the full working
  // timeline instead of silently dropping the latter half before generation.
  const reference = String(referenceAnalysis || '').slice(0, 40_000) || '(no detailed reference analysis provided)';
  if (generationMode === 'clone') {
    const timelineQuality = referenceTimelineQuality(referenceAnalysis, duration);
    if (!timelineQuality.valid) {
      res.status(422).json({
        ok: false,
        error: `对标逐镜分析不满足脚本生成标准：${timelineQuality.issues.join('；')}。请先完成全片精确分析。`,
        code: 'REFERENCE_EXACT_ANALYSIS_REQUIRED',
        requiresExactAnalysis: true,
        validationIssues: timelineQuality.issues,
      });
      return;
    }
  }
  const highlights = Array.isArray(referenceHighlights) && referenceHighlights.length
    ? referenceHighlights.slice(0, 8).map((item: unknown) => `- ${String(item).slice(0, 180)}`).join('\n')
    : '- No reliable highlights. Infer a simple product-first structure from title, platform, and product info.';
  const forbiddenTerms = referenceForbiddenTerms({ referenceTitle, materials, referenceHighlights, referenceAnalysis });
  const forbiddenIndustryTerms = referenceIndustryLeakTerms(`${referenceTitle}\n${referenceAnalysis}\n${highlights}`, productInfo);
  const forbiddenLine = forbiddenTerms.length
    ? `Reference-only forbidden terms: ${forbiddenTerms.join(', ')}. Do not output these words, hashtags, brand names, original captions, or original product claims.`
    : 'Do not output reference-video brand names, hashtags, original captions, or original product claims.';
  const providerOpt = 'qwen' as const;
  const hasNarrationDraft = voiceoverMode === 'ai' || voiceoverMode === 'unselected';
  const selectedProductBrief = productBrief(productInfo);
  const selectedProductCategory = selectedProductBrief.category || compactBriefCategory(selectedProductBrief);
  const normalizedVideoTheme = typeof videoTheme === 'object' && videoTheme ? videoTheme as Record<string, unknown> : {};
  const presentationMode = String(normalizedVideoTheme.presentationMode || 'material');
  const presentationRule = presentationMode === 'avatar'
    ? '成片方式：纯数字人口播。每一镜均为所选数字人面对镜头讲述，不插入产品实拍或生成物品动作；产品资料只用于口播事实。'
    : presentationMode === 'heygen'
      ? '成片方式：数字人加素材混剪。默认数字人开场和收尾，中段按已选产品素材事实配画；用户可在分镜表修改画面来源，不把整片写成数字人。'
      : '成片方式：纯素材剪辑。画面只使用已授权素材，不安排生成的数字人。';
  const mixedRules = mixedStoryboardRules(presentationMode, normalizedMaterialInfos);
  const videoThemeId = String(normalizedVideoTheme.id || 'buyer_pain');
  const videoThemeTitle = String(normalizedVideoTheme.title || '买家痛点');
  const videoThemePainPoint = String(normalizedVideoTheme.painPoint || audience || '').trim();
  const contentGoal = generationMode === 'product' && normalizedVideoTheme.contentGoal === 'reach' ? 'reach' : 'leads';
  const primaryCta = String(normalizedVideoTheme.primaryCta || normalizedVideoTheme.conversionGoal || '').trim();
  const endingRules = scriptEndingRules(contentGoal, primaryCta);
  const narrationBudget = scriptNarrationBudget(Number(duration), language);
  const themeConstraint = THEME_PROMPT_CONSTRAINTS[videoThemeId as ContentTheme] ?? THEME_PROMPT_CONSTRAINTS.buyer_pain;
  const modeForStrategy = generationMode === 'material'
    ? 'asset_library'
    : generationMode === 'clone'
      ? 'viral_remix'
      : 'product_info';
  const allowedRoutes: CooperationRoute[] = ['oem_odm', 'wholesale_distribution', 'consumer_retail'];
  const requestedRoute = String(cooperationRoute || '');
  const strategyRoute: CooperationRoute = allowedRoutes.includes(requestedRoute as CooperationRoute)
    ? requestedRoute as CooperationRoute
    : /retail|consumer|终端|零售/i.test(audience)
      ? 'consumer_retail'
      : /wholesale|distributor|importer|经销|进口|渠道/i.test(audience)
        ? 'wholesale_distribution'
        : 'oem_odm';
  const strategyBrief = createScriptStrategyBrief({
    generationLayer: 'primary_script',
    generationMode: modeForStrategy,
    contentTheme: videoThemeId as ContentTheme,
    cooperationRoute: strategyRoute,
    targetBuyerRoles: audience.trim() ? [audience.trim()] : [],
    platform,
    languagePlan: [language],
    targetDurationSec: Math.max(5, Number(duration) || 20),
    // The UI's theme pain point is a category description, not a buyer-specific
    // question. Let the strategy compiler produce a concrete route/theme question
    // unless a future explicit buyer-question field is supplied.
    buyerQuestions: [],
    approvedFacts: product.trim() ? [{ label: '本次选定产品资料', value: product.trim(), source: 'product' }] : [],
    availableEvidence: generationMode === 'material'
      ? normalizedMaterialInfos.map(item => ({ label: String(item.name || '未命名素材'), type: 'material' as const }))
      : product.trim() ? [{ label: '企业产品资料', type: 'product_detail' as const }] : [],
    primaryCta: primaryCta || (contentGoal === 'reach' ? '' : '私信了解产品资料'),
    verifiedCtaChannels: primaryCta ? ['user_selected'] : [],
    forbiddenClaims: themeConstraint.prohibitedPatterns,
  });
  const contentPlan = buildScriptContentPlan(strategyBrief);
  const strategyPlanRules = renderScriptContentPlan(contentPlan);
  const voiceoverDirective = voiceoverMode === 'unselected'
    ? '声音策略：用户尚未选择配音方式。分镜可提供简短台词草案，也可写“无”；不得因口播数量阻断分镜生成。'
    : voiceoverMode === 'none'
      ? '声音策略：用户已明确选择无口播。所有台词必须写“无”，信息由画面、字幕和配乐承担。'
    : generationMode === 'clone'
      ? '声音策略：用户选择重建口播。若原片存在口播位，可在对应位置写短台词；不得增加原片不存在的口播镜头。'
      : '声音策略：用户选择 AI 口播。每个承担钩子、问题、证据、决策或 CTA 的关键分镜都必须有完整自然口播；先按完整句子安排时长，禁止截断句子。台词与字幕必须逐字一致。';
  const videoThemeRules = `本条主题：${videoThemeTitle}
受众关注：${videoThemePainPoint || '从本次产品与素材中选择一个具体看点'}
主题方向：${contentPlan.hookFormula}
禁用表达：${themeConstraint.prohibitedPatterns.join('；')}
${voiceoverDirective}
${endingRules}`;
  const creativeRules = `${SCRIPT_CREATIVE_QUALITY_RULES}
${scriptCreativeModeRule(generationMode)}`;
  const scriptFactRules = `事实边界：选定产品资料提供产品事实，素材观察只证明可见画面，对标只提供结构与节奏。数字、单位、性能和功能关系只能来自产品资料；不得补造精度、响应速度、价格、MOQ、交期、认证、功效或案例。保留适用条件。“支持某能力”不能扩写成自动完成、实时同步、免操作等未给定结论。制作参数不是产品卖点；不借用其他产品事实。`;
  const cloneMigrationMode = String(tone).includes('高保真复刻')
    ? 'fidelity'
    : String(tone).includes('机制借鉴')
    ? 'mechanism'
    : 'structure';
  const cloneMigrationPolicy = cloneMigrationMode === 'fidelity'
    ? '当前为“高保真复刻”：产品展示逻辑兼容，可保留环境、动作、构图和镜头顺序，但必须替换竞品品牌、型号、参数与不支持的事实。'
    : cloneMigrationMode === 'mechanism'
    ? '当前为“机制借鉴”：只保留钩子类型、信息揭示顺序、证明位置和节奏；环境、主体动作、构图与细节证明均按企业产品和现有素材重建。'
    : '当前为“结构迁移”：保留原片的时长比例、镜头功能、证明顺序、景别节奏与音画密度；必须按企业产品重建环境、主体动作和可见证据，禁止沿用跨品类场景和物体。';
  const cloneFusionRules = `爆款素材迭代规则（只在内部执行，不要输出规则或解释）：
0. ${cloneMigrationPolicy}
1. REFERENCE_ANALYSIS 是灵感大屏已经完成的原视频分析，是原片结构、音画和爆点的唯一事实来源；禁止重新分析、重新定义或套用固定营销模板。
2. 原分析有多少段就输出多少段；逐段保留时间、顺序、时长比例、镜头功能、景别节奏、配乐和节拍。环境、构图与动作是否保留必须服从第 0 条迁移方式。不得合并、补段、重排或改成固定 5 段。
3. 爆点可能是视觉揭晓、动作、反差、细节、音效、卡点、人物反应、字幕或 CTA，不得把“采购痛点”默认当作爆点。
4. 只做受约束的产品替换：把原产品对象、品牌和型号替换为“产品信息”中的选定产品；没有冲突的场景、动作、镜头关系和节奏全部保留。
5. 原片没有口播就输出“台词：无”；原片没有屏幕文字就输出“字幕：无”；原片没有 CTA 就不得新增 CTA。
6. 不得新增人物、剧情、CTA 或镜头功能。但必须在原片现有的产品展示、细节特写、口播或字幕位中，写入选定产品名称和至少 1 个企业中心已核实事实（如规格、材质、定制能力、MOQ 或认证）；只能使用产品资料中真实存在的字段。
7. 不得把分析中的表达意图、改编建议、未展示因果写进实际画面；只允许使用原分析记录的可见、可听内容。
8. 缺失信息用“无”或“沿用原片”表达，禁止用想象补齐。分析缺少逐镜详情时应拒绝生成，不得降级为自由创作。
9. 输出必须干净：只输出时间戳分镜成稿，不输出标题、前言、总结、映射表、自检、Markdown、代码围栏或分析说明。`;
  const previousCloneScripts = Array.isArray(existingScripts)
    ? existingScripts.map(item => String(item || '').trim()).filter(Boolean).slice(-4)
    : [];
  const priorNarration = previousCloneScripts.flatMap(item => Array.from(item.matchAll(/^台词[：:]\s*(.+)$/gm)).map(match => match[1])).join(' ').replace(/\s/g, '').toLowerCase();
  const productFacts = productFactCandidates(product);
  const unusedProductFacts = scriptUnusedFacts(productFacts, priorNarration);
  const planningProduct = generationMode === 'product' && selectedProductNames(product).length === 1 && productFacts.length
    ? `产品名称：${selectedProductNames(product).join('、')}\n本轮可用事实：\n${(unusedProductFacts.length ? unusedProductFacts : productFacts).map(fact => `- ${fact}`).join('\n')}`
    : product;
  const cloneDiversityRules = previousCloneScripts.length
    ? `\n当前生成第 ${Math.max(1, Number(variantSeed) + 1)} 版。以下是已经生成的版本，仅用于排重，严禁复制：\n${previousCloneScripts.map((item, index) => `--- 已有版本 ${index + 1} ---\n${item.slice(0, 6000)}`).join('\n')}\n新版本必须保持原片时间轴和镜头功能，但至少改变以下三项：开场呈现动作、产品证明动作、场景陈设、镜头内产品顺序、台词句式、字幕表达。不得只替换同义词。`
    : '';

  const productDuration = Math.max(10, Number(duration) || 20);
  const productSceneCount = productDuration <= 30 ? 4 : productDuration <= 45 ? 6 : 8;
  // Only shorten an explicit leading model token, never invent a Chinese alias.
  const spokenName = (name: string) => /^[A-Za-z][A-Za-z0-9-]*\s+/.test(name) ? name.split(/\s+/)[0] : name;
  const packagingOnlyProductConstraint = /(?:无品牌瓶器|空白标签|外盒样品|包装方案)/.test(productInfo)
    && !/(?:防漏|密封|耐用|抗[压拉摔]|测试|容量|尺寸|材质|认证|交期|MOQ|起订)/i.test(productInfo)
    ? '本次产品资料仅证明容器/包装样品可提供：画面只能建议拍摄容器摆放、空白标签/外盒组合和手部排布；不得虚构瓶内液体、性能测试、厚薄、毛边、回弹、色差、密封、耐用、PDF资料或邮件界面。'
    : '';
  const productScriptRules = `为选定产品生成 ${productDuration} 秒、${productSceneCount} 段的 ${lang} 分镜稿。
时间从0开始连续无重叠，按完整口播与动作分配时长；中文约每秒4字并留停顿，不能截断句子。
${voiceoverDirective}
${presentationRule}
有口播时字幕逐字相同；无口播时字幕可独立传达信息。音效写入配乐字段。
每段画面写清主体、初始状态、动作和结束状态，并保持人物、产品外观和空间连续。没有现成画面可建议补拍，但产品状态、使用方式和性能结论必须有资料支持。
多选产品时，每个选定名称至少出现在一段画面中；只写输入支持的商业事实，不把参数扩写成未证实效果。
${packagingOnlyProductConstraint}
${forbiddenLine}
只输出以下格式，每段字段各出现一次，无标题、解释或 Markdown：
[start-end s]
环境：<具体场景>
景别：<景别>
运镜：<镜头运动>
构图：<主体位置与产品朝向>
镜头功能：<本段作用>
画面：<具体可执行动作；需补拍时明确标记>
配乐：<音乐或环境声/音效>
台词：<连贯口播片段，可有多句，或无>
字幕：<有口播时逐字相同>`;

  const materialScriptRules = `你是在把“已选素材库片段”剪成一条有销售情绪的社媒带货/外贸留资视频。素材约束留在画面说明中，人物口播必须始终面向潜在买家，不能说后台审核语言。

核心原则：
0. 输入优先级固定为：素材分段观察决定“画面里真实有什么和能怎么剪”；本条视频主题决定“爆款模板与证明顺序”；主推产品信息决定“允许出现的产品名、卖点、数字和商业事实”。三者冲突时不得猜测，画面服从素材、事实服从产品资料。
1. 每个时间戳段必须绑定一个具体素材名，不能只写泛泛产品话术。
2. 只能根据素材元信息做保守推断：素材名、类型、角色、原始时长、建议时间段。没有真实画面识别时，不得编造画面里出现的人、场景、动作或效果。
3. “原始时长”只是文件长度，“建议有效时长”才是当前脚本可使用的动作长度。禁止为了填满目标时长而慢放、循环或重复同一个动作，除非分段观察明确支持。
4. 画面字段必须写“使用素材《素材名》...”并说明剪辑重点，例如截取开头、细节处、动作最清楚处、包装/样品处。
5. 每段承担不同剪辑任务，按实际素材数量选择开场、细节、使用/对比、供应能力、定制/包装、CTA；不得为了凑结构虚构素材不存在的功能。
6. 口播必须承接该素材的角色并形成连续销售逻辑：第一段让人停留，中段把可见细节变成购买理由，最后一段只给一个低门槛行动。不能每段复用同一句式。
7. 如果素材信息不足，只能写“按该素材可见内容剪辑”，不能伪装已经识别出画面。尤其禁止从液体滴落推断吸收、渗透、淡纹、美白、祛痘或其它功效。
8. “按可见内容剪辑、不得推断、资料可确认”只能写进画面字段，禁止出现在人物说中。禁止口播“先看素材、这段只按可见内容、逐项确认”等制作/审核腔。
9. 中文口播按每秒4字并至少预留0.6秒停顿。下面每个时间段的“口播最多字数”是硬上限，不含标点；宁可写“无”也不得超出。
10. 必须恰好生成 ${Math.max(1, normalizedMaterialInfos.length)} 段，逐行使用下方时间段和对应素材，不得改时间、交换素材、合并或增加分镜。
${normalizedMaterialInfos.map((info, index) => {
  const start = Number(info.targetStart || 0);
  const end = Number(info.targetEnd || start + 0.5);
  const maxChars = Math.max(2, Math.floor(Math.max(0.5, end - start - 0.6) * 4));
  return `- 第${index + 1}段：[${start}-${end}s]；素材《${info.name}》；中文口播最多${maxChars}字`;
}).join('\n')}
11. 数字、单位、规格、功效和认证只能逐字来自产品信息；素材名里的数字不能自动视为产品事实，也不能写进台词或字幕。
12. 输出前内部执行三次检查：时间轴连续；每段素材名正确；逐段口播字数不超限。只输出通过检查的成稿，不解释规则。

爆款模板必须服务于当前主题“${videoThemeTitle}”：钩子素材原动作完整建立停留理由 → 1-2 个与主推产品有关的可见证明 → 一个采购/使用价值解释 → 单一低门槛 CTA。不得为了套模板虚构素材中不存在的动作，也不得把无关工厂素材硬套到消费品功效。

固定格式（每段完整重复）：
[start-end s]
素材：<素材名>
环境：<仅写素材元信息支持的环境；未知写“按素材可见环境”>
景别：<远景/全景/中景/中近景/近景/特写之一>
运镜：<固定/推进/拉远/横移/跟拍/环绕之一>
构图：<主体位置、产品朝向、前中后景关系；未知时给出保守裁切方案>
镜头功能：<单一功能>
画面：<基于该素材的剪辑方式，必须提到素材名和明确截取重点>
配乐：<音乐/环境声/音效的节奏，不与口播混写>
台词：<真人能说出口的一句话；不需要则写“无”>
字幕：<短字幕>`;

  const variantRules = `${scriptVariantDirection(generationMode, variantSeed)}${previousCloneScripts.length
    ? `
已有版本（只用于排重，不作为产品事实）：
${previousCloneScripts.map(item => [...new Set(Array.from(item.matchAll(/^(?:台词|字幕)[：:]\s*(.+)$/gm)).map(match => match[1]))].join(' ').slice(0, 1200)).join('\n')}
新版本至少改变钩子切口、证据顺序、叙述视角中的两项；不能只替换同义词。`
    : ''}`;
  let durationFitWarning = '';
  let storyboardFallbackWarning = '';

  try {
    const scriptSystemPrompt = `${presentationRule}\n${mixedRules}\n你是熟悉产品的讲解者，正在帮一个买家想清楚选择。只输出请求的 JSON。产品资料限定你可以陈述的事实；未知信息留作要确认的问题。保留支持、可配置等条件，不推导实施方式或效果，不许诺资料外的服务。`;
    // Select a source fact before drafting. An ungrounded draft must
    // not become the source material for a second, increasingly confident rewrite.
    const generatedVoicePlan = generationMode === 'product' && hasNarrationDraft
      ? await callLLM(`为 ${platform} 的 ${lang} 产品口播选择一项事实。目标 ${productDuration} 秒，受众：${audience || '产品的潜在买家'}。
产品资料：${planningProduct}
主题：${videoThemeTitle}；关注方向：${videoThemePainPoint || contentPlan.hookFormula}
${variantRules}
选一项适合当前主题、值得向买家解释的细节。只摘完整原文并保留条件，不作解释，不追加问题或推论。只输出 JSON：{"factBasis":["产品资料原文"]}。`, { backend: providerOpt, systemPrompt: scriptSystemPrompt })
      : '';
    let spokenFact = '';
    if (generatedVoicePlan) {
      try {
        const plan = JSON.parse(generatedVoicePlan.replace(/```json|```/gi, '').trim());
        const facts = Array.isArray(plan.factBasis) ? plan.factBasis : [];
        const supported = facts.length === 1 && facts.every((fact: unknown) => typeof fact === 'string' && fact.trim()
          && planningProduct.replace(/\s/g, '').includes(fact.replace(/\s/g, '')));
        if (supported) spokenFact = scriptSelectedFactPhrase(generatedVoicePlan, product);
      } catch { /* fail explicitly below */ }
      if (!spokenFact) throw new Error('口播构思模型未选出资料中的事实');
    }
    const factOwner = scriptSelectedFactProductName(generatedVoicePlan, product);
    const spokenProductNames = (factOwner ? [factOwner] : selectedProductNames(product)).map(spokenName);
    // Keep only the selected source clause in the writing context. Scene division
    // happens afterwards and never changes the spoken wording.
    let editedVoiceLines = spokenFact
      ? scriptNarrationLinesFromPlan(await callLLM(`写一段 ${productDuration} 秒的 ${lang} 口播，用于 ${platform}。
产品称呼：${spokenProductNames.join('、')}（只说一次，不念完整型号介绍）。
本条只讲这个事实：${spokenFact}
${scriptVariantDirection(generationMode, variantSeed)}
对谁说：${audience || '产品的潜在买家'}。语气：${tone}。
${SCRIPT_CREATIVE_QUALITY_RULES}
${SCRIPT_FACT_TO_VALUE_EXAMPLES}
${endingRules}
${narrationBudget}
只输出 JSON：{"narration":"像当面说话一样的完整口播"}。不分镜、不凑句数。`, { backend: providerOpt, systemPrompt: scriptSystemPrompt }), productSceneCount)
      : [];
    if (spokenFact && !editedVoiceLines.length) {
      throw new Error('口播模型未返回完整的结构化台词');
    }
    if (editedVoiceLines.length && lockedVoiceDurations(editedVoiceLines).reduce((sum, seconds) => sum + seconds, 0) > productDuration) {
      const originalVoiceLines = editedVoiceLines;
      const estimated = lockedVoiceDurations(editedVoiceLines).reduce((sum, seconds) => sum + seconds, 0);
      editedVoiceLines = scriptNarrationLinesFromPlan(await callLLM(`把口播缩到 ${productDuration} 秒；当前预估 ${estimated.toFixed(1)} 秒，至少减少 ${Math.max(20, Math.ceil((1 - productDuration / estimated) * 100))}% 内容。
产品称呼：${spokenProductNames.join('、')}。本条事实：${spokenFact}
原稿：${editedVoiceLines.join(' ')}
保留原来的问题、事实条件和句间承接；提问仍然是提问，不替产品给出新答案。少讲一个点，不把全文压成口号。
${endingRules}
${narrationBudget}
只输出 ${lang} JSON：{"narration":"缩短后的完整口播"}。`, { backend: providerOpt, systemPrompt: scriptSystemPrompt }), productSceneCount);
      if (!editedVoiceLines.length || lockedVoiceDurations(editedVoiceLines).reduce((sum, seconds) => sum + seconds, 0) > productDuration) {
        editedVoiceLines = editedVoiceLines.length ? editedVoiceLines : originalVoiceLines;
        durationFitWarning = '口播预估超过目标时长，已保留生成结果；请在脚本与声音步骤精简口播或增加成片时长';
      }
    }
    const lockedVoiceLines = generationMode === 'product'
      ? editedVoiceLines
      : generationMode === 'material' && voiceoverMode === 'unselected'
        ? safeMaterialVoicePlan(normalizedMaterialInfos, primaryCta, language)
        : [];
    const lockedNarrationRules = lockedVoiceLines.length
      ? `已锁定口播（不得改写；字幕逐字复制）：\n${lockedVoiceLines.join('\n')}`
      : '';
    let generatedVisualScenes = generationMode === 'product' && lockedVoiceLines.length
      ? parseLockedStoryboardScenes(await callLLM(`为以下锁定口播片段写可执行分镜，恰好 ${lockedVoiceLines.length} 段。
成片约束：${presentationRule}\n${mixedRules}
产品名称：${selectedProductNames(product).join('、')}
本条事实：${spokenFact}
主题：${videoThemeTitle}
已选素材观察：${structuredMaterials || '未提供已分析素材；画面必须标为“建议补拍”，不声称已有素材。'}
锁定口播：${lockedVoiceLines.map((line, index) => `${index + 1}. ${line}`).join('\n')}
后期文案仅从锁定口播与本条选中事实中取用，不把上下文里的其他卖点塞进画面。行动只用锁定口播的 CTA 文字，不新增二维码、联系方式、立牌或扫码行动。
镜头要求：用画面帮助理解口播，相邻镜头推进信息。${presentationMode === 'heygen' ? '数字人讲述与已观察素材交替；素材没有的动作不能添加，尤其禁止人手指示。' : '没有实拍依据时，创意落在取景、呈现顺序、人手指示和后期文字上，设备保持静态；'}不通过虚构设备运行、界面或反馈来证明能力。后期文字注明是后期叠加。
${presentationMode === 'heygen' ? '示例：数字人：面向镜头讲述；素材《完整素材名》；源片截取：0-3s；展示观察确认的可见外观。' : '示例（仅学形式）：资料只有“可选双工位”，可写“建议补拍：镜头从整机推进；后期出现双工位可选，产品结构以实物为准”，不编排两工位同步加工或产能变化。'}每镜只写一个主要动作（初始状态→动作→结束状态），画面不超过80字，镜头功能只写短语。景别和运镜分开填写，保持主体与道具连续；配乐可写“无”。
${presentationMode === 'heygen' ? '混剪禁止补拍建议，缺少素材证明的镜头必须拒绝，不能添加手部或假定同一物件；' : '没有素材证明的镜头写“建议补拍”；'}未知设备细节保持未知：只拍整机及实际可见外观，不指定接口、传感器、屏幕、铭牌或指示灯位置。资料说明功能，不证明这些硬件可见。用取景变化承接口播；后期信息不能画成设备自带界面。不得输出台词、字幕或时间戳。
只输出 JSON，字段含义如下（替换占位内容，不把动作写进景别）：
{"scenes":[{"environment":"拍摄地点；未知写按实物环境","shot":"仅景别名称，如特写","camera":"仅运镜名称，如固定","composition":"主体位置与朝向","purpose":"本镜作用短语","visual":"${presentationMode === 'heygen' ? '以数字人：或素材《完整素材名》；源片截取：a-bs；开头，后接已验证画面描述' : '完整动作描述；无素材时以建议补拍开头，不能只写建议补拍'}","music":"音乐或无"}]}。`, { backend: providerOpt, systemPrompt: scriptSystemPrompt }), lockedVoiceLines.length)
      : [];
    if (generationMode === 'product' && lockedVoiceLines.length && generatedVisualScenes.length !== lockedVoiceLines.length) {
      generatedVisualScenes = safeProductScenes(product, lockedVoiceLines.length);
      storyboardFallbackWarning = '分镜模型返回不完整，已生成保守分镜草案；请在成片制作前核对并补充真实画面';
    }
    const lockedVisualScenes = generationMode === 'material' && voiceoverMode === 'unselected' && lockedVoiceLines.length
      ? safeMaterialScenes(normalizedMaterialInfos)
      : generatedVisualScenes;

    const prompt = generationMode === 'material'
      ? `${materialScriptRules}

${creativeRules}

${scriptFactRules}

${videoThemeRules}

${variantRules}

素材清单：
${structuredMaterials || '无可用素材。请拒绝生成，并提示先上传素材。'}

产品信息：
${product || '未选择产品。只能围绕素材做保守剪辑建议，不得编具体产品。'}

目标平台：${platform}
目标受众：${audience || '海外 B2B 买家、小批量试单买家、渠道采购商'}
补充卖点：${sellingPoints || '仅使用产品信息中已提供的卖点'}
风格：${tone || '真实、可拍、素材优先、询盘导向'}

台词与字幕必须使用 ${lang}，不得因为产品资料是中文而输出中文台词。画面说明和字段名使用简体中文。
这次选择的是已有素材，只陈述可见外观；禁止从排列、反光、走线或焊点推断生产工艺、治具校准、良率、品质或测试结果。
每个素材区间可以有独立分镜，同名素材的不同时间区间必须分别保留。不得把多个分镜合并为一镜。
请直接输出按素材逐段绑定的时间戳脚本。`
      : generationMode === 'product'
      ? `${productScriptRules}

${creativeRules}

${scriptFactRules}

${videoThemeRules}

${variantRules}

${lockedNarrationRules}


	产品信息：
	${product || '未选择产品。请拒绝生成具体产品脚本。'}

目标平台：${platform}
目标受众：${audience || '海外 B2B 买家、小批量试单买家、渠道采购商'}
补充卖点：${sellingPoints || '仅使用产品信息中已提供的卖点'}
风格：${tone || '真实、可拍、询盘导向'}
素材信息：${clips}

请直接输出脚本。`
      : scriptType === 'storyboard'
      ? `你是爆款参考视频的受约束迭代导演。你不负责重新设计营销结构，只负责在保留原片结构和爆点的前提下完成最小必要的产品替换。
请生成 ${platform} 分镜脚本，语言为 ${lang}。总时长、分镜数量和时间段必须跟随对标视频脚本详析，不得套用 ${duration} 秒或固定段数模板。

已选素材：${clips}
可用素材的片段观察（仅这些观察可以作为已有画面依据）：
${structuredMaterials}
素材文件名、分类、产品资料和参考片均不能证明本企业已经拍到某个动作。没有片段观察时按缺口处理，不得声称已有对应画面。
产品信息：
	${product || '未选择产品。请拒绝生成具体产品脚本。'}
产品行业锁定：${selectedProductCategory || '以产品信息为准'}
目标受众：${audience || '根据产品和平台推断'}
核心卖点：${sellingPoints || '从产品信息中提炼，不得编造'}
风格：${tone}
对标视频标题：已隐藏，禁止猜测或补写
对标视频分析：
${reference}
可复用的爆款亮点：
${highlights}
${forbiddenLine}

${cloneFusionRules}
${cloneDiversityRules}

${creativeRules}

${scriptFactRules}


每个场景必须严格对应“对标视频脚本详析”的同一时间段，不要合并、跳段或擅自重排。使用以下固定格式，不要 markdown 符号，不要缺字段：
[start-end s]
素材：<已有素材写准确文件名及原素材起止秒；无对应片段写“待拍：具体动作要求”；数字人讲解写“待生成：数字人口播”>
环境：<按迁移方式保留原环境，或重建为适合企业产品的可拍场景>
景别：<照抄原详析景别>
运镜：<照抄原详析运镜>
构图：<保留原片主体位置和层次；迁移时明确新产品朝向与前中后景>
镜头功能：<钩子/效果证明/价格反差/产品介绍/信任证明/CTA等单一主要功能>
画面：<保留该段镜头功能与卡点节奏；高保真时做产品替换，结构迁移/机制借鉴时必须按企业产品重建可执行动作与可见证据>
配乐：<照抄或贴近原详析配乐音效>
台词：<仅当原分析同一镜头存在口播/对白时保留或做必要产品替换，否则写“无”>
字幕：<仅当原分析同一镜头存在屏幕文字时保留或做必要产品替换，否则写“无”>

硬性规则：
- 逐段保留对标视频的时间段、镜头功能、景别节奏、配乐形态和卡点密度；环境、动作、构图和产品证据必须服从“${cloneMigrationMode}”迁移策略。
- “可见事实”优先级高于标题、口播和表达意图。必须依据相邻密集帧定位动作边界；首帧已经存在的湿润、遮挡、手势或物体状态必须写成初始状态，不能倒推出未拍到的形成过程。
- “表达意图”和“未展示因果”只能帮助理解创意，不得进入实际画面；禁止把推断写成已发生的动作。
- 如果对标视频与选定产品跨品类，不得直接做名词替换；必须保留镜头功能和节奏，重建与企业产品相符的场景、动作、构图和证明内容。
- 不得出现对标视频原行业、原品类、原产品功效；但可以保留无行业冲突的环境、色彩、造型、动作、音效和节奏描述。
- 原片开头依靠什么形成 hook，就保留什么；禁止默认改成采购顾虑或销售口播。
- 原片相邻镜头允许使用相同环境和机位；不得为了“丰富”而擅自改场景、加动作或增加剧情功能。
- 原片镜头数量、切点和内容功能优先级高于目标时长参数；目标时长仅在原分析明确缺失时作为兜底。
- 画面不能写“真实使用场景”“痛点特写”这种空泛词，必须写清楚人物在什么环境里做什么动作，镜头拍到什么具体物件或结果。
- 不要写 generic phrases like "premium quality", "high conversion", "boost sales", "worth buying"，除非绑定具体产品细节。
- 不得复制或提及对标视频标题、原 caption、hashtag、品牌名、原品类、原产品功效。
- 成稿必须出现选定产品名称，并至少使用 1 个“产品信息”中的已核实卖点或规格；不能只把竞品名换成泛称。
- 不得输出分析摘要、基础要求、竞品识别、产品替换说明、成片目标或任何“对标视频”说明，只输出新的可拍分镜。
- 缺少数据时写“无”或“沿用原片”，不得新增样品、报价或 CTA。
- 最终只输出 storyboard 成稿。`
      : `You are a senior short-video copywriter for a Chinese cross-border e-commerce seller.
Write a practical ${duration}-second ${platform} voiceover script in ${lang}.

Selected clips: ${clips}
	Product info: ${product || 'No selected product. Do not invent a product.'}
Target audience: ${audience || '(infer from product and platform)'}
Key selling points: ${sellingPoints || '(infer from product info)'}
Tone/style: ${tone}
Reference video title: ${referenceTitle || '(unknown)'}
Reference video analysis:
${reference}
Reference highlights to reuse:
${highlights}
${forbiddenLine}

${videoThemeRules}

${creativeRules}

${scriptFactRules}


Requirements:
- Exactly three sections, each on its own block, labelled like "[Hook · 0-3s]", "[Proof · 3-${duration - 5}s]", "[CTA · ${duration - 5}-${duration}s]".
- Each section must contain 1-3 short spoken lines only, in ${lang}.
- The hook must mention a concrete buyer pain, use case, visible product result, or sourcing problem in the first line.
- The proof section must include one or two concrete details explicitly present in product info and explain why they matter to this audience. Omit unsupported fields rather than completing a checklist.
- The CTA must ask for one specific B2B action supported by the input. When purchasing policies are absent, safely ask the viewer to message for verified product details.
- Do NOT write generic phrases like "premium quality", "stable solution", "high conversion", "everyone is asking", unless backed by a concrete detail.
- Reuse the reference video's rhythm, not its exact product or claims.
- Do not copy or mention the reference video's title, original caption, hashtags, brand names, original product category, or original product claims.
- Output ONLY the script text.`;

    // Structured product scripts already have locked narration and visual scenes.
    // Do not add another free-form storyboard call that can corrupt them.
    const hasLockedDraft = lockedVisualScenes.length > 0 && lockedVisualScenes.length === lockedVoiceLines.length;
    const text = hasLockedDraft
      ? ''
      : await callLLM(`${presentationRule}\n${prompt}`, { backend: providerOpt, systemPrompt: confirmedProductEnterprise || undefined });
    const isStructuredLockedDraft = hasLockedDraft && (generationMode === 'product' || generationMode === 'material');
    let script = isStructuredLockedDraft
      ? ensureSelectedProductNamesInScript(serializeLockedStoryboard(lockedVisualScenes, lockedVoiceLines, generationMode === 'product' ? productDuration : 0), productInfo)
      : normalizeScriptTimestamps(enforceProductNameInScript(stripScriptAnalysisSummary(text), productInfo));
    if (generationMode === 'material') script = repairMaterialScript(script, productInfo, structuredMaterials);

    // A long creative prompt can still cause a model to smuggle in a familiar MOQ,
    // lead time, measurement, or guarantee. Do not loosen the final validator for
    // that failure mode: give the model a short, closed-world repair pass instead.
    // The repair prompt deliberately contains the rejected draft and the fact source,
    // but none of the large creative-policy context that tends to distract it.
    const normalizeGeneratedScript = (value: string) => {
      let normalized = normalizeStoryboardFieldLines(normalizeScriptTimestamps(ensureSelectedProductNamesInScript(enforceProductNameInScript(stripScriptAnalysisSummary(value), productInfo), productInfo)));
      if (generationMode === 'product') {
        if (hasNarrationDraft && !lockedVisualScenes.length) normalized = applyLockedVoicePlan(normalized, lockedVoiceLines);
        // The deterministic locked draft already owns a valid, target-sized
        // timeline. Rebuilding its ranges from speech would collapse planned
        // visual breathing room (for example 20 seconds back to 12 seconds).
        if (!isStructuredLockedDraft) normalized = restoreProductStoryboardBoundaries(normalized);
      }
      if (generationMode === 'material') normalized = repairMaterialScript(normalized, productInfo, structuredMaterials);
      if (hasNarrationDraft) normalized = syncStoryboardSubtitles(normalized);
      return normalized;
    };
    const strictCommercialPolicyIssues = (candidate: string): string[] => {
      const issues: string[] = [];
      if (/零残留|无挂壁|无气泡|零瑕疵|零缺陷|完全密封|绝不漏|永不漏|无划痕|无毛边|无色差|回弹(?:顺畅|稳)|资料齐全|随时可用|可追溯(?:的)?规格|真实材质(?:与)?结构|厚度差异|结构真实性|可信对比源/i.test(candidate)) {
        issues.push('资料未支持的产品表现、测试结论或文件主张');
      }
      if (/不破|不裂|纹丝不动|吹不烂|保证|最快|最低价|全网|no tear|won'?t tear|never breaks?|unbreakable/i.test(candidate)) {
        issues.push('绝对化或不可验证承诺');
      }
      if (/(?:马上|立即|免费|可)?寄样|寄送样品|免费样品/i.test(candidate)) {
        issues.push('资料未支持的寄样或样品政策承诺');
      }
      const ctaSatisfied = ctaSemanticallySatisfied(candidate, primaryCta);
      if (generationMode !== 'clone' && !ctaSatisfied) {
        issues.push(`未使用本条唯一主 CTA：${primaryCta}`);
      }
      const spokenLines = Array.from(candidate.matchAll(/^台词[：:]\s*(.+)$/gm))
        .map(match => String(match[1] || '').trim())
        .filter(line => line && !/^(无|none|no voiceover)$/i.test(line));
      if (requiresMinimumVoiceoverLines(voiceoverMode, generationMode) && spokenLines.length < 2) {
        issues.push('已选择 AI 口播，但有效台词不足两段');
      }
      return issues;
    };
    const strategyExecutionIssues = (candidate: string): string[] => {
      // This is a quality gate, not a fact gate. It catches the common failure
      // where a model obeys the storyboard schema but opens with a product name
      // instead of the selected buyer's decision problem.
      const firstScene = String(candidate || '').split(/(?=^\[[^\]\r\n]+\][ \t]*$)/m).find(block => /^\[[^\]]+\]/.test(block.trim())) || '';
      const firstVoice = (firstScene.match(/^台词[：:]\s*(.+)$/m)?.[1] || '').trim();
      const firstCaption = (firstScene.match(/^字幕[：:]\s*(.+)$/m)?.[1] || '').trim();
      const firstVisual = (firstScene.match(/^画面[：:]\s*(.+)$/m)?.[1] || '').trim();
      const opening = `${firstVoice} ${firstCaption} ${firstVisual}`.replace(/\s+/g, ' ').trim();
      const issues: string[] = [];
      const productNameOpening = selectedProductNames(productInfo).some(name => {
        const normalized = normalizeProductIdentity(name);
        return normalized && normalizeProductIdentity(firstVoice).startsWith(normalized);
      });
      if (generationMode !== 'clone' && (productNameOpening || !/[？?]|怎么|如何|为什么|别只|先别|看不出|难以|担心|选择|确认|判断|采购|品牌方|经销|进口|\b(?:how|why|which|what|buyer|brand|procurement|sourcing|choose|decide|verify|concern|risk|problem)\b/i.test(opening))) {
        issues.push('首段没有先给目标买家的具体决策问题或判断反差，仍像产品自我介绍');
      }
      const themeOpeningPatterns: Partial<Record<ContentTheme, RegExp>> = {
        buyer_pain: /采购|品牌方|品牌创始人|买家|经销|进口|担心|难以|问题|选择|判断|\b(?:buyer|brand|procurement|sourcing|concern|risk|problem|choose|decision)\b/i,
        product_proof: /目录|实物|细节|怎么|如何|看不出|判断|确认|\b(?:catalog|physical|detail|verify|check|judge|confirm|proof)\b/i,
        customization: /品牌方|包装|打样|标签|外盒|确认|适配|\b(?:brand|packaging|sample|prototype|label|carton|confirm|fit|custom)\b/i,
        comparison: /怎么选|如何选|区别|差异|选择|对比|\b(?:choose|choice|difference|compare|comparison|versus|vs)\b/i,
        supplier_capability: /供应|交付|质检|生产|补货|确认|风险|\b(?:supply|delivery|quality|inspection|production|fulfillment|risk|verify)\b/i,
        talking_head: /我|我们|你|采购|品牌方|问题|为什么|怎么|\b(?:I|we|you|buyer|brand|procurement|question|why|how)\b/i,
      };
      const expected = themeOpeningPatterns[videoThemeId as ContentTheme];
      if (generationMode !== 'clone' && expected && !expected.test(opening)) {
        issues.push(`首段没有执行“${videoThemeTitle}”主题的钩子公式`);
      }
      if (generationMode !== 'clone' && !String(audience || '').trim() && !openingMatchesCooperationRoute(opening, strategyRoute)) {
        issues.push('首段没有点名当前合作路线对应的目标买家');
      }
      if (generationMode !== 'clone' && !openingMatchesTargetBuyer(opening, audience)) {
        issues.push('首段没有使用本条企业策略配置的目标买家');
      }
      const functions = Array.from(String(candidate || '').matchAll(/^镜头功能[：:]\s*(.+)$/gm)).map(match => match[1]!.trim());
      if (functions.length > 2 && new Set(functions).size < Math.min(3, functions.length)) {
        issues.push('分镜功能重复，未形成钩子、问题、证据、决策和 CTA 的推进');
      }
      if (isBeautyProductInfo(productInfo) && !isPackagingOnlyProductInfo(productInfo) && (['product_proof', 'use_case'].includes(videoThemeId) || strategyRoute === 'consumer_retail')) {
        const scenes = String(candidate || '').split(/(?=^\[[^\]\r\n]+\][ \t]*$)/m).filter(block => /^\[[^\]]+\]/.test(block));
        const productScenes = scenes.filter(scene => /膏体|旋出|旋回|唇部|手背|化妆包|涂抹/.test(scene)).length;
        const packagingScenes = scenes.filter(scene => /标签|外盒|包装|牛皮纸|白管/.test(scene)).length;
        if (scenes.length >= 3 && (productScenes < Math.ceil(scenes.length * 2 / 3) || packagingScenes > 1)) {
          issues.push('美妆产品本体镜头不足，包装信息不应主导产品实证、使用场景或C端脚本');
        }
      }
      return issues;
    };
    const repairableIssues = (candidate: string): string[] => {
      const unsupported = unsupportedNumericClaims(candidate, confirmedProductEnterprise);
      const commercialAudit = auditCommercialClaims(candidate, confirmedProductEnterprise);
      const issues = unsupported.length ? [`资料外数字：${unsupported.join('、')}`] : [];
      issues.push(...commercialAudit.issues);
      issues.push(...mixedStoryboardIssues(candidate, presentationMode, normalizedMaterialInfos));
      if (/不破|不裂|纹丝不动|吹不烂|保证|最快|最低价|全网|no tear|won'?t tear|never breaks?|unbreakable/i.test(candidate)) {
        issues.push('绝对化或不可验证承诺');
      }
      const normalizedCandidateIdentity = normalizeProductIdentity(candidate);
      const missingNames = selectedProductNames(productInfo).filter(name => {
        const normalizedName = normalizeProductIdentity(name);
        return normalizedName.length > 0 && !normalizedCandidateIdentity.includes(normalizedName);
      });
      if (missingNames.length) issues.push(`未完整写入选定产品名称：${missingNames.join('、')}`);
      issues.push(...strictCommercialPolicyIssues(candidate));
      // Editorial keyword heuristics are advisory, never model-repair triggers.
      issues.push(...duplicateStoryboardFieldIssues(candidate));
      issues.push(...subtitleVoiceMismatchIssues(candidate));
      issues.push(...storyboardSpeechIssues(candidate));
      if (generationMode === 'clone') {
        issues.push(...storyboardReferenceLeakIssues(candidate, forbiddenTerms, forbiddenIndustryTerms));
      }
      return issues;
    };
    const repairFormat = generationMode === 'product'
      ? `必须保留${lockedVoiceLines.length || productSceneCount}段及每段完整字段；可重新计算时间戳以容纳完整自然口播，总时长保持约${productDuration}秒，时间连续无重叠。`
      : generationMode === 'material'
        ? '必须保留原有时间段、素材绑定和每段字段，不得新增素材或臆造素材画面。'
        : scriptType === 'storyboard'
          ? '必须保留原有对标时间段、镜头数量和字段，不得重排镜头。'
          : '必须保留原有三个区块和时长标签。';
    // Apply deterministic normalization before asking the model to repair the
    // draft. Subtitle/voice equality is mechanical and should not trigger up
    // to three extra LLM calls (or push the UI past its request timeout).
    script = normalizeGeneratedScript(script);
    for (let repairAttempt = 0; !isStructuredLockedDraft && repairAttempt < MAX_INTERACTIVE_SCRIPT_REPAIR_ATTEMPTS; repairAttempt += 1) {
      const issues = repairableIssues(script);
      if (!issues.length) break;
      const repaired = await callLLM(`你是脚本事实校对员。请直接修复下方草稿，只输出修复后的脚本，不要解释。

唯一允许作为产品与商业事实的来源（服务器读取的企业中心已确认资料）：
${hasConfirmedEnterpriseFacts(confirmedProductEnterprise) ? confirmedProductEnterprise : '无。不得写任何产品事实或商业能力。'}

本次发现的问题：
${issues.map(issue => `- ${issue}`).join('\n')}

保留本条创意和模式边界：
${presentationRule}
${mixedRules}
${generationMode === 'clone' ? scriptCreativeModeRule('clone') : contentGoal === 'reach' ? endingRules : strategyPlanRules}

修复规则：
- 删除或改写含有资料外数字、单位、MOQ、价格、交期、认证、效果、比较、保证、性能测试结论或文件完备性主张的整句；不要用另一个数字替换。
- 资料未提供时，宁可写“无”或改成不含商业主张的可拍动作；不得写“按需求确认”“可定制”“可提供样品”，除非来源明确提供。
- 台词超时就缩短台词；不需要台词可写“无”。
- 禁止截断台词。超过镜头时必须重新安排该段时间戳或改写成语义完整的短句；不能以破折号、省略号或未完成短语收尾。
- 每个分镜每个字段只能出现一次，尤其只能有一行“台词”和一行“字幕”；把 CTA 融入最后一段唯一的台词或字幕，不得另起重复字段。
- 每个选定产品名称只需逐字出现在一段“字幕”或“画面”字段中；产品名称本身是已核实事实，不得缩写、改名或省略，也不要在多段重复粘贴。
- ${generationMode === 'clone' ? '口播、字幕和 CTA 仅保留原片已有位置，原片没有则不新增。' : `结尾仅保留所选 CTA「${primaryCta || '无'}」，按目标语言自然表达，不增加其他行动承诺。`}
- 画面必须服从本次产品和素材事实；仅提供容器包装时不能添加内装物或使用效果。
- 保留已有的创意切口与自然开场，只修复列出的问题，不因缺少职业或主题关键词重写口播。
- ${generationMode === 'clone' ? '不得为了口播段数新增原片没有的台词。' : voiceoverDirective}
- 不得新增产品事实、人物、镜头、CTA、场景或产品名称；唯一 CTA 保持原意。
- ${repairFormat}

待修复草稿：
${script}`, { backend: providerOpt, systemPrompt: confirmedProductEnterprise || undefined });
      script = normalizeGeneratedScript(repaired);
    }
    if (!isStructuredLockedDraft) script = normalizeGeneratedScript(script);
    if (generationMode === 'clone') {
      // Competitor identifiers are never valid output facts. Remove the small
      // set extracted from the reference after the model repair passes, while
      // keeping the selected product name enforced separately below.
      script = stripStoryboardReferenceLeaks(script, forbiddenTerms, forbiddenIndustryTerms)
        .replace(/#[A-Za-z][A-Za-z0-9_-]{2,}/g, '')
        .replace(/零残留|无挂壁|无气泡|零瑕疵|零缺陷|完全密封|绝不漏|永不漏|无划痕|无毛边|无色差|回弹(?:顺畅|稳)|厚度差异|结构真实性/gi, '可见细节')
        .replace(/资料齐全|随时可用|可追溯(?:的)?规格|真实材质(?:与)?结构|可信对比源/gi, '');
      script = stripStoryboardHashtags(script);
      // Repair only small timing misses with the same semantic compaction used
      // by material storyboards. fitSpeechToShot returns severe overflows
      // unchanged, so the validator below still rejects them instead of
      // producing mechanically truncated fragments.
      script = syncStoryboardSubtitles(fitStoryboardSpeech(script));
    }
    if (generationMode === 'clone' && voiceoverMode === 'none') {
      script = clearStoryboardSpeech(script);
    }
    script = ensureSelectedProductNamesInScript(script, productInfo);
    if (generationMode === 'clone') {
      // Preserve reference speech/CTA slots. Unresolved factual or timing errors
      // are reported by the final gate instead of replacing the entire concept.
      script = stripStoryboardReferenceLeaks(script, forbiddenTerms, forbiddenIndustryTerms);
    }
    if (generationMode === 'material' && voiceoverMode === 'ai') {
      script = await finalizeMaterialScript({script,facts:confirmedProductEnterprise,language,infos:normalizedMaterialInfos.map(info=>({...info,name:info.name || ''}))});
    }
    let materialQualityV2: ReturnType<typeof assessScriptQualityV2> | null = null;
    if (generationMode === 'material') {
      // First make the configured CTA deterministic, then neutralize any scene
      // whose visual facts are not present in the selected-material evidence.
      // Restore product identity and the full CTA after neutralization because
      // either may have lived inside a replaced scene.
      script = ensureMaterialCanonicalCta(script, primaryCta, language, voiceoverMode !== 'none');
      materialQualityV2 = assessScriptQualityV2({
        script,
        productInfo,
        materialsText: structuredMaterials,
        materialInfos: normalizedMaterialInfos,
        primaryCta,
        targetBuyerText: audience,
      });
      script = ensureSelectedProductNamesInScript(materialQualityV2.script, productInfo);
      script = ensureMaterialCanonicalCta(script, primaryCta, language, voiceoverMode !== 'none');
    }
    const selectedNames = selectedProductNames(productInfo);
    // “秒”及时间戳是视频制作参数，不是产品主张，不能触发“资料外数字”风险。
    const unsupportedNumberClaims = unsupportedNumericClaims(script, confirmedProductEnterprise);
    const commercialAudit = auditCommercialClaims(script, confirmedProductEnterprise);
    const missingProduct = !String(productInfo || '').trim();
    const normalizedScriptIdentity = normalizeProductIdentity(script);
    const missingSelectedProduct = selectedNames.length > 0
      && selectedNames.some(name => {
        const normalizedName = normalizeProductIdentity(name);
        return normalizedName.length > 0 && !normalizedScriptIdentity.includes(normalizedName);
      });
    const speechIssues = storyboardSpeechIssues(script);
    const groundingIssues = generationMode === 'material'
      ? materialGroundingIssues(script, productInfo, structuredMaterials, audience)
      : [];
    const timelineIssues = generationMode === 'material'
      ? materialTimelineIssues(script, normalizedMaterialInfos)
      : [];
    const incompleteCloneStoryboard = generationMode === 'clone'
      && (!/环境[：:]/.test(script)
        || !/景别[：:]/.test(script)
        || !/运镜[：:]/.test(script)
        || !/构图[：:]/.test(script)
        || !/配乐[：:]/.test(script)
        || !/台词[：:]/.test(script));
    const genericCloneStoryboard = generationMode === 'clone'
      && /真实使用场景|痛点特写|买家最关心的结果|采购这类|先看真实使用效果|把「[^」]+」放到真实使用场景/.test(script);
    const strictCommercialIssues = strictCommercialPolicyIssues(script);
    const strategyIssues = strategyExecutionIssues(script);
    const duplicateStoryboardFields = isStructuredLockedDraft ? [] : duplicateStoryboardFieldIssues(script);
    const subtitleVoiceIssues = isStructuredLockedDraft
      ? []
      : subtitleVoiceMismatchIssues(
        script,
        generationMode === 'material' ? canonicalMaterialPrimaryCta(primaryCta, language) : '',
      );
    const productStoryboardFields = ['环境', '景别', '运镜', '构图', '镜头功能', '画面', '配乐', '台词', '字幕'];
    const productStoryboardBlocks = script.split(/(?=^\[[^\]\r\n]+\][ \t]*$)/m).filter(block => /^\[[^\]]+\]/.test(block.trim()));
    const incompleteProductStoryboard = generationMode === 'product' && !isStructuredLockedDraft
      && (productStoryboardBlocks.length < 3
        || productStoryboardBlocks.some(block => productStoryboardFields.some(field => !new RegExp(`^${field}[：:]`, 'm').test(block))));
    const invalidProductScript = generationMode === 'product'
      && (/人物说[：:][^\n]*(镜头|画面|字幕|参考节奏|展示卖点|制作)/.test(script)
        || /Scene N/.test(script));
    const duplicateProductScript = generationMode === 'product'
      && previousCloneScripts.length > 0
      && previousCloneScripts.some(previous => jaccardSimilarity(script, previous) > 0.82);
    const referenceLeakIssues = generationMode === 'clone'
      ? storyboardReferenceLeakIssues(script, forbiddenTerms, forbiddenIndustryTerms)
      : [];
    const leakedReference = referenceLeakIssues.length > 0;
    const mixedIssues = mixedStoryboardIssues(script, presentationMode, normalizedMaterialInfos);
    const validationIssues = [
      ...mixedIssues,
      missingProduct ? '缺少产品信息' : '',
      missingSelectedProduct ? `脚本未完整覆盖选定产品名称：${selectedNames.join('、')}` : '',
      unsupportedNumberClaims.length ? `出现产品资料未提供的数字：${unsupportedNumberClaims.join('、')}` : '',
      incompleteCloneStoryboard ? '爆款分镜缺少环境、景别、运镜、构图、配乐或台词字段' : '',
      incompleteProductStoryboard ? '产品分镜至少需要3段，且每段完整包含环境、景别、运镜、构图、镜头功能、画面、配乐、台词和字幕' : '',
      genericCloneStoryboard ? '爆款分镜包含不可执行的泛化镜头描述' : '',
      hasUnnaturalVoiceover(script) ? '口播过长或堆叠过多技术名词' : '',
      invalidProductScript ? '产品模式把制作指令写进了人物口播' : '',
      duplicateProductScript ? '本次脚本与上一版本过于相似，建议换一个创意切口' : '',
      ...referenceLeakIssues,
      ...speechIssues,
      ...groundingIssues,
      ...timelineIssues,
      ...commercialAudit.issues,
      ...strictCommercialIssues,
      ...strategyIssues,
      ...duplicateStoryboardFields,
      ...subtitleVoiceIssues,
      /参考节奏|Reference video|对标视频|基础要求|分析摘要|竞品识别|产品替换|参考爆款|成片目标|指定画风|核心情绪|行业锁定|结构迁移|不迁移行业|不继承原视频|企业产品组合|主推产品|<具体|不得|必须满足/.test(script) ? '脚本泄漏了生成规则或占位说明' : '',
      /不破|不裂|纹丝不动|吹不烂|保证|最快|最低价|全网|no tear|won'?t tear|never breaks?|unbreakable/i.test(script) ? '脚本包含绝对化或不可验证承诺' : '',
    ].filter(Boolean);
    const nonBlockingQualityIssues = Array.from(new Set(validationIssues.filter(issue =>
      isNonBlockingScriptQualityIssue(issue)
      || Boolean(durationFitWarning && /口播过长|台词过长|目标时长/.test(issue)),
    )));
    const materialStrictHardIssues = strictCommercialIssues.filter(issue => !isNonBlockingScriptQualityIssue(issue));
    const materialHardIssues = Array.from(new Set([
      ...mixedIssues,
      voiceoverMode !== 'none' && !spokenLanguageMatches(spokenText(script), language) ? '口播语言与所选目标语言不一致，请重新生成' : '',
      ...(materialQualityV2?.hardIssues || []),
      missingProduct ? '缺少产品信息' : '',
      missingSelectedProduct ? `脚本未完整覆盖选定产品名称：${selectedNames.join('、')}` : '',
      unsupportedNumberClaims.length ? `出现产品资料未提供的数字：${unsupportedNumberClaims.join('、')}` : '',
      ...groundingIssues,
      ...commercialAudit.issues,
      ...materialStrictHardIssues,
      /参考节奏|Reference video|对标视频|基础要求|分析摘要|竞品识别|产品替换|参考爆款|成片目标|指定画风|核心情绪|行业锁定|结构迁移|不迁移行业|不继承原视频|企业产品组合|主推产品|<具体|不得|必须满足/.test(script) ? '脚本泄漏了生成规则或占位说明' : '',
      /不破|不裂|纹丝不动|吹不烂|保证|最快|最低价|全网|no tear|won'?t tear|never breaks?|unbreakable/i.test(script) ? '脚本包含绝对化或不可验证承诺' : '',
    ].filter(Boolean)));
    const validationWarnings = generationMode === 'material'
      ? Array.from(new Set([
        durationFitWarning,
        storyboardFallbackWarning,
        ...(materialQualityV2?.warnings || []),
        ...strategyIssues,
        ...speechIssues,
        ...duplicateStoryboardFields,
        ...subtitleVoiceIssues,
        ...nonBlockingQualityIssues,
        hasUnnaturalVoiceover(script) ? '部分口播偏长或技术名词较密，建议成片前精简' : '',
        strictCommercialIssues.some(issue => /^已选择 AI 口播，但有效台词不足两段/.test(issue))
          ? '当前可用素材不足以承载两段有效口播，补充素材后可继续完善'
          : '',
        commercialAudit.fieldsToConfirm.length
          ? `商业字段待企业中心确认：${commercialAudit.fieldsToConfirm.join('、')}`
          : '',
      ].filter(Boolean)))
      : Array.from(new Set([durationFitWarning, storyboardFallbackWarning, ...nonBlockingQualityIssues].filter(Boolean)));
    const hardValidationIssues = generationMode === 'material'
      ? materialHardIssues
      : validationIssues.filter(issue => !nonBlockingQualityIssues.includes(issue));
    const shouldBlockScript = hardValidationIssues.length > 0;
    if (shouldBlockScript) {
      console.warn('[studio] script rejected:', hardValidationIssues.join(' | ') || 'unsafe_script');
      res.status(422).json({
        ok: false,
        source: 'ai_rejected',
        provenance: 'ai_rejected',
        publishable: false,
        code: 'SCRIPT_QUALITY_BLOCKED',
        error: hardValidationIssues[0] || '脚本未通过安全与可执行性检查，请补充产品资料或重新生成。',
        script,
        qualityStatus: 'rejected',
        qualityChecks: {
          materialGrounded: groundingIssues.length === 0 && mixedIssues.length === 0,
          presentationGrounded: mixedIssues.length === 0,
          timelineGrounded: timelineIssues.length === 0,
          productGrounded: !missingProduct && !missingSelectedProduct && unsupportedNumberClaims.length === 0,
          dialogueFits: speechIssues.length === 0,
          structurallyComplete: !incompleteCloneStoryboard && !incompleteProductStoryboard,
          ...(materialQualityV2 ? { materialCoverage: materialQualityV2.materialCoverage } : {}),
        },
        validationIssues: hardValidationIssues,
        validationWarnings,
        fieldsToConfirm: commercialAudit.fieldsToConfirm,
      });
      return;
    }
    const qualityStatus = generationMode === 'material'
      ? materialQualityV2?.qualityStatus === 'needs_material'
        ? 'needs_material'
        : validationWarnings.length
          ? 'warning'
          : 'passed'
      : validationWarnings.length
        ? 'warning'
        : 'passed';
    res.json({
      ok: true,
      source: 'ai',
      provenance: 'ai',
      publishable: commercialAudit.fieldsToConfirm.length === 0,
      script,
      qualityStatus,
      qualityChecks: {
        materialGrounded: groundingIssues.length === 0 && mixedIssues.length === 0,
          presentationGrounded: mixedIssues.length === 0,
        timelineGrounded: timelineIssues.length === 0,
        productGrounded: !missingProduct && !missingSelectedProduct && unsupportedNumberClaims.length === 0,
        dialogueFits: speechIssues.length === 0,
        structurallyComplete: !incompleteCloneStoryboard && !incompleteProductStoryboard,
        ...(materialQualityV2 ? { materialCoverage: materialQualityV2.materialCoverage } : {}),
      },
      validationIssues: [],
      validationWarnings,
      fieldsToConfirm: commercialAudit.fieldsToConfirm,
    });
  } catch (error) {
    const rawError = String(error instanceof Error ? error.message : error);
    const upstreamQuota = /429|RESOURCE_EXHAUSTED|prepayment credits|quota|billing/i.test(rawError);
    const upstreamAuth = /401|403|api.?key|unauthorized|permission/i.test(rawError);
    console.warn('[studio] script generation failed:', rawError.slice(0, 500));
    const publicFailureReason = /429|RESOURCE_EXHAUSTED|prepayment credits|quota|billing/i.test(rawError)
      ? '上游模型额度不足，未生成脚本。请更换模型 Key 或稍后重试。'
      : /401|403|api.?key|unauthorized|permission/i.test(rawError)
        ? '上游模型授权暂不可用，未生成脚本。请检查模型 Key 或权限。'
        : /timeout|timed out|超时|503|502|504|UNAVAILABLE/i.test(rawError)
          ? '上游模型暂时繁忙，未生成脚本。请稍后重试。'
          : '上游模型生成失败，未生成脚本。请补充素材/产品信息后重试。';
    res.status(502).json({
      ok: false,
      source: 'ai_failed',
      provenance: 'ai_failed',
      publishable: false,
      script: '',
      qualityStatus: 'failed',
      code: upstreamQuota ? 'UPSTREAM_QUOTA_EXHAUSTED' : upstreamAuth ? 'UPSTREAM_AUTH_UNAVAILABLE' : 'UPSTREAM_GENERATION_FAILED',
      retryable: !upstreamQuota && !upstreamAuth && /timeout|timed out|超时|503|502|504|UNAVAILABLE/i.test(rawError),
      error: publicFailureReason,
      validationIssues: [publicFailureReason],
    });
  }
});

/* ── ⑤ 封面标题候选 ────────────────────────────────────────────────────── */
// POST /studio/covers  Body: { script?, productInfo?, language? }
studioRouter.post('/covers', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { script = '', productInfo = '', language = 'en', provider, tone = '' } = req.body ?? {};
  const lang = langName(language);
  const providerOpt: 'qwen' = 'qwen';
  const enterprise = await enterpriseCtx();
  if (!hasConfirmedEnterpriseFacts(enterprise)) {
    res.status(422).json({
      ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
      code: 'ENTERPRISE_PROFILE_REQUIRED', covers: [],
      error: '企业中心尚无已确认资料，不能生成可用于发布的封面标题。',
      fieldsToConfirm: ['企业产品资料'],
    });
    return;
  }
  if (!String(productInfo || '').trim()) {
    res.status(422).json({
      ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
      code: 'ENTERPRISE_PRODUCT_REQUIRED', covers: [], fieldsToConfirm: ['企业产品资料'],
      error: '请先选择企业中心已确认产品；未调用模型生成封面标题。',
    });
    return;
  }
  const productEnterprise = confirmedEnterpriseContextForProduct(productInfo, enterprise);
  const unconfirmedProductFields = unconfirmedEnterpriseProductFields(productInfo, enterprise);
  if (unconfirmedProductFields.length) {
    res.status(422).json({
      ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
      code: 'UNCONFIRMED_ENTERPRISE_PRODUCT_INPUT', covers: [], fieldsToConfirm: unconfirmedProductFields,
      error: '封面请求中的产品资料无法在当前企业中心已确认资料中核对。',
    });
    return;
  }

  const prompt = `Generate 3 punchy ${lang} video cover titles (max 6 words each) for an overseas e-commerce short video.
Context — product: ${productInfo || '(see enterprise profile)'} ; tone: ${tone || '(fit platform)'} ; script: ${script.slice(0, 300)}
Use only product categories, facts, specifications and claims explicitly present in the context. If context is sparse, use a neutral product-demo title instead of guessing.
Return ONLY a JSON array of 3 strings. No other text.`;

  try {
    const text = await callLLM(prompt, { backend: providerOpt, systemPrompt: productEnterprise });
    const arr = extractJSON<string[]>(text);
    if (arr && arr.length) {
      const covers = arr.slice(0, 3).map(String).map(item => item.trim()).filter(Boolean);
      const audit = auditCommercialClaims(covers.join('\n'), productEnterprise);
      if (audit.issues.length || audit.fieldsToConfirm.length) {
        res.status(422).json({
          ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
          code: audit.issues.length ? 'UNVERIFIED_COMMERCIAL_CLAIMS' : 'COMMERCIAL_FIELDS_REQUIRE_CONFIRMATION',
          covers: [], fieldsToConfirm: audit.fieldsToConfirm,
          error: audit.issues.length
            ? `封面标题包含企业中心未确认的商业声明：${audit.issues.join('；')}`
            : `封面标题仍有待确认商业字段：${audit.fieldsToConfirm.join('、')}`,
        });
        return;
      }
      res.json({ ok: true, source: 'ai', provenance: 'ai', publishable: true, qualityStatus: 'passed', covers });
      return;
    }
    throw new Error('parse');
  } catch (error) {
    res.status(502).json({ ...upstreamGenerationFailure(error, '封面标题'), covers: [] });
  }
});

/* ── ⑦ 发布文案 + 话题标签 ─────────────────────────────────────────────── */
// POST /studio/fb-poster  Body: { mode, productInfo, platform, ratio, posterStyle, language, materials? }
studioRouter.post('/fb-poster', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const {
    mode = 'product',
    productInfo = '',
    platform = 'facebook',
    ratio = '1:1',
    posterStyle = 'oem-factory',
    language = 'en',
    provider,
    materials = [],
    referenceNotes = '',
  } = req.body ?? {};
  const providerOpt: 'qwen' = 'qwen';
  const lang = langName(language);
  const enterprise = await enterpriseCtx();
  if (!hasConfirmedEnterpriseFacts(enterprise)) {
    res.status(422).json({
      ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
      code: 'ENTERPRISE_PROFILE_REQUIRED', caption: '', hashtags: [], fieldsToConfirm: ['企业产品与商业能力资料'],
      error: '企业中心尚无已确认资料，不能生成商业海报文案。',
    });
    return;
  }
  if (!String(productInfo || '').trim()) {
    res.status(422).json({
      ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
      code: 'ENTERPRISE_PRODUCT_REQUIRED', caption: '', hashtags: [], fieldsToConfirm: ['企业产品资料'],
      error: '请先选择企业中心已确认产品；未调用模型生成海报文案。',
    });
    return;
  }
  const productEnterprise = confirmedEnterpriseContextForProduct(productInfo, enterprise);
  const unconfirmedProductFields = unconfirmedEnterpriseProductFields(productInfo, enterprise);
  if (unconfirmedProductFields.length) {
    res.status(422).json({
      ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
      code: 'UNCONFIRMED_ENTERPRISE_PRODUCT_INPUT', caption: '', hashtags: [], fieldsToConfirm: unconfirmedProductFields,
      error: '海报请求中的产品资料无法在当前企业中心已确认资料中核对。',
    });
    return;
  }
  const materialLines = Array.isArray(materials)
    ? materials.slice(0, 8).map((item: any, index: number) => `${index + 1}. ${String(item?.name || item || '').slice(0, 120)}${item?.role ? ` (${item.role})` : ''}`).join('\n')
    : '';
  const modeGuide = mode === 'clone'
    ? [
        'First modularly deconstruct the reference poster into reusable layout modules: headline zone, product hero, background atmosphere, evidence strip, badges, process row, category cards, CTA/bottom bar, and caption framework.',
        'Then map each reusable module to verified local/enterprise assets: replace competitor product with our product photo, reuse only generic background/composition style, omit any evidence module that has no matching verified asset, and rebuild copy from verified enterprise/product info.',
        'Do not copy competitor brand, logo, certifications, price, MOQ, lead time, export country, factory qualification, or any unverified commercial promise.',
      ].join(' ')
    : mode === 'material'
      ? 'Use selected materials only for directly visible product appearance and composition. Material names or folders do not prove factory ownership, certification, export, delivery, pricing, MOQ, or customization capability.'
      : 'Use enterprise profile and product info as the primary source.';

  const prompt = `You are a senior B2B social media creative director. Never assume that the company is a factory, exporter, OEM/ODM supplier, private-label provider, or certified business unless the authenticated enterprise profile explicitly says so.
Create a structured poster brief and ${platform} caption in ${lang}.

Generation channel: ${mode}
Channel rule: ${modeGuide}
Poster style: ${posterStyle === 'oem-factory' ? 'structured B2B product-information layout (the legacy id is visual only; it does not authorize any OEM or factory claim)' : posterStyle}
Canvas ratio: ${ratio}
Selected product context (selection only; authenticated enterprise profile remains the sole source of commercial facts):
${productInfo || '(no product selected)'}

Authenticated enterprise profile (sole commercial fact source):
${productEnterprise}

Selected material references:
${materialLines || '(none selected yet)'}

Reference / inspiration notes:
${String(referenceNotes || '').slice(0, 1500) || '(none)'}

Hard rules:
- AI may optimize expression, but must not invent commercial promises.
- MOQ, certifications, lead time, price, export countries, factory qualifications must come from product / enterprise info or be placed in fieldsToConfirm.
- If Generation channel is clone, output a module-level deconstruction and local asset matching plan. The final poster must be a new composition using our product/materials, not a copy of the competitor poster.
- Poster text should be concise enough for a dense B2B product-information poster.
- Use exact English text for poster fields when language is English.
- Return ONLY valid JSON. No markdown.

Schema:
{
  "layoutModules": [
    {
      "module": "headline zone / product hero / background / verified evidence / badges / process row / category cards / CTA bar",
      "referencePattern": "what to reuse from the viral poster structure or style",
      "localAssetRole": "product photo / factory image / packaging image / certificate image / scene image / brand visual / none",
      "replacementInstruction": "how to replace competitor content with our verified assets and copy"
    }
  ],
  "poster": {
    "headline": "string",
    "subheadline": "string",
    "originBadge": "string",
    "trustBadges": ["only an exact certification from the authenticated profile, otherwise empty"],
    "sellingPoints": ["only an exact verified product fact"],
    "process": ["only steps explicitly supported by the authenticated profile, otherwise empty"],
    "categories": [{"name":"verified product name or category","description":"verified neutral description"}],
    "bottomBar": ["only verified facts, otherwise empty"],
    "cta": "string"
  },
  "caption": "3 short paragraphs with emoji hooks and CTA",
  "hashtags": ["verified product/category terms only; capability tags such as OEM or private label require profile evidence"],
  "commentCta": "string",
  "dmOpening": "string",
  "fieldsToConfirm": ["every desired but missing commercial field; do not put its value elsewhere"],
  "imagePrompt": "detailed prompt for a no-extra-text B2B product poster image model; include layoutModules as composition guidance, include all poster text exactly as above, mention product replacement, background/style reuse, verified local material roles, sections, and layout"
}`;

  const backends = [providerOpt] as const;
  const failures: string[] = [];
  for (const backend of backends) {
    try {
      const text = await callLLM(prompt, { backend, systemPrompt: productEnterprise });
      const obj = extractJSON<any>(text);
      if (obj?.poster?.headline && obj?.caption) {
        const normalized = {
          ...obj,
          poster: normalizePosterBrief(obj.poster),
          caption: String(obj.caption || ''),
          commentCta: String(obj.commentCta || ''),
          dmOpening: String(obj.dmOpening || ''),
          imagePrompt: String(obj.imagePrompt || ''),
        };
        const audit = auditCommercialClaims(userFacingPosterText(normalized), productEnterprise);
        const fieldsToConfirm = confirmationFields([
          ...(Array.isArray(obj.fieldsToConfirm) ? obj.fieldsToConfirm : []),
          ...audit.fieldsToConfirm,
        ]);
        if (audit.issues.length) {
          res.status(422).json({
            ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
            code: 'UNVERIFIED_COMMERCIAL_CLAIMS', caption: '', hashtags: [], fieldsToConfirm,
            error: `海报草稿包含企业中心未确认的商业声明：${audit.issues.join('；')}`,
          });
          return;
        }
        const publishable = fieldsToConfirm.length === 0;
        res.json({
          ok: true,
          source: 'ai',
          provenance: 'ai',
          publishable,
          qualityStatus: publishable ? 'passed' : 'needs_confirmation',
          provider: backend,
          layoutModules: Array.isArray(obj.layoutModules) ? obj.layoutModules.slice(0, 12) : [],
          poster: normalized.poster,
          caption: normalized.caption,
          hashtags: Array.isArray(obj.hashtags) ? obj.hashtags.map(String).slice(0, 10) : [],
          commentCta: normalized.commentCta,
          dmOpening: normalized.dmOpening,
          fieldsToConfirm,
          imagePrompt: normalized.imagePrompt,
        });
        return;
      }
      failures.push(`${backend}: parse_failed`);
    } catch (err: any) {
      failures.push(`${backend}: ${String(err?.message || err).slice(0, 180)}`);
    }
  }
  console.warn('[studio] fb-poster generation failed:', failures.join(' | '));
  res.status(502).json({
    ...upstreamGenerationFailure(failures[0] || 'poster generation failed', '海报文案'),
    caption: '', hashtags: [], fieldsToConfirm: [],
  });
});

// POST /studio/lead-content-package
// 基于竞品公开图文证据 + 企业中心真实资料，生成“吸引—解释—信任”三条连续获客内容。
studioRouter.post('/lead-content-package', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { productInfo = '', platform = 'instagram', language = 'en', ratio = '4:5', referenceEvidence = null, referenceTitle = '' } = req.body ?? {};
  if (!referenceEvidence?.observedFacts?.length) { res.status(400).json({ error: '缺少可信的竞品逐图证据，不能生成获客内容包' }); return; }
  const enterprise = await enterpriseCtx();
  if (!hasConfirmedEnterpriseFacts(enterprise)) {
    res.status(422).json({
      ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
      code: 'ENTERPRISE_PROFILE_REQUIRED', strategySummary: '', referenceModulesUsed: [], items: [],
      fieldsToConfirm: ['企业产品与商业能力资料'], error: '企业中心尚无已确认资料，不能生成获客内容包。',
    });
    return;
  }
  if (!String(productInfo || '').trim()) {
    res.status(422).json({
      ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
      code: 'ENTERPRISE_PRODUCT_REQUIRED', strategySummary: '', referenceModulesUsed: [], items: [], fieldsToConfirm: ['企业产品资料'],
      error: '请先选择企业中心已确认产品；未调用模型生成获客内容包。',
    });
    return;
  }
  const productEnterprise = confirmedEnterpriseContextForProduct(productInfo, enterprise);
  const unconfirmedProductFields = unconfirmedEnterpriseProductFields(productInfo, enterprise);
  if (unconfirmedProductFields.length) {
    res.status(422).json({
      ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
      code: 'UNCONFIRMED_ENTERPRISE_PRODUCT_INPUT', strategySummary: '', referenceModulesUsed: [], items: [],
      fieldsToConfirm: unconfirmedProductFields, error: '获客内容包请求中的产品资料无法在当前企业中心已确认资料中核对。',
    });
    return;
  }
  const prompt = `你是外贸 B2B 社媒获客内容总监。请基于企业真实资料和竞品公开图文的结构化证据，生成三条连续图文内容：吸引目标买家、解释合作能力、建立供应商信任。

企业资料（唯一商业事实来源）：
${productEnterprise || '(企业中心资料为空)'}

当前选择产品：
${String(productInfo || '(未选择产品)').slice(0, 5000)}

竞品标题（仅用于定位参考，不得复制）：${String(referenceTitle || '').slice(0, 300)}
竞品证据：
${JSON.stringify(referenceEvidence).slice(0, 12000)}

平台：${platform}；语言：${langName(language)}；比例：${ratio}

硬规则：
- 只复用竞品的通用布局、信息层级、色彩关系和轮播功能；禁止复制竞品品牌、Logo、产品、包装、联系方式和原句。
- MOQ、价格、认证、交期、出口国家、工厂年限等只能来自企业资料；缺失时写入 fieldsToConfirm，不能出现在 poster 或 caption。
- 三条内容必须分别服务 buyer_attention、capability_explanation、supplier_trust，不是三张相似 A/B 图。
- 每条建议 5 张轮播，每张都必须有明确 role、headline、body、assetRole；文字简洁。
- 输出合法 JSON，不要 markdown。

Schema:
{
  "strategySummary":"string",
  "referenceModulesUsed":[{"module":"string","evidence":"string","application":"string"}],
  "items":[{
    "role":"buyer_attention|capability_explanation|supplier_trust",
    "title":"string",
    "objective":"string",
    "slides":[{"index":1,"role":"attention|product|detail|process|proof|cta","headline":"string","body":"string","assetRole":"product image|factory image|certificate image|packaging image|scene image|brand visual|none"}],
    "caption":"string",
    "hashtags":["string"],
    "cta":"string",
    "dmOpening":"string",
    "imagePrompt":"string"
  }],
  "fieldsToConfirm":["string"]
}`;
  const failures: string[] = [];
  for (const backend of ['qwen'] as const) {
    try {
      const text = await callLLM(prompt, { backend, systemPrompt: productEnterprise || undefined });
      const parsed = extractJSON<any>(text);
      if (Array.isArray(parsed?.items) && parsed.items.length >= 3) {
        const items = parsed.items.slice(0, 3);
        const audit = auditCommercialClaims(userFacingLeadPackageText({ ...parsed, items }), productEnterprise);
        const fieldsToConfirm = confirmationFields([
          ...(Array.isArray(parsed.fieldsToConfirm) ? parsed.fieldsToConfirm : []),
          ...audit.fieldsToConfirm,
        ]);
        if (audit.issues.length) {
          res.status(422).json({
            ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
            code: 'UNVERIFIED_COMMERCIAL_CLAIMS', strategySummary: '', referenceModulesUsed: [], items: [], fieldsToConfirm,
            error: `获客内容包包含企业中心未确认的商业声明：${audit.issues.join('；')}`,
          });
          return;
        }
        const publishable = fieldsToConfirm.length === 0;
        res.json({
          ok: true, source: 'ai', provenance: 'ai', publishable,
          qualityStatus: publishable ? 'passed' : 'needs_confirmation', provider: backend,
          strategySummary: String(parsed.strategySummary || ''),
          referenceModulesUsed: Array.isArray(parsed.referenceModulesUsed) ? parsed.referenceModulesUsed.slice(0, 12) : [],
          items,
          fieldsToConfirm,
        });
        return;
      }
      failures.push(`${backend}: parse_failed`);
    } catch (error) { failures.push(`${backend}: ${String((error as Error)?.message || error).slice(0, 180)}`); }
  }
  res.status(502).json({
    ...upstreamGenerationFailure(failures[0] || 'lead content generation failed', '获客内容包'),
    strategySummary: '', referenceModulesUsed: [], items: [], fieldsToConfirm: [], details: failures,
  });
});

// POST /studio/fb-poster/render  Body: { poster, caption, imagePrompt, ratio, materialIds? }
studioRouter.post('/fb-poster/render', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const {
    poster = null,
    imagePrompt = '',
    ratio = '1:1',
    materialIds = [],
  } = req.body ?? {};
  const enterprise = await enterpriseCtx();
  if (!hasConfirmedEnterpriseFacts(enterprise)) {
    res.status(422).json({
      ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
      code: 'ENTERPRISE_PROFILE_REQUIRED', error: '企业中心尚无已确认资料，不能生成商业海报图片。',
      fieldsToConfirm: ['企业产品与商业能力资料'],
    });
    return;
  }
  const normalizedPoster = normalizePosterBrief(poster || {});
  const commercialAudit = auditCommercialClaims(userFacingPosterText({ poster: normalizedPoster, imagePrompt }), enterprise);
  if (commercialAudit.issues.length) {
    res.status(422).json({
      ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
      code: 'UNVERIFIED_COMMERCIAL_CLAIMS', error: `海报图片输入包含企业中心未确认的商业声明：${commercialAudit.issues.join('；')}`,
      fieldsToConfirm: commercialAudit.fieldsToConfirm,
    });
    return;
  }
  const headline = normalizedPoster.headline || 'AI 图文海报';
  const references = await resolveReferenceImages(materialIds, tenantId);
  const prompt = [
    String(imagePrompt || '').trim(),
    'Generate one finished high-end B2B social media product poster. Do not imply OEM/ODM, export, factory, certification, pricing, MOQ, lead-time, delivery, or customization capabilities unless they appear verbatim in the verified JSON.',
    `Use this exact poster JSON as the content source:\n${JSON.stringify(normalizedPoster, null, 2)}`,
    `Aspect ratio: ${ratio}.`,
    'Use only the sections that contain verified JSON content. Empty badge, proof, process, category, or CTA sections must stay absent rather than being filled with generic marketing claims.',
    'All visible text must match the JSON exactly. Avoid extra fake certifications, fake numbers, fake flags, watermarks, or unreadable tiny claims.',
    references.length
      ? `Use the ${references.length} owned reference image(s) only for product appearance and directly visible environment guidance. Do not infer factory ownership or operational capability from an image.`
      : 'No reference image was provided; create a neutral product-only studio composition. Do not add a factory, warehouse, certificate, flag, packaging claim, or operational proof scene.',
  ].filter(Boolean).join('\n\n');

  try {
    const generated = await generatePosterImage({ prompt, ratio: String(ratio || '1:1'), references });
    const material = await createGeneratedImageMaterial({
      title: `AI 图文海报 · ${headline}`.slice(0, 120),
      bytes: generated.bytes,
      mimeType: generated.mimeType,
      source: generated.source,
      tenantId,
    });
    const responseMaterial = await materialResponse(material, tenantId);
    res.json({
      ok: true,
      source: generated.source,
      model: generated.model,
      url: responseMaterial.url,
      material: responseMaterial,
      references: references.length,
    });
  } catch (err: any) {
    res.status(502).json(upstreamGenerationFailure(err, '海报图片'));
  }
});

// POST /studio/caption  Body: { script?, productInfo?, platform?, language? }
studioRouter.post('/caption', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { script = '', productInfo = '', platform = 'tiktok', language = 'en', provider, audience = '', sellingPoints = '', tone = '' } = req.body ?? {};
  const lang = langName(language);
  const providerOpt: 'qwen' = 'qwen';
  const enterprise = await enterpriseCtx();
  if (!hasConfirmedEnterpriseFacts(enterprise)) {
    res.status(422).json({
      ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
      code: 'ENTERPRISE_PROFILE_REQUIRED', caption: '', hashtags: [], fieldsToConfirm: ['企业产品资料'],
      error: '企业中心尚无已确认资料，不能生成可发布配文。',
    });
    return;
  }
  const productEnterprise = confirmedEnterpriseContextForProduct(productInfo, enterprise);
  const unconfirmedProductFields = unconfirmedEnterpriseProductFields(productInfo, enterprise);
  const sellingPointKey = normalizedFactValue(String(sellingPoints || ''));
  if (sellingPointKey && !normalizedFactValue(productEnterprise).includes(sellingPointKey)) unconfirmedProductFields.push('创作卖点');
  if (unconfirmedProductFields.length) {
    res.status(422).json({
      ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
      code: 'UNCONFIRMED_ENTERPRISE_PRODUCT_INPUT', caption: '', hashtags: [], fieldsToConfirm: Array.from(new Set(unconfirmedProductFields)),
      error: '配文请求中的产品或卖点资料无法在当前企业中心已确认资料中核对。',
    });
    return;
  }

  const prompt = `Write a ${platform} post caption in ${lang} for this overseas e-commerce video.
Product: ${productInfo || '(see enterprise profile)'} ; audience: ${audience || '(infer)'} ; selling points: ${sellingPoints || '(infer)'} ; tone: ${tone || '(fit platform)'} ; script: ${script.slice(0, 300)}
Use only facts and product terms explicitly present above. Never invent a product category, certification, price, MOQ, shipping promise, lead time, geography or performance claim.
Return ONLY JSON: { "caption": string (1-2 sentences, may include 1-2 emojis), "hashtags": string[] (5-8 trending tags, no # prefix) }`;

  try {
    const text = await callLLM(prompt, { backend: providerOpt, systemPrompt: productEnterprise });
    const obj = extractJSON<{ caption: string; hashtags: string[] }>(text);
    if (obj?.caption) {
      const caption = String(obj.caption || '').trim();
      const hashtags = Array.isArray(obj.hashtags) ? obj.hashtags.map(String).slice(0, 8) : [];
      const audit = auditCommercialClaims([caption, ...hashtags].join('\n'), productEnterprise);
      if (audit.issues.length || audit.fieldsToConfirm.length) {
        res.status(422).json({
          ok: false, source: 'ai_rejected', provenance: 'ai_rejected', publishable: false, qualityStatus: 'rejected',
          code: audit.issues.length ? 'UNVERIFIED_COMMERCIAL_CLAIMS' : 'COMMERCIAL_FIELDS_REQUIRE_CONFIRMATION',
          caption: '', hashtags: [], fieldsToConfirm: audit.fieldsToConfirm,
          error: audit.issues.length
            ? `发布配文包含企业中心未确认的商业声明：${audit.issues.join('；')}`
            : `发布配文仍有待确认商业字段：${audit.fieldsToConfirm.join('、')}`,
        });
        return;
      }
      res.json({ ok: true, source: 'ai', provenance: 'ai', publishable: true, qualityStatus: 'passed', caption, hashtags });
      return;
    }
    throw new Error('parse');
  } catch (error) {
    res.status(502).json({ ...upstreamGenerationFailure(error, '发布配文'), caption: '', hashtags: [], fieldsToConfirm: [] });
  }
});

/* ── 文本翻译（默认译成简体中文，给用户确认外语文案） ───────────────────── */
function translationTimeout(value: string | undefined, fallbackMs: number, minimumMs: number) {
  const parsed = Number(value ?? fallbackMs);
  return Number.isFinite(parsed) ? Math.max(minimumMs, parsed) : fallbackMs;
}

function createTranslationDeadline(req: Request, res: Response, timeoutMs: number) {
  const deadline = createLinkedAbort({ timeoutMs, label: 'translation request' });
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    deadline.cleanup();
    req.off('aborted', onClientAbort);
    res.off('finish', onFinish);
    res.off('close', onClose);
  };
  const onClientAbort = () => deadline.abort(new Error('translation client disconnected'));
  const onFinish = () => cleanup();
  const onClose = () => {
    if (!res.writableEnded) deadline.abort(new Error('translation client disconnected'));
    cleanup();
  };
  req.once('aborted', onClientAbort);
  res.once('finish', onFinish);
  res.once('close', onClose);
  return deadline;
}

type TimestampedTranslationCue = { timestamp: string; text: string };
const TRANSLATION_CUE_LINE_RE = /^\s*(\[[^\]]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^\]]*\])\s*(.+?)\s*$/i;

export function timestampedTranslationCues(value: string): TimestampedTranslationCue[] {
  return String(value || '')
    .split(/\n+/)
    .map(line => line.match(TRANSLATION_CUE_LINE_RE))
    .filter((match): match is RegExpMatchArray => Boolean(match?.[1] && match?.[2]))
    .map(match => ({ timestamp: match[1]!.trim(), text: match[2]!.trim() }))
    .filter(cue => cue.text.length > 0);
}

/**
 * A localized voiceover is complete only when every source cue has one target
 * cue. Rebuild with the source timestamps so models cannot silently merge,
 * omit or rewrite time ranges.
 */
export function normalizeCompleteTimestampTranslation(source: string, translated: string, targetCode: string): string {
  const sourceCues = timestampedTranslationCues(source);
  if (!sourceCues.length) return String(translated || '').trim();
  const translatedCues = timestampedTranslationCues(translated);
  if (translatedCues.length !== sourceCues.length) return '';
  const targetTexts = translatedCues.map(cue => cue.text.replace(/^[-*•]\s*/, '').trim());
  if (targetTexts.some(text => !text || /translation unavailable|无法翻译|不能翻译|作为AI|Here is|```/i.test(text))) return '';
  if (targetCode !== 'zh' && targetTexts.some(text => {
    const hanCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const letterCount = (text.match(/\p{L}/gu) || []).length;
    return hanCount >= 6 && hanCount / Math.max(1, letterCount) > 0.45;
  })) return '';
  const distinctSource = new Set(sourceCues.map(cue => cue.text.replace(/\s+/g, '').toLowerCase())).size;
  const distinctTarget = new Set(targetTexts.map(text => text.replace(/\s+/g, '').toLowerCase())).size;
  if (sourceCues.length > 1 && distinctSource > 1 && distinctTarget === 1) return '';
  return sourceCues.map((cue, index) => `${cue.timestamp} ${targetTexts[index]}`).join('\n');
}

function translationLinesFromUnknown(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string' || typeof item === 'number') return String(item).trim();
      if (item && typeof item === 'object') {
        const row = item as Record<string, unknown>;
        return String(row.text ?? row.translation ?? row.content ?? row.value ?? '').trim();
      }
      return '';
    }).filter(Boolean);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['lines', 'translations', 'translation', 'text', 'content', 'result', 'output']) {
      if (record[key] !== undefined) {
        const nested = translationLinesFromUnknown(record[key]);
        if (nested.length) return nested;
      }
    }
    return [];
  }
  const text = String(value ?? '').trim();
  if (!text) return [];
  const parsed = extractJSON<unknown>(text);
  if (parsed && parsed !== value) {
    const nested = translationLinesFromUnknown(parsed);
    if (nested.length) return nested;
  }
  return text.split(/\n+/).map(line => line
    .replace(/^\s*(?:[-*•]|\d+[.)．、])\s*/, '')
    .trim()).filter(Boolean);
}

/**
 * Accept the common response shapes returned by Qwen (timestamped text,
 * {lines:[...]}, an array, or a newline list) and rebuild the exact source
 * timeline before validating it. This keeps strict cue completeness without
 * rejecting an otherwise valid translation solely because of JSON shape.
 */
export function normalizeTimestampTranslationValue(source: string, value: unknown, targetCode: string): string {
  const sourceCues = timestampedTranslationCues(source);
  if (!sourceCues.length) return translationLinesFromUnknown(value).join('\n').trim();
  if (typeof value === 'string') {
    const direct = normalizeCompleteTimestampTranslation(source, value, targetCode);
    if (direct) return direct;
  }
  const lines = translationLinesFromUnknown(value);
  if (lines.length !== sourceCues.length) return '';
  const rebuilt = sourceCues.map((cue, index) => {
    const line = String(lines[index] || '').replace(/^\s*\[[^\]]+\]\s*/, '').trim();
    return `${cue.timestamp} ${line}`;
  }).join('\n');
  return normalizeCompleteTimestampTranslation(source, rebuilt, targetCode);
}

function translationValueForLanguage(value: Record<string, unknown>, code: string): unknown {
  const containers: Record<string, unknown>[] = [value];
  if (value.translations && typeof value.translations === 'object' && !Array.isArray(value.translations)) {
    containers.push(value.translations as Record<string, unknown>);
  }
  for (const container of containers) {
    const languageKey = Object.keys(container).find(key => key.toLowerCase() === code.toLowerCase()
      || key.toLowerCase() === langName(code).toLowerCase());
    if (languageKey) return container[languageKey];
  }
  if (Array.isArray(value.translations)) {
    const row = value.translations.find(item => item && typeof item === 'object'
      && [code.toLowerCase(), langName(code).toLowerCase()].includes(String((item as Record<string, unknown>).language ?? (item as Record<string, unknown>).code ?? '').toLowerCase())) as Record<string, unknown> | undefined;
    if (row) return row.lines ?? row.translation ?? row.text ?? row.content;
  }
  return undefined;
}

// POST /studio/translate  Body: { text, target?, source? }
studioRouter.post('/translate', async (req, res) => {
  const { text = '', target = 'zh' } = req.body ?? {};
  const src = String(text).trim();
  if (!src) { res.json({ ok: true, source: 'noop', text: '' }); return; }
  const targetLang = langName(target);

  const prompt = `Translate the following voiceover lines into ${targetLang}.
Rules:
- Preserve every timestamp label exactly, such as [0-3s].
- Translate only the spoken text after each timestamp.
- If a line contains production labels such as 画面, 字幕, Shot, Camera, Visual, Subtitle, or note text, ignore those labels and translate only the actual spoken voiceover.
- Keep one output line per input line.
- Do not merge lines, repeat lines, add quotes, or add explanations.
- Do not leave any Chinese text in the output unless the target language is Chinese.
- Do not add new product claims, MOQ, certifications, pricing, shipping promises, or CTA lines that are not present in the source line.
- If the input has no timestamp, still translate line by line.
Return ONLY the translated lines.
Text: ${src}`;

  const deadline = createTranslationDeadline(req, res, translationTimeout(process.env.STUDIO_TRANSLATION_TOTAL_TIMEOUT_MS, 65_000, 15_000));
  const providerTimeoutMs = translationTimeout(process.env.STUDIO_TRANSLATION_PROVIDER_TIMEOUT_MS, 28_000, 5_000);
  try {
    const sourceCues = timestampedTranslationCues(src);
    const first = await callLLM(prompt, { backend: 'qwen', model: 'qwen-plus', signal: deadline.signal, timeoutMs: providerTimeoutMs });
    let out = sourceCues.length
      ? normalizeTimestampTranslationValue(src, first, String(target || 'zh'))
      : first.trim();
    if (!out && sourceCues.length) {
      const indexedPrompt = `Translate every numbered spoken line into ${targetLang}. Return ONLY valid JSON {"lines":["translation 1","translation 2"]}. The lines array must contain exactly ${sourceCues.length} non-empty strings in the same order. Never merge, omit, summarize or repeat a line. Do not include timestamps inside the strings. Do not add claims or explanations.\n\n${sourceCues.map((cue, index) => `${index + 1}. ${cue.text}`).join('\n')}`;
      const repaired = await callLLM(indexedPrompt, { backend: 'qwen', model: 'qwen-plus', signal: deadline.signal, timeoutMs: providerTimeoutMs });
      const parsed = extractJSON<{ lines?: unknown[] } | unknown[]>(repaired);
      const lines = Array.isArray(parsed) ? parsed : parsed?.lines;
      if (Array.isArray(lines) && lines.length === sourceCues.length) {
        const rebuilt = sourceCues.map((cue, index) => `${cue.timestamp} ${String(lines[index] || '').trim()}`).join('\n');
        out = normalizeTimestampTranslationValue(src, rebuilt, String(target || 'zh'));
      }
    }
    if (!out.trim()) throw new Error('qwen returned an incomplete line-by-line translation');
    if (!res.writableEnded && !res.destroyed) res.json({ ok: true, source: 'ai', text: out.trim() });
  } catch (error) {
    if (!res.writableEnded && !res.destroyed) {
      res.status(502).json({
        ok: false,
        source: 'ai_failed',
        provenance: 'ai_failed',
        publishable: false,
        text: '',
        error: deadline.timedOut ? 'translation request timed out' : (error instanceof Error ? error.message : String(error)),
      });
    }
  }
});

// POST /studio/translate/batch Body: { text, targets: ['en', 'es'] }
studioRouter.post('/translate/batch', async (req, res) => {
  const { text = '', targets = [], source = 'zh' } = req.body ?? {};
  const sourceCode = String(source || 'zh').trim();
  const src = String(text).trim();
  const targetCodes = Array.isArray(targets)
    ? targets.map(item => String(item || '').trim()).filter(Boolean).filter(code => code !== sourceCode).slice(0, 8)
    : [];
  if (!src) { res.json({ ok: true, source: 'noop', translations: {} }); return; }
  if (targetCodes.length === 0) { res.json({ ok: true, source: 'noop', translations: {} }); return; }
  const deadline = createTranslationDeadline(req, res, translationTimeout(process.env.STUDIO_TRANSLATION_BATCH_TOTAL_TIMEOUT_MS, 75_000, 20_000));
  const providerTimeoutMs = translationTimeout(process.env.STUDIO_TRANSLATION_PROVIDER_TIMEOUT_MS, 24_000, 5_000);

  const prompt = `You are a native short-video voiceover localization editor for cross-border B2B commerce.

Task:
Translate and lightly localize these timestamped ${langName(sourceCode)} spoken lines into natural, human-sounding target-language voiceover. This is NOT literal translation. Make it sound like a real person speaking in a short product video.

Target languages:
${targetCodes.map(code => `- ${code}: ${langName(code)}`).join('\n')}

Rules:
- Return ONLY valid JSON.
- JSON shape: {"en":"[0-3s] translated line\\n[3-8s] translated line","es":"..."}.
- Preserve every timestamp label exactly, such as [0-3s].
- Translate only the spoken text after each timestamp.
- Keep one output line per input line for every language.
- Keep every supplied source line. The caller has already removed non-spoken production notes, so never omit a remaining line.
- Do not leave source-language text in translated outputs unless it is a product name or proper noun.
- Use natural conversational wording, not stiff word-for-word translation.
- Repair Chinese short-video slang into idiomatic buyer-facing wording based on product context. For example, for non-cosmetic products, “上脸质感” should become “feels good in hand” or “looks premium on camera”, not “on the skin”.
- Keep product names, numbers, ranges, units, MOQ, material terms, and certification names accurate.
- Do not add explanations, quotes, markdown, product claims, prices, certifications, or new CTAs.
- If a Chinese line is too long, make it concise but keep the meaning and buyer-facing tone.

Source:
${src}`;

  const invalid = (value: string, code: string) => {
    const textValue = String(value || '').trim();
    if (!textValue) return true;
    const sourceCues = timestampedTranslationCues(src);
    if (sourceCues.length && !normalizeCompleteTimestampTranslation(src, textValue, code)) return true;
    const spokenValue = textValue
      .replace(/\[[^\]]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^\]]*\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!spokenValue) return true;
    const compactSpokenValue = spokenValue.replace(/\s+/g, '');
    if (compactSpokenValue.length < 6) return true;
    if (code !== 'zh') {
      const hanCount = (textValue.match(/[\u4e00-\u9fff]/g) || []).length;
      const letterCount = (textValue.match(/\p{L}/gu) || []).length;
      if (hanCount >= 6 && hanCount / Math.max(1, letterCount) > 0.45) return true;
    }
    if (/translation unavailable|无法翻译|不能翻译|作为AI|Here is|```/i.test(textValue)) return true;
    return false;
  };

  const run = async (backend: 'qwen') => {
    const out = await callLLM(prompt, {
      backend,
      model: 'qwen-plus',
      signal: deadline.signal,
      timeoutMs: providerTimeoutMs,
    });
    const parsed = extractJSON<Record<string, unknown> | Array<Record<string, unknown>>>(out) ?? {};
    const sourceTimestamps = src.split(/\n+/).map(line =>
      line.match(/^\s*(\[[^\]]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–—]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^\]]*\])/)?.[1] || '',
    ).filter(Boolean);
    const translations: Record<string, string> = {};
    for (const code of targetCodes) {
      let value = '';
      if (Array.isArray(parsed)) {
        // Qwen occasionally returns one object per source line even when an
        // object-of-strings was requested. Rebuild the expected timestamped
        // text instead of discarding an otherwise valid translation.
        value = parsed.map((row, index) => {
          const line = String(row?.[code] ?? row?.[langName(code)] ?? row?.translation ?? row?.text ?? '').trim();
          if (!line) return '';
          const timestamp = sourceTimestamps[index] || '';
          return timestamp && !/^\s*\[[^\]]+\]/.test(line) ? `${timestamp} ${line}` : line;
        }).filter(Boolean).join('\n');
      } else {
        const raw = translationValueForLanguage(parsed, code);
        value = normalizeTimestampTranslationValue(src, raw, code);
      }
      const normalized = normalizeTimestampTranslationValue(src, value, code);
      if (!invalid(normalized, code)) translations[code] = normalized;
    }
    return translations;
  };

  const runSingle = async (backend: 'qwen', code: string) => {
    const sourceCues = timestampedTranslationCues(src);
    const singlePrompt = `You are a native short-video voiceover localization editor for cross-border B2B commerce.

Translate every numbered ${langName(sourceCode)} spoken line into ${langName(code)}.
Return ONLY valid JSON: {"lines":["translation 1","translation 2"]}.
The lines array must contain exactly ${sourceCues.length} non-empty strings in the original order. Never merge, omit, summarize or repeat a line. Do not include timestamps inside the strings. Keep verified product names and numbers accurate. Do not add claims, CTAs, markdown or explanations.

Source lines:
${sourceCues.map((cue, index) => `${index + 1}. ${cue.text}`).join('\n')}`;
    const out = await callLLM(singlePrompt, {
      backend,
      model: 'qwen-plus',
      signal: deadline.signal,
      timeoutMs: providerTimeoutMs,
    });
    const parsed = extractJSON<{ lines?: unknown[] } | unknown[]>(out);
    const lines = Array.isArray(parsed) ? parsed : parsed?.lines;
    const value = Array.isArray(lines) && lines.length === sourceCues.length
      ? sourceCues.map((cue, index) => `${cue.timestamp} ${String(lines[index] || '').trim()}`).join('\n')
      : out.trim();
    const normalized = normalizeTimestampTranslationValue(src, value, code);
    return invalid(normalized, code) ? '' : normalized;
  };

  const errors: string[] = [];
  const translations: Record<string, string> = {};
  for (const backend of ['qwen'] as const) {
    if (deadline.signal.aborted) break;
    try {
      const result = await run(backend);
      Object.assign(translations, result);
      if (targetCodes.every(code => translations[code])) break;
    } catch (error) {
      errors.push(`${backend}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const missing = targetCodes.filter(code => !translations[code]);
  // Missing-language repairs used to run serially, multiplying a slow
  // provider timeout by every requested language. Two bounded workers keep
  // latency predictable without creating an upstream request burst.
  let missingIndex = 0;
  const workers = Array.from({ length: Math.min(2, missing.length) }, async () => {
    while (!deadline.signal.aborted) {
      const code = missing[missingIndex++];
      if (!code) break;
      for (const backend of ['qwen'] as const) {
        if (deadline.signal.aborted) break;
        try {
          const value = await runSingle(backend, code);
          if (value) {
            translations[code] = value;
            break;
          }
        } catch (error) {
          errors.push(`${backend}/${code}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  });
  await Promise.allSettled(workers);

  const ok = targetCodes.every(code => Boolean(translations[code]));
  if (!res.writableEnded && !res.destroyed) {
    res.json({
      ok,
      source: ok ? 'ai' : 'partial',
      translations,
      error: ok
        ? undefined
        : (deadline.timedOut ? 'translation request timed out; partial results returned' : (errors[0] || `missing translations: ${targetCodes.filter(code => !translations[code]).join(', ')}`)),
    });
  }
});

/* ── 数据看板 AI 结论 ──────────────────────────────────────────────────── */
// POST /studio/insight  Body: { scope, metrics } → { summary, actions[] }
studioRouter.post('/insight', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { scope = 'traffic', metrics = {} } = req.body ?? {};
  const prompt = `你是跨境电商社媒操盘手。根据以下「${scope}」当期数据（JSON），给运营一句中文洞察 + 2-3 条可执行建议。
数据：${JSON.stringify(metrics)}
只返回 JSON：{ "summary": string（一句话核心结论，≤40 字）, "actions": string[]（2-3 条，每条≤18 字，动词开头，具体到内容方向/平台/语言/发布节奏） }`;
  try {
    const text = await callLLM(prompt, { backend: 'qwen', systemPrompt: await enterpriseCtx() || undefined });
    const obj = extractJSON<{ summary: string; actions: string[] }>(text);
    if (obj?.summary) {
      res.json({ ok: true, source: 'ai', provenance: 'ai', publishable: true, qualityStatus: 'passed', summary: obj.summary, actions: (obj.actions ?? []).slice(0, 3) });
      return;
    }
    throw new Error('parse');
  } catch (error) {
    res.status(502).json({ ...upstreamGenerationFailure(error, '数据洞察'), summary: '', actions: [] });
  }
});

/* ── ② AI 智能选材 ─────────────────────────────────────────────────────── */
// POST /studio/select  Body: { materials: {id,name,type,duration}[], duration? }
studioRouter.post('/select', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { materials = [], duration = 20 } = req.body ?? {};
  const list = materials as { id: string; name: string; type: string; duration: number }[];

  const prompt = `From the clip library below, pick and order the best clips to build a ${duration}s product short video.
Prefer a strong opener, varied shots, and a clear ending. Keep total length close to ${duration}s.
Clips: ${JSON.stringify(list)}
Return ONLY JSON: { "selectedIds": string[] (ordered), "reason": string (one short sentence) }`;

  try {
    const text = await callLLM(prompt, { backend: 'qwen', systemPrompt: await enterpriseCtx() || undefined });
    const obj = extractJSON<{ selectedIds: string[]; reason: string }>(text);
    const valid = obj?.selectedIds?.filter(id => list.some(c => c.id === id));
    if (valid && valid.length) {
      res.json({ ok: true, source: 'ai', provenance: 'ai', publishable: true, qualityStatus: 'passed', selectedIds: valid, reason: obj!.reason ?? '' });
      return;
    }
    throw new Error('parse');
  } catch (error) {
    res.status(502).json({ ...upstreamGenerationFailure(error, '智能选材结果'), selectedIds: [], reason: '' });
  }
});

/* ── ⑥ 成片合成（渲染授权）─────────────────────────────────────────────────
   合成在客户端本机用原生 ffmpeg 完成（桌面端）。服务器只负责「授权」：
   下发 ① 合成所需原料清单（manifest：脚本 / 片段时间轴 / 配音 / 封面 / BGM 的
   URL）② 一个短期签名令牌。客户端凭 manifest 本地拼接出 MP4。
   注：配音(TTS)/封面出图/BGM 曲库尚未实现，相关 url 暂为 null，桌面端用占位合成；
   接入后只需把对应 url 填上，对外契约不变。
─────────────────────────────────────────────────────────────────────────── */

interface SubCue { start: number; end: number; text: string; zh?: string }
interface SubtitleSpec { mode: 'off' | 'target' | 'bilingual'; cues: SubCue[]; style: Record<string, unknown> }

interface RenderSpec {
  materials?: string[];
  timeline?: {
    name: string;
    url?: string;
    trimStart?: number;
    trimEnd?: number;
    speed?: number;
    targetStart?: number;
    targetEnd?: number;
    targetDuration?: number;
  }[];
  script?: string;
  voice?: string;
  bgm?: string;
  bgmVol?: number;
  voiceVol?: number;
  coverId?: string;
  coverTitle?: string;
  coverUrl?: string; // 前端封面步生成的 /covers/xxx.svg
  ratio?: string;
  duration?: number;
  platform?: string;
  language?: string;
  voiceoverUrl?: string; // 前端在脚本步生成配音后回传的 /tts/xxx.wav
  subtitles?: SubtitleSpec; // 字幕轨：桌面端 ffmpeg 按 cue 烧录
}

interface RenderManifest {
  jobId: string;
  spec: { ratio: string; resolution?: string; duration: number; platform: string; language: string; bgmVol: number; voiceVol: number };
  script: string;
  timeline: {
    index: number;
    name: string;
    url: string | null;
    trimStart?: number;
    trimEnd?: number;
    speed?: number;
    targetStart?: number;
    targetEnd?: number;
    targetDuration?: number;
  }[];
  voiceover: { voice: string | null; url: string | null };
  cover: { id: string | null; title: string; url: string | null };
  bgm: { id: string | null; url: string | null };
  subtitles?: SubtitleSpec;
}

function absoluteAssetUrl(base: string, value?: string | null): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;
  return `${base}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function buildManifest(jobId: string, spec: RenderSpec, base: string): RenderManifest {
  // 选中素材按名称映射到素材库的真实 URL（已上传的给绝对地址，ffmpeg 可直接拉取）
  const tenantId = studioTenantContext.getStore();
  const urlByName = new Map(loadMaterials()
    .filter(m => m.scope === 'shared' || (tenantId && m.tenantId === tenantId))
    .map(m => [m.name, m.url]));
  return {
    jobId,
    spec: {
      ratio: spec.ratio || '9:16',
      duration: spec.duration ?? 20,
      platform: spec.platform || 'tiktok',
      language: spec.language || 'en',
      bgmVol: spec.bgmVol ?? 35,
      resolution: (spec as any).resolution || '1080p',
      voiceVol: spec.voiceVol ?? 100,
    },
    script: spec.script ?? '',
    timeline: (spec.timeline?.length ? spec.timeline : (spec.materials ?? []).map(name => ({ name }))).map((item, index) => {
      const rel = urlByName.get(item.name);
      const directUrl = 'url' in item && typeof item.url === 'string' ? item.url : undefined;
      const resolvedUrl = absoluteAssetUrl(base, directUrl || rel);
      return { index, ...item, url: resolvedUrl,
        productUrl: absoluteAssetUrl(base, 'productUrl' in item ? String(item.productUrl || '') : ''),
        backgroundUrl: absoluteAssetUrl(base, 'backgroundUrl' in item ? String(item.backgroundUrl || '') : ''),
      }; // 优先使用逐镜传入 URL，避免 AI/临时素材被名称映射覆盖
    }),
    voiceover: { voice: spec.voice ?? null, url: absoluteAssetUrl(base, spec.voiceoverUrl) },
    cover: { id: spec.coverId ?? null, title: spec.coverTitle ?? '', url: absoluteAssetUrl(base, spec.coverUrl) },
    bgm: (() => {
      const track = spec.bgm && tenantId ? withRecommendedBgmNames(userBgms(tenantId)).find(t => t.id === spec.bgm) : null;
      return { id: spec.bgm ?? null, url: track ? `${base}${track.url}` : null };
    })(),
    subtitles: spec.subtitles && spec.subtitles.mode !== 'off' ? spec.subtitles : undefined,
  };
}

// POST /studio/render  Body: RenderSpec → { ok, token, expiresAt, manifest }
studioRouter.post('/render', async (req, res) => {
  if (!await consumeDemoQuota(req, res, 'render')) return;
  const spec = (req.body ?? {}) as RenderSpec;
  const jobId = randomUUID();
  const base = `${req.protocol}://${req.get('host')}`;
  const manifest = buildManifest(jobId, spec, base);

  const { token, payload } = signRenderToken({ jti: jobId, ratio: manifest.spec.ratio, duration: manifest.spec.duration });

  res.status(201).json({
    ok: true,
    token,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    manifest,
  });
});

// POST /studio/render/local  Body: RenderManifest → { ok, outputPath }
// 网页端兜底：没有 Electron 桥时，直接让本机后端调用同一套 ffmpeg 合成器导出 MP4。
studioRouter.post('/render/local', async (req, res) => {
  try {
    const { tenantId } = res.locals as AuthLocals;
    const origin = `${req.protocol}://${req.get('host')}`;
    const outputDir = publishingRenderDir(tenantId);
    fs.mkdirSync(outputDir, { recursive: true });
    const result = await composite({
      ...(req.body || {}),
      assetOrigin: origin,
      assetHeaders: {
        ...(req.get('authorization') ? { authorization: req.get('authorization') } : {}),
        ...(req.get('cookie') ? { cookie: req.get('cookie') } : {}),
      },
    }, undefined, outputDir);
    if (!result.ok) {
      res.status(500).json({ ok: false, error: result.error || '本地 MP4 导出失败' });
      return;
    }
    const outputPath = String(result.outputPath || '');
    res.json({
      ok: true,
      outputPath,
      previewUrl: outputPath ? publishingRenderPreviewUrl(tenantId, outputPath) : '',
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : '本地 MP4 导出失败' });
  }
});

// POST /studio/render/open-output Body: { path }
// 网页端无法直接打开 file:// 本地路径时，交给本机后端打开文件所在目录。
studioRouter.post('/render/open-output', async (req, res) => {
  const rawPath = String(req.body?.path || '').trim().replace(/^file:\/\//, '').replace(/^["']|["']$/g, '');
  if (!rawPath) {
    res.status(400).json({ ok: false, error: '缺少本地文件路径' });
    return;
  }
  const filePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(rawPath);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ ok: false, error: '本地成片文件不存在，请重新导出。' });
    return;
  }
  try {
    if (process.platform === 'darwin') {
      await execFileAsync('open', ['-R', filePath], 5000);
    } else if (process.platform === 'win32') {
      await execFileAsync('explorer.exe', ['/select,', filePath], 5000);
    } else {
      await execFileAsync('xdg-open', [path.dirname(filePath)], 5000);
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || '打开本地文件夹失败' });
  }
});

/* ── 素材库───────────────────────────────────────────────────────────────
   新上传的「我的素材」统一由 PocketBase materials 记录及文件字段持久化；
   data/media 与 data/materials.json 只保留历史兼容读取，不再接收新上传。
─────────────────────────────────────────────────────────────────────────── */

const MEDIA_DIR = path.join(__dirname, '../../data/media');
const VIDEO_VERSIONS_FILE = path.join(__dirname, '../../data/studio-video-versions.json');

interface VideoGenerationVersion {
  id: string;
  tenantId: string;
  groupKey: string;
  versionNumber: number;
  parentVersionId?: string;
  materialId?: string;
  taskId?: string;
  title: string;
  url?: string;
  poster?: string;
  duration: number;
  source: string;
  model?: string;
  promptSnapshot: {
    script: string;
    productInfo: string;
    language: string;
    ratio: string;
    resolution: string;
  };
  context?: Record<string, unknown>;
  isSelected: boolean;
  createdAt: string;
}

function loadVideoVersions(): VideoGenerationVersion[] {
  try { return JSON.parse(fs.readFileSync(VIDEO_VERSIONS_FILE, 'utf8')) as VideoGenerationVersion[]; }
  catch { return []; }
}

function persistVideoVersions(list: VideoGenerationVersion[]): void {
  fs.mkdirSync(path.dirname(VIDEO_VERSIONS_FILE), { recursive: true });
  fs.writeFileSync(VIDEO_VERSIONS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function appendVideoVersion(input: Omit<VideoGenerationVersion, 'id' | 'versionNumber' | 'isSelected' | 'createdAt'>): VideoGenerationVersion {
  const list = loadVideoVersions();
  const siblings = list.filter(item => item.tenantId === input.tenantId && item.groupKey === input.groupKey);
  siblings.forEach(item => { item.isSelected = false; });
  const version: VideoGenerationVersion = {
    ...input,
    id: randomUUID(),
    versionNumber: Math.max(0, ...siblings.map(item => item.versionNumber)) + 1,
    isSelected: true,
    createdAt: new Date().toISOString(),
  };
  list.push(version);
  persistVideoVersions(list);
  return version;
}

interface Material {
  avatarMediaCheck?: AvatarMediaCheck;
  transcript?: string;
  transcriptCues?: SubCue[];
  id: string;
  name: string;
  folder: string;
  type: 'video' | 'image' | 'audio';
  duration: number; // 秒，图片为 0
  width?: number;
  height?: number;
  aspectRatio?: number;
  size: string;
  file: string;     // PB 文件名；历史记录可能仍是 data/media 相对路径
  url: string;      // 受保护的 PB 播放路由；历史记录可能仍是 /media/<file>
  poster?: string;  // 封面用的帧画面：视频抽首帧，图片即自身
  objectKey?: string;
  posterObjectKey?: string;
  scope: 'shared' | 'own'; // shared=公共库（运营预置），own=用户自己上传
  tenantId?: string;
  usage?: MaterialUsage;   // editable=可剪辑；reference_only=仅供对标分析，禁止进入公共下载库
  sourceType?: string;
  sourceName?: string;
  sourceProvider?: string;
  sourceCreator?: string;
  sourceUrl?: string;
  licenseEvidence?: string;
  licenseName?: string;
  licenseUrl?: string;
  attributionText?: string;
  licenseEvidenceCapturedAt?: string;
  licenseEvidenceTextSha256?: string;
  importBatchId?: string;
  manifestSha256?: string;
  importedAt?: string;
  commercialUseApproved?: boolean;
  derivativesApproved?: boolean;
  rawLibraryUseApproved?: boolean;
  provenance?: Record<string, unknown>;
  pinned?: boolean;
  industry?: string;
  shotFunction?: string;
  applicability?: string;
  tags?: string;
  productId?: string;
  productName?: string;
  segmentAnalysisStatus?: 'pending' | 'analyzing' | 'completed' | 'failed';
  segmentAnalysisError?: string;
  segments?: MaterialSegment[];
  createdAt: string;
}

interface MaterialSegment {
  id: string;
  start: number;
  end: number;
  duration: number;
  poster?: string;
  subject: string[];
  action: string;
  productVisible: boolean;
  productClarity: 'none' | 'low' | 'medium' | 'high';
  shot: string;
  angle: string;
  composition: string;
  camera: string;
  environment: string;
  quality: number;
  ocrText: string;
  hasPerson: boolean;
  hasLogo: boolean;
  logoText: string[];
  recommendedFunctions: string[];
  authenticity: string;
  confidence: number;
  needsReview: boolean;
  manualConfirmed?: boolean;
  posterObjectKey?: string;
}

const ffmpegBin = ffmpegStatic as unknown as string | null;

/** 跑一条 ffmpeg 命令，成功返回 true */
function runFfmpeg(args: string[]): Promise<boolean> {
  return new Promise(resolve => {
    if (!ffmpegBin) { resolve(false); return; }
    const p = spawn(ffmpegBin, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'ignore'] });
    p.on('error', () => resolve(false));
    p.on('close', code => resolve(code === 0));
  });
}

/** 用 ffmpeg 从视频抽一帧存成 JPG（封面候选用）。无 ffmpeg 或失败返回 false */
async function extractPoster(videoPath: string, outPath: string, atSec = 1): Promise<boolean> {
  const ok = await runFfmpeg(['-ss', String(atSec), '-i', videoPath, '-frames:v', '1', '-q:v', '3', '-y', outPath]);
  return ok && fs.existsSync(outPath);
}

function loadMaterials(): Material[] { return readLocalMaterials() as Material[]; }
function persistMaterials(list: Material[]): void { saveLocalMaterials(list); }

type DigitalHumanJobStatus = 'queued' | 'submitting' | 'processing' | 'quality_check' | 'review' | 'completed' | 'failed' | 'cancelled';
type DigitalHumanMode = 'fast' | 'quality';
interface DigitalHumanQualityReport {
  passed: boolean;
  lipSyncScore?: number;
  avOffsetFrames?: number;
  identityScore?: number;
  freezeSegments?: number;
  durationSeconds?: number;
  faceDetectionRate?: number;
  mouthJumpP95?: number;
  gateVersion?: string;
  gateFailures?: string[];
  notes?: string[];
}
interface DigitalHumanJob {
  subtitleCues?: Array<{ start: number; end: number; text: string }>;
  id: string;
  tenantId: string;
  projectId?: string;
  heygenAvatarId?: string;
  avatarMaterialId: string;
  avatarName: string;
  voiceoverUrl: string;
  scriptSnapshot: string;
  language: string;
  mode: DigitalHumanMode;
  consentConfirmed: boolean;
  commercialRightsStatus: 'cleared';
  provider: string;
  providerTaskId?: string;
  status: DigitalHumanJobStatus;
  stage: string;
  progress: number;
  outputMaterialId?: string;
  outputUrl?: string;
  qualityReport?: DigitalHumanQualityReport;
  errorCode?: string;
  errorMessage?: string;
  versionNumber: number;
  parentJobId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

const DIGITAL_HUMAN_JOBS_FILE = process.env.NODE_ENV === 'test' && process.env.DIGITAL_HUMAN_JOBS_FILE ? path.resolve(process.env.DIGITAL_HUMAN_JOBS_FILE) : path.join(__dirname, '../../data/digital-human-jobs.json');
const DIGITAL_HUMAN_MAX_OUTPUT_BYTES = 110 * 1024 * 1024;
const digitalHumanRefreshes = new Map<string, Promise<DigitalHumanJob>>();

function loadDigitalHumanJobs(): DigitalHumanJob[] {
  try { return JSON.parse(fs.readFileSync(DIGITAL_HUMAN_JOBS_FILE, 'utf8')) as DigitalHumanJob[]; }
  catch { return []; }
}

function persistDigitalHumanJobs(list: DigitalHumanJob[]): void {
  fs.mkdirSync(path.dirname(DIGITAL_HUMAN_JOBS_FILE), { recursive: true });
  const temp = `${DIGITAL_HUMAN_JOBS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(temp, DIGITAL_HUMAN_JOBS_FILE);
}

function updateDigitalHumanJob(id: string, patch: Partial<DigitalHumanJob>): DigitalHumanJob {
  const list = loadDigitalHumanJobs();
  const index = list.findIndex(item => item.id === id);
  if (index < 0) throw new Error('digital human job not found');
  if (list[index]!.provider === 'heygen' && list[index]!.status === 'cancelled' && patch.status !== 'cancelled') return list[index]!;
  const next = { ...list[index]!, ...patch, updatedAt: new Date().toISOString() };
  list[index] = next;
  persistDigitalHumanJobs(list);
  return next;
}

function digitalHumanConfig() {
  const baseUrl = String(process.env.DIGITAL_HUMAN_API_URL || '').trim().replace(/\/+$/, '');
  const apiKey = String(process.env.DIGITAL_HUMAN_API_KEY || '').trim();
  const provider = String(process.env.DIGITAL_HUMAN_PROVIDER || 'latentsync').trim() || 'latentsync';
  const timeoutMs = Math.max(10_000, Number(process.env.DIGITAL_HUMAN_API_TIMEOUT_MS || 30_000));
  return { baseUrl, apiKey, provider, timeoutMs };
}

function digitalHumanProviderHeaders(): Record<string, string> {
  const { apiKey } = digitalHumanConfig();
  return { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
}

async function digitalHumanFetch(url: string, init?: RequestInit): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), digitalHumanConfig().timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

function safeProviderOutputUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let output: URL;
  let provider: URL;
  try { output = new URL(raw); provider = new URL(digitalHumanConfig().baseUrl); }
  catch { return ''; }
  if (!['https:', 'http:'].includes(output.protocol)) return '';
  const allowed = new Set([
    provider.host,
    ...String(process.env.DIGITAL_HUMAN_OUTPUT_HOSTS || '').split(',').map(item => item.trim()).filter(Boolean),
  ]);
  return allowed.has(output.host) ? output.toString() : '';
}

function publicDigitalHumanJob(job: DigitalHumanJob) {
  const { tenantId: _tenantId, voiceoverUrl: _voiceoverUrl, ...safe } = job;
  return { ...safe, ...(job.outputUrl?.startsWith('/') ? { outputUrl: signAssetUrl(job.outputUrl.split('?')[0], job.tenantId) } : {}) };
}

function appAssetUrl(req: Request, value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  const base = `${req.protocol}://${req.get('host')}`;
  return `${base}${value.startsWith('/') ? value : `/${value}`}`;
}

async function finalizeDigitalHumanOutput(job: DigitalHumanJob, outputUrl: string, providerQuality: DigitalHumanQualityReport): Promise<DigitalHumanJob> {
  const commercialGate = commercialDigitalHumanGate(providerQuality || {}, job.mode);
  if (!providerQuality || !commercialGate.passed) {
    return updateDigitalHumanJob(job.id, {
      status: 'review', stage: 'quality_review', progress: 100,
      qualityReport: {
        ...providerQuality,
        passed: false,
        gateVersion: 'commercial-v1',
        gateFailures: commercialGate.failures,
        notes: [...(providerQuality?.notes || []), ...commercialGate.failures, '商业质量门禁未通过，禁止自动进入成片与发布。'],
      },
    });
  }
  const response = await digitalHumanFetch(outputUrl, { headers: digitalHumanProviderHeaders() });
  if (!response.ok) throw new Error(`数字人成片下载失败（${response.status}）`);
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType && !contentType.startsWith('video/') && contentType !== 'application/octet-stream') throw new Error('数字人服务返回的不是视频');
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > DIGITAL_HUMAN_MAX_OUTPUT_BYTES) throw new Error('数字人成片超过 110MB 限制');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > DIGITAL_HUMAN_MAX_OUTPUT_BYTES) throw new Error('数字人成片大小无效');

  const outputDir = tenantAssetDir(MEDIA_DIR, job.tenantId);
  fs.mkdirSync(outputDir, { recursive: true });
  const filename = `${job.id}.mp4`;
  fs.writeFileSync(path.join(outputDir, filename), bytes);
  const material = await createGeneratedVideoMaterial({
    title: `视频保真数字人口播 · ${job.avatarName}`,
    filename,
    duration: Number(providerQuality.durationSeconds) || 0,
    tenantId: job.tenantId,
    sourceType: 'digital-human',
  });
  if (!material) throw new Error('数字人成片未能写入素材库');
  material.folder = 'presenter';
  persistMaterials(loadMaterials().map(item => item.id === material.id ? material : item));
  return updateDigitalHumanJob(job.id, {
    status: 'completed', stage: 'completed', progress: 100,
    outputMaterialId: material.id, outputUrl: material.url || undefined,
    qualityReport: { ...providerQuality, passed: true, gateVersion: 'commercial-v1', gateFailures: [] }, completedAt: new Date().toISOString(),
  });
}

async function refreshDigitalHumanJob(jobId: string, req?: Request): Promise<DigitalHumanJob> {
  const existingRefresh = digitalHumanRefreshes.get(jobId);
  if (existingRefresh) return existingRefresh;
  const task = (async () => {
    let job = loadDigitalHumanJobs().find(item => item.id === jobId);
    if (!job) throw new Error('digital human job not found');
    if (['completed', 'review', 'failed', 'cancelled'].includes(job.status)) return job;
    if (job.provider === 'heygen') return advanceHeygenJob(job);
    const { baseUrl, provider } = digitalHumanConfig();
    if (!baseUrl) return updateDigitalHumanJob(job.id, { status: 'failed', stage: 'configuration', errorCode: 'PROVIDER_NOT_CONFIGURED', errorMessage: '数字人推理服务尚未配置。' });

    if (!job.providerTaskId) {
      if (!req) return job;
      const material = loadMaterials().find(item => item.id === job!.avatarMaterialId && item.tenantId === job!.tenantId && item.scope === 'own');
      if (!material) return updateDigitalHumanJob(job.id, { status: 'failed', stage: 'input_validation', errorCode: 'AVATAR_NOT_FOUND', errorMessage: '人物素材不存在或不属于当前企业。' });
      const avatar = await materialResponse(material, job.tenantId);
      const response = await digitalHumanFetch(`${baseUrl}/v1/jobs`, {
        method: 'POST', headers: digitalHumanProviderHeaders(), body: JSON.stringify({
          externalJobId: job.id,
          provider,
          avatarVideoUrl: appAssetUrl(req, String(avatar.url || '')),
          audioUrl: appAssetUrl(req, job.voiceoverUrl),
          script: job.scriptSnapshot,
          language: job.language,
          mode: job.mode,
          output: { ratio: '9:16', container: 'mp4' },
        }),
      });
      const payload = await response.json().catch(() => ({})) as any;
      if (!response.ok || !payload.id) throw new Error(String(payload.error || `数字人服务提交失败（${response.status}）`));
      job = updateDigitalHumanJob(job.id, { providerTaskId: String(payload.id), status: 'processing', stage: String(payload.stage || 'inference'), progress: Math.max(1, Math.min(95, Number(payload.progress) || 5)) });
    }

    const response = await digitalHumanFetch(`${baseUrl}/v1/jobs/${encodeURIComponent(job.providerTaskId!)}`, { headers: digitalHumanProviderHeaders() });
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok) throw new Error(String(payload.error || `数字人服务查询失败（${response.status}）`));
    const providerStatus = String(payload.status || 'processing');
    if (providerStatus === 'failed') return updateDigitalHumanJob(job.id, { status: 'failed', stage: String(payload.stage || 'inference'), progress: Math.max(0, Math.min(99, Number(payload.progress) || job.progress)), errorCode: String(payload.errorCode || 'PROVIDER_FAILED'), errorMessage: String(payload.error || '数字人生成失败') });
    if (providerStatus === 'cancelled') return updateDigitalHumanJob(job.id, { status: 'cancelled', stage: 'cancelled', progress: job.progress });
    if (providerStatus !== 'completed') return updateDigitalHumanJob(job.id, { status: providerStatus === 'quality_check' ? 'quality_check' : 'processing', stage: String(payload.stage || 'inference'), progress: Math.max(job.progress, Math.min(95, Number(payload.progress) || job.progress)) });

    const outputUrl = safeProviderOutputUrl(payload.outputUrl);
    if (!outputUrl) throw new Error('数字人服务返回了不受信任的输出地址');
    return finalizeDigitalHumanOutput(job, outputUrl, payload.quality as DigitalHumanQualityReport);
  })().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    const current = loadDigitalHumanJobs().find(item => item.id === jobId);
    if (current?.provider === 'heygen' && current.providerTaskId && /fetch failed|timeout|timed out|aborted|HeyGen (429|5\d\d)/i.test(message)) {
      return updateDigitalHumanJob(jobId, { status: 'processing', stage: 'heygen_rendering', errorCode: 'PROVIDER_POLL_RETRY', errorMessage: '网络暂时不可用，继续查询原 HeyGen 任务，不重复生成。' });
    }
    return updateDigitalHumanJob(jobId, { status: 'failed', stage: 'provider', errorCode: 'PROVIDER_ERROR', errorMessage: message });
  }).finally(() => digitalHumanRefreshes.delete(jobId));
  digitalHumanRefreshes.set(jobId, task);
  return task;
}

// Keep provider tasks moving even when the creator closes the page. Queued jobs
// are submitted synchronously by their POST request; only already-submitted jobs
// are safe to recover here because their signed inputs are no longer needed.
const digitalHumanRecoveryTimer = setInterval(() => {
  if (!digitalHumanConfig().baseUrl && !heygenConfigured()) return;
  for (const job of loadDigitalHumanJobs().filter(item => item.providerTaskId && ['processing', 'quality_check'].includes(item.status)).slice(0, 20)) {
    void refreshDigitalHumanJob(job.id);
  }
}, 15_000);
digitalHumanRecoveryTimer.unref?.();

function validDigitalHumanVoiceoverUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 1200) return '';
  if (raw.startsWith('/tts/') || /^\/api\/overseas\/studio\/private-assets\/tts\//.test(raw)) return raw;
  return '';
}

async function advanceHeygenJob(job: DigitalHumanJob): Promise<DigitalHumanJob> {
  if (!job.providerTaskId) {
    const audioPath = path.join(tenantAssetDir(TTS_ROOT, job.tenantId), path.basename(new URL(job.voiceoverUrl, 'http://local').pathname));
    const providerTaskId = await submitHeygenVideo({ id: job.id, avatarId: job.heygenAvatarId!, audioPath, title: '数字人口播' });
    job = updateDigitalHumanJob(job.id, { providerTaskId, status: 'processing', stage: 'heygen_rendering', progress: 10 });
  }
  const payload = await heygenRequest(`videos/${encodeURIComponent(job.providerTaskId!)}`);
  const result = payload.data || {};
  if (result.status === 'failed') return updateDigitalHumanJob(job.id, { status: 'failed', stage: 'provider', errorMessage: String(result.failure_message || 'HeyGen 生成失败') });
  if (result.status !== 'completed') return job;
  const subtitleCues = await downloadHeygenSubtitles(String(result.subtitle_url || ''), Number(result.duration), job.scriptSnapshot);
  const bytes = await downloadHeygenOutput(String(result.video_url || ''));
  const outputDir = tenantAssetDir(MEDIA_DIR, job.tenantId);
  fs.mkdirSync(outputDir, { recursive: true });
  const filename = `${job.id}.mp4`;
  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, bytes);
  const visual = await inspectRenderedVisuals({ outputPath, expectedDuration: Number(result.duration) || 1, expectedUniqueScenes: 1 });
  if (!visual.passed) return updateDigitalHumanJob(job.id, { status: 'failed', stage: 'quality', errorMessage: visual.failures.join('；') });
  const material = await createGeneratedVideoMaterial({ title: `HeyGen 数字人口播 · ${job.avatarName}`, filename, duration: Number(result.duration) || 0, tenantId: job.tenantId, sourceType: 'digital-human' });
  if (!material) throw Error('HeyGen 成片素材保存失败');
  material.folder = 'presenter';
  persistMaterials(loadMaterials().map(item => item.id === material.id ? material : item));
  return updateDigitalHumanJob(job.id, { status: 'review', stage: 'human_quality_review', progress: 100, subtitleCues, errorCode: undefined, errorMessage: undefined, outputMaterialId: material.id, outputUrl: material.url || undefined,
    qualityReport: { passed: false, durationSeconds: Number(result.duration) || 0, notes: ['文件与画面检查通过；请预览确认人物、口型及声音后使用。HeyGen 不提供本系统的口型分数，不伪造分数。'] } });
}

export function heygenOutputPath(tenantId: string, jobId: string): string { return path.join(tenantAssetDir(MEDIA_DIR, tenantId), `${jobId}.mp4`); }

const heygenCreationQueues = new Map<string, Promise<unknown>>();
export async function ensureHeygenAutomationJob(input: { tenantId: string; projectId: string; avatarId: string; consent: boolean; voiceoverUrl: string; script: string; language: string }): Promise<DigitalHumanJob> {
  const key = input.tenantId;
  const previous = heygenCreationQueues.get(key) || Promise.resolve();
  const next = previous.catch(() => undefined).then(() => ensureHeygenJobLocked(input));
  heygenCreationQueues.set(key, next);
  try { return await next; } finally { if (heygenCreationQueues.get(key) === next) heygenCreationQueues.delete(key); }
}
async function ensureHeygenJobLocked(input: { tenantId: string; projectId: string; avatarId: string; consent: boolean; voiceoverUrl: string; script: string; language: string }): Promise<DigitalHumanJob> {
  if (!input.consent || !input.avatarId) throw Error('请选择 HeyGen 人物并确认使用权');
  let job = loadDigitalHumanJobs().slice().reverse().find(item => item.tenantId === input.tenantId && item.projectId === input.projectId && item.provider === 'heygen' && item.scriptSnapshot === input.script && item.heygenAvatarId === input.avatarId && item.voiceoverUrl === input.voiceoverUrl);
  if (!job) {
    if (loadDigitalHumanJobs().filter(item => item.tenantId === input.tenantId && ['queued', 'submitting', 'processing', 'quality_check'].includes(item.status)).length >= 2) throw Error('当前已有 2 个数字人任务在运行，请稍后再试');
    const avatar = (await listHeygenAvatars()).find(item => item.id === input.avatarId);
    if (!avatar) throw Error('所选 HeyGen 人物不可用，请重新选择');
    const now = new Date().toISOString();
    job = { id: randomUUID(), tenantId: input.tenantId, projectId: input.projectId, heygenAvatarId: input.avatarId, avatarMaterialId: '', avatarName: avatar.name,
      voiceoverUrl: input.voiceoverUrl, scriptSnapshot: input.script, language: input.language, mode: 'quality', consentConfirmed: true, commercialRightsStatus: 'cleared', provider: 'heygen', status: 'queued', stage: 'queued', progress: 0, versionNumber: 1, createdAt: now, updatedAt: now };
    persistDigitalHumanJobs([...loadDigitalHumanJobs(), job]);
  }
  return refreshDigitalHumanJob(job.id);
}

studioRouter.get('/digital-human/avatars', async (_req, res) => {
  try { res.json({ items: await listHeygenAvatars() }); } catch (error) { res.status(503).json({ error: error instanceof Error ? error.message : 'HeyGen 人物不可用', items: [] }); }
});
studioRouter.post('/digital-human/jobs/:id/approve', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const job = loadDigitalHumanJobs().find(item => item.id === req.params.id && item.tenantId === tenantId);
  if (!job || job.provider !== 'heygen' || job.status !== 'review' || !job.outputMaterialId) { res.status(409).json({ error: '没有可确认的 HeyGen 成片' }); return; }
  if (req.body?.reviewed !== true) { res.status(400).json({ error: '请先预览并确认人物、口型与声音' }); return; }
  const updated = updateDigitalHumanJob(job.id, { status: 'completed', stage: 'completed', completedAt: new Date().toISOString(), qualityReport: { ...job.qualityReport, passed: true, notes: [...(job.qualityReport?.notes || []), '用户已预览并确认人物、口型与声音'] } });
  res.json({ ok: true, job: publicDigitalHumanJob(updated) });
});

function digitalHumanCapabilities() {
  return { available: heygenConfigured(), provider: 'heygen', features: ['lip_sync'], modes: [{ id: 'quality', label: 'HeyGen 数字人' }], output: { ratio: '9:16', container: 'mp4' }, qualityGateRequired: true, maxConcurrentJobs: 2,
    unavailableReason: heygenConfigured() ? undefined : '尚未配置 HeyGen 服务（HEYGEN_API_KEY）' };
}

studioRouter.get('/digital-human/capabilities', (_req, res) => {
  res.json(digitalHumanCapabilities());
});

studioRouter.post('/transformations/assess', (req, res) => {
  try {
    const input = req.body as TransformationAssessmentInput;
    if (!input || !input.mode || !input.rights || !input.source) {
      res.status(400).json({ ok: false, error: '缺少替换模式、授权声明或源素材指标' });
      return;
    }
    res.json({ ok: true, assessment: assessTransformation(input) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : '替换兼容性评估失败' });
  }
});

studioRouter.get('/digital-human/jobs', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const projectId = String(req.query.projectId || '').trim();
  const jobs = loadDigitalHumanJobs()
    .filter(item => item.tenantId === tenantId && (!projectId || item.projectId === projectId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50)
    .map(publicDigitalHumanJob);
  res.json(jobs);
});

studioRouter.post('/digital-human/jobs', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const capabilities = digitalHumanCapabilities();
  if (!capabilities.available) { res.status(503).json({ ok: false, error: capabilities.unavailableReason, code: 'PROVIDER_NOT_CONFIGURED' }); return; }
  if (req.body?.heygenAvatarId) {
    try {
      if (req.body.projectId) { const project = await store.getById<any>('studio_projects', String(req.body.projectId)); if (!project || project.tenant_id !== tenantId) { res.status(404).json({ error: '当前企业的制作项目不存在' }); return; } }
      const voiceoverUrl = validDigitalHumanVoiceoverUrl(req.body.voiceoverUrl);
      if (!voiceoverUrl || !String(req.body.script || '').trim()) { res.status(400).json({ error: '请先确认口播并生成音频' }); return; }
      if (String(req.body.script).length > 8000) { res.status(400).json({ error: '口播过长，请缩短后重新确认' }); return; }
      const job = await ensureHeygenAutomationJob({ tenantId, projectId: String(req.body.projectId || randomUUID()), avatarId: String(req.body.heygenAvatarId), consent: req.body.consentConfirmed === true, voiceoverUrl, script: String(req.body.script), language: String(req.body.language || 'en') });
      res.status(202).json({ ok: true, job: publicDigitalHumanJob(job) });
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'HeyGen 提交失败' }); }
    return;
  }
  res.status(400).json({ error: '请选择 HeyGen 人物', code: 'HEYGEN_AVATAR_REQUIRED' }); return;

});

studioRouter.get('/digital-human/jobs/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const job = loadDigitalHumanJobs().find(item => item.id === req.params.id && item.tenantId === tenantId);
  if (!job) { res.status(404).json({ ok: false, error: '数字人任务不存在' }); return; }
  const outputMaterial = job.outputMaterialId ? loadMaterials().find(item => item.id === job!.outputMaterialId && item.tenantId === tenantId) : undefined;
  res.json({ ok: true, job: publicDigitalHumanJob(job), outputMaterial: outputMaterial ? await materialResponse(outputMaterial, tenantId) : undefined });
});

studioRouter.post('/digital-human/jobs/:id/retry', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const source = loadDigitalHumanJobs().find(item => item.id === req.params.id && item.tenantId === tenantId);
  if (!source) { res.status(404).json({ ok: false, error: '数字人任务不存在' }); return; }
  if (!['failed', 'review', 'cancelled'].includes(source.status)) { res.status(409).json({ ok: false, error: '只有失败、待复核或已取消任务可以重试' }); return; }
  // A repeated click/replayed request against one parent is the same retry.
  // To retry a failed child again the caller must explicitly target that child.
  // Resolve this before capacity checks, which may already include this child.
  const existingRetry = loadDigitalHumanJobs().find(item => item.tenantId === tenantId && item.parentJobId === source.id);
  if (existingRetry) {
    res.status(202).json({ ok: true, job: publicDigitalHumanJob(existingRetry) }); return;
  }
  if (!digitalHumanCapabilities().available) { res.status(503).json({ ok: false, error: 'HeyGen 服务尚未配置' }); return; }
  const active = loadDigitalHumanJobs().filter(item => item.tenantId === tenantId && ['queued', 'submitting', 'processing', 'quality_check'].includes(item.status));
  if (active.length >= 2) { res.status(429).json({ ok: false, error: '当前已有 2 个数字人任务在运行，请稍后再试' }); return; }
  if (source.provider === 'heygen' && source.providerTaskId && source.errorCode === 'PROVIDER_ERROR' && /fetch failed|timeout|timed out|aborted|HeyGen (429|5\d\d)|字幕与已确认口播不一致/i.test(source.errorMessage || '')) {
    const resumed = updateDigitalHumanJob(source.id, { status: 'processing', stage: 'heygen_rendering', errorCode: undefined, errorMessage: undefined });
    void refreshDigitalHumanJob(source.id, req);
    res.status(202).json({ ok: true, job: publicDigitalHumanJob(resumed) }); return;
  }
  const now = new Date().toISOString();
  const retry: DigitalHumanJob = {
    ...source, id: randomUUID(), parentJobId: source.id, providerTaskId: undefined,
    status: 'queued', stage: 'queued', progress: 0, outputMaterialId: undefined, outputUrl: undefined,
    qualityReport: undefined, errorCode: undefined, errorMessage: undefined, completedAt: undefined,
    versionNumber: source.versionNumber + 1, createdAt: now, updatedAt: now,
  };
  const jobs = loadDigitalHumanJobs(); jobs.push(retry); persistDigitalHumanJobs(jobs);
  void refreshDigitalHumanJob(retry.id, req);
  res.status(202).json({ ok: true, job: publicDigitalHumanJob(retry) });
});

studioRouter.post('/digital-human/jobs/:id/cancel', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const job = loadDigitalHumanJobs().find(item => item.id === req.params.id && item.tenantId === tenantId);
  if (!job) { res.status(404).json({ ok: false, error: '数字人任务不存在' }); return; }
  if (['completed', 'failed', 'review', 'cancelled'].includes(job.status)) { res.status(409).json({ ok: false, error: '该任务当前不可取消' }); return; }
  if (job.provider !== 'heygen' && job.providerTaskId && digitalHumanConfig().baseUrl) {
    void digitalHumanFetch(`${digitalHumanConfig().baseUrl}/v1/jobs/${encodeURIComponent(job.providerTaskId)}/cancel`, { method: 'POST', headers: digitalHumanProviderHeaders() }).catch(() => undefined);
  }
  const cancelled = updateDigitalHumanJob(job.id, { status: 'cancelled', stage: 'cancelled', errorCode: undefined, errorMessage: undefined });
  res.json({ ok: true, job: publicDigitalHumanJob(cancelled) });
});
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function materialSignedUrlTtlSeconds(): number {
  const configured = Number(process.env.MATERIAL_SIGNED_URL_TTL_SECONDS || 900);
  return Number.isFinite(configured) ? Math.max(60, Math.min(3600, configured)) : 900;
}

async function materialResponse(material: Material, tenantId: string): Promise<Material & { canManage: boolean }> {
  const url = material.objectKey
    ? privateStudioAssetUrl('materials', tenantId, path.basename(material.objectKey))
    : /^\/(?:cloud-files|studio-media)\//.test(material.url)
      // Studio workflows often span script, material, music and render steps.
      // Keep the protected playback URL valid for the whole editing session.
      ? signPathAssetUrl(material.url, tenantId, 24 * 60 * 60 * 1000)
      : /^\/(?:media|api\/overseas\/studio\/materials\/pb)\//.test(material.url) ? signAssetUrl(material.url, tenantId) : material.url;
  const poster = material.posterObjectKey
    ? privateStudioAssetUrl('materials', tenantId, path.basename(material.posterObjectKey))
    : material.poster && /^\/(?:cloud-files|studio-media)\//.test(material.poster)
      ? signPathAssetUrl(material.poster, tenantId, 24 * 60 * 60 * 1000)
      : material.poster && /^\/(?:media|api\/overseas\/studio\/materials\/pb)\//.test(material.poster)
        ? signAssetUrl(material.poster, tenantId, 24 * 60 * 60 * 1000)
        : material.poster;
  const segments = await Promise.all((material.segments || []).map(async segment => ({
    ...segment,
    poster: segment.posterObjectKey ? privateStudioAssetUrl('materials', tenantId, path.basename(segment.posterObjectKey)) : segment.poster,
    posterObjectKey: undefined,
  })));
  return { ...material, url: url || material.url, poster, segments, canManage: material.scope !== 'shared' && material.tenantId === tenantId, objectKey: undefined, posterObjectKey: undefined };
}

// Video generation history. A groupKey identifies one logical output slot
// (for example an inspiration video or a storyboard shot); regenerations append
// versions and never replace the previous material.
studioRouter.get('/video-versions', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const groupKey = String(req.query.groupKey || '').trim();
  const projectId = String(req.query.projectId || '').trim();
  if (!groupKey && !projectId) { res.status(400).json({ error: 'groupKey or projectId is required' }); return; }
  const versions = loadVideoVersions()
    .filter(item => item.tenantId === tenantId)
    .filter(item => groupKey ? item.groupKey === groupKey : String(item.context?.projectId || '') === projectId)
    .sort((a, b) => b.versionNumber - a.versionNumber);
  res.json(versions);
});

studioRouter.patch('/video-versions/:id/select', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const list = loadVideoVersions();
  const target = list.find(item => item.id === req.params.id && item.tenantId === tenantId);
  if (!target) { res.status(404).json({ ok: false, error: 'version_not_found' }); return; }
  list.forEach(item => {
    if (item.tenantId === tenantId && item.groupKey === target.groupKey) item.isSelected = item.id === target.id;
  });
  persistVideoVersions(list);
  res.json({ ok: true, version: target });
});

function parseAnalysisRange(value: string, fallbackStart: number, totalDuration: number): { start: number; end: number } {
  const values = Array.from(String(value || '').matchAll(/(\d+(?:\.\d+)?)/g)).map(match => Number(match[1]));
  const start = Math.max(0, Math.min(totalDuration || Number.MAX_SAFE_INTEGER, values[0] ?? fallbackStart));
  const fallbackEnd = start + 3;
  const end = Math.max(start + 0.3, Math.min(totalDuration || fallbackEnd, values[1] ?? fallbackEnd));
  return { start: +start.toFixed(2), end: +end.toFixed(2) };
}

function includesAny(text: string, pattern: RegExp): boolean {
  return pattern.test(String(text || '').toLowerCase());
}

function analysisDetailToSegment(material: Material, detail: NonNullable<Awaited<ReturnType<typeof analyzeVideo>>['scriptDetails15s']>[number], index: number, fallbackStart: number): MaterialSegment {
  const range = parseAnalysisRange(String(detail.time || ''), fallbackStart, material.duration);
  const visual = `${detail.visual || ''} ${detail.observedFacts || ''}`;
  const productVisible = includesAny(visual, /产品|包装|瓶|罐|盒|膏|液|product|package|bottle|jar|tube/);
  const hasPerson = includesAny(visual, /人物|真人|男性|女性|手|脸|眼|皮肤|person|man|woman|hand|face|eye|skin/);
  const ocrText = String(detail.onScreenText || detail.subtitle || '').trim();
  const logoText = Array.from(new Set((ocrText.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) || []).slice(0, 6)));
  const purpose = String(detail.purpose || '').trim();
  const clarity: MaterialSegment['productClarity'] = !productVisible ? 'none'
    : includesAny(`${detail.shot} ${visual}`, /大特写|特写|close-up|清晰|完整/) ? 'high'
    : includesAny(`${detail.shot} ${visual}`, /近景|中近景|medium/) ? 'medium' : 'low';
  return {
    id: `${material.id}-segment-${index + 1}`,
    start: range.start,
    end: range.end,
    duration: +(range.end - range.start).toFixed(2),
    subject: [productVisible ? '产品' : '', hasPerson ? '人物' : ''].filter(Boolean),
    action: String(detail.beats?.map(beat => beat.action).filter(Boolean).join(' → ') || detail.visual || ''),
    productVisible,
    productClarity: clarity,
    shot: String(detail.shot || ''),
    angle: String(detail.angle || ''),
    composition: String(detail.composition || ''),
    camera: String(detail.camera || ''),
    environment: String(detail.environment || ''),
    quality: Math.max(0, Math.min(100, Math.round(Number(detail.confidence ?? 0.7) * 100))),
    ocrText,
    hasPerson,
    hasLogo: logoText.length > 0,
    logoText,
    recommendedFunctions: purpose ? [purpose] : [],
    authenticity: String(detail.authenticity || ''),
    confidence: Math.max(0, Math.min(1, Number(detail.confidence ?? 0.7))),
    needsReview: Boolean(detail.needsReview || !purpose || clarity === 'low'),
  };
}

/** Shared conversion for automated production and the material library. */
export function productionAnalysisSegments(id: string, duration: number, analysis: Awaited<ReturnType<typeof analyzeVideo>>): Array<Record<string, unknown>> {
  let cursor = 0;
  return (analysis.scriptDetails15s || []).map((detail, index) => {
    const segment = analysisDetailToSegment({ id, duration } as Material, detail, index, cursor);
    cursor = segment.end;
    return { ...segment, observedFacts: detail.observedFacts || '' };
  });
}

// GET /studio/materials?scope=shared|own&purpose=library|reference|all
// 默认只返回可剪辑素材；reference 专供对标分析。reference_only 永不进入 shared 公共库。
studioRouter.get('/materials', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const scope = req.query.scope as string | undefined;
  const purpose = String(req.query.purpose || 'library');
  const inventory = await readMaterialLibrary(tenantId);
  let list = inventory.items as Material[];
  if (scope === 'shared') list = list.filter(canAppearInSharedLibrary);
  else if (scope === 'own') list = list.filter(m => (m.scope ?? 'own') === 'own');
  if (purpose === 'reference') list = list.filter(isReferenceOnlyMaterial);
  else if (purpose !== 'all') list = list.filter(m => !isReferenceOnlyMaterial(m));
  const sorted = list.sort((a, b) => (Date.parse(String(b.createdAt || '')) || 0) - (Date.parse(String(a.createdAt || '')) || 0));
  const response = await Promise.all(sorted.map(async m => ({
    ...(await materialResponse(m, tenantId)),
    usage: materialUsage(m),
    ...(['pending','analyzing'].includes(m.segmentAnalysisStatus || '') && !isMaterialAnalysisActive(tenantId,m.id)
      ? {segmentAnalysisStatus:'failed' as const, segmentAnalysisError:'分析任务已中断，请重试以继续处理原片'} : {}),
  })));
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.query.envelope === '1') res.status(inventory.status === 'unavailable' ? 503 : 200).json({ ...inventory, items: response });
  else { res.setHeader('X-Material-Library-Status', inventory.status); res.json(response); }
});

studioRouter.get('/materials/pb/:id/:kind', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const field = req.params.kind === 'poster' ? 'posterFile' : req.params.kind === 'media' ? 'videoFile' : null;
  if (!field) { res.status(404).end(); return; }
  if (!await getCloudMaterialRecord(req.params.id, tenantId)) { res.status(404).end(); return; }
  let upstream = await fetchCloudMaterial(req.params.id, field, req.headers.range, tenantId);
  if (!upstream && field === 'posterFile') {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-material-poster-'));
    const mediaPath = path.join(temporary, 'media');
    const posterPath = path.join(temporary, 'poster.jpg');
    try {
      const media = await fetchCloudMaterial(req.params.id, 'videoFile', undefined, tenantId);
      if (media?.ok) {
        fs.writeFileSync(mediaPath, Buffer.from(await media.arrayBuffer()), { mode: 0o600 });
        if (await extractPoster(mediaPath, posterPath, 1)) {
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'private, max-age=3600');
          res.send(fs.readFileSync(posterPath));
          return;
        }
      }
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
  if (!upstream || !upstream.body) { res.status(404).end(); return; }
  for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }
  res.setHeader('Cache-Control', field === 'posterFile' ? 'private, max-age=86400' : 'private, max-age=3600');
  res.setHeader('Vary', 'Cookie, Authorization');
  res.status(upstream.status);
  Readable.fromWeb(upstream.body as any).pipe(res);
});

function isMockMaterial(m: Material): boolean {
  return (m.scope ?? 'own') === 'shared'
    || /^sh-/.test(m.id)
    || isSyntheticMaterial(m as unknown as Record<string, unknown>);
}

// PocketBase materials.videoFile is 100 MiB. Reject at the HTTP boundary first
// so users never finish a larger upload only to have persistence fail later.
const MAX_MATERIAL_UPLOAD_BYTES = 100 * 1024 * 1024;

function materialUploadFileName(type: Material['type'], mimeType: string): string {
  const id = randomUUID();
  const subtype = mimeType.split('/', 2)[1]?.replace('quicktime', 'mov').replace(/[^a-z0-9]/gi, '');
  const extension = subtype || (type === 'image' ? 'jpg' : type === 'audio' ? 'mp3' : 'mp4');
  return `${id}.${extension}`;
}

async function createTransientMaterialPoster(input: {
  directory: string;
  mediaPath: string;
  type: Material['type'];
  duration: number;
}): Promise<{ name: string; path: string; contentType: string }> {
  const jpgPath = path.join(input.directory, 'poster.jpg');
  if (input.type !== 'audio') {
    const ok = await extractPoster(input.mediaPath, jpgPath, input.type === 'video' && input.duration > 1 ? 1 : 0);
    if (ok && fs.statSync(jpgPath).size <= 5 * 1024 * 1024) {
      return { name: 'poster.jpg', path: jpgPath, contentType: 'image/jpeg' };
    }
    fs.rmSync(jpgPath, { force: true });
  }
  // PocketBase's historical schema requires posterFile for every material.
  // Audio and unreadable/unsupported previews get a tiny neutral placeholder;
  // the original media still remains the sole playback authority.
  const pngPath = path.join(input.directory, 'poster.png');
  fs.writeFileSync(pngPath, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  ));
  return { name: 'poster.png', path: pngPath, contentType: 'image/png' };
}

async function saveMaterialUploadToDatabase(input: {
  tenantId: string;
  name: string;
  folder: string;
  type: Material['type'];
  duration: number;
  width: number;
  height: number;
  usage: string;
  sourceType: string;
  sourceUrl: string;
  mimeType: string;
  mediaName: string;
  mediaPath: string;
  sizeBytes: number;
  sha256: string;
  tempDirectory: string;
}): Promise<Material> {
  const requestedUsage: MaterialUsage = input.usage === 'reference_only'
    || input.sourceType === 'youtube'
    || /youtube\.com|youtu\.be/i.test(input.sourceUrl)
    ? 'reference_only'
    : 'editable';
  const poster = await createTransientMaterialPoster({
    directory: input.tempDirectory,
    mediaPath: input.mediaPath,
    type: input.type,
    duration: input.duration,
  });
  const record = await createCloudMaterial({
    tenantId: input.tenantId,
    title: input.name || input.mediaName,
    folder: input.folder,
    type: input.type,
    duration: Number.isFinite(input.duration) ? Math.max(0, input.duration) : 0,
    width: input.width > 0 ? Math.round(input.width) : undefined,
    height: input.height > 0 ? Math.round(input.height) : undefined,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    scope: 'own',
    usage: requestedUsage,
    sourceType: input.sourceType || 'tenant_upload',
    sourceName: input.name || input.mediaName,
    sourceProvider: 'tenant',
    sourceUrl: input.sourceUrl || undefined,
    provenance: {
      uploadMethod: 'studio_my_materials',
      originalName: input.name || input.mediaName,
      mimeType: input.mimeType,
      receivedAt: new Date().toISOString(),
    },
    media: { name: input.mediaName, path: input.mediaPath, contentType: input.mimeType },
    poster,
  });
  return cloudMaterialView(record) as unknown as Material;
}

// POST /studio/materials/file
// Streams a browser-selected file to an OS temp directory, attaches it to the
// PocketBase materials record, then removes the transient bytes.
studioRouter.post('/materials/file', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const name = String(req.query.name || '').trim();
  const folder = String(req.query.folder || 'upload').trim() || 'upload';
  const type = String(req.query.type || '');
  const duration = Number(req.query.duration || 0);
  const width = Number(req.query.width || 0);
  const height = Number(req.query.height || 0);
  const mimeType = String(req.query.mimeType || req.headers['x-material-mime-type'] || '');
  const usage = String(req.query.usage || '');
  const sourceType = String(req.query.sourceType || '');
  const sourceUrl = String(req.query.sourceUrl || '');
  if (!['video', 'image', 'audio'].includes(type)) {
    res.status(400).json({ ok: false, error: 'invalid type' });
    return;
  }

  const declaredLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MATERIAL_UPLOAD_BYTES) {
    res.status(413).json({ ok: false, error: '单个素材不能超过 100 MB' });
    return;
  }

  const file = materialUploadFileName(type as Material['type'], mimeType);
  const contentType = materialAssetContentType(file, mimeType);
  if (!materialAssetTypeAllowed(contentType)) {
    res.status(415).json({ ok: false, error: 'unsupported material type' });
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-material-upload-'));
  const storedPath = path.join(tempDir, file);

  let bytes = 0;
  const digest = createHash('sha256');
  const sizeLimiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_MATERIAL_UPLOAD_BYTES) {
        const error = Object.assign(new Error('material upload too large'), { code: 'MATERIAL_TOO_LARGE' });
        callback(error);
        return;
      }
      digest.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(req, sizeLimiter, fs.createWriteStream(storedPath, { flags: 'wx' }));
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    const tooLarge = (error as NodeJS.ErrnoException)?.code === 'MATERIAL_TOO_LARGE';
    res.status(tooLarge ? 413 : 400).json({
      ok: false,
      error: tooLarge ? '单个素材不能超过 100 MB' : '素材上传中断，请重试',
    });
    return;
  }
  if (!bytes) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    res.status(400).json({ ok: false, error: '素材文件为空' });
    return;
  }

  try {
    const material = await saveMaterialUploadToDatabase({
      tenantId, name, folder, type: type as Material['type'], duration, width, height,
      usage, sourceType, sourceUrl, mimeType: contentType, mediaName: file,
      mediaPath: storedPath, sizeBytes: bytes, sha256: digest.digest('hex'), tempDirectory: tempDir,
    });
    if (['video', 'image'].includes(material.type) && material.usage !== 'reference_only') {
      void requestMaterialAnalysis(tenantId, material.id).catch(() => {});
    }
    res.status(201).json({ ok: true, material: await materialResponse(material, tenantId) });
  } catch (error) {
    console.error('[materials] database upload failed', error instanceof Error ? error.message : error);
    res.status(503).json({ ok: false, error: '素材数据库暂时不可用，请稍后重试' });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// POST /studio/materials  Body: { name, folder?, type, duration?, dataBase64, mimeType?, scope? } → 上传单个文件
studioRouter.post('/materials', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { name, folder = 'upload', type, duration = 0, width = 0, height = 0, dataBase64, mimeType, usage, sourceType, sourceUrl } = req.body ?? {};
  if (!dataBase64 || !type) { res.status(400).json({ ok: false, error: 'dataBase64 and type required' }); return; }
  if (!['video', 'image', 'audio'].includes(type)) { res.status(400).json({ ok: false, error: 'invalid type' }); return; }

  const file = materialUploadFileName(type, String(mimeType || ''));
  const buf = Buffer.from(String(dataBase64).replace(/^data:[^,]+,/, ''), 'base64');
  const contentType = materialAssetContentType(file, String(mimeType || ''));
  if (!materialAssetTypeAllowed(contentType)) { res.status(415).json({ ok: false, error: 'unsupported material type' }); return; }
  if (!buf.length || buf.length > MAX_MATERIAL_UPLOAD_BYTES) { res.status(413).json({ ok: false, error: 'material must be between 1 byte and 100 MB' }); return; }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-material-upload-'));
  const tempFile = path.join(tempDir, file);
  fs.writeFileSync(tempFile, buf, { mode: 0o600 });

  try {
    const material = await saveMaterialUploadToDatabase({
      tenantId, name: String(name || ''), folder: String(folder || 'upload'), type,
      duration: Number(duration) || 0, width: Number(width) || 0, height: Number(height) || 0,
      usage: String(usage || ''), sourceType: String(sourceType || ''), sourceUrl: String(sourceUrl || ''),
      mimeType: contentType, mediaName: file, mediaPath: tempFile, sizeBytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'), tempDirectory: tempDir,
    });
    if (['video', 'image'].includes(material.type) && material.usage !== 'reference_only') {
      void requestMaterialAnalysis(tenantId, material.id).catch(() => {});
    }
    res.status(201).json({ ok: true, material: await materialResponse(material, tenantId) });
  } catch (error) {
    console.error('[materials] database upload failed', error instanceof Error ? error.message : error);
    res.status(503).json({ ok: false, error: '素材数据库暂时不可用，请稍后重试' });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

studioRouter.post('/materials/:id/analysis', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  try { res.status(202).json({ ok: true, ...(await requestMaterialAnalysis(tenantId, req.params.id, req.body?.retry === true)) }); }
  catch (error) { res.status(409).json({ ok: false, error: error instanceof Error ? error.message : '素材分析无法启动' }); }
});

// POST /studio/materials/:id/analyze-segments
// 按动作/主体/镜头功能切片；截取区间来自实际视频时间轴。
/**
 * 素材片段分析的模型选择。
 *
 * 此前这里直接调 Gemini，绕过了 VIDEO_ANALYSIS_PROVIDER 开关——对标视频分析早已切到千问，
 * 素材分镜却还在打 Gemini，额度耗尽后固定返回 429。改为与视频分析同一套选择逻辑：
 * 默认千问关键帧分析；千问失败时明确报错，不自动切换 Gemini。
 */
export async function analyzeMaterialVideo(videoPath: string, buffer: Buffer, duration: number) {
  if ((process.env.VIDEO_ANALYSIS_PROVIDER || 'qwen').trim().toLowerCase() === 'qwen') {
    const frames = await extractQwenAnalysisFrames(videoPath, 30, duration);
    if (frames.length) {
      const strategy = await analyzeVideoFramesWithQwen({ frames, duration, analysisMode: 'strategy' });
      const strategyQuality = analysisDetailsTimelineQuality(strategy.scriptDetails15s, duration);
      if (strategyQuality.valid) return strategy;
      console.warn(`[studio] 策略档时间轴不合格，改用精确档重试：${strategyQuality.issues.join('；')}`);
      const exact = await analyzeVideoFramesWithQwen({ frames, duration, analysisMode: 'exact' });
      const exactQuality = analysisDetailsTimelineQuality(exact.scriptDetails15s, duration);
      if (exactQuality.valid) return exact;
      throw new Error(`千问素材逐镜分析未达到可匹配标准：${exactQuality.issues.join('；')}`);
    } else {
      throw new Error('素材抽帧为空，无法执行千问分析，请检查视频后重试');
    }
  }
  const gemini = await analyzeVideo({ videoBase64: buffer.toString('base64'), mimeType: 'video/mp4' });
  const geminiQuality = analysisDetailsTimelineQuality(gemini.scriptDetails15s, duration);
  if (!geminiQuality.valid) {
    throw new Error(`素材逐镜分析未达到可匹配标准：${geminiQuality.issues.join('；')}`);
  }
  return gemini;
}

/**
 * 云端素材的片段分析。
 *
 * 本地路径依赖 data/materials.json 与 data/media 下的实体文件，而云端素材两者都没有，
 * 且没有 tenantId 字段，走本地分支必然 404。这里改为：从 PocketBase 取视频 →
 * 分析 → 片段和状态写回同一条记录，让云端素材也能进入分镜匹配池。
 */
async function analyzeCloudMaterialSegments(pbId: string, tenantId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const record = await getOwnedCloudMaterialRecord(pbId, tenantId);
  if (!record) return { status: 404, body: { ok: false, error: 'Material not found' } };
  if (String(record.type || 'video') !== 'video') {
    return { status: 400, body: { ok: false, error: '仅视频素材支持片段分析' } };
  }

  await updateCloudMaterial(pbId, { segmentAnalysisStatus: 'analyzing', segmentAnalysisError: '' });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-material-analysis-'));
  const tempPath = path.join(tempDir, `material-${pbId}.mp4`);
  try {
    const media = await fetchCloudMaterial(pbId, 'videoFile', undefined, tenantId);
    if (!media?.ok) throw new Error('云端素材文件不可读');
    const buffer = Buffer.from(await media.arrayBuffer());
    if (!buffer.length) throw new Error('云端素材文件为空');
    fs.writeFileSync(tempPath, buffer);

    const analysis = await analyzeMaterialVideo(tempPath, buffer, Number(record.duration || 0));
    const details = analysis.scriptDetails15s || [];
    if (!details.length) throw new Error('模型未返回可用的片段时间轴');

    // analysisDetailToSegment 只用到 id 与 duration，构造最小对象即可。
    const material = { id: `pb-${pbId}`, duration: Number(record.duration || 0) } as Material;
    const segments: MaterialSegment[] = [];
    let fallbackStart = 0;
    for (let index = 0; index < details.length; index++) {
      const segment = analysisDetailToSegment(material, details[index]!, index, fallbackStart);
      // Segment metadata is durable; derivative frames are intentionally not
      // mirrored into the application server's data/media directory. The UI
      // can use the material's database-backed poster until PB gains a
      // dedicated multi-file field for per-segment thumbnails.
      segments.push(segment);
      fallbackStart = segment.end;
    }

    const saved = await updateCloudMaterial(pbId, { segments, segmentAnalysisStatus: 'completed', segmentAnalysisError: '' });
    if (!saved) throw new Error('片段写回云端失败');
    return { status: 200, body: { ok: true, materialId: material.id, segments } };
  } catch (error: any) {
    const message = String(error?.message || error || '片段分析失败').slice(0, 500);
    await updateCloudMaterial(pbId, { segmentAnalysisStatus: 'failed', segmentAnalysisError: message });
    return { status: 500, body: { ok: false, error: message } };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

studioRouter.post('/materials/:id/analyze-segments', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  try {
    const material = await waitForMaterialAnalysis(tenantId, req.params.id);
    const responseMaterial = await materialResponse(material as Material, tenantId);
    res.json({ ok: true, material: responseMaterial, segments: responseMaterial.segments });
  } catch (error) {
    res.status(409).json({ ok: false, error: error instanceof Error ? error.message : '素材分析失败' });
  }
});

studioRouter.post('/materials/:id/classify', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const inventory = await readMaterialLibrary(tenantId);
  const material = inventory.items.find(item => item.id === req.params.id && item.tenantId === tenantId && item.scope !== 'shared') as Material | undefined;
  if (!material) { res.status(404).json({ ok: false, error: 'Material not found' }); return; }
  if (material.type !== 'video') { res.status(400).json({ ok: false, error: '仅视频素材支持智能分类' }); return; }
  const cloudId = material.id.startsWith('pb-') ? material.id.slice(3) : '';
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-material-classify-'));
  const mediaPath = cloudId || material.objectKey
    ? path.join(tempDir, `classify${path.extname(material.file) || '.mp4'}`)
    : path.join(MEDIA_DIR, material.file);
  try {
    if (cloudId) {
      const downloaded = await fetchCloudMaterial(cloudId, 'videoFile', undefined, tenantId);
      if (!downloaded?.ok) throw new Error('素材数据库中的原片不可读');
      fs.writeFileSync(mediaPath, Buffer.from(await downloaded.arrayBuffer()), { mode: 0o600 });
    } else if (material.objectKey) {
      const downloaded = await r2Download(material.objectKey);
      if (!downloaded?.buf.length) throw new Error('COS 素材文件不存在');
      fs.writeFileSync(mediaPath, downloaded.buf, { mode: 0o600 });
    }
    const frames = await extractQwenAnalysisFrames(mediaPath, 8, material.duration);
    const classified = await classifyMaterialFramesWithQwen({ name: material.name, frames });
    material.industry = classified.industry;
    material.applicability = classified.applicability;
    material.shotFunction = classified.shotFunctions.join(',');
    material.tags = classified.tags.join(',');
    const changes = { industry: material.industry, applicability: material.applicability, shotFunction: material.shotFunction, tags: material.tags };
    const saved = cloudId ? await updateCloudMaterial(cloudId, changes) : updateLocalMaterial(material.id, tenantId, changes);
    if (!saved) throw new Error('素材分类写回失败');
    res.json({ ok: true, material: await materialResponse(material, tenantId) });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 500) });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// PATCH /studio/materials/:id/segments/:segmentId — 人工修正并确认 AI 片段标签。
studioRouter.patch('/materials/:id/segments/:segmentId', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  try {
    const inventory = await readMaterialLibrary(tenantId);
    const material = inventory.items.find(item => item.id === req.params.id && item.tenantId === tenantId && item.scope !== 'shared');
    const segments = structuredClone(material?.segments || []) as MaterialSegment[];
    const segment = segments.find(item => item.id === req.params.segmentId);
    if (!material || !segment) { res.status(404).json({ok:false,error:'素材片段不存在或不可编辑'}); return; }
    const editable = ['start','end','subject','action','shot','camera','environment','needsReview','manualConfirmed'] as const;
    for (const key of editable) if (key in (req.body || {})) (segment as any)[key] = req.body[key];
    const start = Number(segment.start), end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > Number(material.duration)) {
      res.status(400).json({ok:false,error:'片段时间必须位于原视频范围内'}); return;
    }
    segment.start=start; segment.end=end; segment.duration=end-start;
    if (segment.manualConfirmed === true) { segment.needsReview=false; segment.confidence=Math.max(.65,Math.min(1,Number(segment.confidence)||0)); }
    const saved = material.id.startsWith('pb-')
      ? Boolean(await getOwnedCloudMaterialRecord(material.id.slice(3),tenantId)) && await updateCloudMaterial(material.id.slice(3),{segments})
      : updateLocalMaterial(material.id,tenantId,{segments});
    if (!saved) throw Error('片段修改保存失败');
    res.json({ok:true,material:await materialResponse({...material,segments} as Material,tenantId),segment});
  } catch(error) {res.status(503).json({ok:false,error:error instanceof Error ? error.message : '片段修改失败'});}
});

studioRouter.patch('/materials/:id/pin', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const pinned = req.body?.pinned !== false;
  // 云端素材同样不在 data/materials.json 里，直接写回 PocketBase。
  if (req.params.id.startsWith('pb-')) {
    const pbId = req.params.id.slice(3);
    if (!await getOwnedCloudMaterialRecord(pbId, tenantId)) { res.status(404).json({ ok: false, error: 'Material not found' }); return; }
    const saved = await updateCloudMaterial(pbId, { pinned });
    if (!saved) { res.status(500).json({ ok: false, error: '置顶写回云端失败' }); return; }
    res.json({ ok: true, material: { id: req.params.id, pinned } });
    return;
  }
  const list = loadMaterials();
  const material = list.find(item => item.id === req.params.id && item.tenantId === tenantId);
  if (!material) { res.status(404).json({ ok: false, error: 'Material not found' }); return; }
  material.pinned = pinned;
  persistMaterials(list);
  res.json({ ok: true, material });
});


studioRouter.get('/material-products', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  try {
    const profile = await readTenantEnterpriseProfile(tenantId);
    res.json({items: (profile.products.items || []).map((item,index) => ({id:productIdentity(item,index),name:item.name})).filter(item => item.name)});
  } catch { res.status(503).json({error:'产品资料暂不可读取，请稍后重试'}); }
});

studioRouter.patch('/materials/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  try {
    const inventory = await readMaterialLibrary(tenantId);
    const material = inventory.items.find(item => item.id === req.params.id && item.tenantId === tenantId && item.scope !== 'shared');
    if (!material) { res.status(404).json({ok:false,error:'素材不存在或不可编辑'}); return; }
    const name = String(req.body?.name ?? '').trim().slice(0,120);
    if (!name) { res.status(400).json({ok:false,error:'请填写素材名称'}); return; }
    const changes: Record<string,unknown> = {name};
    if ('tags' in (req.body || {})) changes.tags = String(req.body.tags || '').trim().slice(0,500);
    if ('productId' in (req.body || {})) {
      const id = String(req.body.productId || '');
      const profile = await readTenantEnterpriseProfile(tenantId);
      const product = (profile.products.items || []).find((item,index) => productIdentity(item,index) === id);
      if (id && !product) { res.status(400).json({ok:false,error:'关联产品不在当前企业资料中'}); return; }
      changes.productId = id; changes.productName = product?.name || '';
    }
    const saved = material.id.startsWith('pb-')
      ? Boolean(await getOwnedCloudMaterialRecord(material.id.slice(3), tenantId)) && await updateCloudMaterial(material.id.slice(3), {...changes,title:name})
      : updateLocalMaterial(material.id,tenantId,changes);
    if (!saved) throw Error('素材修改保存失败');
    res.json({ok:true,material:await materialResponse({...material,...changes} as Material,tenantId)});
  } catch (error) { res.status(503).json({ok:false,error:error instanceof Error ? error.message : '素材修改失败'}); }
});

// DELETE /studio/materials/:id
studioRouter.delete('/materials/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  if (req.params.id.startsWith('pb-')) {
    try {
      const result = await deleteOwnedCloudMaterial(req.params.id.slice(3), tenantId);
      if (result === 'not_found') { res.status(404).json({ ok: false, error: 'Material not found' }); return; }
      res.json({ ok: true });
    } catch (error) {
      res.status(503).json({ ok: false, error: error instanceof Error ? error.message : '素材数据库删除失败' });
    }
    return;
  }
  const list = loadMaterials();
  const m = list.find(x => x.id === req.params.id && x.tenantId === tenantId);
  if (!m) { res.status(404).json({ ok: false, error: 'Material not found' }); return; }
  if (m.scope === 'shared') { res.status(403).json({ ok: false, error: 'Shared materials are read-only' }); return; }
  // A social-task upload and its material entry intentionally share one
  // immutable object. Removing it from My Materials must not break the task's
  // auditable file reference; the task owns the bytes until task retention
  // handles them separately.
  const taskBacked = m.sourceType === 'social_task_upload'
    || (Array.isArray((m as Material & { sourceTaskFileRefs?: unknown[] }).sourceTaskFileRefs)
      && (m as Material & { sourceTaskFileRefs?: unknown[] }).sourceTaskFileRefs!.length > 0);
  if (m.objectKey) {
    if (!taskBacked) await r2Delete(m.objectKey).catch(error => console.error('[materials] COS delete failed', error));
  } else try { fs.unlinkSync(path.join(MEDIA_DIR, m.file)); } catch { /* file may be gone */ }
  if (m.posterObjectKey && m.posterObjectKey !== m.objectKey) await r2Delete(m.posterObjectKey).catch(error => console.error('[materials] COS poster delete failed', error));
  if (m.poster && m.poster !== m.url) { try { fs.unlinkSync(path.join(MEDIA_DIR, m.poster.replace(/^\/media\//, ''))); } catch { /* ignore */ } }
  for (const segment of m.segments || []) {
    if (segment.posterObjectKey) await r2Delete(segment.posterObjectKey).catch(error => console.error('[materials] COS segment poster delete failed', error));
    else if (segment.poster) try { fs.unlinkSync(path.join(MEDIA_DIR, segment.poster.replace(/^\/media\//, ''))); } catch { /* ignore */ }
  }
  persistMaterials(list.filter(x => x.id !== req.params.id));
  res.json({ ok: true });
});

/* ── ⑤ 封面图层（零依赖 SVG，作发布缩略图）─────────────────────────────────
   按标题 + 配色（或选中的图片素材作底图）生成一张 9:16 / 1:1 / 16:9 的 SVG 封面，
   浏览器原生渲染、CJK/emoji 可显。作为发布缩略图，ffmpeg 不参与，零栅格化依赖。
─────────────────────────────────────────────────────────────────────────── */

const COVERS_ROOT = path.join(__dirname, '../../data/covers');

function coverResolution(ratio: string): [number, number] {
  if (ratio === '1:1') return [1080, 1080];
  if (ratio === '16:9') return [1920, 1080];
  return [1080, 1920];
}
function xmlEscape(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string));
}
/** 按每行字符预算把标题贪心折成 ≤3 行 */
function wrapTitle(title: string, perLine: number): string[] {
  const words = String(title).trim().split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur.length + 1 + w.length) > perLine) { lines.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
    if (lines.length === 2 && cur.length > perLine) break;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

type CoverFont = 'sans' | 'impact' | 'serif' | 'rounded' | 'mono';
interface CoverStyle {
  color: string;
  size: 'S' | 'M' | 'L';
  position: 'top' | 'center' | 'bottom';
  verticalPosition?: number;
  align: 'left' | 'center';
  font: CoverFont;
  weight?: 'regular' | 'bold' | 'heavy';
  artPreset?: 'clean' | 'outline' | 'highlight' | 'magazine' | 'neon' | 'sticker';
}

// 字体栈用系统字体（SVG 经 <img> 加载无法用网页字体），均带 CJK 回退
const COVER_FONT_STACK: Record<CoverFont, string> = {
  sans:    `'Arial Unicode MS','PingFang SC','Microsoft YaHei',sans-serif`,
  impact:  `'Arial Black','Impact','Heiti SC','Microsoft YaHei',sans-serif`,
  serif:   `'Songti SC','SimSun','Times New Roman',serif`,
  rounded: `'Arial Rounded MT Bold','PingFang SC','Microsoft YaHei',sans-serif`,
  mono:    `'Menlo','Consolas','DejaVu Sans Mono',monospace`,
};

function buildCoverSvg(opts: { title: string; ratio: string; accent: string; bgImageUrl?: string } & Partial<CoverStyle>): string {
  const [w, h] = coverResolution(opts.ratio);
	  const color = opts.color || '#ffffff';
  const size = opts.size || 'M';
  const position = opts.position || 'bottom';
  const align = opts.align || 'left';
  const fontStack = COVER_FONT_STACK[opts.font || 'sans'] || COVER_FONT_STACK.sans;
  const weight = opts.weight === 'regular' ? 600 : opts.weight === 'heavy' ? 900 : opts.font === 'serif' ? 700 : 800;
  const artPreset = opts.artPreset || 'clean';

  const scale = size === 'S' ? 0.062 : size === 'L' ? 0.098 : 0.078;
  const fontSize = Math.round(w * scale);
  const lineH = Math.round(fontSize * 1.18);
  const pad = Math.round(w * 0.045);
  const displayTitle = artPreset === 'magazine' ? String(opts.title || '').toUpperCase() : opts.title || '';
  const lines = wrapTitle(displayTitle, Math.floor(w / (fontSize * 0.6)));
  const totalH = (lines.length - 1) * lineH;

  const requestedVerticalPosition = Number(opts.verticalPosition);
  const verticalPosition = Number.isFinite(requestedVerticalPosition)
    ? Math.max(8, Math.min(92, requestedVerticalPosition))
    : position === 'top' ? 14 : position === 'center' ? 50 : 86;
  const firstBaseline = Math.round(h * verticalPosition / 100 - (fontSize + totalH) / 2 + fontSize * 0.8);

  const anchor = align === 'center' ? 'middle' : 'start';
  const tx = align === 'center' ? Math.round(w / 2) : pad;

	  const bg = opts.bgImageUrl
	    ? `<image href="${xmlEscape(opts.bgImageUrl)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`
	    : `<rect width="${w}" height="${h}" fill="#111827"/>`;

  const half = Math.round(h * 0.5);
  const scrim =
    position === 'top' ? `<rect x="0" y="0" width="${w}" height="${half}" fill="url(#scrimT)"/>`
    : position === 'center' ? `<rect width="${w}" height="${h}" fill="#000" fill-opacity="0.3"/>`
    : `<rect x="0" y="${half}" width="${w}" height="${half}" fill="url(#scrimB)"/>`;

	  const texts = lines.map((ln, i) => {
    const y = firstBaseline + i * lineH;
    const escaped = xmlEscape(ln);
    const estimatedWidth = Math.min(w - pad * 2, Math.max(fontSize * 1.4, ln.length * fontSize * 0.58));
    const rectX = align === 'center' ? Math.round((w - estimatedWidth) / 2) : pad;
    if (artPreset === 'highlight') {
      return `<rect x="${rectX - Math.round(fontSize * 0.12)}" y="${y - Math.round(fontSize * 0.9)}" width="${Math.round(estimatedWidth + fontSize * 0.24)}" height="${Math.round(fontSize * 1.08)}" rx="${Math.round(fontSize * 0.1)}" fill="#facc15"/><text x="${tx}" y="${y}" text-anchor="${anchor}" font-family="${fontStack}" font-size="${fontSize}" font-weight="${weight}" fill="#111827">${escaped}</text>`;
    }
    if (artPreset === 'sticker') {
      return `<text x="${tx + Math.round(fontSize * 0.1)}" y="${y + Math.round(fontSize * 0.1)}" text-anchor="${anchor}" font-family="${fontStack}" font-size="${fontSize}" font-weight="${weight}" fill="#16a34a" stroke="#16a34a" stroke-width="${Math.round(fontSize * 0.15)}" paint-order="stroke fill">${escaped}</text><text x="${tx}" y="${y}" text-anchor="${anchor}" font-family="${fontStack}" font-size="${fontSize}" font-weight="${weight}" fill="#111827" stroke="#fff" stroke-width="${Math.round(fontSize * 0.16)}" paint-order="stroke fill">${escaped}</text>`;
    }
    const strokeWidth = artPreset === 'outline' ? Math.round(fontSize * 0.12) : Math.round(fontSize * 0.04);
    const strokeOpacity = artPreset === 'outline' ? 0.95 : 0.25;
    const filter = artPreset === 'neon' ? ' filter="url(#neonGlow)"' : '';
    const italic = artPreset === 'magazine' ? ' font-style="italic"' : '';
    return `<text x="${tx}" y="${y}" text-anchor="${anchor}" font-family="${fontStack}" font-size="${fontSize}" font-weight="${weight}" fill="${color}" paint-order="stroke" stroke="#000" stroke-opacity="${strokeOpacity}" stroke-width="${strokeWidth}"${filter}${italic}>${escaped}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<defs>
	<linearGradient id="scrimB" x1="0" y1="0" x2="0" y2="1"><stop offset="0.45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.7"/></linearGradient>
<linearGradient id="scrimT" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.7"/><stop offset="0.55" stop-color="#000" stop-opacity="0"/></linearGradient>
<filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="10" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
${bg}
${scrim}
${texts}
</svg>`;
}

/** 把本地 /media 帧文件读成 data URI 内嵌进 SVG（SVG 经 <img> 加载时无法引用外部图片） */
function inlineFrame(bgImageUrl?: string): string | undefined {
  if (!bgImageUrl) return undefined;
  try {
    // 浏览器从视频抽出的静态帧可直接作为封面底图；限制格式和体积，避免任意 data URI 写入。
    if (/^data:image\/(?:jpeg|png|webp);base64,/i.test(bgImageUrl)) {
      return bgImageUrl.length <= 8 * 1024 * 1024 ? bgImageUrl : undefined;
    }
    const tenantId = studioTenantContext.getStore();
    if (!tenantId) return undefined;
    const relative = bgImageUrl.split('?')[0].replace(/^.*\/media\//, '');
    if (!relative.startsWith(`tenants/${tenantId}/`) && !relative.startsWith('shared/')) return undefined;
    const local = path.join(MEDIA_DIR, relative);
    if (!fs.existsSync(local)) return undefined;
    const ext = path.extname(local).slice(1).toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${fs.readFileSync(local).toString('base64')}`;
  } catch { return undefined; }
}

// POST /studio/cover  Body: { title, ratio?, accent?, bgImageUrl?, color?, size?, position?, align? } → { ok, url }
studioRouter.post('/cover', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { title = '', ratio = '9:16', accent = '#d97706', bgImageUrl, color, size, position, verticalPosition, align, font, weight, artPreset } = req.body ?? {};
  try {
    fs.mkdirSync(scopedStudioAssetDir(COVERS_ROOT), { recursive: true });
    const file = `${randomUUID()}.svg`;
	    const dataUri = inlineFrame(bgImageUrl);
      if (!dataUri) {
        res.status(400).json({ ok: false, error: 'cover_frame_required' });
        return;
      }
		    const filePath = path.join(scopedStudioAssetDir(COVERS_ROOT), file);
		    fs.writeFileSync(filePath, buildCoverSvg({ title, ratio, accent, bgImageUrl: dataUri, color, size, position, verticalPosition, align, font, weight, artPreset }), 'utf8');
	    res.json({ ok: true, url: await persistPrivateStudioAsset('covers', tenantId, filePath, 'image/svg+xml'), hasFrame: !!dataUri });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

/* ── 配音 TTS（千问优先 → WAV，租户隔离托管）────────────────────────────
   口播使用所选语音服务，逐句测量后保存实际音频时间轴。
   渲染时由 buildManifest 映射成 voiceover.url，桌面端 ffmpeg 把它压过 BGM 混进成片。
─────────────────────────────────────────────────────────────────────────── */

const TTS_ROOT = path.join(__dirname, '../../data/tts');
const VOICE_SAMPLES_ROOT = path.join(__dirname, '../../data/voice-samples');

function privateStudioAssetUrl(namespace: string, tenantId: string, file: string): string {
  return signAssetUrl(`/api/overseas/studio/private-assets/${namespace}/${path.basename(file)}`, tenantId);
}

async function persistPrivateStudioAsset(namespace: string, tenantId: string, filePath: string, contentType?: string): Promise<string> {
  const file = path.basename(filePath);
  if (!objectStorageEnabled()) return scopedStudioAssetUrl(namespace, file);
  const key = tenantPrivateObjectKey(namespace, tenantId, file);
  await r2Upload({ key, body: fs.readFileSync(filePath), contentType: materialAssetContentType(file, contentType || '') });
  return privateStudioAssetUrl(namespace, tenantId, file);
}

studioRouter.get('/private-assets/:namespace/:file', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const namespace = String(req.params.namespace || '');
  if (!['tts', 'voice-samples', 'covers', 'exports', 'materials'].includes(namespace)) { res.status(404).end(); return; }
  const object = await r2GetObject(tenantPrivateObjectKey(namespace, tenantId, req.params.file), req.headers.range);
  if (!object) { res.status(404).end(); return; }
  res.setHeader('Content-Type', object.contentType);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Accept-Ranges', object.acceptRanges || 'bytes');
  res.setHeader('Content-Disposition', 'inline');
  if (object.contentLength !== undefined) res.setHeader('Content-Length', String(object.contentLength));
  if (object.contentRange) { res.status(206); res.setHeader('Content-Range', object.contentRange); }
  for await (const chunk of object.body) res.write(chunk);
  res.end();
});
interface StoredVoiceSample { voiceId: string; name: string; file: string; duration: number; createdAt: string }
function voiceSampleIndexFile(): string { return path.join(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), 'voice-samples.json'); }
function readVoiceSampleIndex(): StoredVoiceSample[] {
  try { return JSON.parse(fs.readFileSync(voiceSampleIndexFile(), 'utf8')) as StoredVoiceSample[]; } catch { return []; }
}
function writeVoiceSampleIndex(items: StoredVoiceSample[]): void {
  fs.mkdirSync(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), { recursive: true });
  fs.writeFileSync(voiceSampleIndexFile(), JSON.stringify(items, null, 2), 'utf8');
}
function minimaxVoiceCacheFile(): string {
  return path.join(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), 'minimax-voice-cache.json');
}

type TtsPreset = 'tiktok_excited' | 'authentic_review' | 'professional_b2b' | 'warm_story' | 'urgent_cta';
interface TtsStyleOptions {
  preset?: TtsPreset;
  emotion?: string;
  emotionIntensity?: number;
  speed?: number;
  targetDuration?: number;
  pauseStyle?: 'few' | 'natural' | 'dramatic';
  pronunciations?: Array<{ word: string; pronunciation: string }>;
}
interface AlignedWord { text: string; start: number; end: number }
interface AlignedCue { text: string; start: number; end: number; words?: AlignedWord[] }

const TTS_PRESET_GUIDE: Record<TtsPreset, string> = {
  tiktok_excited: 'High-energy TikTok product recommendation. Start with excited surprise, use crisp emphasis and quick but intelligible pacing, then land the CTA strongly.',
  authentic_review: 'Authentic personal product review. Sound conversational, specific and pleasantly surprised, never like a hard-sell announcer.',
  professional_b2b: 'Professional cross-border B2B presenter. Sound confident, credible and restrained, with clear pronunciation of specifications and sourcing terms.',
  warm_story: 'Warm lifestyle storytelling. Use a gentle smile, natural breathing and slightly slower emotional pacing.',
  urgent_cta: 'Conversion-focused call to action. Build urgency without shouting, emphasize the offer and finish decisively.',
};

function normalizeTtsStyle(input: unknown): TtsStyleOptions {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const preset = String(raw.preset || '') as TtsPreset;
  return {
    preset: preset in TTS_PRESET_GUIDE ? preset : 'authentic_review',
    emotion: String(raw.emotion || '自然可信').slice(0, 40),
    emotionIntensity: Math.max(0, Math.min(100, Number(raw.emotionIntensity ?? 65) || 65)),
    speed: Math.max(0.75, Math.min(1.35, Number(raw.speed ?? 1) || 1)),
    targetDuration: Math.max(0, Math.min(180, Number(raw.targetDuration ?? 0) || 0)),
    pauseStyle: raw.pauseStyle === 'few' || raw.pauseStyle === 'dramatic' ? raw.pauseStyle : 'natural',
    pronunciations: Array.isArray(raw.pronunciations) ? raw.pronunciations.slice(0, 20).map(item => {
      const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      return { word: String(row.word || '').trim().slice(0, 60), pronunciation: String(row.pronunciation || '').trim().slice(0, 120) };
    }).filter(item => item.word && item.pronunciation) : [],
  };
}

// 工作台音色 → Qwen3-TTS 系统人声。三种音色均支持中、英等主要语种。
const QWEN_TTS_VOICE_MAP: Record<string, string> = {
  v1: 'Cherry',
  v2: 'Ethan',
  v3: 'Serena',
};

const MINIMAX_VOICE_MAP: Record<string, Record<string, string>> = {
  zh: {
    v1: 'Chinese (Mandarin)_Warm_Bestie',
    v2: 'Chinese (Mandarin)_Reliable_Executive',
    v3: 'Chinese (Mandarin)_Warm_Girl',
  },
  en: {
    v1: 'English_FriendlyPerson',
    v2: 'English_Trustworth_Man',
    v3: 'English_CalmWoman',
  },
  es: {
    v1: 'Spanish_SereneWoman',
    v2: 'Spanish_MaturePartner',
    v3: 'Spanish_ConfidentWoman',
  },
  ar: {
    v1: 'Arabic_CalmWoman',
    v2: 'Arabic_FriendlyGuy',
    v3: 'Arabic_CalmWoman',
  },
  pt: {
    v1: 'Portuguese_SentimentalLady',
    v2: 'Portuguese_Deep-VoicedGentleman',
    v3: 'Portuguese_ConfidentWoman',
  },
  id: {
    v1: 'Indonesian_SweetGirl',
    v2: 'Indonesian_ReservedYoungMan',
    v3: 'Indonesian_CalmWoman',
  },
  fr: {
    v1: 'French_MovieLeadFemale',
    v2: 'French_MaleNarrator',
    v3: 'French_FemaleAnchor',
  },
  de: {
    v1: 'German_SweetLady',
    v2: 'German_FriendlyMan',
    v3: 'German_SweetLady',
  },
};

const SAY_VOICE_MAP: Record<string, string[]> = {
  v1: ['Samantha', 'Ting-Ting'],
  v2: ['Daniel', 'Alex'],
  v3: ['Karen', 'Samantha'],
};

const SAY_LANGUAGE_VOICE_MAP: Record<string, Record<string, string[]>> = {
  zh: {
    v1: ['Ting-Ting', 'Mei-Jia', 'Sin-ji'],
    v2: ['Sin-ji', 'Ting-Ting', 'Mei-Jia'],
    v3: ['Mei-Jia', 'Ting-Ting', 'Sin-ji'],
  },
  en: {
    v1: ['Samantha', 'Karen', 'Moira'],
    v2: ['Daniel', 'Alex', 'Fred'],
    v3: ['Karen', 'Samantha', 'Moira'],
  },
  es: {
    v1: ['Monica', 'Paulina'],
    v2: ['Jorge', 'Juan', 'Diego'],
    v3: ['Paulina', 'Monica'],
  },
  ar: {
    v1: ['Maged'],
    v2: ['Maged'],
    v3: ['Maged'],
  },
  pt: {
    v1: ['Luciana', 'Joana'],
    v2: ['Felipe'],
    v3: ['Joana', 'Luciana'],
  },
  id: {
    v1: ['Damayanti'],
    v2: ['Damayanti'],
    v3: ['Damayanti'],
  },
  fr: {
    v1: ['Amelie', 'Thomas'],
    v2: ['Thomas'],
    v3: ['Amelie'],
  },
  de: {
    v1: ['Anna', 'Markus'],
    v2: ['Markus'],
    v3: ['Anna'],
  },
};

function normalizeTtsLanguage(value: unknown): string {
  return normalizeVideoLanguage(value || 'zh');
}

function piperModelForLanguage(language: string): string {
  const code = normalizeTtsLanguage(language).toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return process.env[`PIPER_MODEL_${code}`] || (normalizeTtsLanguage(process.env.PIPER_LANGUAGE) === normalizeTtsLanguage(language) ? process.env.PIPER_MODEL : '') || '';
}

function piperConfigForLanguage(language: string, modelPath: string): string {
  const code = normalizeTtsLanguage(language).toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return process.env[`PIPER_CONFIG_${code}`] || process.env.PIPER_CONFIG || `${modelPath}.json`;
}

function xttsLanguageCode(language: string): string {
  const code = normalizeTtsLanguage(language);
  if (code === 'zh') return 'zh-cn';
  return code;
}

function minimaxLanguageBoost(language: string): string {
  const code = normalizeTtsLanguage(language);
  const map: Record<string, string> = {
    zh: 'Chinese',
    en: 'English',
    es: 'Spanish',
    ar: 'Arabic',
    pt: 'Portuguese',
    id: 'Indonesian',
    fr: 'French',
    de: 'German',
  };
  return map[code] || 'auto';
}

function minimaxEndpoint(pathname: string): string {
  const base = (process.env.MINIMAX_BASE_URL || 'https://api.minimax.io').replace(/\/+$/, '');
  const url = new URL(`${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`);
  const groupId = process.env.MINIMAX_GROUP_ID || process.env.MINIMAX_GROUPID || '';
  if (groupId) url.searchParams.set(process.env.MINIMAX_GROUP_ID_PARAM || 'GroupId', groupId);
  return url.toString();
}

function minimaxVoiceFor(voice: string, language: string): string {
  const lang = normalizeTtsLanguage(language);
  const envCode = lang.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const voiceCode = String(voice || 'v1').toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return process.env[`MINIMAX_VOICE_${envCode}_${voiceCode}`]
    || process.env[`MINIMAX_VOICE_${voiceCode}`]
    || MINIMAX_VOICE_MAP[lang]?.[voice]
    || MINIMAX_VOICE_MAP.en?.[voice]
    || 'English_FriendlyPerson';
}

interface MinimaxVoiceCacheEntry {
  voiceId: string;
  clonedAt: string;
  activatedAt?: string;
  lastSynthesizedAt?: string;
  lastActivationAttemptAt?: string;
  activationState: 'pending' | 'activated';
  lastError?: string;
}

function readMinimaxVoiceCache(): Record<string, MinimaxVoiceCacheEntry> {
  try {
    const raw = JSON.parse(fs.readFileSync(minimaxVoiceCacheFile(), 'utf8')) as Record<string, string | MinimaxVoiceCacheEntry>;
    return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, typeof value === 'string'
      ? { voiceId: value, clonedAt: '', activationState: 'pending' as const }
      : value]));
  } catch {
    return {};
  }
}

function writeMinimaxVoiceCache(cache: Record<string, MinimaxVoiceCacheEntry>) {
  try {
    fs.mkdirSync(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), { recursive: true });
    fs.writeFileSync(minimaxVoiceCacheFile(), JSON.stringify(cache, null, 2), 'utf8');
  } catch {
    // Cache is only an optimization. If it cannot be written, synthesis can still proceed.
  }
}

function minimaxVoiceCacheKey(voice: string, samplePath: string): string {
  const stat = fs.statSync(samplePath);
  return `${voice}:${stat.mtimeMs}:${stat.size}`;
}

function updateMinimaxVoiceCache(cacheKey: string, patch: Partial<MinimaxVoiceCacheEntry>) {
  const cache = readMinimaxVoiceCache();
  const current = cache[cacheKey];
  if (!current) return;
  cache[cacheKey] = { ...current, ...patch };
  writeMinimaxVoiceCache(cache);
}

function clearMinimaxVoiceCache(cacheKey: string) {
  const cache = readMinimaxVoiceCache();
  if (!cache[cacheKey]) return;
  delete cache[cacheKey];
  writeMinimaxVoiceCache(cache);
}

function minimaxCustomVoiceId(voice: string): string {
  const id = String(voice || '').replace(/^custom:/, '').replace(/[^a-zA-Z0-9_-]/g, '');
  const normalized = `lingshu_${id}`.replace(/[-_]+$/g, '');
  return normalized.length >= 8 ? normalized.slice(0, 120) : `lingshu_${randomUUID().replace(/-/g, '')}`;
}

function bufferFromMinimaxAudio(audio: string, outputFormat: string): Buffer | null {
  const raw = String(audio || '').trim();
  if (!raw) return null;
  if (outputFormat === 'url' || /^https?:\/\//i.test(raw)) return null;
  if (/^[0-9a-f]+$/i.test(raw) && raw.length % 2 === 0) return Buffer.from(raw, 'hex');
  try {
    return Buffer.from(raw.replace(/^data:audio\/[^;]+;base64,/, ''), 'base64');
  } catch {
    return null;
  }
}

function voiceSamplePathFromId(voice: string): string | null {
  const id = String(voice || '').replace(/^custom:/, '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id) return null;
  try {
    const files = fs.readdirSync(scopedStudioAssetDir(VOICE_SAMPLES_ROOT));
    const found = files.find(file => file.startsWith(`${id}.`));
    return found ? path.join(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), found) : null;
  } catch {
    return null;
  }
}

function isNonSpeechSfxText(text: string): boolean {
  const normalized = String(text || '')
    .replace(/[\s"'“”‘’.,，。!！?？~～…·:：;；-]/g, '')
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  if (/^(噗|噗噗|砰|砰砰|咚|咚咚|哒|哒哒|啪|啪啪|嗒|嗒嗒|咔|咔哒|咔嚓|咯吱|嘎吱|吱呀|叮|叮咚|嘀|滴滴|唰|嗖|嗡|嗡嗡|轰|轰隆|沙沙|刷刷)$/i.test(normalized)) return true;
  if (/^(whoosh|swoosh|pop|popop|bang|boom|ding|beep|click|clack|creak|crack|snap|buzz|whirr|rustle)$/i.test(normalized)) return true;
  if (normalized.length <= 4 && /^([\u54c8\u563f\u5566\u5662\u7830\u549a\u53ee\u6ef4\u54d2\u55d2\u556a\u54d7\u55d2\u5530\u55e1\u5431\u5494\u55d2])\1+$/.test(normalized)) return true;
  return false;
}

/** 从脚本里提取可朗读的口语文本（去掉 [Hook]、Scene、Shot/Camera/Visual 等标注） */
function spokenText(script: string): string {
  const out: string[] = [];
  for (let line of String(script || '').split('\n')) {
    line = line.trim();
    if (!line) continue;
    if (/^\[.*\]$/.test(line)) continue;
    line = line.replace(/^\[[^\]]*?\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)?[^\]]*\]\s*/i, '').trim();
    if (!line) continue;
    if (/^scene\s*\d/i.test(line)) continue;
    const vo = line.match(/^(voiceover|vo|台词|人物说|口播)\s*[:：]\s*(.+)$/i);
    if (vo) {
      if (!isNonSpeechSfxText(vo[2])) out.push(vo[2]);
      continue;
    }
    if (/^(shot|camera|visual|music|environment|subtitle|caption|画面|镜头|运镜|景别|环境|配乐|字幕)\s*[:：]/i.test(line)) continue;
    if (!/[：:]/.test(line) && !isNonSpeechSfxText(line)) out.push(line);
  }
  return out.join(' ').slice(0, 1500);
}

/** PCM(16-bit LE) → WAV 容器 */
function wavFromPcm(pcm: Buffer, sampleRate: number, channels = 1, bits = 16): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bits / 8, 28);
  header.writeUInt16LE(channels * bits / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function execFileOk(file: string, args: string[], timeout = 45_000): Promise<boolean> {
  return new Promise(resolve => {
    execFile(file, args, { timeout }, err => resolve(!err));
  });
}

function durationFromText(text: string): number {
  const chars = String(text || '').replace(/\s+/g, '').length;
  return Math.max(2, Math.min(60, Math.ceil(chars / 9)));
}

async function minimaxFetchJson(pathname: string, body: Record<string, unknown>, timeoutMs = 90_000): Promise<any> {
  const apiKey = process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || '';
  if (!apiKey) throw new Error('MINIMAX_API_KEY not set');
  const response = await fetch(minimaxEndpoint(pathname), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`MiniMax HTTP ${response.status}: ${JSON.stringify(json).slice(0, 240)}`);
  const statusCode = Number(json?.base_resp?.status_code ?? 0);
  if (statusCode !== 0) {
    throw new Error(`MiniMax ${statusCode}: ${String(json?.base_resp?.status_msg || 'request failed')}`);
  }
  return json;
}

function minimaxSpeechText(text: string, style: TtsStyleOptions): string {
  const clean = String(text || '').replace(/<#\d+(?:\.\d+)?#>/g, '').trim();
  if (style.pauseStyle === 'few') return clean;
  // Slightly varied pauses sound less metronomic than applying one fixed gap
  // after every comma/full stop. The sequence is deterministic so regenerating
  // the same copy remains predictable.
  const sentencePauses = style.pauseStyle === 'dramatic'
    ? [0.34, 0.46, 0.39, 0.52]
    : [0.18, 0.27, 0.22, 0.31];
  const clausePauses = style.pauseStyle === 'dramatic'
    ? [0.16, 0.24, 0.19]
    : [0.07, 0.13, 0.09];
  let sentenceIndex = 0;
  let clauseIndex = 0;
  return clean
    .replace(/([。！？!?；;])(?=\s*\S)/g, punctuation => {
      const pause = sentencePauses[sentenceIndex++ % sentencePauses.length];
      return `${punctuation}<#${pause.toFixed(2)}#>`;
    })
    .replace(/([，,：:])(?=\s*\S)/g, punctuation => {
      const pause = clausePauses[clauseIndex++ % clausePauses.length];
      return `${punctuation}<#${pause.toFixed(2)}#>`;
    });
}

function minimaxVoiceModify(style: TtsStyleOptions): { pitch: number; intensity: number; timbre: number } {
  const preset = style.preset || 'authentic_review';
  const presetShape: Record<TtsPreset, { pitch: number; timbre: number }> = {
    tiktok_excited: { pitch: 2, timbre: 2 },
    authentic_review: { pitch: 0, timbre: 1 },
    professional_b2b: { pitch: -1, timbre: -2 },
    warm_story: { pitch: -1, timbre: 3 },
    urgent_cta: { pitch: 1, timbre: -1 },
  };
  // Keep modification restrained: large values make speech processed rather
  // than expressive. This makes the UI emotion control affect MiniMax while
  // preserving the selected speaker's identity.
  const intensity = Math.max(-8, Math.min(14, Math.round(((style.emotionIntensity ?? 65) - 50) * 0.35)));
  return { ...presetShape[preset], intensity };
}

function minimaxPronunciationDict(style: TtsStyleOptions): { tone: string[] } | undefined {
  const tone = (style.pronunciations || [])
    .map(item => `${item.word}/${item.pronunciation}`)
    .filter(item => !/[\r\n]/.test(item));
  return tone.length ? { tone } : undefined;
}

async function minimaxSubtitleCues(url: unknown, duration: number): Promise<AlignedCue[]> {
  if (!/^https?:\/\//i.test(String(url || ''))) return [];
  try {
    const response = await fetch(String(url), { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return [];
    const json = await response.json().catch(() => null) as any;
    const rows = Array.isArray(json) ? json
      : [json?.subtitles, json?.subtitle, json?.sentences, json?.words, json?.data].find(Array.isArray) || [];
    const normalized = rows.map((row: any) => {
      const text = String(row?.text ?? row?.word ?? row?.content ?? '').trim();
      const startMs = Number(row?.start_time ?? row?.begin_time ?? row?.start ?? row?.startTime ?? 0);
      const endMs = Number(row?.end_time ?? row?.end ?? row?.endTime ?? startMs);
      return { text, start: Math.max(0, startMs / 1000), end: Math.min(duration, Math.max(startMs + 80, endMs) / 1000) };
    }).filter((row: AlignedCue) => row.text && row.end > row.start);
    return normalized;
  } catch {
    return [];
  }
}

async function generateMinimaxTts(text: string, voiceId: string, language: string, style: TtsStyleOptions = {}): Promise<{ url: string; duration: number; source: string; cues?: AlignedCue[]; alignmentSource?: 'minimax_native' } | null> {
  const apiKey = process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || '';
  if (!apiKey) return null;
  try { fs.mkdirSync(scopedStudioAssetDir(TTS_ROOT), { recursive: true }); } catch { /* ignore */ }
  const format = (process.env.MINIMAX_TTS_FORMAT || 'mp3').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp3';
  const outputFormat = (process.env.MINIMAX_TTS_OUTPUT_FORMAT || 'hex').toLowerCase();
  const sampleRate = Math.min(44100, Math.max(16000, Number(process.env.MINIMAX_TTS_SAMPLE_RATE || 32000) || 32000));
  const bitrate = Math.min(256000, Math.max(32000, Number(process.env.MINIMAX_TTS_BITRATE || 128000) || 128000));
  const speed = Math.min(2, Math.max(0.5, Number(style.speed ?? process.env.MINIMAX_TTS_SPEED ?? 1) || 1));
  const volume = Math.min(10, Math.max(0.1, Number(process.env.MINIMAX_TTS_VOLUME || 1) || 1));
  const pitch = Math.min(12, Math.max(-12, Number(process.env.MINIMAX_TTS_PITCH || 0) || 0));
  const model = process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd';
  const spokenText = minimaxSpeechText(text, style);
  const payload: Record<string, unknown> = {
    model,
    text: spokenText.slice(0, 5000),
    stream: false,
    language_boost: minimaxLanguageBoost(language),
    output_format: outputFormat,
    voice_setting: {
      voice_id: voiceId,
      speed,
      vol: volume,
      pitch,
    },
    voice_modify: minimaxVoiceModify(style),
    audio_setting: {
      sample_rate: sampleRate,
      bitrate,
      format,
      channel: 1,
    },
    ...(minimaxPronunciationDict(style) ? { pronunciation_dict: minimaxPronunciationDict(style) } : {}),
    subtitle_enable: true,
    subtitle_type: 'word',
  };
  const json = await minimaxFetchJson('/v1/t2a_v2', payload, Number(process.env.MINIMAX_TTS_TIMEOUT_MS || 90_000));
  const audio = String(json?.data?.audio || '');
  const remoteUrl = outputFormat === 'url' && /^https?:\/\//i.test(audio) ? audio : '';
  const measuredDuration = Number(json?.extra_info?.audio_length || 0) / 1000;
  const duration = measuredDuration > 0
    ? Math.max(1, Number(measuredDuration.toFixed(3)))
    : durationFromText(text);
  const cues = await minimaxSubtitleCues(json?.data?.subtitle_file, duration);
  if (remoteUrl) return { url: remoteUrl, duration, source: 'minimax', ...(cues.length ? { cues, alignmentSource: 'minimax_native' as const } : {}) };

  const buf = bufferFromMinimaxAudio(audio, outputFormat);
  if (!buf?.length) throw new Error('MiniMax did not return audio data');
  const file = `${randomUUID()}.${format}`;
  fs.writeFileSync(path.join(scopedStudioAssetDir(TTS_ROOT), file), buf);
  return { url: scopedStudioAssetUrl('tts', file), duration, source: 'minimax', ...(cues.length ? { cues, alignmentSource: 'minimax_native' as const } : {}) };
}

async function uploadMinimaxVoiceSample(samplePath: string): Promise<string> {
  const apiKey = process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || '';
  if (!apiKey) throw new Error('MINIMAX_API_KEY not set');
  const ext = path.extname(samplePath).toLowerCase();
  if (!['.mp3', '.m4a', '.wav'].includes(ext)) {
    throw new Error('MiniMax 真人音色录入仅支持 mp3/m4a/wav，请重新上传清晰录音。');
  }
  const buf = fs.readFileSync(samplePath);
  const mime = ext === '.mp3' ? 'audio/mpeg' : ext === '.m4a' ? 'audio/mp4' : 'audio/wav';
  const form = new FormData();
  form.append('purpose', 'voice_clone');
  form.append('file', new Blob([new Uint8Array(buf)], { type: mime }), path.basename(samplePath));
  const response = await fetch(minimaxEndpoint('/v1/files/upload'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(Number(process.env.MINIMAX_UPLOAD_TIMEOUT_MS || 90_000)),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`MiniMax upload HTTP ${response.status}: ${JSON.stringify(json).slice(0, 240)}`);
  const statusCode = Number(json?.base_resp?.status_code ?? 0);
  if (statusCode !== 0) throw new Error(`MiniMax upload ${statusCode}: ${String(json?.base_resp?.status_msg || 'request failed')}`);
  const fileId = String(json?.file?.file_id || '').trim();
  if (!fileId) throw new Error('MiniMax upload did not return file_id');
  return fileId;
}

async function ensureMinimaxClonedVoice(voice: string, language: string): Promise<{ voiceId: string; cacheKey: string } | null> {
  const apiKey = process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || '';
  if (!apiKey) return null;
  const samplePath = voiceSamplePathFromId(voice);
  if (!samplePath) return null;
  const cacheKey = minimaxVoiceCacheKey(voice, samplePath);
  const cache = readMinimaxVoiceCache();
  if (cache[cacheKey]?.voiceId) {
    const existing = cache[cacheKey];
    if (existing.activationState !== 'activated') {
      const attemptedAt = Date.parse(existing.lastActivationAttemptAt || '');
      if (!Number.isFinite(attemptedAt) || Date.now() - attemptedAt > 60 * 60 * 1000) {
        updateMinimaxVoiceCache(cacheKey, { lastActivationAttemptAt: new Date().toISOString() });
        try {
          const activation = await generateMinimaxTts(
            process.env.MINIMAX_ACTIVATION_TEXT || '你好，这是我的品牌授权音色。',
            existing.voiceId,
            language,
            { preset: 'authentic_review', emotion: '自然可信', emotionIntensity: 55, speed: 1 },
          );
          if (activation) {
            const now = new Date().toISOString();
            updateMinimaxVoiceCache(cacheKey, { activationState: 'activated', activatedAt: now, lastSynthesizedAt: now, lastError: undefined });
          }
        } catch (error) {
          updateMinimaxVoiceCache(cacheKey, { lastError: String(error instanceof Error ? error.message : error).slice(0, 240) });
        }
      }
    }
    return { voiceId: existing.voiceId, cacheKey };
  }

  const voiceId = minimaxCustomVoiceId(voice);
  const fileId = await uploadMinimaxVoiceSample(samplePath);
  try {
    await minimaxFetchJson('/v1/voice_clone', {
      file_id: Number(fileId),
      voice_id: voiceId,
      text: process.env.MINIMAX_CLONE_PREVIEW_TEXT || '这是一段用于确认真人音色的试读音频。',
      model: process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
      language_boost: minimaxLanguageBoost(language),
    }, Number(process.env.MINIMAX_CLONE_TIMEOUT_MS || 120_000));
  } catch (error: any) {
    const message = String(error?.message || error);
    if (!/duplicate|already exists|exist|重复/i.test(message)) throw error;
  }
  cache[cacheKey] = {
    voiceId,
    clonedAt: new Date().toISOString(),
    activationState: 'pending',
  };
  writeMinimaxVoiceCache(cache);
  updateMinimaxVoiceCache(cacheKey, { lastActivationAttemptAt: new Date().toISOString() });
  try {
    const activation = await generateMinimaxTts(
      process.env.MINIMAX_ACTIVATION_TEXT || '你好，这是我的品牌授权音色。',
      voiceId,
      language,
      { preset: 'authentic_review', emotion: '自然可信', emotionIntensity: 55, speed: 1 },
    );
    if (activation) {
      const now = new Date().toISOString();
      updateMinimaxVoiceCache(cacheKey, { activationState: 'activated', activatedAt: now, lastSynthesizedAt: now, lastError: undefined });
    }
  } catch (error) {
    updateMinimaxVoiceCache(cacheKey, { lastError: String(error instanceof Error ? error.message : error).slice(0, 240) });
  }
  return { voiceId, cacheKey };
}

function minimaxVoiceNeedsReclone(error: unknown): boolean {
  return /voice[^\n]*(?:not found|does not exist|invalid|expired|deleted)|(?:not found|不存在|已删除|过期)[^\n]*voice|voice_id[^\n]*(?:invalid|不存在)/i.test(String(error instanceof Error ? error.message : error));
}

async function generatePiperTts(text: string, language: string): Promise<{ url: string; duration: number; source: string } | null> {
  const piperBin = process.env.PIPER_BIN || process.env.PIPER_PATH || '';
  const modelPath = piperModelForLanguage(language);
  if (!piperBin || !modelPath) return null;
  try { fs.mkdirSync(scopedStudioAssetDir(TTS_ROOT), { recursive: true }); } catch { /* ignore */ }
  const file = `${randomUUID()}.wav`;
  const outPath = path.join(scopedStudioAssetDir(TTS_ROOT), file);
  const args = ['--model', modelPath, '--output_file', outPath];
  const configPath = piperConfigForLanguage(language, modelPath);
  if (configPath && fs.existsSync(configPath)) args.splice(2, 0, '--config', configPath);
  const spoken = text.slice(0, 1500);
  const ok = await new Promise<boolean>(resolve => {
    const child = spawn(piperBin, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve(false);
    }, 60_000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve(code === 0 && fs.existsSync(outPath));
    });
    child.stdin.end(spoken);
  });
  return ok ? { url: scopedStudioAssetUrl('tts', file), duration: durationFromText(text), source: 'piper' } : null;
}

async function generateXttsCloneTts(text: string, voice: string, language: string): Promise<{ url: string; duration: number; source: string } | null> {
  const samplePath = voiceSamplePathFromId(voice);
  const xttsBin = process.env.XTTS_BIN || process.env.COQUI_TTS_BIN || '';
  if (!samplePath || !xttsBin) return null;
  try { fs.mkdirSync(scopedStudioAssetDir(TTS_ROOT), { recursive: true }); } catch { /* ignore */ }
  const file = `${randomUUID()}.wav`;
  const outPath = path.join(scopedStudioAssetDir(TTS_ROOT), file);
  const modelName = process.env.XTTS_MODEL_NAME || 'tts_models/multilingual/multi-dataset/xtts_v2';
  const args = [
    '--model_name', modelName,
    '--text', text.slice(0, 1500),
    '--speaker_wav', samplePath,
    '--language_idx', xttsLanguageCode(language),
    '--out_path', outPath,
  ];
  const ok = await new Promise<boolean>(resolve => {
    const child = spawn(xttsBin, args, { stdio: ['ignore', 'ignore', 'ignore'] });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve(false);
    }, Number(process.env.XTTS_TIMEOUT_MS || 120_000));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve(code === 0 && fs.existsSync(outPath));
    });
  });
  return ok ? { url: scopedStudioAssetUrl('tts', file), duration: durationFromText(text), source: 'xtts_clone' } : null;
}

async function generateLocalSayTts(text: string, voice: string, language: string): Promise<{ url: string; duration: number; source: string } | null> {
  if (process.platform !== 'darwin') return null;
  try { fs.mkdirSync(scopedStudioAssetDir(TTS_ROOT), { recursive: true }); } catch { /* ignore */ }
  const base = randomUUID();
  const aiffFile = `${base}.aiff`;
  const wavFile = `${base}.wav`;
  const aiffPath = path.join(scopedStudioAssetDir(TTS_ROOT), aiffFile);
  const wavPath = path.join(scopedStudioAssetDir(TTS_ROOT), wavFile);
  const lang = normalizeTtsLanguage(language);
  const candidates = SAY_LANGUAGE_VOICE_MAP[lang]?.[voice] ?? [];
  const spoken = text.slice(0, 1500);

  let made = false;
  for (const candidate of candidates) {
    made = await execFileOk('/usr/bin/say', ['-v', candidate, '-o', aiffPath, spoken]);
    if (made && fs.existsSync(aiffPath)) break;
  }
  // Never fall back to the system's unrelated default language.
  if (!made || !fs.existsSync(aiffPath)) return null;

  const converted = await runFfmpeg(['-i', aiffPath, '-ar', '24000', '-ac', '1', '-y', wavPath]);
  try { fs.unlinkSync(aiffPath); } catch { /* ignore */ }
  if (converted && fs.existsSync(wavPath)) {
    return { url: scopedStudioAssetUrl('tts', wavFile), duration: durationFromText(text), source: 'local_say' };
  }
  return { url: scopedStudioAssetUrl('tts', aiffFile), duration: durationFromText(text), source: 'local_say' };
}

function qwenTtsLanguageType(language: string): string {
  const map: Record<string, string> = {
    zh: 'Chinese', en: 'English', es: 'Spanish', pt: 'Portuguese',
    fr: 'French', de: 'German', ja: 'Japanese', ko: 'Korean',
    ru: 'Russian', it: 'Italian',
  };
  return map[normalizeTtsLanguage(language)] || '';
}

function wavDurationFromBytes(bytes: Buffer): number {
  if (bytes.length < 44 || bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WAVE') return 0;
  const byteRate = bytes.readUInt32LE(28);
  if (!byteRate) return 0;
  const dataMarker = bytes.indexOf(Buffer.from('data'), 12);
  const dataStart = dataMarker >= 0 ? dataMarker + 8 : 44;
  return Math.max(0, (bytes.length - dataStart) / byteRate);
}

function friendlyTtsProviderError(value: unknown, provider = '语音服务'): string {
  const message = String(value instanceof Error ? value.message : value || '').trim();
  if (/arrears|recharge|past due|overdue|欠费|充值/i.test(message)) {
    return `${provider}账户欠费，暂时无法生成口播。请为该 API Key 所属账户充值，或改用“上传口播”。`;
  }
  if (/quota|insufficient|balance|credit|resource_exhausted|额度|余额/i.test(message)) {
    return `${provider}额度或余额不足，暂时无法生成口播。请补充额度，或改用“上传口播”。`;
  }
  if (/401|403|unauthorized|forbidden|api.?key|permission|鉴权|权限/i.test(message)) {
    return `${provider}鉴权失败。请检查 API Key 与模型调用权限，或改用“上传口播”。`;
  }
  return message || `${provider}暂时不可用，请稍后重试或改用“上传口播”。`;
}

async function generateQwenTts(text: string, voice: string, language: string): Promise<{ url: string; duration: number; source: string } | null> {
  if (!qwenTtsLanguageType(language)) return null;
  const apiKey = String(process.env.DASHSCOPE_API_KEY || '').trim();
  if (!apiKey) return null;
  const endpoint = process.env.DASHSCOPE_TTS_ENDPOINT
    || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.QWEN_TTS_MODEL || 'qwen3-tts-flash',
      input: {
        text: text.slice(0, 5000),
        voice: process.env[`QWEN_TTS_VOICE_${String(voice || 'v1').toUpperCase()}`] || QWEN_TTS_VOICE_MAP[voice] || 'Cherry',
        language_type: qwenTtsLanguageType(language),
      },
    }),
    signal: AbortSignal.timeout(Number(process.env.QWEN_TTS_TIMEOUT_MS || 90_000)),
  });
  const json = await response.json().catch(() => ({} as any)) as any;
  if (!response.ok || json?.code) {
    throw new Error(friendlyTtsProviderError(`${json?.code || `HTTP ${response.status}`}: ${String(json?.message || 'request failed').slice(0, 240)}`, 'DashScope 语音服务'));
  }
  const remoteUrl = String(json?.output?.audio?.url || '').trim();
  if (!/^https?:\/\//i.test(remoteUrl)) throw new Error('Qwen TTS did not return an audio URL');
  const audioResponse = await fetch(remoteUrl, { signal: AbortSignal.timeout(Number(process.env.QWEN_TTS_DOWNLOAD_TIMEOUT_MS || 60_000)) });
  if (!audioResponse.ok) throw new Error(`Qwen TTS audio download HTTP ${audioResponse.status}`);
  const bytes = Buffer.from(await audioResponse.arrayBuffer());
  if (bytes.length < 1000) throw new Error('Qwen TTS returned empty audio');
  try { fs.mkdirSync(scopedStudioAssetDir(TTS_ROOT), { recursive: true }); } catch { /* ignore */ }
  const base = randomUUID();
  const file = `${base}.wav`;
  const wavPath = path.join(scopedStudioAssetDir(TTS_ROOT), file);
  let measuredDuration = wavDurationFromBytes(bytes);
  if (measuredDuration >= 0.5) {
    fs.writeFileSync(wavPath, bytes);
  } else {
    const contentType = String(audioResponse.headers.get('content-type') || '').toLowerCase();
    let sourceExt = '.bin';
    if (/mpeg|mp3/.test(contentType)) sourceExt = '.mp3';
    else if (/mp4|m4a/.test(contentType)) sourceExt = '.m4a';
    else if (/ogg/.test(contentType)) sourceExt = '.ogg';
    else if (/aac/.test(contentType)) sourceExt = '.aac';
    else if (/webm/.test(contentType)) sourceExt = '.webm';
    else {
      try {
        const remoteExt = path.extname(new URL(remoteUrl).pathname).toLowerCase();
        if (/^\.(mp3|m4a|mp4|ogg|aac|webm|wav)$/.test(remoteExt)) sourceExt = remoteExt;
      } catch { /* keep generic extension; ffmpeg probes the byte stream */ }
    }
    const sourcePath = path.join(scopedStudioAssetDir(TTS_ROOT), `${base}${sourceExt}`);
    fs.writeFileSync(sourcePath, bytes);
    const converted = await runFfmpeg(['-i', sourcePath, '-ar', '24000', '-ac', '1', '-y', wavPath]);
    try { fs.unlinkSync(sourcePath); } catch { /* ignore */ }
    if (!converted || !fs.existsSync(wavPath)) throw new Error('Qwen TTS returned an unsupported audio format');
    measuredDuration = wavDurationFromBytes(fs.readFileSync(wavPath));
  }
  if (measuredDuration < 0.5) {
    try { fs.unlinkSync(wavPath); } catch { /* ignore */ }
    throw new Error('Qwen TTS returned invalid audio');
  }
  return {
    url: scopedStudioAssetUrl('tts', file),
    duration: Math.max(1, Number(measuredDuration.toFixed(3))),
    source: 'qwen_tts',
  };
}

type CachedTtsResult = Awaited<ReturnType<typeof generateTtsAudioUncached>>;
const inFlightTts = new Map<string,Promise<CachedTtsResult>>();
async function generateTtsAudio(spoken: string, voice: string, language = 'zh', style: TtsStyleOptions = {}): Promise<CachedTtsResult> {
  const tenantId = studioTenantContext.getStore();
  // Custom voice lifecycle is managed by the clone registry, not a text cache.
  if (!tenantId || voice.startsWith('custom:')) return generateTtsAudioUncached(spoken,voice,language,style);
  const key = createHash('sha256').update(JSON.stringify([tenantId,spoken,voice,language,normalizeTtsStyle(style),process.env.QWEN_TTS_MODEL || 'qwen3-tts-flash',process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',process.env[`QWEN_TTS_VOICE_${voice.toUpperCase()}`],minimaxVoiceFor(voice,language)])).digest('hex');
  const dir = tenantAssetDir(TTS_ROOT,tenantId);
  const cacheFile = path.join(dir,`sentence-${key}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile,'utf8')) as CachedTtsResult;
    const file = cached.url ? path.join(dir,path.basename(new URL(cached.url,'http://local').pathname)) : '';
    if (cached.ok && ['qwen_tts','minimax'].includes(cached.source) && file && fs.existsSync(file) && fs.statSync(file).size > 44) return cached;
  } catch { /* missing/invalid cache is regenerated */ }
  const existing = inFlightTts.get(key); if(existing) return existing;
  const pending = generateTtsAudioUncached(spoken,voice,language,style).then(result=>{
    if(result.ok && ['qwen_tts','minimax'].includes(result.source)) {
      fs.mkdirSync(dir,{recursive:true});const tmp=cacheFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(result),{mode:0o600});fs.renameSync(tmp,cacheFile);
    }
    return result;
  }).finally(()=>inFlightTts.delete(key));
  inFlightTts.set(key,pending);return pending;
}

async function generateTtsAudioUncached(spoken: string, voice: string, language = 'zh', style: TtsStyleOptions = {}): Promise<{ ok: boolean; source: string; url?: string; duration?: number; error?: string; customVoiceStatus?: 'activated'; cues?: AlignedCue[]; alignmentSource?: 'minimax_native' }> {
  if (spoken.length > 5000) return { ok: false, source: 'text_too_long', error: '口播超过 5000 字符，请拆分视频；配音不会截断正文。' };
  if (!(normalizeTtsLanguage(language) in VIDEO_LANGUAGES)) return { ok: false, source: 'unsupported_language', error: '当前不支持此配音语言，请重新选择；不会改用中文。' };
  if (String(voice || '').startsWith('custom:')) {
    let minimaxError = '';
    try {
      let clonedVoice = await ensureMinimaxClonedVoice(voice, language);
      if (clonedVoice) {
        let minimax: Awaited<ReturnType<typeof generateMinimaxTts>> = null;
        try {
          minimax = await generateMinimaxTts(spoken, clonedVoice.voiceId, language, style);
        } catch (error) {
          if (!minimaxVoiceNeedsReclone(error)) throw error;
          clearMinimaxVoiceCache(clonedVoice.cacheKey);
          clonedVoice = await ensureMinimaxClonedVoice(voice, language);
          if (!clonedVoice) throw error;
          minimax = await generateMinimaxTts(spoken, clonedVoice.voiceId, language, style);
        }
        if (minimax) {
          const now = new Date().toISOString();
          updateMinimaxVoiceCache(clonedVoice.cacheKey, {
            activationState: 'activated',
            activatedAt: now,
            lastSynthesizedAt: now,
            lastError: undefined,
          });
          return { ok: true, ...minimax, customVoiceStatus: 'activated' };
        }
      }
    } catch (e: any) {
      minimaxError = String(e?.message ?? e).slice(0, 240);
    }
    const cloned = await generateXttsCloneTts(spoken, voice, language);
    if (cloned) return { ok: true, ...cloned, error: minimaxError };
    return {
      ok: false,
      source: 'custom_voice_unavailable',
      error: minimaxError
        ? `已录入真人音色，但 MiniMax 克隆/合成失败：${minimaxError}。若要本地兜底，请配置 XTTS/Coqui（XTTS_BIN/COQUI_TTS_BIN）。`
        : '已录入真人音色，但后端未配置 MiniMax（MINIMAX_API_KEY）或 XTTS/Coqui 音色克隆引擎，无法用该音色合成。',
    };
  }
  let aiError = '';

  try {
    const qwen = await generateQwenTts(spoken, voice, language);
    if (qwen) return { ok: true, ...qwen };
  } catch (e: any) {
    aiError = friendlyTtsProviderError(e, 'DashScope 语音服务').slice(0, 240);
  }

  try {
    const minimaxVoiceId = minimaxVoiceFor(voice, language);
    const minimax = await generateMinimaxTts(spoken, minimaxVoiceId, language, style);
    if (minimax) return { ok: true, ...minimax };
  } catch (e: any) {
    aiError = [aiError, friendlyTtsProviderError(e, 'MiniMax 语音服务').slice(0, 240)].filter(Boolean).join('；');
  }

  const piper = await generatePiperTts(spoken, language);
  if (piper) return { ok: true, ...piper, error: aiError };

  const local = await generateLocalSayTts(spoken, voice, language);
  if (local) return { ok: true, ...local, error: aiError };

  return {
    ok: false,
    source: 'tts_unavailable',
    error: aiError || '没有可用的真人语音合成服务，请检查 DashScope、MiniMax 或本地 TTS 配置。',
  };
}

function splitSubtitleText(text: string): string[] {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const sentences = normalized.match(/[^。！？!?；;,.，]+[。！？!?；;,.，]?/g)?.map(item => item.trim()).filter(Boolean) || [normalized];
  const result: string[] = [];
  for (const sentence of sentences) {
    const max = /[\u3400-\u9fff]/.test(sentence) ? 16 : 42;
    if (sentence.length <= max) { result.push(sentence); continue; }
    for (let cursor = 0; cursor < sentence.length; cursor += max) result.push(sentence.slice(cursor, cursor + max));
  }
  return result;
}

function proportionalCues(text: string, duration: number): AlignedCue[] {
  const parts = splitSubtitleText(text);
  const totalWeight = parts.reduce((sum, item) => sum + Math.max(1, item.replace(/\s/g, '').length), 0) || 1;
  let cursor = 0;
  return parts.map((item, index) => {
    const start = cursor;
    const end = index === parts.length - 1
      ? duration
      : Math.min(duration, start + duration * Math.max(1, item.replace(/\s/g, '').length) / totalWeight);
    cursor = end;
    return { text: item, start: +start.toFixed(2), end: +Math.max(start + 0.2, end).toFixed(2) };
  });
}

function localTtsFile(url?: string): { bytes: Buffer; mimeType: string; filePath: string } | null {
  if (!url || (!url.startsWith('/tts/') && !url.includes('/private-assets/tts/'))) return null;
  const filePath = path.join(scopedStudioAssetDir(TTS_ROOT), path.basename(new URL(url, 'http://local').pathname));
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.mp3' ? 'audio/mpeg'
    : ext === '.m4a' || ext === '.mp4' ? 'audio/mp4'
      : ext === '.ogg' ? 'audio/ogg'
        : ext === '.webm' ? 'audio/webm'
          : ext === '.aac' ? 'audio/aac'
            : 'audio/wav';
  return { bytes: fs.readFileSync(filePath), mimeType, filePath };
}

function studioAudioCapabilities() {
  const minimax = Boolean((process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || '').trim());
  const xtts = Boolean((process.env.XTTS_BIN || process.env.COQUI_TTS_BIN || '').trim());
  const qwen = Boolean(process.env.DASHSCOPE_API_KEY?.trim());
  return {
    languages: Object.entries(VIDEO_LANGUAGES).map(([code, label]) => ({ code, label, available: Boolean(minimax || (qwen && qwenTtsLanguageType(code)) || process.env[`PIPER_MODEL_${code.toUpperCase()}`]), reason: '需配置支持此语言的配音服务' })),
    customVoice: {
      upload: true,
      synthesis: minimax || xtts,
      engines: { minimax, xtts },
      message: minimax || xtts
        ? `真人音色合成可用（${minimax ? 'MiniMax' : 'XTTS/Coqui'}）`
        : '可以保存声音样本，但服务器尚未配置 MiniMax 或 XTTS/Coqui，暂不能用该音色生成配音。',
    },
    minimax: {
      configured: minimax,
      baseUrl: process.env.MINIMAX_BASE_URL || 'https://api.minimax.io',
      model: process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
      diagnosticAvailable: minimax,
    },
    subtitles: {
      automatic: true,
      audioTranscription: qwen,
      wordAlignment: false,
      fallback: 'proportional',
    },
  };
}

studioRouter.get('/tts/capabilities', (_req, res) => {
  res.json({ ok: true, ...studioAudioCapabilities() });
});

// POST /studio/tts/minimax/diagnose → validates key/network without synthesizing billable audio.
studioRouter.post('/tts/minimax/diagnose', async (_req, res) => {
  const configured = Boolean((process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN || '').trim());
  if (!configured) {
    res.status(503).json({ ok: false, configured: false, error: 'MINIMAX_API_KEY 未配置。' });
    return;
  }
  const startedAt = Date.now();
  try {
    const result = await minimaxFetchJson('/v1/get_voice', { voice_type: 'all' }, 20_000);
    const clonedVoices = Array.isArray(result?.voice_cloning) ? result.voice_cloning.length : 0;
    res.json({
      ok: true,
      configured: true,
      latencyMs: Date.now() - startedAt,
      model: process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
      clonedVoices,
      message: `MiniMax Key 与网络正常，当前账号可查询到 ${clonedVoices} 个已激活克隆音色。`,
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      configured: true,
      latencyMs: Date.now() - startedAt,
      error: String(error instanceof Error ? error.message : error).slice(0, 300),
    });
  }
});

async function alignTtsAudio(transcript: string, url: string | undefined, duration: number): Promise<{ cues: AlignedCue[]; source: 'audio_ai' }> {
  if (!url || !localTtsFile(url)) throw Error('找不到当前企业的配音文件');
  const tenantId = studioTenantContext.getStore()!;
  const file = path.join(tenantAssetDir(TTS_ROOT, tenantId), path.basename(new URL(url, 'http://local').pathname));
  try {
    const cached = JSON.parse(fs.readFileSync(file + '.alignment.json', 'utf8'));
    if (cached.text === transcript && cached.cues?.length) return { cues: cached.cues, source: 'audio_ai' };
  } catch {}
  if (!objectStorageEnabled()) throw Error('该音频需要真实对齐。请重新生成句级配音，或配置私有对象存储后使用千问音频对齐');
  await persistPrivateStudioAsset('tts', tenantId, file);
  const signed = await r2SignedGetUrl(tenantPrivateObjectKey('tts', tenantId, path.basename(file)), 15 * 60);
  return { cues: await alignQwenFile(signed, transcript, duration, file + '.asr.json'), source: 'audio_ai' };
}

async function rewriteVoiceoverToDuration(text: string, language: string, currentDuration: number, targetDuration: number): Promise<string> {
  const targetChars = Math.max(8, Math.round(text.replace(/\s/g, '').length * targetDuration / Math.max(1, currentDuration)));
  const prompt = `Rewrite this spoken short-video voiceover to fit about ${targetDuration} seconds and approximately ${targetChars} non-space characters at normal speech speed. Language: ${langName(language)}. Preserve every verified product fact, brand name, number and CTA. Do not invent claims. Keep the same emotional arc. Output only the revised spoken copy, without labels, timestamps, quotation marks or explanation.\n\n${text}`;
  try {
    const rewritten = (await callLLM(prompt, { backend: 'qwen', model: 'qwen-plus' })).trim();
    return rewritten || text;
  } catch {
    return text;
  }
}

const LATIN_VOICEOVER_LANGUAGES = new Set([
  'en', 'es', 'fr', 'de', 'pt', 'it', 'id', 'vi', 'tr', 'nl', 'pl', 'sv',
  'fil', 'ms', 'cs', 'ro', 'hu',
]);
const HAN_SCRIPT_RE = /[\u3400-\u9fff]/;
const KANA_SCRIPT_RE = /[\u3040-\u30ff]/;
const HANGUL_SCRIPT_RE = /[\uac00-\ud7af]/;
const ARABIC_SCRIPT_RE = /[\u0600-\u06ff]/;
const DEVANAGARI_SCRIPT_RE = /[\u0900-\u097f]/;
const THAI_SCRIPT_RE = /[\u0e00-\u0e7f]/;
const CYRILLIC_SCRIPT_RE = /[\u0400-\u04ff]/;
const NON_LATIN_VOICEOVER_SCRIPT_RE = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f\u0400-\u04ff]/;

function latinWordCount(value: string): number {
  return String(value || '').match(/[A-Za-zÀ-ž]+(?:[-'][A-Za-zÀ-ž]+)*/g)?.length || 0;
}

/**
 * Detects script-family mismatches before TTS. Brand names and model numbers
 * may stay in Latin characters, but a complete sentence in another writing
 * system must never be read as if it belonged to the selected language.
 */
export function voiceoverLineNeedsLanguageRepair(value: string, targetLanguage: string): boolean {
  const line = String(value || '').trim();
  if (!line) return false;
  const target = String(targetLanguage || 'en').toLowerCase();
  if (LATIN_VOICEOVER_LANGUAGES.has(target)) return NON_LATIN_VOICEOVER_SCRIPT_RE.test(line);
  if (target === 'zh') {
    return !HAN_SCRIPT_RE.test(line)
      && (latinWordCount(line) >= 3 || KANA_SCRIPT_RE.test(line) || HANGUL_SCRIPT_RE.test(line)
        || ARABIC_SCRIPT_RE.test(line) || DEVANAGARI_SCRIPT_RE.test(line)
        || THAI_SCRIPT_RE.test(line) || CYRILLIC_SCRIPT_RE.test(line));
  }
  if (target === 'ja') return HANGUL_SCRIPT_RE.test(line) || ARABIC_SCRIPT_RE.test(line)
    || DEVANAGARI_SCRIPT_RE.test(line) || THAI_SCRIPT_RE.test(line) || CYRILLIC_SCRIPT_RE.test(line);
  if (target === 'ko') return KANA_SCRIPT_RE.test(line) || ARABIC_SCRIPT_RE.test(line)
    || DEVANAGARI_SCRIPT_RE.test(line) || THAI_SCRIPT_RE.test(line) || CYRILLIC_SCRIPT_RE.test(line);
  if (target === 'ar') return HAN_SCRIPT_RE.test(line) || KANA_SCRIPT_RE.test(line)
    || HANGUL_SCRIPT_RE.test(line) || DEVANAGARI_SCRIPT_RE.test(line)
    || THAI_SCRIPT_RE.test(line) || CYRILLIC_SCRIPT_RE.test(line)
    || (!ARABIC_SCRIPT_RE.test(line) && latinWordCount(line) >= 3);
  if (target === 'ru' || target === 'uk') return HAN_SCRIPT_RE.test(line) || KANA_SCRIPT_RE.test(line)
    || HANGUL_SCRIPT_RE.test(line) || ARABIC_SCRIPT_RE.test(line)
    || DEVANAGARI_SCRIPT_RE.test(line) || THAI_SCRIPT_RE.test(line)
    || (!CYRILLIC_SCRIPT_RE.test(line) && latinWordCount(line) >= 3);
  if (target === 'hi') return HAN_SCRIPT_RE.test(line) || KANA_SCRIPT_RE.test(line)
    || HANGUL_SCRIPT_RE.test(line) || ARABIC_SCRIPT_RE.test(line)
    || THAI_SCRIPT_RE.test(line) || CYRILLIC_SCRIPT_RE.test(line)
    || (!DEVANAGARI_SCRIPT_RE.test(line) && latinWordCount(line) >= 3);
  if (target === 'th') return HAN_SCRIPT_RE.test(line) || KANA_SCRIPT_RE.test(line)
    || HANGUL_SCRIPT_RE.test(line) || ARABIC_SCRIPT_RE.test(line)
    || DEVANAGARI_SCRIPT_RE.test(line) || CYRILLIC_SCRIPT_RE.test(line)
    || (!THAI_SCRIPT_RE.test(line) && latinWordCount(line) >= 3);
  return false;
}

export function splitVoiceoverLanguageLines(value: string): string[] {
  return String(value || '')
    .split(/\n+/)
    .flatMap(line => line.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [line])
    .map(line => line.trim())
    .filter(Boolean);
}

async function repairVoiceoverTargetLanguage(spoken: string, language: string): Promise<string> {
  const lines = splitVoiceoverLanguageLines(spoken);
  const repairIndexes = lines
    .map((line, index) => voiceoverLineNeedsLanguageRepair(line, language) ? index : -1)
    .filter(index => index >= 0);
  if (!repairIndexes.length) return spoken;

  const target = String(language || 'en').toLowerCase();
  const prompt = `You are a strict multilingual voiceover editor.

Translate every numbered line below into ${langName(target)}.
Return ONLY valid JSON: {"lines":["translation 1","translation 2"]}.
The lines array must contain exactly ${repairIndexes.length} non-empty strings in the same order.
Preserve verified brand names, product models, numbers, units and the CTA action meaning.
Do not add claims, explanations, markdown, timestamps or quotation marks.
Every returned line must be fully in ${langName(target)} except for proper nouns and product identifiers.

${repairIndexes.map((lineIndex, index) => `${index + 1}. ${lines[lineIndex]}`).join('\n')}`;
  const raw = await callLLM(prompt, { backend: 'qwen', model: 'qwen-plus' });
  const parsed = extractJSON<{ lines?: unknown[] } | unknown[]>(raw);
  const repairedLines = Array.isArray(parsed) ? parsed : parsed?.lines;
  if (!Array.isArray(repairedLines) || repairedLines.length !== repairIndexes.length) {
    throw new Error(`千问未返回完整的${langName(target)}逐句译文，已停止生成配音`);
  }

  const next = [...lines];
  for (let index = 0; index < repairIndexes.length; index += 1) {
    const repaired = String(repairedLines[index] || '').trim();
    if (!repaired || voiceoverLineNeedsLanguageRepair(repaired, target)) {
      throw new Error(`千问返回的第 ${index + 1} 句仍不符合${langName(target)}，已停止生成配音`);
    }
    next[repairIndexes[index]!] = repaired;
  }
  return next.join('\n');
}

async function generateFittedTts(spoken: string, voice: string, language: string, styleInput: unknown) {
  const style = normalizeTtsStyle(styleInput);
  let finalText = spoken;
  console.log(`[studio] TTS start language=${language} target=${style.targetDuration || 0}s preset=${style.preset}`);
  let result = await generateTtsAudio(finalText, voice, language, style);
  console.log(`[studio] TTS audio source=${result.source} duration=${result.duration || 0}s`);
  let adjusted = false;
  const target = style.targetDuration || 0;
  if (result.ok && result.url && result.duration && target > 0 && Math.abs(result.duration - target) > Math.max(0.8, target * 0.08)) {
    // Short audio must not be expanded with invented selling points. Slow it
    // down and let the TTS model add pauses. Only overlong copy is rewritten.
    if (result.duration > target) finalText = await rewriteVoiceoverToDuration(finalText, language, result.duration, target);
    const requestedSpeed = style.speed || 1;
    const fittedSpeed = requestedSpeed * (result.duration / target) * (finalText.length / Math.max(1, spoken.length));
    // Wide time-stretching is one of the strongest sources of robotic speech.
    // Rewrite overlong copy first, then keep automatic fitting within ±8% of
    // the user's chosen delivery speed. Remaining mismatch is handled by edit
    // timing instead of distorting the voice.
    const adjustedSpeed = Math.max(0.75, Math.min(1.35, Math.max(requestedSpeed * 0.92, Math.min(requestedSpeed * 1.08, fittedSpeed))));
    result = await generateTtsAudio(finalText, voice, language, { ...style, speed: adjustedSpeed });
    console.log(`[studio] TTS fitted source=${result.source} duration=${result.duration || 0}s adjusted=${adjustedSpeed.toFixed(2)}x`);
    adjusted = finalText !== spoken || Math.abs(adjustedSpeed - (style.speed || 1)) > 0.02;
  }
  const cues = result.ok && result.duration ? (result.cues?.length ? result.cues : proportionalCues(finalText, result.duration)) : [];
  return { ...result, text: finalText, adjusted, targetDuration: target || undefined, cues, alignmentSource: result.alignmentSource || 'proportional' as const };
}

async function persistTtsResult<T extends { url?: string }>(result: T, tenantId: string): Promise<T> {
  if (!result.url) return result;
  const file = path.basename(new URL(result.url, 'http://local').pathname);
  const filePath = path.join(tenantAssetDir(TTS_ROOT, tenantId), file);
  if (!fs.existsSync(filePath)) return { ...result, ok: false, url: undefined, error: '配音文件未保存，请重试' };
  const diagnostics = await new Promise<string>(resolve => execFile(ffmpegStatic || 'ffmpeg', ['-hide_banner', '-i', filePath, '-af', 'volumedetect', '-f', 'null', '-'], { timeout: 30000 }, (_error, _stdout, stderr) => resolve(String(stderr))));
  const durationMatch = diagnostics.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const duration = durationMatch ? +durationMatch[1] * 3600 + +durationMatch[2] * 60 + +durationMatch[3] : 0;
  const volume = Number(diagnostics.match(/max_volume: ([-\d.]+) dB/)?.[1] ?? '-Infinity');
  if (duration < 0.2 || volume < -60) return { ...result, ok: false, url: undefined, error: '配音为空或接近静音，请选择此语言的其他音色或服务' };
  return { ...result, duration, ...(objectStorageEnabled() ? { url: await persistPrivateStudioAsset('tts', tenantId, filePath) } : {}) };
}

/**
 * Trusted in-process entry point used by the digital-employee content worker.
 * It deliberately returns the tenant-scoped local file path as well as the
 * public URL so the background renderer does not need to forge an HTTP user
 * session. No publishing side effect happens here.
 */
export function splitStudioNarrationSentences(spoken: string): string[] {
  return spoken.split(/(?<=[。！？!?])\s*|(?<=\.)\s+(?=[¿¡]?[A-ZÀ-ž])/u).map(value => value.trim()).filter(Boolean);
}

export async function synthesizeStudioVoiceForAutomation(input: {
  tenantId: string; text: string; language?: string; voice?: string; targetDuration?: number;
  style?: TtsStyleOptions;
}): Promise<{ ok: boolean; source?: string; url?: string; localPath?: string; duration?: number; text?: string; error?: string; cues?: AlignedCue[]; alignmentSource?: string }> {
  return studioTenantContext.run(input.tenantId, async () => {
    const spoken = String(input.text || '').trim();
    if (!spoken) return { ok: false, error: '口播为空' };
    // Each sentence is synthesized and measured independently. Boundaries come
    // from real audio samples, not proportional allocation of the full script.
    const lines = splitStudioNarrationSentences(spoken);
    const dir = tenantAssetDir(TTS_ROOT, input.tenantId); fs.mkdirSync(dir, { recursive: true });
    const files: string[] = [], cues: AlignedCue[] = [];
    const providers = new Set<string>();
    let cursor = 0;
    const speed = Math.max(.8, Math.min(1.2, Number(input.style?.speed) || 1));
    for (const line of lines) {
      const audio = await generateTtsAudio(line, input.voice || 'v1', input.language || 'en', normalizeTtsStyle(input.style || { preset: 'authentic_review' }));
      if (!audio.ok || !audio.url) return { ok: false, error: audio.error || '配音生成失败' };
      const trustedProvider = ['qwen_tts', 'minimax'].includes(audio.source)
        || (process.env.NODE_ENV !== 'production' && audio.source === 'local_say');
      if (!trustedProvider) return { ok: false, source: audio.source, error: audio.error || '当前只能使用本地兜底音色，不能作为正式成片配音；请检查语音服务配置' };
      providers.add(audio.source);
      const source = path.join(dir, path.basename(new URL(audio.url, 'http://local').pathname));
      const output = path.join(dir, randomUUID() + '.wav');
      await execFileAsync(ffmpegStatic || 'ffmpeg', ['-y', '-i', source, '-af', 'atempo=' + speed + ',apad=pad_dur=0.15', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', output], 30000);
      const duration = wavDurationFromBytes(fs.readFileSync(output));
      if (!(duration > .15)) return { ok: false, error: '无法测量实际配音时长' };
      cues.push({ start: cursor, end: cursor + duration - .15, text: line });
      cursor += duration; files.push(output);
    }
    const joined = path.join(dir, randomUUID() + '.wav');
    const inputs = files.flatMap(file => ['-i', file]);
    await execFileAsync(ffmpegStatic || 'ffmpeg', ['-y', ...inputs, '-filter_complex', files.map((_,i) => '['+i+':a]').join('') + 'concat=n=' + files.length + ':v=0:a=1[out]', '-map', '[out]', '-c:a', 'pcm_s16le', joined], 60000);
    const result = await persistTtsResult({ ok: true, url: scopedStudioAssetUrl('tts', path.basename(joined)), duration: cursor }, input.tenantId);
    fs.writeFileSync(joined + '.alignment.json', JSON.stringify({ text: spoken, cues }));
    for (const file of files) fs.unlinkSync(file);
    return { ...result, localPath: joined, text: spoken, cues, source: [...providers].join('+'), alignmentSource: 'synthesized_sentence_audio' };
  });
}

// POST /studio/tts  Body: { script?, text?, voice?, language? } → { ok, url, duration }
studioRouter.post('/tts', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { script = '', text = '', voice = 'v1', language = 'zh', style = {} } = req.body ?? {};
  const spoken = (text || spokenText(script)).trim();
  if (!spoken) { res.status(400).json({ ok: false, error: 'no spoken text' }); return; }

  try {
    if (!spokenLanguageMatches(spoken, language)) { res.status(400).json({ ok: false, error: '口播与目标语言不一致，请先修改脚本；配音不会自动翻译。' }); return; }
    const output = await synthesizeStudioVoiceForAutomation({ tenantId, text: spoken, voice, language, style: normalizeTtsStyle(style) });
    const payload = JSON.stringify(output);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(payload));
    res.end(payload);
  } catch (e: any) {
    console.error('[studio] TTS request failed:', e);
    res.json({ ok: false, source: 'fallback', error: String(e?.message ?? e).slice(0, 200) });
  }
});

// POST /studio/tts/align Body: { text, url, duration }
studioRouter.use('/tts', createStudioAsrRouter(url => localTtsFile(url), ffmpegStatic));

// Kept separate from synthesis so slow alignment never discards a valid audio result.
studioRouter.post('/tts/align', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const url = String(req.body?.url || '').trim();
  const duration = Math.max(0.2, Math.min(180, Number(req.body?.duration) || 0));
  if (!text || (!url.startsWith('/tts/') && !url.includes('/private-assets/tts/')) || !duration) {
    res.status(400).json({ ok: false, error: 'text, local tts url and duration required', cues: [] });
    return;
  }
  const fallback = { cues: proportionalCues(text, duration), source: 'proportional' as const };
  try {
    const aligned = await Promise.race([
      alignTtsAudio(text, url, duration),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('alignment timeout')), 45_000)),
    ]);
    res.json({ ok: true, ...aligned });
  } catch (error) {
    console.warn('[studio] TTS alignment request fallback:', error instanceof Error ? error.message : error);
    res.status(422).json({ ok: false, error: error instanceof Error ? error.message : '音频对齐失败', cues: [] });
  }
});

// POST /studio/tts/transcribe Body: { url, duration, language?, transcriptHint? }
// Used for user-uploaded voiceovers: recognize the real audio and create editable subtitle cues.
studioRouter.post('/tts/transcribe', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  const duration = Math.max(0.2, Math.min(180, Number(req.body?.duration) || 0));
  const language = String(req.body?.language || 'auto').trim();
  const transcriptHint = String(req.body?.transcriptHint || '').trim().slice(0, 6000);
  const media = localTtsFile(url);
  if (!media || !duration) {
    res.status(400).json({ ok: false, error: 'local audio url and duration required', text: '', cues: [] });
    return;
  }
  const qwenConfigured = Boolean(process.env.DASHSCOPE_API_KEY?.trim());
  if (!qwenConfigured) {
    if (transcriptHint) {
      res.status(503).json({ ok: false, text: transcriptHint, cues: [], error: '音频对齐服务不可用，请重新生成配音' });
    } else {
      res.status(503).json({ ok: false, error: 'DASHSCOPE_API_KEY not set; uploaded audio cannot be transcribed', text: '', cues: [] });
    }
    return;
  }
  try {
    void language;
    const parsed = await transcribeAudioWithQwen({ audio: media.bytes, fileName: `voice${media.mimeType === 'audio/mpeg' ? '.mp3' : '.wav'}` });
    const text = String(parsed.text || transcriptHint || '').trim();
    if (!text) throw new Error('audio transcription returned no text');
    const aligned = await alignTtsAudio(text, url, duration);
    res.json({ ok: true, text, cues: aligned.cues, source: 'audio_ai' });
  } catch (error) {
    if (transcriptHint) {
      res.status(422).json({ ok: false, text: transcriptHint, cues: [], error: String(error instanceof Error ? error.message : error).slice(0, 240) });
    } else {
      res.status(502).json({ ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 240), text: '', cues: [] });
    }
  }
});

// POST /studio/tts/batch  Body: { voice?, items: [{ code, text }] } → 批量生成，多语种只扣一次生成额度
studioRouter.post('/tts/batch', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { voice = 'v1', items = [], style = {} } = req.body ?? {};
  const input = Array.isArray(items) ? items.slice(0, 8) : [];
  if (input.length === 0) { res.status(400).json({ ok: false, error: 'items required', audios: {} }); return; }

  const audios: Record<string, Awaited<ReturnType<typeof synthesizeStudioVoiceForAutomation>>> = {};
  for (const item of input) {
    const code = String(item?.code || item?.language || '').trim() || 'zh';
    const language = String(item?.language || code).trim() || code;
    const spoken = String(item?.text || '').trim();
    if (!spoken) {
      audios[code] = { ok: false, source: 'empty', error: 'no spoken text' };
      continue;
    }
    try {
      if (!spokenLanguageMatches(spoken, language)) throw Error('口播与目标语言不一致，请先修改脚本');
      audios[code] = await synthesizeStudioVoiceForAutomation({ tenantId, text: spoken, voice, language, style: normalizeTtsStyle(style) });
    } catch (error) {
      audios[code] = {
        ok: false,
        source: 'language_repair_failed',
        error: String(error instanceof Error ? error.message : error).slice(0, 240),
      };
    }
  }
  res.json({ ok: Object.values(audios).some(item => item.ok && item.url), audios });
});

studioRouter.get('/voice-samples', (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const items = readVoiceSampleIndex().map(item => ({
    ...item,
    url: objectStorageEnabled() ? privateStudioAssetUrl('voice-samples', tenantId, item.file) : scopedStudioAssetUrl('voice-samples', item.file),
  })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(items);
});

// POST /studio/voice-samples Body: { name, dataBase64, mimeType?, duration? } → 新增真人音色样本
studioRouter.post('/voice-samples', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  if (!await consumeDemoQuota(req, res, 'generation')) return;
  const { name = 'voice-sample.wav', dataBase64, mimeType, duration = 0, replacesVoiceId = '' } = req.body ?? {};
  if (!dataBase64) { res.status(400).json({ ok: false, error: 'dataBase64 required' }); return; }
  try {
    fs.mkdirSync(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), { recursive: true });
    const match = String(dataBase64).match(/^data:([^;]+);base64,(.+)$/);
    const b64 = match ? match[2] : String(dataBase64);
    const type = String(mimeType || match?.[1] || '').toLowerCase();
    const ext = type.includes('mpeg') || type.includes('mp3') ? 'mp3'
      : type.includes('m4a') || type.includes('mp4') ? 'm4a'
      : 'wav';
    if (!['mp3', 'm4a', 'wav'].includes(ext) || /ogg|webm/i.test(type)) {
      res.status(400).json({ ok: false, error: '真人音色样本仅支持 mp3、m4a、wav。' });
      return;
    }
    const seconds = Number(duration) || 0;
    if (seconds > 0 && seconds < 10) {
      res.status(400).json({ ok: false, error: '真人音色样本需要至少 10 秒清晰人声。' });
      return;
    }
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length < 1024 || bytes.length > 20 * 1024 * 1024) {
      res.status(400).json({ ok: false, error: '真人音色样本文件需在 1KB 到 20MB 之间。' });
      return;
    }
    const id = randomUUID();
    const file = `${id}.${ext}`;
    const samplePath = path.join(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), file);
    fs.writeFileSync(samplePath, bytes);
    const storedUrl = await persistPrivateStudioAsset('voice-samples', tenantId, samplePath, type);
    const replacedId = String(replacesVoiceId || '');
    if (replacedId.startsWith('custom:')) {
      const previousPath = voiceSamplePathFromId(replacedId);
      const cache = readMinimaxVoiceCache();
      const replacedEntries = Object.entries(cache).filter(([key]) => key.startsWith(`${replacedId}:`));
      for (const [key, entry] of replacedEntries) {
        if ((process.env.MINIMAX_API_KEY || process.env.MINIMAX_API_TOKEN) && entry.voiceId) {
          await minimaxFetchJson('/v1/delete_voice', { voice_type: 'voice_cloning', voice_id: entry.voiceId }, 30_000).catch(() => null);
        }
        delete cache[key];
      }
      writeMinimaxVoiceCache(cache);
      if (previousPath && previousPath !== path.join(scopedStudioAssetDir(VOICE_SAMPLES_ROOT), file)) {
        try { fs.unlinkSync(previousPath); } catch { /* replacement already succeeded; stale sample cleanup is best effort */ }
      }
    }
    const voiceId = `custom:${id}`;
    const voiceName = String(name || '真人音色').replace(/\.[^.]+$/, '');
    const index = readVoiceSampleIndex().filter(item => item.voiceId !== replacedId);
    index.push({ voiceId, name: voiceName, file, duration: seconds, createdAt: new Date().toISOString() });
    writeVoiceSampleIndex(index);
    const capabilities = studioAudioCapabilities();
    res.json({
      ok: true,
      id,
      voiceId,
      name: voiceName,
      url: storedUrl,
      duration: seconds,
      synthesisReady: capabilities.customVoice.synthesis,
      engine: capabilities.customVoice.engines.minimax ? 'minimax' : capabilities.customVoice.engines.xtts ? 'xtts' : undefined,
      warning: capabilities.customVoice.synthesis ? undefined : capabilities.customVoice.message,
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message ?? e).slice(0, 300) });
  }
});

// POST /studio/voiceover  Body: { name, dataBase64, mimeType?, duration? } → 上传本地口播音频
studioRouter.post('/voiceover', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { name = 'voiceover.wav', dataBase64, mimeType, duration = 0 } = req.body ?? {};
  if (!dataBase64) { res.status(400).json({ ok: false, error: 'dataBase64 required' }); return; }
  try { fs.mkdirSync(scopedStudioAssetDir(TTS_ROOT), { recursive: true }); } catch { /* ignore */ }
  try {
    const extFromMime = (mimeType as string | undefined)?.split('/')[1]?.replace('mpeg', 'mp3').replace('x-wav', 'wav');
    const extFromName = String(name).split('.').pop();
    const ext = (extFromMime || extFromName || 'wav').replace(/[^\w]+/g, '').slice(0, 8) || 'wav';
    const file = `${randomUUID()}.${ext}`;
    const buf = Buffer.from(String(dataBase64).replace(/^data:[^,]+,/, ''), 'base64');
    const filePath = path.join(scopedStudioAssetDir(TTS_ROOT), file);
    fs.writeFileSync(filePath, buf);
    res.json({ ok: true, url: await persistPrivateStudioAsset('tts', tenantId, filePath, String(mimeType || '')), duration: Number(duration) || 0 });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 200) });
  }
});

/* ── ④ BGM 曲库（本地磁盘，仅保留用户上传音乐）───────────────────────────────
   渲染时 buildManifest 把选中 BGM 映射成真实 URL。
─────────────────────────────────────────────────────────────────────────── */

const BGM_ROOT = path.join(__dirname, '../../data/bgm');
const BGM_FILE = path.join(__dirname, '../../data/bgm.json');
const BUILTIN_BGM_ROOT = path.join(__dirname, '../assets/bgm');

interface BgmTrack {
  id: string;
  name: string;
  mood: string;
  duration: number;
  file: string;
  url: string;
  recommended?: boolean;
  builtin?: boolean;
  tenantId?: string;
  scope?: 'shared' | 'tenant';
  uploadedBy?: string;
  createdAt: string;
  objectKey?: string;
  sourceUrl?: string;
  license?: string;
}

const BUILTIN_BGM_TRACKS: BgmTrack[] = [
  {
    id: 'builtin-tech-pulse',
    name: '灵枢推荐配乐01',
    mood: '科技感 · 稳定推进',
    duration: 24,
    file: 'tech-pulse.mp3',
    url: '/bgm/shared/tech-pulse.mp3',
    recommended: true,
    builtin: true,
    scope: 'shared',
    uploadedBy: '灵枢官方曲库',
    createdAt: '2026-08-21T00:00:00.000Z',
  },
  {
    id: 'builtin-clean-corporate',
    name: '灵枢推荐配乐02',
    mood: '企业感 · 清爽克制',
    duration: 24,
    file: 'clean-corporate.mp3',
    url: '/bgm/shared/clean-corporate.mp3',
    recommended: true,
    builtin: true,
    scope: 'shared',
    uploadedBy: '灵枢官方曲库',
    createdAt: '2026-08-21T00:00:01.000Z',
  },
  {
    id: 'builtin-product-energy',
    name: '灵枢推荐配乐03',
    mood: '产品展示 · 轻快有力',
    duration: 24,
    file: 'product-energy.mp3',
    url: '/bgm/shared/product-energy.mp3',
    recommended: true,
    builtin: true,
    scope: 'shared',
    uploadedBy: '灵枢官方曲库',
    createdAt: '2026-08-21T00:00:02.000Z',
  },
  {
    id: 'builtin-mixkit-close-up',
    name: '灵枢推荐配乐04',
    mood: '科技产业 · 律动推进',
    duration: 95.14,
    file: 'mixkit-close-up.mp3',
    url: '/bgm/shared/mixkit-close-up.mp3',
    recommended: true,
    builtin: true,
    scope: 'shared',
    uploadedBy: 'Mixkit 免版税曲库',
    createdAt: '2026-08-21T00:00:03.000Z',
    sourceUrl: 'https://mixkit.co/free-stock-music/corporate-music/',
    license: 'Mixkit Free License',
  },
  {
    id: 'builtin-mixkit-its-love',
    name: '灵枢推荐配乐05',
    mood: '品牌叙事 · 轻盈积极',
    duration: 96.63,
    file: 'mixkit-its-love.mp3',
    url: '/bgm/shared/mixkit-its-love.mp3',
    recommended: true,
    builtin: true,
    scope: 'shared',
    uploadedBy: 'Mixkit 免版税曲库',
    createdAt: '2026-08-21T00:00:04.000Z',
    sourceUrl: 'https://mixkit.co/free-stock-music/corporate-music/',
    license: 'Mixkit Free License',
  },
];

function ensureBuiltinBgmFiles(): BgmTrack[] {
  const sharedDir = path.join(BGM_ROOT, 'shared');
  try { fs.mkdirSync(sharedDir, { recursive: true }); } catch { return []; }
  return BUILTIN_BGM_TRACKS.filter(track => {
    const source = path.join(BUILTIN_BGM_ROOT, track.file);
    const target = path.join(sharedDir, track.file);
    if (!fs.existsSync(source)) return false;
    try {
      if (!fs.existsSync(target) || fs.statSync(target).size !== fs.statSync(source).size) fs.copyFileSync(source, target);
      return true;
    } catch {
      return false;
    }
  });
}

function loadBgm(): BgmTrack[] {
  let uploaded: BgmTrack[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(BGM_FILE, 'utf8')) as BgmTrack[];
    uploaded = Array.isArray(parsed) ? parsed.filter(track => !track.builtin) : [];
  } catch { /* first run */ }
  const builtins = ensureBuiltinBgmFiles();
  const builtinIds = new Set(builtins.map(track => track.id));
  return [...builtins, ...uploaded.filter(track => !builtinIds.has(track.id))];
}
function persistBgm(list: BgmTrack[]): void {
  try { fs.mkdirSync(path.dirname(BGM_FILE), { recursive: true }); } catch { /* ignore */ }
  fs.writeFileSync(BGM_FILE, JSON.stringify(list.filter(track => !track.builtin), null, 2), 'utf8');
}

function userBgms(tenantId: string): BgmTrack[] {
  // Pre-isolation uploads have no tenantId and live at data/bgm/<file>.
  // Keep those legacy tracks visible as the authenticated shared library;
  // new uploads remain strictly scoped to their owning tenant.
  return loadBgm().filter(track => track.builtin || track.scope === 'shared' || !track.tenantId || track.tenantId === tenantId);
}

function sortBgmTracks(list: BgmTrack[]): BgmTrack[] {
  return [...list].sort((a, b) => {
    const recommendedDelta = (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0);
    if (recommendedDelta) return recommendedDelta;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || a.id.localeCompare(b.id);
  });
}

function withRecommendedBgmNames(list: BgmTrack[]): BgmTrack[] {
  return sortBgmTracks(list).map((track, index) => ({
    ...track,
    name: `灵枢推荐配乐${String(index + 1).padStart(2, '0')}`,
    scope: track.scope || (!track.tenantId ? 'shared' : 'tenant'),
    uploadedBy: track.uploadedBy || (!track.tenantId ? '灵枢管理员上传' : '客户上传'),
  }));
}

export function automationBgmCatalog(tenantId: string) {
  return withRecommendedBgmNames(userBgms(tenantId)).map(({ id, name, mood }) => ({ id, name, mood }));
}
export async function automationBgmAudio(tenantId: string, id: string): Promise<string> {
  const track = userBgms(tenantId).find(item => item.id === id);
  if (!track) throw Error('所选配乐已不可用，请在生产现场更换');
  if (track.objectKey) return r2SignedGetUrl(track.objectKey, materialSignedUrlTtlSeconds());
  const relative = track.url.replace(/^\/bgm\//, '');
  const root = path.resolve(BGM_ROOT);
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) throw Error('配乐文件缺失，请在生产现场更换');
  return 'data:audio/mpeg;base64,' + fs.readFileSync(file).toString('base64');
}

// GET /studio/bgm → BgmTrack[]（仅用户上传音乐）
studioRouter.get('/bgm', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  res.json(await Promise.all(withRecommendedBgmNames(userBgms(tenantId)).map(async track => ({
    ...track,
    url: track.objectKey ? await r2SignedGetUrl(track.objectKey, materialSignedUrlTtlSeconds()) : track.url ? signAssetUrl(track.url, tenantId) : track.url,
    objectKey: undefined,
  }))));
});

// POST /studio/bgm  Body: { name, mood?, duration?, dataBase64, mimeType? } → 上传真实音乐
studioRouter.post('/bgm', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const admin = await requireAdminUser(req);
  const { name, mood = '自定义', duration = 0, dataBase64, mimeType } = req.body ?? {};
  if (!dataBase64) { res.status(400).json({ ok: false, error: 'dataBase64 required' }); return; }
  const assetDir = admin ? path.join(BGM_ROOT, 'shared') : scopedStudioAssetDir(BGM_ROOT);
  try { fs.mkdirSync(assetDir, { recursive: true }); } catch { /* ignore */ }
  const id = randomUUID();
  const ext = (mimeType as string | undefined)?.split('/')[1]?.replace('mpeg', 'mp3') || 'mp3';
  const file = `${id}.${ext}`;
  const buf = Buffer.from(String(dataBase64).replace(/^data:[^,]+,/, ''), 'base64');
  const objectKey = objectStorageEnabled() ? (admin ? sharedObjectKey('bgm', file) : tenantPrivateObjectKey('bgm', tenantId, file)) : undefined;
  if (objectKey) await r2Upload({ key: objectKey, body: buf, contentType: materialAssetContentType(file, String(mimeType || '')) });
  else fs.writeFileSync(path.join(assetDir, file), buf);
  const list = loadBgm();
  const tenantTracks = userBgms(tenantId);
  const track: BgmTrack = {
    id,
    name: `灵枢推荐配乐${String(tenantTracks.length + 1).padStart(2, '0')}`,
    mood,
    duration: Number(duration) || 0,
    file,
    url: objectKey ? '' : admin ? `/bgm/${sharedAssetRelativePath(file)}` : scopedStudioAssetUrl('bgm', file),
    objectKey,
    tenantId: admin ? undefined : tenantId,
    scope: admin ? 'shared' : 'tenant',
    uploadedBy: admin ? '灵枢管理员上传' : '客户上传',
    createdAt: new Date().toISOString(),
  };
  list.push(track);
  persistBgm(list);
  res.status(201).json({ ok: true, track });
});

// DELETE /studio/bgm/:id
studioRouter.delete('/bgm/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const list = loadBgm();
  const candidate = list.find(x => x.id === req.params.id);
  if (candidate?.builtin) {
    res.status(403).json({ ok: false, error: '官方配乐不可删除' });
    return;
  }
  const shared = Boolean(candidate && (candidate.scope === 'shared' || !candidate.tenantId));
  const admin = shared ? await requireAdminUser(req) : null;
  const t = candidate && (candidate.tenantId === tenantId || (shared && admin)) ? candidate : undefined;
  if (!t) { res.status(404).json({ ok: false, error: 'BGM not found' }); return; }
  const assetPath = t.scope === 'shared'
    ? path.join(BGM_ROOT, 'shared', t.file)
    : !t.tenantId
      ? path.join(BGM_ROOT, t.file)
      : path.join(scopedStudioAssetDir(BGM_ROOT), t.file);
  if (t.objectKey) await r2Delete(t.objectKey).catch(() => undefined);
  else try { fs.unlinkSync(assetPath); } catch { /* ignore */ }
  persistBgm(list.filter(x => x.id !== req.params.id));
  res.json({ ok: true });
});

/* ── 草稿 / 作品持久化（平铺 JSON 文件，无需数据库）─────────────────────────
   对应前端「我的草稿 / 我的作品」。save 既可新建也可更新（带 id 即更新）。
─────────────────────────────────────────────────────────────────────────── */

interface StudioProject {
  id: string;
  title: string;
  status: 'draft' | 'ready_for_approval' | 'published' | 'template';
  spec: Record<string, unknown>;
  thumbSeed?: string;
  createdAt: string;
  updatedAt: string;
}

type StoredStudioProject = StudioProject & { tenant_id: string };

function projectFromRecord(record: any, tenantId: string): StudioProject {
  return {
    id: String(record.id),
    title: String(record.title || '未命名草稿'),
    status: record.status || 'draft',
    spec: { ...refreshStudioProjectAssetUrls(record.spec || {}, tenantId), _baseUpdatedAt: String(record.updated_at || record.updated || '') },
    thumbSeed: record.thumb_seed || undefined,
    createdAt: String(record.created_at || record.created || ''),
    updatedAt: String(record.updated_at || record.updated || ''),
  };
}

export function unpublishableGenerationReasons(spec: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  const inspect = (label: string, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const item = value as Record<string, unknown>;
    const source = String(item.provenance || item.source || item.generationProvenance || item.generationSource || '').toLowerCase();
    const quality = String(item.qualityStatus || '').toLowerCase();
    const hasGeneratedContent = Boolean(
      String(item.script || item.caption || '').trim()
      || (item.poster && typeof item.poster === 'object')
      || (Array.isArray(item.items) && item.items.length),
    );
    if (hasGeneratedContent && !source) reasons.push(`${label}缺少明确生成来源，仅可保存为草稿`);
    if (hasGeneratedContent && !quality) reasons.push(`${label}缺少质量校验结论，仅可保存为草稿`);
    if (hasGeneratedContent && item.publishable !== true) reasons.push(`${label}没有明确可发布结论`);
    if (['template', 'local', 'fallback', 'manual_draft', 'ai_failed', 'ai_rejected'].includes(source)) {
      reasons.push(`${label}来源为${source}，仅可保存为草稿`);
    }
    if (['failed', 'rejected', 'fallback', 'unreviewed', 'needs_confirmation'].includes(quality)) {
      reasons.push(`${label}质量状态为${quality}，尚不可进入交付`);
    }
    if (item.publishable === false) reasons.push(`${label}明确标记为不可发布`);
    const pending = confirmationFields(item.fieldsToConfirm);
    if (pending.length) reasons.push(`${label}仍有待确认商业字段：${pending.join('、')}`);
  };
  if (spec.contentMode === 'poster') {
    inspect('海报草稿', spec.posterDraft);
    inspect('获客内容包', spec.leadContentPackage);
    if (String(spec.posterJsonText || '').trim() && (!spec.posterDraft || typeof spec.posterDraft !== 'object')) {
      reasons.push('海报正文缺少生成来源和质量校验记录，仅可保存为草稿');
    }
  } else if (Array.isArray(spec.modeScripts)) {
    spec.modeScripts.forEach((item, index) => inspect(`脚本${index + 1}`, item));
  }
  if (spec.contentMode !== 'poster' && String(spec.script || '').trim()) {
    const currentScript = String(spec.script).trim();
    const hasVerifiedRecord = Array.isArray(spec.modeScripts) && spec.modeScripts.some(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const item = value as Record<string, unknown>;
      const source = String(item.generationProvenance || item.generationSource || item.provenance || item.source || '').toLowerCase();
      const quality = String(item.qualityStatus || '').toLowerCase();
      return String(item.script || '').trim() === currentScript
        && source === 'ai'
        && Boolean(quality)
        && !['failed', 'rejected', 'fallback', 'unreviewed', 'needs_confirmation'].includes(quality)
        && item.publishable === true;
    });
    if (!hasVerifiedRecord) reasons.push('当前脚本缺少与正文一致的 AI 来源、质量和可发布记录');
  }
  return Array.from(new Set(reasons));
}

// GET /studio/projects → 列表（更新时间倒序）
studioRouter.get('/projects', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const result = await store.list<StoredStudioProject>('studio_projects', { where: { tenant_id: tenantId }, sort: '-updated_at', perPage: 500 });
  const taskId = socialProjectTaskId(res.locals);
  res.json(result.items
    .filter(project => socialProjectBelongs(project, taskId))
    .map(project => projectFromRecord(project, tenantId)));
});

// POST /studio/projects  Body: { id?, title?, status?, spec, thumbSeed? } → 新建或更新
studioRouter.post('/projects', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const { id, title, status = 'draft', spec: rawSpec = {}, thumbSeed } = req.body ?? {};
  const socialTaskId = socialProjectTaskId(res.locals);
  const spec = studioProjectSpecForStorage(bindSocialProjectSpec(rawSpec, socialTaskId));
  const automation = spec.automation && typeof spec.automation === 'object' && !Array.isArray(spec.automation)
    ? spec.automation as Record<string, unknown> : {};
  const now = new Date().toISOString();
  if (automation.managedBy === 'digital_employee') { res.status(403).json({ ok: false, error: '数字员工内容项目只能由受信任的生产流程创建', code: 'managed_production_project_forbidden' }); return; }
  const generationBlocks = unpublishableGenerationReasons(spec);
  if (!['draft', 'template'].includes(String(status)) && generationBlocks.length) {
    res.status(422).json({
      ok: false,
      code: 'UNREVIEWED_GENERATION_DRAFT',
      error: '草稿包含未核实、待确认或失败降级内容，只能先保存为草稿，不能自动进入发布或交付。',
      reasons: generationBlocks,
    });
    return;
  }

  if (id) {
    const existing = await store.getById<any>('studio_projects', String(id));
    if (existing?.tenant_id === tenantId) {
      if (!socialProjectBelongs(existing, socialTaskId)) { res.status(404).json({ ok: false, error: 'Project not found' }); return; }
      const storedSpec = typeof existing.spec === 'string' ? JSON.parse(existing.spec) : existing.spec;
      if (storedSpec?.workflowRunId && storedSpec?.automation?.managedBy === 'digital_employee') {
        res.status(409).json({ ok: false, error: '此项目由任务自动生产，请通过交付看板纠偏重跑，或复制为新草稿后编辑。', code: 'managed_production_project' });
        return;
      }

      const changed = JSON.stringify(existing.spec || {}) !== JSON.stringify(spec || {})
        || String(existing.title || '') !== String(title ?? existing.title ?? '')
        || String(existing.status || '') !== String(status || '');
      await store.update('studio_projects', String(id), { title: title ?? existing.title, status, spec, thumb_seed: thumbSeed || '', updated_at: now });
      if (changed) await invalidatePublishingApprovalForProject(tenantId, String(id));
      res.json({ ok: true, project: projectFromRecord({ ...existing, title: title ?? existing.title, status, spec, thumb_seed: thumbSeed, updated_at: now }, tenantId) });
      return;
    }
  }

  const project: StudioProject = {
    id: randomUUID(),
    title: title || '未命名草稿',
    status,
    spec,
    thumbSeed,
    createdAt: now,
    updatedAt: now,
  };
  const created = await store.create<any>('studio_projects', { tenant_id: tenantId, title: project.title, status, spec, thumb_seed: thumbSeed || '', created_at: now, updated_at: now });
  if (!created) { res.status(503).json({ ok: false, error: 'project storage unavailable' }); return; }
  res.status(201).json({ ok: true, project: projectFromRecord(created, tenantId) });
});

// GET /studio/projects/:id/evidence → verify that shot assignments remain grounded in owned material ranges.
studioRouter.get('/projects/:id/evidence', async (req, res) => {
  try {
    const tenantId = res.locals.tenantId as string;
    const project = await store.getById<any>('studio_projects', req.params.id);
    if (!project || project.tenant_id !== tenantId || !socialProjectBelongs(project, socialProjectTaskId(res.locals))) { res.status(404).json({ error: '草稿不存在' }); return; }
    const gaps = auditShotEvidence(project.spec || {}, loadMaterials().filter(item => !isReferenceOnlyMaterial(item)), tenantId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true, projectId: project.id, revision: project.updated_at, gaps, status: gaps.length ? 'needs_review' : 'range_checked', note: '范围和动作文本校验，不代表视觉或产品功效已验证；未读取到的云端素材需人工核对。' });
  } catch { res.status(503).json({ error: '素材依据检查失败，请稍后重试' }); }
});

// GET /studio/projects/:id → 单个（用于再编辑）
studioRouter.get('/projects/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const p = await store.getById<any>('studio_projects', req.params.id);
  if (!p || p.tenant_id !== tenantId || !socialProjectBelongs(p, socialProjectTaskId(res.locals))) { res.status(404).json({ ok: false, error: 'Project not found' }); return; }
  res.json(projectFromRecord(p, tenantId));
});

// DELETE /studio/projects/:id
studioRouter.delete('/projects/:id', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const existing = await store.getById<any>('studio_projects', req.params.id);
  if (!existing || existing.tenant_id !== tenantId || !socialProjectBelongs(existing, socialProjectTaskId(res.locals))) { res.status(404).json({ ok: false, error: 'Project not found' }); return; }
  await store.delete('studio_projects', req.params.id);
  res.json({ ok: true });
});

/* ── 爆款裂变批量队列：持久化组合、执行状态与人工审核结果 ─────────────── */
const BATCHES_FILE = path.join(__dirname, '../../data/studio-variation-batches.json');
type BatchItemStatus = 'pending' | 'running' | 'quality_check' | 'review' | 'approved' | 'rejected' | 'failed';
interface VariationBatchItem { id: string; variables: Record<string, string>; status: BatchItemStatus; outputProjectId?: string; qualityScore?: number; note?: string; updatedAt: string }
interface VariationBatch { id: string; tenantId: string; title: string; templateProjectId?: string; status: 'queued' | 'running' | 'review' | 'completed' | 'paused'; estimatedCostCny: number; plan?: Record<string, unknown>; createdAt: string; updatedAt: string; items: VariationBatchItem[] }
function loadVariationBatches(): VariationBatch[] { try { return JSON.parse(fs.readFileSync(BATCHES_FILE, 'utf8')) as VariationBatch[]; } catch { return []; } }
function persistVariationBatches(list: VariationBatch[]): void { fs.mkdirSync(path.dirname(BATCHES_FILE), { recursive: true }); fs.writeFileSync(BATCHES_FILE, JSON.stringify(list, null, 2), 'utf8'); }

studioRouter.get('/variation-batches', (_req, res) => { const { tenantId } = res.locals as AuthLocals; res.json(loadVariationBatches().filter(item => item.tenantId === tenantId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); });
studioRouter.post('/variation-batches', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const body = req.body ?? {};
  const dimensions = body.dimensions && typeof body.dimensions === 'object' ? body.dimensions as Record<string, unknown> : {};
  const values = (key: string) => Array.isArray(dimensions[key]) && (dimensions[key] as unknown[]).length ? (dimensions[key] as unknown[]).map(String) : ['默认'];
  const products = values('product'); const people = values('person'); const scenes = values('scene'); const languages = values('language'); const hooks = values('hook');
  const limit = Math.max(1, Math.min(200, Number(body.maxItems) || 20));
  const now = new Date().toISOString(); const items: VariationBatchItem[] = [];
  outer: for (const product of products) for (const person of people) for (const scene of scenes) for (const language of languages) for (const hook of hooks) {
    items.push({ id: randomUUID(), variables: { product, person, scene, language, hook }, status: 'pending', updatedAt: now });
    if (items.length >= limit) break outer;
  }
  const duration = Math.max(1, Number(body.duration) || 20);
  const batch: VariationBatch = { id: randomUUID(), tenantId, title: String(body.title || '未命名裂变批次'), templateProjectId: body.templateProjectId ? String(body.templateProjectId) : undefined, status: 'queued', estimatedCostCny: Math.ceil(items.length * duration * 1.5 * 100) / 100, plan: body.plan && typeof body.plan === 'object' ? body.plan as Record<string, unknown> : { duration, maxItems: limit, dimensions }, createdAt: now, updatedAt: now, items };
  const list = loadVariationBatches(); list.push(batch); persistVariationBatches(list); res.status(201).json({ ok: true, batch });
});
studioRouter.patch('/variation-batches/:batchId', (req, res) => {
  const { tenantId } = res.locals as AuthLocals; const list = loadVariationBatches(); const batch = list.find(item => item.id === req.params.batchId && item.tenantId === tenantId);
  if (!batch) { res.status(404).json({ ok: false, error: 'Batch not found' }); return; }
  if (['queued', 'running', 'review', 'completed', 'paused'].includes(String(req.body?.status))) batch.status = req.body.status;
  batch.updatedAt = new Date().toISOString(); persistVariationBatches(list); res.json({ ok: true, batch });
});
studioRouter.patch('/variation-batches/:batchId/items/:itemId', (req, res) => {
  const { tenantId } = res.locals as AuthLocals; const list = loadVariationBatches(); const batch = list.find(entry => entry.id === req.params.batchId && entry.tenantId === tenantId); const item = batch?.items.find(entry => entry.id === req.params.itemId);
  if (!batch || !item) { res.status(404).json({ ok: false, error: 'Batch item not found' }); return; }
  const allowed: BatchItemStatus[] = ['pending', 'running', 'quality_check', 'review', 'approved', 'rejected', 'failed'];
  if (allowed.includes(req.body?.status)) item.status = req.body.status;
  if (req.body?.outputProjectId) item.outputProjectId = String(req.body.outputProjectId);
  if (Number.isFinite(Number(req.body?.qualityScore))) item.qualityScore = Number(req.body.qualityScore);
  if (typeof req.body?.note === 'string') item.note = req.body.note;
  item.updatedAt = new Date().toISOString(); batch.updatedAt = item.updatedAt;
  if (batch.items.every(entry => entry.status === 'approved' || entry.status === 'rejected')) batch.status = 'completed'; else if (batch.items.some(entry => entry.status === 'review')) batch.status = 'review';
  persistVariationBatches(list); res.json({ ok: true, batch, item });
});
studioRouter.post('/variation-batches/:batchId/claim-next', (req, res) => {
  const { tenantId } = res.locals as AuthLocals; const list = loadVariationBatches(); const batch = list.find(entry => entry.id === req.params.batchId && entry.tenantId === tenantId);
  if (!batch) { res.status(404).json({ ok: false, error: 'Batch not found' }); return; }
  if (batch.status === 'paused' || batch.status === 'completed') { res.json({ ok: true, item: null, batch }); return; }
  const staleBefore = Date.now() - 30 * 60 * 1000;
  const item = batch.items.find(entry => entry.status === 'pending' || (entry.status === 'running' && new Date(entry.updatedAt).getTime() < staleBefore));
  if (!item) { batch.status = batch.items.some(entry => entry.status === 'review') ? 'review' : batch.status; persistVariationBatches(list); res.json({ ok: true, item: null, batch }); return; }
  item.status = 'running'; item.updatedAt = new Date().toISOString(); batch.status = 'running'; batch.updatedAt = item.updatedAt; persistVariationBatches(list); res.json({ ok: true, item, batch });
});
studioRouter.post('/variation-batches/:batchId/retry-failed', (req, res) => {
  const { tenantId } = res.locals as AuthLocals; const list = loadVariationBatches(); const batch = list.find(entry => entry.id === req.params.batchId && entry.tenantId === tenantId);
  if (!batch) { res.status(404).json({ ok: false, error: 'Batch not found' }); return; }
  let count = 0; const now = new Date().toISOString(); batch.items.forEach(item => { if (item.status === 'failed' || item.status === 'rejected') { item.status = 'pending'; item.updatedAt = now; count += 1; } });
  if (count) batch.status = 'queued'; batch.updatedAt = now; persistVariationBatches(list); res.json({ ok: true, retried: count, batch });
});

const PUBLISH_LINKS_FILE = path.join(__dirname, '../../data/studio-publish-links.json');
studioRouter.get('/publish-records', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  res.json(listPublishRecords(tenantId, req.query.accountId ? String(req.query.accountId) : undefined));
});
studioRouter.post('/publish-recommendations', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const targets = Array.isArray(req.body?.targets) ? req.body.targets : [];
  const recommendations = targets
    .filter((target: any) => ['youtube', 'tiktok', 'instagram', 'facebook'].includes(String(target?.platform)))
    .map((target: any) => ({
      accountId: String(target.accountId || ''),
      platform: String(target.platform),
      ...recommendPublish({
        tenantId,
        platform: String(target.platform) as PublishPlatform,
        accountId: String(target.accountId || ''),
        videoPath: String(req.body?.videoPath || ''),
        projectId: req.body?.projectId ? String(req.body.projectId) : undefined,
        generationVersionId: req.body?.generationVersionId ? String(req.body.generationVersionId) : undefined,
        title: String(req.body?.title || ''),
        ratio: req.body?.ratio ? String(req.body.ratio) : undefined,
        language: req.body?.language ? String(req.body.language) : undefined,
      }),
    }));
  res.json({ recommendations });
});
studioRouter.get('/publish-links', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  try { res.json((JSON.parse(fs.readFileSync(PUBLISH_LINKS_FILE, 'utf8')) as any[]).filter(item => item.tenantId === tenantId)); } catch { res.json([]); }
});
export function terminalPublishedPlatformPostId(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const result = value as Record<string, unknown>;
  if (result.ok !== true || result.deliveryStatus !== 'published') return '';
  return String(result.platformPostId || '').trim();
}
studioRouter.post('/publish-links', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const projectId = String(req.body?.projectId || '').trim();
  if (!projectId) { res.status(400).json({ ok: false, error: 'projectId required' }); return; }
  if (!terminalPublishedPlatformPostId(req.body?.publishResult)) {
    res.status(409).json({ ok: false, error: 'publishResult must contain a terminal published platform receipt' });
    return;
  }
  let project: Record<string, unknown> | null;
  try { project = await store.getById<Record<string, unknown>>('studio_projects', projectId); }
  catch { res.status(503).json({ ok: false, error: '无法验证 Studio 生成记录，请稍后重试' }); return; }
  if (!project || String(project.tenant_id || '') !== tenantId) {
    res.status(404).json({ ok: false, error: '当前企业的 Studio 项目不存在' });
    return;
  }
  const generation = verifiedStudioGenerationFromSpec(project.spec, req.body);
  if (!generation.ok) {
    res.status(409).json({ ok: false, error: generation.code, message: generation.message });
    return;
  }
  let list: Record<string, unknown>[] = []; try { list = JSON.parse(fs.readFileSync(PUBLISH_LINKS_FILE, 'utf8')) as Record<string, unknown>[]; } catch { /* empty */ }
  const link = { id: randomUUID(), tenantId, projectId, batchId: req.body?.batchId ? String(req.body.batchId) : undefined, variantId: req.body?.variantId ? String(req.body.variantId) : undefined, accountId: String(req.body?.accountId || ''), platform: String(req.body?.platform || ''), title: String(req.body?.title || ''), publishResult: req.body.publishResult, publishedAt: new Date().toISOString() };
  list.push(link); fs.mkdirSync(path.dirname(PUBLISH_LINKS_FILE), { recursive: true }); fs.writeFileSync(PUBLISH_LINKS_FILE, JSON.stringify(list, null, 2), 'utf8'); res.status(201).json({ ok: true, link });
});
studioRouter.patch('/publish-links/:id/metrics', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  let list: Record<string, any>[] = []; try { list = JSON.parse(fs.readFileSync(PUBLISH_LINKS_FILE, 'utf8')) as Record<string, any>[]; } catch { /* empty */ }
  const link = list.find(item => item.id === req.params.id && item.tenantId === tenantId); if (!link) { res.status(404).json({ ok: false, error: 'Publish link not found' }); return; }
  link.metrics = { views: Number(req.body?.views) || 0, likes: Number(req.body?.likes) || 0, comments: Number(req.body?.comments) || 0, shares: Number(req.body?.shares) || 0, leads: Number(req.body?.leads) || 0, updatedAt: new Date().toISOString() };
  fs.writeFileSync(PUBLISH_LINKS_FILE, JSON.stringify(list, null, 2), 'utf8'); res.json({ ok: true, link });
});
studioRouter.get('/publish-performance', (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  let list: Record<string, any>[] = []; try { list = JSON.parse(fs.readFileSync(PUBLISH_LINKS_FILE, 'utf8')) as Record<string, any>[]; } catch { /* empty */ }
  const grouped: Record<string, any> = {};
  for (const link of list.filter(item => item.tenantId === tenantId)) { const key = String(link.projectId || 'unknown'); const row = grouped[key] ||= { projectId: key, posts: 0, views: 0, likes: 0, comments: 0, shares: 0, leads: 0 }; row.posts += 1; for (const metric of ['views', 'likes', 'comments', 'shares', 'leads']) row[metric] += Number(link.metrics?.[metric]) || 0; }
  res.json(Object.values(grouped).map((row: any) => ({ ...row, engagementRate: row.views ? Math.round(((row.likes + row.comments + row.shares) / row.views) * 10000) / 100 : 0 })).sort((a: any, b: any) => b.views - a.views));
});

/* ── 本地降级生成 ──────────────────────────────────────────────────────── */

function compactProductLabel(productInfo: string): string {
  const names = Array.from(String(productInfo || '').matchAll(/产品名称[：:]\s*([^\n]+)/g))
    .map(match => String(match[1] || '').trim())
    .filter(name => name && !/^(this product|主推产品|企业产品组合)$/i.test(name));
  if (names.length) return names.join(' + ').slice(0, 120);
  const match = String(productInfo || '').match(/(?:主推品|产品类目|所属类目|Product|product)\s*[：:]\s*([^\n]+)/i);
  const fallback = String(match?.[1] || String(productInfo || '').split('\n')[0] || '').trim();
  return fallback && !/^(this product|主推产品|企业产品组合)$/i.test(fallback) ? fallback.slice(0, 80) : '选定产品';
}

function productField(productInfo: string, label: string): string {
  const match = String(productInfo || '').match(new RegExp(`${label}[：:]\\s*([^\\n]+)`));
  return match?.[1]?.trim() || '';
}

function firstProductField(productInfo: string, labels: string[]): string {
  for (const label of labels) {
    const value = productField(productInfo, label);
    if (value) return value;
  }
  return '';
}

function productBrief(productInfo: string) {
  const name = compactProductLabel(productInfo);
  const category = firstProductField(productInfo, ['所属类目', '产品类目']) || '目标采购场景';
  const highlights = conservativeClaim(firstProductField(productInfo, ['产品卖点', '核心优势']));
  const moq = firstProductField(productInfo, ['起订量', 'MOQ']);
  const cert = firstProductField(productInfo, ['认证资质', '认证']);
  const price = firstProductField(productInfo, ['价格区间', '价格']);
  const detailPoints = [
    ['容量', firstProductField(productInfo, ['容量'])],
    ['杯体材质', firstProductField(productInfo, ['杯体材质'])],
    ['刀片材质', firstProductField(productInfo, ['刀片材质'])],
    ['材质', firstProductField(productInfo, ['材质', '产品材质'])],
    ['充电方式', firstProductField(productInfo, ['充电方式'])],
    ['尺寸', firstProductField(productInfo, ['尺寸', '产品尺寸'])],
    ['规格', firstProductField(productInfo, ['规格'])],
  ].filter((item): item is string[] => Boolean(item[1])).map(([label, value]) => `${label} ${value}`);
  const highlightPoints = highlights.split(/[、,，;；\n]/).map(item => item.trim()).filter(Boolean);
  const pointList = [
    ...detailPoints,
    ...highlightPoints,
    cert && cert !== '可按需求确认' ? `认证 ${cert}` : '',
    moq && moq !== '可按需求确认' ? `起订量 ${moq}` : '',
    price ? `报价 ${price}` : '',
  ].filter(Boolean);
  return {
    name,
    category,
    highlights,
    moq,
    cert,
    price,
    firstPoint: pointList[0] || highlights || name,
    secondPoint: pointList[1] || pointList[0] || name,
    thirdPoint: pointList[2] || pointList[1] || pointList[0] || name,
    detailPoints,
    highlightPoints,
    naturalTrustPoint: cert && cert !== '可按需求确认' ? '认证和检测资料能不能一次给齐' : '样品和资料能不能按需求确认',
  };
}

function compactBriefCategory(p: ReturnType<typeof productBrief>): string {
  const items = String(p.category || '').split(/[、,，/]/).map(item => item.trim()).filter(Boolean);
  if (p.name && items.some(item => p.name.includes(item) || item.includes(p.name))) return p.name;
  return items[0] || p.name || '产品';
}

function conservativeClaim(value: string): string {
  return String(value || '')
    .replace(/大风吹不烂/g, '不易撕裂，抗拉表现可打样测试')
    .replace(/吹不烂|不破|不裂|纹丝不动/g, '不易撕裂')
    .replace(/最耐用|最便宜|全网|保证/g, '可按需求确认')
    .trim();
}

function normalizePosterBrief(raw: any) {
  const categories = Array.isArray(raw?.categories) ? raw.categories : [];
  return {
    // Empty model fields stay empty. Filling them with generic supplier claims
    // would turn a parse omission into an unverified business promise.
    headline: String(raw?.headline || '').slice(0, 120),
    subheadline: String(raw?.subheadline || '').slice(0, 140),
    originBadge: String(raw?.originBadge || '').slice(0, 80),
    trustBadges: Array.isArray(raw?.trustBadges) ? raw.trustBadges.map(String).slice(0, 8) : [],
    sellingPoints: Array.isArray(raw?.sellingPoints) ? raw.sellingPoints.map(String).slice(0, 8) : [],
    process: Array.isArray(raw?.process) ? raw.process.map(String).slice(0, 8) : [],
    categories: categories.slice(0, 8).map((item: any) => ({
      name: String(item?.name || item || '').slice(0, 80),
      description: String(item?.description || '').slice(0, 140),
    })).filter((item: { name: string }) => item.name),
    bottomBar: Array.isArray(raw?.bottomBar) ? raw.bottomBar.map(String).slice(0, 8) : [],
    cta: String(raw?.cta || '').slice(0, 120),
  };
}

function mimeFromFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}

function materialLocalFile(material: Material): string | null {
  const raw = material.type === 'image'
    ? material.file
    : material.poster ? material.poster.replace(/^\/media\//, '').split('?')[0] : '';
  if (!raw) return null;
  if (raw.includes('/')) return path.join(MEDIA_DIR, raw);
  const generatedCandidate = path.join(GENERATED_MEDIA_DIR, raw);
  if (fs.existsSync(generatedCandidate)) return generatedCandidate;
  return path.join(MEDIA_DIR, raw);
}

async function resolveReferenceImages(materialIds: unknown, tenantId: string): Promise<ReferenceImage[]> {
  const ids = new Set(Array.isArray(materialIds) ? materialIds.map(String) : []);
  if (!ids.size) return [];
  const refs: ReferenceImage[] = [];
  for (const material of loadMaterials()) {
    if (!ids.has(material.id)) continue;
    if (material.scope !== 'shared' && material.tenantId !== tenantId) continue;
    if (material.objectKey) {
      try {
        const key = material.type === 'image' ? material.objectKey : material.posterObjectKey;
        if (!key) continue;
        const downloaded = await r2Download(key);
        if (!downloaded?.buf.length) continue;
        refs.push({ mimeType: downloaded.contentType, base64: downloaded.buf.toString('base64') });
      } catch {
        continue;
      }
      if (refs.length >= 4) break;
      continue;
    }
    const filePath = materialLocalFile(material);
    if (!filePath || !fs.existsSync(filePath)) continue;
    try {
      refs.push({
        mimeType: mimeFromFile(filePath),
        base64: fs.readFileSync(filePath).toString('base64'),
      });
    } catch {
      // Skip unreadable references; generation can still proceed with remaining assets.
    }
    if (refs.length >= 4) break;
  }
  return refs;
}

import { createProjectRevisionGuard, projectRevisionMatches } from '../lib/projectRevision.js';
