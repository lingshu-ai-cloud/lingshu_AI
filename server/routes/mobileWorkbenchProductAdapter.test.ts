import assert from 'node:assert/strict';
import test from 'node:test';
import { starterWorkspaceOverview, starterWorkspaceQueue } from './mobileWorkbenchProductAdapter.js';

const range = { startsAt: '2026-10-05T00:00:00.000Z', endsAt: '2026-10-11T23:59:59.999Z', timeZone: 'Asia/Shanghai' };

test('starter workspace is projected into the same overview contract without fabricated weekly totals', () => {
  const result = starterWorkspaceOverview({
    generatedAt: '2026-10-10T10:00:00.000Z', run: { id: 'run-1', cycleLabel: '第 1 轮' },
    today: { inProgress: [{ id: 'task-1', what: '制作视频', why: '按计划推进', status: 'running', ownerAgent: 'content' }] },
    agents: [{ role: 'content', displayName: '内容 Agent', status: 'running', stage: '制作视频' }],
  }, range);
  assert.equal(result.metrics.tasks.value, null);
  assert.equal(result.metrics.tasks.availability, 'unavailable');
  assert.equal(result.taskDrilldown.items[0]?.id, 'task-1');
  assert.equal(result.agents.items[0]?.role, 'content');
  assert.match(result.workspace.note, /自然周/);
});

test('starter decisions are projected into the common matter envelope', () => {
  const result = starterWorkspaceQueue({
    generatedAt: '2026-10-10T10:00:00.000Z', today: { nextSteps: [] },
    decisions: [{ id: 'approval:a', title: '确认发布', summary: '将产生外部承诺', riskLevel: 'L3', actions: [{ id: 'approve', command: 'resolve_decision' }] }],
  });
  assert.equal(result.matters.length, 1);
  assert.equal(result.matters[0]?.id, 'starter:approval:a');
  assert.equal(result.matters[0]?.priority, 'high');
  assert.equal(result.matters[0]?.actions[0]?.command, 'resolve_decision');
});
