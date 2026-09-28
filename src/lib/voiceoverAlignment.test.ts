import assert from 'node:assert/strict';
import test from 'node:test';
import { matchVoiceCuesToShots, productionVoiceCues } from './voiceoverAlignment';

test('production receives measured voice cues and ignores proportional estimates', () => {
  const cues = [{ start: 0.2, end: 1.1, text: '第一句' }, { start: 1.25, end: 2.4, text: '第二句' }];
  assert.deepEqual(productionVoiceCues(cues, 'audio_ai', 2.5), cues);
  assert.deepEqual(productionVoiceCues(cues, 'synthesized_sentence_audio', 2.5), cues);
  assert.deepEqual(productionVoiceCues(cues, 'pending_alignment', 2.5), []);
  assert.deepEqual(productionVoiceCues(cues, 'proportional', 2.5), []);
  assert.deepEqual(productionVoiceCues([{ start: 0, end: 5, text: '越界' }], 'audio_ai', 2.5), []);
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
