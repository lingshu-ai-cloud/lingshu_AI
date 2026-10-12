import assert from 'node:assert/strict';
import test from 'node:test';
import { assertReferencePresenterComposition, referencePresenterCompositionIssue } from './referencePresenterComposite.js';

const complete = { referenceShotId: 'shot-1', referenceFirstFrameUrl: '/frame/1', background: '展厅', framing: '中景', camera: '正面固定机位', composition: '人物居中，产品位于右前景' };

test('presenter composition requires the matched reference shot and all visible-scene facts', () => {
  assert.equal(referencePresenterCompositionIssue(complete), null);
  assert.doesNotThrow(() => assertReferencePresenterComposition(complete));
  for (const key of Object.keys(complete)) {
    assert.match(referencePresenterCompositionIssue({ ...complete, [key]: '' }) || '', /真人口播|对标分镜/);
  }
});
