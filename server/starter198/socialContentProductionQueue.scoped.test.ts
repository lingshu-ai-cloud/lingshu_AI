import test from 'node:test';
import assert from 'node:assert/strict';
import { createScopedSocialContentProductionWorker } from './socialContentProductionQueue.js';

test('scoped production worker requires an explicit durable job allow-list', () => {
  assert.throws(
    () => createScopedSocialContentProductionWorker([]),
    /scoped_production_job_ids_required/,
  );
  assert.throws(
    () => createScopedSocialContentProductionWorker([' job-id']),
    /scoped_production_job_ids_required/,
  );
});

test('scoped production worker can be constructed without starting global recovery loops', () => {
  const worker = createScopedSocialContentProductionWorker(['job-id', 'job-id']);
  assert.equal(worker.isLocallyActive('tenant', 'task'), false);
  worker.stop();
});
