import {observeWeeklyQueueResources,type WeeklyObservedQueueResource} from './weeklyObservedQueueResources.js';
import {createHash} from 'node:crypto';
import type {DataStore,Record_} from '../storage/datastore.js';
import {getWeeklyExecutionTaskRow} from './executionTasks.js';
import {withExecutionPackageGate} from './weeklyExecutionGate.js';
import {readContentExecutionJob,listContentExecutionLimits,type ContentExecutionLimit} from '../contentExecution/durableQueue.js';
import {DURABLE_OPERATION_LEASE_COLLECTION} from '../runtime/durableLease.js';
import {parseUsageLedgerRecord} from '../starter198/usage.js';
import {socialJson,socialObject} from '../starter198/socialContentValidation.js';
import {SocialProgramError} from './service.js';
import type {StarterRecord} from '../starter198/repository.js';
const fail=(code:string):never=>{throw new SocialProgramError(code,409,'运行资源证据不完整或身份不一致，未据此承诺排期。');};
export interface WeeklyRunningResourceScope {tenantId:string;programId:string;packageId:string;packageVersion:number;taskId:string}
export interface WeeklyRunningResourceEvidence {
 scope:WeeklyRunningResourceScope;verifiedAt:string;contentTaskId:string;runId:string;
 job:{id:string;status:string;accountId:string;taskType:string;lastStartedAt:string|null};
 lease:{status:'live'|'expired'|'missing'|'inconsistent';tokenHash:string|null;expiresAt:string|null};
 configuredQueueLimits:ContentExecutionLimit[];
 observedResources:WeeklyObservedQueueResource[];
 providerReceipts:Array<{provider:string;requestId:string;providerTaskId:string|null;state:string;updatedAt:string}>;
 operationCosts:Array<{recordId:string;reservationId:string;eventType:'reserve'|'terminal';state:string;costStatus:'known'|'unknown';reservedCostDeltaCny:number|null;settledCostCny:number|null;occurredAt:string}>;
 resourceKey:null;expectedFinishAt:null;remainingCostCny:null;reservationEligible:false;
 gaps:string[];
}
async function fullRows(store:DataStore,collection:string,where:Record<string,string>):Promise<Record_[]>{const rows:Record_[]=[];let expected:number|undefined;for(let page=1;;page++){const result=await store.list<Record_>(collection,{where,page,perPage:100,sort:'id'});if(!Number.isSafeInteger(result.totalPages)||result.totalPages<0||!Number.isSafeInteger(result.totalItems)||result.totalItems<0||result.page!==page||(expected!==undefined&&expected!==result.totalItems))return fail('weekly_resource_evidence_pagination_invalid');if(result.totalPages===0){if(page!==1||result.totalItems!==0||result.items.length)return fail('weekly_resource_evidence_pagination_invalid');return [];}expected=result.totalItems;rows.push(...result.items);if(page===result.totalPages){if(rows.length!==expected||new Set(rows.map(r=>r.id)).size!==rows.length)return fail('weekly_resource_evidence_pagination_incomplete');return rows;}if(!result.items.length||page>10000)return fail('weekly_resource_evidence_pagination_incomplete');}}
/** Read-only diagnostics. Queue limits and initiated-operation costs are not a full remaining-work reservation. */
export function createWeeklyRunningResourceEvidenceService(store:DataStore,ports:{now?:()=>Date}={}){
 return {async read(scope:WeeklyRunningResourceScope):Promise<WeeklyRunningResourceEvidence>{return withExecutionPackageGate(store,scope,async assert=>{
 const task=(await getWeeklyExecutionTaskRow(store,scope.tenantId,scope.taskId)).payload;
 if(task.programId!==scope.programId||task.packageId!==scope.packageId||task.packageVersion!==scope.packageVersion||!task.publicationTaskId||task.workflowKind!=='content')return fail('weekly_resource_evidence_task_scope');
 const packages=await store.list<Record_>('social_weekly_operating_packages',{where:{tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,version:scope.packageVersion},perPage:2});if(packages.totalItems!==1||packages.items.length!==1)return fail('weekly_resource_evidence_package_missing');const actualPackage=socialObject(socialJson(packages.items[0]!.payload));if(actualPackage?.programId!==scope.programId||actualPackage.packageId!==scope.packageId||actualPackage.version!==scope.packageVersion)return fail('weekly_resource_evidence_package_scope');
 const key=`weekly-production:${scope.packageId}:${scope.packageVersion}:${task.publicationTaskId}`;
 const rows=await store.list<Record_>('starter_social_content_tasks',{where:{tenant_id:scope.tenantId,create_idempotency_key:key},perPage:2});if(rows.items.length!==1||rows.totalItems!==1)return fail('weekly_resource_evidence_content_binding');
 const content=rows.items[0]!,contentTaskId=String(content.task_id||''),runId=String(content.run_id||'');const brief=socialObject(socialJson(content.brief)),authority=socialObject(brief?._weeklyAuthority),pkg=socialObject(authority?.weeklyPackage);
 if(!contentTaskId||!runId||pkg?.programId!==scope.programId||pkg.packageId!==scope.packageId||pkg.version!==scope.packageVersion)return fail('weekly_resource_evidence_content_authority');
 const run=await store.getById<Record_>('workflow_runs',runId);if(!run||run.tenant_id!==scope.tenantId)return fail('weekly_resource_evidence_run_scope');
 const job=await readContentExecutionJob(store,scope.tenantId,contentTaskId,runId);if(!job)return fail('weekly_resource_evidence_job_missing');
 const actualPublication=socialObject(actualPackage.socialContentPackage)?.publicationTasks;if(!Array.isArray(actualPublication)||actualPublication.filter(p=>socialObject(p)?.publicationTaskId===task.publicationTaskId&&socialObject(p)?.accountId===job.accountId).length!==1)return fail('weekly_resource_evidence_account_scope');
 const leases=await store.list<Record_>(DURABLE_OPERATION_LEASE_COLLECTION,{where:{tenant_id:scope.tenantId,lease_scope:'content_execution_job',subject_id:job.id},perPage:2});if(leases.totalItems!==leases.items.length||leases.totalItems>1)return fail('weekly_resource_evidence_lease_duplicate');
 const now=ports.now?.()??new Date();if(!Number.isFinite(now.getTime()))return fail('weekly_resource_evidence_now');
 const lease=leases.items[0],expiry=lease&&typeof lease.expires_at==='string'?lease.expires_at:null;
 const consistent=!!lease&&typeof lease.lease_token==='string'&&!!lease.lease_token&&lease.owner_id===job.workerId&&!!expiry&&!!job.leaseExpiresAt&&Date.parse(expiry)===Date.parse(job.leaseExpiresAt)&&Number.isFinite(Date.parse(expiry!))&&job.status==='running';
 const leaseStatus=!lease?'missing':!consistent?'inconsistent':Date.parse(expiry!)<=now.getTime()?'expired':'live';
 const ledger=await fullRows(store,'starter_usage_ledger',{tenant_id:scope.tenantId,run_id:runId,task_id:contentTaskId});const operationCosts:WeeklyRunningResourceEvidence['operationCosts']=[];const identities=new Set<string>();
 for(const row of ledger){const entry=parseUsageLedgerRecord(row as StarterRecord,scope.tenantId),reservationId=String(row.reservation_id||''),event=String(row.event_type),state=String(row.state);if(!entry||entry.runId!==runId||entry.taskId!==contentTaskId||!reservationId||!['reserve','terminal'].includes(event)||!['reserved','settled','failed'].includes(state)||(event==='reserve')!==(state==='reserved')||identities.has(`${reservationId}:${event}`))return fail('weekly_resource_evidence_cost_invalid');identities.add(`${reservationId}:${event}`);operationCosts.push({recordId:row.id,reservationId,eventType:event as 'reserve'|'terminal',state,costStatus:entry.costStatus,reservedCostDeltaCny:entry.reservedCostDeltaCny,settledCostCny:entry.settledCostCny,occurredAt:entry.occurredAt});}
 for(const cost of operationCosts)if(cost.eventType==='terminal'&&!identities.has(`${cost.reservationId}:reserve`))return fail('weekly_resource_evidence_cost_reservation_missing');
 const configuredQueueLimits=(await listContentExecutionLimits(store,scope.tenantId)).filter(l=>l.scopeKey==='*'||(l.scope==='account'&&l.scopeKey===job.accountId)||(l.scope==='task_type'&&l.scopeKey===job.taskType));if(new Set(configuredQueueLimits.map(l=>`${l.scope}:${l.scopeKey}`)).size!==configuredQueueLimits.length)return fail('weekly_resource_evidence_limits_duplicate');
 const observation=await observeWeeklyQueueResources(store,job,configuredQueueLimits,now);
 const gaps=['planner_resource_vector_integration_missing','provider_finish_receipt_missing','remaining_operation_manifest_missing','remaining_cost_unknown'];for(const scope of observation.missingScopes)gaps.push(`persisted_${scope}_queue_limit_missing`);if(observation.resources.some(r=>r.observation.unverifiedOccupancyCount>0))gaps.push('queue_resource_occupancy_unverified');if(leaseStatus!=='live')gaps.push(`production_lease_${leaseStatus}`);if(!job.lastStartedAt)gaps.push('actual_start_missing');if(!configuredQueueLimits.length)gaps.push('persisted_queue_limits_missing');if(!ledger.length)gaps.push('operation_cost_receipts_missing');if(operationCosts.some(x=>x.costStatus==='unknown'))gaps.push('initiated_operation_cost_unknown');await assert();
 return {scope:{...scope},verifiedAt:now.toISOString(),contentTaskId,runId,job:{id:job.id,status:job.status,accountId:job.accountId,taskType:job.taskType,lastStartedAt:job.lastStartedAt},lease:{status:leaseStatus,tokenHash:consistent?createHash('sha256').update(String(lease!.lease_token)).digest('hex'):null,expiresAt:expiry},configuredQueueLimits,observedResources:observation.resources,providerReceipts:job.providerReceipts.map(r=>({provider:r.provider,requestId:r.requestId,providerTaskId:r.providerTaskId,state:r.state,updatedAt:r.updatedAt})),operationCosts,resourceKey:null,expectedFinishAt:null,remainingCostCny:null,reservationEligible:false,gaps};
 });}};
}
