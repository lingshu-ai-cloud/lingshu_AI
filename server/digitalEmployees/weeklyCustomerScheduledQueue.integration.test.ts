import test from 'node:test';
import assert from 'node:assert/strict';
import {store} from '../storage/index.js';
import type {FollowupBatchItemRecord} from './customerWorkflow.js';
import {nativeDispatchFixture} from './weeklyNativeFollowupDispatch.fixture.js';
import {createWeeklyNativeFollowupDispatchService} from './weeklyNativeFollowupDispatch.js';
import {createCustomerChannelSendRequestService} from './customerChannelSendRequests.js';
import {resolveCustomerMessagingAuthorization} from './customerMessagingPolicy.js';
import {dispatchScheduledNativeFollowupBatch,runFollowupDispatchScan} from './followupDispatchWorker.js';

async function queueFixture(channel:'messenger'|'instagram',unknown=false,route:'cold_start'|'account_repair'='account_repair'){
 const f=await nativeDispatchFixture(channel,false,route),original=store.list;
 let sends=0,manualGates=0;
 const makeService=()=>{
  const ledger=createCustomerChannelSendRequestService(f.store);
  return createWeeklyNativeFollowupDispatchService(f.store,{
   now:()=>new Date('2026-10-06T12:00:00Z'),
   assertScheduledProductAccess:async()=>{},executeScheduledProductEffect:async(_tenant,effect)=>effect(),
   authorization:async()=>resolveCustomerMessagingAuthorization({tenantId:'tenant',channel,configActive:true,customerAgentEnabled:true,allowRealCustomerMessages:true,providerReady:true,backgroundWorkerEnabled:true}),
   humanPermission:async()=>{manualGates++;throw Error('manual_gate_forbidden_in_worker');},autoPermission:async(_a,_hash,send)=>send(),
   send:async(a,body,requestId)=>ledger.execute({tenantId:a.tenantId,actorUserId:a.actorUserId,channel,customerId:a.customerId,accountId:a.accountId,recipientId:a.recipientId,body,requestId,weeklyAuthority:a,
    send:async()=>{sends++;if(unknown)throw Error('controlled_provider_unknown');return {messageId:`mid.controlled-queue-${channel}`,recipientId:a.recipientId,raw:{message_id:`mid.controlled-queue-${channel}`}};},recordHistory:async()=>{}}),
  });
 };
 store.list=f.store.list.bind(f.store);
 const scan=()=>runFollowupDispatchScan({getItems:async()=>[f.item as unknown as FollowupBatchItemRecord],nativeScheduled:input=>dispatchScheduledNativeFollowupBatch(f.store,input,{serviceFactory:makeService}),assertLegacyAccess:async()=>{throw Error('native_worker_must_not_borrow_whatsapp_authority');}});
 return {...f,scan,sends:()=>sends,manualGates:()=>manualGates,restore:()=>{store.list=original;f.restore();}};
}
for(const channel of ['messenger','instagram']as const){for(const route of ['cold_start','account_repair']as const){
 test(`${route} ${channel} real scheduled scanner freezes one persistent receipt and completes the original batch/task`,async()=>{
  const f=await queueFixture(channel,false,route);try{
   assert.equal(await f.scan(),1);assert.equal(f.sends(),1);assert.equal(f.manualGates(),0);
   assert.equal(f.item.status,'sent');assert.equal(f.batch.status,'completed');
   assert.equal(f.data.workflow_tasks!.find(t=>t.task_key==='followup_dispatch')!.status,'succeeded');
   const request=f.data.customer_channel_send_requests![0]!.payload as Record<string,unknown>;
   assert.equal(request.status,'accepted');assert.equal(request.actorUserId,'owner');
   assert.equal((f.item.provider_receipt as Record<string,unknown>).dispatchMode,'scheduled');
   assert.equal(f.item.provider_message_id,`mid.controlled-queue-${channel}`);
   await f.scan();assert.equal(f.sends(),1);assert.equal(f.data.customer_channel_send_requests!.length,1);
  }finally{f.restore();}
 });
 test(`${route} ${channel} unknown outcome survives scanner restart and only attempts original receipt reconciliation`,async()=>{
  const f=await queueFixture(channel,true,route);try{
   await f.scan();assert.equal(f.sends(),1);assert.equal(f.item.status,'blocked');
   const requestId=(f.item.provider_receipt as Record<string,unknown>).requestId;
   assert.equal(typeof requestId,'string');assert.equal(f.data.customer_channel_send_requests!.length,1);
   for(let i=0;i<3;i++){await f.scan();assert.equal(f.sends(),1);assert.equal((f.item.provider_receipt as Record<string,unknown>).requestId,requestId);}
   assert.equal(f.data.workflow_tasks!.find(t=>t.task_key==='followup_dispatch')!.status,'waiting_external');
   assert.notEqual(f.batch.status,'completed');assert.equal(f.manualGates(),0);
  }finally{f.restore();}
 });
 test(`${route} ${channel} scanner rejects tenant, approval version, account and customer drift before provider execution`,async()=>{
  for(const field of ['tenant','approval-version','approval-status','account','customer','conversation','member']as const){
   const f=await queueFixture(channel,false,route);try{
    if(field==='tenant')f.item.tenant_id='other';
    if(field==='approval-version')f.data.approval_requests![0]!.subject_version=3;
    if(field==='approval-status')f.data.approval_requests![0]!.status='pending';
    if(field==='account')f.data.social_accounts![0]!.providerAccountId='replaced-native-account';
    if(field==='customer')f.item.customer_id='other-customer';
    if(field==='conversation')f.source.conversationId='other-conversation';
    if(field==='member')f.data.customer_segment_members![0]!.membership='excluded';
    await f.scan();assert.equal(f.sends(),0,`${field} drift must fail before controlled provider`);
    assert.equal(f.data.customer_channel_send_requests?.length??0,0);
    assert.notEqual(f.data.workflow_tasks!.find(t=>t.task_key==='followup_dispatch')!.status,'succeeded');
   }finally{f.restore();}
  }
 });
}}

for(const channel of ['messenger','instagram']as const){
 test(`${channel} restarted scanner repairs accepted receipt after task persistence failure without another provider call`,async()=>{
  const f=await queueFixture(channel);try{
   const update=f.store.update.bind(f.store);let failOnce=true;
   f.store.update=async(collection,id,patch)=>{if(collection==='workflow_tasks'&&patch.status==='succeeded'&&failOnce){failOnce=false;return false;}return update(collection,id,patch);};
   await f.scan();assert.equal(f.sends(),1);assert.equal(f.item.status,'sent');assert.notEqual(f.batch.status,'completed');
   assert.equal(f.data.workflow_tasks!.find(t=>t.task_key==='followup_dispatch')!.status,'waiting_external');
   const requestId=(f.item.provider_receipt as Record<string,unknown>).requestId;
   await f.scan();assert.equal(f.sends(),1);assert.equal(f.batch.status,'completed');
   assert.equal(f.data.workflow_tasks!.find(t=>t.task_key==='followup_dispatch')!.status,'succeeded');
   assert.equal((f.item.provider_receipt as Record<string,unknown>).requestId,requestId);
   assert.equal(f.data.customer_channel_send_requests!.length,1);
  }finally{f.restore();}
 });
}
