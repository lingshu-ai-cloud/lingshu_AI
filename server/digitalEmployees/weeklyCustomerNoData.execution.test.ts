import test from 'node:test';
import assert from 'node:assert/strict';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import {nativeDispatchFixture} from './weeklyNativeFollowupDispatch.fixture.js';
import {readWeeklyCustomerStep} from '../runtime/socialWeeklyCustomerBridge.js';
import {createSocialWeeklyCustomerChannelAdapter,validateWeeklyCustomerChannelExecution,WEEKLY_CUSTOMER_CHANNEL_EXECUTIONS} from '../runtime/socialWeeklyCustomerChannelAdapter.js';
import {resolveCustomerMessagingAuthorization} from './customerMessagingPolicy.js';

const scope={tenantId:'tenant',programId:'program',packageId:'week',packageVersion:1};
for(const channel of ['whatsapp','messenger','instagram']as const){
 test(`${channel} generated empty segment produces durable no_data without fabricated drafts or send receipts`,async()=>{
  const f=await nativeDispatchFixture(channel==='instagram'?'instagram':'messenger');
  try{
   f.data.customer_segment_members=[];f.data.customer_segments![0]!.member_count=0;
   f.data.followup_batches=[];f.data.followup_batch_items=[];
   f.data.tenant_platform_apps=[{id:'meta-app',tenant_id:'tenant',platform:'meta'}];
   if(channel!=='whatsapp')Object.assign(f.data.social_accounts![0]!,{messengerSubscribed:true,oauthProvider:'instagram_login',scope:'instagram_business_manage_messages',instagramWebhookSubscribed:true});
   const now=()=>new Date('2026-10-06T12:00:00Z');
   const ports={now,readAuthorization:async()=>resolveCustomerMessagingAuthorization({tenantId:'tenant',channel,configActive:true,customerAgentEnabled:true,allowRealCustomerMessages:true,providerReady:true,backgroundWorkerEnabled:true}),openSocialToken:()=> 'controlled-account-token',readWhatsApp:async()=>({accountId:'meta-app',nativeAccountId:'controlled-wa-phone',tenantId:'tenant',wabaId:'controlled-waba',accountHash:'a'.repeat(64)})};
   const task={...scope,taskId:`handoff-${channel}`,workflowKind:'engagement',scope:'publication',subjectId:'publication',publicationTaskId:'publication',accountId:channel==='whatsapp'?'meta-app':'account',dependsOnTaskIds:[],upstreamVersionRefs:[],inputSnapshot:{customerChannel:channel},idempotencyKey:`no-data-${channel}`,budget:{category:'none',limitCny:null},schedule:{stepKind:'customer_inquiry_handoff',responsibleActor:'customer_agent',estimatedDurationMinutes:5,estimatedStartAt:now().toISOString(),estimatedFinishAt:now().toISOString(),actualStartedAt:null,actualFinishedAt:null},status:'queued',ownBlockingReasons:[],inheritedBlockingTaskIds:[],attempt:0,maxAttempts:3,nextAttemptAt:null,lease:null,resultRefs:[],lastError:null,recoveredFromDeadLetterAt:null,cancelReason:null,createdAt:now().toISOString(),updatedAt:now().toISOString()} as WeeklyExecutionTask;
   const proof=await readWeeklyCustomerStep(f.store,scope,'run','customer_followup_dispatch');
   assert.equal(proof.status,'no_data');assert.equal(proof.reason,'weekly_customer_no_eligible_customers');
   const adapter=createSocialWeeklyCustomerChannelAdapter(f.store,ports),result=await adapter.execute(task);
   assert.equal(result.status,'succeeded');if(result.status!=='succeeded')return;
   const evidence=f.data[WEEKLY_CUSTOMER_CHANNEL_EXECUTIONS]![0]!.payload as Record<string,unknown>;
   assert.equal(evidence.noData,true);assert.equal(evidence.customerId,null);assert.equal(evidence.conversationId,null);assert.deepEqual(evidence.providerMessageIds,[]);
   await validateWeeklyCustomerChannelExecution(f.store,task,result.resultRefs,ports);
   assert.equal(f.data.followup_batches.length,0);assert.equal(f.data.followup_batch_items.length,0);assert.equal(f.data.customer_channel_send_requests?.length??0,0);assert.equal(f.sends(),0);
   f.data.customer_segments![0]!.status='pending';
   await assert.rejects(validateWeeklyCustomerChannelExecution(f.store,task,result.resultRefs,ports),/segmentation_pending/);
   const pending=await adapter.execute({...task,taskId:`pending-${channel}`});assert.notEqual(pending.status,'succeeded');
   assert.equal(f.data[WEEKLY_CUSTOMER_CHANNEL_EXECUTIONS]!.length,1,'incomplete empty segment must not create another successful no_data record');
   f.data.customer_segments![0]!.status='generated';
   const list=f.store.list.bind(f.store);
   f.store.list=(async(collection,query)=>collection==='customer_segment_members'?{items:[],totalItems:1,totalPages:1,page:1,perPage:250}:list(collection,query)) as typeof f.store.list;
   await assert.rejects(readWeeklyCustomerStep(f.store,scope,'run','customer_followup_dispatch'),(error:unknown)=>(error as {code?:string}).code==='weekly_customer_read_incomplete');
   const truncated=await adapter.execute({...task,taskId:`truncated-${channel}`});assert.notEqual(truncated.status,'succeeded');
   assert.equal(f.data[WEEKLY_CUSTOMER_CHANNEL_EXECUTIONS]!.length,1,'truncated membership read must never become no_data');

  }finally{f.restore();}
 });
}
