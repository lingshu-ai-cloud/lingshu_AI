import { createHash } from 'node:crypto';
import type {
  Starter198Command,
  StarterWorkspaceCommandInput,
  StarterWorkspaceCommandResult,
} from '../../shared/contracts/starter198.js';
import type { DataStore } from '../storage/datastore.js';
import { DurableOperationLeaseError } from '../runtime/durableLease.js';
import { evidenceHash } from '../quotation/canonical.js';
import {
  assertStarterCancellationForCommand,
  requireStarterApprovalForCommand,
  requireStarterRunForCommand,
  starterPendingApprovalsForCommand,
} from './commandScope.js';
import { Starter198CommandError } from './commandValidation.js';
import {
  STARTER_COLLECTIONS,
  type Starter198Repository,
  type StarterRecord,
  starterRecordVersion,
} from './repository.js';
import {
  Starter198RunMutationLeaseError,
  withStarter198RunMutationLease,
} from './runMutationLease.js';

const EVIDENCE_SCHEMA = 'starter-198.command-mutation.v1' as const;
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const object = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);
const stableHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class Starter198CommandMutationUncertainError extends Error {
  constructor(readonly code = 'starter_198_command_state_unknown') {
    super(code);
    this.name = 'Starter198CommandMutationUncertainError';
  }
}

async function withCommandRunMutationLease<T>(input: {
  repository: Starter198Repository;
  dataStore?: DataStore;
  tenantId: string;
  runId: string;
  action: () => Promise<T>;
}): Promise<T> {
  try {
    return await withStarter198RunMutationLease({
      tenantId: input.tenantId,
      runId: input.runId,
      dataStore: input.dataStore ?? input.repository.dataStore,
      action: input.action,
    });
  } catch (error) {
    if (error instanceof Starter198RunMutationLeaseError) {
      throw new Starter198CommandError(
        error.code,
        error.code === 'starter_run_mutation_busy' ? 409 : 503,
      );
    }
    if (error instanceof DurableOperationLeaseError) {
      throw new Starter198CommandError('starter_run_mutation_unavailable', 503);
    }
    throw error;
  }
}

type CommandRecord = StarterRecord & { command_id?: unknown; request_hash?: unknown; created_by?: unknown };
type MutationCommand = 'pause_run' | 'resume_run' | 'cancel_run' | 'resolve_decision';
type MutationEvidenceInput = {
  commandId: string;
  idempotencyKey: string;
  requestHash: string;
  command: MutationCommand;
  targetId: string;
  expectedVersion?: string;
  actorUserId: string;
  resultingStatus: string;
  selection?: Record<string, unknown>;
};

function structured(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

function evidenceArray(value: unknown): Record<string, unknown>[] {
  const parsed = structured(value);
  if (parsed === undefined || parsed === null || parsed === '') return [];
  const values = Array.isArray(parsed) ? parsed : [parsed];
  if (values.some(item => !object(item))) {
    throw new Starter198CommandError('starter_198_command_evidence_integrity_violation', 503);
  }
  return values as Record<string, unknown>[];
}

function mutationEvidence(input: MutationEvidenceInput) {
  const subject = {
    schemaVersion: EVIDENCE_SCHEMA,
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    command: input.command,
    targetId: input.targetId,
    expectedVersion: input.expectedVersion ?? '',
    actorUserId: input.actorUserId,
    resultingStatus: input.resultingStatus,
    ...(input.selection ? { selection: input.selection } : {}),
  };
  return { ...subject, evidenceHash: stableHash(subject) };
}

function mutationEvidenceMatches(value: unknown, input: MutationEvidenceInput): boolean {
  const candidate = object(value);
  if (!candidate) return false;
  return Object.entries(mutationEvidence(input)).every(([key, expected]) => candidate[key] === expected);
}

function eventType(command: Exclude<MutationCommand, 'resolve_decision'>, commandId: string): string {
  return `starter.command.${command}.${commandId}.applied`;
}

async function appendRunEvidence(input: MutationEvidenceInput & {
  repository: Starter198Repository;
  tenantId: string;
  runId: string;
  command: 'pause_run' | 'resume_run' | 'cancel_run';
  now: Date;
}): Promise<void> {
  const existing = await input.repository.list(STARTER_COLLECTIONS.events, input.tenantId, {
    where: { run_id: input.runId, type: eventType(input.command, input.commandId) }, perPage: 2,
  });
  const exact = mutationEvidence(input);
  if (existing.totalItems > 1 || existing.items.length > 1) {
    throw new Starter198CommandError('starter_198_command_evidence_integrity_violation', 503);
  }
  if (existing.items.length === 1) {
    if (!mutationEvidenceMatches(structured(existing.items[0].payload), input)) {
      throw new Starter198CommandError('starter_198_command_evidence_integrity_violation', 503);
    }
    return;
  }
  const latest = await input.repository.list(STARTER_COLLECTIONS.events, input.tenantId, {
    where: { run_id: input.runId }, sort: '-sequence', perPage: 1,
  });
  const latestSequence = Number(latest.items[0]?.sequence || 0);
  if (!Number.isSafeInteger(latestSequence) || latestSequence < 0) {
    throw new Starter198CommandError('starter_198_command_evidence_integrity_violation', 503);
  }
  await input.repository.create(STARTER_COLLECTIONS.events, input.tenantId, {
    run_id: input.runId,
    task_id: '',
    sequence: latestSequence + 1,
    type: eventType(input.command, input.commandId),
    level: input.command === 'cancel_run' ? 'warning' : 'info',
    summary: input.command === 'pause_run' ? '运行已通过灵小枢暂停'
      : input.command === 'resume_run' ? '运行已通过灵小枢恢复'
        : '运行已通过灵小枢取消',
    payload: exact,
    occurred_at: input.now.toISOString(),
  });
}

export async function persistStarterApprovalMutationEvidence(input: {
  repository: Starter198Repository;
  tenantId: string;
  approvalId: string;
  decision: 'approved' | 'rejected';
  commandId: string;
  idempotencyKey: string;
  requestHash: string;
  expectedVersion: string;
  actorUserId: string;
  selection?: Record<string, unknown>;
}): Promise<void> {
  const approval = await input.repository.get(STARTER_COLLECTIONS.approvals, input.tenantId, input.approvalId);
  if (!approval || text(approval.status) !== input.decision
    || text(approval.decided_by) !== input.actorUserId) {
    throw new Starter198CommandMutationUncertainError();
  }
  const evidence = evidenceArray(approval.evidence);
  const expectedInput: MutationEvidenceInput = {
    commandId: input.commandId,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    command: 'resolve_decision',
    targetId: input.approvalId,
    expectedVersion: input.expectedVersion,
    actorUserId: input.actorUserId,
    resultingStatus: input.decision,
    ...(input.selection ? { selection: input.selection } : {}),
  };
  const sameIdentity = evidence.filter(item => item.schemaVersion === EVIDENCE_SCHEMA
    && (text(item.commandId) === input.commandId || text(item.idempotencyKey) === input.idempotencyKey));
  if (sameIdentity.length > 1
    || (sameIdentity.length === 1 && !mutationEvidenceMatches(sameIdentity[0], expectedInput))) {
    throw new Starter198CommandError('starter_198_command_evidence_integrity_violation', 503);
  }
  if (sameIdentity.length === 1) return;
  try {
    await input.repository.update(STARTER_COLLECTIONS.approvals, input.tenantId, input.approvalId, {
      evidence: [...evidence, mutationEvidence(expectedInput)],
    });
  } catch {
    throw new Starter198CommandMutationUncertainError();
  }
}

export async function executeStarterRunControlCommand(input: {
  repository: Starter198Repository;
  dataStore?: DataStore;
  tenantId: string;
  command: 'pause_run' | 'resume_run';
  targetId: string;
  expectedVersion?: string;
  payload: Record<string, unknown>;
  now: Date;
  userId: string;
  commandId: string;
  idempotencyKey: string;
  requestHash: string;
}): Promise<{ message: string }> {
  return withCommandRunMutationLease({
    repository: input.repository,
    dataStore: input.dataStore,
    tenantId: input.tenantId,
    runId: input.targetId,
    action: async () => {
    const run = await requireStarterRunForCommand(input.repository, input.tenantId, input.targetId);
    if (input.expectedVersion && input.expectedVersion !== starterRecordVersion(run)) {
      throw new Starter198CommandError('starter_198_version_conflict', 409);
    }
    const status = text(run.status);
    const approvals = input.command === 'resume_run'
      ? await starterPendingApprovalsForCommand({ repository: input.repository, tenantId: input.tenantId, run })
      : [];
    const resultingStatus = input.command === 'pause_run' ? 'paused'
      : approvals.length > 0 ? 'waiting_approval' : 'running';
    if (input.command === 'pause_run' && !['running', 'waiting_external', 'waiting_approval'].includes(status)) {
      throw new Starter198CommandError('starter_198_run_not_pausable', 409);
    }
    if (input.command === 'resume_run' && status !== 'paused') {
      throw new Starter198CommandError('starter_198_run_not_resumable', 409);
    }
    try {
      await input.repository.update(STARTER_COLLECTIONS.runs, input.tenantId, run.id, {
        status: resultingStatus,
        pause_reason: input.command === 'pause_run' ? text(input.payload.reason) || '用户通过灵小枢暂停' : '',
        current_controller: input.command === 'pause_run' || approvals.length > 0 ? 'human' : 'agent',
      });
    } catch {
      // A transport/storage error cannot prove that the update was rejected.
      // Preserve the processing journal instead of recording a false failure.
      throw new Starter198CommandMutationUncertainError();
    }
    try {
      await appendRunEvidence({
        ...input,
        runId: run.id,
        actorUserId: input.userId,
        resultingStatus,
      });
    } catch {
      throw new Starter198CommandMutationUncertainError();
    }
    return { message: input.command === 'pause_run' ? '本轮已暂停'
      : approvals.length > 0 ? '本轮已恢复，继续等待你的决策' : '本轮已恢复' };
    },
  });
}

export async function executeStarterCancellationCommand(input: {
  repository: Starter198Repository;
  dataStore?: DataStore;
  tenantId: string;
  userId: string;
  targetId: string;
  expectedVersion?: string;
  reason: string;
  commandId: string;
  idempotencyKey: string;
  requestHash: string;
  now: Date;
}): Promise<{ message: string }> {
  return withCommandRunMutationLease({
    repository: input.repository,
    dataStore: input.dataStore,
    tenantId: input.tenantId,
    runId: input.targetId,
    action: async () => {
    let mutationStarted = false;
    try {
      const run = await requireStarterRunForCommand(input.repository, input.tenantId, input.targetId);
      if (input.expectedVersion && input.expectedVersion !== starterRecordVersion(run)) {
        throw new Starter198CommandError('starter_198_version_conflict', 409);
      }
      if (['succeeded', 'failed', 'completed', 'cancelled', 'cancelling'].includes(text(run.status))) {
        throw new Starter198CommandError('workflow_run_not_cancellable', 409);
      }
      // Scope and graph membership are re-read under the same lock and through
      // the same repository used for all following writes.
      const graph = await assertStarterCancellationForCommand({
        repository: input.repository, tenantId: input.tenantId, run,
      });
      const reason = input.reason.slice(0, 500) || '用户通过灵小枢取消';
      const timestamp = input.now.toISOString();
      mutationStarted = true;
      await input.repository.update(STARTER_COLLECTIONS.runs, input.tenantId, run.id, {
        status: 'cancelling', current_controller: 'human', pause_reason: reason,
      });
      for (const task of graph.tasks) {
        if (['succeeded', 'failed', 'cancelled'].includes(text(task.status))) continue;
        await input.repository.update(STARTER_COLLECTIONS.tasks, input.tenantId, task.id, {
          status: 'cancelled', updated_at: timestamp,
        });
      }
      for (const approval of graph.approvals) {
        await input.repository.update(STARTER_COLLECTIONS.approvals, input.tenantId, approval.id, {
          status: 'superseded', decision_note: '运行已取消，审批失效', decided_at: timestamp,
        });
      }
      const goalId = text(run.goal_id);
      if (goalId) {
        const goal = await input.repository.get(STARTER_COLLECTIONS.goals, input.tenantId, goalId);
        if (!goal) throw new Starter198CommandError('starter_198_workflow_scope_invalid', 503);
        await input.repository.update(STARTER_COLLECTIONS.goals, input.tenantId, goal.id, {
          status: 'cancelled', updated_at: timestamp,
        });
      }
      await input.repository.update(STARTER_COLLECTIONS.runs, input.tenantId, run.id, {
        status: 'cancelled', current_controller: 'human', pause_reason: reason, completed_at: timestamp,
      });
      await appendRunEvidence({
        ...input,
        runId: run.id,
        command: 'cancel_run',
        actorUserId: input.userId,
        resultingStatus: 'cancelled',
      });
      return { message: '本轮已取消' };
    } catch (error) {
      if (mutationStarted && !(error instanceof Starter198CommandMutationUncertainError)) {
        throw new Starter198CommandMutationUncertainError();
      }
      throw error;
    }
    },
  });
}

function quoteId(targetId: string): string | null {
  const id = targetId.startsWith('quote:') ? targetId.slice(6) : '';
  return /^[A-Za-z0-9_-]{1,160}$/.test(id) ? id : null;
}

async function recoverRunMutation(input: RecoveryInput, command: 'pause_run' | 'resume_run' | 'cancel_run') {
  const targetId = input.request.targetId ?? '';
  if (!targetId) return null;
  await requireStarterRunForCommand(input.repository, input.tenantId, targetId);
  const events = await input.repository.list(STARTER_COLLECTIONS.events, input.tenantId, {
    where: { run_id: targetId, type: eventType(command, text(input.record.command_id)) }, perPage: 2,
  });
  if (events.totalItems > 1 || events.items.length > 1) {
    throw new Starter198CommandError('starter_198_command_evidence_integrity_violation', 503);
  }
  const statuses = command === 'resume_run' ? ['running', 'waiting_approval']
    : command === 'pause_run' ? ['paused'] : ['cancelled'];
  const matching = events.items.filter(event => statuses.some(resultingStatus => mutationEvidenceMatches(
    structured(event.payload), {
      commandId: text(input.record.command_id), idempotencyKey: input.request.idempotencyKey,
      requestHash: text(input.record.request_hash), command, targetId,
      expectedVersion: input.request.expectedVersion, actorUserId: text(input.record.created_by), resultingStatus,
    },
  )));
  if (matching.length !== 1) return null;
  return command === 'pause_run' ? '本轮已暂停' : command === 'resume_run' ? '本轮已恢复' : '本轮已取消';
}

async function recoverDecision(input: RecoveryInput): Promise<string | null> {
  const targetId = input.request.targetId ?? '';
  const decision = text(input.request.payload?.decision);
  const draftId = quoteId(targetId);
  if (draftId) {
    const quote = await input.repository.get(STARTER_COLLECTIONS.quoteDrafts, input.tenantId, draftId);
    const found = await input.repository.list(STARTER_COLLECTIONS.quoteApprovalEvidence, input.tenantId, {
      where: { idempotency_key: `${input.request.idempotencyKey}:quote-decision` }, perPage: 2,
    });
    if (found.totalItems > 1 || found.items.length > 1) {
      throw new Starter198CommandError('quotation_integrity_error', 503);
    }
    const approval = found.items[0];
    const envelope = object(structured(approval?.envelope));
    const subject = object(envelope?.subject);
    const binding = object(envelope?.binding);
    const actor = object(envelope?.actor);
    const requestHash = quote ? evidenceHash({
      draftId: quote.id, inputHash: text(quote.input_hash), ruleHash: text(quote.rule_hash),
      calculationHash: text(quote.calculation_hash), decision, note: text(input.request.payload?.note),
    }) : '';
    const matches = Boolean(quote && approval && envelope
      && text(approval.draft_id) === quote.id
      && text(approval.input_hash) === text(input.request.expectedVersion)
      && text(approval.input_hash) === text(quote.input_hash)
      && text(approval.rule_hash) === text(quote.rule_hash)
      && text(approval.calculation_hash) === text(quote.calculation_hash)
      && text(approval.decision) === decision && text(approval.status) === decision
      && text(approval.request_hash) === requestHash
      && text(approval.envelope_hash) === evidenceHash(envelope)
      && text(envelope.action) === 'quote_draft_decision' && text(envelope.decision) === decision
      && text(subject?.id) === quote.id
      && text(binding?.inputHash) === text(quote.input_hash)
      && text(binding?.ruleHash) === text(quote.rule_hash)
      && text(binding?.calculationHash) === text(quote.calculation_hash)
      && text(actor?.userId) === text(input.record.created_by)
      && text(quote.approval_evidence_id) === approval.id);
    return matches ? decision === 'approved' ? '报价已批准' : '报价已退回调整' : null;
  }
  if (!targetId) return null;
  const { approval, run } = await requireStarterApprovalForCommand({
    repository: input.repository, tenantId: input.tenantId, approvalId: targetId,
  });
  if (input.lockedRunId && run.id !== input.lockedRunId) {
    throw new Starter198CommandError('starter_198_workflow_scope_invalid', 503);
  }
  const matching = evidenceArray(approval.evidence).filter(item => ['approved', 'rejected'].includes(decision)
    && mutationEvidenceMatches(item, {
      commandId: text(input.record.command_id), idempotencyKey: input.request.idempotencyKey,
      requestHash: text(input.record.request_hash), command: 'resolve_decision', targetId,
      expectedVersion: input.request.expectedVersion, actorUserId: text(input.record.created_by),
      resultingStatus: decision,
    }));
  if (matching.length > 1) throw new Starter198CommandError('starter_198_command_evidence_integrity_violation', 503);
  if (text(approval.status) !== decision || matching.length !== 1) return null;
  return decision === 'approved' ? '决策已同意' : '已退回调整';
}

type RecoveryInput = {
  repository: Starter198Repository;
  dataStore?: DataStore;
  tenantId: string;
  request: StarterWorkspaceCommandInput;
  record: CommandRecord;
  now: Date;
  lockedRunId?: string;
};

async function recoverProcessingAttributedCommandUnlocked(
  input: RecoveryInput,
): Promise<{ status: 200; body: StarterWorkspaceCommandResult } | null> {
  const command = input.request.command as Starter198Command;
  let message: string | null = null;
  if (command === 'pause_run' || command === 'resume_run' || command === 'cancel_run') {
    message = await recoverRunMutation(input, command);
  } else if (command === 'resolve_decision') {
    message = await recoverDecision(input);
  } else if (command === 'submit_quote_send_evidence') {
    const draftId = quoteId(input.request.targetId ?? '');
    if (draftId) {
      const found = await input.repository.list(STARTER_COLLECTIONS.quoteSendEvidence, input.tenantId, {
        where: { draft_id: draftId, idempotency_key: `${input.request.idempotencyKey}:quote-send-evidence` },
        perPage: 2,
      });
      if (found.totalItems > 1 || found.items.length > 1) {
        throw new Starter198CommandError('quotation_integrity_error', 503);
      }
      if (found.items.length === 1 && text(found.items[0].status) === 'submitted_unverified') {
        message = '人工发送证据已登记，等待验真';
      }
    }
  }
  if (!message) return null;
  const result: StarterWorkspaceCommandResult = {
    accepted: true, commandId: text(input.record.command_id) || null, message,
  };
  await input.repository.update(STARTER_COLLECTIONS.commands, input.tenantId, input.record.id, {
    status: 'succeeded', http_status: 200, result, updated_at: input.now.toISOString(),
  });
  return { status: 200, body: result };
}

export async function recoverProcessingAttributedCommand(
  input: RecoveryInput,
): Promise<{ status: 200; body: StarterWorkspaceCommandResult } | null> {
  const command = input.request.command as Starter198Command;
  const targetId = input.request.targetId ?? '';
  if (targetId && (command === 'pause_run' || command === 'resume_run' || command === 'cancel_run')) {
    return withCommandRunMutationLease({
      repository: input.repository,
      dataStore: input.dataStore,
      tenantId: input.tenantId,
      runId: targetId,
      action: () => recoverProcessingAttributedCommandUnlocked(input),
    });
  }
  if (targetId && command === 'resolve_decision' && !quoteId(targetId)) {
    // This first read only discovers the owning run. The authoritative approval
    // re-read, evidence verification and command-journal finalization happen
    // together under that run's durable mutation lease below.
    const context = await requireStarterApprovalForCommand({
      repository: input.repository,
      tenantId: input.tenantId,
      approvalId: targetId,
    });
    return withCommandRunMutationLease({
      repository: input.repository,
      dataStore: input.dataStore,
      tenantId: input.tenantId,
      runId: context.run.id,
      action: () => recoverProcessingAttributedCommandUnlocked({ ...input, lockedRunId: context.run.id }),
    });
  }
  return recoverProcessingAttributedCommandUnlocked(input);
}
