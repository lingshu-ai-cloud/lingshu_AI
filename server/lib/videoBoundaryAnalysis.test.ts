import assert from 'node:assert/strict';
import test from 'node:test';
import { selectEditBoundary } from './videoBoundaryAnalysis.js';

test('edit boundary prefers a real nearby shot cut over an arbitrary low-motion frame', () => {
  const selected = selectEditBoundary({
    target: 2,
    minimum: 1.5,
    maximum: 2.5,
    candidates: [
      { at: 1.9, motion: 2.2 },
      { at: 2.08, motion: 0, isShotBoundary: true },
    ],
  });
  assert.equal(selected.at, 2.08);
  assert.equal(selected.basis, 'shot_boundary');
  assert.ok(selected.confidence >= .8);
});

test('high-motion boundary stays below the automatic trim confidence gate', () => {
  const selected = selectEditBoundary({
    target: 1,
    minimum: .5,
    maximum: 1.5,
    candidates: [{ at: 1, motion: 22 }],
  });
  assert.ok(selected.confidence < .6);
});
