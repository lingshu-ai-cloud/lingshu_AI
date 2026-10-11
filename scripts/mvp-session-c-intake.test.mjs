import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectSessionCIntake} from './mvp-session-c-intake.mjs';
import {socialMvpHandoffFixture} from '../shared/contracts/socialMvpHandoff.fixture.ts';

test('missing A/B and old final alone never certify MVP', async()=>{
 const r=await inspectSessionCIntake({artifacts:[{role:'finalVideo',file:'old.mp4'}]});
 assert.equal(r.mvpPassed,false); assert.equal(r.contractStatus,'blocked');
 assert.ok(r.blockers.includes('digitalHuman_missing_or_duplicate'));
 assert.ok(r.blockers.includes('human_creative_review_missing'));
});
test('legacy four-key handoff is blocked; cross-run and mutated bytes block',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'mvp-c-'));
 try {
  await writeFile(path.join(dir,'asset'),'fixture bytes');
  const hash=createHash('sha256').update('fixture bytes').digest('hex');
  const scope={tenantId:'t',taskId:'task',runId:'run',version:'1'};
  const artifacts=['reference','script','storyboard','voiceover','digitalHuman','aigc','enterpriseMaterial','finalVideo'].map(role=>({role,scope:{...scope},file:'asset',sha256:hash,provider:{name:'fixture',taskId:'receipt',rawReceiptRef:'receipt.json'},cost:{estimated:1,actual:1,currency:'CNY',ledgerRef:'ledger'},authorizationRef:'authorization',sourceSha256s:[hash]}));
  const input={expectedScope:scope,artifacts,technicalReview:{status:'passed',reportRef:'tech'},creativeReview:{status:'passed',reviewerId:'human',reportRef:'creative'}};
  const result=await inspectSessionCIntake(input,dir);
  assert.equal(result.contractStatus,'blocked'); assert.ok(result.blockers.includes('unified_execution_package_missing_or_invalid')); assert.equal(result.mvpPassed,false); assert.equal(result.providerVerified,false);
  artifacts[4].scope.runId='other';
  assert.ok((await inspectSessionCIntake(input,dir)).blockers.includes('digitalHuman_scope_mismatch'));
  await writeFile(path.join(dir,'asset'),'changed');
  assert.ok((await inspectSessionCIntake(input,dir)).blockers.includes('finalVideo_bytes_mismatch'));
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('unified seven-key package rejects A/B product mismatch and missing package even with passing review claims', async()=>{
 const scope={tenantId:'t',accountId:'account',productId:'product',projectId:'project',taskId:'task',runId:'run',version:'1'};
 const hash='a'.repeat(64),ref={id:'fixture-ref',version:'1',sha256:hash};
 const executionPackage={schemaVersion:'social-mvp-execution-package.v1',scope,recordHash:hash,reference:{...ref,sourceRef:'source',usageBoundaryRef:ref},personaBasis:ref,director:ref,script:ref,storyboard:ref,voiceover:ref,qualityStandardRef:ref,recovery:{mode:'resume_original_attempt',ledgerScopeRef:ref},avatar:{id:'avatar',version:'1',rightsRef:ref},voice:{id:'voice',version:'1',rightsRef:ref},scenes:[{sceneId:'a',role:'digital_human',inputFingerprint:hash,factRefs:[],rightsRefs:[ref]},{sceneId:'b',role:'key_aigc',inputFingerprint:hash,factRefs:[],rightsRefs:[ref]}],budgets:{A:{currency:'CNY',maximum:5,authorizationRef:ref},B:{currency:'CNY',maximum:6,authorizationRef:ref},total:{currency:'CNY',maximum:11,authorizationRef:ref}}};
 const foreign={schemaVersion:'social-mvp-clip-handoff.v1',scope:{...scope,productId:'other'},packageHash:hash,lane:'B',sceneId:'b',inputFingerprint:hash,avatarVersion:null,voiceVersion:null,file:{path:'does-not-exist',sha256:hash},provider:{providerId:'fixture',taskId:'provider-task',requestId:'request',attemptId:'attempt',receiptRef:ref},cost:{state:'settled',currency:'CNY',actual:1,reserved:0,ledgerRef:ref},factRefs:[],rightsRefs:[ref]};
 const result=await inspectSessionCIntake({expectedScope:scope,executionPackage,clips:[foreign],technicalReview:{status:'passed',reportRef:'tech'},creativeReview:{status:'passed',reviewerId:'agent',reportRef:'self-claim'}});
 assert.equal(result.contractStatus,'blocked');assert.equal(result.mvpPassed,false);assert.ok(result.blockers.includes('clip_handoff_invalid_or_unavailable'));
 assert.ok(result.blockers.includes('required_scene_handoff_missing'));
 const missing=await inspectSessionCIntake({expectedScope:scope,clips:[]});
 assert.ok(missing.blockers.includes('unified_execution_package_missing_or_invalid'));
});

test('every business scope key rejects mismatched clip; editable humanConfirmed never grants acceptance', async()=>{
 for (const key of ['tenantId','accountId','productId','projectId','taskId','runId','version']) {
  const f=socialMvpHandoffFixture();f.B.scope[key]='foreign';
  const r=await inspectSessionCIntake({expectedScope:f.package.scope,executionPackage:f.package,clips:[f.A,f.B],historicalBudgetSpent:{A:0,B:0},humanConfirmed:true,creativeReview:{status:'passed',reviewerId:'robot',reportRef:'claim'}});
  assert.equal(r.contractStatus,'blocked');assert.equal(r.creativeAccepted,false);assert.equal(r.mvpPassed,false);
  assert.ok(r.blockers.includes('clip_handoff_invalid_or_unavailable'),key);
 }
});

test('A authority audit with no executable candidate blocks both conditional A and historical B', async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'mvp-c-identity-'));
 try {
  const bytes=JSON.stringify({executable:false,uniqueExecutableCandidate:null,state:'blocked_business_identity_unresolved',soleTraceableCandidate:{productId:'GUIANFA-RS-001'}});
  await writeFile(path.join(dir,'identity.json'),bytes);
  const f=socialMvpHandoffFixture();
  const r=await inspectSessionCIntake({expectedScope:f.package.scope,executionPackage:f.package,clips:[f.A,f.B],businessIdentityAudit:{file:'identity.json',sha256:createHash('sha256').update(bytes).digest('hex')}},dir);
  assert.ok(r.blockers.includes('business_identity_unresolved'));assert.equal(r.mvpPassed,false);
 } finally {await rm(dir,{recursive:true,force:true});}
});
