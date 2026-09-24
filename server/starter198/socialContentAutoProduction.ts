import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import type {
  SocialContentTaskBrief,
  SocialContentThemeId,
  SocialProductionResult,
  SocialTaskSource,
} from '../../shared/contracts/socialContentWorkflow.js';
import { inspectRenderedScenes, inspectRenderedVisuals, runVisualFfmpeg } from '../lib/renderVisualQuality.js';
import { readMaterialLibrary, type MaterialRecord } from '../lib/materialLibrary.js';
import { resolveSourceDurations } from '../lib/videoSourcePlan.js';
import { readTenantEnterpriseProfile } from '../routes/enterprise.js';
import {
  automationBgmAudio,
  automationBgmCatalog,
  synthesizeStudioVoiceForAutomation,
} from '../routes/studio.js';
import { analyzeProductionMaterial } from '../digitalEmployees/productionMaterialAnalysis.js';
import { objectStorageEnabled, r2SignedGetUrl } from '../storage/r2.js';
import { createSocialContentArtifact } from './socialContentOutputs.js';
import {
  inspectTransientSocialContentFile,
  registerSocialContentFile,
  socialContentFileDownloadUrl,
  type SocialContentBackendFilePort,
} from './socialContentFiles.js';
import {
  materializeSocialContentCloudMaterial,
  socialContentCloudMaterialRecordId,
  type SocialContentCloudMaterialPort,
} from './socialContentMaterialAccess.js';
import { withSocialContentRenderWorkspace } from './socialContentRenderWorkspace.js';
import { readSocialTaskDetail, requireSocialTask } from './socialContentRecords.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import {
  SocialContentWorkflowError,
  socialJson,
  socialObject,
  socialRequestHash,
  socialText,
} from './socialContentValidation.js';
import {
  freezeSocialScriptBaseline,
  parseStoredSocialScriptBaseline,
  SOCIAL_SCRIPT_GROUNDING_VERSION,
  verifiedSocialScriptContext,
  type StoredSocialScriptBaseline,
} from './socialContentScriptBaseline.js';
import { resolveSocialContentFormulaReference } from './socialContentFormulas.js';
import { runOutsideSocialContentMutationScope } from './socialContentMutation.js';
import { resolveSocialInspirationScript } from './socialContentScriptSources.js';
import {
  buildSocialProductionPlan,
  type SocialProductionAsset,
  type SocialProductionPlan,
} from './socialContentProductionPlan.js';
import { evaluateSocialReplicationResult } from './replicationEvaluationAdapter.js';
import {
  executeSocialAssetSupplyPlan,
  type SocialAssetSupplyExecution,
  type SocialAssetSupplyProviderAdapter,
} from './socialContentAssetSupplyExecution.js';
import {
  buildSocialDirectorPlan,
  parseStoredSocialDirectorPlan,
  publicSocialDirectorPlanSummary,
  reviseSocialDirectorPlanForVoiceoverFit,
  socialDirectorContentHandoff,
  socialDirectorCoverTimestamp,
  socialDirectorRenderTimeline,
  socialDirectorSceneTimingCues,
  socialDirectorScriptText,
  type SocialDirectorBgmSelection,
  type SocialDirectorBgmTrack,
  type SocialDirectorContentHandoff,
} from './socialContentDirectorPlan.js';
import {
  persistSocialDirectorPlanVersion,
  resolveSocialDirectorArtifactLineage,
} from './socialContentDirectorPlanVersions.js';
import type { InternalSocialContentFormula } from './socialContentThemes.js';

const require = createRequire(import.meta.url);
const { composite } = require('../../desktop/render.cjs') as {
  composite: (
    manifest: unknown,
    onProgress?: (progress: number) => void,
    outputDir?: string,
  ) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
};

const MEDIA_ROOT = path.resolve(process.cwd(), 'data', 'media');
const AUTO_TASK_KEY = 'social_content_auto_production';
const AUTO_SCHEMA = 'social-content.auto-production.v3';

export type ProductionAsset = SocialProductionAsset;

export type SocialProductionBaseline = StoredSocialScriptBaseline;

export type SocialProductionAdaptation = {
  narrationChanged: boolean;
  limitedMaterialFallback: boolean;
  sourceAssetCount: number;
  notes: string[];
  sceneAssets: Array<{ sceneId: string; assetId: string; assetName: string; reuseIndex: number }>;
};

export type SocialReviewRevisionDirective = {
  feedbackHash: string;
  categories: Array<'shorter' | 'opening' | 'captions' | 'music' | 'visuals' | 'general'>;
  narrationRatio: number;
  musicMood: string | null;
};

function safeNextVersion(record: StarterRecord): string {
  const version = Number(record.version);
  return Number.isSafeInteger(version) && version > 0 ? String(version + 1) : '1';
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

function normalizedProductReference(value: unknown): string {
  return socialText(value).normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

const MATERIAL_THEME_TERMS: Record<SocialContentThemeId, readonly string[]> = {
  product_value: ['产品', '细节', '外观', '包装', '使用', 'product', 'detail', 'package', 'use'],
  scenario_solution: ['场景', '使用', '操作', '过程', '结果', 'scenario', 'use', 'operation', 'result'],
  supplier_capability: ['工厂', '车间', '生产', '质检', '仓储', '交付', 'factory', 'production', 'quality', 'delivery'],
  customization_process: ['定制', '打样', '包装', '生产', '交付', 'custom', 'sample', 'package', 'production'],
  customer_case: ['客户', '合作', '方案', '过程', '成果', 'customer', 'case', 'process', 'result'],
};

function materialTenantId(record: MaterialRecord): string {
  return socialText(record.tenantId || record.tenant_id);
}

/** Shared inventory is an automatic render source only when its commercial
 * and derivative-use evidence is explicit. Tenant-owned material remains
 * available under the tenant's own upload warranty. */
export function automaticSocialMaterialEligible(record: MaterialRecord, tenantId: string): boolean {
  if (!['video', 'image'].includes(socialText(record.type)) || socialText(record.usage) === 'reference_only') return false;
  if (socialText(record.scope) === 'shared') {
    return record.commercialUseApproved === true
      && record.derivativesApproved === true
      && Boolean(socialText(record.licenseEvidence || record.licenseName));
  }
  return materialTenantId(record) === tenantId;
}

function materialSearchText(record: MaterialRecord): string {
  return [
    record.name, record.title, record.industry, record.shotFunction, record.applicability, record.tags,
    ...(Array.isArray(record.visualObservations) ? record.visualObservations : []),
    ...(Array.isArray(record.observations) ? record.observations : []),
    ...(Array.isArray(record.segments) ? record.segments.flatMap((segment: unknown) => {
      const row = socialObject(segment);
      return row ? [row.observedFacts, row.action, row.visual, row.environment, row.subject, row.purpose] : [];
    }) : []),
  ].map(socialText).filter(Boolean).join(' ').toLocaleLowerCase();
}

function automaticMaterialScore(input: {
  record: MaterialRecord;
  tenantId: string;
  productRef: string | null;
  themeId: SocialContentThemeId | null;
  linked: boolean;
}): number {
  const origin = input.linked ? 400
    : materialTenantId(input.record) === input.tenantId ? 240
      : socialText(input.record.scope) === 'shared' ? 120 : 0;
  const product = normalizedProductReference(input.productRef);
  const productRefs = [input.record.productRef, input.record.productName, ...(Array.isArray(input.record.productRefs) ? input.record.productRefs : [])]
    .map(normalizedProductReference).filter(Boolean);
  const productScore = product && productRefs.includes(product) ? 80 : 0;
  const searchable = materialSearchText(input.record);
  const themeScore = input.themeId
    ? MATERIAL_THEME_TERMS[input.themeId].filter(term => searchable.includes(term.toLocaleLowerCase())).length * 8
    : 0;
  const analyzed = (Array.isArray(input.record.segments) && input.record.segments.length > 0)
    || (Array.isArray(input.record.visualObservations) && input.record.visualObservations.length > 0) ? 30 : 0;
  return origin + productScore + themeScore + analyzed;
}

const LOCAL_SHOT_WIDTH = 72;
const LOCAL_SHOT_HEIGHT = 96;
const LOCAL_SHOT_BYTES = LOCAL_SHOT_WIDTH * LOCAL_SHOT_HEIGHT;

function localShotDifference(left: Buffer, right: Buffer): number {
  let total = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    total += Math.abs((left[index] || 0) - (right[index] || 0));
  }
  return total / Math.max(1, length);
}

/**
 * A task upload can be a fully edited source video containing several real
 * shots. When the optional semantic vision provider is unavailable, detect
 * visually distinct time windows locally instead of discarding the source and
 * replacing it with synthetic title cards. These windows prove only visual
 * difference; they deliberately carry no semantic/product claims.
 */
export async function detectDistinctTaskVideoSegments(asset: ProductionAsset): Promise<Array<Record<string, unknown>>> {
  const source = asset.localPath && existsSync(asset.localPath) ? asset.localPath : '';
  const duration = Number(asset.duration || 0);
  if (asset.type !== 'video' || !source || !Number.isFinite(duration) || duration < 4) return [];
  const sampleCount = Math.max(5, Math.min(14, Math.floor(duration / 1.2)));
  const sampleInterval = duration / sampleCount;
  const decoded = await runVisualFfmpeg([
    '-i', source,
    '-map', '0:v:0',
    '-vf', `fps=${(sampleCount / duration).toFixed(6)},scale=${LOCAL_SHOT_WIDTH}:${LOCAL_SHOT_HEIGHT}:force_original_aspect_ratio=decrease,pad=${LOCAL_SHOT_WIDTH}:${LOCAL_SHOT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,format=gray`,
    '-frames:v', String(sampleCount),
    '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
  ], true, { timeoutMs: 45_000 });
  if (!decoded.ok) return [];
  const frames: Buffer[] = [];
  for (let offset = 0; offset + LOCAL_SHOT_BYTES <= decoded.stdout.length && frames.length < sampleCount; offset += LOCAL_SHOT_BYTES) {
    frames.push(decoded.stdout.subarray(offset, offset + LOCAL_SHOT_BYTES));
  }
  if (frames.length < 3) return [];
  const selected: number[] = [0];
  // Collect spare candidates so the local quality pass can replace a blurry
  // or duplicated interval instead of failing the whole otherwise usable reel.
  const desiredCount = Math.min(7, Math.max(4, Math.floor(duration / 2.3)));
  // Sample the full running time instead of accepting the first four changes.
  // User-edited product reels often contain many quick cuts; a front-loaded
  // selection loses the demonstration/result/hero shots in the second half.
  while (selected.length < desiredCount) {
    const candidates = frames.map((frame, index) => ({
      index,
      temporalDistance: Math.min(...selected.map(previous => Math.abs(index - previous) * sampleInterval)),
      visualDistance: Math.min(...selected.map(previous => localShotDifference(frames[previous]!, frame))),
      localChange: Math.max(
        index > 0 ? localShotDifference(frames[index - 1]!, frame) : 0,
        index + 1 < frames.length ? localShotDifference(frame, frames[index + 1]!) : 0,
      ),
    })).filter(candidate => {
      const enoughTime = candidate.temporalDistance >= 1.45;
      // The renderer treats 0.75 mean-luma movement as real motion. Reuse that
      // conservative floor here; the later per-scene quality gate still
      // rejects genuinely duplicated output scenes.
      const visuallyDistinct = candidate.visualDistance >= 0.75 || candidate.localChange >= 0.75;
      return enoughTime && visuallyDistinct;
    }).sort((left, right) => right.temporalDistance - left.temporalDistance
      || right.visualDistance - left.visualDistance
      || right.localChange - left.localChange);
    const selectedCandidate = candidates[0];
    if (!selectedCandidate) break;
    selected.push(selectedCandidate.index);
  }
  selected.sort((left, right) => left - right);
  if (selected.length < 2) return [];
  const segments: Array<Record<string, unknown>> = [];
  for (const [order, frameIndex] of selected.entries()) {
    const center = Math.min(duration - 0.1, (frameIndex + 0.5) * sampleInterval);
    // Give each selected part enough edit budget for a natural sentence. The
    // previous 1.5–1.8 second windows forced the Director Agent to cut safe
    // copy into fragments even when the uploaded reel had ample running time.
    const targetDuration = Math.max(1.8, Math.min(2.8, sampleInterval * 2.05));
    const start = Math.min(
      Math.max(0, duration - targetDuration),
      Math.max(0, center - targetDuration / 2),
    );
    const end = Math.min(duration, start + targetDuration);
    if (end - start < 1.45) continue;
    segments.push({
      segmentId: `local-distinct:${asset.id}:${order + 1}`,
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      confidence: 0,
      needsReview: true,
      analysisMode: 'local_distinct_visual_windows',
      evidenceBasis: 'tenant_task_upload_visual_difference_only',
    });
  }
  if (segments.length < 2) return [];
  const visualQuality = await inspectRenderedScenes({
    outputPath: source,
    scenes: segments.map(segment => ({ start: Number(segment.start), end: Number(segment.end) })),
    requireDistinct: true,
  });
  const rejected = new Set(visualQuality.issues.map(issue => issue.sceneIndex));
  const usable = segments.filter((_, index) => !rejected.has(index));
  if (usable.length < 2) return [];
  const withoutOverlap = (items: Array<Record<string, unknown>>) => {
    let previousEnd = 0;
    return items.sort((left, right) => Number(left.start) - Number(right.start)).flatMap(segment => {
      const start = Math.max(previousEnd, Number(segment.start));
      const end = Number(segment.end);
      if (end - start < 1.45) return [];
      previousEnd = end;
      return [{ ...segment, start: Number(start.toFixed(3)) }];
    });
  };
  if (usable.length <= 4) return withoutOverlap(usable);
  // Keep the final edit representative of the full upload after rejecting bad
  // candidates: opening, closing, then the most temporally distant interiors.
  const chosen = [0, usable.length - 1];
  while (chosen.length < 4) {
    const next = usable.map((segment, index) => ({
      index,
      distance: Math.min(...chosen.map(chosenIndex => Math.abs(
        Number(segment.start) - Number(usable[chosenIndex]!.start),
      ))),
    })).filter(item => !chosen.includes(item.index))
      .sort((left, right) => right.distance - left.distance)[0];
    if (!next) break;
    chosen.push(next.index);
  }
  return withoutOverlap(chosen.sort((left, right) => left - right).map(index => usable[index]!));
}

/** Only provenance written when the tenant attached the upload to this exact
 * product may unlock association-only production. Product names, filenames,
 * source labels and purposes are intentionally excluded. */
export function hasExactTaskProductAssociation(record: MaterialRecord, taskProductRef: string | null): boolean {
  const expected = normalizedProductReference(taskProductRef);
  if (!expected) return false;
  const candidates = [
    record.productRef,
    ...(Array.isArray(record.productRefs) ? record.productRefs : []),
  ].map(normalizedProductReference).filter(Boolean);
  return candidates.includes(expected);
}

export async function resolveTaskProductionMaterialLocation(input: {
  tenantId: string;
  record: MaterialRecord;
  type: 'image' | 'video';
  outputDirectory: string;
  index: number;
  cloudMaterialPort?: SocialContentCloudMaterialPort;
}): Promise<{ url: string; localPath?: string; cloudRecordId?: string; sha256?: string }> {
  const record = input.record;
  const cloudRecordId = socialContentCloudMaterialRecordId(record);
  const claimsCloudIdentity = socialText(record.id).startsWith('pb-') || Boolean(socialText(record.cloudRecordId));
  if (claimsCloudIdentity) {
    // A malformed or conflicting cloud identity must fail closed; never fall
    // through to a URL stored on the material record.
    if (!cloudRecordId) throw new SocialContentWorkflowError('social_content_material_identity_invalid', 409);
    return materializeSocialContentCloudMaterial({
      tenantId: input.tenantId,
      record,
      type: input.type,
      outputDirectory: input.outputDirectory,
      index: input.index,
      port: input.cloudMaterialPort,
    });
  }
  const localPath = safeLocalMediaPath(record.file)
    || (socialText(record.url).startsWith('/media/') ? safeLocalMediaPath(socialText(record.url).slice('/media/'.length)) : '');
  if (localPath) return { url: localPath, localPath };
  const objectKey = socialText(record.objectKey);
  if (objectKey && objectStorageEnabled()) return { url: await r2SignedGetUrl(objectKey, 15 * 60) };
  // Arbitrary URLs from inventory data are not render inputs. Importing them
  // into tenant-owned storage is the only supported path, preventing SSRF and
  // removing ambient-cookie/public-route authorization assumptions.
  return { url: '' };
}

async function taskProductionAssets(input: {
  tenantId: string;
  sources: SocialTaskSource[];
  productRef: string | null;
  themeId: SocialContentThemeId | null;
  productionMode: NonNullable<SocialContentTaskBrief['productionMode']>;
  outputDirectory: string;
  cloudMaterialPort?: SocialContentCloudMaterialPort;
  allowAuthorizedSharedLibrary?: boolean;
}): Promise<ProductionAsset[]> {
  const inventory = await readMaterialLibrary(input.tenantId);
  if (inventory.status === 'unavailable') throw new Error('素材库暂时不可用，请稍后重试');
  const byId = new Map(inventory.items.map(item => [socialText(item.id), item]));
  const linkedSources = input.sources.filter(item => item.status === 'active' && item.kind === 'material');
  const linkedCandidates = linkedSources.flatMap(source => {
    const id = decodeMaterialRef(source.sourceRef);
    // Older tasks may still carry the file reference used before uploads were
    // canonicalized into My Materials. Resolve it to the immutable material
    // record instead of treating a text/file row as a renderable visual.
    const record = byId.get(id) ?? inventory.items.find(item => (
      Array.isArray(item.sourceTaskFileRefs) && item.sourceTaskFileRefs.map(socialText).includes(source.sourceRef)
    ));
    if (!record || !automaticSocialMaterialEligible(record, input.tenantId)) return [];
    return [{ record, sourceId: source.sourceId, label: source.label, origin: 'task' as const, linked: true }];
  });
  const linkedIds = new Set(linkedCandidates.map(item => socialText(item.record.id)));
  const libraryCandidates = inventory.items
    .filter(record => !linkedIds.has(socialText(record.id)) && automaticSocialMaterialEligible(record, input.tenantId))
    .map(record => ({
      record,
      sourceId: `library_material_${socialRequestHash({ id: socialText(record.id) }).slice(0, 24)}`,
      label: socialText(record.name || record.title) || '素材库素材',
      origin: materialTenantId(record) === input.tenantId ? 'tenant_library' as const : 'shared_library' as const,
      linked: false,
    }));
  // Publish-ready production is grounded only in material the user explicitly
  // linked to this task. Ambient tenant-library footage must never leak into a
  // product video simply because it scores well on generic theme keywords.
  const candidates = [
    ...linkedCandidates,
    ...(input.productionMode === 'concept_preview'
      ? libraryCandidates
      : input.allowAuthorizedSharedLibrary
        ? libraryCandidates.filter(candidate => candidate.origin === 'shared_library')
        : []),
  ]
    .sort((left, right) => automaticMaterialScore({
      record: right.record, tenantId: input.tenantId, productRef: input.productRef, themeId: input.themeId, linked: right.linked,
    }) - automaticMaterialScore({
      record: left.record, tenantId: input.tenantId, productRef: input.productRef, themeId: input.themeId, linked: left.linked,
    }))
    .slice(0, 16);
  const assets: ProductionAsset[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const { record } = candidate;
    const type = socialText(record.type) as ProductionAsset['type'];
    let location: Awaited<ReturnType<typeof resolveTaskProductionMaterialLocation>>;
    try {
      location = await resolveTaskProductionMaterialLocation({
        tenantId: input.tenantId,
        record,
        type,
        outputDirectory: input.outputDirectory,
        index,
        cloudMaterialPort: input.cloudMaterialPort,
      });
    } catch {
      // One stale library item must not abort the whole first-content run.
      // Identity and authorization checks still fail closed for that item.
      continue;
    }
    if (!location.url) continue;
    const explicitlyAssociated = hasExactTaskProductAssociation(record, input.productRef);
    assets.push({
      id: socialText(record.id),
      name: socialText(record.name) || candidate.label || '内容素材',
      type,
      sourceId: candidate.sourceId,
      url: location.url,
      ...(location.localPath ? { localPath: location.localPath } : {}),
      ...(location.cloudRecordId ? { cloudRecordId: location.cloudRecordId } : {}),
      ...(socialText(record.objectKey) ? { objectKey: socialText(record.objectKey) } : {}),
      ...(socialText(record.contentSha256 || record.sha256 || location.sha256)
        ? { contentHash: socialText(record.contentSha256 || record.sha256 || location.sha256) }
        : {}),
      ...(candidate.origin === 'shared_library'
        ? { authorizationRef: socialText(record.licenseEvidence || record.licenseName) }
        : {}),
      duration: Math.max(0, Number(record.duration || 0)),
      visualObservations: [record.visualObservations, record.observations]
        .flatMap(value => Array.isArray(value) ? value : [])
        .map(socialText).filter(Boolean),
      ...(explicitlyAssociated ? {
        explicitProductAssociation: {
          productRef: socialText(input.productRef),
          basis: 'tenant_task_upload' as const,
          exactTaskProductMatch: true as const,
        },
      } : {}),
      segments: Array.isArray(record.segments)
        ? record.segments.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
        : [],
      selectionOrigin: candidate.origin,
    });
  }
  return resolveSourceDurations(assets);
}

function safeGraphicText(value: unknown, maximum: number): string {
  return socialText(value).replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').slice(0, maximum);
}

function escapeSvg(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function systemThemeGraphicAssets(input: {
  outputDirectory: string;
  baseline: StoredSocialScriptBaseline;
}): Promise<ProductionAsset[]> {
  const palette = [
    ['#073b32', '#20a36a', '#d8f7e9'],
    ['#102a43', '#3977c3', '#dcecff'],
    ['#3b245c', '#8b5cc7', '#f0e6ff'],
    ['#4a2b13', '#c87932', '#fff0dc'],
  ] as const;
  const assets: ProductionAsset[] = [];
  for (const [index, scene] of input.baseline.scenes.slice(0, 4).entries()) {
    const [dark, accent, light] = palette[index % palette.length]!;
    const title = safeGraphicText(scene.shotFunction, 18) || '内容要点';
    const subject = safeGraphicText(scene.subject, 28) || '通用主题内容';
    const filename = `system-theme-${index + 1}.png`;
    const localPath = path.join(input.outputDirectory, filename);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${dark}"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs>
      <rect width="720" height="1280" fill="url(#g)"/>
      <circle cx="620" cy="160" r="210" fill="${light}" opacity=".12"/><circle cx="90" cy="1100" r="260" fill="${light}" opacity=".09"/>
      <rect x="64" y="390" width="592" height="500" rx="36" fill="#ffffff" opacity=".94"/>
      <text x="104" y="500" fill="${accent}" font-size="28" font-family="Arial, PingFang SC, sans-serif" font-weight="700">通用安全版 · ${index + 1}/${Math.min(4, input.baseline.scenes.length)}</text>
      <text x="104" y="610" fill="${dark}" font-size="58" font-family="Arial, PingFang SC, sans-serif" font-weight="800">${escapeSvg(title)}</text>
      <text x="104" y="700" fill="#324b45" font-size="34" font-family="Arial, PingFang SC, sans-serif">${escapeSvg(subject)}</text>
      <text x="104" y="805" fill="#60736e" font-size="24" font-family="Arial, PingFang SC, sans-serif">不使用未经核验的企业或产品事实</text>
    </svg>`;
    await sharp(Buffer.from(svg)).png().toFile(localPath);
    const contentHash = createHash('sha256').update(await fsp.readFile(localPath)).digest('hex');
    assets.push({
      id: `system-theme-${input.baseline.themeId || 'general'}-${index + 1}`,
      name: `${title} · 系统安全图形`,
      type: 'image',
      sourceId: `system_theme_material_${index + 1}`,
      url: localPath,
      localPath,
      contentHash,
      duration: 2.8,
      visualObservations: [`${scene.shotFunction} ${scene.subject} ${scene.action}`, '系统生成的抽象图形与受控主题文字'],
      segments: [],
      selectionOrigin: 'system_graphic',
    });
  }
  return assets;
}

function existingAssetSupplyAdapters(): SocialAssetSupplyProviderAdapter[] {
  const customerAsset: SocialAssetSupplyProviderAdapter = {
    adapterId: 'existing_customer_asset.v1',
    sourceStrategies: ['customer_real_asset', 'customer_product_image_animation'],
    async execute(context) {
      const asset = context.availableAssets.find(candidate => (
        context.shot.sourceRefs.includes(candidate.sourceId) || context.shot.sourceRefs.includes(candidate.id)
      ));
      if (!asset) return null;
      const customerEvidence = context.shot.truthBoundary.customerEvidenceRefs.includes(asset.sourceId)
        || context.shot.truthBoundary.customerEvidenceRefs.includes(asset.id);
      return {
        asset,
        sourceStrategy: context.shot.sourceStrategy,
        providerId: this.adapterId,
        sourceRef: context.shot.sourceRefs.find(ref => ref === asset.sourceId || ref === asset.id) ?? asset.sourceId,
        synthetic: false,
        representation: customerEvidence ? 'customer_evidence' : 'non_evidentiary_visual',
        authorizationRef: 'tenant_task_upload_warranty',
        disclosure: null,
      };
    },
  };
  const licensedStock: SocialAssetSupplyProviderAdapter = {
    adapterId: 'authorized_shared_library.v1',
    sourceStrategies: ['licensed_stock_asset'],
    async execute(context) {
      const asset = context.availableAssets.find(candidate => candidate.selectionOrigin === 'shared_library'
        && (!context.shot.sourceRefs.length
          || context.shot.sourceRefs.includes(candidate.sourceId)
          || context.shot.sourceRefs.includes(candidate.id)));
      if (!asset) return null;
      return {
        asset,
        sourceStrategy: 'licensed_stock_asset',
        providerId: this.adapterId,
        sourceRef: asset.sourceId,
        synthetic: false,
        representation: 'non_evidentiary_visual',
        authorizationRef: asset.authorizationRef || null,
        disclosure: '授权素材 · 非客户实拍',
      };
    },
  };
  const safeGraphics: SocialAssetSupplyProviderAdapter = {
    adapterId: 'system_safe_motion_graphics.v1',
    sourceStrategies: ['motion_graphics', 'verified_fact_card'],
    async execute(context) {
      const index = [...context.baselineScene.sceneId].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4;
      const palette = [
        ['#073b32', '#20a36a', '#d8f7e9'],
        ['#102a43', '#3977c3', '#dcecff'],
        ['#3b245c', '#8b5cc7', '#f0e6ff'],
        ['#4a2b13', '#c87932', '#fff0dc'],
      ] as const;
      const [dark, accent, light] = palette[index % palette.length]!;
      const title = safeGraphicText(context.baselineScene.shotFunction, 18) || '内容要点';
      const sensitive = context.shot.truthBoundary.subject !== 'none';
      const replacement = safeGraphicText(
        context.shot.functionalEquivalentReplacement.description || context.baselineScene.subject,
        30,
      ) || '通用主题说明';
      const disclosure = sensitive ? '示意画面 · 非客户实拍/案例/效果' : '系统生成说明画面';
      const filename = `asset-supply-${index + 1}-${context.shot.shotId.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
      const localPath = path.join(context.outputDirectory, filename);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${dark}"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs>
        <rect width="720" height="1280" fill="url(#g)"/>
        <circle cx="620" cy="160" r="210" fill="${light}" opacity=".12"/><circle cx="90" cy="1100" r="260" fill="${light}" opacity=".09"/>
        <rect x="54" y="350" width="612" height="560" rx="36" fill="#fff" opacity=".95"/>
        <text x="94" y="450" fill="${accent}" font-size="26" font-family="Arial, PingFang SC, sans-serif" font-weight="700">${escapeSvg(disclosure)}</text>
        <text x="94" y="570" fill="${dark}" font-size="56" font-family="Arial, PingFang SC, sans-serif" font-weight="800">${escapeSvg(title)}</text>
        <text x="94" y="680" fill="#324b45" font-size="30" font-family="Arial, PingFang SC, sans-serif">${escapeSvg(replacement)}</text>
        <text x="94" y="825" fill="#60736e" font-size="23" font-family="Arial, PingFang SC, sans-serif">不作为客户工厂、案例或产品效果证据</text>
      </svg>`;
      await sharp(Buffer.from(svg)).png().toFile(localPath);
      const contentHash = createHash('sha256').update(await fsp.readFile(localPath)).digest('hex');
      const asset: ProductionAsset = {
        id: `asset-supply-${context.taskId}-${context.shot.shotId}`,
        name: `${title} · ${disclosure}`,
        type: 'image',
        sourceId: `asset_supply_${context.shot.shotId}`,
        url: localPath,
        localPath,
        contentHash,
        duration: 2.8,
        visualObservations: [
          `${context.baselineScene.shotFunction} ${context.baselineScene.subject} ${context.baselineScene.action}`,
          disclosure,
          context.shot.productionInstruction,
        ],
        segments: [],
        selectionOrigin: 'system_graphic',
      };
      return {
        asset,
        sourceStrategy: context.shot.sourceStrategy,
        providerId: this.adapterId,
        sourceRef: context.shot.sourceRefs[0] ?? null,
        synthetic: true,
        representation: 'non_evidentiary_visual',
        authorizationRef: context.shot.sourceStrategy === 'verified_fact_card'
          ? context.shot.truthBoundary.confirmedFactRefs.join(',') || null
          : 'lingshu_system_generated',
        disclosure,
      };
    },
  };
  return [customerAsset, licensedStock, safeGraphics];
}

async function analyzeProductionAssets(input: {
  tenantId: string;
  assets: ProductionAsset[];
}): Promise<{ assets: ProductionAsset[]; failures: Array<{ assetId: string; assetName: string; reason: string }> }> {
  const assets: ProductionAsset[] = [];
  const failures: Array<{ assetId: string; assetName: string; reason: string }> = [];
  for (const asset of input.assets) {
    if (asset.visualObservations.length || asset.segments.length) {
      assets.push(asset);
      continue;
    }
    try {
      const analyzed = await analyzeProductionMaterial({
        ...asset,
        observations: [],
        authorization: { status: 'owned', scope: 'tenant', evidence: 'social_content_task_source' },
        synthetic: false,
        tags: [],
        source: 'tenant_material',
      }, input.tenantId);
      assets.push({
        ...asset,
        duration: analyzed.duration || asset.duration,
        visualObservations: analyzed.observations,
        segments: analyzed.segments,
      });
    } catch (error) {
      const rawReason = String(error instanceof Error ? error.message : error || '素材分析失败');
      const providerUnavailable = /(?:DASHSCOPE|GEMINI|GOOGLE|OPENAI)_API_KEY is not set|analysis provider.+unavailable/i.test(rawReason);
      const directTaskUpload = asset.selectionOrigin === 'task';
      const locallyDistinctSegments = directTaskUpload && asset.type === 'video'
        ? await detectDistinctTaskVideoSegments(asset)
        : [];
      if ((providerUnavailable || rawReason.startsWith('production_input_required:'))
        && directTaskUpload && locallyDistinctSegments.length >= 2) {
        // Keep the user's real footage in the edit. Local detection establishes
        // only that the time windows are visually different; confidence stays
        // at zero and narration remains on the governed, fact-safe baseline.
        assets.push({
          ...asset,
          visualObservations: [],
          segments: locallyDistinctSegments,
        });
        continue;
      }
      if (providerUnavailable && asset.explicitProductAssociation?.exactTaskProductMatch) {
        assets.push({
          ...asset,
          visualObservations: [],
          segments: asset.type === 'video' ? [{
            segmentId: `user-attested:${asset.id}`,
            start: 0,
            end: asset.duration,
            confidence: 0,
            needsReview: true,
            analysisMode: 'user_product_association_only',
            evidenceBasis: 'tenant_task_upload_exact_product_ref',
          }] : [],
        });
        continue;
      }
      if (providerUnavailable) {
        failures.push({
          assetId: asset.id,
          assetName: asset.name,
          reason: '视觉分析服务不可用，且素材没有与当前任务产品的明确关联',
        });
        continue;
      }
      if (!rawReason.startsWith('production_input_required:')) throw error;
      const reason = rawReason.replace(/^production_input_required:/, '').slice(0, 300);
      failures.push({ assetId: asset.id, assetName: asset.name, reason });
    }
  }
  return { assets, failures };
}

function productionAdaptation(plan: SocialProductionPlan, sourceAssetCount: number): SocialProductionAdaptation {
  const counts = new Map<string, number>();
  return {
    narrationChanged: plan.narrationChanged,
    limitedMaterialFallback: plan.scenes.length < 3,
    sourceAssetCount,
    notes: plan.notes,
    sceneAssets: plan.scenes.map(scene => {
      const reuseIndex = counts.get(scene.clip.assetId) ?? 0;
      counts.set(scene.clip.assetId, reuseIndex + 1);
      return {
        sceneId: scene.sceneId,
        assetId: scene.clip.assetId,
        assetName: scene.clip.assetName,
        reuseIndex,
      };
    }),
  };
}

function zeroAssetNarration(value: string): string {
  return value
    .replace(/别急着划走，先看它真实上手。/g, '别急着划走，先看这组产品信息。')
    .replace(/外观、质地和使用过程，都给你拍清楚。/g, '外观、要点和使用步骤，依次说明。')
    .replace(/先看真实场景/g, '先看场景示意')
    .replace(/结果只说明画面中能够确认的部分/g, '结果只说明已经确认的资料')
    .replace(/真实上手/g, '使用思路')
    .replace(/真实操作/g, '操作步骤')
    .replace(/真实可见/g, '逐项说明')
    .replace(/镜头里的真实呈现/g, '已经确认的资料')
    .replace(/(?:都|逐个)?拍清楚/g, '逐项说明')
    .replace(/拍给你看/g, '依次说明')
    .replace(/one real look at the product/gi, 'a clear overview of the product topic')
    .replace(/the real scenario/gi, 'the scenario outline')
    .replace(/visually supported results/gi, 'confirmed information');
}

/** A zero-asset route may reuse a governed promotional baseline, but its
 * spoken output must never say that a generated card is real footage. */
export function applyZeroAssetTruthSafeNarration(plan: SocialProductionPlan): SocialProductionPlan {
  const scenes = plan.scenes.map(scene => ({ ...scene, narration: zeroAssetNarration(scene.narration) }));
  const changed = scenes.some((scene, index) => scene.narration !== plan.scenes[index]?.narration);
  return changed ? {
    ...plan,
    scenes,
    narrationChanged: true,
    notes: [...plan.notes, '零素材真实性门禁已移除“真实实拍/真实效果”等无法由当前画面证明的口播表达。'],
  } : plan;
}

/** Convert review prose into a small, auditable set of director controls.
 * Raw feedback is never copied into narration, captions or other user-facing
 * creative output. Unknown feedback still creates a new plan version, but it
 * cannot inject unverified claims into the script. */
export function socialReviewRevisionDirective(noteValue: unknown): SocialReviewRevisionDirective {
  const note = socialText(noteValue).replace(/\s+/g, ' ').slice(0, 2_000);
  const categories: SocialReviewRevisionDirective['categories'] = [];
  if (/短|精简|太长|啰嗦|节奏.{0,3}快|shorter|too long/i.test(note)) categories.push('shorter');
  if (/开头|第一秒|前.{0,2}秒|hook|opening/i.test(note)) categories.push('opening');
  if (/字幕|caption|subtitle/i.test(note)) categories.push('captions');
  if (/配乐|音乐|bgm|music/i.test(note)) categories.push('music');
  if (/画面|镜头|素材|visual|shot|footage/i.test(note)) categories.push('visuals');
  if (!categories.length) categories.push('general');
  const musicMood = /沉稳|稳重|商务|calm|corporate/i.test(note) ? '稳重、可信、商务'
    : /轻快|活力|明快|upbeat|energetic/i.test(note) ? '清晰、轻快、专业'
      : /温暖|柔和|warm|soft/i.test(note) ? '温暖、克制、可信'
        : null;
  return {
    feedbackHash: createHash('sha256').update(note || 'revision-without-note').digest('hex'),
    categories,
    narrationRatio: categories.includes('shorter') || categories.includes('captions') ? 0.78 : 1,
    musicMood,
  };
}

function compactReviewNarration(value: string, ratio: number): string {
  const clean = socialText(value).replace(/\s+/g, ' ').trim();
  if (!clean || ratio >= 1) return clean;
  const maximum = Math.max(8, Math.floor([...clean].length * ratio));
  if ([...clean].length <= maximum) return clean;
  const chinese = /[\u3400-\u9fff]/.test(clean);
  const candidates = new Set(clean
    .split(chinese ? /[，；。！？]/ : /(?<=[,;.!?])\s+/)
    .map(item => item.trim().replace(/[，；。！？,;.!?]+$/g, ''))
    .filter(Boolean));
  if (chinese) {
    if (/^本片使用用户明确关联到.+的素材/.test(clean)) candidates.add('使用用户关联素材');
    if (/^以上为.+的已确认资料与用户关联素材/.test(clean)) candidates.add('资料与关联素材展示完毕');
    if (/未经确认的产品事实/.test(clean)) candidates.add('不扩展未经确认的产品事实');
    if (/不推断画面事实/.test(clean)) candidates.add('不推断画面事实');
  }
  const compacted = [...candidates]
    .filter(item => [...item].length >= 2 && [...item].length <= maximum)
    .sort((left, right) => [...right].length - [...left].length)[0]
    || (chinese ? '只呈现已确认内容' : 'Verified information is shown');
  return `${compacted.replace(/[，,；;：:\s]+$/g, '')}${chinese ? '。' : '.'}`;
}

export function applySocialReviewRevision(
  plan: SocialProductionPlan,
  directive: SocialReviewRevisionDirective,
): SocialProductionPlan {
  const scenes = plan.scenes.map(scene => ({
    ...scene,
    narration: compactReviewNarration(scene.narration, directive.narrationRatio),
  }));
  const changed = scenes.some((scene, index) => scene.narration !== plan.scenes[index]?.narration);
  return {
    ...plan,
    scenes,
    narrationChanged: plan.narrationChanged || changed,
    notes: [...plan.notes, `用户验收反馈已由编导 Agent 转为修订指令：${directive.categories.join('、')}`],
  };
}

async function createVideoCover(input: {
  videoPath: string;
  outputDirectory: string;
  timestamp: number;
}): Promise<string> {
  const outputPath = path.join(input.outputDirectory, 'cover.jpg');
  const result = await runVisualFfmpeg([
    '-ss', String(Math.max(0.05, input.timestamp)),
    '-i', input.videoPath,
    '-frames:v', '1',
    '-vf', 'scale=720:-2:flags=lanczos',
    '-q:v', '3',
    '-y', outputPath,
  ]);
  if (!result.ok || !existsSync(outputPath)) throw new Error('成品封面生成失败');
  return outputPath;
}

function bgmAuthorization(trackId: string): SocialDirectorBgmTrack['authorization'] {
  if (trackId.startsWith('builtin-mixkit-')) return {
    status: 'authorized',
    basis: 'mixkit_free_license',
    license: 'Mixkit Free License',
    evidence: 'https://mixkit.co/license/#musicFree',
  };
  if (trackId.startsWith('builtin-')) return {
    status: 'authorized',
    basis: 'lingshu_builtin_library',
    license: '灵枢内置商用曲库授权',
    evidence: `authenticated_catalog:${trackId}`,
  };
  return {
    status: 'authorized',
    basis: 'tenant_uploaded_warranty',
    license: '企业上传时确认拥有使用权',
    evidence: `tenant_authenticated_catalog:${trackId}`,
  };
}

async function selectDirectorBgm(input: {
  tenantId: string;
  themeId: string | null;
  directorMood: string;
  volume: number;
}): Promise<SocialDirectorBgmSelection> {
  const catalog = automationBgmCatalog(input.tenantId);
  if (!catalog.length) throw new Error('自动配乐曲库暂时不可用，请稍后重试');
  const moodTerms = input.directorMood.toLocaleLowerCase().split(/[\s,，、/;；]+/).filter(term => term.length >= 2);
  const desired = input.themeId === 'supplier_capability' ? /稳重|商务|科技|corporate|technology/i
    : input.themeId === 'customer_case' ? /温暖|信任|情感|warm|trust/i
      : /轻快|清新|活力|商务|upbeat|fresh|business/i;
  const ranked = [...catalog].sort((left, right) => {
    const score = (track: typeof catalog[number]) => {
      const searchable = `${track.name} ${track.mood}`.toLocaleLowerCase();
      return (moodTerms.some(term => searchable.includes(term)) ? 2 : 0)
        + (desired.test(`${track.name} ${track.mood}`) ? 1 : 0);
    };
    return score(right) - score(left) || left.id.localeCompare(right.id);
  });
  let primaryIndex = -1;
  for (const [index, track] of ranked.entries()) {
    try {
      await automationBgmAudio(input.tenantId, track.id);
      primaryIndex = index;
      break;
    } catch { /* Director Agent tries the next authorized catalog track. */ }
  }
  if (primaryIndex < 0) throw new Error('自动配乐曲库中的授权文件均不可用，请稍后重试');
  const ordered = [ranked[primaryIndex]!, ...ranked.filter((_, index) => index !== primaryIndex)].slice(0, 3);
  const locked = ordered.map(track => ({
    trackId: track.id,
    name: track.name,
    mood: track.mood,
    authorization: bgmAuthorization(track.id),
  }));
  return {
    primary: locked[0]!,
    fallbacks: locked.slice(1),
    fallbackPolicy: 'ordered_preapproved_tracks_only',
    volume: Math.max(0, Math.min(100, input.volume)),
  };
}

async function resolveLockedBgm(
  tenantId: string,
  handoff: SocialDirectorContentHandoff,
): Promise<{ id: string; url: string }> {
  const ordered = [handoff.bgmSelection.primary, ...handoff.bgmSelection.fallbacks];
  for (const track of ordered) {
    if (track.authorization.status !== 'authorized') continue;
    try {
      return { id: track.trackId, url: await automationBgmAudio(tenantId, track.trackId) };
    } catch { /* Execute the Director Agent's pre-authorized fallback order. */ }
  }
  throw new Error('编导方案锁定的主配乐和备用配乐均不可用，请重新生成编导方案');
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
  const previousProduction = socialObject(socialJson(output.production)) ?? {};
  const previousHistory = Array.isArray(socialJson(previousProduction.stageHistory))
    ? (socialJson(previousProduction.stageHistory) as unknown[])
      .map(item => socialObject(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .slice(-11)
    : [];
  const updatedAt = new Date().toISOString();
  await input.repository.update(STARTER_COLLECTIONS.tasks, input.tenantId, task.id, {
    status: input.status ?? 'running',
    output: {
      ...output,
      production: {
        ...previousProduction,
        schemaVersion: AUTO_SCHEMA,
        stage: input.stage,
        message: input.message,
        updatedAt,
        stageHistory: [
          ...previousHistory,
          { stage: input.stage, message: input.message, at: updatedAt },
        ],
        ...(input.extra ?? {}),
      },
    },
    blocked_reason: input.status === 'waiting_external' ? input.message : '',
    updated_at: updatedAt,
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
  const pendingRevision = detail?.artifacts.some(artifact => artifact.kind === 'short_video'
    && artifact.status === 'changes_requested');
  const completedArtifact = detail?.artifacts.some(artifact => artifact.origin === 'agent'
    && artifact.kind === 'short_video'
    && !['superseded', 'changes_requested'].includes(artifact.status));
  if (completedArtifact && !pendingRevision) return;
  const rawMessage = String(input.error instanceof Error ? input.error.message : input.error || '自动成片失败').slice(0, 800);
  const needsMaterial = rawMessage.startsWith('production_input_required:');
  const needsUserInput = rawMessage.startsWith('user_input_required:');
  const directorRevisionFailed = rawMessage.startsWith('director_revision_required:');
  const message = rawMessage.replace(/^(?:production_input_required|user_input_required|director_revision_required):/, '').trim();
  await writeExecutionStage({
    ...input,
    stage: needsUserInput ? 'waiting_for_user_input' : 'automatic_recovery_exhausted',
    status: 'waiting_external',
    message: needsUserInput
      ? message
      : `系统已保留导演方案和现有结果，稍后可继续自动处理：${message}`,
    extra: {
      reasonCode: needsUserInput
        ? 'social_content_user_input_required'
        : needsMaterial
          ? 'social_content_system_material_fallback_exhausted'
        : directorRevisionFailed
          ? 'social_content_director_revision_retryable'
          : 'social_content_auto_production_failed',
    },
  }).catch(() => undefined);
  const record = await requireSocialTask(input).catch(() => null);
  if (record && socialText(record.status) === 'producing') {
    await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, record.id, {
      // Missing personalization data is handled by the library/system fallback.
      // Only an explicit governed user-input requirement may surface attention.
      status: needsUserInput ? 'attention' : 'paused',
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

export interface SocialContentAutoProductionRuntime {
  selectDirectorBgm?: typeof selectDirectorBgm;
  synthesizeVoice?: typeof synthesizeStudioVoiceForAutomation;
  resolveBgm?: typeof resolveLockedBgm;
  renderComposite?: typeof composite;
  inspectVisuals?: typeof inspectRenderedVisuals;
  inspectScenes?: typeof inspectRenderedScenes;
  runFfmpeg?: typeof runVisualFfmpeg;
  createCover?: typeof createVideoCover;
  evaluateReplication?: typeof evaluateSocialReplicationResult;
  backendFilePort?: SocialContentBackendFilePort;
}

export async function runSocialContentAutoProduction(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  runId: string;
  /** Optional providers are explicitly registered by the deployment. Missing
   * digital-human/stock/AI providers remain visible fallback attempts. */
  assetSupplyAdapters?: SocialAssetSupplyProviderAdapter[];
  /** Deterministic ports for worker-level tests and alternate local runtimes. */
  runtime?: SocialContentAutoProductionRuntime;
}): Promise<void> {
  const detail = await readSocialTaskDetail(input);
  if (!detail) throw new Error('社媒内容任务不存在');
  const revisionParent = [...detail.artifacts].reverse().find(artifact => artifact.kind === 'short_video'
    && artifact.status === 'changes_requested');
  const existing = detail.artifacts.find(artifact => artifact.origin === 'agent'
    && artifact.kind === 'short_video'
    && socialText(artifact.content?.workflowSchema) === AUTO_SCHEMA
    && !['superseded', 'changes_requested'].includes(artifact.status));
  if (!revisionParent && existing) {
    await finishExecution({ ...input, artifactId: existing.artifactId });
    return;
  }
  const agentWorkflow = detail.agentWorkflow;
  if (!agentWorkflow?.executionPlanReview.approved) {
    const required = agentWorkflow?.executionPlanReview.requiredRevision.join('；')
      || '内容执行方案尚未通过编导逐镜审核';
    throw new Error(`user_input_required:${required}`);
  }
  await writeExecutionStage({
    ...input,
    stage: 'execution_plan_approved',
    message: '内容 Agent 已提交逐镜执行方案，编导 Agent 自动审核通过，开始锁定并执行。',
    extra: {
      agentWorkflowSchema: agentWorkflow.schemaVersion,
      directorBriefId: agentWorkflow.directorBrief.directorBriefId,
      directorBriefVersion: agentWorkflow.directorBrief.version,
      executionPlanId: agentWorkflow.executionPlan.executionPlanId,
      executionPlanVersion: agentWorkflow.executionPlan.version,
      executionPlanReviewId: agentWorkflow.executionPlanReview.reviewId,
      reviewRound: agentWorkflow.executionPlan.reviewRound,
      maxReviewRounds: agentWorkflow.executionPlan.maxReviewRounds,
      plannedCostCny: agentWorkflow.executionPlan.scenes.reduce((sum, scene) => sum + scene.estimatedCostCny, 0),
      plannedSeconds: agentWorkflow.executionPlan.scenes.reduce((sum, scene) => sum + scene.estimatedSeconds, 0),
    },
  });
  const taskRecord = await requireSocialTask(input);
  let revisionNote = '';
  if (revisionParent) {
    const revisionRows = await input.repository.list(STARTER_COLLECTIONS.socialContentArtifacts, input.tenantId, {
      where: { task_id: input.taskId, artifact_id: revisionParent.artifactId }, perPage: 2,
    });
    if (revisionRows.totalItems !== 1 || revisionRows.items.length !== 1) {
      throw new Error('退回成品的修订记录不完整，已停止自动重制');
    }
    revisionNote = socialText(revisionRows.items[0]?.decision_note);
  }
  const reviewDirective = revisionParent ? socialReviewRevisionDirective(revisionNote) : null;
  const profile = await readTenantEnterpriseProfile(input.tenantId).catch(() => null);
  const verifiedContext = profile
    ? verifiedSocialScriptContext(profile, detail.brief.productRef)
    : { productName: null, facts: [], source: 'none' as const, confidence: 0 };
  let baseline = parseStoredSocialScriptBaseline(taskRecord.script_baseline);
  let directorFormula: InternalSocialContentFormula | null = null;
  let staleFormulaReference = false;
  if (baseline?.formulaReference) {
    try {
      directorFormula = await resolveSocialContentFormulaReference({
        repository: input.repository,
        formulaId: baseline.formulaReference.formulaId,
        version: baseline.formulaReference.version,
      });
    } catch (error) {
      // Bundled formulas were intentionally removed. Re-ground older tasks
      // through the governed inspiration -> enterprise knowledge fallback.
      if (!(error instanceof SocialContentWorkflowError)
        || error.code !== 'social_content_formula_reference_invalid') throw error;
      baseline = null;
      staleFormulaReference = true;
    }
  }
  if (baseline?.source === 'knowledge_fallback'
    && baseline.match?.verifiedKnowledgeSource === 'none'
    && !baseline.formulaReference
    && !baseline.match?.inspirationReference
    && !baseline.match?.userProductAssociation) {
    // Older v3 baselines treated an empty tenant as a knowledge fallback and
    // then blocked on missing evidence. Re-freeze them into the governed
    // system-theme baseline so first-content tasks gain the new safe fallback.
    baseline = null;
  }
  if (!baseline || baseline.groundingVersion !== SOCIAL_SCRIPT_GROUNDING_VERSION) {
    // Compatibility path for older tasks: discard any baseline that directly
    // interpolated title/objective/product free text and re-freeze it from
    // governed formula/inspiration structure plus verified enterprise facts.
    const storedReference = socialObject(socialJson(taskRecord.formula_reference));
    const formulaId = staleFormulaReference ? '' : baseline?.formulaReference?.formulaId || socialText(storedReference?.formulaId);
    const formulaVersion = staleFormulaReference ? '' : baseline?.formulaReference?.version || socialText(storedReference?.version);
    directorFormula = formulaId && formulaVersion
      ? await resolveSocialContentFormulaReference({
          repository: input.repository,
          formulaId,
          version: formulaVersion,
        })
      : null;
    const inspiration = detail.theme?.themeId
      ? await resolveSocialInspirationScript({
          tenantId: input.tenantId,
          themeId: detail.theme.themeId,
          verifiedContext,
        })
      : null;
    baseline = freezeSocialScriptBaseline({
      brief: detail.brief,
      theme: detail.theme ?? null,
      formula: directorFormula,
      inspiration,
      verifiedContext,
      lockedAt: new Date().toISOString(),
      previous: baseline,
    });
    await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, taskRecord.id, {
      script_baseline: baseline,
      formula_reference: baseline.formulaReference ?? '',
      updated_at: new Date().toISOString(),
    });
  }
  if (!baseline) throw new Error('脚本基线生成失败，已停止自动制作');
  const initialBaseline = baseline;
  await writeExecutionStage({
    ...input,
    stage: 'director_planning',
    message: '脚本来源已确认，编导 Agent 正在匹配真实素材并编排脚本、口播、字幕和镜头节奏。',
    extra: {
      baselineOrigin: initialBaseline.source,
      baselineVersion: initialBaseline.version,
      scriptMatchConfidence: initialBaseline.match?.confidence ?? null,
      userTextUsage: initialBaseline.match?.userTextUsage ?? 'intent_only',
    },
  });

	  await withSocialContentRenderWorkspace(async outputDir => {
	  let activeBaseline = initialBaseline;
	  const productionMode = detail.brief.productionMode ?? 'concept_preview';
	  const zeroAssetRoute = detail.assetSupplyPlan?.productionRoute === 'zero_asset_generation';
	  const rawAssets = await taskProductionAssets({
	    tenantId: input.tenantId,
	    sources: detail.sources,
	    productRef: detail.brief.productRef,
	    themeId: detail.theme?.themeId ?? null,
	    productionMode,
	    outputDirectory: outputDir,
	    allowAuthorizedSharedLibrary: zeroAssetRoute,
	  }).catch(error => {
	    if (zeroAssetRoute) return [];
	    throw error;
	  });
	  const analyzed = await analyzeProductionAssets({ tenantId: input.tenantId, assets: rawAssets });
	  let assets = analyzed.assets;
	  let assetSupplyExecution: SocialAssetSupplyExecution | null = null;
	  if (zeroAssetRoute && detail.assetSupplyPlan) {
	    const supplied = await executeSocialAssetSupplyPlan({
	      tenantId: input.tenantId,
	      taskId: input.taskId,
	      outputDirectory: outputDir,
	      plan: detail.assetSupplyPlan,
	      baseline: activeBaseline,
	      availableAssets: assets,
	      adapters: [...(input.assetSupplyAdapters ?? []), ...existingAssetSupplyAdapters()],
	    });
	    // Only assets selected by the governed per-shot router may enter a
	    // zero-asset render. Ambient shared inventory cannot bypass its trace.
	    assets = supplied.assets;
	    assetSupplyExecution = supplied.execution;
	    await writeExecutionStage({
	      ...input,
	      stage: 'asset_supply_completed',
	      message: '内容 Agent 已逐镜完成零素材来源路由和真实性边界检查。',
	      extra: { assetSupplyExecution },
	    });
	  }
  if (['knowledge_fallback', 'system_theme_baseline'].includes(activeBaseline.source)
    && !activeBaseline.formulaReference
    && !activeBaseline.match?.inspirationReference) {
    const associationIdentities = new Set(assets
      .filter(asset => asset.explicitProductAssociation?.exactTaskProductMatch)
      .map(asset => asset.contentHash || asset.localPath || asset.objectKey || asset.url || asset.id));
    const requiresAssociationOnlySafety = activeBaseline.match?.verifiedKnowledgeSource === 'none';
    const materialCategoryHint = assets.flatMap(asset => asset.visualObservations).map(socialText).filter(Boolean).join(' ');
    // Exact tenant-authored product linkage is also a safe visual fallback
    // when enterprise product facts exist but no vision provider is available.
    // It authorizes using the files in an edit; it never turns filenames,
    // labels or enterprise facts into claims about what the camera saw.
    if (associationIdentities.size >= 1 && requiresAssociationOnlySafety) {
      activeBaseline = freezeSocialScriptBaseline({
        brief: detail.brief,
        theme: detail.theme ?? null,
        formula: null,
        inspiration: null,
        verifiedContext,
        // This is confidence in the exact tenant-authored linkage only. Visual
        // confidence remains 0 on every association-only production clip.
        userProductAssociation: { basis: 'tenant_task_upload', confidence: 0.45 },
        materialCategoryHint,
        lockedAt: new Date().toISOString(),
        previous: activeBaseline,
      });
      await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, taskRecord.id, {
        script_baseline: activeBaseline,
        formula_reference: '',
        updated_at: activeBaseline.lockedAt,
      });
    }
  }
  let plan = buildSocialProductionPlan({ baseline: activeBaseline, assets, themeId: detail.theme?.themeId ?? null });
  if (!plan.ok) {
    const systemAssets = await systemThemeGraphicAssets({ outputDirectory: outputDir, baseline: activeBaseline });
    assets = [...assets, ...systemAssets];
    plan = buildSocialProductionPlan({ baseline: activeBaseline, assets, themeId: detail.theme?.themeId ?? null });
    if (plan.ok) {
      plan.notes.push(productionMode === 'social_ready'
        ? '客户素材不足，编导 Agent 已切换到零素材托管方案，使用可追溯的系统图形、口播和字幕完成正式制作。'
        : '现有素材覆盖不足，编导 Agent 已使用平台安全主题图形完成预览版。');
    }
  }
  plan.unusedAssets.push(...analyzed.failures.map(item => ({
    assetId: item.assetId,
    assetName: item.assetName,
    reason: `素材分析未通过：${item.reason}`,
  })));
  if (!plan.ok) {
    const failureSummary = analyzed.failures.length
      ? ` 未通过分析：${analyzed.failures.map(item => `${item.assetName}（${item.reason}）`).join('；')}`
      : '';
    throw new Error(`production_input_required:系统无法建立安全的零素材画面方案，请稍后自动重试。${failureSummary}`);
  }
  if (assetSupplyExecution) plan = applyZeroAssetTruthSafeNarration(plan);
  if (reviewDirective) plan = applySocialReviewRevision(plan, reviewDirective);
  const adaptation = productionAdaptation(plan, assets.length);
  const previousDirectorPlan = parseStoredSocialDirectorPlan(taskRecord.director_plan);
  if (previousDirectorPlan) {
    // One-time compatibility backfill for tasks created before the immutable
    // version collection existed. A mismatched historic baseline is recorded
    // honestly as legacy_plan_only rather than attaching current facts to it.
    await persistSocialDirectorPlanVersion({
      repository: input.repository,
      tenantId: input.tenantId,
      taskId: input.taskId,
      plan: previousDirectorPlan,
    });
  }
  const defaultDirectorMood = detail.theme?.themeId === 'supplier_capability'
    ? '稳重、可信、商务'
    : detail.theme?.themeId === 'customer_case'
      ? '温暖、克制、可信'
      : '清晰、轻快、专业';
	  const bgmSelection = await (input.runtime?.selectDirectorBgm ?? selectDirectorBgm)({
    tenantId: input.tenantId,
    themeId: detail.theme?.themeId ?? null,
    directorMood: reviewDirective?.musicMood
      || socialText(directorFormula?.direction?.music?.mood)
      || defaultDirectorMood,
    volume: Number(directorFormula?.direction?.music?.volume ?? 18),
  });
  let directorPlan = buildSocialDirectorPlan({
    taskId: input.taskId,
    baseline: activeBaseline,
    productionPlan: plan,
    productionAssets: assets,
    sourceVersions: Object.fromEntries(detail.sources.map(source => [source.sourceId, source.sourceVersion ?? ''])),
    outputSpec: {
      aspectRatio: detail.brief.aspectRatio,
      resolution: '720p',
      platform: detail.brief.platforms[0] ?? 'douyin',
    },
    bgmSelection,
    formula: directorFormula,
    createdAt: new Date().toISOString(),
    previous: previousDirectorPlan,
  });
  let persistedDirectorPlan = await persistSocialDirectorPlanVersion({
    repository: input.repository,
    tenantId: input.tenantId,
    taskId: input.taskId,
    plan: directorPlan,
    baseline: activeBaseline,
    verifiedContext,
  });
  let directorSummary = publicSocialDirectorPlanSummary(directorPlan)!;
  await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, taskRecord.id, {
    director_plan: directorPlan,
    updated_at: directorPlan.createdAt,
  });
  let contentHandoff = socialDirectorContentHandoff(directorPlan);
  await writeExecutionStage({
    ...input,
    stage: 'content_production',
    message: '编导方案已锁定并交给内容 Agent，正在生成配音、配乐并制作视频。',
    extra: {
      directorPlanVersion: directorPlan.version,
      directorPlanHash: directorPlan.lineageHash,
      directorPlanSummary: directorSummary,
      adaptationNotes: adaptation.notes,
      narrationChanged: adaptation.narrationChanged,
      selectedAssetCount: plan.selectedAssetIds.length,
      unusedAssetCount: plan.unusedAssets.length,
      sourceClipSeconds: plan.sourceClipSeconds,
	  ...(assetSupplyExecution ? { assetSupplyExecution } : {}),
      ...(revisionParent && reviewDirective ? {
        reviewRevision: {
          parentArtifactId: revisionParent.artifactId,
          feedbackHash: reviewDirective.feedbackHash,
          categories: reviewDirective.categories,
        },
      } : {}),
    },
  });
    let transientVoicePath = '';
    try {
      let voice: Awaited<ReturnType<typeof synthesizeStudioVoiceForAutomation>> | null = null;
      let duration = 0;
      for (let revisionAttempt = 0; revisionAttempt <= 2; revisionAttempt += 1) {
        voice = await (input.runtime?.synthesizeVoice ?? synthesizeStudioVoiceForAutomation)({
          tenantId: input.tenantId,
          text: contentHandoff.narration,
          language: contentHandoff.outputSpec.language,
          voice: contentHandoff.direction.voiceover.voice,
          targetDuration: contentHandoff.outputSpec.targetDurationSeconds,
          style: {
            preset: contentHandoff.direction.voiceover.preset,
            speed: contentHandoff.direction.voiceover.speed,
            pauseStyle: contentHandoff.direction.voiceover.pauseStyle,
          },
        });
        transientVoicePath = voice.localPath || '';
        if (!voice.ok || !voice.localPath || !existsSync(voice.localPath) || !voice.cues?.length) {
          throw new Error(voice.error || '口播服务未返回可用音频和字幕时间轴');
        }
        if (socialText(voice.text) !== contentHandoff.narration) {
          throw new Error('内容 Agent 返回的口播与编导方案不一致，已停止生成');
        }
        duration = Math.max(1, Number(voice.duration || voice.cues.at(-1)?.end
          || contentHandoff.outputSpec.targetDurationSeconds));
        if (duration <= contentHandoff.outputSpec.maximumDurationSeconds + 0.25) break;
        if (revisionAttempt >= 2) {
          throw new Error(`director_revision_required:口播经过 2 次编导内部压缩仍为 ${duration.toFixed(1)} 秒，超过锁定素材 ${contentHandoff.outputSpec.maximumDurationSeconds.toFixed(1)} 秒`);
        }
        await writeExecutionStage({
          ...input,
          stage: 'director_revision_required',
          message: '实际口播超过素材时长，已退回编导 Agent 内部压缩；无需用户补填。',
          extra: {
            directorPlanId: directorPlan.directorPlanId,
            previousDirectorPlanVersion: directorPlan.version,
            measuredVoiceoverSeconds: duration,
            maximumMaterialSeconds: contentHandoff.outputSpec.maximumDurationSeconds,
            revisionAttempt: revisionAttempt + 1,
          },
        });
        await Promise.all([
          fsp.rm(transientVoicePath, { force: true }),
          fsp.rm(`${transientVoicePath}.alignment.json`, { force: true }),
        ]).catch(() => undefined);
        transientVoicePath = '';
        directorPlan = reviseSocialDirectorPlanForVoiceoverFit({
          previous: directorPlan,
          measuredDurationSeconds: duration,
          createdAt: new Date().toISOString(),
        });
        persistedDirectorPlan = await persistSocialDirectorPlanVersion({
          repository: input.repository,
          tenantId: input.tenantId,
          taskId: input.taskId,
          plan: directorPlan,
          baseline: activeBaseline,
          verifiedContext,
        });
        directorSummary = publicSocialDirectorPlanSummary(directorPlan)!;
        await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, taskRecord.id, {
          director_plan: directorPlan,
          updated_at: directorPlan.createdAt,
        });
        contentHandoff = socialDirectorContentHandoff(directorPlan);
        await writeExecutionStage({
          ...input,
          stage: 'content_production',
          message: `编导 Agent 已锁定第 ${directorPlan.version} 版执行方案，内容 Agent 自动重试配音。`,
          extra: {
            directorPlanId: directorPlan.directorPlanId,
            directorPlanVersion: directorPlan.version,
            directorPlanHash: directorPlan.lineageHash,
            directorPlanSummary: directorSummary,
          },
        });
      }
      if (!voice || !voice.localPath || !voice.cues?.length) throw new Error('口播执行状态异常');
  const timeline = socialDirectorRenderTimeline(contentHandoff, duration);
  const adaptedScript = socialDirectorScriptText(contentHandoff, duration);
  const bgm = await (input.runtime?.resolveBgm ?? resolveLockedBgm)(input.tenantId, contentHandoff);
  const captionCues = socialDirectorSceneTimingCues(contentHandoff, duration);
  await writeExecutionStage({
    ...input,
    stage: 'rendering',
    message: '内容 Agent 正在自动剪辑、混音并烧录字幕。',
    extra: { duration, sceneCount: timeline.length },
  });
  const result = await (input.runtime?.renderComposite ?? composite)({
    jobId: `social-${input.taskId}-${createHash('sha256').update(input.runId).digest('hex').slice(0, 12)}`,
    requireVisualAssets: true,
    spec: {
      ratio: contentHandoff.outputSpec.aspectRatio,
      resolution: contentHandoff.outputSpec.resolution,
      duration,
      platform: contentHandoff.outputSpec.platform,
      language: contentHandoff.outputSpec.language,
      bgmVol: contentHandoff.bgmSelection.volume,
      voiceVol: contentHandoff.outputSpec.voiceVolume,
    },
    timeline,
    voiceover: { url: voice.localPath },
    bgm,
    subtitles: {
      mode: 'target',
      cues: captionCues,
      style: {
        fontScale: contentHandoff.direction.subtitles.fontScale,
        bottomRatio: contentHandoff.direction.subtitles.bottomRatio,
      },
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
  const quality = await (input.runtime?.inspectVisuals ?? inspectRenderedVisuals)({
    outputPath: result.outputPath,
    expectedDuration: duration,
    expectedUniqueScenes: contentHandoff.scenes.length,
  });
  if (!quality.passed) throw new Error(`成片画面质检未通过：${quality.failures.join('；')}`);
  const sceneQuality = await (input.runtime?.inspectScenes ?? inspectRenderedScenes)({
    outputPath: result.outputPath,
    scenes: captionCues,
    requireDistinct: true,
  });
  if (!sceneQuality.passed) {
    throw new Error(`成片逐镜质检未通过：${sceneQuality.issues.map(issue => issue.reason).join('；')}`);
  }
  const audio = await (input.runtime?.runFfmpeg ?? runVisualFfmpeg)([
    '-i', result.outputPath, '-map', '0:a:0', '-t', String(Math.min(2, duration)), '-f', 'null', '-',
  ]);
  if (!audio.ok) throw new Error('成片音轨无法解码，已停止提交验收');

  const coverPath = await (input.runtime?.createCover ?? createVideoCover)({
    videoPath: result.outputPath,
    outputDirectory: outputDir,
    timestamp: socialDirectorCoverTimestamp(contentHandoff, duration),
  });
  const stored = await inspectTransientSocialContentFile({
    filePath: result.outputPath,
    name: `${detail.brief.title || '社媒内容'}-成品.mp4`,
    mimeType: 'video/mp4',
  });
  const file = await registerSocialContentFile({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    taskId: input.taskId,
    usage: 'artifact_media',
    idempotencyKey: `social-auto-file:${input.taskId}:${stored.sha256}`,
    stored,
    transientPath: result.outputPath,
	backendFilePort: input.runtime?.backendFilePort,
  });
  const storedCover = await inspectTransientSocialContentFile({
    filePath: coverPath,
    name: `${detail.brief.title || '社媒内容'}-封面.jpg`,
    mimeType: 'image/jpeg',
  });
  const coverFile = await registerSocialContentFile({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    taskId: input.taskId,
    usage: 'artifact_media',
    idempotencyKey: `social-auto-cover:${input.taskId}:${storedCover.sha256}`,
    stored: storedCover,
    transientPath: coverPath,
	backendFilePort: input.runtime?.backendFilePort,
  });
  await resolveSocialDirectorArtifactLineage({
    repository: input.repository,
    tenantId: input.tenantId,
    taskId: input.taskId,
    reference: persistedDirectorPlan.reference,
  });
  const productionResultId = `production_result_${socialRequestHash({ taskId: input.taskId, runId: input.runId, executionPlanId: agentWorkflow.executionPlan.executionPlanId }).slice(0, 20)}`;
  let replicationEvaluation = null;
  if (agentWorkflow.replicationJob) {
    await writeExecutionStage({
      ...input,
      stage: 'media_evaluation',
      message: '独立媒体评估 Worker 正在核对爆点保真、身份替换、原创差异、复用风险和账号适配。',
      extra: {
        replicationJobId: agentWorkflow.replicationJob.replicationJobId,
        factorSpecVersion: agentWorkflow.replicationJob.factorSpecVersion,
      },
    });
    const evaluated = await (input.runtime?.evaluateReplication ?? evaluateSocialReplicationResult)({
      workflow: agentWorkflow,
      replicationScript: detail.replicationScript ?? null,
      productionResultId,
      outputVideoPath: result.outputPath,
      evidence: {
        outputText: adaptedScript,
      },
    });
    replicationEvaluation = evaluated.evaluation;
  }
  const creativeReviewFailures = [
    ...(agentWorkflow.executionPlanReview.approved ? [] : ['内容执行方案未通过编导审核']),
    ...(contentHandoff.scenes.length > 0 ? [] : ['成片没有可验收的镜头']),
    ...(agentWorkflow.directorBrief.scenes.every(scene => scene.acceptanceCriteria.length > 0)
      ? [] : ['存在没有可观察验收条件的分镜']),
  ];
  await writeExecutionStage({
    ...input,
    stage: 'creative_review',
    message: creativeReviewFailures.length
      ? '编导 Agent 的结构与表达验收未通过，正在停止提交并保留当前结果。'
      : replicationEvaluation && replicationEvaluation.status !== 'passed'
        ? '成片已保留为候选；独立媒体检测尚未自动放行，等待编导逐镜复核或局部返工。'
        : '技术质检和独立媒体检测通过，编导 Agent 已按 DirectorBrief 完成结构与表达验收。',
    extra: {
      directorBriefId: agentWorkflow.directorBrief.directorBriefId,
      checkedSceneCount: contentHandoff.scenes.length,
      failedCriteria: creativeReviewFailures,
      replicationEvaluationId: replicationEvaluation?.evaluationId ?? null,
      replicationEvaluationStatus: replicationEvaluation?.status ?? null,
    },
  });
  if (creativeReviewFailures.length) {
    throw new Error(`director_revision_required:${creativeReviewFailures.join('；')}`);
  }
  const evaluationFailures = replicationEvaluation?.status === 'passed'
    ? []
    : replicationEvaluation?.directorDecision.failedCriteria ?? [];
  const productionResult: SocialProductionResult = {
    productionResultId,
    version: detail.version,
    executionPlanId: agentWorkflow.executionPlan.executionPlanId,
    executionPlanVersion: agentWorkflow.executionPlan.version,
    executionPlanReviewId: agentWorkflow.executionPlanReview.reviewId,
    artifactId: null,
    creativeReviewId: `creative_review_${socialRequestHash({ taskId: input.taskId, runId: input.runId, directorBriefId: agentWorkflow.directorBrief.directorBriefId }).slice(0, 20)}`,
    publishAssignmentId: null,
    status: 'asset_review',
    sceneResults: agentWorkflow.executionPlan.scenes.map(scene => ({
      sceneId: scene.sceneId,
      idempotencyKey: scene.idempotencyKey,
      sourceStrategy: scene.selectedSourceStrategy,
      feasibility: scene.feasibility,
      provenanceCandidateIds: scene.recommendedCandidateIds,
    })),
    technicalReview: { approved: true, checkedScenes: sceneQuality.checkedScenes, failures: [] },
    creativeReview: {
      approved: !replicationEvaluation || replicationEvaluation.status === 'passed',
      failedCriteria: evaluationFailures,
      reviewedBy: 'director_agent',
    },
    artifactResourceRef: file.fileRef,
    createdAt: new Date().toISOString(),
  };
  const artifactResult = await createSocialContentArtifact({
    repository: input.repository,
    tenantId: input.tenantId,
    userId: input.userId,
    taskId: input.taskId,
    idempotencyKey: `social-auto-artifact:${input.runId}`,
    trustedAgentOrigin: true,
	backendFilePort: input.runtime?.backendFilePort,
    value: {
      kind: 'short_video',
      platform: contentHandoff.outputSpec.platform,
      language: contentHandoff.outputSpec.language,
      origin: 'agent',
      parentArtifactId: revisionParent?.artifactId,
      resourceRef: file.fileRef,
      content: {
        workflowSchema: AUTO_SCHEMA,
        sourceKey: `social_task_auto:${input.taskId}`,
        contentType: 'short_video',
        mediaStorage: {
          provider: 'pocketbase_file',
          video: {
            fileRef: file.fileRef,
            fileId: file.fileId,
            sha256: file.sha256,
            url: file.downloadUrl || socialContentFileDownloadUrl(file.fileId),
          },
          cover: {
            fileRef: coverFile.fileRef,
            fileId: coverFile.fileId,
            sha256: coverFile.sha256,
            url: coverFile.downloadUrl || socialContentFileDownloadUrl(coverFile.fileId),
          },
        },
        scriptBaseline: {
          version: activeBaseline.version,
          source: activeBaseline.source,
          matchConfidence: activeBaseline.match?.confidence ?? null,
          groundingVersion: activeBaseline.groundingVersion ?? null,
          language: activeBaseline.language,
          lockedAt: activeBaseline.lockedAt,
          scenes: activeBaseline.scenes.map(scene => ({
            sceneId: scene.sceneId,
            shotFunction: scene.shotFunction,
            subject: scene.subject,
            action: scene.action,
            script: scene.script,
            voiceover: scene.voiceover,
            caption: scene.caption,
            narration: scene.narration,
          })),
        },
        directorPlan: directorSummary,
        directorPlanReference: persistedDirectorPlan.reference,
        productionResult,
        ...(replicationEvaluation ? { replicationEvaluation } : {}),
        adaptedScript,
        scriptAdaptation: adaptation,
	    ...(assetSupplyExecution ? { assetSupplyExecution } : {}),
        narration: {
          changedFromBaseline: adaptation.narrationChanged,
          source: voice.source || 'unknown',
          duration,
          cueCount: captionCues.length,
        },
        render: {
          completed: true,
          materialSourceIds: [...new Set(contentHandoff.scenes.map(scene => scene.source.sourceId))],
          selectedAssetIds: [...new Set(contentHandoff.scenes.map(scene => scene.source.assetId))],
          unusedAssets: directorPlan.unusedAssets,
          sourceClipSeconds: contentHandoff.scenes.reduce((sum, scene) => (
            sum + Math.max(0, scene.source.sourceEnd - scene.source.sourceStart)
          ), 0),
          materialMatchConfidence: directorPlan.scenes.reduce((sum, scene) => (
            sum + scene.shotPlan.confidence
          ), 0) / Math.max(1, directorPlan.scenes.length),
          qualityPassed: true,
          qualityMetrics: quality.metrics,
          checkedScenes: sceneQuality.checkedScenes,
          audioDecoded: true,
          bgm: {
            id: bgm.id,
            volume: contentHandoff.bgmSelection.volume,
            mood: [contentHandoff.bgmSelection.primary, ...contentHandoff.bgmSelection.fallbacks]
              .find(track => track.trackId === bgm.id)?.mood ?? contentHandoff.direction.music.mood,
            authorization: [contentHandoff.bgmSelection.primary, ...contentHandoff.bgmSelection.fallbacks]
              .find(track => track.trackId === bgm.id)?.authorization ?? null,
          },
          coverIntent: contentHandoff.coverIntent,
          degradation: adaptation.limitedMaterialFallback ? adaptation.notes : [],
        },
        review: { state: 'requires_user_approval', automatedChecksPassed: true },
        ...(revisionParent && reviewDirective ? {
          reviewRevision: {
            parentArtifactId: revisionParent.artifactId,
            feedbackHash: reviewDirective.feedbackHash,
            categories: reviewDirective.categories,
          },
        } : {}),
        productionHash: socialRequestHash({
          directorPlan,
          adaptation,
          videoSha256: stored.sha256,
          coverSha256: storedCover.sha256,
        }),
      },
    },
  });
  await finishExecution({ ...input, artifactId: artifactResult.artifact.artifactId });
    } finally {
      if (transientVoicePath) {
        await Promise.all([
          fsp.rm(transientVoicePath, { force: true }),
          fsp.rm(`${transientVoicePath}.alignment.json`, { force: true }),
        ]).catch(() => undefined);
      }
    }
  });
}

const activeProductions = new Map<string, { runId: string; promise: Promise<void> }>();

async function runSocialContentAutoProductionWithRetry(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  runId: string;
}): Promise<void> {
  let lastError: unknown = new Error('自动成片失败');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await runSocialContentAutoProduction(input);
      return;
    } catch (error) {
      lastError = error;
      const raw = String(error instanceof Error ? error.message : error || '自动成片失败');
      if (raw.startsWith('user_input_required:')) break;
      if (attempt >= 3) break;
      await writeExecutionStage({
        ...input,
        stage: 'automatic_recovery',
        status: 'running',
        message: raw.startsWith('production_input_required:')
          ? '现有素材未通过自动检查，正在切换素材库与安全基础方案。'
          : '本次生成暂未完成，正在自动切换备用方案。',
        extra: { automaticRetryAttempt: attempt + 1, automaticRetryLimit: 3 },
      }).catch(() => undefined);
      await new Promise<void>(resolve => setTimeout(resolve, attempt * 300));
    }
  }
  throw lastError;
}

/** Fire-and-observe entry point: API admission returns immediately while the worker renders in-process. */
export function enqueueSocialContentAutoProduction(input: {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  taskId: string;
  runId: string;
}): void {
  const key = `${input.tenantId}\u0000${input.taskId}`;
  const current = activeProductions.get(key);
  if (current?.runId === input.runId) return;
  let pending!: Promise<void>;
  pending = runOutsideSocialContentMutationScope(() => (
    (current?.promise.catch(() => undefined) ?? Promise.resolve())
      .then(() => new Promise<void>(resolve => setImmediate(resolve)))
      .then(() => runSocialContentAutoProductionWithRetry(input))
      .catch(error => failExecution({ ...input, error }))
      .finally(() => {
        if (activeProductions.get(key)?.promise === pending) activeProductions.delete(key);
      })
  ));
  activeProductions.set(key, { runId: input.runId, promise: pending });
}

export function socialContentAutoProductionActive(tenantId: string, taskId: string): boolean {
  return activeProductions.has(`${tenantId}\u0000${taskId}`);
}
