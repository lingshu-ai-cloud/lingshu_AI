import assert from 'node:assert/strict';
import { test } from 'node:test';
import { qwenFrameSeconds, shiftedTimelineLabel, selectFramesForPhysicalCuts } from './videoAnalysisTimelineProjection.js';

test('frame seconds and local timeline labels preserve the source clock', () => {
  assert.equal(qwenFrameSeconds('2.50s'), 2.5);
  assert.equal(qwenFrameSeconds('invalid'), 0);
  assert.equal(shiftedTimelineLabel('1s–3s', 6, 4), '7s–9s');
  assert.equal(shiftedTimelineLabel('3s–9s', 6, 4), '9s–10s');
});

test('physical-cut frame selection favors short-shot midpoint evidence', () => {
  const frames = [0, 0.5, 1, 1.5, 2, 3].map(time => ({ timeLabel: `${time}s` }));
  const selected = selectFramesForPhysicalCuts(frames, [1], 0, 3, 3);
  assert.equal(selected.length, 3);
  assert.ok(selected.some(frame => frame.timeLabel === '0.5s'));
});
