import test from 'node:test';
import assert from 'node:assert/strict';
import {store} from '../storage/index.js';
import {sendRecoveryFixture} from '../socialPrograms/weeklyCustomerSendRecovery.fixture.js';
import {dispatchFollowupBatch,runFollowupDispatchScan,recoverStaleFollowupSending} from './followupDispatchWorker.js';
import {createCustomerChannelSendRequestService} from './customerChannelSendRequests.js';
import {followupItemContentHash,type FollowupBatchItemRecord,type FollowupBatchRecord} from './customerWorkflow.js';
import {resolveCustomerMessagingAuthorization} from './customerMessagingPolicy.js';

// Controlled transport only. This proves mixed scan isolation and actual WA
// receipt persistence; native weekly authority is covered by its own service suite.
test('mixed scan preserves native unknown ledger while real WA worker persists one controlled receipt',async t=>{
 const f=sendRecoveryFixture(),now=new Date('2026-10-06T12:00:00Z');
 const batch=f.data.followup_batches![0]!;Object.assign(batch,{status:'approved',delivery_policy:{},created_at:now.toISOString(),updated_at:now.toISOString()});
 const wa=f.data.followup_batch_items![0]!;Object.assign(wa,{channel:'whatsapp',wa_number:'+12025550123',customer_name:'Buyer',language:'en',time_zone:'UTC',last_inbound_at:now.toISOString(),outside_24h:false,template_name:'',template_status:'not_required',draft_version:1,status:'approved',risk_level:'low',guard_rule:'',scheduled_at:now.toISOString(),idempotency_key:'wa-controlled',provider_message_id:'',provider_receipt:{},attempts:0,last_error:'',sent_at:'',delivered_at:'',approved_at:now.toISOString(),created_at:now.toISOString(),updated_at:now.toISOString()});
 wa.content_hash=followupItemContentHash(wa as FollowupBatchItemRecord);
 const native={...structuredClone(wa),id:'native-item',customer_id:'native-buyer',channel:'instagram'};f.data.followup_batch_items!.push(native);
 f.data.social_accounts=[{id:'native-account',tenantId:'tenant',platform:'instagram',providerAccountId:'ig-controlled',status:'connected'}];
 const original={getById:store.getById,list:store.list,create:store.create,update:store.update,delete:store.delete};
 store.getById=f.store.getById.bind(f.store);store.list=f.store.list.bind(f.store);store.create=f.store.create.bind(f.store);
 store.update=(async(c,id,p)=>Boolean(await f.store.update(c,id,p))) as typeof store.update;
 store.delete=(async(c,id)=>{const rows=f.data[c]??[],i=rows.findIndex(r=>r.id===id);if(i<0)return false;rows.splice(i,1);return true;}) as typeof store.delete;
 f.store.delete=store.delete;
 t.after(()=>Object.assign(store,original));
 let waSends=0,nativeSends=0,history=0;
 const ledger=createCustomerChannelSendRequestService(f.store);
 const nativeDispatch=async()=>{await ledger.execute({tenantId:'tenant',actorUserId:'owner',channel:'instagram',customerId:'native-buyer',accountId:'native-account',recipientId:'ig-buyer',body:'Controlled native draft',requestId:'mixed-native-controlled',send:async()=>{nativeSends++;throw Error('controlled_lost_response');},recordHistory:async()=>{throw Error('unknown_must_not_record_history');}});};
 const waDispatch=async(tenantId:string,batchId:string)=>dispatchFollowupBatch(tenantId,batchId,{mode:'scheduled',dependencies:{now:()=>now,assertLegacyAccess:async()=>{},executeLegacyEffect:async(_tenant,effect)=>effect(),authorization:async()=>resolveCustomerMessagingAuthorization({tenantId:'tenant',channel:'whatsapp',configActive:true,customerAgentEnabled:true,allowRealCustomerMessages:true,providerReady:true,backgroundWorkerEnabled:true}),customers:()=>[{id:'buyer',waNumber:wa.wa_number,handlingMode:'ai_draft',tags:[],timeline:[{actor:'buyer',timestamp:now.getTime()-60_000}]}],guard:async()=>({allowed:true}),recipientDelayMs:0,recordOutbound:()=>{history++;},sendText:async(_tenant,to,body,onReceipt)=>{waSends++;const receipt={messageId:'wamid.controlled.mixed',recipientId:to,raw:{messages:[{id:'wamid.controlled.mixed'}]}};await onReceipt?.({message:body,receipt,index:0,total:1});return {messages:[body],receipts:[receipt]};}}});
 const scan=()=>runFollowupDispatchScan({nativeScheduled:nativeDispatch,assertLegacyAccess:async()=>{},recover:b=>recoverStaleFollowupSending(b,now,()=>{}),dispatch:waDispatch});
 await scan();assert.equal(waSends,1);assert.equal(nativeSends,1);assert.equal(history,1);assert.equal(wa.status,'sent');assert.equal(wa.provider_message_id,'wamid.controlled.mixed');assert.equal(wa.attempts,1);
 assert.equal(f.data.customer_channel_send_requests!.length,1);assert.equal((f.data.customer_channel_send_requests![0]!.payload as {status:string}).status,'unknown');
 // Return attention batch to approved solely to exercise another scanner pass;
 // existing accepted WA receipt and unknown native intent must remain immutable.
 batch.status='approved';await scan();assert.equal(waSends,1);assert.equal(nativeSends,1);assert.equal(history,1);assert.equal(f.data.customer_channel_send_requests!.length,1);
});
