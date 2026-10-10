import assert from 'node:assert/strict';
import test from 'node:test';
import { photoTalkingBudget } from './photoTalkingBudget.js';

const cue = (id: string, end: number) => ({ id, start: 0, end, personShot: true, originalText: 'Hello boss', targetText: 'Hi boss', shotIds: ['s1'] });

test('one-second photo talking reserves five padded seconds when an explicit rate is configured', () => {
  const quote = photoTalkingBudget({ cues: [cue('hi-boss', 1)], frameCount: 1, fixedHeygenReserveCny: 10,
    env: { HEYGEN_PHOTO_ESTIMATED_CNY_PER_SECOND: '0.8', SEEDREAM_FIRST_FRAME_ESTIMATED_CNY: '0.22' } });
  assert.deepEqual(quote, { heygenByCue: { 'hi-boss': 4 }, heygenCny: 4, firstFrameCny: 0.22, totalCny: 4.22 });
});

test('missing short-clip rate keeps the fixed reserve and long clips cannot exceed its ceiling', () => {
  assert.equal(photoTalkingBudget({ cues: [cue('hi-boss', 1)], frameCount: 1, fixedHeygenReserveCny: 10, env: {} }).totalCny, 10.22);
  assert.throws(() => photoTalkingBudget({ cues: [cue('long', 15)], frameCount: 1, fixedHeygenReserveCny: 10,
    env: { HEYGEN_PHOTO_ESTIMATED_CNY_PER_SECOND: '0.8' } }), /超过管理员单任务上限/);
});
