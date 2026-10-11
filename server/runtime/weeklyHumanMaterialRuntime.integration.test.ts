import {updateTenantEnterpriseProfile} from '../routes/enterprise.js';import {store as routeStore} from '../storage/index.js';
import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import type {DataStore,ListQuery,ListResult,Record_} from '../storage/datastore.js';import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';import {DURABLE_OPERATION_LEASE_COLLECTION} from './durableLease.js';import {WEEKLY_EXECUTION_TASKS} from '../socialPrograms/executionTasks.js';import {createWeeklyMaterialRequestService} from '../socialPrograms/weeklyMaterialRequests.js';import express from 'express';import {runSocialWeeklyExecutionScan} from './socialWeeklyExecutionRuntime.js';import {createSocialWeeklySupplementRequestsRouter} from '../routes/socialWeeklySupplementRequests.js';
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
test('formal runtime material block to upload and independent verification to original consumer recovery; HTTP readback is authenticated and read only',async t=>{
 const f=await setup();for(const key of ['list','getById','create','update','delete'] as const)t.mock.method(routeStore,key,f.store[key].bind(f.store));await f.store.create('users',{id:'owner',tenantId:f.first.tenantId,role:'social_operator',active:true});const profile=await updateTenantEnterpriseProfile(f.first.tenantId,{company:{name:'Real factory',industry:'manufacturing',description:'Verified factory',mainMarkets:'US',primaryLanguages:'en',founded:'2018'},products:{categories:'industrial',items:[],priceRange:'',moq:'',certifications:'',highlights:'Product proof'}},'owner');const packageRows=(await f.store.list<Record_>('social_weekly_operating_packages')).items;for(const p of packageRows){const payload=p.payload as {socialContentPackage:{publicationTasks:Array<Record<string,unknown>>}};payload.socialContentPackage.publicationTasks[0]!.factRefs=[{type:'enterprise_fact',id:profile.factVersion!.id,version:profile.factVersion!.revision}];await f.store.update('social_weekly_operating_packages',p.id,{payload});}const taskRows=(await f.store.list<Record_>(WEEKLY_EXECUTION_TASKS)).items;for(const row of taskRows){if(row.task_id==='next'){await f.store.delete(WEEKLY_EXECUTION_TASKS,row.id);continue;}const original=row.payload as WeeklyExecutionTask;await f.store.update(WEEKLY_EXECUTION_TASKS,row.id,{status:'queued',payload:{...original,status:'queued',ownBlockingReasons:[],lastError:null}});}
 await f.store.create('social_weekly_agent_planning',{tenant_id:f.first.tenantId,program_id:f.first.programId,package_id:'week1',package_version:1,planning_version:1,payload:{planningId:'plan',version:1,packageId:'week1',packageVersion:1,status:'dispatched',userConfirmation:{},dispatch:{packageVersion:1,detailedScheduleRef:{id:'schedule',version:1},scheduleItems:[]},detailedSchedule:{ref:{id:'schedule',version:1}},skeleton:{slots:[{slotId:'slot',motherContentId:'mother',accountIds:['account'],publicationTaskIds:['pub']}]},directorAnalyses:[]}});
 let calls=0;const scan=()=>runSocialWeeklyExecutionScan({dataStore:f.store,humanMaterialPorts:f.ports,maxTasksPerTenant:1,adapters:{material_readiness:{async execute(){calls++;return {status:'blocked' as const,code:'weekly_required_materials_missing',message:'real required material awaiting human verification'};}}}});
 const first=await scan();assert.equal(first.blocked,1,JSON.stringify({first,tasks:await f.store.list(WEEKLY_EXECUTION_TASKS)}));assert.equal(calls,1);assert.equal(first.humanMaterialAfterExecution.materialized,1);assert.equal((await f.store.list('social_weekly_supplement_events')).totalItems,1);
 await f.service.submit({tenantId:f.first.tenantId,programId:f.first.programId,requestId:f.request.requestId,actorUserId:'uploader',materialRecordIds:[f.raw.id],expectedSubmissionVersion:0});assert.equal((await scan()).humanMaterialRecovery.resumed,0);
 await f.service.review({tenantId:f.first.tenantId,programId:f.first.programId,requestId:f.request.requestId,actorUserId:'reviewer',submissionVersion:1,consumerDecisions:[{taskId:'first',accepted:true,factCheck:'actual product verified',rightsCheck:'independently verified license',visualCheck:'actual front visible'}]});
 const recovered=await runSocialWeeklyExecutionScan({dataStore:f.store,humanMaterialPorts:f.ports,maxTasksPerTenant:0,adapters:{}});assert.equal(recovered.humanMaterialRecovery.resumed,1,JSON.stringify(recovered));const live=(await f.store.list<Record_>(WEEKLY_EXECUTION_TASKS)).items[0]!.payload as WeeklyExecutionTask;assert.equal(live.taskId,'first');assert.equal(live.status,'queued');assert.deepEqual(live.ownBlockingReasons,[]);assert.equal(calls,1);
 await f.store.create('social_weekly_operating_packages',{tenant_id:f.first.tenantId,program_id:f.first.programId,package_id:'week1',version:2,payload:{programId:f.first.programId,packageId:'week1',version:2,status:'draft',socialContentPackage:{publicationTasks:[]}}});
 let tenant:string|undefined=f.first.tenantId,user:string|undefined='owner';const app=express();app.use((_req,res,next)=>{res.locals.tenantId=tenant;res.locals.userId=user;next();});app.use('/:programId/:packageId',createSocialWeeklySupplementRequestsRouter(f.store));app.use((error:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(409).json({error:error.message}));const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));const address=server.address();assert.ok(address&&typeof address==='object');const base=`http://127.0.0.1:${address.port}`;const route=`/${f.first.programId}/week1/scheduler-exceptions`;
 let writes=0;f.store.create=async()=>{writes++;throw Error('read_created');};f.store.update=async()=>{writes++;throw Error('read_updated');};f.store.delete=async()=>{writes++;throw Error('read_deleted');};
 const response=await fetch(`${base}${route}?version=1`),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.items.length,1);assert.equal(body.items[0].type,'human_material_exception');assert.equal(body.items[0].status,'resolved');assert.equal(body.items[0].consumerTaskId,'first');assert.equal(body.items[0].materials[0].sha256,f.raw.sha256);
 const otherVersion=await fetch(`${base}${route}?version=2`);assert.equal(otherVersion.status,200);assert.deepEqual((await otherVersion.json()).items,[]);assert.equal((await fetch(`${base}${route}?version=3`)).status,409);assert.equal((await fetch(`${base}/wrong/week1/scheduler-exceptions?version=1`)).status,409);tenant='foreign';assert.equal((await fetch(`${base}${route}?version=1`)).status,403);tenant=f.first.tenantId;user=undefined;assert.equal((await fetch(`${base}${route}?version=1`)).status,401);assert.equal(writes,0);
});
