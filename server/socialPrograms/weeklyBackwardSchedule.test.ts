import assert from 'node:assert/strict';
import test from 'node:test';
import type { WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';
import { planWeeklyBackwardSchedule, backwardTaskEvidenceFingerprint, type WeeklyBackwardScheduleInput } from './weeklyBackwardSchedule.js';
import {createHash} from 'node:crypto';
const now='2026-10-04T08:00:00Z';
function task(id:string,parents:string[]=[],publicationId:string|null=null):WeeklyExecutionTask {
 return {tenantId:'tenant',programId:'program',packageId:'package',packageVersion:1,ownBlockingReasons:[],inheritedBlockingTaskIds:[],taskId:id,dependsOnTaskIds:parents,publicationTaskId:publicationId,status:'queued',schedule:{stepKind:publicationId?'publishing':'video_generation',responsibleActor:'content_agent',latestStartAt:publicationId?'2026-10-05T09:00:00Z':null,latestFinishAt:publicationId?'2026-10-05T10:00:00Z':'2026-10-04T18:00:00Z'}} as unknown as WeeklyExecutionTask;
}
function input(tasks:WeeklyExecutionTask[]):WeeklyBackwardScheduleInput {
 return {tasks,now,remainingBudgetCny:100,resources:{content:{concurrency:1,workingWindows:[{startAt:now,finishAt:'2026-10-04T18:00:00Z'},{startAt:'2026-10-05T08:00:00Z',finishAt:'2026-10-05T18:00:00Z'}]}},constraints:Object.fromEntries(tasks.map(t=>[t.taskId,{resourceKey:'content',remainingMinutes:60,remainingCostCny:10,bufferMinutes:0,availableAt:now}]))};
}
test('real backward allocation moves shared preparation before earliest actual consumers and preserves publication time',()=>{
 const request=input([task('shared'),task('a',['shared']),task('b',['shared']),task('pa',['a'],'p1'),task('pb',['b'],'p2')]);request.resources.content!.concurrency=2;
 const before=JSON.stringify(request),result=planWeeklyBackwardSchedule(request);
 assert.equal(result.conditionallyReachableCount,2);assert.equal(result.reservedCostCny,50);
 const rows=new Map(result.assignments.map(row=>[row.taskId,row]));
 assert(rows.get('shared')!.finishAt!<=rows.get('a')!.startAt!);assert(rows.get('shared')!.finishAt!<=rows.get('b')!.startAt!);
 assert.equal(rows.get('pa')!.startAt,'2026-10-05T09:00:00.000Z');assert.equal(JSON.stringify(request),before);assert.equal(result.revisionApplied,false);
});
test('completed status without fresh verified result and actual timestamps never becomes completion at now',()=>{
 const request=input([task('done'),task('pub',['done'],'p1')]);request.tasks[0]!.status='succeeded';
 let result=planWeeklyBackwardSchedule(request);assert.equal(result.publicationGap,1);assert.equal(result.assignments.find(row=>row.taskId==='done')!.startAt,null);
 const done=request.tasks[0]!;done.schedule.actualStartedAt='2026-10-04T06:00:00Z';done.schedule.actualFinishedAt='2026-10-04T07:00:00Z';done.resultRefs=[{type:'actual_video',id:'real-output',version:1}];
 request.completedEvidence={done:{taskFingerprint:backwardTaskEvidenceFingerprint(done),verifiedAt:now,actualStartedAt:done.schedule.actualStartedAt,actualFinishedAt:done.schedule.actualFinishedAt,resultRefs:done.resultRefs}};
 result=planWeeklyBackwardSchedule(request);assert.equal(result.publicationGap,0);assert.equal(result.reservedCostCny,10);assert.equal(result.assignments.find(row=>row.taskId==='done')!.mode,'completed_verified');assert.equal(result.assignments.find(row=>row.taskId==='done')!.finishAt,'2026-10-04T07:00:00Z');
 done.inputSnapshot={changedFact:true};assert.equal(planWeeklyBackwardSchedule(request).publicationGap,1,'changed immutable inputs invalidate reuse evidence');
});
function runningInput() {
 const request=input([task('running'),task('pub',['running'],'p1')]),running=request.tasks[0]!;
 running.status='leased';running.schedule.actualStartedAt='2026-10-04T07:30:00Z';running.lease={leaseId:'lease',token:'actual-secret-token',workerId:'worker',acquiredAt:'2026-10-04T07:30:00Z',expiresAt:'2026-10-04T10:00:00Z'};
 request.observedReservations={running:{taskFingerprint:backwardTaskEvidenceFingerprint(running),verifiedAt:now,actualStartedAt:running.schedule.actualStartedAt,leaseId:'lease',leaseTokenHash:createHash('sha256').update(running.lease.token).digest('hex'),leaseExpiresAt:running.lease.expiresAt,expectedFinishAt:'2026-10-04T09:00:00Z',resourceKey:'content',remainingCostCny:10}};
 return request;
}
test('live observed production keeps its original start and reserves real capacity before new work',()=>{
 const request=runningInput();request.tasks.push(task('other'));request.tasks.at(-1)!.schedule.latestFinishAt='2026-10-04T09:00:00Z';request.constraints.other={...request.constraints.running!};
 const result=planWeeklyBackwardSchedule(request),running=result.assignments.find(row=>row.taskId==='running')!;
 assert.equal(running.mode,'running_reserved');assert.equal(running.startAt,'2026-10-04T07:30:00Z');assert.equal(running.finishAt,'2026-10-04T09:00:00Z');assert.equal(result.assignments.find(row=>row.taskId==='other')!.startAt,null,'already-running capacity cannot be given to a new task');
 assert.equal(result.reservedCostCny,20);assert.equal(request.tasks[0]!.status,'leased');
});
test('expired or stale leases block; forecasts beyond a live lease explicitly require renewal',()=>{
 const request=runningInput();request.observedReservations!.running!.verifiedAt='2026-10-04T07:59:59Z';assert.equal(planWeeklyBackwardSchedule(request).publicationGap,1);
 request.observedReservations!.running!.verifiedAt=now;const running=request.tasks[0]!;running.lease!.expiresAt='2026-10-04T08:30:00Z';request.observedReservations!.running!.leaseExpiresAt=running.lease!.expiresAt;request.observedReservations!.running!.taskFingerprint=backwardTaskEvidenceFingerprint(running);
 let result=planWeeklyBackwardSchedule(request);assert.equal(result.publicationGap,0);assert(result.publications[0]!.reasons.includes('running_lease_renewal_required'));
 running.lease!.expiresAt=now;request.observedReservations!.running!.leaseExpiresAt=now;request.observedReservations!.running!.taskFingerprint=backwardTaskEvidenceFingerprint(running);result=planWeeklyBackwardSchedule(request);assert.equal(result.publicationGap,1);
});
test('running output that will finish after its publication slot is not predicted reachable',()=>{
 const request=runningInput();request.tasks[1]!.schedule.latestStartAt='2026-10-04T08:00:00Z';request.tasks[1]!.schedule.latestFinishAt='2026-10-04T09:00:00Z';request.resources.content!.concurrency=2;
 const result=planWeeklyBackwardSchedule(request);assert.equal(result.publicationGap,1);assert(result.publications[0]!.reasons.includes('dependency_finish_after_consumer_start'));
});
test('a deferred task with prior production start cannot silently become unstarted work',()=>{
 const request=input([task('prior-run'),task('pub',['prior-run'],'p1')]);request.tasks[0]!.schedule.actualStartedAt='2026-10-04T07:00:00Z';
 const result=planWeeklyBackwardSchedule(request);assert.equal(result.publicationGap,1);assert(result.publications[0]!.reasons.includes('started_work_requires_verified_continuation'));
});
test('running reservation requires known server-observed remaining cost and rejects understated user budget assumptions',()=>{
 const request=runningInput();request.constraints.running!.remainingCostCny=0;
 assert(planWeeklyBackwardSchedule(request).publications[0]!.reasons.includes('running_remaining_cost_understated'));
 request.constraints.running!.remainingCostCny=10;request.observedReservations!.running!.remainingCostCny=undefined as any;
 assert.equal(planWeeklyBackwardSchedule(request).publicationGap,1);
});
test('capacity collision never publishes earlier to disguise an impossible simultaneous goal',()=>{
 const request=input([task('pa',[],'p1'),task('pb',[],'p2')]);
 const result=planWeeklyBackwardSchedule(request);assert.equal(result.conditionallyReachableCount,1);assert.equal(result.publicationGap,1);
 assert.equal(result.assignments.filter(row=>row.startAt).length,1);
 request.resources.content!.concurrency=2;assert.equal(planWeeklyBackwardSchedule(request).publicationGap,0);
});
test('one Agent cannot gain fictional parallel capacity by using multiple resource keys',()=>{
 const tasks=[task('a'),task('b')];
 tasks.forEach(item=>item.schedule.latestFinishAt='2026-10-04T10:00:00Z');
 const request=input(tasks);
 request.constraints.b={...request.constraints.b!,resourceKey:'content-second-column'};
 request.resources['content-second-column']={concurrency:1,workingWindows:[{startAt:now,finishAt:'2026-10-04T10:00:00Z'}]};
 assert.throws(()=>planWeeklyBackwardSchedule(request),/one capacity resource/i,'columns do not create another content Agent');
 request.tasks[1]!.schedule.responsibleActor='quality_agent';
 const separateAgents=planWeeklyBackwardSchedule(request);
 assert.equal(separateAgents.assignments.filter(row=>row.mode==='planned').length,2,'a distinct Agent may use its own confirmed work window');
});
test('human nonworking days and missing estimates block without fabricating capacity',()=>{
 const tasks=[task('human'),task('render',['human']),task('pub',['render'],'p1')];tasks[0]!.schedule.responsibleActor='user';
 const request=input(tasks);request.constraints.human!.resourceKey='human';request.resources.human={concurrency:1,workingWindows:[{startAt:'2026-10-05T09:00:00Z',finishAt:'2026-10-05T17:00:00Z'}]};
 const result=planWeeklyBackwardSchedule(request);assert.equal(result.publicationGap,1);assert(result.publications[0]!.reasons.includes('human_completion_not_verified'));
 delete request.constraints.human;assert(planWeeklyBackwardSchedule(request).publications[0]!.reasons.includes('remaining_work_evidence_required'));
});
test('explicit budget, buffers, release times and blockers are enforced',()=>{
 const request=input([task('source'),task('pub',['source'],'p1')]);request.remainingBudgetCny=10;
 assert.equal(planWeeklyBackwardSchedule(request).publicationGap,1);
 request.remainingBudgetCny=100;request.constraints.source!.availableAt='2026-10-04T17:30:00Z';request.constraints.source!.bufferMinutes=30;
 assert.equal(planWeeklyBackwardSchedule(request).publicationGap,1);
 request.constraints.source!.availableAt=now;request.tasks[0]!.ownBlockingReasons=['rights_unverified'];assert(planWeeklyBackwardSchedule(request).publications[0]!.reasons.includes('rights_unverified'));
});
test('mixed authority, invalid concrete dates, cycles and duplicate targets are rejected',()=>{
 const request=input([task('source'),task('pub',['source'],'p1')]);request.tasks[0]!.tenantId='other';assert.throws(()=>planWeeklyBackwardSchedule(request),/authority/);
 request.tasks[0]!.tenantId='tenant';request.now='2026-02-30T09:00:00Z';assert.throws(()=>planWeeklyBackwardSchedule(request),/timestamp/);
 request.now=now;request.tasks[0]!.dependsOnTaskIds=['pub'];assert.throws(()=>planWeeklyBackwardSchedule(request),/cycle/);
});
function operatingInput() {
 const tasks=[task('pub',[],'p1'),task('observe',['pub']),task('review',['observe'])];
 tasks[1]!.schedule.stepKind='performance_monitoring';tasks[2]!.schedule.stepKind='weekly_review';
 for(const task of tasks.slice(1))task.schedule.latestFinishAt=null;
 const request=input(tasks);request.frozenOperationalWeek={weekStart:'2026-10-05',weekEnd:'2026-10-11'};
 request.resources.content!.workingWindows=[{startAt:'2026-10-05T08:00:00Z',finishAt:'2026-10-05T18:00:00Z'},{startAt:'2026-10-11T08:00:00Z',finishAt:'2026-10-11T18:00:00Z'},{startAt:'2026-10-12T00:00:00Z',finishAt:'2026-10-12T04:00:00Z'}];
 return request;
}
test('real full publication-monitoring-review graph needs explicit operational deadlines and retains dependency order',()=>{
 const request=operatingInput();assert.equal(planWeeklyBackwardSchedule(request).fullGraphConditionallyReachable,false);
 request.operationalDeadlines={observe:'2026-10-11T16:00:00Z',review:'2026-10-12T02:00:00Z'};
 const result=planWeeklyBackwardSchedule(request),rows=new Map(result.assignments.map(row=>[row.taskId,row]));
 assert.equal(result.fullGraphConditionallyReachable,true);assert.deepEqual(result.unscheduledTaskIds,[]);assert.equal(result.publicationGap,0);
 assert(rows.get('pub')!.finishAt!<=rows.get('observe')!.startAt!);assert(rows.get('observe')!.finishAt!<=rows.get('review')!.startAt!);
});
test('late Sunday publication can explicitly carry monitoring and review into the next week',()=>{
 const request=operatingInput();request.tasks[0]!.schedule.latestStartAt='2026-10-11T23:00:00+08:00';request.tasks[0]!.schedule.latestFinishAt='2026-10-12T00:00:00+08:00';
 request.resources.content!.workingWindows=[{startAt:'2026-10-11T23:00:00+08:00',finishAt:'2026-10-12T12:00:00+08:00'}];
 request.operationalDeadlines={observe:'2026-10-12T03:00:00+08:00',review:'2026-10-12T10:00:00+08:00'};
 const result=planWeeklyBackwardSchedule(request);assert.equal(result.fullGraphConditionallyReachable,true);assert.deepEqual(result.crossWeekOperationalTaskIds,['observe','review']);
 request.operationalDeadlines={observe:'2026-10-11T23:30:00+08:00',review:'2026-10-12T10:00:00+08:00'};assert.equal(planWeeklyBackwardSchedule(request).fullGraphConditionallyReachable,false);
});
test('review cannot start before the real worker UTC reporting window closes',()=>{
 const request=operatingInput();request.operationalDeadlines={observe:'2026-10-11T16:00:00Z',review:'2026-10-11T18:00:00Z'};
 assert.equal(planWeeklyBackwardSchedule(request).fullGraphConditionallyReachable,false);
 request.operationalDeadlines.review='2026-10-12T02:00:00Z';
 const result=planWeeklyBackwardSchedule(request);assert.equal(result.fullGraphConditionallyReachable,true);assert(result.assignments.find(row=>row.taskId==='review')!.startAt!>='2026-10-12T00:00:00.000Z');
});
test('operational dates use their explicit local timezone and do not invent cutoffs for unrelated tasks',()=>{
 const request=operatingInput();request.operationalDeadlines={review:'2026-10-11T23:30:00-07:00',observe:'2026-10-11T23:00:00-07:00'};
 assert.deepEqual(planWeeklyBackwardSchedule(request).crossWeekOperationalTaskIds,[],'Sunday local deadline is not Monday merely because UTC date changes');
 request.operationalDeadlines={pub:'2026-10-11T23:00:00Z'};assert.throws(()=>planWeeklyBackwardSchedule(request),/actual monitoring/);
 request.operationalDeadlines={review:'2026-10-04T23:00:00+08:00'};assert.throws(()=>planWeeklyBackwardSchedule(request),/precedes/);
});
test('S6 successors require explicit deadlines while review retains its true close gate',()=>{const request=operatingInput(),extract=task('extract',['review']),validate=task('validate',['extract']);extract.schedule.stepKind='template_extraction';validate.schedule.stepKind='template_performance_validation';extract.schedule.latestFinishAt=null;validate.schedule.latestFinishAt=null;request.tasks.push(extract,validate);for(const t of [extract,validate])request.constraints[t.taskId]={resourceKey:'content',remainingMinutes:30,remainingCostCny:0,bufferMinutes:0,availableAt:now};request.operationalDeadlines={observe:'2026-10-11T16:00:00Z',review:'2026-10-12T02:00:00Z'};assert.equal(planWeeklyBackwardSchedule(request).fullGraphConditionallyReachable,false);request.operationalDeadlines.extract='2026-10-12T03:00:00Z';request.operationalDeadlines.validate='2026-10-12T04:00:00Z';const result=planWeeklyBackwardSchedule(request);assert.equal(result.fullGraphConditionallyReachable,true);const rows=new Map(result.assignments.map(r=>[r.taskId,r]));assert(rows.get('review')!.finishAt!<=rows.get('extract')!.startAt!);assert(rows.get('extract')!.finishAt!<=rows.get('validate')!.startAt!);assert(result.crossWeekOperationalTaskIds.includes('extract'));});
