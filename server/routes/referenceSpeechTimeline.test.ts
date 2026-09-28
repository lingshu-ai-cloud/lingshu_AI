import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReferenceSpeechTimeline, type ReferenceStructureInput } from './referenceSpeechTimeline.js';

const sections: ReferenceStructureInput[] = [
  { sectionId: 'hook', title: '工厂人物提问作开场钩子', start: 0, end: 3.5 },
  { sectionId: 'pain', title: '卡粉、褪色等痛点画面', start: 3.5, end: 12 },
  { sectionId: 'fill', title: '灌装与妆效', start: 12, end: 22 },
  { sectionId: 'texture', title: '产品质地和定制展示', start: 22, end: 37 },
  { sectionId: 'trust', title: '生产、检验及合作场景', start: 37, end: 58 },
  { sectionId: 'cta', title: '展厅人物持瓶引导询价', start: 58, end: 63.72 },
];

test('long shot accepts multiple phrase timed sentences and maps a cross-cut voiceover to both shots', () => {
  const result = buildReferenceSpeechTimeline({
    sections,
    shots: [
      { shotId: 'S01', start: 0, end: 0.1 },
      { shotId: 'S02', start: 0.1, end: 3.47 },
      { shotId: 'S26', start: 36.87, end: 44 },
      { shotId: 'S27', start: 44, end: 45 },
    ],
    speech: [
      { start: 0.4, end: 2.5, text: 'Are you looking for a reliable supplier?', timingPrecision: 'phrase', provenance: 'word-aligned-asr', visibility: 'on_camera' },
      { start: 37.1, end: 39.5, text: 'We inspect every batch.', timingPrecision: 'phrase', provenance: 'word-aligned-asr', visibility: 'voiceover' },
      { start: 40.1, end: 42.3, text: 'Our clients trust us.', timingPrecision: 'phrase', provenance: 'word-aligned-asr', visibility: 'voiceover' },
      { start: 43.7, end: 44.3, text: 'Talk to us.', timingPrecision: 'phrase', provenance: 'word-aligned-asr', visibility: 'voiceover' },
    ],
  });
  assert.equal(result.lines.length, 4);
  assert.equal(result.lines[0].primaryShotId, 'S02');
  assert.deepEqual(result.lines[3].shotIds, ['S26', 'S27']);
  assert.deepEqual(result.productionShots.find(shot => shot.shotId === 'S26')?.cueIds,
    ['speech-002', 'speech-003', 'speech-004']);
  assert.deepEqual(result.productionShots.find(shot => shot.shotId === 'S27')?.cueIds, ['speech-004']);
  assert.equal(result.sections[4].speechIds.length, 3);
  assert.equal(result.coarseWindows.length, 0);
});

test('coarse window supplies approximate speech without claiming phrase precision', () => {
  const result = buildReferenceSpeechTimeline({
    sections,
    shots: [{ shotId: 'S02', start: 0.1, end: 3.47 }],
    speech: [{ start: 0, end: 30, text: 'Entire 30 second ASR paragraph', timingPrecision: 'coarse', provenance: 'qwen-asr-chunk' }],
  });
  assert.equal(result.phraseTimedCount, 0);
  assert.equal(result.lines.length, 1);
  assert.equal(result.coarseWindows.length, 1);
  assert.equal(result.coarseWindows[0].timingPrecision, 'coarse');
  assert.equal(result.sections[0].transcript, 'Entire 30 second ASR paragraph');
  assert.deepEqual(result.productionShots[0].cueIds, ['speech-001']);
  assert.deepEqual(result.productionShots[0].coarseEvidenceIds, ['speech-001']);
  assert.equal(result.productionShots[0].speechMode, 'approximate_aligned');
  assert.equal(result.productionReady, false);
});

test('picture cuts control production units: one phrase spans two shots and two phrases share one shot', () => {
  const result = buildReferenceSpeechTimeline({
    sections,
    shots: [
      { shotId: 'HOOK', start: 0, end: 1, content: '人物靠近镜头敲门' },
      { shotId: 'A', start: 1, end: 2 },
      { shotId: 'B', start: 2, end: 3 },
      { shotId: 'C', start: 3, end: 6 },
    ],
    speech: [
      { start: 1, end: 3, text: 'First phrase', timingPrecision: 'phrase', provenance: 'manual', visibility: 'on_camera' },
      { start: 3, end: 4, text: 'Second phrase', timingPrecision: 'phrase', provenance: 'manual', visibility: 'on_camera' },
      { start: 4, end: 5, text: 'Third phrase', timingPrecision: 'phrase', provenance: 'manual', visibility: 'on_camera' },
    ],
    speechCoverageVerified: true,
    shotCutsVerified: true,
  });
  assert.equal(result.productionShots.length, 4);
  assert.equal(result.productionShots[0].speechMode, 'silent_opening_hook');
  assert.deepEqual(result.lines[0].shotIds, ['A', 'B']);
  assert.deepEqual(result.productionShots[1].cueIds, ['speech-001']);
  assert.deepEqual(result.productionShots[2].cueIds, ['speech-001']);
  assert.deepEqual(result.productionShots[3].cueIds, ['speech-002', 'speech-003']);
});
