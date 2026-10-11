import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReplicationWorkbenchSpec, managedReplicationAction, trustedReferenceDuration } from './replicationWorkbenchPlan.js';
const reference = { id:'reference-1', tenantId:'tenant-1', duration:8, modelInputAuthorized:true, modelInputAuthorizationEvidence:'enterprise-owned-reference AUTH-1', aiAnalysis:{analysisMode:'exact',analysisQuality:'video',gemini:{scriptDetails15s:[
  {time:'0-4s',materialType:'talking_head',narrativeRole:'hook',classificationEvidence:'visible presenter',visual:'人物面向镜头口播',dialogue:'Original competitor claim'},
  {time:'4-8s',materialType:'product',narrativeRole:'product_intro',classificationEvidence:'product closeup',visual:'产品近景'},
]}}};
const spec={script:'[0-4s]\n台词：Our own verified product.\n[4-8s]\n台词：Discover more.',automation:{route:'clone',orderId:'order-1'},contentOrder:{id:'order-1'}};
const input={tenantId:'tenant-1',projectId:'project-1',reference,spec,presenterId:'presenter-1',productIds:['product-1']};
test('business order initializes stable real shot workbench without catalog assignments',()=>{
  const result=buildReplicationWorkbenchSpec(input) as any;
  assert.deepEqual(result.automation,spec.automation); assert.equal(result.script,spec.script);
  assert.equal(result.shootingSlots.length,2); assert.deepEqual(result.storyboardAssignments,{});
  assert.deepEqual(result.automatedReplicationShots.map((s:any)=>s.kind),['person','nonperson']);
  assert.match(result.automatedReplicationShots[0].fingerprintContext,/^automated-replication-shot:/);
  assert.notEqual(result.automatedReplicationShots[0].fingerprintContext,result.automatedReplicationShots[1].fingerprintContext);
  const person=result.shotProductions[`video-1:${result.shootingSlots[0].id}`];
  assert.equal(person.digitalHuman.reference.cues[0].targetText,'Our own verified product.');
  assert.equal(person.digitalHuman.reference.cues[0].originalText,'Original competitor claim');
  assert.equal(result.automatedReplicationShots[1].firstFrameRequest.sourceFirstFrameUrl,'/api/overseas/videos/reference-1/shot/2/first-frame');
  assert.equal(buildReplicationWorkbenchSpec({...input,spec:result}),result);
});
test('tenant mismatch and incomplete reference fail while an unauthorized person shot is isolated',()=>{
  assert.throws(()=>buildReplicationWorkbenchSpec({...input,tenantId:'other'}),/当前企业/);
  assert.throws(()=>buildReplicationWorkbenchSpec({...input,reference:{...reference,duration:12}}),/时间线不完整/);
  const isolated=buildReplicationWorkbenchSpec({...input,presenterId:''}) as any;
  assert.equal(isolated.automatedReplicationShots[0].productionState,'blocked');
  assert.equal(isolated.automatedReplicationShots[0].blockerCode,'avatar_required');
  assert.equal(isolated.automatedReplicationShots[1].productionState,'ready');
});
test('uses frozen director contract and safely replaces a person shot missing target narration',()=>{
  const result=buildReplicationWorkbenchSpec({...input,spec:{lang:'en',contentOrder:{scripts:{en:{status:'confirmed',generatedBy:'director_agent',body:spec.script,hash:createHash('sha256').update(JSON.stringify(spec.script)).digest('hex')}}}}}) as any;
  assert.equal(result.script,spec.script);
  const isolated=buildReplicationWorkbenchSpec({...input,spec:{script:'[0-4s]\n画面：人物\n[4-8s]\n台词：Products'}}) as any;
  assert.equal(isolated.automatedReplicationShots[0].kind,'nonperson');
  assert.equal(isolated.storyboardSourcePlans['slot-1'].fallbackMode,'enterprise_product_display');
  assert.equal(isolated.automatedReplicationShots[1].productionState,'ready');
});
test('missing reference model-input authorization uses an enterprise product fallback without source frames',()=>{
  const unauthorized={...reference,modelInputAuthorized:false,modelInputAuthorizationEvidence:''};
  const result=buildReplicationWorkbenchSpec({...input,reference:unauthorized}) as any;
  assert.equal(result.automatedReplicationShots[0].kind,'nonperson');
  assert.equal(result.automatedReplicationShots[0].firstFrameRequest.sourceFirstFrameUrl,undefined);
  assert.equal(result.storyboardSourcePlans['slot-1'].fallbackMode,'enterprise_product_display');
  assert.equal(result.automatedReplicationShots[1].productionState,'ready');
});
test('exact legacy shots supported and changed evidence cannot overwrite paid state',()=>{
  const legacy={...reference,aiAnalysis:{...reference.aiAnalysis,gemini:{shots:reference.aiAnalysis.gemini.scriptDetails15s}}};
  const result=buildReplicationWorkbenchSpec({...input,reference:legacy});
  const changed=structuredClone(reference);changed.aiAnalysis.gemini.scriptDetails15s[0]!.visual='different action';
  assert.throws(()=>buildReplicationWorkbenchSpec({...input,spec:result,reference:changed}),/不能覆盖/);
});
test('a frozen line crossing reference shots is partitioned once across the timeline',()=>{
  const result=buildReplicationWorkbenchSpec({...input,spec:{script:'[0-8s]\n台词：One two three four five six seven eight'}}) as any;
  const lines=result.shootingSlots.map((slot:any)=>result.shotProductions[`video-1:${slot.id}`].narration);
  assert.deepEqual(lines,['One two three four','five six seven eight']);
});
test('last reference overrun uses verified scene cuts plus media duration, without inventing boundaries',()=>{
  const r=structuredClone(reference);r.aiAnalysis.gemini.scriptDetails15s[1]!.time='4-10s';
  Object.assign(r.aiAnalysis.gemini,{detectedSceneCuts:[4]});
  const result=buildReplicationWorkbenchSpec({...input,reference:r}) as any;
  assert.equal(result.automatedReplicationShots[1].end,8);
  assert.equal(result.automatedReplicationPlan.terminalBoundaryCorrection.originalEnd,10);
  Object.assign(r.aiAnalysis.gemini,{detectedSceneCuts:[5]});
  assert.throws(()=>buildReplicationWorkbenchSpec({...input,reference:r}),/时间线不完整/);
});
test('general is explicit while unknown and observation windows safely downgrade without blocking production',()=>{
  const general=structuredClone(reference);general.aiAnalysis.gemini.scriptDetails15s[1]!.materialType='general';
  general.aiAnalysis.gemini.scriptDetails15s[1]!.visual='办公室桌面与品牌图形转场';
  const result=buildReplicationWorkbenchSpec({...input,reference:general}) as any;
  assert.equal(result.storyboardSourcePlans['slot-2'].sceneType,'general');
  const unresolved=structuredClone(general);unresolved.aiAnalysis.gemini.scriptDetails15s[1]!.materialType='unknown';
  const unresolvedResult=buildReplicationWorkbenchSpec({...input,reference:unresolved}) as any;
  assert.equal(unresolvedResult.automatedReplicationShots.length,2);
  assert.equal(unresolvedResult.automatedReplicationShots[1].kind,'nonperson');
  assert.equal(unresolvedResult.storyboardSourcePlans['slot-2'].fallbackMode,'enterprise_product_display');
  assert.ok(unresolvedResult.shotProductions[`video-1:${unresolvedResult.shootingSlots[1].id}`]);
  const observationWindow=structuredClone(general);Object.assign(observationWindow.aiAnalysis.gemini.scriptDetails15s[1]!,{analysisGranularity:'observation_window'});
  const observationResult=buildReplicationWorkbenchSpec({...input,reference:observationWindow}) as any;
  assert.equal(observationResult.automatedReplicationShots[1].kind,'nonperson');
  assert.match(observationResult.automatedReplicationShots[1].firstFrameRequest.shotDescription,/仅保留时间窗口/);
});

test('trusted source clock for the current analysis run preserves the precise terminal boundary',()=>{
  const r=structuredClone(reference) as any;
  r.duration=8;
  r.aiAnalysis.analysisRunId='run-current';
  r.aiAnalysis.contentSha256='a'.repeat(64);
  r.aiAnalysis.gemini.sourceMediaClock={analysisRunId:'run-current',duration:8.41,sourceSha256:'a'.repeat(64)};
  r.aiAnalysis.gemini.scriptDetails15s[1].time='4-8.41s';
  const result=buildReplicationWorkbenchSpec({...input,reference:r}) as any;
  assert.equal(result.automatedReplicationShots[1].end,8.41);
  assert.equal(trustedReferenceDuration(r),8.41);
  r.aiAnalysis.gemini.sourceMediaClock.analysisRunId='stale-run';
  assert.equal(trustedReferenceDuration(r),8);
  r.aiAnalysis.gemini.sourceMediaClock.analysisRunId='run-current';
  r.aiAnalysis.gemini.sourceMediaClock.sourceSha256='b'.repeat(64);
  assert.equal(trustedReferenceDuration(r),8);
  delete r.aiAnalysis.contentSha256;
  r.videoFileId='objects/reference-1.mp4';
  Object.assign(r.aiAnalysis.gemini.sourceMediaClock,{sourceSha256:'a'.repeat(64),videoObjectKey:'objects/reference-1.mp4'});
  assert.equal(trustedReferenceDuration(r),8.41,'legacy exact records may trust the CAS-bound object-key clock receipt');
});

test('usage without a product-bound action becomes a non-use product display', () => {
  const r = structuredClone(reference);
  Object.assign(r.aiAnalysis.gemini.scriptDetails15s[1]!, { materialType: 'consumer_demo',
    visual: '香水喷向手腕', startState: '香水瓶对准手腕', endState: '喷雾落到手腕', beats: [{ action: '按压香水喷头' }] });
  const result = buildReplicationWorkbenchSpec({ ...input, reference: r, productIds: ['clay-mask'] }) as any;
  assert.equal(result.automatedReplicationShots[1].kind, 'nonperson');
  assert.equal(result.automatedReplicationShots[1].firstFrameRequest.sceneType, 'product');
  assert.match(result.automatedReplicationShots[1].firstFrameRequest.shotDescription,/不演示未确认用法/);
  assert.equal(result.automatedReplicationShots[0].kind, 'person', 'one missing action must not block an independent ready shot');
  assert.equal(result.videoKickoff.referenceAnalysis.details[1].startState, '香水瓶对准手腕', 'observed facts are retained as reference, not applied to the target');
});

test('explicit target-product action flows through native source plans and request without copying competitor motion', () => {
  const r = structuredClone(reference);
  Object.assign(r.aiAnalysis.gemini.scriptDetails15s[1]!, { materialType: 'consumer_demo', visual: '香水喷向手腕' });
  const saved = { productIds: ['product-1'], actionStartState: '目标产品放在桌面', actionBeats: '双手拿起目标产品；保持正面朝向镜头', actionEndState: '双手稳定展示正面' };
  const result = buildReplicationWorkbenchSpec({ ...input, reference: r, spec: { ...spec, storyboardSourcePlans: { 'slot-2': saved } } }) as any;
  const action = result.automatedReplicationShots[1].firstFrameRequest.action;
  assert.equal(action.evidence, 'confirmed_storyboard');
  assert.deepEqual(action.beats, ['双手拿起目标产品', '保持正面朝向镜头']);
  assert.equal(result.storyboardSourcePlans['slot-2'].actionEndState, saved.actionEndState);
  const changedProduct = buildReplicationWorkbenchSpec({ ...input, reference: r, productIds: ['other-product'], spec: { ...spec, storyboardSourcePlans: { 'slot-2': saved } } }) as any;
  assert.equal(changedProduct.automatedReplicationShots[1].kind, 'nonperson');
  assert.equal(changedProduct.storyboardSourcePlans['slot-2'].fallbackMode, 'enterprise_product_display');
});

test('version one plans migrate soft blockers while preserving receipts and assignments', () => {
  const first = buildReplicationWorkbenchSpec(input) as any;
  const legacy = structuredClone(first);
  legacy.automatedReplicationPlan.version = 1;
  legacy.automatedReplicationShots[1] = { ...legacy.automatedReplicationShots[1], kind: 'blocked', productionState: 'blocked', blockerCode: 'material_type_unconfirmed' };
  legacy.storyboardSourcePlans['slot-2'] = { mode: 'blocked', blockerCode: 'material_type_unconfirmed' };
  legacy.storyboardAssignments['slot-1'] = 'existing-video';
  legacy.automatedReplicationProgress = { [legacy.automatedReplicationShots[0].shotId]: { materialId: 'existing-video', adopted: true } };
  const migrated = buildReplicationWorkbenchSpec({ ...input, spec: legacy }) as any;
  assert.equal(migrated.automatedReplicationPlan.version, 2);
  assert.equal(migrated.automatedReplicationShots[1].productionState, 'ready');
  assert.equal(migrated.storyboardAssignments['slot-1'], 'existing-video');
  assert.equal(migrated.automatedReplicationProgress[legacy.automatedReplicationShots[0].shotId].materialId, 'existing-video');
});

test('reference motion is copied only for the same enterprise-owned product with confirmed evidence', () => {
  const raw = { startState: '瓶子在桌面', beats: [{ action: '双手拿起瓶子' }], endState: '瓶子在手中', camera: '固定' };
  const same = { scope: 'own', productId: 'p' };
  assert.equal(managedReplicationAction({ raw, plan: {}, reference: same, productIds: ['p'] })?.evidence, 'confirmed_reference_analysis');
  assert.equal(managedReplicationAction({ raw: { ...raw, needsReview: true }, plan: {}, reference: same, productIds: ['p'] }), null);
  assert.equal(managedReplicationAction({ raw, plan: {}, reference: { ...same, scope: 'reference' }, productIds: ['p'] }), null);
  assert.equal(managedReplicationAction({ raw, plan: {}, reference: same, productIds: ['other'] }), null);
});
