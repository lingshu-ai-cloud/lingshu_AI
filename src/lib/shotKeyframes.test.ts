import assert from 'node:assert/strict';
import test from 'node:test';
import { shotKeyframeCues } from './shotKeyframes.js';

test('builds opening middle and ending frames for every sentence overlapping the shot', () => {
  const rows = shotKeyframeCues({ shotStart: 4, shotEnd: 10, fallbackText: '', cues: [
    { start: 2, end: 5, text: '上一镜延续句' }, { start: 5, end: 8, text: '本镜完整句' }, { start: 8, end: 12, text: '下一镜延续句' },
  ] });
  assert.deepEqual(rows.map(row => row.text), ['上一镜延续句', '本镜完整句', '下一镜延续句']);
  assert.deepEqual(rows[1].frames.map(frame => frame.position), ['开头', '中间', '结尾']);
  assert.ok(rows.every(row => row.frames.every(frame => frame.time >= 0 && frame.time <= 6)));
});

test('falls back to whole-shot three frames when aligned subtitles are unavailable', () => {
  const [row] = shotKeyframeCues({ shotStart: 10, shotEnd: 14, fallbackText: '当前真实口播', cues: [] });
  assert.equal(row.text, '当前真实口播');
  assert.deepEqual(row.frames.map(frame => frame.time), [0.08, 2, 3.92]);
});
