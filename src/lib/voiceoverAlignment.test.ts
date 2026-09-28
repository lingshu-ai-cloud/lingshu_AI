import assert from 'node:assert/strict';
import test from 'node:test';
import { matchVoiceCuesToShots, productionVoiceCues, retimeVisualShotsToVoiceover } from './voiceoverAlignment';
import { mapNarrationCues } from './narrationAlignment';

test('production receives measured voice cues and ignores proportional estimates', () => {
  const cues = [{ start: 0.2, end: 1.1, text: '第一句' }, { start: 1.25, end: 2.4, text: '第二句' }];
  assert.deepEqual(productionVoiceCues(cues, 'audio_ai', 2.5), cues);
  assert.deepEqual(productionVoiceCues(cues, 'synthesized_sentence_audio', 2.5), cues);
  assert.deepEqual(productionVoiceCues(cues, 'qwen_asr', 2.5), cues);
  assert.deepEqual(productionVoiceCues(cues, 'pending_alignment', 2.5), []);
  assert.deepEqual(productionVoiceCues(cues, 'proportional', 2.5), []);
  assert.deepEqual(productionVoiceCues([{ start: 0, end: 5, text: '越界' }], 'audio_ai', 2.5), []);
});

test('measured word timing becomes exact sentence timing before shot matching', () => {
  const words = [
    { start: 0.1, end: 0.4, text: 'Hello ' },
    { start: 0.45, end: 0.8, text: 'boss.' },
    { start: 1.0, end: 1.3, text: 'Text ' },
    { start: 1.35, end: 1.6, text: 'me.' },
  ];
  const grouped = mapNarrationCues(['Hello boss.', 'Text me.'], words, 2, 'audio_ai');
  assert.deepEqual(grouped.map(item => item && [item.start, item.end]), [[0.1, 0.8], [1, 1.6]]);
});

test('one measured sentence per visual shot follows finished audio boundaries', () => {
  const shots = [{ start: 0, end: 1 }, { start: 1, end: 2 }];
  const cues = [{ start: 0.1, end: 0.7, text: '第一句' }, { start: 0.9, end: 2.3, text: '第二句' }];
  const mapped = matchVoiceCuesToShots(shots, cues, 2.5);
  assert.equal(mapped[0]?.end, 0.9);
  assert.deepEqual(mapped[0]?.cues, [cues[0]]);
  assert.deepEqual(mapped[1]?.cues, [cues[1]]);
});

test('multiple spoken sentences within one physical shot preserve visual cuts', () => {
  const shots = [{ start: 0, end: 2 }, { start: 2, end: 4 }];
  const cues = [{ start: 0.1, end: 0.9, text: '一' }, { start: 1, end: 1.8, text: '二' }, { start: 2.2, end: 3.8, text: '三' }];
  const mapped = matchVoiceCuesToShots(shots, cues, 4);
  assert.deepEqual(mapped.map(item => item.cues.map(cue => cue.text)), [['一', '二'], ['三']]);
});

test('shot lengths follow measured speech while preserving cuts inside a sentence', () => {
  const shots = [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 4 }];
  const source = [{ start: 0, end: 2, text: 'one' }, { start: 2, end: 4, text: 'two' }];
  const measured = [{ start: 0, end: 4, text: 'one' }, { start: 4, end: 5, text: 'two' }];
  assert.deepEqual(retimeVisualShotsToVoiceover(shots, source, measured, 5), [
    { start: 0, end: 2 }, { start: 2, end: 4 }, { start: 4, end: 5 },
  ]);
  assert.equal(retimeVisualShotsToVoiceover(shots, source, measured.slice(0, 1), 5), null);
});
