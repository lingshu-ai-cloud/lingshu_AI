import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SocialContentTaskBudget,type SocialTaskBudgetOperation,type SocialTaskBudgetScope} from './socialContentTaskBudget.js';
import {productionBudgetDuration,productionBudgetLimitCny,productionBudgetDecisionError,productionBudgetDecisionMessage} from '../../shared/contracts/productionBudgetPolicy.js';
import {parseCreateSocialTask} from '../starter198/socialContentValidation.js';
import {defaultBrief} from '../starter198/socialContentTaskSupport.js';
import {classifyContentExecutionFailure} from '../contentExecution/retryPolicy.js';

const scope:SocialTaskBudgetScope={tenantId:'budget-test',taskId:'film',runId:'original',planHash:'a'.repeat(64)};
const operation=(id:string):SocialTaskBudgetOperation=>({operationId:id,fingerprint:'b'.repeat(64),provider:'offline',model:'fixture',accountRef:'test',stage:'video',shotId:'s1'});
function fixture(duration=30,maximum=productionBudgetLimitCny(duration)){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'production-budget-policy-'));
  const ports={authorization:async()=>({maximumCny:maximum,productionDurationSeconds:duration,authorizationRef:'approved-original-order'}),
    quote:async(_scope:SocialTaskBudgetScope,op:SocialTaskBudgetOperation)=>({upperBoundCny:Number(op.operationId.split(':')[1]),quoteRef:op.operationId,validUntil:'2099-01-01'}),
    assertCurrent:async()=>{},verifyRejection:async()=>false};
  return {root,ports,ledger:new SocialContentTaskBudget(root,ports),clean:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('one rate covers creation, legacy defaults and 15/30/60-second finished videos',()=>{
  for(const [duration,expected] of [[15,7.5],[30,15],[60,30]]){
    const brief=parseCreateSocialTask({title:'offline',objective:'production budget',mode:'instant',targetDurationSeconds:duration,perItemBudgetCny:10});
    assert.equal(brief.perItemBudgetCny,expected);assert.equal(defaultBrief({...brief,materialRoutingPolicyVersion:'type-aware.v1'}).perItemBudgetCny,expected);
    assert.equal(productionBudgetLimitCny(duration),expected);
  }
  assert.equal(productionBudgetDuration(),30);
  assert.equal(productionBudgetDuration({targetDurationSeconds:30,scenes:[{duration:{startSeconds:0,endSeconds:60}}]}),30);
  for(const duration of [NaN,Infinity,0,-1])assert.throws(()=>productionBudgetLimitCny(duration),/duration_invalid/);
});
test('60-second authorized film can reserve 30 yuan; a replay cannot enlarge its duration or budget',async()=>{
  const f=fixture(60);try{
    await f.ledger.reserveBatch(scope,[operation('original:30')]);
    assert.equal(new SocialContentTaskBudget(f.root,f.ports).status(scope)!.limitCny,30);
    f.ports.authorization=async()=>({maximumCny:60,productionDurationSeconds:120,authorizationRef:'unapproved-duration-change'});
    await assert.rejects(f.ledger.reserveBatch({...scope,runId:'retry'},[operation('retry:0.01')]),/production_budget_decision_required/);
    assert.equal(f.ledger.status(scope)!.retainedCny,30);
  }finally{f.clean();}
});
test('verified acquisition is separately accounted, while unknown production and child repair occupy the same cap',async()=>{
  const f=fixture();try{
    await f.ledger.carryForwardPreproduction(scope,operation('acquisition:50'),{schema:'social-task-preproduction-budget-binding.v1',source:'weekly_candidate_exact_analysis',tenantId:scope.tenantId,packageId:'week',packageVersion:1,motherContentId:'film',candidateId:'reference',sourceOperationId:'acquisition:50',sourceAuthorizationHash:'c'.repeat(64),sourceLedgerOutcomeHash:'d'.repeat(64),sourceReceiptHash:'e'.repeat(64),retainedUpperBoundCny:50},async()=>true);
    assert.equal(f.ledger.status(scope)!.acquisitionCny,50);assert.equal(f.ledger.status(scope)!.remainingCny,15);
    await f.ledger.reserveBatch(scope,[operation('original:12')]);
    await f.ledger.markOutcome(scope,'original:12','unknown','receipt-pending');
    const repair={...scope,taskId:'child',budgetTaskId:'film',runId:'repair'};
    const restarted=new SocialContentTaskBudget(f.root,f.ports);
    await restarted.reserveBatch(repair,[operation('repair:3')]);
    const before=restarted.status(repair)!;
    await assert.rejects(restarted.reserveBatch({...repair,runId:'repair-retry'},[operation('extra:0.01')]),/production_budget_decision_required/);
    assert.deepEqual(restarted.status(repair),before);assert.equal(before.retainedCny,15);
    assert.equal(before.entries.find(entry=>entry.operationId==='original:12')!.status,'unknown');
  }finally{f.clean();}
});
test('an earlier lower authorization and incremental repair allowance are never silently raised',async()=>{
  const f=fixture(30,10);try{
    await f.ledger.reserveBatch(scope,[operation('original:9')]);
    f.ports.authorization=async()=>({maximumCny:15,productionDurationSeconds:30,authorizationRef:'new-product-default'});
    await assert.rejects(f.ledger.reserveBatch({...scope,runId:'revision'},[operation('extra:2')]),/production_budget_decision_required/);
    assert.equal(f.ledger.status(scope)!.limitCny,10);
  }finally{f.clean();}
});
test('budget failures require a user decision; unresolved supplier receipts retain reconciliation priority',()=>{
  const error=Error('user_input_required:production_budget_decision_required:total_exceeded');
  assert.equal(classifyContentExecutionFailure(error,{attempt:1}).disposition,'block');
  assert.equal(classifyContentExecutionFailure(error,{attempt:1}).failureClass,'input_required');
  assert.equal(classifyContentExecutionFailure(error,{attempt:1,hasUnsettledProviderReceipt:true}).disposition,'reconcile');
});

test('budget decision copy exposes retained, additional and total costs without granting authority',()=>{
 const reason=productionBudgetDecisionError({maximumCny:15,retainedCny:14,plannedAdditionalCny:2,totalCny:16});
 const message=productionBudgetDecisionMessage(reason.message);
 assert.match(message,/当前额度 ¥15.00/);assert.match(message,/已占用 ¥14.00/);assert.match(message,/新增报价 ¥2.00/);assert.match(message,/累计 ¥16.00/);
});
