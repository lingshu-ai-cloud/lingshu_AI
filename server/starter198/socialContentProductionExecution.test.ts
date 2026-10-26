import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSocialShootingPlanArtifactContent,
  archiveSocialGeneratedShots,
  socialGeneratedShotArchiveCandidates,
  bindCanonicalTypeAwareRouting,
  rebindDivergentLocalRoutesFromApprovedContext,
  assertCompleteTypeAwareExecutionPlan,
  assetSupplyPlanWithDynamicPresenterBackgroundLocks,
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
  const referenceReuse={recordId:'trend-1',contentSha256:'a'.repeat(64),analysisId:'analysis-1',analysisHash:'b'.repeat(64)};
  const referenceAnalysis:any={analysisId:'analysis-1',referenceSourceId:'reference-source',referenceRecordId:'trend-1',status:'ready',shots:[{shotId:'ref-motion',startSeconds:1,endSeconds:4,materialEvidence:{extractionStatus:'ready',sourceVideoRef:'reference-source',clipRef:'/api/videos/trend-1/shot/ref-motion/clip',firstFrameRef:'/api/videos/trend-1/shot/ref-motion/first-frame',firstFrameSeconds:1.2}}]};
  const plan:any={shots:[{shotId:'dynamic'},{shotId:'stable'}]};
  const selection=(sceneId:string,providerId:'seedance'|'heygen'):any=>({sceneId,providerId,executionStatus:'ready'});
  const frozen=assetSupplyPlanWithDynamicPresenterBackgroundLocks({plan,selections:[selection('dynamic','seedance'),selection('stable','heygen')],referenceReuse,referenceAnalysis,scenes:[{sceneId:'dynamic',referenceShotId:'ref-motion'},{sceneId:'stable',referenceShotId:'ref-motion'}] as any});
  assert.equal(frozen.shots[0]!.referenceBackgroundAssetLock!.referenceShotId,'ref-motion');
  assert.equal(frozen.shots[1].referenceBackgroundAssetLock,undefined,'stable HeyGen must not require a dynamic background lock');
  assert.throws(()=>assetSupplyPlanWithDynamicPresenterBackgroundLocks({plan,selections:[selection('dynamic','seedance')],referenceReuse:null,referenceAnalysis,scenes:[{sceneId:'dynamic',referenceShotId:'ref-motion'}] as any}),/reference_background_source_missing/);
}

{
  const candidate:any={planVersion:'2',materialRoutingPolicyVersion:'type-aware.v2',shots:[{
    shotId:'product',sourceStrategy:'customer_real_asset',sourceRefs:['sku-local'],fallbackSourceStrategy:null,
    selectedMaterialSegment:{sourceRef:'sku-local',segmentId:'same-sku',startSeconds:0,endSeconds:3},
    materialRouting:{schemaVersion:'social-material-routing.v1',materialType:'product',policy:'local_only',
      localMatch:{state:'matched',sourceRefs:['sku-local'],productRef:'sku-a',evidenceRef:'verified-sku'},
      productGenerationDecision:{state:'eligible',importance:'critical',reason:'hero'},
      generation:{productImageRefs:['sku-image'],durationSeconds:3}},
    productSceneReplication:{productIdentity:{groups:[{productRef:'sku-a',referenceImageIds:['sku-image']}]}}}]};
  const stale=structuredClone(candidate);
  stale.shots[0].sourceRefs=['other-sku'];stale.shots[0].selectedMaterialSegment.sourceRef='other-sku';
  delete stale.shots[0].materialRouting;delete stale.shots[0].productSceneReplication;
  const restored=bindCanonicalTypeAwareRouting(stale,candidate);
  assert.equal(restored.materialRoutingPolicyVersion,'type-aware.v2');
  assert.deepEqual(restored.shots[0].sourceRefs,['sku-local']);
  assert.equal(restored.shots[0].selectedMaterialSegment.sourceRef,'sku-local');
  assert.equal(restored.shots[0].materialRouting.productGenerationDecision.state,'eligible');
  assert.deepEqual(restored.shots[0].productSceneReplication,candidate.shots[0].productSceneReplication);
}

{
  const shots=Array.from({length:37},(_,i)=>({shotId:`replication-reference-shot-${i+1}`,sourceStrategy:i<21?'aigc_product_scene_replication':'customer_real_asset',sourceRefs:i<21?[]:['local'],fallbackSourceStrategy:null,truthBoundary:{},materialRouting:{schemaVersion:'social-material-routing.v1',materialType:i<21?'product':'factory',policy:i<21?'local_first_product_i2v':'local_only',localMatch:{state:i<21?'missing':'matched',sourceRefs:i<21?[]:['local'],evidenceRef:i<21?null:'evidence'},...(i<21?{generation:{method:'reference_first_frame_product_replacement_i2v',durationSeconds:3,productImageRefs:['RS-001']}}:{})},...(i<21?{productSceneReplication:{schemaVersion:'social-product-scene-replication.v1',sceneTemplateKey:`scene-${i}`,productIdentity:{groups:[]}}}:{})}));
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
  const staleRealAsset=structuredClone(approved);
  Object.assign(staleRealAsset.shots[21],{sourceStrategy:'aigc_product_scene_replication',sourceRefs:['stale'],fallbackSourceStrategy:'motion_graphics'});
  const restoredRealAsset=bindCanonicalTypeAwareRouting(staleRealAsset,canonical).shots[21];
  assert.equal(restoredRealAsset.sourceStrategy,'customer_real_asset');
  assert.deepEqual(restoredRealAsset.sourceRefs,canonical.shots[21].sourceRefs);
  assert.equal(restoredRealAsset.fallbackSourceStrategy,canonical.shots[21].fallbackSourceStrategy);
  const localProductFallback=structuredClone(finalAfterAllOverlays);
  Object.assign(localProductFallback.shots[0],{sourceStrategy:'customer_real_asset',sourceRefs:['local-product'],selectedMaterialSegment:{sourceRef:'local-product',segmentId:'cut',startSeconds:0,endSeconds:3}});
  delete localProductFallback.shots[0].productSceneReplication;
  delete localProductFallback.shots[0].materialRouting.generation;
  assert.doesNotThrow(()=>assertCompleteTypeAwareExecutionPlan(localProductFallback));
  const ownedProductCanonical=structuredClone(canonical);
  Object.assign(ownedProductCanonical.shots[0],{sourceStrategy:'customer_real_asset',sourceRefs:['owned-product']});
  delete ownedProductCanonical.shots[0].productSceneReplication;
  delete ownedProductCanonical.shots[0].materialRouting.generation;
  ownedProductCanonical.shots[0].materialRouting.localMatch={state:'matched',sourceRefs:['owned-product'],evidenceRef:'owned-proof'};
  const ownedRebound=bindCanonicalTypeAwareRouting(ownedProductCanonical,ownedProductCanonical);
  assert.doesNotThrow(()=>assertCompleteTypeAwareExecutionPlan(ownedRebound));
  const missingGeneratedProduct=structuredClone(canonical);delete missingGeneratedProduct.shots[0].productSceneReplication;
  assert.throws(()=>bindCanonicalTypeAwareRouting(approved,missingGeneratedProduct),/canonical_product_spec_missing/);
  assert.throws(()=>assertCompleteTypeAwareExecutionPlan(schedulerOverlay),/execution_routing_missing:replication-reference-shot-1/);
  assert.throws(()=>bindCanonicalTypeAwareRouting({...approved,shots:approved.shots.slice(1)},canonical),/scene_set_changed/);
  // Scene count belongs to the approved task, not a particular 37-shot
  // reference fixture. Ordinary short productions retain the same exact-ID
  // admission boundary and all per-shot routing/product requirements.
  for(const count of [1,4,37]) {
    const current={...canonical,shots:structuredClone(canonical.shots.slice(0,count))};
    const frozen={...approved,shots:structuredClone(approved.shots.slice(0,count))};
    const rebound=bindCanonicalTypeAwareRouting(frozen,current);
    const ids=current.shots.map((shot:any)=>shot.shotId);
    assert.doesNotThrow(()=>assertCompleteTypeAwareExecutionPlan(rebound,ids));
    assert.throws(()=>bindCanonicalTypeAwareRouting({...frozen,shots:[...frozen.shots,{...frozen.shots[0]}]},current),/scene_set_changed/);
    assert.throws(()=>bindCanonicalTypeAwareRouting({...frozen,shots:frozen.shots.map((shot:any,index:number)=>index?shot:{...shot,shotId:'different'})},current),/scene_set_changed/);
    assert.throws(()=>assertCompleteTypeAwareExecutionPlan({...rebound,shots:rebound.shots.slice(1)},ids),/scene_set_invalid/);
  }
  assert.throws(()=>bindCanonicalTypeAwareRouting({...approved,shots:[]},{...canonical,shots:[]}),/scene_set_changed/);
  assert.throws(()=>bindCanonicalTypeAwareRouting({...approved,shots:[approved.shots[0],approved.shots[0]]},{...canonical,shots:[canonical.shots[0],canonical.shots[0]]}),/scene_set_changed/);
}

{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'approved-local-route-'));
  try{
    const file=path.join(dir,'owned.mp4');fs.writeFileSync(file,'verified-local-video');
    const stale:any={shotId:'shot-16',sourceStrategy:'customer_real_asset',sourceRefs:['missing'],fallbackSourceStrategy:null,
      truthBoundary:{subject:'customer_factory'},materialRouting:{schemaVersion:'social-material-routing.v1',materialType:'factory',policy:'local_only',localMatch:{state:'matched',sourceRefs:['missing'],evidenceRef:'old-proof'}}};
    const approved:any={...stale,sourceRefs:['owned-video'],materialRouting:{...stale.materialRouting,localMatch:{state:'matched',sourceRefs:['owned-video'],evidenceRef:'approved-proof'}}};
    const asset:any={id:'owned-video',sourceId:'library-owned',type:'video',localPath:file,contentHash:'a'.repeat(64)};
    const result=rebindDivergentLocalRoutesFromApprovedContext({plan:{shots:[stale]} as any,approved:{shots:[approved]} as any,assets:[asset]});
    assert.deepEqual(result.plan.shots[0]?.sourceRefs,['owned-video']);
    assert.equal(result.rebindings[0]?.approvalEvidenceRef,'approved-proof');
    assert.deepEqual(rebindDivergentLocalRoutesFromApprovedContext({plan:{shots:[stale]} as any,approved:{shots:[approved]} as any,assets:[]}).rebindings,[]);
    const thirdParty={...approved,sourceRefs:['unowned-video'],materialRouting:{...approved.materialRouting,localMatch:{state:'matched',sourceRefs:['unowned-video'],evidenceRef:'approved-proof'}}};
    assert.deepEqual(rebindDivergentLocalRoutesFromApprovedContext({plan:{shots:[stale]} as any,approved:{shots:[thirdParty]} as any,assets:[{...asset,id:'unowned-video'}]}).rebindings,[]);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
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
const shootingPlanExecutionSource = fs.readFileSync(new URL('./socialContentShootingPlanExecution.ts', import.meta.url), 'utf8');
const earlyBranch = source.indexOf("if (productionApproach === 'shooting_plan')");
const renderWorkspace = source.indexOf('await withSocialContentRenderWorkspace(');
assert.ok(earlyBranch >= 0 && renderWorkspace >= 0 && earlyBranch < renderWorkspace,
  'shooting_plan must return before opening a render workspace');
assert.match(source, /if \(productionApproach === 'shooting_plan'\) \{\s*await createShootingPlanExecution\([\s\S]*?return;/);
assert.match(shootingPlanExecutionSource, /kind: 'shooting_plan'[\s\S]*?finishShootingPlanExecution\(input, artifactResult\.artifact\.artifactId\)/);
assert.doesNotMatch(shootingPlanExecutionSource, /finishExecution\(|withSocialContentRenderWorkspace\(/,
  'shooting plans must not enter the video delivery/publishing finalizer');
assert.match(shootingPlanExecutionSource, /stage: 'review_ready'[\s\S]*?status: 'completed'/);

const presenterPrepare=source.indexOf('preparePresenterFirstFrameReviews:async');
const presenterPause=source.indexOf("stage:'social.presenter_first_frames'");
const wholeFilmBudget=source.indexOf('const productionBudget = await prepareSocialContentProductionBudget');
const presenterProvider=source.indexOf('motherSupply=await preparePresenterMotherSupply(');
assert.ok(wholeFilmBudget>0&&presenterPrepare>wholeFilmBudget&&presenterPause>presenterPrepare&&presenterProvider>presenterPause,
  'whole-film admission must prepare and persist review nodes before any mother provider invocation');
assert.match(source,/preparePresenterFirstFrameReviews:async[\s\S]*?await input\.runtime\.preparePresenterMotherFirstFrames[\s\S]*?automaticallyConfirmPresenterFirstFrameApproval[\s\S]*?status:(?:nativeSourceOnly\?'catalogue_source_confirmed_visual_review_pending':)?'automatically_confirmed_after_static_qa'/,
  'preflight callback must automatically confirm QA-passed review nodes with the trusted system actor');
assert.doesNotMatch(source,/awaiting_explicit_user_confirmation|presenter_first_frames_pending_confirmation/,
  'production must never pause for a user confirmation after static first-frame QA passes');
assert.match(source,/if\(!input\.runtime\?\.evaluatePresenterMotherDynamicQa\|\|!preparedWholeVoice\)throw Error\('presenter_mother_frozen_audio_and_lip_sync_qa_unavailable'\)[\s\S]*?assertPresenterMotherSpeechQaReady\(\)[\s\S]*?readPreparedWholeVoiceScene\([\s\S]*?await input\.runtime!\.evaluatePresenterMotherDynamicQa![\s\S]*?inspectPresenterMotherSpeechQa\(/,
  'paid mother speech requires certified frozen-audio and lip-sync QA before provider submission and crop receipts');
assert.match(source,/if \(assetSupplyCheckpointReused && supplyCheckpoint\) \{[\s\S]*?if\(presenterGroupRequirements\.length\)[\s\S]*?readPreparedWholeVoiceScene\([\s\S]*?assertRestoredPresenterMotherExecution\([\s\S]*?assets = restoredAssets/,
  'a cached mother supply must re-open the current frozen audio and measured QA before it becomes a restored asset');
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

assert.match(source,/schemaVersion==='social-presenter-first-frame-approval.v3'\?\{originalSceneApproval:structuredClone\(confirmation.approval\)\}/,'only verified v3 original approvals reach the presenter adapter');
assert.match(source,/buildSocialPresenterSceneSources\(\{groups,/,'budget static preparation consumes original scene source contract');
assert.match(source,/buildSocialPresenterMotherSceneSources\(/,'mother handoff reuses frozen original scene sources');
assert.match(source,/if \(executedSupplyPlan && assetSupplyExecution\) \{[\s\S]*?buildInitialSocialSceneCacheInput\([\s\S]*?referenceAnalysis: detail\.referenceVideoAnalysis \?\? null/,
  'both original and reference productions enter the same initial scene-cache handoff');
assert.doesNotMatch(source,/executedSupplyPlan && assetSupplyExecution && detail\.referenceVideoAnalysis/,
  'an original production must not be excluded from scene-cache and rework recovery');
assert.doesNotMatch(source,/if\(!referenceAnalysis\)throw Error\('presenter_first_frame_reference_analysis_missing'\)/,'authored scenes do not require fabricated benchmark analysis');
