import {
  assertAndNormalizeFixedYieldProductionPlan,
  assertFixedYieldOperationTransition,
  type FixedYieldOperationState,
  type FixedYieldProductionPlan,
  type ProductionFailure,
} from './contracts/fixedYieldProduction.js';
import {
  assertFixedYieldQualityDecision,
  sealFixedYieldQualityDecision,
  type FixedYieldQualityDecision,
} from './contracts/fixedYieldQuality.js';

export interface FixedYieldOperationRuntimeState {
  operationId: string;
  state: FixedYieldOperationState;
  attempt: number;
  updatedAt: string;
  failure: ProductionFailure | null;
  /** SHA-256 of the immutable output bytes or canonical decision emitted by this operation. */
  outputSha256: string | null;
  /** SHA-256 of the immutable provider/local execution receipt, when the receipt is the QA subject. */
  receiptSha256: string | null;
  /** Canonical QA decision. Required only when a quality operation succeeds. */
  qualityDecision: FixedYieldQualityDecision | null;
}

export interface FixedYieldRunState {
  schemaVersion: 'fixed-yield-run-state.v2';
  runId: string;
  planHash: string;
  operations: Record<string, FixedYieldOperationRuntimeState>;
}

const FIXED_YIELD_OPERATION_STATES = new Set<FixedYieldOperationState>([
  'planned', 'ready', 'running', 'provider_pending', 'reconciling', 'succeeded',
  'failed_retryable', 'failed_terminal', 'blocked_input', 'skipped', 'cancelled',
]);
const FAILURE_CATEGORIES = new Set<ProductionFailure['category']>([
  'input', 'authorization', 'quota', 'provider', 'quality', 'infrastructure', 'cancelled',
]);
const FAILURE_RETRYABILITIES = new Set<ProductionFailure['retryability']>([
  'automatic', 'after_reconciliation', 'after_input', 'never',
]);
const FAILURE_RESPONSIBLE_PARTIES = new Set<ProductionFailure['responsibleParty']>([
  'system', 'provider', 'administrator', 'user',
]);
const FAILURE_STATES = new Set<FixedYieldOperationState>([
  'failed_retryable', 'failed_terminal', 'blocked_input',
]);
const QUALITY_ROLES = new Set<FixedYieldProductionPlan['operations'][number]['role']>([
  'shot_quality', 'repair_quality', 'whole_video_quality',
]);
const FINALIZE_ROLES = new Set<FixedYieldProductionPlan['operations'][number]['role']>([
  'shot_finalize', 'content_finalize',
]);
const DEPENDENCY_BOUND_STATES = new Set<FixedYieldOperationState>([
  'ready', 'running', 'provider_pending', 'reconciling', 'succeeded',
  'failed_retryable', 'blocked_input', 'skipped',
]);
const CONDITIONAL_ACTIVE_STATES = new Set<FixedYieldOperationState>([
  'ready', 'running', 'provider_pending', 'reconciling', 'succeeded',
  'failed_retryable', 'blocked_input',
]);
const TERMINAL_PROPAGATION_STATES = new Set<FixedYieldOperationState>([
  'planned', 'ready', 'running', 'provider_pending', 'reconciling',
  'failed_retryable', 'blocked_input',
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizedRequiredText(value: unknown, code: string): string {
  if (typeof value !== 'string') throw new Error(code);
  const normalized = value.normalize('NFKC').trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function normalizedTimestamp(value: unknown, code: string): string {
  const normalized = normalizedRequiredText(value, code);
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) throw new Error(code);
  return new Date(milliseconds).toISOString();
}

function normalizedFailure(value: unknown, state: FixedYieldOperationState): ProductionFailure | null {
  const failureExpected = FAILURE_STATES.has(state);
  if (value === null) {
    if (failureExpected) throw new Error('fixed_yield_runtime_failure_shape_invalid');
    return null;
  }
  if (!failureExpected) throw new Error('fixed_yield_runtime_failure_shape_invalid');
  const source = record(value);
  if (!source || source.schemaVersion !== 'production-failure.v2') {
    throw new Error('fixed_yield_runtime_failure_schema_invalid');
  }
  const code = normalizedRequiredText(source.code, 'fixed_yield_runtime_failure_code_invalid');
  const category = source.category as ProductionFailure['category'];
  const retryability = source.retryability as ProductionFailure['retryability'];
  const responsibleParty = source.responsibleParty as ProductionFailure['responsibleParty'];
  if (!FAILURE_CATEGORIES.has(category)) throw new Error('fixed_yield_runtime_failure_category_invalid');
  if (!FAILURE_RETRYABILITIES.has(retryability)) throw new Error('fixed_yield_runtime_failure_retryability_invalid');
  if (!FAILURE_RESPONSIBLE_PARTIES.has(responsibleParty)) {
    throw new Error('fixed_yield_runtime_failure_responsible_party_invalid');
  }
  if (!Array.isArray(source.evidenceRefs) || source.evidenceRefs.some(item => typeof item !== 'string')) {
    throw new Error('fixed_yield_runtime_failure_evidence_invalid');
  }
  const evidenceRefs = [...new Set(source.evidenceRefs.map(item => item.normalize('NFKC').trim()).filter(Boolean))];
  if (state === 'blocked_input' && retryability !== 'after_input') {
    throw new Error('fixed_yield_runtime_blocked_input_invalid');
  }
  if (state === 'failed_retryable' && !['automatic', 'after_reconciliation'].includes(retryability)) {
    throw new Error('fixed_yield_runtime_retryable_failure_invalid');
  }
  if (state === 'failed_terminal' && retryability !== 'never') {
    throw new Error('fixed_yield_runtime_terminal_failure_invalid');
  }
  return {
    schemaVersion: 'production-failure.v2',
    code,
    category,
    retryability,
    responsibleParty,
    message: normalizedRequiredText(source.message, 'fixed_yield_runtime_failure_message_invalid'),
    evidenceRefs,
    occurredAt: normalizedTimestamp(source.occurredAt, 'fixed_yield_runtime_failure_timestamp_invalid'),
  };
}

function normalizedOperationRuntimeState(
  operationId: string,
  value: unknown,
): FixedYieldOperationRuntimeState {
  const source = record(value);
  if (!source) throw new Error(`fixed_yield_runtime_operation_state_invalid:${operationId}`);
  if (source.operationId !== operationId) {
    throw new Error(`fixed_yield_runtime_operation_id_mismatch:${operationId}`);
  }
  if (!FIXED_YIELD_OPERATION_STATES.has(source.state as FixedYieldOperationState)) {
    throw new Error(`fixed_yield_runtime_operation_state_invalid:${operationId}`);
  }
  const state = source.state as FixedYieldOperationState;
  if (!Number.isSafeInteger(source.attempt) || Number(source.attempt) < 0) {
    throw new Error(`fixed_yield_runtime_attempt_invalid:${operationId}`);
  }
  if (!Object.hasOwn(source, 'failure') || !Object.hasOwn(source, 'outputSha256')
    || !Object.hasOwn(source, 'receiptSha256') || !Object.hasOwn(source, 'qualityDecision')) {
    throw new Error(`fixed_yield_runtime_operation_shape_invalid:${operationId}`);
  }
  if (source.outputSha256 !== null && typeof source.outputSha256 !== 'string') {
    throw new Error('fixed_yield_runtime_output_sha_invalid');
  }
  if (source.receiptSha256 !== null && typeof source.receiptSha256 !== 'string') {
    throw new Error('fixed_yield_runtime_receipt_sha_invalid');
  }
  const outputSha256 = normalizeEvidenceSha(source.outputSha256 as string | null, 'output');
  const receiptSha256 = normalizeEvidenceSha(source.receiptSha256 as string | null, 'receipt');
  if (state !== 'succeeded' && (outputSha256 || receiptSha256)) {
    throw new Error(`fixed_yield_runtime_evidence_state_invalid:${operationId}`);
  }
  if (state === 'succeeded' && !outputSha256 && !receiptSha256) {
    throw new Error(`fixed_yield_runtime_success_evidence_missing:${operationId}`);
  }
  let qualityDecision: FixedYieldQualityDecision | null = null;
  if (source.qualityDecision !== null) {
    assertFixedYieldQualityDecision(source.qualityDecision);
    qualityDecision = sealFixedYieldQualityDecision(source.qualityDecision.core);
    if (state !== 'succeeded') {
      throw new Error(`fixed_yield_runtime_quality_decision_state_invalid:${operationId}`);
    }
  }
  return {
    operationId,
    state,
    attempt: Number(source.attempt),
    updatedAt: normalizedTimestamp(source.updatedAt, `fixed_yield_runtime_timestamp_invalid:${operationId}`),
    failure: normalizedFailure(source.failure, state),
    outputSha256,
    receiptSha256,
    qualityDecision,
  };
}

/**
 * Treats persisted runtime state as untrusted input and binds it back to the
 * immutable production plan. Missing or injected operations fail closed so a
 * corrupted ledger cannot leave work silently stuck in `planned` forever.
 */
function normalizeFixedYieldRunStateShape(
  planInput: FixedYieldProductionPlan,
  stateInput: unknown,
): FixedYieldRunState {
  const plan = assertAndNormalizeFixedYieldProductionPlan(planInput);
  const source = record(stateInput);
  if (!source || source.schemaVersion !== 'fixed-yield-run-state.v2') {
    throw new Error('fixed_yield_runtime_schema_invalid');
  }
  if (source.runId !== plan.runId) throw new Error('fixed_yield_runtime_run_changed');
  if (source.planHash !== plan.planHash) throw new Error('fixed_yield_runtime_plan_changed');
  const persistedOperations = record(source.operations);
  if (!persistedOperations) throw new Error('fixed_yield_runtime_operations_invalid');
  const plannedIds = new Set(plan.operations.map(operation => operation.operationId));
  const persistedIds = Object.keys(persistedOperations);
  if (persistedIds.length !== plannedIds.size || persistedIds.some(operationId => !plannedIds.has(operationId))) {
    throw new Error('fixed_yield_runtime_operation_set_invalid');
  }
  const operations: Record<string, FixedYieldOperationRuntimeState> = {};
  for (const operation of plan.operations) {
    if (!Object.hasOwn(persistedOperations, operation.operationId)) {
      throw new Error(`fixed_yield_runtime_operation_missing:${operation.operationId}`);
    }
    operations[operation.operationId] = normalizedOperationRuntimeState(
      operation.operationId,
      persistedOperations[operation.operationId],
    );
  }
  return {
    schemaVersion: 'fixed-yield-run-state.v2',
    runId: plan.runId,
    planHash: plan.planHash,
    operations,
  };
}

export function assertAndNormalizeFixedYieldRunState(
  planInput: FixedYieldProductionPlan,
  stateInput: unknown,
): FixedYieldRunState {
  const plan = assertAndNormalizeFixedYieldProductionPlan(planInput);
  const state = normalizeFixedYieldRunStateShape(plan, stateInput);
  assertCrossOperationConsistency(plan, state);
  return state;
}

export function createFixedYieldRunState(plan: FixedYieldProductionPlan, now: string): FixedYieldRunState {
  const normalizedPlan = assertAndNormalizeFixedYieldProductionPlan(plan);
  const updatedAt = new Date(now).toISOString();
  const state: FixedYieldRunState = { schemaVersion: 'fixed-yield-run-state.v2', runId: normalizedPlan.runId, planHash: normalizedPlan.planHash,
    operations: Object.fromEntries(normalizedPlan.operations.map(operation => [operation.operationId, {
      operationId: operation.operationId, state: 'planned' as const, attempt: 0, updatedAt, failure: null,
      outputSha256: null, receiptSha256: null, qualityDecision: null,
    }])) };
  return assertAndNormalizeFixedYieldRunState(normalizedPlan, state);
}

function applyFixedYieldOperationTransition(input: {
  state: FixedYieldRunState;
  operationId: string;
  to: FixedYieldOperationState;
  now: string;
  failure?: ProductionFailure | null;
  outputSha256?: string | null;
  receiptSha256?: string | null;
  qualityDecision?: FixedYieldQualityDecision | null;
}): FixedYieldRunState {
  const currentValue = input.state.operations[input.operationId];
  const current = currentValue
    ? normalizedOperationRuntimeState(input.operationId, currentValue)
    : undefined;
  if (!current) throw new Error('fixed_yield_runtime_operation_missing');
  assertFixedYieldOperationTransition(current.state, input.to);
  const failure = normalizedFailure(input.failure ?? null, input.to);
  const outputSha256 = normalizeEvidenceSha(input.outputSha256, 'output');
  const receiptSha256 = normalizeEvidenceSha(input.receiptSha256, 'receipt');
  if (input.to !== 'succeeded' && (outputSha256 || receiptSha256)) {
    throw new Error('fixed_yield_runtime_evidence_state_invalid');
  }
  if (input.to === 'succeeded' && !outputSha256 && !receiptSha256) {
    throw new Error('fixed_yield_runtime_success_evidence_missing');
  }
  const qualityDecision = input.qualityDecision ?? null;
  if (qualityDecision) assertFixedYieldQualityDecision(qualityDecision);
  const transitioned = normalizedOperationRuntimeState(input.operationId, {
    ...current, state: input.to, attempt: input.to === 'running' ? current.attempt + 1 : current.attempt,
    updatedAt: new Date(input.now).toISOString(), failure,
    outputSha256: input.to === 'succeeded' ? outputSha256 : null,
    receiptSha256: input.to === 'succeeded' ? receiptSha256 : null,
    qualityDecision: input.to === 'succeeded' ? qualityDecision : null,
  });
  return { ...input.state, operations: { ...input.state.operations, [input.operationId]: transitioned } };
}

/**
 * Applies an executor/provider state update against the canonical plan and the
 * entire persisted ledger. Conditional branches and finalize nodes are released
 * only by reconcileFixedYieldRunState; a caller cannot forge their ready state.
 */
export function transitionFixedYieldOperationState(input: {
  plan: FixedYieldProductionPlan;
  state: FixedYieldRunState;
  operationId: string;
  to: FixedYieldOperationState;
  now: string;
  failure?: ProductionFailure | null;
  outputSha256?: string | null;
  receiptSha256?: string | null;
  qualityDecision?: FixedYieldQualityDecision | null;
}): FixedYieldRunState {
  const plan = assertAndNormalizeFixedYieldProductionPlan(input.plan);
  const state = assertAndNormalizeFixedYieldRunState(plan, input.state);
  const operation = plan.operations.find(item => item.operationId === input.operationId);
  if (!operation) throw new Error('fixed_yield_runtime_operation_missing');
  const current = state.operations[input.operationId];
  if (!current) throw new Error('fixed_yield_runtime_operation_missing');
  if (current.state === 'planned' && input.to === 'ready'
    && (operation.activation === 'on_quality_failure' || FINALIZE_ROLES.has(operation.role))) {
    throw new Error(`fixed_yield_runtime_reconcile_required:${operation.operationId}`);
  }
  if (current.state === 'planned' && input.to === 'skipped' && operation.activation === 'on_quality_failure') {
    throw new Error(`fixed_yield_runtime_reconcile_required:${operation.operationId}`);
  }
  if (input.to === 'failed_terminal' && FINALIZE_ROLES.has(operation.role)
    && current.state === 'planned') {
    throw new Error(`fixed_yield_runtime_reconcile_required:${operation.operationId}`);
  }
  if (input.to === 'succeeded' && QUALITY_ROLES.has(operation.role) && !input.qualityDecision) {
    throw new Error(`fixed_yield_runtime_quality_decision_missing:${operation.operationId}`);
  }
  if (input.qualityDecision && !QUALITY_ROLES.has(operation.role)) {
    throw new Error(`fixed_yield_runtime_quality_decision_operation_invalid:${operation.operationId}`);
  }
  if (input.qualityDecision && input.to !== 'succeeded') {
    throw new Error(`fixed_yield_runtime_quality_decision_state_invalid:${operation.operationId}`);
  }
  const next = applyFixedYieldOperationTransition({
    state,
    operationId: input.operationId,
    to: input.to,
    now: input.now,
    failure: input.failure,
    outputSha256: input.outputSha256,
    receiptSha256: input.receiptSha256,
    qualityDecision: input.qualityDecision,
  });
  return assertAndNormalizeFixedYieldRunState(plan, next);
}

function normalizeEvidenceSha(value: string | null | undefined, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).normalize('NFKC').trim();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`fixed_yield_runtime_${label}_sha_invalid`);
  return normalized;
}

function dependencyComplete(value: FixedYieldOperationRuntimeState | undefined): boolean {
  return value?.state === 'succeeded' || value?.state === 'skipped';
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(item => String(item ?? '').trim()).filter(Boolean))] : [];
}

function qualityFailureIsRepairable(
  operation: FixedYieldProductionPlan['operations'][number],
  decision: FixedYieldQualityDecision,
): boolean {
  const allowed = new Set(stringList(operation.request.repairableFailureCodes));
  return decision.core.verdict === 'rejected' && decision.core.failureCodes.length > 0
    && decision.core.failureCodes.every(code => allowed.has(code));
}

function qualitySubjectOperationId(
  operation: FixedYieldProductionPlan['operations'][number],
): string {
  const explicit = String(operation.request.sourceOperationId ?? '').normalize('NFKC').trim();
  if (explicit) {
    if (!operation.dependsOn.includes(explicit)) throw new Error('fixed_yield_quality_subject_dependency_invalid');
    return explicit;
  }
  if (operation.dependsOn.length !== 1) throw new Error('fixed_yield_quality_subject_operation_ambiguous');
  return operation.dependsOn[0]!;
}

/** Validates the decision persisted by the QA operation against its frozen
 * profile, threshold version and immutable subject evidence. */
function validatePersistedQualityDecision(input: {
  plan: FixedYieldProductionPlan;
  state: FixedYieldRunState;
  qualityOperationId: string;
}): FixedYieldQualityDecision | undefined {
  const qualityOperation = input.plan.operations.find(item => item.operationId === input.qualityOperationId);
  if (!qualityOperation || !['shot_quality', 'repair_quality', 'whole_video_quality'].includes(qualityOperation.role)) {
    throw new Error('fixed_yield_quality_operation_invalid');
  }
  const qualityState = input.state.operations[input.qualityOperationId];
  if (qualityState?.state !== 'succeeded') return undefined;
  const decision = qualityState.qualityDecision;
  if (!decision) throw new Error('fixed_yield_quality_decision_missing');
  assertFixedYieldQualityDecision(decision);
  if (qualityState?.state !== 'succeeded') throw new Error('fixed_yield_quality_operation_not_succeeded');
  if (![qualityState.outputSha256, qualityState.receiptSha256].includes(decision.decisionHash)) {
    throw new Error('fixed_yield_quality_decision_evidence_mismatch');
  }
  const subjectOperationId = qualitySubjectOperationId(qualityOperation);
  if (decision.core.subjectOperationId !== subjectOperationId) throw new Error('fixed_yield_quality_subject_operation_mismatch');
  const frozenQaProfileId = String(qualityOperation.request.qaProfileId ?? '').normalize('NFKC').trim();
  const frozenThresholdsVersion = String(qualityOperation.request.thresholdsVersion ?? '').normalize('NFKC').trim();
  if (!frozenQaProfileId || !frozenThresholdsVersion || frozenQaProfileId !== qualityOperation.executor) {
    throw new Error('fixed_yield_quality_frozen_identity_invalid');
  }
  if (decision.core.qaProfileId !== frozenQaProfileId) throw new Error('fixed_yield_quality_profile_mismatch');
  if (decision.core.thresholdsVersion !== frozenThresholdsVersion) {
    throw new Error('fixed_yield_quality_thresholds_version_mismatch');
  }
  const subjectState = input.state.operations[subjectOperationId];
  if (subjectState?.state !== 'succeeded') throw new Error('fixed_yield_quality_subject_not_succeeded');
  const subjectEvidence = [subjectState.outputSha256, subjectState.receiptSha256].filter(Boolean);
  if (!subjectEvidence.length) throw new Error('fixed_yield_quality_subject_evidence_missing');
  if (!subjectEvidence.includes(decision.core.subjectSha256)) throw new Error('fixed_yield_quality_subject_hash_mismatch');
  return decision;
}

/** A caller may supply its copy for request-level integrity checking, but the
 * persisted decision remains the only decision that can release downstream work. */
function validatedQualityDecision(input: {
  plan: FixedYieldProductionPlan;
  state: FixedYieldRunState;
  qualityDecisions: Record<string, FixedYieldQualityDecision>;
  qualityOperationId: string;
}): FixedYieldQualityDecision | undefined {
  const persisted = validatePersistedQualityDecision(input);
  const supplied = input.qualityDecisions[input.qualityOperationId];
  if (!supplied) return persisted;
  assertFixedYieldQualityDecision(supplied);
  if (!persisted || supplied.decisionHash !== persisted.decisionHash) {
    throw new Error('fixed_yield_quality_decision_evidence_mismatch');
  }
  return persisted;
}

function acceptedFinalizeDecision(
  plan: FixedYieldProductionPlan,
  state: FixedYieldRunState,
  operation: FixedYieldProductionPlan['operations'][number],
): boolean {
  const initialId = String(operation.request.initialQualityGateOperationId ?? '').normalize('NFKC').trim();
  const repairId = String(operation.request.repairQualityGateOperationId ?? '').normalize('NFKC').trim();
  const initial = initialId ? validatePersistedQualityDecision({ plan, state, qualityOperationId: initialId }) : undefined;
  const repair = repairId ? validatePersistedQualityDecision({ plan, state, qualityOperationId: repairId }) : undefined;
  return initial?.core.verdict === 'accepted' || repair?.core.verdict === 'accepted';
}

function assertCrossOperationConsistency(
  plan: FixedYieldProductionPlan,
  state: FixedYieldRunState,
): void {
  for (const operation of plan.operations) {
    const runtime = state.operations[operation.operationId];
    if (!runtime) throw new Error(`fixed_yield_runtime_operation_missing:${operation.operationId}`);
    const qualityRole = QUALITY_ROLES.has(operation.role);
    if (runtime.qualityDecision && !qualityRole) {
      throw new Error(`fixed_yield_runtime_quality_decision_operation_invalid:${operation.operationId}`);
    }
    if (qualityRole && runtime.state === 'succeeded') {
      validatePersistedQualityDecision({ plan, state, qualityOperationId: operation.operationId });
    } else if (runtime.qualityDecision) {
      throw new Error(`fixed_yield_runtime_quality_decision_state_invalid:${operation.operationId}`);
    }
    if (DEPENDENCY_BOUND_STATES.has(runtime.state)
      && !operation.dependsOn.every(dependency => dependencyComplete(state.operations[dependency]))) {
      throw new Error(`fixed_yield_runtime_dependency_incomplete:${operation.operationId}`);
    }
    if (operation.activation === 'on_quality_failure') {
      const decision = operation.qualityGateOperationId
        ? validatePersistedQualityDecision({ plan, state, qualityOperationId: operation.qualityGateOperationId })
        : undefined;
      if (CONDITIONAL_ACTIVE_STATES.has(runtime.state)
        && (!decision || !qualityFailureIsRepairable(operation, decision))) {
        throw new Error(`fixed_yield_runtime_conditional_activation_invalid:${operation.operationId}`);
      }
      if (runtime.state === 'skipped'
        && (!decision || qualityFailureIsRepairable(operation, decision))) {
        throw new Error(`fixed_yield_runtime_conditional_skip_invalid:${operation.operationId}`);
      }
    }
    if (FINALIZE_ROLES.has(operation.role) && CONDITIONAL_ACTIVE_STATES.has(runtime.state)
      && !acceptedFinalizeDecision(plan, state, operation)) {
      throw new Error(`fixed_yield_runtime_finalize_quality_not_accepted:${operation.operationId}`);
    }
  }
}

function qualityFailure(now: string, decisions: FixedYieldQualityDecision[]): ProductionFailure {
  return {
    schemaVersion: 'production-failure.v2', code: 'fixed_yield_no_accepted_shot_output', category: 'quality',
    retryability: 'never', responsibleParty: 'system', message: '初稿与已冻结的一次返修均未形成通过质检的交付输出',
    evidenceRefs: decisions.map(decision => `quality:${decision.decisionHash}`), occurredAt: new Date(now).toISOString(),
  };
}

function upstreamTerminalFailure(input: {
  now: string;
  operationId: string;
  dependencies: FixedYieldOperationRuntimeState[];
}): ProductionFailure {
  const evidenceRefs = [...new Set(input.dependencies.flatMap(dependency => [
    `operation:${dependency.operationId}:failed_terminal`,
    ...(dependency.failure?.evidenceRefs ?? []),
  ]))];
  return {
    schemaVersion: 'production-failure.v2',
    code: 'fixed_yield_upstream_dependency_failed_terminal',
    category: 'infrastructure',
    retryability: 'never',
    responsibleParty: 'system',
    message: `${input.operationId} 未执行：上游依赖已终止失败`,
    evidenceRefs,
    occurredAt: new Date(input.now).toISOString(),
  };
}

export function reconcileFixedYieldRunState(input: {
  plan: FixedYieldProductionPlan;
  state: FixedYieldRunState;
  qualityDecisions: Record<string, FixedYieldQualityDecision>;
  now: string;
}): FixedYieldRunState {
  const plan = assertAndNormalizeFixedYieldProductionPlan(input.plan);
  let next = normalizeFixedYieldRunStateShape(plan, input.state);
  let changed = true;
  while (changed) {
    changed = false;
    for (const operation of plan.operations) {
      const current = next.operations[operation.operationId];
      if (!current) throw new Error(`fixed_yield_runtime_operation_missing:${operation.operationId}`);
      const dependencies = operation.dependsOn.map(dependency => next.operations[dependency]);
      const terminalDependencies = dependencies.filter((dependency): dependency is FixedYieldOperationRuntimeState =>
        dependency?.state === 'failed_terminal');
      if (terminalDependencies.length && TERMINAL_PROPAGATION_STATES.has(current.state)) {
        next = applyFixedYieldOperationTransition({ state: next, operationId: operation.operationId,
          to: 'failed_terminal', now: input.now,
          failure: upstreamTerminalFailure({ now: input.now, operationId: operation.operationId,
            dependencies: terminalDependencies }) });
        changed = true;
        continue;
      }
      if (dependencies.some(dependency => dependency?.state === 'cancelled')
        && TERMINAL_PROPAGATION_STATES.has(current.state)) {
        next = applyFixedYieldOperationTransition({ state: next, operationId: operation.operationId,
          to: 'cancelled', now: input.now });
        changed = true;
        continue;
      }
      if (current.state !== 'planned') continue;
      if (!operation.dependsOn.every(dependency => dependencyComplete(next.operations[dependency]))) continue;
      if (operation.activation === 'on_quality_failure') {
        const decision = operation.qualityGateOperationId ? validatedQualityDecision({
          plan, state: next, qualityDecisions: input.qualityDecisions,
          qualityOperationId: operation.qualityGateOperationId,
        }) : undefined;
        if (!decision) continue;
        const target = qualityFailureIsRepairable(operation, decision) ? 'ready' : 'skipped';
        next = applyFixedYieldOperationTransition({ state: next, operationId: operation.operationId, to: target, now: input.now });
      } else if (operation.role === 'shot_finalize' || operation.role === 'content_finalize') {
        const initialId = String(operation.request.initialQualityGateOperationId ?? '').trim();
        const repairId = String(operation.request.repairQualityGateOperationId ?? '').trim();
        const initial = initialId ? validatedQualityDecision({ plan, state: next,
          qualityDecisions: input.qualityDecisions, qualityOperationId: initialId }) : undefined;
        const repair = repairId ? validatedQualityDecision({ plan, state: next,
          qualityDecisions: input.qualityDecisions, qualityOperationId: repairId }) : undefined;
        if (!initial) continue;
        if (initial.core.verdict === 'accepted' || repair?.core.verdict === 'accepted') {
          next = applyFixedYieldOperationTransition({ state: next, operationId: operation.operationId, to: 'ready', now: input.now });
        } else {
          const repairOperationId = String(operation.request.conditionalRepairOperationId ?? '').trim();
          const repairOperation = plan.operations.find(item => item.operationId === repairOperationId);
          const repairable = Boolean(repairOperation && qualityFailureIsRepairable(repairOperation, initial));
          if (repairable && !repair) continue;
          next = applyFixedYieldOperationTransition({ state: next, operationId: operation.operationId,
            to: 'failed_terminal', now: input.now, failure: qualityFailure(input.now, [initial, ...(repair ? [repair] : [])]) });
        }
      } else {
        next = applyFixedYieldOperationTransition({ state: next, operationId: operation.operationId, to: 'ready', now: input.now });
      }
      changed = true;
    }
  }
  for (const qualityOperationId of Object.keys(input.qualityDecisions)) {
    if (!plan.operations.some(operation => operation.operationId === qualityOperationId
      && QUALITY_ROLES.has(operation.role))) {
      throw new Error(`fixed_yield_quality_operation_invalid:${qualityOperationId}`);
    }
    validatedQualityDecision({ plan, state: next, qualityDecisions: input.qualityDecisions, qualityOperationId });
  }
  return assertAndNormalizeFixedYieldRunState(plan, next);
}

export function fixedYieldRunProgress(plan: FixedYieldProductionPlan, state: FixedYieldRunState): {
  total: number;
  completed: number;
  running: number;
  waitingForProvider: number;
  blockedForUser: number;
  failed: number;
  percent: number;
} {
  const normalizedPlan = assertAndNormalizeFixedYieldProductionPlan(plan);
  const normalizedState = assertAndNormalizeFixedYieldRunState(normalizedPlan, state);
  const values = Object.values(normalizedState.operations);
  const completed = values.filter(item => item.state === 'succeeded' || item.state === 'skipped').length;
  return { total: values.length, completed,
    running: values.filter(item => item.state === 'running' || item.state === 'reconciling').length,
    waitingForProvider: values.filter(item => item.state === 'provider_pending').length,
    blockedForUser: values.filter(item => item.state === 'blocked_input').length,
    failed: values.filter(item => item.state === 'failed_retryable' || item.state === 'failed_terminal').length,
    percent: values.length ? Math.floor((completed / values.length) * 100) : 0 };
}
