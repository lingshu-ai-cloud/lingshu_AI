import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scheduledExecutionState } from './scheduler.js';

assert.equal(scheduledExecutionState(''), 'idle');
assert.equal(scheduledExecutionState('任务正在执行，请稍后查看结果。'), 'running');
assert.equal(scheduledExecutionState('执行状态：已排队（1 组等待 Worker）'), 'queued');
assert.equal(
  scheduledExecutionState('执行状态：处理中（排队 1，执行中 0，已完成 0，失败 0）', { workerOnline: false }),
  'worker_offline',
);
assert.equal(
  scheduledExecutionState('执行状态：部分成功（成功 1，失败 1）\n关键词 B: 执行失败 - upstream'),
  'succeeded',
  '明确的部分成功不能被明细中的失败文本覆盖',
);
assert.equal(scheduledExecutionState('执行状态：执行失败\n本次任务均执行失败'), 'failed');
assert.equal(scheduledExecutionState('任务执行完成'), 'succeeded');

const source = readFileSync(new URL('./scheduler.ts', import.meta.url), 'utf8');
assert.match(source, /export async function runScheduledTaskNow/);
assert.match(source, /findTenantTask\(input\.taskId, input\.tenantId\)/, '导出 helper 必须校验租户归属');
assert.match(source, /schedulerRouter\.post\('\/:id\/run'[\s\S]*runScheduledTaskNow/);
assert.match(source, /res\.json\(\{ ok: true, \.\.\.outcome \}\)/, '立即执行 API 必须返回结构化 state');

console.log('scheduler execution state tests passed');
