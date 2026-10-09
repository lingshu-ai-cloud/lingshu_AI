import assert from 'node:assert/strict';
import test from 'node:test';
import { lockReferenceSpeechTimeline, type ReferenceSpeechTranscript } from './referenceSpeechAnalysis.js';
import type { VideoAiAnalysis } from '../types/index.js';

const analysis = (details: VideoAiAnalysis['scriptDetails15s']): VideoAiAnalysis => ({ theme: 'test', hooks: [],
  sellingPoints: [], mood: '', structure: '', recommendedScriptType: 'storyboard', scriptDetails15s: details });
const transcript = (patch: Partial<ReferenceSpeechTranscript>): ReferenceSpeechTranscript => ({ text: '', segments: [],
  provenance: 'qwen_filetrans:measured_words', timestampResolutionMs: 1, accuracyMs: null, ...patch });

test('whole source sentence spans edits but each shot and beat receives only measured word owners', () => {
  const source = analysis([{ time: '0–1s', dialogue: 'old full paragraph', needsReview: true, confidence: .32,
    beats: [{ time: '0–0.7s', action: '伸手', dialogue: 'old invented greeting' },
      { time: '0.7–1s', action: '靠近', dialogue: 'old repeated sentence' }] },
  { time: '1–2s', dialogue: 'old full paragraph', beats: [{ time: '1–2s', action: '指产品', dialogue: 'old sentence' }] }]);
  const result = lockReferenceSpeechTimeline(source, transcript({ text: 'Hi Boss welcome',
    words: [], segments: [{ start: .1, end: 1.8, text: 'Hi Boss welcome', timingPrecision: 'phrase',
      words: [{ start: .1, end: .4, text: 'Hi' }, { start: .9, end: 1.2, text: 'Boss' },
        { start: 1.4, end: 1.8, text: 'welcome' }] }] }));
  assert.deepEqual(result.scriptDetails15s?.map(shot => shot.dialogue), ['Hi', 'Boss welcome']);
  assert.deepEqual(result.scriptDetails15s?.[0].beats?.map(beat => beat.dialogue), ['Hi', '']);
  assert.deepEqual(result.scriptDetails15s?.[0].beats?.map(beat => beat.time), ['0–0.7s', '0.7–1s']);
  assert.equal(result.scriptDetails15s?.[1].beats?.[0].dialogue, 'Boss welcome');
  assert.equal(result.scriptDetails15s?.[0].needsReview, true);
  assert.equal(result.scriptDetails15s?.[0].confidence, .32);
  assert.equal(result.speechAlignmentSummary?.acceptedWordCount, 3);
  assert.equal(source.scriptDetails15s?.[0].dialogue, 'old full paragraph', 'source object must not mutate');
});

test('provider point clock stays zero-length and does not become a sync candidate', () => {
  const result = lockReferenceSpeechTimeline(analysis([{ time: '0–1s' }, { time: '1–2s',
    beats: [{ time: '1–1.5s', action: '伸手' }] }]), transcript({
    words: [{ start: 1, end: 1, text: 'Hi', timingPrecision: 'point' }] }));
  assert.deepEqual(result.scriptDetails15s?.map(shot => shot.dialogue), ['', 'Hi']);
  const word = result.scriptDetails15s?.[1].speechAlignment?.words[0];
  assert.equal(word?.start, 1);
  assert.equal(word?.end, 1);
  assert.equal(word?.syncEligible, false);
  assert.equal(result.scriptDetails15s?.[1].beats?.[0].speechSyncStatus, 'insufficient_evidence');
  assert.ok(result.scriptDetails15s?.[1].audio?.includes('词起点'));
});

test('legacy phrase can remain readable once, but cannot supply beat words or precise sync', () => {
  const result = lockReferenceSpeechTimeline(analysis([{ time: '0–1s' }, { time: '1–3s',
    beats: [{ time: '1–2s', dialogue: 'guessed words' }] }]), transcript({
    segments: [{ start: .5, end: 2.5, text: 'One continuous spoken sentence', timingPrecision: 'phrase', provenance: 'legacy_asr' }] }));
  assert.deepEqual(result.scriptDetails15s?.map(shot => shot.dialogue), ['', 'One continuous spoken sentence']);
  assert.equal(result.scriptDetails15s?.[1].speechAlignment?.timingPrecision, 'phrase');
  assert.equal(result.scriptDetails15s?.[1].speechAlignment?.syncEligible, false);
  assert.equal(result.scriptDetails15s?.[1].beats?.[0].dialogue, '');
  assert.equal(result.scriptDetails15s?.[1].speechAlignment?.words.length, 0);
});

test('coarse fallback and empty transcript remove guessed dialogue without implying proven silence', () => {
  for (const input of [transcript({ segments: [{ start: 0, end: 30, text: 'Full coarse paragraph', timingPrecision: 'coarse' }] }),
    transcript({ text: 'Untimed full transcript', segments: [] })]) {
    const result = lockReferenceSpeechTimeline(analysis([{ time: '0–1s', dialogue: 'guessed',
      beats: [{ time: '0–1s', dialogue: 'guessed beat' }] }]), input);
    assert.equal(result.scriptDetails15s?.[0].dialogue, '');
    assert.equal(result.scriptDetails15s?.[0].beats?.[0].dialogue, '');
    assert.equal(result.scriptDetails15s?.[0].speechAlignment?.syncEligible, false);
    assert.equal(result.scriptDetails15s?.[0].speechAlignment?.words.length, 0);
    assert.ok(!result.scriptDetails15s?.[0].audio?.includes('无口播'));
    if (input.segments.length) assert.equal(result.scriptDetails15s?.[0].needsReview, true, 'coarse fallback keeps legacy quality flag');
  }
});

test('measured 33.58s duration clips old 35.58s last shot, retaining original clock and rejecting later words', () => {
  const result = lockReferenceSpeechTimeline(analysis([{ time: '27.13s–35.58s', visual: 'closing',
    needsReview: true, confidence: .4, beats: [{ time: '32–35.58s', action: '挥手' }] }]),
  transcript({ words: [{ start: 32.1, end: 32.5, text: 'bye' }, { start: 34, end: 34.3, text: 'outside' }] }),
  { duration: 33.58 });
  assert.equal(result.scriptDetails15s?.[0].time, '27.13s–33.58s');
  assert.equal(result.scriptDetails15s?.[0].originalTime, '27.13s–35.58s');
  assert.equal(result.scriptDetails15s?.[0].timelineCorrection, 'clipped_to_measured_video_duration');
  assert.equal(result.scriptDetails15s?.[0].dialogue, 'bye');
  assert.equal(result.scriptDetails15s?.[0].beats?.[0].time, '32.00s–33.58s', 'visible beat must not exceed measured source duration');
  assert.equal(result.scriptDetails15s?.[0].beats?.[0].originalTime, '32–35.58s', 'original observation remains auditable');
  assert.deepEqual(result.speechAlignmentSummary?.unassignedWordIds, ['word-0002']);
  assert.equal(result.scriptDetails15s?.[0].needsReview, true);
  assert.equal(result.scriptDetails15s?.[0].confidence, .4);
});

test('invalid/missing shot or beat clock cannot retain stale precise speech alignment', () => {
  const stale = { schemaVersion: 1 as const, timingPrecision: 'word' as const, provenance: ['old'],
    timestampResolutionMs: 1, accuracyMs: null, confidence: 1, words: [], coarseEvidence: [],
    syncEligible: true, limitations: [] };
  const result = lockReferenceSpeechTimeline(analysis([{ time: '1s', dialogue: 'invented end', speechAlignment: stale,
    criticalShot: { classification: 'critical' } as any,
    beats: [{ time: '1–2s', dialogue: 'stale', speechAlignment: stale }] }, { time: '0–2s',
    beats: [{ time: '0.5s', dialogue: 'invented beat end', speechAlignment: stale }] }]),
  transcript({ words: [{ start: .5, end: 1.2, text: 'Hello' }] }));
  assert.equal(result.scriptDetails15s?.[0].dialogue, '');
  assert.equal(result.scriptDetails15s?.[0].criticalShot, undefined);
  assert.equal(result.scriptDetails15s?.[0].speechAlignment?.timingPrecision, 'unavailable');
  assert.equal(result.scriptDetails15s?.[0].beats?.[0].speechAlignment?.syncEligible, false);
  assert.equal(result.scriptDetails15s?.[1].beats?.[0].dialogue, '');
  assert.equal(result.scriptDetails15s?.[1].beats?.[0].speechAlignment?.timingPrecision, 'unavailable');
});

test('ASR provider metadata and screen captions survive speech locking without precision invention', () => {
  const input = transcript({ taskId: 'task-real', provider: 'qwen', model: 'qwen3-asr-flash-filetrans',
    precision: 'word', words: [{ start: .1, end: .5, text: 'Hi' }],
    segments: [{ start: .1, end: .5, text: 'Hi', timingPrecision: 'phrase', provenance: 'provider', needsReview: false }] });
  const result = lockReferenceSpeechTimeline(analysis([{ time: '0–1s', subtitle: 'old display', onScreenText: '原片屏幕文字',
    needsReview: false, note: '原始备注', materialType: 'talking_head' }]), input);
  assert.equal(result.audioTranscript?.taskId, 'task-real');
  assert.equal(result.audioTranscript?.model, 'qwen3-asr-flash-filetrans');
  assert.equal(result.audioTranscript?.segments[0].needsReview, false);
  assert.equal(result.scriptDetails15s?.[0].subtitle, '原片屏幕文字');
  assert.equal(result.scriptDetails15s?.[0].needsReview, false);
  assert.equal(result.scriptDetails15s?.[0].note, '原始备注');
  assert.equal(result.scriptDetails15s?.[0].speechAlignment?.confidence, null);
  assert.equal(result.scriptDetails15s?.[0].speechAlignment?.accuracyMs, null);
});
