import {initialMaterialPlanHash} from './socialContentInitialMaterialPlanIdentity.js';
import {createHash} from 'node:crypto';
import type {DataStore} from '../storage/datastore.js';
import type {ScriptGapTask} from '../../shared/shootingWorkflow.js';
import type {SocialAssetSupplyPlan,SocialDirectorBrief} from '../../shared/contracts/socialContentWorkflow.js';
import {socialObject,socialRequestHash} from './socialContentValidation.js';
import {validateHeyGenPresenterRecord,type TrustedPresenterRecord} from '../lib/presenterAssetTrust.js';

export type InitialShootTask = ScriptGapTask & {sourceContentTaskId:string;sourceContentRunId:string;
  sourceContentTaskVersion:string;sourceContentShotId:string;sourceContentPlanHash:string};
type Row={id:string;tenant_id:string;payload:InitialShootTask};
const idFor=(tenantId:string,taskId:string,runId:string,shotId:string)=>`content-shoot-${createHash('sha256')
  .update(`${tenantId}:${taskId}:${runId}:${shotId}`).digest('hex').slice(0,24)}`;

function exact(task:InitialShootTask,input:{taskId:string;runId:string;taskVersion:string;shotId:string;planHash:string}){
 return task.sourceContentTaskId===input.taskId&&task.sourceContentRunId===input.runId
  &&task.sourceContentTaskVersion===input.taskVersion&&task.sourceContentShotId===input.shotId
  &&task.sourceContentPlanHash===input.planHash;
}

async function tenantShootTasks(store:DataStore,tenantId:string){
 const rows:Row[]=[];let page=1,totalPages=1;
 do{
  const listed=await store.list<Row>('studio_shooting_tasks',{where:{tenant_id:tenantId},page,perPage:200});
  rows.push(...listed.items);totalPages=listed.totalPages;page+=1;
 }while(page<=totalPages);
 return rows;
}

/** Creates one stable real-shoot request for each blocked talking-head slot.
 * Uploading footage satisfies the shoot task only; it does not authorize a
 * presenter and therefore cannot resume production by itself. */
export async function ensureInitialShootTasks(input:{store:DataStore;tenantId:string;taskId:string;runId:string;
 taskVersion:string;plan:SocialAssetSupplyPlan;scenes?:SocialDirectorBrief['scenes']}):Promise<Record<string,string>>{
 const planHash=initialMaterialPlanHash(input.plan),result:Record<string,string>={},listed=await tenantShootTasks(input.store,input.tenantId);
 for(const shot of input.plan.shots){
  if(shot.materialRouting?.pendingReason!=='awaiting_shoot')continue;
  if(shot.materialRouting.materialType!=='talking_head')throw Error('initial_shoot_task_route_invalid');
  const stableId=idFor(input.tenantId,input.taskId,input.runId,shot.shotId);
  const scene=input.scenes?.find(row=>row.sceneId===shot.shotId),duration=scene?scene.duration.endSeconds-scene.duration.startSeconds:3;
  const identity={taskId:input.taskId,runId:input.runId,taskVersion:input.taskVersion,shotId:shot.shotId,planHash};
  const payload:InitialShootTask={id:'',origin:'script_gap',title:`真人口播待拍 · ${shot.shotId}`.slice(0,200),
   productLabel:'',themeTitle:'真人口播',shotBrief:String(shot.requestedDescription||'拍摄真人口播素材').slice(0,10000),
   suggestedDurationSec:Number.isFinite(duration)&&duration>0?duration:3,ratio:undefined,soundMode:'source',
   expectedNarration:String(scene?.audioLayers?.voiceover||''),createdAt:new Date().toISOString(),uploadedMaterialIds:[],
   sourceContentTaskId:input.taskId,sourceContentRunId:input.runId,sourceContentTaskVersion:input.taskVersion,
   sourceContentShotId:shot.shotId,sourceContentPlanHash:planHash};
  const matches=listed.filter(row=>row.tenant_id===input.tenantId
   &&row.payload.sourceContentTaskId===input.taskId&&row.payload.sourceContentRunId===input.runId
   &&row.payload.sourceContentShotId===shot.shotId);
  if(matches.length>1)throw Error('initial_shoot_task_identity_changed');
  const existing=matches[0];
  if(existing){
   const originalVersion=existing.payload.sourceContentTaskVersion;
   if(!originalVersion||!exact(existing.payload,{...identity,taskVersion:originalVersion})
    ||existing.payload.expectedNarration!==payload.expectedNarration
    ||existing.payload.suggestedDurationSec!==payload.suggestedDurationSec||existing.payload.shotBrief!==payload.shotBrief)
    throw Error('initial_shoot_task_identity_changed');
   result[shot.shotId]=existing.id;
  }
  else {const created=await input.store.create<Row>('studio_shooting_tasks',{id:stableId,tenant_id:input.tenantId,payload});
   if(!created||created.tenant_id!==input.tenantId||!exact(created.payload,identity))throw Error('initial_shoot_task_create_failed');
   listed.push(created);result[shot.shotId]=created.id;}
 }
 return result;
}

export async function validateInitialShootPresenter(input:{store:DataStore;tenantId:string;taskId:string;runId:string;
 taskVersion:string;shotId:string;planHash:string;shootingTaskId:string;presenterAssetId:string}){
 const task=await input.store.getById<Row>('studio_shooting_tasks',input.shootingTaskId);
 if(!task||task.tenant_id!==input.tenantId||!exact(task.payload,input)||!Array.isArray(task.payload.uploadedMaterialIds)
  ||!task.payload.uploadedMaterialIds.length)throw Error('initial_shoot_task_incomplete');
 const rows=await input.store.list<{id:string;tenant_id:string;payload:{presenters?:unknown}}>('studio_production_defaults',
  {where:{tenant_id:input.tenantId},perPage:2});
 if(rows.totalItems!==1||rows.items.length!==1||rows.items[0]!.tenant_id!==input.tenantId)throw Error('initial_shoot_presenter_registry_invalid');
 const presenters=Array.isArray(rows.items[0]!.payload.presenters)?rows.items[0]!.payload.presenters.map(socialObject):[];
 const matches=presenters.filter(row=>row&&String(row.id||'')===input.presenterAssetId);
 if(matches.length!==1)throw Error('initial_shoot_presenter_missing');
 const presenter=matches[0] as TrustedPresenterRecord&Record<string,unknown>,trusted=validateHeyGenPresenterRecord(presenter);
 if(!trusted.ok)throw Error(`initial_shoot_presenter_not_authorized:${trusted.reasons.join(',')}`);
 const refs=Array.isArray(presenter.referenceMaterialIds)?presenter.referenceMaterialIds.map(String):[];
 if(!task.payload.uploadedMaterialIds.some(id=>refs.includes(id)))throw Error('initial_shoot_presenter_not_bound_to_capture');
 return {presenterAssetId:trusted.presenterAssetId,presenterAssetVersion:trusted.assetVersion,shootingTaskId:task.id,
  shootingTaskVersion:task.payload.sourceContentTaskVersion,
  presenterBindingHash:socialRequestHash({presenterAssetId:trusted.presenterAssetId,assetVersion:trusted.assetVersion,
   avatarId:trusted.avatarId,voiceId:trusted.voiceId,rights:trusted.rights,uploadedMaterialIds:task.payload.uploadedMaterialIds})};
}

/** Preserve each shoot's original creation stamp when lifecycle projections
 * increment the content task version and the pending checkpoint is refreshed. */
export async function readInitialShootTaskVersions(store:DataStore,tenantId:string,ids:Record<string,string>){
 const entries=await Promise.all(Object.entries(ids).map(async([shotId,id])=>{
  const row=await store.getById<Row>('studio_shooting_tasks',id);
  if(!row||row.tenant_id!==tenantId||row.payload.sourceContentShotId!==shotId||!row.payload.sourceContentTaskVersion)
   throw Error('initial_shoot_task_identity_changed');
  return [shotId,row.payload.sourceContentTaskVersion] as const;
 }));
 return Object.fromEntries(entries);
}
