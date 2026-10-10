import { createHash, randomUUID } from 'node:crypto';
import {
  STARTER_AGENT_ROLES,
  type AgentHandoffV1,
  type AgentTaskEnvelopeV1,
  type AgentTaskResultV1,
  type Starter198Capability,
  type StarterAgentRole,
} from '../../shared/contracts/starter198.js';
import {
  STARTER_COLLECTIONS,
  Starter198RepositoryError,
  starter198Repository,
  type Starter198Repository,
  type StarterRecord,
} from './repository.js';
import {
  failStarterUsage,
  reserveStarterUsage,
  settleStarterUsage,
  Starter198UsageLedgerError,
  type StarterUsageActualCost,
  type StarterUsageReservationCost,
  type StarterUsageResourceUnits,
  type StarterUsageTokenMeasurement,
} from './usageLedger.js';

export class Starter198AgentTaskError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'Starter198AgentTaskError';
  }
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const stableHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const taskIdentityHash = (envelope: AgentTaskEnvelopeV1): string => {
  const { budgetReservationId: _reservation, ...identity } = envelope;
  return stableHash(identity);
};
const validId = (value: string): boolean => Boolean(value) && value.length <= 200 && /^[a-z0-9:_-]+$/i.test(value);

function validRole(value: unknown): value is StarterAgentRole {
  return STARTER_AGENT_ROLES.includes(value as StarterAgentRole);
}

function validResult(result: AgentTaskResultV1): boolean {
  return result.schemaVersion === 'starter-198.agent-result.v1'
    && ['succeeded', 'blocked', 'failed', 'cancelled'].includes(result.status)
    && Array.isArray(result.outputs)
    && Array.isArray(result.evidence)
    && Array.isArray(result.missingFacts)
    && Array.isArray(result.risks)
    && typeof result.requiresDecision === 'boolean'
    && (typeof result.suggestedNextAction === 'string' || result.suggestedNextAction === null)
    && Boolean(result.checkpoint && typeof result.checkpoint === 'object' && !Array.isArray(result.checkpoint));
}

export function assertStarterAgentTaskEnvelope(envelope: AgentTaskEnvelopeV1): void {
  if (
    envelope.schemaVersion !== 'starter-198.agent-task.v1'
    || !validId(text(envelope.tenantId))
    || !validId(text(envelope.runId))
    || !validId(text(envelope.taskId))
    || !validId(text(envelope.correlationId))
    || !validId(text(envelope.idempotencyKey))
    || !text(envelope.goal)
    || !text(envelope.factSetVersion)
    || !text(envelope.policyVersion)
    || !text(envelope.entitlementSnapshotId)
    || !text(envelope.expectedOutputSchema)
    || !['L0', 'L1', 'L2', 'L3'].includes(envelope.riskLevel)
    || !Number.isFinite(Date.parse(envelope.deadline))
    || !Array.isArray(envelope.inputObjectRefs)
    || !validRole(envelope.sourceAgent)
    || !validRole(envelope.targetAgent)
  ) throw new Starter198AgentTaskError('starter_agent_task_invalid');
  if (envelope.sourceAgent !== 'orchestrator' || envelope.targetAgent === 'orchestrator') {
    throw new Starter198AgentTaskError('starter_agent_direct_child_command_forbidden');
  }
  if (envelope.inputObjectRefs.some(ref => !text(ref?.type) || !validId(text(ref?.id)))) {
    throw new Starter198AgentTaskError('starter_agent_task_reference_invalid');
  }
}

export function starterAgentTaskEnvelopeFromRecord(record: StarterRecord): AgentTaskEnvelopeV1 | null {
  const value = typeof record.envelope === 'string'
    ? (() => { try { return JSON.parse(record.envelope) as unknown; } catch { return null; } })()
    : record.envelope;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    assertStarterAgentTaskEnvelope(value as AgentTaskEnvelopeV1);
    if (text(record.envelope_hash) !== stableHash(value)) return null;
    return value as AgentTaskEnvelopeV1;
  } catch {
    return null;
  }
}

export async function persistStarterAgentTask(
  envelope: AgentTaskEnvelopeV1,
  repository: Starter198Repository = starter198Repository,
): Promise<{ envelope: AgentTaskEnvelopeV1; created: boolean }> {
  assertStarterAgentTaskEnvelope(envelope);
  const access = await repository.access(envelope.tenantId);
  if (access.entitlementSnapshotId !== envelope.entitlementSnapshotId) {
    throw new Starter198AgentTaskError('starter_agent_entitlement_snapshot_stale');
  }
  const existing = await repository.list(STARTER_COLLECTIONS.agentTasks, envelope.tenantId, {
    where: { idempotency_key: envelope.idempotencyKey }, perPage: 2,
  });
  if (existing.totalItems > 1) throw new Starter198AgentTaskError('starter_agent_task_integrity_violation');
  if (existing.items[0]) {
    const previous = starterAgentTaskEnvelopeFromRecord(existing.items[0]);
    if (!previous) throw new Starter198AgentTaskError('starter_agent_task_integrity_violation');
    if (taskIdentityHash(previous) !== taskIdentityHash(envelope)) throw new Starter198AgentTaskError('starter_agent_task_idempotency_conflict');
    return { envelope: previous, created: false };
  }
  try {
    await repository.create(STARTER_COLLECTIONS.agentTasks, envelope.tenantId, {
      run_id: envelope.runId,
      task_id: envelope.taskId,
      correlation_id: envelope.correlationId,
      idempotency_key: envelope.idempotencyKey,
      source_agent: envelope.sourceAgent,
      target_agent: envelope.targetAgent,
      envelope,
      envelope_hash: stableHash(envelope),
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return { envelope, created: true };
  } catch (error) {
    if (!(error instanceof Starter198RepositoryError)) throw error;
    const raced = await repository.list(STARTER_COLLECTIONS.agentTasks, envelope.tenantId, {
      where: { idempotency_key: envelope.idempotencyKey }, perPage: 2,
    });
    const previous = raced.items.length === 1 ? starterAgentTaskEnvelopeFromRecord(raced.items[0]) : null;
    if (previous && taskIdentityHash(previous) === taskIdentityHash(envelope)) return { envelope: previous, created: false };
    throw new Starter198AgentTaskError(previous
      ? 'starter_agent_task_idempotency_conflict'
      : 'starter_agent_task_storage_unavailable');
  }
}

export interface ApprovedContentPublicationTaskInput {
  tenantId: string;
  runId: string;
  approvalId: string;
  approvalTaskId: string;
  subjectVersion: string;
  contentHash: string;
  /** Deterministic clock injection for replay/tests; production callers omit it. */
  now?: Date;
}

/**
 * Durable, idempotent hand-off from a Starter approval to the traffic agent
 * (灵小量).
 * This task authorizes package generation only; it never authorizes a platform
 * account, a calendar entry, or publication.
 */
export async function enqueueApprovedContentPublicationPackageTask(
  input: ApprovedContentPublicationTaskInput,
  repository: Starter198Repository = starter198Repository,
): Promise<{ taskId: string; created: boolean }> {
  const identity = {
    tenantId: text(input.tenantId),
    runId: text(input.runId),
    approvalId: text(input.approvalId),
    approvalTaskId: text(input.approvalTaskId),
    subjectVersion: text(input.subjectVersion),
    contentHash: text(input.contentHash),
  };
  if (Object.values(identity).some(value => !value)) {
    throw new Starter198AgentTaskError('starter_publication_task_identity_required');
  }
  const access = await repository.access(identity.tenantId);
  const fingerprint = stableHash(identity);
  const taskId = `publication-package:${fingerprint.slice(0, 24)}`;
  const envelope: AgentTaskEnvelopeV1 = {
    schemaVersion: 'starter-198.agent-task.v1',
    tenantId: identity.tenantId,
    runId: identity.runId,
    taskId,
    correlationId: `approval:${fingerprint.slice(0, 24)}`,
    sourceAgent: 'orchestrator',
    targetAgent: 'traffic',
    goal: '灵小量为已批准内容生成自助发布包；不得调用平台账号、创建发布日历或标记已发布。',
    factSetVersion: identity.contentHash,
    policyVersion: access.profileVersion,
    entitlementSnapshotId: access.entitlementSnapshotId,
    inputObjectRefs: [
      { type: 'approval_request', id: identity.approvalId, version: identity.subjectVersion },
      { type: 'workflow_task', id: identity.approvalTaskId, version: identity.subjectVersion },
    ],
    expectedOutputSchema: 'starter-publication-package.v1',
    riskLevel: 'L1',
    deadline: access.cycleEndsAt,
    idempotencyKey: `publication-package:${fingerprint}`,
  };
  const persisted = await persistStarterAgentTask(envelope, repository);
  // Package assembly is deterministic local work: it invokes no model and no
  // publishing provider. Reserve an explicit zero-cost execution slot now so
  // the worker can consume the approval immediately while the ledger still
  // records truthful zero token/cost measurements.
  await meterStarterAgentTaskForExecution({
    tenantId: identity.tenantId,
    taskId: persisted.envelope.taskId,
    capability: 'publishing.package.generate',
    cost: { status: 'known', estimatedCostCny: 0, reservedCostCny: 0 },
    resourceUnits: { contentArtifacts: 0, contentRevisions: 0, inquiryAi: 0 },
    repository,
    now: input.now,
  });
  return { taskId: persisted.envelope.taskId, created: persisted.created };
}

/**
 * Consumer gate: a queued package task becomes executable only after the
 * referenced approval is approved with the exact frozen version and hash.
 * Re-reading is safe; execution must use the envelope idempotency key.
 */
export async function readConsumablePublicationPackageTask(
  tenantId: string,
  taskId: string,
  repository: Starter198Repository = starter198Repository,
): Promise<AgentTaskEnvelopeV1 | null> {
  const tasks = await repository.list(STARTER_COLLECTIONS.agentTasks, tenantId, {
    where: { task_id: taskId }, perPage: 2,
  });
  if (tasks.totalItems > 1) throw new Starter198AgentTaskError('starter_agent_task_integrity_violation');
  const task = tasks.items[0];
  if (!task) return null;
  const envelope = starterAgentTaskEnvelopeFromRecord(task);
  if (!envelope || envelope.expectedOutputSchema !== 'starter-publication-package.v1') return null;
  if (text(task.status) !== 'ready' || !text(task.budget_reservation_id)
    || envelope.budgetReservationId !== text(task.budget_reservation_id)) return null;
  const approvalRef = envelope.inputObjectRefs.find(ref => ref.type === 'approval_request');
  if (!approvalRef) throw new Starter198AgentTaskError('starter_publication_task_approval_missing');
  const approval = await repository.get(STARTER_COLLECTIONS.approvals, tenantId, approvalRef.id);
  if (!approval || text(approval.status) !== 'approved') return null;
  if (text(approvalRef.version) !== String(approval.subject_version ?? '').trim()
    || envelope.factSetVersion !== text(approval.content_hash)) return null;
  return envelope;
}

export function buildStarterAgentHandoff(input: {
  envelope: AgentTaskEnvelopeV1;
  sourceAgent: Exclude<StarterAgentRole, 'orchestrator'>;
  result: AgentTaskResultV1;
  /** A deterministic id makes worker replay converge on one durable handoff. */
  handoffId?: string;
  now?: Date;
}): AgentHandoffV1 {
  assertStarterAgentTaskEnvelope(input.envelope);
  if (input.sourceAgent !== input.envelope.targetAgent || !validResult(input.result)) {
    throw new Starter198AgentTaskError('starter_agent_handoff_invalid');
  }
  const handoffId = text(input.handoffId) || `handoff_${randomUUID().replaceAll('-', '')}`;
  if (!validId(handoffId)) throw new Starter198AgentTaskError('starter_agent_handoff_invalid');
  return {
    schemaVersion: 'starter-198.agent-handoff.v1',
    tenantId: input.envelope.tenantId,
    runId: input.envelope.runId,
    taskId: input.envelope.taskId,
    handoffId,
    correlationId: input.envelope.correlationId,
    sourceAgent: input.sourceAgent,
    targetAgent: 'orchestrator',
    result: input.result,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

export async function persistStarterAgentHandoff(
  handoff: AgentHandoffV1,
  repository: Starter198Repository = starter198Repository,
): Promise<{ created: boolean }> {
  if (
    handoff.schemaVersion !== 'starter-198.agent-handoff.v1'
    || handoff.targetAgent !== 'orchestrator'
    || handoff.sourceAgent === 'orchestrator'
    || !validRole(handoff.sourceAgent)
    || !validResult(handoff.result)
    || !validId(text(handoff.handoffId))
  ) throw new Starter198AgentTaskError('starter_agent_handoff_invalid');
  const tasks = await repository.list(STARTER_COLLECTIONS.agentTasks, handoff.tenantId, {
    where: { task_id: handoff.taskId }, perPage: 2,
  });
  if (tasks.totalItems !== 1 || tasks.items.length !== 1) {
    throw new Starter198AgentTaskError('starter_agent_handoff_task_missing');
  }
  const envelope = starterAgentTaskEnvelopeFromRecord(tasks.items[0]);
  if (!envelope
    || envelope.runId !== handoff.runId
    || envelope.correlationId !== handoff.correlationId
    || envelope.targetAgent !== handoff.sourceAgent) {
    throw new Starter198AgentTaskError('starter_agent_handoff_task_mismatch');
  }
  const resultHash = stableHash(handoff.result);
  const matches = (record: StarterRecord): boolean => {
    const result = typeof record.result === 'string'
      ? (() => { try { return JSON.parse(record.result) as unknown; } catch { return null; } })()
      : record.result;
    return text(record.run_id) === handoff.runId
      && text(record.task_id) === handoff.taskId
      && text(record.correlation_id) === handoff.correlationId
      && text(record.source_agent) === handoff.sourceAgent
      && text(record.target_agent) === handoff.targetAgent
      && text(record.result_hash) === resultHash
      && stableHash(result) === resultHash;
  };
  const existing = await repository.list(STARTER_COLLECTIONS.handoffs, handoff.tenantId, {
    where: { handoff_id: handoff.handoffId }, perPage: 2,
  });
  if (existing.totalItems > 1 || existing.items.length > 1) {
    throw new Starter198AgentTaskError('starter_agent_handoff_integrity_violation');
  }
  if (existing.items[0]) {
    if (!matches(existing.items[0])) throw new Starter198AgentTaskError('starter_agent_handoff_idempotency_conflict');
    return { created: false };
  }
  const data = {
    run_id: handoff.runId,
    task_id: handoff.taskId,
    handoff_id: handoff.handoffId,
    correlation_id: handoff.correlationId,
    source_agent: handoff.sourceAgent,
    target_agent: handoff.targetAgent,
    result: handoff.result,
    result_hash: resultHash,
    status: 'received',
    created_at: handoff.createdAt,
    updated_at: handoff.createdAt,
  };
  try {
    await repository.create(STARTER_COLLECTIONS.handoffs, handoff.tenantId, data);
    return { created: true };
  } catch (error) {
    if (!(error instanceof Starter198RepositoryError)) throw error;
    const raced = await repository.list(STARTER_COLLECTIONS.handoffs, handoff.tenantId, {
      where: { handoff_id: handoff.handoffId }, perPage: 2,
    });
    if (raced.totalItems === 1 && raced.items.length === 1 && matches(raced.items[0])) {
      return { created: false };
    }
    throw new Starter198AgentTaskError(raced.items.length
      ? 'starter_agent_handoff_idempotency_conflict'
      : 'starter_agent_handoff_storage_unavailable');
  }
}

function usageKey(prefix: string, envelope: AgentTaskEnvelopeV1): string {
  return `${prefix}:${stableHash({ tenantId: envelope.tenantId, taskId: envelope.taskId, key: envelope.idempotencyKey }).slice(0, 48)}`;
}

function mapUsageError(error: unknown): never {
  if (error instanceof Starter198UsageLedgerError) throw new Starter198AgentTaskError(error.code);
  throw error;
}

async function starterAgentTaskByLogicalId(
  repository: Starter198Repository,
  tenantId: string,
  taskId: string,
): Promise<StarterRecord | null> {
  const tasks = await repository.list(STARTER_COLLECTIONS.agentTasks, tenantId, {
    where: { task_id: taskId }, perPage: 2,
  });
  if (tasks.totalItems > 1 || tasks.items.length > 1) {
    throw new Starter198AgentTaskError('starter_agent_task_integrity_violation');
  }
  return tasks.items[0] ?? null;
}

/**
 * Make a pending task consumer-visible only after a priced budget/resource
 * reservation exists. Unknown pricing is recorded and closed before any
 * worker can see the task; it is never represented as a zero estimate.
 */
export async function meterStarterAgentTaskForExecution(input: {
  tenantId: string;
  taskId: string;
  capability: Starter198Capability;
  cost: StarterUsageReservationCost;
  resourceUnits?: StarterUsageResourceUnits;
  repository?: Starter198Repository;
  now?: Date;
}): Promise<{ envelope: AgentTaskEnvelopeV1; reservationId: string; changed: boolean }> {
  const repository = input.repository ?? starter198Repository;
  const task = await starterAgentTaskByLogicalId(repository, input.tenantId, input.taskId);
  if (!task) throw new Starter198AgentTaskError('starter_agent_task_not_found');
  const envelope = starterAgentTaskEnvelopeFromRecord(task);
  if (!envelope || envelope.tenantId !== input.tenantId) {
    throw new Starter198AgentTaskError('starter_agent_task_integrity_violation');
  }
  const existingReservationId = text(task.budget_reservation_id);
  if (text(task.status) === 'ready' && existingReservationId) {
    if (envelope.budgetReservationId !== existingReservationId || text(task.metered_capability) !== input.capability) {
      throw new Starter198AgentTaskError('starter_agent_task_metering_conflict');
    }
    let replay;
    try {
      replay = await reserveStarterUsage({
        tenantId: input.tenantId,
        runId: envelope.runId,
        taskId: envelope.taskId,
        agentRole: envelope.targetAgent,
        capability: input.capability,
        idempotencyKey: usageKey('usage-reserve', envelope),
        cost: input.cost,
        resourceUnits: input.resourceUnits,
        repository,
        now: input.now,
      });
    } catch (error) { return mapUsageError(error); }
    if (replay.reservationId !== existingReservationId || replay.state !== 'reserved') {
      throw new Starter198AgentTaskError('starter_agent_task_usage_reservation_closed');
    }
    return { envelope, reservationId: existingReservationId, changed: false };
  }
  if (text(task.status) !== 'pending' || existingReservationId || envelope.budgetReservationId) {
    throw new Starter198AgentTaskError('starter_agent_task_not_meterable');
  }
  let reservation;
  try {
    reservation = await reserveStarterUsage({
      tenantId: input.tenantId,
      runId: envelope.runId,
      taskId: envelope.taskId,
      agentRole: envelope.targetAgent,
      capability: input.capability,
      idempotencyKey: usageKey('usage-reserve', envelope),
      cost: input.cost,
      resourceUnits: input.resourceUnits,
      repository,
      now: input.now,
    });
  } catch (error) { return mapUsageError(error); }
  if (reservation.state !== 'reserved') {
    throw new Starter198AgentTaskError('starter_agent_task_usage_reservation_closed');
  }
  if (!reservation.executable) {
    try {
      await failStarterUsage({
        tenantId: input.tenantId,
        reservationId: reservation.reservationId,
        idempotencyKey: usageKey('usage-unpriced', envelope),
        tokens: { status: 'known', inputTokens: 0, outputTokens: 0, cacheTokens: 0 },
        cost: { status: 'known', settledCostCny: 0 },
        outputCount: 0,
        resourceUnits: { contentArtifacts: 0, contentRevisions: 0, inquiryAi: 0 },
        waitReason: '成本未知，未向 Worker 开放任务',
        anomalyCode: 'usage_price_unknown_execution_blocked',
        repository,
        now: input.now,
      });
    } catch (error) { return mapUsageError(error); }
    throw new Starter198AgentTaskError('starter_agent_task_usage_price_unknown');
  }
  const meteredEnvelope: AgentTaskEnvelopeV1 = { ...envelope, budgetReservationId: reservation.reservationId };
  try {
    await repository.update(STARTER_COLLECTIONS.agentTasks, input.tenantId, task.id, {
      envelope: meteredEnvelope,
      envelope_hash: stableHash(meteredEnvelope),
      budget_reservation_id: reservation.reservationId,
      metered_capability: input.capability,
      status: 'ready',
      updated_at: (input.now ?? new Date()).toISOString(),
    });
  } catch (taskError) {
    try {
      await failStarterUsage({
        tenantId: input.tenantId,
        reservationId: reservation.reservationId,
        idempotencyKey: usageKey('usage-enqueue-failed', envelope),
        tokens: { status: 'known', inputTokens: 0, outputTokens: 0, cacheTokens: 0 },
        cost: { status: 'known', settledCostCny: 0 },
        outputCount: 0,
        resourceUnits: { contentArtifacts: 0, contentRevisions: 0, inquiryAi: 0 },
        waitReason: '任务开放失败，未执行',
        anomalyCode: 'agent_task_metering_update_failed',
        repository,
        now: input.now,
      });
    } catch (compensationError) { return mapUsageError(compensationError); }
    throw taskError;
  }
  return { envelope: meteredEnvelope, reservationId: reservation.reservationId, changed: true };
}

/**
 * Worker completion seam. The usage reservation reaches one terminal state
 * before a result is exposed through the idempotent handoff.
 */
export async function completeMeteredStarterAgentTask(input: {
  handoff: AgentHandoffV1;
  idempotencyKey: string;
  tokens: StarterUsageTokenMeasurement;
  cost: StarterUsageActualCost;
  outputCount: number;
  resourceUnits?: StarterUsageResourceUnits;
  waitReason?: string;
  anomalyCode?: string;
  repository?: Starter198Repository;
  now?: Date;
}): Promise<void> {
  const repository = input.repository ?? starter198Repository;
  const task = await starterAgentTaskByLogicalId(repository, input.handoff.tenantId, input.handoff.taskId);
  if (!task) throw new Starter198AgentTaskError('starter_agent_task_not_found');
  const envelope = starterAgentTaskEnvelopeFromRecord(task);
  const reservationId = text(task.budget_reservation_id);
  const alreadyTerminal = ['succeeded', 'blocked', 'failed', 'cancelled'].includes(text(task.status));
  if (!envelope || (!alreadyTerminal && text(task.status) !== 'ready') || !reservationId
    || envelope.budgetReservationId !== reservationId
    || input.handoff.sourceAgent !== envelope.targetAgent
    || input.handoff.runId !== envelope.runId
    || input.handoff.correlationId !== envelope.correlationId) {
    throw new Starter198AgentTaskError('starter_agent_task_completion_invalid');
  }
  const terminalInput = {
    tenantId: input.handoff.tenantId,
    reservationId,
    idempotencyKey: input.idempotencyKey,
    tokens: input.tokens,
    cost: input.cost,
    outputCount: input.outputCount,
    resourceUnits: input.resourceUnits,
    waitReason: input.waitReason,
    anomalyCode: input.anomalyCode,
    repository,
    now: input.now,
  };
  try {
    if (input.handoff.result.status === 'succeeded') await settleStarterUsage(terminalInput);
    else await failStarterUsage(terminalInput);
  } catch (error) { return mapUsageError(error); }
  await persistStarterAgentHandoff(input.handoff, repository);
  await repository.update(STARTER_COLLECTIONS.agentTasks, input.handoff.tenantId, task.id, {
    status: input.handoff.result.status,
    result: input.handoff.result,
    result_hash: stableHash(input.handoff.result),
    updated_at: (input.now ?? new Date()).toISOString(),
  });
}
