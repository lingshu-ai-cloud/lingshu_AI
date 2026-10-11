import assert from 'node:assert/strict';
import {readContentExecutionJob} from '../contentExecution/durableQueue.js';
import {readSocialTaskDetail} from '../starter198/socialContentRecords.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import type {executeFiveMotherWeek} from './weeklyFiveMotherExecution.fixture.js';
/** Recheck actual producer output through the same weekly adapter. No output,
 * approval, runtime artifact or run is created by these assertions. */
export async function assertFiveMotherAdapterEvidence(f:Awaited<ReturnType<typeof executeFiveMotherWeek>>){
 const runIds=new Set<string>(),artifactIds=new Set<string>();
 for(const task of f.graph.filter(task=>task.schedule.stepKind==='asset_generation')){
  const row=f.f.tables.starter_social_content_tasks?.find(row=>row.create_idempotency_key===`weekly-production:${f.pkg.packageId}:${f.pkg.version}:${task.publicationTaskId}`);
  assert.ok(row);assert.ok(row.run_id);
  const detail=await readSocialTaskDetail({repository:f.repository,tenantId:task.tenantId,taskId:String(row.task_id)});assert.ok(detail);
  const run=f.f.tables.workflow_runs?.find(run=>run.id===row.run_id);assert.ok(run);assert.equal(run.tenant_id,task.tenantId);assert.equal(run.status,'waiting_external','generated output awaits the actual user approval');
  assert.equal(detail.status,'asset_review');
  const job=await readContentExecutionJob(f.f.store,task.tenantId,String(row.task_id),String(row.run_id));assert.ok(job);assert.equal(job.status,'succeeded','durable production must finish before approval');
  const handoff=f.presupplyHandoffs.find(handoff=>handoff.taskId===String(row.task_id));assert.ok(handoff,'actual script stage must retain its formally validated handoff');assert.equal(handoff.tenantId,task.tenantId);assert.equal(handoff.runId,row.run_id);assert.equal(handoff.packageId,task.packageId);assert.equal(handoff.packageVersion,task.packageVersion);assert.equal(handoff.publicationTaskId,task.publicationTaskId);
  const {recordHash,...handoffPayload}=handoff;assert.equal(recordHash,socialRequestHash(handoffPayload),'verified handoff snapshot must remain unchanged');
  assert.match(handoff.recordHash,/^[a-f0-9]{64}$/);
  const artifact=detail.artifacts.find(artifact=>task.resultRefs.some(ref=>ref.type==='starter_social_content_artifact'&&ref.id===artifact.artifactId&&ref.version===Number(artifact.version)));
  assert.ok(artifact,'actual generated artifact must match the completed task result');assert.equal(artifact.taskId,detail.taskId);assert.ok(artifact.resourceRef);assert.ok(artifact.content?.render);
  runIds.add(String(row.run_id));artifactIds.add(artifact.artifactId);
 }
 assert.equal(runIds.size,5);assert.equal(artifactIds.size,5);
 const runsBefore=f.f.tables.workflow_runs?.length??0;
 const jobsBefore=f.f.tables.content_execution_jobs?.length??0;
 const createdBefore=f.f.tables.starter_social_content_tasks?.length??0;
 for(const stepKind of ['material_readiness','asset_generation','quality_check'] as const){
  const tasks=f.graph.filter(task=>task.schedule.stepKind===stepKind);
  assert.equal(tasks.length,5,`five actual ${stepKind} tasks required`);
  for(const task of tasks){
   assert.equal(task.status,'succeeded');
   const result=await f.adapter.execute(task);
   assert.equal(result.status,'succeeded',JSON.stringify({stepKind,taskId:task.taskId,result}));
   if(result.status==='succeeded')assert.ok(result.resultRefs.length,'the successful poll must retain actual evidence refs');
  }
 }
 assert.equal(f.f.tables.workflow_runs?.length??0,runsBefore,'polling verified results must reuse the paid runs');
 assert.equal(f.f.tables.content_execution_jobs?.length??0,jobsBefore,'polling must not admit replacement jobs');
 assert.equal(f.f.tables.starter_social_content_tasks?.length??0,createdBefore,'polling must reuse the actual content tasks');
}
