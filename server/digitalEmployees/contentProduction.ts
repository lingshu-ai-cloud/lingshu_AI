import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { callLLM } from '../agents/llm.js';
import { SCRIPT_CREATIVE_QUALITY_RULES, scriptCreativeModeRule } from '../prompts/scriptCreativeQuality.js';
import { readTenantEnterpriseProfile, type EnterpriseProfile } from '../routes/enterprise.js';
import { synthesizeStudioVoiceForAutomation } from '../routes/studio.js';
import { assessScriptQualityV2, storyboardSceneRanges, type StudioScriptMaterialInfo } from '../lib/studioScriptQualityV2.js';
import { fetchCloudMaterial, listCloudMaterials } from '../lib/cloudMaterials.js';
import { store } from '../storage/index.js';
import { objectStorageEnabled, r2SignedGetUrl } from '../storage/r2.js';
import { isSyntheticMaterial, syntheticMaterialMarker } from '../lib/materialTruthfulness.js';
import { enterpriseAssetObjectKey, enterpriseAssetTenantKey } from '../storage/enterpriseAssets.js';
import { inspectRenderedVisuals } from '../lib/renderVisualQuality.js';
import { planVideoSourceSegments, resolveSourceDurations } from '../lib/videoSourcePlan.js';
import type { DigitalEmployeeConfig, WeeklyGoalInput } from './domain.js';

const require = createRequire(import.meta.url);
const { composite } = require('../../desktop/render.cjs') as {
  composite: (manifest: unknown, onProgress?: (progress: number) => void, outputDir?: string) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
};

export type ContentProductionRoute = 'clone' | 'product' | 'material';
type ProductionStage = 'script' | 'material_match' | 'voice_subtitles' | 'render' | 'quality' | 'completed' | 'blocked';
export const CONTENT_SCRIPT_QUALITY_RULE_VERSION = 4;
export const CONTENT_PRODUCTION_SCHEMA_VERSION = 2;
export const CONTENT_PRODUCTION_MAX_CONCURRENCY = 2;

type StoredRecord = { id: string; [key: string]: unknown };
export type AssetCandidate = {
  id: string;
  name: string;
  type: 'video' | 'image';
  url?: string;
  localPath?: string;
  objectKey?: string;
  cloudRecordId?: string;
  duration: number;
  observations: string[];
  /** Stable product identity copied from the enterprise profile, never inferred. */
  productId?: string;
  productName?: string;
  visualObservations: string[];
  authorization: {
    status: 'owned' | 'licensed' | 'unknown';
    scope: 'tenant' | 'shared';
    evidence: string;
  };
  synthetic: boolean;
  aspectRatio?: string;
  width?: number;
  height?: number;
  focusX?: number;
  focusY?: number;
  tags: string[];
  source: 'enterprise_product' | 'tenant_material' | 'licensed_shared_material';
};

export interface SceneSourcePlanItem {
  sceneIndex: number;
  start: number;
  end: number;
  intent: string;
  assetId: string;
  productId?: string;
  score: number;
  reasons: string[];
}

export interface RouteSourcePlan {
  route: ContentProductionRoute;
  productId?: string;
  productName?: string;
  assetIds: string[];
  seedAssetId?: string;
  referenceAnalysisId?: string;
  platform: string;
  platformBrief: string;
  gap?: string;
}

export interface ContentProductionOrderInput {
  id: string;
  route: ContentProductionRoute;
  platform: string;
  productId: string;
  productName: string;
  evidenceRefs: Array<{ type: 'exact_analysis' | 'enterprise_material'; id: string }>;
  theme?: { key: string; label: string };
  cta?: string;
  constraints?: string[];
}

export interface ContentRouteEvidence {
  exactAnalysisIds: string[];
  productNames: string[];
  assetIds: string[];
}

export interface ContentRoutePlan {
  allocations: ContentProductionRoute[];
  eligibleRoutes: ContentProductionRoute[];
  blockers: string[];
  evidence: ContentRouteEvidence;
}

export interface ContentProductionAdvanceResult {
  changed: boolean;
  ready: boolean;
  projectRefs: Array<{ type: 'studio_project'; id: string; route: ContentProductionRoute; status: string; stage: string; outputPath?: string }>;
  knowledgeGaps: Array<{ type: 'knowledge_gap'; key: string; label: string; destination: string; purpose: string }>;
  blocker: string;
  summary: string;
}

const text = (value: unknown, max = 1_000): string => String(value ?? '').trim().slice(0, max);
const json = <T>(value: unknown, fallback: T): T => {
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value && typeof value === 'object' ? value as T : fallback;
};

const stableHash = (value: unknown): string => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function productIdentity(product: NonNullable<EnterpriseProfile['products']['items']>[number], index: number): string {
  return text(product.sku, 160) || `product-${stableHash([index, text(product.name, 200)]).slice(0, 16)}`;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => text(item, 160)).filter(Boolean);
  return text(value, 1_000).split(/[,，、;；|\n]+/).map(item => item.trim()).filter(Boolean);
}

function dimensions(record: Record<string, unknown>): { width?: number; height?: number; aspectRatio?: string; focusX?: number; focusY?: number } {
  const width = Number(record.width || json<Record<string, unknown>>(record.metadata, {}).width || 0);
  const height = Number(record.height || json<Record<string, unknown>>(record.metadata, {}).height || 0);
  const explicit = text(record.aspectRatio || record.ratio || json<Record<string, unknown>>(record.metadata, {}).aspectRatio, 40);
  const focusX = Number(record.focusX ?? json<Record<string, unknown>>(record.metadata, {}).focusX);
  const focusY = Number(record.focusY ?? json<Record<string, unknown>>(record.metadata, {}).focusY);
  return {
    ...(width > 0 ? { width } : {}),
    ...(height > 0 ? { height } : {}),
    ...(explicit ? { aspectRatio: explicit } : width > 0 && height > 0 ? { aspectRatio: `${width}:${height}` } : {}),
    ...(Number.isFinite(focusX) && focusX >= 0 && focusX <= 1 ? { focusX } : {}),
    ...(Number.isFinite(focusY) && focusY >= 0 && focusY <= 1 ? { focusY } : {}),
  };
}

export function assetAuthorization(record: Record<string, unknown>, source: AssetCandidate['source']): AssetCandidate['authorization'] {
  const license = text(record.licenseEvidence || record.license, 500);
  if (license) return { status: 'licensed', scope: source === 'licensed_shared_material' ? 'shared' : 'tenant', evidence: license };
  if (source === 'enterprise_product') return { status: 'owned', scope: 'tenant', evidence: '企业知识库当前租户上传' };
  if (source === 'licensed_shared_material') {
    const evidence = text(record.license || record.licenseEvidence || record.authorization || (/licensed/i.test(text(record.sourceType)) ? record.sourceType : ''), 500);
    return { status: evidence ? 'licensed' : 'unknown', scope: 'shared', evidence };
  }
  return { status: 'owned', scope: 'tenant', evidence: text(record.authorization || record.provenance, 500) || '当前租户素材记录' };
}

function assetEligible(asset: AssetCandidate): boolean {
  return !asset.synthetic && asset.authorization.status !== 'unknown';
}

function normalizedTokens(value: string): string[] {
  const latin = value.toLowerCase().match(/[a-z0-9][a-z0-9_-]{1,}/g) || [];
  const chinese = value.match(/[\u3400-\u9fff]{2,6}/g) || [];
  return [...new Set([...latin, ...chinese])].slice(0, 80);
}

function sceneIntent(script: string, start: number, end: number): string {
  const marker = `[${start}-${end}s]`;
  const from = script.indexOf(marker);
  if (from < 0) return '';
  const next = script.indexOf('\n[', from + marker.length);
  const block = script.slice(from, next < 0 ? undefined : next);
  return block.split('\n').filter(line => /^(?:环境|镜头功能|画面)[：:]/.test(line.trim())).join('；').slice(0, 1_000);
}

/**
 * Selects only semantically related assets. Product routes have a hard product
 * ownership boundary; a high keyword score can never cross that boundary.
 */
export function matchSceneSources(input: {
  script: string;
  scenes: Array<{ start: number; end: number }>;
  assets: AssetCandidate[];
  route: ContentProductionRoute;
  productId?: string;
  lockedAssetIds?: string[];
}): { plan: SceneSourcePlanItem[]; gaps: string[] } {
  const locked = new Set(input.lockedAssetIds || []);
  const candidates = input.assets.filter(asset => {
    if (!assetEligible(asset)) return false;
    if (input.route === 'material') return locked.size > 0 && locked.has(asset.id);
    return Boolean(input.productId && asset.productId === input.productId);
  });
  if (!candidates.length) return { plan: [], gaps: [input.route === 'material' ? '已锁定素材不可用或缺少授权' : '缺少属于本产品的已授权视觉素材'] };
  const used = new Map<string, number>();
  const gaps: string[] = [];
  const plan = input.scenes.flatMap((scene, sceneIndex) => {
    const intent = sceneIntent(input.script, scene.start, scene.end);
    const tokens = normalizedTokens(intent);
    const ranked = candidates.map(asset => {
      const haystack = [asset.name, asset.productName, ...asset.visualObservations, ...asset.tags].filter(Boolean).join(' ').toLowerCase();
      const hits = tokens.filter(token => haystack.includes(token.toLowerCase()));
      const ownership = input.productId && asset.productId === input.productId ? 60 : input.route === 'material' ? 40 : 0;
      const observation = asset.visualObservations.length ? 20 : 0;
      const useCount = used.get(asset.id) || 0;
      const reusePenalty = useCount > 0 && used.size < candidates.length ? 100 : useCount * 12;
      return { asset, score: ownership + observation + hits.length * 5 - reusePenalty, hits, reusePenalty };
    }).sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id));
    const best = ranked[0];
    if (!best) {
      gaps.push(`第 ${sceneIndex + 1} 镜头没有相关素材`);
      return [];
    }
    used.set(best.asset.id, (used.get(best.asset.id) || 0) + 1);
    return [{
      sceneIndex, start: scene.start, end: scene.end, intent, assetId: best.asset.id,
      ...(best.asset.productId ? { productId: best.asset.productId } : {}), score: best.score,
      reasons: [
        input.route === 'material' ? '使用脚本生成前锁定的素材' : `素材归属产品 ${best.asset.productName || best.asset.productId}`,
        best.hits.length ? `语义命中：${best.hits.slice(0, 5).join('、')}` : '无关键词命中，按产品归属与已确认视觉观察安全降级',
        best.reusePenalty ? `重复使用扣分 ${best.reusePenalty}` : '优先未使用素材',
      ],
    }];
  });
  return { plan, gaps };
}

export function platformCreativeBrief(platform: string): string {
  const key = platform.toLowerCase();
  if (key.includes('linkedin')) return 'LinkedIn：专业决策者语气，先给业务问题与可信证据，弱化娱乐化表达，CTA 指向商务沟通。';
  if (key.includes('youtube')) return 'YouTube：标题与开场承诺一致，信息结构完整，镜头留出字幕安全区，CTA 指向进一步了解。';
  if (key.includes('instagram')) return 'Instagram：视觉优先、首屏识别产品，短句字幕，突出可保存或可分享的信息点。';
  if (key.includes('facebook')) return 'Facebook：上下文清晰、适合静音浏览，强调场景价值与可信说明。';
  if (key.includes('tiktok')) return 'TikTok：前 2 秒明确钩子，快节奏但不牺牲产品真实性，单一低门槛 CTA。';
  return `${platform || '已确认平台'}：保持平台安全区、可读字幕与单一 CTA；不跨平台复用同一标题、开场和节奏。`;
}

export function contentFingerprint(input: { route: ContentProductionRoute; productId?: string; referenceAnalysisId?: string; assetIds: string[]; script?: string }): string {
  return stableHash({ route: input.route, productId: input.productId || '', referenceAnalysisId: input.referenceAnalysisId || '', assetIds: [...input.assetIds].sort(), script: text(input.script, 30_000) });
}

export function detectContentDuplication(input: {
  candidate: { route: ContentProductionRoute; productId?: string; referenceAnalysisId?: string; assetIds: string[]; script?: string };
  existing: Array<{ fingerprint?: string; route?: ContentProductionRoute; assetIds?: string[]; script?: string }>;
}): { duplicate: boolean; pathDifference: boolean; reason: string } {
  const fingerprint = contentFingerprint(input.candidate);
  if (input.existing.some(item => item.fingerprint === fingerprint)) return { duplicate: true, pathDifference: false, reason: '内容证据、路径与脚本完全重复' };
  const candidateAssets = new Set(input.candidate.assetIds);
  const collision = input.existing.find(item => item.route !== input.candidate.route && (item.assetIds || []).length > 0 && (item.assetIds || []).every(id => candidateAssets.has(id)));
  const normalizedScript = text(input.candidate.script, 30_000).replace(/\s+/g, '');
  const sameScript = input.existing.some(item => item.route !== input.candidate.route && normalizedScript && text(item.script, 30_000).replace(/\s+/g, '') === normalizedScript);
  if (collision || sameScript) return { duplicate: false, pathDifference: false, reason: sameScript ? '不同路径生成了相同脚本' : '不同路径完全复用了同一素材集合' };
  return { duplicate: false, pathDifference: true, reason: '' };
}

export function selectContentProjectsForTick<T extends { stage: string; retryable: boolean }>(projects: T[], limit = CONTENT_PRODUCTION_MAX_CONCURRENCY): T[] {
  const selected: T[] = [];
  let scriptSlotUsed = false;
  for (const project of projects) {
    if (project.stage === 'completed' || (project.stage === 'blocked' && !project.retryable)) continue;
    // Script uniqueness is checked against persisted siblings. Keep that stage
    // serialized while allowing render/voice/quality work to proceed in parallel.
    const effectiveStage = project.stage === 'blocked' ? 'script' : project.stage;
    if (effectiveStage === 'script' && scriptSlotUsed) continue;
    selected.push(project);
    if (effectiveStage === 'script') scriptSlotUsed = true;
    if (selected.length >= Math.max(1, limit)) break;
  }
  return selected;
}

export function containsInternalContentMarker(value: unknown): boolean {
  const content = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return /\be2e[-_][\w-]*|(?:https?:\/\/)?(?:[\w-]+\.)?local\.test\b|\bplaceholder\b|\bmock[-_](?:data|asset|project|content|video|image|test|product)\b/i.test(content);
}

export function subtitleCuesAreSafe(value: unknown, duration: number): boolean {
  const cues = Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
  if (!cues.length) return false;
  return cues.every(cue => {
    const start = Number(cue.start);
    const end = Number(cue.end);
    const content = text(cue.text, 500);
    return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= duration + 0.1
      && content.length > 0 && content.length <= 80 && !containsInternalContentMarker(content);
  });
}

function enabledRoutes(config: DigitalEmployeeConfig): ContentProductionRoute[] {
  const routes: ContentProductionRoute[] = [];
  if (config.enabledWorkflows.includes('viral_clone')) routes.push('clone');
  if (config.enabledWorkflows.includes('product_content')) routes.push('product');
  if (config.enabledWorkflows.includes('material_content')) routes.push('material');
  return routes;
}

export function contentProductionKnowledgeGaps(input: { enabled: ContentProductionRoute[]; evidence: ContentRouteEvidence }) {
  const gaps: ContentProductionAdvanceResult['knowledgeGaps'] = [];
  if (!input.enabled.length) gaps.push({ type: 'knowledge_gap', key: 'content_route', label: '未启用内容生产路径', destination: 'digitalEmployees', purpose: '在 Agent 边界中启用爆款裂变、产品生成或素材生成' });
  if (input.enabled.includes('clone') && !input.evidence.exactAnalysisIds.length) gaps.push({ type: 'knowledge_gap', key: 'exact_analysis', label: '缺少爆款全片精确分析', destination: 'socialInspiration', purpose: '给爆款裂变提供可验证的节奏和分镜依据' });
  if ((input.enabled.includes('clone') || input.enabled.includes('product')) && !input.evidence.productNames.length) gaps.push({ type: 'knowledge_gap', key: 'product', label: '缺少重点产品', destination: 'enterprise', purpose: '为脚本和画面提供可追溯产品事实' });
  if (input.enabled.length && !input.evidence.assetIds.length) gaps.push({ type: 'knowledge_gap', key: 'material', label: '缺少可用企业/授权素材', destination: 'smartAssets', purpose: '为分镜、配音字幕和真实成片渲染提供画面' });
  return gaps;
}

/** Pure allocator: always picks the currently least-used eligible route. */
export function allocateBalancedContentRoutes(input: {
  count: number;
  enabled: ContentProductionRoute[];
  evidence: ContentRouteEvidence;
  priorCounts?: Partial<Record<ContentProductionRoute, number>>;
}): ContentRoutePlan {
  const blockers: string[] = [];
  const eligibleRoutes = input.enabled.filter(route => {
    if (route === 'clone') {
      const ok = input.evidence.exactAnalysisIds.length > 0 && input.evidence.productNames.length > 0 && input.evidence.assetIds.length > 0;
      if (!ok) blockers.push('爆款裂变需要“全片精确分析 + 重点产品 + 可用自有/授权素材”');
      return ok;
    }
    if (route === 'product') {
      const ok = input.evidence.productNames.length > 0 && input.evidence.assetIds.length > 0;
      if (!ok) blockers.push('产品生成需要“重点产品资料 + 至少 1 个可用产品图片/视频”');
      return ok;
    }
    const ok = input.evidence.assetIds.length > 0;
    if (!ok) blockers.push('素材生成需要企业素材库中至少 1 个可编辑的真实图片/视频');
    return ok;
  });
  const counts: Record<ContentProductionRoute, number> = {
    clone: Number(input.priorCounts?.clone || 0),
    product: Number(input.priorCounts?.product || 0),
    material: Number(input.priorCounts?.material || 0),
  };
  const order: ContentProductionRoute[] = ['clone', 'product', 'material'];
  const allocations: ContentProductionRoute[] = [];
  for (let index = 0; index < Math.max(0, Math.min(12, Math.floor(input.count))); index += 1) {
    const route = eligibleRoutes
      .slice()
      .sort((left, right) => counts[left] - counts[right] || order.indexOf(left) - order.indexOf(right))[0];
    if (!route) break;
    allocations.push(route);
    counts[route] += 1;
  }
  return { allocations, eligibleRoutes, blockers: [...new Set(blockers)], evidence: input.evidence };
}

function requestedDraftCount(config: DigitalEmployeeConfig, goal: WeeklyGoalInput): number {
  const cadence = config.socialCadence.match(/(?:每周生成|每周发布|每周)\s*(\d{1,2})\s*条/);
  const count = cadence ? Number(cadence[1]) : Math.max(1, goal.target - goal.baseline);
  return Math.max(1, Math.min(12, count || 5));
}

function exactAnalysis(record: StoredRecord): boolean {
  const analysis = json<Record<string, unknown>>(record.aiAnalysis, {});
  return analysis.analysisMode === 'exact' && analysis.analysisQuality === 'video' && Boolean(analysis.gemini);
}

function realMaterial(record: Record<string, unknown>, tenantId: string): boolean {
  if (isSyntheticMaterial(record)) return false;
  if (String(record.usage || 'editable') === 'reference_only') return false;
  const scope = String(record.scope || 'own');
  return scope === 'shared' || String(record.tenantId || record.tenant_id || '') === tenantId;
}

function observationsForMaterial(record: Record<string, unknown>): string[] {
  const segments = Array.isArray(record.segments) ? record.segments as Array<Record<string, unknown>> : [];
  const fromSegments = segments.flatMap(segment => [
    text(segment.action, 180),
    text(segment.environment, 180),
    ...(Array.isArray(segment.subject) ? segment.subject.map(item => text(item, 100)) : []),
  ]).filter(Boolean);
  return [...new Set(fromSegments.length ? fromSegments : [
    [record.name, record.industry, record.shotFunction, record.applicability, record.tags].map(value => text(value, 160)).filter(Boolean).join('；'),
  ].filter(Boolean))].slice(0, 8);
}

function mimeFromFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mov') return 'video/quicktime';
  return 'video/mp4';
}

function localMaterials(tenantId: string): AssetCandidate[] {
  const file = path.resolve(process.cwd(), 'data', 'materials.json');
  let records: Array<Record<string, unknown>> = [];
  try { records = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<Record<string, unknown>>; } catch { return []; }
  return records.filter(record => realMaterial(record, tenantId) && ['video', 'image'].includes(String(record.type || ''))).flatMap(record => {
    const relative = text(record.file, 500);
    const localPath = relative ? path.resolve(process.cwd(), 'data', 'media', relative) : '';
    const objectKey = text(record.objectKey, 1_000);
    if ((!localPath || !fs.existsSync(localPath) || fs.statSync(localPath).size <= 0) && !objectKey) return [];
    const source = String(record.scope || 'own') === 'shared' ? 'licensed_shared_material' as const : 'tenant_material' as const;
    const visualObservations = observationsForMaterial(record);
    return [{
      id: text(record.id, 160), name: text(record.name, 200) || '企业素材', type: String(record.type) as 'video' | 'image',
      ...(localPath && fs.existsSync(localPath) ? { localPath } : {}), ...(objectKey ? { objectKey } : {}), duration: Math.max(0, Number(record.duration || 0)),
      observations: visualObservations, visualObservations,
      ...(text(record.productId, 160) ? { productId: text(record.productId, 160) } : {}),
      ...(text(record.productName, 200) ? { productName: text(record.productName, 200) } : {}),
      authorization: assetAuthorization(record, source), synthetic: isSyntheticMaterial(record), ...dimensions(record),
      tags: stringList(record.tags), source,
    }];
  });
}

export function resolveEnterpriseAssetLocation(
  assetUrl: string,
  tenantId: string,
  options: { assetsDir?: string; objectStorage?: boolean } = {},
): Pick<AssetCandidate, 'url' | 'localPath' | 'objectKey'> {
  const url = text(assetUrl, 2_000);
  if (!url || syntheticMaterialMarker(url)) return {};
  if (/^(?:https?:|data:)/i.test(url)) return { url };
  const match = url.match(/^\/api\/overseas\/enterprise\/assets\/([^/?#]+)(?:[?#].*)?$/i);
  if (!match) return {};
  let filename = '';
  try { filename = path.basename(decodeURIComponent(match[1]!)); } catch { return {}; }
  if (!filename || syntheticMaterialMarker(filename)) return {};
  const assetsDir = options.assetsDir || path.resolve(process.cwd(), 'data', 'enterprise-assets');
  const localPath = path.join(assetsDir, enterpriseAssetTenantKey(tenantId), filename);
  try {
    if (fs.statSync(localPath).size > 0) return { localPath };
  } catch { /* the tenant asset may live only in object storage */ }
  const useObjectStorage = options.objectStorage ?? objectStorageEnabled();
  return useObjectStorage ? { objectKey: enterpriseAssetObjectKey(tenantId, filename) } : {};
}

function enterpriseAssets(profile: EnterpriseProfile, tenantId: string): AssetCandidate[] {
  return (profile.products.items || []).flatMap((product, productIndex) => {
    const groups = [product.images, product.videos, product.factoryImages, product.packagingImages, product.sceneImages, product.brandAssets].filter(Array.isArray) as Array<Array<{ name: string; type: string; url?: string }>>;
    if (product.imageUrl) groups.unshift([{ name: `${product.name || '产品'}主图`, type: 'image', url: product.imageUrl }]);
    return groups.flat().flatMap((asset, assetIndex) => {
      const url = text(asset.url, 2_000);
      // A legitimate file may be named "product-demo.mp4". Only explicit
      // synthetic provenance markers are rejected; display words are not data lineage.
      const location = resolveEnterpriseAssetLocation(url, tenantId);
      if (!location.url && !location.localPath && !location.objectKey) return [];
      const type = /video/i.test(asset.type || '') || /\.(mp4|mov|webm)(?:\?|$)/i.test(url) ? 'video' as const : 'image' as const;
      const productId = productIdentity(product, productIndex);
      const visualObservations = [`企业知识库产品“${product.name || '未命名产品'}”的已上传${type === 'video' ? '视频' : '图片'}`];
      return [{
        id: `enterprise-product-${productIndex}-${assetIndex}-${Buffer.from(url).toString('base64url').slice(0, 12)}`,
        name: text(asset.name, 200) || `${product.name || '产品'}素材`, type, ...location, duration: 0,
        productId, productName: text(product.name, 200), observations: visualObservations, visualObservations,
        authorization: assetAuthorization(asset as unknown as Record<string, unknown>, 'enterprise_product'), synthetic: false, ...dimensions(asset as unknown as Record<string, unknown>),
        tags: [text(product.category, 120), text(product.sku, 120), text(asset.name, 120)].filter(Boolean), source: 'enterprise_product' as const,
      }];
    });
  });
}

async function collectAssets(tenantId: string, profile: EnterpriseProfile): Promise<AssetCandidate[]> {
  const cloud = await listCloudMaterials(tenantId).catch(() => []);
  const cloudAssets = cloud.filter(record => realMaterial(record, tenantId) && ['video', 'image'].includes(String(record.type || ''))).map(record => ({
    id: text(record.id, 160), name: text(record.name, 200) || '云端素材', type: String(record.type) as 'video' | 'image',
    url: text(record.url, 2_000), cloudRecordId: text(record.id).replace(/^pb-/, ''), duration: Math.max(0, Number(record.duration || 0)),
    observations: observationsForMaterial(record), visualObservations: observationsForMaterial(record),
    ...(text(record.productId, 160) ? { productId: text(record.productId, 160) } : {}),
    ...(text(record.productName, 200) ? { productName: text(record.productName, 200) } : {}),
    authorization: assetAuthorization(record, String(record.scope || 'own') === 'shared' ? 'licensed_shared_material' : 'tenant_material'),
    synthetic: isSyntheticMaterial(record), ...dimensions(record), tags: stringList(record.tags),
    source: String(record.scope || 'own') === 'shared' ? 'licensed_shared_material' as const : 'tenant_material' as const,
  }));
  const byId = new Map([...localMaterials(tenantId), ...cloudAssets, ...enterpriseAssets(profile, tenantId)].map(asset => [asset.id, asset]));
  return [...byId.values()].filter(assetEligible);
}

export function selectExplicitFocusProducts<T extends { name: string; sku?: string }>(products: T[], focusProducts: string): T[] {
  const focus = focusProducts.split(/[,，、;；\n]/).map(item => item.trim()).filter(Boolean);
  if (!focus.length) return [];
  return products.filter(item => focus.some(name => name === item.name || name === item.sku));
}

function selectedProductItems(profile: EnterpriseProfile, config: DigitalEmployeeConfig) {
  const selected = selectExplicitFocusProducts(profile.products.items || [], config.focusProducts);
  return (profile.products.items || []).map((item, index) => ({ item, productId: productIdentity(item, index) }))
    .filter(({ item }) => selected.includes(item));
}

function productFacts(profile: EnterpriseProfile, config: DigitalEmployeeConfig, productId?: string): string {
  const items = selectedProductItems(profile, config).filter(item => !productId || item.productId === productId).map(item => item.item);
  return items.map(item => [
    `产品：${item.name}`, item.sku ? `SKU：${item.sku}` : '', item.category ? `类别：${item.category}` : '',
    item.material ? `材质：${item.material}` : '', item.priceRange ? `价格范围：${item.priceRange}` : '',
    item.moq ? `MOQ：${item.moq}` : '', item.certifications ? `认证：${item.certifications}` : '', item.highlights ? `特点：${item.highlights}` : '',
  ].filter(Boolean).join('；')).join('\n').slice(0, 8_000);
}

function referenceStructure(record?: StoredRecord): { id: string; structure: unknown; observedFacts: string[]; hash: string } | null {
  if (!record) return null;
  const analysis = json<Record<string, unknown>>(record.aiAnalysis, {});
  const gemini = json<Record<string, unknown>>(analysis.gemini, {});
  const shots = Array.isArray(gemini.scriptDetails15s) ? gemini.scriptDetails15s : Array.isArray(gemini.shots) ? gemini.shots : [];
  const structure = shots.map((shot, index) => {
    const row = json<Record<string, unknown>>(shot, {});
    return {
      index,
      time: text(row.time, 80),
      shot: text(row.shot, 120),
      camera: text(row.camera, 120),
      purpose: text(row.purpose, 180),
      beats: Array.isArray(row.beats) ? row.beats : [],
      transitionToNext: text(row.transitionToNext, 180),
    };
  });
  const observedFacts = shots.flatMap(shot => {
    const row = json<Record<string, unknown>>(shot, {});
    return Array.isArray(row.observedFacts) ? row.observedFacts.map(item => text(item, 200)).filter(Boolean) : [];
  });
  if (!structure.length) return null;
  return { id: record.id, structure, observedFacts, hash: stableHash(structure) };
}

function evidenceAssetSnapshot(asset: AssetCandidate) {
  return {
    id: asset.id, name: asset.name, type: asset.type, source: asset.source,
    productId: asset.productId || '', productName: asset.productName || '',
    visualObservations: asset.visualObservations, authorization: asset.authorization,
    synthetic: asset.synthetic, aspectRatio: asset.aspectRatio || '', width: asset.width || 0, height: asset.height || 0,
    ...(typeof asset.focusX === 'number' ? { focusX: asset.focusX } : {}), ...(typeof asset.focusY === 'number' ? { focusY: asset.focusY } : {}),
    tags: asset.tags,
  };
}

export function buildRouteSourcePlans(input: {
  allocations: ContentProductionRoute[];
  products: Array<{ productId: string; productName: string }>;
  assets: AssetCandidate[];
  referenceAnalysisIds: string[];
  platforms: string[];
  existingFingerprints?: string[];
}): RouteSourcePlan[] {
  const productCursor = new Map<string, number>();
  const usedAcrossRoutes = new Set<string>();
  const usedReferences = new Set<string>();
  return input.allocations.map((route, slot) => {
    const platform = input.platforms[slot % Math.max(1, input.platforms.length)] || '';
    const base = { route, platform, platformBrief: platformCreativeBrief(platform) };
    if (route === 'material') {
      const material = input.assets
        .filter(asset => assetEligible(asset) && !usedAcrossRoutes.has(asset.id))
        .sort((a, b) => Number(Boolean(b.visualObservations.length)) - Number(Boolean(a.visualObservations.length)) || a.id.localeCompare(b.id))[0];
      if (!material) return { ...base, assetIds: [], gap: '素材生成缺少尚未使用的已授权真实素材；不会复用其他路径素材冒充新内容' };
      const companions = material.productId ? input.assets.filter(asset => assetEligible(asset) && asset.id !== material.id && asset.productId === material.productId && !usedAcrossRoutes.has(asset.id)).slice(0, 2) : [];
      const assetIds = [material.id, ...companions.map(asset => asset.id)];
      assetIds.forEach(id => usedAcrossRoutes.add(id));
      return { ...base, ...(material.productId ? { productId: material.productId, productName: material.productName } : {}), seedAssetId: material.id, assetIds };
    }
    const candidates = input.products.filter(product => input.assets.some(asset => assetEligible(asset) && asset.productId === product.productId && !usedAcrossRoutes.has(asset.id)));
    if (!candidates.length) return { ...base, assetIds: [], gap: `${routeTitle(route)}缺少“重点产品 + 归属于该产品的已授权素材”` };
    const selected = candidates.slice().sort((left, right) => (productCursor.get(left.productId) || 0) - (productCursor.get(right.productId) || 0) || left.productId.localeCompare(right.productId))[0]!;
    productCursor.set(selected.productId, (productCursor.get(selected.productId) || 0) + 1);
    const ownedAssets = input.assets.filter(asset => assetEligible(asset) && asset.productId === selected.productId && !usedAcrossRoutes.has(asset.id));
    ownedAssets.forEach(asset => usedAcrossRoutes.add(asset.id));
    if (route === 'product') return { ...base, productId: selected.productId, productName: selected.productName, assetIds: ownedAssets.map(asset => asset.id) };
    const referenceAnalysisId = input.referenceAnalysisIds.find(id => !usedReferences.has(id));
    if (!referenceAnalysisId) return { ...base, productId: selected.productId, productName: selected.productName, assetIds: ownedAssets.map(asset => asset.id), gap: '爆款裂变缺少尚未用于本批次的精确参考结构' };
    usedReferences.add(referenceAnalysisId);
    return { ...base, productId: selected.productId, productName: selected.productName, assetIds: ownedAssets.map(asset => asset.id), referenceAnalysisId };
  });
}

function routeTitle(route: ContentProductionRoute): string {
  return route === 'clone' ? '爆款裂变' : route === 'product' ? '产品生成' : '素材生成';
}

function projectAutomation(record: StoredRecord): Record<string, unknown> {
  return json<Record<string, unknown>>(json<Record<string, unknown>>(record.spec, {}).automation, {});
}

export function automatedContentQualityNeedsRevalidation(automation: Record<string, unknown>): boolean {
  if (automation.managedBy !== 'digital_employee' || text(automation.stage) !== 'completed') return false;
  const quality = json<Record<string, unknown>>(automation.quality, {});
  return Number(quality.ruleVersion || 0) !== CONTENT_SCRIPT_QUALITY_RULE_VERSION;
}

function stagePatch(automation: Record<string, unknown>, stage: ProductionStage, extra: Record<string, unknown> = {}) {
  return { ...automation, stage, updatedAt: new Date().toISOString(), ...extra };
}

function selectedAssets(spec: Record<string, unknown>, all: AssetCandidate[]): AssetCandidate[] {
  const ids = Array.isArray(spec.selectedMaterialIds) ? spec.selectedMaterialIds.map(String) : [];
  return ids.map(id => all.find(asset => asset.id === id)).filter((asset): asset is AssetCandidate => Boolean(asset));
}

function voiceoverText(script: string): string {
  return script.split('\n').flatMap(line => {
    const match = line.trim().match(/^(?:台词|口播|voiceover|vo)[：:]\s*(.+)$/i);
    return match?.[1] && match[1] !== '无' ? [match[1]] : [];
  }).join(' ').slice(0, 1_500);
}

export function splitSubtitleUnits(value: string, maxChars = 36): string[] {
  const sentences = value.match(/[^。！？!?]+[。！？!?]?/g)?.map(item => item.trim()).filter(Boolean) || [value.trim()];
  return sentences.flatMap(sentence => {
    if (sentence.length <= maxChars) return [sentence];
    const phrases = sentence.match(/[^，；：、,;:]+[，；：、,;:]?/g)?.map(item => item.trim()).filter(Boolean) || [sentence];
    const units: string[] = [];
    let current = '';
    const flush = () => {
      if (current.trim()) units.push(current.trim());
      current = '';
    };
    for (const phrase of phrases) {
      if (phrase.length > maxChars) {
        flush();
        for (let cursor = 0; cursor < phrase.length; cursor += maxChars) units.push(phrase.slice(cursor, cursor + maxChars));
      } else if (!current || current.length + phrase.length <= maxChars) current += phrase;
      else {
        flush();
        current = phrase;
      }
    }
    flush();
    return units;
  }).filter(Boolean);
}

export function proportionalCues(value: string, duration: number) {
  const parts = splitSubtitleUnits(value);
  const total = parts.reduce((sum, item) => sum + item.length, 0) || 1;
  let cursor = 0;
  return parts.map((part, index) => {
    const start = cursor;
    const end = index === parts.length - 1 ? duration : cursor + duration * part.length / total;
    cursor = end;
    return { start: Number(start.toFixed(2)), end: Number(end.toFixed(2)), text: part };
  });
}

export function productionTiming(spec: { duration?: unknown; voiceoverDur?: unknown }, ranges: Array<{ start: number; end: number }>) {
  const positive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
  const duration = Math.max(positive(spec.duration) || 20, positive(spec.voiceoverDur));
  const weights = ranges.map(range => range.end - range.start);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!weights.length || weights.some(weight => !Number.isFinite(weight) || weight <= 0)) throw new Error('invalid_scene_timing');
  return { duration, sceneDurations: weights.map(weight => duration * weight / total) };
}

export async function assetRenderUrl(asset: AssetCandidate, tenantId: string): Promise<string> {
  if (asset.localPath && fs.existsSync(asset.localPath)) {
    return `data:${mimeFromFile(asset.localPath)};base64,${fs.readFileSync(asset.localPath).toString('base64')}`;
  }
  if (asset.objectKey && objectStorageEnabled()) return r2SignedGetUrl(asset.objectKey, 15 * 60);
  if (asset.cloudRecordId) {
    const response = await fetchCloudMaterial(asset.cloudRecordId, asset.type === 'video' ? 'videoFile' : 'posterFile', undefined, tenantId);
    if (response?.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length) return `data:${response.headers.get('content-type') || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg')};base64,${bytes.toString('base64')}`;
    }
  }
  const url = text(asset.url, 4_000);
  return /^(?:https?:|data:)/i.test(url) ? url : '';
}

async function updateProject(record: StoredRecord, spec: Record<string, unknown>, status = 'draft') {
  const ok = await store.update('studio_projects', record.id, { spec, status, updated_at: new Date().toISOString() });
  if (!ok) throw new Error('studio_project_update_failed');
}

function retryable(stage: Record<string, unknown>): boolean {
  const next = Date.parse(text(stage.retryAfter, 80));
  return !Number.isFinite(next) || next <= Date.now();
}

export function contentProjectBlockIsSemanticallyUnchanged(input: {
  automation: Record<string, unknown>;
  resumeStage: ProductionStage;
  reason: string;
}): boolean {
  return text(input.automation.stage) === 'blocked'
    && text(input.automation.status) === 'blocked'
    && text(input.automation.resumeStage) === input.resumeStage
    && text(input.automation.blocker, 2_000) === text(input.reason, 2_000);
}

/**
 * Clears a content project's internal backoff after an explicit task retry or
 * replan. The project payload, selected real materials and render receipts are
 * preserved; only the retry-control fields for the exact run/task lineage are
 * changed.
 */
export function resumeContentProjectForTaskControl(input: {
  project: Record<string, unknown>;
  runId: string;
  affectedTaskIds: Set<string>;
  now: string;
}): Record<string, unknown> | null {
  const spec = json<Record<string, unknown>>(input.project.spec, {});
  const automation = json<Record<string, unknown>>(spec.automation, {});
  if (automation.managedBy !== 'digital_employee') return null;
  if (text(spec.workflowRunId) !== input.runId || !input.affectedTaskIds.has(text(spec.workflowTaskId))) return null;
  if (text(automation.stage) !== 'blocked') return null;
  const requestedStage = text(automation.resumeStage) as ProductionStage;
  const resumeStage: ProductionStage = ['script', 'material_match', 'voice_subtitles', 'render', 'quality'].includes(requestedStage)
    ? requestedStage
    : 'script';
  const { retryAfter: _retryAfter, resumeStage: _resumeStage, blocker: _blocker, ...preserved } = automation;
  return {
    ...spec,
    automation: {
      ...preserved,
      stage: resumeStage,
      status: 'queued',
      retryRequestedAt: input.now,
      updatedAt: input.now,
    },
  };
}

export function isLlmUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /timed?\s*out|timeout|not set|unavailable|temporar|network|fetch|econn|socket|503|502|504|service/i.test(message);
}

function safeFactClauses(value: string): string[] {
  return value
    .split(/[\n；;]+/)
    .map(item => item.trim().replace(/[\r\n]+/g, ' '))
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * Provider-independent continuity path. Every factual noun phrase is copied
 * from product facts or a tenant-owned/licensed asset observation. It does not
 * infer certifications, efficacy, labels, people, actions or environments.
 */
export function deterministicClosedWorldStoryboard(input: {
  productFacts: string;
  assets: AssetCandidate[];
}): string {
  const facts = safeFactClauses(input.productFacts);
  const spoken = [
    facts[0] ? `已确认产品资料：${facts[0]}。` : '先看已上传素材中能够确认的实际内容。',
    facts[1] ? `已确认产品资料：${facts[1]}。` : '本段仅展示已上传素材中可见的主体。',
    facts[2] ? `已确认产品资料：${facts[2]}。` : '内容仅使用企业已提供的产品与素材信息。',
    facts[3] ? `已确认产品资料：${facts[3]}。` : '具体规格与合作条件请以企业确认资料为准。',
    '如需了解已确认的产品资料，请私信获取方案。',
  ];
  return spoken.map((line, index) => {
    const asset = input.assets[index % input.assets.length];
    const observation = asset?.observations.map(item => text(item, 180)).find(Boolean) || '';
    const visual = observation
      ? `展示素材“${text(asset?.name, 120) || '已上传素材'}”中已确认可见的内容：${observation}`
      : '展示已上传素材中已确认可见的主体';
    return `[${index * 4}-${(index + 1) * 4}s]\n环境：已上传素材所示实际环境\n景别：保持原素材景别\n运镜：固定\n构图：保持原素材构图\n镜头功能：${index === 4 ? '保守行动引导' : '展示可验证素材'}\n画面：${visual}\n配乐：轻节奏\n台词：${line}\n字幕：${line}`;
  }).join('\n\n');
}

type GeneratedScript = { script: string; source: 'llm' | 'deterministic_closed_world_fallback'; degradedReason: string };

async function generateScript(input: {
  route: ContentProductionRoute; config: DigitalEmployeeConfig; goal: WeeklyGoalInput; profile: EnterpriseProfile; assets: AssetCandidate[]; reference?: StoredRecord;
  productId?: string; platformBrief: string; contentOrder?: ContentProductionOrderInput;
}): Promise<GeneratedScript> {
  const facts = productFacts(input.profile, input.config, input.productId);
  const reference = input.route === 'clone' ? referenceStructure(input.reference) : null;
  const referenceSummary = reference ? JSON.stringify(reference.structure).slice(0, 8_000) : '';
  const materialEvidence = input.assets.slice(0, 8).map(asset => `${asset.name}：${asset.observations.join('；')}`).join('\n');
  const prompt = `你是严谨的 B2B 短视频分镜导演。根据已确认事实生成一条 20 秒视频脚本。
生产路径：${routeTitle(input.route)}
目标：${input.goal.objective}
本条主题：${input.contentOrder?.theme?.label || '按周目标生成'}
客户：${input.config.customerProfile}
市场：${input.goal.scope || input.config.targetMarkets}
平台创作要求：${input.platformBrief}
行动引导：${input.contentOrder?.cta || '私信获取方案'}
本条冻结约束：${(input.contentOrder?.constraints || []).join('；') || '遵守企业与周目标约束'}
产品事实（封闭世界，不得补造）：
${facts || '（无）'}
可用素材事实：
${materialEvidence || '（无）'}
${referenceSummary ? `爆款参考结构（必须逐段对应其时间、镜头功能、节奏和转场；只迁移结构，不复制品牌、文案或参考主体）：\n${referenceSummary}` : ''}

路径规则：${input.route === 'material'
    ? '素材路径已经先锁定素材。必须从该素材已观察到的主体和动作开始组织脚本，不能写完脚本再寻找别的画面。'
    : input.route === 'product'
      ? '产品路径以单个产品事实为中心，画面只能使用明确归属于该产品的素材。'
      : '裂变路径逐段复用精确参考结构，同时只能使用当前产品自己的素材替换参考主体。'}

${SCRIPT_CREATIVE_QUALITY_RULES}
${scriptCreativeModeRule(input.route)}

事实边界（违反任一条即为不可用脚本）：
1. 只能逐字采用“产品事实”中已有的规格、MOQ、纯度、认证或合规结论；不得从品类、市场或常识推断“高纯度”“符合美国市场合规”等结论。
2. “可用素材事实”只证明其中明确写出的可见内容。不得声称标签、包装或画面中出现 FOR SENSITIVE SKIN、MOQ、二维码、邮箱、VI、认证标识或任何未在素材观察中明确记录的文字/物体。
3. 不知道素材具体画面时，保守写“展示已上传产品素材中的实际可见主体”，不得自行补出旋转瓶身、扫码、标签特写、邮件界面等动作。
4. 产品资料中的文本事实不等于素材中肉眼可见；台词可引用已确认事实，但画面仍只能写素材观察已确认的内容。
5. 展示设备视频不证明性能或兼容性通过测试；产品事实未明确验证时，不得使用“已验证兼容”“兼容性已验证”等结论，应邀请工程师按具体需求核实。

只输出中文成稿，恰好 5 段，时间线从 0 到 20 秒连续。每段严格按以下格式：
[0-4s]
环境：<只写素材已证明或可执行的环境>
景别：<景别>
运镜：<运镜>
构图：<构图>
镜头功能：<本段作用>
画面：<可执行画面；缺少证据就写待匹配素材>
配乐：<情绪>
台词：<自然口播，不说未确认价格、功效、交期>
字幕：<与台词逐字一致>

最后只保留一个低门槛 CTA。不输出 Markdown 或解释。`;
  try {
    const script = (await callLLM(prompt, { timeoutMs: 90_000, systemPrompt: '你必须遵守封闭世界事实约束。产品事实与视觉素材证据严格分离；未明确提供的纯度、合规、认证、标签文字、二维码、邮箱、VI 和画面动作一律不得生成。缺少证据时使用保守场景或明确待匹配，不得虚构。' })).trim();
    if (!script) {
      return { script: deterministicClosedWorldStoryboard({ productFacts: facts, assets: input.assets }), source: 'deterministic_closed_world_fallback', degradedReason: 'LLM 未返回内容' };
    }
    return { script, source: 'llm', degradedReason: '' };
  } catch (error) {
    if (!isLlmUnavailableError(error)) throw error;
    return {
      script: deterministicClosedWorldStoryboard({ productFacts: facts, assets: input.assets }),
      source: 'deterministic_closed_world_fallback',
      degradedReason: text(error instanceof Error ? error.message : error, 500) || 'LLM 服务不可用',
    };
  }
}

async function advanceOneProject(input: {
  tenantId: string; record: StoredRecord; config: DigitalEmployeeConfig; goal: WeeklyGoalInput; profile: EnterpriseProfile; assets: AssetCandidate[]; analyses: StoredRecord[]; allProjects: StoredRecord[];
}): Promise<{ changed: boolean; blocker: string }> {
  const spec = json<Record<string, unknown>>(input.record.spec, {});
  const automation = projectAutomation(input.record);
  const route = text(automation.route) as ContentProductionRoute;
  const legacyAssetIds = Array.isArray(spec.selectedMaterialIds) ? spec.selectedMaterialIds.map(String) : [];
  const legacyAssets = legacyAssetIds.map(id => input.assets.find(asset => asset.id === id)).filter((asset): asset is AssetCandidate => Boolean(asset));
  const legacyProductId = legacyAssets.map(asset => asset.productId).find(Boolean);
  const routePlan = json<RouteSourcePlan>(automation.routePlan, {
    route, assetIds: legacyAssetIds, ...(legacyProductId ? { productId: legacyProductId } : {}),
    referenceAnalysisId: text(automation.referenceAnalysisId), platform: text(spec.platform), platformBrief: platformCreativeBrief(text(spec.platform)),
  });
  const contentOrder = json<ContentProductionOrderInput | undefined>(spec.contentOrder, undefined);
  const routeAssets = routePlan.assetIds.map(id => input.assets.find(asset => asset.id === id)).filter((asset): asset is AssetCandidate => Boolean(asset));
  let stage = text(automation.stage) as ProductionStage;
  if (stage === 'blocked') {
    if (!retryable(automation)) return { changed: false, blocker: text(automation.blocker) };
    stage = text(automation.resumeStage) as ProductionStage || 'script';
  }
  const block = async (resumeStage: ProductionStage, reason: string, details: Record<string, unknown> = {}) => {
    const semanticRepeat = contentProjectBlockIsSemanticallyUnchanged({ automation, resumeStage, reason });
    const next = { ...spec, automation: stagePatch(automation, 'blocked', { ...details, status: 'blocked', blocker: reason, resumeStage, retryAfter: new Date(Date.now() + 15 * 60_000).toISOString() }) };
    await updateProject(input.record, next);
    // retryAfter remains operational state and is refreshed after a real retry,
    // but it must not produce another identical business progress event.
    return { changed: !semanticRepeat, blocker: reason };
  };

  try {
    if (stage === 'script') {
      const referenceId = text(automation.referenceAnalysisId);
      const reference = input.analyses.find(item => item.id === referenceId);
      if (routePlan.gap) return block('script', routePlan.gap);
      if (route === 'clone' && (!reference || !referenceStructure(reference))) return block('script', '爆款裂变缺少可解析的精确参考结构');
      if (!routeAssets.length) return block('script', route === 'material' ? '素材路径在写脚本前必须先锁定一条已授权素材' : '缺少属于当前产品的已授权素材');
      const generated = await generateScript({
        route, config: input.config, goal: input.goal, profile: input.profile, assets: routeAssets, reference,
        productId: routePlan.productId, platformBrief: routePlan.platformBrief,
        contentOrder,
      });
      const script = generated.script;
      if (!script || storyboardSceneRanges(script).length < 4) return block('script', '脚本服务未返回完整的可执行分镜');
      const fingerprint = contentFingerprint({ route, productId: routePlan.productId, referenceAnalysisId: referenceId, assetIds: routePlan.assetIds, script });
      const prior = input.allProjects.filter(item => item.id !== input.record.id).map(item => {
        const otherSpec = json<Record<string, unknown>>(item.spec, {});
        const otherAutomation = projectAutomation(item);
        const otherRoutePlan = json<RouteSourcePlan>(otherAutomation.routePlan, { route: text(otherAutomation.route) as ContentProductionRoute, assetIds: [], platform: '', platformBrief: '' });
        return { fingerprint: text(otherAutomation.contentFingerprint), route: otherRoutePlan.route, assetIds: otherRoutePlan.assetIds, script: text(otherSpec.script, 30_000) };
      });
      const duplication = detectContentDuplication({ candidate: { route, productId: routePlan.productId, referenceAnalysisId: referenceId, assetIds: routePlan.assetIds, script }, existing: prior });
      if (duplication.duplicate || !duplication.pathDifference) return block('script', `跨项目差异检查未通过：${duplication.reason}`);
      await updateProject(input.record, {
        ...spec,
        script,
        activeStepId: 'script',
        automation: stagePatch(automation, 'material_match', {
          blocker: '',
          scriptGeneratedAt: new Date().toISOString(),
          scriptSource: generated.source,
          contentVersion: Number(automation.contentVersion || 0) + 1,
          contentHash: stableHash(script), contentFingerprint: fingerprint,
          pathDifferenceCheck: duplication,
          ...(generated.degradedReason ? { scriptDegradedReason: generated.degradedReason } : {}),
        }),
      });
      return { changed: true, blocker: '' };
    }
    if (stage === 'material_match') {
      if (!routeAssets.length) return block('material_match', '缺少本路径锁定的可编辑真实企业/授权素材，无法进入成片生产');
      const script = text(spec.script, 30_000);
      const scenes = storyboardSceneRanges(script);
      const matching = matchSceneSources({ script, scenes, assets: routeAssets, route, productId: routePlan.productId, lockedAssetIds: routePlan.assetIds });
      if (matching.gaps.length || matching.plan.length !== scenes.length) {
        const generatedVisualsAllowed = (input.config as unknown as { allowGeneratedVisuals?: boolean }).allowGeneratedVisuals === true;
        return block('material_match', generatedVisualsAllowed
          ? `needs_visual_generation_provider：${matching.gaps.join('；') || '部分镜头没有相关素材'}；仅允许补齐缺失镜头，且不得虚构产品本体`
          : `素材覆盖缺口：${matching.gaps.join('；') || '部分镜头没有相关素材'}；未授权生成视觉，已安全停止`);
      }
      const chosen = matching.plan.map(item => routeAssets.find(asset => asset.id === item.assetId)!).filter(Boolean);
      const timing = productionTiming(spec, scenes);
      const sourceCoverage = planVideoSourceSegments(await resolveSourceDurations(chosen), timing.sceneDurations);
      if (sourceCoverage.gaps.length) return block('material_match', `素材覆盖缺口：${sourceCoverage.gaps.join('；')}`, { sourceCoverage });
      const materialInfos: StudioScriptMaterialInfo[] = chosen.map((asset, index) => ({ name: asset.name, targetStart: scenes[index]?.start, targetEnd: scenes[index]?.end, observations: asset.observations }));
      const quality = assessScriptQualityV2({ script, productInfo: productFacts(input.profile, input.config, routePlan.productId), materialsText: chosen.map(asset => asset.observations.join('；')).join('\n'), materialInfos, primaryCta: contentOrder?.cta || '私信获取方案', targetBuyerText: input.config.customerProfile });
      if (quality.qualityStatus === 'rejected') return block('script', `脚本事实质检未通过：${quality.hardIssues.join('；')}`);
      if (quality.qualityStatus === 'needs_material') return block('material_match', `素材覆盖不足：${quality.warnings.join('；') || `仍有 ${quality.materialCoverage.pendingScenes} 个分镜缺少可验证画面`}`);
      await updateProject(input.record, {
        ...spec, script: quality.script, selectedMaterialIds: [...new Set(chosen.map(asset => asset.id))], materialInfos,
        sceneSourcePlan: matching.plan,
        sourceSegments: sourceCoverage.segments,
        selectedMaterialEvidence: [...new Map(chosen.map(asset => [asset.id, asset])).values()].map(asset => ({ ...evidenceAssetSnapshot(asset), tenantScoped: asset.source !== 'licensed_shared_material', hasLocalFile: Boolean(asset.localPath), hasPersistedUrl: Boolean(asset.url) })),
        activeStepId: 'script', automation: stagePatch(automation, 'voice_subtitles', {
          blocker: '', scriptQuality: { ...quality, ruleVersion: CONTENT_SCRIPT_QUALITY_RULE_VERSION },
          scriptQualityRuleVersion: CONTENT_SCRIPT_QUALITY_RULE_VERSION,
        }),
      });
      return { changed: true, blocker: '' };
    }
    if (stage === 'voice_subtitles') {
      // Historical tasks can resume here without the new material preflight.
      const scenes = storyboardSceneRanges(text(spec.script, 30_000));
      const sourcePlan = Array.isArray(spec.sceneSourcePlan) ? spec.sceneSourcePlan as SceneSourcePlanItem[] : [];
      const sourceAssets = sourcePlan.map(item => input.assets.find(asset => asset.id === item.assetId));
      if (sourceAssets.some(asset => !asset) || sourceAssets.length !== scenes.length) return block('material_match', '素材覆盖缺口：配音前分镜素材不完整');
      const sourceCoverage = planVideoSourceSegments(await resolveSourceDurations(sourceAssets as AssetCandidate[]), productionTiming(spec, scenes).sceneDurations);
      if (sourceCoverage.gaps.length) return block('material_match', `素材覆盖缺口：${sourceCoverage.gaps.join('；')}`, { sourceCoverage });
      const spoken = voiceoverText(text(spec.script, 30_000));
      if (!spoken) return block('script', '脚本中没有可合成的口播台词');
      const voice = await synthesizeStudioVoiceForAutomation({ tenantId: input.tenantId, text: spoken, language: 'zh', targetDuration: 20 });
      if (!voice.ok || !voice.localPath || !fs.existsSync(voice.localPath)) return block('voice_subtitles', `配音服务不可用：${voice.error || '未返回可用音频文件'}`);
      const duration = Math.max(1, Number(voice.duration || 20));
      await updateProject(input.record, {
        ...spec, duration: Math.max(Number(spec.duration) || 20, duration), voiceoverMode: 'ai', voiceoverUrl: voice.url, voiceoverDur: duration,
        alignedCuesByLang: { zh: proportionalCues(String(voice.text || spoken), duration) }, subtitlesOn: true, subMode: 'target',
        automation: stagePatch(automation, 'render', { blocker: '', voiceSource: voice.source, voiceLocalPath: voice.localPath }),
      });
      return { changed: true, blocker: '' };
    }
    if (stage === 'render') {
      const chosen = selectedAssets(spec, input.assets);
      if (!chosen.length) return block('material_match', '渲染前找不到项目已绑定的真实素材');
      const voicePath = text(automation.voiceLocalPath, 2_000);
      if (!voicePath || !fs.existsSync(voicePath)) return block('voice_subtitles', '渲染前找不到已生成的配音文件');
      const ranges = storyboardSceneRanges(text(spec.script, 30_000));
      const timing = productionTiming(spec, ranges);
      const sourcePlan = Array.isArray(spec.sceneSourcePlan) ? spec.sceneSourcePlan as SceneSourcePlanItem[] : [];
      if (sourcePlan.length !== ranges.length) return block('material_match', '逐镜头来源计划缺失或与脚本分镜数量不一致');
      const sceneAssets = sourcePlan.map(item => chosen.find(asset => asset.id === item.assetId));
      if (sceneAssets.some(asset => !asset)) return block('material_match', '逐镜头来源计划引用了不可用素材');
      // Recheck after TTS: actual audio can be longer than the original brief.
      const sourceCoverage = planVideoSourceSegments(await resolveSourceDurations(sceneAssets as AssetCandidate[]), timing.sceneDurations);
      if (sourceCoverage.gaps.length) return block('material_match', `素材覆盖缺口：${sourceCoverage.gaps.join('；')}`, { sourceCoverage });
      const renderUrls = await Promise.all(sceneAssets.map(asset => assetRenderUrl(asset!, input.tenantId)));
      if (renderUrls.some(url => !url)) return block('material_match', '已绑定素材的租户文件或对象存储不可读，已停止渲染');
      const manifest = {
        jobId: `de-${input.record.id}`,
        requireVisualAssets: true,
        spec: { ratio: '9:16', duration: timing.duration, platform: input.goal.contentPlatforms[0] || 'tiktok', language: 'zh', bgmVol: 0, voiceVol: 100 },
        script: text(spec.script, 30_000),
        timeline: ranges.map((range, index) => ({
          index,
          name: sceneAssets[index]!.name,
          type: sceneAssets[index]!.type,
          url: renderUrls[index]!,
          ...sourceCoverage.segments[index],
          cropMode: 'smart',
          ...(typeof sceneAssets[index]!.focusX === 'number' ? { focusX: sceneAssets[index]!.focusX } : {}),
          ...(typeof sceneAssets[index]!.focusY === 'number' ? { focusY: sceneAssets[index]!.focusY } : {}),
        })),
        voiceover: { voice: 'automation', url: `data:${mimeFromFile(voicePath)};base64,${fs.readFileSync(voicePath).toString('base64')}` },
        cover: { id: null, title: input.record.title || '', url: null }, bgm: { id: null, url: null },
        subtitles: { mode: 'target', cues: json<Record<string, unknown>>(spec.alignedCuesByLang, {}).zh || proportionalCues(voiceoverText(text(spec.script)), timing.duration), style: {} },
      };
      const outputDir = path.resolve(process.cwd(), 'data', 'publishing-uploads', input.tenantId.replace(/[^\w.-]+/g, '-'));
      const result = await composite(manifest, undefined, outputDir);
      if (!result.ok || !result.outputPath || !fs.existsSync(result.outputPath)) return block('render', `本机渲染失败：${result.error || '未生成 MP4'}`);
      await updateProject(input.record, { ...spec, duration: timing.duration, sourceSegments: sourceCoverage.segments, renderOutputPath: result.outputPath, activeStepId: 'preview', automation: stagePatch(automation, 'quality', { blocker: '', renderOutputPath: result.outputPath, renderedAt: new Date().toISOString() }) });
      return { changed: true, blocker: '' };
    }
    if (stage === 'quality') {
      // Old projects may contain cues for the full voice track but a render
      // truncated to the original brief. Re-render; never just relax the gate.
      if (Number(spec.voiceoverDur) > Number(spec.duration || 20) + 0.1) {
        await updateProject(input.record, {
          ...spec,
          automation: stagePatch(automation, 'render', {
            blocker: '', approvalState: 'not_ready',
            qualityRevalidationReason: '配音超过旧成片时长，重新渲染完整口播与字幕',
          }),
        });
        return { changed: true, blocker: '' };
      }
      const outputPath = text(automation.renderOutputPath, 2_000) || text(spec.renderOutputPath, 2_000);
      const stat = outputPath && fs.existsSync(outputPath) ? fs.statSync(outputPath) : null;
      const materialInfos = Array.isArray(spec.materialInfos) ? spec.materialInfos as StudioScriptMaterialInfo[] : [];
      const latestScriptQuality = assessScriptQualityV2({
        script: text(spec.script, 30_000),
        productInfo: productFacts(input.profile, input.config, routePlan.productId),
        materialsText: materialInfos.flatMap(item => item.observations || []).join('\n'),
        materialInfos,
        primaryCta: contentOrder?.cta || '私信获取方案',
        targetBuyerText: input.config.customerProfile,
      });
      if (latestScriptQuality.qualityStatus === 'rejected') return block('script', `脚本事实质检未通过：${latestScriptQuality.hardIssues.join('；')}`);
      if (latestScriptQuality.qualityStatus === 'needs_material') return block('material_match', `素材覆盖不足：${latestScriptQuality.warnings.join('；')}`);
      if (latestScriptQuality.script !== text(spec.script, 30_000)) {
        const nextVersion = Number(automation.contentVersion || 1) + 1;
        await updateProject(input.record, {
          ...spec,
          script: latestScriptQuality.script,
          sceneSourcePlan: [], selectedMaterialIds: [], materialInfos: [],
          automation: stagePatch(automation, 'material_match', {
            status: 'queued', blocker: '',
            contentVersion: nextVersion, contentHash: stableHash(latestScriptQuality.script), approvalState: 'not_ready',
            scriptQuality: { ...latestScriptQuality, ruleVersion: CONTENT_SCRIPT_QUALITY_RULE_VERSION },
            scriptQualityRuleVersion: CONTENT_SCRIPT_QUALITY_RULE_VERSION,
            qualityRevalidatedAt: new Date().toISOString(),
            qualityRevalidationReason: '当前规则修复了未被素材观察支持的画面描述，需重新匹配镜头来源、配音与渲染',
          }),
        });
        return { changed: true, blocker: '' };
      }
      const visualQuality = stat
        ? await inspectRenderedVisuals({
          outputPath,
          expectedDuration: Number(spec.duration || 20),
          expectedUniqueScenes: Math.max(3, storyboardSceneRanges(text(spec.script, 30_000)).length),
          minSharpFrameRatio: 0.5,
          evidenceDir: path.join(path.dirname(outputPath), 'quality-evidence', path.basename(outputPath, path.extname(outputPath))),
        })
        : null;
      const sourcePlan = Array.isArray(spec.sceneSourcePlan) ? spec.sceneSourcePlan as SceneSourcePlanItem[] : [];
      const ranges = storyboardSceneRanges(text(spec.script, 30_000));
      const cues = json<Record<string, unknown>>(spec.alignedCuesByLang, {}).zh;
      const pathDifference = json<{ pathDifference?: boolean }>(automation.pathDifferenceCheck, {});
      const semanticAlignment = sourcePlan.length === ranges.length && sourcePlan.every(item => item.assetId && Number.isFinite(item.score) && item.reasons.length > 0);
      const routeDifferentiation = pathDifference.pathDifference === true;
      const availableSceneAssets = new Set(routePlan.assetIds).size;
      const sceneDiversity = availableSceneAssets < 2 || new Set(sourcePlan.map(item => item.assetId)).size >= 2;
      const internalMarkerFree = !containsInternalContentMarker({ title: input.record.title, script: spec.script, cues, evidence: spec.selectedMaterialEvidence });
      const subtitleSafe = subtitleCuesAreSafe(cues, Number(spec.duration || 20));
      const platformBriefApplied = Boolean(text(spec.platformBrief, 1_000) && text(routePlan.platformBrief, 1_000));
      const failures = [
        !stat || stat.size < 10_000 ? '成片文件不存在或文件异常' : '',
        visualQuality && !visualQuality.passed ? `成片视觉质检未通过：${visualQuality.failures.join('；')}` : '',
        !Array.isArray(spec.selectedMaterialIds) || spec.selectedMaterialIds.length === 0 ? '未绑定真实素材' : '',
        !spec.voiceoverUrl ? '未生成配音' : '',
        !semanticAlignment ? '逐镜头素材语义匹配证据不完整' : '',
        !routeDifferentiation ? '内容路径差异检查未通过' : '',
        !sceneDiversity ? '存在多个相关素材但分镜仍只循环单一素材' : '',
        !internalMarkerFree ? '成片内容含 E2E、local.test、mock 或 placeholder 内部标记' : '',
        !subtitleSafe ? '字幕时间轴、长度或内部标记安全检查未通过' : '',
        !platformBriefApplied ? '未应用目标平台差异化创作要求' : '',
      ].filter(Boolean);
      if (failures.length) return block('quality', `成片质检未通过：${failures.join('；')}`, {
        quality: {
          passed: false, ruleVersion: CONTENT_SCRIPT_QUALITY_RULE_VERSION,
          checkedAt: new Date().toISOString(), failures,
          checks: { semanticAlignment, routeDifferentiation, internalMarkerFree, subtitleSafe, platformBriefApplied, sceneDiversity },
          visualMetrics: visualQuality?.metrics || null,
          evidenceFrames: visualQuality?.evidenceFrames || [],
        },
      });
      await updateProject(input.record, {
        ...spec,
        automation: stagePatch(automation, 'completed', {
          status: 'ready_for_approval', blocker: '', completedAt: new Date().toISOString(), approvalState: 'ready_for_approval',
          quality: {
            passed: true,
            ruleVersion: CONTENT_SCRIPT_QUALITY_RULE_VERSION,
            checks: {
              renderedFile: true, visualContent: true, groundedScript: true, materialBound: true, voiceAndSubtitles: true,
              semanticAlignment, routeDifferentiation, internalMarkerFree, subtitleSafe, platformBriefApplied,
              sceneDiversity,
            },
            outputBytes: stat!.size,
            visualMetrics: visualQuality!.metrics,
            evidenceFrames: visualQuality!.evidenceFrames,
          },
        }),
      // A completed render is only ready for a human/content approval gate.
      // Platform publication is a separate posts/provider-receipt workflow.
      }, 'ready_for_approval');
      return { changed: true, blocker: '' };
    }
    return { changed: false, blocker: '' };
  } catch (error) {
    return block(stage, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Read all tenant projects so older pages cannot hide current-run orders.
 */
export async function listTenantContentProjects(tenantId: string): Promise<StoredRecord[]> {
  const records: StoredRecord[] = [];
  for (let page = 1; ; page += 1) {
    const result = await store.list<StoredRecord>('studio_projects', { where: { tenant_id: tenantId }, sort: 'created_at,id', perPage: 500, page });
    records.push(...result.items);
    if (page >= result.totalPages || result.items.length === 0) return records;
  }
}

export function contentOrderCoverage(projects: StoredRecord[], orderIds: string[]) {
  const ids = projects.map(project => text(json<Record<string, unknown>>(project.spec, {}).contentOrderId));
  const missing = orderIds.filter(id => !ids.includes(id));
  const duplicate = orderIds.filter(id => ids.filter(value => value === id).length > 1);
  const unexpected = ids.filter(id => !orderIds.includes(id));
  return { missing, duplicate, unexpected, complete: orderIds.length > 0 && missing.length === 0 && duplicate.length === 0 && unexpected.length === 0 };
}

/** One bounded tick; repair partial queue creation before advancing projects. */
export async function advanceAutomatedContentProduction(input: {
  tenantId: string;
  runId: string;
  taskId: string;
  config: DigitalEmployeeConfig;
  goal: WeeklyGoalInput;
  batchPlanId?: string;
  contentOrders?: ContentProductionOrderInput[];
}): Promise<ContentProductionAdvanceResult> {
  const [profile, analysesResult, existingProjects] = await Promise.all([
    readTenantEnterpriseProfile(input.tenantId),
    store.list<StoredRecord>('trend_videos', { where: { tenantId: input.tenantId }, sort: '-updatedAt', perPage: 500 }),
    listTenantContentProjects(input.tenantId),
  ]);
  const analyses = analysesResult.items.filter(record => exactAnalysis(record) && Boolean(referenceStructure(record)));
  const assets = await collectAssets(input.tenantId, profile);
  const selectedProducts = selectedProductItems(profile, input.config);
  const productNames = selectedProducts.map(({ item }) => text(item.name, 160)).filter(Boolean);
  const evidence: ContentRouteEvidence = { exactAnalysisIds: analyses.map(item => item.id), productNames, assetIds: assets.map(item => item.id) };
  let projects = existingProjects.filter(record => {
    const spec = json<Record<string, unknown>>(record.spec, {});
    return spec.workflowRunId === input.runId && spec.workflowTaskId === input.taskId && projectAutomation(record).managedBy === 'digital_employee';
  });
  const frozenOrders = input.contentOrders?.filter(order => ['clone', 'product', 'material'].includes(order.route)) || [];
  if (input.contentOrders && (!frozenOrders.length || frozenOrders.length !== input.contentOrders.length
    || frozenOrders.some(order => !text(order.id)) || new Set(frozenOrders.map(order => order.id)).size !== frozenOrders.length)) {
    return { changed: false, ready: false, projectRefs: [], knowledgeGaps: [], blocker: '内容批次订单为空、重复或包含无效路径', summary: '内容生产未启动' };
  }
  const missingOrders = contentOrderCoverage(projects, frozenOrders.map(order => order.id)).missing;

  let changed = false;
  if (!projects.length || missingOrders.length > 0) {
    const priorCounts: Partial<Record<ContentProductionRoute, number>> = {};
    for (const record of existingProjects.filter(item => !projects.some(project => project.id === item.id))) {
      const route = text(projectAutomation(record).route) as ContentProductionRoute;
      if (['clone', 'product', 'material'].includes(route)) priorCounts[route] = Number(priorCounts[route] || 0) + 1;
    }
    const plan = allocateBalancedContentRoutes({ count: requestedDraftCount(input.config, input.goal), enabled: enabledRoutes(input.config), evidence, priorCounts });
    if (!frozenOrders.length && !plan.allocations.length) {
      const gaps = contentProductionKnowledgeGaps({ enabled: enabledRoutes(input.config), evidence });
      return { changed: false, ready: false, projectRefs: [], knowledgeGaps: gaps, blocker: plan.blockers.join('；') || gaps.map(item => item.label).join('；') || '未启用内容生产路径', summary: '内容生产未启动' };
    }
    const now = new Date().toISOString();
    const created: StoredRecord[] = [];
    const sourcePlans = frozenOrders.length ? frozenOrders.map(order => {
      const product = selectedProducts.find(candidate => candidate.productId === order.productId || text(candidate.item.name, 160) === text(order.productName, 160));
      const productId = product?.productId || '';
      const productName = text(product?.item.name || order.productName, 160);
      const owned = assets.filter(asset => assetEligible(asset) && asset.productId === productId);
      const referenceId = order.evidenceRefs.find(ref => ref.type === 'exact_analysis')?.id || '';
      const materialId = order.evidenceRefs.find(ref => ref.type === 'enterprise_material')?.id || '';
      const material = materialId ? (
        assets.find(asset => asset.id === materialId && assetEligible(asset) && (!productId || !asset.productId || asset.productId === productId))
        || (/^product-\d+-/.test(materialId) ? owned[0] : undefined)
      ) : undefined;
      // A frozen content order owns the exact enterprise material selected by
      // the batch planner. Pulling every asset for the same product into every
      // order made otherwise distinct product/material routes converge on the
      // same evidence set and correctly trip the cross-route duplication gate.
      // Additional material may still be chosen by a future batch plan, but it
      // must be explicit evidence rather than an implicit same-product sweep.
      const assetIds = material ? [material.id] : [];
      const gap = !productId ? '批次订单引用的产品不在当前冻结重点产品中'
        : order.route === 'clone' && !analyses.some(record => record.id === referenceId) ? '批次订单引用的精确参考结构不存在或不可解析'
          : order.route === 'material' && !material ? '批次订单引用的锁定素材不存在、未授权或不属于当前产品'
            : !assetIds.length ? '批次订单没有属于当前产品的已授权视觉素材' : '';
      return {
        route: order.route, productId, productName, assetIds, ...(order.route === 'material' && material ? { seedAssetId: material.id } : {}),
        ...(referenceId ? { referenceAnalysisId: referenceId } : {}),
        platform: order.platform, platformBrief: platformCreativeBrief(order.platform), ...(gap ? { gap } : {}),
      } satisfies RouteSourcePlan;
    }) : buildRouteSourcePlans({
      allocations: plan.allocations,
      products: selectedProducts.map(({ item, productId }) => ({ productId, productName: text(item.name, 160) })),
      assets,
      referenceAnalysisIds: analyses.map(item => item.id),
      platforms: input.goal.contentPlatforms,
    });
    for (let slot = 0; slot < sourcePlans.length; slot += 1) {
      const routePlan = sourcePlans[slot]!;
      const frozenOrder = frozenOrders[slot];
      if (frozenOrder && !missingOrders.includes(frozenOrder.id)) continue;
      const route = routePlan.route;
      const referenceId = routePlan.referenceAnalysisId || '';
      const routeAssets = routePlan.assetIds.map(id => assets.find(asset => asset.id === id)).filter((asset): asset is AssetCandidate => Boolean(asset));
      const reference = referenceId ? analyses.find(item => item.id === referenceId) : undefined;
      const referenceEvidence = referenceStructure(reference);
      const snapshot = {
        schemaVersion: CONTENT_PRODUCTION_SCHEMA_VERSION,
        capturedAt: now,
        product: routePlan.productId ? { id: routePlan.productId, name: routePlan.productName || '', facts: productFacts(profile, input.config, routePlan.productId) } : null,
        assets: routeAssets.map(evidenceAssetSnapshot),
        reference: referenceEvidence,
        hash: stableHash({ productId: routePlan.productId || '', assets: routeAssets.map(evidenceAssetSnapshot), reference: referenceEvidence }),
      };
      const record = await store.create<StoredRecord>('studio_projects', {
        tenant_id: input.tenantId,
        title: `${routeTitle(route)} · ${input.goal.title} · ${slot + 1}`,
        status: 'draft',
        spec: {
          mode: route, contentMode: 'video', platform: routePlan.platform, platformBrief: routePlan.platformBrief, ratio: '9:16', duration: 20, lang: 'zh',
          workflowRunId: input.runId, workflowTaskId: input.taskId, workflowTaskKey: 'content_production', productInfo: productFacts(profile, input.config, routePlan.productId),
          ...(input.batchPlanId ? { batchPlanId: input.batchPlanId } : {}), ...(frozenOrder?.id ? { contentOrderId: frozenOrder.id, contentOrder: frozenOrder } : {}),
          audience: input.config.customerProfile, selectedMaterialIds: [], script: '', subtitlesOn: true,
          evidenceSnapshot: snapshot,
          automation: {
            schemaVersion: CONTENT_PRODUCTION_SCHEMA_VERSION, managedBy: 'digital_employee', route, slot: slot + 1,
            stage: 'script', status: routePlan.gap ? 'blocked' : 'queued', referenceAnalysisId: referenceId,
            evidence, evidenceSnapshotHash: snapshot.hash, routePlan,
            ...(routePlan.gap ? { blocker: routePlan.gap, resumeStage: 'script', retryAfter: new Date(Date.now() + 15 * 60_000).toISOString() } : {}),
            routeWarnings: plan.blockers, createdAt: now, updatedAt: now,
          },
        },
        thumb_seed: '', created_at: now, updated_at: now,
      });
      if (!record) throw new Error('studio_project_storage_unavailable');
      created.push(record);
    }
    projects = [...projects, ...created];
    changed = created.length > 0;
  }

  // A historical `passed` result is not proof under newer fact/visual rules.
  // Re-open one stale project per tick so it is re-matched, re-voiced and
  // re-rendered before it can count as completed again.
  const staleCompleted = projects.find(project => automatedContentQualityNeedsRevalidation(projectAutomation(project)));
  if (staleCompleted) {
    const staleSpec = json<Record<string, unknown>>(staleCompleted.spec, {});
    const staleAutomation = projectAutomation(staleCompleted);
    const revalidationSpec = {
      ...staleSpec,
      automation: stagePatch(staleAutomation, 'material_match', {
        status: 'queued', blocker: '',
        previousQuality: staleAutomation.quality,
        quality: undefined,
        qualityRevalidationReason: `脚本与视觉规则升级至 v${CONTENT_SCRIPT_QUALITY_RULE_VERSION}`,
      }),
    };
    await updateProject(staleCompleted, revalidationSpec, 'draft');
    const refreshed = await store.getById<StoredRecord>('studio_projects', staleCompleted.id);
    projects = projects.map(project => project.id === staleCompleted.id ? (refreshed || { ...project, status: 'draft', spec: revalidationSpec }) : project);
    changed = true;
  }

  const pending = selectContentProjectsForTick(projects.map(project => ({
    project, stage: text(projectAutomation(project).stage), retryable: retryable(projectAutomation(project)),
  }))).map(item => item.project);
  const advancedResults = await Promise.all(pending.map(project => advanceOneProject({
    tenantId: input.tenantId, record: project, config: input.config, goal: input.goal, profile, assets, analyses, allProjects: projects,
  })));
  changed ||= advancedResults.some(result => result.changed);
  const blocker = advancedResults.map(result => result.blocker).find(Boolean) || '';
  const refreshedProjects = await Promise.all(pending.map(project => store.getById<StoredRecord>('studio_projects', project.id)));
  for (const refreshed of refreshedProjects) {
    if (refreshed) projects = projects.map(item => item.id === refreshed.id ? refreshed : item);
  }

  const projectRefs = projects.map(project => {
    const automation = projectAutomation(project);
    return {
      type: 'studio_project' as const,
      id: project.id,
      route: text(automation.route) as ContentProductionRoute,
      status: String(project.status || 'draft'),
      stage: text(automation.stage) || 'script',
      ...(text(automation.renderOutputPath) ? { outputPath: text(automation.renderOutputPath, 2_000) } : {}),
    };
  });
  const coverage = frozenOrders.length ? contentOrderCoverage(projects, frozenOrders.map(order => order.id)) : null;
  const ready = (!coverage || coverage.complete) && projectRefs.length > 0 && projectRefs.every(ref => ref.status === 'ready_for_approval' && ref.stage === 'completed');
  const coverageBlocker = coverage && !coverage.complete ? `内容订单覆盖不完整：缺失 ${coverage.missing.length}，重复 ${coverage.duplicate.length}，非当前订单 ${coverage.unexpected.length}` : '';
  const blocked = projects.map(project => text(projectAutomation(project).blocker)).filter(Boolean);
  return {
    changed,
    ready,
    projectRefs,
    knowledgeGaps: contentProductionKnowledgeGaps({ enabled: enabledRoutes(input.config), evidence }),
    blocker: coverageBlocker || blocker || blocked[0] || (ready ? '' : '内容 Agent 正在后台推进脚本、素材、配音、渲染与质检'),
    summary: ready ? `已完成 ${projectRefs.length} 个可审批成片` : `内容生产进度 ${projectRefs.filter(ref => ref.stage === 'completed').length}/${projectRefs.length}`,
  };
}
