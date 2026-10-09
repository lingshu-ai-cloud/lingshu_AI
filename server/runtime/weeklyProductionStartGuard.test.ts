import test from 'node:test';import assert from 'node:assert/strict';
import type {DataStore,Record_,ListQuery} from '../storage/datastore.js';
import {createStarter198Repository,STARTER_COLLECTIONS} from '../starter198/repository.js';
import {startSocialContentTask} from '../starter198/socialContentTasks.js';
import {withWeeklyProductionStartGuard} from './weeklyProductionStartGuard.js';
function memory(): DataStore {
  const data = new Map<string, Record_[]>();
  return {
    async getById<T>(c: string, id: string) { return structuredClone(data.get(c)?.find(r => r.id === id) ?? null) as T | null; },
    async list<T>(c: string, q: ListQuery = {}) { const rows = (data.get(c) ?? []).filter(r => Object.entries(q.where ?? {}).every(([k,v]) => r[k] === v)); return { items: structuredClone(rows) as T[], totalItems: rows.length, totalPages: 1, page: 1, perPage: q.perPage ?? 30 }; },
    async create<T>(c: string, d: Record<string, unknown>) { const rows = data.get(c) ?? []; const row = { id: `${c}-${rows.length}`, ...structuredClone(d) }; data.set(c, [...rows, row]); return structuredClone(row) as T; },
    async update(c: string, id: string, d: Record<string, unknown>) { const row = data.get(c)?.find(r => r.id === id); if (!row) return false; Object.assign(row, structuredClone(d)); return true; },
    async delete(c: string, id: string) { data.set(c,(data.get(c) ?? []).filter(r => r.id !== id)); return true; },
  };
}

test('actual start entry refuses weekly creation receipt with removed scope before queue enqueue',async()=>{
 const store=memory(),repository=createStarter198Repository(store);let queued=0;
 await repository.create(STARTER_COLLECTIONS.socialContentTasks,'tenant',{task_id:'task',create_idempotency_key:'weekly-production:package:1:publication',brief:{},status:'draft',version:'v1'});
 await assert.rejects(startSocialContentTask({repository,tenantId:'tenant',userId:'owner',taskId:'task',expectedVersion:'v1',idempotencyKey:'start',orchestratorQueue:{enqueue:async()=>{queued++;throw new Error('unexpected');}}}),/weekly_production_start_authority_invalid/);
 assert.equal(queued,0);
});
test('ordinary nonweekly production remains outside weekly gate',async()=>{
 const store=memory(),repository=createStarter198Repository(store);let called=0;
 await repository.create(STARTER_COLLECTIONS.socialContentTasks,'tenant',{task_id:'task',create_idempotency_key:'ordinary',brief:{},status:'draft',version:'v1'});
 await withWeeklyProductionStartGuard({repository,tenantId:'tenant',taskId:'task'},async()=>{called++;return {} as never;});assert.equal(called,1);
});

test('actual weekly start cannot create a run while confirmation holds the same package gate',async()=>{
 const store=memory(),repository=createStarter198Repository(store);let queued=0;
 const pub={publicationTaskId:'publication'},workflow={taskRef:{type:'weekly_workflow_task',id:'workflow',version:1}};
 const pkg={programId:'program',packageId:'package',version:1,workflowTasks:[workflow],socialContentPackage:{publicationTasks:[pub]}};
 await store.create('social_weekly_operating_packages',{tenant_id:'tenant',program_id:'program',package_id:'package',version:1,payload:pkg});
 await repository.create(STARTER_COLLECTIONS.socialContentTasks,'tenant',{task_id:'task',create_idempotency_key:'weekly-production:package:1:publication',brief:{_weeklyAuthority:{weeklyPackage:pkg,programRef:{id:'program'},publicationTask:pub,weeklyWorkflowTask:workflow}},status:'draft',version:'v1'});
 const {withExecutionPackageGate}=await import('../socialPrograms/weeklyExecutionGate.js');
 const {AsyncResource}=await import('node:async_hooks');const independent=new AsyncResource('independent-http-request');
 await withExecutionPackageGate(store,{tenantId:'tenant',programId:'program',packageId:'package',packageVersion:1},async()=>{
  // AsyncLocalStorage inheritance is deliberately removed to model another HTTP request.
  const result=await independent.runInAsyncScope(()=>startSocialContentTask({repository,tenantId:'tenant',userId:'owner',taskId:'task',expectedVersion:'v1',idempotencyKey:'start',orchestratorQueue:{enqueue:async()=>{queued++;throw new Error('unexpected');}}}));
  return result;
 }).then(()=>assert.fail('must reject')).catch(e=>assert.equal(e.code,'weekly_execution_package_gate_busy'));
 assert.equal(queued,0);
});

async function guardedFixture(){
 const store=memory(),repository=createStarter198Repository(store);
 const workflow={taskId:'workflow',kind:'content',taskRef:{type:'weekly_workflow_task',id:'workflow',version:1},dependsOnTaskIds:[],subjectRefs:[],carriedFromTaskId:null,status:'planned',ownBlockingReasons:[],inheritedBlockingTaskIds:[]};
 const pub={publicationTaskId:'publication',status:'planned'};
 const item={publicationTaskId:'publication',slotId:'slot',scheduleItemId:'item'},ref={type:'weekly_detailed_schedule',id:'details',version:1};const planning={programId:'program',packageId:'package',packageVersion:1,status:'dispatched',skeleton:{packageId:'package',packageVersion:1,slots:[{slotId:'slot',publicationTaskIds:['publication']}]},detailedSchedule:{ref,items:[item]},userConfirmation:{confirmedBy:'owner',confirmedAt:'2026-10-09T00:00:00Z'},dispatch:{packageId:'package',packageVersion:1,detailedScheduleRef:ref,scheduleItems:[item],scheduleItemIds:['item']}};const pkg={programId:'program',packageId:'package',version:1,workflowTasks:[workflow],socialContentPackage:{publicationTasks:[pub]},agentPlanning:planning};await store.create('social_weekly_agent_planning',{tenant_id:'tenant',program_id:'program',package_id:'package',package_version:1,planning_version:1,payload:planning});
 await store.create('social_programs',{tenant_id:'tenant',program_id:'program',payload:{version:1}});
 const packageRow=await store.create<any>('social_weekly_operating_packages',{tenant_id:'tenant',program_id:'program',package_id:'package',version:1,payload:pkg});
 const taskRow=await repository.create(STARTER_COLLECTIONS.socialContentTasks,'tenant',{task_id:'task',create_idempotency_key:'weekly-production:package:1:publication',brief:{_weeklyAuthority:{weeklyPackage:pkg,programRef:{id:'program',version:1},publicationTask:pub,weeklyWorkflowTask:workflow}},status:'draft',version:'v1'});
 const {buildSocialContentAuthorityLineage}=await import('../starter198/socialContentLineage.js');
 const lineage=buildSocialContentAuthorityLineage({version:'1',programRef:{type:'social_program',id:'program',version:1},packageRef:{type:'weekly_operating_package',id:'package',version:1},weeklyTaskRef:workflow.taskRef,publicationTaskRef:{type:'weekly_publication_task',id:'publication',version:1},businessGoalRef:{type:'business_content_goal',id:'goal',version:1},enterpriseProfileRef:{type:'enterprise_profile',id:'enterprise',version:1},enterpriseFactRefs:[],referenceSelectionRef:{type:'reference_selection',id:'reference',version:1},candidateEvidenceRefs:[],inspirationHandoffs:[],directorBrief:{directorBriefId:'brief',version:'1'} as any});
 await repository.create(STARTER_COLLECTIONS.socialContentLineage,'tenant',{weekly_task_id:'workflow',payload:lineage,record_hash:lineage.recordHash});
 return {store,repository,pkg,taskRow,packageRow};
}
test('same version aggregate workflow and publication status changes preserve new start business identity',async()=>{
 const f=await guardedFixture();await f.store.update('social_weekly_operating_packages',f.packageRow.id,{payload:{...f.pkg,workflowTasks:[{...f.pkg.workflowTasks[0],status:'running',ownBlockingReasons:['observed']}],socialContentPackage:{publicationTasks:[{...f.pkg.socialContentPackage.publicationTasks[0],status:'ready'}]}}});let starts=0;
 await withWeeklyProductionStartGuard({repository:f.repository,tenantId:'tenant',taskId:'task'},async()=>{starts++;return {} as never;});assert.equal(starts,1);
});
test('existing true run remains readonly when program head or workflow state changes',async()=>{
 const f=await guardedFixture();await f.repository.update(STARTER_COLLECTIONS.socialContentTasks,'tenant',f.taskRow.id,{run_id:'actual-run'});const program=(await f.store.list<any>('social_programs')).items[0];await f.store.update('social_programs',program.id,{payload:{version:2}});await f.store.update('social_weekly_operating_packages',f.packageRow.id,{payload:{...f.pkg,workflowTasks:[{...f.pkg.workflowTasks[0],status:'blocked'}]}});let starts=0;
 const result=await withWeeklyProductionStartGuard({repository:f.repository,tenantId:'tenant',taskId:'task'},async()=>{starts++;throw Error('must not start');},{read:async()=>({taskId:'task',runId:'actual-run'} as any)});assert.equal(starts,0);assert.equal(result.runId,'actual-run');
});

test('manual weekly start rereads live planning and refuses confirmation drift before queue creation',async()=>{const f=await guardedFixture();const row=(await f.store.list<any>('social_weekly_agent_planning')).items[0];await f.store.update('social_weekly_agent_planning',row.id,{payload:{...f.pkg.agentPlanning,userConfirmation:null}});let starts=0;await assert.rejects(()=>withWeeklyProductionStartGuard({repository:f.repository,tenantId:'tenant',taskId:'task'},async()=>{starts++;return {} as never;}),{code:'weekly_production_dispatch_unconfirmed'});assert.equal(starts,0);});
