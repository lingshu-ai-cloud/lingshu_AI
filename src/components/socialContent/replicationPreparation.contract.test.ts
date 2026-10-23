import { readAiStudioApplicationSources } from '../../../tests/fixtures/aiStudioApplicationSources.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = readAiStudioApplicationSources();
const handler = source.slice(source.indexOf('const generateSetupScriptAndContinue ='), source.indexOf('const runBatchShotJobs ='));
const taskSync = handler.indexOf('await socialContentApi.getTask');
const applyScript = handler.indexOf('applyTimestampScript(preparedScript)');
const atomicSave = handler.indexOf("const saved = await saveProject('draft', {");
const verifySave = handler.indexOf("if (!saved) throw new Error('口播与分镜尚未保存，请稍后重试。')");
const revealMaterial = handler.indexOf('setStepIdx(materialIndex)');
assert.ok(taskSync > 0 && applyScript > taskSync, 'task context is synchronized before the local script is committed');
assert.ok(atomicSave > applyScript && verifySave > atomicSave && revealMaterial > verifySave,
  'the material step is revealed only after the complete script/storyboard snapshot is durable');
assert.match(handler.slice(atomicSave, verifySave), /activeStepId: 'material'/,
  'the atomic snapshot records the target workbench step');
assert.equal(handler.split('setStepIdx(materialIndex)').length - 1, 1, 'completion must not interrupt user navigation');
assert.ok(handler.includes('if (replicationPreparationRef.current) return false;'), 'prevent duplicate paid requests');
assert.ok(handler.includes('成片渲染时再生成配音'), 'replication preparation defers voiceover generation until final render');
assert.ok(!handler.includes('await studioApi.alignTts'), 'navigating to storyboards must not submit an alignment request');
assert.ok(handler.includes('setReplicationPreparationError(message)'), 'failures remain actionable on the preparation page');
assert.ok(handler.includes('replicationPreparationRef.current = false;'), 'release request guard after failure or success');
assert.ok(source.includes('const primaryActionDisabled = replicationTimingBlocked ||'));
assert.ok(source.includes('|| batchShotBusy || savingProj || replicationTimingBlocked'), 'material step action uses the same preparation gate');
assert.ok(source.includes('batchShotBusy || savingProj || replicationTimingBlocked'), 'material step remains blocked while replication preparation is pending');
assert.ok(source.includes('generateSetupScriptAndContinue(replicationConfirmedLinesRef.current)'), 'retry uses confirmed edits');
assert.ok(source.includes('重试口播准备'), 'retry text describes the deferred voiceover workflow');
console.log('Replication preparation navigation and production gates passed');
