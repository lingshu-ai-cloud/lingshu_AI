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
  assert.equal(rows[0].time, `${String(finish.getHours()).padStart(2,'0')}:00`);
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
