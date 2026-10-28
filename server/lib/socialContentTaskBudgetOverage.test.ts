import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SocialContentTaskBudget,type SocialTaskBudgetPorts,type SocialTaskBudgetScope,type SocialTaskBudgetOperation} from './socialContentTaskBudget.js';
const scope:SocialTaskBudgetScope={tenantId:'tenant',taskId:'film',runId:'run',planHash:'a'.repeat(64)};
const operation=(id:string):SocialTaskBudgetOperation=>({operationId:id,fingerprint:'b'.repeat(64),provider:'provider',model:'model',accountRef:'account',stage:'scene_rework',shotId:'slot'});
function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'overage-'));let price=14,quoteRef='quote-14';
 const ports:SocialTaskBudgetPorts={authorization:async()=>({maximumCny:15,productionDurationSeconds:30,authorizationRef:'original'}),quote:async()=>({upperBoundCny:price,quoteRef,validUntil:'2099-01-01'}),assertCurrent:async()=>{},verifyRejection:async()=>true};
 const budget=new SocialContentTaskBudget(root,ports);return {root,ports,budget,price:(p:number,r='quote')=>{price=p;quoteRef=r},cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};}
const approval=(previewHash:string)=>({previewHash,actorUserId:'user',authorizationRef:'authenticated-user-choice'});
test('fresh server quote allows exact overage, preserves original ledger and cannot fund another operation',async()=>{const f=fixture();try{
 await f.budget.reserveBatch(scope,[operation('previous')]);f.price(2);
 const preview=await f.budget.previewOverage(scope,operation('repair'));assert.equal(preview.retainedMicros,14e6);assert.equal(preview.extraMicros,1e6);
 await f.budget.reserveUserApprovedOverage(scope,operation('repair'),approval(preview.previewHash));
 await f.budget.reserveUserApprovedOverage(scope,operation('repair'),approval(preview.previewHash));
 await f.budget.reserveBatch(scope,[operation('repair')]);
 assert.equal(f.budget.status(scope)!.retainedCny,16);assert.equal(f.budget.status(scope)!.limitCny,15);
 await assert.rejects(f.budget.reserveBatch(scope,[operation('another')]),/production_budget_decision_required/);
 await assert.rejects(f.budget.reserveUserApprovedOverage(scope,operation('repair'),{...approval(preview.previewHash),actorUserId:'other'}),/overage_approval_conflict/);
 }finally{f.cleanup()}});
test('changed price, occupied ledger and uncertain receipts invalidate the decision',async()=>{const f=fixture();try{
 await f.budget.reserveBatch(scope,[operation('previous')]);f.price(2);const preview=await f.budget.previewOverage(scope,operation('repair'));
 f.price(3);await assert.rejects(f.budget.reserveUserApprovedOverage(scope,operation('repair'),approval(preview.previewHash)),/overage_preview_changed/);
 f.price(2);await f.budget.markOutcome(scope,'previous','unknown','unknown-receipt');
 await assert.rejects(f.budget.reserveUserApprovedOverage(scope,operation('repair'),approval(preview.previewHash)),/overage_unsettled_receipt/);
 assert.equal(f.budget.status(scope)!.retainedCny,14);
 }finally{f.cleanup()}});
test('a rejected approved operation does not confer budget to other operations',async()=>{const f=fixture();try{
 await f.budget.reserveBatch(scope,[operation('previous')]);f.price(2);const preview=await f.budget.previewOverage(scope,operation('repair'));
 await f.budget.reserveUserApprovedOverage(scope,operation('repair'),approval(preview.previewHash));
 await f.budget.releaseRejected(scope,'repair','proved-rejected');
 await assert.rejects(f.budget.reserveBatch(scope,[operation('another')]),/production_budget_decision_required/);
 }finally{f.cleanup()}});
test('authorization changes invalidate the preview and do not create an entry',async()=>{const f=fixture();try{
 await f.budget.reserveBatch(scope,[operation('previous')]);f.price(2);const preview=await f.budget.previewOverage(scope,operation('repair'));
 f.ports.authorization=async()=>({maximumCny:15,productionDurationSeconds:31,authorizationRef:'original'});
 await assert.rejects(f.budget.reserveUserApprovedOverage(scope,operation('repair'),approval(preview.previewHash)),/overage_original_film_required/);
 f.ports.authorization=async()=>({maximumCny:15,productionDurationSeconds:30,authorizationRef:'different'});
 await assert.rejects(f.budget.reserveUserApprovedOverage(scope,operation('repair'),approval(preview.previewHash)),/overage_original_film_required/);
 assert.equal(f.budget.status(scope)!.entries.length,1);
 }finally{f.cleanup()}});
test('concurrent decisions are fenced by the shared original ledger lock',async()=>{const f=fixture();try{
 await f.budget.reserveBatch(scope,[operation('previous')]);f.price(2);const preview=await f.budget.previewOverage(scope,operation('repair'));
 const results=await Promise.allSettled([
  f.budget.reserveUserApprovedOverage(scope,operation('repair'),approval(preview.previewHash)),
  f.budget.reserveUserApprovedOverage(scope,operation('repair'),approval(preview.previewHash)),
 ]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(f.budget.status(scope)!.entries.length,2);
 await f.budget.reserveUserApprovedOverage(scope,operation('repair'),approval(preview.previewHash));
 assert.equal(f.budget.status(scope)!.retainedCny,16);
 }finally{f.cleanup()}});
test('preview cannot be replayed against another run or operation',async()=>{const f=fixture();try{
 await f.budget.reserveBatch(scope,[operation('previous')]);f.price(2);const preview=await f.budget.previewOverage(scope,operation('repair'));
 await assert.rejects(f.budget.reserveUserApprovedOverage({...scope,runId:'other-run'},operation('repair'),approval(preview.previewHash)),/overage_preview_changed/);
 await assert.rejects(f.budget.reserveUserApprovedOverage(scope,operation('other'),approval(preview.previewHash)),/overage_preview_changed/);
 assert.equal(f.budget.status(scope)!.entries.length,1);
 }finally{f.cleanup()}});

test('batch overage is atomic, binds every canonical quote and permits zero-extra members only in that batch',async()=>{
 const {createSocialContentPaidOperationPermit}=await import('./socialContentPaidOperationPermit.js');
 const {socialPaidIntentOperation}=await import('./socialContentTaskBudgetAuthority.js');
 const f=fixture();try{
  await f.budget.reserveBatch(scope,[operation('original')]);await f.budget.markOutcome(scope,'original','completed','original');
  f.price(.75,'each-slot');
  const repairScope={...scope,runId:'repair'};
  const intents=['repair-a','repair-b','repair-c'].map(id=>({operationId:id,provider:'heygen',model:'avatar_iv',accountRef:'account',stage:'presenter_video',shotId:id,inputContractHash:'c'.repeat(64),maximumUnits:{providerSeconds:1}}));
  const operations=intents.map(intent=>socialPaidIntentOperation(repairScope,intent));
  await assert.rejects(f.budget.reserveBatch(repairScope,operations),/production_budget_decision_required/);
  assert.equal(f.budget.status(scope)!.entries.length,1,'over-cap batch cannot leave partial reservations');
  const preview=await f.budget.previewOverageBatch(repairScope,operations);
  assert.equal(preview.extraMicros,1.25e6);
  await assert.rejects(f.budget.reserveUserApprovedOverageBatch(repairScope,operations.slice(0,2),approval(preview.previewHash)),/preview_changed/);
  assert.equal(f.budget.status(scope)!.entries.length,1);
  await f.budget.reserveUserApprovedOverageBatch(repairScope,[...operations].reverse(),approval(preview.previewHash));
  await f.budget.reserveUserApprovedOverageBatch(repairScope,operations,approval(preview.previewHash));
  const entries=f.budget.status(scope)!.entries.filter(entry=>entry.runId==='repair');
  assert.equal(entries.length,3);assert.equal(f.budget.status(scope)!.retainedCny,16.25);
  assert.deepEqual(entries.map(entry=>entry.overageApproval!.extraMicros).sort(),[0,.5e6,.75e6]);
  const permit=createSocialContentPaidOperationPermit({scope:repairScope,operations,intents,ledger:f.budget,root:path.join(f.root,'permits'),assertCurrent:async()=>{}});
  for(const intent of intents){const {maximumUnits,...binding}=intent;await permit.beforeSubmit({...binding,actualUnits:maximumUnits});await permit.markOutcome(intent.operationId,'completed','same-original-task');}
  assert.equal(f.budget.status(scope)!.retainedCny,16.25);
  await assert.rejects(f.budget.reserveBatch(repairScope,[operation('unrelated')]),/production_budget_decision_required/);
 }finally{f.cleanup();}
});

test('batch overage rechecks all tariffs and retained occupancy before one durable write',async()=>{
 const f=fixture();try{
  await f.budget.reserveBatch(scope,[operation('original')]);f.price(1);
  const operations=[operation('a'),operation('b')],preview=await f.budget.previewOverageBatch(scope,operations);
  f.price(1.1);await assert.rejects(f.budget.reserveUserApprovedOverageBatch(scope,operations,approval(preview.previewHash)),/preview_changed/);
  assert.equal(f.budget.status(scope)!.entries.length,1);
  f.price(1);await f.budget.markOutcome(scope,'original','unknown','unsettled');
  await assert.rejects(f.budget.reserveUserApprovedOverageBatch(scope,operations,approval(preview.previewHash)),/unsettled_receipt/);
  assert.equal(f.budget.status(scope)!.entries.length,1);
 }finally{f.cleanup();}
});
