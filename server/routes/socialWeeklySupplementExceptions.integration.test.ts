import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type {DataStore,ListQuery,ListResult,Record_} from '../storage/datastore.js';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import {DURABLE_OPERATION_LEASE_COLLECTION} from '../runtime/durableLease.js';
import {WEEKLY_EXECUTION_TASKS} from '../socialPrograms/executionTasks.js';
import {materializeWeeklySupplementException} from '../runtime/weeklySupplementExceptionMaterializer.js';
import {createSocialWeeklySupplementRequestsRouter} from './socialWeeklySupplementRequests.js';
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


test('scheduler-exceptions HTTP verifies actor and reads only exact tenant/package/version',async t=>{
 const store=memoryStore(),consumer=task();consumer.status='blocked';consumer.schedule.estimatedStartAt='2026-10-12T00:00:00Z';consumer.lastError={code:'facebook_account_not_connected',message:'account needed',retryable:false,occurredAt:'2026-10-10T00:00:00Z'};consumer.ownBlockingReasons=[consumer.lastError.code];
 await store.create('users',{id:'owner',tenantId:consumer.tenantId,role:'admin'});
 await store.create('users',{id:'foreign-user',tenantId:'foreign',role:'admin'});
 await store.create('users',{id:'disabled-user',tenantId:consumer.tenantId,role:'admin',disabled:true});
 await store.create(WEEKLY_EXECUTION_TASKS,{tenant_id:consumer.tenantId,program_id:consumer.programId,package_id:consumer.packageId,package_version:1,task_id:consumer.taskId,status:consumer.status,payload:consumer});
 await store.create('social_weekly_operating_packages',{tenant_id:consumer.tenantId,program_id:consumer.programId,package_id:consumer.packageId,version:1,payload:{programId:consumer.programId,packageId:consumer.packageId,version:1,status:'active'}});
 await store.create('social_weekly_operating_packages',{tenant_id:consumer.tenantId,program_id:consumer.programId,package_id:consumer.packageId,version:2,payload:{programId:consumer.programId,packageId:consumer.packageId,version:2,status:'draft'}});
 await materializeWeeklySupplementException({store,task:consumer,gapCode:consumer.lastError.code});
 let tenant: string|undefined=consumer.tenantId,user: string|undefined='owner';
 const app=express();app.use((_req,res,next)=>{res.locals.tenantId=tenant;res.locals.userId=user;next();});app.use('/:programId/:packageId',createSocialWeeklySupplementRequestsRouter(store));app.use((error:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(409).json({error:error.message}));
 const server=app.listen(0);await new Promise<void>(resolve=>server.once('listening',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));const address=server.address();assert.ok(address&&typeof address==='object');const url=`http://127.0.0.1:${address.port}/${consumer.programId}/${consumer.packageId}/scheduler-exceptions`;
 const create=store.create,update=store.update,del=store.delete;let writes=0;store.create=async()=>{writes++;throw Error('read_must_not_create');};store.update=async()=>{writes++;throw Error('read_must_not_update');};store.delete=async()=>{writes++;throw Error('read_must_not_delete');};
 try{
 const response=await fetch(`${url}?version=1`),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.items.length,1);assert.equal(body.items[0].consumerTaskId,consumer.taskId);assert.equal(body.items[0].dueAt,consumer.schedule.estimatedStartAt);
 assert.equal((await fetch(`${url}?version=2`)).status,200);assert.deepEqual((await (await fetch(`${url}?version=2`)).json()).items,[]);
 assert.equal((await fetch(`${url}?version=3`)).status,409);
 assert.equal((await fetch(`${url}?version=01`)).status,400);assert.equal((await fetch(`${url}?version=invalid`)).status,400);
 for(const candidate of ['missing-user','foreign-user','disabled-user']){user=candidate;assert.equal((await fetch(`${url}?version=1`)).status,403,`actor ${candidate} must not read scheduler exceptions`);}
 user='owner';const event=(await store.list<Record_>('social_weekly_supplement_events')).items[0]!;const foreign={...(event.payload as Record<string,unknown>),tenantId:'foreign'};await update.call(store,'social_weekly_supplement_events',event.id,{payload:foreign});assert.equal((await fetch(`${url}?version=1`)).status,409,'foreign event payload is rejected');await update.call(store,'social_weekly_supplement_events',event.id,{payload:event.payload});
 user=undefined;assert.equal((await fetch(`${url}?version=1`)).status,401);user='owner';tenant='foreign';assert.equal((await fetch(`${url}?version=1`)).status,403);assert.equal(writes,0);
 }finally{store.create=create;store.update=update;store.delete=del;}
});
