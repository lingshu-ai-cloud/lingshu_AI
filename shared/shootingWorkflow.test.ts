import assert from 'node:assert/strict';
import test from 'node:test';
import { shootingTaskPresentation, shootingSoundInstructions } from './shootingWorkflow.js';
test('task presentation distinguishes uploaded footage from binding eligibility', () => {
  const view = shootingTaskPresentation({ uploadedMaterialIds: ['', null, 'video'], suggestedDurationSec: NaN });
  assert.equal(view.uploadedCount, 1);
  assert.equal(view.done, true);
  assert.equal(view.durationText, '不限');
  assert.match(view.bindingText, /手动选用/);
  assert.equal(shootingTaskPresentation({}).done, false);
});
test('source dialogue has explicit transcription instructions', () => {
  assert.match(shootingSoundInstructions('source'), /转写核对/);
  assert.match(shootingSoundInstructions('silent'), /不混入/);
  assert.match(shootingSoundInstructions(), /草稿旁白/);
});
