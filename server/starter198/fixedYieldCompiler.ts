import {
  freezeFixedYieldProductionPlan,
  type FixedYieldOperationDraft,
  type FixedYieldProductionPlan,
} from '../../shared/contracts/fixedYieldProduction.js';
import {
  evaluateLocalMaterialSegmentProfile,
  type LocalMaterialSegmentProfile,
  usableLocalMaterialRightsEvidence,
} from '../../shared/contracts/localMaterialSegmentProfile.js';
import { fixedYieldSha256 } from '../../shared/fixedYieldHash.js';
import { fixedYieldPathReadinessIssues, type FixedYieldRuntimeReadinessSnapshot } from '../../shared/fixedYieldPathRegistry.js';
import type { FixedYieldProductionMode } from '../../shared/fixedYieldCapabilityMap.js';
import { FIXED_YIELD_MATERIAL_RULES } from '../../shared/fixedYieldMaterialRegistry.js';
import type { FixedYieldTimelineCompilation, FixedYieldTimelineShot } from '../../shared/fixedYieldTimelineCompiler.js';
import { compilePresenterShotExecutionGraph, type PresenterPipeline } from '../../shared/presenterShotExecutionGraph.js';

export interface FixedYieldLocalSegmentBinding {
  timelineShotId: string;
  assetId: string;
  segmentId: string;
  sourceRevision: string;
  /** SHA-256 of the exact eligible segment bytes. Different database segment
   * ids for the same physical clip must carry the same value. */
  physicalSegmentSha256: string;
  profile: LocalMaterialSegmentProfile;
  requestedProductRef?: string | null;
}

export const FIXED_YIELD_WEEKLY_MATERIAL_USAGE_VERSION = 'fixed-yield-weekly-material-usage.v2' as const;

export interface FixedYieldWeeklyMaterialReservation {
  assetId: string;
  segmentId: string;
  sourceRevision: string;
  physicalSegmentSha256: string;
  /** The already-frozen sibling order that owns this reservation. The current
   * order must be excluded by the server before compilation. */
  orderId: string;
}

export interface FixedYieldWeeklyMaterialUsageSnapshot {
  schemaVersion: typeof FIXED_YIELD_WEEKLY_MATERIAL_USAGE_VERSION;
  tenantId: string;
  weekStartsAt: string;
  weekEndsAt: string;
  checkedAt: string;
  reservations: FixedYieldWeeklyMaterialReservation[];
  snapshotId: string;
}

type FixedYieldWeeklyMaterialUsageSnapshotCore = Omit<FixedYieldWeeklyMaterialUsageSnapshot, 'snapshotId'>;

export function fixedYieldWeeklyMaterialUsageSnapshotId(
  input: FixedYieldWeeklyMaterialUsageSnapshotCore,
): string {
  return fixedYieldSha256(input);
}

export function freezeFixedYieldWeeklyMaterialUsageSnapshot(
  input: FixedYieldWeeklyMaterialUsageSnapshotCore,
): FixedYieldWeeklyMaterialUsageSnapshot {
  const core = structuredClone(input);
  return { ...core, snapshotId: fixedYieldWeeklyMaterialUsageSnapshotId(core) };
}

export interface FixedYieldProviderOperationConfig {
  provider: string;
  executor: string;
  maxCostFen: number;
}

export const FIXED_YIELD_AUXILIARY_INPUT_BINDING_VERSION = 'fixed-yield-auxiliary-input-binding.v2' as const;

interface FixedYieldAuthorizedAuxiliaryInputBindingBase {
  bindingVersion: typeof FIXED_YIELD_AUXILIARY_INPUT_BINDING_VERSION;
  tenantId: string;
  inputRef: string;
  sourceRevision: string;
  sourceSha256: string;
  rightsEvidenceRefs: string[];
  commercialUseApproved: boolean;
  derivativeUseAllowed: boolean;
}

export interface FixedYieldPresenterIdentityBinding extends FixedYieldAuthorizedAuxiliaryInputBindingBase {
  inputKind: 'presenter_identity';
  authorizationRef: string;
  consentRef: string;
  subjectAdultConfirmed: boolean;
  modelInputAllowed: boolean;
  permittedUses: string[];
  presenterVoiceId: string | null;
  revokedAt: string | null;
}

export interface FixedYieldBackgroundBinding extends FixedYieldAuthorizedAuxiliaryInputBindingBase {
  inputKind: 'background';
  modelInputAllowed: boolean;
  productRef: string | null;
}

export interface FixedYieldPerformanceReferenceBinding extends FixedYieldAuthorizedAuxiliaryInputBindingBase {
  inputKind: 'performance_reference';
  modelInputAllowed: boolean;
  productRef: string | null;
}

export interface FixedYieldBrandContactBinding extends FixedYieldAuthorizedAuxiliaryInputBindingBase {
  inputKind: 'brand_contact';
  publicDisplayApproved: boolean;
}

export interface FixedYieldVoiceAuthorizationBinding extends FixedYieldAuthorizedAuxiliaryInputBindingBase {
  inputKind: 'voice';
  consentRef: string;
  modelInputAllowed: boolean;
  permittedUses: string[];
  /** Set when this is the voice physically bound to the selected enterprise presenter.
   * Both fields must match the frozen presenter route; otherwise the compiler fails closed. */
  presenterRef: string | null;
  presenterVoiceId: string | null;
  /** Existing audio is accepted only when its immutable bytes are named here.
   * Generated candidates keep this null and are instead bound to voiceRef + revision. */
  authorizedArtifactSha256: string | null;
  revokedAt: string | null;
}

type FixedYieldAuxiliaryInputBinding = FixedYieldPresenterIdentityBinding | FixedYieldBackgroundBinding
  | FixedYieldPerformanceReferenceBinding | FixedYieldBrandContactBinding | FixedYieldVoiceAuthorizationBinding;

type FrozenAuxiliaryBindingEvidence = FixedYieldAuxiliaryInputBinding & { bindingEvidenceHash: string };
type FrozenVoiceAuthorizationEvidence = FixedYieldVoiceAuthorizationBinding & { bindingEvidenceHash: string };

export interface FixedYieldPresenterRoutingConfig {
  presenterRef: string;
  /** Physical voice bound to the selected presenter. Null selects an explicitly
   * authorized standalone voiceRef instead of inferring a voice from the presenter. */
  presenterVoiceId: string | null;
  presenterSourceRevision: string;
  presenterAuthorizationRef: string;
  presenterIdentityBinding: FixedYieldPresenterIdentityBinding;
  /** Legacy single-background default. New plans should freeze the exact
   * approved background for every physical timeline shot below. */
  backgroundRef: string;
  backgroundSourceRevision: string;
  backgroundBinding: FixedYieldBackgroundBinding;
  backgroundRefByShotId?: Record<string, string>;
  backgroundSourceRevisionByShotId?: Record<string, string>;
  backgroundBindingByShotId?: Record<string, FixedYieldBackgroundBinding>;
  performanceReferenceByShotId: Record<string, string>;
  performanceReferenceSourceRevisionByShotId: Record<string, string>;
  performanceReferenceBindingByShotId: Record<string, FixedYieldPerformanceReferenceBinding>;
  brandContactRef: string | null;
  brandContactSourceRevision: string | null;
  brandContactBinding: FixedYieldBrandContactBinding | null;
  voice:
    | { kind: 'existing_artifact'; voiceRef: string; sourceRevision: string;
      authorizationBinding: FixedYieldVoiceAuthorizationBinding;
      artifactRef: string; artifactSha256: string; durationMs: number }
    | { kind: 'generate'; voiceRef: string; sourceRevision: string;
      authorizationBinding: FixedYieldVoiceAuthorizationBinding;
      specificationRef: string; providerOperation: FixedYieldProviderOperationConfig };
  modes: Partial<Record<Exclude<FixedYieldProductionMode, 'local_video_match'>, {
    primary: FixedYieldProviderOperationConfig;
    firstFrame?: FixedYieldProviderOperationConfig;
    repair?: FixedYieldProviderOperationConfig;
  }>>;
}

export interface FixedYieldCompileBlocker {
  code: string;
  shotId: string | null;
  message: string;
}

export interface FixedYieldCompileResult {
  ready: boolean;
  blockers: FixedYieldCompileBlocker[];
  plan: FixedYieldProductionPlan | null;
}

const pipelineByMode: Record<Exclude<FixedYieldProductionMode, 'local_video_match'>, PresenterPipeline> = {
  pipeline_1: 'pipeline_1_heygen',
  pipeline_2: 'pipeline_2_performance_reference',
  pipeline_3: 'pipeline_3_reconstructed_frames',
};

const REPAIRABLE_PRESENTER_FAILURE_CODES = [
  'identity_drift', 'lip_sync_mismatch', 'background_instability', 'duration_mismatch',
] as const;

/** Immutable QA identities are compiled into the operation request so a later
 * executor/config rollout cannot silently evaluate an already-frozen plan with
 * different thresholds. The persisted quality decision must echo both fields. */
export const FIXED_YIELD_QA_POLICY_IDENTITIES = Object.freeze({
  localShot: Object.freeze({
    qaProfileId: 'fixed-yield-local-shot-qa',
    thresholdsVersion: 'fixed-yield-local-shot-qa.v2',
  }),
  presenterShot: Object.freeze({
    qaProfileId: 'presenter-shot-quality-gate',
    thresholdsVersion: 'presenter-shot-quality-gate.v2',
  }),
  wholeVideo: Object.freeze({
    qaProfileId: 'fixed-yield-whole-video-qa',
    thresholdsVersion: 'fixed-yield-whole-video-qa.v2',
  }),
} as const);

function operation(input: FixedYieldOperationDraft): FixedYieldOperationDraft {
  return input;
}

function localOperation(input: Omit<FixedYieldOperationDraft, 'executionKind' | 'provider' | 'maxCostFen'>): FixedYieldOperationDraft {
  return operation({ ...input, executionKind: 'local', provider: null, maxCostFen: 0 });
}

function providerOperation(input: Omit<FixedYieldOperationDraft, 'executionKind' | 'provider' | 'executor' | 'maxCostFen'> & {
  config: FixedYieldProviderOperationConfig;
}): FixedYieldOperationDraft {
  const { config, ...rest } = input;
  return operation({ ...rest, executionKind: 'provider', provider: config.provider,
    executor: config.executor, maxCostFen: config.maxCostFen });
}

function addBlocker(blockers: FixedYieldCompileBlocker[], code: string, shotId: string | null, message: string): void {
  if (!blockers.some(item => item.code === code && item.shotId === shotId && item.message === message)) blockers.push({ code, shotId, message });
}

function localSegmentKey(value: Pick<FixedYieldLocalSegmentBinding, 'physicalSegmentSha256'>): string {
  return String(value.physicalSegmentSha256 || '').trim().toLowerCase();
}

function validatedWeeklyMaterialUsageSnapshot(input: {
  snapshot: FixedYieldWeeklyMaterialUsageSnapshot | null | undefined;
  tenantId: string;
  blockers: FixedYieldCompileBlocker[];
}): FixedYieldWeeklyMaterialUsageSnapshot | null {
  const { snapshot, blockers } = input;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    addBlocker(blockers, 'weekly_material_usage_snapshot_missing', null,
      '本地素材路径缺少当前周的跨订单片段占用快照，禁止仅依赖单计划内存去重');
    return null;
  }
  const reasons: string[] = [];
  if (snapshot.schemaVersion !== FIXED_YIELD_WEEKLY_MATERIAL_USAGE_VERSION) reasons.push('schema_version_unsupported');
  if (!snapshot.tenantId || snapshot.tenantId !== input.tenantId) reasons.push('tenant_mismatch');
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const startsAt = datePattern.test(snapshot.weekStartsAt) ? Date.parse(`${snapshot.weekStartsAt}T00:00:00.000Z`) : Number.NaN;
  const endsAt = datePattern.test(snapshot.weekEndsAt) ? Date.parse(`${snapshot.weekEndsAt}T00:00:00.000Z`) : Number.NaN;
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt < startsAt || endsAt - startsAt > 6 * 86_400_000) {
    reasons.push('week_scope_invalid');
  }
  if (!Number.isFinite(Date.parse(snapshot.checkedAt))) reasons.push('checked_at_invalid');
  if (!Array.isArray(snapshot.reservations)) reasons.push('reservations_invalid');
  else if (snapshot.reservations.some(item => !item || typeof item !== 'object'
    || !String(item.assetId || '').trim() || !String(item.segmentId || '').trim()
    || !String(item.sourceRevision || '').trim() || !String(item.orderId || '').trim()
    || !SHA256_PATTERN.test(String(item.physicalSegmentSha256 || '').trim().toLowerCase()))) {
    reasons.push('reservation_identity_invalid');
  }
  const { snapshotId, ...core } = snapshot;
  if (!/^[a-f0-9]{64}$/.test(snapshotId || '') || snapshotId !== fixedYieldWeeklyMaterialUsageSnapshotId(core)) {
    reasons.push('snapshot_hash_mismatch');
  }
  if (reasons.length) {
    addBlocker(blockers, 'weekly_material_usage_snapshot_invalid', null,
      `当前周跨订单片段占用快照不可用：${[...new Set(reasons)].join(',')}`);
    return null;
  }
  return structuredClone(snapshot);
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function normalizedBindingText(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : '';
}

function normalizedBindingTextList(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(normalizedBindingText).filter(Boolean))].sort();
}

function validateAuxiliaryBinding(input: {
  binding: FixedYieldAuxiliaryInputBinding | null | undefined;
  inputKind: FixedYieldAuxiliaryInputBinding['inputKind'];
  tenantId: string;
  inputRef: string;
  sourceRevision: string;
  authorizationRef?: string;
  requiredProductRef?: string | null;
  expectedPresenterRef?: string;
  expectedPresenterVoiceId?: string | null;
}): { evidence: FrozenAuxiliaryBindingEvidence | null; reasons: string[] } {
  const binding = input.binding as unknown;
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
    return { evidence: null, reasons: ['binding_missing'] };
  }
  const row = binding as Record<string, unknown>;
  const reasons: string[] = [];
  const bindingVersion = normalizedBindingText(row.bindingVersion);
  const inputKind = normalizedBindingText(row.inputKind);
  const tenantId = normalizedBindingText(row.tenantId);
  const inputRef = normalizedBindingText(row.inputRef);
  const sourceRevision = normalizedBindingText(row.sourceRevision);
  const sourceSha256 = normalizedBindingText(row.sourceSha256).toLowerCase();
  const rightsEvidenceRefs = usableLocalMaterialRightsEvidence(row.rightsEvidenceRefs).sort();
  if (bindingVersion !== FIXED_YIELD_AUXILIARY_INPUT_BINDING_VERSION) reasons.push('binding_version_unsupported');
  if (inputKind !== input.inputKind) reasons.push('input_kind_mismatch');
  if (!tenantId || tenantId !== normalizedBindingText(input.tenantId)) reasons.push('tenant_mismatch');
  if (!inputRef || inputRef !== normalizedBindingText(input.inputRef)) reasons.push('input_ref_mismatch');
  if (!sourceRevision || sourceRevision !== normalizedBindingText(input.sourceRevision)) reasons.push('source_revision_mismatch');
  if (!SHA256_PATTERN.test(sourceSha256)) reasons.push('source_hash_invalid');
  if (!rightsEvidenceRefs.length) reasons.push('rights_evidence_missing');
  if (row.commercialUseApproved !== true) reasons.push('commercial_use_not_allowed');
  if (row.derivativeUseAllowed !== true) reasons.push('derivative_use_not_allowed');
  if (input.inputKind !== 'brand_contact' && row.modelInputAllowed !== true) reasons.push('model_input_not_allowed');

  let normalized: FixedYieldAuxiliaryInputBinding | null = null;
  if (input.inputKind === 'presenter_identity') {
    const authorizationRef = normalizedBindingText(row.authorizationRef);
    const consentRef = normalizedBindingText(row.consentRef);
    const permittedUses = normalizedBindingTextList(row.permittedUses);
    const presenterVoiceId = normalizedBindingText(row.presenterVoiceId) || null;
    const revokedAt = row.revokedAt === null || row.revokedAt === undefined ? null : normalizedBindingText(row.revokedAt);
    if (!authorizationRef || authorizationRef !== normalizedBindingText(input.authorizationRef)) reasons.push('authorization_ref_mismatch');
    if (!consentRef) reasons.push('consent_evidence_missing');
    if (row.subjectAdultConfirmed !== true) reasons.push('adult_confirmation_missing');
    if (!permittedUses.includes('digital_presenter')) reasons.push('digital_presenter_use_not_allowed');
    if (normalizedBindingText(input.expectedPresenterVoiceId) && !permittedUses.includes('voice_synthesis')) {
      reasons.push('voice_synthesis_use_not_allowed');
    }
    if (normalizedBindingText(input.expectedPresenterVoiceId)
      && presenterVoiceId !== normalizedBindingText(input.expectedPresenterVoiceId)) reasons.push('presenter_voice_id_mismatch');
    if (revokedAt) reasons.push('authorization_revoked');
    normalized = {
      bindingVersion: FIXED_YIELD_AUXILIARY_INPUT_BINDING_VERSION,
      inputKind: 'presenter_identity', tenantId, inputRef, sourceRevision, sourceSha256,
      rightsEvidenceRefs, commercialUseApproved: row.commercialUseApproved === true,
      derivativeUseAllowed: row.derivativeUseAllowed === true,
      authorizationRef, consentRef, subjectAdultConfirmed: row.subjectAdultConfirmed === true,
      modelInputAllowed: row.modelInputAllowed === true, permittedUses, presenterVoiceId, revokedAt,
    };
  } else if (input.inputKind === 'background') {
    normalized = {
      bindingVersion: FIXED_YIELD_AUXILIARY_INPUT_BINDING_VERSION,
      inputKind: 'background', tenantId, inputRef, sourceRevision, sourceSha256,
      rightsEvidenceRefs, commercialUseApproved: row.commercialUseApproved === true,
      derivativeUseAllowed: row.derivativeUseAllowed === true,
      modelInputAllowed: row.modelInputAllowed === true,
      productRef: normalizedBindingText(row.productRef) || null,
    };
  } else if (input.inputKind === 'performance_reference') {
    const productRef = normalizedBindingText(row.productRef) || null;
    const requiredProductRef = normalizedBindingText(input.requiredProductRef);
    if (requiredProductRef && productRef !== requiredProductRef) reasons.push('product_identity_mismatch');
    normalized = {
      bindingVersion: FIXED_YIELD_AUXILIARY_INPUT_BINDING_VERSION,
      inputKind: 'performance_reference', tenantId, inputRef, sourceRevision, sourceSha256,
      rightsEvidenceRefs, commercialUseApproved: row.commercialUseApproved === true,
      derivativeUseAllowed: row.derivativeUseAllowed === true,
      modelInputAllowed: row.modelInputAllowed === true, productRef,
    };
  } else if (input.inputKind === 'brand_contact') {
    if (row.publicDisplayApproved !== true) reasons.push('public_display_not_approved');
    normalized = {
      bindingVersion: FIXED_YIELD_AUXILIARY_INPUT_BINDING_VERSION,
      inputKind: 'brand_contact', tenantId, inputRef, sourceRevision, sourceSha256,
      rightsEvidenceRefs, commercialUseApproved: row.commercialUseApproved === true,
      derivativeUseAllowed: row.derivativeUseAllowed === true,
      publicDisplayApproved: row.publicDisplayApproved === true,
    };
  } else {
    const consentRef = normalizedBindingText(row.consentRef);
    const permittedUses = normalizedBindingTextList(row.permittedUses);
    const presenterRef = normalizedBindingText(row.presenterRef) || null;
    const presenterVoiceId = normalizedBindingText(row.presenterVoiceId) || null;
    const authorizedArtifactSha256 = normalizedBindingText(row.authorizedArtifactSha256).toLowerCase() || null;
    const expectedPresenterRef = normalizedBindingText(input.expectedPresenterRef);
    const expectedPresenterVoiceId = normalizedBindingText(input.expectedPresenterVoiceId) || null;
    const revokedAt = row.revokedAt === null || row.revokedAt === undefined ? null : normalizedBindingText(row.revokedAt);
    if (!consentRef) reasons.push('consent_evidence_missing');
    if (!permittedUses.includes('voice_synthesis')) reasons.push('voice_synthesis_use_not_allowed');
    if (authorizedArtifactSha256 && !SHA256_PATTERN.test(authorizedArtifactSha256)) reasons.push('authorized_artifact_hash_invalid');
    if (revokedAt) reasons.push('authorization_revoked');
    if (expectedPresenterVoiceId) {
      if (presenterVoiceId !== expectedPresenterVoiceId) reasons.push('presenter_voice_id_mismatch');
      if (!expectedPresenterRef || presenterRef !== expectedPresenterRef) reasons.push('presenter_ref_mismatch');
    } else {
      if (presenterVoiceId) reasons.push('presenter_voice_id_not_frozen');
      if (presenterRef && presenterRef !== expectedPresenterRef) reasons.push('presenter_ref_mismatch');
    }
    normalized = {
      bindingVersion: FIXED_YIELD_AUXILIARY_INPUT_BINDING_VERSION,
      inputKind: 'voice', tenantId, inputRef, sourceRevision, sourceSha256,
      rightsEvidenceRefs, commercialUseApproved: row.commercialUseApproved === true,
      derivativeUseAllowed: row.derivativeUseAllowed === true,
      consentRef, modelInputAllowed: row.modelInputAllowed === true, permittedUses,
      presenterRef, presenterVoiceId, authorizedArtifactSha256, revokedAt,
    };
  }
  if (reasons.length) return { evidence: null, reasons: [...new Set(reasons)] };
  return { evidence: { ...normalized, bindingEvidenceHash: fixedYieldSha256(normalized) }, reasons: [] };
}

function compileLocalShot(input: {
  tenantId: string;
  shot: FixedYieldTimelineShot;
  binding: FixedYieldLocalSegmentBinding | undefined;
  alreadyUsed: boolean;
  weeklyUsageSnapshot: FixedYieldWeeklyMaterialUsageSnapshot | null;
  blockers: FixedYieldCompileBlocker[];
}): FixedYieldOperationDraft[] {
  const { shot, binding, blockers } = input;
  if (!binding) {
    addBlocker(blockers, 'local_segment_binding_missing', shot.timelineShotId, `${shot.archetypeId} 没有冻结企业本地素材片段`);
    return [];
  }
  if (!SHA256_PATTERN.test(String(binding.physicalSegmentSha256 || '').trim().toLowerCase())) {
    addBlocker(blockers, 'local_segment_physical_identity_missing', shot.timelineShotId,
      `${shot.archetypeId} 没有冻结可跨记录去重的物理片段 SHA-256`);
    return [];
  }
  const requiresProduct = FIXED_YIELD_MATERIAL_RULES[shot.archetypeId].productIdentity === 'same_product';
  if (requiresProduct && !shot.productRef) {
    addBlocker(blockers, 'product_identity_missing', shot.timelineShotId, `${shot.archetypeId} 没有冻结产品身份`);
    return [];
  }
  if (binding.requestedProductRef && binding.requestedProductRef !== shot.productRef) {
    addBlocker(blockers, 'product_identity_changed', shot.timelineShotId, `${shot.archetypeId} 的素材产品身份与冻结时间线不一致`);
    return [];
  }
  const reasons = evaluateLocalMaterialSegmentProfile({
    profile: binding.profile, tenantId: input.tenantId, assetId: binding.assetId,
    segmentId: binding.segmentId, sourceRevision: binding.sourceRevision,
    targetMaterialType: shot.materialType, targetArchetypeId: shot.archetypeId,
    requestedProductRef: shot.productRef, requiredDurationSeconds: shot.targetOutputDurationMs / 1000,
    alreadyUsed: input.alreadyUsed,
  });
  if (reasons.length) {
    addBlocker(blockers, 'local_segment_not_eligible', shot.timelineShotId, reasons.join(','));
    return [];
  }
  const prefix = `shot:${shot.timelineShotId}`;
  const extract = `${prefix}:extract`;
  const qa = `${prefix}:qa`;
  const finalize = `${prefix}:finalize`;
  return [
    localOperation({ operationId: extract, shotId: shot.timelineShotId, role: 'local_segment_extract', executor: 'ffmpeg',
      dependsOn: [], activation: 'always', request: {
        assetId: binding.assetId, segmentId: binding.segmentId, sourceRevision: binding.sourceRevision,
        physicalSegmentSha256: binding.physicalSegmentSha256.toLowerCase(),
        sourceStartMs: binding.profile.startMs, sourceEndMs: binding.profile.startMs + shot.targetOutputDurationMs,
        targetDurationMs: shot.targetOutputDurationMs, rightsEvidenceRefs: binding.profile.rightsEvidenceRefs,
        weeklyMaterialUsageSnapshotId: input.weeklyUsageSnapshot?.snapshotId || '',
        weekStartsAt: input.weeklyUsageSnapshot?.weekStartsAt || '',
        weekEndsAt: input.weeklyUsageSnapshot?.weekEndsAt || '',
      } }),
    localOperation({ operationId: qa, shotId: shot.timelineShotId, role: 'shot_quality', executor: FIXED_YIELD_QA_POLICY_IDENTITIES.localShot.qaProfileId,
      dependsOn: [extract], activation: 'always', request: { ...FIXED_YIELD_QA_POLICY_IDENTITIES.localShot,
        archetypeId: shot.archetypeId, materialType: shot.materialType,
        expectedDurationMs: shot.targetOutputDurationMs, sourceRevision: binding.sourceRevision } }),
    localOperation({ operationId: finalize, shotId: shot.timelineShotId, role: 'shot_finalize', executor: 'fixed-yield-asset-finalize',
      dependsOn: [qa], activation: 'always', request: { timelineShotId: shot.timelineShotId,
        initialQualityGateOperationId: qa, conditionalRepairOperationId: null,
        repairQualityGateOperationId: null, deliverableSelector: 'accepted_quality_output_only' } }),
  ];
}

function compileVoice(input: {
  tenantId: string;
  routing: FixedYieldPresenterRoutingConfig;
  timeline: FixedYieldTimelineCompilation;
  blockers: FixedYieldCompileBlocker[];
}): { operations: FixedYieldOperationDraft[]; verifiedVoiceOperationId: string;
  authorizationEvidence: FrozenVoiceAuthorizationEvidence | null } {
  const verify = 'content:canonical-voice:verify';
  const voice = input.routing.voice;
  const authorization = validateAuxiliaryBinding({
    binding: voice.authorizationBinding,
    inputKind: 'voice',
    tenantId: input.tenantId,
    inputRef: voice.voiceRef,
    sourceRevision: voice.sourceRevision,
    expectedPresenterRef: input.routing.presenterRef,
    expectedPresenterVoiceId: input.routing.presenterVoiceId,
  });
  const reasons = [...authorization.reasons];
  if (!normalizedBindingText(voice.voiceRef)) reasons.push('voice_ref_missing');
  if (!normalizedBindingText(voice.sourceRevision)) reasons.push('source_revision_missing');
  if (voice.kind === 'existing_artifact') {
    if (!normalizedBindingText(voice.artifactRef)) reasons.push('artifact_ref_missing');
    if (!SHA256_PATTERN.test(normalizedBindingText(voice.artifactSha256).toLowerCase())) reasons.push('artifact_hash_invalid');
    const authorizedArtifactSha256 = authorization.evidence?.inputKind === 'voice'
      ? authorization.evidence.authorizedArtifactSha256 : null;
    if (!authorizedArtifactSha256 || authorizedArtifactSha256 !== normalizedBindingText(voice.artifactSha256).toLowerCase()) {
      reasons.push('artifact_hash_not_authorized');
    }
    if (!Number.isSafeInteger(voice.durationMs) || voice.durationMs <= 0) reasons.push('artifact_duration_invalid');
  } else {
    if (!normalizedBindingText(voice.specificationRef)) reasons.push('specification_ref_missing');
    if (!normalizedBindingText(voice.providerOperation.provider)
      || !normalizedBindingText(voice.providerOperation.executor)
      || !Number.isSafeInteger(voice.providerOperation.maxCostFen)
      || voice.providerOperation.maxCostFen < 0) reasons.push('provider_route_invalid');
  }
  const evidence = authorization.evidence?.inputKind === 'voice'
    ? authorization.evidence as FrozenVoiceAuthorizationEvidence : null;
  if (reasons.length || !evidence) {
    addBlocker(input.blockers, 'presenter_voice_binding_invalid', null,
      `声音授权绑定不可用：${[...new Set(reasons.length ? reasons : ['binding_missing'])].join(',')}`);
    return { verifiedVoiceOperationId: verify, operations: [], authorizationEvidence: null };
  }
  const frozenAuthorization = {
    authorizationBinding: evidence,
    voiceBindingEvidenceHash: evidence.bindingEvidenceHash,
  };
  if (voice.kind === 'existing_artifact') return {
    verifiedVoiceOperationId: verify,
    authorizationEvidence: evidence,
    operations: [localOperation({ operationId: verify, shotId: null, role: 'voice_quality', executor: 'canonical-voice-verifier',
      dependsOn: [], activation: 'always', request: { mode: 'existing_artifact',
        voiceRef: voice.voiceRef, sourceRevision: voice.sourceRevision,
        artifactRef: voice.artifactRef, artifactSha256: voice.artifactSha256.toLowerCase(), durationMs: voice.durationMs,
        presenterVoiceId: input.routing.presenterVoiceId, ...frozenAuthorization,
        expectedTimelineDurationMs: input.timeline.targetDurationMs } })],
  };
  const generate = 'content:canonical-voice:generate';
  return {
    verifiedVoiceOperationId: verify,
    authorizationEvidence: evidence,
    operations: [
      providerOperation({ operationId: generate, shotId: null, role: 'canonical_voice', dependsOn: [], activation: 'always',
        request: { voiceRef: voice.voiceRef, sourceRevision: voice.sourceRevision,
          specificationRef: voice.specificationRef, presenterVoiceId: input.routing.presenterVoiceId,
          ...frozenAuthorization, expectedTimelineDurationMs: input.timeline.targetDurationMs },
        config: voice.providerOperation }),
      localOperation({ operationId: verify, shotId: null, role: 'voice_quality', executor: 'canonical-voice-verifier',
        dependsOn: [generate], activation: 'always', request: { mode: 'generated_candidate', sourceOperationId: generate,
          voiceRef: voice.voiceRef, sourceRevision: voice.sourceRevision, presenterVoiceId: input.routing.presenterVoiceId,
          ...frozenAuthorization, expectedTimelineDurationMs: input.timeline.targetDurationMs } }),
    ],
  };
}

function compilePresenterShot(input: {
  tenantId: string;
  shot: FixedYieldTimelineShot;
  routing: FixedYieldPresenterRoutingConfig;
  verifiedVoiceOperationId: string;
  voiceAuthorizationEvidence: FrozenVoiceAuthorizationEvidence | null;
  blockers: FixedYieldCompileBlocker[];
}): FixedYieldOperationDraft[] {
  const { shot, routing, blockers } = input;
  if (shot.productionMode === 'local_video_match') {
    addBlocker(blockers, 'presenter_mode_invalid', shot.timelineShotId, '真人口播镜头不能冻结为本地普通素材路径');
    return [];
  }
  const mode = routing.modes[shot.productionMode];
  const performanceReference = routing.performanceReferenceByShotId[shot.timelineShotId] || '';
  const performanceReferenceSourceRevision = routing.performanceReferenceSourceRevisionByShotId[shot.timelineShotId] || '';
  const backgroundRef = routing.backgroundRefByShotId?.[shot.timelineShotId] || routing.backgroundRef;
  const backgroundSourceRevision = routing.backgroundSourceRevisionByShotId?.[shot.timelineShotId] || routing.backgroundSourceRevision;
  const presenterAuthorization = validateAuxiliaryBinding({
    binding: routing.presenterIdentityBinding, inputKind: 'presenter_identity', tenantId: input.tenantId,
    inputRef: routing.presenterRef, sourceRevision: routing.presenterSourceRevision,
    authorizationRef: routing.presenterAuthorizationRef, expectedPresenterVoiceId: routing.presenterVoiceId,
  });
  const backgroundAuthorization = validateAuxiliaryBinding({
    binding: routing.backgroundBindingByShotId?.[shot.timelineShotId] || routing.backgroundBinding,
    inputKind: 'background', tenantId: input.tenantId, inputRef: backgroundRef,
    sourceRevision: backgroundSourceRevision,
  });
  const dynamic = ['P1A_FACTORY_WALK_TALK', 'P1D_SHELF_ACTION_TALK', 'P1F_REAL_PRODUCT_CONTACT'].includes(shot.archetypeId);
  const performanceAuthorization = dynamic ? validateAuxiliaryBinding({
    binding: routing.performanceReferenceBindingByShotId[shot.timelineShotId],
    inputKind: 'performance_reference', tenantId: input.tenantId, inputRef: performanceReference,
    sourceRevision: performanceReferenceSourceRevision,
    requiredProductRef: shot.archetypeId === 'P1F_REAL_PRODUCT_CONTACT' ? shot.productRef : null,
  }) : { evidence: null, reasons: [] };
  const brandContactAuthorization = shot.archetypeId === 'P1E_PRESENTER_CTA' ? validateAuxiliaryBinding({
    binding: routing.brandContactBinding, inputKind: 'brand_contact', tenantId: input.tenantId,
    inputRef: routing.brandContactRef || '', sourceRevision: routing.brandContactSourceRevision || '',
  }) : { evidence: null, reasons: [] };
  if (shot.archetypeId === 'P1F_REAL_PRODUCT_CONTACT' && !normalizedBindingText(shot.productRef)) {
    addBlocker(blockers, 'presenter_product_identity_missing', shot.timelineShotId, 'P1F 真人接触产品镜头没有冻结产品 SKU');
  }
  if (!presenterAuthorization.evidence) addBlocker(blockers, 'presenter_identity_binding_invalid', shot.timelineShotId,
    `人物身份授权绑定不可用：${presenterAuthorization.reasons.join(',')}`);
  if (!backgroundAuthorization.evidence) addBlocker(blockers, 'presenter_background_binding_invalid', shot.timelineShotId,
    `场景背景授权绑定不可用：${backgroundAuthorization.reasons.join(',')}`);
  if (dynamic && !performanceAuthorization.evidence) addBlocker(blockers, 'presenter_performance_binding_invalid', shot.timelineShotId,
    `动作参考授权绑定不可用：${performanceAuthorization.reasons.join(',')}`);
  if (shot.archetypeId === 'P1E_PRESENTER_CTA' && !brandContactAuthorization.evidence) {
    addBlocker(blockers, 'presenter_brand_contact_binding_invalid', shot.timelineShotId,
      `公开联系方式授权绑定不可用：${brandContactAuthorization.reasons.join(',')}`);
  }
  const readiness = {
    presenter: Boolean(presenterAuthorization.evidence), voice: Boolean(input.voiceAuthorizationEvidence),
    background: Boolean(backgroundAuthorization.evidence),
    performanceReference: Boolean(performanceAuthorization.evidence),
    brandContact: Boolean(brandContactAuthorization.evidence),
  };
  const graph = compilePresenterShotExecutionGraph({ shotId: shot.timelineShotId,
    archetypeId: shot.archetypeId as Extract<typeof shot.archetypeId, `P1${string}`>,
    pipeline: pipelineByMode[shot.productionMode], readiness });
  for (const blocker of graph.blockers) addBlocker(blockers, `presenter_${blocker}`, shot.timelineShotId, blocker);
  if (!mode) {
    addBlocker(blockers, 'presenter_provider_route_missing', shot.timelineShotId, `${shot.productionMode} 没有冻结供应商执行器`);
    return [];
  }
  if (shot.productionMode === 'pipeline_3' && !mode.firstFrame) {
    addBlocker(blockers, 'presenter_first_frame_route_missing', shot.timelineShotId, 'pipeline_3 没有冻结现有首帧执行器');
    return [];
  }
  const prefix = `shot:${shot.timelineShotId}`;
  const identity = `${prefix}:identity`;
  const background = `${prefix}:background`;
  const performance = `${prefix}:performance`;
  const brandContact = `${prefix}:brand-contact`;
  const firstFrame = `${prefix}:first-frame`;
  const talking = `${prefix}:talking-video`;
  const composite = `${prefix}:composite`;
  const qa = `${prefix}:qa`;
  const repair = `${prefix}:repair`;
  const repairQa = `${prefix}:repair-qa`;
  const finalize = `${prefix}:finalize`;
  const operations: FixedYieldOperationDraft[] = [
    localOperation({ operationId: identity, shotId: shot.timelineShotId, role: 'presenter_identity', executor: 'enterprise-presenter-lock',
      dependsOn: [], activation: 'always', request: { presenterRef: routing.presenterRef,
        sourceRevision: routing.presenterSourceRevision, authorizationRef: routing.presenterAuthorizationRef,
        authorizationBinding: presenterAuthorization.evidence } }),
    localOperation({ operationId: background, shotId: shot.timelineShotId, role: 'background_scene', executor: 'local-material-lock',
      dependsOn: [], activation: 'always', request: { backgroundRef, sourceRevision: backgroundSourceRevision,
        archetypeId: shot.archetypeId, authorizationBinding: backgroundAuthorization.evidence } }),
  ];
  if (dynamic) operations.push(localOperation({ operationId: performance, shotId: shot.timelineShotId,
    role: 'performance_motion', executor: 'authorized-performance-lock', dependsOn: [], activation: 'always',
    request: { performanceReference, sourceRevision: performanceReferenceSourceRevision,
      targetDurationMs: shot.targetOutputDurationMs, productRef: shot.productRef,
      authorizationBinding: performanceAuthorization.evidence } }));
  if (shot.archetypeId === 'P1E_PRESENTER_CTA') operations.push(localOperation({ operationId: brandContact,
    shotId: shot.timelineShotId, role: 'brand_contact_overlay', executor: 'authorized-brand-contact-lock',
    dependsOn: [], activation: 'always', request: { brandContactRef: routing.brandContactRef,
      sourceRevision: routing.brandContactSourceRevision, authorizationBinding: brandContactAuthorization.evidence } }));
  const firstFrameDependencies = [identity, background, ...(dynamic ? [performance] : [])];
  operations.push(mode.firstFrame
    ? providerOperation({ operationId: firstFrame, shotId: shot.timelineShotId, role: 'target_first_frame',
      dependsOn: firstFrameDependencies, activation: 'always', request: { archetypeId: shot.archetypeId,
        targetDurationMs: shot.targetOutputDurationMs, presenterRef: routing.presenterRef, backgroundRef,
        presenterBindingEvidenceHash: presenterAuthorization.evidence?.bindingEvidenceHash,
        backgroundBindingEvidenceHash: backgroundAuthorization.evidence?.bindingEvidenceHash }, config: mode.firstFrame })
    : localOperation({ operationId: firstFrame, shotId: shot.timelineShotId, role: 'target_first_frame', executor: 'approved-first-frame-lock',
      dependsOn: firstFrameDependencies, activation: 'always', request: { archetypeId: shot.archetypeId,
        presenterRef: routing.presenterRef, backgroundRef,
        presenterBindingEvidenceHash: presenterAuthorization.evidence?.bindingEvidenceHash,
        backgroundBindingEvidenceHash: backgroundAuthorization.evidence?.bindingEvidenceHash } }));
  operations.push(providerOperation({ operationId: talking, shotId: shot.timelineShotId, role: 'talking_video',
    dependsOn: [input.verifiedVoiceOperationId, firstFrame], activation: 'always', request: {
      productionMode: shot.productionMode, targetDurationMs: shot.targetOutputDurationMs,
      presenterRef: routing.presenterRef, productRef: shot.productRef, performanceReference: performanceReference || null,
      voiceBindingEvidenceHash: input.voiceAuthorizationEvidence?.bindingEvidenceHash,
      presenterBindingEvidenceHash: presenterAuthorization.evidence?.bindingEvidenceHash,
      performanceBindingEvidenceHash: performanceAuthorization.evidence?.bindingEvidenceHash || null,
    }, config: mode.primary }));
  operations.push(localOperation({ operationId: composite, shotId: shot.timelineShotId, role: 'layer_composite', executor: 'ffmpeg',
    dependsOn: [talking, ...(shot.archetypeId === 'P1E_PRESENTER_CTA' ? [brandContact] : [])], activation: 'always',
    request: { targetDurationMs: shot.targetOutputDurationMs,
      brandContactRef: shot.archetypeId === 'P1E_PRESENTER_CTA' ? routing.brandContactRef : null,
      brandContactBindingEvidenceHash: brandContactAuthorization.evidence?.bindingEvidenceHash || null } }));
  operations.push(localOperation({ operationId: qa, shotId: shot.timelineShotId, role: 'shot_quality', executor: FIXED_YIELD_QA_POLICY_IDENTITIES.presenterShot.qaProfileId,
    dependsOn: [composite], activation: 'always', request: { ...FIXED_YIELD_QA_POLICY_IDENTITIES.presenterShot,
      archetypeId: shot.archetypeId,
      expectedDurationMs: shot.targetOutputDurationMs, presenterRef: routing.presenterRef,
      authorizationRef: routing.presenterAuthorizationRef,
      voiceBindingEvidenceHash: input.voiceAuthorizationEvidence?.bindingEvidenceHash,
      presenterBindingEvidenceHash: presenterAuthorization.evidence?.bindingEvidenceHash } }));
  if (mode.repair) operations.push(providerOperation({ operationId: repair, shotId: shot.timelineShotId,
    role: 'conditional_repair', dependsOn: [qa], activation: 'on_quality_failure', qualityGateOperationId: qa,
    request: { sourceOperationId: talking, qualityGateOperationId: qa, oneAttemptOnly: true,
      repairableFailureCodes: [...REPAIRABLE_PRESENTER_FAILURE_CODES] }, config: mode.repair }));
  if (mode.repair) operations.push(localOperation({ operationId: repairQa, shotId: shot.timelineShotId,
    role: 'repair_quality', executor: FIXED_YIELD_QA_POLICY_IDENTITIES.presenterShot.qaProfileId, dependsOn: [qa, repair],
    activation: 'on_quality_failure', qualityGateOperationId: qa, request: {
      ...FIXED_YIELD_QA_POLICY_IDENTITIES.presenterShot,
      sourceOperationId: repair, archetypeId: shot.archetypeId, expectedDurationMs: shot.targetOutputDurationMs,
      presenterRef: routing.presenterRef, authorizationRef: routing.presenterAuthorizationRef,
      voiceBindingEvidenceHash: input.voiceAuthorizationEvidence?.bindingEvidenceHash,
      presenterBindingEvidenceHash: presenterAuthorization.evidence?.bindingEvidenceHash,
      repairableFailureCodes: [...REPAIRABLE_PRESENTER_FAILURE_CODES],
    } }));
  operations.push(localOperation({ operationId: finalize, shotId: shot.timelineShotId, role: 'shot_finalize',
    executor: 'fixed-yield-asset-finalize', dependsOn: [qa, ...(mode.repair ? [repair, repairQa] : [])], activation: 'always',
    request: { timelineShotId: shot.timelineShotId, initialQualityGateOperationId: qa,
      conditionalRepairOperationId: mode.repair ? repair : null,
      repairQualityGateOperationId: mode.repair ? repairQa : null,
      deliverableSelector: 'accepted_quality_output_only' } }));
  return operations;
}

/** Deterministically compiles a frozen operation DAG. It never calls a model,
 * provider, budget ledger or object store. */
export function compileFixedYieldProductionPlan(input: {
  tenantId: string;
  projectId: string;
  runId: string;
  createdAt: string;
  timeline: FixedYieldTimelineCompilation;
  readinessSnapshot: FixedYieldRuntimeReadinessSnapshot;
  localSegmentBindings: FixedYieldLocalSegmentBinding[];
  /** Required whenever the timeline contains a P2-P5 local-material shot.
   * It must include reservations from other orders in this same week. */
  weeklyMaterialUsageSnapshot?: FixedYieldWeeklyMaterialUsageSnapshot | null;
  presenterRouting?: FixedYieldPresenterRoutingConfig | null;
}): FixedYieldCompileResult {
  const blockers: FixedYieldCompileBlocker[] = [];
  if (!input.timeline.ready) input.timeline.blockers.forEach(message => addBlocker(blockers, 'timeline_not_ready', null, message));
  for (const message of fixedYieldPathReadinessIssues({ snapshot: input.readinessSnapshot,
    requirements: input.timeline.shots.map(shot => ({ pathId: shot.pathId, productionMode: shot.productionMode })),
    evaluatedAt: input.createdAt })) {
    addBlocker(blockers, 'runtime_path_not_ready', null, message);
  }
  const requiresPresenter = input.timeline.shots.some(shot => shot.pathId === 'P1_PRESENTER');
  const requiresLocalMaterial = input.timeline.shots.some(shot => shot.pathId !== 'P1_PRESENTER');
  const weeklyMaterialUsageSnapshot = requiresLocalMaterial
    ? validatedWeeklyMaterialUsageSnapshot({ snapshot: input.weeklyMaterialUsageSnapshot,
      tenantId: input.tenantId, blockers })
    : null;
  if (requiresPresenter && !input.presenterRouting) addBlocker(blockers, 'presenter_routing_missing', null, '真人口播路径没有冻结人物、声音和供应商执行器');
  const operations: FixedYieldOperationDraft[] = [];
  let verifiedVoiceOperationId = '';
  let voiceAuthorizationEvidence: FrozenVoiceAuthorizationEvidence | null = null;
  if (requiresPresenter && input.presenterRouting) {
    const voice = compileVoice({ tenantId: input.tenantId, routing: input.presenterRouting,
      timeline: input.timeline, blockers });
    operations.push(...voice.operations);
    verifiedVoiceOperationId = voice.verifiedVoiceOperationId;
    voiceAuthorizationEvidence = voice.authorizationEvidence;
  }
  const bindingByShot = new Map(input.localSegmentBindings.map(binding => [binding.timelineShotId, binding]));
  const usedSegments = new Set<string>();
  const weeklyReservedSegments = new Map((weeklyMaterialUsageSnapshot?.reservations || [])
    .map(reservation => [localSegmentKey(reservation), reservation]));
  const shotFinalOperations: string[] = [];
  for (const shot of input.timeline.shots) {
    const added = shot.pathId === 'P1_PRESENTER'
      ? input.presenterRouting ? compilePresenterShot({ tenantId: input.tenantId, shot, routing: input.presenterRouting,
        verifiedVoiceOperationId, voiceAuthorizationEvidence, blockers }) : []
      : (() => {
        const binding = bindingByShot.get(shot.timelineShotId);
        const segmentKey = binding ? localSegmentKey(binding) : '';
        const weeklyReservation = segmentKey ? weeklyReservedSegments.get(segmentKey) : undefined;
        if (weeklyReservation) {
          addBlocker(blockers, 'local_segment_already_reserved_in_week', shot.timelineShotId,
            `同一物理本地素材片段已被本周订单 ${weeklyReservation.orderId} 使用，不得跨订单重复：${segmentKey}`);
          return [];
        }
        const result = compileLocalShot({ tenantId: input.tenantId, shot, binding,
          alreadyUsed: Boolean(segmentKey && usedSegments.has(segmentKey)),
          weeklyUsageSnapshot: weeklyMaterialUsageSnapshot, blockers });
        if (result.length && segmentKey) usedSegments.add(segmentKey);
        return result;
      })();
    operations.push(...added);
    const final = added.find(item => item.role === 'shot_finalize');
    if (final) shotFinalOperations.push(final.operationId);
  }
  if (blockers.length || shotFinalOperations.length !== input.timeline.shots.length) return { ready: false, blockers, plan: null };
  operations.push(
    localOperation({ operationId: 'content:timeline:assembly', shotId: null, role: 'timeline_assembly', executor: 'ffmpeg',
      dependsOn: shotFinalOperations, activation: 'always', request: { targetDurationMs: input.timeline.targetDurationMs,
        orderedTimelineShotIds: input.timeline.shots.map(shot => shot.timelineShotId) } }),
    localOperation({ operationId: 'content:whole-video:qa', shotId: null, role: 'whole_video_quality', executor: FIXED_YIELD_QA_POLICY_IDENTITIES.wholeVideo.qaProfileId,
      dependsOn: ['content:timeline:assembly'], activation: 'always', request: { ...FIXED_YIELD_QA_POLICY_IDENTITIES.wholeVideo,
        expectedDurationMs: input.timeline.targetDurationMs,
        expectedShotCount: input.timeline.shots.length } }),
    localOperation({ operationId: 'content:finalize', shotId: null, role: 'content_finalize', executor: 'fixed-yield-content-finalize',
      dependsOn: ['content:whole-video:qa'], activation: 'always', request: { projectId: input.projectId,
        referenceVideoId: input.timeline.referenceVideoId, initialQualityGateOperationId: 'content:whole-video:qa',
        conditionalRepairOperationId: null, repairQualityGateOperationId: null,
        deliverableSelector: 'accepted_quality_output_only' } }),
  );
  const totalReservedCostFen = operations.reduce((sum, item) => sum + item.maxCostFen, 0);
  try {
    const plan = freezeFixedYieldProductionPlan({ runId: input.runId, createdAt: input.createdAt, core: {
      tenantId: input.tenantId, projectId: input.projectId, timeline: input.timeline,
      readinessSnapshot: input.readinessSnapshot, operations, finalOutputOperationId: 'content:finalize', totalReservedCostFen,
    } });
    return { ready: true, blockers: [], plan };
  } catch (error) {
    addBlocker(blockers, 'plan_invariant_failed', null, error instanceof Error ? error.message : String(error));
    return { ready: false, blockers, plan: null };
  }
}
