import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertReferencePresenterComposition, referencePresenterCompositionIssue } from './referencePresenterComposite.js';

const complete = {
  referenceShotId: 'reference-1:shot-2',
  referenceFirstFrameUrl: '/api/overseas/videos/reference-1/shot/2/first-frame',
  background: '门店货架', framing: '中景', camera: '平视固定', composition: '人物居中，产品位于右侧',
};

test('presenter composition requires the matched reference shot and all spatial evidence', () => {
  assert.equal(referencePresenterCompositionIssue(complete), null);
  assert.doesNotThrow(() => assertReferencePresenterComposition(complete));
  for (const field of Object.keys(complete)) {
    assert.match(referencePresenterCompositionIssue({ ...complete, [field]: '' }) || '', /真人口播|对标分镜/);
  }
});
