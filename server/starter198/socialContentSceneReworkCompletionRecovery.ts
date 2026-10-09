import type {Record_} from '../storage/datastore.js';
import type {Starter198Repository} from './repository.js';
import {readContentExecutionJob} from '../contentExecution/durableQueue.js';
import {completeSocialSceneReworkRun,isSocialSceneReworkJob} from './socialContentSceneReworkExecution.js';
import {runWithDataAuthority,type DataAuthority} from '../storage/dataAuthority.js';
export interface SceneReworkCompletionRecoveryCursor {page:number;offset:number}
export interface SceneReworkCompletionRecoveryReport {scanned:number;attempted:number;recovered:number;skipped:number;failed:number;errors:Array<{jobId:string;code:string}>;nextCursor:SceneReworkCompletionRecoveryCursor|null}
const integer=(value:number|undefined,fallback:number,max:number)=>value===undefined?fallback:Number.isSafeInteger(value)&&value>0&&value<=max?value:(()=>{throw Error('scene_rework_recovery_limit_invalid');})();
/** Repairs only the run projection after durable success. No execution, provider, render, or source-run mutation. */
export async function recoverSocialSceneReworkCompletions(input:{repository:Starter198Repository;dataAuthority?:DataAuthority;cursor?:SceneReworkCompletionRecoveryCursor;pageSize?:number;maxPages?:number;maxRows?:number}):Promise<SceneReworkCompletionRecoveryReport>{
 if(input.dataAuthority)return runWithDataAuthority(input.dataAuthority,()=>recoverSocialSceneReworkCompletions({...input,dataAuthority:undefined}));
 const store=input.repository.dataStore;if(!store)throw Error('scene_rework_persistent_store_required');const pageSize=integer(input.pageSize,100,500),maxPages=integer(input.maxPages,3,20),maxRows=integer(input.maxRows,250,1000);let page=input.cursor?.page??1,offset=input.cursor?.offset??0;if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(offset)||offset<0||offset>=pageSize)throw Error('scene_rework_recovery_cursor_invalid');
 const report:SceneReworkCompletionRecoveryReport={scanned:0,attempted:0,recovered:0,skipped:0,failed:0,errors:[],nextCursor:{page,offset}};const seen=new Set<string>();
 for(let pages=0;pages<maxPages;pages++,page++,offset=0){
  const rows=await store.list<Record_>('content_execution_jobs',{where:{status:'succeeded'},sort:'id',page,perPage:pageSize});if(rows.page!==page||rows.perPage!==pageSize||!Number.isSafeInteger(rows.totalItems)||rows.totalItems<0||!Number.isSafeInteger(rows.totalPages)||rows.totalPages<0||rows.items.length>pageSize||page<rows.totalPages&&rows.items.length!==pageSize)throw Error('scene_rework_recovery_page_incomplete');
  // Archived rows can shrink a previously valid cursor; restart on the next bounded sweep.
  if(page>Math.max(1,rows.totalPages)||offset>rows.items.length){report.nextCursor=null;return report;}
  for(let index=offset;index<rows.items.length;index++){
   const row=rows.items[index]!;report.scanned++;report.nextCursor=index+1<rows.items.length?{page,offset:index+1}:page<rows.totalPages?{page:page+1,offset:0}:null;
   if(seen.has(row.id))throw Error('scene_rework_recovery_page_duplicate');seen.add(row.id);
   try{
    if(row.status!=='succeeded'||typeof row.task_type!=='string'||!isSocialSceneReworkJob({taskType:row.task_type})){report.skipped++;}
    else{
     if(typeof row.tenant_id!=='string'||!row.tenant_id||typeof row.task_id!=='string'||!row.task_id||typeof row.run_id!=='string'||!row.run_id)throw Error('scene_rework_recovery_job_scope_invalid');
     const job=await readContentExecutionJob(store,row.tenant_id,row.task_id,row.run_id);if(!job||job.id!==row.id||job.status!=='succeeded'||job.taskType!==row.task_type||!job.completedAt||!Number.isFinite(Date.parse(job.completedAt)))throw Error('scene_rework_recovery_job_success_evidence_invalid');
     const run=await store.getById<Record_>('workflow_runs',job.runId);if(!run||run.tenant_id!==job.tenantId||run.task_id&&run.task_id!==job.taskId)throw Error('scene_rework_recovery_run_scope_invalid');
     if(['succeeded','completed'].includes(String(run.status))){report.skipped++;}
     else if(run.status!=='running')throw Error('scene_rework_recovery_run_not_running');
     else{report.attempted++;await completeSocialSceneReworkRun(input.repository,job);const verified=await store.getById<Record_>('workflow_runs',job.runId);if(!verified||verified.tenant_id!==job.tenantId||!['succeeded','completed'].includes(String(verified.status)))throw Error('scene_rework_recovery_run_write_unverified');report.recovered++;}
    }
   }catch(error){report.failed++;report.errors.push({jobId:row.id,code:error instanceof Error&&/^scene_rework_[a-z0-9_]+$/.test(error.message)?error.message:'scene_rework_completion_recovery_failed'});}
   if(report.scanned>=maxRows)return report;
  }
  if(page>=rows.totalPages){report.nextCursor=null;return report;}
  report.nextCursor={page:page+1,offset:0};
 }
 return report;
}
