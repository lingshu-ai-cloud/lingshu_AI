import type {DataStore,Record_} from '../storage/datastore.js';
import type {WeeklyExecutionTask,WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import {socialJson} from '../starter198/socialContentValidation.js';
import {createWeeklyRequiredMaterialAdmission} from './weeklyRequiredMaterialAdmission.js';
import type {WeeklyMaterialPorts} from './weeklyMaterialRequests.js';
import {createWeeklyExecutionTaskService,getWeeklyExecutionTaskRow} from './executionTasks.js';
import {withExecutionPackageGate,executionPackageFrozen} from './weeklyExecutionGate.js';
import {SocialProgramError} from './service.js';
export interface WeeklyRequiredMaterialRecoveryScope {tenantId:string;programId:string;packageId:string;packageVersion:number;taskId:string}
function fail(code:string):never{throw new SocialProgramError(code,409,'原任务必需素材尚未通过真实核验，未解除阻塞。');}
export function createWeeklyRequiredMaterialRecoveryService(store:DataStore,ports:WeeklyMaterialPorts={}){
 return {async recheck(scope:WeeklyRequiredMaterialRecoveryScope):Promise<WeeklyExecutionTask[]>{
 if(!scope.tenantId||!scope.programId||!scope.packageId||!scope.taskId||!Number.isSafeInteger(scope.packageVersion)||scope.packageVersion<1)fail('weekly_material_recovery_scope_invalid');
 return withExecutionPackageGate(store,scope,async assert=>{
 if(await executionPackageFrozen(store,scope))fail('weekly_execution_package_frozen');
 const rows=await store.list<Record_>('social_weekly_operating_packages',{where:{tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId},perPage:500});
 if(rows.totalItems!==rows.items.length||rows.items.some(row=>Number(row.version)>scope.packageVersion))fail('weekly_material_recovery_version_changed');
 const matches=rows.items.filter(row=>row.version===scope.packageVersion);if(matches.length!==1)fail('weekly_material_recovery_package_missing');const pkg=socialJson(matches[0]!.payload) as WeeklyOperatingPackage|null;
 if(!pkg||pkg.programId!==scope.programId||pkg.packageId!==scope.packageId||pkg.version!==scope.packageVersion||!['draft','active'].includes(pkg.status))fail('weekly_material_recovery_package_changed');
 const row=await getWeeklyExecutionTaskRow(store,scope.tenantId,scope.taskId),task=row.payload;
 if(row.tenant_id!==scope.tenantId||row.program_id!==scope.programId||row.package_id!==scope.packageId||row.package_version!==scope.packageVersion||row.task_id!==scope.taskId||task.programId!==scope.programId||task.packageId!==scope.packageId||task.packageVersion!==scope.packageVersion||task.status!=='blocked'||!task.ownBlockingReasons.includes('weekly_required_materials_missing')||!task.publicationTaskId)fail('weekly_material_recovery_task_changed');
 const pubs=pkg.socialContentPackage.publicationTasks.filter(pub=>pub.publicationTaskId===task.publicationTaskId&&pub.accountId===task.accountId);if(pubs.length!==1||pubs[0]!.materialRequirement?.required!==true||!pubs[0]!.materialRequirement.requestIds.length)fail('weekly_material_recovery_contract_missing');
 const graph=await store.list<Record_>('social_weekly_execution_tasks',{where:{tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,package_version:scope.packageVersion},perPage:500});if(graph.totalItems!==graph.items.length)fail('weekly_material_recovery_graph_incomplete');
 for(const entry of graph.items){const value=socialJson(entry.payload) as WeeklyExecutionTask|null;if(!value||entry.tenant_id!==scope.tenantId||entry.program_id!==scope.programId||entry.package_id!==scope.packageId||entry.package_version!==scope.packageVersion||entry.task_id!==value.taskId||value.tenantId!==scope.tenantId||value.programId!==scope.programId||value.packageId!==scope.packageId||value.packageVersion!==scope.packageVersion)fail('weekly_material_recovery_graph_scope');}
 const consumers=graph.items.map(row=>socialJson(row.payload) as WeeklyExecutionTask|null).filter(value=>value?.publicationTaskId===task.publicationTaskId&&value.schedule?.stepKind==='material_readiness');
 if(consumers.length!==1)fail('weekly_material_recovery_consumer_ambiguous');const consumer=consumers[0]!;
 if(consumer.tenantId!==scope.tenantId||consumer.programId!==scope.programId||consumer.packageId!==scope.packageId||consumer.packageVersion!==scope.packageVersion||consumer.accountId!==task.accountId)fail('weekly_material_recovery_consumer_changed');
 const admission=await createWeeklyRequiredMaterialAdmission(store,ports)({tenantId:scope.tenantId,programId:scope.programId,consumerTaskId:consumer.taskId,requirement:pubs[0]!.materialRequirement});if(admission.status!=='ready'||!admission.materials.length)fail('weekly_required_materials_missing');
 await assert();return createWeeklyExecutionTaskService(store).unblock(scope.tenantId,scope.programId,scope.packageId,scope.taskId,'weekly_required_materials_missing');
 });
 }};
}
export async function recheckWeeklyRequiredMaterials(store:DataStore,scope:WeeklyRequiredMaterialRecoveryScope,ports:WeeklyMaterialPorts={}):Promise<WeeklyExecutionTask[]>{return createWeeklyRequiredMaterialRecoveryService(store,ports).recheck(scope);}
