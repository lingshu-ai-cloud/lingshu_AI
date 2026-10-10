import {createSocialWeeklyExecutionWorker} from '../runtime/socialWeeklyExecutionWorker.js';
import {createWeeklyExecutionTaskService,recomputePackageExecution,writeWeeklyExecutionTask,getWeeklyExecutionTaskRow} from './executionTasks.js';
import {WEEKLY_EXECUTION_FREEZES,withExecutionPackageGate} from './weeklyExecutionGate.js';
import {createSocialProgramService} from './service.js';
import {createWeeklyOperatingPackageService} from './weeklyOperatingPackages.js';
import {listWeeklyExecutionTasks,materializeWeeklyExecutionTasks} from './executionTasks.js';
import test from 'node:test';import assert from 'node:assert/strict';
import type {DataStore,ListQuery,ListResult,Record_} from '../storage/datastore.js';
import type {WeeklyExecutionTask,WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import type {WeeklyScheduledPackage} from '../../shared/contracts/socialWeeklyScheduleRevision.js';
import {createWeeklyScheduleRevisionService} from './socialWeeklyScheduleRevisions.js';
import {applyFrozenWeeklySchedule,scheduleHash,scheduleTaskSignature,SCHEDULE_SNAPSHOTS} from './weeklyScheduleSnapshots.js';
const scope={tenantId:'tenant',programId:'program',packageId:'package',packageVersion:1,actorUserId:'owner'};
function memoryStore(): DataStore {
  const rows = new Map<string, Array<Record_>>();
  let counter = 0;
  return {
    async getById<T>(collection: string, id: string) {
      return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as T | null;
    },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const row = { id: `row-${++counter}`, ...structuredClone(data) } as Record_;
      rows.set(collection, [...(rows.get(collection) ?? []), row]);
      return structuredClone(row) as T;
    },
    async update(collection: string, id: string, data: Record<string, unknown>) {
      const list = rows.get(collection) ?? [];
      const index = list.findIndex(row => row.id === id);
      if (index < 0) return false;
      list[index] = { ...list[index], ...structuredClone(data) };
      return true;
    },
    async delete(collection: string, id: string) {
      const list = rows.get(collection) ?? [];
      const next = list.filter(row => row.id !== id);
      rows.set(collection, next);
      return next.length !== list.length;
    },
    async list<T>(collection: string, query: ListQuery = {}): Promise<ListResult<T>> {
      let items = (rows.get(collection) ?? []).filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value));
      if (query.sort) {
        const descending = query.sort.startsWith('-');
        const field = descending ? query.sort.slice(1) : query.sort;
        items = [...items].sort((left, right) => {
          const a = left[field];
          const b = right[field];
          const comparison = typeof a === 'number' && typeof b === 'number'
            ? a - b
            : String(a ?? '').localeCompare(String(b ?? ''));
          return comparison * (descending ? -1 : 1);
        });
      }
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 30;
      const start = (page - 1) * perPage;
      return {
        items: structuredClone(items.slice(start, start + perPage)) as T[],
        totalItems: items.length,
        totalPages: Math.max(1, Math.ceil(items.length / perPage)),
        page,
        perPage,
      };
    },
  };
}


async function fixture(options:{onRevise?:()=>Promise<void>}={}){const store=memoryStore();let time='2026-10-04T08:00:00Z';await store.create('users',{id:'owner',tenantId:'tenant',role:'admin'});
const pkg={programId:'program',packageId:'package',version:1,previousVersion:null,createdBy:'owner',status:'draft',weekStart:'2026-10-05',weekEnd:'2026-10-11',socialContentPackage:{publicationTasks:[{publicationTaskId:'publication',accountId:'account',publishWindow:'2026-10-05T09:00:00Z'}],authorization:{allowRealPublishing:false}}} as unknown as WeeklyOperatingPackage;
await store.create('social_weekly_operating_packages',{tenant_id:'tenant',program_id:'program',package_id:'package',version:1,payload:pkg});
const tasks:WeeklyExecutionTask[]=['source','publish'].map((id,i)=>({taskId:id,tenantId:'tenant',programId:'program',packageId:'package',packageVersion:1,workflowKind:i?'publishing':'content',scope:i?'publication':'content',subjectId:id,accountId:'account',publicationTaskId:'publication',dependsOnTaskIds:i?['source']:[],upstreamVersionRefs:[],inputSnapshot:{},idempotencyKey:id,budget:{category:'none',limitCny:null},schedule:{stepKind:i?'publishing':'video_generation',responsibleActor:'content_agent',estimatedDurationMinutes:60,estimatedStartAt:time,estimatedFinishAt:'2026-10-04T09:00:00Z',latestStartAt:i?'2026-10-05T09:00:00Z':null,latestFinishAt:i?'2026-10-05T10:00:00Z':'2026-10-04T18:00:00Z',actualStartedAt:null,actualFinishedAt:null},status:'queued',ownBlockingReasons:[],inheritedBlockingTaskIds:[],attempt:0,maxAttempts:3,nextAttemptAt:null,lease:null,resultRefs:[],lastError:null,recoveredFromDeadLetterAt:null,cancelReason:null,createdAt:time,updatedAt:time} as WeeklyExecutionTask));
for(const task of tasks)await store.create('social_weekly_execution_tasks',{tenant_id:'tenant',program_id:'program',package_id:'package',package_version:1,task_id:task.taskId,status:task.status,payload:task});
const capacity={constraints:Object.fromEntries(tasks.map(t=>[t.taskId,{resourceKey:'content',remainingMinutes:60,remainingCostCny:10,bufferMinutes:0,availableAt:time}])),resources:{content:{concurrency:1,workingWindows:[{startAt:time,finishAt:'2026-10-04T18:00:00Z'},{startAt:'2026-10-05T08:00:00Z',finishAt:'2026-10-05T18:00:00Z'}]}},remainingBudgetCny:100};
for(const [dimension,key] of [['tenant','*'],['account','account'],['task_type','social_content_weekly']])await store.create('content_execution_limits',{tenant_id:'tenant',limit_scope:dimension,scope_key:key,max_running:1,updated_by:'owner',created_at:time,updated_at:time});
let revisions=0;const service=createWeeklyScheduleRevisionService(store,{now:()=>time,previewTarget:async(_a,current,actualTasks)=>({pkg:{...current,version:current.version+1,previousVersion:current.version,createdBy:'owner'},tasks:actualTasks.map(t=>({...t,packageVersion:current.version+1,taskId:'new-'+t.taskId,dependsOnTaskIds:t.dependsOnTaskIds.map(id=>'new-'+id)}))}),revise:async(a,ref)=>{revisions++;await options.onRevise?.();const next={...pkg,version:2,previousVersion:1,scheduleRevisionRef:ref} as WeeklyScheduledPackage;await store.create('social_weekly_operating_packages',{tenant_id:'tenant',program_id:'program',package_id:'package',version:2,payload:next});return next;}});
return {store,service,pkg,tasks,capacity,setTime:(value:string)=>{time=value;},revisions:()=>revisions};}
test('server confirmation freezes real capacity assignments into one draft, retains publish time and retry never creates another revision',async()=>{const f=await fixture();const p=await f.service.propose(scope,f.capacity);f.setTime('2026-10-04T08:00:05Z');const result=await f.service.confirm(scope,{proposalId:p.proposalId,expectedVersion:1,inputEvidenceHash:p.inputEvidenceHash});assert.equal(result.item.version,2);assert.equal(result.activated,false);assert.equal(result.item.socialContentPackage.publicationTasks[0]!.publishWindow,'2026-10-05T09:00:00Z');assert.equal(result.snapshot.assignments.find(a=>a.sourceTaskId==='publish')!.startAt,'2026-10-05T09:00:00.000Z');assert.equal((await f.service.confirm(scope,{proposalId:p.proposalId,expectedVersion:1,inputEvidenceHash:p.inputEvidenceHash})).item.version,2);assert.equal(f.revisions(),1);const old=await f.store.list<Record_>('social_weekly_execution_tasks',{where:{package_version:1}});assert.deepEqual(old.items.map(r=>(r.payload as WeeklyExecutionTask).schedule.estimatedStartAt),['2026-10-04T08:00:00Z','2026-10-04T08:00:00Z']);const newTasks=f.tasks.map(t=>({...t,packageVersion:2,taskId:'new-'+t.taskId,dependsOnTaskIds:t.dependsOnTaskIds.map(id=>'new-'+id)}));const frozen=await applyFrozenWeeklySchedule(f.store,'tenant',result.item,newTasks);assert.equal(frozen[1]!.schedule.estimatedStartAt,'2026-10-05T09:00:00.000Z');});
test('graph changes, wrong proof, started work, stale now and foreign users reject before revision',async()=>{for(const mode of ['graph','proof','time','started','foreign']){const f=await fixture(),p=await f.service.propose(scope,f.capacity);if(mode==='graph'){const row=(await f.store.list<Record_>('social_weekly_execution_tasks')).items[0]!;await f.store.update('social_weekly_execution_tasks',row.id,{payload:{...(row.payload as WeeklyExecutionTask),updatedAt:'2026-10-04T08:01:00Z'}});}if(mode==='time')f.setTime('2026-10-05T10:01:00Z');if(mode==='started'){const row=(await f.store.list<Record_>('social_weekly_execution_tasks')).items[0]!;await f.store.update('social_weekly_execution_tasks',row.id,{payload:{...(row.payload as WeeklyExecutionTask),status:'succeeded'}});}await assert.rejects(f.service.confirm(mode==='foreign'?{...scope,tenantId:'foreign'}:scope,{proposalId:p.proposalId,expectedVersion:1,inputEvidenceHash:mode==='proof'?'wrong':p.inputEvidenceHash}));assert.equal(f.revisions(),0);}});
test('snapshot hashes and publication times cannot be edited after confirmation',async()=>{const f=await fixture(),p=await f.service.propose(scope,f.capacity),r=await f.service.confirm(scope,{proposalId:p.proposalId,expectedVersion:1,inputEvidenceHash:p.inputEvidenceHash});await assert.rejects(applyFrozenWeeklySchedule(f.store,'tenant',{...r.item,socialContentPackage:{...r.item.socialContentPackage,publicationTasks:[{...r.item.socialContentPackage.publicationTasks[0]!,publishWindow:'2026-10-05T08:00:00Z'}]}},f.tasks));const row=(await f.store.list<Record_>(SCHEDULE_SNAPSHOTS)).items[0]!;await f.store.update(SCHEDULE_SNAPSHOTS,row.id,{payload:{...(row.payload as any),assignments:[]}});await assert.rejects(applyFrozenWeeklySchedule(f.store,'tenant',r.item,f.tasks));assert.notEqual(row.content_hash,scheduleHash({}));});
test('real package revision materializes frozen times and resumes a partial draft without overwriting started tasks',async()=>{
 const store=memoryStore(),programs=createSocialProgramService(store),packages=createWeeklyOperatingPackageService(store);
 const program=await programs.createProgram('tenant','owner',{brandName:'Real test factory',market:'EU',targetAudience:'Buyer',candidatePlatforms:['tiktok'],route:'cold_start'});
 const account=await programs.createAccount('tenant','owner',program.programId,{platform:'tiktok',displayName:'Factory',businessRole:'core',audiencePromise:'buyer',contentPromise:'facts'});
 const original=await packages.create('tenant','owner',program.programId,{weekStart:'2026-11-09',objective:'Deliver one real publication',successCriteria:['One approved video'],accountPlans:[{accountId:account.accountId,publicationCount:1}],originalContentTarget:1});
 const source=await packages.revise('tenant','owner',program.programId,original.packageId,{expectedVersion:1,publicationTasks:original.socialContentPackage.publicationTasks.map(p=>({...p,publishWindow:'2026-11-09T09:00:00Z'}))});
 const sourceTasks=await listWeeklyExecutionTasks(store,'tenant',program.programId,source.packageId,source.version),before=structuredClone(sourceTasks);
 const ends=new Map<string,number>();const actualAssignments=sourceTasks.map(t=>{const start=t.schedule.stepKind==='publishing'?Date.parse('2026-11-09T09:00:00Z'):Math.max(Date.parse('2026-11-07T08:00:00Z'),...t.dependsOnTaskIds.map(id=>ends.get(id)??0));const finish=start+(t.schedule.stepKind==='publishing'?10:15)*60000;ends.set(t.taskId,finish);return {sourceTaskId:t.taskId,signature:scheduleTaskSignature(t),startAt:new Date(start).toISOString(),finishAt:new Date(finish).toISOString(),resourceKey:'explicit-test-capacity'};});
 const snapshot={snapshotId:'frozen-real-test',proposalId:'server-proposal',tenantId:'tenant',programId:program.programId,packageId:source.packageId,sourceVersion:source.version,targetVersion:source.version+1,confirmedBy:'owner',confirmedAt:'2026-11-07T08:00:00Z',inputEvidenceHash:'source-proof',assignments:actualAssignments,publicationTimes:source.socialContentPackage.publicationTasks.map(t=>({publicationTaskId:t.publicationTaskId,publishWindow:t.publishWindow})),capacity:{constraints:{},resources:{},remainingBudgetCny:0},previousPublishingAuthorizationAllowed:false};
 await store.create(SCHEDULE_SNAPSHOTS,{tenant_id:'tenant',snapshot_id:snapshot.snapshotId,payload:snapshot,content_hash:scheduleHash(snapshot)});
 const next=await packages.revise('tenant','owner',program.programId,source.packageId,{expectedVersion:2},{scheduleRevisionRef:{type:'weekly_schedule_snapshot',id:snapshot.snapshotId,version:1}});
 assert.equal(next.status,'draft');let rows=(await store.list<Record_>('social_weekly_execution_tasks',{where:{package_version:3},perPage:250})).items;assert.equal(rows.length,sourceTasks.length);assert.equal((rows[0]!.payload as WeeklyExecutionTask).schedule.estimatedStartAt,'2026-11-07T08:00:00.000Z');
 await store.delete('social_weekly_execution_tasks',rows[0]!.id);await materializeWeeklyExecutionTasks(store,'tenant',next);rows=(await store.list<Record_>('social_weekly_execution_tasks',{where:{package_version:3},perPage:250})).items;assert.equal(rows.length,sourceTasks.length);
 await store.update('social_weekly_execution_tasks',rows[0]!.id,{payload:{...(rows[0]!.payload as WeeklyExecutionTask),status:'leased'}});await assert.rejects(materializeWeeklyExecutionTasks(store,'tenant',next),{code:'weekly_schedule_existing_task_mismatch'});assert.deepEqual(await listWeeklyExecutionTasks(store,'tenant',program.programId,source.packageId,source.version),before);
});
test('confirmation gate excludes concurrent real worker claims and committed freeze preserves original truthful task states',async()=>{
 let entered!:()=>void,release!:()=>void;const inside=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);const f=await fixture({onRevise:async()=>{entered();await wait;}});const p=await f.service.propose(scope,f.capacity);const confirming=f.service.confirm(scope,{proposalId:p.proposalId,expectedVersion:1,inputEvidenceHash:p.inputEvidenceHash});await inside;
 const worker=createSocialWeeklyExecutionWorker(f.store);assert.equal(await worker.claimNext({tenantId:'tenant',workerId:'concurrent-worker',now:new Date('2026-10-04T08:00:00Z')}),null);release();await confirming;
 assert.equal(await worker.claimNext({tenantId:'tenant',workerId:'after-confirm-worker',now:new Date('2026-10-04T08:00:00Z')}),null);const old=(await f.store.list<Record_>('social_weekly_execution_tasks',{where:{package_version:1}})).items;assert(old.every(r=>(r.payload as WeeklyExecutionTask).status==='queued'));assert(old.every(r=>(r.payload as WeeklyExecutionTask).schedule.actualStartedAt===null));await assert.rejects(createWeeklyExecutionTaskService(f.store).block('tenant','program','package','source','new state'),{code:'weekly_execution_package_frozen'});assert((await recomputePackageExecution(f.store,'tenant','program','package',1)).every(t=>t.status==='queued'));
});
test('worker claim winning first rejects confirmation before freeze, and task mutation uses a deadlock-free gate ordering',async()=>{
 const f=await fixture(),p=await f.service.propose(scope,f.capacity),worker=createSocialWeeklyExecutionWorker(f.store);const claim=await worker.claimNext({tenantId:'tenant',workerId:'winner',now:new Date('2026-10-04T08:00:00Z')});assert(claim);await assert.rejects(f.service.confirm(scope,{proposalId:p.proposalId,expectedVersion:1,inputEvidenceHash:p.inputEvidenceHash}),{code:'weekly_schedule_proposal_stale'});assert.equal((await f.store.list(WEEKLY_EXECUTION_FREEZES)).totalItems,0);await worker.defer(claim!,{code:'real_provider_pending',message:'Real job remains pending',now:new Date('2026-10-04T08:00:01Z')});const second=await fixture();await createWeeklyExecutionTaskService(second.store).block('tenant','program','package','source','actual input missing');assert.equal((await listWeeklyExecutionTasks(second.store,'tenant','program','package',1)).find(t=>t.taskId==='source')!.status,'blocked');
});
test('failure after durable freeze leaves source unclaimed and same confirmation retries the missing draft',async()=>{
 let failOnce=true;const f=await fixture({onRevise:async()=>{if(failOnce){failOnce=false;throw Error('database unavailable before draft save');}}}),p=await f.service.propose(scope,f.capacity);const request={proposalId:p.proposalId,expectedVersion:1,inputEvidenceHash:p.inputEvidenceHash};await assert.rejects(f.service.confirm(scope,request),/database unavailable/);assert.equal((await f.store.list(WEEKLY_EXECUTION_FREEZES)).totalItems,1);assert.equal(await createSocialWeeklyExecutionWorker(f.store).claimNext({tenantId:'tenant',workerId:'no-repeat',now:new Date('2026-10-04T08:00:00Z')}),null);const recovered=await f.service.confirm(scope,request);assert.equal(recovered.item.version,2);assert.equal((await f.store.list(WEEKLY_EXECUTION_FREEZES)).totalItems,1);
});
test('a lost package gate fences the old process before any task write',async()=>{const f=await fixture();await withExecutionPackageGate(f.store,scope,async()=>{const gate=(await f.store.list<Record_>('durable_operation_leases',{where:{lease_scope:'social-weekly-execution-gate'}})).items[0]!;await f.store.delete('durable_operation_leases',gate.id);const row=await getWeeklyExecutionTaskRow(f.store,'tenant','source');await assert.rejects(writeWeeklyExecutionTask(f.store,row,{...row.payload,status:'blocked'}));assert.equal((await getWeeklyExecutionTaskRow(f.store,'tenant','source')).payload.status,'queued');});});

test('real immutable revision materializes a completed planning task as a trusted continuation without replaying its result in the new scope',async()=>{
 const store=memoryStore(),programs=createSocialProgramService(store),packages=createWeeklyOperatingPackageService(store);
 const program=await programs.createProgram('tenant','owner',{brandName:'Factory',market:'EU',targetAudience:'Buyer',candidatePlatforms:['tiktok'],route:'cold_start'});
 const account=await programs.createAccount('tenant','owner',program.programId,{platform:'tiktok',displayName:'Factory',businessRole:'core',audiencePromise:'buyer',contentPromise:'facts'});
 const original=await packages.create('tenant','owner',program.programId,{weekStart:'2026-11-09',objective:'Deliver approved video',successCriteria:['One approved video'],accountPlans:[{accountId:account.accountId,publicationCount:1}],originalContentTarget:1});
 const source=await packages.revise('tenant','owner',program.programId,original.packageId,{expectedVersion:1,publicationTasks:original.socialContentPackage.publicationTasks.map(p=>({...p,publishWindow:'2026-11-09T09:00:00Z'}))});
 const policy={profile:'b2b_cold_start',ownedPercent:0,externalPercent:100,allocationUnit:'mother_content'} as any;
 source.referenceSourcePolicy=policy;const sourcePkgRow=(await store.list<Record_>('social_weekly_operating_packages',{where:{package_id:source.packageId,version:source.version}})).items[0]!;await store.update('social_weekly_operating_packages',sourcePkgRow.id,{payload:source});
 const raw=(await store.list<Record_>('social_weekly_execution_tasks',{where:{package_id:source.packageId,package_version:source.version}})).items;
 for(const row of raw){const t=row.payload as WeeklyExecutionTask;await store.update('social_weekly_execution_tasks',row.id,{payload:{...t,inputSnapshot:{...t.inputSnapshot,referenceSourcePolicy:policy}}});}
 const sourceTasks=await listWeeklyExecutionTasks(store,'tenant',program.programId,source.packageId,source.version),completed=sourceTasks.find(t=>t.schedule.stepKind==='business_outline')!;
 const ref={type:'weekly_agent_planning',id:'actual-frozen-plan',version:99};
 await store.create('social_weekly_agent_planning',{tenant_id:'tenant',program_id:program.programId,package_id:source.packageId,package_version:source.version,planning_version:99,payload:{planningId:ref.id,version:99,status:'dispatched',referenceSourcePolicy:policy,userConfirmation:{confirmedBy:'owner',confirmedAt:'2026-10-01T00:00:00Z'},skeleton:{slots:[{slotId:'slot',referenceSource:'external',accountIds:[account.accountId],publicationTaskIds:[source.socialContentPackage.publicationTasks[0]!.publicationTaskId]}]},dispatch:{scheduleItems:[{publicationTaskId:source.socialContentPackage.publicationTasks[0]!.publicationTaskId}]},detailedSchedule:{items:[{publicationTaskId:source.socialContentPackage.publicationTasks[0]!.publicationTaskId}]}}});
 completed.status='succeeded';completed.resultRefs=[ref];completed.schedule.actualStartedAt='2026-10-01T01:00:00Z';completed.schedule.actualFinishedAt='2026-10-01T01:15:00Z';
 const completedRow=raw.find(r=>(r.payload as WeeklyExecutionTask).taskId===completed.taskId)!;await store.update('social_weekly_execution_tasks',completedRow.id,{payload:completed,status:'succeeded'});
 const {weeklyContinuationInputHash,createWeeklyExecutionContinuationService}=await import('./weeklyExecutionContinuations.js');
 const ends=new Map<string,number>();const assignments=sourceTasks.map(t=>{const done=t.taskId===completed.taskId,start=done?Date.parse(completed.schedule.actualStartedAt!):t.schedule.stepKind==='publishing'?Date.parse('2026-11-09T09:00:00Z'):Math.max(Date.parse('2026-11-07T08:00:00Z'),...t.dependsOnTaskIds.map(id=>ends.get(id)??0));const finish=done?Date.parse(completed.schedule.actualFinishedAt!):start+(t.schedule.stepKind==='publishing'?10:15)*60000;ends.set(t.taskId,finish);return {sourceTaskId:t.taskId,signature:scheduleTaskSignature(t),sourceInputHash:weeklyContinuationInputHash(t),mode:done?'completed_verified':'planned',startAt:new Date(start).toISOString(),finishAt:new Date(finish).toISOString(),resourceKey:done?null:'actual-test-capacity'};});
 const snapshot={snapshotId:'real-completed-snapshot',proposalId:'real-proposal',tenantId:'tenant',programId:program.programId,packageId:source.packageId,sourceVersion:source.version,targetVersion:source.version+1,confirmedBy:'owner',confirmedAt:'2026-10-09T01:00:00Z',inputEvidenceHash:'proof',assignments,publicationTimes:source.socialContentPackage.publicationTasks.map(t=>({publicationTaskId:t.publicationTaskId,publishWindow:t.publishWindow})),capacity:{constraints:{},resources:{},remainingBudgetCny:0},previousPublishingAuthorizationAllowed:false};
 await store.create(SCHEDULE_SNAPSHOTS,{tenant_id:'tenant',program_id:program.programId,package_id:source.packageId,target_version:snapshot.targetVersion,proposal_id:snapshot.proposalId,snapshot_id:snapshot.snapshotId,payload:snapshot,content_hash:scheduleHash(snapshot)});
 const {freezeExecutionPackage}=await import('./weeklyExecutionGate.js');await withExecutionPackageGate(store,{tenantId:'tenant',programId:program.programId,packageId:source.packageId,packageVersion:source.version},()=>freezeExecutionPackage(store,{tenantId:'tenant',programId:program.programId,packageId:source.packageId,packageVersion:source.version},{snapshotId:snapshot.snapshotId,targetVersion:source.version+1,actorUserId:'owner',inputEvidenceHash:'proof',confirmedAt:snapshot.confirmedAt}));
 const originalCreate=store.create.bind(store);let failReceipt=true;
 store.create=async(c,d)=>{if(c==='social_weekly_execution_continuations'&&failReceipt){failReceipt=false;return null;}return originalCreate(c,d);};
 await assert.rejects(packages.revise('tenant','owner',program.programId,source.packageId,{expectedVersion:source.version},{scheduleRevisionRef:{type:'weekly_schedule_snapshot',id:snapshot.snapshotId,version:1}}),{code:'weekly_continuation_storage_failed'});
 const persisted=(await store.list<Record_>('social_weekly_operating_packages',{where:{package_id:source.packageId,version:source.version+1}})).items;assert.equal(persisted.length,1,'the real draft survives receipt storage failure');
 assert((await listWeeklyExecutionTasks(store,'tenant',program.programId,source.packageId,source.version+1)).length>0,'actual task rows survive for recovery');
 await store.create('users',{id:'owner',tenantId:'tenant',role:'admin'});
 const proposal={proposalId:snapshot.proposalId,tenantId:'tenant',programId:program.programId,packageId:source.packageId,packageVersion:source.version,createdBy:'owner',createdAt:snapshot.confirmedAt,inputEvidenceHash:'proof',capacity:snapshot.capacity,plan:{},inputAuthority:'stored_tasks_with_user_confirmed_capacity_assumptions'};
 await store.create('social_weekly_schedule_proposals',{tenant_id:'tenant',proposal_id:proposal.proposalId,payload:proposal,content_hash:scheduleHash(proposal)});
 const recovered=await createWeeklyScheduleRevisionService(store).confirm({tenantId:'tenant',programId:program.programId,packageId:source.packageId,packageVersion:source.version,actorUserId:'owner'},{proposalId:proposal.proposalId,expectedVersion:source.version,inputEvidenceHash:'proof'});
 const next=recovered.item;assert.equal(next.version,source.version+1);assert.equal(recovered.activated,false);assert.equal((await store.list('social_weekly_execution_continuations')).totalItems,1);

 const target=(await listWeeklyExecutionTasks(store,'tenant',program.programId,next.packageId,next.version)).find(t=>t.schedule.stepKind==='business_outline')!;
 assert.equal(target.status,'pending_activation');assert.equal(target.resultRefs.length,0);assert.equal(target.schedule.actualFinishedAt,null);
 const continuationRef=target.inputSnapshot.weeklyContinuationRef as any;assert.equal(continuationRef.type,'weekly_execution_continuation');
 const read=await createWeeklyExecutionContinuationService(store).readValidated({tenantId:'tenant',programId:program.programId,packageId:next.packageId,targetVersion:next.version,targetTaskId:target.taskId,ref:continuationRef});assert.equal(read.status,'ready');assert.equal(read.sourceTask.taskId,completed.taskId);assert.deepEqual(read.resultRefs,[ref]);
 const {projectWeeklyContinuationCalendar}=await import('./weeklyContinuationCalendar.js');const calendar=await projectWeeklyContinuationCalendar(store,[target,{...target,inputSnapshot:{...target.inputSnapshot,weeklyContinuationRef:{type:'weekly_execution_continuation',id:'fake-receipt',version:1}}}]);assert.equal(calendar[0]!.continuationObservation?.status,'ready');assert.equal(calendar[0]!.continuationObservation?.sourceTaskId,completed.taskId);assert.equal(calendar[0]!.continuationObservation?.contentTaskId,undefined,'business completion does not invent a content production entry');assert.equal(calendar[1]!.continuationObservation?.status,'blocked');assert.equal(calendar[1]!.continuationObservation?.contentTaskId,undefined);assert.equal(calendar[0]!.resultRefs.length,0,'readonly projection never copies old result into target');
 await materializeWeeklyExecutionTasks(store,'tenant',next);assert.equal((await store.list('social_weekly_execution_continuations')).totalItems,1,'idempotent actual draft recovery retains one receipt');
 const {validateWeeklyExecutionResults}=await import('../runtime/socialWeeklyResultValidation.js');await assert.rejects(validateWeeklyExecutionResults(store,target,[ref]));await validateWeeklyExecutionResults(store,target,[continuationRef]);
});

test('confirmation freshly validates completed source evidence and freezes historical completion without remaining budget or fake new completion',async()=>{
 for(const tamper of [false,true]){const f=await fixture();const row=(await f.store.list<Record_>('social_weekly_execution_tasks',{where:{task_id:'source'}})).items[0]!;
 const completed={...f.tasks[0]!,accountId:null,publicationTaskId:null,workflowKind:'readiness' as const,schedule:{...f.tasks[0]!.schedule,stepKind:'business_outline' as const,actualStartedAt:'2026-10-01T01:00:00Z',actualFinishedAt:'2026-10-01T01:15:00Z'},status:'succeeded' as const,resultRefs:[{type:'weekly_agent_planning',id:'stored-source-plan',version:7}]};
 await f.store.update('social_weekly_execution_tasks',row.id,{payload:completed,status:'succeeded'});
 const planRow=await f.store.create<Record_>('social_weekly_agent_planning',{tenant_id:'tenant',program_id:'program',package_id:'package',package_version:1,planning_version:7,payload:{planningId:'stored-source-plan',version:7,status:'dispatched',userConfirmation:{confirmedBy:'owner',confirmedAt:'2026-10-01T00:00:00Z'},skeleton:{slots:[{slotId:'slot'}]},dispatch:{scheduleItems:[{publicationTaskId:'publication'}]},detailedSchedule:{items:[{publicationTaskId:'publication'}]}}});
 const capacity={...f.capacity,constraints:{publish:f.capacity.constraints.publish},remainingBudgetCny:10};const proposal=await f.service.propose(scope,capacity);assert.equal(proposal.plan.assignments.find(t=>t.taskId==='source')!.mode,'completed_verified');
 if(tamper){await f.store.update('social_weekly_agent_planning',planRow!.id,{payload:{...(planRow!.payload as any),status:'draft'}});await assert.rejects(f.service.confirm(scope,{proposalId:proposal.proposalId,expectedVersion:1,inputEvidenceHash:proposal.inputEvidenceHash}));assert.equal(f.revisions(),0);continue;}
 const result=await f.service.confirm(scope,{proposalId:proposal.proposalId,expectedVersion:1,inputEvidenceHash:proposal.inputEvidenceHash});const frozen=result.snapshot.assignments.find(t=>t.sourceTaskId==='source')!;assert.equal(frozen.mode,'completed_verified');assert.equal(frozen.startAt,'2026-10-01T01:00:00Z');assert.equal(frozen.resourceKey,null);assert.equal(frozen.sourceInputHash?.length,64);assert.equal(result.activated,false);
 }
});

test('a real leased source without durable remaining cost and capacity receipt remains an unavailable suggestion and cannot create a paid continuation',async()=>{
 const f=await fixture(),worker=createSocialWeeklyExecutionWorker(f.store),claim=await worker.claimNext({tenantId:'tenant',workerId:'actual-worker',now:new Date('2026-10-04T08:00:00Z')});assert(claim);
 const proposal=await f.service.propose(scope,f.capacity),source=proposal.plan.assignments.find(a=>a.taskId===claim!.task.taskId)!;assert.equal(source.mode,'unavailable');assert(source.reasons.length>0,'unknown running reservation has a concrete missing-evidence reason');
 await assert.rejects(f.service.confirm(scope,{proposalId:proposal.proposalId,expectedVersion:1,inputEvidenceHash:proposal.inputEvidenceHash}),{code:'weekly_schedule_fresh_capacity_not_feasible'});assert.equal(f.revisions(),0);assert.equal((await f.store.list(WEEKLY_EXECUTION_FREEZES)).totalItems,0);assert.equal((await f.store.list('social_weekly_execution_continuations')).totalItems,0);
 assert.equal((await listWeeklyExecutionTasks(f.store,'tenant','program','package',1)).find(t=>t.taskId===claim!.task.taskId)!.status,'leased','a missing capacity receipt never changes the running source state');
});

test('real revision refuses changed queue configuration and never treats client capacity as a replacement',async()=>{const f=await fixture(),p=await f.service.propose(scope,f.capacity);assert.match(p.plan.queueConfigurationHash!,/^[a-f0-9]{64}$/);const limit=(await f.store.list<Record_>('content_execution_limits',{where:{limit_scope:'account'}})).items[0]!;await f.store.update('content_execution_limits',limit.id,{max_running:2});await assert.rejects(f.service.confirm(scope,{proposalId:p.proposalId,expectedVersion:1,inputEvidenceHash:p.inputEvidenceHash}),{code:'weekly_schedule_queue_configuration_changed'});assert.equal(f.revisions(),0);});

test('actual historical factory upgrades to an explicit new preparation node and missing capacity cannot freeze its source',async()=>{
 const store=memoryStore(),programs=createSocialProgramService(store),packages=createWeeklyOperatingPackageService(store);
 await store.create('users',{id:'owner',tenantId:'tenant',role:'admin'});
 const program=await programs.createProgram('tenant','owner',{brandName:'Historical factory',market:'EU',targetAudience:'Buyer',candidatePlatforms:['tiktok'],route:'cold_start'});
 const account=await programs.createAccount('tenant','owner',program.programId,{platform:'tiktok',displayName:'Factory',businessRole:'core',audiencePromise:'buyer',contentPromise:'facts'});
 const created=await packages.create('tenant','owner',program.programId,{weekStart:'2026-11-09',objective:'One publication',successCriteria:['One approved video'],accountPlans:[{accountId:account.accountId,publicationCount:1}],originalContentTarget:1});
 // Represent a persisted pre-upgrade package; no completed production or source evidence is invented.
 const historical=structuredClone(created);delete historical.executionGraphVersion;
 const row=(await store.list<Record_>('social_weekly_operating_packages',{where:{package_id:created.packageId,version:created.version}})).items[0]!;
 await store.update('social_weekly_operating_packages',row.id,{payload:historical});
 for(const old of (await store.list<Record_>('social_weekly_execution_tasks',{where:{package_id:created.packageId},perPage:500})).items)await store.delete('social_weekly_execution_tasks',old.id);
 await materializeWeeklyExecutionTasks(store,'tenant',historical);
 const sourceTasks=await listWeeklyExecutionTasks(store,'tenant',program.programId,created.packageId,created.version),before=scheduleHash(sourceTasks);
 assert(!sourceTasks.some(t=>t.schedule.stepKind==='material_preparation'));
 const actualScope={tenantId:'tenant',programId:program.programId,packageId:created.packageId,packageVersion:created.version,actorUserId:'owner'},service=createWeeklyScheduleRevisionService(store,{now:()=> '2026-11-01T08:00:00Z'});
 const graph=await service.preview(actualScope),prep=graph.tasks.find(t=>t.schedule.stepKind==='material_preparation')!,script=graph.tasks.find(t=>t.schedule.stepKind==='script')!;
 assert(prep);assert(script.dependsOnTaskIds.includes(prep.taskId));assert.equal(graph.bindings.find(b=>b.planningTaskId===prep.taskId)!.sourceTaskId,null);assert.equal(graph.bindings.find(b=>b.planningTaskId===prep.taskId)!.origin,'new_planned');
 const capacity={constraints:Object.fromEntries(sourceTasks.map(t=>[t.taskId,{resourceKey:'work',remainingMinutes:10,remainingCostCny:0,bufferMinutes:0,availableAt:'2026-11-01T08:00:00Z'}])),resources:{work:{concurrency:2,workingWindows:[{startAt:'2026-11-01T08:00:00Z',finishAt:'2026-11-16T23:00:00Z'}]}},remainingBudgetCny:0};
 const proposal=await service.propose(actualScope,capacity),assignment=proposal.plan.assignments.find(a=>a.taskId===prep.taskId)!;
 assert.equal(assignment.startAt,null);assert(assignment.reasons.length>0,'new preparation requires its own explicitly confirmed capacity');
 await assert.rejects(service.confirm(actualScope,{proposalId:proposal.proposalId,expectedVersion:created.version,inputEvidenceHash:proposal.inputEvidenceHash}),{code:'weekly_schedule_fresh_capacity_not_feasible'});
 assert.equal((await store.list(WEEKLY_EXECUTION_FREEZES)).totalItems,0);assert.equal(scheduleHash(await listWeeklyExecutionTasks(store,'tenant',program.programId,created.packageId,created.version)),before);assert.equal((await store.list<Record_>('social_weekly_operating_packages',{where:{package_id:created.packageId}})).totalItems,1);
});
