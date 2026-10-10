import type {
  Starter198InitialSetupInput,
  Starter198OrgRole,
  StarterWorkspaceCommandInput,
  StarterWorkspaceCommandResult,
} from '../../shared/contracts/starter198.js';
import {
  buildPublicationEvidenceSubmission,
  StarterPublicationPackageError,
  type PublicationEvidenceSubmission,
  type StarterPublicationPackage,
} from '../publishing/starterPublicationPackage.js';
import { Starter198CommandError } from './commandValidation.js';
import {
  executeStarter198InitialSetupCommand,
  resumeStarter198WaitingInput,
} from './initialSetupCommand.js';
import { starter198InitialSetupFingerprint } from './initialSetup.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import type {
  Starter198InitialSetupPort,
  Starter198OrchestratorQueuePort,
} from './runtimePorts.js';

type ProcessingCommandRecord = StarterRecord & { command_id?: unknown; created_by?: unknown };
type PublicationRead = (tenantId: string, packageId: string) => Promise<StarterPublicationPackage | null>;

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const originalActor = (input: RecoveryInput): string => text(input.record.created_by) || input.userId;

function object(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function assertComplete(items: StarterRecord[], totalItems: number, code: string): void {
  if (!Number.isFinite(totalItems) || totalItems > items.length || items.length > 1) {
    throw new Starter198CommandError(code, 503);
  }
}

async function finalize(input: {
  repository: Starter198Repository;
  tenantId: string;
  record: ProcessingCommandRecord;
  state: 'accepted' | 'succeeded';
  message: string;
  operationResult?: Record<string, unknown>;
  now: Date;
}): Promise<{ status: 200 | 202; body: StarterWorkspaceCommandResult }> {
  const commandId = text(input.record.command_id) || null;
  const body: StarterWorkspaceCommandResult = { accepted: true, commandId, message: input.message };
  const status = input.state === 'accepted' ? 202 : 200;
  try {
    await input.repository.update(STARTER_COLLECTIONS.commands, input.tenantId, input.record.id, {
      status: input.state,
      http_status: status,
      result: body,
      operation_result: input.operationResult ?? {},
      error_code: '',
      updated_at: input.now.toISOString(),
    });
  } catch {
    throw new Starter198CommandError('starter_198_command_journal_finalize_failed', 503);
  }
  return { status, body };
}

async function recoverOrchestratorInput(input: RecoveryInput) {
  const found = await input.repository.list(STARTER_COLLECTIONS.orchestratorInbox, input.tenantId, {
    where: { idempotency_key: input.request.idempotencyKey }, perPage: 2,
  });
  assertComplete(found.items, found.totalItems, 'starter_198_orchestrator_inbox_integrity_violation');
  const inbox = found.items[0];
  if (!inbox) return null;
  if (text(inbox.command_id) !== text(input.record.command_id)) {
    throw new Starter198CommandError('starter_198_orchestrator_inbox_integrity_violation', 503);
  }
  const disposition = text(inbox.disposition);
  const status = text(inbox.status);
  const valid = (disposition === 'queued' && ['pending', 'succeeded'].includes(status))
    || (disposition === 'attached_to_run' && ['pending', 'succeeded'].includes(status))
    || (disposition === 'awaiting_initial_confirmation' && status === 'waiting_user')
    || (disposition === 'resumed_after_setup' && status === 'succeeded');
  const queueItemId = text(inbox.queue_item_id);
  if (!valid || !queueItemId) return null;
  const message = disposition === 'queued'
    ? '7 日标准工作流已创建，等待执行器领取'
    : disposition === 'attached_to_run'
      ? '补充已绑定当前运行，等待灵小枢处理'
      : disposition === 'awaiting_initial_confirmation'
        ? '目标已保存，请先补齐开工卡中的必要资料'
        : '目标已进入灵小枢任务队列';
  return finalize({
    ...input,
    state: 'accepted',
    message,
    operationResult: {
      queueItemId,
      disposition,
      runId: text(inbox.run_id) || null,
      missingFacts: stringArray(inbox.missing_facts),
    },
  });
}

async function recoverInitialSetup(input: RecoveryInput) {
  if (!input.initialSetup) return null;
  const configs = await input.repository.list(STARTER_COLLECTIONS.configurations, input.tenantId, { perPage: 2 });
  assertComplete(configs.items, configs.totalItems, 'starter_198_initial_setup_integrity_violation');
  const current = configs.items[0];
  if (!current) {
    const executed = await executeStarter198InitialSetupCommand({
      ...input,
      userId: originalActor(input),
      initialSetup: input.initialSetup,
      commandId: text(input.record.command_id),
    });
    return finalize({ ...input, ...executed, operationResult: executed.result });
  }
  const effective = object(current.effective_config);
  const setup = object(effective?.initialSetup);
  if (text(setup?.idempotencyKey) !== input.request.idempotencyKey) return null;
  const requestHash = starter198InitialSetupFingerprint(
    (input.request.payload ?? {}) as unknown as Starter198InitialSetupInput,
  );
  if (text(setup?.requestHash) !== requestHash) {
    throw new Starter198CommandError('starter_198_initial_setup_integrity_violation', 503);
  }
  const configVersion = Number(current.config_version);
  const factsVersion = text(current.facts_version);
  if (!Number.isSafeInteger(configVersion) || configVersion < 1 || !factsVersion) {
    throw new Starter198CommandError('starter_198_initial_setup_integrity_violation', 503);
  }
  const resumed = await resumeStarter198WaitingInput({
    ...input,
    userId: originalActor(input),
    commandId: text(input.record.command_id),
  });
  const message = resumed?.runId
    ? '开工资料已固化，先前目标已自动进入灵小枢任务队列'
    : '开工资料已确认';
  return finalize({
    ...input,
    state: 'succeeded',
    message,
    operationResult: { configVersion, factsVersion, repeated: true, resumed },
  });
}

async function recoverPublicationPackage(input: RecoveryInput) {
  if (!input.readPublicationPackage) return null;
  const found = await input.repository.list(STARTER_COLLECTIONS.publicationPackages, input.tenantId, {
    where: { idempotency_key: `${input.request.idempotencyKey}:package` }, perPage: 2,
  });
  assertComplete(found.items, found.totalItems, 'publication_package_integrity_violation');
  const record = found.items[0];
  const packageId = text(record?.package_id);
  if (!record || !packageId) return null;
  const publicationPackage = await input.readPublicationPackage(input.tenantId, packageId);
  if (!publicationPackage) throw new Starter198CommandError('publication_package_integrity_violation', 503);
  return finalize({
    ...input,
    state: 'succeeded',
    message: '已返回同一发布包',
    operationResult: { package: publicationPackage, created: false },
  });
}

async function recoverPublicationEvidence(input: RecoveryInput) {
  const packageId = text(input.request.targetId);
  if (!packageId || !input.readPublicationPackage) return null;
  const found = await input.repository.list(STARTER_COLLECTIONS.publicationPackages, input.tenantId, {
    where: { package_id: packageId }, perPage: 2,
  });
  assertComplete(found.items, found.totalItems, 'publication_package_integrity_violation');
  const stored = found.items[0];
  if (!stored || !['evidence_submitted', 'published', 'evidence_rejected'].includes(text(stored.status))) return null;
  const publicationPackage = await input.readPublicationPackage(input.tenantId, packageId);
  const evidence = object(stored.evidence) as (PublicationEvidenceSubmission & Record<string, unknown>) | null;
  if (!publicationPackage || !evidence) {
    throw new Starter198CommandError('publication_package_integrity_violation', 503);
  }
  try {
    const submittedAt = Date.parse(text(evidence.submittedAt));
    if (!Number.isFinite(submittedAt) || submittedAt > input.now.getTime()) return null;
    const expected = buildPublicationEvidenceSubmission({
      package: publicationPackage,
      contentHash: publicationPackage.contentHash,
      ...(text(input.request.payload?.publicUrl) ? { publicUrl: text(input.request.payload?.publicUrl) } : {}),
      ...(text(input.request.payload?.platformPostId) ? { platformPostId: text(input.request.payload?.platformPostId) } : {}),
      submittedBy: originalActor(input),
      // The evidence hash binds the original audit timestamp. Recovery must
      // validate that persisted instant, never replace it with retry time.
      now: new Date(submittedAt),
    });
    if (text(evidence.evidenceHash) !== expected.evidenceHash
      || text(evidence.submittedBy) !== originalActor(input)
      || text(evidence.packageId) !== packageId) return null;
  } catch (error) {
    if (error instanceof StarterPublicationPackageError) {
      throw new Starter198CommandError(error.code, 409);
    }
    throw error;
  }
  return finalize({
    ...input,
    state: 'succeeded',
    message: text(stored.status) === 'published' ? '发布证据已登记并完成验真' : '该发布证据已提交',
    operationResult: { package: publicationPackage, evidence, repeated: true },
  });
}

type RecoveryInput = {
  repository: Starter198Repository;
  tenantId: string;
  userId: string;
  role: Starter198OrgRole;
  request: StarterWorkspaceCommandInput;
  record: ProcessingCommandRecord;
  initialSetup?: Starter198InitialSetupPort;
  orchestratorQueue?: Starter198OrchestratorQueuePort;
  readPublicationPackage?: PublicationRead;
  now: Date;
};

/**
 * Reconciles commands only from tenant-scoped durable facts or replay-safe
 * initial setup. A missing fact returns null so the caller preserves the
 * explicit unknown state instead of guessing or replaying external effects.
 */
export async function recoverProcessingDurableCommand(
  input: RecoveryInput,
): Promise<{ status: 200 | 202; body: StarterWorkspaceCommandResult } | null> {
  switch (input.request.command) {
    case 'submit_orchestrator_input': return recoverOrchestratorInput(input);
    case 'confirm_initial_setup': return recoverInitialSetup(input);
    case 'generate_publication_package': return recoverPublicationPackage(input);
    case 'submit_publication_evidence': return recoverPublicationEvidence(input);
    default: return null;
  }
}
