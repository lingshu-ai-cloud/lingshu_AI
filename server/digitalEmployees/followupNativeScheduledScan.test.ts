import test from 'node:test';
import assert from 'node:assert/strict';
import {store} from '../storage/index.js';
import {runFollowupDispatchScan,dispatchScheduledNativeFollowupBatch,preflightFollowupBatchDispatch} from './followupDispatchWorker.js';
import type {FollowupBatchRecord,FollowupBatchItemRecord} from './customerWorkflow.js';
import {nativeDispatchFixture} from './weeklyNativeFollowupDispatch.fixture.js';
import {createWeeklyNativeFollowupDispatchService} from './weeklyNativeFollowupDispatch.js';
import {createCustomerChannelSendRequestService} from './customerChannelSendRequests.js';
import {resolveCustomerMessagingAuthorization} from './customerMessagingPolicy.js';

const at='2026-10-06T12:00:00Z';
function batchFixture(overrides:Partial<FollowupBatchRecord>):FollowupBatchRecord{return {id:'batch',tenant_id:'tenant',goal_id:'goal',run_id:'run',task_id:'draft',segment_id:'segment',name:'Controlled scheduled batch',status:'approved',version:1,approval_id:'approval',approved_version:1,content_hash:'hash',delivery_policy:{},safety_summary:{},counts:{},created_by:'owner',approved_by:'owner',created_at:at,updated_at:at,approved_at:at,...overrides};}
function itemFixture(overrides:Partial<FollowupBatchItemRecord>):FollowupBatchItemRecord{return {id:'item',tenant_id:'tenant',batch_id:'batch',segment_member_id:'member',customer_id:'buyer',customer_name:'Buyer',wa_number:'15551234567',language:'en',time_zone:'UTC',last_inbound_at:at,outside_24h:false,send_mode:'session_message',template_name:'',template_status:'not_required',draft_body:'Controlled followup',draft_version:1,content_hash:'hash',status:'approved',risk_level:'low',guard_rule:'',exclusion_reason:'',scheduled_at:at,idempotency_key:'controlled-item',provider_message_id:'',provider_receipt:{},attempts:0,last_error:'',approved_at:at,sent_at:'',delivered_at:'',created_at:at,updated_at:at,...overrides};}

test('native scheduled preflight does not borrow WhatsApp consent or require explicit manual dispatch',async()=>{
 const f=await nativeDispatchFixture('instagram'),originalGet=store.getById,originalList=store.list;
 store.getById=f.store.getById.bind(f.store);store.list=f.store.list.bind(f.store);
 const nativeAuth=resolveCustomerMessagingAuthorization({tenantId:'tenant',channel:'instagram',configActive:true,customerAgentEnabled:true,allowRealCustomerMessages:true,providerReady:true,backgroundWorkerEnabled:true});
 let whatsappReads=0,legacyReads=0;
 const dependencies={authorization:async()=>{whatsappReads++;return {...nativeAuth,channel:'whatsapp' as const,scheduledFollowupSendAllowed:false};},nativeAuthorization:async()=>nativeAuth,assertLegacyAccess:async()=>{legacyReads++;throw Error('unexpected_whatsapp_product_check');},nativePreflight:async()=>({status:'eligible' as const,code:null,scheduledAt:f.item.scheduled_at})};
 try{
  const ready=await preflightFollowupBatchDispatch('tenant','batch',{mode:'scheduled',dependencies});
  assert.equal(ready.ready,true);assert.equal(ready.eligible,1);assert.equal(ready.authorization.channel,'instagram');
  assert.equal(whatsappReads,0);assert.equal(legacyReads,0);assert.equal(ready.blockers.weekly_native_explicit_dispatch_required,undefined);
  const denied=await preflightFollowupBatchDispatch('tenant','batch',{mode:'scheduled',dependencies:{...dependencies,nativePreflight:async()=>({status:'blocked' as const,code:'weekly_native_dispatch_scheduled_not_authorized',scheduledAt:null})}});
  assert.equal(denied.ready,false);assert.equal(denied.blockers.weekly_native_dispatch_scheduled_not_authorized,1);
 }finally{store.getById=originalGet;store.list=originalList;f.restore();}
});

test('scan consumes the actual native driver and approved service, then reconciles the same receipt without sending again',async()=>{
 for(const channel of ['messenger','instagram'] as const){
  const f=await nativeDispatchFixture(channel),original=store.list;let sends=0;
  const ledger=createCustomerChannelSendRequestService(f.store);
  const service=createWeeklyNativeFollowupDispatchService(f.store,{
   now:()=>new Date('2026-10-06T12:00:00Z'),assertScheduledProductAccess:async()=>{},executeScheduledProductEffect:async(_tenant,effect)=>effect(),
   authorization:async()=>resolveCustomerMessagingAuthorization({tenantId:'tenant',channel,configActive:true,customerAgentEnabled:true,allowRealCustomerMessages:true,providerReady:true,backgroundWorkerEnabled:true}),
   autoPermission:async(_authority,_hash,send)=>send(),
   send:async(a,body,requestId)=>ledger.execute({tenantId:a.tenantId,actorUserId:a.actorUserId,channel,customerId:a.customerId,accountId:a.accountId,recipientId:a.recipientId,body,requestId,weeklyAuthority:a,send:async()=>{sends++;return {messageId:'mid.scan-controlled',recipientId:a.recipientId,raw:{message_id:'mid.scan-controlled'}};},recordHistory:async()=>{}}),
  });
  store.list=(async(collection:string)=>({items:collection==='followup_batches'?[f.batch]:[],totalItems:collection==='followup_batches'?1:0,totalPages:1,page:1,perPage:500})) as typeof store.list;
  const dispatch=()=>runFollowupDispatchScan({getItems:async()=>[itemFixture({id:f.item.id,tenant_id:'tenant',batch_id:f.batch.id,channel})],nativeScheduled:input=>dispatchScheduledNativeFollowupBatch(f.store,input,{serviceFactory:()=>service}),assertLegacyAccess:async()=>{throw Error('native_must_not_use_whatsapp_guard');}});
  try{
   await dispatch();assert.equal(sends,1);assert.equal(f.item.status,'sent');
   assert.equal(f.data.workflow_tasks!.find(t=>t.task_key==='followup_dispatch')!.status,'succeeded');
   assert.equal(f.batch.status,'completed');
   const recovered=await dispatchScheduledNativeFollowupBatch(f.store,{tenantId:'tenant',batchId:f.batch.id,runId:'run'},{serviceFactory:()=>service});
   assert.equal(recovered.outcomes[0]?.status,'reconciled');
   await dispatch();assert.equal(sends,1);assert.equal(f.data.customer_channel_send_requests!.length,1);
  }finally{store.list=original;f.restore();}
 }
});

test('scheduled scan isolates native channels from WhatsApp authorization and failure paths',async()=>{
 const original=store.list;
 const batches=[batchFixture({id:'native',run_id:'run-native',status:'needs_attention'}),batchFixture({id:'mixed',run_id:'run-mixed'}),batchFixture({id:'wa',run_id:'run-wa'})];
 store.list=(async(collection:string)=>({items:collection==='followup_batches'?batches:[],totalItems:collection==='followup_batches'?3:0,totalPages:1,page:1,perPage:500})) as typeof store.list;
 const native:string[]=[],legacy:string[]=[],sent:string[]=[];
 try{
  const result=await runFollowupDispatchScan({
   getItems:async(_tenant,batchId)=>[itemFixture({id:`item-${batchId}`,batch_id:batchId,channel:batchId==='wa'?'whatsapp':'instagram'}),...(batchId==='mixed'?[itemFixture({id:'mixed-wa',batch_id:batchId,channel:'whatsapp'})]:[])],
   nativeScheduled:async input=>{native.push(input.batchId);if(input.batchId==='mixed')throw Error('native_pending');},
   assertLegacyAccess:async tenant=>{legacy.push(tenant);},recover:async()=>0,
   getBatch:async(_tenant,id)=>batches.find(batch=>batch.id===id)!,
   dispatch:async(_tenant,id)=>{sent.push(id);return {batchId:id,mode:'scheduled',claimed:0,sent:0,partial:0,blocked:0,retryScheduled:0,failed:0,future:0,counts:{}};},
  });
  assert.equal(result,3);
  assert.deepEqual(native,['native','mixed'],'native recovery is consumed even in needs_attention');
  assert.equal(legacy.length,2,'native-only rows do not request WhatsApp legacy permission');
  assert.deepEqual(sent,['mixed','wa'],'native failure does not prevent a separate WhatsApp dispatch');
 }finally{store.list=original;}
});

test('scan rejects foreign batch items before either channel dispatcher',async()=>{
 const original=store.list;let native=0,wa=0;
 store.list=(async()=>({items:[batchFixture({})],totalItems:1,totalPages:1,page:1,perPage:500})) as typeof store.list;
 try{
  await runFollowupDispatchScan({getItems:async()=>[itemFixture({id:'foreign',tenant_id:'other',channel:'messenger'})],nativeScheduled:async()=>{native++;},assertLegacyAccess:async()=>{wa++;}});
  assert.equal(native,0);assert.equal(wa,0);
 }finally{store.list=original;}
});
