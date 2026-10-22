import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCues, confirmedNarrationForTimeRange, parsePronunciationRules, renderSafeCues, subtitleFile } from './studioSubtitleCues.js';

test('confirmed narration is selected by overlapping shot time', () => {
  assert.equal(confirmedNarrationForTimeRange([
    { time: '0-3s', draft: '开场' },
    { time: '3-6s', draft: '产品' },
  ], { start: 0, end: 3 }), '开场');
  assert.equal(confirmedNarrationForTimeRange([], { start: 3, end: 3 }), '');
});

test('subtitle cues keep spoken text within the requested duration', () => {
  const cues = buildCues('第一句。 第二句。', 4);
  assert.ok(cues.length >= 2);
  assert.equal(cues[0]?.start, 0);
  assert.ok(cues.every((cue, index) => cue.end > cue.start && (index === 0 || cue.start >= cues[index - 1]!.start)));
  const safe = renderSafeCues(cues, 3);
  assert.ok(safe.every(cue => cue.end <= 3));
});

test('storyboard field labels are not invented as narration', () => {
  assert.deepEqual(buildCues('画面：展示产品\n镜头功能：开场', 5), []);
});

test('SRT and VTT use distinct timestamp punctuation', () => {
  const cues = [{ start: 0, end: 1.25, text: '真实口播' }];
  assert.match(subtitleFile(cues, 'srt'), /00:00:00,000 --> 00:00:01,250/);
  assert.match(subtitleFile(cues, 'vtt'), /^WEBVTT\n\n1\n00:00:00\.000 --> 00:00:01\.250/);
  assert.deepEqual(parsePronunciationRules('MOQ=M O Q\n无效行'), [{ word: 'MOQ', pronunciation: 'M O Q' }]);
});
