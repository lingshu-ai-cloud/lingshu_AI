import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectMobileWorkbenchAgentSchedule as project } from './mobileWorkbenchAgentSchedule.js';
const range = { startsAt: '2026-10-04T16:00:00Z', endsAt: '2026-10-11T15:59:59Z', timeZone: 'Asia/Shanghai' as const };
const row = (id: string, patch: Record<string, unknown> = {}) => ({ id, tenant_id: 'A', run_id: 'run-a', status: 'running', ...patch });

test('includes all ongoing work and only finished work observed in selected week', () => {
  const result = project({ availability: 'available', items: [
    row('old-open', { updated_at: '2026-09-01T01:00:00Z' }),
    row('done', { status: 'succeeded', updated_at: '2026-10-05T01:00:00Z' }),
    row('old-done', { status: 'succeeded', updated_at: '2026-09-01T01:00:00Z' }),
    row('done-unknown', { status: 'succeeded' }),
    row('cancelled-old', { status: 'cancelled', updated_at: '2026-10-05T01:00:00Z' }),
    row('other-tenant', { tenant_id: 'B' }),
  ] }, 'A', range);
  assert.deepEqual(result.items.map(i => i.taskId), ['done', 'old-open']);
});

test('does not manufacture a plan, owner name or actionable matter from status', () => {
  const result = project({ availability: 'available', items: [row('missing', {
    created_at: '2026-10-05T01:00:00Z', status: 'waiting_approval', owner_id: 'member-a', output: 'null',
  })] }, 'A', range).items[0];
  assert.equal(result.plannedAt, null); assert.equal(result.dueAt, null);
  assert.equal(result.observedAt, null); assert.equal(result.timeStatus, 'unscheduled');
  assert.equal(result.ownerName, null); assert.equal(result.matterId, null);
});

test('projects persisted date-only plans and exact node, with scoped most recent event signal', () => {
  const result = project({ availability: 'available', items: [row('task-a', {
    task_key: 'content_production', agent_role: 'industry', planned_at: '2026-10-06',
    updated_at: '2026-10-06T01:00:00Z', owner_id: 'user-a',
    output: JSON.stringify({ phase: '分镜生成', dueAt: '2026-10-07T09:00:00+08:00', nextAction: '完成当前分镜生成', matterId: 'task:task-a', waitState: { kind: 'processing', message: '供应商处理中' } }),
  })] }, 'A', range, { availability: 'available', items: [
    { id: 'latest', tenant_id: 'A', run_id: 'run-a', task_id: 'task-a', occurred_at: '2026-10-06T02:00:00Z', summary: '第2个分镜完成' },
    { id: 'wrong-run', tenant_id: 'A', run_id: 'other', task_id: 'task-a', occurred_at: '2026-10-06T03:00:00Z' },
    { id: 'foreign', tenant_id: 'B', run_id: 'run-a', task_id: 'task-a', occurred_at: '2026-10-06T04:00:00Z' },
  ] }).items[0];
  assert.equal(result.plannedAt, '2026-10-06'); assert.equal(result.stage, '分镜生成');
  assert.equal(result.role, 'content'); assert.equal(result.observedAt, '2026-10-06T02:00:00Z');
  assert.equal(result.lastEvent?.id, 'latest'); assert.equal(result.matterId, 'task:task-a');
  assert.equal(result.waitKind, 'processing');
});

test('source failures stay unavailable while event failure retains known task observations', () => {
  assert.deepEqual(project({ availability: 'unavailable', items: [row('discard')] }, 'A', range).items, []);
  const result = project({ availability: 'available', items: [row('known', { updated_at: '2026-10-06T01:00:00Z' })] }, 'A', range, { availability: 'unavailable', items: [] });
  assert.equal(result.availability, 'available'); assert.equal(result.eventAvailability, 'unavailable');
  assert.equal(result.items[0].observedAt, '2026-10-06T01:00:00Z');
});
