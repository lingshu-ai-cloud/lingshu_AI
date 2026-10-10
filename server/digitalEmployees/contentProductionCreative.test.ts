import assert from 'node:assert/strict';
import test from 'node:test';
import { closedWorldNarrationLines, socialVideoEffectPlan } from './contentProductionCreative.js';

const scenes = [{ sceneId: 'scene-1', targetDuration: 3, purpose: 'proof', targetVisual: '真实产品特写' }];

test('historic projects remain effect-free and new effect plans are stable', () => {
  assert.equal(socialVideoEffectPlan({ schemaVersion: 3, scenes }), undefined);
  const current = socialVideoEffectPlan({ schemaVersion: 4, scenes });
  assert.equal(current?.schemaVersion, 1);
  assert.equal(current?.scenes[0]?.color, 'original');
  assert.deepEqual(socialVideoEffectPlan({ schemaVersion: 4, stored: current, scenes }), current);
});

test('closed-world fallback does not invent visible actions or an ungoverned CTA', () => {
  const copy = closedWorldNarrationLines([]).join('');
  assert.doesNotMatch(copy, /这个动作|主体和环境|真实细节|私信|联系我们|把.+发来/);
  assert.match(copy, /正式资料|真实验证/);
});
