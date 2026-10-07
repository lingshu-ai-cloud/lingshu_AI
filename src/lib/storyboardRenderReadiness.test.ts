import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canEnterStoryboardRenderStep, evaluateStoryboardRenderReadiness, type RenderReadyShot } from './storyboardRenderReadiness';

const local: RenderReadyShot = { id: 's1', index: 1, title: '产品瓶特写', duration: 2,
  route: 'local', material: { id: 'm1', url: '/m1.mp4', type: 'video', usableDuration: 2.4 },
  productRequired: true, productIds: ['p1'] };

test('all required shots and speech inputs must be ready before render', () => {
  const ai: RenderReadyShot = { id: 's2', index: 2, duration: 3, route: 'ai',
    material: { id: 'm2', url: '/m2.mp4', type: 'video', usableDuration: 3 }, generatedVideoAccepted: true,
    quality: { passed: true } };
  const result = evaluateStoryboardRenderReadiness({ shots: [local, ai], scriptReady: true, voiceoverRequired: true, voiceoverReady: true });
  assert.equal(result.ready, true);
  assert.equal(result.readyCount, 2);
  assert.deepEqual(result.issues, []);
});

test('a first frame or pending generated video cannot be rendered', () => {
  const result = evaluateStoryboardRenderReadiness({ shots: [{ id: 's2', index: 2, duration: 3, route: 'ai',
    material: { id: 'frame', url: '/frame.png', type: 'image' } }], scriptReady: true });
  assert.equal(result.ready, false);
  assert.ok(result.unreadyShots[0].issues.some(issue => issue.code === 'video_not_accepted'));
});

test('reports specific per-shot duration, product and quality blockers', () => {
  const result = evaluateStoryboardRenderReadiness({ shots: [{ ...local, material: { id: 'short', url: '/short.mp4', type: 'video', usableDuration: 1 },
    productIds: [], quality: { passed: false, findings: [{ message: '主体缺失' }] } }], scriptReady: true });
  assert.deepEqual(result.unreadyShots[0].issues.map(issue => issue.code), ['material_too_short', 'quality_failed', 'product_unresolved']);
  assert.match(result.unreadyShots[0].issues[1].message, /主体缺失/);
});

test('a mismatched aspect ratio is not a render blocker', () => {
  const result = evaluateStoryboardRenderReadiness({ shots: [local], scriptReady: true });
  assert.equal(result.ready, true);
});

test('missing storyboard and speech inputs are actionable global blockers', () => {
  const result = evaluateStoryboardRenderReadiness({ shots: [], scriptReady: false, voiceoverRequired: true, voiceoverReady: false });
  assert.deepEqual(result.issues.map(issue => issue.code), ['no_shots', 'script_missing', 'voiceover_missing']);
});

test('render settings require a storyboard, independently of final render readiness', () => {
  assert.equal(canEnterStoryboardRenderStep([]), false);
  assert.equal(canEnterStoryboardRenderStep([local]), true);
});

test('a persisted material assignment is not reported as missing while materials hydrate', () => {
  const result = evaluateStoryboardRenderReadiness({ shots: [{ ...local, material: undefined, materialAssigned: true }], scriptReady: true });
  assert.equal(result.ready, false);
  assert.ok(result.issues.some(issue => issue.code === 'material_unusable'));
  assert.ok(!result.issues.some(issue => issue.code === 'material_missing'));
  assert.match(result.issues[0].message, /已匹配素材/);
});
