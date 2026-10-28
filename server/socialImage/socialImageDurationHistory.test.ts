import assert from 'node:assert/strict';
import test from 'node:test';
import { imageNodeDurationSamples } from './socialImageDurationHistory.js';
import type { SocialImageCreationTask } from '../../shared/contracts/socialImageCreation.js';

const sample = (id: string, offset: number, nextStatus = 'waiting') => ({ id, productionRuntime: { events: [
  { nodeId: 'director_brief', status: 'waiting', occurredAt: `2026-10-28T08:00:${String(offset).padStart(2, '0')}Z` },
  { nodeId: 'execution_plan', status: nextStatus, occurredAt: '2026-10-28T08:01:00Z' },
] } }) as unknown as SocialImageCreationTask;

test('duration history uses only finished transitions and excludes the current task', () => {
  assert.deepEqual(imageNodeDurationSamples([sample('past-a', 20), sample('past-b', 30),
    sample('blocked', 10, 'blocked'), sample('current', 0)], 'director_brief', 'current'), [40, 30]);
});
