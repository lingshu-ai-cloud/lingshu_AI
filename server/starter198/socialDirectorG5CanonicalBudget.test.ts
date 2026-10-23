import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SocialContentTaskBudget} from '../lib/socialContentTaskBudget.js';
import {reserveDirectorG5CanonicalBudget,verifyDirectorG5OriginalFilmBudget,verifyDirectorG5RepairChildBudget} from './socialDirectorG5CanonicalBudget.js';
import {paidProductionHash} from './socialContentPaidOperationPlan.js';
import {socialPaidIntentOperation,type SocialPaidOperationIntent,type SocialVerifiedAccountTariff} from '../lib/socialContentTaskBudgetAuthority.js';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const scope={tenantId:'isolated-g5',taskId:'original-film',runId:'original-run',planHash:sha('frozen-plan')};
const original={operationId:'original-video',fingerprint:sha('original-video'),provider:'heygen',model:'frozen',accountRef:'owned-account',stage:'presenter_video',shotId:'s1'};
const intent:SocialPaidOperationIntent={operationId:'director-g5-original-film',provider:'qwen',model:'controlled-model',accountRef:'bound-account',stage:'director_review',shotId:null,inputContractHash:sha('actual-render-and-source'),maximumUnits:{inputTokens:100,outputTokens:20}};
const tariff:SocialVerifiedAccountTariff={provider:intent.provider,model:intent.model,accountRef:intent.accountRef,stage:'director_review',currency:'CNY',verifiedAccountPrice:true,evidenceRef:'verified-account-tariff',checkedAt:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+60000).toISOString(),meters:{inputTokens:{priceCny:1000,unitsPerPrice:1000,minimumUnits:0,increment:1},outputTokens:{priceCny:1000,unitsPerPrice:1000,minimumUnits:0,increment:1}}};
async function fixture(originalCny:number){const root=await mkdtemp(path.join(os.tmpdir(),'canonical-g5-'));const ledger=new SocialContentTaskBudget(root,{assertCurrent:async()=>{},authorization:async()=>({maximumCny:10,authorizationRef:'original-week-accepted'}),quote:async()=>({upperBoundCny:originalCny,quoteRef:'verified-original-quote',validUntil:new Date(Date.now()+60000).toISOString()}),verifyRejection:async()=>false});await ledger.reserveBatch(scope,[original]);return {root,ledger,cleanup:()=>rm(root,{recursive:true,force:true})};}
test('G5 retains original film spend and unknown occupancy, and replays the same reservation',async()=>{const f=await fixture(9);try{let priceCalls=0;const args={scope,intent,ledgerRoot:f.root,assertCurrent:async()=>{},readVerifiedTariff:async()=>{priceCalls++;return {...tariff,meters:{inputTokens:{...tariff.meters.inputTokens!,priceCny:5},outputTokens:{...tariff.meters.outputTokens!,priceCny:5}}};}};await f.ledger.markOutcome(scope,original.operationId,'unknown','provider-original-unknown');const first=await reserveDirectorG5CanonicalBudget(args);assert.equal(first.status.limitCny,10);assert.equal(first.status.retainedCny,9.6);assert.equal(priceCalls,1);const restored=await reserveDirectorG5CanonicalBudget({...args,readVerifiedTariff:async()=>{throw Error('expired tariff unavailable on recovery');}});assert.equal(restored.status.retainedCny,9.6);assert.equal(restored.status.entries.length,2);await first.permit.beforeSubmit({...intent,actualUnits:{inputTokens:100,outputTokens:20}});await assert.rejects(restored.permit.beforeSubmit({...intent,actualUnits:{inputTokens:100,outputTokens:20}}),/receipt_recovery_required/);assert.equal(f.ledger.status(scope)!.entries.find(row=>row.operationId===intent.operationId)!.status,'unknown');}finally{await f.cleanup();}});
test('G5 refuses cumulative overrun and absence of verified tariff before a paid claim',async()=>{const f=await fixture(9.5);try{await assert.rejects(reserveDirectorG5CanonicalBudget({scope,intent,ledgerRoot:f.root,assertCurrent:async()=>{},readVerifiedTariff:async()=>tariff}),/production_budget_decision_required/);assert.equal(f.ledger.status(scope)!.entries.length,1);await assert.rejects(reserveDirectorG5CanonicalBudget({scope,intent,ledgerRoot:f.root,assertCurrent:async()=>{},readVerifiedTariff:async()=>null}),/account_tariff_missing_or_expired/);assert.equal(f.ledger.status(scope)!.entries.length,1);}finally{await f.cleanup();}});
test('G5 never creates a film ledger from an orphan review',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'canonical-g5-orphan-'));try{await assert.rejects(reserveDirectorG5CanonicalBudget({scope,intent,ledgerRoot:root,assertCurrent:async()=>{},readVerifiedTariff:async()=>tariff}),/original_ten_yuan_ledger_required/);}finally{await rm(root,{recursive:true,force:true});}});
test('G5 original scope comes only from same-run frozen film checkpoint and occupied 10 yuan ledger',async()=>{const f=await fixture(2);try{const reviewScope={tenantId:scope.tenantId,taskId:scope.taskId,runId:scope.runId,artifactId:'actual-film'};
 const checkpoint={inputHash:scope.planHash,payload:{scopeHash:paidProductionHash(scope),plan:{scope,paidOperations:[{operationId:original.operationId}]},operationIds:[original.operationId]}};
 const verify=(cp=checkpoint,status=f.ledger.status(scope))=>verifyDirectorG5OriginalFilmBudget({reviewScope,budgetTaskId:scope.taskId,checkpoint:cp,status});
 assert.deepEqual(verify(),scope);
 assert.throws(()=>verify({...checkpoint,inputHash:sha('different-plan')}),/checkpoint_required/);
 assert.throws(()=>verify({...checkpoint,payload:{...checkpoint.payload,plan:{...checkpoint.payload.plan,scope:{...scope,runId:'foreign-run'}}}}),/checkpoint_required/);
 assert.throws(()=>verify({...checkpoint,payload:{...checkpoint.payload,operationIds:['other-film']}}),/checkpoint_required/);
 const status=f.ledger.status(scope)!;assert.throws(()=>verify(checkpoint,{...status,limitCny:15}),/ten_yuan_ledger_required/);
 assert.throws(()=>verify(checkpoint,{...status,entries:[]}),/ten_yuan_ledger_required/);
 }finally{await f.cleanup();}});
test('repair child G5 inherits the original ten-yuan ledger only with both pre-G5 frozen film checkpoints',async()=>{
 const f=await fixture(2);try{
  const child={...scope,taskId:'repair-child',budgetTaskId:scope.taskId,runId:'repair-run',planHash:sha('repair-plan')};
  const childVideo={...original,operationId:'repair-video',fingerprint:sha('repair-video')};
  const childHold={...original,operationId:'repair-g5-hold',fingerprint:sha('repair-g5-hold'),stage:'director_review_capacity'};
  const authority=new SocialContentTaskBudget(f.root,{assertCurrent:async()=>{},authorization:async()=>({maximumCny:10,authorizationRef:'root-week-accepted'}),quote:async()=>({upperBoundCny:1,quoteRef:'verified-repair-quote',validUntil:new Date(Date.now()+60000).toISOString()}),verifyRejection:async()=>false});
  await authority.reserveBatch(child,[childVideo,childHold]);
  const cp=(s:typeof scope|typeof child,ops:Array<typeof original>)=>({inputHash:s.planHash,payload:{scopeHash:paidProductionHash(s),plan:{scope:s,paidOperations:ops},operationIds:ops.map(op=>op.operationId)}});
  const rootCheckpoint=cp(scope,[original]),childCheckpoint=cp(child,[childVideo,childHold]);
  const reviewScope={tenantId:scope.tenantId,taskId:child.taskId,runId:child.runId,artifactId:'repair-film'};
  const verify=(override:Partial<Parameters<typeof verifyDirectorG5RepairChildBudget>[0]>={})=>verifyDirectorG5RepairChildBudget({reviewScope,rootTaskId:scope.taskId,rootRunId:scope.runId,originalMaximumCny:10,maximumAdditionalCostCny:3,childCheckpoint,rootCheckpoint,status:authority.status(child),...override});
  assert.deepEqual(verify(),child);
  assert.throws(()=>verify({rootCheckpoint:null}),/checkpoint_required/);
  assert.throws(()=>verify({childCheckpoint:{...childCheckpoint,inputHash:sha('late-plan')}}),/checkpoint_required/);
  assert.throws(()=>verify({rootRunId:'wrong-parent-run'}),/checkpoint_required/);
  assert.throws(()=>verify({maximumAdditionalCostCny:null}),/lineage_invalid/);
  assert.throws(()=>verify({childCheckpoint:cp(child,[childVideo])}),/child_hold_required/);
  const status=authority.status(child)!;
  assert.throws(()=>verify({status:{...status,limitCny:15}}),/ten_yuan_ledger_required/);
  assert.throws(()=>verify({status:{...status,entries:status.entries.filter(entry=>entry.operationId!==childHold.operationId)}}),/ten_yuan_ledger_required/);
 }finally{await f.cleanup();}
});
test('original film G5 capacity converts once to its exact request without a second charge, including restart',async()=>{
 const f=await fixture(8);try{
  const capacityIntent:SocialPaidOperationIntent={...intent,stage:'director_review_capacity',inputContractHash:sha('frozen-film-review-capacity'),maximumUnits:{inputTokens:260096,outputTokens:2400}};
  const capacity=socialPaidIntentOperation(scope,capacityIntent),exact=socialPaidIntentOperation(scope,intent);
  const capacityLedger=new SocialContentTaskBudget(f.root,{assertCurrent:async()=>{},authorization:async()=>({maximumCny:10,authorizationRef:'original-week-accepted'}),quote:async()=>({upperBoundCny:1,quoteRef:'independently-priced-g5-hold',validUntil:new Date(Date.now()+60000).toISOString()}),verifyRejection:async()=>false});
  await capacityLedger.reserveBatch(scope,[capacity]);
  assert.equal(capacityLedger.status(scope)!.retainedCny,9);
  const exactQuote={upperBoundCny:.6,quoteRef:'independently-priced-exact-g5',validUntil:new Date(Date.now()+60000).toISOString()};
  const claim=path.join(f.root,'.permits',sha(JSON.stringify([scope.tenantId,scope.taskId,scope.runId,scope.planHash,intent.operationId]))+'.json');
  await mkdir(path.dirname(claim),{recursive:true});await writeFile(claim,'{"status":"unknown"}');
  await assert.rejects(capacityLedger.bindDirectorReviewCapacity(scope,{capacityOperation:capacity,exactOperation:exact,exactQuote}),/claim_exists/);
  await unlink(claim);
  await assert.rejects(capacityLedger.bindDirectorReviewCapacity(scope,{capacityOperation:capacity,exactOperation:{...exact,accountRef:'other'},exactQuote}),/binding_invalid/);
  await assert.rejects(capacityLedger.bindDirectorReviewCapacity(scope,{capacityOperation:capacity,exactOperation:exact,exactQuote:{...exactQuote,upperBoundCny:1.01}}),/capacity_insufficient/);
  const restart=new SocialContentTaskBudget(f.root,{assertCurrent:async()=>{},authorization:async()=>{throw Error('no second authorization');},quote:async()=>{throw Error('no second quote');},verifyRejection:async()=>false});
  const bound=await restart.bindDirectorReviewCapacity(scope,{capacityOperation:capacity,exactOperation:exact,exactQuote});
  assert.equal(bound.retainedCny,9);
  assert.equal(bound.entries.filter(entry=>entry.operationId===intent.operationId).length,1);
  assert.equal(bound.entries.find(entry=>entry.operationId===intent.operationId)!.fingerprint,exact.fingerprint);
  assert.equal(bound.entries.find(entry=>entry.operationId===intent.operationId)!.capacityBinding?.capacityOperation.fingerprint,capacity.fingerprint);
  assert.deepEqual(await restart.bindDirectorReviewCapacity(scope,{capacityOperation:capacity,exactOperation:exact,exactQuote}),bound);
  await restart.markOutcome(scope,intent.operationId,'unknown','original-provider-submission-unknown');
  await assert.rejects(restart.bindDirectorReviewCapacity(scope,{capacityOperation:capacity,exactOperation:{...exact,fingerprint:sha('other-request')},exactQuote}),/capacity_changed/);
  assert.equal(restart.status(scope)!.retainedCny,9);
 }finally{await f.cleanup();}
});
test('G5 capacity provenance tamper cannot be replayed as an exact paid permit',async()=>{
 const f=await fixture(8);try{
  const holdIntent:SocialPaidOperationIntent={...intent,stage:'director_review_capacity',inputContractHash:sha('frozen-capacity'),maximumUnits:{inputTokens:260096,outputTokens:2400}};
  const hold=socialPaidIntentOperation(scope,holdIntent),exact=socialPaidIntentOperation(scope,intent);
  const ledger=new SocialContentTaskBudget(f.root,{assertCurrent:async()=>{},authorization:async()=>({maximumCny:10,authorizationRef:'week'}),quote:async()=>({upperBoundCny:1,quoteRef:'verified-capacity',validUntil:new Date(Date.now()+60000).toISOString()}),verifyRejection:async()=>false});
  await ledger.reserveBatch(scope,[hold]);await ledger.bindDirectorReviewCapacity(scope,{capacityOperation:hold,exactOperation:exact,exactQuote:{upperBoundCny:.5,quoteRef:'verified-exact',validUntil:new Date(Date.now()+60000).toISOString()}});
  const file=path.join(f.root,sha(JSON.stringify([scope.tenantId,scope.taskId]))+'.json');
  const saved=JSON.parse(await readFile(file,'utf8')) as {entries:Record<string,{capacityBinding:{capacityQuoteRef:string}}>};
  Object.values(saved.entries).find(entry=>entry.capacityBinding)!.capacityBinding.capacityQuoteRef='tampered';
  await writeFile(file,JSON.stringify(saved));
  assert.throws(()=>ledger.status(scope),/ledger_corrupt/);
 }finally{await f.cleanup();}
});
test('canonical G5 permit consumes only the pre-priced film hold and cannot submit the hold itself',async()=>{
 const f=await fixture(8);try{
  const capacityIntent:SocialPaidOperationIntent={...intent,stage:'director_review_capacity',inputContractHash:sha('frozen-film-review-capacity'),maximumUnits:{inputTokens:260096,outputTokens:2400}};
  const capacity=socialPaidIntentOperation(scope,capacityIntent);
  const capacityLedger=new SocialContentTaskBudget(f.root,{assertCurrent:async()=>{},authorization:async()=>({maximumCny:10,authorizationRef:'original-week-accepted'}),quote:async()=>({upperBoundCny:1,quoteRef:'independently-priced-g5-hold',validUntil:new Date(Date.now()+60000).toISOString()}),verifyRejection:async()=>false});
  await capacityLedger.reserveBatch(scope,[capacity]);
  const held=capacityLedger.status(scope)!;
  const {createSocialContentPaidOperationPermit}=await import('../lib/socialContentPaidOperationPermit.js');
  const heldPermit=createSocialContentPaidOperationPermit({scope,operations:[capacity],intents:[capacityIntent],ledger:capacityLedger,root:path.join(f.root,'.permits'),assertCurrent:async()=>{}});
  await assert.rejects(heldPermit.beforeSubmit({...capacityIntent,actualUnits:{inputTokens:1,outputTokens:1}}),/capacity_not_submittable/);
  assert.deepEqual(capacityLedger.status(scope),held);
  const exactTariff={...tariff,meters:{inputTokens:{...tariff.meters.inputTokens!,priceCny:5},outputTokens:{...tariff.meters.outputTokens!,priceCny:5}}};
  const args={scope,intent,capacityIntent,ledgerRoot:f.root,assertCurrent:async()=>{},readVerifiedTariff:async()=>exactTariff};
  const result=await reserveDirectorG5CanonicalBudget(args);
  assert.equal(result.status.retainedCny,9);
  assert.equal(result.status.entries.filter(entry=>entry.operationId===intent.operationId).length,1);
  await result.permit.beforeSubmit({...intent,actualUnits:{inputTokens:100,outputTokens:20}});
  assert.equal(capacityLedger.status(scope)!.entries.find(entry=>entry.operationId===intent.operationId)!.status,'unknown');
  const recovered=await reserveDirectorG5CanonicalBudget({...args,readVerifiedTariff:async()=>{throw Error('old quote retained after restart');}});
  assert.equal(recovered.status.retainedCny,9);
  await assert.rejects(recovered.permit.beforeSubmit({...intent,actualUnits:{inputTokens:100,outputTokens:20}}),/receipt_recovery_required/);
 }finally{await f.cleanup();}
});
