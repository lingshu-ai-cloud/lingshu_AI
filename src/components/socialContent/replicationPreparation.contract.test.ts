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
assert.ok(handler.includes('成片渲染时再生成配音'), 'replication preparation defers voiceover generation until final render');
assert.ok(!handler.includes('await studioApi.alignTts'), 'navigating to storyboards must not submit an alignment request');
assert.ok(handler.includes('setReplicationPreparationError(message)'), 'failures remain actionable on the storyboard page');
assert.ok(handler.includes('replicationPreparationRef.current = false;'), 'release request guard after failure or success');
assert.ok(source.includes('const primaryActionDisabled = replicationTimingBlocked ||'));
assert.ok(source.includes('|| batchShotBusy || savingProj || replicationTimingBlocked'), 'material step action uses the same preparation gate');
assert.ok(source.includes('batchShotBusy || savingProj || replicationTimingBlocked'), 'material step remains blocked while replication preparation is pending');
assert.ok(source.includes('generateSetupScriptAndContinue(replicationConfirmedLinesRef.current)'), 'retry uses confirmed edits');
assert.ok(source.includes('重试口播准备'), 'retry text describes the deferred voiceover workflow');
console.log('Replication preparation navigation and production gates passed');
