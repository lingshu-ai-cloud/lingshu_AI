import { editorialEvidenceScore, visualEvidenceScore } from '../digitalEmployees/sceneEvidence.js';
import type { SocialContentThemeId } from '../../shared/contracts/socialContentWorkflow.js';
import { socialContentMaterialPolicy } from '../../shared/socialContentMaterialPolicy.js';
import type { StoredSocialScriptBaseline } from './socialContentScriptBaseline.js';
import { socialText } from './socialContentValidation.js';
import type { MaterialScriptAnalysis, MaterialScriptRole } from '../../shared/materialScriptAnalysis.js';
import {
  buildMaterialSceneReview,
  materialReviewBundle,
  type MaterialReviewBundle,
  type MaterialSceneReview,
} from '../videoProduction/materialQualityLearning.js';

export type SocialProductionAsset = {
  id: string;
  name: string;
  type: 'video' | 'image';
  sourceId: string;
  url: string;
  localPath?: string;
  objectKey?: string;
  cloudRecordId?: string;
  contentHash?: string;
  /** Concrete commercial/derivative-use evidence for authorized shared
   * inventory. It is required before stock can enter a zero-asset render. */
  authorizationRef?: string;
  /** External generation provenance. These fields are audit data, not proof
   * that a provider call succeeded; an asset only enters production after the
   * adapter has verified a completed task and a concrete output file. */
  providerId?: string;
  providerTaskId?: string;
  idempotencyKey?: string;
  duration: number;
  visualObservations: string[];
  /** Legacy display labels. They are never sufficient to authorize an
   * association-only edit because labels and filenames are not proof that the
   * tenant linked this asset to the current product. */
  userProvidedObservations?: string[];
  /** Server-derived from an exact match between the task product reference and
   * the material provenance written at upload time. This proves association,
   * not visual contents. */
  explicitProductAssociation?: {
    productRef: string;
    basis: 'tenant_task_upload';
    exactTaskProductMatch: true;
  };
  segments: Array<Record<string, unknown>>;
  scriptAnalysis?: MaterialScriptAnalysis;
  /** Auditable retrieval origin. It does not change the visual evidence score. */
  selectionOrigin?: 'task' | 'tenant_library' | 'shared_library' | 'system_graphic';
};

export type ProductionClip = {
  clipId: string;
  /** All edit windows cut from one analyzed scene share this identifier. */
  evidenceShotId: string;
  assetId: string;
  assetName: string;
  type: 'video' | 'image';
  start: number;
  end: number;
  sourceDuration: number;
  observations: string[];
  confidence: number;
  /** Association-only clips remain unreviewed visual evidence even though a
   * safe, fact-free edit may use them. */
  needsReview: boolean;
  evidenceBasis: 'visual_analysis' | 'user_product_association';
  boundaryConfidence?: number;
  cleanEntry?: boolean;
  cleanExit?: boolean;
  actionPeak?: number | null;
  actionStart?: number;
  actionEnd?: number;
  editorialTerms?: string[];
  role?: MaterialScriptRole;
};

export type PlannedProductionScene = {
  sceneId: string;
  baselineSceneIndex: number;
  shotFunction: string;
  subject: string;
  action: string;
  baselineNarration: string;
  narration: string;
  clip: ProductionClip;
  semanticScore: number;
  materialReview?: MaterialSceneReview;
};

export type SocialProductionPlan = {
  ok: boolean;
  reasonCode: 'ready' | 'no_visual_material' | 'material_analysis_required' | 'insufficient_visual_coverage';
  message: string;
  scenes: PlannedProductionScene[];
  selectedAssetIds: string[];
  unusedAssets: Array<{ assetId: string; assetName: string; reason: string }>;
  narrationChanged: boolean;
  maxDuration: number;
  sourceClipSeconds: number;
  averageConfidence: number;
  notes: string[];
  materialLearning?: MaterialReviewBundle;
};

function strings(value: unknown): string[] {
  return [value].flatMap(item => Array.isArray(item) ? item : [item])
    .map(socialText).filter(Boolean);
}

function segmentObservations(segment: Record<string, unknown>): string[] {
  return [segment.observedFacts, segment.action, segment.visual, segment.environment, segment.subject,
    segment.purpose, segment.recommendedFunctions, segment.shot, segment.camera]
    .flatMap(strings).map(value => value.replace(/\s+/g, ' ').slice(0, 240));
}

function identity(asset: SocialProductionAsset): string {
  return asset.contentHash || asset.localPath || asset.objectKey || asset.url || asset.id;
}

function hasExplicitProductAssociation(asset: SocialProductionAsset): boolean {
  return Boolean(asset.explicitProductAssociation?.exactTaskProductMatch
    && asset.explicitProductAssociation.basis === 'tenant_task_upload'
    && socialText(asset.explicitProductAssociation.productRef));
}

function hasTaskUploadAssociation(asset: SocialProductionAsset): boolean {
  return asset.selectionOrigin === 'task' || hasExplicitProductAssociation(asset);
}

function hasLocalTaskWindows(asset: SocialProductionAsset): boolean {
  return asset.selectionOrigin === 'task' && asset.segments.some(segment => (
    socialText(segment.analysisMode) === 'local_distinct_visual_windows'
  ));
}

function trustedClips(asset: SocialProductionAsset): ProductionClip[] {
  if (asset.type === 'image') {
    const observations = asset.visualObservations.map(socialText).filter(Boolean);
    const indexed = asset.scriptAnalysis?.shots[0];
    return observations.length ? [{
      clipId: `${asset.id}:image`, evidenceShotId: `${asset.id}:image`, assetId: asset.id, assetName: asset.name, type: 'image',
      start: 0, end: 0, sourceDuration: 2.8, observations, confidence: 0.85,
      needsReview: false, evidenceBasis: 'visual_analysis',
      ...(indexed ? {
        role: indexed.role,
        editorialTerms: [
          ...(indexed.matchTags || []).filter(tag => tag !== indexed.role),
          ...(indexed.editorial?.subjects || []),
          ...(indexed.editorial?.actions || []),
          ...(indexed.editorial?.environments || []),
          ...(indexed.editorial?.shotLanguage || []),
        ],
      } : {}),
    }] : [];
  }
  if (!Number.isFinite(asset.duration) || asset.duration < 1.5) return [];
  const clips: ProductionClip[] = [];
  for (const [index, segment] of asset.segments.entries()) {
    const start = Number(segment.start ?? segment.startTime);
    const end = Number(segment.end ?? segment.endTime);
    const confidence = Number(segment.confidence ?? (segment.quality !== undefined ? Number(segment.quality) / 100 : 0));
    const observations = segmentObservations(segment);
    if (segment.needsReview === true || !Number.isFinite(confidence) || confidence < 0.6
      || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > asset.duration + 0.05
      || end - start < 1.2 || !observations.length) continue;
    const evidenceShotId = `${asset.id}:${socialText(segment.id) || `segment-${index + 1}`}`;
    const indexed = asset.scriptAnalysis?.shots.find(shot => shot.segmentId === socialText(segment.id))
      || asset.scriptAnalysis?.shots[index];
    const trim = indexed?.editorial?.trim;
    const bounded = (value: unknown, fallback: number) => {
      const parsed = typeof value === 'number' ? value
        : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
      return Number.isFinite(parsed) ? Math.max(start, Math.min(end, parsed)) : fallback;
    };
    const boundaryConfidence = Math.max(0, Math.min(1, Number(trim?.boundaryConfidence ?? segment.boundaryConfidence) || 0));
    const cleanEntry = trim?.cleanEntry ?? segment.cleanEntry === true;
    const cleanExit = trim?.cleanExit ?? segment.cleanExit === true;
    const trustedBoundary = boundaryConfidence >= .6 && cleanEntry && cleanExit;
    const safeStart = trustedBoundary ? bounded(trim?.preferredStartSeconds ?? segment.cleanStart, start) : start;
    const safeEnd = trustedBoundary ? Math.max(safeStart, bounded(trim?.preferredEndSeconds ?? segment.cleanEnd, end)) : end;
    if (safeEnd - safeStart < 1.2) continue;
    // Long analyzed sections are split into independent, non-overlapping edit
    // windows for trim-duration options. They remain one evidence shot and may
    // never satisfy more than one independent-shot requirement.
    const windowCount = Math.max(1, Math.min(4, Math.floor((safeEnd - safeStart) / 1.6)));
    const windowDuration = Math.min(3.5, (safeEnd - safeStart) / windowCount);
    const windowStride = windowCount <= 1 ? 0 : ((safeEnd - safeStart) - windowDuration) / (windowCount - 1);
    const peakValue = trim?.actionPeakSeconds ?? segment.actionPeak;
    const actionPeak = typeof peakValue === 'number' ? peakValue
      : typeof peakValue === 'string' && peakValue.trim() ? Number(peakValue) : Number.NaN;
    const actionStartValue = typeof segment.actionStart === 'number' ? segment.actionStart
      : typeof segment.actionStart === 'string' && segment.actionStart.trim() ? Number(segment.actionStart) : Number.NaN;
    const actionEndValue = typeof segment.actionEnd === 'number' ? segment.actionEnd
      : typeof segment.actionEnd === 'string' && segment.actionEnd.trim() ? Number(segment.actionEnd) : Number.NaN;
    const actionStart = Number.isFinite(actionStartValue) ? bounded(actionStartValue, safeStart) : undefined;
    const actionEnd = Number.isFinite(actionEndValue) && actionStart !== undefined
      ? Math.max(actionStart, bounded(actionEndValue, safeEnd)) : undefined;
    const completeActionStart = actionStart !== undefined && actionEnd !== undefined && actionEnd - actionStart <= windowDuration
      ? Math.max(safeStart, Math.min(actionStart, actionEnd - windowDuration)) : Number.NaN;
    const completeActionEnd = actionStart !== undefined && actionEnd !== undefined && actionEnd - actionStart <= windowDuration
      ? Math.min(actionStart, safeEnd - windowDuration) : Number.NaN;
    const peakStart = Number.isFinite(actionPeak)
      ? Math.max(Number.isFinite(completeActionStart) ? completeActionStart : safeStart,
        Math.min(Number.isFinite(completeActionEnd) ? completeActionEnd : safeEnd - windowDuration, actionPeak - windowDuration / 2))
      : null;
    const windowStarts = [...new Set([
      ...(peakStart === null ? [] : [Number(peakStart.toFixed(3))]),
      ...Array.from({ length: windowCount }, (_, window) => Number((safeStart + window * windowStride).toFixed(3))),
    ])].slice(0, 4);
    for (const [window, clipStart] of windowStarts.entries()) {
      const clipEnd = Math.min(safeEnd, clipStart + windowDuration);
      if (clipEnd - clipStart < 1.2) continue;
      clips.push({
        clipId: `${asset.id}:${index}:${window}`,
        evidenceShotId,
        assetId: asset.id,
        assetName: asset.name,
        type: 'video',
        start: clipStart,
        end: clipEnd,
        sourceDuration: clipEnd - clipStart,
        observations,
        confidence,
        needsReview: false,
        evidenceBasis: 'visual_analysis',
        boundaryConfidence,
        cleanEntry,
        cleanExit,
        actionPeak: Number.isFinite(actionPeak) ? actionPeak : null,
        ...(actionStart !== undefined && actionEnd !== undefined ? { actionStart, actionEnd } : {}),
        ...(indexed ? {
          role: indexed.role,
          editorialTerms: [
            ...(indexed.matchTags || []).filter(tag => tag !== indexed.role),
            ...(indexed.editorial?.subjects || []),
            ...(indexed.editorial?.actions || []),
            ...(indexed.editorial?.environments || []),
            ...(indexed.editorial?.shotLanguage || []),
          ],
        } : {}),
      });
    }
  }
  return clips;
}

/** A task upload or explicit product association can authorize a generic edit
 * when semantic vision is unavailable, but it never becomes a visual
 * observation. Locally verified distinct windows may become separate edit
 * shots; all retain confidence=0 / needsReview=true. */
function associationOnlyClip(asset: SocialProductionAsset): ProductionClip[] {
  if (!hasTaskUploadAssociation(asset)) return [];
  if (asset.type === 'video' && (!Number.isFinite(asset.duration) || asset.duration < 1.5)) return [];
  const locallyDistinct = asset.type === 'video'
    ? asset.segments.flatMap((segment, index) => {
      if (socialText(segment.analysisMode) !== 'local_distinct_visual_windows') return [];
      const start = Number(segment.start ?? segment.startTime);
      const end = Number(segment.end ?? segment.endTime);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0
        || end > asset.duration + 0.05 || end - start < 1.2) return [];
      const segmentId = socialText(segment.segmentId || segment.id) || `local-${index + 1}`;
      return [{
        clipId: `${asset.id}:${segmentId}`,
        evidenceShotId: `${asset.id}:${segmentId}`,
        assetId: asset.id,
        assetName: asset.name,
        type: 'video' as const,
        start,
        end,
        sourceDuration: end - start,
        observations: ['用户为当前任务上传；本地检测确认该区间与其他候选区间画面不同；未经语义视觉模型识别'],
        confidence: 0,
        needsReview: true,
        evidenceBasis: 'user_product_association' as const,
      }];
    }).slice(0, 4)
    : [];
  if (locallyDistinct.length >= 2) return locallyDistinct;
  const sourceDuration = asset.type === 'image' ? 2.8 : Math.min(3.5, asset.duration);
  return [{
    clipId: `${asset.id}:association-only`,
    evidenceShotId: `${asset.id}:association-only`,
    assetId: asset.id,
    assetName: asset.name,
    type: asset.type,
    start: 0,
    end: asset.type === 'image' ? 0 : sourceDuration,
    sourceDuration,
    observations: ['用户明确关联到当前任务产品；未经视觉模型识别'],
    confidence: 0,
    needsReview: true,
    evidenceBasis: 'user_product_association',
  }];
}

function isAssociationSafeBaseline(baseline: StoredSocialScriptBaseline): boolean {
  return baseline.source === 'knowledge_fallback'
    && !baseline.formulaReference
    && !baseline.match?.inspirationReference
    && baseline.match?.userProductAssociation?.basis === 'tenant_task_upload';
}

function sceneOrder(count: number, available: number): number[] {
  if (count <= available) return Array.from({ length: count }, (_, index) => index);
  if (available <= 1) return [0];
  if (available === 2) return [0, count - 1];
  const middleCount = available - 2;
  return [0, ...Array.from({ length: middleCount }, (_, index) => Math.min(count - 2, index + 1)), count - 1];
}

function endsSentence(value: string, language: StoredSocialScriptBaseline['language']): string {
  const clean = value.trim().replace(/[，,;；:\s]+$/g, '');
  if (!clean) return language === 'en' ? 'Only verified information is presented.' : '只呈现真实画面和已确认资料。';
  return /[。！？.!?]$/.test(clean) ? clean : `${clean}${language === 'en' ? '.' : '。'}`;
}

function compactNarration(value: string, seconds: number, language: StoredSocialScriptBaseline['language']): string {
  const clean = socialText(value).replace(/\s+/g, ' ');
  if (language === 'en') {
    const maximum = Math.max(5, Math.floor(seconds * 2.35));
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length <= maximum) return endsSentence(clean, language);
    const clauses = clean.split(/(?<=[,;.!?])\s+/).map(item => item.trim()).filter(Boolean);
    const complete = clauses
      .filter(clause => clause.split(/\s+/).length <= maximum)
      .sort((left, right) => right.split(/\s+/).length - left.split(/\s+/).length)[0];
    return endsSentence(complete || 'Verified information is shown', language);
  }
  const maximum = Math.max(9, Math.floor(seconds * 4.4));
  const characters = [...clean];
  if (characters.length <= maximum) return endsSentence(clean, language);
  const candidates = new Set(clean.split(/[，；。！？]/).map(item => item.trim()).filter(Boolean));
  if (/^本片使用用户明确关联到.+的素材/.test(clean)) candidates.add('使用用户关联素材');
  if (/^以上为.+的已确认资料与用户关联素材/.test(clean)) candidates.add('资料与关联素材展示完毕');
  if (/未经确认的产品事实/.test(clean)) candidates.add('不扩展未经确认的产品事实');
  if (/不推断画面事实/.test(clean)) candidates.add('不推断画面事实');
  const complete = [...candidates]
    .filter(clause => [...clause].length >= 2 && [...clause].length <= maximum)
    .sort((left, right) => [...right].length - [...left].length)[0];
  // Never hand the Director Agent a fragment cut in the middle of a Chinese
  // phrase. When no complete clause fits, keep a short, factual fallback.
  return endsSentence(complete || '只呈现已确认内容', language);
}

function sceneIntent(scene: StoredSocialScriptBaseline['scenes'][number]): string {
  return `${scene.shotFunction} ${scene.subject} ${scene.action}`;
}

/** Pure production gate. It never mutates/deletes the material library: low
 * quality, duplicate and unrelated uploads simply remain unused for this edit. */
export function buildSocialProductionPlan(input: {
  baseline: StoredSocialScriptBaseline;
  assets: SocialProductionAsset[];
  themeId?: SocialContentThemeId | null;
}): SocialProductionPlan {
  const materialPolicy = socialContentMaterialPolicy(input.themeId ?? input.baseline.themeId ?? null);
  if (!input.assets.length) return {
    ok: false, reasonCode: 'no_visual_material',
    message: '没有可读取的图片或视频素材，请至少补充一段清晰实拍视频或两张相关图片。',
    scenes: [], selectedAssetIds: [], unusedAssets: [], narrationChanged: false,
    maxDuration: 0, sourceClipSeconds: 0, averageConfidence: 0, notes: [],
  };
  const seen = new Set<string>();
  const uniqueAssets: SocialProductionAsset[] = [];
  const unusedAssets: SocialProductionPlan['unusedAssets'] = [];
  for (const asset of input.assets) {
    const key = identity(asset);
    if (seen.has(key)) {
      unusedAssets.push({ assetId: asset.id, assetName: asset.name, reason: '与本次已选素材内容重复，原文件仍保留在素材库' });
      continue;
    }
    seen.add(key);
    uniqueAssets.push(asset);
  }
  const taskAssociatedAssetCount = uniqueAssets.filter(hasTaskUploadAssociation).length;
  const associationSafe = isAssociationSafeBaseline(input.baseline)
    // Two independently selected task assets are enough to authorize a
    // generic edit even when the reference vocabulary does not match their
    // visual-analysis wording. The clips retain their real observations and
    // never inherit factual claims from the reference video.
    || taskAssociatedAssetCount >= 2
    || (['system_theme_baseline', 'knowledge_fallback'].includes(input.baseline.source)
      && uniqueAssets.some(hasLocalTaskWindows));
  const clipRows = uniqueAssets.map(asset => {
    const visuallyTrusted = trustedClips(asset);
    return {
      asset,
      clips: visuallyTrusted.length
        ? visuallyTrusted
        : associationSafe ? associationOnlyClip(asset) : [],
    };
  });
  for (const row of clipRows.filter(item => !item.clips.length)) {
    unusedAssets.push({
      assetId: row.asset.id,
      assetName: row.asset.name,
      reason: row.asset.type === 'video' && row.asset.duration < 1.5
        ? '视频有效时长不足 1.5 秒'
        : associationSafe && !hasExplicitProductAssociation(row.asset)
          ? '素材没有与当前任务产品的明确关联，不能进入知识骨架剪辑'
          : '未取得可信的画面分析结果，不能进入自动剪辑',
    });
  }
  const clips = clipRows.flatMap(item => item.clips);
  if (!clips.length) return {
    ok: false, reasonCode: 'material_analysis_required',
    message: '上传素材暂时没有可确认的清晰画面，请重新分析或补充更清晰、与主题相关的素材。',
    scenes: [], selectedAssetIds: [], unusedAssets, narrationChanged: false,
    maxDuration: 0, sourceClipSeconds: 0, averageConfidence: 0, notes: [],
  };

  const relevance = new Map(clips.map(clip => [clip.clipId, Math.max(
    0,
    ...input.baseline.scenes.map(scene => visualEvidenceScore(sceneIntent(scene), [
      ...clip.observations, ...(clip.editorialTerms || []),
    ])),
  )]));
  const associatedAssetIds = new Set(uniqueAssets.filter(hasTaskUploadAssociation).map(asset => asset.id));
  const relevantClips = clips.filter(clip => associationSafe
    ? associatedAssetIds.has(clip.assetId)
    : (relevance.get(clip.clipId) ?? 0) > 0);
  // Association-only production needs two independently evidenced visual
  // windows. They may be separate uploads or locally detected, visually
  // distinct shots inside one complete user video.
  const relevantEvidenceShots = associationSafe
    ? [...new Map(relevantClips.map(clip => [clip.evidenceShotId, clip])).values()]
    : [...new Map(relevantClips.map(clip => [clip.evidenceShotId, clip])).values()];
  for (const row of clipRows.filter(item => item.clips.length
    && item.clips.every(clip => associationSafe
      ? !associatedAssetIds.has(clip.assetId)
      : (relevance.get(clip.clipId) ?? 0) <= 0))) {
    unusedAssets.push({
      assetId: row.asset.id,
      assetName: row.asset.name,
      reason: associationSafe
        ? '素材未明确关联当前任务产品，原文件仍保留在素材库'
        : '画面分析结果与本次主题和脚本镜头不相关，原文件仍保留在素材库',
    });
  }
  if (relevantEvidenceShots.length < 2) return {
    ok: false,
    reasonCode: 'insufficient_visual_coverage',
    message: associationSafe
      ? '至少需要 2 个可区分的真实画面区间；可以来自两份素材，也可以来自一支包含多个真实镜头的完整视频。'
      : `素材中与本次主题和脚本相符的可信镜头不足 2 个，${materialPolicy.insufficientMessage}。`,
    scenes: [], selectedAssetIds: [], unusedAssets, narrationChanged: false,
    maxDuration: 0,
    sourceClipSeconds: relevantEvidenceShots.reduce((sum, clip) => sum + clip.sourceDuration, 0),
    averageConfidence: relevantEvidenceShots.reduce((sum, clip) => sum + clip.confidence, 0) / Math.max(1, relevantEvidenceShots.length),
    notes: associationSafe
      ? ['任务上传或产品关联只证明用户允许本次使用，不代表视觉模型确认了画面语义。', '本地镜头差异检测只确认画面不同；视觉语义置信度保持为 0，且继续标记待复核。']
      : ['独立镜头按真实分析片段计算；同一片段的切窗不会增加镜头数。', '不相关素材仅从本次剪辑中舍弃，不会从素材库删除。'],
  };

  const maximumScenes = input.baseline.source === 'inspiration_script' ? 12 : 4;
  const wanted = Math.min(maximumScenes, input.baseline.scenes.length, relevantEvidenceShots.length);
  const indices = sceneOrder(input.baseline.scenes.length, wanted);
  const remaining = [...relevantClips];
  const assignments = indices.flatMap(sceneIndex => {
    const scene = input.baseline.scenes[sceneIndex]!;
    const ranked = remaining.map((clip, index) => ({
      clip,
      index,
      semanticScore: associationSafe ? 0 : editorialEvidenceScore(
        sceneIntent(scene), clip, clip.sourceDuration, clip.start, clip.end,
      ),
    })).filter(candidate => associationSafe || candidate.semanticScore >= 10).sort((left, right) => associationSafe
      ? left.clip.start - right.clip.start
      : right.semanticScore - left.semanticScore
        || right.clip.confidence - left.clip.confidence
        || right.clip.sourceDuration - left.clip.sourceDuration);
    const selected = ranked[0];
    if (!selected) return [];
    const materialReview = buildMaterialSceneReview({
      sceneId: scene.sceneId,
      intent: sceneIntent(scene),
      selectedClipId: selected.clip.clipId,
      candidates: ranked.slice(0, 5).map(candidate => ({
        type: candidate.clip.type,
        assetId: candidate.clip.assetId,
        clipId: candidate.clip.clipId,
        sourceStart: candidate.clip.start,
        sourceEnd: candidate.clip.end,
        score: candidate.semanticScore,
        analysisConfidence: candidate.clip.confidence,
        boundaryConfidence: candidate.clip.boundaryConfidence ?? 0,
        cleanEntry: candidate.clip.cleanEntry,
        cleanExit: candidate.clip.cleanExit,
        needsReview: candidate.clip.needsReview,
        evidenceBasis: candidate.clip.evidenceBasis,
      })),
    });
    // Evidence-shot ids, rather than asset ids, define independence here.
    // Several trim alternatives from one analyzed shot share an id and are
    // removed together, while locally detected cuts in one complete upload
    // retain separate ids and may each supply one scene.
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (remaining[index]!.evidenceShotId === selected.clip.evidenceShotId) remaining.splice(index, 1);
    }
    return [{ sceneIndex, scene, clip: selected.clip, semanticScore: selected.semanticScore, materialReview }];
  });
  const sourceClipSeconds = assignments.reduce((sum, item) => sum + item.clip.sourceDuration, 0);
  const dynamicSeconds = assignments.filter(item => item.clip.type === 'video')
    .reduce((sum, item) => sum + item.clip.sourceDuration, 0);
  const averageConfidence = assignments.reduce((sum, item) => sum + item.clip.confidence, 0) / Math.max(1, assignments.length);
  const maxDuration = Math.min(20, assignments.reduce((sum, item) => (
    sum + (item.clip.type === 'image' ? 2.8 : item.clip.sourceDuration / 0.82)
  ), 0));
  if (assignments.length < 2 || maxDuration < 5.5 || (!associationSafe && averageConfidence < 0.62)
    || (dynamicSeconds < 2.5 && assignments.filter(item => item.clip.type === 'image').length < 2)) {
    return {
      ok: false,
      reasonCode: 'insufficient_visual_coverage',
      message: associationSafe
        ? `当前只有 ${assignments.length} 个可区分的真实画面区间、约 ${sourceClipSeconds.toFixed(1)} 秒可用时长，达不到制作门槛。`
        : `当前只有 ${assignments.length} 个可信镜头、约 ${sourceClipSeconds.toFixed(1)} 秒有效画面，达不到可交付门槛。${materialPolicy.insufficientMessage}。`,
      scenes: [], selectedAssetIds: [], unusedAssets,
      narrationChanged: false, maxDuration, sourceClipSeconds, averageConfidence,
      notes: associationSafe
        ? ['系统不会删除已上传素材；产品关联不会被伪装成视觉识别或置信度。']
        : ['系统不会删除已上传素材，也不会用文字资料卡或重复末帧凑成品。'],
    };
  }
  const totalWeight = assignments.reduce((sum, item) => sum + (item.clip.type === 'image' ? 2.8 : item.clip.sourceDuration / 0.82), 0);
  const scenes = assignments.map(item => {
    const seconds = Math.max(2.2, maxDuration * (item.clip.type === 'image' ? 2.8 : item.clip.sourceDuration / 0.82) / totalWeight);
    return {
      sceneId: item.scene.sceneId,
      baselineSceneIndex: item.sceneIndex,
      shotFunction: item.scene.shotFunction,
      subject: item.scene.subject,
      action: item.scene.action,
      baselineNarration: item.scene.narration,
      narration: compactNarration(item.scene.narration, seconds, input.baseline.language),
      clip: item.clip,
      semanticScore: item.semanticScore,
      materialReview: item.materialReview,
    };
  });
  const selectedAssetIds = [...new Set(scenes.map(item => item.clip.assetId))];
  for (const asset of uniqueAssets.filter(item => !selectedAssetIds.includes(item.id))) {
    if (!unusedAssets.some(item => item.assetId === asset.id)) {
      unusedAssets.push({ assetId: asset.id, assetName: asset.name, reason: '本次脚本有更清晰或更相关的镜头，素材仍保留供后续任务使用' });
    }
  }
  const narrationChanged = scenes.length !== input.baseline.scenes.length
    || scenes.some(item => item.narration !== item.baselineNarration);
  return {
    ok: true,
    reasonCode: 'ready',
    message: associationSafe
      ? '已按用户明确的当前产品关联生成安全知识骨架；画面内容仍未宣称经过视觉识别。'
      : '素材已按清晰度、重复度和脚本相关性完成筛选。',
    scenes,
    selectedAssetIds,
    unusedAssets,
    narrationChanged,
    maxDuration,
    sourceClipSeconds,
    averageConfidence,
    notes: [
      associationSafe
        ? `本次使用 ${scenes.length} 个可区分真实画面区间（来自 ${selectedAssetIds.length} 份任务素材）；关联证明不等于视觉识别，未选素材不会删除。`
        : `本次只使用 ${selectedAssetIds.length} 份素材中的 ${scenes.length} 个可信镜头，未选素材不会删除。`,
      narrationChanged ? '执行稿仅做删镜和压缩，未添加新的产品事实。' : '执行稿与锁定脚本一致。',
    ],
    materialLearning: materialReviewBundle(scenes.flatMap(scene => scene.materialReview ? [scene.materialReview] : [])),
  };
}

export function buildPlannedSceneTimingCues(
  scenes: PlannedProductionScene[],
  duration: number,
): Array<{ start: number; end: number; text: string }> {
  const weights = scenes.map(scene => Math.max(1, scene.clip.type === 'image' ? 2.8 : scene.clip.sourceDuration / 0.82));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let elapsed = 0;
  return scenes.map((scene, index) => {
    const start = elapsed;
    elapsed = index === scenes.length - 1 ? duration : Math.min(duration, elapsed + duration * weights[index]! / total);
    return { start, end: elapsed, text: scene.narration };
  });
}

export function buildPlannedTimeline(input: {
  plan: SocialProductionPlan;
  assets: SocialProductionAsset[];
  duration: number;
}) {
  if (!input.plan.ok) throw new Error(input.plan.message);
  const byId = new Map(input.assets.map(asset => [asset.id, asset]));
  const cues = buildPlannedSceneTimingCues(input.plan.scenes, input.duration);
  return input.plan.scenes.map((scene, index) => {
    const asset = byId.get(scene.clip.assetId);
    if (!asset) throw new Error(`生产计划引用的素材不存在：${scene.clip.assetId}`);
    const targetStart = cues[index]!.start;
    const targetEnd = cues[index]!.end;
    const targetDuration = Math.max(0.5, targetEnd - targetStart);
    if (asset.type === 'image') {
      if (targetDuration > 4.2) throw new Error('production_input_required:单张图片停留时间过长，请补充动态素材或缩短脚本');
      return { name: asset.name, type: 'image' as const, url: asset.url, targetStart, targetEnd, targetDuration };
    }
    const availableSourceDuration = scene.clip.end - scene.clip.start;
    // A shorter spoken scene may take a shorter sub-range from the verified
    // clip. A longer spoken scene may slow the clip by at most 20%; it may not
    // clone the last frame or loop the same interval.
    const sourceDuration = Math.min(availableSourceDuration, targetDuration * 1.1);
    const speed = sourceDuration / targetDuration;
    if (!Number.isFinite(speed) || speed < 0.8 || speed > 1.25) {
      throw new Error('production_input_required:实际口播时长与可信素材覆盖不匹配，请补充素材或缩短脚本');
    }
    return {
      name: asset.name,
      type: 'video' as const,
      url: asset.url,
      trimStart: scene.clip.start,
      trimEnd: scene.clip.start + sourceDuration,
      speed,
      targetStart,
      targetEnd,
      targetDuration,
    };
  });
}
