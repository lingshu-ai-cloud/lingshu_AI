import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WeeklyExecutionTask } from '../../../shared/contracts/socialProgram';
import { projectExecutionCalendar } from '../socialProgram/weeklyExecutionCalendar';
import { STEP_LABEL } from '../socialProgram/weeklyExecutionLabels';
import { buildVideoProductionLanes, persistedVideoTasks } from '../smartBusiness/agentVideoProductionModel';
import { productionGanttTasks } from '../smartBusiness/AgentVideoProductionBoard';

function task(taskId: string, stepKind: 'script' | 'video_generation', parents: string[] = []): WeeklyExecutionTask {
  return { taskId, tenantId: 'tenant', programId: 'program', packageId: 'package', packageVersion: 3,
    publicationTaskId: 'video', accountId: 'account', status: 'queued',
    inputSnapshot: { objective: 'Frozen real objective', productIds: ['product'] },
    resultRefs: [{ type: 'actual_result', id: `result-${taskId}`, version: 1 }], dependsOnTaskIds: parents,
    ownBlockingReasons: [], inheritedBlockingTaskIds: [], lastError: null,
    schedule: { stepKind, responsibleActor: 'content_agent', estimatedFinishAt: '2026-10-24T12:00:00Z', estimatedDurationMinutes: 10 },
  } as unknown as WeeklyExecutionTask;
}

test('video track contains exact backend tasks, no fixed seven-stage placeholders', () => {
  const tasks = projectExecutionCalendar([task('script-id', 'script'), task('render-id', 'video_generation', ['script-id'])], STEP_LABEL);
  const lanes = productionGanttTasks(buildVideoProductionLanes(tasks).lanes, true);
  assert.equal(lanes.length, 1);
  assert.deepEqual(lanes[0].nodes.map(node => node.id), ['script-id', 'render-id']);
  assert.ok(lanes[0].nodes.every(node => node.task?.workspaceTarget?.executionTaskId === node.id));
  assert.equal(lanes[0].progress, 0);
});

test('each node retains its frozen inputs, exact result refs, dependencies and workspace version', () => {
  const source = task('render', 'video_generation', ['verified-material']);
  const [node] = projectExecutionCalendar([source], STEP_LABEL);
  assert.deepEqual(node.executionInputSnapshot, source.inputSnapshot);
  assert.deepEqual(node.executionResultRefs, source.resultRefs);
  assert.deepEqual(node.dependsOn, source.dependsOnTaskIds);
  assert.deepEqual(node.workspaceTarget, { programId: 'program', packageId: 'package', packageVersion: 3, executionTaskId: 'render' });
});

test('actual task ordering follows dependency IDs and excludes inferred summary cards', () => {
  const nodes = projectExecutionCalendar([task('render', 'video_generation', ['script']), task('script', 'script')], STEP_LABEL);
  const inferred = { ...nodes[0], id: 'summary', workspaceTarget: undefined };
  assert.deepEqual(persistedVideoTasks([nodes[0], inferred, nodes[1]]).map(node => node.id), ['script', 'render']);
});

test('independent persisted video tasks remain visible without a weekly workspace', async () => {
  const { projectSocialContentTaskCalendar } = await import('../smartBusiness/socialContentTaskCalendar');
  const summary = { taskId: 'independent-video', brief: { title: 'Existing video', objective: 'Real brief', platforms: ['tiktok'], languages: ['zh'] }, status: 'producing', artifactCount: 0, approvedArtifactCount: 0, readiness: { missing: [] }, createdAt: '2026-10-24T10:00:00Z', updatedAt: '2026-10-24T11:00:00Z' };
  const cards = projectSocialContentTaskCalendar([summary as never]);
  const nodes = persistedVideoTasks([...cards, ...cards.flatMap(card => card.internalNodes || [])]);
  assert.deepEqual(nodes.map(node => node.id), ['social-content:independent-video']);
  assert.equal(nodes[0].productionTaskId, summary.taskId);
  const lanes = productionGanttTasks(buildVideoProductionLanes(nodes).lanes, true);
  assert.equal(lanes[0].nodes.length, 1, 'summary stages must not be fabricated as persisted execution nodes');
});
