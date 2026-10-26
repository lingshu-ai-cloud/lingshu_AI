import test from 'node:test';
import assert from 'node:assert/strict';
import { correctRepeatedSpokenWords, reviewSpokenCopy, spokenCopyReviewNotice } from './socialSpokenCopyReview.js';

test('flags repeated source wording before voice handoff without changing source or timings', () => {
  const scenes = [{ sceneId: 'opening', text: 'Stop launching products based on only on guesswork.' }];
  const before = JSON.stringify(scenes);
  assert.deepEqual(reviewSpokenCopy(scenes).map(({ sceneId, code, excerpt }) => ({ sceneId, code, excerpt })),
    [{ sceneId: 'opening', code: 'repeated_preposition', excerpt: 'on only on' }]);
  assert.match(spokenCopyReviewNotice(scenes), /口播待校对.*on only on/);
  assert.equal(reviewSpokenCopy(scenes)[0]?.suggestedText, 'Stop launching products based only on guesswork.');
  assert.equal(correctRepeatedSpokenWords('The the product is based on only on guesswork.'), 'The product is based only on guesswork.');
  assert.equal(JSON.stringify(scenes), before);
});
test('preserves legitimate repetition, sentence boundaries and languages outside this narrow check', () => {
  for (const text of ['She had had enough.', 'I know that that works.', 'Based only on evidence.', 'Put it on. On the table.', '非常非常好。'])
    assert.deepEqual(reviewSpokenCopy([{ sceneId: 'scene', text }]), [], text);
  assert.equal(reviewSpokenCopy([{ sceneId: 'one', text: 'the' }, { sceneId: 'two', text: 'the product' }]).length, 0);
  assert.equal(reviewSpokenCopy([{ sceneId: 'one', text: 'Try the the product with just with water.' }]).length, 2);
});
