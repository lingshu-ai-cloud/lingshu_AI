import assert from 'node:assert/strict';
import test from 'node:test';
import { salesReviewKey, validateSalesReview, hasOnCameraSpeechEvidence } from './salesPresenterReview.js';
const speaker = (index: number, personId = 'person_1') => ({ index, role: 'sales_presenter', personId, confidence: .95, evidence: '同一面部，对镜讲话' });
test('same recurring speaker forms a group; background and inserts do not', () => {
  const rows = validateSalesReview({ shots: [speaker(0), { index: 1, role: 'background', confidence: .98, evidence: '工人背影' }, speaker(2), { index: 3, role: 'none', confidence: .98, evidence: '仅产品' }] }, 4);
  assert.equal(rows.filter(s => s.observedPresenterRole === 'sales_presenter').length, 2);
  assert.equal(rows[0].personContinuityId, rows[2].personContinuityId);
});
test('low confidence, missing identity and conflicting equal speakers are unresolved', () => {
  assert.equal(validateSalesReview({ shots: [{ ...speaker(0), confidence: .7 }] }, 1)[0].observedPresenterRole, 'unknown');
  assert.equal(validateSalesReview({ shots: [speaker(0, '')] }, 1)[0].observedPresenterRole, 'unknown');
  assert.ok(validateSalesReview({ shots: [speaker(0), speaker(1, 'person_2')] }, 2).every(row => row.needsReview));
});
test('incomplete and duplicate responses cannot label a different shot', () => {
  assert.throws(() => validateSalesReview({ shots: [speaker(0)] }, 2));
  assert.throws(() => validateSalesReview({ shots: [speaker(0), speaker(0)] }, 2));
});
test('cache ignores product mappings but changes with source or storyboard', () => {
  const shots = [{ time: '0-2s', visual: 'sales', dialogue: 'hello' }];
  assert.equal(salesReviewKey('hash', shots), salesReviewKey('hash', shots));
  assert.notEqual(salesReviewKey('hash', shots), salesReviewKey('changed', shots));
  assert.notEqual(salesReviewKey('hash', shots), salesReviewKey('hash', [{ ...shots[0], time: '0-3s' }]));
});

test('hands-only product shots and voiceovers cannot enter identity recognition', () => {
  const observed = { faceVisible: true, frontFacing: true, speakingVisible: true, confidence: .95, evidence: '前景人物面向镜头，嘴型变化' };
  assert.equal(hasOnCameraSpeechEvidence(observed), true);
  assert.equal(hasOnCameraSpeechEvidence({ ...observed, faceVisible: false }), false);
  assert.equal(hasOnCameraSpeechEvidence({ ...observed, speakingVisible: false }), false);
  assert.equal(hasOnCameraSpeechEvidence({ ...observed, frontFacing: false }), false);
  assert.equal(hasOnCameraSpeechEvidence({ ...observed, faceVisible: 'true' }), false);
});
