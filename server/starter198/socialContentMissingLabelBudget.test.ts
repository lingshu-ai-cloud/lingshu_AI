import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LangGraphTestStore} from '../../scripts/langgraphTestStore.js';
import {createStarter198Repository,STARTER_COLLECTIONS} from './repository.js';
import {SocialContentTaskBudget} from '../lib/socialContentTaskBudget.js';
import {prepareMissingLabelBudget} from './socialContentMissingLabelBudget.js';

async function fixture(t:test.TestContext){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'label-budget-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new LangGraphTestStore(path.join(root,'store.json')),repository=createStarter198Repository(store);
 await store.create(STARTER_COLLECTIONS.socialContentTasks,{id:'task-row',tenant_id:'tenant',task_id:'film',run_id:'run',brief:{materialRoutingPolicyVersion:'type-aware.v3',targetDurationSeconds:30}});
 const request={model:'qwen3-vl-plus',messages:[{role:'user',content:'existing observed factory evidence'}],max_tokens:1000};
 let posts=0,current=true,tariffCny=1;const receipts=new Map<string,unknown>();
 const input={repository,tenantId:'tenant',taskId:'film',runId:'run',planHash:'a'.repeat(64),durationSeconds:30,request,
  assertCurrent:async()=>{if(!current)throw Error('superseded');},ports:{ledgerRoot:root,
   readBinding:()=>({baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',credentialSha256:'b'.repeat(64),materialModel:'qwen3-vl-plus',imageModel:'qwen3-vl-plus'}),
   readTariff:async(intent:any)=>({provider:intent.provider,model:intent.model,stage:intent.stage,accountRef:intent.accountRef,currency:'CNY' as const,verifiedAccountPrice:true,evidenceRef:'controlled-price',checkedAt:new Date(Date.now()-1000).toISOString(),validUntil:'2099-01-01',meters:{inputTokens:{priceCny:tariffCny,unitsPerPrice:260096,minimumUnits:0,increment:1},outputTokens:{priceCny:0,unitsPerPrice:1,minimumUnits:0,increment:1}}}),
   persistProviderReceipt:async({response}:{response:unknown})=>{receipts.set('receipt',response);return 'receipt';},
   readProviderReceipt:async(ref:string)=>receipts.get(ref)}};
 return {input,get posts(){return posts;},send:async()=>{posts++;return {choices:[{message:{content:'actual-response'}}]};},
  setCurrent:(value:boolean)=>{current=value;},setTariff:(value:number)=>{tariffCny=value;}};
}

test('early analysis reserves the same film ledger and restart recovers completed response without another POST',async t=>{
 const f=await fixture(t),call=await prepareMissingLabelBudget(f.input);
 assert.equal(call.reserved.status.retainedCny,1);assert.equal(call.reserved.status.limitCny,15);
 await call.submit(f.send);assert.equal(f.posts,1);
 const replay=await prepareMissingLabelBudget(f.input);
 assert.equal(replay.intent.operationId,call.intent.operationId);
 assert.deepEqual(await replay.recoverResponse(),{choices:[{message:{content:'actual-response'}}]});
 await assert.rejects(replay.submit(f.send),/paid_result_unknown/);assert.equal(f.posts,1);
 assert.equal(replay.reserved.ledger.status(replay.scope)!.entries.length,1);
 f.setCurrent(false);await assert.rejects(prepareMissingLabelBudget(f.input),/superseded/);
});

test('unknown transport retains fee and never repeats submission, including restart',async t=>{
 const f=await fixture(t),call=await prepareMissingLabelBudget(f.input);let posts=0;
 await assert.rejects(call.submit(async()=>{posts++;throw Error('transport');}),/transport/);
 const replay=await prepareMissingLabelBudget(f.input);
 assert.equal(replay.reserved.status.entries[0]!.status,'unknown');
 await assert.rejects(replay.recoverResponse(),/paid_result_unknown/);
 await assert.rejects(replay.submit(async()=>{posts++;return {};}),/paid_result_unknown/);
 assert.equal(posts,1);assert.equal(replay.reserved.status.retainedCny,1);
});

test('cumulative 14 + 1 permitted, above 15 and over 30 seconds do not send',async t=>{
 const f=await fixture(t),scope={tenantId:'tenant',taskId:'film',runId:'original-run',planHash:'c'.repeat(64)};
 const original=new SocialContentTaskBudget(f.input.ports.ledgerRoot,{assertCurrent:async()=>{},authorization:async()=>({maximumCny:15,productionDurationSeconds:30,authorizationRef:'film'}),quote:async()=>({upperBoundCny:14,quoteRef:'first',validUntil:'2099-01-01'}),verifyRejection:async()=>false});
 await original.reserveBatch(scope,[{operationId:'prior-shots',fingerprint:'d'.repeat(64),provider:'existing',model:'existing',accountRef:'existing',stage:'video',shotId:'slot'}]);
 const call=await prepareMissingLabelBudget(f.input);assert.equal(call.reserved.status.retainedCny,15);
 await assert.rejects(prepareMissingLabelBudget({...f.input,durationSeconds:31}),/duration_decision_required/);
 f.setTariff(2);
 await assert.rejects(prepareMissingLabelBudget({...f.input,request:{...f.input.request,max_tokens:1001}}),/user_input_required:production_budget_decision_required/);
 assert.equal(f.posts,0);
});

test('production receipt bytes recover after restart using the request serialization hash',async t=>{
 const f=await fixture(t),previous=process.env.SOCIAL_CONTENT_PROVIDER_RECEIPT_DIR;
 process.env.SOCIAL_CONTENT_PROVIDER_RECEIPT_DIR=path.join(f.input.ports.ledgerRoot,'provider-receipts');
 t.after(()=>{if(previous===undefined)delete process.env.SOCIAL_CONTENT_PROVIDER_RECEIPT_DIR;else process.env.SOCIAL_CONTENT_PROVIDER_RECEIPT_DIR=previous;});
 const {persistProviderReceipt:_,readProviderReceipt:__,...ports}=f.input.ports;
 const input={...f.input,ports},call=await prepareMissingLabelBudget(input);
 const response=await call.submit(f.send);assert.equal(f.posts,1);
 const replay=await prepareMissingLabelBudget(input);assert.deepEqual(await replay.recoverResponse(),response);
 assert.equal(f.posts,1);
});

test('weekly preproduction evidence is carried into the same scope before early reservation; failed carry never submits',async t=>{
 const f=await fixture(t),store=f.input.repository.dataStore!;
 await store.update(STARTER_COLLECTIONS.socialContentTasks,'task-row',{created_at:'2026-10-28T00:00:00.000Z',brief:{materialRoutingPolicyVersion:'type-aware.v3',targetDurationSeconds:30,_weeklyAuthority:{weeklyPackage:{programId:'program'},publicationTask:{}}}});
 let carries=0;
 const carryForwardWeeklyExactCost:NonNullable<Parameters<typeof prepareMissingLabelBudget>[0]['ports']>['carryForwardWeeklyExactCost']=async input=>{
  carries++;assert.equal(input.mode,'carry');assert.equal(input.scope.taskId,'film');assert.equal(input.scope.planHash,f.input.planHash);
  assert.equal(input.budget.status(input.scope),null,'carry precedes label reservation');return null;
 };
 await prepareMissingLabelBudget({...f.input,ports:{...f.input.ports,carryForwardWeeklyExactCost}});assert.equal(carries,1);
 await assert.rejects(prepareMissingLabelBudget({...f.input,ports:{...f.input.ports,carryForwardWeeklyExactCost:async()=>{throw Error('source-evidence-missing');}}}),/source-evidence-missing/);
 assert.equal(f.posts,0);
});
