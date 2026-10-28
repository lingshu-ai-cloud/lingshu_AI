import assert from 'node:assert/strict';
import test from 'node:test';
import { verifiedProductCutoutDecision } from './productCutoutPipeline.js';

test('a verified cutout is ready for a single image even if unrelated analysis failed', () => {
  assert.equal(verifiedProductCutoutDecision(false, 'failed'), 'ready');
  assert.equal(verifiedProductCutoutDecision(false, 'analyzing'), 'ready');
});

test('weekly image work keeps analysis as a distinct, explicit gate', () => {
  assert.equal(verifiedProductCutoutDecision(true, 'failed'), 'analysis_failed');
  assert.equal(verifiedProductCutoutDecision(true, 'analyzing'), 'await_analysis');
  assert.equal(verifiedProductCutoutDecision(true, 'completed'), 'await_analysis');
});
