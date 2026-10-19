import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareWeeklyEnterpriseFactFixture} from './weeklyEnterpriseFactSupplement.fixture.js';
import {adoptWeeklyAutomationTemplate} from '../socialPrograms/weeklyAutomationTemplate.js';
import {independentAdmissionId,WEEKLY_INDEPENDENT_ADMISSIONS} from '../socialPrograms/weeklyIndependentAdmission.js';
import {prepareWeeklyCandidateExactProductionEscrow,prepareWeeklyCandidateExactProductionEscrowV2,weeklyCandidateExactProductionEscrowV2LedgerPath,WEEKLY_CANDIDATE_EXACT_PRODUCTION_ESCROWS} from './weeklyCandidateExactProductionEscrow.js';
import type {WeeklyPreproductionJob} from './weeklyPreproductionProducer.js';
import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';
import {createQwenMaaSPublishedTariffReader} from '../lib/socialContentPublishedTariffs.js';
import {createWeeklyCandidateDynamicExactPaidRequestsV2,weeklyCandidateDynamicExactInitialHeadV2,type WeeklyCandidateDynamicExactHeadV2,type WeeklyCandidateDynamicExactPlanV2} from './weeklyCandidateExactPaidRequests.js';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
async function v2Input(t:test.TestContext){
 const f=await prepareWeeklyEnterpriseFactFixture(t),root=fs.mkdtempSync(path.join(os.tmpdir(),'weekly-exact-production-escrow-v2-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 f.pkg.socialContentPackage.weeklyBudgetCny=50;f.pkg.socialContentPackage.perItemBudgetCny=10;
 const packageRow=(await f.store.list<any>('social_weekly_operating_packages',{where:{tenant_id:f.task.tenantId,package_id:f.task.packageId},perPage:2})).items[0]!;await f.store.update('social_weekly_operating_packages',packageRow.id,{payload:f.pkg});
 const scope={tenantId:f.task.tenantId,programId:f.task.programId,packageId:f.task.packageId,packageVersion:f.task.packageVersion};await adoptWeeklyAutomationTemplate(f.store,scope,'owner');
 const independent={...scope,actorUserId:'owner',admittedAt:new Date().toISOString(),mode:'independent_branches' as const,authorizePublishing:false as const,authorizeMessaging:false as const};
 await f.store.create(WEEKLY_INDEPENDENT_ADMISSIONS,{id:independentAdmissionId(scope),tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,package_version:scope.packageVersion,payload:independent});
 const job:WeeklyPreproductionJob={jobId:'job-v2',...scope,consumerTaskId:f.task.taskId,consumerInputHash:'input',kind:'discovery',status:'running',originalRunKey:'weekly-preproduction:job-v2',actorUserId:'owner',dueAt:'2026-10-12T00:00:00.000Z',boundAt:'2026-10-11T00:00:00.000Z',updatedAt:'2026-10-11T00:00:00.000Z',sourceHash:'a'.repeat(64),authority:{scopeId:'scope-v2',scopeVersion:1,scopeHash:'b'.repeat(64),requestedModes:['account']},code:null,resultRefs:[],recordHash:'c'.repeat(64)};
 const run:SocialInspirationCollectionRun={runId:'run-v2',planId:'plan',keywordSetId:'keywords',keywordSetVersion:1,discoveryScopeId:'scope-v2',discoveryScopeVersion:1,status:'stopped',triggerType:'manual',scopeSnapshot:{weeklyProducer:{key:job.originalRunKey}} as any,modeStats:{},platformStats:{},keywordTierStats:{},evidenceOutcomes:{},sourceRunRefs:[],queryBasis:{},market:'US',language:'en',stopReason:'no_valid_results',startedAt:'2026-10-11T00:00:00.000Z',finishedAt:'2026-10-11T01:00:00.000Z',error:null,failureDetails:[]};
 const candidates=Array.from({length:5},(_,index)=>({candidateId:`candidate-v2-${index}`,mediaSha256:String(index).repeat(64),operationId:`operation-v2-${index}`}));
 const endpoint='https://maas.qianwenaiapi.com/compatible-mode/v1',integrityKey='isolated-v2-escrow-key',credentialSha256=sha(integrityKey),accountRef=`qwen:${sha(JSON.stringify({baseUrl:endpoint,credentialSha256}))}`;
 const tariff=await createQwenMaaSPublishedTariffReader({now:()=>new Date('2026-10-19T12:00:00.000Z'),readProviderBinding:async()=>({provider:'qwen',model:'qwen3-vl-plus',baseUrl:endpoint,credentialSha256})}).read({provider:'qwen',model:'qwen3-vl-plus',accountRef,stage:'candidate_exact_analysis',shotId:null,operationId:'v2-escrow-tariff',inputContractHash:'f'.repeat(64),maximumUnits:{inputTokens:260096,outputTokens:16384}});assert.ok(tariff);
 const provider={endpoint,credentialSha256,model:'qwen3-vl-plus' as const,pricingEvidence:tariff.publicPricingEvidence};
 return {f,root,job,run,candidates,provider,integrityKey,input:{store:f.store,job,run,root,provider,candidates}};
}

test('accepted weekly ten-yuan production authority creates one restart-safe exact-analysis escrow without a second user approval',async t=>{
 const f=await prepareWeeklyEnterpriseFactFixture(t),root=fs.mkdtempSync(path.join(os.tmpdir(),'weekly-exact-production-escrow-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 f.pkg.socialContentPackage.weeklyBudgetCny=50;f.pkg.socialContentPackage.perItemBudgetCny=10;
 const packageRow=(await f.store.list<any>('social_weekly_operating_packages',{where:{tenant_id:f.task.tenantId,package_id:f.task.packageId},perPage:2})).items[0]!;
 await f.store.update('social_weekly_operating_packages',packageRow.id,{payload:f.pkg});
 const scope={tenantId:f.task.tenantId,programId:f.task.programId,packageId:f.task.packageId,packageVersion:f.task.packageVersion};
 const adoption=await adoptWeeklyAutomationTemplate(f.store,scope,'owner');
 const independent={...scope,actorUserId:'owner',admittedAt:new Date().toISOString(),mode:'independent_branches' as const,authorizePublishing:false as const,authorizeMessaging:false as const};
 await f.store.create(WEEKLY_INDEPENDENT_ADMISSIONS,{id:independentAdmissionId(scope),tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,package_version:scope.packageVersion,payload:independent});
 const job:WeeklyPreproductionJob={jobId:'job',...scope,consumerTaskId:f.task.taskId,consumerInputHash:'input',kind:'discovery',status:'running',originalRunKey:'weekly-preproduction:job',actorUserId:'owner',dueAt:'2026-10-12T00:00:00.000Z',boundAt:'2026-10-11T00:00:00.000Z',updatedAt:'2026-10-11T00:00:00.000Z',sourceHash:'a'.repeat(64),authority:{scopeId:'scope',scopeVersion:1,scopeHash:'b'.repeat(64),requestedModes:['account']},code:null,resultRefs:[],recordHash:'c'.repeat(64)};
 const run:SocialInspirationCollectionRun={runId:'run',planId:'plan',keywordSetId:'keywords',keywordSetVersion:1,discoveryScopeId:'scope',discoveryScopeVersion:1,status:'stopped',triggerType:'manual',scopeSnapshot:{weeklyProducer:{key:job.originalRunKey}} as any,modeStats:{},platformStats:{},keywordTierStats:{},evidenceOutcomes:{},sourceRunRefs:[],queryBasis:{},market:'US',language:'en',stopReason:'no_valid_results',startedAt:'2026-10-11T00:00:00.000Z',finishedAt:'2026-10-11T01:00:00.000Z',error:null,failureDetails:[]};
 const candidates=Array.from({length:5},(_,index)=>({candidateId:`candidate-${index}`,mediaSha256:String(index).repeat(64),operationId:`operation-${index}`}));
 const input={store:f.store,job,run,root,provider:{endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1',credentialSha256:'d'.repeat(64),model:'qwen3-vl-plus' as const,tariffEvidenceHash:'e'.repeat(64),auditApiKeyId:'official-key-id'},candidates};
 const first=await prepareWeeklyCandidateExactProductionEscrow(input);assert.equal(first.escrow.maximumCnyPerCandidate<=10,true);assert.equal(first.escrow.maximumCnyTotal<=50,true);assert.equal(first.escrow.authorizesPublishing,false);assert.equal(first.escrow.independentAdmissionHash.length,64);assert.equal(first.escrow.templateAdoptionHash.length,64);assert.equal(adoption.userApproval,null);
 const hold=await first.reserve(candidates[0]!.candidateId,candidates[0]!.mediaSha256,candidates[0]!.operationId);assert.equal(hold.authorizationHash,first.escrow.recordHash);assert.equal((await first.status()).entries[candidates[0]!.operationId]?.state,'reserved');
 const reopened=await prepareWeeklyCandidateExactProductionEscrow(input);assert.equal(reopened.escrow.recordHash,first.escrow.recordHash);assert.deepEqual(await reopened.status(),await first.status());assert.equal((await f.store.list(WEEKLY_CANDIDATE_EXACT_PRODUCTION_ESCROWS)).totalItems,1);
 await assert.rejects(reopened.reserve(candidates[0]!.candidateId,'f'.repeat(64),candidates[0]!.operationId),/candidate_changed/);
 f.pkg.socialContentPackage.weeklyBudgetCny=49;await f.store.update('social_weekly_operating_packages',packageRow.id,{payload:f.pkg});
 await assert.rejects(reopened.reserve(candidates[1]!.candidateId,candidates[1]!.mediaSha256,candidates[1]!.operationId),/authority_changed/,'a package budget change invalidates the original hold rather than minting another allowance');
});

test('v2 freezes complete pricing evidence and reserves five independent shares of the existing mother budgets',async t=>{
 const f=await v2Input(t),first=await prepareWeeklyCandidateExactProductionEscrowV2(f.input);
 assert.equal(first.escrow.schema,'weekly-candidate-exact-production-escrow.v2');assert.equal(first.escrow.authorizesProviderExecution,false);
 assert.equal(first.escrow.candidateMaximumMicros,10_000_000);assert.equal(first.escrow.weeklyExactMaximumMicros,50_000_000);
 assert.equal(first.escrow.pricingEvidenceHash,sha(JSON.stringify(f.provider.pricingEvidence)));assert.match(first.escrow.pricingPolicyHash,/^[a-f0-9]{64}$/);
 let firstReservation:Awaited<ReturnType<typeof first.reserve>>|null=null;
 for(const candidate of f.candidates){const reservation=await first.reserve(candidate.candidateId,candidate.mediaSha256,candidate.operationId);firstReservation??=reservation;}
 assert.equal(Object.keys(first.readOnlyStatus().entries).length,5);assert.equal(Object.values(first.readOnlyStatus().entries).reduce((sum,item)=>sum+item.reservedMicros,0),50_000_000);
 assert.equal(first.ledgerPath,weeklyCandidateExactProductionEscrowV2LedgerPath(f.root,first.escrow));
 const original=Date.now;try{Date.now=()=>Date.parse('2026-10-19T12:00:01.000Z');
  const reopened=await prepareWeeklyCandidateExactProductionEscrowV2({...f.input,now:()=>Date.parse('2026-10-19T12:00:01.000Z')});
  assert.equal(reopened.escrow.recordHash,first.escrow.recordHash);assert.equal(reopened.pricingPolicy()!.verificationHash,first.escrow.pricingPolicyHash);
  assert.equal((await reopened.reserve(f.candidates[0]!.candidateId,f.candidates[0]!.mediaSha256,f.candidates[0]!.operationId)).authorizationHash,first.escrow.recordHash);
  assert.deepEqual(reopened.readOnlyStatus(),first.readOnlyStatus());
 }finally{Date.now=original;}
 const candidate=f.candidates[0]!,reservation=firstReservation!;
 const plan:WeeklyCandidateDynamicExactPlanV2={schema:'weekly-candidate-dynamic-exact-plan.v2',operationId:candidate.operationId,candidateId:candidate.candidateId,
  mediaSha256:candidate.mediaSha256,endpoint:f.provider.endpoint,credentialSha256:f.provider.credentialSha256,model:'qwen3-vl-plus',
  pricingEvidence:reservation.pricingEvidence,pricingEvidenceHash:reservation.pricingEvidenceHash,pricingPolicyHash:reservation.pricingPolicyHash,
  measurementPolicyHash:reservation.measurementPolicyHash,protocolMaximumRequests:reservation.protocolMaximumRequests,candidateMaximumMicros:reservation.candidateMaximumMicros};
 let head:WeeklyCandidateDynamicExactHeadV2|null=weeklyCandidateDynamicExactInitialHeadV2(reservation.authorizationHash,plan,f.integrityKey);const headAnchor={read:async()=>head?structuredClone(head):null,
  compareAndSwap:async(expected:WeeklyCandidateDynamicExactHeadV2,next:WeeklyCandidateDynamicExactHeadV2)=>{if(JSON.stringify(head)!==JSON.stringify(expected))return false;head=structuredClone(next);return true;}};
 const journal=createWeeklyCandidateDynamicExactPaidRequestsV2({root:f.root,authorizationHash:reservation.authorizationHash,plan,integrityKey:f.integrityKey,assertAuthorizedPlan:first.assertReservedPlan,headAnchor});
 await journal.beforeProviderRequest(JSON.stringify({model:'qwen3-vl-plus',messages:[{role:'user',content:'escrow-bound'}],response_format:{type:'json_object'},temperature:0,max_tokens:1}));
 assert.equal((await journal.readDiagnostic()).requestCount,1);
});

test('v2 refuses a package/job/run that already has v1 and creates neither a second row nor a v2 ledger',async t=>{
 const f=await v2Input(t),legacy=await prepareWeeklyCandidateExactProductionEscrow({store:f.f.store,job:f.job,run:f.run,root:f.root,
  provider:{endpoint:f.provider.endpoint,credentialSha256:f.provider.credentialSha256,model:'qwen3-vl-plus',tariffEvidenceHash:'e'.repeat(64),auditApiKeyId:'official-key-id'},candidates:f.candidates});
 const before=(await f.f.store.list(WEEKLY_CANDIDATE_EXACT_PRODUCTION_ESCROWS)).totalItems;
 await assert.rejects(prepareWeeklyCandidateExactProductionEscrowV2(f.input),/legacy_v1_exists/);
 assert.equal((await f.f.store.list(WEEKLY_CANDIDATE_EXACT_PRODUCTION_ESCROWS)).totalItems,before);
 assert.equal(fs.existsSync(weeklyCandidateExactProductionEscrowV2LedgerPath(f.root,{...legacy.escrow,schema:'weekly-candidate-exact-production-escrow.v2'} as any)),false);
});

test('v2 pricing expiry and provider evidence drift fail before record or ledger creation',async t=>{
 const f=await v2Input(t),original=Date.now;try{Date.now=()=>Date.parse('2027-01-16T16:00:00.000Z');
  await assert.rejects(prepareWeeklyCandidateExactProductionEscrowV2(f.input),/pricing_evidence_unverified/);
 }finally{Date.now=original;}
 const changed={...f.input,provider:{...f.input.provider,pricingEvidence:structuredClone(f.input.provider.pricingEvidence)}};changed.provider.pricingEvidence.providerBinding.credentialSha256='f'.repeat(64);
 await assert.rejects(prepareWeeklyCandidateExactProductionEscrowV2(changed),/pricing_evidence_unverified/);
 assert.equal((await f.f.store.list(WEEKLY_CANDIDATE_EXACT_PRODUCTION_ESCROWS)).totalItems,0);assert.deepEqual(fs.readdirSync(f.root),[]);
});

test('v2 journal authority requires the exact reserved mother and rejects invented, swapped and sixth operations before a claim',async t=>{
 const f=await v2Input(t),handle=await prepareWeeklyCandidateExactProductionEscrowV2(f.input),reserved=f.candidates[0]!;
 const grant=await handle.reserve(reserved.candidateId,reserved.mediaSha256,reserved.operationId);
 const base:WeeklyCandidateDynamicExactPlanV2={schema:'weekly-candidate-dynamic-exact-plan.v2',operationId:reserved.operationId,candidateId:reserved.candidateId,
  mediaSha256:reserved.mediaSha256,endpoint:f.provider.endpoint,credentialSha256:f.provider.credentialSha256,model:'qwen3-vl-plus',pricingEvidence:grant.pricingEvidence,
  pricingEvidenceHash:grant.pricingEvidenceHash,pricingPolicyHash:grant.pricingPolicyHash,measurementPolicyHash:grant.measurementPolicyHash,
  protocolMaximumRequests:grant.protocolMaximumRequests,candidateMaximumMicros:grant.candidateMaximumMicros};
 const request=JSON.stringify({model:'qwen3-vl-plus',messages:[{role:'user',content:'must-not-claim'}],response_format:{type:'json_object'},temperature:0,max_tokens:1});
 const attempts:WeeklyCandidateDynamicExactPlanV2[]=[
  {...base,operationId:'invented-operation'},
  {...base,operationId:f.candidates[1]!.operationId,candidateId:f.candidates[1]!.candidateId,mediaSha256:f.candidates[1]!.mediaSha256},
  {...base,candidateId:f.candidates[1]!.candidateId},
  {...base,mediaSha256:f.candidates[1]!.mediaSha256},
  {...base,protocolMaximumRequests:31},
 ];
 for(const [index,plan] of attempts.entries()){
  let head:WeeklyCandidateDynamicExactHeadV2|null=weeklyCandidateDynamicExactInitialHeadV2(grant.authorizationHash,plan,f.integrityKey);const headAnchor={read:async()=>head?structuredClone(head):null,
   compareAndSwap:async(expected:WeeklyCandidateDynamicExactHeadV2,next:WeeklyCandidateDynamicExactHeadV2)=>{if(JSON.stringify(head)!==JSON.stringify(expected))return false;head=structuredClone(next);return true;}};
  const journal=createWeeklyCandidateDynamicExactPaidRequestsV2({root:f.root,authorizationHash:grant.authorizationHash,plan,integrityKey:f.integrityKey,
   assertAuthorizedPlan:handle.assertReservedPlan,headAnchor});
  await assert.rejects(journal.beforeProviderRequest(request),/authorized_plan_(candidate_changed|reservation_missing|changed)/,`attempt ${index} must fail before a claim`);
  assert.equal(fs.existsSync(journal.ledgerPath),false);
 }
 await assert.rejects(handle.reserve('candidate-v2-5','5'.repeat(64),'operation-v2-5'),/candidate_changed/);
});
