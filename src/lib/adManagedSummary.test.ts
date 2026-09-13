import assert from 'node:assert/strict';
import { managedSummary, type ManagedSnapshot } from './adManagedSummary';
import type { PlatformAdTask } from './platformAds';
const tasks = [
  { managementMode: 'managed', authorization: { expiresAt: '2026-09-15T00:00:00Z' } },
  { managementMode: 'managed', authorization: { expiresAt: '2026-09-12T00:00:00Z' } },
  { managementMode: 'manual', authorization: { expiresAt: '2026-09-15T00:00:00Z' } },
  { managementMode: 'managed', authorization: null },
] as PlatformAdTask[];
const rows: ManagedSnapshot[] = [
  { approvals: [{ status: 'PENDING' }, { status: 'EXECUTED' }], executions: [{ status: 'VERIFIED' }, { status: 'UNKNOWN' }], runs: [{ status: 'FAILED' }], errors: [] },
  { approvals: [], executions: [], runs: [], errors: ['读取失败'] },
];
assert.deepEqual(managedSummary(tasks, rows, Date.parse('2026-09-14T00:00:00Z')), { authorized: 1, pending: 1, verified: 1, issues: 2 });
assert.deepEqual(managedSummary([], [], 0), { authorized: 0, pending: 0, verified: 0, issues: 0 });
assert.equal(managedSummary(tasks, [], Date.parse('2026-09-15T00:00:00Z')).authorized, 0);
console.log('Managed summary: expiry, permission/execution separation, pending status and partial failures passed');
