import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignReferenceWordsToShots, joinReferenceWords } from './referenceWordAlignment.js';

const defaults = { provenance: 'qwen_filetrans:measured_words', timestampResolutionMs: 1, accuracyMs: null };

test('one cross-cut sentence becomes actual word subsets; boundary word owns only one shot', () => {
  const result = alignReferenceWordsToShots({ ...defaults, fps: 25,
    shots: [{ shotId: 'A', start: 0, end: 1 }, { shotId: 'B', start: 1, end: 3 }],
    words: [{ start: .2, end: .6, text: 'Hi' }, { start: .8, end: 1.2, text: 'boss,' },
      { start: 1.4, end: 2, text: 'welcome.' }],
  });
  assert.equal(result.shots[0].dialogue, 'Hi');
  assert.equal(result.shots[1].dialogue, 'boss, welcome.');
  const boundary = result.shots[1].speechAlignment.words[0];
  assert.equal(boundary.start, .8);
  assert.equal(boundary.end, 1.2);
  assert.equal(boundary.overlapStart, 1);
  assert.equal(boundary.overlapEnd, 1.2);
  assert.deepEqual(boundary.overlappingShotIds, ['A', 'B']);
  assert.equal(boundary.boundaryCrossing, true);
  assert.deepEqual(boundary.frameRange, { startInclusive: 25, endExclusive: 30, fps: 25 });
  assert.equal(boundary.confidence, null);
  assert.equal(result.shots[1].speechAlignment.accuracyMs, null);
  assert.ok(boundary.limitations.includes('clock_accuracy_unverified'));
  assert.equal(new Set(result.shots.flatMap(shot => shot.speechAlignment.words.map(word => word.wordId))).size, 3);
});

test('boundary ownership prefers greatest overlap over midpoint and exact adjacent limits are half-open', () => {
  const result = alignReferenceWordsToShots({ ...defaults,
    shots: [{ shotId: 'A', start: 0, end: 1 }, { shotId: 'B', start: 1, end: 2 }],
    words: [{ start: .5, end: 1.1, text: 'first' }, { start: 1, end: 1.2, text: 'second' }],
  });
  assert.equal(result.shots[0].dialogue, 'first');
  assert.equal(result.shots[1].dialogue, 'second');
});

test('beat dialogue uses real intersections, clips to shot, and never repeats full sentence', () => {
  const result = alignReferenceWordsToShots({ ...defaults,
    shots: [{ shotId: 'A', start: 0, end: 2, beats: [
      { beatId: 'reach', start: 0, end: 1 }, { beatId: 'speak', start: 1, end: 4 },
    ] }], words: [{ start: .1, end: .5, text: '嗨' }, { start: .9, end: 1.2, text: 'Boss' },
      { start: 1.3, end: 1.8, text: '欢迎' }],
  });
  assert.equal(result.shots[0].dialogue, '嗨Boss欢迎');
  assert.equal(result.shots[0].beats[0].dialogue, '嗨');
  assert.equal(result.shots[0].beats[1].dialogue, 'Boss欢迎');
  assert.equal(result.shots[0].beats[1].end, 2);
  assert.equal(result.shots[0].beats[1].speechAlignment.words[0].overlapStart, 1);
});

test('coarse-only ASR never supplies exact dialogue or sync evidence', () => {
  const result = alignReferenceWordsToShots({ shots: [{ shotId: 'A', start: 0, end: 1 }], words: [],
    coarseSegments: [{ start: 0, end: 30, text: 'The entire paragraph', provenance: 'inline_window' }],
  });
  assert.equal(result.shots[0].dialogue, '');
  assert.equal(result.shots[0].speechAlignment.timingPrecision, 'coarse');
  assert.equal(result.shots[0].speechAlignment.coarseEvidence[0].text, 'The entire paragraph');
  assert.equal(result.shots[0].speechAlignment.syncEligible, false);
});

test('low confidence, no provenance, coarse resolution, and point timestamps cannot support sync', () => {
  for (const options of [{ confidence: .2 }, { provenance: '' }, { timestampResolutionMs: 1000 },
    { timingPrecision: 'point' as const, end: .2 }]) {
    const result = alignReferenceWordsToShots({ ...defaults, ...options,
      shots: [{ shotId: 'A', start: 0, end: 1 }], words: [{ start: .2, end: .5, text: 'hello', ...options }],
    });
    assert.equal(result.shots[0].speechAlignment.syncEligible, false);
    assert.equal(result.shots[0].dialogue, 'hello');
  }
});

test('zero-duration point at a cut remains original and belongs only to following shot', () => {
  const result = alignReferenceWordsToShots({ ...defaults,
    shots: [{ shotId: 'A', start: 0, end: 1 }, { shotId: 'B', start: 1, end: 2 }],
    words: [{ start: 1, end: 1, text: 'boss', timingPrecision: 'point' },
      { start: 2, end: 2, text: 'outside', timingPrecision: 'point' }],
  });
  assert.equal(result.shots[0].dialogue, '');
  assert.equal(result.shots[1].dialogue, 'boss');
  assert.equal(result.shots[1].speechAlignment.timingPrecision, 'point');
  assert.equal(result.shots[1].speechAlignment.words[0].start, 1);
  assert.equal(result.shots[1].speechAlignment.words[0].end, 1);
  assert.equal(result.shots[1].speechAlignment.syncEligible, false);
  assert.deepEqual(result.unassignedWordIds, ['word-0002']);
});

test('invalid clocks and phrase rows cannot be promoted into word clocks', () => {
  const result = alignReferenceWordsToShots({ ...defaults, shots: [{ shotId: 'A', start: 0, end: 3 }],
    words: [{ start: 0, end: 2, text: 'full sentence', timingPrecision: 'phrase' },
      { start: 0, end: NaN, text: 'bad' }, { start: 3, end: 2, text: 'negative' },
      { start: -1, end: 0, text: 'before' }, { start: 0, end: 1, text: '' },
      { start: 1, end: 2, text: 'real', timingPrecision: 'word' }],
  });
  assert.equal(result.acceptedWordCount, 1);
  assert.equal(result.invalidWordCount, 5);
  assert.equal(result.shots[0].dialogue, 'real');
});

test('word joining preserves English spacing and punctuation and CJK adjacency', () => {
  assert.equal(joinReferenceWords([{ text: 'Hi' }, { text: ',' }, { text: 'Boss' }, { text: '!' }]), 'Hi, Boss!');
  assert.equal(joinReferenceWords([{ text: '你' }, { text: '好' }, { text: '！' }]), '你好！');
});
