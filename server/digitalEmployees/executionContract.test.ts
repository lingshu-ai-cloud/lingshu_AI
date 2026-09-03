import assert from 'node:assert/strict';
import { contractStillValid, fingerprintFormalSourceVersions, readinessForGaps, type ExecutionContract } from './executionContract.js';

assert.equal(readinessForGaps([]), 'ready');
assert.equal(readinessForGaps([{ code: 'metrics', severity: 'warning', title: '', resolution: '', source: '' }]), 'ready_with_assumptions');
assert.equal(readinessForGaps([{ code: 'product', severity: 'blocking', title: '', resolution: '', source: '' }]), 'blocked');
assert.equal(contractStillValid({ goalVersion: 2, sourceFingerprint: 'a' } as ExecutionContract, { goalVersion: 2, sourceFingerprint: 'a' }), true);
assert.equal(contractStillValid({ goalVersion: 2, sourceFingerprint: 'a' } as ExecutionContract, { goalVersion: 3, sourceFingerprint: 'a' }), false);
assert.equal(contractStillValid({ goalVersion: 2, sourceFingerprint: 'a' } as ExecutionContract, { goalVersion: 2, sourceFingerprint: 'b' }), false);
const sameCountBefore = fingerprintFormalSourceVersions({ metrics: [{ id: 'm1', capturedAt: '2026-09-01', metricsHash: 'views:10' }], posts: [{ id: 'p1', status: 'scheduled' }] });
const sameCountAfter = fingerprintFormalSourceVersions({ metrics: [{ id: 'm1', capturedAt: '2026-09-01', metricsHash: 'views:11' }], posts: [{ id: 'p1', status: 'published' }] });
assert.notEqual(sameCountBefore, sameCountAfter, 'formal source content changes must invalidate a contract even when record counts stay constant');
assert.equal(
  fingerprintFormalSourceVersions({ product: { id: 'p1', attributes: { color: 'blue', size: 'M' } } }),
  fingerprintFormalSourceVersions({ product: { attributes: { size: 'M', color: 'blue' }, id: 'p1' } }),
  'source fingerprints must be stable across object key ordering',
);
console.log('execution contract tests passed');
