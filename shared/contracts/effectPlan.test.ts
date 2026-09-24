import assert from 'node:assert/strict';
import test from 'node:test';
import { createPresetEffectPlan, normalizeEffectPlan } from './effectPlan.js';

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
