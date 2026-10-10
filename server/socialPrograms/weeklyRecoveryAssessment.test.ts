import assert from 'node:assert/strict';
import test from 'node:test';
import type { WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';
import { assessWeeklyRecovery, type WeeklyRecoveryInput } from './weeklyRecoveryAssessment.js';
const now='2026-10-04T08:00:00Z';
function task(id:string,parents:string[]=[],publicationId:string|null=null,actor='content_agent'):WeeklyExecutionTask {
 return {tenantId:'tenant',programId:'program',packageId:'package',packageVersion:1,ownBlockingReasons:[],inheritedBlockingTaskIds:[],taskId:id,dependsOnTaskIds:parents,publicationTaskId:publicationId,status:'queued',schedule:{stepKind:publicationId?'publishing':actor==='user'?'user_approval':'video_generation',responsibleActor:actor,latestStartAt:'2026-10-04T16:00:00Z',latestFinishAt:'2026-10-04T18:00:00Z'}} as unknown as WeeklyExecutionTask;
}
function input(tasks:WeeklyExecutionTask[]):WeeklyRecoveryInput {
 return {tasks,changedTaskIds:['shared'],now,remainingBudgetCny:100,resources:{content:{concurrency:1,workingWindows:[{startAt:now,finishAt:'2026-10-04T18:00:00Z'}]},human:{concurrency:1,workingWindows:[{startAt:'2026-10-05T09:00:00Z',finishAt:'2026-10-05T17:00:00Z'}]}},constraints:Object.fromEntries(tasks.map(t=>[t.taskId,{resourceKey:t.schedule.responsibleActor==='user'?'human':'content',remainingMinutes:60,remainingCostCny:10,bufferMinutes:0,availableAt:now}]))};
}
test('only actual consumers inherit a shared-material interruption; independent publication remains possible',()=> {
 const tasks=[task('shared'),task('a',['shared']),task('pa',['a'],'p1'),task('other'),task('pb',['other'],'p2')];
 const request=input(tasks); request.constraints.shared!.unresolvedReasons=['material_verification_pending'];
 const before=JSON.stringify(request);
 const result=assessWeeklyRecovery(request);
 assert.deepEqual(result.affectedTaskIds,['a','pa','shared']);
 assert.deepEqual(result.affectedPublicationIds,['p1']);
 assert.equal(result.publications.find(p=>p.publicationId==='p1')!.conditionallyReachable,false);
 assert.equal(result.publications.find(p=>p.publicationId==='p2')!.conditionallyReachable,true);
 assert.equal(result.publicationGap,1);
 assert.equal(result.revisionApplied,false);
 assert.equal(JSON.stringify(request),before);
});
test('real resource concurrency and explicit buffers change achievable quantities',()=> {
 const tasks=[task('shared'),task('pa',['shared'],'p1'),task('pb',['shared'],'p2')];
 const request=input(tasks); tasks[0]!.status='succeeded';
 request.resources.content!.workingWindows=[{startAt:now,finishAt:'2026-10-04T10:00:00Z'}];
 for(const t of tasks.slice(1)) { t.schedule.latestFinishAt='2026-10-04T10:00:00Z'; request.constraints[t.taskId]!.bufferMinutes=30; }
 const serial=assessWeeklyRecovery(request);
 assert.equal(serial.conditionallyReachableCount,1);
 assert(serial.proposedActions.includes('confirm_capacity_or_window_revision'));
 request.resources.content!.concurrency=2;
 assert.equal(assessWeeklyRecovery(request).conditionallyReachableCount,2);
});
test('approval respects actual human work windows and never becomes verified by a forecast',()=> {
 const request=input([task('shared'),task('approve',['shared'],null,'user'),task('publish',['approve'],'p1')]);
 const late=assessWeeklyRecovery(request);
 assert.equal(late.conditionallyReachableCount,0);
 assert(late.publications[0]!.reasons.includes('human_completion_not_verified'));
 request.resources.human!.workingWindows=[{startAt:now,finishAt:'2026-10-04T18:00:00Z'}];
 const possible=assessWeeklyRecovery(request);
 assert.equal(possible.conditionallyReachableCount,1);
 assert(possible.publications[0]!.reasons.includes('human_completion_not_verified'));
 assert.equal(request.tasks[1]!.status,'queued');
});
test('budget shortage blocks additional production and recommends explicit budget revision',()=> {
 const request=input([task('shared'),task('publish',['shared'],'p1')]);
 request.remainingBudgetCny=10;
 const result=assessWeeklyRecovery(request);
 assert.equal(result.reservedCostCny,10);
 assert.equal(result.publicationGap,1);
 assert(result.proposedActions.includes('confirm_budget_revision'));
 assert.equal(result.confirmationRequired,true);
});
test('missing remaining work and invalid graphs fail without inventing readiness',()=> {
 const request=input([task('shared'),task('publish',['shared'],'p1')]);
 delete request.constraints.shared;
 assert.equal(assessWeeklyRecovery(request).conditionallyReachableCount,0);
 request.tasks[0]!.dependsOnTaskIds=['publish'];
 assert.throws(()=>assessWeeklyRecovery(request),/cycle/);
 request.tasks[0]!.dependsOnTaskIds=['absent'];
 assert.throws(()=>assessWeeklyRecovery(request),/Missing/);
});
test('leased work reserves shared provider capacity before queued work',()=> {
 const request=input([task('shared'),task('publish',[],'p1')]);
 request.tasks[0]!.status='leased';
 request.constraints.shared!.remainingMinutes=120;
 request.tasks[1]!.schedule.latestStartAt='2026-10-04T07:00:00Z';
 const result=assessWeeklyRecovery(request);
 assert.equal(result.forecast.find(t=>t.taskId==='publish')!.startAt,'2026-10-04T10:00:00.000Z');
});

test('persisted blockers cannot be bypassed by omitted constraint reasons and mixed authority is rejected',()=> {
 const request=input([task('shared'),task('publish',['shared'],'p1')]);
 request.tasks[0]!.status='blocked'; request.tasks[0]!.ownBlockingReasons=['required_upload_missing'];
 const result=assessWeeklyRecovery(request);
 assert.equal(result.conditionallyReachableCount,0);
 assert(result.proposedActions.includes('resolve_inputs'));
 request.tasks[1]!.tenantId='other';
 assert.throws(()=>assessWeeklyRecovery(request),/authority identity/);
});

test('duplicate publishing identities cannot inflate target or reachable quantities',()=> {
 const request=input([task('shared'),task('a',['shared'],'p1'),task('b',['shared'],'p1')]);
 assert.throws(()=>assessWeeklyRecovery(request),/Duplicate recovery publication/);
});
