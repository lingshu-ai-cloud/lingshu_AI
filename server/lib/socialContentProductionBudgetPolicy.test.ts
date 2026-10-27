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
test('the duration rate remains a default target; explicit confirmed limits survive creation and projection',()=>{
  for(const [duration,expected] of [[15,7.5],[30,15],[60,30]]){
    const brief=parseCreateSocialTask({title:'offline',objective:'production budget',mode:'instant',targetDurationSeconds:duration,perItemBudgetCny:10});
    assert.equal(brief.perItemBudgetCny,10);assert.equal(defaultBrief({...brief,materialRoutingPolicyVersion:'type-aware.v1'}).perItemBudgetCny,10);
    assert.equal(productionBudgetLimitCny(duration),expected);
  }
  assert.equal(productionBudgetDuration(),30);
  assert.equal(productionBudgetDuration({targetDurationSeconds:30,scenes:[{duration:{startSeconds:0,endSeconds:60}}]}),30);
  for(const duration of [NaN,Infinity,0,-1])assert.throws(()=>productionBudgetLimitCny(duration),/duration_invalid/);
});
test('60-second forecast remains visible while later valid usage is metered without a cap',async()=>{
  const f=fixture(60);try{
    await f.ledger.reserveBatch(scope,[operation('original:30')]);
    assert.equal(new SocialContentTaskBudget(f.root,f.ports).status(scope)!.limitCny,30);
    f.ports.authorization=async()=>({maximumCny:60,productionDurationSeconds:120,authorizationRef:'unapproved-duration-change'});
    await f.ledger.reserveBatch({...scope,runId:'retry'},[operation('retry:0.01')]);
    assert.equal(f.ledger.status(scope)!.retainedCny,30.01);
  }finally{f.clean();}
});
test('an explicit 100-yuan forecast is retained while retries continue to be metered',async()=>{
  const brief=parseCreateSocialTask({title:'authorized film',objective:'production',mode:'instant',targetDurationSeconds:38,perItemBudgetCny:100});
  assert.equal(brief.perItemBudgetCny,100);assert.equal(defaultBrief(brief).perItemBudgetCny,100);
  const f=fixture(38,100);try{
    await f.ledger.reserveBatch(scope,[operation('first:90')]);
    await f.ledger.markOutcome(scope,'first:90','unknown','pending-provider-receipt');
    const restarted=new SocialContentTaskBudget(f.root,f.ports);
    await restarted.reserveBatch({...scope,runId:'retry'},[operation('last:10')]);
    assert.equal(restarted.status(scope)!.limitCny,100);assert.equal(restarted.status(scope)!.retainedCny,100);
    f.ports.authorization=async()=>({maximumCny:200,productionDurationSeconds:38,authorizationRef:'changed-default'});
    await restarted.reserveBatch({...scope,runId:'retry-2'},[operation('extra:0.01')]);
    assert.equal(restarted.status(scope)!.limitCny,100);assert.equal(restarted.status(scope)!.retainedCny,100.01);
  }finally{f.clean();}
});
test('verified acquisition is separately accounted while production and repair usage remain metered',async()=>{
  const f=fixture();try{
    await f.ledger.carryForwardPreproduction(scope,operation('acquisition:50'),{schema:'social-task-preproduction-budget-binding.v1',source:'weekly_candidate_exact_analysis',tenantId:scope.tenantId,packageId:'week',packageVersion:1,motherContentId:'film',candidateId:'reference',sourceOperationId:'acquisition:50',sourceAuthorizationHash:'c'.repeat(64),sourceLedgerOutcomeHash:'d'.repeat(64),sourceReceiptHash:'e'.repeat(64),retainedUpperBoundCny:50},async()=>true);
    assert.equal(f.ledger.status(scope)!.acquisitionCny,50);assert.equal(f.ledger.status(scope)!.remainingCny,15);
    await f.ledger.reserveBatch(scope,[operation('original:12')]);
    await f.ledger.markOutcome(scope,'original:12','unknown','receipt-pending');
    const repair={...scope,taskId:'child',budgetTaskId:'film',runId:'repair'};
    const restarted=new SocialContentTaskBudget(f.root,f.ports);
    await restarted.reserveBatch(repair,[operation('repair:3')]);
    await restarted.reserveBatch({...repair,runId:'repair-retry'},[operation('extra:0.01')]);
    const after=restarted.status(repair)!;assert.equal(after.retainedCny,15.01);
    assert.equal(after.entries.find(entry=>entry.operationId==='original:12')!.status,'unknown');
  }finally{f.clean();}
});
test('an earlier forecast stays unchanged while additional usage is recorded',async()=>{
  const f=fixture(30,10);try{
    await f.ledger.reserveBatch(scope,[operation('original:9')]);
    f.ports.authorization=async()=>({maximumCny:15,productionDurationSeconds:30,authorizationRef:'new-product-default'});
    await f.ledger.reserveBatch({...scope,runId:'revision'},[operation('extra:2')]);
    assert.equal(f.ledger.status(scope)!.limitCny,10);assert.equal(f.ledger.status(scope)!.retainedCny,11);
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
