import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeSocialAssetSupplyPlan, type SocialAssetSupplyProviderAdapter } from './socialContentAssetSupplyExecution.js';
import { createSocialDigitalPresenterAdapter, type SocialDigitalPresenterBridgePorts } from './socialContentDigitalPresenterAdapter.js';
import type { SocialAssetSupplyPlan } from '../../shared/contracts/socialContentWorkflow.js';
import type { StoredSocialScriptBaseline } from './socialContentScriptBaseline.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'social-presenter-adapter-'));
const output = path.join(root, 'presenter.mp4');
fs.writeFileSync(output, 'mock-video-bytes');

const baseline: StoredSocialScriptBaseline = {
  schemaVersion: 'social-content-script-baseline.v1', version: 'baseline-1', source: 'knowledge_fallback',
  formulaReference: null, themeId: 'product_value', language: 'zh', lockedAt: '2026-09-25T00:00:00.000Z',
  createdBeforeMaterialAdaptation: true,
  scenes: [{ sceneId: 'shot-1', formulaNodeId: null, shotFunction: '开场', subject: '产品价值', action: '口播说明', narration: '这是已确认的口播。' }],
};
const presenterLock = {
  socialAccountId: 'tiktok-account-1', presenterProfileId: 'presenter-profile-1', presenterProfileVersion: '7',
  presenterAssetId: 'presenter-1', avatarId: 'avatar-1', voiceProfileId: 'voice-1', consentRef: 'consent-1',
  commercialRightsStatus: 'cleared' as const, status: 'published' as const,
  consistencyKey: 'tiktok-account-1:presenter-profile-1:7',
};
const plan: SocialAssetSupplyPlan = {
  planVersion: 'plan-1', creationMode: 'material_processing', assetAvailability: 'ready',
  managementMode: 'one_click_managed', productionRoute: 'zero_asset_generation', status: 'ready',
  overallFeasibility: 'functional_equivalent', canProduceWithoutCustomerShoot: true,
  customerActions: [], systemActions: [], optionalEnhancements: [], accountPresenterLock: presenterLock,
  shots: [{
    shotId: 'shot-1', function: 'hook', requestedDescription: '口播', sourceStrategy: 'authorized_digital_presenter',
    sourceRefs: ['presenter-1'], fallbackSourceStrategy: 'motion_graphics', productionInstruction: '授权人物口播',
    truthBoundary: { subject: 'none', syntheticVisualAllowed: true, customerEvidenceRequired: false,
      customerEvidenceRefs: [], confirmedFactRefs: [], mustNotImplyCustomerReality: true,
      prohibitedRepresentations: ['alter_locked_product_identity', 'present_synthetic_media_as_customer_evidence'] },
    functionalEquivalentReplacement: { required: false, preservesFunction: 'hook', replacesSubject: null, description: null, reason: null },
    feasibility: 'functional_equivalent', feasibilityReason: '授权人物可用', customerShootRequired: false,
    digitalHumanPlan: { workflow: 'material_processing', method: 'talking', presenterAssetIds: ['presenter-1'],
      referenceMaterialIds: [], referenceRequired: false, candidateTools: ['heygen'], executionState: 'ready_for_capability_check',
      accountPresenterLock: presenterLock },
  }],
};

let executeCount = 0;
let capturedKey = '';
let capturedVisualControl: any = null;
const ports: SocialDigitalPresenterBridgePorts = {
  async resolvePresenter() {
    return { presenterAssetId: 'presenter-1', providerId: 'heygen', providerPresenterId: 'avatar-1',
      providerVoiceId: 'voice-1', authorizationRef: 'rights-1', consentRef: 'consent-1', assetVersion: 3, authorized: true,
      socialAccountId: presenterLock.socialAccountId, presenterProfileId: presenterLock.presenterProfileId,
      presenterProfileVersion: presenterLock.presenterProfileVersion, consistencyKey: presenterLock.consistencyKey };
  },
  async authorizeBudget(input) { capturedKey = input.idempotencyKey; return { allowed: true, reservationRef: 'budget-1' }; },
  async execute(input) {
    executeCount += 1;
    assert.equal(input.idempotencyKey, capturedKey);
    assert.equal(input.presenter.consentRef, 'consent-1');
    capturedVisualControl = input.visualControl;
    return { status: 'completed', providerTaskId: 'heygen-task-1', localPath: output,
      contentHash: 'sha256-mock', duration: 3.2, actualCostCny: 1.1 };
  },
};

const completed = await executeSocialAssetSupplyPlan({ tenantId: 'tenant-a', taskId: 'task-a', outputDirectory: root,
  plan, baseline, availableAssets: [], adapters: [createSocialDigitalPresenterAdapter(ports)] });
assert.equal(executeCount, 1);
assert.equal(completed.assets[0]?.providerTaskId, 'heygen-task-1');
assert.equal(completed.assets[0]?.authorizationRef, 'rights-1');
assert.equal(completed.execution.shots[0]?.provenance.synthetic, true);
assert.equal(completed.execution.shots[0]?.provenance.authorizationRef, 'rights-1');
assert.match(completed.execution.shots[0]?.provenance.disclosure || '', /数字人合成/);
assert.equal((completed.assets[0]?.segments[0] as any)?.presenterConsistencyKey, presenterLock.consistencyKey);
assert.equal(capturedVisualControl.precision, 'hook_high');
assert.equal(capturedVisualControl.interaction, 'talking');
assert.match(capturedVisualControl.action.path, /口播说明/);
assert.deepEqual(capturedVisualControl.requiredCapabilities, ['scripted_speech', 'timing_control']);

const complexShot = {
  ...plan.shots[0]!,
  requestedDescription: '人物将精华挤出后涂抹上脸',
  visualContract: {
    schemaVersion: 'social-scene-visual-contract.v1',
    subjects: [
      { subjectId: 'person', kind: 'person', description: '人物', identityRef: null, confidence: 1 },
      { subjectId: 'product', kind: 'product', description: '精华产品', identityRef: 'serum-a', confidence: 1 },
    ],
    interaction: { kind: 'apply_product_to_face', description: '涂抹上脸', actorSubjectId: 'person', objectSubjectId: 'product', contactArea: '面部' },
    environment: { kind: 'bathroom', description: '浴室洗手台', details: [] },
    productUsage: { kind: 'apply_to_face', description: '挤出并涂抹', productId: 'product-a', productRef: 'serum-a' },
    product: { policy: 'locked', requestedProductId: 'product-a', requestedProductRef: 'serum-a', source: 'user_explicit' },
    action: { startState: '手持产品', path: '挤出后涂抹', peakState: '指尖接触面部', endState: '涂抹完成', startSeconds: 0, peakSeconds: 1.4, endSeconds: 2.8 },
    camera: { shotSize: '人物近景', angle: '平视', movement: '轻微推近', composition: '手部和面部不遮挡' },
    precision: 'hook_high', evidence: { sourceRange: { startSeconds: 0, endSeconds: 3 }, keyframeIds: [], confidence: 0.95 },
  },
} as any;
const complexContext = {
  tenantId: 'tenant-a', taskId: 'task-a', outputDirectory: root,
  shot: complexShot, baselineScene: baseline.scenes[0]!, availableAssets: [],
};

let unsupportedExecuted = false;
const talkingOnly = createSocialDigitalPresenterAdapter({
  ...ports,
  capabilities: { methods: ['talking'], controls: ['scripted_speech', 'timing_control'] },
  async execute(input) { unsupportedExecuted = true; return ports.execute(input); },
});
await assert.rejects(() => talkingOnly.execute(complexContext),
  /digital_presenter_capability_unsupported:controls:.*guided_action.*product_interaction/,
  '当前 talking-head provider 不支持产品上脸时必须显式报告能力不足');
assert.equal(unsupportedExecuted, false, '不得向不具备复杂动作能力的 provider 提交付费任务');

const governedKeys: string[] = [];
let governedControl: any = null;
const fullControl = createSocialDigitalPresenterAdapter({
  ...ports,
  capabilities: {
    methods: ['talking'],
    controls: ['scripted_speech', 'timing_control', 'guided_action', 'product_interaction',
      'environment_control', 'camera_control'],
  },
  async authorizeBudget(input) {
    capturedKey = input.idempotencyKey;
    governedKeys.push(input.idempotencyKey);
    return { allowed: true, reservationRef: `budget-${governedKeys.length}` };
  },
  async execute(input) {
    governedControl = input.visualControl;
    return ports.execute(input);
  },
});
await fullControl.execute(complexContext);
await fullControl.execute({
  ...complexContext,
  shot: { ...complexShot, visualContract: { ...complexShot.visualContract,
    action: { ...complexShot.visualContract.action, path: '开盖、挤出后点涂面部' } } },
});
assert.deepEqual(governedControl.timing, {
  startSeconds: 0, endSeconds: 2.8, durationSeconds: 2.8, actionPeakSeconds: 1.4,
});
assert.equal(governedControl.product.productRefs[0], 'serum-a');
assert.ok(governedControl.requiredCapabilities.includes('environment_control'));
assert.ok(governedControl.requiredCapabilities.includes('camera_control'));
assert.notEqual(governedKeys[0], governedKeys[1], '动作控制变化必须生成不同幂等键');

const failedProvider = createSocialDigitalPresenterAdapter({ ...ports, async execute() {
  return { status: 'failed', providerTaskId: 'heygen-task-failed', error: 'provider_failed' };
} });
let fallbackCalls = 0;
const fallback: SocialAssetSupplyProviderAdapter = {
  adapterId: 'test-motion-graphics', sourceStrategies: ['motion_graphics'],
  async execute(context: any) {
    fallbackCalls += 1;
    return { asset: { id: 'fallback', name: '回退图形', type: 'image' as const, sourceId: 'fallback', url: output,
      localPath: output, duration: 2, visualObservations: [], segments: [] }, sourceStrategy: 'motion_graphics' as const,
      providerId: 'local', sourceRef: null, synthetic: true, representation: 'non_evidentiary_visual' as const,
      authorizationRef: null, disclosure: '系统生成说明画面' };
  },
};
const recovered = await executeSocialAssetSupplyPlan({ tenantId: 'tenant-a', taskId: 'task-a', outputDirectory: root,
  plan, baseline, availableAssets: [], adapters: [failedProvider, fallback] });
assert.equal(fallbackCalls, 1);
assert.equal(recovered.execution.shots[0]?.sourceStrategy, 'motion_graphics');
assert.equal(recovered.execution.shots[0]?.fallbackApplied, true);
assert.equal(recovered.execution.shots[0]?.attempts[0]?.status, 'failed');
assert.match(recovered.execution.shots[0]?.attempts[0]?.reason || '', /digital_presenter_not_completed/);

const missingConsent = createSocialDigitalPresenterAdapter({ ...ports, async resolvePresenter() {
  return { presenterAssetId: 'presenter-1', providerId: 'heygen', providerPresenterId: 'avatar-1',
    providerVoiceId: 'voice-1', authorizationRef: 'rights-1', consentRef: '', assetVersion: 3, authorized: true,
    socialAccountId: presenterLock.socialAccountId, presenterProfileId: presenterLock.presenterProfileId,
    presenterProfileVersion: presenterLock.presenterProfileVersion, consistencyKey: presenterLock.consistencyKey };
} });
const noConsent = await executeSocialAssetSupplyPlan({ tenantId: 'tenant-a', taskId: 'task-a', outputDirectory: root,
  plan, baseline, availableAssets: [], adapters: [missingConsent, fallback] });
assert.equal(noConsent.execution.shots[0]?.attempts[0]?.status, 'unavailable');
assert.equal(noConsent.execution.shots[0]?.sourceStrategy, 'motion_graphics');

const wrongAccountProfile = createSocialDigitalPresenterAdapter({ ...ports, async resolvePresenter() {
  return { presenterAssetId: 'presenter-1', providerId: 'heygen', providerPresenterId: 'avatar-1',
    providerVoiceId: 'voice-1', authorizationRef: 'rights-1', consentRef: 'consent-1', assetVersion: 3, authorized: true,
    socialAccountId: presenterLock.socialAccountId, presenterProfileId: presenterLock.presenterProfileId,
    presenterProfileVersion: '8', consistencyKey: 'tiktok-account-1:presenter-profile-1:8' };
} });
const wrongProfileResult = await executeSocialAssetSupplyPlan({ tenantId: 'tenant-a', taskId: 'task-a', outputDirectory: root,
  plan, baseline, availableAssets: [], adapters: [wrongAccountProfile, fallback] });
assert.equal(wrongProfileResult.execution.shots[0]?.attempts[0]?.status, 'unavailable');
assert.equal(wrongProfileResult.execution.shots[0]?.sourceStrategy, 'motion_graphics');

fs.rmSync(root, { recursive: true, force: true });
console.log('social content digital presenter adapter tests passed');
