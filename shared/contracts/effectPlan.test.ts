import assert from 'node:assert/strict';
import test from 'node:test';
import { createIntentEffectPlan, createPresetEffectPlan, normalizeEffectPlan } from './effectPlan.js';

test('EffectPlan rejects arbitrary renderer expressions and clamps values', () => {
  const plan = normalizeEffectPlan({
    schemaVersion: 999,
    presetId: '$(touch /tmp/nope)',
    intensity: 99,
    seed: -4,
    scenes: [{
      sceneId: 'scene 1;movie=/etc/passwd',
      motion: "none,drawtext=text='owned'",
      color: 'evil',
      transitionOut: { type: 'custom_ffmpeg', duration: 90 },
      overlays: [
        { presetId: 'fact_card', layer: 'foreground', start: -9, end: 99, text: '真实卖点\u0000'.repeat(30), expression: 'movie=/etc/passwd' },
        { presetId: 'unknown', start: 0, end: 1 },
      ],
    }],
    audioEvents: [{ presetId: 'impact', at: 999, volume: 50 }, { presetId: 'amovie', at: 0 }],
  }, [{ sceneId: 'scene1', targetDuration: 2 }]);

  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.presetId, 'natural');
  assert.equal(plan.intensity, 3);
  assert.equal(plan.seed, 0);
  assert.equal(plan.scenes[0].motion, 'none');
  assert.equal(plan.scenes[0].color, 'original');
  assert.equal(plan.scenes[0].transitionOut.type, 'cut');
  assert.equal(plan.scenes[0].transitionOut.duration, 0);
  assert.equal(plan.scenes[0].overlays.length, 1);
  assert.ok((plan.scenes[0].overlays[0].text?.length || 0) <= 120);
  assert.deepEqual(plan.audioEvents, [{ presetId: 'impact', at: 2, volume: 1 }]);
  assert.doesNotMatch(JSON.stringify(plan), /movie=|\/etc\/passwd|touch/);
});

test('intent plan maps hook, proof and CTA to conservative scene-aware effects', () => {
  const plan = createIntentEffectPlan([
    { sceneId: 'hook', targetDuration: 2, purpose: 'hook', targetVisual: '首秒展示产品', pace: 'fast' },
    { sceneId: 'proof', targetDuration: 3, purpose: 'proof', targetVisual: '质检参数证据', caption: '实测参数' },
    { sceneId: 'cta', targetDuration: 2, purpose: 'call_to_action', caption: '私信核对需求' },
  ], 2, 198);
  assert.equal(plan.scenes[0].motion, 'push_in');
  assert.equal(plan.scenes[0].transitionOut.type, 'cut');
  assert.equal(plan.scenes[1].motion, 'none');
  assert.equal(plan.scenes[1].color, 'cool');
  assert.ok(plan.scenes[1].overlays.some(overlay => overlay.presetId === 'fact_card'));
  assert.ok(plan.scenes[2].overlays.some(overlay => overlay.presetId === 'cta'));
  assert.equal(plan.beatSync, false);

  const protectedPlan = createIntentEffectPlan([{
    sceneId: 'real-product', targetDuration: 3, purpose: 'proof', targetVisual: '真实产品 Logo 特写',
    caption: '已确认参数', protectedVisual: true,
  }], 2, 9);
  assert.equal(protectedPlan.scenes[0].color, 'original');
  assert.deepEqual(protectedPlan.scenes[0].overlays, [],
    'real product regions stay untouched without a spatial protection mask');
});

test('protected visuals need stable spatial evidence before decorative overlays are allowed', () => {
  const withoutMask = createIntentEffectPlan([{
    sceneId: 'proof', targetDuration: 3, purpose: 'proof', caption: '可见结构', protectedVisual: true,
  }], 2, 1);
  assert.equal(withoutMask.scenes[0]?.overlays.length, 0);
  const withMask = createIntentEffectPlan([{
    sceneId: 'proof', targetDuration: 3, purpose: 'proof', caption: '可见结构', protectedVisual: true,
    spatialEvidence: {
      schemaVersion: 'spatial-mask.v1', provider: 'sam3', maskRef: 'mask:proof', analyzedContentHash: 'abc123',
      temporalStability: .92, safeOverlayAnchors: [{ x: .8, y: .2 }],
    },
  }], 2, 1);
  assert.equal(withMask.scenes[0]?.overlays[0]?.anchor?.x, .8);
});

test('preset generation is deterministic and old projects remain effect-free', () => {
  const timeline = [{ sceneId: 'hook', targetDuration: 1.5 }, { sceneId: 'proof', targetDuration: 2 }];
  const disabled = normalizeEffectPlan(undefined, timeline);
  assert.equal(disabled.intensity, 0);
  assert.ok(disabled.scenes.every(scene => scene.enabled === false && scene.transitionOut.type === 'cut'));

  const first = createPresetEffectPlan('dynamic', 3, timeline, 198);
  const second = createPresetEffectPlan('dynamic', 3, timeline, 198);
  assert.deepEqual(first, second);
  assert.equal(first.scenes[0].enabled, true);
  assert.ok(first.scenes[0].overlays.some(overlay => overlay.presetId === 'sparkle'));
  assert.ok(first.audioEvents.length > 0);
});
