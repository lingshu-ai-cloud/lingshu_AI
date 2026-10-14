import { useEffect, useRef } from 'react';
import type { VideoKickoff } from '../AiCreateStudio';
import type {
  SocialAccountPresenterLock,
  SocialContentTaskDetail,
  SocialReferenceVideoAnalysis,
} from '../../../shared/contracts/socialContentWorkflow';
import {
  normalizeBenchmarkAnalysisSnapshot,
  type BenchmarkAnalysis,
} from '../../../shared/benchmarkAnalysis';
import { socialContentApi } from '../../lib/socialContentApi';
import { localReferenceMediaUrl } from '../studio/studioReferenceMedia';
import { AUTH_TOKEN_CHANGED_EVENT, getToken } from '../../lib/auth';
import { readCurrentStudioSocialTask } from '../../lib/studioSocialTaskRead';

export type StudioContentTheme = 'product_proof' | 'use_case' | 'supplier_capability' | 'customization' | 'customer_case';

export interface StudioSocialTaskSeed {
  projectTitle: string;
  productReference: string;
  contentMode: 'video' | 'poster';
  creationMode: 'material' | 'product' | 'clone';
  reference: VideoKickoff | null;
  platform: string;
  aspectRatio: string;
  languageCodes: string[];
  productInfo: string;
  audience: string;
  primaryCta: string;
  sellingPoints: string;
  contentTheme: StudioContentTheme | null;
  /** Free-form customer wording that should guide the generated story, not replace verified product facts. */
  themeTopic: string;
  factVerificationNotice: string;
  selectedMaterialIds: string[];
  /** Ordered IDs from the approved task script. Studio binds materials and
   * presenter plans to these production shots, not to reference-shot IDs. */
  sourceShotIds: string[];
  shotMaterialBindings: StudioSocialShotMaterialBinding[];
  unsupportedLanguages: string[];
  digitalHumanShotPlans: Array<{
    shotId: string;
    shotIndex: number;
    requestedDescription: string;
    workflow: 'material_processing' | 'viral_replication';
    method: 'talking' | 'replace' | 'reenact';
    presenterAssetIds: string[];
    referenceMaterialIds: string[];
    referenceRequired: boolean;
    candidateTools: string[];
    executionState: 'needs_presenter' | 'needs_confirmation' | 'preview_only' | 'ready_for_capability_check';
    accountPresenterLock: SocialAccountPresenterLock | null;
    sourceTaskId: string;
    sourceTaskVersion: string;
  }>;
  /** Read-only evidence already produced by the task. This powers the Agent-entry demo view. */
  productionPreview: StudioSocialTaskProductionPreview;
}

export interface StudioSocialTaskProductionPreview {
  deliverableVideoUrl: string;
  coverUrl: string;
  narrationLines: Array<{
    text: string;
    startSeconds: number;
    endSeconds: number;
  }>;
  shots: Array<{
    shotId: string;
    startSeconds: number;
    endSeconds: number;
    visual: string;
    spokenText: string;
    audioDescription: string;
  }>;
  audio: {
    embeddedInDeliverable: boolean;
    technicalCheckPassed: boolean | null;
    bgmMood: string;
  };
}

export interface StudioSocialShotMaterialBinding {
  /** Stable task shot identity. `shotIndex` is retained only for historic
   * tasks whose Studio storyboard predates shot IDs. */
  shotId: string;
  shotIndex: number;
  materialId: string;
}

const STUDIO_THEME_BY_SOCIAL_THEME = {
  product_value: 'product_proof',
  scenario_solution: 'use_case',
  supplier_capability: 'supplier_capability',
  customization_process: 'customization',
  customer_case: 'customer_case',
} as const satisfies Record<NonNullable<NonNullable<SocialContentTaskDetail['theme']>['themeId']>, StudioContentTheme>;

export function socialThemeToStudioTheme(task: Pick<SocialContentTaskDetail, 'theme'>): StudioContentTheme | null {
  const themeId = task.theme?.themeId;
  return themeId ? STUDIO_THEME_BY_SOCIAL_THEME[themeId] : null;
}

const LANGUAGE_CODES: Record<string, string> = {
  english: 'en', 英语: 'en', en: 'en', chinese: 'zh', 中文: 'zh', 简体中文: 'zh', zh: 'zh',
  spanish: 'es', 西班牙语: 'es', 西语: 'es', es: 'es', french: 'fr', 法语: 'fr', fr: 'fr',
  german: 'de', 德语: 'de', de: 'de', portuguese: 'pt', 葡萄牙语: 'pt', 葡语: 'pt', pt: 'pt',
  italian: 'it', 意大利语: 'it', it: 'it', russian: 'ru', 俄语: 'ru', ru: 'ru',
  japanese: 'ja', 日语: 'ja', ja: 'ja', korean: 'ko', 韩语: 'ko', ko: 'ko',
  arabic: 'ar', 阿拉伯语: 'ar', 阿语: 'ar', ar: 'ar', hindi: 'hi', 印地语: 'hi', hi: 'hi',
  indonesian: 'id', 印度尼西亚语: 'id', 印尼语: 'id', id: 'id', thai: 'th', 泰语: 'th', th: 'th',
  vietnamese: 'vi', 越南语: 'vi', vi: 'vi', turkish: 'tr', 土耳其语: 'tr', tr: 'tr',
  dutch: 'nl', 荷兰语: 'nl', nl: 'nl', polish: 'pl', 波兰语: 'pl', pl: 'pl',
};

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function materialId(sourceRef: string): string | null {
  const token = /^socialmaterial:([a-zA-Z0-9_-]+)$/.exec(sourceRef)?.[1];
  if (!token || typeof globalThis.atob !== 'function') return null;
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(token.length / 4) * 4, '=');
    const bytes = Uint8Array.from(globalThis.atob(padded), character => character.charCodeAt(0));
    const id = new TextDecoder().decode(bytes).trim();
    return /^[a-zA-Z0-9._:-]{1,200}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function languageCode(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return LANGUAGE_CODES[value.trim()] || LANGUAGE_CODES[normalized] || null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finite(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function missingCanonicalBenchmark(
  analysis: SocialReferenceVideoAnalysis,
  reason = '社媒任务缺少规范逐镜快照，请回到灵感中心补充或重新分析参考视频',
): BenchmarkAnalysis {
  const shots: BenchmarkAnalysis['shots'] = (analysis.shots ?? []).map((shot, offset) => {
    const start = typeof shot.startSeconds === 'number' && Number.isFinite(shot.startSeconds) && shot.startSeconds >= 0
      ? shot.startSeconds : null;
    const end = start !== null && typeof shot.endSeconds === 'number' && Number.isFinite(shot.endSeconds) && shot.endSeconds > start
      ? shot.endSeconds : null;
    return {
      shotId: clean(shot.shotId) || `social-shot-${offset + 1}`,
      index: offset + 1,
      time: start !== null && end !== null ? `${start}-${end}s` : '',
      start,
      end,
      materialType: 'unknown',
      narrativeRole: 'unknown',
      classificationSource: 'missing',
      classificationEvidence: '',
      visual: clean(shot.visualDescription),
      dialogue: clean(shot.spokenText),
      onScreenText: clean(shot.captionText),
      purpose: '',
      firstFrameRef: null,
      clipRef: null,
      needsReview: true,
      granularity: 'observation_window',
      environment: '',
      framing: '',
      camera: '',
      audio: clean(shot.audioDescription),
      authenticity: '',
      effectivenessHypothesis: '',
      detailedAnalysis: {},
    };
  });
  return {
    schemaVersion: 1,
    source: {
      videoId: clean(analysis.referenceRecordId) || clean(analysis.referenceSourceId),
      analysisRunId: clean(analysis.analysisId) || null,
      evidenceRevision: clean(analysis.version) || null,
      correctionVersion: 0,
      analyzedAt: clean(analysis.createdAt) || null,
      analysisMode: 'missing_canonical_snapshot',
    },
    status: 'pending',
    gaps: [reason],
    hookShotId: null,
    shots,
    totalShots: null,
    timelineComplete: false,
    materialCounts: {
      talking_head: 0, factory: 0, product: 0, consumer_demo: 0, general: 0, unknown: shots.length,
    },
    structure: [],
    speechGroups: [],
  };
}

/** Canonical bridge between the social task and Studio. A malformed supplied
 * snapshot is never allowed to fall through to Studio's permissive timeline
 * compatibility check. */
export function socialTaskBenchmarkAnalysis(
  analysis: SocialReferenceVideoAnalysis | null | undefined,
): BenchmarkAnalysis | undefined {
  if (!analysis) return undefined;
  if (analysis.benchmarkAnalysis !== undefined) {
    const normalized = normalizeBenchmarkAnalysisSnapshot(analysis.benchmarkAnalysis);
    if (normalized) return normalized;
    return missingCanonicalBenchmark(analysis, '社媒任务携带的规范逐镜快照无效，请重新分析参考视频');
  }
  return missingCanonicalBenchmark(analysis);
}

/**
 * Project only persisted task evidence into the demo surface. It deliberately
 * does not manufacture TTS URLs: completed task audio is played from the real
 * deliverable when the pipeline stored it as an embedded track.
 */
export function socialTaskProductionPreview(task: SocialContentTaskDetail): StudioSocialTaskProductionPreview {
  const narrationLines = (task.replicationScript?.narrationLines || []).flatMap(line => {
    const text = clean(line.draftText) || clean(line.referenceText);
    return text ? [{ text, startSeconds: finite(line.sourceStartSeconds), endSeconds: finite(line.sourceEndSeconds) }] : [];
  });
  const shots = (task.referenceVideoAnalysis?.shots || []).map(shot => ({
    shotId: clean(shot.shotId),
    startSeconds: finite(shot.startSeconds),
    endSeconds: finite(shot.endSeconds),
    visual: clean(shot.visualDescription),
    spokenText: clean(shot.spokenText),
    audioDescription: clean(shot.audioDescription),
  }));
  const artifact = [...task.artifacts].reverse().find(item => item.kind === 'short_video' || item.kind === 'long_video');
  const content = record(artifact?.content);
  const mediaStorage = record(content?.mediaStorage);
  const video = record(mediaStorage?.video);
  const cover = record(mediaStorage?.cover);
  const technicalQuality = record(content?.technicalQualityReport);
  const technicalAudio = record(technicalQuality?.audio);
  const render = record(content?.render);
  const bgm = record(render?.bgm);
  return {
    deliverableVideoUrl: clean(video?.url),
    coverUrl: clean(cover?.url),
    narrationLines,
    shots,
    audio: {
      embeddedInDeliverable: Boolean(clean(video?.url)) && technicalAudio?.ok === true,
      technicalCheckPassed: typeof technicalAudio?.ok === 'boolean' ? technicalAudio.ok : null,
      bgmMood: clean(bgm?.mood),
    },
  };
}

export function socialTaskShotMaterialBindings(
  task: Pick<SocialContentTaskDetail, 'shotMaterialMap'>,
): StudioSocialShotMaterialBinding[] {
  return (task.shotMaterialMap || []).flatMap((shot, shotIndex) => {
    const materialId = [
      ...shot.customerAssetIds,
      ...shot.generatedAssetIds,
      ...shot.licensedAssetIds,
    ].map(clean).find(Boolean);
    return materialId ? [{ shotId: clean(shot.shotId), shotIndex, materialId }] : [];
  });
}

export function socialTaskStudioShotIds(
  task: Pick<SocialContentTaskDetail, 'replicationScript' | 'assetSupplyPlan' | 'shotMaterialMap'>,
): string[] {
  const candidates = [
    task.replicationScript?.shots?.map(shot => clean(shot.shotId)),
    task.assetSupplyPlan?.shots?.map(shot => clean(shot.shotId)),
    task.shotMaterialMap?.map(shot => clean(shot.shotId)),
  ];
  return candidates.find(ids => ids?.length && ids.every(Boolean)) || [];
}

export function socialTaskReferenceKickoff(task: SocialContentTaskDetail): VideoKickoff | null {
  if (task.brief.creationMode !== 'viral_replication') return null;
  const analysis = task.referenceVideoAnalysis;
  const source = analysis?.referenceSourceId
    ? task.sources.find(item => item.status === 'active' && item.sourceId === analysis.referenceSourceId)
    : task.sources.find(item => item.status === 'active' && item.kind === 'reference_link');
  if (!source) return null;
  const replication = task.replicationScript as (typeof task.replicationScript & {
    narrationSourceStatus?: 'asr_aligned' | 'missing_source_asr';
    narrationLines?: Array<{ lineId: string; referenceText: string; draftText: string; sourceStartSeconds: number; sourceEndSeconds: number; narrationOwnerShotId: string; visualShotIds: string[] }>;
  }) | null | undefined;
  const narrationLines = replication?.narrationLines || [];
  const storedReferenceUrl = analysis?.referenceRecordId
    ? localReferenceMediaUrl(`local://${analysis.referenceRecordId}`) : '';
  const benchmarkAnalysis = socialTaskBenchmarkAnalysis(analysis);
  return {
    source: 'inspiration_analysis', scriptType: 'storyboard',
    video: { title: source.label, sourceUrl: source.sourceRef, referenceRecordId: analysis?.referenceRecordId || undefined,
      videoUrl: storedReferenceUrl || localReferenceMediaUrl(source.sourceRef) || undefined,
      contentFormat: 'video', duration: analysis?.durationSeconds || undefined },
    ...(analysis?.status === 'ready' ? { referenceAnalysis: { title: source.label,
      ...(benchmarkAnalysis ? { benchmarkAnalysis } : {}),
      narrationProducts: analysis.narrationProducts, narrationBrands: analysis.narrationBrands,
      narrationSourceStatus: replication?.narrationSourceStatus || 'missing_source_asr',
      details: analysis.shots.map(shot => ({
      shotId: `replication-${shot.shotId}`,
      time: `${shot.startSeconds}-${shot.endSeconds}s`, shot: shot.visualDescription, camera: shot.shotLanguage?.movement || '',
      visual: shot.visualDescription, dialogue: shot.spokenText || '', subtitle: shot.captionText || '', audio: shot.audioDescription || '',
      purpose: shot.purpose || undefined,
      personContinuityId: shot.personContinuityId || undefined,
      observedPresenterRole: shot.observedPresenterRole,
      firstFrameRef: shot.materialEvidence?.firstFrameRef || undefined,
      firstFrameSeconds: shot.materialEvidence?.firstFrameSeconds ?? shot.startSeconds,
      speechLines: narrationLines.filter(line => line.visualShotIds?.includes(`replication-${shot.shotId}`)
        || line.narrationOwnerShotId === `replication-${shot.shotId}`),
    })) } } : {}),
  };
}

export function socialTaskToStudioSeed(task: SocialContentTaskDetail): StudioSocialTaskSeed {
  const brief = task.brief;
  const contentMode = brief.creationMode === 'viral_replication' || brief.formats.some(format => format === 'short_video' || format === 'long_video') ? 'video' : 'poster';
  const languagePairs = brief.languages.map(language => ({ language, code: languageCode(language) }));
  const languageCodes = [...new Set(languagePairs.map(item => item.code).filter((code): code is string => Boolean(code)))];
  const selectedMaterialIds = [...new Set(task.sources
    .filter(source => source.status === 'active' && source.kind === 'material')
    .map(source => materialId(source.sourceRef))
    .filter((id): id is string => Boolean(id)))];
  const pendingFacts = [
    brief.productRef ? `产品引用“${brief.productRef}”` : '',
    brief.brandNotes ? '任务备注' : '',
  ].filter(Boolean);
  const digitalHumanShotPlans = (task.assetSupplyPlan?.shots ?? []).flatMap((shot, shotIndex) => shot.digitalHumanPlan ? [{
    shotId: shot.shotId,
    shotIndex,
    requestedDescription: clean(shot.requestedDescription),
    ...shot.digitalHumanPlan,
    presenterAssetIds: [...shot.digitalHumanPlan.presenterAssetIds],
    referenceMaterialIds: [...shot.digitalHumanPlan.referenceMaterialIds],
    candidateTools: [...shot.digitalHumanPlan.candidateTools],
    accountPresenterLock: shot.digitalHumanPlan.accountPresenterLock ?? null,
    sourceTaskId: task.taskId,
    sourceTaskVersion: task.version,
  }] : []);
  return {
    projectTitle: clean(brief.title) || '社媒内容任务',
    productReference: clean(brief.productRef),
    contentMode,
    creationMode: brief.creationMode === 'viral_replication' ? 'clone' : selectedMaterialIds.length ? 'material' : 'product',
    reference: socialTaskReferenceKickoff(task),
    platform: clean(brief.platforms[0]).toLowerCase() || (contentMode === 'poster' ? 'facebook' : 'tiktok'),
    aspectRatio: clean(brief.aspectRatio) || (contentMode === 'poster' ? '1:1' : '9:16'),
    languageCodes: languageCodes.length ? languageCodes : ['zh'],
    // Brief productRef/brandNotes are request free text, not confirmed facts.
    // Studio will hydrate its product input only from the tenant enterprise profile.
    productInfo: '',
    audience: [clean(brief.audience), brief.markets.length ? `目标市场：${brief.markets.join('、')}` : ''].filter(Boolean).join('；'),
    primaryCta: clean(brief.callToAction),
    sellingPoints: '',
    contentTheme: socialThemeToStudioTheme(task),
    themeTopic: task.theme?.inputKind === 'custom' ? clean(task.theme.topic) : '',
    factVerificationNotice: pendingFacts.length
      ? `${pendingFacts.join('和')}未作为已确认企业事实导入；请在企业中心选择并核对产品资料后再生成。`
      : '',
    selectedMaterialIds,
    sourceShotIds: socialTaskStudioShotIds(task),
    shotMaterialBindings: socialTaskShotMaterialBindings(task),
    unsupportedLanguages: languagePairs.filter(item => !item.code).map(item => item.language),
    digitalHumanShotPlans,
    productionPreview: socialTaskProductionPreview(task),
  };
}

export function useStudioSocialTaskHydration(input: {
  taskId?: string | null;
  canApply: () => boolean;
  onHydrate: (seed: StudioSocialTaskSeed) => void;
  onRefresh?: (task: SocialContentTaskDetail) => void;
}): void {
  const refreshRef = useRef(input.onRefresh);
  refreshRef.current = input.onRefresh;
  const canApplyRef = useRef(input.canApply);
  const onHydrateRef = useRef(input.onHydrate);
  canApplyRef.current = input.canApply;
  onHydrateRef.current = input.onHydrate;

  useEffect(() => {
    const taskId = input.taskId?.trim();
    if (!taskId) return;
    const controller = new AbortController();
    const token = getToken();
    const invalidate = () => controller.abort();
    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, invalidate);
    window.addEventListener('storage', invalidate);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        await readCurrentStudioSocialTask(taskId,
          () => socialContentApi.getTask(taskId, controller.signal),
          () => !controller.signal.aborted && getToken() === token,
          task => {
            if (canApplyRef.current()) onHydrateRef.current(socialTaskToStudioSeed(task));
            refreshRef.current?.(task);
          });
      } catch { /* Preserve the loaded editor during a temporary read failure. */ }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 8000);
    };
    void refresh();
    return () => {
      controller.abort(); clearTimeout(timer);
      window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, invalidate);
      window.removeEventListener('storage', invalidate);
    };
  }, [input.taskId]);
}
