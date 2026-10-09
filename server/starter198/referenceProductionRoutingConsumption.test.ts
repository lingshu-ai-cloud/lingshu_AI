import assert from 'node:assert/strict';
import test from 'node:test';
import { createSocialAssetSupplyPlan } from '../../shared/socialContentAssetSupply.js';
import { buildReferenceShotProductionRouting } from '../../shared/referenceShotProductionRouting.js';
import type { SocialReferenceShotAnalysis } from '../../shared/contracts/socialContentWorkflow.js';
import type { StoredSocialScriptBaseline } from './socialContentScriptBaseline.js';
import { alignSocialAssetSupplyPlanToBaseline, executeSocialAssetSupplyPlan,
  type SocialAssetSupplyProviderAdapter } from './socialContentAssetSupplyExecution.js';

const lock = { socialAccountId: 'account-1', presenterProfileId: 'profile-1', presenterProfileVersion: '1',
  presenterAssetId: 'account-presenter', avatarId: 'avatar-1', voiceProfileId: 'voice-1', consentRef: 'consent-1',
  commercialRightsStatus: 'cleared' as const, status: 'published' as const, consistencyKey: 'account-1:profile-1:1' };
function reference(unknown = false): SocialReferenceShotAnalysis {
  const evidence = { time: '0–3s', personPresence: 'person' as const,
    observedPresenterRole: unknown ? 'unknown' as const : 'sales_presenter' as const, personContinuityId: 'person_1',
    confidence: .95, evidence: ['0.1和2.8秒原片人物帧'], frameSeconds: [.1, 2.8],
    model: 'qwen3-vl-flash', provenance: 'qwen_vl:source_frames', sourceSha256: 'sha' };
  const routing = buildReferenceShotProductionRouting({ sourceSha256: 'sha', shots: [{ shotId: 'reference-person', time: '0–3s',
    criticalShot: { classification: 'non_critical' }, presenterContinuityEvidence: evidence }] }).shots[0].productionRouting;
  return { shotId: 'reference-person', startSeconds: 0, endSeconds: 3, visualDescription: '主讲介绍工厂', spokenText: '工厂介绍',
    captionText: null, audioDescription: null, rhythmDescription: '稳定', purpose: 'proof',
    referenceProductionRouting: routing, presenterContinuityEvidence: evidence,
    tags: { subjects: ['人物'], subjectRelations: [], sceneTypes: ['工厂'], cameraLanguage: [], contentFunctions: ['proof'],
      soundTypes: [], onScreenInformation: [], truthRequirements: [], suggestedProductionMethods: [] },
    fidelityPoints: [], mustDifferPoints: [] };
}
function plan(options: { unknown?: boolean; withLock?: boolean } = {}) {
  return createSocialAssetSupplyPlan({ creationMode: 'viral_replication', referenceShots: [reference(options.unknown)],
    accountPresenterLock: options.withLock === false ? undefined : lock,
    inventory: { customerVideoIds: ['generic-person'], factoryEvidenceAssetIds: ['generic-factory'],
      presenterAssetIds: ['account-presenter'], referenceVideoIds: ['source-video'], licensedStockAssetIds: ['stock-person'] },
    shots: [{ shotId: 'scene-person', referenceShotId: 'reference-person', function: 'proof',
      truthSensitiveSubject: 'customer_factory', requestedDescription: '主讲介绍工厂' }] });
}
const baseline: StoredSocialScriptBaseline = { schemaVersion: 'social-content-script-baseline.v1', version: 'baseline-1',
  source: 'knowledge_fallback', formulaReference: null, themeId: null, language: 'zh', lockedAt: '2026-10-10T00:00:00Z',
  createdBeforeMaterialAdaptation: true, scenes: [{ sceneId: 'scene-person', formulaNodeId: null, shotFunction: 'proof',
    subject: '主讲介绍工厂', action: '手势', voiceover: '工厂介绍', narration: '工厂介绍' }] };

test('noncritical source presenter overrides abundant ordinary factory/library assets and binds current account identity', () => {
  const result = plan();
  assert.equal(result.shots[0].sourceStrategy, 'authorized_digital_presenter');
  assert.equal(result.shots[0].fallbackSourceStrategy, null);
  assert.deepEqual(result.shots[0].sourceRefs, ['account-presenter']);
  assert.equal(result.shots[0].referenceProductionRouting?.tier, 'standard');
  assert.equal(result.shots[0].referenceProductionRouting?.identityLock?.targetPresenterAssetId, 'account-presenter');
  assert.equal(result.shots[0].digitalHumanPlan?.referenceRequired, true);
  assert.deepEqual(result.shots[0].digitalHumanPlan?.referenceMaterialIds, ['source-video']);
  const aligned = alignSocialAssetSupplyPlanToBaseline({ plan: result, baseline });
  assert.equal(aligned.shots[0].referenceProductionRouting?.route, 'reference_frame_presenter');
  assert.equal(aligned.shots[0].sourceStrategy, 'authorized_digital_presenter');
});

test('unknown source role cannot create an ordinary matching plan', () => {
  assert.throws(() => plan({ unknown: true }), /reference_person_automatic_analysis_required/);
});

test('execution does not downgrade presenter to any material or graphic adapter if presenter provider is unavailable', async () => {
  let ordinaryCalls = 0;
  const ordinary: SocialAssetSupplyProviderAdapter = { adapterId: 'must-not-run', sourceStrategies: ['customer_real_asset', 'licensed_stock_asset', 'motion_graphics'],
    async execute() { ordinaryCalls++; throw new Error('ordinary adapter must not run'); } };
  await assert.rejects(() => executeSocialAssetSupplyPlan({ tenantId: 'tenant', taskId: 'task', outputDirectory: '/tmp',
    plan: plan(), baseline, availableAssets: [], adapters: [ordinary] }), /authorized_digital_presenter:adapter_not_registered/);
  assert.equal(ordinaryCalls, 0);
});

test('missing account identity is explicitly blocked before any paid presenter adapter, without inventing an asset', async () => {
  const result = plan({ withLock: false });
  assert.equal(result.shots[0].referenceProductionRouting?.identityLock?.targetPresenterAssetId, null);
  assert.equal(result.shots[0].digitalHumanPlan?.accountPresenterLock, null);
  let calls = 0;
  await assert.rejects(() => executeSocialAssetSupplyPlan({ tenantId: 'tenant', taskId: 'task', outputDirectory: '/tmp', plan: result,
    baseline, availableAssets: [], adapters: [{ adapterId: 'presenter', sourceStrategies: ['authorized_digital_presenter'],
      async execute() { calls++; throw new Error('must not submit'); } }] }), /reference_presenter_account_identity_required/);
  assert.equal(calls, 0);
});

test('execution catches a later candidate selection that attempts to substitute a generic material', async () => {
  const changed = plan();
  changed.shots[0].sourceStrategy = 'customer_real_asset';
  changed.shots[0].sourceRefs = ['generic-person'];
  await assert.rejects(() => executeSocialAssetSupplyPlan({ tenantId: 'tenant', taskId: 'task', outputDirectory: '/tmp',
    plan: changed, baseline, availableAssets: [], adapters: [] }), /reference_presenter_identity_route_violation/);
});

test('execution preserves the source reference requirement instead of submitting an unconstrained generic talking head', async () => {
  const changed = plan();
  changed.shots[0].digitalHumanPlan!.referenceRequired = false;
  changed.shots[0].digitalHumanPlan!.referenceMaterialIds = [];
  let calls = 0;
  await assert.rejects(() => executeSocialAssetSupplyPlan({ tenantId: 'tenant', taskId: 'task', outputDirectory: '/tmp',
    plan: changed, baseline, availableAssets: [], adapters: [{ adapterId: 'presenter', sourceStrategies: ['authorized_digital_presenter'],
      async execute() { calls++; throw new Error('must not submit'); } }] }), /reference_presenter_source_evidence_required/);
  assert.equal(calls, 0);
});
