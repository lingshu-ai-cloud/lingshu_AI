import assert from 'node:assert/strict';
import test from 'node:test';
import type { LocalMaterialSegmentProfile } from '../../shared/contracts/localMaterialSegmentProfile.js';
import { fixedYieldRuntimeSnapshotId, type FixedYieldRuntimeReadinessSnapshot } from '../../shared/fixedYieldPathRegistry.js';
import type { FixedYieldTimelineCompilation } from '../../shared/fixedYieldTimelineCompiler.js';
import {
  compileFixedYieldProductionPlan,
  FIXED_YIELD_AUXILIARY_INPUT_BINDING_VERSION,
  FIXED_YIELD_QA_POLICY_IDENTITIES,
  freezeFixedYieldWeeklyMaterialUsageSnapshot,
  type FixedYieldBackgroundBinding,
  type FixedYieldBrandContactBinding,
  type FixedYieldPerformanceReferenceBinding,
  type FixedYieldPresenterIdentityBinding,
  type FixedYieldPresenterRoutingConfig,
  type FixedYieldVoiceAuthorizationBinding,
} from './fixedYieldCompiler.js';

const checkedAt = '2026-10-15T00:00:00.000Z';
function snapshot(mode: 'pipeline_1' | 'pipeline_2' | 'local_video_match'): FixedYieldRuntimeReadinessSnapshot {
  const core: Omit<FixedYieldRuntimeReadinessSnapshot, 'snapshotId'> = { schemaVersion: 'fixed-yield-runtime-readiness.v2', capabilityMapVersion: 'fixed-yield-capability.v2', checkedAt,
    states: Object.fromEntries(['P1_PRESENTER', 'P2_PRODUCT_REAL', 'P3_FACTORY_REAL', 'P4_CONSUMER_REAL', 'P5_GENERAL_EVIDENCE'].map(pathId => [pathId, {
      pathId, state: 'available', allowedModes: pathId === 'P1_PRESENTER'
        ? [mode === 'local_video_match' ? 'pipeline_1' : mode] : ['local_video_match'], reasonCodes: [], checkedAt,
    }])) as unknown as FixedYieldRuntimeReadinessSnapshot['states'] };
  return { ...core, snapshotId: fixedYieldRuntimeSnapshotId(core) };
}
const productTimeline: FixedYieldTimelineCompilation = {
  schemaVersion: 'fixed-yield-timeline-compilation.v2', capabilityMapVersion: 'fixed-yield-capability.v2', referenceVideoId: 'ref', referenceEvidenceRevision: 'rev', productRef: 'sku',
  ready: true, blockers: [], referenceDurationMs: 3000, targetDurationMs: 3000, unresolvedReferenceDurationMs: 0,
  classifiedDurationMsByPath: { P1_PRESENTER: 0, P2_PRODUCT_REAL: 3000, P3_FACTORY_REAL: 0, P4_CONSUMER_REAL: 0, P5_GENERAL_EVIDENCE: 0 },
  requiredArchetypeIds: ['P2B_PRODUCT_SHELF'], shots: [{ timelineShotId: 'timeline:one', referenceShotId: 'one', sourceStartMs: 0, sourceEndMs: 3000,
    timelineStartMs: 0, timelineEndMs: 3000, targetOutputDurationMs: 3000, productRef: 'sku', materialType: 'product', narrativeRole: 'product_intro', pathId: 'P2_PRODUCT_REAL',
    archetypeId: 'P2B_PRODUCT_SHELF', productionMode: 'local_video_match', classificationEvidence: 'shelf' }],
};
const productProfile: LocalMaterialSegmentProfile = {
  segmentProfileVersion: 'fixed-yield-material-segment.v2', tenantId: 'tenant', assetId: 'asset', segmentId: 'segment', sourceRevision: 'rev-1',
  startMs: 1000, endMs: 5000, materialType: 'product', archetypeCandidates: ['P2B_PRODUCT_SHELF'], materialRoles: ['product'], productId: 'sku', productRef: 'sku',
  interactionKind: 'none', environmentKind: 'retail', productUsageKind: 'none', observedActionTags: [], framingTags: [], cameraMovementTags: [], entityAndTextTags: [],
  rightsEvidenceRefs: ['rights:tenant:1'], commercialUseApproved: true,
  commercialUseApprovalEvidenceRefs: ['rights:tenant:1'], modelInputAllowed: false,
  derivativeUseAllowed: true, confidence: 0.98, cleanEntry: true, cleanExit: true,
  productionEligible: true, rejectionReasons: [],
};

const sourceHashes = {
  presenter: '1'.repeat(64), background: '2'.repeat(64), performance: '3'.repeat(64), contact: '4'.repeat(64),
  voice: '5'.repeat(64), artifact: '6'.repeat(64),
};
const physicalSegmentSha256 = '7'.repeat(64);

function weeklyMaterialUsage(
  reservations: Array<{ assetId: string; segmentId: string; sourceRevision: string; physicalSegmentSha256: string; orderId: string }> = [],
  overrides: Partial<{ tenantId: string; weekStartsAt: string; weekEndsAt: string; checkedAt: string }> = {},
) {
  return freezeFixedYieldWeeklyMaterialUsageSnapshot({
    schemaVersion: 'fixed-yield-weekly-material-usage.v2', tenantId: overrides.tenantId || 'tenant',
    weekStartsAt: overrides.weekStartsAt || '2026-10-12', weekEndsAt: overrides.weekEndsAt || '2026-10-18',
    checkedAt: overrides.checkedAt || checkedAt, reservations,
  });
}

function presenterIdentityBinding(
  overrides: Partial<FixedYieldPresenterIdentityBinding> = {},
): FixedYieldPresenterIdentityBinding {
  return {
    bindingVersion: FIXED_YIELD_AUXILIARY_INPUT_BINDING_VERSION,
    inputKind: 'presenter_identity', tenantId: 'tenant', inputRef: 'presenter:v1', sourceRevision: 'presenter-rev:1',
    sourceSha256: sourceHashes.presenter, rightsEvidenceRefs: ['rights:presenter:1'], commercialUseApproved: true,
    derivativeUseAllowed: true, authorizationRef: 'auth:v1', consentRef: 'consent:v1', subjectAdultConfirmed: true,
    modelInputAllowed: true, permittedUses: ['digital_presenter', 'voice_synthesis'], presenterVoiceId: 'voice-id:1',
    revokedAt: null, ...overrides,
  };
}

function backgroundBinding(overrides: Partial<FixedYieldBackgroundBinding> = {}): FixedYieldBackgroundBinding {
  return {
    bindingVersion: FIXED_YIELD_AUXILIARY_INPUT_BINDING_VERSION,
    inputKind: 'background', tenantId: 'tenant', inputRef: 'background:factory:v2', sourceRevision: 'background-rev:2',
    sourceSha256: sourceHashes.background, rightsEvidenceRefs: ['rights:background:2'], commercialUseApproved: true,
    derivativeUseAllowed: true, modelInputAllowed: true, productRef: null, ...overrides,
  };
}

function performanceBinding(
  overrides: Partial<FixedYieldPerformanceReferenceBinding> = {},
): FixedYieldPerformanceReferenceBinding {
  return {
    bindingVersion: FIXED_YIELD_AUXILIARY_INPUT_BINDING_VERSION,
    inputKind: 'performance_reference', tenantId: 'tenant', inputRef: 'performance:contact:v1', sourceRevision: 'performance-rev:1',
    sourceSha256: sourceHashes.performance, rightsEvidenceRefs: ['rights:performance:1'], commercialUseApproved: true,
    derivativeUseAllowed: true, modelInputAllowed: true, productRef: 'sku', ...overrides,
  };
}

function brandContactBinding(overrides: Partial<FixedYieldBrandContactBinding> = {}): FixedYieldBrandContactBinding {
  return {
    bindingVersion: FIXED_YIELD_AUXILIARY_INPUT_BINDING_VERSION,
    inputKind: 'brand_contact', tenantId: 'tenant', inputRef: 'contact:v1', sourceRevision: 'contact-rev:1',
    sourceSha256: sourceHashes.contact, rightsEvidenceRefs: ['approval:contact:1'], commercialUseApproved: true,
    derivativeUseAllowed: true, publicDisplayApproved: true, ...overrides,
  };
}

function voiceAuthorizationBinding(
  overrides: Partial<FixedYieldVoiceAuthorizationBinding> = {},
): FixedYieldVoiceAuthorizationBinding {
  return {
    bindingVersion: FIXED_YIELD_AUXILIARY_INPUT_BINDING_VERSION,
    inputKind: 'voice', tenantId: 'tenant', inputRef: 'voice:enterprise:v1', sourceRevision: 'voice-rev:1',
    sourceSha256: sourceHashes.voice, rightsEvidenceRefs: ['rights:voice:1'], commercialUseApproved: true,
    derivativeUseAllowed: true, consentRef: 'consent:voice:1', modelInputAllowed: true,
    permittedUses: ['voice_synthesis'], presenterRef: 'presenter:v1', presenterVoiceId: 'voice-id:1',
    authorizedArtifactSha256: null, revokedAt: null, ...overrides,
  };
}

function presenterRouting(overrides: Partial<FixedYieldPresenterRoutingConfig> = {}): FixedYieldPresenterRoutingConfig {
  return {
    presenterRef: 'presenter:v1', presenterVoiceId: 'voice-id:1',
    presenterSourceRevision: 'presenter-rev:1', presenterAuthorizationRef: 'auth:v1',
    presenterIdentityBinding: presenterIdentityBinding(),
    backgroundRef: 'background:factory:v2', backgroundSourceRevision: 'background-rev:2', backgroundBinding: backgroundBinding(),
    backgroundRefByShotId: {}, backgroundSourceRevisionByShotId: {}, backgroundBindingByShotId: {},
    performanceReferenceByShotId: {}, performanceReferenceSourceRevisionByShotId: {}, performanceReferenceBindingByShotId: {},
    brandContactRef: null, brandContactSourceRevision: null, brandContactBinding: null,
    voice: { kind: 'generate', voiceRef: 'voice:enterprise:v1', sourceRevision: 'voice-rev:1',
      authorizationBinding: voiceAuthorizationBinding(), specificationRef: 'voice-spec:v1',
      providerOperation: { provider: 'voice-existing-provider', executor: 'voice-existing-adapter', maxCostFen: 20 } },
    modes: {
      pipeline_1: { primary: { provider: 'heygen', executor: 'existing-heygen-adapter', maxCostFen: 80 },
        repair: { provider: 'heygen', executor: 'existing-heygen-adapter', maxCostFen: 80 } },
      pipeline_2: { primary: { provider: 'existing-reference-provider', executor: 'existing-reference-adapter', maxCostFen: 90 } },
    },
    ...overrides,
  };
}

function presenterTimeline(input: {
  archetypeId: 'P1B_FACTORY_STAND_TALK' | 'P1E_PRESENTER_CTA' | 'P1F_REAL_PRODUCT_CONTACT';
  productionMode: 'pipeline_1' | 'pipeline_2';
  productRef?: string | null;
}): FixedYieldTimelineCompilation {
  return { ...productTimeline,
    productRef: input.productRef ?? 'sku',
    classifiedDurationMsByPath: { P1_PRESENTER: 3000, P2_PRODUCT_REAL: 0, P3_FACTORY_REAL: 0, P4_CONSUMER_REAL: 0, P5_GENERAL_EVIDENCE: 0 },
    requiredArchetypeIds: [input.archetypeId], shots: [{ ...productTimeline.shots[0]!, productRef: input.productRef ?? 'sku',
      materialType: 'talking_head', pathId: 'P1_PRESENTER', archetypeId: input.archetypeId,
      productionMode: input.productionMode }],
  };
}

test('local-only plan is zero-cost and exact-duration without provider operations', () => {
  const result = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project', runId: 'run', createdAt: checkedAt,
    timeline: productTimeline, readinessSnapshot: snapshot('local_video_match'), presenterRouting: null,
    weeklyMaterialUsageSnapshot: weeklyMaterialUsage(),
    localSegmentBindings: [{ timelineShotId: 'timeline:one', assetId: 'asset', segmentId: 'segment', sourceRevision: 'rev-1',
      physicalSegmentSha256, profile: productProfile, requestedProductRef: 'sku' }] });
  assert.equal(result.ready, true);
  assert.equal(result.plan?.core.totalReservedCostFen, 0);
  assert.ok(result.plan?.operations.every(item => item.executionKind === 'local'));
  assert.equal(result.plan?.operations.find(item => item.role === 'local_segment_extract')?.request.sourceEndMs, 4000);
  assert.deepEqual(result.plan?.operations.find(item => item.role === 'shot_quality')?.request,
    { ...FIXED_YIELD_QA_POLICY_IDENTITIES.localShot, archetypeId: 'P2B_PRODUCT_SHELF', materialType: 'product',
      expectedDurationMs: 3000, sourceRevision: 'rev-1' });
  assert.equal(result.plan?.operations.find(item => item.role === 'whole_video_quality')?.request.thresholdsVersion,
    FIXED_YIELD_QA_POLICY_IDENTITIES.wholeVideo.thresholdsVersion);
});

test('missing or reused exact local segment blocks before execution and creates no plan', () => {
  const duplicateTimeline = { ...productTimeline, referenceDurationMs: 6000, targetDurationMs: 6000,
    classifiedDurationMsByPath: { ...productTimeline.classifiedDurationMsByPath, P2_PRODUCT_REAL: 6000 },
    shots: [productTimeline.shots[0]!, { ...productTimeline.shots[0]!, timelineShotId: 'timeline:two', referenceShotId: 'two',
      sourceStartMs: 3000, sourceEndMs: 6000, timelineStartMs: 3000, timelineEndMs: 6000 }] };
  const result = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project', runId: 'run', createdAt: checkedAt,
    timeline: duplicateTimeline, readinessSnapshot: snapshot('local_video_match'), weeklyMaterialUsageSnapshot: weeklyMaterialUsage(), localSegmentBindings: [
      { timelineShotId: 'timeline:one', assetId: 'asset', segmentId: 'segment', sourceRevision: 'rev-1', physicalSegmentSha256,
        profile: productProfile, requestedProductRef: 'sku' },
      { timelineShotId: 'timeline:two', assetId: 'asset-copy', segmentId: 'segment-copy', sourceRevision: 'rev-copy', physicalSegmentSha256,
        profile: { ...productProfile, assetId: 'asset-copy', segmentId: 'segment-copy', sourceRevision: 'rev-copy' }, requestedProductRef: 'sku' },
    ] });
  assert.equal(result.ready, false);
  assert.equal(result.plan, null);
  assert.match(result.blockers.map(item => item.message).join(','), /segment_already_used_in_plan/);
});

test('local compilation fails closed without a valid cross-order weekly usage snapshot', () => {
  const binding = { timelineShotId: 'timeline:one', assetId: 'asset', segmentId: 'segment', sourceRevision: 'rev-1', physicalSegmentSha256,
    profile: productProfile, requestedProductRef: 'sku' };
  const missing = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project', runId: 'run-missing-week', createdAt: checkedAt,
    timeline: productTimeline, readinessSnapshot: snapshot('local_video_match'), localSegmentBindings: [binding] });
  assert.equal(missing.ready, false);
  assert.equal(missing.plan, null);
  assert.ok(missing.blockers.some(item => item.code === 'weekly_material_usage_snapshot_missing'));

  const valid = weeklyMaterialUsage();
  const tampered = { ...valid, tenantId: 'other-tenant' };
  const invalid = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project', runId: 'run-invalid-week', createdAt: checkedAt,
    timeline: productTimeline, readinessSnapshot: snapshot('local_video_match'), weeklyMaterialUsageSnapshot: tampered,
    localSegmentBindings: [binding] });
  assert.equal(invalid.ready, false);
  assert.ok(invalid.blockers.some(item => item.code === 'weekly_material_usage_snapshot_invalid'
    && /tenant_mismatch|snapshot_hash_mismatch/.test(item.message)));

  const missingPhysicalIdentity = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project',
    runId: 'run-missing-physical-segment', createdAt: checkedAt, timeline: productTimeline,
    readinessSnapshot: snapshot('local_video_match'), weeklyMaterialUsageSnapshot: weeklyMaterialUsage(),
    localSegmentBindings: [{ ...binding, physicalSegmentSha256: '' }] });
  assert.equal(missingPhysicalIdentity.ready, false);
  assert.ok(missingPhysicalIdentity.blockers.some(item => item.code === 'local_segment_physical_identity_missing'));
});

test('local segment is unique across orders in one week but reusable in a later week', () => {
  const binding = { timelineShotId: 'timeline:one', assetId: 'asset', segmentId: 'segment', sourceRevision: 'rev-1', physicalSegmentSha256,
    profile: productProfile, requestedProductRef: 'sku' };
  const reserved = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project', runId: 'run-week-42-second-order', createdAt: checkedAt,
    timeline: productTimeline, readinessSnapshot: snapshot('local_video_match'),
    weeklyMaterialUsageSnapshot: weeklyMaterialUsage([{ assetId: 'asset-copy', segmentId: 'segment-copy', sourceRevision: 'rev-copy',
      physicalSegmentSha256, orderId: 'order:first' }]),
    localSegmentBindings: [binding] });
  assert.equal(reserved.ready, false);
  assert.equal(reserved.plan, null);
  assert.ok(reserved.blockers.some(item => item.code === 'local_segment_already_reserved_in_week'
    && item.message.includes('order:first')));

  const nextWeek = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project', runId: 'run-week-43', createdAt: checkedAt,
    timeline: productTimeline, readinessSnapshot: snapshot('local_video_match'),
    weeklyMaterialUsageSnapshot: weeklyMaterialUsage([], { weekStartsAt: '2026-10-19', weekEndsAt: '2026-10-25' }),
    localSegmentBindings: [binding] });
  assert.equal(nextWeek.ready, true, 'a fresh authoritative weekly snapshot allows the same local segment next week');
  assert.equal(nextWeek.plan?.operations.find(item => item.role === 'local_segment_extract')?.request.weekStartsAt, '2026-10-19');
});

test('presenter plan freezes one canonical voice, provider budget and deterministic content identity', () => {
  const timeline = presenterTimeline({ archetypeId: 'P1B_FACTORY_STAND_TALK', productionMode: 'pipeline_1' });
  const routing = presenterRouting({
    backgroundRef: 'background:v1', backgroundSourceRevision: 'background-rev:1',
    backgroundBinding: backgroundBinding({ inputRef: 'background:v1', sourceRevision: 'background-rev:1' }),
    backgroundRefByShotId: { 'timeline:one': 'background:factory:v2' },
    backgroundSourceRevisionByShotId: { 'timeline:one': 'background-rev:2' },
    backgroundBindingByShotId: { 'timeline:one': backgroundBinding() },
  });
  const first = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project', runId: 'run-1', createdAt: checkedAt,
    timeline, readinessSnapshot: snapshot('pipeline_1'), localSegmentBindings: [], presenterRouting: routing });
  const second = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project', runId: 'run-2', createdAt: checkedAt,
    timeline, readinessSnapshot: snapshot('pipeline_1'), localSegmentBindings: [], presenterRouting: routing });
  assert.equal(first.ready, true);
  assert.equal(first.plan?.core.totalReservedCostFen, 180);
  assert.equal(first.plan?.operations.filter(item => item.role === 'canonical_voice').length, 1);
  const canonicalVoice = first.plan?.operations.find(item => item.role === 'canonical_voice');
  const voiceBinding = canonicalVoice?.request.authorizationBinding as Record<string, unknown>;
  assert.equal(voiceBinding?.inputKind, 'voice');
  assert.equal(voiceBinding?.tenantId, 'tenant');
  assert.equal(voiceBinding?.presenterVoiceId, 'voice-id:1');
  assert.match(String(voiceBinding?.bindingEvidenceHash), /^[a-f0-9]{64}$/);
  assert.equal(canonicalVoice?.request.voiceBindingEvidenceHash, voiceBinding?.bindingEvidenceHash);
  assert.equal(first.plan?.operations.find(item => item.role === 'talking_video')?.request.voiceBindingEvidenceHash,
    voiceBinding?.bindingEvidenceHash);
  const background = first.plan?.operations.find(item => item.role === 'background_scene');
  assert.equal(background?.request.backgroundRef, 'background:factory:v2');
  assert.equal((background?.request.authorizationBinding as Record<string, unknown>)?.tenantId, 'tenant');
  assert.match(String((background?.request.authorizationBinding as Record<string, unknown>)?.bindingEvidenceHash), /^[a-f0-9]{64}$/);
  assert.equal(first.plan?.operations.find(item => item.role === 'shot_quality')?.request.thresholdsVersion,
    FIXED_YIELD_QA_POLICY_IDENTITIES.presenterShot.thresholdsVersion);
  assert.equal(first.plan?.operations.find(item => item.role === 'repair_quality')?.request.qaProfileId,
    FIXED_YIELD_QA_POLICY_IDENTITIES.presenterShot.qaProfileId);
  assert.equal(first.plan?.coreHash, second.plan?.coreHash);
  assert.notEqual(first.plan?.planHash, second.plan?.planHash);

  const changedVoiceEvidence = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project',
    runId: 'run-1', createdAt: checkedAt, timeline, readinessSnapshot: snapshot('pipeline_1'),
    localSegmentBindings: [], presenterRouting: presenterRouting({
      voice: { kind: 'generate', voiceRef: 'voice:enterprise:v1', sourceRevision: 'voice-rev:1',
        authorizationBinding: voiceAuthorizationBinding({ rightsEvidenceRefs: ['rights:voice:replacement'] }),
        specificationRef: 'voice-spec:v1',
        providerOperation: { provider: 'voice-existing-provider', executor: 'voice-existing-adapter', maxCostFen: 20 } },
    }) });
  assert.equal(changedVoiceEvidence.ready, true);
  assert.notEqual(first.plan?.coreHash, changedVoiceEvidence.plan?.coreHash);
});

test('existing voice artifact freezes its immutable bytes and complete standalone voice authorization', () => {
  const timeline = presenterTimeline({ archetypeId: 'P1B_FACTORY_STAND_TALK', productionMode: 'pipeline_1' });
  const authorizationBinding = voiceAuthorizationBinding({ inputRef: 'voice:licensed:narrator',
    presenterRef: null, presenterVoiceId: null, authorizedArtifactSha256: sourceHashes.artifact });
  const result = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project',
    runId: 'existing-voice', createdAt: checkedAt, timeline, readinessSnapshot: snapshot('pipeline_1'),
    localSegmentBindings: [], presenterRouting: presenterRouting({
      presenterVoiceId: null,
      presenterIdentityBinding: presenterIdentityBinding({ permittedUses: ['digital_presenter'] }),
      voice: { kind: 'existing_artifact', voiceRef: 'voice:licensed:narrator', sourceRevision: 'voice-rev:1',
        authorizationBinding, artifactRef: 'artifact:voice:approved:1', artifactSha256: sourceHashes.artifact,
        durationMs: 3000 },
    }) });
  assert.equal(result.ready, true);
  assert.equal(result.plan?.core.totalReservedCostFen, 160);
  assert.equal(result.plan?.operations.some(item => item.role === 'canonical_voice'), false);
  const verify = result.plan?.operations.find(item => item.role === 'voice_quality');
  assert.equal(verify?.request.mode, 'existing_artifact');
  assert.equal(verify?.request.artifactSha256, sourceHashes.artifact);
  assert.equal((verify?.request.authorizationBinding as Record<string, unknown>)?.inputRef, 'voice:licensed:narrator');
  assert.match(String(verify?.request.voiceBindingEvidenceHash), /^[a-f0-9]{64}$/);

  const changedBytes = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project',
    runId: 'existing-voice-changed-bytes', createdAt: checkedAt, timeline, readinessSnapshot: snapshot('pipeline_1'),
    localSegmentBindings: [], presenterRouting: presenterRouting({
      presenterVoiceId: null,
      presenterIdentityBinding: presenterIdentityBinding({ permittedUses: ['digital_presenter'] }),
      voice: { kind: 'existing_artifact', voiceRef: 'voice:licensed:narrator', sourceRevision: 'voice-rev:1',
        authorizationBinding, artifactRef: 'artifact:voice:approved:1', artifactSha256: '7'.repeat(64),
        durationMs: 3000 },
    }) });
  assert.equal(changedBytes.ready, false);
  assert.equal(changedBytes.plan, null);
  assert.match(changedBytes.blockers.map(item => `${item.code}:${item.message}`).join('|'),
    /presenter_voice_binding_invalid.*artifact_hash_not_authorized/);
});

test('generated voice fails closed for tenant, rights, consent, model-input, synthesis-use and presenter voice mismatches', () => {
  const timeline = presenterTimeline({ archetypeId: 'P1B_FACTORY_STAND_TALK', productionMode: 'pipeline_1' });
  for (const [label, authorizationBinding, reason] of [
    ['tenant', voiceAuthorizationBinding({ tenantId: 'other-tenant' }), 'tenant_mismatch'],
    ['rights', voiceAuthorizationBinding({ rightsEvidenceRefs: ['pending'] }), 'rights_evidence_missing'],
    ['consent', voiceAuthorizationBinding({ consentRef: '' }), 'consent_evidence_missing'],
    ['model-input', voiceAuthorizationBinding({ modelInputAllowed: false }), 'model_input_not_allowed'],
    ['synthesis-use', voiceAuthorizationBinding({ permittedUses: [] }), 'voice_synthesis_use_not_allowed'],
    ['voice-id', voiceAuthorizationBinding({ presenterVoiceId: 'voice-id:other' }), 'presenter_voice_id_mismatch'],
    ['presenter', voiceAuthorizationBinding({ presenterRef: 'presenter:other' }), 'presenter_ref_mismatch'],
    ['revision', voiceAuthorizationBinding({ sourceRevision: 'voice-rev:other' }), 'source_revision_mismatch'],
    ['hash', voiceAuthorizationBinding({ sourceSha256: 'not-a-hash' }), 'source_hash_invalid'],
  ] as const) {
    const routing = presenterRouting();
    routing.voice = { ...routing.voice, authorizationBinding };
    const result = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project',
      runId: `voice-${label}`, createdAt: checkedAt, timeline, readinessSnapshot: snapshot('pipeline_1'),
      localSegmentBindings: [], presenterRouting: routing });
    assert.equal(result.ready, false, label);
    assert.equal(result.plan, null, label);
    assert.match(result.blockers.map(item => `${item.code}:${item.message}`).join('|'),
      new RegExp(`presenter_voice_binding_invalid.*${reason}`), label);
  }
});

test('both generated and existing voice inputs reject a missing binding before any plan can be frozen', () => {
  const timeline = presenterTimeline({ archetypeId: 'P1B_FACTORY_STAND_TALK', productionMode: 'pipeline_1' });
  const generated = presenterRouting();
  generated.voice = { ...generated.voice, authorizationBinding: null as never };
  const existing = presenterRouting({ voice: { kind: 'existing_artifact', voiceRef: 'voice:enterprise:v1',
    sourceRevision: 'voice-rev:1', authorizationBinding: null as never,
    artifactRef: 'artifact:voice:approved:1', artifactSha256: sourceHashes.artifact, durationMs: 3000 } });
  for (const [label, presenterRouting] of [['generated', generated], ['existing', existing]] as const) {
    const result = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project',
      runId: `missing-${label}-voice-binding`, createdAt: checkedAt, timeline,
      readinessSnapshot: snapshot('pipeline_1'), localSegmentBindings: [], presenterRouting });
    assert.equal(result.ready, false, label);
    assert.equal(result.plan, null, label);
    assert.match(result.blockers.map(item => `${item.code}:${item.message}`).join('|'),
      /presenter_voice_binding_invalid.*binding_missing/, label);
  }
});

test('presenter-bound voice additionally requires voice synthesis permission on the presenter consent', () => {
  const timeline = presenterTimeline({ archetypeId: 'P1B_FACTORY_STAND_TALK', productionMode: 'pipeline_1' });
  const result = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project',
    runId: 'presenter-voice-consent', createdAt: checkedAt, timeline, readinessSnapshot: snapshot('pipeline_1'),
    localSegmentBindings: [], presenterRouting: presenterRouting({
      presenterIdentityBinding: presenterIdentityBinding({ permittedUses: ['digital_presenter'] }),
    }) });
  assert.equal(result.ready, false);
  assert.equal(result.plan, null);
  assert.match(result.blockers.map(item => `${item.code}:${item.message}`).join('|'),
    /presenter_identity_binding_invalid.*voice_synthesis_use_not_allowed/);
});

function p1fRouting(binding = performanceBinding()): FixedYieldPresenterRoutingConfig {
  return presenterRouting({
    performanceReferenceByShotId: { 'timeline:one': 'performance:contact:v1' },
    performanceReferenceSourceRevisionByShotId: { 'timeline:one': 'performance-rev:1' },
    performanceReferenceBindingByShotId: { 'timeline:one': binding },
  });
}

test('P1F freezes authoritative presenter, background and same-SKU performance bindings into the plan hash', () => {
  const timeline = presenterTimeline({ archetypeId: 'P1F_REAL_PRODUCT_CONTACT', productionMode: 'pipeline_2', productRef: 'sku' });
  const routing = p1fRouting();
  const result = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project', runId: 'run-p1f', createdAt: checkedAt,
    timeline, readinessSnapshot: snapshot('pipeline_2'), localSegmentBindings: [], presenterRouting: routing });
  assert.equal(result.ready, true);
  assert.ok(result.plan);
  const identity = result.plan.operations.find(item => item.role === 'presenter_identity');
  const performance = result.plan.operations.find(item => item.role === 'performance_motion');
  assert.equal((identity?.request.authorizationBinding as Record<string, unknown>)?.sourceRevision, 'presenter-rev:1');
  assert.equal((performance?.request.authorizationBinding as Record<string, unknown>)?.productRef, 'sku');
  assert.match(String((performance?.request.authorizationBinding as Record<string, unknown>)?.bindingEvidenceHash), /^[a-f0-9]{64}$/);

  const changedEvidence = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project', runId: 'run-p1f', createdAt: checkedAt,
    timeline, readinessSnapshot: snapshot('pipeline_2'), localSegmentBindings: [],
    presenterRouting: p1fRouting(performanceBinding({ rightsEvidenceRefs: ['rights:performance:replacement'] })) });
  assert.equal(changedEvidence.ready, true);
  assert.notEqual(result.plan.coreHash, changedEvidence.plan?.coreHash);
});

test('P1E freezes an approved public brand-contact binding instead of trusting a non-empty ref', () => {
  const timeline = presenterTimeline({ archetypeId: 'P1E_PRESENTER_CTA', productionMode: 'pipeline_1' });
  const routing = presenterRouting({ brandContactRef: 'contact:v1', brandContactSourceRevision: 'contact-rev:1',
    brandContactBinding: brandContactBinding() });
  const result = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project', runId: 'run-p1e', createdAt: checkedAt,
    timeline, readinessSnapshot: snapshot('pipeline_1'), localSegmentBindings: [], presenterRouting: routing });
  assert.equal(result.ready, true);
  const contact = result.plan?.operations.find(item => item.role === 'brand_contact_overlay');
  assert.equal(contact?.request.brandContactRef, 'contact:v1');
  assert.equal((contact?.request.authorizationBinding as Record<string, unknown>)?.publicDisplayApproved, true);
  assert.ok(result.plan?.operations.find(item => item.role === 'layer_composite')?.dependsOn.includes('shot:timeline:one:brand-contact'));
});

test('presenter identity binding is rejected across tenants', () => {
  const timeline = presenterTimeline({ archetypeId: 'P1B_FACTORY_STAND_TALK', productionMode: 'pipeline_1' });
  const result = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project', runId: 'cross-tenant', createdAt: checkedAt,
    timeline, readinessSnapshot: snapshot('pipeline_1'), localSegmentBindings: [],
    presenterRouting: presenterRouting({ presenterIdentityBinding: presenterIdentityBinding({ tenantId: 'other-tenant' }) }) });
  assert.equal(result.ready, false);
  assert.equal(result.plan, null);
  assert.match(result.blockers.map(item => `${item.code}:${item.message}`).join('|'), /presenter_identity_binding_invalid.*tenant_mismatch/);
});

test('background binding is rejected when commercial rights evidence is missing', () => {
  const timeline = presenterTimeline({ archetypeId: 'P1B_FACTORY_STAND_TALK', productionMode: 'pipeline_1' });
  const result = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project', runId: 'unlicensed-background', createdAt: checkedAt,
    timeline, readinessSnapshot: snapshot('pipeline_1'), localSegmentBindings: [],
    presenterRouting: presenterRouting({ backgroundBinding: backgroundBinding({ rightsEvidenceRefs: ['pending'] }) }) });
  assert.equal(result.ready, false);
  assert.equal(result.plan, null);
  assert.match(result.blockers.map(item => `${item.code}:${item.message}`).join('|'), /presenter_background_binding_invalid.*rights_evidence_missing/);
});

test('performance binding must match the selected ref and exact source revision', () => {
  const timeline = presenterTimeline({ archetypeId: 'P1F_REAL_PRODUCT_CONTACT', productionMode: 'pipeline_2', productRef: 'sku' });
  for (const [label, binding, reason] of [
    ['ref', performanceBinding({ inputRef: 'performance:other' }), 'input_ref_mismatch'],
    ['revision', performanceBinding({ sourceRevision: 'performance-rev:other' }), 'source_revision_mismatch'],
  ] as const) {
    const result = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project', runId: `mismatch-${label}`, createdAt: checkedAt,
      timeline, readinessSnapshot: snapshot('pipeline_2'), localSegmentBindings: [], presenterRouting: p1fRouting(binding) });
    assert.equal(result.ready, false, label);
    assert.equal(result.plan, null, label);
    assert.match(result.blockers.map(item => `${item.code}:${item.message}`).join('|'), new RegExp(reason), label);
  }
});

test('P1F rejects a licensed performance reference for a different product SKU', () => {
  const timeline = presenterTimeline({ archetypeId: 'P1F_REAL_PRODUCT_CONTACT', productionMode: 'pipeline_2', productRef: 'sku' });
  const result = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project', runId: 'wrong-sku', createdAt: checkedAt,
    timeline, readinessSnapshot: snapshot('pipeline_2'), localSegmentBindings: [],
    presenterRouting: p1fRouting(performanceBinding({ productRef: 'other-sku' })) });
  assert.equal(result.ready, false);
  assert.equal(result.plan, null);
  assert.match(result.blockers.map(item => `${item.code}:${item.message}`).join('|'), /presenter_performance_binding_invalid.*product_identity_mismatch/);
});

test('P1E does not authorize a brand contact from the ref string alone', () => {
  const timeline = presenterTimeline({ archetypeId: 'P1E_PRESENTER_CTA', productionMode: 'pipeline_1' });
  const result = compileFixedYieldProductionPlan({ tenantId: 'tenant', projectId: 'project', runId: 'contact-string-only', createdAt: checkedAt,
    timeline, readinessSnapshot: snapshot('pipeline_1'), localSegmentBindings: [],
    presenterRouting: presenterRouting({ brandContactRef: 'contact:v1', brandContactSourceRevision: 'contact-rev:1', brandContactBinding: null }) });
  assert.equal(result.ready, false);
  assert.equal(result.plan, null);
  assert.ok(result.blockers.some(item => item.code === 'presenter_brand_contact_binding_invalid'));
});
