import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../AiCreateStudio.tsx', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('const generateSetupScriptAndContinue ='), source.indexOf('const runBatchShotJobs ='));
const firstAwait = handler.indexOf('await socialContentApi.getTask');
assert.ok(firstAwait > 0);
for (const action of ['applyTimestampScript(plan.script)', 'setStepIdx(materialIndex)', "setCanvasView('creation')", 'setVoiceoverStaleLangs(Object.keys(voiceoverAudios))']) {
  assert.ok(handler.indexOf(action) >= 0 && handler.indexOf(action) < firstAwait, `${action} must happen before network requests`);
}
assert.equal(handler.split('setStepIdx(materialIndex)').length - 1, 1, 'completion must not interrupt user navigation');
assert.ok(handler.includes('if (replicationPreparationRef.current) return;'), 'prevent duplicate paid requests');
assert.ok(handler.indexOf('replicationPreviewAudioRef.current = { text: spoken, audio }') < handler.indexOf('await studioApi.alignTts'), 'retain valid audio for alignment retries');
assert.ok(handler.includes('setReplicationPreparationError(message)'), 'failures remain actionable on the storyboard page');
assert.ok(handler.includes('replicationPreparationRef.current = false;'), 'release request guard after failure or success');
assert.ok(source.includes('disabled={replicationTimingBlocked || batchShotBusy || materialSelectLoading}'));
assert.ok(source.includes('const primaryActionDisabled = replicationTimingBlocked ||'));
assert.ok(source.includes('disabled: replicationTimingBlocked ||'));
assert.ok(source.includes('generateSetupScriptAndContinue(replicationConfirmedLinesRef.current)'), 'retry uses confirmed edits');
console.log('Replication preparation navigation and production gates passed');
