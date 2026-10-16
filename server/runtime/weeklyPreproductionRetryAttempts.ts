import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyPreproductionJob} from './weeklyPreproductionProducer.js';
import type {SocialDiscoveryMode,SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {planTerminalDiscoverySourceRetry} from '../socialDiscovery/retryPlan.js';
import {readCollectionRetryGrant,collectionBusinessDate} from '../socialDiscovery/dailyCollectionQuota.js';

export const PREPRODUCTION_RETRY_ATTEMPTS='social_weekly_preproduction_retry_attempts';
export interface RetryGrantScope {grantId:string;programId:string;packageId:string;packageVersion:number;taskId:string;parentRunId:string;parentRunHash:string;}
export interface WeeklyPreproductionRetryAttempt extends WeeklyPreproductionJob {
 retry:{rootJobId:string;rootJobHash:string;parentRunId:string;parentRunHash:string;sourceSelection:Array<{mode:SocialDiscoveryMode;platform:string;queryRef:string}>;grant:RetryGrantScope};
}
const seal=(value:WeeklyPreproductionRetryAttempt)=>({...value,recordHash:socialRequestHash({...value,recordHash:''})});
async function parentRun(store:DataStore,root:WeeklyPreproductionJob){
 const runId=`weekly_discovery_${socialRequestHash({tenantId:root.tenantId,key:root.originalRunKey})}`;
 const rows=await store.list<SocialInspirationCollectionRun & Record_>('social_discovery_runs',{where:{tenant_id:root.tenantId,runId},perPage:2});
 if(rows.totalItems!==1||rows.items.length!==1)return null;
 return rows.items[0]!;
}
type GrantReader=typeof readCollectionRetryGrant;
export async function readWeeklyPreproductionRetryAttempt(store:DataStore,root:WeeklyPreproductionJob,readGrant:GrantReader=readCollectionRetryGrant):Promise<WeeklyPreproductionRetryAttempt|null>{
 const rows=await store.list<Record_>(PREPRODUCTION_RETRY_ATTEMPTS,{where:{tenant_id:root.tenantId,program_id:root.programId,package_id:root.packageId,package_version:root.packageVersion,root_job_id:root.jobId},perPage:2});
 if(!rows.totalItems)return null;
 if(rows.totalItems!==1||rows.items.length!==1)throw Error('weekly_preproduction_retry_ambiguous');
 const row=rows.items[0]!,a=row.payload as WeeklyPreproductionRetryAttempt,parent=await parentRun(store,root);
 if(!a?.retry||!parent||a.recordHash!==seal(a).recordHash||row.record_hash!==a.recordHash||row.id!==a.jobId||a.tenantId!==root.tenantId||a.programId!==root.programId||a.packageId!==root.packageId||a.packageVersion!==root.packageVersion||a.consumerTaskId!==root.consumerTaskId||a.consumerInputHash!==root.consumerInputHash||a.sourceHash!==root.sourceHash||a.retry.rootJobId!==root.jobId||a.retry.rootJobHash!==root.recordHash||a.retry.parentRunId!==parent.runId||a.retry.parentRunHash!==socialRequestHash(parent)||a.originalRunKey!==`${root.originalRunKey}:retry:${a.jobId}`)throw Error('weekly_preproduction_retry_lineage_changed');
 const plan=planTerminalDiscoverySourceRetry(parent);
 if(row.tenant_id!==a.tenantId||row.program_id!==a.programId||row.package_id!==a.packageId||row.package_version!==a.packageVersion||row.task_id!==a.consumerTaskId||row.input_hash!==a.consumerInputHash||row.original_run_key!==a.originalRunKey||row.kind!==a.kind||row.status!==a.status||row.root_job_id!==root.jobId)throw Error('weekly_preproduction_retry_row_corrupt');
 if(a.dueAt!==root.dueAt||a.actorUserId!==root.actorUserId||a.kind!=='discovery'||socialRequestHash(a.authority)!==socialRequestHash(root.authority)||a.retry.grant.programId!==root.programId||a.retry.grant.packageId!==root.packageId||a.retry.grant.packageVersion!==root.packageVersion||a.retry.grant.taskId!==root.consumerTaskId||a.retry.grant.parentRunId!==parent.runId||a.retry.grant.parentRunHash!==socialRequestHash(parent))throw Error('weekly_preproduction_retry_scope_changed');
 if(plan.blockingCodes.length||!a.retry.sourceSelection.length||a.retry.sourceSelection.some(source=>!plan.eligibleSources.some(s=>socialRequestHash(s)===socialRequestHash(source))))throw Error('weekly_preproduction_retry_source_not_rejected');
 const grant=await readGrant(store,{tenantId:root.tenantId,programId:root.programId,packageId:root.packageId,packageVersion:root.packageVersion,taskId:root.consumerTaskId,parentRunId:parent.runId,parentRunHash:a.retry.parentRunHash});
 if(!grant||grant.grantId!==a.retry.grant.grantId)throw Error('weekly_preproduction_retry_grant_changed');
 return a;
}

/** Called only under the current package gate. Original run/job are untouched. */
export async function ensureWeeklyPreproductionRetryAttempt(store:DataStore,root:WeeklyPreproductionJob,now:string,readGrant:GrantReader=readCollectionRetryGrant){
 const prior=await readWeeklyPreproductionRetryAttempt(store,root,readGrant);if(prior)return prior;
 if(root.kind!=='discovery'||root.status!=='blocked')return null;
 const parent=await parentRun(store,root);if(!parent)return null;
 const plan=planTerminalDiscoverySourceRetry(parent);if(plan.blockingCodes.length||!plan.eligibleSources.length)return null;
 const grant=await readGrant(store,{tenantId:root.tenantId,programId:root.programId,packageId:root.packageId,packageVersion:root.packageVersion,taskId:root.consumerTaskId,parentRunId:parent.runId,parentRunHash:plan.parentRunHash});
 if(!grant||grant.remainingCount<1||grant.businessDate!==collectionBusinessDate(new Date(now)))return null;
 const grantScope:RetryGrantScope={grantId:grant.grantId,programId:root.programId,packageId:root.packageId,packageVersion:root.packageVersion,taskId:root.consumerTaskId,parentRunId:parent.runId,parentRunHash:plan.parentRunHash};
 const id=socialRequestHash({rootJobId:root.jobId,rootJobHash:root.recordHash,parentRunId:parent.runId,parentRunHash:plan.parentRunHash,grantId:grant.grantId}).slice(0,15);
 const attempt=seal({...root,jobId:id,originalRunKey:`${root.originalRunKey}:retry:${id}`,status:'bound',code:null,resultRefs:[],boundAt:now,updatedAt:now,recordHash:'',retry:{rootJobId:root.jobId,rootJobHash:root.recordHash,parentRunId:parent.runId,parentRunHash:plan.parentRunHash,sourceSelection:plan.eligibleSources,grant:grantScope}} as WeeklyPreproductionRetryAttempt);
 if(!await store.create(PREPRODUCTION_RETRY_ATTEMPTS,{id,tenant_id:root.tenantId,program_id:root.programId,package_id:root.packageId,package_version:root.packageVersion,task_id:root.consumerTaskId,input_hash:root.consumerInputHash,kind:'discovery',status:attempt.status,original_run_key:attempt.originalRunKey,root_job_id:root.jobId,record_hash:attempt.recordHash,payload:attempt}))throw Error('weekly_preproduction_retry_create_unknown');
 return attempt;
}
