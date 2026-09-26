import assert from 'node:assert/strict';
import { decideShotRoute } from './shotRouting.js';
import type { ShotRoutingAvailability, ShotRoutingRequirements } from '../../shared/contracts/shotRouting.js';

const available: ShotRoutingAvailability = {
  enterprisePresenterReady: true, enterprisePresenterImageReady: true,
  presenterTalkingAvailable: true, firstFrameVideoAvailable: true,
  productSceneReplicationAvailable: true, productIdentityReferencesReady: true,
  accountPresenterProfileConsistent: true,
  ugcActorAvailable: true, materialEditAvailable: true, aiBrollAvailable: true,
  authorizedReferenceMotion: true, budgetAvailable: true,
};

function requirements(patch: Partial<ShotRoutingRequirements> = {}): ShotRoutingRequirements {
  return {
    shotType: 'enterprise_presenter', visualRole: '解释产品卖点', identityRequirement: 'enterprise_presenter', productIdentityRequirement: 'none',
    speechRequirement: 'precise_lip_sync', backgroundRequirement: 'preserve_composition', motionRequirement: 'light_gesture',
    referenceUse: 'first_frame_composition', durationSeconds: 3,
    evidence: { sourceRange: { startSeconds: 0, endSeconds: 3 }, keyframeIds: ['frame-1'], asrText: '设备连续工作八小时。', materialIds: ['reference-1'] },
    confidence: { shotType: .95, identity: .94, speech: .96, background: .91, motion: .9 },
    ...patch,
  };
}

const presenterReplacement = decideShotRoute(requirements(), available);
assert.equal(presenterReplacement.route, 'first_frame_video');
assert.deepEqual(presenterReplacement.fallbackRoutes, ['presenter_talking', 'material_edit']);
assert.equal(presenterReplacement.executable, true);
assert.equal(presenterReplacement.requiresUserConfirmation, true, 'background-preserving enterprise replacement must be reviewed');
assert.ok(presenterReplacement.requiredCapabilities.includes('target_presenter_first_frame'));

const presenterWithFlexibleScene = decideShotRoute(requirements({ backgroundRequirement: 'flexible', referenceUse: 'structure_only' }), available);
assert.equal(presenterWithFlexibleScene.route, 'presenter_talking');
assert.equal(presenterWithFlexibleScene.requiresUserConfirmation, false);

const ugc = decideShotRoute(requirements({ shotType: 'ugc_actor', visualRole: '用户自拍表达痛点', identityRequirement: 'industry_role', speechRequirement: 'voiceover_ok', backgroundRequirement: 'flexible', motionRequirement: 'light_gesture', referenceUse: 'structure_only' }), available);
assert.equal(ugc.route, 'ugc_actor');
assert.match(ugc.reasons.join(' '), /不复刻参考人物身份/);

const productScene = decideShotRoute(requirements({ shotType: 'product_close_up', identityRequirement: 'none', productIdentityRequirement: 'locked_product', speechRequirement: 'none', backgroundRequirement: 'preserve_composition', motionRequirement: 'none', referenceUse: 'first_frame_composition' }), available);
assert.equal(productScene.route, 'product_scene_replication');
assert.equal(productScene.executable, true);
assert.ok(productScene.requiredCapabilities.includes('camera_trajectory_lock'));

for (const shotType of ['factory_operation', 'usage_scene', 'information_card', 'transition_atmosphere'] as const) {
  const decision = decideShotRoute(requirements({ shotType, identityRequirement: 'none', speechRequirement: 'none', backgroundRequirement: 'flexible', motionRequirement: 'none', referenceUse: 'structure_only' }), available);
  assert.equal(decision.route, 'material_edit', `${shotType} should avoid the digital-human route`);
}

const missingImage = decideShotRoute(requirements(), { ...available, enterprisePresenterImageReady: false });
assert.equal(missingImage.executable, false);
assert.equal(missingImage.status, 'needs_input');
assert.ok(missingImage.blockers.some(value => value.includes('可信图片资产')));

const inconsistentAccountPresenter = decideShotRoute(requirements(), { ...available, accountPresenterProfileConsistent: false });
assert.equal(inconsistentAccountPresenter.executable, false);
assert.ok(inconsistentAccountPresenter.blockers.some(value => value.includes('发布账号')));

const missingProductIdentity = decideShotRoute(requirements({ shotType: 'product_close_up', identityRequirement: 'none', productIdentityRequirement: 'locked_product' }), { ...available, productIdentityReferencesReady: false });
assert.equal(missingProductIdentity.executable, false);
assert.ok(missingProductIdentity.blockers.some(value => value.includes('产品身份')));

const uncertain = decideShotRoute(requirements({ confidence: { shotType: .95, identity: .7, speech: .96, background: .91, motion: .9 } }), available);
assert.equal(uncertain.requiresUserConfirmation, true);
assert.equal(uncertain.confidence, .7);

const missingEvidence = decideShotRoute(requirements({ evidence: { keyframeIds: [], materialIds: [] } }), available);
assert.equal(missingEvidence.executable, false);
assert.equal(missingEvidence.status, 'needs_input');
assert.ok(missingEvidence.blockers.some(value => value.includes('证据')));

console.log('Shot routing decision regression passed');
