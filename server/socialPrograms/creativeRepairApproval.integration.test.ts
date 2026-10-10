import test from 'node:test';
import assert from 'node:assert/strict';
import type {WeeklyExecutionTask} from '../../shared/contracts/socialProgram.js';
import type {WeeklyProductionRepairCase} from '../../shared/contracts/weeklyProductionRepairCase.js';
import {socialRequestHash} from '../starter198/socialContentValidation.js';
import {WEEKLY_PRODUCTION_REPAIR_CASES} from './weeklyProductionRepairCases.js';
import {createWeeklyExecutionTaskService} from './executionTasks.js';

import {creativeRepairApprovalFixture as fixture} from './creativeRepairApproval.fixture.js';

const approve=(f:Awaited<ReturnType<typeof fixture>>)=>createWeeklyExecutionTaskService(f.store).approve('t','p','week1',f.approval.taskId,'owner');

test('resolved creative child is approved without rewriting parent quality history and repeated approval is idempotent',async t=>{
 const f=await fixture(t),history=structuredClone(f.quality);
 await approve(f);
 assert.equal(f.readApproval().status,'succeeded');
 assert(f.readApproval().resultRefs.some(r=>r.type==='starter_social_content_artifact'&&r.id==='artifact'));
 assert.equal(f.childArtifact.status,'approved');
 assert.equal(f.parentArtifact.status,'changes_requested');
 assert.deepEqual(f.quality,history);
 const operations=f.tables.starter_social_content_operations!.length;
 await approve(f);assert.equal(f.tables.starter_social_content_operations!.length,operations);
});

test('changed child artifact cannot be approved',async t=>{
 const f=await fixture(t);f.childArtifact.content_hash='f'.repeat(64);
 await assert.rejects(approve(f));assert.notEqual(f.readApproval().status,'succeeded');
 assert.equal(f.parentArtifact.status,'changes_requested');
});

test('resolved creative evidence for a different approval case cannot authorize this approval',async t=>{
 const f=await fixture(t),item=f.caseRow.payload as WeeklyProductionRepairCase;
 const {recordHash,...body}=item,nextBody={...body,approvalTaskId:'other-approval'},next={...nextBody,recordHash:socialRequestHash(nextBody)};
 Object.assign(f.caseRow,{payload:next,content_hash:socialRequestHash(next)});
 await assert.rejects(approve(f));assert.notEqual(f.readApproval().status,'succeeded');
});

test('artifact approval written before task settlement can retry without another artifact decision',async t=>{
 const f=await fixture(t),update=f.store.update.bind(f.store);let interrupt=true;
 f.store.update=async(collection,id,value)=>{
  if(interrupt&&collection==='social_weekly_execution_tasks'&&id==='approval-row'&&(value.payload as WeeklyExecutionTask)?.status==='succeeded'){
   interrupt=false;throw new Error('simulated approval settlement interruption');
  }
  return update(collection,id,value);
 };
 await assert.rejects(approve(f),/simulated approval settlement interruption/);
 assert.equal(f.childArtifact.status,'approved');assert.notEqual(f.readApproval().status,'succeeded');
 const decisions=f.tables.starter_social_content_operations!.filter(r=>r.operation==='decide_social_content_artifact'&&r.target_id==='content').length;
 await approve(f);assert.equal(f.readApproval().status,'succeeded');
 assert.equal(f.tables.starter_social_content_operations!.filter(r=>r.operation==='decide_social_content_artifact'&&r.target_id==='content').length,decisions);
});

test('without a creative revision the original production approval path remains available',async t=>{
 const f=await fixture(t);f.tables[WEEKLY_PRODUCTION_REPAIR_CASES]=[];
 f.tables.starter_social_content_tasks=f.tables.starter_social_content_tasks!.filter(r=>r.task_id==='content');
 f.tables.starter_social_content_artifacts=f.tables.starter_social_content_artifacts!.filter(r=>r.task_id==='content');
 const child=f.tables.starter_social_content_tasks[0]!;child.create_idempotency_key='weekly-production:week1:1:pub';
 delete (child.brief as Record<string,unknown>)._weeklyCreativeRepairProof;
 const content=f.childArtifact.content as any;content.productionResult.technicalReview.approved=true;content.productionResult.creativeReview.approved=true;
 f.childArtifact.content_hash=socialRequestHash({resourceRef:f.childArtifact.resource_ref,content});f.tables.starter_social_production_receipts=[];
 const qualityRow=f.tables.social_weekly_execution_tasks!.find(r=>r.task_id===f.quality.taskId)!;
 (qualityRow.payload as WeeklyExecutionTask).resultRefs=[{type:'starter_social_content_artifact',id:'artifact',version:1}];
 await approve(f);assert.equal(f.readApproval().status,'succeeded');assert.equal(f.childArtifact.status,'approved');
});

for (const [name,mutate] of [
 ['child version',(f:Awaited<ReturnType<typeof fixture>>)=>{f.childArtifact.version='9';}],
 ['execution run',(f:Awaited<ReturnType<typeof fixture>>)=>{f.tables.starter_social_content_tasks!.find(r=>r.task_id==='content')!.run_id='other-run';}],
 ['execution job',(f:Awaited<ReturnType<typeof fixture>>)=>{f.tables.content_execution_jobs!.find(r=>r.id==='creative-job')!.run_id='other-run';}],
] as const) {
 test(`approval rejects drift in ${name} without accepting parent or child`,async t=>{
  const f=await fixture(t);mutate(f);
  await assert.rejects(approve(f),(error:any)=>String(error.code).startsWith('weekly_creative_repair_'));
  assert.notEqual(f.readApproval().status,'succeeded');assert.equal(f.childArtifact.status,'review_required');
  assert.equal(f.parentArtifact.status,'changes_requested');
 });
}
