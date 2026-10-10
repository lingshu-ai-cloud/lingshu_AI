import {withSocialContentSubjectLease,assertSocialContentSubjectLease} from '../starter198/socialContentMutation.js';
import {createStarter198Repository} from '../starter198/repository.js';
import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyOwnedProductIdentityPorts} from './weeklyOwnedProductIdentityDemand.js';
import {validateWeeklyMaterialPreparationEvidence} from './weeklyMaterialPreparationEvidence.js';
import {withExecutionPackageGate,executionPackageFrozen} from '../socialPrograms/weeklyExecutionGate.js';
import {getWeeklyExecutionTaskRow,createWeeklyExecutionTaskService} from '../socialPrograms/executionTasks.js';
import {organizationRoleOrNull} from '../lib/organizationRole.js';
import {socialRequestHash,SocialContentWorkflowError} from '../starter198/socialContentValidation.js';
export interface WeeklyMaterialPreparationRecoveryScope {tenantId:string;programId:string;packageId:string;packageVersion:number;taskId:string;actorUserId:string}
function fail(code:string):never {throw new SocialContentWorkflowError(code,409);}
const MATERIAL_REASONS=new Set(['weekly_owned_product_identity_verification_required','weekly_owned_product_identity_source_not_bound','weekly_owned_product_identity_binding_changed','weekly_required_materials_missing','weekly_material_contract_required','weekly_material_source_binding_missing']);
/** Explicitly rechecks the selected preparation task, without manufacturing work
 * for its predecessors or releasing any unrelated blocker. */
export async function recheckWeeklyMaterialPreparation(store:DataStore,scope:WeeklyMaterialPreparationRecoveryScope,ports?:WeeklyOwnedProductIdentityPorts){return withExecutionPackageGate(store,scope,async assert=>{
 if(await executionPackageFrozen(store,scope))fail('weekly_execution_package_frozen');
 const user=await store.getById<Record_>('users',scope.actorUserId);const role=organizationRoleOrNull(user?.role);if(!user||String(user.tenantId??user.tenant_id)!==scope.tenantId||user.disabled===true||user.active===false||['disabled','suspended'].includes(String(user.status))||!['super_admin','admin','social_operator'].includes(String(role)))fail('weekly_material_preparation_actor_forbidden');
 const row=await getWeeklyExecutionTaskRow(store,scope.tenantId,scope.taskId),task=row.payload;if(row.program_id!==scope.programId||row.package_id!==scope.packageId||row.package_version!==scope.packageVersion||task.programId!==scope.programId||task.packageId!==scope.packageId||task.packageVersion!==scope.packageVersion||task.schedule.stepKind!=='material_preparation'||task.status!=='blocked'||!task.ownBlockingReasons.some(r=>MATERIAL_REASONS.has(r)))fail('weekly_material_preparation_task_changed');
 const inputHash=socialRequestHash(task.inputSnapshot),refsHash=socialRequestHash(task.upstreamVersionRefs),depsHash=socialRequestHash(task.dependsOnTaskIds);
 const content=await store.list<Record_>('starter_social_content_tasks',{where:{tenant_id:scope.tenantId,create_idempotency_key:`weekly-production:${scope.packageId}:${scope.packageVersion}:${task.publicationTaskId}`},perPage:2});if(content.totalItems!==1||content.items.length!==1)fail('weekly_production_binding_missing');const target=content.items[0]!;const version=Number(target.version);if(!Number.isSafeInteger(version)||version<1)fail('weekly_material_preparation_content_changed');
 const repository=ports?.repository??createStarter198Repository(store);if(repository.dataStore!==store)fail('weekly_material_repository_authority_invalid');
 return withSocialContentSubjectLease({repository,tenantId:scope.tenantId,subjectId:String(target.task_id),action:async()=>{
 const before=await store.getById<Record_>('starter_social_content_tasks',target.id);if(!before||before.tenant_id!==scope.tenantId||before.task_id!==target.task_id||before.version!==target.version||before.run_id!==target.run_id||socialRequestHash(before.brief)!==socialRequestHash(target.brief))fail('weekly_material_preparation_content_changed');
 const beforeVersion=before.version,beforeRun=before.run_id,beforeBriefHash=socialRequestHash(before.brief);
 await validateWeeklyMaterialPreparationEvidence(store,task,{type:'starter_social_material_preparation',id:String(target.task_id),version},{...ports,repository});
 await assert();await assertSocialContentSubjectLease({repository,tenantId:scope.tenantId,subjectId:String(target.task_id)});const after=await store.getById<Record_>('starter_social_content_tasks',target.id),current=(await getWeeklyExecutionTaskRow(store,scope.tenantId,scope.taskId)).payload;
 if(!after||after.version!==beforeVersion||after.run_id!==beforeRun||socialRequestHash(after.brief)!==beforeBriefHash||current.status!=='blocked'||socialRequestHash(current.inputSnapshot)!==inputHash||socialRequestHash(current.upstreamVersionRefs)!==refsHash||socialRequestHash(current.dependsOnTaskIds)!==depsHash)fail('weekly_material_preparation_evidence_changed');

 const service=createWeeklyExecutionTaskService(store);for(const reason of task.ownBlockingReasons.filter(r=>MATERIAL_REASONS.has(r))){await assert();await service.unblock(scope.tenantId,scope.programId,scope.packageId,scope.taskId,reason);}
 return (await getWeeklyExecutionTaskRow(store,scope.tenantId,scope.taskId)).payload;
 }});
});}
