import assert from 'node:assert/strict';
import test from 'node:test';
import type { BenchmarkAnalysis, BenchmarkShot } from '../../shared/benchmarkAnalysis.js';
import type { ProductionOnboardingPreferences } from '../../shared/contracts/productionOnboarding.js';
import { buildLocalMaterialSegmentProfile } from '../../shared/contracts/localMaterialSegmentProfile.js';
import { buildMaterialScriptAnalysis } from '../../shared/materialScriptAnalysis.js';
import type { EnterpriseProfile } from '../routes/enterprise.js';
import { enterpriseFactContentHash } from '../routes/enterprise.js';
import { normalizeProfile } from '../routes/enterpriseProfileStore.js';
import { resolveKnowledgeBinding } from './configuration.js';
import type { AssetCandidate } from './contentProductionContracts.js';
import {
  enterpriseOnboardingEvidence,
  compatibleProductionOnboardingPreferences,
  evaluateServerProductionOnboardingReadiness,
  fixedYieldArchetypeForBenchmarkShot,
  inventoryFixedYieldArchetypes,
  missingFixedYieldLocalMaterials,
  readServerProductionOnboardingReadiness,
  referenceCoveredByProductionEvidence,
  requiredFixedYieldArchetypes,
  requiredFixedYieldLocalMaterials,
} from './productionOnboardingPreflight.js';

const shot = (partial: Partial<BenchmarkShot> = {}): BenchmarkShot => ({
  shotId: 'shot-1', index: 1, time: '0-3', start: 0, end: 3,
  materialType: 'factory', narrativeRole: 'capability_proof',
  classificationSource: 'model', classificationEvidence: '真实可见事实',
  visual: '自动旋盖机器特写', dialogue: '', onScreenText: '', purpose: '展示设备能力',
  firstFrameRef: '/api/reference/first', clipRef: '/api/reference/clip', needsReview: false,
  granularity: 'shot', environment: '工厂车间', framing: '近景', camera: '固定',
  audio: '', authenticity: '真实素材', effectivenessHypothesis: '', detailedAnalysis: {},
  ...partial,
});

const analysis = (shots: BenchmarkShot[]): BenchmarkAnalysis => ({
  schemaVersion: 1,
  source: { videoId: 'reference-1', analysisRunId: 'analysis-1', evidenceRevision: 'rev-1', correctionVersion: 0, analyzedAt: '2026-10-01T00:00:00Z', analysisMode: 'exact' },
  status: 'ready', gaps: [], hookShotId: shots[0]?.shotId ?? null, shots, totalShots: shots.length,
  timelineComplete: true,
  materialCounts: { talking_head: 0, factory: 0, product: 0, consumer_demo: 0, general: 0, unknown: 0 },
  structure: shots.map(item => ({ materialType: item.materialType, narrativeRole: item.narrativeRole, shotIds: [item.shotId] })),
  speechGroups: [],
});

const preferences: ProductionOnboardingPreferences = {
  schemaVersion: 'fixed-yield.production-onboarding.v1',
  contact: { kind: 'email', value: 'sales@example.com', primaryCta: 'Contact our sales team' },
  presenterPolicy: 'local_video_only',
  output: { primaryLanguage: 'en', aspectRatio: '9:16', resolution: '1080p' },
  includeOneRevision: true,
  confirmedAt: '2026-10-01T00:00:00Z',
};

const ownedVideo = (overrides: Partial<AssetCandidate> = {}): AssetCandidate => {
  const asset: AssetCandidate = {
    id: 'asset-1', name: '自动旋盖设备', type: 'video', duration: 3,
    observations: ['自动旋盖机器运行'], visualObservations: ['自动旋盖机器运行'], productId: 'product-1',
    segments: [{ id: 'segment-1', start: 0, end: 3, action: '机器连续旋盖', environment: '工厂车间',
      observedFacts: ['自动旋盖机器运行'], confidence: .95, boundaryConfidence: .95,
      cleanEntry: true, cleanExit: true, needsReview: false }],
    authorization: { status: 'owned', scope: 'tenant', evidence: 'tenant upload' },
    rightsEvidenceRefs: ['rights://tenant-a/asset-1'],
    commercialUseApproved: true,
    commercialUseApprovalEvidenceRefs: ['approval://tenant-a/asset-1'],
    modelInputAllowed: true,
    derivativeUseAllowed: true,
    synthetic: false, tags: ['工厂', '机器'], source: 'tenant_material',
    ...overrides,
  };
  if (!overrides.scriptAnalysis) asset.scriptAnalysis = buildMaterialScriptAnalysis({
    materialId: asset.id,
    name: asset.name,
    sourceRevision: 'asset-revision-1',
    duration: asset.duration,
    segments: asset.segments,
    visualObservations: asset.visualObservations,
    productId: asset.productId,
    productRef: asset.productId,
  });
  return asset;
};

function confirmedProfile(): EnterpriseProfile {
  const profile = {
    company: { name: 'Aurelia', industry: 'Beauty manufacturing', mainMarkets: 'US', founded: '2018', description: 'Cosmetics OEM factory' },
    products: { categories: 'Cleanser', priceRange: '', moq: '1000', certifications: '', highlights: 'Low MOQ', items: [{ id: 'product-1', name: 'Foam cleanser', sku: 'FC-1', category: 'Cleanser', highlights: 'Low MOQ' }] },
    brand: { name: 'Aurelia', tone: 'Professional', style: '', taboos: '', usp: 'OEM expertise' },
    knowledge: '', dataGovernance: { aiAccessEnabled: true },
  } as EnterpriseProfile;
  profile.factVersion = {
    id: 'facts-1', revision: 1, contentHash: enterpriseFactContentHash(profile),
    confirmedAt: '2026-10-01T00:00:00Z', confirmedBy: 'owner-1',
  };
  return profile;
}

test('reference and inventory classifiers produce exact fixed-yield archetypes without a model call', () => {
  assert.equal(fixedYieldArchetypeForBenchmarkShot(shot()), 'P3B_MACHINE_CLOSEUP');
  assert.equal(fixedYieldArchetypeForBenchmarkShot(shot({ materialType: 'product', visual: '第一视角手持产品，背景为整面产品墙' })), 'P2A_HANDHELD_PRODUCT_WALL');
  assert.equal(fixedYieldArchetypeForBenchmarkShot(shot({ materialType: 'consumer_demo', narrativeRole: 'effect_proof', visual: '展示使用后效果' })), 'P4C_USAGE_RESULT');
  assert.deepEqual(requiredFixedYieldArchetypes([{ productionRole: 'master', benchmarkAnalysis: analysis([shot(), shot({ shotId: 'shot-2' })]) }]), ['P3B_MACHINE_CLOSEUP']);
  assert.deepEqual(inventoryFixedYieldArchetypes([ownedVideo()], { tenantId: 'tenant-a' }), ['P3B_MACHINE_CLOSEUP']);
});

test('managed clone leaves non-person footage to its real per-shot executor instead of the fixed-yield catalogue', () => {
  const plans = [{ route: 'clone' as const, productionRole: 'master' as const, productId: 'product-1',
    benchmarkAnalysis: analysis([shot({ materialType: 'product', narrativeRole: 'product_intro', visual: '产品包装静态展示' })]) }];
  assert.deepEqual(requiredFixedYieldArchetypes(plans), []);
  assert.deepEqual(requiredFixedYieldLocalMaterials(plans), []);
  assert.equal(evaluateServerProductionOnboardingReadiness({ preferences, evidence: {
    companyReady: true, brandReady: true, productFactsReady: true, presenterReady: false,
    voiceReady: false, inventoryArchetypes: [], budgetConfirmed: true,
  }, plans }).ready, true);
});

test('inventory coverage accepts licensed shared video and rejects synthetic, unreviewed and image-only records', () => {
  const invalid = [
    ownedVideo({ id: 'shared', source: 'licensed_shared_material', authorization: { status: 'licensed', scope: 'shared', evidence: 'license' } }),
    ownedVideo({ id: 'synthetic', synthetic: true }),
    ownedVideo({ id: 'unreviewed', segments: [{ start: 0, end: 3, action: '机器运行', needsReview: true }] }),
    ownedVideo({ id: 'image', type: 'image' }),
  ];
  assert.deepEqual(inventoryFixedYieldArchetypes(invalid, { tenantId: 'tenant-a' }), ['P3B_MACHINE_CLOSEUP']);
});

test('inventory readiness validates V2 rights, source revision, edit bounds, duration, SKU and weekly non-reuse', () => {
  const factoryPlan = { productId: 'product-1', benchmarkAnalysis: analysis([shot()]) };
  const factoryRequirements = requiredFixedYieldLocalMaterials([factoryPlan]);
  assert.deepEqual(inventoryFixedYieldArchetypes([ownedVideo()], { tenantId: 'tenant-a', requirements: factoryRequirements }), ['P3B_MACHINE_CLOSEUP']);

  const stale = ownedVideo() as AssetCandidate & { currentSourceRevision: string };
  stale.currentSourceRevision = 'asset-revision-2';
  assert.deepEqual(inventoryFixedYieldArchetypes([stale], { tenantId: 'tenant-a', requirements: factoryRequirements }), [], 'stale analysis revisions cannot satisfy readiness');
  assert.deepEqual(inventoryFixedYieldArchetypes([ownedVideo({
    authorization: { status: 'owned', scope: 'tenant', evidence: 'pending' },
    rightsEvidenceRefs: ['pending'], commercialUseApproved: false,
    commercialUseApprovalEvidenceRefs: [], derivativeUseAllowed: false,
  })], {
    tenantId: 'tenant-a', requirements: factoryRequirements,
  }), [], 'unverified rights evidence cannot satisfy readiness');
  assert.deepEqual(inventoryFixedYieldArchetypes([ownedVideo({ duration: 2 })], {
    tenantId: 'tenant-a', requirements: factoryRequirements,
  }), [], 'source bounds and required output duration must fit the real asset');
  assert.deepEqual(inventoryFixedYieldArchetypes([ownedVideo()], {
    tenantId: 'tenant-a', requirements: [...factoryRequirements, ...factoryRequirements.map(item => ({ ...item, requirementId: `${item.requirementId}:second` }))],
  }), [], 'one source segment cannot be reused for two shots in the same plan');
  const twoShots = requiredFixedYieldLocalMaterials([{ productId: 'product-1', benchmarkAnalysis: analysis([
    shot(), shot({ shotId: 'shot-2', start: 3, end: 6 }),
  ]) }]);
  assert.deepEqual(missingFixedYieldLocalMaterials([ownedVideo()], { tenantId: 'tenant-a', requirements: twoShots })
    .map(item => item.shotIndex), [1], 'assistant names only the unmatched shot, not every shot of a missing archetype');

  const productReference = analysis([shot({
    shotId: 'product-shot', materialType: 'product', narrativeRole: 'product_intro',
    visual: '产品包装标签微距特写', purpose: '展示包装细节', environment: '产品货架',
  })]);
  const productAsset = ownedVideo({
    id: 'product-asset', name: '产品包装特写', productId: 'other-product',
    observations: ['产品包装标签特写'], visualObservations: ['产品包装标签特写'], tags: ['产品', '包装'],
    segments: [{ id: 'product-segment', start: 0, end: 3, action: '产品包装标签微距特写', environment: '产品货架',
      subject: ['产品包装'], observedFacts: ['产品包装标签特写'], confidence: .95, boundaryConfidence: .95,
      cleanEntry: true, cleanExit: true, needsReview: false }],
  });
  assert.deepEqual(inventoryFixedYieldArchetypes([productAsset], {
    tenantId: 'tenant-a',
    requirements: requiredFixedYieldLocalMaterials([{ productId: 'product-1', benchmarkAnalysis: productReference }]),
  }), [], 'a visually similar segment from another SKU cannot satisfy a product-bound shot');
});

test('analysis cannot manufacture missing or explicitly denied material rights', () => {
  const requirements = requiredFixedYieldLocalMaterials([{ productId: 'product-1', benchmarkAnalysis: analysis([shot()]) }]);
  const withoutRights = ownedVideo({
    rightsEvidenceRefs: undefined,
    commercialUseApproved: undefined,
    commercialUseApprovalEvidenceRefs: undefined,
    modelInputAllowed: undefined,
    derivativeUseAllowed: undefined,
  });
  assert.deepEqual(inventoryFixedYieldArchetypes([withoutRights], { tenantId: 'tenant-a', requirements }), [],
    'tenant ownership and completed analysis must not imply commercial/model/derivative permission');

  const explicitlyDenied = ownedVideo({
    commercialUseApproved: false,
    modelInputAllowed: false,
    derivativeUseAllowed: false,
  });
  assert.deepEqual(inventoryFixedYieldArchetypes([explicitlyDenied], { tenantId: 'tenant-a', requirements }), [],
    'an explicit rights denial must fail closed');
});

test('local FFmpeg material remains eligible when model input is explicitly disallowed', () => {
  const asset = ownedVideo({ modelInputAllowed: false });
  const shotAnalysis = asset.scriptAnalysis!.shots[0]!;
  const profile = buildLocalMaterialSegmentProfile({
    tenantId: 'tenant-a', sourceTenantId: 'tenant-a', origin: 'my_materials',
    assetId: asset.id, segmentId: shotAnalysis.segmentId,
    sourceRevision: asset.scriptAnalysis!.sourceRevision,
    currentSourceRevision: asset.scriptAnalysis!.sourceRevision,
    mediaType: 'video', synthetic: false, startSeconds: 0, endSeconds: 3,
    materialType: 'factory', materialRoles: ['factory'], productId: 'product-1', productRef: 'product-1',
    visualContract: shotAnalysis.visualContract,
    rightsEvidenceRefs: asset.rightsEvidenceRefs!, commercialUseApproved: true,
    commercialUseApprovalEvidenceRefs: asset.commercialUseApprovalEvidenceRefs!,
    modelInputAllowed: false, derivativeUseAllowed: true,
    confidence: .95, needsReview: false, cleanEntry: true, cleanExit: true,
  }).profile!;
  assert.equal(profile.modelInputAllowed, false, 'the permission fact must be preserved, not upgraded');
  assert.equal(profile.productionEligible, true, 'local extraction does not send footage to a model');
  asset.segmentProfiles = [profile];
  const requirements = requiredFixedYieldLocalMaterials([{ productId: 'product-1', benchmarkAnalysis: analysis([shot()]) }]);
  assert.deepEqual(inventoryFixedYieldArchetypes([asset], { tenantId: 'tenant-a', requirements }), ['P3B_MACHINE_CLOSEUP']);
});

test('persisted rejected segment profiles cannot be replaced by an optimistic analysis duplicate', () => {
  const asset = ownedVideo();
  const generatedProfile = inventoryFixedYieldArchetypes([asset], { tenantId: 'tenant-a' });
  assert.deepEqual(generatedProfile, ['P3B_MACHINE_CLOSEUP']);
  const sourceRevision = asset.scriptAnalysis!.sourceRevision;
  const visualContract = asset.scriptAnalysis!.shots[0]!.visualContract;
  const rejected = buildLocalMaterialSegmentProfile({
    tenantId: 'tenant-a', sourceTenantId: 'tenant-a', origin: 'my_materials',
    assetId: asset.id, segmentId: asset.scriptAnalysis!.shots[0]!.segmentId,
    sourceRevision, currentSourceRevision: sourceRevision, mediaType: 'video', synthetic: false,
    startSeconds: 0, endSeconds: 3, materialType: 'factory', materialRoles: ['factory'],
    productId: 'product-1', productRef: 'product-1', visualContract,
    rightsEvidenceRefs: ['rights://tenant-a/asset-1'], commercialUseApproved: false,
    commercialUseApprovalEvidenceRefs: [], modelInputAllowed: false, derivativeUseAllowed: false,
    confidence: .95, needsReview: false, cleanEntry: true, cleanExit: true,
  }).profile!;
  asset.segmentProfiles = [rejected];
  assert.deepEqual(inventoryFixedYieldArchetypes([asset], { tenantId: 'tenant-a' }), [],
    'the stored rejection for an immutable segment revision must take precedence');
});

test('authoritative evidence requires confirmed enterprise facts and a rights-scoped default presenter', () => {
  const presenter = {
    id: 'presenter-1', authorized: true, assetVersion: 2,
    toolMappings: { heygen: { avatarId: 'avatar-1', voiceId: 'voice-1' } },
    rightsEvidence: {
      authorizationRef: 'rights://tenant-a/person-a/contract-v1',
      consentRef: 'consent://tenant-a/person-a/recording-v1',
      grantedAt: '2026-10-01T00:00:00Z', subjectAdultConfirmed: true,
      permittedProviders: ['heygen'], permittedUses: ['digital_presenter', 'voice_synthesis'],
    },
  };
  const evidence = enterpriseOnboardingEvidence(confirmedProfile(), [{
    tenant_id: 'tenant-a', payload: { defaultPresenterId: 'presenter-1', presenters: [presenter] },
  }], 'tenant-a', [ownedVideo()], true);
  assert.deepEqual(evidence, {
    companyReady: true, brandReady: true, productFactsReady: true,
    presenterReady: true, voiceReady: true,
    inventoryArchetypes: ['P3B_MACHINE_CLOSEUP'], budgetConfirmed: true,
  });
  const browserClaimCannotReplaceEvidence = evaluateServerProductionOnboardingReadiness({
    preferences: { ...preferences, presenterPolicy: 'digital_presenter' },
    evidence: { ...evidence, presenterReady: false, voiceReady: false },
    plans: [{ benchmarkAnalysis: analysis([shot({ materialType: 'talking_head', visual: '销售人员站在工厂内口播' })]) }],
  });
  assert.deepEqual(browserClaimCannotReplaceEvidence.blockers.map(item => item.code), ['presenter_missing']);
});

test('missing onboarding preferences or exact local archetype blocks before production', () => {
  const evidence = {
    companyReady: true, brandReady: true, productFactsReady: true,
    presenterReady: false, voiceReady: false, inventoryArchetypes: [] as never[], budgetConfirmed: true,
  };
  const plans = [{ benchmarkAnalysis: analysis([shot()]) }];
  assert.deepEqual(evaluateServerProductionOnboardingReadiness({ evidence, plans }).blockers.map(item => item.code), ['production_preferences_missing']);
  const missingMaterial = evaluateServerProductionOnboardingReadiness({ preferences, evidence, plans });
  assert.deepEqual(missingMaterial.blockers.map(item => item.code), ['local_material_missing']);
  assert.equal(referenceCoveredByProductionEvidence({ analysis: analysis([shot()]), preferences, evidence }), false);
  assert.equal(referenceCoveredByProductionEvidence({ analysis: analysis([shot()]), preferences, evidence: { ...evidence, inventoryArchetypes: ['P3B_MACHINE_CLOSEUP'] } }), true);
});

test('confirmed legacy enterprise facts receive only safe local-video production defaults', () => {
  const profile = confirmedProfile();
  const evidence = {
    companyReady: true, brandReady: true, productFactsReady: true,
    presenterReady: false, voiceReady: false, inventoryArchetypes: [] as never[], budgetConfirmed: true,
  };
  assert.deepEqual(compatibleProductionOnboardingPreferences(profile, evidence), {
    schemaVersion: 'fixed-yield.production-onboarding.v1',
    contact: { kind: 'none', value: '', primaryCta: '' },
    presenterPolicy: 'local_video_only',
    output: { primaryLanguage: 'en', aspectRatio: '9:16', resolution: '1080p' },
    includeOneRevision: true,
    confirmedAt: profile.factVersion!.confirmedAt,
  });
  assert.equal(compatibleProductionOnboardingPreferences({ ...profile, factVersion: undefined }, evidence), undefined);
});

test('a changed confirmed enterprise profile reports a fact mismatch instead of missing onboarding', async () => {
  const profile = confirmedProfile();
  profile.company.name = 'Changed after confirmation';
  const store = { list: async () => ({ items: [], totalItems: 0, totalPages: 0, page: 1, perPage: 2 }) };
  const result = await readServerProductionOnboardingReadiness({
    store: store as never, tenantId: 'tenant-a', profile, plans: [], budgetConfirmed: true, assets: [],
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.blockers.map(item => item.code), ['enterprise_facts_mismatch']);
  assert.match(result.blockers[0]!.message, /无法核验企业资料的已确认版本/);
});

test('a frozen business snapshot is accepted only when the verified full canonical profile matches', async () => {
  const profile = normalizeProfile(confirmedProfile());
  profile.factVersion!.contentHash = enterpriseFactContentHash(profile);
  const binding = resolveKnowledgeBinding(profile, {} as never, '2026-10-01T00:00:00Z');
  const frozen = binding.enterpriseSnapshot.profile as EnterpriseProfile;
  const store = { list: async (collection: string) => collection === 'tenant_profiles'
    ? { items: [{ tenant_id: 'tenant-a', profile }], totalItems: 1, totalPages: 1, page: 1, perPage: 2 }
    : { items: [], totalItems: 0, totalPages: 0, page: 1, perPage: 2 } };
  const ready = await readServerProductionOnboardingReadiness({ store: store as never, tenantId: 'tenant-a',
    profile: frozen, plans: [], budgetConfirmed: true, assets: [] });
  assert.equal(ready.ready, true);
  const changed = structuredClone(frozen);
  changed.company.name = 'Unconfirmed change';
  const rejected = await readServerProductionOnboardingReadiness({ store: store as never, tenantId: 'tenant-a',
    profile: changed, plans: [], budgetConfirmed: true, assets: [] });
  assert.equal(rejected.ready, false);
  assert.equal(rejected.blockers[0]?.code, 'enterprise_facts_mismatch');
});
