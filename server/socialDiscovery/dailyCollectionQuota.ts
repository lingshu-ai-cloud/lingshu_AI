import {createHash,randomUUID} from 'node:crypto';
import type {DataStore,Record_} from '../storage/datastore.js';
import {acquireDurableOperationLease,releaseDurableOperationLease} from '../runtime/durableLease.js';
import {WEEKLY_AUTOMATION_TEMPLATE} from '../../shared/weeklyAutomationTemplate.js';
import {validateCollectionRetryGrant,type CollectionRetryScope} from './collectionRetryGrant.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
export type CollectionRetryGrantRef=Omit<CollectionRetryScope,'tenantId'>&{grantId:string};
export const DAILY_COLLECTION_RESERVATIONS='social_discovery_daily_reservations';
export function collectionBusinessDate(now:Date){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
/** Reserve BEFORE calling a provider. Unknown/failed requests still consume
 * their reservation: retrying cannot silently exceed the day's hard ceiling. */
export async function readCollectionRetryGrant(store:DataStore,scope:CollectionRetryScope){
 const grant=await validateCollectionRetryGrant(store,scope);if(!grant)return null;
 let consumed=0;for(let page=1;;page++){const r=await store.list<Record_>(DAILY_COLLECTION_RESERVATIONS,{where:{tenant_id:scope.tenantId,retry_grant_id:grant.grantId},page,perPage:100});for(const row of r.items){if(!Number.isSafeInteger(row.count)||Number(row.count)<1)throw Error('daily_collection_ledger_invalid');consumed+=Number(row.count);}if(page>=r.totalPages)break;}
 if(consumed>grant.count)throw Error('collection_retry_grant_overdrawn');
 return {grantId:grant.grantId,remainingCount:grant.count-consumed,businessDate:grant.businessDate};
}
export async function reserveDailyCollection(store:DataStore,a:{tenantId:string;runId:string;requestKey:string;requested:number;now?:Date;retryGrant?:CollectionRetryGrantRef}):Promise<number>{
 const now=a.now??new Date(),day=collectionBusinessDate(now);
 if(!a.tenantId||!a.runId||!a.requestKey||!Number.isSafeInteger(a.requested)||a.requested<1)throw Error('daily_collection_reservation_invalid');
 const lease=await acquireDurableOperationLease({dataStore:store,tenantId:a.tenantId,scope:'social-discovery-daily-quota',subjectId:day,ownerId:randomUUID(),leaseDurationMs:30000});
 if(!lease)throw Error('daily_collection_quota_busy');
 try{
  const key=createHash('sha256').update(JSON.stringify([a.tenantId,day,a.runId,a.requestKey])).digest('hex');
  // A reused provider request is an unknown outcome, never a new allowance.
  if(await store.getById(DAILY_COLLECTION_RESERVATIONS,key))throw Error('daily_collection_request_already_reserved');
  if(a.retryGrant){
   const {grantId:requestedGrantId,...referenceScope}=a.retryGrant;
   const scope={...referenceScope,tenantId:a.tenantId},grant=await validateCollectionRetryGrant(store,scope);
   if(!grant||grant.grantId!==requestedGrantId||grant.businessDate!==day)throw Error('collection_retry_grant_scope_invalid');
   const attempts=await store.list<Record_>('social_weekly_preproduction_retry_attempts',{where:{tenant_id:a.tenantId,package_id:scope.packageId,package_version:scope.packageVersion,task_id:scope.taskId},perPage:2});
   const attempt=attempts.items[0]?.payload as any;
   if(attempts.totalItems!==1||!attempt?.retry||attempt.recordHash!==socialRequestHash({...attempt,recordHash:''})||attempts.items[0]?.record_hash!==attempt.recordHash||attempt.retry.grant.grantId!==grant.grantId||attempt.retry.parentRunHash!==scope.parentRunHash||a.runId!==`weekly_discovery_${socialRequestHash({tenantId:a.tenantId,key:attempt.originalRunKey})}`||!attempt.retry.sourceSelection.some((s:any)=>a.requestKey===`${s.mode}:${s.platform}:${s.queryRef}`))throw Error('collection_retry_attempt_unverified');
   const available=await readCollectionRetryGrant(store,scope),count=Math.min(a.requested,available?.remainingCount??0);
   if(!count)return 0;
   if(!await store.create(DAILY_COLLECTION_RESERVATIONS,{id:key,tenant_id:a.tenantId,day,run_id:a.runId,request_key:a.requestKey,count,retry_grant_id:grant.grantId,parent_run_id:scope.parentRunId,created_at:now.toISOString()}))throw Error('daily_collection_reservation_write_failed');
   return count;
  }
  const rows:Record_[]=[];for(let page=1;;page++){const r=await store.list<Record_>(DAILY_COLLECTION_RESERVATIONS,{where:{tenant_id:a.tenantId,day},page,perPage:100});rows.push(...r.items);if(page>=r.totalPages)break;}
  if(rows.some(r=>r.tenant_id!==a.tenantId||r.day!==day||!Number.isSafeInteger(r.count)||Number(r.count)<1))throw Error('daily_collection_ledger_invalid');
  const reservedRuns=new Set(rows.map(r=>r.run_id));let legacyRequested=0;
  for(let page=1;;page++){const r=await store.list<Record_>('social_discovery_runs',{where:{tenant_id:a.tenantId},page,perPage:100});for(const run of r.items){if(run.runId===a.runId||reservedRuns.has(run.runId)||typeof run.startedAt!=='string'||collectionBusinessDate(new Date(run.startedAt))!==day)continue;const stats=run.modeStats as Record<string,{requested?:number}>|undefined;legacyRequested+=Object.values(stats??{}).reduce((n,s)=>n+(Number.isSafeInteger(s.requested)&&s.requested!>0?s.requested!:0),0);}if(page>=r.totalPages)break;}
  const remaining=WEEKLY_AUTOMATION_TEMPLATE.dailyCollectionLimit-legacyRequested-rows.filter(r=>!r.retry_grant_id).reduce((n,r)=>n+Number(r.count),0),count=Math.min(a.requested,Math.max(0,remaining));
  if(!count)return 0;
  if(!await store.create(DAILY_COLLECTION_RESERVATIONS,{id:key,tenant_id:a.tenantId,day,run_id:a.runId,request_key:a.requestKey,count,created_at:now.toISOString()}))throw Error('daily_collection_reservation_write_failed');
  return count;
 }finally{await releaseDurableOperationLease({dataStore:store,lease});}
}
