import test from 'node:test';
import {readWeeklyCustomerChannelReadiness} from './socialWeeklyCustomerChannelAdapter.js';
import {encryptSecret} from '../lib/tenantPlatformApps.js';
import assert from 'node:assert/strict';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import {nativeDispatchFixture} from '../digitalEmployees/weeklyNativeFollowupDispatch.fixture.js';
import {resolveCustomerMessagingAuthorization} from '../digitalEmployees/customerMessagingPolicy.js';
import {materializeWeeklyCustomerChannelAuthorizationException,runWeeklyCustomerChannelAuthorizationExceptionScan,listWeeklyCustomerChannelAuthorizationExceptions,CUSTOMER_CHANNEL_AUTHORIZATION_EXCEPTIONS} from './weeklyCustomerChannelAuthorizationExceptions.js';
const now=new Date('2026-10-06T12:00:00Z');
async function fixture(channel:'whatsapp'|'messenger'|'instagram') {
 const f=await nativeDispatchFixture(channel==='instagram'?'instagram':'messenger');
 if(channel==='whatsapp'){f.data.social_weekly_customer_channel_selections=[];f.data.tenant_platform_apps=[{id:'wa-app',tenant_id:'tenant',platform:'meta',phone_number_id:'wa-phone'}];}
 else Object.assign(f.data.social_accounts![0]!,{messengerSubscribed:true,oauthProvider:'instagram_login',scope:'instagram_business_manage_messages',instagramWebhookSubscribed:true,expiresAt:'2026-10-10T00:00:00Z'});
 const t:WeeklyExecutionTask={tenantId:'tenant',programId:'program',packageId:'week',packageVersion:1,taskId:`readiness-${channel}`,workflowKind:'engagement',scope:'publication',subjectId:'pub',publicationTaskId:'pub',accountId:'account',dependsOnTaskIds:[],upstreamVersionRefs:[],inputSnapshot:{customerChannel:channel},idempotencyKey:`readiness-${channel}`,budget:{category:'none',limitCny:null},schedule:{stepKind:'customer_channel_readiness',responsibleActor:'customer_agent',estimatedDurationMinutes:5,estimatedStartAt:'2026-10-07T12:00:00Z',estimatedFinishAt:'2026-10-07T12:05:00Z',actualStartedAt:null,actualFinishedAt:null},status:'blocked',ownBlockingReasons:['tenant_real_customer_messages_not_authorized'],inheritedBlockingTaskIds:[],attempt:0,maxAttempts:3,nextAttemptAt:null,lease:null,resultRefs:[],lastError:{code:'tenant_real_customer_messages_not_authorized',message:'missing consent',retryable:false,occurredAt:now.toISOString()},recoveredFromDeadLetterAt:null,cancelReason:null,createdAt:now.toISOString(),updatedAt:now.toISOString()};
 f.data.social_weekly_execution_tasks=[{id:t.taskId,tenant_id:'tenant',program_id:'program',package_id:'week',package_version:1,task_id:t.taskId,status:'blocked',payload:t}];
 const pkg=f.data.social_weekly_operating_packages![0]!;Object.assign(pkg,{version:1,payload:{...(pkg.payload as object),programId:'program',packageId:'week',version:1,status:'active'}});
 let consent=false;
 const ports={now:()=>now,readAuthorization:async()=>resolveCustomerMessagingAuthorization({tenantId:'tenant',channel,configActive:true,customerAgentEnabled:true,allowRealCustomerMessages:consent,providerReady:true,backgroundWorkerEnabled:true}),openSocialToken:()=> 'controlled-token',readWhatsApp:async()=>({tenantId:'tenant',accountId:'wa-app',nativeAccountId:'wa-phone',wabaId:'waba',accountHash:'verified-wa'})};
 return {...f,t,ports,allow:()=>{consent=true;}};
}
for(const channel of ['whatsapp','messenger','instagram']as const){
 test(`${channel} missing authorization has one durable exception; fresh official authority restores only exact consumer`,async()=>{
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('external_fetch_forbidden');};const f=await fixture(channel);
 try{const input={store:f.store,task:f.t,gapCode:f.t.lastError!.code,now};await materializeWeeklyCustomerChannelAuthorizationException(input);await materializeWeeklyCustomerChannelAuthorizationException(input);assert.equal(f.data[CUSTOMER_CHANNEL_AUTHORIZATION_EXCEPTIONS]!.length,1);
 assert.equal((await runWeeklyCustomerChannelAuthorizationExceptionScan({store:f.store,now,ports:f.ports})).resolved,0);assert.equal(f.t.status,'blocked');f.allow();
 const report=await runWeeklyCustomerChannelAuthorizationExceptionScan({store:f.store,now,ports:f.ports});assert.equal(report.resolved,1,JSON.stringify(report));assert.equal((f.data[CUSTOMER_CHANNEL_AUTHORIZATION_EXCEPTIONS]!.find(row=>row.version===3)!.payload as {status:string}).status,'resolved');const task=f.data.social_weekly_execution_tasks![0]!.payload as WeeklyExecutionTask;assert.equal(task.taskId,f.t.taskId);assert.equal(task.ownBlockingReasons.length,0);assert.equal(f.sends(),0);const listed=await listWeeklyCustomerChannelAuthorizationExceptions({store:f.store,tenantId:'tenant',programId:'program',packageId:'week',packageVersion:1});assert.equal(listed.length,1);assert.equal(listed[0]!.status,'resolved');assert.equal((await runWeeklyCustomerChannelAuthorizationExceptionScan({store:f.store,now,ports:f.ports})).resolved,0);
 }finally{f.restore();globalThis.fetch=originalFetch;}
 });
 test(`${channel} tenant/account/native account/run/customer/version drift and no_data cannot substitute authorization`,async()=>{
 for(const drift of ['tenant','account','native','run','customer','version','expired','oauth_provider','deadline','deleted_selected_with_other','no_data']){
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('external_fetch_forbidden');};const f=await fixture(channel);
 try{await materializeWeeklyCustomerChannelAuthorizationException({store:f.store,task:f.t,gapCode:f.t.lastError!.code,now});if(drift!=='no_data')f.allow();
 if(drift==='tenant')f.data.workflow_runs![0]!.tenant_id='foreign';
 if(drift==='deleted_selected_with_other'){if(channel==='whatsapp')f.data.tenant_platform_apps![0]!.id='replacement';else{f.data.social_accounts=[{...f.data.social_accounts![0]!,id:'replacement',providerAccountId:'replacement-native'}];}}
 if(drift==='account'){if(channel==='whatsapp')f.data.tenant_platform_apps![0]!.id='other';else f.data.social_accounts![0]!.id='other';}
 if(drift==='native'){if(channel==='whatsapp')f.data.tenant_platform_apps![0]!.phone_number_id='other';else f.data.social_accounts![0]!.providerAccountId='other';}
 if(drift==='run')f.data.social_weekly_customer_bindings![0]!.run_id='other';
 if(drift==='customer'){if(channel==='whatsapp')f.t.inputSnapshot.customerId='other';else (f.data.social_weekly_customer_channel_selections![0]!.payload as Record<string,unknown>).customerId='other';}
 if(drift==='version'){f.t.packageVersion=2;f.data.social_weekly_operating_packages!.push({id:'new-week',tenant_id:'tenant',program_id:'program',package_id:'week',version:2,payload:{programId:'program',packageId:'week',version:2,status:'active'}});}
 if(drift==='deadline')f.t.schedule.estimatedStartAt='2026-10-14T12:00:00Z';
 if(drift==='oauth_provider'){if(channel==='whatsapp')f.data.tenant_platform_apps![0]!.waba_id='other-waba';else f.data.social_accounts![0]!.oauthProvider='legacy_login';}
 if(drift==='expired'){if(channel==='whatsapp')f.ports.readWhatsApp=async()=>{throw Error('whatsapp_token_expired');};else f.data.social_accounts![0]!.expiresAt='2026-10-05T00:00:00Z';}
 if(drift==='no_data'){f.data.customer_segment_members=[];f.data.customer_segments![0]!.member_count=0;}
 const report=await runWeeklyCustomerChannelAuthorizationExceptionScan({store:f.store,now,ports:f.ports});assert.equal(report.resolved,0,`${channel}/${drift}`);assert.equal((f.data[CUSTOMER_CHANNEL_AUTHORIZATION_EXCEPTIONS]![0]!.payload as {status:string}).status,'missing');assert.equal(f.sends(),0);
 }finally{f.restore();globalThis.fetch=originalFetch;}
 }
 });
}

test('multiple channel consumers keep unique exceptions; resolution-before-task persistence failure recovers without sending',async()=>{
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('external_fetch_forbidden');};const f=await fixture('messenger');
 try{
 const second=structuredClone(f.t);second.taskId='readiness-second';second.idempotencyKey='second';f.data.social_weekly_execution_tasks!.push({id:second.taskId,tenant_id:'tenant',program_id:'program',package_id:'week',package_version:1,task_id:second.taskId,status:'blocked',payload:second});
 await materializeWeeklyCustomerChannelAuthorizationException({store:f.store,task:f.t,gapCode:f.t.lastError!.code,now});await materializeWeeklyCustomerChannelAuthorizationException({store:f.store,task:second,gapCode:second.lastError!.code,now});assert.equal(f.data[CUSTOMER_CHANNEL_AUTHORIZATION_EXCEPTIONS]!.length,2);f.allow();
 const update=f.store.update.bind(f.store);let fail=true;f.store.update=async(collection,id,patch)=>{if(collection==='social_weekly_execution_tasks'&&id===f.t.taskId&&fail){fail=false;return false;}return update(collection,id,patch);};
 const first=await runWeeklyCustomerChannelAuthorizationExceptionScan({store:f.store,now,ports:f.ports});assert.equal(first.failed,1);assert.equal(first.resolved,1);assert.equal(f.data[CUSTOMER_CHANNEL_AUTHORIZATION_EXCEPTIONS]!.length,4);
 const retry=await runWeeklyCustomerChannelAuthorizationExceptionScan({store:f.store,now,ports:f.ports});assert.equal(retry.resolved,1);assert.equal((f.data.social_weekly_execution_tasks![0]!.payload as WeeklyExecutionTask).ownBlockingReasons.length,0);assert.equal((f.data.social_weekly_execution_tasks![1]!.payload as WeeklyExecutionTask).ownBlockingReasons.length,0);assert.equal(f.sends(),0);
 }finally{f.restore();globalThis.fetch=originalFetch;}
});

for(const channel of ['whatsapp','messenger','instagram']as const)test(`${channel} default official storage authorization ports restore consent without provider send`,async()=>{
 const originalFetch=globalThis.fetch,worker=process.env.FOLLOWUP_WORKER_ENABLED;globalThis.fetch=async()=>{throw Error('external_fetch_forbidden');};process.env.FOLLOWUP_WORKER_ENABLED='true';const f=await fixture(channel);
 try{
 f.data.digital_employee_configs=[{id:'config',tenant_id:'tenant',status:'active',config_version:1,config:{enabledWorkflows:['batch_followup'],allowRealCustomerMessages:false}}];
 if(channel==='whatsapp')Object.assign(f.data.tenant_platform_apps![0]!,{app_id:'app',waba_id:'waba',status:'active',app_secret:encryptSecret('local-app-secret'),access_token:encryptSecret('local-token'),token_expires_at:'2099-01-01T00:00:00Z'});
 else Object.assign(f.data.social_accounts![0]!,{accessToken:encryptSecret('local-token'),expiresAt:'2099-01-01T00:00:00Z'});
 assert.equal((await runWeeklyCustomerChannelAuthorizationExceptionScan({store:f.store,now})).resolved,0);(f.data.digital_employee_configs[0]!.config as Record<string,unknown>).allowRealCustomerMessages=true;
 const result=await runWeeklyCustomerChannelAuthorizationExceptionScan({store:f.store,now});assert.equal(result.resolved,1,JSON.stringify(result));assert.equal(f.sends(),0);
 }finally{f.restore();globalThis.fetch=originalFetch;if(worker===undefined)delete process.env.FOLLOWUP_WORKER_ENABLED;else process.env.FOLLOWUP_WORKER_ENABLED=worker;}
});

for(const channel of ['messenger','instagram']as const)test(`${channel} readiness uses run selection when publication account differs and refuses deleted selection fallback`,async()=>{
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('external_fetch_forbidden');};const f=await fixture(channel);
 try{f.allow();f.t.accountId='separate-publication-account';assert.equal((await readWeeklyCustomerChannelReadiness(f.store,f.t,f.ports)).accountId,'account');f.data.social_accounts=[{...f.data.social_accounts![0]!,id:'replacement',providerAccountId:'replacement-native'}];await assert.rejects(readWeeklyCustomerChannelReadiness(f.store,f.t,f.ports),/selected_account_unavailable/);assert.equal(f.sends(),0);}finally{f.restore();globalThis.fetch=originalFetch;}
});
