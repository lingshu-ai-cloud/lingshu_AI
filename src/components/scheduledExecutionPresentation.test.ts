import assert from 'node:assert/strict';
import { safeAnalysisActionMessage, scheduledTaskExecutionState, TASK_EXECUTION_META } from './scheduledExecutionPresentation.js';

assert.equal(scheduledTaskExecutionState({ lastResult: '' }), 'idle');
assert.equal(scheduledTaskExecutionState({ executionState: 'queued' }), 'queued');
assert.equal(scheduledTaskExecutionState({ executionState: 'queued' }, { workerOnline: false }), 'worker_offline');
assert.equal(scheduledTaskExecutionState({ executionState: 'failed' }, { running: true }), 'running');
assert.equal(scheduledTaskExecutionState({ lastResult: '执行状态：部分成功' }), 'partial');
assert.equal(scheduledTaskExecutionState({ lastResult: '执行状态：执行失败' }), 'failed');
assert.equal(TASK_EXECUTION_META.worker_offline.label, 'Worker 离线');
assert.equal(safeAnalysisActionMessage('429 quota exhausted', '失败'), 'AI 分析额度暂时不足，请稍后重试。');
assert.equal(safeAnalysisActionMessage('api_key=secret', '安全提示'), '安全提示');

console.log('scheduled execution presentation rules passed');
