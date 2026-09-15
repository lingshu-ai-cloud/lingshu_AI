import assert from 'node:assert/strict';
import { resolveContentBlocker } from './contentBlockerResolution.js';

const blocked = { script: '原脚本', renderOutputPath: '/tmp/old.mp4', sceneSourcePlan: [{ sceneIndex: 0 }], automation: { stage: 'blocked', status: 'blocked', resumeStage: 'material_match', blocker: '匹配度不足', contentVersion: 2 } };
const retry = resolveContentBlocker(blocked, 'retry');
assert.equal(retry.automation.stage, 'material_match');
assert.equal(retry.automation.status, 'queued');
assert.equal(retry.renderOutputPath, '');
assert.equal(retry.automation.contentVersion, 3);
assert.equal(retry.revisionHistory.at(-1).snapshot.blocker, '匹配度不足');

const relaxed = resolveContentBlocker(blocked, 'relax_non_core');
assert.equal(relaxed.materialMatchPolicy.allowCompositionVariance, true);
assert.equal(relaxed.materialMatchPolicy.preserveFactBoundary, true);

const rewritten = resolveContentBlocker(blocked, 'rewrite_scene');
assert.equal(rewritten.automation.stage, 'script');
assert.deepEqual(rewritten.sceneSourcePlan, []);
assert.equal(rewritten.scenePlanOrigin, 'director');
assert.throws(() => resolveContentBlocker({ automation: { stage: 'render' } }, 'retry'), /没有等待处理/);
console.log('content blocker resolution passed');
