import assert from 'node:assert/strict';
import { hasMeaningfulHandoffResult, normalizeHandoffReferences } from './handoffReturnPolicy.js';

assert.equal(hasMeaningfulHandoffResult({}), false);
assert.equal(hasMeaningfulHandoffResult({ summary: '   ' }), false);
assert.equal(hasMeaningfulHandoffResult({ summary: 'completed with receipt' }), true);
assert.equal(hasMeaningfulHandoffResult({ count: 0 }), true);
assert.equal(hasMeaningfulHandoffResult({ evidence: {} }), false);

assert.equal(normalizeHandoffReferences('not-an-array'), null);
assert.deepEqual(normalizeHandoffReferences(['  ', { id: ' ', url: '  ' }]), []);
assert.deepEqual(normalizeHandoffReferences([' receipt-1 ', { type: 'url', url: ' https://example.test/evidence ' }]), [
  { type: 'reference', id: 'receipt-1' },
  { type: 'url', id: '', label: '', url: 'https://example.test/evidence' },
]);
assert.equal(normalizeHandoffReferences(Array.from({ length: 21 }, () => 'receipt')), null);

console.log('handoff return evidence policy tests passed');
