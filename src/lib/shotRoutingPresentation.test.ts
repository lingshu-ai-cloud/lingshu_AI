import assert from 'node:assert/strict';
import test from 'node:test';
import { newShotProduction } from './shotProduction.js';
import { presentShotRouting, routeLabel } from './shotRoutingPresentation.js';

test('routing presentation keeps enterprise replacement reviewable and reports missing inputs', () => {
  const shot = { ...newShotProduction('销售讲解'), contentType: 'enterprise_presenter' as const, source: 'avatar' as const,
    digitalHuman: { workflow: 'viral_replication' as const, method: 'reenact' as const, contentConfirmed: false, action: '', scene: '', preserve: '' } };
  const decision = presentShotRouting(shot, { hasPresenter: false, hasMaterial: false });
  assert.equal(decision.route, 'first_frame_video');
  assert.equal(decision.requiresUserConfirmation, true);
  assert.ok(decision.missing.some(item => item.includes('企业人物')));
  assert.ok(decision.missing.some(item => item.includes('参考视频')));
  assert.ok(decision.alternatives.some(item => item.label === '人物口播 + 工厂 B-roll'));
});

test('routing presentation does not send product shots into the digital-human route', () => {
  const decision = presentShotRouting({ ...newShotProduction(), contentType: 'factory_scene', source: 'material' }, { hasPresenter: true, hasMaterial: true });
  assert.equal(decision.route, 'material_edit');
  assert.equal(routeLabel(decision.route), '素材剪辑');
  assert.equal(decision.alternatives.some(item => item.source === 'avatar'), false);
});

test('ugc route describes a new industry role instead of reference-person replacement', () => {
  const decision = presentShotRouting({ ...newShotProduction(), contentType: 'ugc', source: 'ai', ugcRole: '采购人员', ugcScenario: '工厂自拍' }, { hasPresenter: false, hasMaterial: false });
  assert.equal(decision.route, 'ugc_actor');
  assert.equal(decision.missing.length, 0);
  assert.ok(decision.reasons.some(item => item.includes('身份不会作为模型输入')));
});
