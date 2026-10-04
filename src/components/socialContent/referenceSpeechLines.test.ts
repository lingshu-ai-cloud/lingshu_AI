import assert from 'node:assert/strict';
import { referenceSpeechLines } from './referenceSpeechLines';

const lines = referenceSpeechLines([
  { time: '5.60–11.19s', dialogue: 'Repairing masks, whitening cream.', visual: '手持包装' },
  { time: '5.6–11.19s', dialogue: 'Repairing masks, whitening cream.', visual: '粉体特写' },
  { time: '5.60–11.19s', dialogue: 'Repairing masks, whitening cream.', visual: '瓶身特写' },
  { time: '5.60–11.19s', dialogue: 'Repairing masks, whitening cream.', visual: '灌装' },
  { time: '5.60–11.19s', dialogue: 'Repairing masks, whitening cream.', visual: '封口' },
  { time: '5.60–11.19s', dialogue: 'Repairing masks, whitening cream.', visual: '成品' },
  { time: '11.19–14.00s', dialogue: 'Repairing masks, whitening cream.', visual: '下一段画面' },
]);

assert.equal(lines.length, 2, 'the same utterance spanning six cuts should be listed once');
assert.equal(lines[0].visualShotCount, 6);
assert.equal(lines[0].shots.length, 6);
assert.deepEqual(lines[0].visuals, ['手持包装', '粉体特写', '瓶身特写', '灌装', '封口', '成品']);
assert.equal(lines[1].visualShotCount, 1, 'the same words at a later time are a separate utterance');
