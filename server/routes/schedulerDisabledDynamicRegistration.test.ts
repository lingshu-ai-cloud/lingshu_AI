import test from 'node:test';
import assert from 'node:assert/strict';
import { isSchedulerTaskRegistered, scheduleTask } from './scheduler.js';
import type { ScheduledTask } from './schedulerTaskStore.js';

test('disabled scheduler does not dynamically register an approved discovery collection cron', () => {
  const previous = process.env.SCHEDULER_ENABLED;
  const task: ScheduledTask = {
    id: `scope-revision-${process.pid}`,
    tenantId: 'local-tenant',
    name: '连续发现采集',
    category: 'automation',
    taskType: 'social_discovery_collection',
    cronExpr: '*/15 * * * *',
    cronLabel: '每15分钟检查到期供给',
    enabled: true,
    config: { discoveryScopeId: 'scope-v3', discoveryScopeVersion: '3' },
    createdAt: new Date().toISOString(),
  };
  try {
    process.env.SCHEDULER_ENABLED = 'true';
    scheduleTask(task);
    assert.equal(isSchedulerTaskRegistered(task.id), true);

    // The route updates the persisted task and calls scheduleTask again. An
    // opt-out must revoke even a cron already registered in this process.
    process.env.SCHEDULER_ENABLED = 'false';
    scheduleTask(task);
    assert.equal(isSchedulerTaskRegistered(task.id), false);

    scheduleTask({ ...task, id: `${task.id}-new` });
    assert.equal(isSchedulerTaskRegistered(`${task.id}-new`), false);
  } finally {
    process.env.SCHEDULER_ENABLED = 'false';
    scheduleTask(task);
    if (previous === undefined) delete process.env.SCHEDULER_ENABLED;
    else process.env.SCHEDULER_ENABLED = previous;
  }
});
