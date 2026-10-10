import {runSocialWeeklyExecutionScan} from './socialWeeklyExecutionRuntime.js';
import test from 'node:test';import assert from 'node:assert/strict';import type {DataStore,ListQuery,ListResult,Record_} from '../storage/datastore.js';import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';import {DURABLE_OPERATION_LEASE_COLLECTION} from './durableLease.js';import {WEEKLY_EXECUTION_TASKS} from '../socialPrograms/executionTasks.js';import {listWeeklySupplementExceptions,materializeWeeklySupplementException,runWeeklySupplementExceptionScan} from './weeklySupplementExceptionMaterializer.js';import {sealAccountCredential} from '../lib/accountCredentials.js';
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

test('durable blocked account gap deduplicates, fresh proof restores original consumer only',async()=>{
process.env.PLATFORM_TOKEN_ENCRYPTION_KEY='scheduler-test-only';const store=memoryStore(),t=task();t.workflowKind='publishing';t.accountId='account';t.publicationTaskId='pub';t.schedule.stepKind='publishing';t.schedule.estimatedStartAt='2026-10-12T00:00:00Z';t.schedule.estimatedFinishAt='2026-10-12T01:00:00Z';t.status='blocked';t.ownBlockingReasons=['facebook_account_not_connected','independent_quality_gap'];t.lastError={code:'facebook_account_not_connected',message:'authorization required',retryable:false,occurredAt:new Date().toISOString()};
await store.create(WEEKLY_EXECUTION_TASKS,{tenant_id:t.tenantId,program_id:t.programId,package_id:t.packageId,package_version:1,task_id:t.taskId,status:t.status,payload:t});await store.create('social_weekly_operating_packages',{tenant_id:t.tenantId,program_id:t.programId,package_id:t.packageId,version:1,payload:{packageId:t.packageId,programId:t.programId,version:1,status:'active',socialContentPackage:{publicationTasks:[{publicationTaskId:'pub',accountId:'account',platform:'facebook'}]}}});
const now=new Date();await store.create('social_accounts',{id:'account',tenantId:t.tenantId,platform:'facebook',status:'disconnected',providerAccountId:'page',scope:'pages_manage_posts',accessToken:sealAccountCredential('controlled')});
const originalCreate=store.create.bind(store);let failInitial=true;store.create=async<T>(collection:string,data:Record<string,unknown>)=>{if(collection==='social_weekly_supplement_events'&&data.version===2&&failInitial){failInitial=false;return null;}return originalCreate<T>(collection,data);};await assert.rejects(materializeWeeklySupplementException({store,task:t,gapCode:t.lastError!.code,now}),/supplement_exception_write_failed/);const a=await materializeWeeklySupplementException({store,task:t,gapCode:t.lastError.code,now});assert.equal(a?.status,'assignment_pending');assert.equal(a?.dueAt,t.schedule.estimatedStartAt);await materializeWeeklySupplementException({store,task:t,gapCode:t.lastError.code,now});assert.equal((await store.list('social_weekly_supplement_events')).totalItems,1);
assert.equal((await runSocialWeeklyExecutionScan({dataStore:store,adapters:{},now,maxTasksPerTenant:0})).supplementRecovery.resolved,0);await store.update('social_accounts','account',{status:'connected'});await store.create('social_platform_capability_evidence',{tenant_id:t.tenantId,account_id:'account',platform:'facebook',capability:'publishing.official',status:'verified',evidence_source:'provider_probe',evidence_ref:'provider:facebook:account:page',verified_at:now.toISOString(),expires_at:new Date(now.getTime()+600000).toISOString()});let failResolution=true;store.create=async<T>(collection:string,data:Record<string,unknown>)=>{if(collection==='social_weekly_supplement_events'&&data.version===3&&failResolution){failResolution=false;return null;}return originalCreate<T>(collection,data);};assert.equal((await runSocialWeeklyExecutionScan({dataStore:store,adapters:{},now,maxTasksPerTenant:0})).supplementRecovery.failed,1);assert.ok(((await store.list<Record_>(WEEKLY_EXECUTION_TASKS)).items[0]!.payload as WeeklyExecutionTask).ownBlockingReasons.includes(t.lastError!.code));assert.equal((await runSocialWeeklyExecutionScan({dataStore:store,adapters:{},now,maxTasksPerTenant:0})).supplementRecovery.resolved,1);const updated=(await store.list<Record_>(WEEKLY_EXECUTION_TASKS)).items[0]!.payload as WeeklyExecutionTask;assert.equal(updated.taskId,t.taskId);assert.deepEqual(updated.ownBlockingReasons,['independent_quality_gap']);assert.equal(updated.status,'blocked');assert.equal((await store.list('social_weekly_supplement_events')).totalItems,2);assert.equal((await store.list('social_weekly_supplement_requests')).totalItems,0);const scope={store,tenantId:t.tenantId,programId:t.programId,packageId:t.packageId,packageVersion:1};assert.equal((await listWeeklySupplementExceptions(scope))[0]?.status,'resolved');const persisted=(await store.list<Record_>('social_weekly_supplement_events',{where:{version:3}})).items[0]!;await store.update('social_weekly_supplement_events',persisted.id,{payload:JSON.stringify(persisted.payload)});assert.equal((await listWeeklySupplementExceptions(scope)).length,1,'JSON payload is decoded');await store.update('social_weekly_supplement_events',persisted.id,{tenant_id:'other-tenant'});await assert.rejects(listWeeklySupplementExceptions(scope),/supplement_exception_resolution_corrupt/);await store.update('social_weekly_supplement_events',persisted.id,{tenant_id:t.tenantId});const changedSchedule={...updated,schedule:{...updated.schedule,estimatedStartAt:'2026-10-13T00:00:00Z'}};const consumerRow=(await store.list<Record_>(WEEKLY_EXECUTION_TASKS)).items[0]!;await store.update(WEEKLY_EXECUTION_TASKS,consumerRow.id,{payload:changedSchedule});await assert.rejects(listWeeklySupplementExceptions(scope),/supplement_exception_consumer_changed/);
});

function planning() {
  return { planningId: 'planning-a', version: 4, programId: 'program-a', packageId: 'package-a', packageVersion: 1, status: 'dispatched',
    skeleton: { skeletonId: 'skeleton', packageId: 'package-a', packageVersion: 1, generatedBy: 'business_agent', tokenCost: 0, slots: [{ slotId: 'slot', motherContentId: 'mother', publicationTaskIds: ['pub'], accountIds: ['account'], platforms: ['tiktok'], plannedPublishWindows: [], objective: 'goal', quantity: 1 }], createdAt: '' },
    directorAnalyses: [], detailedSchedule: { ref: { type: 'detailed_schedule', id: 'schedule', version: 1 }, mergedBy: 'business_agent', items: [], createdAt: '' },
    userConfirmation: { confirmedBy: 'user', confirmedAt: '' }, dispatch: { dispatchId: 'dispatch', packageId: 'package-a', packageVersion: 1, issuedBy: 'business_agent', assignedTo: 'content_agent', detailedScheduleRef: { type: 'detailed_schedule', id: 'schedule', version: 1 }, scheduleItemIds: [], scheduleItems: [], issuedAt: '' }, createdAt: '', updatedAt: '' };
}

test('formal scheduler blocked outcome materializes one durable authorization exception',async()=>{
 const store=memoryStore(),t=task();t.workflowKind='publishing';t.publicationTaskId='pub';t.accountId='account';t.schedule.stepKind='publishing';t.schedule.estimatedStartAt='2026-10-12T00:00:00Z';t.schedule.estimatedFinishAt='2026-10-12T01:00:00Z';
 await store.create('social_weekly_operating_packages',{tenant_id:t.tenantId,program_id:t.programId,package_id:t.packageId,version:1,payload:{packageId:t.packageId,programId:t.programId,version:1,status:'active',socialContentPackage:{publicationTasks:[{publicationTaskId:'pub',accountId:'account',platform:'facebook'}]}}});await store.create('social_weekly_agent_planning',{tenant_id:t.tenantId,program_id:t.programId,package_id:t.packageId,package_version:1,planning_version:4,payload:planning()});await store.create(WEEKLY_EXECUTION_TASKS,{tenant_id:t.tenantId,program_id:t.programId,package_id:t.packageId,package_version:1,task_id:t.taskId,status:t.status,payload:t});
 const result=await runSocialWeeklyExecutionScan({dataStore:store,now:new Date('2026-10-12T00:00:00Z'),maxTasksPerTenant:1,adapters:{publishing:{async execute(){return {status:'blocked',code:'facebook_account_not_found',message:'missing actual account'};}}}});assert.equal(result.blocked,1);const exceptions=await listWeeklySupplementExceptions({store,tenantId:t.tenantId,programId:t.programId,packageId:t.packageId,packageVersion:1});assert.equal(exceptions.length,1);assert.equal(exceptions[0]?.consumerTaskId,t.taskId);assert.equal(exceptions[0]?.status,'assignment_pending');
});
