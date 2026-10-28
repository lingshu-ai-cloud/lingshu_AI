import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {DataStore} from '../storage/datastore.js';
import {readContentExecutionJob} from '../contentExecution/durableQueue.js';
import {readWeeklyTaskWorkspace} from './weeklyTaskWorkspaces.js';
import {weeklyVideoQualityEvidence} from './weeklyVideoQualityEvidence.js';
import {SocialProgramError} from './service.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';

type Scope=Parameters<typeof readWeeklyTaskWorkspace>[1];
export type WeeklyVideoQualityMediaInput={expectedJobId:string;expectedRunId:string;expectedMediaSha256:string;expectedQualityInputHash:string;frameSha256?:string};
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const stale=():never=>{throw new SocialProgramError('weekly_video_quality_media_changed',409,'当前成片或检查证据已变化，请刷新任务后重新查看。');};

/** Read only the currently blocked film; clients cannot supply paths or URLs.
 * The same tenant/week/job/media evidence protects both preview and acceptance. */
export async function readWeeklyVideoQualityMedia(store:DataStore,scope:Scope,input:WeeklyVideoQualityMediaInput,
 roots={render:path.resolve('data/content-execution-render'),quality:path.resolve('data/content-execution-quality')}){
 if(!input.expectedJobId||!input.expectedRunId||!hash(input.expectedMediaSha256)||!hash(input.expectedQualityInputHash)
  ||(input.frameSha256!==undefined&&!hash(input.frameSha256)))throw new SocialProgramError('weekly_video_quality_media_input_invalid',400,'成片预览参数无效。');
 const workspace=await readWeeklyTaskWorkspace(store,scope);
 if(!workspace.contentTaskId||workspace.runId!==input.expectedRunId)return stale();
 const job=await readContentExecutionJob(store,scope.tenantId,workspace.contentTaskId,input.expectedRunId);
 if(!job||job.id!==input.expectedJobId||job.checkpoints['social.video_node_quality']?.inputHash!==input.expectedQualityInputHash)return stale();
 const quality=await weeklyVideoQualityEvidence(store,job,roots);
 if(!quality||quality.mediaSha256!==input.expectedMediaSha256)return stale();
 let file=path.join(roots.render,sha(JSON.stringify([job.tenantId,job.taskId,job.runId])),`${input.expectedMediaSha256}.mp4`);
 if(input.frameSha256){
  const report=job.checkpoints['social.video_node_quality'].payload as {subtitleStyle?:{samples?:Array<{frameSha256:string;framePath:string}>}};
  const sample=report.subtitleStyle?.samples?.find(row=>row.frameSha256===input.frameSha256);
  if(!sample||!quality.samples.some(row=>row.frameSha256===input.frameSha256))return stale();
  file=sample.framePath;
 }
 let bytes:Buffer;try{bytes=await readFile(file);}catch{return stale();}
 if(sha(bytes)!==(input.frameSha256??input.expectedMediaSha256))return stale();
 // Recheck job identity after reading bytes, so a concurrent rerender cannot
 // return evidence under an obsolete quality checkpoint.
 const current=await readContentExecutionJob(store,scope.tenantId,workspace.contentTaskId,input.expectedRunId);
 if(!current||current.id!==job.id||current.status!=='blocked'
  ||current.checkpoints['social.video_node_quality']?.inputHash!==input.expectedQualityInputHash
  ||socialRequestHash(current.checkpoints['social.video_node_quality'])!==socialRequestHash(job.checkpoints['social.video_node_quality'])
  ||socialRequestHash(current.checkpoints['social.graph_render'])!==socialRequestHash(job.checkpoints['social.graph_render']))return stale();
 const tasks=await store.list<Record<string,unknown>>('starter_social_content_tasks',{where:{tenant_id:scope.tenantId,task_id:workspace.contentTaskId},page:1,perPage:2});
 if(tasks.totalItems!==1||tasks.items[0]?.run_id!==input.expectedRunId)return stale();
 return{bytes,contentType:input.frameSha256?'image/png' as const:'video/mp4' as const};
}
