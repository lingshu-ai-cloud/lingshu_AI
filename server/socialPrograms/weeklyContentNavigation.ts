import {isWeeklyContentNavigationExecution} from '../../shared/contracts/weeklyContentNavigation.js';
import type {WeeklyContentNavigation,WeeklyContentNavigationScope} from '../../shared/contracts/weeklyContentNavigation.js';
import type {WeeklyExecutionTask,WeeklyOperatingPackage,VersionedSocialRef} from '../../shared/contracts/socialProgram.js';
import type {DataStore,Record_} from '../storage/datastore.js';
import {socialJson,socialObject,socialRequestHash} from '../starter198/socialContentValidation.js';
import {createStarter198Repository} from '../starter198/repository.js';
import {resolveSceneCacheSourceRun} from '../starter198/socialContentSceneCacheSource.js';
import {createSocialSceneReworkService} from '../starter198/socialContentSceneReworkService.js';
import {SocialProgramError} from './service.js';
function fail(code:string):never {throw new SocialProgramError(code,409,'真实生产任务、产物或原生产运行未能唯一核验，请核对当前周任务。');}
export async function readWeeklyContentNavigation(store:DataStore,scope:WeeklyContentNavigationScope):Promise<WeeklyContentNavigation>{
 if(!scope.tenantId||!scope.programId||!scope.packageId||!scope.executionTaskId||!Number.isSafeInteger(scope.packageVersion)||scope.packageVersion<1)fail('weekly_content_navigation_scope_invalid');
 const unique=async(collection:string,where:Record<string,string|number>)=>{const rows=await store.list<Record_>(collection,{where,page:1,perPage:2});if(rows.totalItems!==1||rows.items.length!==1||!rows.items[0]||Object.entries(where).some(([key,value])=>rows.items[0]![key]!==value))return fail('weekly_content_navigation_identity_ambiguous');return rows.items[0];};
 const pkgRow=await unique('social_weekly_operating_packages',{tenant_id:scope.tenantId,package_id:scope.packageId,version:scope.packageVersion});
 const pkg=socialJson(pkgRow.payload) as WeeklyOperatingPackage|null;
 if(!pkg||pkg.programId!==scope.programId||pkg.packageId!==scope.packageId||pkg.version!==scope.packageVersion)fail('weekly_content_navigation_scope_invalid');
 const taskRow=await unique('social_weekly_execution_tasks',{tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,package_version:scope.packageVersion,task_id:scope.executionTaskId});
 const task=socialJson(taskRow.payload) as WeeklyExecutionTask|null;
 if(!task||task.tenantId!==scope.tenantId||task.programId!==scope.programId||task.packageId!==scope.packageId||task.packageVersion!==scope.packageVersion||task.taskId!==scope.executionTaskId||!task.publicationTaskId||!isWeeklyContentNavigationExecution(task))fail('weekly_content_navigation_task_invalid');
 if(task.inputSnapshot?.inventoryReuseRef)fail('inventory_navigation_required');
 const pubs=pkg.socialContentPackage.publicationTasks.filter(p=>p.publicationTaskId===task.publicationTaskId);
 if(pubs.length!==1||pubs[0]!.inventoryReuseRef||pubs[0]!.accountId!==task.accountId)fail('weekly_content_navigation_publication_invalid');
 const bindingKey=`weekly-production:${scope.packageId}:${scope.packageVersion}:${task.publicationTaskId}`;
 const contentRow=await unique('starter_social_content_tasks',{tenant_id:scope.tenantId,create_idempotency_key:bindingKey});
 const contentTaskId=contentRow.task_id;
 const brief=socialObject(socialJson(contentRow.brief));
 const programRef=socialObject(brief?.programRef);
 if(typeof contentTaskId!=='string'||!contentTaskId||programRef?.id!==scope.programId)fail('weekly_content_navigation_binding_invalid');
 const authority=socialObject(brief?._weeklyAuthority),weekly=socialObject(authority?.weeklyPackage),publication=socialObject(authority?.publicationTask);
 if(!weekly||weekly.packageId!==scope.packageId||weekly.version!==scope.packageVersion||weekly.programId!==scope.programId||publication?.publicationTaskId!==task.publicationTaskId)fail('weekly_content_navigation_authority_invalid');
 const refs:VersionedSocialRef[]=task.resultRefs.filter(r=>r.type==='starter_social_content_artifact');
 if(!refs.length){
  const upstream=await store.list<Record_>('social_weekly_execution_tasks',{where:{tenant_id:scope.tenantId,program_id:scope.programId,package_id:scope.packageId,package_version:scope.packageVersion},perPage:500});
  if(upstream.totalItems!==upstream.items.length)fail('weekly_content_navigation_graph_incomplete');
  for(const row of upstream.items){const other=socialJson(row.payload) as WeeklyExecutionTask|null;if(!other||other.tenantId!==scope.tenantId||other.programId!==scope.programId||other.packageId!==scope.packageId||other.packageVersion!==scope.packageVersion)fail('weekly_content_navigation_graph_scope');if(other.publicationTaskId===task.publicationTaskId&&other.workflowKind==='content')refs.push(...other.resultRefs.filter(r=>r.type==='starter_social_content_artifact'));}
 }
 const distinct=[...new Map(refs.map(ref=>[`${ref.id}:${ref.version}`,ref])).values()];
 if(new Set(distinct.map(ref=>ref.id)).size>1)fail('weekly_content_navigation_artifact_ambiguous');
 distinct.sort((a,b)=>a.version-b.version);
 if(distinct.length>2||distinct.length===2&&distinct[1]!.version!==distinct[0]!.version+1)fail('weekly_content_navigation_artifact_ambiguous');
 let artifactRef=distinct[0]??null;
 let runId:string|null;
 if(artifactRef){
  if(!Number.isSafeInteger(artifactRef.version)||artifactRef.version<1)fail('weekly_content_navigation_artifact_version');
  const artifact=await unique('starter_social_content_artifacts',{tenant_id:scope.tenantId,task_id:contentTaskId,artifact_id:artifactRef.id});
  const currentVersion=Number(String(artifact.version).replace(/^v/,''));
  if(artifact.artifact_kind!=='short_video')fail('weekly_content_navigation_artifact_version');
  if(currentVersion!==artifactRef.version){
   if(artifact.status!=='approved'||currentVersion!==artifactRef.version+1||typeof artifact.last_operation_id!=='string')fail('weekly_content_navigation_artifact_version');
   const operation=await unique('starter_social_content_operations',{tenant_id:scope.tenantId,operation_id:artifact.last_operation_id});
   if(operation.operation!=='decide_social_content_artifact'||operation.target_id!==contentTaskId||operation.status!=='succeeded'||operation.request_hash!==socialRequestHash({decision:'approved',expectedVersion:String(artifactRef.version),note:artifact.decision_note}))fail('weekly_content_navigation_artifact_version');
   const receipt=socialObject(socialJson(operation.result));if(receipt?.schemaVersion!=='social-content.operation-result.v1'||receipt.operationId!==artifact.last_operation_id||receipt.targetId!==contentTaskId)fail('weekly_content_navigation_artifact_version');
   artifactRef={...artifactRef,version:currentVersion};
  }
  const content=socialObject(socialJson(artifact.content));if(!content||artifact.content_hash!==socialRequestHash({resourceRef:artifact.resource_ref,content}))fail('weekly_content_navigation_artifact_hash');
  const repository=createStarter198Repository(store);
  runId=await resolveSceneCacheSourceRun(repository,{tenantId:scope.tenantId,taskId:contentTaskId,parentArtifactId:artifactRef.id});
  const cached=await createSocialSceneReworkService(repository).readCache({tenantId:scope.tenantId,taskId:contentTaskId,runId,parentArtifactId:artifactRef.id});
  if(cached.cache.parentArtifactHash!==artifact.content_hash)fail('weekly_content_navigation_cache_changed');
 }else{
  if(typeof contentRow.run_id==='string'&&contentRow.run_id.trim())runId=contentRow.run_id;
  else if(['draft','needs_input','plan_review'].includes(String(contentRow.status)))runId=null;
  else fail('weekly_content_navigation_run_missing');
 }
 if(runId!==null){const run=await store.getById<Record_>('workflow_runs',runId);if(!run||run.tenant_id!==scope.tenantId||(run.task_id&&run.task_id!==contentTaskId))fail('weekly_content_navigation_run_scope');}
 if(task.productionProgress&&(task.productionProgress.contentTaskId!==contentTaskId||task.productionProgress.runId!==runId))fail('weekly_content_navigation_progress_changed');
 return {scope:{...scope},publicationTaskId:task.publicationTaskId,contentTaskId,runId,artifactRef,bindingKey,source:artifactRef?'completed_artifact':'production_binding',gaps:artifactRef?[]:['尚未保存可核验的成片；仅进入真实原生产任务。']};
}
