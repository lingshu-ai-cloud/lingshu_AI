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
  SocialReplicationFactorSpec,
  SocialReplicationJob,
  SocialReplicationJobContext,
  SocialReplicationReferenceChain,
  SocialReplicationReferenceMode,
  SocialReplicationScriptShot,
  SocialReplicationScriptVersion,
  SocialShotSourceStrategy,
  SocialShotTruthBoundary,
  SocialTaskSource,
  SocialWeeklyContentPackage,
} from '../../shared/contracts/socialContentWorkflow.js';
import {
  buildSocialReplicationFactorSpecs,
  buildSocialTimelineBeats,
  inferSocialReplicationReferenceMode,
} from '../../shared/socialInspirationStrategy.js';
import { socialRequestHash } from './socialContentValidation.js';
import type { BusinessContentGoal } from '../../shared/contracts/socialOperatingDecision.js';
import type {
  SocialWeeklyPublicationTask,
  VersionedSocialRef,
  WeeklyOperatingPackage,
  WeeklyWorkflowTask,
} from '../../shared/contracts/socialProgram.js';
import type { VersionedReferenceSelection } from '../socialDiscovery/orchestration.js';

import {
  buildBusinessContext,
  buildDiscoveryBrief,
  buildInspirationHandoffs,
  buildReplicationJob,
  authoritativeHandoffs,
  EMBEDDED_RUNTIME_REGISTRATIONS,
  mergeInspirationHandoffs,
  positiveNumber,
  socialContentCapabilityRegistry,
  stableId,
  unique,
  type SocialContentCapabilityRuntimeRegistration,
} from './socialContentAgentWorkflowContext.js';
export type {
  SocialContentCapabilityRuntime,
  SocialContentCapabilityRuntimeRegistration,
} from './socialContentAgentWorkflowContext.js';
export { socialContentCapabilityRegistry } from './socialContentAgentWorkflowContext.js';
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
  replicationFactors: SocialReplicationFactorSpec[];
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
      ...input.replicationFactors.map(factor => `裂变因素 ${factor.factorId}：${factor.target.metric} 达到目标并通过 ${factor.validator.detector}`),
      ...(boundary.mustNotImplyCustomerReality ? ['合成或通用画面不得被表述为客户真实证据'] : []),
    ]),
    replicationFactors: input.replicationFactors.map(factor => ({
      factorId: factor.factorId,
      factorSpecVersion: factor.version,
      category: factor.category,
      policy: factor.policy,
      importance: factor.importance,
      target: structuredClone(factor.target),
      tolerance: structuredClone(factor.tolerance),
      validator: structuredClone(factor.validator),
    })),
    fidelityPoints: input.script?.fidelityPoints ?? input.reference?.fidelityPoints ?? [],
    mustDifferPoints: input.script?.mustDifferPoints ?? input.reference?.mustDifferPoints ?? [],
  };
}

function buildDirectorBrief(
  input: BuildSocialAgentWorkflowInput,
  context: ReturnType<typeof buildBusinessContext>,
  inspirationHandoffs: SocialInspirationHandoff[],
  replicationJob: SocialReplicationJob | null,
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
      replicationFactors: replicationJob?.factorSpecs.filter(factor => (
        factor.referenceShotId === (script?.referenceShotId ?? input.referenceAnalysis?.shots[index]?.shotId ?? null)
      )) ?? [],
    });
  }).filter((scene): scene is SocialDirectorBriefScene => Boolean(scene));
  const coverage = input.referenceAnalysis?.coverage;
  const referenceRequired = input.brief.creationMode === 'viral_replication';
  const referenceReady = !referenceRequired || Boolean(input.referenceAnalysis?.status === 'ready' && coverage?.fullTimelineCovered !== false);
  const factorsReady = !referenceRequired || replicationJob?.status === 'factor_ready';
  const orderedScenes = [...scenes].sort((left, right) => left.order - right.order);
  const timelineValid = orderedScenes.every((scene, index) => scene.duration.endSeconds > scene.duration.startSeconds
    && (index === 0 || scene.duration.startSeconds >= orderedScenes[index - 1]!.duration.endSeconds));
  // Five Han characters or 2.7 whitespace-delimited words per second is a
  // deliberately conservative, deterministic speech-capacity gate.
  const dialogueFits = scenes.every(scene => {
    const speech = scene.audioLayers.dialogue ?? scene.audioLayers.voiceover;
    if (!speech) return true;
    const units = /[\u3400-\u9fff]/.test(speech)
      ? [...speech].filter(char => /[\u3400-\u9fff]/.test(char)).length
      : speech.trim().split(/\s+/).filter(Boolean).length;
    const capacity = /[\u3400-\u9fff]/.test(speech) ? scene.duration.targetSeconds * 5 : scene.duration.targetSeconds * 2.7;
    return units <= Math.max(1, capacity);
  });
  const status = scenes.length > 0 && referenceReady && factorsReady && timelineValid && dialogueFits ? 'ready' : 'blocked';
  const totalDurationSeconds = Math.max(0, ...scenes.map(scene => scene.duration.endSeconds));
  return {
    directorBriefId: stableId('director_brief', { taskId: input.taskId }),
    version: input.taskVersion,
    status,
    source: {
      weeklyPackageId: context.weeklyPackage?.packageId ?? null,
      adHocBusinessContextId: context.adHocBusinessContext?.contextId ?? null,
    },
    replicationJobRef: replicationJob ? {
      replicationJobId: replicationJob.replicationJobId,
      version: replicationJob.version,
      factorSpecVersion: replicationJob.factorSpecVersion,
    } : null,
    referenceMode: replicationJob?.referenceMode ?? null,
    accountPlaybookRef: replicationJob?.target.accountPlaybookRef ?? null,
    referenceAnalysis: input.referenceAnalysis ? {
      analysisId: input.referenceAnalysis.analysisId,
      version: input.referenceAnalysis.version || input.taskVersion,
      fullDurationSeconds: coverage?.fullDurationSeconds ?? input.referenceAnalysis.durationSeconds,
      precisionIntervals: coverage?.precisionIntervals ?? input.referenceAnalysis.shots.map(shot => ({ startSeconds: shot.startSeconds, endSeconds: shot.endSeconds, level: 'L3' as const })),
      gaps: coverage?.gaps ?? [],
      overallConfidence: coverage?.overallConfidence ?? null,
    } : null,
    inspirationHandoffIds: inspirationHandoffs.map(item => item.handoffId ?? item.inspirationId),
    topic: input.brief.title,
    audience: input.brief.audience,
    platforms: input.brief.platforms,
    accountRefs: input.authoritativeContext ? [input.authoritativeContext.publicationTask.accountId] : [],
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
    factSourceRefs: input.authoritativeContext
      ? unique(input.authoritativeContext.publicationTask.factRefs.map(ref => `${ref.type}:${ref.id}@${ref.version}`))
      : input.factSourceRefs,
    rightsConstraints: unique([
      '参考视频只用于分析结构和节奏，不复制原片素材、人物、声音、商标或原文案',
      ...(input.assetSupplyPlan.status === 'requires_rights_confirmation' ? ['参考内容或素材权利尚待确认'] : []),
    ]),
    referenceEvidence: [
      ...(input.referenceAnalysis ? input.referenceAnalysis.shots.map(shot => ({
        analysisId: input.referenceAnalysis!.analysisId,
        referenceShotId: shot.shotId,
        transferable: [...shot.fidelityPoints],
        mustReplace: [...shot.mustDifferPoints],
      })) : []),
      ...inspirationHandoffs
        .filter(handoff => handoff.analysisId !== input.referenceAnalysis?.analysisId)
        .map(handoff => ({
          analysisId: handoff.analysisId,
          referenceShotId: null,
          transferable: [...handoff.adaptationBoundary.reusable],
          mustReplace: [...handoff.adaptationBoundary.mustReplace, ...handoff.adaptationBoundary.prohibited],
        })),
    ],
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
  capabilityRuntime?: SocialContentCapabilityRuntimeRegistration[];
}): SocialExecutionCandidate[] {
  const runtimeRegistration = new Map((input.capabilityRuntime ?? EMBEDDED_RUNTIME_REGISTRATIONS)
    .map(item => [item.strategy, item]));
  const sourceRuntime = runtimeRegistration.get(input.supply.sourceStrategy);
  const sourceExecutable = Boolean(sourceRuntime?.environmentReady && sourceRuntime.adapterIds.length);
  const actualAssets = (sourceExecutable ? input.supply.sourceRefs : []).map((sourceRef, index): SocialExecutionCandidate => ({
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
    providerId: sourceRuntime?.adapterIds[0] ?? null,
    modelId: null,
    clipId: sourceRef,
    timeRange: null,
    promptRef: null,
    retryPolicy: { maxAttempts: 1, fallbackStrategies: input.supply.fallbackSourceStrategy ? [input.supply.fallbackSourceStrategy] : [] },
    provenance: { origin: 'customer', inputVersion: input.taskVersion, authorizationRef: sourceRef, executionRecordId: null },
  }));
  const capabilityRows = socialContentCapabilityRegistry(input.capabilityRuntime)
    .filter(capability => capability.executable)
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
      providerId: capability.registeredAdapterIds[0] ?? null,
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
  capabilityRuntime?: SocialContentCapabilityRuntimeRegistration[];
}): SocialContentExecutionScenePlan {
  const candidates = capabilityCandidates({ ...input, sceneId: input.scene.sceneId });
  const preferred = candidates.find(candidate => candidate.sourceStrategy === input.supply.sourceStrategy) ?? candidates[0];
  const fallback = candidates.find(candidate => candidate.sourceStrategy === input.supply.fallbackSourceStrategy && candidate.candidateId !== preferred?.candidateId);
  return {
    sceneId: input.scene.sceneId,
    replicationFactorIds: (input.scene.replicationFactors ?? []).map(factor => factor.factorId),
    factorFeasibility: (input.scene.replicationFactors ?? []).map(factor => ({
      factorId: factor.factorId,
      feasible: Boolean(preferred),
      reason: preferred ? `由推荐候选 ${preferred.label} 承担，并在成片后由 ${factor.validator.detector} 独立检测` : '当前没有可执行候选',
      plannedValidatorId: factor.validator.validatorId,
    })),
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
    return supply ? [executionScene({
      taskId: input.taskId,
      taskVersion: input.taskVersion,
      scene,
      supply,
      capabilityRuntime: input.capabilityRuntime,
    })] : [];
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
  const requiredFactorIds = (input.scene.replicationFactors ?? []).map(factor => factor.factorId);
  const plannedFactorIds = new Set(input.plan.replicationFactorIds ?? []);
  const missingFactorIds = requiredFactorIds.filter(factorId => !plannedFactorIds.has(factorId));
  const infeasibleFactorIds = (input.plan.factorFeasibility ?? []).filter(item => !item.feasible).map(item => item.factorId);
  if (missingFactorIds.length || infeasibleFactorIds.length) {
    failedCriteria.push(`存在未被执行方案承接的裂变因素：${unique([...missingFactorIds, ...infeasibleFactorIds]).join('、')}`);
    requiredRevision.push('为每个冻结因素补充可执行候选和独立检测器，不得通过放宽因素规格绕过');
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

function taskStage(input: BuildSocialAgentWorkflowInput, review: SocialExecutionPlanReview, replicationJob: SocialReplicationJob | null): SocialAgentWorkflowStage {
  if (!review.approved) {
    if (review.reasonCodes.includes('rights_missing')) return 'needs_rights';
    if (review.reasonCodes.includes('facts_missing')) return 'needs_facts';
    if (review.reasonCodes.includes('budget_exceeded')) return 'needs_budget';
    if (review.sceneResults.some(result => result.feasibility === 'goal_degraded')) return 'goal_degraded';
    if (replicationJob?.status === 'factor_ready') return 'factor_ready';
    if (replicationJob?.status === 'reference_ready' || replicationJob?.status === 'blocked') return 'reference_ready';
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
  /** Optional versioned account/content lineage; omitted on historic tasks. */
  replicationContext?: SocialReplicationJobContext;
  /** Additional references used only by series/hybrid modes. */
  inspirationHandoffs?: SocialInspirationHandoff[];
  /** Frozen T3/T4 authority. When present, legacy weeklyPlanId and caller facts are projections only. */
  authoritativeContext?: {
    programRef: VersionedSocialRef;
    enterpriseProfileRef: VersionedSocialRef;
    weeklyPackage: WeeklyOperatingPackage;
    weeklyWorkflowTask: WeeklyWorkflowTask;
    publicationTask: SocialWeeklyPublicationTask;
    businessGoal: BusinessContentGoal;
    referenceSelection: VersionedReferenceSelection;
    selectedHandoffs: SocialInspirationHandoff[];
  };
  /** Runtime registrations after adapter and environment readiness checks. Omit to use only embedded adapters. */
  capabilityRuntime?: SocialContentCapabilityRuntimeRegistration[];
  now?: Date;
}

function assertAuthoritativeContext(input: BuildSocialAgentWorkflowInput): void {
  const authority = input.authoritativeContext;
  if (!authority) return;
  const packageTask = authority.weeklyPackage.workflowTasks.find(item => item.taskId === authority.weeklyWorkflowTask.taskId);
  const publicationTask = authority.weeklyPackage.socialContentPackage.publicationTasks
    .find(item => item.publicationTaskId === authority.publicationTask.publicationTaskId);
  if (authority.weeklyPackage.programId !== authority.programRef.id
    || authority.businessGoal.programId !== authority.weeklyPackage.programId
    || authority.weeklyPackage.businessContentGoalRef?.id !== authority.businessGoal.goalId
    || authority.weeklyPackage.enterpriseProfileRef?.id !== authority.enterpriseProfileRef.id
    || !packageTask || packageTask.kind !== 'content' || !publicationTask
    || !packageTask.subjectRefs.some(ref => ref.type === 'weekly_publication_task'
      && ref.id === publicationTask.publicationTaskId && ref.version === authority.weeklyPackage.version)
    || publicationTask.factRefs.some(factRef => !authority.businessGoal.publicFactRefs.some(goalFact => (
      goalFact.type === factRef.type && goalFact.id === factRef.id && goalFact.version === factRef.version
    )))
    || authority.referenceSelection.upstreamTaskRef !== authority.weeklyWorkflowTask.taskId) {
    throw new Error('social_content_authoritative_context_mismatch');
  }
  const mode = input.replicationContext?.referenceMode ?? input.brief.referenceMode;
  if (mode === 'single_source_fidelity') {
    const selected = authority.referenceSelection.selected;
    if (selected.length !== 1 || selected[0]?.readiness !== 'production_reference') {
      throw new Error('social_content_fidelity_primary_reference_required');
    }
  }
}

/**
 * Compatibility projection for the unified Business → Director → Content
 * chain. Historic storage remains readable; new clients consume agent-owned
 * objects without allowing the Director to lock assets or providers.
 */
export function buildSocialAgentWorkflow(input: BuildSocialAgentWorkflowInput): SocialContentAgentWorkflow {
  assertAuthoritativeContext(input);
  const context = buildBusinessContext(input);
  const discoveryBrief = buildDiscoveryBrief(input);
  const inspirationHandoffs = mergeInspirationHandoffs(
    input.authoritativeContext ? [] : buildInspirationHandoffs(input),
    authoritativeHandoffs(input),
  );
  const replicationJob = buildReplicationJob(input, context, inspirationHandoffs);
  const directorBrief = buildDirectorBrief(input, context, inspirationHandoffs, replicationJob);
  if (replicationJob?.status === 'factor_ready' && directorBrief.status === 'ready') replicationJob.status = 'director_ready';
  const executionPlan = buildExecutionPlan(input, directorBrief);
  const executionPlanReview = buildReview(input, directorBrief, executionPlan);
  executionPlan.status = executionPlanReview.approved ? 'approved' : 'blocked';
  return {
    schemaVersion: 'social-content-agent-workflow.v2',
    stage: taskStage(input, executionPlanReview, replicationJob),
    contentPlanId: stableId('content_plan', { weeklyPlanId: input.weeklyPlanId, taskId: input.taskId }),
    videoTaskId: input.taskId,
    weeklyPackage: context.weeklyPackage,
    adHocBusinessContext: context.adHocBusinessContext,
    discoveryBrief,
    inspirationHandoffs,
    replicationJob,
    responsibilityBoundary: {
      businessGoalOwner: 'business_agent',
      factorDecisionOwner: 'director_agent',
      executionOwner: 'content_agent',
      metricEvidenceProvider: 'metrics_worker',
      mediaEvidenceProvider: 'media_evaluation_worker',
      finalGateOrder: ['content_agent', 'media_evaluation_worker', 'director_agent', 'business_agent', 'rules_engine'],
      selfApprovalForbidden: true,
    },
    directorBrief,
    executionPlan,
    executionPlanReview,
    productionResult: null,
    replicationEvaluation: null,
  };
}
