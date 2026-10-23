import assert from 'node:assert/strict';
import type {
  SocialContentAgentWorkflow,
  SocialShotSourceStrategy,
} from '../../shared/contracts/socialContentWorkflow.js';
import type { ProductionCostQuote } from '../../shared/contracts/productionCostQuote.js';
import type { ProductionInputRequest } from '../../shared/contracts/productionInputRequest.js';
import { createProductionTestStore } from '../production/testStore.js';
import {
  buildSocialContentProductionReadModel,
  projectProductionInputRequests,
  readCanonicalSocialStudioProject,
  selectProductionCostQuoteForRun,
} from './socialContentProductionReadModel.js';

const strategies: SocialShotSourceStrategy[] = [
  'customer_real_asset',
  'authorized_digital_presenter',
  'motion_graphics',
  'non_evidentiary_ai_visual',
  'customer_product_image_animation',
  'aigc_product_scene_replication',
];

function workflowFixture(): SocialContentAgentWorkflow {
  const scenes = strategies.map((strategy, index) => ({
    sceneId: `scene-${index + 1}`,
    selectedSourceStrategy: strategy,
    fallbackSourceStrategy: strategy === 'customer_real_asset' ? 'motion_graphics' : null,
    recommendedCandidateIds: [`candidate-${index + 1}`],
    candidates: [{
      candidateId: `candidate-${index + 1}`,
      sourceStrategy: strategy,
      sourceRef: ['customer_real_asset', 'customer_product_image_animation'].includes(strategy)
        ? `material-${index + 1}` : strategy === 'authorized_digital_presenter' ? 'presenter-1' : null,
      productId: strategy === 'customer_real_asset' ? 'product-1' : null,
      productRef: strategy === 'customer_real_asset' ? 'sku-1' : null,
      retryPolicy: { maxAttempts: 2, fallbackStrategies: strategy === 'non_evidentiary_ai_visual' ? ['motion_graphics'] : [] },
    }],
    feasibility: 'executable',
    feasibilityReason: '当前栈可执行',
    estimatedCostCny: index + 1,
    routeDecision: { visualTopic: { subject: `镜头主题 ${index + 1}` } },
    ...(strategy === 'aigc_product_scene_replication' ? {
      productSceneReplication: {
        productIdentity: { groups: [{ productRef: 'sku-1', referenceImageIds: ['product-front-1'] }] },
      },
    } : {}),
  }));
  return {
    directorBrief: {
      contentRequirements: { product: { productId: 'product-1', productRef: 'sku-1' } },
      scenes: strategies.map((strategy, index) => ({
        sceneId: `scene-${index + 1}`,
        order: index + 1,
        targetVisual: `目标画面 ${index + 1}`,
        ...(strategy === 'authorized_digital_presenter' ? {
          productionRouting: { presenterIdentityReplacementRequired: true },
        } : {}),
        ...(['customer_real_asset', 'customer_product_image_animation', 'aigc_product_scene_replication'].includes(strategy) ? {
          visualTopic: { kind: 'product_introduction' },
        } : {}),
      })),
    },
    executionPlan: {
      selectedApproach: 'ai_enhanced',
      accountPresenterLock: { presenterAssetId: 'presenter-1' },
      scenes,
    },
    executionPlanReview: {
      approved: true,
      reasonCodes: [],
      sceneResults: scenes.map(scene => ({
        sceneId: scene.sceneId,
        approved: true,
        failedCriteria: [],
        reasonCodes: [],
        requiredRevision: [],
      })),
    },
    productionResult: null,
  } as unknown as SocialContentAgentWorkflow;
}

const workflow = workflowFixture();
const studio = {
  available: true,
  duplicateCount: 0,
  project: {
    id: 'studio-1', version: '2026-10-13T01:00:00.000Z', status: 'draft', title: '任务制作项目',
    slotIds: strategies.map((_, index) => `scene-${index + 1}`), sourceTaskVersions: ['version-7'],
  },
};
const quote: ProductionCostQuote = {
  id: 'quote-1', schemaVersion: 'production-cost-quote.v1', quoteKey: 'quote-key-1',
  taskId: 'task-1', runId: 'run-1', currency: 'CNY', pricingVersion: 'pricing-v1', status: 'quoted',
  expectedCostCny: 12, upperBoundCostCny: 14, budgetLimitCny: 25,
  lines: [{
    lineKey: 'generation', label: '生产', quantity: 1, unit: 'task', expectedUnitCostCny: 12,
    upperBoundUnitCostCny: 14, expectedCostCny: 12, upperBoundCostCny: 14,
    pricingSource: 'execution-plan', explanation: '按执行计划计价', reused: false,
  }],
  reservationId: null, actualCostCny: null, actualLines: [],
  createdAt: '2026-10-13T01:00:00.000Z', updatedAt: '2026-10-13T01:00:00.000Z', settledAt: null,
};

assert.equal(selectProductionCostQuoteForRun({
  quotes: [{ ...quote, id: 'quote-old', runId: 'run-old' }, { ...quote, id: 'quote-current', runId: 'run-2' }],
  taskId: 'task-1',
  runId: 'run-2',
})?.id, 'quote-current', 'the current run must win even when an older-run quote is listed first');
assert.equal(selectProductionCostQuoteForRun({ quotes: [quote], taskId: 'task-1', runId: null }), null,
  'a task without an active run must not inherit historical cost');

const ready = buildSocialContentProductionReadModel({
  task: {
    taskId: 'task-1', version: 'version-7', status: 'plan_review', runId: 'run-1',
    updatedAt: '2026-10-13T01:00:00.000Z', title: '统一生产读模型', readinessMissing: [],
    productionApproach: 'ai_enhanced',
  },
  workflow,
  assetSupplyPlan: {
    shots: strategies.map((strategy, index) => ({
      shotId: `scene-${index + 1}`,
      sourceRefs: ['customer_real_asset', 'customer_product_image_animation'].includes(strategy)
        ? [`material-${index + 1}`] : [],
      ...(strategy === 'authorized_digital_presenter'
        ? { digitalHumanPlan: { presenterAssetIds: ['presenter-1'], method: 'reenact', silentMotion: true } } : {}),
    })),
  } as never,
  studio,
  costQuote: quote,
});

assert.equal(ready.authority, 'canonical_task');
assert.equal(ready.project.studioProjectId, 'studio-1');
assert.equal(ready.aggregate.status, 'ready');
assert.equal(ready.aggregate.executable, true);
assert.deepEqual(ready.shots.map(shot => shot.route.recommended.kind), [
  'material_edit', 'digital_human', 'motion_graphics', 'aigc_visual', 'product_composite', 'product_scene',
]);
assert.ok(ready.shots.every(shot => shot.slotId === shot.shotId && shot.allowedCommands.includes('open_shot')));
assert.equal(ready.shots[0]?.identityGuarantee.product, 'exact_source');
assert.equal(ready.shots[1]?.identityGuarantee.presenter, 'locked_reference');
assert.equal(ready.shots[5]?.identityGuarantee.product, 'qa_gated');
assert.equal(ready.shots[0]?.route.fallbacks[0]?.executable, false,
  'a named fallback without a current-stack candidate must not be advertised as executable');
assert.equal(ready.aggregate.cost.expectedCny, 12);
assert.equal(ready.aggregate.cost.upperBoundCny, 14);
assert.equal(ready.aggregate.cost.currency, 'CNY');
assert.equal(ready.aggregate.cost.reusable, false);
assert.equal(ready.aggregate.cost.basis, 'execution_plan');
assert.ok(ready.aggregate.allowedCommands.includes('open_project'));
assert.ok(ready.aggregate.allowedCommands.includes('generate'));
assert.equal(ready.aggregate.allowedCommands.includes('request_shoot'), false,
  'a ready system route must not advertise customer shooting as the default command');

const staleRunQuote = buildSocialContentProductionReadModel({
  task: {
    taskId: 'task-1', version: 'version-8', status: 'plan_review', runId: 'run-2',
    updatedAt: '2026-10-13T02:00:00.000Z', title: '新一轮生产', readinessMissing: [],
    productionApproach: 'ai_enhanced',
  },
  workflow,
  assetSupplyPlan: {
    shots: strategies.map((strategy, index) => ({
      shotId: `scene-${index + 1}`,
      sourceRefs: ['customer_real_asset', 'customer_product_image_animation'].includes(strategy)
        ? [`material-${index + 1}`] : [],
      ...(strategy === 'authorized_digital_presenter'
        ? { digitalHumanPlan: { presenterAssetIds: ['presenter-1'], method: 'reenact', silentMotion: true } } : {}),
    })),
  } as never,
  studio: { ...studio, project: { ...studio.project, sourceTaskVersions: ['version-8'] } },
  costQuote: { ...quote, runId: 'run-1', expectedCostCny: 999, upperBoundCostCny: 999 },
});
assert.equal(staleRunQuote.aggregate.cost.expectedCny, 21,
  'a quote from an older run must not override the current execution-plan estimate');
assert.equal(staleRunQuote.aggregate.cost.upperBoundCny, 42);

const openProductRequest: ProductionInputRequest = {
  id: 'input-1', schemaVersion: 'production-input-request.v1', category: 'product_asset',
  kind: 'product_front_image', status: 'open', title: '产品正面图', instructions: '请提供清晰正面图',
  required: true, blocking: true, subjectRef: null, productId: 'product-1', productName: '测试产品',
  bindings: [{ taskId: 'task-1', shotId: 'scene-3' }, { taskId: 'other-task', shotId: 'foreign-scene' }],
  acceptedMimeTypes: ['image/png'], specification: {}, fulfillments: [], minimumItems: 1,
  createdAt: '2026-10-13T01:00:00.000Z', updatedAt: '2026-10-13T01:00:00.000Z',
  fulfilledAt: null, waivedAt: null, waiverReason: null,
};
const projectedRequests = projectProductionInputRequests([openProductRequest], 'task-1');
assert.equal(projectedRequests.length, 1, 'bindings from another task must never leak into this projection');
assert.equal(projectedRequests[0]?.shotId, 'scene-3');
const waiting = buildSocialContentProductionReadModel({
  task: {
    taskId: 'task-1', version: 'version-7', status: 'plan_review', runId: 'run-1',
    updatedAt: '2026-10-13T01:00:00.000Z', title: '等待产品输入', productionApproach: 'ai_enhanced',
  },
  workflow,
  studio,
  inputRequests: projectedRequests,
});
assert.equal(waiting.shots[2]?.status, 'needs_input');
assert.equal(waiting.shots[2]?.executable, false);
assert.ok(waiting.shots[2]?.allowedCommands.includes('upload_product_asset'));
assert.equal(waiting.shots[2]?.allowedCommands.includes('request_shoot'), false,
  'a recoverable product-input gap must not be converted into a default shooting request');
assert.equal(waiting.aggregate.inputs.missing.includes('input-1'), true);

const runningWithNewInput = buildSocialContentProductionReadModel({
  task: {
    taskId: 'task-1', version: 'version-7', status: 'producing', runId: 'run-1',
    updatedAt: '2026-10-13T01:03:00.000Z', title: '制作中补充产品输入', productionApproach: 'ai_enhanced',
  },
  workflow,
  studio,
  productionStage: { stage: 'content_production', updatedAt: '2026-10-13T01:03:00.000Z' },
  inputRequests: projectedRequests,
});
assert.equal(runningWithNewInput.shots[2]?.status, 'needs_input',
  'a stale running stage must not hide a newly opened required input');
assert.equal(runningWithNewInput.shots[2]?.executable, false);
assert.ok(runningWithNewInput.shots[2]?.allowedCommands.includes('upload_product_asset'),
  'the recovery command must remain available while production waits for input');
assert.equal(runningWithNewInput.aggregate.status, 'needs_input');
assert.equal(runningWithNewInput.aggregate.stage, 'input');
assert.equal(runningWithNewInput.aggregate.counts.needsInput, 1);

const shootingPlan = buildSocialContentProductionReadModel({
  task: {
    taskId: 'task-1', version: 'version-7', status: 'plan_review', runId: null,
    updatedAt: '2026-10-13T01:00:00.000Z', title: '用户实拍路线', productionApproach: 'shooting_plan',
  },
  workflow,
  studio,
});
assert.ok(shootingPlan.shots.every(shot => shot.route.recommended.kind === 'user_capture'));
assert.ok(shootingPlan.shots.every(shot => shot.status === 'needs_input' && !shot.executable));
assert.ok(shootingPlan.shots.every(shot => shot.allowedCommands.includes('request_shoot')));

const inQualityReview = buildSocialContentProductionReadModel({
  task: {
    taskId: 'task-1', version: 'version-7', status: 'producing', runId: 'run-1',
    updatedAt: '2026-10-13T01:00:00.000Z', title: '质检中', productionApproach: 'ai_enhanced',
  },
  workflow,
  studio,
  productionStage: { stage: 'quality_check', updatedAt: '2026-10-13T01:03:00.000Z' },
});
assert.equal(inQualityReview.aggregate.stage, 'qa');
assert.equal(inQualityReview.aggregate.status, 'quality_review');
assert.ok(inQualityReview.shots.every(shot => shot.allowedCommands.includes('review_output')));

const receiptOnlyCost = buildSocialContentProductionReadModel({
  task: {
    taskId: 'task-empty', version: 'version-1', status: 'draft', runId: null,
    updatedAt: '2026-10-13T01:00:00.000Z', title: '尚未规划镜头', productionApproach: 'ai_enhanced',
  },
  workflow: null,
  studio: { available: true, project: null, duplicateCount: 0 },
  artifactCost: { settlementStatus: 'settled', actualProviderCostCny: 2.5 },
});
assert.equal(receiptOnlyCost.aggregate.cost.expectedCny, null,
  'an empty execution plan must not become a fake zero-cost estimate');
assert.equal(receiptOnlyCost.aggregate.cost.actualCny, 2.5);
assert.equal(receiptOnlyCost.aggregate.cost.basis, 'provider_receipt');
assert.equal(receiptOnlyCost.aggregate.status, 'planning',
  'an empty plan without a concrete input gap remains normal planning');

const emptyPlanWaitingForInput = buildSocialContentProductionReadModel({
  task: {
    taskId: 'task-empty-input', version: 'version-1', status: 'draft', runId: null,
    updatedAt: '2026-10-13T01:00:00.000Z', title: '等待必要信息',
    productionApproach: 'ai_enhanced', readinessMissing: ['目标产品'],
  },
  workflow: null,
  studio: { available: true, project: null, duplicateCount: 0 },
});
assert.equal(emptyPlanWaitingForInput.aggregate.status, 'needs_input');
assert.equal(emptyPlanWaitingForInput.aggregate.stage, 'input');
assert.equal(emptyPlanWaitingForInput.aggregate.executable, false);
assert.deepEqual(emptyPlanWaitingForInput.aggregate.inputs.missing, ['task:目标产品']);

const productionChoiceRequest = {
  ...openProductRequest,
  id: 'input-choice-1', category: 'production_choice', kind: 'content_clarification',
  productId: null, productName: null, subjectRef: 'task:task-empty-choice',
  title: '确认生产方式', instructions: '请选择素材剪辑或 AI 增强',
  bindings: [{ taskId: 'task-empty-choice', shotId: null }],
} as unknown as ProductionInputRequest;
const emptyPlanWaitingForChoice = buildSocialContentProductionReadModel({
  task: {
    taskId: 'task-empty-choice', version: 'version-1', status: 'draft', runId: null,
    updatedAt: '2026-10-13T01:00:00.000Z', title: '等待生产方式确认', productionApproach: null,
  },
  workflow: null,
  studio: { available: true, project: null, duplicateCount: 0 },
  inputRequests: projectProductionInputRequests([productionChoiceRequest], 'task-empty-choice'),
});
assert.equal(emptyPlanWaitingForChoice.aggregate.status, 'needs_input');
assert.ok(emptyPlanWaitingForChoice.aggregate.allowedCommands.includes('confirm_production_choice'));

const accountAuthorizationRequest = {
  ...productionChoiceRequest,
  id: 'input-account-1', category: 'account_authorization', kind: 'account_authorization',
  subjectRef: 'account:douyin-primary', title: '连接发布账号', instructions: '完成账号授权',
  bindings: [{ taskId: 'task-empty-choice', shotId: null }],
} as ProductionInputRequest;
const projectedAccountAuthorization = projectProductionInputRequests(
  [accountAuthorizationRequest],
  'task-empty-choice',
);
assert.equal(projectedAccountAuthorization[0]?.kind, 'account_authorization');
const emptyPlanWaitingForAccount = buildSocialContentProductionReadModel({
  task: {
    taskId: 'task-empty-choice', version: 'version-1', status: 'draft', runId: null,
    updatedAt: '2026-10-13T01:00:00.000Z', title: '等待账号授权', productionApproach: null,
  },
  workflow: null,
  studio: { available: true, project: null, duplicateCount: 0 },
  inputRequests: projectedAccountAuthorization,
});
assert.equal(emptyPlanWaitingForAccount.aggregate.status, 'needs_input');
assert.ok(emptyPlanWaitingForAccount.aggregate.allowedCommands.includes('connect_account'));

const store = createProductionTestStore();
await store.create('studio_projects', {
  tenant_id: 'tenant-a', title: '较新的空项目', status: 'draft', updated_at: '2026-10-13T02:00:00.000Z',
  spec: { socialContentTaskId: 'task-1', shootingSlots: [{ slotId: 'scene-1' }] },
});
const established = await store.create<{ id: string }>('studio_projects', {
  tenant_id: 'tenant-a', title: '已有分镜的项目', status: 'ready_for_approval', updated_at: '2026-10-13T01:00:00.000Z',
  spec: {
    socialContentTaskId: 'task-1', shootingSlots: [{ slotId: 'scene-1' }, { slotId: 'scene-2' }],
    storyboardAssignments: { 'scene-1': 'material-1' },
    socialDigitalHumanPlans: [{ sourceTaskVersion: 'version-7' }],
  },
});
await store.create('studio_projects', {
  tenant_id: 'tenant-b', title: '其他租户项目', status: 'published', updated_at: '2026-10-13T03:00:00.000Z',
  spec: { socialContentTaskId: 'task-1', storyboardAssignments: { 'scene-1': 'foreign' } },
});
await store.create('studio_projects', {
  tenant_id: 'tenant-a', title: '模板不参与关联', status: 'template', updated_at: '2026-10-13T04:00:00.000Z',
  spec: { socialContentTaskId: 'task-1', storyboardAssignments: { 'scene-1': 'template' } },
});
const selectedStudio = await readCanonicalSocialStudioProject({ dataStore: store, tenantId: 'tenant-a', taskId: 'task-1' });
assert.equal(selectedStudio.available, true);
assert.equal(selectedStudio.project?.id, established?.id);
assert.equal(selectedStudio.duplicateCount, 1);
assert.deepEqual(selectedStudio.project?.slotIds, ['scene-1', 'scene-2']);
assert.deepEqual(selectedStudio.project?.sourceTaskVersions, ['version-7']);
assert.deepEqual(await readCanonicalSocialStudioProject({ tenantId: 'tenant-a', taskId: 'task-1' }), {
  available: false, project: null, duplicateCount: 0,
});

console.log('social content production read model tests passed');

const speechWorkflow = workflowFixture();
const speechView = buildSocialContentProductionReadModel({
  task: { taskId: 'task', version: '1', status: 'plan_review', runId: null, updatedAt: '2026-10-23T00:00:00Z', title: '人物口播', productionApproach: 'ai_enhanced' },
  workflow: speechWorkflow, studio,
});
assert.equal(speechView.shots[1]?.route.recommended.executable, false);
assert.ok(speechView.shots[1]?.blockers.some(b => b.code === 'presenter_speech_route_unavailable' && b.message.includes('重新确认')));
assert.equal(speechView.shots[1]?.allowedCommands.includes('generate'), false);

assert.equal(speechView.aggregate.executable,false);
assert.equal(speechView.aggregate.allowedCommands.includes('generate'),false);

for(const productionStage of [
  {stage:'budget_decision_required',message:'请决策'},
  {stage:'waiting_for_user_input',message:'input_required:请处理:user_input_required:whole_film_budget_routing:mandatory_plan_exceeds_budget:16:15'},
]){
 const blocked=buildSocialContentProductionReadModel({task:{taskId:'task-1',version:'version-7',status:'attention',runId:'run-1',updatedAt:'2026-10-23',title:'预算阻塞'},workflow:workflowFixture(),studio,productionStage});
 assert.equal(blocked.aggregate.status,'blocked');assert.equal(blocked.aggregate.executable,false);
 assert.ok(blocked.aggregate.inputs.items.some(input=>input.kind==='budget_confirmation'&&input.status==='pending_confirmation'));
 assert.ok(blocked.aggregate.allowedCommands.includes('confirm_budget'));
 assert.ok(!blocked.aggregate.allowedCommands.some(command=>['generate','retry','use_fallback','approve_output'].includes(command)));
 assert.ok(blocked.aggregate.blockers.some(blocker=>blocker.code.includes('production_budget_decision_required')));
}
const overrun=buildSocialContentProductionReadModel({task:{taskId:'task-1',version:'version-7',status:'asset_review',runId:'run-1',updatedAt:'2026-10-23',title:'修订费用超限'},workflow:workflowFixture(),studio,costQuote:{...quote,status:'overrun'}});
assert.equal(overrun.aggregate.status,'blocked');assert.ok(overrun.aggregate.allowedCommands.includes('confirm_budget'));
