import type {DataStore,Record_} from '../storage/datastore.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {readWeeklyReviewActor} from '../socialPrograms/weeklyReviewEvidence.js';
import {planTerminalDiscoverySourceRetry} from './retryPlan.js';
import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';
import {PACKAGES} from '../socialPrograms/weeklyOperatingPackageSupport.js';

export const COLLECTION_RETRY_GRANTS='social_discovery_retry_grants';
export interface CollectionRetryScope {tenantId:string;programId:string;packageId:string;packageVersion:number;taskId:string;parentRunId:string;parentRunHash:string;}
export interface CollectionRetryGrant extends CollectionRetryScope {grantId:string;count:number;businessDate:string;actorUserId:string;authorizedAt:string;source:'explicit_user_authorization';authorizationRef:string;authorizationText:string;recordHash:string;}
const seal=(g:CollectionRetryGrant)=>({...g,recordHash:socialRequestHash({...g,recordHash:''})});
export async function validateCollectionRetryGrant(store:DataStore,scope:CollectionRetryScope){
 const id=socialRequestHash(scope),row=await store.getById<Record_>(COLLECTION_RETRY_GRANTS,id);
 if(!row)return null;
 const g=row.payload as CollectionRetryGrant;
 if(!g||g.grantId!==id||g.recordHash!==seal(g).recordHash||row.record_hash!==g.recordHash||row.tenant_id!==scope.tenantId||Object.entries(scope).some(([k,v])=>g[k as keyof CollectionRetryScope]!==v)||g.source!=='explicit_user_authorization'||!Number.isSafeInteger(g.count)||g.count<1||g.count>10||!g.authorizationRef||!g.authorizationText)throw Error('collection_retry_grant_invalid');
 return g;
}
/** Internal configuration adoption, not a task-start or status mutation API.
 * Must only be invoked with an actual human authorization; never by a scan. */
export async function recordCollectionRetryGrant(store:DataStore,input:Omit<CollectionRetryGrant,'grantId'|'recordHash'|'source'>){
 const scope:CollectionRetryScope={tenantId:input.tenantId,programId:input.programId,packageId:input.packageId,packageVersion:input.packageVersion,taskId:input.taskId,parentRunId:input.parentRunId,parentRunHash:input.parentRunHash};
 if(!Number.isSafeInteger(input.count)||input.count<1||input.count>10||!/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate)||!Number.isFinite(Date.parse(input.authorizedAt))||!input.authorizationRef||!input.authorizationText)throw Error('collection_retry_authorization_invalid');
 const actor=await readWeeklyReviewActor(store,input.tenantId,input.actorUserId);
 if(!actor||actor.tenantId!==input.tenantId||actor.disabled===true||actor.active===false||['disabled','suspended'].includes(String(actor.status))||!['admin','super_admin','social_operator'].includes(String(actor.role)))throw Error('collection_retry_actor_forbidden');
 const packages=await store.list<Record_>(PACKAGES,{where:{tenant_id:input.tenantId,program_id:input.programId,package_id:input.packageId},sort:'-version',perPage:1}),pkg=packages.items[0]?.payload as any;
 if(!pkg||pkg.version!==input.packageVersion||!['draft','active'].includes(pkg.status))throw Error('collection_retry_package_stale');
 const roots=await store.list<Record_>('social_weekly_preproduction_jobs',{where:{tenant_id:input.tenantId,program_id:input.programId,package_id:input.packageId,package_version:input.packageVersion,task_id:input.taskId},perPage:2});
 const root=roots.items[0]?.payload as any;
 if(roots.totalItems!==1||root?.kind!=='discovery'||root.status!=='blocked')throw Error('collection_retry_root_unavailable');
 if(input.parentRunId!==`weekly_discovery_${socialRequestHash({tenantId:input.tenantId,key:root.originalRunKey})}`)throw Error('collection_retry_parent_scope_changed');
 const rows=await store.list<SocialInspirationCollectionRun & Record_>('social_discovery_runs',{where:{tenant_id:input.tenantId,runId:input.parentRunId},perPage:2});
 const parent=rows.items[0];
 if(rows.totalItems!==1||!parent||socialRequestHash(parent)!==input.parentRunHash||planTerminalDiscoverySourceRetry(parent).blockingCodes.length)throw Error('collection_retry_parent_unverified');
 const prior=await validateCollectionRetryGrant(store,scope);
 if(prior){if(prior.count!==input.count||prior.authorizationRef!==input.authorizationRef||prior.businessDate!==input.businessDate)throw Error('collection_retry_grant_conflict');return prior;}
 const grant=seal({...input,...scope,grantId:socialRequestHash(scope),source:'explicit_user_authorization',recordHash:''});
 if(!await store.create(COLLECTION_RETRY_GRANTS,{id:grant.grantId,tenant_id:input.tenantId,record_hash:grant.recordHash,payload:grant})){
  const recovered=await validateCollectionRetryGrant(store,scope);if(!recovered||recovered.recordHash!==grant.recordHash)throw Error('collection_retry_grant_write_unknown');return recovered;
 }
 return grant;
}
