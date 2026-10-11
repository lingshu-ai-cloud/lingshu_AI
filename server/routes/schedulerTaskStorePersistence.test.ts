import assert from 'node:assert/strict';
import { canonicalScheduledTasks, type ScheduledTask } from './schedulerTaskStore.js';

const base: ScheduledTask = {
  id: 'canonical-task', tenantId: 'tenant-1', name: '连续发现采集', category: 'automation',
  taskType: 'social_discovery_collection', cronExpr: '*/15 * * * *', cronLabel: '每15分钟', enabled: true,
  config: { discoveryScopeId: 'scope-1' }, createdAt: '2026-10-11T01:00:00Z',
};
const result = canonicalScheduledTasks([
  { ...base, lastRun: '2026-10-11T01:10:00Z', lastResult: 'old' },
  { ...base, lastRun: '2026-10-11T01:20:00Z', lastResult: 'latest' },
  { ...base, tenantId: 'tenant-2', lastRun: '2026-10-11T01:15:00Z' },
]);
assert.equal(result.length, 2);
assert.equal(result.find(task => task.tenantId === 'tenant-1')?.lastResult, 'latest');

console.log('scheduler task store persistence tests passed');
