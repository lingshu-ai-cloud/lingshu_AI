import type {
  SocialContentThemeId,
  SocialDirectorPlanSummary,
} from '../../shared/contracts/socialContentWorkflow.js';
import type { InternalSocialContentFormula } from './socialContentThemes.js';
import type { SocialProductionAsset, SocialProductionPlan } from './socialContentProductionPlan.js';
import type { StoredSocialScriptBaseline } from './socialContentScriptBaseline.js';
import {
  SocialContentWorkflowError,
  socialJson,
  socialObject,
  socialRequestHash,
  socialText,
} from './socialContentValidation.js';

export const SOCIAL_DIRECTOR_PLAN_SCHEMA = 'social-content-director-plan.v2';
const LEGACY_DIRECTOR_PLAN_SCHEMA = 'social-content-director-plan.v1';

export type SocialDirectorPace = 'fast' | 'balanced' | 'steady';
export type SocialDirectorQualityGateStatus = 'passed' | 'warning' | 'blocked';

export interface SocialDirectorBgmTrack {
  trackId: string;
  name: string;
  mood: string;
  authorization: {
    status: 'authorized';
    basis: 'lingshu_builtin_library' | 'mixkit_free_license' | 'tenant_uploaded_warranty';
    license: string;
    evidence: string;
  };
}

export interface SocialDirectorBgmSelection {
  primary: SocialDirectorBgmTrack;
  fallbacks: SocialDirectorBgmTrack[];
  fallbackPolicy: 'ordered_preapproved_tracks_only';
  volume: number;
}

export interface SocialDirectorOutputSpec {
  aspectRatio: string;
  resolution: '720p';
  platform: string;
  language: 'zh' | 'en';
  targetDurationSeconds: number;
  maximumDurationSeconds: number;
  voiceVolume: number;
}

export interface StoredSocialDirectorPlan {
  schemaVersion: typeof SOCIAL_DIRECTOR_PLAN_SCHEMA;
  directorPlanId: string;
  version: string;
  status: 'ready' | 'blocked';
  lockStatus: 'locked' | 'blocked';
  lockedAt: string | null;
  createdAt: string;
  createdBy: 'director_agent';
  revision: {
    kind: 'initial' | 'voiceover_fit';
    previousVersion: string | null;
    reasonCode: 'initial_lock' | 'voiceover_exceeds_material';
    measuredDurationSeconds: number | null;
    targetDurationSeconds: number;
  };
  themeId: SocialContentThemeId | null;
  language: 'zh' | 'en';
  scriptSource: {
    kind: StoredSocialScriptBaseline['source'];
    baselineVersion: string;
    formulaReference: { formulaId: string; version: string } | null;
    inspirationReference: { recordId: string; confidence: number } | null;
    referenceSource?: {
      sourceId: string;
      sourceRef: string;
      sourceVersion: string | null;
    } | null;
    matchConfidence: number;
    verifiedKnowledgeSource: 'enterprise_product' | 'enterprise_profile' | 'user_product_association' | 'none';
  };
  direction: {
    targetDurationSeconds: number;
    pace: SocialDirectorPace;
    music: { mood: string; volume: number };
    voiceover: {
      voice: string;
      preset: 'tiktok_excited' | 'authentic_review' | 'professional_b2b' | 'warm_story' | 'urgent_cta';
      speed: number;
      pauseStyle: 'few' | 'natural' | 'dramatic';
    };
    subtitles: {
      mode: 'director_locked';
      fontScale: number;
      bottomRatio: number;
    };
  };
  outputSpec: SocialDirectorOutputSpec;
  bgmSelection: SocialDirectorBgmSelection;
  materialSnapshot: Array<{
    assetId: string;
    sourceId: string;
    sourceVersion: string | null;
    assetName: string;
    type: 'video' | 'image';
    durationSeconds: number;
    contentHash: string;
    hashKind: 'content_sha256' | 'reference_sha256';
    cloudRecordId: string | null;
    objectKey: string | null;
    renderUrl: string;
    availability: 'available_at_lock';
    selectionOrigin?: SocialProductionAsset['selectionOrigin'];
    clips: Array<{
      clipId: string;
      sourceStart: number;
      sourceEnd: number;
      confidence: number;
      observations: string[];
    }>;
  }>;
  scenes: Array<{
    sceneId: string;
    order: number;
    /** Safe timing/camera grammar copied from this task's analyzed reference
     * video. Original dialogue, brand and identity never enter this object. */
    referenceStructure?: NonNullable<StoredSocialScriptBaseline['scenes'][number]['referenceStructure']>;
    script: {
      text: string;
      shotFunction: string;
      subject: string;
      action: string;
    };
    voiceover: string;
    caption: string;
    shotPlan: {
      clipId: string;
      assetId: string;
      assetName: string;
      type: 'video' | 'image';
      sourceStart: number;
      sourceEnd: number;
      confidence: number;
      semanticScore: number;
    };
    materialMapping: {
      sourceAssetId: string;
      observations: string[];
      adaptation: 'none' | 'trim_only' | 'trim_and_duration_fit';
    };
  }>;
  coverIntent: {
    sceneId: string;
    assetId: string;
    sourceTimestampSeconds: number;
    framePosition: 'scene_midpoint';
    purpose: string;
  };
  selectedAssetIds: string[];
  unusedAssets: Array<{ assetId: string; assetName: string; reason: string }>;
  optionalReshootSuggestions: string[];
  qualityGates: Array<{
    gateId: 'script_grounding' | 'material_coverage' | 'material_confidence' | 'content_agent_lock';
    status: SocialDirectorQualityGateStatus;
    message: string;
  }>;
  contentAgentHandoff: {
    scriptLocked: true;
    creativeFieldsLocked: ['timeline', 'voiceover', 'subtitles', 'output_spec', 'bgm', 'cover'];
    allowedAdaptations: ['execute_locked_timeline', 'ordered_bgm_fallback'];
    forbiddenActions: ['rewrite_script', 'invent_product_facts', 'replace_real_material_with_text_cards', 'select_unplanned_bgm', 'change_output_spec'];
  };
  lineageHash: string;
}

export interface SocialDirectorContentHandoff {
  directorPlanId: string;
  planVersion: string;
  lockStatus: 'locked';
  lineageHash: string;
  narration: string;
  direction: StoredSocialDirectorPlan['direction'];
  outputSpec: SocialDirectorOutputSpec;
  bgmSelection: SocialDirectorBgmSelection;
  coverIntent: StoredSocialDirectorPlan['coverIntent'];
  scenes: Array<{
    sceneId: string;
    order: number;
    script: StoredSocialDirectorPlan['scenes'][number]['script'];
    voiceover: string;
    caption: string;
    source: {
      assetId: string;
      sourceId: string;
      assetName: string;
      type: 'video' | 'image';
      renderUrl: string;
      contentHash: string;
      clipId: string;
      sourceStart: number;
      sourceEnd: number;
    };
  }>;
  rules: StoredSocialDirectorPlan['contentAgentHandoff'];
  handoffHash: string;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundSeconds(value: number): number {
  return Number(Math.max(0, value).toFixed(3));
}

function nextVersion(previous: StoredSocialDirectorPlan | null | undefined): string {
  const version = Number(previous?.version);
  return Number.isSafeInteger(version) && version > 0 ? String(version + 1) : '1';
}

function stableDirectorPlanId(taskId: string): string {
  const id = socialText(taskId);
  if (!id) throw new SocialContentWorkflowError('social_content_director_plan_identity_invalid', 503);
  return `director_plan_${socialRequestHash({ scope: 'social_content_task', taskId: id }).slice(0, 24)}`;
}

function directionFor(input: {
  formula?: InternalSocialContentFormula | null;
  themeId: SocialContentThemeId | null;
  duration: number;
}): StoredSocialDirectorPlan['direction'] {
  const configured = input.formula?.direction;
  const defaultPace: SocialDirectorPace = input.themeId === 'supplier_capability' ? 'steady' : 'balanced';
  const defaultVoicePreset = input.themeId === 'product_value' ? 'authentic_review' : 'professional_b2b';
  const defaultVoiceSpeed = input.themeId === 'product_value' ? 1.02 : 1.08;
  const defaultMood = input.themeId === 'supplier_capability'
    ? '稳重、可信、商务'
    : input.themeId === 'customer_case'
      ? '温暖、克制、可信'
      : '清晰、轻快、专业';
  return {
    targetDurationSeconds: roundSeconds(input.duration),
    pace: configured?.pace ?? defaultPace,
    music: {
      mood: socialText(configured?.music?.mood) || defaultMood,
      volume: clamp(Number(configured?.music?.volume ?? 18), 0, 100),
    },
    voiceover: {
      voice: socialText(configured?.voiceover?.voice) || 'v1',
      preset: configured?.voiceover?.preset ?? defaultVoicePreset,
      speed: clamp(Number(configured?.voiceover?.speed ?? defaultVoiceSpeed), 0.75, 1.5),
      pauseStyle: configured?.voiceover?.pauseStyle ?? 'natural',
    },
    subtitles: {
      mode: 'director_locked',
      fontScale: clamp(Number(configured?.subtitles?.fontScale ?? 1), 0.75, 1.5),
      bottomRatio: clamp(Number(configured?.subtitles?.bottomRatio ?? 0.18), 0.08, 0.35),
    },
  };
}

function reshootSuggestions(plan: SocialProductionPlan): string[] {
  const suggestions: string[] = [];
  if (plan.scenes.length < 3) suggestions.push('可选补拍：增加一个与主题直接相关的动态近景，便于丰富镜头节奏。');
  if (plan.averageConfidence < 0.78) suggestions.push('可选补拍：在光线稳定、主体清晰的环境中补充一段 3–5 秒实拍。');
  if (plan.unusedAssets.some(asset => /不相关/.test(asset.reason))) {
    suggestions.push('可选补拍：补充与本次主题一致的产品、使用过程或生产现场画面。');
  }
  return suggestions.slice(0, 3);
}

function sameSpokenContent(left: string, right: string): boolean {
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[\s，,。.!！?？；;：:、]/g, '');
  return normalize(left) === normalize(right);
}

function materialSnapshots(input: {
  assets: SocialProductionAsset[];
  plan: SocialProductionPlan;
  sourceVersions?: Record<string, string>;
}): StoredSocialDirectorPlan['materialSnapshot'] {
  const byId = new Map(input.assets.map(asset => [asset.id, asset]));
  return input.plan.selectedAssetIds.map(assetId => {
    const asset = byId.get(assetId);
    if (!asset || !socialText(asset.url)) {
      throw new SocialContentWorkflowError('social_content_director_plan_material_snapshot_invalid', 503);
    }
    const contentHash = /^[a-f0-9]{64}$/i.test(socialText(asset.contentHash))
      ? socialText(asset.contentHash).toLocaleLowerCase()
      : socialRequestHash({
          assetId: asset.id,
          sourceId: asset.sourceId,
          cloudRecordId: asset.cloudRecordId ?? null,
          objectKey: asset.objectKey ?? null,
          duration: roundSeconds(asset.duration),
        });
    const clips = input.plan.scenes.filter(scene => scene.clip.assetId === assetId).map(scene => ({
      clipId: scene.clip.clipId,
      sourceStart: roundSeconds(scene.clip.start),
      sourceEnd: roundSeconds(scene.clip.end),
      confidence: Number(scene.clip.confidence.toFixed(4)),
      observations: [...scene.clip.observations],
    }));
    if (!clips.length) throw new SocialContentWorkflowError('social_content_director_plan_material_snapshot_invalid', 503);
    return {
      assetId: asset.id,
      sourceId: asset.sourceId,
      sourceVersion: socialText(input.sourceVersions?.[asset.sourceId]) || null,
      assetName: asset.name,
      type: asset.type,
      durationSeconds: roundSeconds(asset.duration),
      contentHash,
      hashKind: /^[a-f0-9]{64}$/i.test(socialText(asset.contentHash))
        ? 'content_sha256' as const
        : 'reference_sha256' as const,
      cloudRecordId: socialText(asset.cloudRecordId) || null,
      objectKey: socialText(asset.objectKey) || null,
      renderUrl: asset.url,
      availability: 'available_at_lock' as const,
      ...(asset.selectionOrigin ? { selectionOrigin: asset.selectionOrigin } : {}),
      clips,
    };
  });
}

function directorPlanPayload(plan: StoredSocialDirectorPlan): Omit<StoredSocialDirectorPlan, 'lineageHash'> {
  const { lineageHash: _lineageHash, ...payload } = plan;
  return payload;
}

function withDirectorPlanHash(plan: Omit<StoredSocialDirectorPlan, 'lineageHash'>): StoredSocialDirectorPlan {
  return { ...plan, lineageHash: socialRequestHash(plan) };
}

function assertDirectorPlanIntegrity(plan: StoredSocialDirectorPlan): void {
  if (socialRequestHash(directorPlanPayload(plan)) !== plan.lineageHash) {
    throw new SocialContentWorkflowError('social_content_director_plan_lineage_invalid', 503);
  }
}

/** Director Agent output: all creative decisions and source revisions are
 * locked before Content Agent can execute anything. */
export function buildSocialDirectorPlan(input: {
  taskId: string;
  baseline: StoredSocialScriptBaseline;
  productionPlan: SocialProductionPlan;
  productionAssets: SocialProductionAsset[];
  sourceVersions?: Record<string, string>;
  outputSpec: { aspectRatio?: string | null; resolution?: '720p'; platform?: string | null };
  bgmSelection: SocialDirectorBgmSelection;
  formula?: InternalSocialContentFormula | null;
  createdAt: string;
  previous?: StoredSocialDirectorPlan | null;
}): StoredSocialDirectorPlan {
  if (!input.productionPlan.ok || input.productionPlan.scenes.length < 1) {
    throw new SocialContentWorkflowError('social_content_director_plan_material_not_ready', 409);
  }
  const directorPlanId = stableDirectorPlanId(input.taskId);
  if (input.previous && input.previous.directorPlanId !== directorPlanId) {
    throw new SocialContentWorkflowError('social_content_director_plan_identity_invalid', 503);
  }
  const direction = directionFor({
    formula: input.formula,
    themeId: input.baseline.themeId,
    duration: input.productionPlan.maxDuration,
  });
  const baselineById = new Map(input.baseline.scenes.map(scene => [scene.sceneId, scene]));
  const scenes = input.productionPlan.scenes.map((scene, index) => {
    const baselineScene = baselineById.get(scene.sceneId);
    if (!baselineScene) throw new SocialContentWorkflowError('social_content_director_plan_lineage_invalid', 503);
    const script = {
      text: socialText(baselineScene.script) || `${baselineScene.shotFunction}：${baselineScene.subject}，${baselineScene.action}`,
      shotFunction: socialText(baselineScene.shotFunction),
      subject: socialText(baselineScene.subject),
      action: socialText(baselineScene.action),
    };
    const voiceover = socialText(scene.narration);
    const caption = sameSpokenContent(scene.narration, baselineScene.voiceover || baselineScene.narration)
      ? socialText(baselineScene.caption) || voiceover
      : voiceover;
    if (!voiceover || !caption || Object.values(script).some(value => !value)) {
      throw new SocialContentWorkflowError('social_content_director_plan_script_invalid', 503);
    }
    return {
      sceneId: scene.sceneId,
      order: index + 1,
      ...(baselineScene.referenceStructure ? {
        referenceStructure: {
          ...baselineScene.referenceStructure,
          sourceTiming: { ...baselineScene.referenceStructure.sourceTiming },
        },
      } : {}),
      script,
      voiceover,
      caption,
      shotPlan: {
        clipId: scene.clip.clipId,
        assetId: scene.clip.assetId,
        assetName: scene.clip.assetName,
        type: scene.clip.type,
        sourceStart: roundSeconds(scene.clip.start),
        sourceEnd: roundSeconds(scene.clip.end),
        confidence: Number(scene.clip.confidence.toFixed(4)),
        semanticScore: Number(scene.semanticScore.toFixed(4)),
      },
      materialMapping: {
        sourceAssetId: scene.clip.assetId,
        observations: [...scene.clip.observations],
        adaptation: scene.narration === scene.baselineNarration ? 'trim_only' as const : 'trim_and_duration_fit' as const,
      },
    };
  });
  const qualityGates: StoredSocialDirectorPlan['qualityGates'] = [
    {
      gateId: 'script_grounding',
      status: input.baseline.source !== 'system_theme_baseline'
        && input.baseline.match?.verifiedKnowledgeSource === 'none'
        && !input.baseline.match?.inspirationReference
        && !input.baseline.formulaReference ? 'blocked' : 'passed',
      message: input.baseline.source === 'system_theme_baseline'
        ? '采用平台安全主题结构，不使用未经核验的企业或产品事实。'
        : input.baseline.match?.verifiedKnowledgeSource === 'none'
        && !input.baseline.match?.inspirationReference
        && !input.baseline.formulaReference
        ? '没有可追溯的公式、灵感脚本或企业知识来源。'
        : '脚本来源可追溯，用户自由输入仅用于表达意图。',
    },
    {
      gateId: 'material_coverage',
      status: scenes.length >= 2 && input.productionPlan.sourceClipSeconds >= 5.5 ? 'passed' : 'blocked',
      message: `已锁定 ${scenes.length} 个可用视觉镜头，约 ${input.productionPlan.sourceClipSeconds.toFixed(1)} 秒有效画面。`,
    },
    {
      gateId: 'material_confidence',
      status: input.productionPlan.averageConfidence >= 0.7 ? 'passed' : 'warning',
      message: `素材分析平均置信度 ${Math.round(input.productionPlan.averageConfidence * 100)}%。`,
    },
    {
      gateId: 'content_agent_lock',
      status: 'passed',
      message: '时间线、脚本、口播、字幕、输出规格、配乐和封面意图均已锁定；内容 Agent 只执行。',
    },
  ];
  const blocked = qualityGates.some(gate => gate.status === 'blocked');
  const snapshot = materialSnapshots({
    assets: input.productionAssets,
    plan: input.productionPlan,
    sourceVersions: input.sourceVersions,
  });
  const coverScene = [...scenes].sort((left, right) => (
    right.shotPlan.semanticScore - left.shotPlan.semanticScore
    || right.shotPlan.confidence - left.shotPlan.confidence
    || left.order - right.order
  ))[0]!;
  const createdAt = new Date(input.createdAt).toISOString();
  const bgmSelection: SocialDirectorBgmSelection = {
    ...input.bgmSelection,
    primary: { ...input.bgmSelection.primary, authorization: { ...input.bgmSelection.primary.authorization } },
    fallbacks: input.bgmSelection.fallbacks.map(track => ({ ...track, authorization: { ...track.authorization } })),
    volume: direction.music.volume,
  };
  const outputSpec: SocialDirectorOutputSpec = {
    aspectRatio: socialText(input.outputSpec.aspectRatio) || '9:16',
    resolution: input.outputSpec.resolution ?? '720p',
    platform: socialText(input.outputSpec.platform) || 'douyin',
    language: input.baseline.language,
    targetDurationSeconds: direction.targetDurationSeconds,
    maximumDurationSeconds: roundSeconds(input.productionPlan.maxDuration),
    voiceVolume: 100,
  };
  return withDirectorPlanHash({
    schemaVersion: SOCIAL_DIRECTOR_PLAN_SCHEMA,
    directorPlanId,
    version: nextVersion(input.previous),
    status: blocked ? 'blocked' : 'ready',
    lockStatus: blocked ? 'blocked' : 'locked',
    lockedAt: blocked ? null : createdAt,
    createdAt,
    createdBy: 'director_agent',
    revision: {
      kind: 'initial',
      previousVersion: input.previous?.version ?? null,
      reasonCode: 'initial_lock',
      measuredDurationSeconds: null,
      targetDurationSeconds: direction.targetDurationSeconds,
    },
    themeId: input.baseline.themeId,
    language: input.baseline.language,
    scriptSource: {
      kind: input.baseline.source,
      baselineVersion: input.baseline.version,
      formulaReference: input.baseline.formulaReference,
      inspirationReference: input.baseline.match?.inspirationReference ?? null,
      referenceSource: input.baseline.match?.referenceSource
        ? { ...input.baseline.match.referenceSource }
        : null,
      matchConfidence: input.baseline.match?.confidence ?? 0,
      verifiedKnowledgeSource: input.baseline.match?.verifiedKnowledgeSource ?? 'none',
    },
    direction,
    outputSpec,
    bgmSelection,
    materialSnapshot: snapshot,
    scenes,
    coverIntent: {
      sceneId: coverScene.sceneId,
      assetId: coverScene.shotPlan.assetId,
      sourceTimestampSeconds: roundSeconds((coverScene.shotPlan.sourceStart + coverScene.shotPlan.sourceEnd) / 2),
      framePosition: 'scene_midpoint',
      purpose: `${coverScene.script.shotFunction}：${coverScene.script.subject}`,
    },
    selectedAssetIds: [...input.productionPlan.selectedAssetIds],
    unusedAssets: [...input.productionPlan.unusedAssets],
    optionalReshootSuggestions: reshootSuggestions(input.productionPlan),
    qualityGates,
    contentAgentHandoff: {
      scriptLocked: true,
      creativeFieldsLocked: ['timeline', 'voiceover', 'subtitles', 'output_spec', 'bgm', 'cover'],
      allowedAdaptations: ['execute_locked_timeline', 'ordered_bgm_fallback'],
      forbiddenActions: [
        'rewrite_script',
        'invent_product_facts',
        'replace_real_material_with_text_cards',
        'select_unplanned_bgm',
        'change_output_spec',
      ],
    },
  });
}

function compactLockedSpeech(value: string, ratio: number, language: 'zh' | 'en'): string {
  const clean = socialText(value).replace(/\s+/g, language === 'en' ? ' ' : '');
  if (language === 'en') {
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length <= 2) return clean;
    const maximum = Math.max(2, Math.min(words.length - 1, Math.floor(words.length * ratio)));
    const clauses = clean.split(/(?<=[,;.!?])\s+/).map(item => item.trim()).filter(Boolean);
    const completeClause = clauses
      .map(item => item.replace(/[,;.!?]+$/g, ''))
      .filter(item => item.split(/\s+/).length <= maximum)
      .sort((left, right) => right.split(/\s+/).length - left.split(/\s+/).length)[0];
    return `${(completeClause || words.slice(0, maximum).join(' ')).replace(/[.,;:!?]+$/g, '')}.`;
  }
  const withoutEnding = clean.replace(/[，。；：！？、,.!?:;]+$/g, '');
  const characters = [...withoutEnding];
  if (characters.length <= 3) return clean;
  const maximum = Math.max(3, Math.min(characters.length - 1, Math.floor(characters.length * ratio)));
  const sentence = (text: string) => `${text.replace(/^[，。；：！？、,.!?:;\s]+|[，。；：！？、,.!?:;\s]+$/g, '')}。`;
  const candidates = new Set<string>();
  const addCandidate = (text: string) => {
    const normalized = sentence(text);
    if (normalized !== sentence(withoutEnding) && [...normalized].length > 2) candidates.add(normalized);
  };

  // Keep complete clauses and remove common scaffolding instead of slicing a
  // Chinese sentence in the middle (for example, never produce “的已。”).
  clean.split(/[，；。！？]/).map(item => item.trim()).filter(Boolean).forEach(addCandidate);
  addCandidate(withoutEnding.replace(/^通过客户上传的真实画面[，,]?/, ''));
  addCandidate(withoutEnding.replace(/^企业已确认资料显示[，,]?/, '已确认：'));
  addCandidate(withoutEnding.replace(/^口播[-—：:]?/, ''));
  if (/^想了解.+(?:的已确认信息)?[，,]?可以联系我们$/.test(withoutEnding)) {
    addCandidate('详情请联系我们');
  }
  if (/联系我们/.test(withoutEnding)) addCandidate('详情请联系我们');
  if (/客户上传的真实画面/.test(withoutEnding)) addCandidate('真实画面展示');

  const ranked = [...candidates].sort((left, right) => [...right].length - [...left].length);
  const withinBudget = ranked.find(item => [...item].length <= maximum + 1);
  if (withinBudget) return withinBudget;
  if (ranked.length) return [...ranked].sort((left, right) => [...left].length - [...right].length)[0]!;

  // Last resort for unpunctuated administrator templates: keep a complete
  // labelled phrase. Production copy with natural clauses exits above.
  return `${characters.slice(0, maximum).join('')}。`;
}

/** Internal Director Agent correction. It creates a new locked version; the
 * Content Agent never shortens or rewrites speech by itself. */
export function reviseSocialDirectorPlanForVoiceoverFit(input: {
  previous: StoredSocialDirectorPlan;
  measuredDurationSeconds: number;
  createdAt: string;
}): StoredSocialDirectorPlan {
  assertDirectorPlanIntegrity(input.previous);
  if (input.previous.lockStatus !== 'locked' || input.previous.status !== 'ready') {
    throw new SocialContentWorkflowError('social_content_director_plan_not_ready', 409);
  }
  const measured = Number(input.measuredDurationSeconds);
  const target = input.previous.outputSpec.maximumDurationSeconds;
  if (!Number.isFinite(measured) || measured <= target) {
    throw new SocialContentWorkflowError('social_content_director_revision_not_required', 409);
  }
  const ratio = clamp((target / measured) * 0.82, 0.28, 0.82);
  let changed = false;
  const scenes = input.previous.scenes.map(scene => {
    const voiceover = compactLockedSpeech(scene.voiceover, ratio, input.previous.language);
    if (!voiceover) throw new SocialContentWorkflowError('social_content_director_revision_not_possible', 409);
    if (voiceover !== scene.voiceover) changed = true;
    return { ...scene, voiceover, caption: voiceover };
  });
  if (!changed) throw new SocialContentWorkflowError('social_content_director_revision_not_possible', 409);
  const createdAt = new Date(input.createdAt).toISOString();
  const { lineageHash: _lineageHash, ...previous } = input.previous;
  return withDirectorPlanHash({
    ...previous,
    version: nextVersion(input.previous),
    createdAt,
    lockedAt: createdAt,
    revision: {
      kind: 'voiceover_fit',
      previousVersion: input.previous.version,
      reasonCode: 'voiceover_exceeds_material',
      measuredDurationSeconds: roundSeconds(measured),
      targetDurationSeconds: roundSeconds(target),
    },
    scenes,
    qualityGates: input.previous.qualityGates.map(gate => gate.gateId === 'content_agent_lock'
      ? { ...gate, message: '口播超时已由编导 Agent 压缩并生成新锁定版本；内容 Agent 继续只执行。' }
      : gate),
  });
}

function stringArray(value: unknown): string[] {
  const parsed = socialJson(value);
  return Array.isArray(parsed) ? parsed.map(socialText).filter(Boolean) : [];
}

export function parseStoredSocialDirectorPlan(value: unknown): StoredSocialDirectorPlan | null {
  const raw = socialJson(value);
  if (raw === undefined || raw === null || raw === '') return null;
  const row = socialObject(raw);
  if (socialText(row?.schemaVersion) === LEGACY_DIRECTOR_PLAN_SCHEMA) return null;
  const source = socialObject(row?.scriptSource);
  const formulaReference = socialObject(source?.formulaReference);
  const direction = socialObject(row?.direction);
  const music = socialObject(direction?.music);
  const voiceover = socialObject(direction?.voiceover);
  const subtitles = socialObject(direction?.subtitles);
  const outputSpec = socialObject(row?.outputSpec);
  const bgmSelection = socialObject(row?.bgmSelection);
  const primaryBgm = socialObject(bgmSelection?.primary);
  const coverIntent = socialObject(row?.coverIntent);
  const handoff = socialObject(row?.contentAgentHandoff);
  const scenesValue = socialJson(row?.scenes);
  const materialsValue = socialJson(row?.materialSnapshot);
  const gatesValue = socialJson(row?.qualityGates);
  const kind = socialText(source?.kind) as StoredSocialDirectorPlan['scriptSource']['kind'];
  const language = socialText(row?.language) as StoredSocialDirectorPlan['language'];
  const status = socialText(row?.status) as StoredSocialDirectorPlan['status'];
  if (!row || socialText(row.schemaVersion) !== SOCIAL_DIRECTOR_PLAN_SCHEMA
    || !/^director_plan_[a-f0-9]{24}$/.test(socialText(row.directorPlanId))
    || !/^\d+$/.test(socialText(row.version))
    || !['ready', 'blocked'].includes(status)
    || !['locked', 'blocked'].includes(socialText(row.lockStatus))
    || (status === 'ready' ? socialText(row.lockStatus) !== 'locked' || !socialText(row.lockedAt) : socialText(row.lockStatus) !== 'blocked')
    || socialText(row.createdBy) !== 'director_agent'
    || !socialText(row.createdAt)
    || !['zh', 'en'].includes(language)
    || !['formula', 'inspiration_script', 'knowledge_fallback', 'system_theme_baseline'].includes(kind)
    || !source || !direction || !music || !voiceover || !subtitles || !outputSpec || !bgmSelection || !primaryBgm
    || !coverIntent || !handoff || handoff.scriptLocked !== true
    || !Array.isArray(scenesValue) || !scenesValue.length
    || !Array.isArray(materialsValue) || !materialsValue.length
    || !Array.isArray(gatesValue) || gatesValue.length < 4
    || !socialText(row.lineageHash)) {
    throw new SocialContentWorkflowError('social_content_director_plan_record_invalid', 503);
  }
  if ((kind === 'formula' && (!socialText(formulaReference?.formulaId) || !socialText(formulaReference?.version)))
    || (kind !== 'formula' && formulaReference)) {
    throw new SocialContentWorkflowError('social_content_director_plan_record_invalid', 503);
  }
  if (!socialText(outputSpec.aspectRatio) || socialText(outputSpec.resolution) !== '720p'
    || !socialText(outputSpec.platform) || socialText(outputSpec.language) !== language
    || Number(outputSpec.targetDurationSeconds) <= 0 || Number(outputSpec.maximumDurationSeconds) <= 0
    || Number(outputSpec.voiceVolume) !== 100
    || !socialText(primaryBgm.trackId) || !socialText(primaryBgm.name)
    || socialText(bgmSelection.fallbackPolicy) !== 'ordered_preapproved_tracks_only'
    || Number(bgmSelection.volume) !== Number(music.volume)) {
    throw new SocialContentWorkflowError('social_content_director_plan_record_invalid', 503);
  }
  for (const value of scenesValue) {
    const scene = socialObject(value);
    const script = socialObject(scene?.script);
    const shotPlan = socialObject(scene?.shotPlan);
    const mapping = socialObject(scene?.materialMapping);
    if (!scene || !script || !shotPlan || !mapping
      || !socialText(scene.sceneId) || !socialText(scene.voiceover) || !socialText(scene.caption)
      || !socialText(script.text) || !socialText(script.shotFunction) || !socialText(script.subject) || !socialText(script.action)
      || !socialText(shotPlan.clipId) || !socialText(shotPlan.assetId) || !socialText(shotPlan.assetName)
      || !['video', 'image'].includes(socialText(shotPlan.type))) {
      throw new SocialContentWorkflowError('social_content_director_plan_record_invalid', 503);
    }
  }
  for (const value of materialsValue) {
    const material = socialObject(value);
    const clips = socialJson(material?.clips);
    if (!material || !socialText(material.assetId) || !socialText(material.sourceId) || !socialText(material.assetName)
      || !['video', 'image'].includes(socialText(material.type))
      || !/^[a-f0-9]{64}$/i.test(socialText(material.contentHash))
      || !['content_sha256', 'reference_sha256'].includes(socialText(material.hashKind))
      || !socialText(material.renderUrl) || socialText(material.availability) !== 'available_at_lock'
      || !Array.isArray(clips) || !clips.length) {
      throw new SocialContentWorkflowError('social_content_director_plan_record_invalid', 503);
    }
  }
  for (const value of gatesValue) {
    const gate = socialObject(value);
    if (!gate
      || !['script_grounding', 'material_coverage', 'material_confidence', 'content_agent_lock'].includes(socialText(gate.gateId))
      || !['passed', 'warning', 'blocked'].includes(socialText(gate.status))
      || !socialText(gate.message)) {
      throw new SocialContentWorkflowError('social_content_director_plan_record_invalid', 503);
    }
  }
  const selectedAssetIds = stringArray(row.selectedAssetIds);
  const sceneAssetIds = scenesValue.map(value => socialText(socialObject(socialObject(value)?.shotPlan)?.assetId));
  const materialAssetIds = materialsValue.map(value => socialText(socialObject(value)?.assetId));
  if (!selectedAssetIds.length
    || selectedAssetIds.some(id => !sceneAssetIds.includes(id) || !materialAssetIds.includes(id))
    || !sceneAssetIds.includes(socialText(coverIntent.assetId))
    || !scenesValue.some(value => socialText(socialObject(value)?.sceneId) === socialText(coverIntent.sceneId))) {
    throw new SocialContentWorkflowError('social_content_director_plan_record_invalid', 503);
  }
  const plan = row as unknown as StoredSocialDirectorPlan;
  assertDirectorPlanIntegrity(plan);
  return plan;
}

function oneLine(value: string, maximum: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length <= maximum ? clean : `${clean.slice(0, maximum - 1)}…`;
}

export function publicSocialDirectorPlanSummary(plan: StoredSocialDirectorPlan | null): SocialDirectorPlanSummary | undefined {
  if (!plan) return undefined;
  assertDirectorPlanIntegrity(plan);
  const passed = plan.status === 'ready' && plan.lockStatus === 'locked'
    && plan.qualityGates.every(gate => gate.status !== 'blocked');
  const first = plan.scenes[0]!;
  const shotKinds = [...new Set(plan.scenes.map(scene => scene.script.shotFunction))].slice(0, 3).join('、');
  const publicScriptSource: SocialDirectorPlanSummary['scriptSource'] = plan.scriptSource.kind !== 'formula'
    ? plan.scriptSource.kind
    : plan.scriptSource.inspirationReference
      ? 'inspiration_script'
      : plan.scriptSource.verifiedKnowledgeSource !== 'none'
        ? 'knowledge_fallback'
        : 'system_theme_baseline';
  return {
    version: plan.version,
    status: plan.status,
    scriptSource: publicScriptSource,
    baselineVersion: plan.scriptSource.baselineVersion,
    sceneCount: plan.scenes.length,
    language: plan.language,
    createdAt: plan.createdAt,
    // Compatibility field in the public contract. Formula configuration is no
    // longer part of the customer workflow, including for historic plans.
    formulaConfigured: false,
    qualityPassed: passed,
    reshootSuggestionCount: plan.optionalReshootSuggestions.length,
    scriptSummary: oneLine(`${first.script.text}；共 ${plan.scenes.length} 个镜头`, 120),
    voiceoverSummary: oneLine(plan.scenes.map(scene => scene.voiceover).join(plan.language === 'en' ? ' ' : ''), 160),
    subtitleSummary: oneLine(plan.scenes.map(scene => scene.caption).join(' / '), 160),
    shotRhythmSummary: oneLine(`${plan.direction.pace === 'fast' ? '明快' : plan.direction.pace === 'steady' ? '稳健' : '自然'}节奏 · 约 ${Math.round(plan.direction.targetDurationSeconds)} 秒 · ${shotKinds}`, 120),
    referenceSourceId: plan.scriptSource.referenceSource?.sourceId ?? null,
  };
}

function assertHandoffIntegrity(handoff: SocialDirectorContentHandoff): void {
  const { handoffHash, ...payload } = handoff;
  if (socialRequestHash(payload) !== handoffHash) {
    throw new SocialContentWorkflowError('social_content_director_handoff_lineage_invalid', 503);
  }
}

/** Exact immutable execution contract handed to Content Agent. No prompt,
 * brief, raw assets or generative/rewrite input exists in this object. */
export function socialDirectorContentHandoff(plan: StoredSocialDirectorPlan): SocialDirectorContentHandoff {
  assertDirectorPlanIntegrity(plan);
  if (plan.status !== 'ready' || plan.lockStatus !== 'locked'
    || plan.qualityGates.some(gate => gate.status === 'blocked')) {
    throw new SocialContentWorkflowError('social_content_director_plan_not_ready', 409);
  }
  const materialById = new Map(plan.materialSnapshot.map(material => [material.assetId, material]));
  const payload: Omit<SocialDirectorContentHandoff, 'handoffHash'> = {
    directorPlanId: plan.directorPlanId,
    planVersion: plan.version,
    lockStatus: 'locked',
    lineageHash: plan.lineageHash,
    narration: plan.scenes.map(scene => scene.voiceover).join(plan.language === 'en' ? ' ' : ''),
    direction: plan.direction,
    outputSpec: plan.outputSpec,
    bgmSelection: plan.bgmSelection,
    coverIntent: plan.coverIntent,
    scenes: plan.scenes.map(scene => {
      const material = materialById.get(scene.shotPlan.assetId);
      if (!material || !material.clips.some(clip => clip.clipId === scene.shotPlan.clipId)) {
        throw new SocialContentWorkflowError('social_content_director_plan_lineage_invalid', 503);
      }
      return {
        sceneId: scene.sceneId,
        order: scene.order,
        script: scene.script,
        voiceover: scene.voiceover,
        caption: scene.caption,
        source: {
          assetId: material.assetId,
          sourceId: material.sourceId,
          assetName: material.assetName,
          type: material.type,
          renderUrl: material.renderUrl,
          contentHash: material.contentHash,
          clipId: scene.shotPlan.clipId,
          sourceStart: scene.shotPlan.sourceStart,
          sourceEnd: scene.shotPlan.sourceEnd,
        },
      };
    }),
    rules: plan.contentAgentHandoff,
  };
  return { ...payload, handoffHash: socialRequestHash(payload) };
}

export function socialDirectorSceneTimingCues(
  handoff: SocialDirectorContentHandoff,
  duration: number,
): Array<{ start: number; end: number; text: string }> {
  assertHandoffIntegrity(handoff);
  const exactDuration = Math.max(0.5, Number(duration));
  const weights = handoff.scenes.map(scene => Math.max(1,
    scene.source.type === 'image' ? 2.8 : (scene.source.sourceEnd - scene.source.sourceStart) / 0.82));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let elapsed = 0;
  return handoff.scenes.map((scene, index) => {
    const start = elapsed;
    elapsed = index === handoff.scenes.length - 1
      ? exactDuration
      : Math.min(exactDuration, elapsed + exactDuration * weights[index]! / total);
    return { start, end: elapsed, text: scene.caption };
  });
}

export function socialDirectorRenderTimeline(handoff: SocialDirectorContentHandoff, duration: number) {
  const cues = socialDirectorSceneTimingCues(handoff, duration);
  return handoff.scenes.map((scene, index) => {
    const targetStart = cues[index]!.start;
    const targetEnd = cues[index]!.end;
    const targetDuration = Math.max(0.5, targetEnd - targetStart);
    if (scene.source.type === 'image') {
      if (targetDuration > 4.2) throw new Error('director_revision_required:单张图片的锁定停留时长过长');
      return { name: scene.source.assetName, type: 'image' as const, url: scene.source.renderUrl, targetStart, targetEnd, targetDuration };
    }
    const availableSourceDuration = scene.source.sourceEnd - scene.source.sourceStart;
    const sourceDuration = Math.min(availableSourceDuration, targetDuration * 1.1);
    const speed = sourceDuration / targetDuration;
    if (!Number.isFinite(speed) || speed < 0.8 || speed > 1.25) {
      throw new Error('director_revision_required:锁定口播与镜头时长不匹配');
    }
    return {
      name: scene.source.assetName,
      type: 'video' as const,
      url: scene.source.renderUrl,
      trimStart: scene.source.sourceStart,
      trimEnd: scene.source.sourceStart + sourceDuration,
      speed,
      targetStart,
      targetEnd,
      targetDuration,
    };
  });
}

export function socialDirectorCoverTimestamp(handoff: SocialDirectorContentHandoff, duration: number): number {
  const cues = socialDirectorSceneTimingCues(handoff, duration);
  const index = handoff.scenes.findIndex(scene => scene.sceneId === handoff.coverIntent.sceneId);
  if (index < 0) throw new SocialContentWorkflowError('social_content_director_handoff_lineage_invalid', 503);
  const cue = cues[index]!;
  return roundSeconds(cue.start + (cue.end - cue.start) / 2);
}

export function socialDirectorScriptText(handoff: SocialDirectorContentHandoff, duration: number): string {
  const cues = socialDirectorSceneTimingCues(handoff, duration);
  return handoff.scenes.map((scene, index) => {
    const cue = cues[index]!;
    return `[${cue.start.toFixed(2)}-${cue.end.toFixed(2)}s]\n镜头功能：${scene.script.shotFunction}\n画面：使用“${scene.source.assetName}”的已锁定片段 ${scene.source.sourceStart.toFixed(2)}-${scene.source.sourceEnd.toFixed(2)}s\n口播：${scene.voiceover}\n字幕：${scene.caption}`;
  }).join('\n\n');
}
