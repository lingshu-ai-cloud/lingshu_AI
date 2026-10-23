import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VideoKickoff } from './studioVideoKickoff';
import { hasIncompleteReferenceAnalysis, recommendMigration, referenceAnalysisEnd, studioReferenceAnalysisBlockers } from './studioReferenceAdmission';

const reference = {
  video: { title: 'Truck production', duration: 10 },
  referenceAnalysis: {
    details: [
      { time: '0-5', visual: 'truck cabin' },
      { time: '5-10', visual: 'truck chassis' },
    ],
  },
} as VideoKickoff;

test('continuous full-duration reference is admitted and its end is measured', () => {
  assert.equal(referenceAnalysisEnd(reference), 10);
  assert.deepEqual(studioReferenceAnalysisBlockers(reference), []);
  assert.equal(hasIncompleteReferenceAnalysis(reference), false);
});

test('missing or overlapping evidence blocks production', () => {
  assert.equal(hasIncompleteReferenceAnalysis(null), true);
  const overlapping = {
    ...reference,
    referenceAnalysis: { details: [{ time: '0-6' }, { time: '5-10' }] },
  } as VideoKickoff;
  assert.match(studioReferenceAnalysisBlockers(overlapping).join('；'), /重叠/);
});

test('cross-category references require structural migration, not a product swap', () => {
  assert.equal(recommendMigration(reference, 'truck chassis').mode, 'fidelity');
  assert.equal(recommendMigration(reference, 'cosmetic serum').mode, 'structure');
  assert.equal(recommendMigration(null, 'cosmetic serum').mode, 'mechanism');
});
