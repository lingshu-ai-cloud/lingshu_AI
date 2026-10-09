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
  normalizeSceneVisualContract,
  scoreSceneVisualCompatibility,
  type SocialMaterialRole,
  type SocialProductPolicy,
  type SocialProductPolicySource,
  type SocialSceneVisualContract,
} from '../../shared/sceneVisualContract.js';
import type { SocialReferenceReviewHandoff } from './socialReferenceReviewHandoff.js';

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

export interface SocialWorkflowMaterialCandidate {
  assetId: string;
  sourceRef: string;
  label: string;
  mediaType: 'video' | 'image';
  previewUrl: string | null;
  origin: 'my_materials' | 'shared_library';
  matchedVoiceoverCueIds: string[];
  matchScore: number;
  segmentId?: string;
  productId?: string | null;
  productRef?: string | null;
  enterpriseCommon?: boolean;
  productPolicy?: SocialProductPolicy;
  materialRoles?: SocialMaterialRole[];
  visualContract?: SocialSceneVisualContract;
  timeRange?: { startSeconds: number; endSeconds: number } | null;
}
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
  const subjectLabel = boundary.subject === 'customer_factory' ? '优先使用“我的素材”中的真实工厂或生产过程'
    : boundary.subject === 'customer_case' ? '优先使用“我的素材”中的客户案例'
      : boundary.subject === 'product_effect' ? '人物使用产品的效果镜头使用数字人路线'
        : null;
  return unique([
    ...(subjectLabel ? [subjectLabel] : []),
    ...(purpose === 'proof' ? ['直接优先调用已入库的工厂、客户案例或产品效果素材'] : []),
  ]);
}

function sceneProductSelection(input: BuildSocialAgentWorkflowInput): {
  policy: SocialProductPolicy;
  source: SocialProductPolicySource;
  productId: string | null;
  productRef: string | null;
} {
  if (input.brief.productId || input.brief.productRef) return {
    policy: 'locked', source: 'user_explicit',
    productId: input.brief.productId ?? null,
    productRef: input.brief.productRef,
  };
  if (input.inferredProductRef) return { policy: 'preferred', source: 'agent_inferred', productId: null, productRef: input.inferredProductRef };
  return { policy: 'open', source: 'inventory_open', productId: null, productRef: null };
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

function visualTopicFor(reference: SocialReferenceShotAnalysis | undefined, targetVisual: string, intent: string): NonNullable<SocialDirectorBriefScene['visualTopic']> {
  const subject = reference?.semanticLabel?.content || targetVisual;
  const description = [subject, reference?.visualDescription, ...(reference?.tags.sceneTypes ?? [])].filter(Boolean).join(' ');
  const personIsForeground = /(?:女|男)?主播|人物|真人|女性|男性|口播|数字人|presenter|talking/i.test(description)
    && !/背影|背景人物|远景人物|路人|人群|silhouette|background person/i.test(description);
  const personHasAction = /手势|靠近|凑近|转身|敲门|gesture|approach/i.test(description);
  const kind = personIsForeground && personHasAction ? 'presenter_talking'
    : /工厂|车间|生产线|灌装|factory|manufactur/i.test(description) ? 'factory_footage'
    : /竞品|对比|比较|before.?after|competitor|comparison/i.test(description) ? 'competitor_comparison'
      : /产品|商品|包装|质地|瓶身|product|packaging/i.test(description) ? 'product_introduction'
      : /口播|主播|人物|真人|数字人|女性|男性|女主播|男主播|presenter|talking/i.test(description) ? 'presenter_talking' : 'other';
  const personRole = /背影|背景人物|远景人物|路人|人群|silhouette|background person/i.test(description) ? 'background'
    : /手势|靠近|凑近|转身|敲门|双臂|手臂|动作|gesture|approach/i.test(description) && personIsForeground ? 'expressive_action'
      : /口播|说话|对镜|口型|唇|talking|speaking/i.test(description) && personIsForeground ? 'visible_speech'
        : personIsForeground ? 'visible_speech' : 'none';
  return { kind, subject, intent: reference?.semanticLabel?.intent || intent, personRole };
}

function directorScene(input: {
  index: number;
  script: SocialReplicationScriptShot | null;
  supply: SocialAssetSupplyShotPlan;
  reference: SocialReferenceShotAnalysis | undefined;
  replicationFactors: SocialReplicationFactorSpec[];
  productSelection: ReturnType<typeof sceneProductSelection>;
  primaryHook: SocialReferenceVideoAnalysis['hookAnalysis'];
  enterprisePresenterAssetRef: string | null;
}): SocialDirectorBriefScene {
  const startSeconds = input.script?.startSeconds ?? input.reference?.startSeconds ?? input.index * 3;
  const endSeconds = input.script?.endSeconds ?? input.reference?.endSeconds ?? startSeconds + 3;
  const targetVisual = input.script?.visualInstruction || input.supply.requestedDescription || '用清楚、可验证的画面完成本镜头的信息作用';
  // Each line can be associated with several visual cuts, but only its owner
  // shot plays the narration. This avoids repeating one sentence at every cut.
  const spokenText = input.script?.speechLines
    ?.filter(line => !line.narrationOwnerShotId || line.narrationOwnerShotId === input.script?.shotId)
    .map(line => line.draftText.trim()).filter(Boolean).join(' ')
    || input.script?.spokenText || null;
  const boundary = safeBoundary(input.supply.truthBoundary);
  const evidence = requiredEvidence(boundary, input.supply.function);
  const visualContract = normalizeSceneVisualContract({
    ...(input.supply.visualContract ?? input.reference?.visualContract ?? {
      subjects: input.reference?.tags.subjects ?? [],
      interaction: input.reference?.action?.path ?? targetVisual,
      environment: input.reference?.tags.sceneTypes?.[0] ?? '',
      action: input.reference?.action ?? { path: targetVisual },
      shotLanguage: input.reference?.shotLanguage ?? shotLanguage(input.reference),
      evidence: { sourceRange: { startSeconds, endSeconds } },
    }),
    product: {
      policy: input.productSelection.policy,
      requestedProductId: input.productSelection.productId,
      requestedProductRef: input.productSelection.productRef,
      source: input.productSelection.source,
    },
    precision: startSeconds < 3 ? 'hook_high' : 'standard',
  });
  const reference = input.reference;
  const referenceRouting = reference?.referenceProductionRouting;
  const identityLockedPresenter = referenceRouting?.state === 'ready' && referenceRouting.route === 'reference_frame_presenter';
  const presenterVisible = referenceRouting ? Boolean(identityLockedPresenter) : Boolean(reference && /真人|人物|人像|口播|数字人|主播|女性|男性|模特|presenter|person|human|face|talking/i.test([
    reference.visualDescription, reference.semanticLabel?.content, ...reference.tags.subjects,
  ].filter(Boolean).join(' ')));
  const isPrimaryHook = Boolean(reference && input.primaryHook?.referencePoints.includes(reference.shotId));
  const needsExpressiveAction = Boolean(reference && /手势|指向|凑近|靠近|转身|拿起|展示|动作|gesture|approach|point|move/i.test([
    reference.visualDescription, reference.action?.path, reference.semanticLabel?.content,
  ].filter(Boolean).join(' ')));
  const needsCameraOrCompositionReconstruction = Boolean(isPrimaryHook || (reference && /推进|拉远|运镜|构图|特写|镜头|camera|composition|zoom|pan/i.test([
    reference.visualDescription, reference.shotLanguage?.movement, reference.shotLanguage?.composition,
  ].filter(Boolean).join(' '))));
  const personRole = identityLockedPresenter ? referenceRouting.observedPresenterRole === 'presenter_action' ? 'expressive_action' : 'visible_speech'
    : visualTopicFor(reference, targetVisual, input.supply.function).personRole;
  const visibleMouth = personRole === 'visible_speech' || (personRole === 'expressive_action'
    && /口播|说话|对镜|唇|talking|speaking/i.test([
      reference?.visualDescription, reference?.semanticLabel?.content,
    ].filter(Boolean).join(' ')));
  const needsPreciseLipSync = presenterVisible && visibleMouth && Boolean(spokenText || reference?.spokenText);
  return {
    sceneId: input.script?.shotId || input.supply.shotId,
    order: input.index + 1,
    referenceShotId: input.script?.referenceShotId ?? input.reference?.shotId ?? null,
    ...(referenceRouting ? { referenceProductionRouting: structuredClone(referenceRouting) } : {}),
    visualTopic: visualTopicFor(input.reference, targetVisual, input.supply.function),
    ...(reference ? {
      referenceMaterial: {
        semanticLabel: reference.semanticLabel ?? null,
        sourceVideoRef: reference.materialEvidence?.sourceVideoRef ?? null,
        clipRef: reference.materialEvidence?.clipRef ?? null,
        firstFrameRef: reference.materialEvidence?.firstFrameRef ?? null,
        firstFrameSeconds: reference.materialEvidence?.firstFrameSeconds ?? null,
        extractionStatus: reference.materialEvidence?.extractionStatus ?? 'unavailable' as const,
        isPrimaryHook,
        hookDetail: isPrimaryHook ? input.primaryHook?.detailedAnalysis ?? null : null,
      },
      productionRouting: {
        presenterVisible,
        presenterIdentityReplacementRequired: presenterVisible && personRole !== 'background',
        enterprisePresenterAssetRef: presenterVisible && personRole !== 'background' ? input.enterprisePresenterAssetRef : null,
        needsPreciseLipSync,
        needsExpressiveAction,
        needsCameraOrCompositionReconstruction,
        decisionReason: [
          ...(presenterVisible ? ['人物镜头必须使用原分镜首帧作为构图证据，并替换为企业人物身份'] : []),
          ...(needsPreciseLipSync ? ['镜头包含可见人物口播，需校验逐字口型同步'] : []),
          ...(needsExpressiveAction ? ['镜头含动作或手势，需保留动作轨迹'] : []),
          ...(needsCameraOrCompositionReconstruction ? ['镜头含钩子或明确镜头语言，需还原构图与运镜'] : []),
        ],
      },
    } : {}),
    purpose: input.supply.function,
    targetVisual,
    visualContract,
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
      voiceover: spokenText,
      dialogue: null,
      captionIntent: input.script?.captionText ?? null,
      ambient: input.reference?.audioDescription ?? null,
      music: input.script?.audioAndTransition ?? null,
      soundEffects: null,
    },
    ...(input.script?.speechLines?.length ? {
      voiceoverLines: input.script.speechLines.map(line => ({
        lineId: line.lineId || `${input.script?.shotId}:line:${line.sourceStartSeconds}`,
        text: line.draftText,
        sourceStartSeconds: line.sourceStartSeconds,
        sourceEndSeconds: line.sourceEndSeconds,
        narrationOwnerShotId: line.narrationOwnerShotId || input.script?.shotId || input.supply.shotId,
        visualShotIds: [...(line.visualShotIds?.length ? line.visualShotIds : [input.script?.shotId || input.supply.shotId])],
        isNarrationOwner: !line.narrationOwnerShotId || line.narrationOwnerShotId === input.script?.shotId,
      })),
    } : {}),
    ...(spokenText ? {
      voiceoverAlignment: {
        cueId: `${input.script?.shotId ?? input.supply.shotId}:voiceover`,
        text: spokenText,
        startSeconds,
        endSeconds,
        matchMode: 'verbatim_semantic' as const,
        secondaryVisualTags: unique([
          input.supply.function,
          input.supply.requestedDescription || '',
          ...(input.reference?.tags.subjects ?? []),
          ...(input.reference?.action ? [input.reference.action.startState, input.reference.action.path, input.reference.action.endState] : []),
          ...(input.reference?.tags.sceneTypes ?? []),
        ].filter(Boolean)),
      },
    } : {}),
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
      ...(startSeconds < 3 ? [
        '前三秒钩子必须逐帧核对主体出现时间、动作峰值、构图、运镜、字幕与声音触发，不得用粗标签近似替代',
        '前三秒候选素材必须同时通过逐句口播语义、主体动作、节奏和清晰度高阈值',
      ] : []),
      ...(presenterVisible ? ['必须提取该分镜的原始首帧，并以企业人物资产替换人物身份；全片人物身份保持一致'] : []),
      ...(isPrimaryHook ? ['开场钩子须依据原分镜首帧、动作轨迹、构图与逐镜脚本做高精度复刻'] : []),
      ...evidence.map(item => `证据要求：${item}`),
      ...input.replicationFactors.map(factor => `裂变因素 ${factor.factorId}：${factor.target.metric} 达到目标并通过 ${factor.validator.detector}`),
      ...(boundary.mustNotImplyCustomerReality ? ['合成或通用画面不得被表述为客户真实证据'] : []),
      ...(input.supply.productSceneReplication ? [
        '产品身份相似度、Logo 与标签 OCR 必须通过，不得重设计产品',
        '场景拓扑、产品槽位和镜头轨迹必须在冻结容差内，不得退化为单图平移缩放',
      ] : []),
    ]),
    ...(input.supply.productSceneReplication ? {
      productSceneReplication: structuredClone(input.supply.productSceneReplication),
    } : {}),
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
  const productSelection = sceneProductSelection(input);
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
      productSelection,
      primaryHook: input.referenceAnalysis?.hookAnalysis ?? null,
      enterprisePresenterAssetRef: input.assetSupplyPlan.accountPresenterLock?.presenterAssetId ?? null,
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
    if (scene.voiceoverAlignment?.matchMode === 'verbatim_semantic') return true;
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
  const inferredProductRef = productSelection.productRef;
  const requirementText = [
    inferredProductRef,
    ...scenes.map(scene => `${scene.targetVisual} ${scene.audioLayers.voiceover || ''}`),
    ...(input.referenceAnalysis?.shots ?? []).map(shot => `${shot.visualDescription} ${shot.tags.subjects.join(' ')} ${shot.tags.sceneTypes.join(' ')}`),
  ].filter(Boolean).join(' ');
  const productRequired = /产品|商品|包装|瓶|罐|盒|product|package|bottle|jar/i.test(requirementText);
  const materialKinds = unique([
    ...(productRequired ? ['product'] : []),
    ...(/工厂|车间|产线|factory|workshop/i.test(requirementText) ? ['factory'] : []),
    ...(/人物|真人|口播|person|presenter|human/i.test(requirementText) ? ['person'] : []),
    ...(/场景|环境|使用|scenario|environment/i.test(requirementText) ? ['scenario'] : []),
    ...(/细节|特写|detail|close/i.test(requirementText) ? ['detail'] : []),
  ]) as NonNullable<SocialDirectorBrief['contentRequirements']>['primaryMaterialKinds'];
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
    accountPresenterLock: input.assetSupplyPlan.accountPresenterLock
      ? structuredClone(input.assetSupplyPlan.accountPresenterLock)
      : null,
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
    contentRequirements: {
      product: {
        required: productRequired,
        productId: productRequired ? productSelection.productId : null,
        productRef: productRequired ? inferredProductRef : null,
        policy: productSelection.policy,
        source: productSelection.source,
        confidence: productRequired ? (inferredProductRef ? 0.9 : 0.55) : 0.75,
        reason: productRequired
          ? inferredProductRef ? '用户已选产品或系统已从企业中心与素材库自动优选' : '未指定产品，按 open 策略使用当前最匹配的产品或企业通用素材'
          : '参考视频未要求产品主体持续出镜',
      },
      enterpriseFacts: {
        required: false,
        factSourceRefs: input.factSourceRefs,
        reason: '内容制作前不要求用户补填事实；企业信息自动来自企业中心',
      },
      primaryMaterialKinds: materialKinds.length ? materialKinds : ['general'],
    },
    rightsConstraints: unique([
      '参考视频的口播逐字冻结，仅替换企业名、品牌名和产品名',
      '已入库的工厂、客户案例和企业通用素材可直接进入匹配与剪辑',
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
  scene: SocialDirectorBriefScene;
  supply: SocialAssetSupplyShotPlan;
  capabilityRuntime?: SocialContentCapabilityRuntimeRegistration[];
  materialCandidates?: SocialWorkflowMaterialCandidate[];
}): SocialExecutionCandidate[] {
  const runtimeRegistration = new Map((input.capabilityRuntime ?? EMBEDDED_RUNTIME_REGISTRATIONS)
    .map(item => [item.strategy, item]));
  const sourceRuntime = runtimeRegistration.get(input.supply.sourceStrategy);
  // Product image refs are inputs to the paid scene-generation capability,
  // not zero-cost finished clips. Keeping them out of `actualAssets` makes the
  // confirmation card report the real Seedream + Seedance route and estimate.
  const generatedInputStrategies: SocialShotSourceStrategy[] = [
    'aigc_product_scene_replication',
    'authorized_digital_presenter',
  ];
  const finishedAssetRefs = generatedInputStrategies.includes(input.supply.sourceStrategy)
    ? [] : input.supply.sourceRefs;
  const explicitAssetRows = finishedAssetRefs.flatMap<{ sourceRef: string; material: SocialWorkflowMaterialCandidate | null }>(sourceRef => {
    const rows = input.materialCandidates?.filter(item => item.sourceRef === sourceRef || item.assetId === sourceRef) ?? [];
    return rows.length
      ? rows.map(material => ({ sourceRef, material }))
      : [{ sourceRef, material: null }];
  });
  // Ordinary later shots can reuse owned clips when topic and purpose fit.
  // Opening hooks retain their reference mechanism and are not auto-replaced.
  const topic = input.scene.visualTopic;
  const sceneCueIds = new Set([
    `${input.sceneId}:voiceover`,
    ...(input.scene.voiceoverLines ?? []).map(line => line.lineId),
  ]);
  const matchesSceneSpeech = (material: SocialWorkflowMaterialCandidate) =>
    material.matchedVoiceoverCueIds.some(cueId => sceneCueIds.has(cueId));
  const localAssetRows = (input.materialCandidates ?? [])
    .filter(() => input.supply.function !== 'hook' && !input.scene.referenceMaterial?.isPrimaryHook)
    .filter(material => material.origin === 'my_materials' && material.mediaType === 'video' && material.visualContract)
    .filter(material => !input.scene.productionRouting?.presenterIdentityReplacementRequired)
    .filter(material => topic?.kind !== 'competitor_comparison' || !input.supply.truthBoundary.customerEvidenceRequired)
    .filter(material => (input.scene.visualContract ?? input.supply.visualContract)
      && scoreSceneVisualCompatibility(input.scene.visualContract ?? input.supply.visualContract, material.visualContract) >= 0.8)
    .filter(material => {
      const subject = topic?.subject ?? '';
      const words = subject.match(/[\u4e00-\u9fff]{2,4}|[a-z]{4,}/gi) ?? [];
      return words.some(word => material.label.toLowerCase().includes(word.toLowerCase()))
        || matchesSceneSpeech(material);
    })
    .map(material => ({ sourceRef: material.sourceRef, material }));
  const actualAssetRows = [...explicitAssetRows, ...localAssetRows.filter(row =>
    !explicitAssetRows.some(explicit => explicit.sourceRef === row.sourceRef))];
  const actualAssets = actualAssetRows.map(({ sourceRef, material }, index): SocialExecutionCandidate => {
    const cueMatched = material ? matchesSceneSpeech(material) : false;
    const normalizedMatch = material ? Math.max(0, Math.min(1, material.matchScore / 1_000)) : 0;
    const visualScore = material?.visualContract && (input.scene.visualContract ?? input.supply.visualContract)
      ? scoreSceneVisualCompatibility(input.scene.visualContract ?? input.supply.visualContract, material.visualContract)
      : 0.65;
    const semanticScore = material
      ? Math.min(1, (cueMatched ? 0.82 : 0.55) + normalizedMatch * 0.18)
      : 0.5;
    return ({
    candidateId: stableId('candidate', {
      sceneId: input.sceneId,
      sourceRef,
      segmentId: material?.segmentId ?? null,
      timeRange: material?.timeRange ?? null,
    }),
    kind: 'asset',
    label: material?.label || `已入库素材 ${index + 1}`,
    sourceRef,
    sourceStrategy: material && !finishedAssetRefs.includes(sourceRef) ? 'customer_real_asset' : input.supply.sourceStrategy,
    evidenceStrength: input.supply.truthBoundary.customerEvidenceRequired ? 'strong' : 'supporting',
    rightsStatus: 'confirmed',
    enterpriseOwnershipScore: material?.origin === 'shared_library' ? 0.6 : 1,
    semanticScore,
    evidenceScore: input.supply.truthBoundary.customerEvidenceRequired ? 1 : 0.8,
    actionAndShotScore: visualScore,
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
    timeRange: material?.timeRange ?? null,
    promptRef: null,
    previewUrl: material?.previewUrl ?? null,
    mediaType: material?.mediaType ?? null,
    matchedVoiceoverCueIds: material?.matchedVoiceoverCueIds ?? [],
    productId: material?.productId ?? null,
    productRef: material?.productRef ?? null,
    enterpriseCommon: material?.enterpriseCommon ?? false,
    materialRoles: material?.materialRoles ?? [],
    ...(material?.visualContract && material.segmentId && material.timeRange ? {
      materialSegments: [{
        segmentId: material.segmentId,
        startSeconds: material.timeRange.startSeconds,
        endSeconds: material.timeRange.endSeconds,
        visualContract: structuredClone(material.visualContract),
        materialRoles: [...(material.materialRoles ?? [])],
        matchedVoiceoverCueIds: [...material.matchedVoiceoverCueIds],
        voiceoverScore: semanticScore,
        visualCompatibilityScore: visualScore,
      }],
    } : {}),
    retryPolicy: { maxAttempts: 1, fallbackStrategies: input.supply.fallbackSourceStrategy ? [input.supply.fallbackSourceStrategy] : [] },
    provenance: {
      origin: material?.origin === 'shared_library' ? 'licensed_library' : 'customer',
      inputVersion: input.taskVersion,
      authorizationRef: sourceRef,
      executionRecordId: null,
    },
  });
  });
  const capabilityRows = socialContentCapabilityRegistry(input.capabilityRuntime)
    .filter(capability => capability.executable)
    .filter(capability => capability.strategy !== 'authorized_digital_presenter'
      || (input.supply.digitalHumanPlan !== undefined
        && ['preview_only', 'ready_for_capability_check'].includes(input.supply.digitalHumanPlan.executionState)))
    .filter(capability => capability.strategy !== 'aigc_product_scene_replication'
      || (input.supply.productSceneReplication !== undefined && input.supply.sourceRefs.length > 0))
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
      retryPolicy: { maxAttempts: 3, fallbackStrategies: input.scene.referenceProductionRouting ? [] : [...capability.fallbackStrategies] },
      provenance: { origin: capability.strategy === 'licensed_stock_asset' ? 'licensed_library' : 'system_capability', inputVersion: input.taskVersion, authorizationRef: capability.rightsStatus === 'confirmed' ? `capability:${capability.strategy}` : null, executionRecordId: null },
    }));
  return [...actualAssets, ...capabilityRows]
    .filter(candidate => {
      const routing = input.scene.referenceProductionRouting;
      if (!routing) return true;
      if (routing.state !== 'ready' || routing.route === 'undetermined') return false;
      if (routing.route === 'reference_frame_presenter') return candidate.kind === 'capability' && candidate.sourceStrategy === 'authorized_digital_presenter';
      if (['aigc_video', 'non_presenter_aigc_video'].includes(routing.route)) return candidate.kind === 'capability'
        && ['aigc_product_scene_replication', 'non_evidentiary_ai_visual'].includes(candidate.sourceStrategy);
      if (!['customer_real_asset', 'licensed_stock_asset'].includes(candidate.sourceStrategy)) return false;
      if (routing.route === 'library_match' && candidate.kind === 'asset') {
        const material = input.materialCandidates?.find(item => item.sourceRef === candidate.sourceRef || item.assetId === candidate.sourceRef);
        return Boolean(material?.visualContract && !material.visualContract.subjects.some(subject => subject.kind === 'person'));
      }
      return true;
    })
    .sort((left, right) => right.semanticScore - left.semanticScore || right.estimatedSuccessRate - left.estimatedSuccessRate)
    .slice(0, 20);
}

function executionScene(input: {
  taskId: string;
  taskVersion: string;
  scene: SocialDirectorBriefScene;
  supply: SocialAssetSupplyShotPlan;
  capabilityRuntime?: SocialContentCapabilityRuntimeRegistration[];
  materialCandidates?: SocialWorkflowMaterialCandidate[];
}): SocialContentExecutionScenePlan {
  const candidates = capabilityCandidates({ ...input, sceneId: input.scene.sceneId });
  const identityLockedPresenter = input.scene.referenceProductionRouting?.state === 'ready'
    && input.scene.referenceProductionRouting.route === 'reference_frame_presenter';
  const topic = input.scene.visualTopic;
  const primaryHook = input.scene.referenceMaterial?.isPrimaryHook || input.supply.function === 'hook';
  const referenceHook = Boolean(input.scene.referenceMaterial?.isPrimaryHook
    || (input.scene.replicationFactors?.length ?? 0) > 0);
  const expressivePerson = topic?.personRole === 'expressive_action' && input.scene.productionRouting?.presenterIdentityReplacementRequired;
  const visibleSpeech = topic?.personRole === 'visible_speech' && input.scene.productionRouting?.needsPreciseLipSync;
  const matchingAsset = candidates.find(candidate => candidate.kind === 'asset'
    && candidate.sourceStrategy === 'customer_real_asset'
    && candidate.actionAndShotScore >= 0.8 && candidate.semanticScore >= 0.72);
  const capability = (strategy: SocialShotSourceStrategy) => candidates.find(candidate =>
    candidate.kind === 'capability' && candidate.sourceStrategy === strategy);
  // The Content Agent routes from observed purpose and available assets. A
  // Director-side supply hint cannot silently turn an action hook into a
  // talking avatar or a customer factory claim into generated evidence.
  const policy = expressivePerson ? 'expressive_action'
    : visibleSpeech ? 'visible_speech'
      : primaryHook ? 'hook_fidelity'
        : matchingAsset ? 'reuse_material'
          : topic?.kind === 'product_introduction' ? 'product_scene' : 'needs_capability';
  const ordinaryCapability = topic?.kind === 'factory_footage'
    ? (input.supply.truthBoundary.customerEvidenceRequired ? undefined : capability('licensed_stock_asset'))
    : topic?.kind === 'product_introduction'
      ? capability('aigc_product_scene_replication') ?? capability('customer_product_image_animation')
      : topic?.kind === 'competitor_comparison'
        ? capability('verified_fact_card')
        : input.supply.function === 'call_to_action'
          ? capability('verified_fact_card') ?? capability('motion_graphics')
          : capability('licensed_stock_asset') ?? capability('motion_graphics');
  const safeOriginalHookFallback = referenceHook
    ? undefined
    : capability('licensed_stock_asset') ?? capability('motion_graphics');
  const preferred = identityLockedPresenter ? capability('authorized_digital_presenter') : expressivePerson ? undefined
    : visibleSpeech ? capability('authorized_digital_presenter')
      : primaryHook && topic?.kind === 'product_introduction'
        ? capability('aigc_product_scene_replication') ?? capability('customer_product_image_animation') ?? matchingAsset ?? safeOriginalHookFallback
        : primaryHook ? matchingAsset ?? candidates.find(candidate => candidate.sourceStrategy === input.supply.sourceStrategy) ?? safeOriginalHookFallback
          : matchingAsset ?? ordinaryCapability;
  const fallback = candidates.find(candidate => candidate.sourceStrategy === input.supply.fallbackSourceStrategy && candidate.candidateId !== preferred?.candidateId);
  return {
    sceneId: input.scene.sceneId,
    routeDecision: {
      visualTopic: topic,
      policy,
      reason: identityLockedPresenter ? input.scene.referenceProductionRouting!.reason : expressivePerson ? '人物明显动作需要已验收的首帧动作能力；当前注册能力不满足，退回补能力或改镜'
        : visibleSpeech ? '可见口播需要企业授权人物与逐句口型能力'
          : primaryHook ? '开场钩子先保持参考表现机制，再核对可执行素材或能力'
            : matchingAsset ? '现有素材满足视觉主题、表达目的与画面契约'
              : '没有合格素材，按分镜目标检查可用能力',
      source: 'content_agent',
    },
    replicationFactorIds: (input.scene.replicationFactors ?? []).map(factor => factor.factorId),
    factorFeasibility: (input.scene.replicationFactors ?? []).map(factor => ({
      factorId: factor.factorId,
      feasible: Boolean(preferred),
      reason: preferred ? `由推荐候选 ${preferred.label} 承担，并在成片后由 ${factor.validator.detector} 独立检测` : '当前没有可执行候选',
      plannedValidatorId: factor.validator.validatorId,
    })),
    feasibility: preferred ? input.supply.feasibility : 'blocked_for_facts_or_rights',
    feasibilityReason: preferred ? input.supply.feasibilityReason : '内容 Agent 未找到满足本镜头要求的可执行素材或能力',
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
    ...(input.supply.productSceneReplication ? {
      productSceneReplication: structuredClone(input.supply.productSceneReplication),
    } : {}),
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
      materialCandidates: input.materialCandidates,
    })] : [];
  });
  const selectedApproach = input.brief.productionApproach ?? 'ai_enhanced';
  const ownMaterials = (input.materialCandidates ?? []).filter(item => item.origin === 'my_materials');
  const selectedMaterialIds = unique(scenes.flatMap(scene => {
    const recommended = new Set(scene.recommendedCandidateIds);
    return scene.candidates
      .filter(candidate => recommended.has(candidate.candidateId)
        && candidate.kind === 'asset' && candidate.sourceRef)
      .map(candidate => input.materialCandidates?.find(item => (
        item.sourceRef === candidate.sourceRef || item.assetId === candidate.sourceRef
      ))?.assetId || '');
  }).filter(Boolean));
  const previewMaterial = selectedMaterialIds
    .map(assetId => ownMaterials.find(item => item.assetId === assetId))
    .find((item): item is SocialWorkflowMaterialCandidate => Boolean(item))
    ?? ownMaterials[0]
    ?? null;
  const firstFramePreview = previewMaterial ? {
    assetId: previewMaterial.assetId,
    label: previewMaterial.label,
    mediaType: previewMaterial.mediaType,
    url: previewMaterial.previewUrl,
    sourceTimestampSeconds: 0 as const,
  } : null;
  const currentEstimatedCost = +scenes.reduce((sum, scene) => sum + scene.estimatedCostCny, 0).toFixed(2);
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
    accountPresenterLock: directorBrief.accountPresenterLock
      ? structuredClone(directorBrief.accountPresenterLock)
      : null,
    estimatedTotalCostCny: currentEstimatedCost,
    estimatedTotalSeconds: +scenes.reduce((sum, scene) => sum + scene.estimatedSeconds, 0).toFixed(1),
    selectedApproach,
    productionOptions: [
      {
        approach: 'ai_enhanced',
        label: '智能混合制作·主推',
        description: '人物出镜自动使用账号数字人，产品展示自动使用产品身份锁定 IAIGC，其余镜头逐句匹配“我的素材”。',
        qualityTier: 'premium',
        available: true,
        unavailableReason: null,
        usesPaidProviders: true,
        estimatedCostCny: selectedApproach === 'ai_enhanced' ? currentEstimatedCost : Math.max(1, directorBrief.scenes.length * 3.6),
        includedOperations: ['前三秒精细生成约束', '数字人动作复现', '产品 IAIGC 场景复现', '逐句素材剪辑', '完整质量检查'],
        selectedMaterialIds,
        firstFramePreview,
      },
      {
        approach: 'material_cut',
        label: '免费素材剪辑',
        description: '逐句匹配“我的素材”，只做裁切、拼接、变速与字幕，不生成人物或产品画面。',
        qualityTier: 'standard',
        available: ownMaterials.length > 0,
        unavailableReason: ownMaterials.length ? null : '“我的素材”中没有可读取的图片或视频',
        usesPaidProviders: false,
        estimatedCostCny: 0,
        includedOperations: ['逐句语义匹配', '片段裁切', '节奏重排', '字幕与基础转场'],
        selectedMaterialIds: selectedMaterialIds.length ? selectedMaterialIds : ownMaterials.slice(0, 8).map(item => item.assetId),
        firstFramePreview,
      },
      {
        approach: 'shooting_plan',
        label: '建立代拍清单',
        description: '不立即生成视频，把编导方案转成可交给代拍团队的镜头、动作、场景、产品状态和验收清单。',
        qualityTier: 'enhanced',
        available: true,
        unavailableReason: null,
        usesPaidProviders: false,
        estimatedCostCny: 0,
        includedOperations: ['镜头清单', '表演与动作指令', '场景与道具要求', '产品状态与效果要求', '验收标准'],
        selectedMaterialIds: [],
        firstFramePreview: null,
      },
    ],
    referenceFirstFramePreview: input.referencePreviewUrl ? {
      label: '参考视频前三秒首帧',
      mediaType: 'image',
      url: input.referencePreviewUrl,
      sourceTimestampSeconds: 0,
    } : null,
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
  const shootingPlanOnly = plan.selectedApproach === 'shooting_plan';
  const sceneResults = directorBrief.scenes.flatMap(scene => {
    const scenePlan = planByScene.get(scene.sceneId);
    if (shootingPlanOnly && scenePlan) return [{
      sceneId: scene.sceneId,
      approved: true,
      feasibility: scenePlan.feasibility,
      failedCriteria: [],
      requiredRevision: [],
      goalImpact: 'none' as const,
      reasonCodes: [],
    }];
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
  const referenceBlocked = input.brief.creationMode === 'viral_replication'
    && input.referenceReviewHandoff?.productionExecutionAllowed !== true;
  const approved = !directorBlocked && !referenceBlocked && sceneResults.length === directorBrief.scenes.length && sceneResults.every(result => result.approved);
  const failedCriteria = unique([
    ...(directorBlocked ? ['导演方案或参考分析尚未满足完整性要求'] : []),
    ...(referenceBlocked ? ['参考视频的逐句时间码、分镜证据或授权尚未通过生产门禁'] : []),
    ...sceneResults.flatMap(result => result.failedCriteria),
  ]);
  const requiredRevision = unique([
    ...(directorBlocked ? ['补齐参考分析覆盖或导演方案后重新规划'] : []),
    ...(referenceBlocked ? ['按参考交接物 issues 补齐证据并重新计算生产门禁'] : []),
    ...sceneResults.flatMap(result => result.requiredRevision),
  ]);
  const reasonCodes = unique([
    ...(directorBlocked ? ['expression_failed' as const] : []),
    ...(referenceBlocked ? ['expression_failed' as const] : []),
    ...sceneResults.flatMap(result => result.reasonCodes),
  ]);
  return {
    reviewId: stableId('execution_plan_review', { taskId: input.taskId, taskVersion: input.taskVersion,
      referenceHandoffVersion: input.referenceReviewHandoff?.versionHash ?? null, round: plan.reviewRound }),
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
  /** Version-bound reference gate; Content may plan but cannot execute while false. */
  referenceReviewHandoff?: Pick<SocialReferenceReviewHandoff, 'productionExecutionAllowed' | 'versionHash'> | null;
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
  materialCandidates?: SocialWorkflowMaterialCandidate[];
  inferredProductRef?: string | null;
  referencePreviewUrl?: string | null;
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
