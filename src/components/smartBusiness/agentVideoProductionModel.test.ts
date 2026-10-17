import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
import { buildVideoProductionLanes, productionStageContract, VIDEO_PRODUCTION_STAGES } from './agentVideoProductionModel';

const task = (id: string, videoTaskId: string | undefined, executionStep: string, status: AgentCalendarTask['status'], agent: AgentCalendarTask['agent']): AgentCalendarTask => ({
  id, videoTaskId, executionStep, status, agent,
  date: '2026-10-17', time: '10:00', title: `${executionStep} · 云朵泡沫卸妆蜜`,
  output: `交付 ${executionStep}`, context: 'TikTok · 品牌账号', minutes: 20,
  workspaceTarget: { programId: 'program', packageId: 'week', packageVersion: 1, executionTaskId: id },
});

test('tasks are grouped by video identity rather than calendar date', () => {
  const tasks = [
    task('script-a', 'video-a', 'script', 'completed', 'director'),
    task('render-a', 'video-a', 'video_generation', 'active', 'content'),
    task('script-b', 'video-b', 'script', 'blocked', 'director'),
    task('shared', undefined, 'business_outline', 'planned', 'business'),
  ];
  const result = buildVideoProductionLanes(tasks);
  assert.equal(result.lanes.length, 2);
  assert.equal(result.shared.length, 1);
  const first = result.lanes.find(lane => lane.videoTaskId === 'video-a')!;
  assert.equal(first.stages.directing[0]?.id, 'script-a');
  assert.equal(first.stages.production[0]?.id, 'render-a');
  assert.equal(first.status, 'active');
  assert.deepEqual(tasks.map(item => item.id), ['script-a', 'render-a', 'script-b', 'shared']);
});

test('the fixed path covers invocation, handoff and stability gates for every stage', () => {
  assert.equal(VIDEO_PRODUCTION_STAGES.length, 7);
  for (const stage of VIDEO_PRODUCTION_STAGES) {
    assert.ok(stage.invocation);
    assert.ok(stage.input);
    assert.ok(stage.handoff);
    assert.ok(stage.qualityGate);
  }
  assert.equal(productionStageContract(task('qc', 'video-a', 'quality_check', 'planned', 'content'))?.key, 'quality');
});
