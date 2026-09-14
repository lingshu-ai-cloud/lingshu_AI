import { createHash, randomUUID } from 'node:crypto';
import type {
  Starter198Command,
  Starter198OrgRole,
  Starter198QuoteInquiryInput,
  Starter198QuoteRuleSetupInput,
  StarterWorkspaceCommandInput,
  StarterWorkspaceCommandResult,
} from '../../shared/contracts/starter198.js';
import {
  createStarterPublicationPackage,
  readStarterPublicationPackage,
  submitStarterPublicationEvidence,
  StarterPublicationPackageError,
  type BuildStarterPublicationPackageInput,
} from '../publishing/starterPublicationPackage.js';
import type { DataStore } from '../storage/datastore.js';
import { DurableOperationLeaseError } from '../runtime/durableLease.js';
import { buildStarter198CapabilityManifest } from './profile.js';
import {
  retryStarterPublicationEvidenceProjection,
  type StarterPublicationEvidenceProjector,
} from './publicationEvidenceCommandProjection.js';
import {
  STARTER_COLLECTIONS,
  Starter198RepositoryError,
  starter198Repository,
  type Starter198Repository,
  type StarterRecord,
  starterRecordVersion,
  starterVersionString,
} from './repository.js';
import { starterCommandAllowed } from './workspace.js';
import {
  Starter198RuntimePortError,
  type Starter198ApprovalDecisionPort,
  type Starter198InitialSetupPort,
  type Starter198OrchestratorQueuePort,
  type Starter198OrchestratorQueueResult,
  type Starter198QuoteDecisionPort,
  type Starter198QuoteEvidencePort,
  type Starter198QuoteSelfServicePort,
} from './runtimePorts.js';
import {
  assertPublicationPackageQuota,
  Starter198QuotaError,
  withStarterQuotaScope,
} from './quota.js';
import type { Starter198ResourceLimits } from '../../shared/contracts/starter198.js';
import {
  assertStarter198CommandPayload as assertPayload,
  parseStarter198CommandInput,
  STARTER_198_COMMAND_SET as COMMANDS,
  Starter198CommandError,
} from './commandValidation.js';
import { recoverProcessingQuoteCommand } from './quoteCommandRecovery.js';
import { recoverProcessingDurableCommand } from './durableCommandRecovery.js';
import { executeStarter198InitialSetupCommand } from './initialSetupCommand.js';
import {
  assertStarterCancellationForCommand,
  assertStarterReplayTargetScope,
  requireStarterApprovalForCommand,
  requireStarterRunForCommand,
} from './commandScope.js';
import {
  executeStarterCancellationCommand,
  executeStarterRunControlCommand,
  persistStarterApprovalMutationEvidence,
  recoverProcessingAttributedCommand,
  Starter198CommandMutationUncertainError,
} from './commandAttribution.js';
import {
  Starter198RunMutationLeaseError,
  withStarter198RunMutationLease,
} from './runMutationLease.js';

export { parseStarter198CommandInput, Starter198CommandError } from './commandValidation.js';

type PublicationCreate = typeof createStarterPublicationPackage;
type PublicationEvidence = typeof submitStarterPublicationEvidence;
type PublicationRead = typeof readStarterPublicationPackage;

export interface Starter198CommandDependencies {
  repository?: Starter198Repository;
  /** Explicit backing store for storage-agnostic test repositories. */
  dataStore?: DataStore;
  createPublicationPackage?: PublicationCreate;
  readPublicationPackage?: PublicationRead;
  submitPublicationEvidence?: PublicationEvidence;
  projectPublicationEvidence?: StarterPublicationEvidenceProjector;
  orchestratorQueue?: Starter198OrchestratorQueuePort;
  approvalDecision?: Starter198ApprovalDecisionPort;
  quoteDecision?: Starter198QuoteDecisionPort;
  quoteEvidence?: Starter198QuoteEvidencePort;
  quoteSelfService?: Starter198QuoteSelfServicePort;
  initialSetup?: Starter198InitialSetupPort;
  now?: () => Date;
}

type CommandRecord = StarterRecord & {
  idempotency_key?: unknown;
  request_hash?: unknown;
  command?: unknown;
  status?: unknown;
  result?: unknown;
};

const queues = new Map<string, Promise<void>>();
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const object = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
);
const stableHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function commandAuditPayload(
  command: Starter198Command,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Record<string, unknown> {
  if (command !== 'confirm_quote_rule' && command !== 'submit_quote_inquiry') return payload;
  const sourceReference = text(payload.sourceReference);
  return {
    ...payload,
    sourceReference: sourceReference
      ? `sha256:${stableHash({ command, idempotencyKey, sourceReference })}`
      : '',
  };
}

async function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => gate);
  queues.set(key, tail);
  await previous.catch(() => undefined);
  try { return await operation(); }
  finally {
    release();
    if (queues.get(key) === tail) queues.delete(key);
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

function parseStoredResult(value: unknown): StarterWorkspaceCommandResult | null {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) as unknown; } catch { return null; }
  }
  const result = object(parsed);
  if (!result || typeof result.accepted !== 'boolean') return null;
  return {
    accepted: result.accepted,
    commandId: text(result.commandId) || null,
    message: text(result.message) || null,
  };
}

async function findCommand(
  repository: Starter198Repository,
  tenantId: string,
  idempotencyKey: string,
): Promise<CommandRecord | null> {
  const result = await repository.list(STARTER_COLLECTIONS.commands, tenantId, {
    where: { idempotency_key: idempotencyKey }, perPage: 2,
  });
  if (result.totalItems > 1 || result.items.length > 1) {
    throw new Starter198CommandError('starter_198_command_integrity_violation', 503);
  }
  return result.items[0] as CommandRecord | undefined ?? null;
}

function expectedVersionMatches(record: StarterRecord, expectedVersion: string | undefined): boolean {
  if (!expectedVersion) return true;
  return expectedVersion === starterRecordVersion(record);
}

function quoteDraftId(targetId: string): string | null {
  if (!targetId.startsWith('quote:')) return null;
  const id = targetId.slice('quote:'.length);
  return /^[A-Za-z0-9_-]{1,160}$/.test(id) ? id : null;
}

async function preflightStatefulCommand(input: {
  repository: Starter198Repository;
  tenantId: string;
  request: StarterWorkspaceCommandInput;
}): Promise<void> {
  const command = input.request.command as Starter198Command;
  if (!['pause_run', 'resume_run', 'cancel_run', 'resolve_decision', 'submit_quote_send_evidence'].includes(command)) return;
  if (!input.request.targetId) throw new Starter198CommandError('starter_198_command_target_required', 400);
  if (!input.request.expectedVersion) throw new Starter198CommandError('starter_198_version_required', 400);
  if (command === 'resolve_decision' || command === 'submit_quote_send_evidence') {
    const quoteId = quoteDraftId(input.request.targetId);
    if (quoteId) {
      const quote = await input.repository.get(STARTER_COLLECTIONS.quoteDrafts, input.tenantId, quoteId);
      if (!quote) throw new Starter198CommandError('quote_draft_not_found', 404);
      const requiredStatus = command === 'resolve_decision' ? 'draft_ready' : 'approved';
      if (text(quote.status) !== requiredStatus) {
        throw new Starter198CommandError(command === 'resolve_decision' ? 'quote_draft_not_approvable' : 'quote_manual_send_evidence_not_allowed', 409);
      }
      if (starterVersionString(quote.input_hash) !== input.request.expectedVersion) {
        throw new Starter198CommandError('quote_draft_changed', 409);
      }
      return;
    }
    if (command === 'submit_quote_send_evidence') throw new Starter198CommandError('quote_draft_target_invalid', 400);
    const { approval } = await requireStarterApprovalForCommand({
      repository: input.repository, tenantId: input.tenantId, approvalId: input.request.targetId,
    });
    if (text(approval.status) !== 'pending') throw new Starter198CommandError('approval_not_pending', 409);
    if (starterVersionString(approval.subject_version) !== input.request.expectedVersion) {
      throw new Starter198CommandError('approval_subject_changed', 409);
    }
    return;
  }
  const run = await requireStarterRunForCommand(input.repository, input.tenantId, input.request.targetId);
  if (!expectedVersionMatches(run, input.request.expectedVersion)) {
    throw new Starter198CommandError('starter_198_version_conflict', 409);
  }
  const status = text(run.status);
  if (command === 'pause_run' && !['running', 'waiting_external', 'waiting_approval'].includes(status)) {
    throw new Starter198CommandError('starter_198_run_not_pausable', 409);
  }
  if (command === 'resume_run' && status !== 'paused') {
    throw new Starter198CommandError('starter_198_run_not_resumable', 409);
  }
  if (command === 'cancel_run' && ['succeeded', 'failed', 'completed', 'cancelled', 'cancelling'].includes(status)) {
    throw new Starter198CommandError('workflow_run_not_cancellable', 409);
  }
  if (command === 'cancel_run') {
    await assertStarterCancellationForCommand({ repository: input.repository, tenantId: input.tenantId, run });
  }
}

function mapPublicationError(error: StarterPublicationPackageError): Starter198CommandError {
  if (error.code.includes('not_found')) return new Starter198CommandError(error.code, 404);
  if (error.code.includes('conflict') || error.code.includes('already') || error.code.includes('quota')) {
    return new Starter198CommandError(error.code, 409);
  }
  if (error.code.includes('storage') || error.code.includes('integrity')) return new Starter198CommandError(error.code, 503);
  return new Starter198CommandError(error.code, 400);
}

async function executeCommand(input: {
  request: StarterWorkspaceCommandInput;
  tenantId: string;
  userId: string;
  repository: Starter198Repository;
  dataStore?: DataStore;
  createPublicationPackage: PublicationCreate;
  readPublicationPackage: PublicationRead;
  submitPublicationEvidence: PublicationEvidence;
  now: Date;
  commandId: string;
  requestHash: string;
  orchestratorQueue?: Starter198OrchestratorQueuePort;
  approvalDecision?: Starter198ApprovalDecisionPort;
  quoteDecision?: Starter198QuoteDecisionPort;
  quoteEvidence?: Starter198QuoteEvidencePort;
  quoteSelfService?: Starter198QuoteSelfServicePort;
  initialSetup?: Starter198InitialSetupPort;
  role: Starter198OrgRole;
  resourceLimits: Starter198ResourceLimits;
}): Promise<{ state: 'accepted' | 'succeeded'; message: string; result?: Record<string, unknown> }> {
  const { command, payload = {}, targetId, expectedVersion } = input.request;
  if (command === 'confirm_initial_setup') {
    if (!input.initialSetup) throw new Starter198CommandError('starter_198_initial_setup_unavailable', 503);
    return executeStarter198InitialSetupCommand({
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role,
      commandId: input.commandId,
      request: input.request,
      repository: input.repository,
      initialSetup: input.initialSetup,
      orchestratorQueue: input.orchestratorQueue,
      now: input.now,
    });
  }
  if (command === 'submit_orchestrator_input') {
    if (!input.orchestratorQueue) throw new Starter198CommandError('starter_198_orchestrator_worker_unavailable', 503);
    let queued: Starter198OrchestratorQueueResult;
    try {
      // The durable orchestrator decides whether this starts a new run or is
      // attached to the current run. Applying the run quota here would reject
      // every legitimate clarification while concurrentRunCount is already 1.
      queued = await input.orchestratorQueue.enqueue({
          tenantId: input.tenantId,
          userId: input.userId,
          commandId: input.commandId,
          input: text(payload.input),
          idempotencyKey: input.request.idempotencyKey,
      });
    } catch (error) {
      if (error instanceof Starter198QuotaError) throw new Starter198CommandError(error.code, error.status);
      if (error instanceof Starter198RuntimePortError) throw new Starter198CommandError(error.code, error.status);
      throw error;
    }
    if (!text(queued.queueItemId)) throw new Starter198CommandError('starter_198_orchestrator_queue_failed', 503);
    const message = queued.disposition === 'queued'
      ? '7 日标准工作流已创建，等待执行器领取'
      : queued.disposition === 'attached_to_run'
        ? '补充已绑定当前运行，等待灵小枢处理'
        : queued.disposition === 'awaiting_initial_confirmation'
          ? '目标已保存，请先补齐开工卡中的必要资料'
          : '目标已进入灵小枢任务队列';
    return {
      state: 'accepted',
      message,
      result: {
        queueItemId: queued.queueItemId,
        disposition: queued.disposition ?? 'external_queue',
        runId: queued.runId ?? null,
        missingFacts: queued.missingFacts ?? [],
      },
    };
  }
  if (command === 'confirm_quote_rule') {
    if (!input.quoteSelfService) throw new Starter198CommandError('starter_198_quote_self_service_unavailable', 503);
    if (input.role !== 'owner' && input.role !== 'admin') {
      throw new Starter198CommandError('starter_198_command_forbidden', 403);
    }
    try {
      const rule = await input.quoteSelfService.confirmRule({
        tenantId: input.tenantId,
        userId: input.userId,
        role: input.role,
        setup: payload as unknown as Starter198QuoteRuleSetupInput,
        idempotencyKey: input.request.idempotencyKey,
      });
      return {
        state: 'succeeded',
        message: rule.created ? '报价规则已确认并锁定版本' : '当前报价规则已确认',
        result: rule,
      };
    } catch (error) {
      if (error instanceof Starter198RuntimePortError) throw new Starter198CommandError(error.code, error.status);
      throw error;
    }
  }
  if (command === 'submit_quote_inquiry') {
    if (!input.quoteSelfService) throw new Starter198CommandError('starter_198_quote_self_service_unavailable', 503);
    if (input.role !== 'owner' && input.role !== 'admin' && input.role !== 'customer_service') {
      throw new Starter198CommandError('starter_198_command_forbidden', 403);
    }
    try {
      const quote = await input.quoteSelfService.submitInquiry({
        tenantId: input.tenantId,
        userId: input.userId,
        role: input.role,
        inquiry: payload as unknown as Starter198QuoteInquiryInput,
        idempotencyKey: input.request.idempotencyKey,
      });
      return {
        state: 'succeeded',
        message: quote.repeated ? '已返回同一询盘的报价草稿' : '报价已按确认规则计算，等待人工审核',
        result: quote,
      };
    } catch (error) {
      if (error instanceof Starter198RuntimePortError) throw new Starter198CommandError(error.code, error.status);
      throw error;
    }
  }
  if (command === 'resolve_decision') {
    if (!targetId || !expectedVersion) throw new Starter198CommandError('starter_198_decision_version_required', 400);
    const quoteId = quoteDraftId(targetId);
    if (quoteId) {
      if (!input.quoteDecision) throw new Starter198CommandError('starter_198_quote_decision_handler_unavailable', 503);
      if (input.role !== 'owner' && input.role !== 'admin') {
        throw new Starter198CommandError('starter_198_command_forbidden', 403);
      }
      const current = await input.repository.get(STARTER_COLLECTIONS.quoteDrafts, input.tenantId, quoteId);
      if (!current) throw new Starter198CommandError('quote_draft_not_found', 404);
      if (text(current.status) !== 'draft_ready') throw new Starter198CommandError('quote_draft_not_approvable', 409);
      if (starterVersionString(current.input_hash) !== expectedVersion) {
        throw new Starter198CommandError('quote_draft_changed', 409);
      }
      try {
        const decisionResult = await input.quoteDecision.decide({
          tenantId: input.tenantId,
          userId: input.userId,
          role: input.role,
          draftId: quoteId,
          expectedInputHash: expectedVersion,
          decision: text(payload.decision) as 'approved' | 'rejected',
          note: text(payload.note),
          idempotencyKey: input.request.idempotencyKey,
        });
        return {
          state: 'succeeded',
          message: text(payload.decision) === 'approved'
            ? decisionResult.artifactPending
              ? '报价已批准，报价文件正在生成'
              : '报价已批准，可下载后人工发送'
            : '报价已退回调整',
          result: decisionResult,
        };
      } catch (error) {
        if (error instanceof Starter198RuntimePortError) {
          throw new Starter198CommandError(error.code, error.status);
        }
        throw error;
      }
    }
    if (!input.approvalDecision) throw new Starter198CommandError('starter_198_decision_handler_unavailable', 503);
    const context = await requireStarterApprovalForCommand({
      repository: input.repository, tenantId: input.tenantId, approvalId: targetId,
    });
    return withCommandRunMutationLease({
      repository: input.repository,
      dataStore: input.dataStore,
      tenantId: input.tenantId,
      runId: context.run.id,
      action: async () => {
      const { approval: current, run: currentRun } = await requireStarterApprovalForCommand({
        repository: input.repository, tenantId: input.tenantId, approvalId: targetId,
      });
      if (currentRun.id !== context.run.id) {
        throw new Starter198CommandError('starter_198_workflow_scope_invalid', 503);
      }
      if (text(current.status) !== 'pending') throw new Starter198CommandError('approval_not_pending', 409);
      if (starterVersionString(current.subject_version) !== expectedVersion) throw new Starter198CommandError('approval_subject_changed', 409);
      let decisionResult: Awaited<ReturnType<Starter198ApprovalDecisionPort['decide']>>;
      try {
        decisionResult = await input.approvalDecision!.decide({
          tenantId: input.tenantId,
          userId: input.userId,
          approvalId: targetId,
          expectedSubjectVersion: expectedVersion,
          decision: text(payload.decision) as 'approved' | 'rejected',
          note: text(payload.note),
        });
      } catch (error) {
        if (error instanceof Starter198RuntimePortError) {
          throw new Starter198CommandError(error.code, error.status);
        }
        // The canonical approval application performs several writes. An
        // untyped transport/runtime error cannot prove whether none, some or
        // all of them committed, so keep this journal recoverable.
        throw new Starter198CommandMutationUncertainError();
      }
      if (decisionResult.state !== 'decided' || decisionResult.decision !== text(payload.decision)) {
        throw new Starter198CommandError('approval_already_decided_by_another_command', 409);
      }
      try {
        await persistStarterApprovalMutationEvidence({
          repository: input.repository,
          tenantId: input.tenantId,
          approvalId: targetId,
          decision: text(payload.decision) as 'approved' | 'rejected',
          commandId: input.commandId,
          idempotencyKey: input.request.idempotencyKey,
          requestHash: input.requestHash,
          expectedVersion,
          actorUserId: input.userId,
        });
      } catch (error) {
        if (error instanceof Starter198CommandMutationUncertainError) throw error;
        throw new Starter198CommandMutationUncertainError();
      }
      return { state: 'succeeded', message: text(payload.decision) === 'approved' ? '决策已同意' : '已退回调整' };
      },
    });
  }
  if (command === 'cancel_run') {
    if (!targetId) throw new Starter198CommandError('starter_198_command_target_required', 400);
    const result = await executeStarterCancellationCommand({
      repository: input.repository,
      dataStore: input.dataStore,
      tenantId: input.tenantId,
      userId: input.userId,
      targetId,
      expectedVersion,
      reason: text(payload.reason),
      commandId: input.commandId,
      idempotencyKey: input.request.idempotencyKey,
      requestHash: input.requestHash,
      now: input.now,
    });
    return { state: 'succeeded', ...result };
  }
  if (command === 'submit_quote_send_evidence') {
    if (!targetId || !expectedVersion) throw new Starter198CommandError('starter_198_decision_version_required', 400);
    const draftId = quoteDraftId(targetId);
    if (!draftId) throw new Starter198CommandError('quote_draft_target_invalid', 400);
    if (!input.quoteEvidence) throw new Starter198CommandError('starter_198_quote_evidence_handler_unavailable', 503);
    try {
      const evidence = await input.quoteEvidence.record({
        tenantId: input.tenantId,
        userId: input.userId,
        role: input.role,
        draftId,
        expectedInputHash: expectedVersion,
        channel: text(payload.channel),
        providerReference: text(payload.providerReference),
        idempotencyKey: input.request.idempotencyKey,
      });
      return { state: 'succeeded', message: '人工发送证据已登记，等待验真', result: evidence };
    } catch (error) {
      if (error instanceof Starter198RuntimePortError) throw new Starter198CommandError(error.code, error.status);
      throw error;
    }
  }
  if (command === 'pause_run' || command === 'resume_run') {
    if (!targetId) throw new Starter198CommandError('starter_198_command_target_required', 400);
    const result = await executeStarterRunControlCommand({
      repository: input.repository,
      dataStore: input.dataStore,
      tenantId: input.tenantId,
      command,
      targetId,
      expectedVersion,
      payload,
      now: input.now,
      userId: input.userId,
      commandId: input.commandId,
      idempotencyKey: input.request.idempotencyKey,
      requestHash: input.requestHash,
    });
    return { state: 'succeeded', ...result };
  }
  try {
    if (command === 'generate_publication_package') {
      const contentId = text(payload.contentId);
      const result = await withStarterQuotaScope(`publication:${input.tenantId}:${contentId}`, async () => {
        await assertPublicationPackageQuota({
          repository: input.repository,
          tenantId: input.tenantId,
          contentId,
          limits: input.resourceLimits,
        });
        return input.createPublicationPackage({
          tenantId: input.tenantId,
          contentId,
          contentVersion: text(payload.contentVersion),
          contentHash: text(payload.contentHash),
          platform: payload.platform as BuildStarterPublicationPackageInput['platform'],
          copy: payload.copy as BuildStarterPublicationPackageInput['copy'],
          assets: payload.assets as BuildStarterPublicationPackageInput['assets'],
          ...(text(payload.inquiryUrl) ? { inquiryUrl: text(payload.inquiryUrl) } : {}),
          idempotencyKey: `${input.request.idempotencyKey}:package`,
          now: input.now,
        });
      });
      return {
        state: 'succeeded',
        message: result.created ? '发布包已生成' : '已返回同一发布包',
        result: { package: result.package, created: result.created },
      };
    }
    if (!targetId) throw new Starter198CommandError('starter_198_command_target_required', 400);
    const packageManifest = await input.readPublicationPackage(input.tenantId, targetId);
    if (!packageManifest) throw new Starter198CommandError('publication_package_not_found', 404);
    const result = await input.submitPublicationEvidence({
      tenantId: input.tenantId,
      packageId: targetId,
      contentHash: packageManifest.contentHash,
      ...(text(payload.publicUrl) ? { publicUrl: text(payload.publicUrl) } : {}),
      ...(text(payload.platformPostId) ? { platformPostId: text(payload.platformPostId) } : {}),
      submittedBy: input.userId,
      now: input.now,
    });
    return {
      state: 'succeeded',
      message: result.repeated ? '该发布证据已提交' : '发布证据已提交，等待验真',
      result: { package: result.package, evidence: result.evidence, repeated: result.repeated },
    };
  } catch (error) {
    if (error instanceof Starter198QuotaError) throw new Starter198CommandError(error.code, error.status);
    if (error instanceof StarterPublicationPackageError) throw mapPublicationError(error);
    throw error;
  }
}

export async function runStarter198Command(input: {
  tenantId: string;
  userId: string;
  role: Starter198OrgRole;
  request: StarterWorkspaceCommandInput;
  dependencies?: Starter198CommandDependencies;
}): Promise<{ status: number; body: StarterWorkspaceCommandResult }> {
  const repository = input.dependencies?.repository ?? starter198Repository;
  const dataStore = input.dependencies?.dataStore ?? repository.dataStore;
  const now = input.dependencies?.now?.() ?? new Date();
  const access = await repository.access(input.tenantId);
  const manifest = buildStarter198CapabilityManifest(access, now);
  const command = input.request.command as Starter198Command;
  if (!COMMANDS.has(command)) throw new Starter198CommandError('starter_198_command_unknown', 400);
  if (!starterCommandAllowed(manifest, input.role, command)) {
    throw new Starter198CommandError('starter_198_command_forbidden', 403);
  }
  const payload = input.request.payload ?? {};
  assertPayload(command, payload);
  const requestSubject = { command, targetId: input.request.targetId ?? null, expectedVersion: input.request.expectedVersion ?? null, payload };
  const requestHash = stableHash(requestSubject);
  const key = `${input.tenantId}:${input.request.idempotencyKey}`;
  const retryEvidenceProjection = () => command === 'submit_publication_evidence' && input.request.targetId && dataStore
    ? retryStarterPublicationEvidenceProjection({
      dataStore, repository, tenantId: input.tenantId, packageId: input.request.targetId,
      readPublicationPackage: input.dependencies?.readPublicationPackage ?? readStarterPublicationPackage,
      projector: input.dependencies?.projectPublicationEvidence, now,
    }) : Promise.resolve();
  return serialize(key, async () => {
    const previous = await findCommand(repository, input.tenantId, input.request.idempotencyKey);
    if (previous) {
      if (text(previous.request_hash) !== requestHash || text(previous.command) !== command) {
        throw new Starter198CommandError('starter_198_idempotency_conflict', 409);
      }
      if (text(previous.status) === 'failed') {
        const storedStatus = Number(previous.http_status);
        throw new Starter198CommandError(
          text(previous.error_code) || 'starter_198_command_failed_previous',
          Number.isInteger(storedStatus) && storedStatus >= 400 && storedStatus <= 599 ? storedStatus : 503,
        );
      }
      await assertStarterReplayTargetScope({
        repository, tenantId: input.tenantId, request: input.request,
      });
      if (text(previous.status) === 'processing') {
        const recoveredDurable = await recoverProcessingDurableCommand({
          repository,
          tenantId: input.tenantId,
          userId: input.userId,
          role: input.role,
          request: input.request,
          record: previous,
          initialSetup: input.dependencies?.initialSetup,
          orchestratorQueue: input.dependencies?.orchestratorQueue,
          readPublicationPackage: input.dependencies?.readPublicationPackage ?? readStarterPublicationPackage,
          now,
        });
        if (recoveredDurable) { await retryEvidenceProjection(); return recoveredDurable; }
        const recoveredQuote = await recoverProcessingQuoteCommand({
          repository,
          tenantId: input.tenantId,
          userId: input.userId,
          role: input.role,
          request: input.request,
          record: previous,
          quoteSelfService: input.dependencies?.quoteSelfService,
          now,
        });
        if (recoveredQuote) return recoveredQuote;
        const reconciled = await recoverProcessingAttributedCommand({
          repository,
          dataStore,
          tenantId: input.tenantId,
          request: input.request,
          record: previous,
          now,
        });
        if (reconciled) return reconciled;
        throw new Starter198CommandError('starter_198_command_state_unknown', 409);
      }
      const priorResult = parseStoredResult(previous.result);
      if (!priorResult) throw new Starter198CommandError('starter_198_command_state_unknown', 409);
      await retryEvidenceProjection();
      return { status: text(previous.status) === 'accepted' ? 202 : 200, body: priorResult };
    }
    await preflightStatefulCommand({ repository, tenantId: input.tenantId, request: input.request });
    const commandId = `starter_cmd_${randomUUID().replaceAll('-', '')}`;
    let record: StarterRecord;
    try {
      record = await repository.create(STARTER_COLLECTIONS.commands, input.tenantId, {
        command_id: commandId,
        idempotency_key: input.request.idempotencyKey,
        request_hash: requestHash,
        command,
        target_id: input.request.targetId ?? '',
        expected_version: input.request.expectedVersion ?? '',
        payload: commandAuditPayload(command, payload, input.request.idempotencyKey),
        status: 'processing',
        http_status: 0,
        result: {},
        error_code: '',
        created_by: input.userId,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      });
    } catch (error) {
      if (!(error instanceof Starter198RepositoryError)) throw error;
      const raced = await findCommand(repository, input.tenantId, input.request.idempotencyKey);
      if (raced && text(raced.request_hash) === requestHash && text(raced.command) === command) {
        const result = parseStoredResult(raced.result);
        if (result) return { status: text(raced.status) === 'accepted' ? 202 : 200, body: result };
        if (text(raced.status) === 'processing') {
          return {
            status: 202,
            body: {
              accepted: true,
              commandId: text(raced.command_id) || null,
              message: '相同命令正在处理中，请稍后重试',
            },
          };
        }
      }
      throw new Starter198CommandError(raced ? 'starter_198_idempotency_conflict' : 'starter_198_command_storage_unavailable', raced ? 409 : 503);
    }
    let executed: Awaited<ReturnType<typeof executeCommand>>;
    try {
      executed = await executeCommand({
        request: input.request,
        tenantId: input.tenantId,
        userId: input.userId,
        repository,
        dataStore,
        createPublicationPackage: input.dependencies?.createPublicationPackage ?? createStarterPublicationPackage,
        readPublicationPackage: input.dependencies?.readPublicationPackage ?? readStarterPublicationPackage,
        submitPublicationEvidence: input.dependencies?.submitPublicationEvidence ?? submitStarterPublicationEvidence,
        now,
        commandId,
        requestHash,
        orchestratorQueue: input.dependencies?.orchestratorQueue,
        approvalDecision: input.dependencies?.approvalDecision,
        quoteDecision: input.dependencies?.quoteDecision,
        quoteEvidence: input.dependencies?.quoteEvidence,
        quoteSelfService: input.dependencies?.quoteSelfService,
        initialSetup: input.dependencies?.initialSetup,
        role: input.role,
        resourceLimits: access.resourceLimits,
      });
      await retryEvidenceProjection();
    } catch (error) {
      if (error instanceof Starter198CommandMutationUncertainError) {
        // A target mutation may already be durable but its attribution/final
        // journal write is not. Preserve `processing` for evidence-based
        // recovery; never convert an unknown business outcome into `failed`.
        throw new Starter198CommandError(error.code, 503);
      }
      const failure = error instanceof Starter198CommandError
        ? error
        : new Starter198CommandError('starter_198_command_failed', 503);
      await repository.update(STARTER_COLLECTIONS.commands, input.tenantId, record.id, {
        status: 'failed',
        http_status: failure.status,
        result: { accepted: false, commandId, message: failure.code },
        error_code: failure.code,
        updated_at: now.toISOString(),
      }).catch(() => undefined);
      throw failure;
    }
    const result: StarterWorkspaceCommandResult = { accepted: true, commandId, message: executed.message };
    try {
      await repository.update(STARTER_COLLECTIONS.commands, input.tenantId, record.id, {
        status: executed.state,
        http_status: executed.state === 'accepted' ? 202 : 200,
        result,
        operation_result: executed.result ?? {},
        updated_at: now.toISOString(),
      });
    } catch {
      // The business operation may already have succeeded. Leave the journal
      // in processing so a later read-only reconciliation can observe the
      // target state; never rewrite it as a failed operation and blind-replay.
      throw new Starter198CommandError('starter_198_command_journal_finalize_failed', 503);
    }
    return { status: executed.state === 'accepted' ? 202 : 200, body: result };
  });
}
