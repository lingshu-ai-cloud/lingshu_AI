import {recheckWeeklyMaterialPreparation} from '../runtime/weeklyMaterialPreparationRecovery.js';
import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyOwnedProductIdentityScope} from '../../shared/contracts/weeklyOwnedProductIdentity.js';
import type {WeeklyOwnedProductIdentityRead} from '../../shared/contracts/weeklyOwnedProductIdentityUI.js';
import {assessWeeklyOwnedProductIdentity,bindWeeklyOwnedProductIdentity,type WeeklyOwnedProductIdentityPorts} from '../runtime/weeklyOwnedProductIdentityDemand.js';
import {readMaterialLibrary} from '../lib/materialLibrary.js';
import {getOwnedCloudMaterialRecord} from '../lib/cloudMaterials.js';
import {socialContentSourceOptions} from './socialContentSourceOptions.js';
import {requireSocialTask,readSocialTaskDetail} from './socialContentRecords.js';
import {organizationRoleOrNull} from '../lib/organizationRole.js';
import {SocialContentWorkflowError} from './socialContentValidation.js';
export function createWeeklyOwnedProductIdentityUI(store:DataStore,ports:WeeklyOwnedProductIdentityPorts){
 async function actor(scope:WeeklyOwnedProductIdentityScope,id:string){const user=await store.getById<Record_>('users',id);if(!user||user.tenantId!==scope.tenantId||!['super_admin','admin','social_operator'].includes(organizationRoleOrNull(user.role)??'')||user.disabled===true||user.active===false||['disabled','suspended'].includes(String(user.status)))throw new SocialContentWorkflowError('weekly_owned_product_identity_actor_invalid',403);}
 async function read(scope:WeeklyOwnedProductIdentityScope,actorUserId:string,expectedRunId:string|null):Promise<WeeklyOwnedProductIdentityRead>{
  await actor(scope,actorUserId);
  const task=await requireSocialTask({repository:ports.repository,tenantId:scope.tenantId,taskId:scope.contentTaskId});
  if((typeof task.run_id==='string'&&task.run_id?task.run_id:null)!==expectedRunId)throw new SocialContentWorkflowError('weekly_owned_product_identity_run_changed',409);
  const assessment=await assessWeeklyOwnedProductIdentity(store,scope,ports);
  const detail=await readSocialTaskDetail({repository:ports.repository,tenantId:scope.tenantId,taskId:scope.contentTaskId});
  if(!detail||Number(detail.version)!==assessment.contentTaskVersion)throw new SocialContentWorkflowError('weekly_owned_product_identity_binding_changed',409);
  const result:WeeklyOwnedProductIdentityRead={assessment,expectedRunId,readOnly:Boolean(task.run_id)||!['draft','needs_input','plan_review'].includes(String(task.status)),candidates:[],candidateGaps:[]};
  const inventory=await (ports.repository.materialLibrary??readMaterialLibrary)(scope.tenantId);
  for(const requirement of assessment.requirements){for(const sha of requirement.imageHashes){
   const matches=inventory.items.filter(item=>requirement.imageIds.includes(item.id)&&item.type==='image'&&String(item.tenantId||item.tenant_id)===scope.tenantId&&item.scope!=='shared'&&item.contentSha256===sha);
   let count=0;
   for(const material of matches){const recordId=material.cloudRecordId;if(typeof recordId!=='string'||!/^[a-z0-9]{15}$/.test(recordId))continue;
    const raw=await (ports.getMaterial??getOwnedCloudMaterialRecord)(recordId,scope.tenantId);if(!raw||raw.id!==recordId||String(raw.tenantId||raw.tenant_id)!==scope.tenantId||raw.sha256!==sha)continue;
    const sourceRef=`socialmaterial:${Buffer.from(`pb-${recordId}`).toString('base64url')}`,source=await (ports.sourceOptions??socialContentSourceOptions).resolve({tenantId:scope.tenantId,kind:'material',sourceRef});
    if(!source||source.kind!=='material'||source.sourceRef!==sourceRef||!source.sourceVersion)continue;
    const url=typeof material.url==='string'&&((material.url.startsWith('/')&&!material.url.startsWith('//'))||/^https:\/\//.test(material.url))?material.url:null;
    result.candidates.push({requirementId:requirement.requirementId,recordId,sha256:sha,name:String(material.name||requirement.productRef),previewUrl:url,sourceRef:source.sourceRef,sourceVersion:source.sourceVersion,alreadyBound:detail.sources.some(s=>s.kind==='material'&&s.status==='active'&&s.sourceRef===sourceRef&&s.sourceVersion===source.sourceVersion)});count++;
   }
   if(!count)result.candidateGaps.push(`canonical_material_missing:${requirement.requirementId}:${sha}`);
  }}
  const fresh=await requireSocialTask({repository:ports.repository,tenantId:scope.tenantId,taskId:scope.contentTaskId});
  if((typeof fresh.run_id==='string'&&fresh.run_id?fresh.run_id:null)!==expectedRunId||Number(fresh.version)!==assessment.contentTaskVersion)throw new SocialContentWorkflowError('weekly_owned_product_identity_binding_changed',409);
  result.readOnly=Boolean(fresh.run_id)||!['draft','needs_input','plan_review'].includes(String(fresh.status));
  return result;
 }
 return {read,async recheckPreparation(scope:WeeklyOwnedProductIdentityScope,actorUserId:string,preparationTaskId:string){await actor(scope,actorUserId);const actual=await read(scope,actorUserId,null);if(actual.assessment.preparationTaskId!==preparationTaskId)throw new SocialContentWorkflowError('weekly_material_preparation_task_changed',409);return recheckWeeklyMaterialPreparation(store,{tenantId:scope.tenantId,programId:scope.programId,packageId:scope.packageId,packageVersion:scope.packageVersion,taskId:preparationTaskId,actorUserId},ports);},async bind(scope:WeeklyOwnedProductIdentityScope,actorUserId:string,input:Omit<Parameters<typeof bindWeeklyOwnedProductIdentity>[2],'actorUserId'>){await actor(scope,actorUserId);await bindWeeklyOwnedProductIdentity(store,scope,{...input,actorUserId},ports);return read(scope,actorUserId,null);}};
}
