import assert from 'node:assert/strict';
import test from 'node:test';
import { imageProductionEstimate } from './imageProductionEstimate';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation';
import type { SocialImageExecutionReceipt } from '../../shared/contracts/socialImageExecution';

const execution = { status: 'running' } as SocialImageExecutionReceipt;
const now = Date.parse('2026-10-28T08:00:00Z');
const task = (value: unknown, createdAt = '2026-10-28T07:59:00Z') => ({ productionRuntime: { nodeOutputs: [{
  nodeId: 'execution_plan', status: 'completed', version: 1, createdAt, value,
}] } }) as unknown as SocialImageCreationTask;

test('shows only a persisted, bounded planner estimate for an executing task', () => {
  assert.equal(imageProductionEstimate(task({ estimatedDurationSeconds: 180 }), execution, now), '预计还需约 2 分钟');
  assert.equal(imageProductionEstimate(task({ estimatedDurationSeconds: 30 }), execution, now), '已超过预计时间，仍在处理');
  assert.equal(imageProductionEstimate(task({ estimatedDurationSeconds: null }), execution, now), '同环节历史样本不足，暂无法可靠估时');
  assert.equal(imageProductionEstimate(task({ estimatedDurationSeconds: 180 }, 'invalid'), execution, now), '同环节历史样本不足，暂无法可靠估时');
  assert.equal(imageProductionEstimate(task({ estimatedDurationSeconds: 180 }), { ...execution, status: 'blocked' }, now), '');
  const withEvent = task({ estimatedDurationSeconds: null });
  Object.assign(withEvent.productionRuntime!, { currentNode: 'director_brief', events: [{ nodeId: 'director_brief', status: 'running', occurredAt: '2026-10-28T07:58:00Z' }] });
  assert.equal(imageProductionEstimate(withEvent, execution, now), '本步骤已进行约 2 分钟 · 同环节历史样本不足，暂无法可靠估时');
});

test('historical same-stage samples show a transparent range, not an artificially short promise', () => {
  const withEvent = task({ estimatedDurationSeconds: null });
  Object.assign(withEvent.productionRuntime!, { currentNode: 'director_brief', events: [{ nodeId: 'director_brief', status: 'waiting', occurredAt: '2026-10-28T07:59:50Z' }] });
  assert.equal(imageProductionEstimate(withEvent, execution, now, [27, 31]),
    '参考近期 2 次同环节记录，预计还需约 1–2 分钟（仅供参考）');
  assert.equal(imageProductionEstimate(withEvent, execution, now + 120_000, [27, 31]),
    '已超过近期 2 次同环节的参考时长，仍在处理');
});
