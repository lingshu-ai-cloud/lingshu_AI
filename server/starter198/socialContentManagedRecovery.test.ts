import assert from 'node:assert/strict';
import { managedReferenceResume } from './socialContentManagedRecovery.js';
import type { StarterRecord } from './repository.js';
const now = new Date('2026-09-27T10:00:00Z');
const row: StarterRecord = { id: 'task', status: 'needs_input', brief: { managementMode: 'one_click_managed', _managedStart: {
  status: 'queued', requestId: 'explicit-start', userId: 'owner', attempts: 0, nextAttemptAt: '2026-09-27T09:00:00Z',
} } };
assert.deepEqual(managedReferenceResume(row, now), { requestId: 'explicit-start', userId: 'owner', attempts: 0 });
for (const status of ['paused', 'attention', 'producing', 'delivered']) assert.equal(managedReferenceResume({ ...row, status }, now), null);
assert.equal(managedReferenceResume({ ...row, brief: { managementMode: 'one_click_managed' } }, now), null, 'ordinary drafts are never automatically started');
const brief = row.brief as Record<string, any>;
for (const patch of [{ attempts: 8 }, { nextAttemptAt: 'invalid' }, { nextAttemptAt: '2026-10-01T00:00:00Z' }, { status: 'blocked' }, { userId: '' }]) {
  assert.equal(managedReferenceResume({ ...row, brief: { ...brief, _managedStart: { ...brief._managedStart, ...patch } } }, now), null);
}
assert.equal(managedReferenceResume({ ...row, brief: { ...brief, managementMode: 'advanced' } }, now), null);
console.log('managed reference recovery admission tests passed');
