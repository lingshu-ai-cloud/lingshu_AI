import assert from 'node:assert/strict';
import { groupMonitorEvents, mergeMonitorEvents } from './agentMonitor';
import type { RunEvent } from './digitalEmployees';

const event = (sequence: number, run = 'run-a'): RunEvent => ({ id: `${run}:${sequence}`, sequence, run_id: run, task_id: 'task-a', type: 'agent.ui.click', level: 'info', summary: '真实点击', payload: {}, occurred_at: '2026-09-05T10:00:00Z' });
assert.deepEqual(mergeMonitorEvents('run-a', [event(5), event(6)], [event(4), event(5)]).map(item => item.sequence), [4, 5, 6], 'a delayed snapshot cannot erase a live click');
assert.deepEqual(mergeMonitorEvents('run-b', [event(5)], [event(1, 'run-b')]).map(item => item.run_id), ['run-b'], 'switching runs must not retain another run’s telemetry');
assert.equal(mergeMonitorEvents('run-a', Array.from({ length: 2500 }, (_, index) => event(index + 1)), []).length, 2000, 'long-running streams must stay bounded');
console.log('Monitor event synchronization tests passed');

const grouped = groupMonitorEvents([event(1), event(2), { ...event(3), type: 'task.retry' }, event(4)]);
assert.deepEqual(grouped.map(e => e.repeatCount), [2, 1, 1], 'retry boundaries must remain visible');
assert.equal(grouped[0].id, event(2).id, 'group displays the latest occurrence');
assert.equal(groupMonitorEvents([event(1), { ...event(2), task_id: 'other' }]).length, 2);
assert.equal(groupMonitorEvents([event(1), { ...event(2), level: 'error' }, { ...event(3), level: 'error' }]).length, 3, 'errors remain individually inspectable');
assert.equal(groupMonitorEvents([event(1), { ...event(2), summary: '条件改变' }]).length, 2);
