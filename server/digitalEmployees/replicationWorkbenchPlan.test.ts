import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReplicationWorkbenchSpec, trustedReferenceDuration } from './replicationWorkbenchPlan.js';
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
  assert.equal(isolated.automatedReplicationShots[0].blockerCode,'presenter_authorization_required');
  assert.equal(isolated.automatedReplicationShots[1].productionState,'ready');
});
test('uses frozen director contract and blocks only the person shot missing target narration',()=>{
  const result=buildReplicationWorkbenchSpec({...input,spec:{lang:'en',contentOrder:{scripts:{en:{status:'confirmed',generatedBy:'director_agent',body:spec.script,hash:createHash('sha256').update(JSON.stringify(spec.script)).digest('hex')}}}}}) as any;
  assert.equal(result.script,spec.script);
  const isolated=buildReplicationWorkbenchSpec({...input,spec:{script:'[0-4s]\n画面：人物\n[4-8s]\n台词：Products'}}) as any;
  assert.equal(isolated.automatedReplicationShots[0].blockerCode,'target_narration_missing');
  assert.equal(isolated.automatedReplicationShots[1].productionState,'ready');
});
test('missing reference model-input authorization blocks only person shots',()=>{
  const unauthorized={...reference,modelInputAuthorized:false,modelInputAuthorizationEvidence:''};
  const result=buildReplicationWorkbenchSpec({...input,reference:unauthorized}) as any;
  assert.equal(result.automatedReplicationShots[0].blockerCode,'reference_model_input_authorization_required');
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
test('general is an explicit production scene while unknown remains blocked for evidence review',()=>{
  const general=structuredClone(reference);general.aiAnalysis.gemini.scriptDetails15s[1]!.materialType='general';
  general.aiAnalysis.gemini.scriptDetails15s[1]!.visual='办公室桌面与品牌图形转场';
  const result=buildReplicationWorkbenchSpec({...input,reference:general}) as any;
  assert.equal(result.storyboardSourcePlans['slot-2'].sceneType,'general');
  const unresolved=structuredClone(general);unresolved.aiAnalysis.gemini.scriptDetails15s[1]!.materialType='unknown';
  const unresolvedResult=buildReplicationWorkbenchSpec({...input,reference:unresolved}) as any;
  assert.equal(unresolvedResult.automatedReplicationShots.length,2);
  assert.equal(unresolvedResult.automatedReplicationShots[1].kind,'blocked');
  assert.equal(unresolvedResult.automatedReplicationShots[1].blockerCode,'material_type_unconfirmed');
  assert.equal(unresolvedResult.shotProductions[`video-1:${unresolvedResult.shootingSlots[1].id}`],undefined);
  const observationWindow=structuredClone(general);Object.assign(observationWindow.aiAnalysis.gemini.scriptDetails15s[1]!,{analysisGranularity:'observation_window'});
  const observationResult=buildReplicationWorkbenchSpec({...input,reference:observationWindow}) as any;
  assert.equal(observationResult.automatedReplicationShots[1].blockerCode,'physical_boundary_unconfirmed');
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
