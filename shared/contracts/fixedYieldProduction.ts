import { fixedYieldRuntimeSnapshotIssues, type FixedYieldRuntimeReadinessSnapshot } from '../fixedYieldPathRegistry.js';
import type { FixedYieldTimelineCompilation } from '../fixedYieldTimelineCompiler.js';
import { FIXED_YIELD_CAPABILITY_MAP } from '../fixedYieldCapabilityMap.js';
import { canonicalFixedYieldJson, fixedYieldSha256 } from '../fixedYieldHash.js';

export { canonicalFixedYieldJson, fixedYieldSha256 } from '../fixedYieldHash.js';

export const FIXED_YIELD_PRODUCTION_PLAN_VERSION = 'fixed-yield-production.v2' as const;

export type FixedYieldOperationRole =
  | 'canonical_voice'
  | 'voice_quality'
  | 'presenter_identity'
  | 'background_scene'
  | 'performance_motion'
  | 'brand_contact_overlay'
  | 'target_first_frame'
  | 'talking_video'
  | 'layer_composite'
  | 'local_segment_extract'
  | 'shot_quality'
  | 'repair_quality'
  | 'shot_finalize'
  | 'conditional_repair'
  | 'timeline_assembly'
  | 'whole_video_quality'
  | 'content_finalize';

export type FixedYieldOperationState =
  | 'planned'
  | 'ready'
  | 'running'
  | 'provider_pending'
  | 'reconciling'
  | 'succeeded'
  | 'failed_retryable'
  | 'failed_terminal'
  | 'blocked_input'
  | 'skipped'
  | 'cancelled';

export interface ProductionFailure {
  schemaVersion: 'production-failure.v2';
  code: string;
  category: 'input' | 'authorization' | 'quota' | 'provider' | 'quality' | 'infrastructure' | 'cancelled';
  retryability: 'automatic' | 'after_reconciliation' | 'after_input' | 'never';
  responsibleParty: 'system' | 'provider' | 'administrator' | 'user';
  message: string;
  evidenceRefs: string[];
  occurredAt: string;
}

export interface FixedYieldOperationDraft {
  operationId: string;
  shotId: string | null;
  role: FixedYieldOperationRole;
  executor: string;
  executionKind: 'local' | 'provider';
  provider: string | null;
  dependsOn: string[];
  activation: 'always' | 'on_quality_failure';
  qualityGateOperationId?: string | null;
  request: Record<string, unknown>;
  maxCostFen: number;
}

export interface FixedYieldFrozenOperation extends FixedYieldOperationDraft {
  operationIdentityHash: string;
  requestHash: string;
  idempotencyKey: string;
}

export interface FixedYieldProductionPlanCore {
  schemaVersion: typeof FIXED_YIELD_PRODUCTION_PLAN_VERSION;
  tenantId: string;
  projectId: string;
  timeline: FixedYieldTimelineCompilation;
  readinessSnapshot: FixedYieldRuntimeReadinessSnapshot;
  operations: FixedYieldOperationDraft[];
  finalOutputOperationId: string;
  totalReservedCostFen: number;
}

export interface FixedYieldProductionPlan {
  schemaVersion: typeof FIXED_YIELD_PRODUCTION_PLAN_VERSION;
  runId: string;
  createdAt: string;
  coreHash: string;
  planHash: string;
  core: Omit<FixedYieldProductionPlanCore, 'operations'>;
  operations: FixedYieldFrozenOperation[];
}

export interface FixedYieldOperationReceipt {
  schemaVersion: 'fixed-yield-operation-receipt.v2';
  runId: string;
  operationId: string;
  idempotencyKey: string;
  state: Extract<FixedYieldOperationState, 'succeeded' | 'failed_retryable' | 'failed_terminal' | 'skipped' | 'cancelled'>;
  outputRefs: string[];
  providerReceiptId: string | null;
  reservedCostFen: number;
  settledCostFen: number;
  failure: ProductionFailure | null;
  finishedAt: string;
}

const FIXED_YIELD_OPERATION_ROLES = new Set<FixedYieldOperationRole>([
  'canonical_voice',
  'voice_quality',
  'presenter_identity',
  'background_scene',
  'performance_motion',
  'brand_contact_overlay',
  'target_first_frame',
  'talking_video',
  'layer_composite',
  'local_segment_extract',
  'shot_quality',
  'repair_quality',
  'shot_finalize',
  'conditional_repair',
  'timeline_assembly',
  'whole_video_quality',
  'content_finalize',
]);

const FIXED_YIELD_QUALITY_ROLES = new Set<FixedYieldOperationRole>([
  'shot_quality', 'repair_quality', 'whole_video_quality',
]);

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`fixed_yield_plan_${label}_invalid`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  const result = String(value ?? '').normalize('NFKC').trim();
  if (!result) throw new Error(`fixed_yield_plan_${label}_missing`);
  return result;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`fixed_yield_plan_${label}_invalid`);
  return Number(value);
}

function normalizeOperation(operation: FixedYieldOperationDraft): FixedYieldOperationDraft {
  const raw = plainRecord(operation, 'operation') as unknown as FixedYieldOperationDraft;
  const operationId = text(raw.operationId, 'operation_id');
  if (!FIXED_YIELD_OPERATION_ROLES.has(raw.role)) {
    throw new Error(`fixed_yield_plan_operation_role_invalid:${operationId}`);
  }
  const executionKind = raw.executionKind;
  if (executionKind !== 'local' && executionKind !== 'provider') {
    throw new Error(`fixed_yield_plan_execution_kind_invalid:${operationId}`);
  }
  if (raw.activation !== 'always' && raw.activation !== 'on_quality_failure') {
    throw new Error(`fixed_yield_plan_activation_invalid:${operationId}`);
  }
  if (!Array.isArray(raw.dependsOn)) throw new Error(`fixed_yield_plan_dependencies_invalid:${operationId}`);
  const request = plainRecord(raw.request, `${operationId}_request`);
  // This also rejects non-canonical nested values such as undefined, Dates,
  // functions and non-finite numbers before they can cross the trust boundary.
  canonicalFixedYieldJson(request);
  const maxCostFen = integer(raw.maxCostFen, `${operationId}_max_cost`);
  if (executionKind === 'local' && (operation.provider !== null || maxCostFen !== 0)) {
    throw new Error(`fixed_yield_local_operation_billing_invalid:${operationId}`);
  }
  if (executionKind === 'provider' && !String(raw.provider ?? '').trim()) {
    throw new Error(`fixed_yield_provider_operation_provider_missing:${operationId}`);
  }
  const qualityGateOperationId = raw.qualityGateOperationId === null || raw.qualityGateOperationId === undefined
    ? raw.qualityGateOperationId
    : text(raw.qualityGateOperationId, 'quality_gate_operation_id');
  if (raw.activation === 'on_quality_failure' && (!qualityGateOperationId
    || !['conditional_repair', 'repair_quality'].includes(raw.role))) {
    throw new Error(`fixed_yield_conditional_operation_invalid:${operationId}`);
  }
  if (FIXED_YIELD_QUALITY_ROLES.has(raw.role)) {
    if (String(request.qaProfileId ?? '').trim() !== String(raw.executor ?? '').trim()
      || !String(request.thresholdsVersion ?? '').trim()) {
      throw new Error(`fixed_yield_quality_identity_not_frozen:${operationId}`);
    }
  }
  return {
    operationId,
    shotId: raw.shotId ? text(raw.shotId, 'shot_id') : null,
    role: raw.role,
    executor: text(raw.executor, 'executor'),
    executionKind,
    provider: raw.provider ? text(raw.provider, 'provider') : null,
    dependsOn: [...new Set(raw.dependsOn.map(item => text(item, 'dependency')))].sort(),
    activation: raw.activation,
    request,
    maxCostFen,
    ...(qualityGateOperationId === undefined ? {} : { qualityGateOperationId }),
  };
}

function planIssues(core: FixedYieldProductionPlanCore): string[] {
  const issues: string[] = [];
  if (!core.timeline.ready) issues.push('timeline_not_ready');
  if (core.readinessSnapshot.capabilityMapVersion !== core.timeline.capabilityMapVersion) issues.push('capability_version_mismatch');
  issues.push(...fixedYieldRuntimeSnapshotIssues(core.readinessSnapshot, core.readinessSnapshot.checkedAt));
  const byId = new Map(core.operations.map(operation => [operation.operationId, operation]));
  if (byId.size !== core.operations.length) issues.push('operation_id_duplicate');
  for (const operation of core.operations) {
    for (const dependency of operation.dependsOn) if (!byId.has(dependency)) issues.push(`dependency_missing:${operation.operationId}:${dependency}`);
    if (operation.qualityGateOperationId && !operation.dependsOn.includes(operation.qualityGateOperationId)) {
      issues.push(`conditional_quality_dependency_missing:${operation.operationId}`);
    }
    if (operation.role === 'shot_finalize' || operation.role === 'content_finalize') {
      const initialQualityGateOperationId = String(operation.request.initialQualityGateOperationId ?? '').trim();
      if (!initialQualityGateOperationId || !operation.dependsOn.includes(initialQualityGateOperationId)) {
        issues.push(`finalize_quality_gate_missing:${operation.operationId}`);
      }
      if (operation.request.deliverableSelector !== 'accepted_quality_output_only') {
        issues.push(`finalize_selector_invalid:${operation.operationId}`);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) { issues.push(`operation_cycle:${id}`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    byId.get(id)?.dependsOn.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  core.operations.forEach(operation => visit(operation.operationId));
  const count = (role: FixedYieldOperationRole) => core.operations.filter(operation => operation.role === role).length;
  if (count('timeline_assembly') !== 1) issues.push('timeline_assembly_count_invalid');
  if (count('whole_video_quality') !== 1) issues.push('whole_video_quality_count_invalid');
  if (count('content_finalize') !== 1) issues.push('content_finalize_count_invalid');
  if (byId.get(core.finalOutputOperationId)?.role !== 'content_finalize') issues.push('final_output_operation_invalid');
  const ancestors = new Set<string>();
  const collect = (id: string): void => {
    if (ancestors.has(id)) return;
    ancestors.add(id);
    byId.get(id)?.dependsOn.forEach(collect);
  };
  collect(core.finalOutputOperationId);
  for (const operation of core.operations) {
    if (!ancestors.has(operation.operationId)) issues.push(`operation_not_in_final_lineage:${operation.operationId}`);
  }
  const reserved = core.operations.reduce((sum, operation) => sum + operation.maxCostFen, 0);
  if (reserved !== core.totalReservedCostFen) issues.push('reserved_cost_mismatch');
  if (core.timeline.shots.length > Math.min(...Object.values(FIXED_YIELD_CAPABILITY_MAP).map(path => path.maximumTimelineShots))) {
    issues.push('timeline_shot_limit_exceeded');
  }
  for (const shot of core.timeline.shots) {
    const operationCount = core.operations.filter(operation => operation.shotId === shot.timelineShotId).length;
    if (operationCount > FIXED_YIELD_CAPABILITY_MAP[shot.pathId].maximumOperationsPerShot) {
      issues.push(`shot_operation_limit_exceeded:${shot.timelineShotId}`);
    }
    if (shot.productRef !== core.timeline.productRef) issues.push(`shot_product_identity_mismatch:${shot.timelineShotId}`);
    if ((shot.pathId === 'P2_PRODUCT_REAL' || shot.pathId === 'P4_CONSUMER_REAL' || shot.archetypeId === 'P1F_REAL_PRODUCT_CONTACT')
      && !shot.productRef) issues.push(`shot_product_identity_missing:${shot.timelineShotId}`);
  }
  return [...new Set(issues)];
}

/** Freezes a zero-side-effect draft. No provider call or budget mutation occurs here. */
export function freezeFixedYieldProductionPlan(input: {
  runId: string;
  createdAt: string;
  core: Omit<FixedYieldProductionPlanCore, 'schemaVersion'>;
}): FixedYieldProductionPlan {
  const runId = text(input.runId, 'run_id');
  const createdAt = new Date(input.createdAt).toISOString();
  const operations = input.core.operations.map(normalizeOperation).sort((left, right) => left.operationId.localeCompare(right.operationId));
  const core: FixedYieldProductionPlanCore = {
    schemaVersion: FIXED_YIELD_PRODUCTION_PLAN_VERSION,
    ...input.core,
    tenantId: text(input.core.tenantId, 'tenant_id'),
    projectId: text(input.core.projectId, 'project_id'),
    operations,
    finalOutputOperationId: text(input.core.finalOutputOperationId, 'final_output_operation_id'),
    totalReservedCostFen: integer(input.core.totalReservedCostFen, 'total_reserved_cost'),
  };
  const issues = planIssues(core);
  if (issues.length) throw new Error(`fixed_yield_plan_invalid:${issues.join(',')}`);
  const coreHash = fixedYieldSha256(core);
  const frozen = operations.map((operation): FixedYieldFrozenOperation => {
    const requestHash = fixedYieldSha256({ role: operation.role, executor: operation.executor, request: operation.request });
    const operationIdentityHash = fixedYieldSha256({ coreHash, operationId: operation.operationId, dependsOn: operation.dependsOn, requestHash });
    return {
      ...operation,
      requestHash,
      operationIdentityHash,
      idempotencyKey: fixedYieldSha256({ version: FIXED_YIELD_PRODUCTION_PLAN_VERSION, runId, operationIdentityHash }),
    };
  });
  const planHash = fixedYieldSha256({ runId, coreHash, operations: frozen.map(operation => ({
    operationId: operation.operationId,
    operationIdentityHash: operation.operationIdentityHash,
    idempotencyKey: operation.idempotencyKey,
  })) });
  const { operations: _operations, ...coreWithoutOperations } = core;
  return { schemaVersion: FIXED_YIELD_PRODUCTION_PLAN_VERSION, runId, createdAt, coreHash, planHash,
    core: coreWithoutOperations, operations: frozen };
}

/** Rehydrates a persisted plan through the same deterministic freezer that
 * created it, then verifies every identity layer before any budget or runtime
 * side effect is allowed. The returned value is the canonical normalized plan;
 * callers must use it instead of continuing with the untrusted input object. */
export function assertAndNormalizeFixedYieldProductionPlan(value: unknown): FixedYieldProductionPlan {
  const plan = plainRecord(value, 'persisted_shape') as unknown as FixedYieldProductionPlan;
  if (plan.schemaVersion !== FIXED_YIELD_PRODUCTION_PLAN_VERSION) {
    throw new Error('fixed_yield_plan_schema_invalid');
  }
  const core = plainRecord(plan.core, 'persisted_core') as unknown as FixedYieldProductionPlan['core'];
  plainRecord(core.timeline, 'persisted_timeline');
  plainRecord(core.readinessSnapshot, 'persisted_readiness');
  plainRecord(core.readinessSnapshot.states, 'persisted_readiness_states');
  if (core.schemaVersion !== FIXED_YIELD_PRODUCTION_PLAN_VERSION
    || !Array.isArray(core.timeline.shots) || !Array.isArray(plan.operations)) {
    throw new Error('fixed_yield_plan_persisted_shape_invalid');
  }
  const draftOperations = plan.operations.map((operation): FixedYieldOperationDraft => {
    const raw = plainRecord(operation, 'persisted_operation') as unknown as FixedYieldFrozenOperation;
    return {
      operationId: raw.operationId,
      shotId: raw.shotId,
      role: raw.role,
      executor: raw.executor,
      executionKind: raw.executionKind,
      provider: raw.provider,
      dependsOn: raw.dependsOn,
      activation: raw.activation,
      ...(raw.qualityGateOperationId === undefined ? {} : { qualityGateOperationId: raw.qualityGateOperationId }),
      request: raw.request,
      maxCostFen: raw.maxCostFen,
    };
  });
  const normalized = freezeFixedYieldProductionPlan({
    runId: plan.runId,
    createdAt: plan.createdAt,
    core: {
      tenantId: core.tenantId,
      projectId: core.projectId,
      timeline: core.timeline,
      readinessSnapshot: core.readinessSnapshot,
      operations: draftOperations,
      finalOutputOperationId: core.finalOutputOperationId,
      totalReservedCostFen: core.totalReservedCostFen,
    },
  });
  if (!SHA256_PATTERN.test(String(plan.coreHash ?? '')) || plan.coreHash !== normalized.coreHash) {
    throw new Error('fixed_yield_plan_core_hash_invalid');
  }
  const persistedById = new Map(plan.operations.map(operation => [operation.operationId, operation]));
  if (persistedById.size !== plan.operations.length || normalized.operations.length !== plan.operations.length) {
    throw new Error('fixed_yield_plan_operation_identity_set_invalid');
  }
  for (const operation of normalized.operations) {
    const persisted = persistedById.get(operation.operationId);
    if (!persisted) throw new Error(`fixed_yield_plan_operation_identity_missing:${operation.operationId}`);
    if (!SHA256_PATTERN.test(String(persisted.requestHash ?? '')) || persisted.requestHash !== operation.requestHash) {
      throw new Error(`fixed_yield_plan_request_hash_invalid:${operation.operationId}`);
    }
    if (!SHA256_PATTERN.test(String(persisted.operationIdentityHash ?? ''))
      || persisted.operationIdentityHash !== operation.operationIdentityHash) {
      throw new Error(`fixed_yield_plan_operation_identity_hash_invalid:${operation.operationId}`);
    }
    if (!SHA256_PATTERN.test(String(persisted.idempotencyKey ?? ''))
      || persisted.idempotencyKey !== operation.idempotencyKey) {
      throw new Error(`fixed_yield_plan_idempotency_key_invalid:${operation.operationId}`);
    }
  }
  if (!SHA256_PATTERN.test(String(plan.planHash ?? '')) || plan.planHash !== normalized.planHash) {
    throw new Error('fixed_yield_plan_hash_invalid');
  }
  return normalized;
}

const LEGAL_TRANSITIONS: Record<FixedYieldOperationState, FixedYieldOperationState[]> = {
  planned: ['ready', 'failed_terminal', 'blocked_input', 'skipped', 'cancelled'],
  ready: ['running', 'failed_terminal', 'skipped', 'cancelled'],
  running: ['provider_pending', 'reconciling', 'succeeded', 'failed_retryable', 'failed_terminal', 'cancelled'],
  provider_pending: ['reconciling', 'succeeded', 'failed_retryable', 'failed_terminal', 'cancelled'],
  reconciling: ['provider_pending', 'succeeded', 'failed_retryable', 'failed_terminal', 'cancelled'],
  succeeded: [], failed_retryable: ['ready', 'reconciling', 'failed_terminal', 'cancelled'],
  failed_terminal: [], blocked_input: ['ready', 'failed_terminal', 'cancelled'], skipped: [], cancelled: [],
};

export function assertFixedYieldOperationTransition(from: FixedYieldOperationState, to: FixedYieldOperationState): void {
  if (!LEGAL_TRANSITIONS[from].includes(to)) throw new Error(`fixed_yield_operation_transition_invalid:${from}:${to}`);
}

export function validateFixedYieldOperationReceipt(
  operation: FixedYieldFrozenOperation,
  receipt: FixedYieldOperationReceipt,
): string[] {
  const issues: string[] = [];
  if (receipt.operationId !== operation.operationId || receipt.idempotencyKey !== operation.idempotencyKey) issues.push('receipt_identity_mismatch');
  if (!Number.isSafeInteger(receipt.reservedCostFen) || !Number.isSafeInteger(receipt.settledCostFen)
    || receipt.reservedCostFen < 0 || receipt.settledCostFen < 0) issues.push('receipt_cost_invalid');
  if (receipt.reservedCostFen > operation.maxCostFen || receipt.settledCostFen > receipt.reservedCostFen) issues.push('receipt_cost_exceeds_reservation');
  if (receipt.state === 'skipped' && (receipt.outputRefs.length || receipt.providerReceiptId || receipt.settledCostFen)) issues.push('skipped_receipt_has_side_effect');
  if (operation.executionKind === 'local' && (receipt.providerReceiptId || receipt.reservedCostFen || receipt.settledCostFen)) issues.push('local_receipt_has_provider_billing');
  if (operation.executionKind === 'provider' && receipt.state === 'succeeded' && !receipt.providerReceiptId) issues.push('provider_receipt_missing');
  if (receipt.state === 'succeeded' && !receipt.outputRefs.length) issues.push('successful_receipt_output_missing');
  if ((receipt.state === 'failed_retryable' || receipt.state === 'failed_terminal') !== Boolean(receipt.failure)) issues.push('receipt_failure_shape_invalid');
  return [...new Set(issues)];
}
