import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareFiveMotherProductionFixture} from './weeklyFiveMotherProduction.fixture.js';
import {prepareFiveMotherOwnedReferenceFixture} from './weeklyFiveMotherOwnedReference.fixture.js';
import {createSocialWeeklyProductionAdapter,weeklyProductionBindingKey} from './socialWeeklyProductionAdapter.js';
for(const percentage of [40,20] as const)test(`H ${percentage}/${100-percentage} five mothers retain owned metrics/tone bind five real content tasks and retain shared-material prerequisite gate`,async t=>{
 const seed=await prepareFiveMotherOwnedReferenceFixture(t,percentage);
 const {f,pkg,repository,dispatched,tasks:graph,request}=await prepareFiveMotherProductionFixture(t,seed);
 const {referenceIds,ownedReferenceIds}=seed;
 assert.equal(request.consumers.filter(row=>row.packageVersion===pkg.version).length,5);
 assert.equal(dispatched.skeleton.slots.length,5);
 const own=dispatched.skeleton.slots.filter(slot=>slot.referenceSource==='owned');assert.equal(own.length,percentage/20);
 const selected=new Set<string>();
 for(const slot of dispatched.skeleton.slots){const analysis=dispatched.directorAnalyses.find(row=>row.slotId===slot.slotId)!;const id=analysis.benchmarkVideoRefs[0]!.id;assert.ok(referenceIds.includes(id));assert.equal(ownedReferenceIds.includes(id),slot.referenceSource==='owned');selected.add(id);if(slot.referenceSource==='owned'){assert.equal(analysis.historicalPerformance?.snapshotRef.id,`metric-${id}`);const metric=seed.f.tables.social_channel_metric_snapshots!.find(row=>row.external_content_id===id)?.snapshot as {metrics?:unknown}|undefined;assert.deepEqual(analysis.historicalPerformance?.metrics,metric?.metrics);assert.equal(analysis.ownedReferenceDiagnosis?.toneStatus,'verified');assert.equal(analysis.ownedReferenceDiagnosis?.performanceStatus,'complete');}}
 assert.equal(selected.size,5,'each mother must use a different verified source');
 const adapter=createSocialWeeklyProductionAdapter(f.store,{repository});
 for(const publication of pkg.socialContentPackage.publicationTasks){const task=graph.find(row=>row.publicationTaskId===publication.publicationTaskId&&row.schedule.stepKind==='material_readiness')!;assert.ok(task);assert.ok(task.dependsOnTaskIds.length);
 const result=await adapter.execute(task);const created=f.tables.starter_social_content_tasks!.filter(row=>row.create_idempotency_key===weeklyProductionBindingKey(task));assert.equal(created.length,1,JSON.stringify(result));assert.equal(result.status,'blocked');if(result.status==='blocked')assert.equal(result.code,'weekly_required_materials_missing',JSON.stringify(result));}
 assert.equal(new Set(f.tables.starter_social_content_tasks!.map(row=>row.task_id)).size,5);assert.equal(f.tables.starter_usage_ledger?.length??0,0);
});

test('same owned and external references bind independently to five content tasks after task-scoped source-key fix',async t=>{
 const {f,pkg,repository,referenceIds,ownedReferenceIds}=await prepareFiveMotherOwnedReferenceFixture(t,40);
 const {planWeeklyExecutionTasks}=await import('../socialPrograms/executionTasks.js');
 const graph=planWeeklyExecutionTasks('t',pkg,'2026-10-02T00:00:00Z');
 for(const task of graph)await f.store.create('social_weekly_execution_tasks',{tenant_id:'t',program_id:'p',package_id:pkg.packageId,package_version:pkg.version,task_id:task.taskId,status:task.status,payload:task});
 const adapter=createSocialWeeklyProductionAdapter(f.store,{repository});
 const tasks=graph.filter(task=>task.schedule.stepKind==='material_readiness');assert.equal(tasks.length,5);
 for(const task of tasks){
  assert.ok(task.dependsOnTaskIds.length,'formal graph dependencies remain intact');
  const result=await adapter.execute(task);assert.equal(result.status,'blocked');
  if(result.status==='blocked')assert.equal(result.code,'weekly_required_materials_missing',JSON.stringify(result));
  const created=f.tables.starter_social_content_tasks!.filter(row=>row.create_idempotency_key===weeklyProductionBindingKey(task));assert.equal(created.length,1);
  const slot=pkg.agentPlanning!.skeleton.slots.find(row=>row.publicationTaskIds.includes(task.publicationTaskId!))!;
  const source=f.tables.starter_social_task_sources!.filter(row=>row.task_id===created[0]!.task_id&&row.source_kind==='reference_link');assert.equal(source.length,1);
  const analysis=pkg.agentPlanning!.directorAnalyses.find(row=>row.slotId===slot.slotId)!;const id=analysis.benchmarkVideoRefs[0]!.id;assert.ok(referenceIds.includes(id));assert.equal(ownedReferenceIds.includes(id),slot.referenceSource==='owned');const reference=f.tables.trend_videos!.find(row=>row.id===id)!;assert.equal(source[0]!.source_ref,reference.sourceUrl);
  const mutation=f.tables.starter_social_content_operations!.filter(row=>row.operation==='add_social_task_source'&&row.target_id===created[0]!.task_id);assert.equal(mutation.length,1);assert.equal(mutation[0]!.status,'succeeded');assert.ok(String(mutation[0]!.idempotency_key).includes(String(created[0]!.task_id)));
 }
 assert.equal(new Set(f.tables.starter_social_task_sources!.filter(row=>row.source_kind==='reference_link').map(row=>row.task_id)).size,5);
 assert.equal(f.tables.starter_usage_ledger?.length??0,0);
});
