import test from 'node:test';
import assert from 'node:assert/strict';
import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import {createSocialWeeklyCustomerChannelAdapter,WEEKLY_CUSTOMER_CHANNEL_EXECUTIONS} from './socialWeeklyCustomerChannelAdapter.js';

function fixture(){
 const rows:Record<string,Record_[]>={
  digital_employee_configs:[{id:'config',tenant_id:'tenant',status:'active',config_version:1,config:{enabledWorkflows:['batch_followup'],allowRealCustomerMessages:true}}],
  social_accounts:[{id:'page',tenantId:'tenant',platform:'facebook',status:'connected',providerAccountId:'native-page',messengerSubscribed:true,accessToken:'sealed'}],
  social_weekly_customer_bindings:[{id:'binding',tenant_id:'tenant',program_id:'program',package_id:'package',package_version:1,run_id:'run',goal_id:'goal'}],
  social_programs:[{id:'program-row',tenant_id:'tenant',program_id:'program',payload:{route:'cold_start'}}],
  weekly_goals:[{id:'goal',tenant_id:'tenant',starts_at:'2026-10-05T00:00:00Z',ends_at:'2026-10-11T23:59:59Z'}],
  followup_batch_items:[{id:'item',tenant_id:'tenant',batch_id:'batch',channel:'messenger',status:'delivered',provider_message_id:'mid.real',provider_receipt:{messageId:'mid.real'},channel_selection:{recordHash:'selection-hash'}}],
 };
 const store={
  async list<T>(collection:string,query:any={}){const all=(rows[collection]??[]).filter(row=>Object.entries(query.where??{}).every(([key,value])=>row[key]===value));const per=query.perPage??250,page=query.page??1;return{items:structuredClone(all.slice((page-1)*per,page*per)) as T[],totalItems:all.length,totalPages:Math.max(1,Math.ceil(all.length/per)),page,perPage:per};},
  async getById<T>(collection:string,id:string){return structuredClone(rows[collection]?.find(row=>row.id===id)??null) as T|null;},
  async create<T>(collection:string,data:Record<string,unknown>){const row={...structuredClone(data),id:String(data.id)};(rows[collection]??=[]).push(row);return structuredClone(row) as T;},
  async update(collection:string,id:string,data:Record<string,unknown>){const row=rows[collection]?.find(item=>item.id===id);if(!row)return false;Object.assign(row,structuredClone(data));return true;},
 } as unknown as DataStore;
 const task=(step:'customer_channel_readiness'|'customer_inquiry_handoff'):WeeklyExecutionTask=>({taskId:`task-${step}`,tenantId:'tenant',programId:'program',packageId:'package',packageVersion:1,workflowKind:'engagement',scope:'publication',subjectId:`publication:${step}`,accountId:'page',publicationTaskId:'publication',dependsOnTaskIds:[],upstreamVersionRefs:[],inputSnapshot:{customerChannel:'messenger',publicationAccountId:'page'},idempotencyKey:'idem',budget:{category:'none',limitCny:null},schedule:{stepKind:step,responsibleActor:'customer_agent',estimatedDurationMinutes:10,estimatedStartAt:'2026-10-05T00:00:00Z',estimatedFinishAt:'2026-10-05T00:10:00Z',actualStartedAt:null,actualFinishedAt:null},status:'queued',ownBlockingReasons:[],inheritedBlockingTaskIds:[],attempt:0,maxAttempts:3,nextAttemptAt:null,lease:null,resultRefs:[],lastError:null,recoveredFromDeadLetterAt:null,cancelReason:null,createdAt:'2026-10-05T00:00:00Z',updatedAt:'2026-10-05T00:00:00Z'});
 const authorization=async()=>({tenantId:'tenant',channel:'messenger' as const,configVersion:1,configActive:true,customerAgentEnabled:true,tenantAuthorized:true,providerReady:true,backgroundWorkerEnabled:true,inboundAutoSendAllowed:true,manualFollowupSendAllowed:true,scheduledFollowupSendAllowed:true,reasons:[]});
 const selection={channel:'messenger' as const,accountId:'page',nativeAccountId:'native-page',conversationId:'messenger:native-page:buyer',customerId:'buyer',recordHash:'selection-hash'};
 return{rows,store,task,authorization,selection};
}

test('channel readiness persists a real account authority result and missing consent blocks instead of succeeding',async()=>{
 const f=fixture(),adapter=createSocialWeeklyCustomerChannelAdapter(f.store,{readAuthorization:f.authorization as any,openSocialToken:()=> 'token',now:()=>new Date('2026-10-05T00:00:00Z')});
 const result=await adapter.execute(f.task('customer_channel_readiness'));assert.equal(result.status,'succeeded');assert.equal(f.rows[WEEKLY_CUSTOMER_CHANNEL_EXECUTIONS]?.length,1);assert.equal((f.rows[WEEKLY_CUSTOMER_CHANNEL_EXECUTIONS]![0]!.payload as any).channelAuthority.nativeAccountId,'native-page');
 const blocked=await createSocialWeeklyCustomerChannelAdapter(f.store,{readAuthorization:async()=>({...await f.authorization(),tenantAuthorized:false,reasons:['tenant_real_customer_messages_not_authorized']}) as any,openSocialToken:()=> 'token'}).execute({...f.task('customer_channel_readiness'),taskId:'blocked'});assert.equal(blocked.status,'blocked');assert.equal('code' in blocked?blocked.code:'','tenant_real_customer_messages_not_authorized');
});

test('handoff binds the original weekly customer run and provider conversation; unknown outcome remains pending for recovery',async()=>{
 const f=fixture(),common={readAuthorization:f.authorization as any,openSocialToken:()=> 'token',verifySelection:async()=>f.selection as any,now:()=>new Date('2026-10-06T00:00:00Z')};
 const succeeded=await createSocialWeeklyCustomerChannelAdapter(f.store,{...common,readStep:async()=>({status:'succeeded',reason:null,runId:'run',taskId:'dispatch',resultRefs:[{type:'weekly_customer_followup_batch',id:'batch',version:1}]})}).execute(f.task('customer_inquiry_handoff'));
 assert.equal(succeeded.status,'succeeded');const evidence=f.rows[WEEKLY_CUSTOMER_CHANNEL_EXECUTIONS]![0]!.payload as any;assert.equal(evidence.runId,'run');assert.equal(evidence.conversationId,f.selection.conversationId);assert.deepEqual(evidence.providerMessageIds,['mid.real']);
 const pending=await createSocialWeeklyCustomerChannelAdapter(f.store,{...common,readStep:async()=>({status:'blocked',reason:'weekly_customer_send_outcome_unknown',runId:'run',taskId:'dispatch',resultRefs:[]})}).execute({...f.task('customer_inquiry_handoff'),taskId:'unknown'});assert.equal(pending.status,'pending');assert.equal('code' in pending?pending.code:'','weekly_customer_send_outcome_unknown');
});

test('successful customer dispatch without the requested channel receipt cannot complete the weekly handoff',async()=>{
 const f=fixture();f.rows.followup_batch_items![0]!.channel='instagram';
 const result=await createSocialWeeklyCustomerChannelAdapter(f.store,{readAuthorization:f.authorization as any,openSocialToken:()=> 'token',verifySelection:async()=>f.selection as any,readStep:async()=>({status:'succeeded',reason:null,runId:'run',taskId:'dispatch',resultRefs:[{type:'weekly_customer_followup_batch',id:'batch',version:1}]})}).execute(f.task('customer_inquiry_handoff'));
 assert.equal(result.status,'blocked');assert.equal('code' in result?result.code:'','weekly_customer_channel_dispatch_missing');
});
