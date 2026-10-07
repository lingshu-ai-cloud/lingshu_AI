import assert from 'node:assert/strict';
import test from 'node:test';
import { paginateAlignedCues, subtitleCuesAreSafe } from './subtitleCues.js';

test('splits a real Chinese long cue into concise screens while preserving alignment', () => {
  const spoken = '这款面膜采用独立包装，可以用于日常护肤，打开后按照说明均匀涂抹即可。';
  const cues = paginateAlignedCues([{ start: 2, end: 10, text: spoken }], 10)!;
  assert.equal(cues.map(cue => cue.text).join(''), spoken);
  assert.ok(cues.every(cue => cue.text.length <= 16));
  assert.equal(cues[0]?.start, 2);
  assert.equal(cues.at(-1)?.end, 10);
  assert.ok(subtitleCuesAreSafe(cues, 10));
  assert.deepEqual(paginateAlignedCues(cues, 10), cues);
});

test('preserves silence and proportionally distributes subcue time', () => {
  const cues = paginateAlignedCues([
    { start: 0, end: 4, text: '第一段内容较长，需要按照语义和长度进行拆分。' },
    { start: 6, end: 8, text: '第二段保持独立。' },
  ], 8)!;
  assert.equal(cues[0]?.start, 0);
  assert.equal(cues.find(cue => cue.start >= 6)?.start, 6);
  assert.equal(cues.at(-1)?.end, 8);
});
