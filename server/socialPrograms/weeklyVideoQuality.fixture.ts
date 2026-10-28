import {type TestContext} from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {DataStore,ListQuery,ListResult,Record_} from '../storage/datastore.js';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import {ensureWeeklyTaskWorkspaces} from './weeklyTaskWorkspaces.js';
import {acceptWeeklyUnknownVideoQuality} from './weeklyVideoQualityAcceptance.js';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function weeklyVideoQualityFixture(t:TestContext){
  const tables=new Map<string,Record_[]>();let serial=0,failResume=false;
  const store:DataStore={
    async getById<T>(c:string,id:string){return structuredClone(tables.get(c)?.find(r=>r.id===id)??null) as T|null;},
    async create<T>(c:string,data:Record<string,unknown>){const row={id:`row-${++serial}`,...structuredClone(data)} as Record_;tables.set(c,[...(tables.get(c)??[]),row]);return structuredClone(row) as T;},
    async update(c:string,id:string,data:Record<string,unknown>){if(c==='content_execution_jobs'&&data.status==='queued'&&failResume){failResume=false;return false;}const row=tables.get(c)?.find(r=>r.id===id);if(!row)return false;Object.assign(row,structuredClone(data));return true;},
    async delete(c:string,id:string){const rows=tables.get(c)??[];tables.set(c,rows.filter(r=>r.id!==id));return rows.some(r=>r.id===id);},
    async list<T>(c:string,q:ListQuery={}):Promise<ListResult<T>>{const rows=(tables.get(c)??[]).filter(r=>Object.entries(q.where??{}).every(([k,v])=>r[k]===v)),page=q.page??1,perPage=q.perPage??30;return{items:structuredClone(rows.slice((page-1)*perPage,page*perPage)) as T[],totalItems:rows.length,totalPages:Math.max(1,Math.ceil(rows.length/perPage)),page,perPage};},
  };
  const tenantId=`quality-${randomUUID()}`,scope={tenantId,actorUserId:'owner',programId:'p',packageId:'week',packageVersion:2,executionTaskId:'weekly'};
  const now='2026-10-28T00:00:00.000Z';
  const task={tenantId,programId:'p',packageId:'week',packageVersion:2,taskId:'weekly',idempotencyKey:'weekly-key',workflowKind:'content',scope:'content',subjectId:'video',accountId:'account',publicationTaskId:'pub',dependsOnTaskIds:[],inputSnapshot:{publicationTask:{businessProposition:'video'}},upstreamVersionRefs:[],budget:{category:'production',limitCny:15},status:'blocked',ownBlockingReasons:['video_timeline_unknown'],inheritedBlockingTaskIds:[],attempt:1,maxAttempts:3,nextAttemptAt:null,lease:null,resultRefs:[],productionProgress:{contentTaskId:'content',runId:'run',step:'video',activity:'quality',updatedAt:now},lastError:null,recoveredFromDeadLetterAt:null,cancelReason:null,createdAt:now,updatedAt:now,schedule:{stepKind:'video_generation',responsibleActor:'content_agent',estimatedDurationMinutes:30,estimatedStartAt:now,estimatedFinishAt:now,actualStartedAt:null,actualFinishedAt:null}} as WeeklyExecutionTask;
  await store.create('social_weekly_execution_tasks',{tenant_id:tenantId,program_id:'p',package_id:'week',package_version:2,task_id:'weekly',payload:task});
  await store.create('starter_social_content_tasks',{tenant_id:tenantId,task_id:'content',run_id:'run'});
  const media=Buffer.from(`video-${tenantId}`),mediaHash=hash(media.toString()),root=path.resolve('data/content-execution-render',hash(JSON.stringify([tenantId,'content','run']))),cachePath=path.join(root,`${mediaHash}.mp4`);
  await mkdir(root,{recursive:true});await writeFile(cachePath,media);t.after(()=>rm(root,{recursive:true,force:true}));
  const report={schemaVersion:'voice-driven-video-quality.v1',mediaSha256:mediaHash,timeline:{status:'unknown'},subtitleStyle:{schemaVersion:'subtitle-style-sampling.v1',mediaSha256:mediaHash,status:'passed',samples:[]}};
  await store.create('content_execution_jobs',{id:'job',tenant_id:tenantId,job_key:'quality-job-key',task_id:'content',run_id:'run',user_id:'owner',account_id:'account',task_type:'social-content',status:'blocked',attempt:1,reconciliation_attempt:0,next_attempt_at:'',worker_id:'',lease_expires_at:'',retry_class:'input_required',last_error:'user_input_required:video_timeline_unknown:detector_unavailable',provider_state:'none',provider_receipts:[],checkpoints:{'social.graph_render':{version:'2',inputHash:mediaHash,payload:{sha256:mediaHash,cachePath},updatedAt:now},'social.video_node_quality':{version:'1',inputHash:'b'.repeat(64),payload:report,updatedAt:now}},created_at:now,updated_at:now,last_started_at:'',completed_at:''});
  await ensureWeeklyTaskWorkspaces(store,[task]);
  const input={expectedJobId:'job',expectedRunId:'run',expectedMediaSha256:mediaHash,acceptUnknown:true as const};
  const job=()=>tables.get('content_execution_jobs')![0]!;
  const accept=()=>acceptWeeklyUnknownVideoQuality(store,scope,input,new Date(now));
  return{store,tables,scope,input,job,accept,cachePath,media,failNextResume:()=>{failResume=true;}};
}
