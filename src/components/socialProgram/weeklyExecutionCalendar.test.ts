import assert from 'node:assert/strict';
import test from 'node:test';
import type { WeeklyExecutionTask, WeeklyProductionStepKind } from '../../../shared/contracts/socialProgram';
import { projectExecutionCalendar } from './weeklyExecutionCalendar';
const labels = { video_generation: '生成成片' } as Record<WeeklyProductionStepKind, string>;
const task = (status: WeeklyExecutionTask['status'], finish = '2026-10-06T12:00:00Z'): WeeklyExecutionTask => ({
  taskId: status, packageId: 'week-1', publicationTaskId: 'video-1', accountId: 'account-1', status,
  schedule: { stepKind: 'video_generation', responsibleActor: 'content_agent', estimatedFinishAt: finish, estimatedDurationMinutes: 90 },
  resultRefs: [], dependsOnTaskIds: ['verified-material'], ownBlockingReasons: [], inheritedBlockingTaskIds: [], lastError: null,
} as unknown as WeeklyExecutionTask);
test('calendar preserves execution identity and does not fabricate deliverables or dates', () => {
  const rows = projectExecutionCalendar([task('queued'), task('cancelled'), task('dead_letter'), task('succeeded'), task('blocked', '')], labels);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map(row => row.status), ['planned','cancelled','failed','completed']);
  assert.equal(rows[0].id, 'queued');
  assert.deepEqual(rows[0].dependsOn, ['verified-material']);
  assert.equal(rows[0].output, '待交付：生成成片');
  const finish = new Date('2026-10-06T12:00:00Z');
  assert.equal(rows[0].time, `${String(finish.getUTCHours()).padStart(2,'0')}:00`);
});
test('production entry uses bound task identity rather than publication or artifact identity', () => {
  const bound = task('leased');
  bound.productionProgress = { contentTaskId: 'real-content-1', runId: 'run-1', step: 'render', activity: '渲染中', updatedAt: '2026-10-06T11:00:00Z' };
  const artifact = task('succeeded');
  artifact.publicationTaskId = 'other-video';
  artifact.resultRefs = [{ type: 'starter_social_content_artifact', id: 'artifact-1', version: 1 }];
  const readiness = task('succeeded');
  readiness.publicationTaskId = 'third-video';
  readiness.resultRefs = [{ type: 'starter_social_content_task', id: 'real-content-2', version: 2 }];
  const rows = projectExecutionCalendar([bound, artifact, readiness], labels);
  assert.equal(rows[0].productionTaskId, 'real-content-1');
  assert.equal(rows[1].productionTaskId, undefined);
  assert.equal(rows[2].productionTaskId, 'real-content-2');
  readiness.resultRefs = [{ type: 'starter_social_content_material_demand', id: 'real-content-2', version: 2 }];
  assert.equal(projectExecutionCalendar([readiness], labels)[0].productionTaskId, 'real-content-2');
  for(const type of ['starter_social_material_preparation','starter_social_owned_product_identity_demand']) {
    readiness.schedule.stepKind=type==='starter_social_material_preparation'?'material_preparation':'material_readiness';
    readiness.resultRefs=[{type,id:'real-content-2',version:2}];
    const card=projectExecutionCalendar([readiness],labels)[0]!;
    assert.equal(card.productionTaskId,'real-content-2');
    assert.equal(card.agent,'content');
    assert.equal(card.status,'completed');
  }
  bound.status = 'blocked';
  bound.productionProgress!.runId = null;
  assert.equal(projectExecutionCalendar([bound], labels)[0].productionTaskId, 'real-content-1', 'material upload entry does not require a fabricated run identity');
});
test('completed stages retain the verified sibling production entry and reject ambiguous or cross-version bindings', () => {
  const ready = task('succeeded');
  ready.packageVersion = 1;
  ready.resultRefs = [{ type: 'starter_social_content_task', id: 'real-content', version: 1 }];
  const rendered = task('succeeded');
  rendered.packageVersion = 1;
  rendered.resultRefs = [{ type: 'starter_social_content_artifact', id: 'artifact', version: 1 }];
  const otherVersion = { ...rendered, packageVersion: 2 };
  let rows = projectExecutionCalendar([ready, rendered, otherVersion], labels);
  assert.equal(rows[1].productionTaskId, 'real-content');
  assert.equal(rows[2].productionTaskId, undefined);
  const conflict = { ...ready, resultRefs: [{ type: 'starter_social_content_task', id: 'conflicting-content', version: 1 }] };
  rows = projectExecutionCalendar([ready, rendered, conflict], labels);
  assert(rows.every(row => row.productionTaskId === undefined));
});
test('runtime risk advances with the clock without changing verified completion', () => {
  const waiting = task('queued');
  waiting.schedule.latestStartAt = '2026-10-06T10:00:00Z';
  waiting.schedule.latestFinishAt = '2026-10-06T12:00:00Z';
  assert.equal(projectExecutionCalendar([waiting],labels,Date.parse('2026-10-06T09:00:00Z'))[0].reason,undefined);
  assert.match(projectExecutionCalendar([waiting],labels,Date.parse('2026-10-06T11:00:00Z'))[0].reason!,/最晚开始/);
  waiting.status='leased';
  assert.equal(projectExecutionCalendar([waiting],labels,Date.parse('2026-10-06T11:00:00Z'))[0].reason,undefined);
  assert.match(projectExecutionCalendar([waiting],labels,Date.parse('2026-10-06T13:00:00Z'))[0].reason!,/最晚完成/);
  waiting.status='succeeded';
  assert.equal(projectExecutionCalendar([waiting],labels,Date.parse('2026-10-06T13:00:00Z'))[0].reason,undefined);
});
test('a verified continuation opens its original production while pending and blocked receipts expose no entry', () => {
  const continued = task('succeeded');
  continued.packageVersion = 2;
  continued.resultRefs = [{ type: 'weekly_execution_continuation', id: 'receipt', version: 1 }];
  continued.continuationObservation = { status: 'ready', sourceVersion: 1, sourceTaskId: 'old-task', contentTaskId: 'original-content' };
  assert.equal(projectExecutionCalendar([continued], labels)[0].productionTaskId, 'original-content');
  assert.deepEqual(continued.resultRefs, [{ type: 'weekly_execution_continuation', id: 'receipt', version: 1 }]);
  continued.continuationObservation.status = 'pending';
  assert.equal(projectExecutionCalendar([continued], labels)[0].productionTaskId, undefined);
  continued.continuationObservation.status = 'blocked';
  assert.equal(projectExecutionCalendar([continued], labels)[0].productionTaskId, undefined);
});
test('persisted planning cards retain exact scope while review and ordinary production keep their own entries',()=>{const kinds=['business_outline','benchmark_collection','benchmark_scoring','director_analysis','business_schedule','weekly_review','video_generation'] as WeeklyProductionStepKind[];const actual=kinds.map((stepKind,index)=>({...task('queued'),taskId:`real-${index}`,tenantId:'tenant',programId:'program',packageId:'week',packageVersion:4,schedule:{...task('queued').schedule,stepKind}}));const rows=projectExecutionCalendar(actual,labels);assert.deepEqual(rows.slice(0,5).map(r=>r.planningTarget?.stepKind),kinds.slice(0,5));for(const row of rows.slice(0,5)){assert.equal(row.planningTarget?.taskId,row.id);assert.equal(row.planningTarget?.packageVersion,4);assert.equal(row.planningTarget?.tenantId,'tenant');}assert.equal(rows[5].planningTarget,undefined);assert.equal(rows[6].planningTarget,undefined);assert.equal(projectExecutionCalendar([{...actual[0],packageVersion:0}],labels)[0].planningTarget,undefined);});
test('actual monitoring/review cards open scoped social evidence instead of planning or inferred production',()=>{const actual=['performance_monitoring','weekly_review'].map(stepKind=>({...task('queued'),tenantId:'tenant',programId:'program',packageId:'week',packageVersion:2,schedule:{...task('queued').schedule,stepKind:stepKind as WeeklyProductionStepKind},resultRefs:[{type:'starter_social_content_task',id:'unrelated-content',version:1}]}));const rows=projectExecutionCalendar(actual,labels);assert.deepEqual(rows.map(r=>r.reviewTarget?.stepKind),['performance_monitoring','weekly_review']);assert.ok(rows.every(r=>r.planningTarget===undefined&&r.productionTaskId===undefined));});
test('real readable deliverable keeps production identity, verified completion and continuation without inventing templates',()=>{const pub={publicationTaskId:'video-1',motherContentId:'mother',accountId:'account-1',platform:'youtube',accountPositioning:'Industrial buyer'};const pkg={programId:'program',packageId:'week-1',version:2,weekStart:'2026-10-05',weekEnd:'2026-10-11',socialContentPackage:{publicationTasks:[pub]},agentPlanning:{packageId:'week-1',packageVersion:2,skeleton:{slots:[{motherContentId:'mother',referenceSource:'external'}]},dispatch:{dispatchId:'real-dispatch',packageId:'week-1',packageVersion:2,scheduleItems:[{scheduleItemId:'real-item',publicationTaskId:'video-1',accountId:'account-1',platform:'youtube',topic:'采购前检查接口尺寸'}]}}}as unknown as import('../../../shared/contracts/socialProgram').WeeklyOperatingPackage;const actual={...task('succeeded'),tenantId:'tenant',programId:'program',packageVersion:2,inputSnapshot:{publicationTask:pub},resultRefs:[{type:'weekly_execution_continuation',id:'verified-receipt',version:1}],continuationObservation:{status:'ready' as const,sourceVersion:1,sourceTaskId:'original',contentTaskId:'original-content'}};const rows=projectExecutionCalendar([actual],labels,Date.parse('2026-10-09T12:00:00Z'),{pkg,profile:'account_repair'});assert.equal(rows.length,1);assert.equal(rows[0].status,'completed');assert.equal(rows[0].productionTaskId,'original-content');assert.match(rows[0].title,/采购前检查接口尺寸/);assert.match(rows[0].context,/YouTube · Industrial buyer/);assert.match(rows[0].output,/已核验承接原 v1/);assert.match(rows[0].chain!,/H-M5/);assert.match(rows[0].chain!,/H-S9/);assert.doesNotMatch(rows[0].chain!,/S6/);});

test('deadline projection preserves actual finish truth and original plan across elapsed days', () => {
  const actual = task('succeeded'); actual.schedule.latestFinishAt = '2026-10-06T12:00:00Z';
  const project = () => projectExecutionCalendar([actual], labels, Date.parse('2026-10-09T12:00:00Z'))[0];
  assert.equal(project().deliveryTiming, 'unknown');
  actual.schedule.actualFinishedAt = '2026-10-06T12:00:00Z'; assert.equal(project().deliveryTiming, 'on_time');
  actual.schedule.actualFinishedAt = '2026-10-06T12:01:00Z'; assert.equal(project().deliveryTiming, 'late');
  assert.equal(project().actualFinishedAt, actual.schedule.actualFinishedAt);
  assert.equal(project().date, projectExecutionCalendar([actual], labels, Date.parse('2026-10-06T10:00:00Z'))[0].date);
  actual.status = 'leased'; assert.equal(project().status, 'active'); assert.equal(project().deliveryTiming, undefined);
});
test('affected publication propagation follows actual dependencies within the exact package scope', () => {
  const upstream = {...task('blocked'), taskId:'shared-material', publicationTaskId:null, tenantId:'tenant', programId:'program', packageVersion:1};
  const child = {...task('queued'), taskId:'render', tenantId:'tenant', programId:'program', packageVersion:1, dependsOnTaskIds:['shared-material']};
  const foreign = {...child, taskId:'foreign', publicationTaskId:'foreign-publication', packageVersion:2};
  assert.deepEqual(projectExecutionCalendar([upstream, child, foreign], labels)[0].affectedPublicationIds, ['video-1']);
});

test('calendar exposes persisted recovery assessment without pretending a proposal changed the schedule', () => {
  const actual=task('blocked');
  actual.deadlineRecovery={assessmentId:'stored-assessment',assessedAt:'2026-10-06T11:00:00Z',status:'blocked',blockingReasons:['fresh_remaining_budget_capacity_work_windows_required'],affectedPublicationIds:['video-1']};
  const projected=projectExecutionCalendar([actual],labels)[0];
  assert.deepEqual(projected.deadlineRecovery,actual.deadlineRecovery); assert.equal(projected.status,'blocked');
  assert.equal(projected.dueAt,actual.schedule.estimatedFinishAt);
});

test('verified continuation uses original completion and deadline without moving the current version plan', () => {
  const actual = task('succeeded','2026-10-09T12:00:00Z');
  actual.schedule.actualFinishedAt='2026-10-09T11:00:00Z'; actual.schedule.latestFinishAt='2026-10-09T12:00:00Z';
  actual.continuationObservation={status:'ready',sourceVersion:1,sourceTaskId:'original',contentTaskId:'original-content',sourceActualFinishedAt:'2026-10-06T13:00:00Z',sourceLatestFinishAt:'2026-10-06T12:00:00Z'};
  const project=()=>projectExecutionCalendar([actual],labels)[0];
  assert.equal(project().deliveryTiming,'late'); assert.equal(project().actualFinishedAt,'2026-10-06T13:00:00Z');
  assert.equal(project().sourceDeadlineAt,'2026-10-06T12:00:00Z'); assert.equal(project().dueAt,'2026-10-09T12:00:00Z');
  const finish = new Date(actual.schedule.estimatedFinishAt);
  assert.equal(project().date,`${finish.getUTCFullYear()}-${String(finish.getUTCMonth()+1).padStart(2,'0')}-${String(finish.getUTCDate()).padStart(2,'0')}`);
  actual.continuationObservation.sourceActualFinishedAt=null; assert.equal(project().deliveryTiming,'unknown');
  actual.continuationObservation.status='pending'; assert.equal(project().deliveryTiming,'on_time'); assert.equal(project().sourceDeadlineAt,undefined);
});

test('frozen publication offset controls plan date despite Shanghai browser and UTC-normalized schedule',()=>{
  const actual=task('leased','2026-10-10T02:30:00Z');
  actual.inputSnapshot={publicationTask:{publishWindow:'2026-10-10T12:00:00-04:00'}};
  const row=projectExecutionCalendar([actual],labels,Date.parse('2026-10-10T03:00:00Z'))[0];
  assert.equal(row.date,'2026-10-09'); assert.equal(row.time,'22:30');
  assert.equal(row.calendarClock?.label,'UTC-04:00'); assert.equal(row.calendarClock?.source,'publication_offset');
});

test('foreign package timezone cannot alter scoped execution date',()=>{
 const actual={...task('leased','2026-10-10T02:30:00Z'),tenantId:'tenant',programId:'program',packageVersion:1};
 const pkg={programId:'foreign',packageId:actual.packageId,version:1,timeZone:'America/New_York',socialContentPackage:{publicationTasks:[{publicationTaskId:'video-1',publishWindow:'2026-10-10T12:00:00-04:00'}]}} as unknown as import('../../../shared/contracts/socialProgram').WeeklyOperatingPackage;
 const projected=projectExecutionCalendar([actual],labels,Date.now(),{pkg})[0];
 assert.equal(projected.date,'2026-10-10'); assert.equal(projected.time,'02:30'); assert.equal(projected.calendarClock?.label,'UTC');
});
test('inventory approval links the frozen binding instead of inventing a production task',()=>{const actual={...task('queued'),workflowKind:'content' as const,tenantId:'tenant',programId:'program',packageVersion:2,inputSnapshot:{publicationTask:{publicationTaskId:'video-1',inventoryReuseRef:{type:'weekly_inventory_binding',id:'actual-binding',version:1}}},schedule:{...task('queued').schedule,stepKind:'user_approval' as const,responsibleActor:'user' as const}};const card=projectExecutionCalendar([actual],{...labels,user_approval:'本周库存审批'})[0];assert.deepEqual(card.inventoryTarget,{tenantId:'tenant',programId:'program',packageId:'week-1',packageVersion:2,bindingId:'actual-binding',publicationTaskId:'video-1',taskId:'queued'});assert.equal(card.productionTaskId,undefined);});
test('publishing card links exact publication execution instead of generic content production',()=>{const actual={...task('blocked'),tenantId:'tenant',programId:'program',packageVersion:2,workflowKind:'publishing' as const,accountId:'account-1',schedule:{...task('blocked').schedule,stepKind:'publishing' as const},resultRefs:[{type:'starter_social_content_task',id:'content-wrong-entry',version:1}]};const card=projectExecutionCalendar([actual],{...labels,publishing:'发布'})[0];assert.deepEqual(card.publicationExecutionTarget,{tenantId:'tenant',programId:'program',packageId:'week-1',packageVersion:2,taskId:'blocked',publicationTaskId:'video-1',accountId:'account-1'});assert.equal(card.productionTaskId,undefined);});
