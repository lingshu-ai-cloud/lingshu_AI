import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discoveryTriggerForScheduler } from './scheduledTrigger.js';

assert.equal(discoveryTriggerForScheduler('manual'), 'manual');
assert.equal(discoveryTriggerForScheduler('cron'), 'scheduled');
assert.equal(discoveryTriggerForScheduler('catch-up'), 'scheduled');

const scheduler = readFileSync(new URL('../routes/scheduler.ts', import.meta.url), 'utf8');
assert.match(scheduler, /executeTask\(task, trigger\)/, 'scheduler execution must pass its real trigger into task execution');
assert.match(scheduler, /triggerType: discoveryTriggerForScheduler\(trigger\)/,
  'continuous discovery must translate UI manual runs separately from cadence-bound runs');

console.log('scheduled discovery trigger tests passed');
