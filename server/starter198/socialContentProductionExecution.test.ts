import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildSocialShootingPlanArtifactContent,
  archiveSocialGeneratedShots,
  socialGeneratedShotArchiveCandidates,
  bindCanonicalTypeAwareRouting,
  assertCompleteTypeAwareExecutionPlan,
  SOCIAL_SHOOTING_PLAN_SCHEMA,
} from './socialContentProductionExecution.js';
import { archiveGeneratedSocialContentFile } from './socialContentFiles.js';

const detail: any = {
  taskId: 'task-shooting-plan',
  version: '4',
  brief: {
    title: '精华爆款复刻', productRef: null, platforms: ['douyin'], languages: ['zh'],
  },
  referenceVideoAnalysis: { analysisId: 'analysis-1' },
  agentWorkflow: {
    directorBrief: {
      directorBriefId: 'director-1', totalDurationSeconds: 9,
      referenceAnalysis: { analysisId: 'analysis-1' },
      contentRequirements: {
        product: { required: true, productRef: 'serum-a', confidence: 0.8, reason: '素材自动选定' },
      },
      scenes: [{
        sceneId: 'scene-hook', order: 1, purpose: 'hook', targetVisual: '人物将精华涂抹上脸',
        duration: { startSeconds: 0, endSeconds: 3, targetSeconds: 3 },
        audioLayers: { voiceover: '前三秒锁定的逐字口播', captionIntent: '核心卖点' },
        action: { startState: '手持精华', path: '按压并涂抹', endState: '展示面部' },
        shotLanguage: { shotSize: '近景', cameraAngle: '平视', movement: '轻推', composition: '面部和手部清晰' },
        spaceAndContinuity: ['产品外观一致'], requiredEvidence: [], acceptanceCriteria: ['产品接触位置准确'],
        truthBoundary: { subject: 'product_effect' }, productSceneReplication: null,
      }],
    },
  },
};

{
  const shots=Array.from({length:37},(_,i)=>({shotId:`replication-reference-shot-${i+1}`,sourceStrategy:i<21?'aigc_product_scene_replication':'customer_real_asset',sourceRefs:[],truthBoundary:{},materialRouting:{schemaVersion:'social-material-routing.v1',materialType:i<21?'product':'factory',policy:i<21?'local_first_product_i2v':'local_only',localMatch:{state:i<21?'missing':'matched',sourceRefs:i<21?[]:['local'],evidenceRef:i<21?null:'evidence'},...(i<21?{generation:{method:'reference_first_frame_product_replacement_i2v',durationSeconds:3,productImageRefs:['RS-001']}}:{})},...(i<21?{productSceneReplication:{schemaVersion:'social-product-scene-replication.v1',sceneTemplateKey:`scene-${i}`,productIdentity:{groups:[]}}}:{})}));
  const canonical:any={planVersion:'27',materialRoutingPolicyVersion:'type-aware.v1',shots};
  const approved:any={...structuredClone(canonical),shots:canonical.shots.map((shot:any)=>{const copy=structuredClone(shot);delete copy.materialRouting;delete copy.productSceneReplication;return copy})};
  const rebound=bindCanonicalTypeAwareRouting(approved,canonical);
  assert.equal(rebound.shots.length,37);
  assert.equal(rebound.shots.filter((shot:any)=>shot.materialRouting).length,37);
  assert.equal(rebound.shots.filter((shot:any)=>shot.materialRouting.materialType==='product'&&shot.productSceneReplication).length,21);
  assert.doesNotThrow(()=>assertCompleteTypeAwareExecutionPlan(rebound));
  const schedulerOverlay=structuredClone(approved);
  const finalAfterAllOverlays=bindCanonicalTypeAwareRouting(schedulerOverlay,canonical);
  assert.doesNotThrow(()=>assertCompleteTypeAwareExecutionPlan(finalAfterAllOverlays));
  const localProductFallback=structuredClone(finalAfterAllOverlays);
  Object.assign(localProductFallback.shots[0],{sourceStrategy:'customer_real_asset',sourceRefs:['local-product'],selectedMaterialSegment:{sourceRef:'local-product',segmentId:'cut',startSeconds:0,endSeconds:3}});
  delete localProductFallback.shots[0].productSceneReplication;
  delete localProductFallback.shots[0].materialRouting.generation;
  assert.doesNotThrow(()=>assertCompleteTypeAwareExecutionPlan(localProductFallback));
  assert.throws(()=>assertCompleteTypeAwareExecutionPlan(schedulerOverlay),/execution_routing_missing:replication-reference-shot-1/);
  assert.throws(()=>bindCanonicalTypeAwareRouting({...approved,shots:approved.shots.slice(1)},canonical),/scene_set_changed/);
}

const content: any = buildSocialShootingPlanArtifactContent(detail);
assert.equal(content.workflowSchema, SOCIAL_SHOOTING_PLAN_SCHEMA);
assert.equal(content.contentType, 'shooting_plan');
assert.equal(content.productionMode, 'non_rendering_checklist');
assert.equal(content.providerCallsRequired, false);
assert.equal(content.product.productRef, 'serum-a');
assert.equal(content.hook.precision, 'hook_high');
assert.equal(content.scenes[0].voiceover, '前三秒锁定的逐字口播');
assert.equal(content.scenes[0].action.path, '按压并涂抹');
assert.equal(content.scenes[0].hookPrecision, true);

const source = fs.readFileSync(new URL('./socialContentProductionExecution.ts', import.meta.url), 'utf8');
const earlyBranch = source.indexOf("if (productionApproach === 'shooting_plan')");
const renderWorkspace = source.indexOf('await withSocialContentRenderWorkspace(');
assert.ok(earlyBranch >= 0 && renderWorkspace >= 0 && earlyBranch < renderWorkspace,
  'shooting_plan must return before opening a render workspace');
assert.match(source, /kind: 'shooting_plan'[\s\S]*?finishShootingPlanExecution[\s\S]*?return;/);
const shootingPlanFinalizer = source.slice(
  source.indexOf('async function finishShootingPlanExecution'),
  source.indexOf('export async function runSocialContentAutoProduction'),
);
assert.doesNotMatch(shootingPlanFinalizer, /finishExecution\(/,
  'shooting plans must not enter the video delivery/publishing finalizer');
assert.match(shootingPlanFinalizer, /stage: 'review_ready'[\s\S]*?status: 'completed'/);

const presenterPrepare=source.indexOf('preparePresenterFirstFrameReviews:async');
const presenterPause=source.indexOf("stage:'social.presenter_first_frames'");
const wholeFilmBudget=source.indexOf('const productionBudget = await prepareSocialContentProductionBudget');
const presenterProvider=source.indexOf('motherSupply=await preparePresenterMotherSupply(');
assert.ok(wholeFilmBudget>0&&presenterPrepare>wholeFilmBudget&&presenterPause>presenterPrepare&&presenterProvider>presenterPause,
  'whole-film admission must prepare and persist review nodes before any mother provider invocation');
assert.match(source,/preparePresenterFirstFrameReviews:async[\s\S]*?await input\.runtime\.preparePresenterMotherFirstFrames[\s\S]*?status:'awaiting_explicit_user_confirmation'/,
  'preflight callback must checkpoint inspectable review nodes before explicit confirmation is read');
assert.match(source,/if\(!input\.runtime\?\.evaluatePresenterMotherDynamicQa\)throw Error\('presenter_mother_dynamic_qa_port_missing'\)[\s\S]*?await input\.runtime!\.evaluatePresenterMotherDynamicQa!/,
  'dynamic presenter output must pass the bound identity and lip-sync QA port before crop receipts');
assert.match(source,/const frozenReviewedSupplyPlan = reviewedSupplyPlan \? structuredClone\(reviewedSupplyPlan\) : null;[\s\S]*?frozenSupplyPlan: frozenReviewedSupplyPlan![\s\S]*?planHash:socialRequestHash\(frozenReviewedSupplyPlan\)/,
  'product execution must bind an immutable reviewed supply snapshot before budget and adapter stages can mutate projections');

const generatedAssets: any[] = [
  { id: 'product-scene', name: '产品镜头', type: 'video', sourceId: 'seedance:1', url: '/tmp/product.mp4', localPath: '/tmp/product.mp4', duration: 5, visualObservations: [], segments: [] },
  { id: 'concept', name: '概念镜头', type: 'image', sourceId: 'qwen:2', url: '/tmp/concept.png', localPath: '/tmp/concept.png', duration: 2.8, visualObservations: [], segments: [] },
  { id: 'existing', name: '客户素材', type: 'video', sourceId: 'socialfile:3', url: '/tmp/existing.mp4', duration: 5, visualObservations: [], segments: [] },
  { id: 'presenter', name: '数字人', type: 'video', sourceId: 'heygen:4', url: '/tmp/presenter.mp4', duration: 5, visualObservations: [], segments: [] },
  { id: 'graphics', name: '动态图文', type: 'image', sourceId: 'system:5', url: '/tmp/graphics.png', localPath: '/tmp/graphics.png', duration: 2.8, visualObservations: [], segments: [] },
];
const shot = (sceneId: string, assetId: string, sourceStrategy: string, synthetic: boolean): any => ({
  shotId: sceneId, sceneId, function: 'value', requestedSourceStrategy: sourceStrategy, sourceStrategy,
  fallbackApplied: false, providerId: 'provider', assetId, sourceRef: null, truthBoundary: {},
  functionalEquivalentReplacement: null,
  provenance: { synthetic, representation: synthetic ? 'non_evidentiary_visual' : 'customer_evidence', authorizationRef: null, disclosure: null },
  attempts: [],
});
const candidates = socialGeneratedShotArchiveCandidates({
  assets: generatedAssets,
  execution: {
    schemaVersion: 'social-content.asset-supply-execution.v1', planVersion: '1', creationMode: 'product',
    productionRoute: 'asset_generation', managementMode: 'system', executedAt: '2026-10-09T00:00:00.000Z',
    shots: [
      shot('product-shot', 'product-scene', 'aigc_product_scene_replication', true),
      shot('concept-shot', 'concept', 'non_evidentiary_ai_visual', true),
      shot('existing-shot', 'existing', 'customer_real_asset', false),
      shot('presenter-shot', 'presenter', 'authorized_digital_presenter', true),
      shot('graphics-shot', 'graphics', 'motion_graphics', true),
    ],
  } as any,
});
assert.deepEqual(candidates.map(item => [item.sceneId, item.assetGenerationKind]), [
  ['product-shot', 'product_scene'],
  ['concept-shot', 'concept_visual'],
  ['graphics-shot', 'motion_graphics'],
]);
assert.equal(socialGeneratedShotArchiveCandidates({ assets: generatedAssets, execution: null }).length, 0);

const generatedPath = `/tmp/social-generated-archive-${process.pid}.mp4`;
fs.writeFileSync(generatedPath, Buffer.from('generated-shot-media'));
const archiveInputs: any[] = [];
const archiveExecution: any = {
  schemaVersion: 'social-content.asset-supply-execution.v1', planVersion: '1', creationMode: 'product',
  productionRoute: 'asset_generation', managementMode: 'system', executedAt: '2026-10-09T00:00:00.000Z',
  shots: [shot('product-shot', 'product-scene', 'aigc_product_scene_replication', true)],
};
await archiveSocialGeneratedShots({
  tenantId: 'tenant-a', taskId: 'task-a', now: new Date('2026-10-09T00:00:00.000Z'),
  assets: [{ ...generatedAssets[0], localPath: generatedPath, url: generatedPath, providerTaskId: 'provider-task-1',
    idempotencyKey: 'provider-idempotency-1', segments: [{ model: 'seedance-v1', actualCostCny: 1.2, quality: { passed: true } }] }],
  execution: archiveExecution,
  archiveMedia: async input => {
    archiveInputs.push(input);
    return { id: 'generated-material-1' } as any;
  },
});
const unknownCostInputs: any[] = [];
await archiveSocialGeneratedShots({
  tenantId: 'tenant-a', taskId: 'task-a', now: new Date('2026-10-09T00:00:00.000Z'),
  assets: [{ ...generatedAssets[0], localPath: generatedPath, url: generatedPath, providerTaskId: 'unknown-cost-task',
    idempotencyKey: 'unknown-cost-operation', segments: [{ model: 'seedance-v1', estimatedCostCny: 4, actualCostCny: null, quality: { passed: true } }] }],
  execution: { ...archiveExecution, shots: [shot('product-shot', 'product-scene', 'aigc_product_scene_replication', true)] },
  archiveMedia: async input => { unknownCostInputs.push(input); return { id: 'unknown-cost-material' } as any; },
});
assert.equal(unknownCostInputs[0].generation.estimatedCostCny, 4);
assert.equal(unknownCostInputs[0].generation.actualCostCny, undefined, 'unknown actual invoice must not be cast to zero');
fs.rmSync(generatedPath, { force: true });
assert.equal(archiveInputs.length, 1);
assert.equal(archiveInputs[0].generation.pipelineId, 'non_person_generation');
assert.equal(archiveInputs[0].generation.assetGenerationKind, 'product_scene');
assert.equal(archiveInputs[0].lineage.sourceShotId, 'product-shot');
assert.equal(archiveInputs[0].quality.state, 'accepted');
assert.deepEqual(archiveExecution.shots[0].archivedMaterial, {
  materialId: 'generated-material-1',
  materialRevision: archiveInputs[0].media.contentSha256,
  generationExecutionId: 'provider-task-1',
  adoptedAt: '2026-10-09T00:00:00.000Z',
});
await assert.rejects(() => archiveGeneratedSocialContentFile({
  file: { fileId: 'file-1', taskId: 'task-a', usage: 'artifact_media', fileRef: 'socialfile:file-1', name: 'final.mp4',
    mimeType: 'video/mp4', size: 1, sha256: 'a'.repeat(64), createdAt: '2026-10-09T00:00:00.000Z', downloadUrl: '' },
  stored: { storageKind: 'object', storageKey: 'x', name: 'final.mp4', mimeType: 'video/mp4', byteSize: 1, sha256: 'b'.repeat(64) },
  archive: {} as any,
}), /social_content_file_integrity_violation/);

console.log('social content shooting-plan execution tests passed');
