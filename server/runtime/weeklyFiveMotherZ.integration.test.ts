import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareFiveMotherProductionFixture} from './weeklyFiveMotherProduction.fixture.js';
test('Z five mothers share one persisted weekly package and one unresolved preparation barrier',async t=>{
 const f=await prepareFiveMotherProductionFixture(t);
 assert.equal(f.pkg.referenceSourcePolicy?.ownedPercent,0);
 assert.equal(f.pkg.referenceSourcePolicy?.externalPercent,100);
 assert.equal(f.dispatched.skeleton.slots.length,5);
 assert.equal(f.dispatched.directorAnalyses.length,5);
 assert.equal(new Set(f.pkg.socialContentPackage.publicationTasks.map(p=>p.motherContentId)).size,5);
 assert.ok(f.tasks.every(task=>task.packageId===f.pkg.packageId&&task.packageVersion===f.pkg.version));
 const barriers=f.tasks.filter(task=>task.inputSnapshot?.sharedMaterialBarrier);
 assert.equal(barriers.length,1);
 const scripts=f.tasks.filter(task=>task.schedule.stepKind==='script');assert.equal(scripts.length,5);
 assert.ok(scripts.every(task=>task.dependsOnTaskIds.includes(barriers[0]!.taskId)));
 assert.equal(f.request.consumers.filter(c=>c.packageVersion===f.pkg.version).length,5);assert.equal(f.request.consumers.length,10);assert.equal(f.pkg.status,'active');assert.equal(f.confirmation.materialConsumerRepairs?.length??0,0);assert.equal(f.request.status,'missing');
 assert.equal(f.f.tables.content_execution_jobs?.length??0,0);
 assert.equal(f.f.tables.social_publication_attempts?.length??0,0);
});
test('Z repeated external benchmark admits five distinct mother production tasks',async t=>{
 const setup=await prepareFiveMotherProductionFixture(t);
 const {createSocialWeeklyProductionAdapter}=await import('./socialWeeklyProductionAdapter.js');
 const adapter=createSocialWeeklyProductionAdapter(setup.f.store,{repository:setup.repository});
 for(const task of setup.tasks.filter(task=>task.schedule.stepKind==='material_preparation')){
  const output=await adapter.execute(task);
  assert.equal(output.status,'blocked',JSON.stringify(output));
  if(output.status==='blocked')assert.equal(output.code,'weekly_required_materials_missing',JSON.stringify(output));
 }
 const actual=setup.f.tables.starter_social_content_tasks!.filter(row=>String(row.create_idempotency_key).startsWith(`weekly-production:${setup.pkg.packageId}:${setup.pkg.version}:`));
 assert.equal(actual.length,5);
 assert.equal(new Set(actual.map(row=>row.task_id)).size,5);
 for(const task of actual){const sources=setup.f.tables.starter_social_task_sources!.filter(source=>source.task_id===task.task_id&&source.status==='active');assert.equal(sources.length,1);assert.equal(sources[0]!.source_kind,'reference_link');assert.ok(!task.run_id);}
 assert.equal(setup.f.tables.content_execution_jobs?.length??0,0,'material preparation cannot fabricate running production');
});
