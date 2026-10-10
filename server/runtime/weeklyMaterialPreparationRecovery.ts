import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyOwnedProductIdentityPorts} from './weeklyOwnedProductIdentityDemand.js';
import {validateWeeklyMaterialPreparationEvidence} from './weeklyMaterialPreparationEvidence.js';
import {withExecutionPackageGate,executionPackageFrozen} from '../socialPrograms/weeklyExecutionGate.js';
import {getWeeklyExecutionTaskRow,createWeeklyExecutionTaskService} from '../socialPrograms/executionTasks.js';
import {organizationRoleOrNull} from '../lib/organizationRole.js';
import {SocialContentWorkflowError} from '../starter198/socialContentValidation.js';
export interface WeeklyMaterialPreparationRecoveryScope {tenantId:string;programId:string;packageId:string;packageVersion:number;taskId:string;actorUserId:string}
function fail(code:string):never {throw new SocialContentWorkflowError(code,409);}
const MATERIAL_REASONS=new Set(['weekly_owned_product_identity_verification_required','weekly_owned_product_identity_source_not_bound','weekly_owned_product_identity_binding_changed','weekly_required_materials_missing','weekly_material_contract_required','weekly_material_source_binding_missing']);
/** Explicitly rechecks the selected preparation task, without manufacturing work
 * for its predecessors or releasing any unrelated blocker. */
export async function recheckWeeklyMaterialPreparation(store:DataStore,scope:WeeklyMaterialPreparationRecoveryScope,ports?:WeeklyOwnedProductIdentityPorts){return withExecutionPackageGate(store,scope,async assert=>{
 if(await executionPackageFrozen(store,scope))fail('weekly_execution_package_frozen');
 const user=await store.getById<Record_>('users',scope.actorUserId);const role=organizationRoleOrNull(user?.role);if(!user||String(user.tenantId??user.tenant_id)!==scope.tenantId||user.disabled===true||user.active===false||['disabled','suspended'].includes(String(user.status))||!['super_admin','admin','social_operator'].includes(String(role)))fail('weekly_material_preparation_actor_forbidden');
 const row=await getWeeklyExecutionTaskRow(store,scope.tenantId,scope.taskId),task=row.payload;if(row.program_id!==scope.programId||row.package_id!==scope.packageId||row.package_version!==scope.packageVersion||task.programId!==scope.programId||task.packageId!==scope.packageId||task.packageVersion!==scope.packageVersion||task.schedule.stepKind!=='material_preparation'||task.status!=='blocked'||!task.ownBlockingReasons.some(r=>MATERIAL_REASONS.has(r)))fail('weekly_material_preparation_task_changed');
 const content=await store.list<Record_>('starter_social_content_tasks',{where:{tenant_id:scope.tenantId,create_idempotency_key:`weekly-production:${scope.packageId}:${scope.packageVersion}:${task.publicationTaskId}`},perPage:2});if(content.totalItems!==1||content.items.length!==1)fail('weekly_production_binding_missing');const target=content.items[0]!;const version=Number(target.version);if(!Number.isSafeInteger(version)||version<1)fail('weekly_material_preparation_content_changed');
 await validateWeeklyMaterialPreparationEvidence(store,task,{type:'starter_social_material_preparation',id:String(target.task_id),version},ports);
 const service=createWeeklyExecutionTaskService(store);for(const reason of task.ownBlockingReasons.filter(r=>MATERIAL_REASONS.has(r))){await assert();await service.unblock(scope.tenantId,scope.programId,scope.packageId,scope.taskId,reason);}
 return (await getWeeklyExecutionTaskRow(store,scope.tenantId,scope.taskId)).payload;
});}
