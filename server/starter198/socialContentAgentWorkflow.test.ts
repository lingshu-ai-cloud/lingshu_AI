import assert from 'node:assert/strict';
import { createSocialAssetSupplyPlan } from '../../shared/socialContentAssetSupply';
import type {
  SocialContentTaskBrief,
  SocialReferenceVideoAnalysis,
  SocialReplicationScriptVersion,
} from '../../shared/contracts/socialContentWorkflow';
import { buildSocialAgentWorkflow, socialContentCapabilityRegistry } from './socialContentAgentWorkflow';
import { alignSocialAssetSupplyPlanToBaseline } from './socialContentAssetSupplyExecution';

const brief: SocialContentTaskBrief = {
  title: '面向采购商的产品介绍',
  objective: '让美国采购商理解产品价值并发起询盘',
  productRef: 'product:verified-1',
  audience: '美国采购商',
  markets: ['US'],
  languages: ['en'],
  platforms: ['tiktok', 'youtube'],
  formats: ['short_video'],
  aspectRatio: '9:16',
  cadence: null,
  requestedOutputCount: 2,
  weeklyBudgetCny: 100,
  perItemBudgetCny: 20,
  retryReserveCny: 10,
  planningMode: 'auto_adjust',
  shootingWindowMinutes: 0,
  specialRequirements: null,
  dueAt: '2026-10-01T00:00:00.000Z',
  brandNotes: '保持产品包装与商标不变',
  restrictions: ['不得虚构认证'],
  callToAction: '提交询盘',
  creationMode: 'viral_replication',
  assetAvailability: 'none',
  managementMode: 'one_click_managed',
  productionMode: 'social_ready',
};

const truthBoundary = {
  subject: 'none' as const,
  syntheticVisualAllowed: true,
  customerEvidenceRequired: false,
  customerEvidenceRefs: [],
  confirmedFactRefs: ['knowledge:product-1'],
  mustNotImplyCustomerReality: true,
  prohibitedRepresentations: ['alter_locked_product_identity' as const, 'present_synthetic_media_as_customer_evidence' as const],
};
const presenterLock = {
  socialAccountId: 'account-1', presenterProfileId: 'profile-1', presenterProfileVersion: '2',
  presenterAssetId: 'presenter-enterprise-1', avatarId: 'avatar-1', voiceProfileId: 'voice-1',
  consentRef: 'consent-1', commercialRightsStatus: 'cleared' as const, status: 'published' as const,
  consistencyKey: 'account-1:profile-1:2',
};

const referenceAnalysis: SocialReferenceVideoAnalysis = {
  analysisId: 'analysis-1',
  version: '7',
  referenceSourceId: 'source-reference-1',
  status: 'ready',
  durationSeconds: 6,
  coverage: {
    fullDurationSeconds: 6,
    precisionIntervals: [{ startSeconds: 0, endSeconds: 3, level: 'L3' }, { startSeconds: 3, endSeconds: 6, level: 'L3' }],
    gaps: [],
    overallConfidence: 0.91,
    fullTimelineCovered: true,
  },
  shots: [
    {
      shotId: 'reference-hook', startSeconds: 0, endSeconds: 3, visualDescription: '快速呈现主体', spokenText: null, captionText: null,
      audioDescription: '节奏音效', rhythmDescription: '快速', purpose: 'hook',
      tags: { sceneTypes: ['产品展示'], subjects: ['产品'], subjectRelations: [], cameraLanguage: ['近景特写', '推进镜头'], contentFunctions: ['hook'], soundTypes: ['音效'], onScreenInformation: ['主字幕'], truthRequirements: ['none'], suggestedProductionMethods: ['motion_graphics'] },
      fidelityPoints: ['结果先行'], mustDifferPoints: ['替换产品和文案'],
    },
    {
      shotId: 'reference-cta', startSeconds: 3, endSeconds: 6, visualDescription: '行动引导', spokenText: null, captionText: null,
      audioDescription: '音乐收束', rhythmDescription: '稳定', purpose: 'call_to_action',
      tags: { sceneTypes: ['图文'], subjects: ['字幕'], subjectRelations: [], cameraLanguage: ['固定镜头'], contentFunctions: ['call_to_action'], soundTypes: ['音乐'], onScreenInformation: ['行动按钮'], truthRequirements: ['none'], suggestedProductionMethods: ['motion_graphics'] },
      fidelityPoints: ['结尾收束'], mustDifferPoints: ['替换业务行动'],
    },
  ],
  hookAnalysis: null,
  rightsNotice: '仅分析结构，不复制受保护内容。',
  createdAt: '2026-09-23T00:00:00.000Z',
};

const supply = createSocialAssetSupplyPlan({
  creationMode: 'viral_replication',
  planVersion: '12',
  confirmedFactRefs: ['knowledge:product-1'],
  shots: [
    { shotId: 'scene-hook', function: 'hook', requestedDescription: '三秒内呈现主体' },
    { shotId: 'scene-cta', function: 'call_to_action', requestedDescription: '给出询盘行动' },
  ],
});

const replicationScript: SocialReplicationScriptVersion = {
  version: '9',
  referenceAnalysisId: referenceAnalysis.analysisId,
  status: 'review_required',
  primaryHookId: 'hook-primary',
  hookOptions: [],
  shots: [
    {
      shotId: 'scene-hook', referenceShotId: 'reference-hook', startSeconds: 0, endSeconds: 3, purpose: 'hook',
      visualInstruction: '第一帧直接呈现产品轮廓和核心利益点', spokenText: 'See the key difference.', captionText: 'See the difference', audioAndTransition: '快速起音',
      fidelityPoints: ['结果先行'], mustDifferPoints: ['使用客户品牌表达'], materialPlan: supply.shots[0]!, lockedRegions: ['产品包装'], risks: [],
    },
    {
      shotId: 'scene-cta', referenceShotId: 'reference-cta', startSeconds: 3, endSeconds: 6, purpose: 'call_to_action',
      visualInstruction: '以询盘动作完成收束', spokenText: 'Send your inquiry.', captionText: 'Contact us', audioAndTransition: '音乐收束',
      fidelityPoints: ['行动收束'], mustDifferPoints: ['替换行动文案'], materialPlan: supply.shots[1]!, lockedRegions: ['品牌标识'], risks: [],
    },
  ],
  structureFidelitySummary: '保留信息顺序',
  originalityDifferenceSummary: '替换品牌内容',
  createdAt: '2026-09-23T00:00:00.000Z',
};

const workflow = buildSocialAgentWorkflow({
  taskId: 'task-1',
  taskVersion: '12',
  taskStatus: 'plan_review',
  mode: 'weekly',
  weeklyPlanId: 'weekly-1',
  brief,
  sources: [],
  factSourceRefs: ['knowledge:product-1'],
  assetSupplyPlan: supply,
  referenceAnalysis,
  replicationScript,
  replicationContext: {
    referenceMode: 'single_source_fidelity',
    programRef: { objectType: 'social_program', id: 'program-1', version: '2' },
    targetAccountRef: { objectType: 'owned_social_account', id: 'account-1', version: '4' },
    accountPlaybookRef: { objectType: 'account_playbook', id: 'playbook-1', version: '5', accountRef: 'account-1' },
    benchmarkAccountSnapshotRef: { objectType: 'benchmark_account_snapshot', id: 'benchmark-1', version: '6' },
    referenceContentAnalysisRef: { objectType: 'reference_content_analysis', id: 'content-analysis-1', version: '7' },
    primaryReferenceAnalysisId: referenceAnalysis.analysisId,
    primaryExperimentVariable: '开场动作',
  },
  now: new Date('2026-09-24T00:00:00.000Z'),
});

assert.equal(workflow.weeklyPackage?.originalContentCount, 2);
assert.equal(workflow.weeklyPackage?.publicationTaskCount, 4);
assert.equal(workflow.weeklyPackage?.adaptationVersionCount, 2);
assert.equal(workflow.weeklyPackage?.publicationMatrix.length, 2);
assert.equal(workflow.directorBrief.version, '12');
assert.equal(workflow.directorBrief.referenceAnalysis?.version, '7');
assert.equal(workflow.directorBrief.scenes.length, 2);
assert.equal(workflow.executionPlan.scenes.length, 2);
assert.ok(workflow.executionPlan.scenes.every(scene => scene.candidates.length > 0 && scene.candidates.length <= 20));
assert.ok(workflow.executionPlan.scenes.every(scene => scene.idempotencyKey.startsWith('social_scene_execution_')));
assert.equal(workflow.executionPlanReview.approved, true);
assert.equal(workflow.executionPlan.status, 'approved');
assert.equal(workflow.stage, 'director_ready');
assert.equal(workflow.schemaVersion, 'social-content-agent-workflow.v2');
assert.equal(workflow.replicationJob?.referenceMode, 'single_source_fidelity');
assert.equal(workflow.replicationJob?.status, 'director_ready');
assert.equal(workflow.replicationJob?.referenceAssignments.filter(item => item.primary).length, 1);
assert.equal(workflow.replicationJob?.referenceChain.integrity.complete, true);
assert.equal(workflow.replicationJob?.factorSpecs.every(factor => factor.status === 'frozen'), true);
assert.ok((workflow.replicationJob?.factorSpecs.length ?? 0) > 0);
assert.equal(workflow.directorBrief.replicationJobRef?.factorSpecVersion, '12');
assert.equal(workflow.directorBrief.accountPlaybookRef?.id, 'playbook-1');
assert.ok(workflow.directorBrief.scenes.every(scene => (scene.replicationFactors?.length ?? 0) > 0));
assert.ok(workflow.executionPlan.scenes.every(scene => (
  (scene.replicationFactorIds?.length ?? 0) > 0
  && scene.factorFeasibility?.every(factor => factor.feasible)
)));
assert.deepEqual(workflow.responsibilityBoundary?.finalGateOrder, ['content_agent', 'media_evaluation_worker', 'director_agent', 'business_agent', 'rules_engine']);
assert.equal(workflow.responsibilityBoundary?.selfApprovalForbidden, true);

const directorJson = JSON.stringify(workflow.directorBrief);
assert.doesNotMatch(directorJson, /sourceStrategy|candidateId|provider|model|clipId/);
assert.doesNotMatch(directorJson, /customerEvidenceRefs":\["/);
assert.match(JSON.stringify(workflow.executionPlan), /candidateId/);
assert.ok(workflow.executionPlan.estimatedTotalCostCny > 0);
assert.ok(workflow.executionPlan.scenes.every(scene => scene.candidates.every(candidate => (
  candidate.retryPolicy.maxAttempts > 0
  && candidate.qualityScore >= 0
  && candidate.durationFitScore >= 0
  && 'executionRecordId' in candidate.provenance
))));
const runtimeCapabilities = socialContentCapabilityRegistry();
assert.ok(runtimeCapabilities.every(capability => (
  capability.canDo.length > 0
  && capability.cannotDo.length > 0
  && capability.inputRequirements.length > 0
  && capability.fallbackStrategies.length > 0
  && capability.concurrencyLimit > 0
  && capability.rateLimitPerMinute > 0
  && capability.planningAvailability === 'supported'
  && capability.availability === (capability.executable ? 'available' : 'unavailable')
  && capability.applicableScenes.length > 0
)));
assert.equal(runtimeCapabilities.find(item => item.strategy === 'authorized_digital_presenter')?.executable, false);
assert.equal(runtimeCapabilities.find(item => item.strategy === 'authorized_digital_presenter')?.availabilityReason, '未注册执行适配器');
assert.deepEqual(runtimeCapabilities.find(item => item.strategy === 'motion_graphics')?.registeredAdapterIds, ['system_safe_motion_graphics.v1']);

const runtimeBlockedDigitalHuman = buildSocialAgentWorkflow({
  taskId: 'task-runtime-blocked', taskVersion: '1', taskStatus: 'plan_review', mode: 'instant', weeklyPlanId: null,
  brief: { ...brief, creationMode: 'viral_replication' }, sources: [], factSourceRefs: ['knowledge:product-1'],
  assetSupplyPlan: createSocialAssetSupplyPlan({
    creationMode: 'viral_replication', planVersion: 'runtime-blocked', confirmedFactRefs: ['knowledge:product-1'],
    inventory: { presenterAssetIds: ['presenter-enterprise-1'] },
    accountPresenterLock: presenterLock,
    shots: [{ shotId: 'scene-hook', function: 'hook', requestedDescription: '企业人物口播' }],
  }),
  referenceAnalysis, replicationScript: null,
});
assert.ok(runtimeBlockedDigitalHuman.executionPlan.scenes.every(scene => (
  scene.candidates.every(candidate => candidate.sourceStrategy !== 'authorized_digital_presenter')
)));

const runtimeEnabledDigitalHuman = socialContentCapabilityRegistry([{
  strategy: 'authorized_digital_presenter', adapterIds: ['heygen.v3'], environmentReady: true, reason: null,
}]);
assert.equal(runtimeEnabledDigitalHuman.find(item => item.strategy === 'authorized_digital_presenter')?.executable, true);
assert.equal(runtimeEnabledDigitalHuman.find(item => item.strategy === 'authorized_digital_presenter')?.registeredAdapterIds[0], 'heygen.v3');
const runtimeDegradedDigitalHuman = socialContentCapabilityRegistry([{
  strategy: 'authorized_digital_presenter', adapterIds: ['heygen.v3'], environmentReady: false, reason: 'HEYGEN_API_KEY 缺失',
}]);
assert.equal(runtimeDegradedDigitalHuman.find(item => item.strategy === 'authorized_digital_presenter')?.availability, 'degraded');
assert.equal(runtimeDegradedDigitalHuman.find(item => item.strategy === 'authorized_digital_presenter')?.executable, false);
const runtimeReadyDigitalHumanWorkflow = buildSocialAgentWorkflow({
  taskId: 'task-runtime-ready', taskVersion: '1', taskStatus: 'plan_review', mode: 'instant', weeklyPlanId: null,
  brief: { ...brief, creationMode: 'viral_replication' }, sources: [], factSourceRefs: ['knowledge:product-1'],
  assetSupplyPlan: createSocialAssetSupplyPlan({
    creationMode: 'viral_replication', planVersion: 'runtime-ready', confirmedFactRefs: ['knowledge:product-1'],
    inventory: { presenterAssetIds: ['presenter-enterprise-1'], referenceVideoIds: ['reference-video-1'] },
    accountPresenterLock: presenterLock,
    shots: [{ shotId: 'scene-hook', function: 'hook', requestedDescription: '企业人物口播' }],
  }),
  referenceAnalysis, replicationScript: null,
  capabilityRuntime: [{
    strategy: 'authorized_digital_presenter', adapterIds: ['heygen.v3'], environmentReady: true, reason: null,
  }],
});
assert.ok(runtimeReadyDigitalHumanWorkflow.executionPlan.scenes.some(scene => (
  scene.candidates.some(candidate => candidate.sourceStrategy === 'authorized_digital_presenter'
    && candidate.providerId === 'heygen.v3')
)));

const digitalHumanSupply = createSocialAssetSupplyPlan({
  creationMode: 'viral_replication', planVersion: 'digital-human-1', confirmedFactRefs: ['knowledge:product-1'],
  inventory: { presenterAssetIds: ['presenter-enterprise-1'], referenceVideoIds: ['reference-video-1'] },
  accountPresenterLock: presenterLock,
  shots: [{ shotId: 'scene-hook', function: 'hook', requestedDescription: '使用企业人物逐句重新演绎' }],
});
const alignedDigitalHumanSupply = alignSocialAssetSupplyPlanToBaseline({
  plan: digitalHumanSupply,
  baseline: {
    schemaVersion: 'social-content-script-baseline.v1', version: '1', source: 'knowledge_fallback',
    formulaReference: null, themeId: null, language: 'en', lockedAt: '2026-09-24T00:00:00.000Z', createdBeforeMaterialAdaptation: true,
    scenes: [{ sceneId: 'scene-hook', formulaNodeId: null, shotFunction: 'hook', subject: 'enterprise presenter', action: 'speaks to camera', script: 'Discover the difference.', voiceover: 'Discover the difference.', narration: 'Discover the difference.', caption: 'Discover the difference.' }],
  },
});
assert.equal(alignedDigitalHumanSupply.shots[0]?.sourceStrategy, 'authorized_digital_presenter');
assert.equal(alignedDigitalHumanSupply.shots[0]?.digitalHumanPlan?.workflow, 'viral_replication');
assert.equal(alignedDigitalHumanSupply.shots[0]?.digitalHumanPlan?.executionState, 'preview_only');
assert.deepEqual(alignedDigitalHumanSupply.shots[0]?.digitalHumanPlan?.referenceMaterialIds, ['reference-video-1']);
assert.deepEqual(alignedDigitalHumanSupply.shots[0]?.sourceRefs, ['presenter-enterprise-1']);
assert.equal(alignedDigitalHumanSupply.accountPresenterLock?.consistencyKey, presenterLock.consistencyKey);

const productSceneSupply = createSocialAssetSupplyPlan({
  creationMode: 'material_processing', planVersion: 'product-scene-1', confirmedFactRefs: ['knowledge:product-1'],
  inventory: { productIdentityGroups: [
    { productRef: 'serum', imageIds: ['serum-front'] },
    { productRef: 'cream', imageIds: ['cream-front'] },
  ] },
  shots: [{ shotId: 'scene-product', function: 'hook', requestedDescription: '多产品在干净展台上有序摆放并环绕展示' }],
});
const productSceneWorkflow = buildSocialAgentWorkflow({
  taskId: 'task-product-scene', taskVersion: '1', taskStatus: 'plan_review', mode: 'instant', weeklyPlanId: null,
  brief: { ...brief, creationMode: 'material_processing' }, sources: [], factSourceRefs: ['knowledge:product-1'],
  assetSupplyPlan: productSceneSupply, referenceAnalysis: null, replicationScript: null,
  capabilityRuntime: [{ strategy: 'aigc_product_scene_replication', adapterIds: ['controlled_product_scene_replication.v1'], environmentReady: true, reason: null }],
});
assert.equal(productSceneWorkflow.directorBrief.scenes[0]?.productSceneReplication?.sceneLock.productSlots.length, 2);
assert.equal(productSceneWorkflow.executionPlan.scenes[0]?.selectedSourceStrategy, 'aigc_product_scene_replication');
assert.equal(productSceneWorkflow.executionPlan.scenes[0]?.productSceneReplication?.cameraLock.movementPath.includes('环绕'), true);
assert.ok(productSceneWorkflow.directorBrief.scenes[0]?.acceptanceCriteria.some(item => item.includes('单图平移缩放')));

const blockedSupply = createSocialAssetSupplyPlan({
  creationMode: 'viral_replication',
  planVersion: '13',
  shots: [{ shotId: 'scene-proof', function: 'proof', requestedDescription: '展示真实工厂', truthSensitiveSubject: 'customer_factory' }],
});
const blocked = buildSocialAgentWorkflow({
  taskId: 'task-2', taskVersion: '13', taskStatus: 'plan_review', mode: 'instant', weeklyPlanId: null,
  brief: { ...brief, requestedOutputCount: 1 }, sources: [], factSourceRefs: [], assetSupplyPlan: blockedSupply,
  referenceAnalysis, replicationScript: null,
});
assert.equal(blocked.adHocBusinessContext?.version, '13');
assert.equal(blocked.executionPlanReview.approved, false);
assert.ok(blocked.executionPlanReview.reasonCodes.includes('facts_missing'));
assert.equal(blocked.stage, 'needs_facts');

const incompleteReference = { ...referenceAnalysis, coverage: { ...referenceAnalysis.coverage!, gaps: [{ startSeconds: 5, endSeconds: 6, reason: '未覆盖' }], fullTimelineCovered: false } };
const incomplete = buildSocialAgentWorkflow({
  taskId: 'task-3', taskVersion: '14', taskStatus: 'plan_review', mode: 'instant', weeklyPlanId: null,
  brief, sources: [], factSourceRefs: ['knowledge:product-1'], assetSupplyPlan: supply,
  referenceAnalysis: incompleteReference, replicationScript,
});
assert.equal(incomplete.directorBrief.status, 'blocked');
assert.equal(incomplete.replicationJob?.status, 'blocked');
assert.equal(incomplete.executionPlanReview.approved, false);
assert.ok(incomplete.executionPlanReview.failedCriteria.some(item => /参考分析/.test(item)));

const materialOnly = buildSocialAgentWorkflow({
  taskId: 'task-material', taskVersion: '1', taskStatus: 'plan_review', mode: 'instant', weeklyPlanId: null,
  brief: { ...brief, creationMode: 'material_processing' }, sources: [], factSourceRefs: ['knowledge:product-1'], assetSupplyPlan: supply,
  referenceAnalysis: null, replicationScript: null,
});
assert.equal(materialOnly.replicationJob, null, 'material-processing and historic non-clone tasks stay compatible');
assert.equal(materialOnly.directorBrief.referenceMode, null);

const hybrid = buildSocialAgentWorkflow({
  taskId: 'task-hybrid', taskVersion: '2', taskStatus: 'plan_review', mode: 'instant', weeklyPlanId: null,
  brief, sources: [], factSourceRefs: ['knowledge:product-1'], assetSupplyPlan: supply,
  referenceAnalysis, replicationScript,
  replicationContext: { referenceMode: 'multi_source_hybrid', primaryReferenceAnalysisId: referenceAnalysis.analysisId },
  inspirationHandoffs: [{
    ...workflow.inspirationHandoffs[0]!, inspirationId: 'proof-inspiration', analysisId: 'proof-analysis', analysisVersion: '4',
    referenceRole: 'proof_reference', whySelected: ['提供证明方式，不改变主参考镜头结构'],
  }],
});
assert.equal(hybrid.replicationJob?.referenceAssignments.length, 2);
assert.equal(hybrid.replicationJob?.referenceAssignments.filter(item => item.primary).length, 1);
assert.equal(hybrid.replicationJob?.referenceAssignments.find(item => item.analysisId === 'proof-analysis')?.role, 'proof_reference');
assert.ok(hybrid.directorBrief.referenceEvidence.some(item => item.analysisId === 'proof-analysis'));

console.log('social content agent workflow tests passed');
