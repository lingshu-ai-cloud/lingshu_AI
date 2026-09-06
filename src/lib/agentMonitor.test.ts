import assert from 'node:assert/strict';
import { mergeMonitorEvents } from './agentMonitor';
import type { RunEvent } from './digitalEmployees';

const event = (sequence: number, run = 'run-a'): RunEvent => ({ id: `${run}:${sequence}`, sequence, run_id: run, task_id: 'task-a', type: 'agent.ui.click', level: 'info', summary: '真实点击', payload: {}, occurred_at: '2026-09-05T10:00:00Z' });
assert.deepEqual(mergeMonitorEvents('run-a', [event(5), event(6)], [event(4), event(5)]).map(item => item.sequence), [4, 5, 6], 'a delayed snapshot cannot erase a live click');
assert.deepEqual(mergeMonitorEvents('run-b', [event(5)], [event(1, 'run-b')]).map(item => item.run_id), ['run-b'], 'switching runs must not retain another run’s telemetry');
assert.equal(mergeMonitorEvents('run-a', Array.from({ length: 2500 }, (_, index) => event(index + 1)), []).length, 2000, 'long-running streams must stay bounded');
console.log('Monitor event synchronization tests passed');
