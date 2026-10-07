import test from 'node:test';
import assert from 'node:assert/strict';
import { planSeedanceReplication, seedanceTalkingHeadPrompt, spokenLanguageForSeedance } from './seedanceReplicationPlan.js';

test('Seedance speech language follows target copy instead of being fixed to Chinese', () => {
  assert.equal(spokenLanguageForSeedance('Build your skincare brand with us.'), 'English');
  assert.equal(spokenLanguageForSeedance('欢迎来到我们的工厂'), 'Chinese');
  assert.equal(spokenLanguageForSeedance('ブランドを作りましょう'), 'Japanese');
  assert.match(seedanceTalkingHeadPrompt('Build your skincare brand with us.'), /speaks in English/);
  assert.doesNotMatch(seedanceTalkingHeadPrompt('Build your skincare brand with us.'), /speaks in Chinese/);
  assert.match(seedanceTalkingHeadPrompt('Hello', 'Spanish'), /speaks in Spanish/);
  assert.match(seedanceTalkingHeadPrompt('Hello', 'en-US'), /speaks in English/);
  assert.match(seedanceTalkingHeadPrompt('Hello', 'en', { action: 'one small hand gesture', scene: 'front medium shot', preserve: 'camera height and pacing' }), /one small hand gesture[\s\S]*front medium shot[\s\S]*camera height and pacing/);
});

test('plan reports Seedream frames, Seedance videos, reuse, B-roll and 4-15 second blockers', () => {
  const previousRate = process.env.SEEDANCE_ESTIMATED_CNY_PER_SECOND_480P;
  process.env.SEEDANCE_ESTIMATED_CNY_PER_SECOND_480P = '1';
  try {
    const cues: any[] = [
      { id: 'reuse', start: 0, end: 4, personShot: true, compositionClusterId: 'a' },
      { id: 'generate', start: 4, end: 9, personShot: true, compositionClusterId: 'b' },
      { id: 'short', start: 9, end: 11, personShot: true, compositionClusterId: 'c' },
      { id: 'broll', start: 11, end: 14, personShot: false },
    ];
    const plan = planSeedanceReplication({ cues, reuseCueMaterialIds: { reuse: 'material-1' }, compositionClusterIds: ['b', 'c'], resolution: '480p', firstFrameCostCny: .25 });
    assert.deepEqual(plan.reusedCueIds, ['reuse']);
    assert.deepEqual(plan.generatedCueIds, ['generate', 'short']);
    assert.deepEqual(plan.nonPersonCueIds, ['broll']);
    assert.deepEqual(plan.invalidCueIds, ['short']);
    assert.equal(plan.firstFrameCount, 2);
    assert.equal(plan.videoEstimatedCny, 9);
    assert.equal(plan.firstFrameEstimatedCny, .5);
    assert.equal(plan.estimatedCostCny, 9.5);
  } finally {
    if (previousRate === undefined) delete process.env.SEEDANCE_ESTIMATED_CNY_PER_SECOND_480P;
    else process.env.SEEDANCE_ESTIMATED_CNY_PER_SECOND_480P = previousRate;
  }
});

test('fully reused person cues have zero paid Seedream and Seedance work', () => {
  const plan = planSeedanceReplication({ cues: [{ id: 'done', start: 0, end: 4, originalText: '', targetText: '', shotIds: [], personShot: true }], reuseCueMaterialIds: { done: 'clip' }, compositionClusterIds: ['a'], resolution: '720p' });
  assert.equal(plan.firstFrameCount, 0);
  assert.equal(plan.videoEstimatedCny, 0);
  assert.equal(plan.estimatedCostCny, 0);
});
