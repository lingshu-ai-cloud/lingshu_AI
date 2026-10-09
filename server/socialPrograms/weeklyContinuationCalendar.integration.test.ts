import test from 'node:test';import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';import fs from 'node:fs/promises';import path from 'node:path';
import type {DataStore,ListQuery,ListResult,Record_} from '../storage/datastore.js';
import type {WeeklyExecutionTask,WeeklyOperatingPackage} from '../../shared/contracts/socialProgram.js';
import {createWeeklyExecutionContinuationService,weeklyContinuationInputHash} from './weeklyExecutionContinuations.js';
import {applyFrozenWeeklySchedule,scheduleHash,scheduleTaskSignature,SCHEDULE_SNAPSHOTS} from './weeklyScheduleSnapshots.js';
import {withExecutionPackageGate,freezeExecutionPackage} from './weeklyExecutionGate.js';
import {validateWeeklyExecutionResults} from '../runtime/socialWeeklyResultValidation.js';
import {projectWeeklyContinuationCalendar} from './weeklyContinuationCalendar.js';
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
async function contentFixture(){
 const store=memoryStore();const pub={publicationTaskId:'publication',accountId:'account',factRefs:[],publishWindow:'2026-10-12T09:00:00Z'};
 const pkg={programId:'program',packageId:'package',version:2,previousVersion:1,createdBy:'owner',socialContentPackage:{publicationTasks:[pub]},scheduleRevisionRef:{type:'weekly_schedule_snapshot',id:'snapshot',version:1}} as unknown as WeeklyOperatingPackage;
 const source={taskId:'old-weekly-task',tenantId:'tenant',programId:'program',packageId:'package',packageVersion:1,workflowKind:'content',scope:'publication',subjectId:'publication',accountId:'account',publicationTaskId:'publication',dependsOnTaskIds:[],upstreamVersionRefs:[],inputSnapshot:{publicationTask:pub},budget:{category:'none',limitCny:null},schedule:{stepKind:'video_generation',responsibleActor:'content_agent',estimatedStartAt:'2026-10-01T01:00:00Z',estimatedFinishAt:'2026-10-01T02:00:00Z',estimatedDurationMinutes:60,actualStartedAt:'2026-10-01T01:00:00Z',actualFinishedAt:'2026-10-01T02:00:00Z'},status:'succeeded',productionProgress:null,resultRefs:[{type:'starter_social_content_artifact',id:'actual-artifact',version:1}]} as unknown as WeeklyExecutionTask;
 await store.create('social_weekly_operating_packages',{tenant_id:'tenant',program_id:'program',package_id:'package',version:1,payload:{...pkg,version:1,previousVersion:null}});
 await store.create('social_weekly_operating_packages',{tenant_id:'tenant',program_id:'program',package_id:'package',version:2,payload:pkg});
 await store.create('social_weekly_execution_tasks',{tenant_id:'tenant',program_id:'program',package_id:'package',package_version:1,task_id:source.taskId,payload:source});
 const bytes=Buffer.from('actual persisted test video bytes, verified by the unchanged SHA256 storage validator');const hash=createHash('sha256').update(bytes).digest('hex'),folder=path.resolve('data/social-content-sources',`continuation-test-${randomUUID()}`),local=path.join(folder,`${hash}.mp4`);
 await fs.mkdir(folder,{recursive:true});await fs.writeFile(local,bytes);
 await store.create('starter_social_content_files',{tenant_id:'tenant',file_id:'actual-file',task_id:'original-content',usage:'artifact_media',name:'video.mp4',mime_type:'video/mp4',byte_size:bytes.length,content_sha256:hash,storage_kind:'local',storage_key:path.relative(path.resolve('data/social-content-sources'),local)});
 await store.create('starter_social_content_artifacts',{tenant_id:'tenant',artifact_id:'actual-artifact',task_id:'original-content',artifact_kind:'short_video',origin:'agent',resource_ref:'socialfile:actual-file',version:'1',status:'review_required',created_at:'2026-10-01T02:00:00Z',content:{render:{completed:true},mediaStorage:{video:{fileId:'actual-file',sha256:hash,url:'/actual-video'}}}});
 const production=await store.create<Record_>('starter_social_content_tasks',{tenant_id:'tenant',task_id:'original-content',create_idempotency_key:'weekly-production:package:1:publication',run_id:'original-run',status:'asset_review',brief:{programRef:{id:'program'}}});
 await store.create('workflow_runs',{id:'original-run',tenant_id:'tenant',status:'succeeded'});
 const snapshot={snapshotId:'snapshot',proposalId:'proposal',tenantId:'tenant',programId:'program',packageId:'package',sourceVersion:1,targetVersion:2,confirmedBy:'owner',confirmedAt:'2026-10-09T01:00:00Z',inputEvidenceHash:'actual-proof',assignments:[{sourceTaskId:source.taskId,signature:scheduleTaskSignature(source),startAt:source.schedule.actualStartedAt,finishAt:source.schedule.actualFinishedAt,resourceKey:null,mode:'completed_verified',sourceInputHash:weeklyContinuationInputHash(source)}],publicationTimes:[{publicationTaskId:pub.publicationTaskId,publishWindow:pub.publishWindow}],capacity:{constraints:{},resources:{},remainingBudgetCny:0},previousPublishingAuthorizationAllowed:false};
 await store.create(SCHEDULE_SNAPSHOTS,{tenant_id:'tenant',snapshot_id:'snapshot',payload:snapshot,content_hash:scheduleHash(snapshot)});
 await withExecutionPackageGate(store,{tenantId:'tenant',programId:'program',packageId:'package',packageVersion:1},()=>freezeExecutionPackage(store,{tenantId:'tenant',programId:'program',packageId:'package',packageVersion:1},{snapshotId:'snapshot',targetVersion:2,actorUserId:'owner',inputEvidenceHash:'actual-proof',confirmedAt:snapshot.confirmedAt}));
 const target=(await applyFrozenWeeklySchedule(store,'tenant',pkg,[{...source,taskId:'new-weekly-task',packageVersion:2,status:'pending_activation',resultRefs:[],schedule:{...source.schedule,actualStartedAt:null,actualFinishedAt:null}}]))[0]!;
 const targetRow=await store.create<Record_>('social_weekly_execution_tasks',{tenant_id:'tenant',program_id:'program',package_id:'package',package_version:2,task_id:target.taskId,payload:target});
 await validateWeeklyExecutionResults(store,source,source.resultRefs);
 const receipt=await createWeeklyExecutionContinuationService(store).ensureForTarget({tenantId:'tenant',programId:'program',packageId:'package',targetVersion:2,targetTaskId:target.taskId});assert(receipt);
 target.inputSnapshot.weeklyContinuationRef=receipt!.ref;target.upstreamVersionRefs.push(receipt!.ref);await store.update('social_weekly_execution_tasks',targetRow!.id,{payload:target});
 return {store,source,target,production:production!,local,folder,cleanup:()=>fs.rm(folder,{recursive:true,force:true})};
}

test('completed content with cleared progress navigates through the real unique original production binding and verified artifact bytes',async()=>{
 const f=await contentFixture();try{const [projected]=await projectWeeklyContinuationCalendar(f.store,[f.target]);assert.equal(projected!.continuationObservation?.status,'ready');assert.equal(projected!.continuationObservation?.contentTaskId,'original-content');assert.equal(projected!.continuationObservation?.sourceVersion,1);assert.equal(projected!.continuationObservation?.sourceActualFinishedAt,f.source.schedule.actualFinishedAt);assert.equal(projected!.continuationObservation?.sourceLatestFinishAt,f.source.schedule.estimatedFinishAt);assert.equal(projected!.schedule.actualFinishedAt,null);assert.equal(projected!.resultRefs.length,0);assert.equal(f.source.productionProgress,null);await validateWeeklyExecutionResults(f.store,f.target,[f.target.inputSnapshot.weeklyContinuationRef as any]);await assert.rejects(validateWeeklyExecutionResults(f.store,f.target,f.source.resultRefs));}finally{await f.cleanup();}
});
test('duplicate production binding never chooses a navigation destination and cross tenant artifact/source cannot be observed',async()=>{
 const f=await contentFixture();try{await f.store.create('starter_social_content_tasks',{tenant_id:'tenant',task_id:'duplicate-content',create_idempotency_key:'weekly-production:package:1:publication'});const [duplicate]=await projectWeeklyContinuationCalendar(f.store,[f.target]);assert.equal(duplicate!.continuationObservation?.contentTaskId,undefined);await f.store.update('starter_social_content_tasks',f.production.id,{tenant_id:'other-tenant'});const [foreign]=await projectWeeklyContinuationCalendar(f.store,[f.target]);assert.equal(foreign!.continuationObservation?.status,'blocked');assert.equal(foreign!.continuationObservation?.contentTaskId,undefined);}finally{await f.cleanup();}
});
test('missing persisted artifact bytes block the real completed continuation and expose no production navigation',async()=>{
 const f=await contentFixture();try{await fs.unlink(f.local);const [missing]=await projectWeeklyContinuationCalendar(f.store,[f.target]);assert.equal(missing!.continuationObservation?.status,'blocked');assert.equal(missing!.continuationObservation?.contentTaskId,undefined);}finally{await f.cleanup();}
});
