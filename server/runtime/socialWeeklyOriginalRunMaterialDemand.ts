import type {DataStore,Record_} from '../storage/datastore.js';
import {createStarter198Repository} from '../starter198/repository.js';
import {readSocialTaskDetail} from '../starter198/socialContentRecords.js';
import {socialObject,socialJson,socialRequestHash} from '../starter198/socialContentValidation.js';
import {buildNoSharedMaterialDemand,type WeeklyMaterialDemandScope,type FrozenNoSharedMaterialDemand} from './socialWeeklyMaterialDemand.js';
export type OriginalRunMaterialDemandScope=WeeklyMaterialDemandScope&{tenantId:string};
const obj=(value:unknown)=>socialObject(socialJson(value));
function listHash(values:Array<{id:string;version?:string}>){return socialRequestHash(values.map(v=>({id:v.id,...(v.version?{version:v.version}:{})})).sort((a,b)=>a.id.localeCompare(b.id)));}
async function originalSource(store:DataStore,scope:OriginalRunMaterialDemandScope){
 async function one(collection:string,where:Record<string,string|number>){const found=await store.list<Record_>(collection,{where,perPage:2});return found.totalItems===1&&found.items.length===1&&found.items[0]&&Object.entries(where).every(([key,value])=>found.items[0]![key]===value)?found.items[0]:null;}
 const row=await one('starter_social_content_tasks',{tenant_id:scope.tenantId,task_id:scope.taskId});
 if(!row||typeof row.tenant_id!=='string'||!row.tenant_id||typeof row.run_id!=='string'||!row.run_id||row.create_idempotency_key!==`weekly-production:${scope.packageId}:${scope.packageVersion}:${scope.publicationTaskId}`)return null;
 const tenantId=row.tenant_id;
 const run=await store.getById<Record_>('workflow_runs',row.run_id),context=obj(run?.starter_context);
 if(!run||run.tenant_id!==tenantId||context?.schemaVersion!=='starter-social-content.auto-execution.v1'||context.socialTaskId!==scope.taskId||typeof context.socialTaskVersion!=='string'||!context.socialTaskVersion||!Array.isArray(context.sourceRefs)||!Array.isArray(context.packageSelection))return null;
 const authority=obj(obj(row.brief)?._weeklyAuthority),weekly=obj(authority?.weeklyPackage),publication=obj(authority?.publicationTask);
 if(!authority||weekly?.programId!==scope.programId||weekly.packageId!==scope.packageId||weekly.version!==scope.packageVersion||publication?.publicationTaskId!==scope.publicationTaskId||publication.accountId!==scope.accountId||socialRequestHash(publication.factRefs)!==socialRequestHash(scope.factRefs))return null;
 const pkg=await one('social_weekly_operating_packages',{tenant_id:tenantId,program_id:scope.programId,package_id:scope.packageId,version:scope.packageVersion}),payload=obj(pkg?.payload),pack=obj(payload?.socialContentPackage);
 if(!payload||!['draft','active'].includes(String(payload.status))||!Array.isArray(pack?.publicationTasks))return null;
 const pubs=pack.publicationTasks.map(obj).filter(p=>p?.publicationTaskId===scope.publicationTaskId);
 if(pubs.length!==1||pubs[0]?.accountId!==scope.accountId||socialRequestHash(pubs[0]?.factRefs)!==socialRequestHash(scope.factRefs)||pubs[0]?.materialRequirement)return null;
 const detail=await readSocialTaskDetail({repository:createStarter198Repository(store),tenantId,taskId:scope.taskId});
 if(!detail||detail.runId!==row.run_id||!detail.assetSupplyPlan)return null;
 const sources=detail.sources.filter(s=>s.status==='active');
 const refs=context.sourceRefs.map(obj);if(refs.some(r=>!r||typeof r.id!=='string'||(r.version!==undefined&&typeof r.version!=='string')))return null;
 if(listHash(sources.map(s=>({id:s.sourceId,...(s.sourceVersion?{version:s.sourceVersion}:{})})))!==listHash(refs.map(r=>({id:String(r!.id),...(r!.version?{version:String(r!.version)}:{})}))))return null;
 const packages=(values:unknown[])=>values.map(obj).map(p=>({kind:p?.kind,packageKey:p?.packageKey,version:p?.version})).sort((a,b)=>String(a.kind).localeCompare(String(b.kind)));
 if(socialRequestHash(packages(detail.packageSelection))!==socialRequestHash(packages(context.packageSelection)))return null;
 const {tenantId:scopedTenant,...demandScope}=scope;
 const demand=buildNoSharedMaterialDemand(row,detail,demandScope);if(!demand)return null;
 return {row,tenantId,demand,proof:{runId:row.run_id,runContextHash:socialRequestHash(context),sourceDigest:socialRequestHash(sources),authorityHash:socialRequestHash(authority),planHash:socialRequestHash(detail.assetSupplyPlan)}};
}
export async function readVerifiedNoSharedMaterialDemand(store:DataStore,row:Record<string,unknown>,scope:OriginalRunMaterialDemandScope):Promise<FrozenNoSharedMaterialDemand|null>{
 if(row.tenant_id!==scope.tenantId)return null;
 const stored=obj(row.brief)?._weeklyMaterialDemand as FrozenNoSharedMaterialDemand|undefined;
 if(!stored?.runProof)return (await import('./socialWeeklyMaterialDemand.js')).verifiedNoSharedMaterialDemand(row,scope);
 const {recordHash,...payload}=stored;if(recordHash!==socialRequestHash(payload))return null;
 const actual=await originalSource(store,scope);if(!actual||actual.row.id!==row.id||socialRequestHash(stored.runProof)!==socialRequestHash(actual.proof))return null;
 const {recordHash:ignored,...current}=actual.demand;
 return socialRequestHash({...current,runProof:actual.proof})===stored.recordHash?stored:null;
}
/** Reconcile only the existing owned run; never create/start a run or substitute a plan. */
export async function freezeOriginalRunMaterialDemand(store:DataStore,scope:OriginalRunMaterialDemandScope):Promise<FrozenNoSharedMaterialDemand|null>{
 const first=await originalSource(store,scope);if(!first)return null;
 const existing=obj(first.row.brief)?._weeklyMaterialDemand;
 if(existing)return readVerifiedNoSharedMaterialDemand(store,first.row,scope);
 const second=await originalSource(store,scope);if(!second||second.row.id!==first.row.id||socialRequestHash(second.proof)!==socialRequestHash(first.proof)||socialRequestHash(second.demand)!==socialRequestHash(first.demand))return null;
 const {recordHash:ignored,...base}=first.demand;const payload={...base,runProof:first.proof};const demand={...payload,recordHash:socialRequestHash(payload)};
 if(!await store.update('starter_social_content_tasks',first.row.id,{brief:{...obj(second.row.brief),_weeklyMaterialDemand:demand}}))return null;
 const fresh=await store.getById<Record_>('starter_social_content_tasks',first.row.id);
 return fresh?readVerifiedNoSharedMaterialDemand(store,fresh,scope):null;
}
