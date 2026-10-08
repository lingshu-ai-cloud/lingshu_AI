import assert from 'node:assert/strict';
import { normalizeFreeCreationState } from './freeCreationProject';

const restored = normalizeFreeCreationState({
  hookSource: 'ai', hookMaterialId: 'ai-hook-video-1', currentStep: 1,
  brief: { productIds: ['p1'], goal: '种草', audience: '采购商', platform: 'TikTok', language: 'zh', durationSeconds: 20 },
  script: { lines: [] },
});
assert.equal(restored.hookSource, 'ai');
assert.equal(restored.hookMaterialId, 'ai-hook-video-1', 'adopted AI hook material must survive draft restoration');

const none = normalizeFreeCreationState({ ...restored, hookSource: 'none', hookMaterialId: 'stale' });
assert.equal(none.hookMaterialId, '', 'switching to no hook must clear stale material identity');

console.log('free creation AI hook state contract passed');
