import test from 'node:test';
import assert from 'node:assert/strict';
import type {DataStore,Record_,ListQuery} from '../storage/datastore.js';
import type {SocialInspirationCollectionRun} from '../../shared/contracts/socialContentWorkflow.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {readWeeklyQualifiedDirectorAdmission,type WeeklyPreproductionJob} from './weeklyPreproductionProducer.js';
import type {WeeklyPreproductionRetryAttempt} from './weeklyPreproductionRetryAttempts.js';
import type {WeeklyQualifiedCandidate} from './weeklyQualifiedCandidateContinuation.js';

function fixture(){
 const tenantId='tenant-a',key='weekly:root',rootId=`weekly_discovery_${socialRequestHash({tenantId,key})}`;
 const base={jobId:'root-job',tenantId,programId:'program-a',packageId:'package-a',packageVersion:7,consumerTaskId:'task-a',consumerInputHash:'input',kind:'discovery' as const,status:'blocked' as const,originalRunKey:key,actorUserId:'owner',dueAt:'2026-10-18T00:00:00Z',boundAt:'2026-10-18T00:00:00Z',updatedAt:'2026-10-18T00:00:00Z',sourceHash:'scope-hash',authority:{scopeId:'scope-a',scopeVersion:2,scopeHash:'scope-hash',requestedModes:['momentum' as const]},code:'weekly_qualified_admission_unverified',resultRefs:[],recordHash:''};
 const rootJob:WeeklyPreproductionJob={...base,recordHash:socialRequestHash(base)};
 const rootRun={id:'root-row',tenant_id:tenantId,runId:rootId,status:'partial',startedAt:'2026-10-18T00:00:00Z',finishedAt:'2026-10-18T00:01:00Z',discoveryScopeId:'scope-a',discoveryScopeVersion:2,scopeSnapshot:{weeklyProducer:{key}},evidenceOutcomes:{momentum:{acceptedCandidateIds:['video-1','video-2','video-3','video-4'],acceptedEvidenceRefs:[],suggestionCandidateIds:[],failedCandidateIds:[]}}} as unknown as SocialInspirationCollectionRun;
 const childBase={...rootJob,jobId:'child-job',originalRunKey:`${key}:qualified:child-job`,retry:{rootJobId:rootJob.jobId,rootJobHash:rootJob.recordHash,parentRunId:rootId,parentRunHash:socialRequestHash(rootRun),sourceSelection:[{mode:'momentum' as const,platform:'tiktok',queryRef:'foam'}]},recordHash:''};
 const childJob:WeeklyPreproductionRetryAttempt={...childBase,recordHash:socialRequestHash(childBase)};
 const childId=`weekly_discovery_${socialRequestHash({tenantId,key:childJob.originalRunKey})}`;
 const childRun={id:'child-row',tenant_id:tenantId,runId:childId,status:'partial',startedAt:'2026-10-18T00:06:00Z',finishedAt:'2026-10-18T00:07:00Z',discoveryScopeId:'scope-a',discoveryScopeVersion:2,scopeSnapshot:{weeklyProducer:{key:childJob.originalRunKey,retry:{parentRunId:rootId,parentRunHash:socialRequestHash(rootRun)}}},evidenceOutcomes:{momentum:{acceptedCandidateIds:['video-5'],acceptedEvidenceRefs:[],suggestionCandidateIds:[],failedCandidateIds:[]}}} as unknown as SocialInspirationCollectionRun;
 const rows:Record<string,Record_[]>={social_discovery_runs:[rootRun as unknown as Record_,childRun as unknown as Record_],social_weekly_preproduction_retry_attempts:[{id:childJob.jobId,tenant_id:tenantId,program_id:rootJob.programId,package_id:rootJob.packageId,package_version:7,root_job_id:rootJob.jobId,record_hash:childJob.recordHash,payload:childJob}]};
 const store:DataStore={async getById<T>(collection:string,id:string){return structuredClone(rows[collection]?.find(row=>row.id===id)??null) as T|null;},async list<T>(collection:string,query:ListQuery={}){const found=(rows[collection]??[]).filter(row=>Object.entries(query.where??{}).every(([field,value])=>row[field]===value));const page=query.page??1,perPage=query.perPage??100;return{items:structuredClone(found.slice((page-1)*perPage,page*perPage)) as T[],totalItems:found.length,totalPages:Math.max(1,Math.ceil(found.length/perPage)),page,perPage};},async create(){throw Error('read_only_test');},async update(){throw Error('read_only_test');},async delete(){throw Error('read_only_test');}};
 const candidate=(candidateId:string,postAdmission:'accepted'|'pending'|'rejected'='accepted'):WeeklyQualifiedCandidate=>({candidateId,evidenceRef:`evidence:${candidateId}@1`,exactHandoffRef:`handoff:${candidateId}@1`,accountId:'account-a',postAdmission});
 const snapshots=new Map([[rootId,[1,2,3,4].map(index=>candidate(`video-${index}`))],[childId,[candidate('video-5')]]]);
 const readSnapshot=(async({job,run}:{job:WeeklyPreproductionJob;run:SocialInspirationCollectionRun})=>{if(job.packageVersion!==7)throw Error('stale_weekly_package');return snapshots.get(run.runId)??[];}) as any;
 return {store,rootJob,rootRun,childJob,childRun,rows,snapshots,readSnapshot,candidate};
}

test('only five different current-package post-admission accepts across the root and child may reach the director',async()=>{
 const f=fixture(),before=structuredClone(f.rows);
 const root=await readWeeklyQualifiedDirectorAdmission({store:f.store,rootJob:f.rootJob,job:f.rootJob,run:f.rootRun,mediaRoot:'/unavailable',readSnapshot:f.readSnapshot});
 assert.deepEqual(root.candidateIds,['video-1','video-2','video-3','video-4']);
 const complete=await readWeeklyQualifiedDirectorAdmission({store:f.store,rootJob:f.rootJob,job:f.childJob,run:f.childRun,mediaRoot:'/unavailable',readSnapshot:f.readSnapshot});
 assert.deepEqual(complete.candidateIds,['video-1','video-2','video-3','video-4','video-5']);
 assert.deepEqual(complete.runIds,[f.childRun.runId,f.rootRun.runId]);
 assert.deepEqual(f.rows,before,'admission projection never writes, downloads, analyzes or reserves');
 const restarted=await readWeeklyQualifiedDirectorAdmission({store:f.store,rootJob:f.rootJob,job:f.childJob,run:f.childRun,mediaRoot:'/unavailable',readSnapshot:f.readSnapshot});
 assert.deepEqual(restarted,complete,'restart reads the same immutable chain');
});

test('metadata success, revocation and package-version drift cannot fill a fifth mother',async()=>{
 const f=fixture();f.snapshots.set(f.childRun.runId,[f.candidate('video-5','pending')]);
 const pending=await readWeeklyQualifiedDirectorAdmission({store:f.store,rootJob:f.rootJob,job:f.childJob,run:f.childRun,mediaRoot:'/unavailable',readSnapshot:f.readSnapshot});
 assert.equal(pending.candidateIds.length,4,'metadata accepted is not post-admission accepted');
 f.snapshots.set(f.childRun.runId,[f.candidate('video-5','rejected')]);
 assert.equal((await readWeeklyQualifiedDirectorAdmission({store:f.store,rootJob:f.rootJob,job:f.childJob,run:f.childRun,mediaRoot:'/unavailable',readSnapshot:f.readSnapshot})).candidateIds.length,4,'resource or semantic rejection removes the candidate');
 await assert.rejects(readWeeklyQualifiedDirectorAdmission({store:f.store,rootJob:f.rootJob,job:{...f.childJob,packageVersion:8},run:f.childRun,mediaRoot:'/unavailable',readSnapshot:f.readSnapshot}),/lineage_invalid/);
});

test('frozen five-from-one-account target cannot be filled by another admitted uploader',async()=>{
 const f=fixture(),accountUrl='https://www.tiktok.com/@fixture_factory';
 (f.rootRun.scopeSnapshot as any).weeklyAccountCollectionTarget={accountUrl,targetCount:5};
 f.snapshots.set(f.rootRun.runId,[1,2,3,4].map(index=>({...f.candidate(`video-${index}`),accountId:accountUrl})).concat([{...f.candidate('video-5'),accountId:'https://www.tiktok.com/@other_factory'}]));
 const short=await readWeeklyQualifiedDirectorAdmission({store:f.store,rootJob:f.rootJob,job:f.rootJob,run:f.rootRun,mediaRoot:'/unavailable',readSnapshot:f.readSnapshot});
 assert.deepEqual(short.candidateIds,['video-1','video-2','video-3','video-4']);
 f.snapshots.set(f.rootRun.runId,[...f.snapshots.get(f.rootRun.runId)!.slice(0,4),{...f.candidate('video-5'),accountId:accountUrl}]);
 const full=await readWeeklyQualifiedDirectorAdmission({store:f.store,rootJob:f.rootJob,job:f.rootJob,run:f.rootRun,mediaRoot:'/unavailable',readSnapshot:f.readSnapshot});
 assert.equal(full.candidateIds.length,5);
});

test('director re-reads exact settlement through each original run, and absent or borrowed ports stay pending',async()=>{
 const f=fixture(),before=structuredClone(f.rows),seen:string[]=[];
 const readSnapshot=(async({job,run,exactAnalysisPorts}:{job:WeeklyPreproductionJob;run:SocialInspirationCollectionRun;exactAnalysisPorts?:{readSettledReceipt?:()=>Promise<unknown>}})=>{
  const expected=run.runId===f.rootRun.runId?f.rootJob.jobId:f.childJob.jobId;
  const settled=await exactAnalysisPorts?.readSettledReceipt?.();
  return (f.snapshots.get(run.runId)??[]).map(candidate=>({...candidate,postAdmission:settled===expected?'accepted':'pending'}));
 }) as typeof f.readSnapshot;
 const resolve=async(job:WeeklyPreproductionJob|WeeklyPreproductionRetryAttempt,run:SocialInspirationCollectionRun)=>{
  seen.push(`${job.jobId}:${run.runId}`);
  return {readSettledReceipt:async()=>job.jobId};
 };
 const base={store:f.store,rootJob:f.rootJob,job:f.childJob,run:f.childRun,mediaRoot:'/unavailable',readSnapshot};
 assert.equal((await readWeeklyQualifiedDirectorAdmission(base)).candidateIds.length,0);
 const admitted=await readWeeklyQualifiedDirectorAdmission({...base,exactAnalysisPortsForRun:resolve as any});
 assert.deepEqual(admitted.candidateIds,['video-1','video-2','video-3','video-4','video-5']);
 assert.deepEqual(seen,[`${f.childJob.jobId}:${f.childRun.runId}`,`${f.rootJob.jobId}:${f.rootRun.runId}`]);
 seen.length=0;
 const restarted=await readWeeklyQualifiedDirectorAdmission({...base,exactAnalysisPortsForRun:resolve as any});
 assert.deepEqual(restarted.candidateIds,admitted.candidateIds,'restart must re-read both original settlements');
 assert.deepEqual(seen,[`${f.childJob.jobId}:${f.childRun.runId}`,`${f.rootJob.jobId}:${f.rootRun.runId}`]);
 assert.equal((await readWeeklyQualifiedDirectorAdmission({...base,exactAnalysisPortsForRun:async()=>({readSettledReceipt:async()=>f.childJob.jobId}) as any})).candidateIds.length,1);
 assert.deepEqual(f.rows,before,'settlement projection must not mutate runs or spend money');
});
