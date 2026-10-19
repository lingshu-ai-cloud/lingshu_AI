import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareWeeklyEnterpriseFactFixture} from './weeklyEnterpriseFactSupplement.fixture.js';
import {adoptWeeklyAutomationTemplate} from '../socialPrograms/weeklyAutomationTemplate.js';
import {independentAdmissionId,WEEKLY_INDEPENDENT_ADMISSIONS} from '../socialPrograms/weeklyIndependentAdmission.js';
import {prepareWeeklyCandidateExactProductionEscrow,prepareWeeklyCandidateExactProductionEscrowV2} from './weeklyCandidateExactProductionEscrow.js';
import {carryForwardWeeklyCandidateExactProductionCost,carryForwardWeeklyCandidateExactProductionCostV2} from './weeklyCandidateExactProductionEscrowPorts.js';
import {WEEKLY_CANDIDATE_EXACT_ANALYSIS_OPERATIONS,WEEKLY_CANDIDATE_EXACT_ANALYSIS_RECEIPTS} from './weeklyCandidateExactAnalysisOperation.js';
import {SocialContentTaskBudget,type SocialTaskBudgetScope,type SocialTaskBudgetPorts} from '../lib/socialContentTaskBudget.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import type {WeeklyPreproductionJob} from './weeklyPreproductionProducer.js';
import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';
import {createHash} from 'node:crypto';
import {createQwenMaaSPublishedTariffReader} from '../lib/socialContentPublishedTariffs.js';
import {createWeeklyCandidateDynamicExactPaidRequestsV2,weeklyCandidateDynamicExactInitialHeadV2,type WeeklyCandidateDynamicExactHeadV2,type WeeklyCandidateDynamicExactPlanV2} from './weeklyCandidateExactPaidRequests.js';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');

async function prepared(t:TestContext,{receipt=true,priorCost=0}={}){
 const f=await prepareWeeklyEnterpriseFactFixture(t as never),root=fs.mkdtempSync(path.join(os.tmpdir(),'weekly-exact-carry-')),budgetRoot=path.join(root,'content-budget');
 (t as any).after(()=>fs.rmSync(root,{recursive:true,force:true}));
 f.pkg.socialContentPackage.weeklyBudgetCny=50;f.pkg.socialContentPackage.perItemBudgetCny=10;
 const publication=f.pkg.socialContentPackage.publicationTasks[0]!;publication.motherContentId='mother-1';
 const packageRow=(await f.store.list<any>('social_weekly_operating_packages',{where:{tenant_id:f.task.tenantId,package_id:f.task.packageId},perPage:2})).items[0]!;
 await f.store.update('social_weekly_operating_packages',packageRow.id,{payload:f.pkg});
 const packageScope={tenantId:f.task.tenantId,programId:f.task.programId,packageId:f.task.packageId,packageVersion:f.task.packageVersion};
 await adoptWeeklyAutomationTemplate(f.store,packageScope,'owner');
 const independent={...packageScope,actorUserId:'owner',admittedAt:new Date().toISOString(),mode:'independent_branches' as const,authorizePublishing:false as const,authorizeMessaging:false as const};
 await f.store.create(WEEKLY_INDEPENDENT_ADMISSIONS,{id:independentAdmissionId(packageScope),tenant_id:packageScope.tenantId,program_id:packageScope.programId,package_id:packageScope.packageId,package_version:packageScope.packageVersion,payload:independent});
 const job:WeeklyPreproductionJob={jobId:'job',...packageScope,consumerTaskId:f.task.taskId,consumerInputHash:'input',kind:'discovery',status:'running',originalRunKey:'weekly-preproduction:job',actorUserId:'owner',dueAt:'2026-10-12T00:00:00.000Z',boundAt:'2026-10-11T00:00:00.000Z',updatedAt:'2026-10-11T00:00:00.000Z',sourceHash:'a'.repeat(64),authority:{scopeId:'scope',scopeVersion:1,scopeHash:'b'.repeat(64),requestedModes:['account']},code:null,resultRefs:[],recordHash:'c'.repeat(64)};
 const run:SocialInspirationCollectionRun={runId:'discovery-run',planId:'plan',keywordSetId:'keywords',keywordSetVersion:1,discoveryScopeId:'scope',discoveryScopeVersion:1,status:'stopped',triggerType:'manual',scopeSnapshot:{weeklyProducer:{key:job.originalRunKey}} as any,modeStats:{},platformStats:{},keywordTierStats:{},evidenceOutcomes:{},sourceRunRefs:[],queryBasis:{},market:'US',language:'en',stopReason:'no_valid_results',startedAt:'2026-10-11T00:00:00.000Z',finishedAt:'2026-10-11T01:00:00.000Z',error:null,failureDetails:[]};
 await f.store.create('social_weekly_preproduction_jobs',{id:job.jobId,tenant_id:job.tenantId,program_id:job.programId,package_id:job.packageId,package_version:job.packageVersion,record_hash:job.recordHash,payload:job});
 await f.store.create('social_discovery_runs',{id:'discovery-row',tenant_id:job.tenantId,...run});
 const candidates=Array.from({length:5},(_,index)=>({candidateId:`candidate-${index}`,mediaSha256:String(index).repeat(64),operationId:`operation-${index}`}));
 const handle=await prepareWeeklyCandidateExactProductionEscrow({store:f.store,job,run,root,provider:{endpoint:'https://maas.qianwenaiapi.com/compatible-mode/v1',credentialSha256:'d'.repeat(64),model:'qwen3-vl-plus',tariffEvidenceHash:'e'.repeat(64),auditApiKeyId:'official-key-id'},candidates});
 const candidate=candidates[0]!;await handle.reserve(candidate.candidateId,candidate.mediaSha256,candidate.operationId);
 const operation={schema:'weekly-candidate-exact-analysis-operation.v1',operationId:candidate.operationId,tenantId:job.tenantId,programId:job.programId,packageId:job.packageId,packageVersion:job.packageVersion,jobId:job.jobId,runId:run.runId,runHash:handle.escrow.runHash,candidateId:candidate.candidateId,sourceUrl:'https://www.tiktok.com/video/1',mediaSha256:candidate.mediaSha256,authorizationId:handle.escrow.escrowId,authorizationHash:handle.escrow.recordHash,state:'submitted_or_unknown' as const,recordHash:''};operation.recordHash=socialRequestHash({...operation,recordHash:''});
 await f.store.create(WEEKLY_CANDIDATE_EXACT_ANALYSIS_OPERATIONS,{id:candidate.operationId,tenant_id:job.tenantId,record_hash:operation.recordHash,payload:operation});
 const settled={schema:'weekly-candidate-exact-analysis-receipt.v1' as const,operationId:candidate.operationId,tenantId:job.tenantId,jobId:job.jobId,runId:run.runId,candidateId:candidate.candidateId,mediaSha256:candidate.mediaSha256,authorizationHash:handle.escrow.recordHash,providerRequestHash:'1'.repeat(64),providerReceiptRef:`qwen-audit-upper-bound:${candidate.operationId}:receipt`,ledgerOutcomeHash:'2'.repeat(64),analysisRunId:candidate.operationId,recordSnapshotHash:'3'.repeat(64),settlementBasis:'conservative_upper_bound' as const,recordedUpperBoundCny:2};
 if(receipt)await f.store.create(WEEKLY_CANDIDATE_EXACT_ANALYSIS_RECEIPTS,{id:candidate.operationId,tenant_id:job.tenantId,record_hash:socialRequestHash(settled),payload:settled});
 const slotId='slot-1',frozenPackage=structuredClone(f.pkg) as any;frozenPackage.agentPlanning={status:'dispatched',skeleton:{slots:[{slotId,motherContentId:publication.motherContentId,publicationTaskIds:[publication.publicationTaskId],accountIds:[publication.accountId],platforms:[publication.platform],plannedPublishWindows:[],objective:'test',quantity:1}]},directorAnalyses:[{slotId,benchmarkVideoRefs:[{type:'candidate',id:candidate.candidateId,version:1}]}],dispatch:{scheduleItems:[{slotId,publicationTaskId:publication.publicationTaskId}]}};
 const scope:SocialTaskBudgetScope={tenantId:job.tenantId,taskId:'content-task',runId:'content-run',planHash:'f'.repeat(64)},taskRow={id:'content-row',tenant_id:job.tenantId,task_id:scope.taskId,run_id:scope.runId,brief:{perItemBudgetCny:10,_weeklyAuthority:{weeklyPackage:frozenPackage,publicationTask:structuredClone(publication)}}};
 const ports:SocialTaskBudgetPorts={authorization:async()=>({maximumCny:10,authorizationRef:'weekly-production'}),quote:async()=>({upperBoundCny:priorCost,quoteRef:'prior',validUntil:'2099-01-01'}),assertCurrent:async()=>{},verifyRejection:async()=>false},budget=new SocialContentTaskBudget(budgetRoot,ports);
 if(priorCost>0)await budget.reserveBatch(scope,[{operationId:'prior',fingerprint:'4'.repeat(64),provider:'provider',model:'model',accountRef:'account',stage:'video',shotId:'S01'}]);
 return{...f,root,budgetRoot,scope,taskRow,budget,handle,candidate,settled,call:(extra={})=>carryForwardWeeklyCandidateExactProductionCost({store:f.store,escrowRoot:root,scope,taskRow,budget,mode:'carry',...extra})};
}

test('settled exact cost lands in the original ten-yuan ledger before source escrow is marked and replays idempotently',async t=>{const f=await prepared(t);const value=await f.call();assert.equal(value?.retainedUpperBoundCny,2);assert.equal(f.budget.status(f.scope)?.retainedCny,2);assert.equal(f.budget.status(f.scope)?.entries[0]?.status,'completed');assert.equal((await f.handle.status()).entries[f.candidate.operationId]?.state,'carried_forward');assert.deepEqual(await f.call(),value);assert.equal(f.budget.status(f.scope)?.entries.length,1);});

test('restart between target fsync and source marker reuses one target charge then completes the marker',async t=>{const f=await prepared(t);await assert.rejects(f.call({afterTargetWrite:async()=>{throw Error('simulated-crash')}}),/simulated-crash/);assert.equal(f.budget.status(f.scope)?.entries.length,1);assert.equal((await f.handle.status()).entries[f.candidate.operationId]?.state,'reserved');await f.call();assert.equal(f.budget.status(f.scope)?.entries.length,1);assert.equal((await f.handle.status()).entries[f.candidate.operationId]?.state,'carried_forward');});

test('concurrent workers cannot double charge and a losing worker safely replays',async t=>{const f=await prepared(t);const results=await Promise.allSettled([f.call(),f.call()]);assert.ok(results.some(result=>result.status==='fulfilled'));const replay=await f.call();assert.match(replay?.contentLedgerRef??'',/^social-task-budget:/);assert.equal(f.budget.status(f.scope)?.entries.length,1);assert.equal((await f.handle.status()).entries[f.candidate.operationId]?.state,'carried_forward');});

test('missing or drifting settlement evidence never writes either side',async t=>{const missing=await prepared(t,{receipt:false});await assert.rejects(missing.call(),/settled_receipt_invalid/);assert.equal(missing.budget.status(missing.scope),null);assert.equal((await missing.handle.status()).entries[missing.candidate.operationId]?.state,'reserved');const changed=await prepared(t);const row=await changed.store.getById<any>(WEEKLY_CANDIDATE_EXACT_ANALYSIS_RECEIPTS,changed.candidate.operationId);await changed.store.update(WEEKLY_CANDIDATE_EXACT_ANALYSIS_RECEIPTS,changed.candidate.operationId,{payload:{...row!.payload,recordedUpperBoundCny:3}});await assert.rejects(changed.call(),/settled_receipt_invalid/);assert.equal(changed.budget.status(changed.scope),null);assert.equal((await changed.handle.status()).entries[changed.candidate.operationId]?.state,'reserved');});

test('preproduction plus existing production spend cannot exceed the original ten yuan',async t=>{const f=await prepared(t,{priorCost:9});await assert.rejects(f.call(),/social_task_budget_exceeded/);assert.equal(f.budget.status(f.scope)?.retainedCny,9);assert.equal(f.budget.status(f.scope)?.entries.length,1);assert.equal((await f.handle.status()).entries[f.candidate.operationId]?.state,'reserved');});

test('quote-only verification is pure read and projects the settled upper bound',async t=>{const f=await prepared(t);const before=fs.readdirSync(f.root,{recursive:true}).map(String).sort();const value=await carryForwardWeeklyCandidateExactProductionCost({store:f.store,escrowRoot:f.root,scope:f.scope,taskRow:f.taskRow,budget:f.budget,mode:'read'});assert.equal(value?.retainedUpperBoundCny,2);assert.equal(f.budget.status(f.scope),null);assert.equal((await f.handle.status()).entries[f.candidate.operationId]?.state,'reserved');assert.deepEqual(fs.readdirSync(f.root,{recursive:true}).map(String).sort(),before);});

async function preparedV2(t:TestContext,{priorCost=0}={}){
 const f=await prepareWeeklyEnterpriseFactFixture(t as never),root=fs.mkdtempSync(path.join(os.tmpdir(),'weekly-exact-carry-v2-')),
  budgetRoot=path.join(root,'content-budget');(t as any).after(()=>fs.rmSync(root,{recursive:true,force:true}));
 f.pkg.socialContentPackage.weeklyBudgetCny=50;f.pkg.socialContentPackage.perItemBudgetCny=10;
 const publication=f.pkg.socialContentPackage.publicationTasks[0]!;publication.motherContentId='mother-v2';
 const candidates=Array.from({length:5},(_,index)=>({candidateId:`candidate-v2-${index}`,mediaSha256:String(index).repeat(64),operationId:`operation-v2-${index}`})),candidate=candidates[0]!,slotId='slot-v2';
 (f.pkg as any).agentPlanning={status:'dispatched',skeleton:{slots:[{slotId,motherContentId:publication.motherContentId,
  publicationTaskIds:[publication.publicationTaskId],accountIds:[publication.accountId],platforms:[publication.platform],plannedPublishWindows:[],objective:'test',quantity:1}]},
  directorAnalyses:[{slotId,benchmarkVideoRefs:[{type:'candidate',id:candidate.candidateId,version:1}]}],dispatch:{scheduleItems:[{slotId,publicationTaskId:publication.publicationTaskId}]}};
 const packageRow=(await f.store.list<any>('social_weekly_operating_packages',{where:{tenant_id:f.task.tenantId,package_id:f.task.packageId},perPage:2})).items[0]!;
 await f.store.update('social_weekly_operating_packages',packageRow.id,{payload:f.pkg});
 const packageScope={tenantId:f.task.tenantId,programId:f.task.programId,packageId:f.task.packageId,packageVersion:f.task.packageVersion};
 await adoptWeeklyAutomationTemplate(f.store,packageScope,'owner');
 const independent={...packageScope,actorUserId:'owner',admittedAt:new Date().toISOString(),mode:'independent_branches' as const,
  authorizePublishing:false as const,authorizeMessaging:false as const};
 await f.store.create(WEEKLY_INDEPENDENT_ADMISSIONS,{id:independentAdmissionId(packageScope),tenant_id:packageScope.tenantId,
  program_id:packageScope.programId,package_id:packageScope.packageId,package_version:packageScope.packageVersion,payload:independent});
 const job:WeeklyPreproductionJob={jobId:'job-v2-carry',...packageScope,consumerTaskId:f.task.taskId,consumerInputHash:'input',kind:'discovery',
  status:'running',originalRunKey:'weekly-preproduction:job-v2-carry',actorUserId:'owner',dueAt:'2026-10-12T00:00:00.000Z',
  boundAt:'2026-10-11T00:00:00.000Z',updatedAt:'2026-10-11T00:00:00.000Z',sourceHash:'a'.repeat(64),
  authority:{scopeId:'scope-v2',scopeVersion:1,scopeHash:'b'.repeat(64),requestedModes:['account']},code:null,resultRefs:[],recordHash:'c'.repeat(64)};
 const run:SocialInspirationCollectionRun={runId:'discovery-run-v2',planId:'plan',keywordSetId:'keywords',keywordSetVersion:1,
  discoveryScopeId:'scope-v2',discoveryScopeVersion:1,status:'stopped',triggerType:'manual',scopeSnapshot:{weeklyProducer:{key:job.originalRunKey}} as any,
  modeStats:{},platformStats:{},keywordTierStats:{},evidenceOutcomes:{},sourceRunRefs:[],queryBasis:{},market:'US',language:'en',
  stopReason:'no_valid_results',startedAt:'2026-10-11T00:00:00.000Z',finishedAt:'2026-10-11T01:00:00.000Z',error:null,failureDetails:[]};
 await f.store.create('social_weekly_preproduction_jobs',{id:job.jobId,tenant_id:job.tenantId,program_id:job.programId,package_id:job.packageId,
  package_version:job.packageVersion,record_hash:job.recordHash,payload:job});await f.store.create('social_discovery_runs',{id:'discovery-row-v2',tenant_id:job.tenantId,...run});
 const endpoint='https://maas.qianwenaiapi.com/compatible-mode/v1',integrityKey='carry-v2-integrity',credentialSha256=sha('carry-v2-provider'),
  accountRef=`qwen:${sha(JSON.stringify({baseUrl:endpoint,credentialSha256}))}`;
 const tariff=await createQwenMaaSPublishedTariffReader({now:()=>new Date('2026-10-19T12:00:00.000Z'),readProviderBinding:async()=>({provider:'qwen',model:'qwen3-vl-plus',baseUrl:endpoint,credentialSha256})}).read({
  provider:'qwen',model:'qwen3-vl-plus',accountRef,stage:'candidate_exact_analysis',shotId:null,operationId:'carry-v2-tariff',
  inputContractHash:'f'.repeat(64),maximumUnits:{inputTokens:260096,outputTokens:16384}});assert.ok(tariff);
 const handle=await prepareWeeklyCandidateExactProductionEscrowV2({store:f.store,job,run,root,provider:{endpoint,credentialSha256,
  auditApiKeyId:'audit-v2',model:'qwen3-vl-plus',pricingEvidence:tariff.publicPricingEvidence},ledgerIntegrityKeySha256:sha(integrityKey),candidates});
 const reservation=await handle.reserve(candidate.candidateId,candidate.mediaSha256,candidate.operationId);
 const plan:WeeklyCandidateDynamicExactPlanV2={schema:'weekly-candidate-dynamic-exact-plan.v2',operationId:candidate.operationId,candidateId:candidate.candidateId,
  mediaSha256:candidate.mediaSha256,endpoint,credentialSha256,ledgerIntegrityKeySha256:reservation.ledgerIntegrityKeySha256,model:'qwen3-vl-plus',
  pricingEvidence:reservation.pricingEvidence,pricingEvidenceHash:reservation.pricingEvidenceHash,pricingPolicyHash:reservation.pricingPolicyHash,
  measurementPolicyHash:reservation.measurementPolicyHash,protocolMaximumRequests:reservation.protocolMaximumRequests,candidateMaximumMicros:reservation.candidateMaximumMicros};
 let head:WeeklyCandidateDynamicExactHeadV2|null=weeklyCandidateDynamicExactInitialHeadV2(reservation.authorizationHash,plan,integrityKey);
 const headAnchor={read:async()=>head?structuredClone(head):null,compareAndSwap:async(expected:WeeklyCandidateDynamicExactHeadV2,next:WeeklyCandidateDynamicExactHeadV2)=>{
  if(JSON.stringify(head)!==JSON.stringify(expected))return false;head=structuredClone(next);return true;}};
 const journal=createWeeklyCandidateDynamicExactPaidRequestsV2({root,authorizationHash:reservation.authorizationHash,plan,integrityKey,
  assertAuthorizedPlan:handle.assertReservedPlan,headAnchor}),request=JSON.stringify({model:'qwen3-vl-plus',messages:[{role:'user',content:'carry-v2'}],response_format:{type:'json_object'},temperature:0,max_tokens:100});
 await journal.beforeProviderRequest(request);const response={provider:'qwen' as const,responseId:'response-v2',providerRequestId:'request-v2',requestHash:sha(request),
  model:'qwen3-vl-plus',requestModel:'qwen3-vl-plus',httpStatus:200,usage:{prompt_tokens:100,completion_tokens:10,total_tokens:110},receivedAt:'2026-10-19T12:00:01.000Z'};
 await journal.onProviderReceipt(response);const auditReader={readOriginalAuditRequest:async()=>({requestId:'request-v2',apiKeyId:'audit-v2',model:'qwen3-vl-plus',status:200,
  usage:response.usage,sourceEvidenceHash:'e'.repeat(64)})};
 const scope:SocialTaskBudgetScope={tenantId:job.tenantId,taskId:'content-task-v2',runId:'content-run-v2',planHash:'f'.repeat(64)},
  taskRow={id:'content-row-v2',tenant_id:job.tenantId,task_id:scope.taskId,run_id:scope.runId,
   brief:{perItemBudgetCny:10,_weeklyAuthority:{weeklyPackage:structuredClone(f.pkg),publicationTask:structuredClone(publication)}}};
 const ports:SocialTaskBudgetPorts={authorization:async()=>({maximumCny:10,authorizationRef:'weekly-production'}),
  quote:async()=>({upperBoundCny:priorCost,quoteRef:'prior',validUntil:'2099-01-01'}),assertCurrent:async()=>{},verifyRejection:async()=>false},
  budget=new SocialContentTaskBudget(budgetRoot,ports);
 if(priorCost>0)await budget.reserveBatch(scope,[{operationId:'prior-v2',fingerprint:'4'.repeat(64),provider:'provider',model:'model',accountRef:'account',stage:'video',shotId:'S01'}]);
 const call=(extra:Record<string,unknown>={})=>carryForwardWeeklyCandidateExactProductionCostV2({store:f.store,exactRoot:root,scope,taskRow,budget,
  mode:'carry',integrityKey,headAnchor,auditReader,...extra});
 return{...f,root,budget,scope,taskRow,handle,candidate,journal,headAnchor,auditReader,integrityKey,response,call,getHead:()=>structuredClone(head)};
}

test('v2 carries only retained child occupation target-first and replays after source-marker crash',async t=>{
 const f=await preparedV2(t),beforeHead=f.getHead();await assert.rejects(f.call({afterTargetWrite:async()=>{throw Error('v2-crash')}}),/v2-crash/);
 assert.equal(f.budget.status(f.scope)?.entries.length,1);assert.equal(f.handle.readOnlyStatus().entries[f.candidate.operationId]?.state,'reserved');
 const result=await f.call();assert.ok(result);assert.ok(result!.retainedUpperBoundCny<10);assert.equal(f.budget.status(f.scope)?.entries.length,1);
 const marker=f.handle.readOnlyStatus().entries[f.candidate.operationId]!;assert.equal(marker.state,'carried_forward');
 assert.equal(marker.retainedOccupationMicros,Math.round(result!.retainedUpperBoundCny*1e6));assert.deepEqual(f.getHead(),beforeHead);
});

test('v2 quote is byte-pure, missing audit is null, wrong key and over-budget fail before source marker',async t=>{
 const f=await preparedV2(t),before=fs.readFileSync(f.journal.ledgerPath),head=f.getHead(),source=JSON.stringify(f.handle.readOnlyStatus());
 const read=await carryForwardWeeklyCandidateExactProductionCostV2({store:f.store,exactRoot:f.root,scope:f.scope,taskRow:f.taskRow,budget:f.budget,
  mode:'read',integrityKey:f.integrityKey,headAnchor:f.headAnchor,auditReader:f.auditReader});assert.ok(read);assert.equal(f.budget.status(f.scope),null);
 assert.deepEqual(fs.readFileSync(f.journal.ledgerPath),before);assert.deepEqual(f.getHead(),head);assert.equal(JSON.stringify(f.handle.readOnlyStatus()),source);
 assert.equal(await carryForwardWeeklyCandidateExactProductionCostV2({store:f.store,exactRoot:f.root,scope:f.scope,taskRow:f.taskRow,budget:f.budget,
  mode:'read',integrityKey:f.integrityKey,headAnchor:f.headAnchor,auditReader:{readOriginalAuditRequest:async()=>null}}),null);
 await assert.rejects(carryForwardWeeklyCandidateExactProductionCostV2({store:f.store,exactRoot:f.root,scope:f.scope,taskRow:f.taskRow,budget:f.budget,
  mode:'carry',integrityKey:'wrong-key',headAnchor:f.headAnchor,auditReader:f.auditReader}),/integrity_key_invalid/);
 const over=await preparedV2(t,{priorCost:10});await assert.rejects(over.call(),/social_task_budget_exceeded/);
 assert.equal(over.handle.readOnlyStatus().entries[over.candidate.operationId]?.state,'reserved');
});

test('v2 concurrent carry is single-charge and mapping or marker drift fails closed',async t=>{
 const f=await preparedV2(t),results=await Promise.allSettled([f.call(),f.call()]);assert.ok(results.some(value=>value.status==='fulfilled'));
 assert.equal(f.budget.status(f.scope)?.entries.length,1);await f.call();assert.equal(f.budget.status(f.scope)?.entries.length,1);
 const marker=f.handle.readOnlyStatus().entries[f.candidate.operationId]!;assert.equal(marker.state,'carried_forward');
 await assert.rejects(f.handle.markCarriedForward({candidateId:f.candidate.candidateId,mediaSha256:f.candidate.mediaSha256,
  operationId:f.candidate.operationId,motherContentId:'other-mother',contentLedgerRef:marker.contentLedgerRef!,
  settlementRecordHash:marker.settlementRecordHash!,retainedOccupationMicros:marker.retainedOccupationMicros!}),/carry_forward_changed/);
 const drift=await preparedV2(t);(drift.taskRow.brief as any)._weeklyAuthority.publicationTask.motherContentId='different';
 await assert.rejects(drift.call(),/v2_candidate_mapping_invalid/);
});

test('only dormant escrow ports reference the v2 carry symbol',()=>{
 const files=(function walk(directory:string):string[]{return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(directory,entry.name)):[path.join(directory,entry.name)]);})('server');
 const callers=files.filter(file=>file.endsWith('.ts')&&!file.endsWith('.test.ts')&&!file.endsWith('weeklyCandidateExactProductionEscrowPorts.ts'))
  .filter(file=>fs.readFileSync(file,'utf8').includes('carryForwardWeeklyCandidateExactProductionCostV2'));assert.deepEqual(callers,[]);
});
