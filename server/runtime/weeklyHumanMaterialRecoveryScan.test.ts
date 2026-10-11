import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import type {DataStore,ListQuery,ListResult,Record_} from '../storage/datastore.js';import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';import {DURABLE_OPERATION_LEASE_COLLECTION} from './durableLease.js';import {WEEKLY_EXECUTION_TASKS} from '../socialPrograms/executionTasks.js';import {createWeeklyMaterialRequestService} from '../socialPrograms/weeklyMaterialRequests.js';import {listWeeklyHumanMaterialExceptions,runWeeklyHumanMaterialRecoveryScan} from './weeklyHumanMaterialRecoveryScan.js';
function memoryStore(): DataStore {
  const rows = new Map<string, Record_[]>();
  let counter = 0;
  const matches = (row: Record_, where: ListQuery['where']) => Object.entries(where ?? {}).every(([key, value]) => row[key] === value);
  return {
    async getById<T>(collection: string, id: string) {
      return structuredClone(rows.get(collection)?.find(row => row.id === id) ?? null) as T | null;
    },
    async create<T>(collection: string, data: Record<string, unknown>) {
      const list = rows.get(collection) ?? [];
      if (collection === DURABLE_OPERATION_LEASE_COLLECTION
        && list.some(row => row.tenant_id === data.tenant_id && row.lease_scope === data.lease_scope && row.subject_id === data.subject_id)) return null;
      if (collection === WEEKLY_EXECUTION_TASKS
        && list.some(row => row.tenant_id === data.tenant_id && row.idempotency_key === data.idempotency_key)) return null;
      const row = { id: `row-${++counter}`, ...structuredClone(data) } as Record_;
      rows.set(collection, [...list, row]);
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
      let list = (rows.get(collection) ?? []).filter(row => matches(row, query.where));
      if (query.sort) {
        const descending = query.sort.startsWith('-');
        const field = descending ? query.sort.slice(1) : query.sort;
        list = [...list].sort((left, right) => String(left[field] ?? '').localeCompare(String(right[field] ?? '')) * (descending ? -1 : 1));
      }
      const page = query.page ?? 1;
      const perPage = query.perPage ?? 30;
      return {
        items: structuredClone(list.slice((page - 1) * perPage, page * perPage)) as T[],
        totalItems: list.length,
        totalPages: Math.max(1, Math.ceil(list.length / perPage)),
        page,
        perPage,
      };
    },
  };
}

function task(tenantId = 'tenant-a'): WeeklyExecutionTask {
  return { taskId: 'task-a', tenantId, programId: 'program-a', packageId: 'package-a', packageVersion: 1,
    workflowKind: 'readiness', scope: 'package', subjectId: 'package-a', accountId: null, publicationTaskId: null,
    dependsOnTaskIds: [], upstreamVersionRefs: [], inputSnapshot: {}, idempotencyKey: `key-${tenantId}`,
    budget: { category: 'none', limitCny: null }, schedule: { stepKind: 'business_outline', responsibleActor: 'business_agent', estimatedDurationMinutes: 15, estimatedStartAt: '', estimatedFinishAt: '', actualStartedAt: null, actualFinishedAt: null },
    status: 'queued', ownBlockingReasons: [], inheritedBlockingTaskIds: [], attempt: 0, maxAttempts: 3,
    nextAttemptAt: null, lease: null, resultRefs: [], lastError: null, recoveredFromDeadLetterAt: null, cancelReason: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

async function setup(){const store=memoryStore();const bytes=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);const sha=createHash('sha256').update(bytes).digest('hex');const raw={id:'material0000001',tenantId:'tenant-a',scope:'own',type:'image',sha256:sha,sizeBytes:bytes.length,videoFile:'product.png',sourceType:'licensed_upload'};
 const ports={isTenantUser:async()=>true,getMaterial:async()=>raw,materialBytes:{fetch:async()=>new Response(bytes,{headers:{'content-type':'image/png'}})}};
 const service=createWeeklyMaterialRequestService(store,ports);
 async function seed(id:string,week:string){const t=task();t.taskId=id;t.packageId=week;t.workflowKind='content';t.scope='content';t.accountId='account';t.publicationTaskId='pub';t.schedule.stepKind='material_readiness';t.status='blocked';t.ownBlockingReasons=['weekly_required_materials_missing','independent_review'];t.lastError={code:'weekly_required_materials_missing',message:'missing',retryable:false,occurredAt:new Date().toISOString()};await store.create(WEEKLY_EXECUTION_TASKS,{tenant_id:t.tenantId,program_id:t.programId,package_id:week,package_version:1,task_id:id,idempotency_key:id,status:'blocked',payload:t});return t;}
 const first=await seed('first','week1'),next=await seed('next','week2');
 const request=await service.create({tenantId:first.tenantId,programId:first.programId,requirementKey:'product-proof',requirements:'product evidence',assigneeUserId:'uploader',reviewerUserId:'reviewer',dueAt:'2026-10-12T08:00:00+08:00',verificationDueAt:'2026-10-12T09:00:00+08:00',timeZone:'Asia/Shanghai',consumers:[{taskId:first.taskId,packageId:first.packageId,packageVersion:1,requirement:'front'}],actorUserId:'reviewer'});
 for(const t of [first,next])await store.create('social_weekly_operating_packages',{tenant_id:t.tenantId,program_id:t.programId,package_id:t.packageId,version:1,payload:{packageId:t.packageId,programId:t.programId,version:1,status:'active',socialContentPackage:{publicationTasks:[{publicationTaskId:'pub',accountId:'account',materialRequirement:{required:true,requestIds:[request.requestId]}}]}}});
 return {store,ports,service,request,first,next,raw};}
test('durable scanner deduplicates; explicit cross-week consumer review restores exact original tasks only',async()=>{const f=await setup();const scan=()=>runWeeklyHumanMaterialRecoveryScan({store:f.store,materialPorts:f.ports});assert.equal((await scan()).blocked,2);assert.equal((await scan()).blocked,2);assert.equal((await f.store.list('social_weekly_supplement_events')).totalItems,2);
 await f.service.submit({tenantId:f.first.tenantId,programId:f.first.programId,requestId:f.request.requestId,actorUserId:'uploader',materialRecordIds:[f.raw.id],expectedSubmissionVersion:0});const decision={taskId:'first',accepted:true,factCheck:'real product',rightsCheck:'licensed use',visualCheck:'actual front'};
 await f.service.review({tenantId:f.first.tenantId,programId:f.first.programId,requestId:f.request.requestId,actorUserId:'reviewer',submissionVersion:1,consumerDecisions:[decision]});assert.equal((await scan()).resumed,1);
 await f.service.revise({tenantId:f.first.tenantId,programId:f.first.programId,requestId:f.request.requestId,actorUserId:'reviewer',reason:'explicit week2 requirement',addConsumers:[{taskId:'next',packageId:'week2',packageVersion:1,requirement:'near label'}]});assert.equal((await scan()).resumed,0);
 await f.service.review({tenantId:f.first.tenantId,programId:f.first.programId,requestId:f.request.requestId,actorUserId:'reviewer',submissionVersion:1,consumerDecisions:[decision,{...decision,taskId:'next',visualCheck:'new actual near label'}]});assert.equal((await scan()).resumed,1);const tasks=(await f.store.list<Record_>(WEEKLY_EXECUTION_TASKS)).items.map(r=>r.payload as WeeklyExecutionTask);assert.ok(tasks.every(t=>t.ownBlockingReasons.join()==='independent_review'));assert.equal((await f.store.list('social_weekly_supplement_events')).totalItems,4);const scope={store:f.store,tenantId:f.first.tenantId,programId:f.first.programId,packageId:'week2',packageVersion:1};assert.equal((await listWeeklyHumanMaterialExceptions(scope))[0]!.status,'resolved');await assert.rejects(listWeeklyHumanMaterialExceptions({...scope,tenantId:'foreign'}),/package_invalid/);});
test('no data and altered actual hash never unlock a consumer',async()=>{assert.equal((await runWeeklyHumanMaterialRecoveryScan({store:memoryStore()})).status,'no_data');const f=await setup();await f.service.submit({tenantId:f.first.tenantId,programId:f.first.programId,requestId:f.request.requestId,actorUserId:'uploader',materialRecordIds:[f.raw.id],expectedSubmissionVersion:0});await f.service.review({tenantId:f.first.tenantId,programId:f.first.programId,requestId:f.request.requestId,actorUserId:'reviewer',submissionVersion:1,consumerDecisions:[{taskId:'first',accepted:true,factCheck:'real',rightsCheck:'licensed',visualCheck:'front'}]});f.raw.sha256='a'.repeat(64);const report=await runWeeklyHumanMaterialRecoveryScan({store:f.store,materialPorts:f.ports});assert.equal(report.resumed,0);assert.equal(report.blocked,2);});
test('old input receipt cannot unlock changed task; unknown durable create result is read back once',async()=>{const f=await setup();const create=f.store.create.bind(f.store);let writes=0;f.store.create=async<T>(collection:string,data:Record<string,unknown>)=>{const result=await create<T>(collection,data);if(collection==='social_weekly_supplement_events'){writes++;throw Error('lost response');}return result;};const first=await runWeeklyHumanMaterialRecoveryScan({store:f.store,materialPorts:f.ports});assert.equal(first.failed,0);assert.equal(writes,2);const row=(await f.store.list<Record_>(WEEKLY_EXECUTION_TASKS,{where:{task_id:'first'}})).items[0]!;const t=row.payload as WeeklyExecutionTask;await f.store.update(WEEKLY_EXECUTION_TASKS,row.id,{payload:{...t,inputSnapshot:{changed:true}}});await f.service.submit({tenantId:f.first.tenantId,programId:f.first.programId,requestId:f.request.requestId,actorUserId:'uploader',materialRecordIds:[f.raw.id],expectedSubmissionVersion:0});await f.service.review({tenantId:f.first.tenantId,programId:f.first.programId,requestId:f.request.requestId,actorUserId:'reviewer',submissionVersion:1,consumerDecisions:[{taskId:'first',accepted:true,factCheck:'real',rightsCheck:'licensed',visualCheck:'front'}]});assert.equal((await runWeeklyHumanMaterialRecoveryScan({store:f.store,materialPorts:f.ports})).resumed,0);assert.equal(writes,2);});
