import assert from 'node:assert/strict';
import test from 'node:test';
import { arrangeShotsWithinNarration, durationForUnfixedNarration, narrationForUnfixedShots, shotsMissingSourceCues, sourceCuesForShot, voiceoverMatchesNarrationSources, type NarrationTimelineShot } from './narrationTimeline';

test('four visual shots follow four spoken lines split into eight measured subtitle cues', () => {
  const lines = ['第一句前半，第一句后半。', '第二句前半，第二句后半。', '第三句前半，第三句后半。', '第四句前半，第四句后半。'];
  const cues = lines.flatMap((line, index) => [
    { text: line.slice(0, 6), start: index * 4.5, end: index * 4.5 + 2 },
    { text: line.slice(6), start: index * 4.5 + 2.2, end: index * 4.5 + 4 },
  ]);
  const shots: NarrationTimelineShot[] = lines.map(line => ({ narration: line, targetDuration: 5.25, trimStart: 0, trimEnd: 5.25 }));
  const result = arrangeShotsWithinNarration(shots, lines, cues, 18, 'minimax_native');
  assert.equal(result.timeline.length, 4);
  assert.equal(result.cues.length, 8);
  assert.equal(result.duration, 18);
  assert.deepEqual(result.timeline.map(shot => shot.targetEnd), [4.25, 8.75, 13.25, 18]);
  assert.equal(result.timeline[1]?.voiceStart, 4.25);
  assert.equal(result.timeline[1]?.voiceEnd, 8.75);
});

test('seventeen shots keep avatar source audio locked and cut B-roll inside continuous narration', () => {
  const lines = ['数字人一。', '一段较长口播。', '数字人十二。', '继续介绍。', '数字人十五。', '收尾补充。', '数字人十七。'];
  const owners = new Map([[0, 0], [1, 1], [11, 2], [12, 3], [14, 4], [15, 5], [16, 6]]);
  const source = new Map([[0, 3.1], [11, 2.2], [14, 1.8], [16, 3.4]]);
  const shots: NarrationTimelineShot[] = Array.from({ length: 17 }, (_, index) => ({
    narration: owners.has(index) ? lines[owners.get(index)!] : '',
    targetDuration: 1.5,
    trimStart: 0,
    trimEnd: source.get(index) || 2,
    lockedSourceVoice: source.has(index),
    lockedDuration: source.get(index),
  }));
  assert.deepEqual(narrationForUnfixedShots(shots, lines), [lines[1], lines[3], lines[5]]);
  const cues = [
    { text: lines[1]!, start: 0, end: 8 },
    { text: lines[3]!, start: 8, end: 11 },
    { text: lines[5]!, start: 11, end: 14 },
  ];
  const result = arrangeShotsWithinNarration(shots, lines, cues, 14, 'minimax_native');
  assert.equal(result.timeline.length, 17);
  for (const [index, duration] of source) {
    assert.equal(result.timeline[index]?.targetDuration, duration);
    assert.equal(result.timeline[index]?.speed, 1);
    assert.equal(result.timeline[index]?.voiceStart, undefined);
    assert.ok(Math.abs(result.timeline[index]?.targetEnd! - result.timeline[index]?.targetStart! - duration) < 0.001);
  }
  for (let index = 2; index < 11; index++) {
    assert.equal(result.timeline[index - 1]?.voiceEnd, result.timeline[index]?.voiceStart);
  }
  assert.ok(result.timeline.every((shot, index) => index === 0 || shot.targetStart === result.timeline[index - 1]?.targetEnd));
  assert.equal(result.cues.length, 3);
  assert.equal(result.timeline[11]?.targetStart, result.timeline[10]?.targetEnd);
});

test('missing measured text mapping stops render instead of guessing shot boundaries', () => {
  assert.throws(() => arrangeShotsWithinNarration(
    [{ narration: '另一句', targetDuration: 3 }], ['真实口播'],
    [{ text: '真实口播', start: 0, end: 2 }], 2, 'minimax_native',
  ), /未关联到分镜/);
});

test('avatar source media length mismatch is reported while keeping its locked duration', () => {
  const shots: NarrationTimelineShot[] = [
    { narration: '数字人开场', targetDuration: 3, trimStart: 0, trimEnd: 3.4, lockedSourceVoice: true, lockedDuration: 3 },
    { narration: '其他口播', targetDuration: 2, trimStart: 0, trimEnd: 2 },
  ];
  const result = arrangeShotsWithinNarration(shots, ['数字人开场', '其他口播'],
    [{ text: '其他口播', start: 0, end: 2 }], 2, 'minimax_native');
  assert.equal(result.timeline[0]?.targetEnd, 3);
  assert.ok(result.warnings.some(item => item.includes('素材时长与锁定时长')));
});

test('non-avatar speech moves the next avatar start while preserving its duration', () => {
  const shots: NarrationTimelineShot[] = [
    { narration: '前段口播', targetDuration: 4 },
    { narration: '数字人原声', targetDuration: 2, trimStart: 0, trimEnd: 2, lockedSourceVoice: true, lockedDuration: 2 },
  ];
  const result = arrangeShotsWithinNarration(shots, ['前段口播', '数字人原声'],
    [{ text: '前段口播', start: 0, end: 5 }], 5, 'minimax_native');
  assert.deepEqual(result.timeline.map(shot => [shot.targetStart, shot.targetEnd]), [[0, 5], [5, 7]]);
});

test('one short spoken paragraph can cover several quick-cut visuals without a count gate', () => {
  const shots: NarrationTimelineShot[] = [
    { narration: '连续口播', targetDuration: 1 },
    { narration: '', targetDuration: 1 },
    { narration: '', targetDuration: 1 },
    { narration: '', targetDuration: 1 },
  ];
  const result = arrangeShotsWithinNarration(shots, ['连续口播'],
    [{ text: '连续口播', start: 0, end: 1.2 }], 1.2, 'minimax_native');
  assert.equal(result.timeline.length, 4);
  assert.equal(result.duration, 1.2);
  assert.ok(result.timeline.every(shot => shot.targetDuration > 0));
  assert.ok(result.warnings.some(item => item.includes('预览快切效果')));
});

test('translated narration keeps source-language shot ownership while using its own audio timing', () => {
  const shots: NarrationTimelineShot[] = [{ narration: '第一句', targetDuration: 4 }, { narration: '', targetDuration: 2 }, { narration: '第二句', targetDuration: 4 }];
  const result = arrangeShotsWithinNarration(
    shots,
    ['First sentence', 'Second sentence'],
    [{ text: 'First sentence', start: 0, end: 2.8 }, { text: 'Second sentence', start: 3.2, end: 6 }],
    6, 'minimax_native', ['第一句', '第二句'],
  );
  assert.deepEqual(result.paragraphs.map(value => [value.firstShot, value.lastShot]), [[1, 2], [3, 3]]);
  assert.equal(result.timeline[0]?.voiceEnd, result.timeline[1]?.voiceStart);
  assert.equal(result.duration, 6);
});

test('a spoken paragraph may span a fixed avatar and rough B-roll without blocking voice generation', () => {
  const lines = ['数字人介绍产品。', '后续配音。'];
  const shots: NarrationTimelineShot[] = [
    { narration: lines[0], targetDuration: 2, trimStart: 0, trimEnd: 2, lockedSourceVoice: true, lockedDuration: 2 },
    { narration: '', targetDuration: 1.5, targetStart: 2, targetEnd: 3.5 },
    { narration: lines[1], targetDuration: 2, targetStart: 3.5, targetEnd: 5.5 },
  ];
  assert.deepEqual(narrationForUnfixedShots(shots, lines), [lines[1]]);
  assert.equal(durationForUnfixedNarration(shots, lines), 2);
  const result = arrangeShotsWithinNarration(shots, lines,
    [{ text: lines[1], start: 0, end: 2 }], 2, 'minimax_native');
  assert.deepEqual(result.paragraphs.map(item => item.source), ['mixed', 'ai']);
  assert.deepEqual(result.timeline.map(item => [item.targetStart, item.targetEnd]), [[0, 2], [2, 3.5], [3.5, 5.5]]);
  assert.equal(result.timeline[0]?.speed, 1);
  assert.equal(result.timeline[1]?.voiceAligned, true);
  assert.deepEqual([result.timeline[1]?.voiceStart, result.timeline[1]?.voiceEnd], [0, 0]);
  assert.ok(result.warnings.some(item => item.includes('分镜 2 没有口播音轨')));
});

test('AI speech ends at the start of a mixed paragraph whose avatar is its second shot', () => {
  const lines = ['前段配音。', '原声混剪。'];
  const shots: NarrationTimelineShot[] = [
    { narration: lines[0], targetDuration: 2, targetStart: 0, targetEnd: 2 },
    { narration: lines[1], targetDuration: 1, targetStart: 2, targetEnd: 3 },
    { narration: '', targetDuration: 2, trimStart: 0, trimEnd: 2, lockedSourceVoice: true, lockedDuration: 2 },
    { narration: '', targetDuration: 1, targetStart: 5, targetEnd: 6 },
  ];
  const result = arrangeShotsWithinNarration(shots, lines,
    [{ text: lines[0], start: 0, end: 2 }], 2, 'minimax_native');
  assert.deepEqual(result.timeline.map(item => [item.targetStart, item.targetEnd]), [[0, 2], [2, 3], [3, 5], [5, 6]]);
  assert.equal(result.timeline[2]?.voiceStart, undefined);
  assert.deepEqual([result.timeline[1]?.voiceStart, result.timeline[1]?.voiceEnd], [0, 0]);
  assert.deepEqual([result.timeline[3]?.voiceStart, result.timeline[3]?.voiceEnd], [0, 0]);
});

test('source clip captions move with its shot and do not inherit AI audio timestamps', () => {
  const lines = ['配音开场', '数字人原声', '后续配音'];
  const shots: NarrationTimelineShot[] = [
    { narration: lines[0], targetDuration: 2 },
    { narration: lines[1], targetDuration: 3, lockedSourceVoice: true, lockedDuration: 3,
      sourceCues: [{ text: '数字人第一句', start: 0.2, end: 1.2 }, { text: '数字人第二句', start: 1.3, end: 2.8 }] },
    { narration: lines[2], targetDuration: 2 },
  ];
  const result = arrangeShotsWithinNarration(shots, lines,
    [{ text: lines[0], start: 0, end: 2 }, { text: lines[2], start: 2, end: 4 }], 4, 'minimax_native');
  assert.deepEqual(result.cues.map(cue => [cue.text, cue.start, cue.end]), [
    ['配音开场', 0, 2], ['数字人第一句', 2.2, 3.2], ['数字人第二句', 3.3, 4.8], ['后续配音', 5, 7],
  ]);
  assert.deepEqual(shotsMissingSourceCues(shots), []);
});

test('mixed source and B-roll use clip-local captions only on the original audio shot', () => {
  const shots: NarrationTimelineShot[] = [
    { narration: '混剪原声', targetDuration: 2, lockedSourceVoice: true, lockedDuration: 2,
      sourceCues: [{ text: '原声第一句', start: 0, end: 1.5 }] },
    { narration: '', targetDuration: 1.5 },
    { narration: '配音结尾', targetDuration: 1 },
  ];
  const result = arrangeShotsWithinNarration(shots, ['混剪原声', '配音结尾'],
    [{ text: '配音结尾', start: 0, end: 1 }], 1, 'synthesized_sentence_audio');
  assert.deepEqual(result.cues.map(cue => [cue.text, cue.start, cue.end]),
    [['原声第一句', 0, 1.5], ['配音结尾', 3.5, 4.5]]);
});

test('invalid or missing source timing is reported instead of borrowing AI timing', () => {
  assert.deepEqual(sourceCuesForShot([{ text: '超出素材', start: 0, end: 4 }], 3), []);
  const shots: NarrationTimelineShot[] = [
    { narration: '数字人原声', targetDuration: 3, lockedSourceVoice: true, lockedDuration: 3,
      sourceCues: [{ text: '超出素材', start: 0, end: 4 }] },
    { narration: '配音', targetDuration: 1 },
  ];
  assert.deepEqual(shotsMissingSourceCues(shots), [1]);
  const result = arrangeShotsWithinNarration(shots, ['数字人原声', '配音'],
    [{ text: '配音', start: 0, end: 1 }], 1, 'minimax_native');
  assert.deepEqual(result.cues.map(cue => cue.text), ['配音']);
  assert.ok(result.warnings.some(warning => warning.includes('缺少有效的独立字幕时间码')));
});

test('an adopted source shot invalidates old TTS that still speaks its line', () => {
  const lines = ['第一段口播。', '数字人收尾。'];
  const before: NarrationTimelineShot[] = lines.map(narration => ({ narration, targetDuration: 2 }));
  const after: NarrationTimelineShot[] = [{ ...before[0]! }, { ...before[1]!, lockedSourceVoice: true, lockedDuration: 2 }];
  assert.equal(voiceoverMatchesNarrationSources(before, lines, lines.join(' ')), true);
  assert.equal(voiceoverMatchesNarrationSources(after, lines, lines.join(' ')), false);
  assert.equal(voiceoverMatchesNarrationSources(after, lines, lines[0]!), true);
});
