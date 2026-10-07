import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCaptionTextEdits, sourceCaptionEditKey, subtitleReviewCues } from './subtitleReview';
import { arrangeShotsWithinNarration, sourceCuesForShot } from './narrationTimeline';
import type { SpeechCue } from './narrationAlignment';

test('mixed subtitles retain their source owner and final measured positions', () => {
  const ai = [{ text: 'AI', start: .2, end: 1.8 }, { text: 'AI second', start: 2.1, end: 3.8 }];
  const rows = subtitleReviewCues([
    { targetStart: 0, targetDuration: 3, lockedSourceVoice: true, sourceCues: [{ text: 'avatar', start: .1, end: 2.7 }] },
    { targetStart: 3, targetDuration: 1, voiceAligned: true, voiceStart: 0, voiceEnd: 1 },
    { targetStart: 4, targetDuration: 1, voiceAligned: true, voiceStart: 1, voiceEnd: 2 },
    { targetStart: 5, targetDuration: 2, voiceAligned: true, voiceStart: 2, voiceEnd: 4 },
  ], ai);
  assert.equal(rows.length, 3); // A cue spanning two visual shots is editable once.
  assert.deepEqual(rows[0], { text: 'avatar', start: .1, end: 2.7, source: 'source', shotIndex: 0, cueIndex: 0 });
  assert.equal(rows[1]!.cueIndex, 0);
  assert.equal(rows[1]!.source, 'ai');
  assert.equal(rows[1]!.start, 3.2);
  assert.equal(rows[2]!.start, 5.1);
});

test('missing avatar timing never borrows separately measured AI cues', () => {
  assert.deepEqual(subtitleReviewCues([{ targetDuration: 4, lockedSourceVoice: true }], [{ text: 'wrong audio', start: 0, end: 4 }]), []);
});

test('caption edits expire when source content, timing or transcript changes', () => {
  const cue = { text: 'original', start: .3, end: 1.1 };
  const key = sourceCaptionEditKey('material', 'hash1', cue);
  assert.notEqual(key, sourceCaptionEditKey('material', 'hash2', cue));
  assert.notEqual(key, sourceCaptionEditKey('material', 'hash1', { ...cue, end: 1.2 }));
  assert.notEqual(key, sourceCaptionEditKey('material', 'hash1', { ...cue, text: 'new transcript' }));
});


test('saved text corrections reach arranged render output without changing measured timing or words', () => {
  const source: SpeechCue = { text: 'source', start: .2, end: 1.7,
    words: [{ text: 'source', start: .2, end: 1.7 }] };
  const ai: SpeechCue = { text: 'AI', start: .1, end: 1.8,
    words: [{ text: 'AI', start: .1, end: 1.8 }] };
  const arrange = (sourceCues: SpeechCue[]) => arrangeShotsWithinNarration([
    { targetDuration: 2, lockedDuration: 2, lockedSourceVoice: true, narration: 'source', sourceCues },
    { targetDuration: 2, narration: 'AI' },
  ], ['source', 'AI'], [ai], 2, 'minimax_native');
  const baseline = arrange(sourceCuesForShot([source], 2));
  const arrangedAi = baseline.cues[1]!;
  const owner = 'voice:en:/actual-audio.mp3';
  const edits = JSON.parse(JSON.stringify({
    [sourceCaptionEditKey('actual-source', 'sha256', source)]: 'Corrected source caption',
    [sourceCaptionEditKey(owner, undefined, arrangedAi)]: 'Corrected AI caption',
  })) as Record<string, string>;
  const correctedSource = applyCaptionTextEdits(sourceCuesForShot([source], 2), 'actual-source', 'sha256', edits);
  const result = applyCaptionTextEdits(arrange(correctedSource).cues, owner, undefined, edits);
  assert.deepEqual(result.map(cue => cue.text), ['Corrected source caption', 'Corrected AI caption']);
  assert.deepEqual(result.map(({ start, end, words }) => ({ start, end, words })),
    baseline.cues.map(({ start, end, words }) => ({ start, end, words })));
  assert.equal(correctedSource[0]!.words, source.words);
  assert.equal(result[1]!.words, ai.words);
  assert.equal(source.text, 'source');
  assert.equal(ai.text, 'AI');
  assert.equal(applyCaptionTextEdits([source], 'actual-source', 'replacement-sha256', edits)[0]!.text, 'source');
});
