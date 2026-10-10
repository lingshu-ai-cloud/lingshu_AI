import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeDispatchFixture} from './weeklyNativeFollowupDispatch.fixture.js';
import {createWeeklyNativeFollowupDispatchService} from './weeklyNativeFollowupDispatch.js';
import {createCustomerChannelSendRequestService} from './customerChannelSendRequests.js';
import {resolveCustomerMessagingAuthorization} from './customerMessagingPolicy.js';
import {createCustomerManualTakeoverService} from '../customerService/customerManualTakeover.js';
import {followupItemContentHash,type FollowupBatchItemRecord} from './customerWorkflow.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';

// Controlled transport only: exercise the real durable ledger, never a native provider.
async function fixture(channel:'messenger'|'instagram'='messenger',options:{scheduled?:boolean;unknown?:boolean;takeover?:boolean;humanHandling?:boolean;gateApprovalDrift?:boolean;productDenied?:boolean}={}) {
 const f=await nativeDispatchFixture(channel),clock=new Date('2026-10-06T12:00:00Z');
 const selection=f.item.channel_selection as Record<string,string>;
 const manual=createCustomerManualTakeoverService(f.store,{now:()=>clock.getTime(),resolve:async()=>({tenantId:'tenant',customerId:'buyer',channel,accountId:'account',nativeAccountId:'native-account',conversationId:selection.conversationId,accountHash:selection.accountHash,handlingMode:options.humanHandling?'human_needed':'auto'})});
 if(options.takeover)await manual.hold({tenantId:'tenant',customerId:'buyer',channel,actorUserId:'owner',minutes:10});
 let sends=0,humanCalls=0;const ledger=createCustomerChannelSendRequestService(f.store);
 const service=createWeeklyNativeFollowupDispatchService(f.store,{
  now:()=>clock,
  assertScheduledProductAccess:async()=>{if(options.productDenied)throw Error('test_product_access_denied');},
  executeScheduledProductEffect:async(_tenant,execute)=>execute(),
  authorization:async()=>resolveCustomerMessagingAuthorization({tenantId:'tenant',channel,configActive:true,customerAgentEnabled:true,allowRealCustomerMessages:true,providerReady:true,backgroundWorkerEnabled:options.scheduled!==false}),
  humanPermission:async()=>{humanCalls++;throw Error('test_scheduled_must_not_use_human_permission');},
  autoPermission:async(a,_accountHash,send)=>manual.withAutoSendPermission({tenantId:a.tenantId,customerId:a.customerId,channel:a.channel},async()=>{if(options.gateApprovalDrift)f.data.approval_requests![0]!.status='pending';return send();}),
  send:async(a,body,requestId)=>ledger.execute({tenantId:a.tenantId,actorUserId:a.actorUserId,channel,customerId:a.customerId,accountId:a.accountId,recipientId:a.recipientId,body,requestId,weeklyAuthority:a,send:async()=>{sends++;if(options.unknown)throw Error('test_provider_timeout');return {requestId,messageId:'mid.controlled-scheduled',recipientId:a.recipientId,acceptedAt:clock.toISOString(),raw:{message_id:'mid.controlled-scheduled'}};},recordHistory:async()=>{}}),
 });
 const {actorUserId:_actor,...command}=f.command;
 return {...f,manualService:f.service,manualCommand:f.command,allSends:()=>sends+f.sends(),service,command,sends:()=>sends,humanCalls:()=>humanCalls};
}

test('native scheduled sends require scheduled consent even when manual consent is available',async()=>{
 const f=await fixture('messenger',{scheduled:false});try{
  const preflight=await f.service.preflightScheduled(f.command);assert.equal(preflight.status,'blocked');
  await assert.rejects(f.service.dispatchScheduled(f.command));assert.equal(f.sends(),0);assert.equal(f.humanCalls(),0);
 }finally{f.restore();}
});

test('the scheduled product access guard blocks before native transport',async()=>{
 const f=await fixture('messenger',{productDenied:true});try{
  await assert.rejects(f.service.dispatchScheduled(f.command),/test_product_access_denied/);
  assert.equal(f.sends(),0);assert.equal(f.humanCalls(),0);
 }finally{f.restore();}
});

test('an actual manual hold or human handling blocks native automatic sends',async()=>{
 for(const options of [{takeover:true},{humanHandling:true}]){
  const f=await fixture('instagram',options);try{await assert.rejects(f.service.dispatchScheduled(f.command),/manual_active|human_handling_in_progress/);assert.equal(f.sends(),0);assert.equal(f.humanCalls(),0);}finally{f.restore();}
 }
});

test('scheduled approval, source-version and weekly scope drift block before transport',async()=>{
 for(const change of ['approval','batch-version','item-content','week-version']as const){
  const f=await fixture();try{
   if(change==='approval')f.data.approval_requests![0]!.status='pending';
   if(change==='batch-version')f.batch.version=3;
   if(change==='item-content')f.item.draft_body='Unapproved replacement';
   const command=change==='week-version'?{...f.command,expectedScope:{...f.command.expectedScope,packageVersion:2}}:f.command;
   assert.equal((await f.service.preflightScheduled(command)).status,'blocked');await assert.rejects(f.service.dispatchScheduled(command));assert.equal(f.sends(),0);
  }finally{f.restore();}
 }
});

test('concurrent scheduled requests bind one durable native receipt and never call manual permission',async()=>{
 for(const channel of ['messenger','instagram']as const){
  const f=await fixture(channel);try{
   assert.equal((await f.service.preflightScheduled(f.command)).status,'eligible');
   const results=await Promise.allSettled([f.service.dispatchScheduled(f.command),f.service.dispatchScheduled(f.command)]);
   assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(f.sends(),1);assert.equal(f.humanCalls(),0);
   const replay=await f.service.dispatchScheduled(f.command);assert.equal(replay.messagesSent,0);assert.equal(f.sends(),1);
   assert.equal((f.item.provider_receipt as Record<string,unknown>).dispatchMode,'scheduled');
  }finally{f.restore();}
 }
});

test('approval changed while entering the automatic conversation gate is rechecked before sending',async()=>{
 const f=await fixture('instagram',{gateApprovalDrift:true});try{
  assert.equal((await f.service.preflightScheduled(f.command)).status,'eligible');
  await assert.rejects(f.service.dispatchScheduled(f.command),/approval_changed/);
  assert.equal(f.sends(),0);assert.equal(f.item.status,'approved');
 }finally{f.restore();}
});

test('unknown native scheduled outcome remains durable and replay never resends',async()=>{
 const f=await fixture('messenger',{unknown:true});try{
  await assert.rejects(f.service.dispatchScheduled(f.command));assert.equal(f.sends(),1);
  const requests=f.data.customer_channel_send_requests??[];assert.equal(requests.length,1);
  await assert.rejects(f.service.dispatchScheduled(f.command));assert.equal(f.sends(),1);assert.equal(f.humanCalls(),0);
  assert.notEqual(f.item.status,'sent');
 }finally{f.restore();}
});

test('a future approved native item is reported without starting a transport attempt',async()=>{
 const f=await fixture();try{
  f.item.scheduled_at='2026-10-06T13:00:00Z';
  f.item.content_hash=followupItemContentHash(f.item as unknown as FollowupBatchItemRecord);
  f.batch.content_hash=socialRequestHash([f.item.content_hash]);f.data.approval_requests![0]!.content_hash=f.batch.content_hash;
  const command={...f.command,expectedItemHash:String(f.item.content_hash)};
  assert.equal((await f.service.preflightScheduled(command)).status,'future');
  await assert.rejects(f.service.dispatchScheduled(command),/schedule_not_due/);assert.equal(f.sends(),0);
 }finally{f.restore();}
});

test('manual and scheduled native requests share the same durable intent and send once',async()=>{
 for(const channel of ['messenger','instagram']as const){
  const f=await fixture(channel);try{
   const results=await Promise.allSettled([f.manualService.dispatch(f.manualCommand),f.service.dispatchScheduled(f.command)]);
   assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(f.allSends(),1);
   assert.equal((f.data.customer_channel_send_requests??[]).length,1);
   await f.service.dispatchScheduled(f.command);await f.manualService.dispatch(f.manualCommand);
   assert.equal(f.allSends(),1);
  }finally{f.restore();}
 }
});

test('scheduled provider acceptance survives task projection failure and replay only repairs projection',async()=>{
 const f=await fixture('instagram');try{
  const task=f.data.workflow_tasks!.find(t=>t.task_key==='followup_dispatch')!;
  const original=f.store.update.bind(f.store);let failOnce=true;
  f.store.update=async(collection,id,patch)=>{if(collection==='workflow_tasks'&&id===task.id&&patch.status==='succeeded'&&failOnce){failOnce=false;return false;}return original(collection,id,patch);};
  await assert.rejects(f.service.dispatchScheduled(f.command),/task_save_failed/);
  assert.equal(f.sends(),1);assert.equal(f.item.status,'sent');assert.equal(task.status,'waiting_external');
  const recovered=await f.service.dispatchScheduled(f.command);
  assert.equal(recovered.messagesSent,0);assert.equal(recovered.originalTaskCompleted,true);
  assert.equal(task.status,'succeeded');assert.equal(f.sends(),1);
 }finally{f.restore();}
});

test('cancelled leased duplicate or dependency-pending original dispatch tasks prevent scheduled sends',async()=>{
 for(const change of ['cancelled','lease','dependency','duplicate']as const){
  const f=await fixture();try{
   const task=f.data.workflow_tasks!.find(t=>t.task_key==='followup_dispatch')!;
   if(change==='cancelled')task.status='cancelled';
   if(change==='lease')task.lease_token='active-lease';
   if(change==='dependency')task.depends_on=['missing-dependency'];
   if(change==='duplicate')f.data.workflow_tasks!.push({...task,id:'duplicate-dispatch'});
   assert.equal((await f.service.preflightScheduled(f.command)).status,'blocked');
   await assert.rejects(f.service.dispatchScheduled(f.command),/task_not_recoverable|dependencies_pending/);
   assert.equal(f.sends(),0);assert.equal(f.humanCalls(),0);
  }finally{f.restore();}
 }
});

test('a completed original dispatch cannot create a new send without its actual ledger',async()=>{
 for(const receipt of [{},{requestId:'forged-request'}]){
  const f=await fixture();try{
   f.data.workflow_tasks!.find(t=>t.task_key==='followup_dispatch')!.status='succeeded';
   f.item.provider_receipt=receipt;
   await assert.rejects(f.service.dispatchScheduled(f.command),/completed_task_new_send_forbidden/);
   assert.equal(f.sends(),0);assert.equal(f.item.status,'approved');
  }finally{f.restore();}
 }
});

test('a batch projection save failure is recovered after task completion without resending',async()=>{
 const f=await fixture('instagram');try{
  const original=f.store.update.bind(f.store);let failOnce=true;
  f.store.update=async(collection,id,patch)=>{if(collection==='followup_batches'&&id===f.batch.id&&patch.status==='completed'&&failOnce){failOnce=false;return false;}return original(collection,id,patch);};
  await assert.rejects(f.service.dispatchScheduled(f.command),/batch.*save_failed/);
  assert.equal(f.sends(),1);assert.equal(f.batch.status,'approved');
  assert.equal(f.data.workflow_tasks!.find(t=>t.task_key==='followup_dispatch')!.status,'succeeded');
  const recovered=await f.service.dispatchScheduled(f.command);
  assert.equal(recovered.messagesSent,0);assert.equal(f.sends(),1);assert.equal(f.batch.status,'completed');
  assert.ok(f.batch.counts&&typeof f.batch.counts==='object');
 }finally{f.restore();}
});
