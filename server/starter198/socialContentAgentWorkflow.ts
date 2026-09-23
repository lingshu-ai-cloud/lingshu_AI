import type {
  SocialAdHocBusinessContext,
  SocialAgentWorkflowStage,
  SocialAssetSupplyPlan,
  SocialAssetSupplyShotPlan,
  SocialContentAgentWorkflow,
  SocialContentExecutionPlan,
  SocialContentExecutionScenePlan,
  SocialContentTaskBrief,
  SocialContentTaskStatus,
  SocialDiscoveryBrief,
  SocialDirectorBrief,
  SocialDirectorBriefScene,
  SocialExecutionCandidate,
  SocialExecutionPlanReview,
  SocialExecutionPlanReviewReason,
  SocialExecutionPlanSceneReview,
  SocialInspirationHandoff,
  SocialReferenceShotAnalysis,
  SocialReferenceVideoAnalysis,
  SocialReplicationScriptShot,
  SocialReplicationScriptVersion,
  SocialShotSourceStrategy,
  SocialShotTruthBoundary,
  SocialTaskSource,
  SocialWeeklyContentPackage,
} from '../../shared/contracts/socialContentWorkflow.js';
import { socialRequestHash } from './socialContentValidation.js';

type CapabilityDefinition = {
  strategy: SocialShotSourceStrategy;
  label: string;
  evidenceStrength: SocialExecutionCandidate['evidenceStrength'];
  estimatedCostCny: number;
  estimatedSeconds: number;
  estimatedSuccessRate: number;
  dataTransfer: SocialExecutionCandidate['dataTransfer'];
  rightsStatus: SocialExecutionCandidate['rightsStatus'];
  canDo: string[];
  cannotDo: string[];
  inputRequirements: string[];
  outputSpec: string;
  qualityRange: string;
  concurrencyLimit: number;
  rateLimitPerMinute: number;
  availability: 'available' | 'degraded' | 'unavailable';
  authorizationScope: string;
  dataRestriction: string;
  fallbackStrategies: SocialShotSourceStrategy[];
  applicableScenes: SocialDirectorBriefScene['purpose'][];
};

const CAPABILITIES: CapabilityDefinition[] = [
  { strategy: 'customer_product_image_animation', label: '产品图动效', evidenceStrength: 'supporting', estimatedCostCny: 0.35, estimatedSeconds: 45, estimatedSuccessRate: 0.94, dataTransfer: 'local_only', rightsStatus: 'confirmed', canDo: ['锁定产品图并生成运镜、景深和非事实性背景'], cannotDo: ['重绘包装文字、商标或证明真实使用效果'], inputRequirements: ['已授权且清晰的客户产品图'], outputSpec: '竖屏或横屏短镜头', qualityRange: '产品身份保持优先', concurrencyLimit: 4, rateLimitPerMinute: 30, availability: 'available', authorizationScope: '当前租户产品素材', dataRestriction: '本地处理优先', fallbackStrategies: ['motion_graphics'], applicableScenes: ['hook', 'value', 'demonstration', 'call_to_action'] },
  { strategy: 'authorized_digital_presenter', label: '授权数字人口播', evidenceStrength: 'non_evidentiary', estimatedCostCny: 1.2, estimatedSeconds: 150, estimatedSuccessRate: 0.87, dataTransfer: 'external_processor', rightsStatus: 'restricted', canDo: ['生成授权形象的稳定口播'], cannotDo: ['冒充客户员工、客户证言或真实身份'], inputRequirements: ['已确认口播', '可用形象授权', '目标语言'], outputSpec: '带透明或合成背景的口播镜头', qualityRange: '口型与身份连续性需逐镜检查', concurrencyLimit: 2, rateLimitPerMinute: 10, availability: 'available', authorizationScope: '租户已授权数字人', dataRestriction: '仅传输生成所需文案和授权形象', fallbackStrategies: ['motion_graphics'], applicableScenes: ['hook', 'problem', 'value', 'call_to_action'] },
  { strategy: 'licensed_stock_asset', label: '商用授权素材库', evidenceStrength: 'non_evidentiary', estimatedCostCny: 0.8, estimatedSeconds: 30, estimatedSuccessRate: 0.9, dataTransfer: 'external_processor', rightsStatus: 'confirmed', canDo: ['补充环境、气氛和转场画面'], cannotDo: ['作为客户真实工厂、案例或效果证据'], inputRequirements: ['场景语义', '平台和权利范围'], outputSpec: '已授权图片或视频片段', qualityRange: '依赖素材库供给', concurrencyLimit: 8, rateLimitPerMinute: 60, availability: 'available', authorizationScope: '商用授权范围内', dataRestriction: '只发送检索词和规格', fallbackStrategies: ['non_evidentiary_ai_visual', 'motion_graphics'], applicableScenes: ['hook', 'problem', 'value', 'transition'] },
  { strategy: 'non_evidentiary_ai_visual', label: '非证明性生成画面', evidenceStrength: 'non_evidentiary', estimatedCostCny: 1.8, estimatedSeconds: 220, estimatedSuccessRate: 0.74, dataTransfer: 'external_processor', rightsStatus: 'restricted', canDo: ['生成概念、气氛和非证明性辅助画面'], cannotDo: ['伪造客户工厂、案例、认证、效果或真实产品细节'], inputRequirements: ['真值边界', '画面目标', '禁止事项'], outputSpec: '图片或短视频镜头', qualityRange: '一致性和文字准确性需复检', concurrencyLimit: 2, rateLimitPerMinute: 8, availability: 'available', authorizationScope: '允许外部生成的非敏感输入', dataRestriction: '真实客户证据不得外传或作为生成目标', fallbackStrategies: ['motion_graphics', 'licensed_stock_asset'], applicableScenes: ['hook', 'problem', 'value', 'transition'] },
  { strategy: 'motion_graphics', label: '动态图文与示意动画', evidenceStrength: 'non_evidentiary', estimatedCostCny: 0.25, estimatedSeconds: 35, estimatedSuccessRate: 0.97, dataTransfer: 'local_only', rightsStatus: 'confirmed', canDo: ['生成流程示意、字幕、图标和品牌动画'], cannotDo: ['替代未经确认的产品事实或真实证据'], inputRequirements: ['已确认文案或事实'], outputSpec: '可组合的视频图形层', qualityRange: '稳定可控', concurrencyLimit: 8, rateLimitPerMinute: 120, availability: 'available', authorizationScope: '当前租户品牌资产', dataRestriction: '本地处理', fallbackStrategies: ['authorized_digital_presenter'], applicableScenes: ['hook', 'problem', 'value', 'demonstration', 'transition', 'call_to_action'] },
  { strategy: 'verified_fact_card', label: '已确认事实卡片', evidenceStrength: 'supporting', estimatedCostCny: 0.12, estimatedSeconds: 20, estimatedSuccessRate: 0.99, dataTransfer: 'local_only', rightsStatus: 'confirmed', canDo: ['把已确认参数和事实转为可读信息卡'], cannotDo: ['补写未确认参数、认证、价格或效果'], inputRequirements: ['可追溯事实引用'], outputSpec: '品牌化信息卡视频层', qualityRange: '事实准确性优先', concurrencyLimit: 16, rateLimitPerMinute: 240, availability: 'available', authorizationScope: '当前任务确认事实', dataRestriction: '本地处理', fallbackStrategies: ['motion_graphics'], applicableScenes: ['value', 'demonstration', 'proof', 'trust', 'call_to_action'] },
];

export function socialContentCapabilityRegistry(): ReadonlyArray<Readonly<CapabilityDefinition>> {
  return structuredClone(CAPABILITIES);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function positiveNumber(value: number | null | undefined): number | null {
  return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : null;
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${socialRequestHash(value).slice(0, 20)}`;
}

function buildBusinessContext(input: BuildSocialAgentWorkflowInput): {
  weeklyPackage: SocialWeeklyContentPackage | null;
  adHocBusinessContext: SocialAdHocBusinessContext | null;
} {
  const originalContentCount = Math.max(1, Math.floor(input.brief.requestedOutputCount || 1));
  const publicationTaskCount = originalContentCount * Math.max(1, input.brief.platforms.length);
  if (input.mode === 'weekly') {
    return {
      weeklyPackage: {
        packageId: input.weeklyPlanId || stableId('weekly_package', { taskId: input.taskId }),
        version: input.taskVersion,
        businessGoal: input.brief.objective,
        productFocus: input.brief.productRef,
        audience: input.brief.audience,
        markets: input.brief.markets,
        languages: input.brief.languages,
        originalContentCount,
        adaptationVersionCount: Math.max(0, publicationTaskCount - originalContentCount),
        publicationTaskCount,
        platforms: input.brief.platforms,
        publicationMatrix: input.brief.platforms.map(platform => ({ platform, accountRef: null, accountPositioning: null, publishWindow: input.brief.dueAt })),
        weeklyBudgetCny: positiveNumber(input.brief.weeklyBudgetCny),
        perItemBudgetCny: positiveNumber(input.brief.perItemBudgetCny),
        dueAt: input.brief.dueAt,
        availableAssetRefs: input.sources.filter(source => source.kind === 'material').map(source => source.sourceId),
        customerCanShoot: false,
        availableCapabilities: CAPABILITIES.filter(item => item.availability === 'available').map(item => item.strategy),
        priorities: ['must_do'],
        successCriteria: unique([
          input.brief.objective,
          input.brief.callToAction ? `观众完成行动：${input.brief.callToAction}` : '',
        ].filter(Boolean)),
        metricTargets: ['播放完成度', '互动质量', '有效询盘或目标行动'],
        createdBy: 'business_agent',
      },
      adHocBusinessContext: null,
    };
  }
  return {
    weeklyPackage: null,
    adHocBusinessContext: {
      contextId: stableId('ad_hoc_context', { taskId: input.taskId }),
      version: input.taskVersion,
      objective: input.brief.objective,
      productRef: input.brief.productRef,
      audience: input.brief.audience,
      platforms: input.brief.platforms,
      markets: input.brief.markets,
      languages: input.brief.languages,
      budgetCny: positiveNumber(input.brief.perItemBudgetCny),
      dueAt: input.brief.dueAt,
      factSourceRefs: input.factSourceRefs,
      createdBy: 'business_agent',
    },
  };
}

function platformFromReference(value: string): string {
  if (/tiktok/i.test(value)) return 'tiktok';
  if (/youtu/i.test(value)) return 'youtube';
  if (/instagram/i.test(value)) return 'instagram';
  if (/facebook|fb\.watch/i.test(value)) return 'facebook';
  return 'external';
}

function buildDiscoveryBrief(input: BuildSocialAgentWorkflowInput): SocialDiscoveryBrief | null {
  if (input.brief.creationMode !== 'viral_replication') return null;
  const market = input.brief.markets[0] || '';
  const audience = input.brief.audience || '';
  const productRef = input.brief.productRef || '';
  const keywordSetId = stableId('market_keyword_set', { productRef, market, audience });
  return {
    discoveryBriefId: stableId('discovery_brief', { taskId: input.taskId, version: input.taskVersion }),
    keywordSetId,
    keywordSetVersion: 1,
    productRef,
    market,
    audience,
    discoverySeedIds: productRef ? [stableId('seed', { keywordSetId, productRef })] : [],
    trackedSceneIds: [],
    competitorAccounts: [],
    discoveryModes: ['momentum', 'account', 'innovation'],
    platforms: [...input.brief.platforms],
    lookbackDays: 7,
    resultLimit: 30,
    budgetLimitCny: positiveNumber(input.brief.perItemBudgetCny),
    productionGap: input.referenceAnalysis ? null : '当前任务尚无达到生产级的参考分析',
    createdBy: 'director_agent',
  };
}

function buildInspirationHandoffs(input: BuildSocialAgentWorkflowInput): SocialInspirationHandoff[] {
  const analysis = input.referenceAnalysis;
  if (!analysis) return [];
  const source = input.sources.find(item => item.sourceId === analysis.referenceSourceId)
    ?? input.sources.find(item => item.kind === 'reference_link');
  const exactReady = analysis.status === 'ready'
    && analysis.coverage?.fullTimelineCovered === true
    && (analysis.analysisLayers ?? []).some(layer => layer.level === 'L3' && layer.status === 'complete');
  const strategyReady = analysis.status === 'ready'
    && ((analysis.analysisLayers ?? []).some(layer => layer.level === 'L2' && layer.status === 'complete') || analysis.shots.length > 0);
  const readiness: SocialInspirationHandoff['readiness'] = exactReady
    ? 'production_reference'
    : strategyReady ? 'strategy_reference' : 'discovery_reference';
  const sourceRef = source?.sourceRef || '';
  const primaryHook = analysis.hookAnalysis;
  return [{
    inspirationId: source?.sourceId || analysis.referenceSourceId,
    analysisId: analysis.analysisId,
    analysisVersion: analysis.version || input.taskVersion,
    readiness,
    source: { platform: platformFromReference(sourceRef), sourceUrl: sourceRef },
    taskContext: {
      taskId: input.taskId,
      productRef: input.brief.productRef || undefined,
      market: input.brief.markets[0],
      audience: input.brief.audience || undefined,
    },
    whySelected: source?.sourceId.startsWith('system-reference:')
      ? ['系统根据当前产品、受众和任务目标推荐']
      : ['用户已将该参考关联到当前任务'],
    referenceRole: 'primary_structure',
    reusableLogic: {
      hookTypes: unique([primaryHook?.mechanism || ''].filter(Boolean)),
      revealOrder: analysis.shots.map(shot => shot.purpose),
      proofPlacement: analysis.shots.filter(shot => shot.purpose === 'proof').map(shot => `${shot.startSeconds}-${shot.endSeconds}s`),
      pacing: analysis.shots.map(shot => shot.rhythmDescription).filter(Boolean).join(' → '),
      emotionalProgression: '由前三秒吸引进入价值与证明，再收束到行动',
      ctaPosition: analysis.shots.some(shot => shot.purpose === 'call_to_action') ? '结尾' : '待编导补充',
    },
    adaptationBoundary: {
      reusable: unique(analysis.shots.flatMap(shot => shot.fidelityPoints)),
      mustReplace: unique(analysis.shots.flatMap(shot => shot.mustDifferPoints)),
      prohibited: ['原视频文件', '原人物身份', '原品牌与商标', '原台词和字幕', '未授权音乐'],
    },
    productionImplications: {
      requiredEvidence: unique(analysis.shots.flatMap(shot => shot.observation?.observableFacts ?? [])),
      likelyAssetNeeds: unique(analysis.shots.flatMap(shot => shot.tags?.sceneTypes ?? [])),
      difficulty: exactReady ? 'medium' : 'high',
      risks: analysis.coverage?.gaps.map(gap => `${gap.startSeconds}-${gap.endSeconds}s：${gap.reason}`) ?? [],
    },
    evidenceRefs: analysis.shots.map(shot => ({
      startTime: shot.startSeconds,
      endTime: shot.endSeconds,
      description: shot.visualDescription,
      confidence: analysis.coverage?.overallConfidence ?? 0.7,
      needsReview: Boolean(shot.observation?.causalGaps?.length),
    })),
    rights: { mayAnalyze: true, mayUseOriginalMedia: false, mayAdapt: false, note: analysis.rightsNotice },
  }];
}

function safeBoundary(boundary: SocialShotTruthBoundary): SocialShotTruthBoundary {
  return {
    ...boundary,
    // The Director declares what evidence is required; the Content Agent owns
    // the actual asset choice and therefore receives no preselected asset ids.
    customerEvidenceRefs: [],
    confirmedFactRefs: [...boundary.confirmedFactRefs],
    prohibitedRepresentations: [...boundary.prohibitedRepresentations],
  };
}

function requiredEvidence(boundary: SocialShotTruthBoundary, purpose: SocialDirectorBriefScene['purpose']): string[] {
  const subjectLabel = boundary.subject === 'customer_factory' ? '本企业真实工厂或生产过程'
    : boundary.subject === 'customer_case' ? '已授权且可核验的真实客户案例'
      : boundary.subject === 'product_effect' ? '可核验的真实产品效果或测试结果'
        : null;
  return unique([
    ...(subjectLabel ? [subjectLabel] : []),
    ...(boundary.confirmedFactRefs.length ? ['只使用已确认企业事实'] : []),
    ...(purpose === 'proof' ? ['证明内容必须能追溯到事实或授权证据'] : []),
  ]);
}

function shotLanguage(reference: SocialReferenceShotAnalysis | undefined) {
  const tags = reference?.tags.cameraLanguage ?? [];
  const pick = (pattern: RegExp, fallback: string) => tags.find(item => pattern.test(item)) || fallback;
  return {
    shotSize: pick(/特写|近景|中景|全景|远景|close|medium|wide/i, '根据主体信息密度选择明确景别'),
    cameraAngle: pick(/平视|俯拍|仰拍|侧面|正面|angle|overhead|low/i, '保持主体关系清楚的稳定机位'),
    movement: pick(/推进|拉远|横移|跟拍|手持|固定|推拉|pan|track|static/i, '运镜服务于信息揭示，不做无目的运动'),
    composition: pick(/构图|中心|对称|三分|前景|留白|composition/i, '主体、证据和字幕安全区互不遮挡'),
  };
}

function directorScene(input: {
  index: number;
  script: SocialReplicationScriptShot | null;
  supply: SocialAssetSupplyShotPlan;
  reference: SocialReferenceShotAnalysis | undefined;
}): SocialDirectorBriefScene {
  const startSeconds = input.script?.startSeconds ?? input.reference?.startSeconds ?? input.index * 3;
  const endSeconds = input.script?.endSeconds ?? input.reference?.endSeconds ?? startSeconds + 3;
  const targetVisual = input.script?.visualInstruction || input.supply.requestedDescription || '用清楚、可验证的画面完成本镜头的信息作用';
  const boundary = safeBoundary(input.supply.truthBoundary);
  const evidence = requiredEvidence(boundary, input.supply.function);
  return {
    sceneId: input.script?.shotId || input.supply.shotId,
    order: input.index + 1,
    referenceShotId: input.script?.referenceShotId ?? input.reference?.shotId ?? null,
    purpose: input.supply.function,
    targetVisual,
    requiredEvidence: evidence,
    action: {
      startState: input.index === 0 ? '第一帧立即出现清楚主体' : '承接上一镜的主体、方向和信息状态',
      path: targetVisual,
      endState: input.supply.function === 'call_to_action' ? '画面停留在明确行动信息上' : '以稳定主体或动作结果衔接下一镜',
    },
    shotLanguage: shotLanguage(input.reference),
    spaceAndContinuity: [
      '人物、产品、包装和品牌元素在前后镜保持一致',
      '动作方向、主体位置和环境关系不得无解释跳变',
    ],
    audioLayers: {
      voiceover: input.script?.spokenText ?? null,
      dialogue: null,
      captionIntent: input.script?.captionText ?? null,
      ambient: input.reference?.audioDescription ?? null,
      music: input.script?.audioAndTransition ?? null,
      soundEffects: null,
    },
    duration: { startSeconds, endSeconds, targetSeconds: Math.max(0.2, +(endSeconds - startSeconds).toFixed(2)) },
    truthBoundary: boundary,
    allowedVariation: unique([
      '可以改变具体素材组合、制作能力和镜头实现方式',
      '可以在不改变镜头作用和事实强度的前提下使用功能等价表达',
      ...(input.supply.functionalEquivalentReplacement.required && input.supply.functionalEquivalentReplacement.description
        ? [input.supply.functionalEquivalentReplacement.description]
        : []),
    ]),
    acceptanceCriteria: unique([
      `观众能够看懂本镜头的作用：${input.supply.function}`,
      `画面可观察地实现：${targetVisual}`,
      `镜头时长控制在约 ${Math.max(0.2, endSeconds - startSeconds).toFixed(1)} 秒`,
      ...evidence.map(item => `证据要求：${item}`),
      ...(boundary.mustNotImplyCustomerReality ? ['合成或通用画面不得被表述为客户真实证据'] : []),
    ]),
    fidelityPoints: input.script?.fidelityPoints ?? input.reference?.fidelityPoints ?? [],
    mustDifferPoints: input.script?.mustDifferPoints ?? input.reference?.mustDifferPoints ?? [],
  };
}

function buildDirectorBrief(
  input: BuildSocialAgentWorkflowInput,
  context: ReturnType<typeof buildBusinessContext>,
  inspirationHandoffs: SocialInspirationHandoff[],
): SocialDirectorBrief {
  const scriptShots = input.replicationScript?.shots ?? [];
  const supplyShots = input.assetSupplyPlan.shots;
  const supplyById = new Map(supplyShots.map(shot => [shot.shotId, shot]));
  const referenceById = new Map((input.referenceAnalysis?.shots ?? []).map(shot => [shot.shotId, shot]));
  const scenes = (scriptShots.length ? scriptShots : supplyShots.map(() => null)).map((script, index) => {
    const supply = (script ? supplyById.get(script.shotId) : undefined) ?? supplyShots[index] ?? supplyShots[0];
    if (!supply) return null;
    return directorScene({
      index,
      script,
      supply,
      reference: referenceById.get(script?.referenceShotId || '') ?? input.referenceAnalysis?.shots[index],
    });
  }).filter((scene): scene is SocialDirectorBriefScene => Boolean(scene));
  const coverage = input.referenceAnalysis?.coverage;
  const referenceRequired = input.brief.creationMode === 'viral_replication';
  const referenceReady = !referenceRequired || Boolean(input.referenceAnalysis?.status === 'ready' && coverage?.fullTimelineCovered !== false);
  const status = scenes.length > 0 && referenceReady ? 'ready' : 'blocked';
  const totalDurationSeconds = Math.max(0, ...scenes.map(scene => scene.duration.endSeconds));
  return {
    directorBriefId: stableId('director_brief', { taskId: input.taskId }),
    version: input.taskVersion,
    status,
    source: {
      weeklyPackageId: context.weeklyPackage?.packageId ?? null,
      adHocBusinessContextId: context.adHocBusinessContext?.contextId ?? null,
    },
    referenceAnalysis: input.referenceAnalysis ? {
      analysisId: input.referenceAnalysis.analysisId,
      version: input.referenceAnalysis.version || input.taskVersion,
      fullDurationSeconds: coverage?.fullDurationSeconds ?? input.referenceAnalysis.durationSeconds,
      precisionIntervals: coverage?.precisionIntervals ?? input.referenceAnalysis.shots.map(shot => ({ startSeconds: shot.startSeconds, endSeconds: shot.endSeconds, level: 'L3' as const })),
      gaps: coverage?.gaps ?? [],
      overallConfidence: coverage?.overallConfidence ?? null,
    } : null,
    inspirationHandoffIds: inspirationHandoffs.map(item => item.inspirationId),
    topic: input.brief.title,
    audience: input.brief.audience,
    platforms: input.brief.platforms,
    accountRefs: [],
    creativeIntent: input.brief.objective,
    narrativeStructure: scenes.map(scene => scene.purpose),
    rhythm: input.referenceAnalysis ? '保持参考内容的信息推进节奏，但按新素材重新安排具体切点' : '前三秒快速建立主题，随后逐步补充价值、证据和行动信息',
    primaryHookId: input.replicationScript?.primaryHookId ?? null,
    coreSellingPoints: unique([input.brief.productRef || '', input.brief.brandNotes || ''].filter(Boolean)),
    callToAction: input.brief.callToAction,
    totalDurationSeconds,
    aspectRatio: input.brief.aspectRatio,
    languages: input.brief.languages,
    brandRequirements: unique([input.brief.brandNotes || '', ...input.brief.restrictions].filter(Boolean)),
    factSourceRefs: input.factSourceRefs,
    rightsConstraints: unique([
      '参考视频只用于分析结构和节奏，不复制原片素材、人物、声音、商标或原文案',
      ...(input.assetSupplyPlan.status === 'requires_rights_confirmation' ? ['参考内容或素材权利尚待确认'] : []),
    ]),
    referenceEvidence: input.referenceAnalysis ? input.referenceAnalysis.shots.map(shot => ({
      analysisId: input.referenceAnalysis!.analysisId,
      referenceShotId: shot.shotId,
      transferable: [...shot.fidelityPoints],
      mustReplace: [...shot.mustDifferPoints],
    })) : [],
    budgetCny: positiveNumber(input.brief.perItemBudgetCny),
    dueAt: input.brief.dueAt,
    scenes,
    createdBy: 'director_agent',
  };
}

function capabilityCandidates(input: {
  taskId: string;
  taskVersion: string;
  sceneId: string;
  supply: SocialAssetSupplyShotPlan;
}): SocialExecutionCandidate[] {
  const actualAssets = input.supply.sourceRefs.map((sourceRef, index): SocialExecutionCandidate => ({
    candidateId: stableId('candidate', { sceneId: input.sceneId, sourceRef }),
    kind: 'asset',
    label: `客户或已授权素材 ${index + 1}`,
    sourceRef,
    sourceStrategy: input.supply.sourceStrategy,
    evidenceStrength: input.supply.truthBoundary.customerEvidenceRequired ? 'strong' : 'supporting',
    rightsStatus: 'confirmed',
    enterpriseOwnershipScore: 1,
    semanticScore: 0.96,
    evidenceScore: input.supply.truthBoundary.customerEvidenceRequired ? 1 : 0.8,
    actionAndShotScore: 0.85,
    qualityScore: 0.85,
    durationFitScore: 0.9,
    repetitionPenalty: 0,
    estimatedCostCny: 0,
    estimatedSeconds: 8,
    estimatedSuccessRate: 0.99,
    dataTransfer: 'local_only',
    providerId: null,
    modelId: null,
    clipId: sourceRef,
    timeRange: null,
    promptRef: null,
    retryPolicy: { maxAttempts: 1, fallbackStrategies: input.supply.fallbackSourceStrategy ? [input.supply.fallbackSourceStrategy] : [] },
    provenance: { origin: 'customer', inputVersion: input.taskVersion, authorizationRef: sourceRef, executionRecordId: null },
  }));
  const capabilityRows = CAPABILITIES
    .filter(capability => !input.supply.truthBoundary.customerEvidenceRequired || capability.evidenceStrength === 'strong')
    .map((capability): SocialExecutionCandidate => ({
      candidateId: stableId('capability', { sceneId: input.sceneId, strategy: capability.strategy }),
      kind: 'capability',
      label: capability.label,
      sourceRef: null,
      sourceStrategy: capability.strategy,
      evidenceStrength: capability.evidenceStrength,
      rightsStatus: capability.rightsStatus,
      enterpriseOwnershipScore: 0,
      semanticScore: capability.strategy === input.supply.sourceStrategy ? 0.88
        : capability.strategy === input.supply.fallbackSourceStrategy ? 0.72 : 0.48,
      evidenceScore: capability.evidenceStrength === 'strong' ? 1 : capability.evidenceStrength === 'supporting' ? 0.7 : 0.25,
      actionAndShotScore: capability.applicableScenes.includes(input.supply.function) ? 0.85 : 0.4,
      qualityScore: capability.estimatedSuccessRate,
      durationFitScore: 0.8,
      repetitionPenalty: 0,
      estimatedCostCny: capability.estimatedCostCny,
      estimatedSeconds: capability.estimatedSeconds,
      estimatedSuccessRate: capability.estimatedSuccessRate,
      dataTransfer: capability.dataTransfer,
      providerId: capability.dataTransfer === 'local_only' ? 'lingshu-local' : `registered:${capability.strategy}`,
      modelId: null,
      clipId: null,
      timeRange: null,
      promptRef: null,
      retryPolicy: { maxAttempts: 3, fallbackStrategies: [...capability.fallbackStrategies] },
      provenance: { origin: capability.strategy === 'licensed_stock_asset' ? 'licensed_library' : 'system_capability', inputVersion: input.taskVersion, authorizationRef: capability.rightsStatus === 'confirmed' ? `capability:${capability.strategy}` : null, executionRecordId: null },
    }));
  return [...actualAssets, ...capabilityRows]
    .sort((left, right) => right.semanticScore - left.semanticScore || right.estimatedSuccessRate - left.estimatedSuccessRate)
    .slice(0, 20);
}

function executionScene(input: {
  taskId: string;
  taskVersion: string;
  scene: SocialDirectorBriefScene;
  supply: SocialAssetSupplyShotPlan;
}): SocialContentExecutionScenePlan {
  const candidates = capabilityCandidates({ ...input, sceneId: input.scene.sceneId });
  const preferred = candidates.find(candidate => candidate.sourceStrategy === input.supply.sourceStrategy) ?? candidates[0];
  const fallback = candidates.find(candidate => candidate.sourceStrategy === input.supply.fallbackSourceStrategy && candidate.candidateId !== preferred?.candidateId);
  return {
    sceneId: input.scene.sceneId,
    feasibility: input.supply.feasibility,
    feasibilityReason: input.supply.feasibilityReason,
    candidates,
    recommendedCandidateIds: preferred ? [preferred.candidateId] : [],
    alternativeCandidateGroups: fallback ? [[fallback.candidateId]] : [],
    selectedSourceStrategy: preferred?.sourceStrategy ?? input.supply.sourceStrategy,
    fallbackSourceStrategy: fallback?.sourceStrategy ?? input.supply.fallbackSourceStrategy,
    estimatedCostCny: preferred?.estimatedCostCny ?? 0,
    estimatedSeconds: preferred?.estimatedSeconds ?? 0,
    estimatedSuccessRate: preferred?.estimatedSuccessRate ?? 0,
    rightsRisks: candidates.some(candidate => candidate.rightsStatus === 'requires_confirmation' || candidate.rightsStatus === 'restricted')
      ? ['部分外部能力受授权范围限制，执行前必须校验租户授权'] : [],
    dataTransferRisks: preferred?.dataTransfer === 'external_processor' ? ['推荐路线会把必要输入发送给外部处理服务'] : [],
    idempotencyKey: stableId('social_scene_execution', { taskId: input.taskId, taskVersion: input.taskVersion, sceneId: input.scene.sceneId }),
  };
}

function buildExecutionPlan(input: BuildSocialAgentWorkflowInput, directorBrief: SocialDirectorBrief): SocialContentExecutionPlan {
  const supplyById = new Map(input.assetSupplyPlan.shots.map(shot => [shot.shotId, shot]));
  const scenes = directorBrief.scenes.flatMap(scene => {
    const supply = supplyById.get(scene.sceneId) ?? input.assetSupplyPlan.shots[scene.order - 1];
    return supply ? [executionScene({ taskId: input.taskId, taskVersion: input.taskVersion, scene, supply })] : [];
  });
  return {
    executionPlanId: stableId('execution_plan', { taskId: input.taskId }),
    version: input.taskVersion,
    directorBriefId: directorBrief.directorBriefId,
    directorBriefVersion: directorBrief.version,
    status: directorBrief.status === 'ready' && scenes.length === directorBrief.scenes.length ? 'review_required' : 'blocked',
    reviewRound: 1,
    maxReviewRounds: 3,
    budgetLimitCny: positiveNumber(input.brief.perItemBudgetCny),
    deadlineAt: input.brief.dueAt,
    estimatedTotalCostCny: +scenes.reduce((sum, scene) => sum + scene.estimatedCostCny, 0).toFixed(2),
    estimatedTotalSeconds: +scenes.reduce((sum, scene) => sum + scene.estimatedSeconds, 0).toFixed(1),
    scenes,
    createdBy: 'content_agent',
  };
}

function reviewScene(input: {
  scene: SocialDirectorBriefScene;
  plan: SocialContentExecutionScenePlan;
  budgetExceeded: boolean;
  weekly: boolean;
  rightsMissing: boolean;
  conceptPreview: boolean;
}): SocialExecutionPlanSceneReview {
  const failedCriteria: string[] = [];
  const requiredRevision: string[] = [];
  const reasonCodes: SocialExecutionPlanReviewReason[] = [];
  if (input.plan.feasibility === 'blocked_for_facts_or_rights' && !input.conceptPreview) {
    failedCriteria.push('缺少不可替代的事实、真实证据或授权');
    requiredRevision.push('补充最少必要事实/权利信息，或由经营 Agent 接受明确的目标降级');
    reasonCodes.push(input.rightsMissing ? 'rights_missing' : 'facts_missing');
  }
  if (input.plan.feasibility === 'goal_degraded') {
    failedCriteria.push('当前路线降低了镜头的核心证明强度或经营目标');
    requiredRevision.push('寻找能保持事实强度的替代路线，或显式返回经营 Agent 调整目标');
    reasonCodes.push('material_insufficient');
  }
  if (!input.plan.recommendedCandidateIds.length) {
    failedCriteria.push('没有可执行的推荐候选');
    requiredRevision.push('补充候选素材或可用能力后重新提交');
    reasonCodes.push('capability_mismatch');
  }
  if (input.scene.truthBoundary.customerEvidenceRequired
    && input.plan.candidates.filter(candidate => input.plan.recommendedCandidateIds.includes(candidate.candidateId))
      .some(candidate => candidate.evidenceStrength !== 'strong')) {
    failedCriteria.push('证明型镜头的推荐候选不能承担真实证据');
    requiredRevision.push('只选择可追溯的客户真实证据素材');
    reasonCodes.push('material_insufficient');
  }
  if (input.budgetExceeded) {
    failedCriteria.push('预计成本超过单条预算');
    requiredRevision.push('改用预算内的本地能力或请求预算确认');
    reasonCodes.push('budget_exceeded');
  }
  const approved = failedCriteria.length === 0;
  return {
    sceneId: input.scene.sceneId,
    approved,
    feasibility: input.plan.feasibility,
    failedCriteria,
    requiredRevision,
    goalImpact: approved ? 'none' : input.weekly ? 'weekly_plan' : 'video',
    reasonCodes: unique(reasonCodes),
  };
}

function buildReview(input: BuildSocialAgentWorkflowInput, directorBrief: SocialDirectorBrief, plan: SocialContentExecutionPlan): SocialExecutionPlanReview {
  const estimatedCost = plan.scenes.reduce((sum, scene) => sum + scene.estimatedCostCny, 0);
  const budgetExceeded = plan.budgetLimitCny !== null && estimatedCost > plan.budgetLimitCny;
  const planByScene = new Map(plan.scenes.map(scene => [scene.sceneId, scene]));
  const sceneResults = directorBrief.scenes.flatMap(scene => {
    const scenePlan = planByScene.get(scene.sceneId);
    return scenePlan ? [reviewScene({
      scene,
      plan: scenePlan,
      budgetExceeded,
      weekly: input.mode === 'weekly',
      rightsMissing: input.assetSupplyPlan.status === 'requires_rights_confirmation',
      conceptPreview: input.brief.productionMode === 'concept_preview',
    })] : [];
  });
  const directorBlocked = directorBrief.status === 'blocked';
  const approved = !directorBlocked && sceneResults.length === directorBrief.scenes.length && sceneResults.every(result => result.approved);
  const failedCriteria = unique([
    ...(directorBlocked ? ['导演方案或参考分析尚未满足完整性要求'] : []),
    ...sceneResults.flatMap(result => result.failedCriteria),
  ]);
  const requiredRevision = unique([
    ...(directorBlocked ? ['补齐参考分析覆盖或导演方案后重新规划'] : []),
    ...sceneResults.flatMap(result => result.requiredRevision),
  ]);
  const reasonCodes = unique([
    ...(directorBlocked ? ['expression_failed' as const] : []),
    ...sceneResults.flatMap(result => result.reasonCodes),
  ]);
  return {
    reviewId: stableId('execution_plan_review', { taskId: input.taskId, taskVersion: input.taskVersion, round: plan.reviewRound }),
    version: input.taskVersion,
    executionPlanId: plan.executionPlanId,
    executionPlanVersion: plan.version,
    directorBriefId: directorBrief.directorBriefId,
    directorBriefVersion: directorBrief.version,
    approved,
    sceneResults,
    failedCriteria,
    requiredRevision,
    goalImpact: approved ? 'none' : input.mode === 'weekly' ? 'weekly_plan' : 'video',
    reasonCodes,
    createdBy: 'director_agent',
  };
}

function taskStage(input: BuildSocialAgentWorkflowInput, review: SocialExecutionPlanReview): SocialAgentWorkflowStage {
  if (!review.approved) {
    if (review.reasonCodes.includes('rights_missing')) return 'needs_rights';
    if (review.reasonCodes.includes('facts_missing')) return 'needs_facts';
    if (review.reasonCodes.includes('budget_exceeded')) return 'needs_budget';
    if (review.sceneResults.some(result => result.feasibility === 'goal_degraded')) return 'goal_degraded';
    if (input.referenceAnalysis?.status !== 'ready' && input.brief.creationMode === 'viral_replication') return 'planned';
    return 'director_review';
  }
  const mapping: Partial<Record<SocialContentTaskStatus, SocialAgentWorkflowStage>> = {
    draft: 'planned',
    needs_input: 'planned',
    plan_review: 'director_ready',
    producing: 'producing',
    asset_review: 'asset_review',
    packaging: 'ready_to_publish',
    delivered: 'ready_to_publish',
    awaiting_publish: 'ready_to_publish',
    awaiting_metrics: 'ready_to_publish',
    reviewed: 'ready_to_publish',
    paused: 'failed_recoverable',
    attention: 'failed_recoverable',
  };
  return mapping[input.taskStatus] ?? 'director_review';
}

export interface BuildSocialAgentWorkflowInput {
  taskId: string;
  taskVersion: string;
  taskStatus: SocialContentTaskStatus;
  mode: 'weekly' | 'instant';
  weeklyPlanId: string | null;
  brief: SocialContentTaskBrief;
  sources: SocialTaskSource[];
  factSourceRefs: string[];
  assetSupplyPlan: SocialAssetSupplyPlan;
  referenceAnalysis: SocialReferenceVideoAnalysis | null;
  replicationScript: SocialReplicationScriptVersion | null;
}

/**
 * Compatibility projection for the unified Business → Director → Content
 * chain. Historic storage remains readable; new clients consume agent-owned
 * objects without allowing the Director to lock assets or providers.
 */
export function buildSocialAgentWorkflow(input: BuildSocialAgentWorkflowInput): SocialContentAgentWorkflow {
  const context = buildBusinessContext(input);
  const discoveryBrief = buildDiscoveryBrief(input);
  const inspirationHandoffs = buildInspirationHandoffs(input);
  const directorBrief = buildDirectorBrief(input, context, inspirationHandoffs);
  const executionPlan = buildExecutionPlan(input, directorBrief);
  const executionPlanReview = buildReview(input, directorBrief, executionPlan);
  executionPlan.status = executionPlanReview.approved ? 'approved' : 'blocked';
  return {
    schemaVersion: 'social-content-agent-workflow.v1',
    stage: taskStage(input, executionPlanReview),
    contentPlanId: stableId('content_plan', { weeklyPlanId: input.weeklyPlanId, taskId: input.taskId }),
    videoTaskId: input.taskId,
    weeklyPackage: context.weeklyPackage,
    adHocBusinessContext: context.adHocBusinessContext,
    discoveryBrief,
    inspirationHandoffs,
    directorBrief,
    executionPlan,
    executionPlanReview,
    productionResult: null,
  };
}
