import { randomUUID } from 'node:crypto';
import {
  STARTER_CONTENT_RELEASE_APPROVAL_TASK_KEY,
  type AgentTaskEnvelopeV1,
  type AgentTaskResultV1,
} from '../../shared/contracts/starter198.js';
import {
  createStarterPublicationPackage,
  readStarterPublicationPackage,
  StarterPublicationPackageError,
  type StarterPublicationPackage,
} from '../publishing/starterPublicationPackage.js';
import type { DataStore, ListResult } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import {
  buildStarterAgentHandoff,
  completeMeteredStarterAgentTask,
  meterStarterAgentTaskForExecution,
  readConsumablePublicationPackageTask,
  Starter198AgentTaskError,
} from './agentTasks.js';
import { buildStarter198CapabilityManifest, starter198CapabilityAllowed } from './profile.js';
import {
  array,
  contentSubjectFromApproval,
  object,
  readCanonicalStarterContentArtifact,
  sha256Json,
  StarterPublicationPackageWorkerError,
  text,
  type StarterContentSubjectV1,
} from './publicationPackageArtifact.js';
import {
  createStarter198Repository,
  STARTER_COLLECTIONS,
  starter198Repository,
  type Starter198Repository,
  type StarterRecord,
} from './repository.js';
import { starterWorkerRuntimeIssue } from './workerRuntime.js';
import { starterWorkerDataStore } from './workerStorage.js';
import {
  Starter198RunMutationLeaseError,
  withStarter198RunMutationLease,
} from './runMutationLease.js';

const PACKAGE_OUTPUT_SCHEMA = 'starter-publication-package.v1';
const WORKER_LEASE_COLLECTION = 'starter_worker_leases';
const TASK_SCAN_PAGE_SIZE = 100;
const SCANNABLE_TASK_STATUSES = new Set(['ready', 'pending', 'succeeded']);
const localTaskQueues = new Map<string, Promise<void>>();
const PROJECTION_WRITABLE_RUN_STATUSES = new Set([
  'initializing',
  'queued',
  'planning',
  'running',
  'waiting_external',
  'waiting_approval',
  'waiting_human',
]);
const TERMINAL_WORKFLOW_TASK_STATUSES = new Set(['succeeded', 'failed', 'skipped', 'cancelled']);

type PublicationTaskScanCursorV1 = {
  schemaVersion: 'starter-198.publication-task-scan.v1';
  page: number;
  offset: number;
};

const INITIAL_TASK_SCAN_CURSOR: PublicationTaskScanCursorV1 = {
  schemaVersion: 'starter-198.publication-task-scan.v1',
  page: 1,
  offset: 0,
};

function validCursorInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function decodeTaskScanCursor(value: string | null | undefined): PublicationTaskScanCursorV1 {
  if (!value) return { ...INITIAL_TASK_SCAN_CURSOR };
  try {
    if (value.length > 512 || !/^[a-z0-9_-]+$/i.test(value)) throw new Error('invalid');
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== value) throw new Error('invalid');
    const parsed = JSON.parse(decoded) as Partial<PublicationTaskScanCursorV1>;
    if (parsed.schemaVersion !== INITIAL_TASK_SCAN_CURSOR.schemaVersion
      || !validCursorInteger(parsed.page, 1, Number.MAX_SAFE_INTEGER)
      || !validCursorInteger(parsed.offset, 0, TASK_SCAN_PAGE_SIZE - 1)) throw new Error('invalid');
    return parsed as PublicationTaskScanCursorV1;
  } catch {
    throw new StarterPublicationPackageWorkerError('starter_publication_worker_cursor_invalid');
  }
}

function encodeTaskScanCursor(cursor: PublicationTaskScanCursorV1): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function validTaskScanPage(value: {
  items: unknown[];
  totalItems: number;
  totalPages: number;
  page: number;
  perPage: number;
}, expectedPage: number): boolean {
  return Array.isArray(value.items)
    && Number.isFinite(value.totalItems)
    && Number.isInteger(value.totalPages)
    && value.totalPages >= 0
    && value.page === expectedPage
    && value.perPage === TASK_SCAN_PAGE_SIZE;
}

export {
  readCanonicalStarterContentArtifact,
  starterContentSubjectHash,
  StarterPublicationPackageWorkerError,
} from './publicationPackageArtifact.js';
export type {
  CanonicalStarterContentArtifact,
  StarterContentSubjectV1,
} from './publicationPackageArtifact.js';

function taskEnvelope(record: StarterRecord): AgentTaskEnvelopeV1 | null {
  const value = object(record.envelope);
  return value?.schemaVersion === 'starter-198.agent-task.v1'
    ? value as unknown as AgentTaskEnvelopeV1
    : null;
}

function taskResult(input: {
  envelope: AgentTaskEnvelopeV1;
  package: StarterPublicationPackage;
  subject: StarterContentSubjectV1;
}): AgentTaskResultV1 {
  return {
    schemaVersion: 'starter-198.agent-result.v1',
    status: 'succeeded',
    outputs: [{ type: 'starter_publication_package', id: input.package.packageId, version: input.package.packageHash }],
    evidence: [
      { type: 'studio_project', id: input.subject.contentId, version: input.subject.contentVersion },
      { type: 'approval_request', id: input.envelope.inputObjectRefs.find(ref => ref.type === 'approval_request')!.id,
        version: input.envelope.inputObjectRefs.find(ref => ref.type === 'approval_request')!.version },
    ],
    missingFacts: [],
    risks: [],
    requiresDecision: false,
    suggestedNextAction: '用户可在灵小枢下载发布包并自行发布；发布后回填公开 URL 或帖子 ID。',
    checkpoint: {
      publicationState: input.package.status,
      packageId: input.package.packageId,
      packageHash: input.package.packageHash,
      contentHash: input.package.contentHash,
      externalPublishPerformed: false,
      providerInvoked: false,
      calendarEntriesCreated: 0,
    },
  };
}

function blockedResult(envelope: AgentTaskEnvelopeV1, code: string): AgentTaskResultV1 {
  return {
    schemaVersion: 'starter-198.agent-result.v1',
    status: 'blocked',
    outputs: [],
    evidence: envelope.inputObjectRefs,
    missingFacts: [code],
    risks: [{ level: 'L2', code, summary: '已批准内容与当前 canonical 产物不一致，未生成发布包。' }],
    requiresDecision: true,
    suggestedNextAction: '请回到灵小枢确认内容版本；修复后创建新的审批和发布包任务。',
    checkpoint: {
      publicationState: 'blocked',
      errorCode: code,
      externalPublishPerformed: false,
      providerInvoked: false,
      calendarEntriesCreated: 0,
    },
  };
}

function deterministicHandoffId(envelope: AgentTaskEnvelopeV1): string {
  return `handoff_pubpkg_${sha256Json({
    tenantId: envelope.tenantId,
    runId: envelope.runId,
    taskId: envelope.taskId,
    correlationId: envelope.correlationId,
    idempotencyKey: envelope.idempotencyKey,
  }).slice(0, 24)}`;
}

async function serialized<T>(key: string, action: () => Promise<T>): Promise<T> {
  const prior = localTaskQueues.get(key) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = prior.catch(() => undefined).then(() => gate);
  localTaskQueues.set(key, tail);
  await prior.catch(() => undefined);
  try { return await action(); }
  finally {
    release();
    if (localTaskQueues.get(key) === tail) localTaskQueues.delete(key);
  }
}

export interface StarterPublicationPackageWorkerDependencies {
  dataStore?: DataStore;
  repository?: Starter198Repository;
  publishingRoot?: string;
  now?: () => Date;
  createPublicationPackage?: typeof createStarterPublicationPackage;
  leaseDurationMs?: number;
}

export type StarterPublicationTaskOutcome =
  | { state: 'succeeded'; packageId: string; created: boolean }
  | { state: 'already_succeeded' | 'not_ready' | 'ignored' }
  | { state: 'blocked'; code: string };

async function taskRecord(repository: Starter198Repository, tenantId: string, taskId: string): Promise<StarterRecord | null> {
  const result = await repository.list(STARTER_COLLECTIONS.agentTasks, tenantId, {
    where: { task_id: taskId }, perPage: 2,
  });
  if (result.totalItems > 1 || result.items.length > 1) {
    throw new StarterPublicationPackageWorkerError('starter_publication_task_integrity_violation');
  }
  return result.items[0] ?? null;
}

type WorkerLease = { id: string; tenant_id: string; task_id: string; lease_token: string; expires_at: string };

async function acquireWorkerLease(input: {
  dataStore: DataStore;
  tenantId: string;
  taskId: string;
  now: Date;
  durationMs: number;
}): Promise<WorkerLease | null> {
  const existing = await input.dataStore.list<WorkerLease>(WORKER_LEASE_COLLECTION, {
    where: { tenant_id: input.tenantId, task_id: input.taskId }, perPage: 2,
  });
  if (existing.totalItems > 1 || existing.items.length > 1) {
    throw new StarterPublicationPackageWorkerError('starter_publication_worker_lease_integrity_violation', true);
  }
  const current = existing.items[0];
  if (current) {
    if (text(current.tenant_id) !== input.tenantId || text(current.task_id) !== input.taskId) {
      throw new StarterPublicationPackageWorkerError('starter_publication_worker_lease_integrity_violation', true);
    }
    const expiresAt = Date.parse(text(current.expires_at));
    if (!Number.isFinite(expiresAt)) {
      throw new StarterPublicationPackageWorkerError('starter_publication_worker_lease_integrity_violation', true);
    }
    if (expiresAt > input.now.getTime()) return null;
    const latest = await input.dataStore.getById<WorkerLease>(WORKER_LEASE_COLLECTION, current.id);
    if (latest && text(latest.lease_token) === text(current.lease_token)) {
      if (!await input.dataStore.delete(WORKER_LEASE_COLLECTION, current.id)) {
        throw new StarterPublicationPackageWorkerError('starter_publication_worker_lease_unavailable', true);
      }
    }
  }
  const token = randomUUID();
  const expiresAt = new Date(input.now.getTime() + input.durationMs).toISOString();
  const created = await input.dataStore.create<WorkerLease>(WORKER_LEASE_COLLECTION, {
    tenant_id: input.tenantId,
    task_id: input.taskId,
    lease_token: token,
    worker_id: `${process.pid}`,
    acquired_at: input.now.toISOString(),
    expires_at: expiresAt,
  });
  if (!created) return null;
  if (text(created.tenant_id) !== input.tenantId || text(created.task_id) !== input.taskId
    || text(created.lease_token) !== token) {
    throw new StarterPublicationPackageWorkerError('starter_publication_worker_lease_integrity_violation', true);
  }
  return created;
}

async function releaseWorkerLease(dataStore: DataStore, lease: WorkerLease): Promise<void> {
  try {
    const current = await dataStore.getById<WorkerLease>(WORKER_LEASE_COLLECTION, lease.id);
    if (current && text(current.lease_token) === text(lease.lease_token)) {
      await dataStore.delete(WORKER_LEASE_COLLECTION, lease.id);
    }
  } catch (error) {
    console.error('[starter-publication-worker] failed to release lease:', error instanceof Error ? error.message : error);
  }
}

async function persistOutcome(input: {
  repository: Starter198Repository;
  envelope: AgentTaskEnvelopeV1;
  result: AgentTaskResultV1;
  now: Date;
  outputCount: number;
}): Promise<void> {
  const handoff = buildStarterAgentHandoff({
    envelope: input.envelope,
    sourceAgent: 'traffic',
    result: input.result,
    handoffId: deterministicHandoffId(input.envelope),
    now: input.now,
  });
  await completeMeteredStarterAgentTask({
    handoff,
    idempotencyKey: `publication-package-terminal:${sha256Json({
      taskId: input.envelope.taskId,
      result: input.result.status,
    }).slice(0, 48)}`,
    tokens: { status: 'known', inputTokens: 0, outputTokens: 0, cacheTokens: 0 },
    cost: { status: 'known', settledCostCny: 0 },
    outputCount: input.outputCount,
    resourceUnits: { contentArtifacts: 0, contentRevisions: 0, inquiryAi: 0 },
    ...(input.result.status === 'succeeded' ? {} : {
      waitReason: input.result.suggestedNextAction ?? '发布包生成被阻塞',
      anomalyCode: text(input.result.missingFacts[0]) || 'starter_publication_package_blocked',
    }),
    repository: input.repository,
    now: input.now,
  });
}

async function projectionRunIsWritable(input: {
  repository: Starter198Repository;
  tenantId: string;
  runId: string;
}): Promise<boolean> {
  const run = await input.repository.get(STARTER_COLLECTIONS.runs, input.tenantId, input.runId);
  return Boolean(run && PROJECTION_WRITABLE_RUN_STATUSES.has(text(run.status)));
}

async function projectPackageReady(input: {
  dataStore: DataStore;
  repository: Starter198Repository;
  envelope: AgentTaskEnvelopeV1;
  package: StarterPublicationPackage;
  now: Date;
}): Promise<boolean> {
  return withStarter198RunMutationLease({
    tenantId: input.envelope.tenantId, runId: input.envelope.runId, dataStore: input.dataStore,
    action: async () => {
    if (!await projectionRunIsWritable({
      repository: input.repository,
      tenantId: input.envelope.tenantId,
      runId: input.envelope.runId,
    })) return false;

    const tasks = await input.repository.list(STARTER_COLLECTIONS.tasks, input.envelope.tenantId, {
      where: { run_id: input.envelope.runId }, sort: 'sequence', perPage: 500,
    });
    if (tasks.totalItems > tasks.items.length) {
      throw new StarterPublicationPackageWorkerError('starter_publication_workflow_projection_incomplete', true);
    }
    const packageTask = tasks.items.find(item => text(item.task_key) === 'starter_publication_package');
    const evidenceTask = tasks.items.find(item => text(item.task_key) === 'starter_publication_evidence');
    if (packageTask) {
      const currentTask = await input.repository.get(
        STARTER_COLLECTIONS.tasks,
        input.envelope.tenantId,
        packageTask.id,
      );
      if (!currentTask || !await projectionRunIsWritable({
        repository: input.repository,
        tenantId: input.envelope.tenantId,
        runId: input.envelope.runId,
      })) return false;
      const currentStatus = text(currentTask.status);
      if (currentStatus === 'failed' || currentStatus === 'skipped' || currentStatus === 'cancelled') return false;
      if (!TERMINAL_WORKFLOW_TASK_STATUSES.has(currentStatus)) {
        await input.repository.update(STARTER_COLLECTIONS.tasks, input.envelope.tenantId, packageTask.id, {
          status: 'succeeded',
          output: {
            schemaVersion: 'starter-198.publication-package-output.v1',
            packageId: input.package.packageId,
            packageHash: input.package.packageHash,
            contentId: input.package.contentId,
            contentVersion: input.package.contentVersion,
            status: input.package.status,
            externalPublishPerformed: false,
          },
          blocked_reason: '',
          updated_at: input.now.toISOString(),
        });
      }
    }
    if (evidenceTask) {
      const currentTask = await input.repository.get(
        STARTER_COLLECTIONS.tasks,
        input.envelope.tenantId,
        evidenceTask.id,
      );
      if (!currentTask || !await projectionRunIsWritable({
        repository: input.repository,
        tenantId: input.envelope.tenantId,
        runId: input.envelope.runId,
      })) return false;
      const currentStatus = text(currentTask.status);
      if (currentStatus === 'failed' || currentStatus === 'cancelled') return false;
      if (!TERMINAL_WORKFLOW_TASK_STATUSES.has(currentStatus)) {
        await input.repository.update(STARTER_COLLECTIONS.tasks, input.envelope.tenantId, evidenceTask.id, {
          status: 'waiting_external',
          output: {
            schemaVersion: 'starter-198.publication-evidence-wait.v1',
            packageId: input.package.packageId,
            contentHash: input.package.contentHash,
            evidenceVerified: false,
            externalPublishPerformed: false,
          },
          blocked_reason: '发布包已生成，等待用户自行发布并回填可核验证据',
          updated_at: input.now.toISOString(),
        });
      }
    }

    // The shared durable lease closes cross-worker lifecycle races. These task
    // and run writes are not one transaction; succeeded-task replay repairs a
    // crash between them without manufacturing another package.
    if (!await projectionRunIsWritable({
      repository: input.repository,
      tenantId: input.envelope.tenantId,
      runId: input.envelope.runId,
    })) return false;
    await input.repository.update(STARTER_COLLECTIONS.runs, input.envelope.tenantId, input.envelope.runId, {
      status: 'waiting_human',
      current_controller: 'human',
      pause_reason: '灵小量已生成发布包；等待用户自行发布并回填公开 URL 或平台帖子 ID。',
    });
    return true;
    },
  });
}

async function repairSucceededProjection(input: {
  dataStore: DataStore;
  repository: Starter198Repository;
  task: StarterRecord;
  now: Date;
}): Promise<boolean> {
  const envelope = taskEnvelope(input.task);
  const result = object(input.task.result);
  const outputs = array(result?.outputs).map(object).filter((item): item is Record<string, unknown> => Boolean(item));
  const packageRef = outputs.find(item => text(item.type) === 'starter_publication_package');
  if (!envelope || envelope.expectedOutputSchema !== PACKAGE_OUTPUT_SCHEMA
    || result?.schemaVersion !== 'starter-198.agent-result.v1'
    || text(result.status) !== 'succeeded'
    || !packageRef) return false;
  return withStarter198RunMutationLease({
    tenantId: envelope.tenantId, runId: envelope.runId, dataStore: input.dataStore,
    action: async () => {
      const publication = await readStarterPublicationPackage(
        envelope.tenantId, text(packageRef.id), input.dataStore,
      );
      if (!publication || publication.packageHash !== text(packageRef.version)) {
        throw new StarterPublicationPackageWorkerError('starter_publication_completed_result_invalid', true);
      }
      await projectPackageReady({
        dataStore: input.dataStore, repository: input.repository,
        envelope, package: publication, now: input.now,
      });
      return true;
    },
  });
}

function runMutationBusy(error: unknown): boolean {
  return error instanceof Starter198RunMutationLeaseError
    && error.code === 'starter_run_mutation_busy';
}

/** Consume one durable, approval-gated package task. No external provider is reachable from this service. */
export async function consumeStarterPublicationPackageTask(input: {
  tenantId: string;
  taskId: string;
  dependencies?: StarterPublicationPackageWorkerDependencies;
}): Promise<StarterPublicationTaskOutcome> {
  const dependencies = input.dependencies ?? {};
  const configuredDataStore = dependencies.dataStore ?? store;
  const dataStore = starterWorkerDataStore(configuredDataStore);
  const repository = dependencies.repository ?? (dataStore === store
    ? starter198Repository
    : createStarter198Repository(dataStore));
  const now = dependencies.now?.() ?? new Date();
  return serialized(`${input.tenantId}:${input.taskId}`, async () => {
    const initialTask = await taskRecord(repository, input.tenantId, input.taskId);
    if (!initialTask) return { state: 'ignored' };
    if (text(initialTask.status) === 'succeeded') {
      try {
        return await repairSucceededProjection({ dataStore, repository, task: initialTask, now })
          ? { state: 'already_succeeded' }
          : { state: 'ignored' };
      } catch (error) {
        if (runMutationBusy(error)) return { state: 'ignored' };
        throw error;
      }
    }
    const configuredLease = dependencies.leaseDurationMs ?? Number(process.env.STARTER_PUBLICATION_PACKAGE_WORKER_LEASE_MS || 30 * 60_000);
    const leaseDurationMs = Number.isFinite(configuredLease)
      ? Math.min(Math.max(Math.floor(configuredLease), 60_000), 2 * 60 * 60_000)
      : 30 * 60_000;
    const lease = await acquireWorkerLease({
      dataStore,
      tenantId: input.tenantId,
      taskId: input.taskId,
      now,
      durationMs: leaseDurationMs,
    });
    if (!lease) return { state: 'ignored' };
    try {
    let task = await taskRecord(repository, input.tenantId, input.taskId);
    if (!task) return { state: 'ignored' };
    if (text(task.status) === 'succeeded') return { state: 'already_succeeded' };
    // Backfill old pending rows produced before enqueue-time metering. The
    // reservation is idempotent and explicitly zero because this worker only
    // assembles a local manifest; it performs no LLM or provider call.
    if (text(task.status) === 'pending') {
      await meterStarterAgentTaskForExecution({
        tenantId: input.tenantId,
        taskId: input.taskId,
        capability: 'publishing.package.generate',
        cost: { status: 'known', estimatedCostCny: 0, reservedCostCny: 0 },
        resourceUnits: { contentArtifacts: 0, contentRevisions: 0, inquiryAi: 0 },
        repository,
        now,
      });
      task = await taskRecord(repository, input.tenantId, input.taskId);
      if (!task) throw new StarterPublicationPackageWorkerError('starter_publication_task_storage_unavailable', true);
    }
    if (text(task.status) !== 'ready') return { state: 'ignored' };
    const envelope = await readConsumablePublicationPackageTask(input.tenantId, input.taskId, repository);
    if (!envelope) return { state: 'not_ready' };
    if (envelope.targetAgent !== 'traffic' || envelope.expectedOutputSchema !== PACKAGE_OUTPUT_SCHEMA) {
      return { state: 'ignored' };
    }
    const access = await repository.access(input.tenantId);
    const manifest = buildStarter198CapabilityManifest(access, now);
    if (access.entitlementSnapshotId !== envelope.entitlementSnapshotId
      || !starter198CapabilityAllowed(manifest, 'publishing.package.generate')) {
      return { state: 'not_ready' };
    }
    const approvalRef = envelope.inputObjectRefs.find(ref => ref.type === 'approval_request');
    const approvalTaskRef = envelope.inputObjectRefs.find(ref => ref.type === 'workflow_task');
    if (!approvalRef || !approvalTaskRef) {
      throw new StarterPublicationPackageWorkerError('starter_publication_task_reference_invalid');
    }
    const [approval, approvalTask] = await Promise.all([
      repository.get(STARTER_COLLECTIONS.approvals, input.tenantId, approvalRef.id),
      repository.get(STARTER_COLLECTIONS.tasks, input.tenantId, approvalTaskRef.id),
    ]);
    if (!approval || !approvalTask
      || text(approval.run_id) !== envelope.runId
      || text(approval.task_id) !== approvalTask.id
      || text(approvalTask.task_key) !== STARTER_CONTENT_RELEASE_APPROVAL_TASK_KEY) {
      throw new StarterPublicationPackageWorkerError('starter_publication_approval_context_invalid');
    }
    const approvalOutput = object(approvalTask.output);
    if (text(approvalTask.status) !== 'succeeded'
      || text(approvalOutput?.publicationPackageTaskId) !== envelope.taskId
      || approvalOutput?.externalPublishPerformed !== false) {
      return { state: 'not_ready' };
    }

    try {
      const frozen = contentSubjectFromApproval(approval);
      if (frozen.tenantId !== envelope.tenantId
        || frozen.runId !== envelope.runId
        || frozen.contentHash !== envelope.factSetVersion
        || frozen.contentHash !== text(approval.content_hash).toLowerCase()) {
        throw new StarterPublicationPackageWorkerError('starter_publication_subject_changed');
      }
      const canonical = await readCanonicalStarterContentArtifact({
        tenantId: envelope.tenantId,
        runId: envelope.runId,
        contentId: frozen.contentId,
        dataStore,
        ...(dependencies.publishingRoot ? { publishingRoot: dependencies.publishingRoot } : {}),
      });
      if (canonical.subject.contentVersion !== frozen.contentVersion
        || canonical.subject.contentHash !== frozen.contentHash) {
        throw new StarterPublicationPackageWorkerError('starter_publication_content_changed');
      }
      const createPackage = dependencies.createPublicationPackage ?? createStarterPublicationPackage;
      const packageResult = await createPackage({
        ...canonical.publication,
        workflowBinding: {
          schemaVersion: 'starter-198.publication-workflow-binding.v1',
          runId: envelope.runId,
          approvalId: approvalRef.id,
          approvalTaskId: approvalTaskRef.id,
          agentTaskId: envelope.taskId,
        },
        idempotencyKey: envelope.idempotencyKey,
        now,
      }, dataStore);
      if (!['awaiting_user_publish', 'evidence_submitted', 'evidence_rejected'].includes(packageResult.package.status)) {
        throw new StarterPublicationPackageWorkerError('starter_publication_package_state_invalid');
      }
      const result = taskResult({ envelope, package: packageResult.package, subject: canonical.subject });
      await persistOutcome({
        repository,
        envelope,
        result,
        now,
        outputCount: 1,
      });
      try {
        await projectPackageReady({ dataStore, repository, envelope, package: packageResult.package, now });
      } catch (error) {
        if (runMutationBusy(error)) return { state: 'ignored' };
        throw error;
      }
      return { state: 'succeeded', packageId: packageResult.package.packageId, created: packageResult.created };
    } catch (error) {
      const normalized = error instanceof StarterPublicationPackageWorkerError
        ? error
        : error instanceof StarterPublicationPackageError || error instanceof Starter198AgentTaskError
          ? new StarterPublicationPackageWorkerError(error.code, error.code.includes('storage_unavailable'))
          : null;
      if (!normalized || normalized.retryable) throw error;
      await persistOutcome({
        repository,
        envelope,
        result: blockedResult(envelope, normalized.code),
        now,
        outputCount: 0,
      });
      return { state: 'blocked', code: normalized.code };
    }
    } finally {
      await releaseWorkerLease(dataStore, lease);
    }
  });
}

export interface StarterPublicationPackageWorkerCycleResult {
  scanned: number;
  pageReads: number;
  succeeded: number;
  blocked: number;
  notReady: number;
  ignored: number;
  errors: Array<{ tenantId: string; taskId: string; code: string }>;
  nextCursor: string | null;
  scanComplete: boolean;
}

/**
 * Bounded polling adapter. A database lease elects one consumer per task;
 * package, usage and handoff writes remain idempotent for crash recovery.
 */
export async function runStarterPublicationPackageWorkerCycle(input: {
  dependencies?: StarterPublicationPackageWorkerDependencies;
  maxTasks?: number;
  cursor?: string | null;
} = {}): Promise<StarterPublicationPackageWorkerCycleResult> {
  const dependencies = input.dependencies ?? {};
  const dataStore = starterWorkerDataStore(dependencies.dataStore ?? store);
  const configuredMaxTasks = input.maxTasks ?? 25;
  const maxTasks = Number.isFinite(configuredMaxTasks)
    ? Math.min(Math.max(Math.floor(configuredMaxTasks), 1), 200)
    : 25;
  const maxPageReads = Math.ceil((maxTasks + TASK_SCAN_PAGE_SIZE - 1) / TASK_SCAN_PAGE_SIZE) + 1;
  const cursor = decodeTaskScanCursor(input.cursor);
  const result: StarterPublicationPackageWorkerCycleResult = {
    scanned: 0,
    pageReads: 0,
    succeeded: 0,
    blocked: 0,
    notReady: 0,
    ignored: 0,
    errors: [],
    nextCursor: null,
    scanComplete: false,
  };
  let loadedPageNumber = 0;
  let loadedPage: ListResult<StarterRecord> | null = null;

  // Scan one stable population instead of separate mutable status buckets.
  // A ready task remains in this ordering after it succeeds, so advancing the
  // cursor cannot skip the record that followed it. Invalid envelopes,
  // not-ready tasks and tasks leased by another process all consume one unit
  // of the hard scan budget and therefore cannot pin the worker to page one.
  while (result.scanned < maxTasks) {
    if (!loadedPage || loadedPageNumber !== cursor.page) {
      if (result.pageReads >= maxPageReads) break;
      loadedPage = await dataStore.list<StarterRecord>(STARTER_COLLECTIONS.agentTasks, {
        where: { target_agent: 'traffic' },
        sort: 'created_at,id',
        page: cursor.page,
        perPage: TASK_SCAN_PAGE_SIZE,
      });
      loadedPageNumber = cursor.page;
      result.pageReads += 1;
    }
    const batch = loadedPage;
    if (!validTaskScanPage(batch, cursor.page)) {
      throw new StarterPublicationPackageWorkerError('starter_publication_worker_scan_invalid', true);
    }
    if (cursor.offset >= batch.items.length) {
      if (cursor.page < batch.totalPages) {
        cursor.page += 1;
        cursor.offset = 0;
        continue;
      }
      result.scanComplete = true;
      break;
    }

    const record = batch.items[cursor.offset]!;
    const isLastRecord = cursor.page >= batch.totalPages && cursor.offset + 1 >= batch.items.length;
    cursor.offset += 1;
    if (cursor.offset >= TASK_SCAN_PAGE_SIZE) {
      cursor.page += 1;
      cursor.offset = 0;
    }
    result.scanned += 1;

    const tenantId = text(record.tenant_id);
    const taskId = text(record.task_id);
    const envelope = taskEnvelope(record);
    if (text(record.target_agent) !== 'traffic'
      || !SCANNABLE_TASK_STATUSES.has(text(record.status))
      || envelope?.expectedOutputSchema !== PACKAGE_OUTPUT_SCHEMA
      || !tenantId
      || !taskId) {
      result.ignored += 1;
    } else {
      try {
        const outcome = await consumeStarterPublicationPackageTask({ tenantId, taskId, dependencies });
        if (outcome.state === 'succeeded') result.succeeded += 1;
        else if (outcome.state === 'blocked') result.blocked += 1;
        else if (outcome.state === 'not_ready') result.notReady += 1;
        else result.ignored += 1;
      } catch (error) {
        result.errors.push({
          tenantId,
          taskId,
          code: error instanceof Error ? error.message : 'starter_publication_worker_failed',
        });
      }
    }

    if (isLastRecord) {
      result.scanComplete = true;
      break;
    }
  }
  result.nextCursor = result.scanComplete ? null : encodeTaskScanCursor(cursor);
  return result;
}

let timer: ReturnType<typeof setInterval> | null = null;
let cycleRunning = false;
let taskScanCursor: string | null = null;

async function guardedCycle(): Promise<void> {
  if (cycleRunning) return;
  cycleRunning = true;
  try {
    const result = await runStarterPublicationPackageWorkerCycle({ cursor: taskScanCursor });
    taskScanCursor = result.nextCursor;
    if (result.succeeded || result.blocked || result.errors.length) {
      console.log(`[starter-publication-worker] scanned=${result.scanned} succeeded=${result.succeeded} blocked=${result.blocked} errors=${result.errors.length}`);
    }
    for (const error of result.errors) {
      console.error(`[starter-publication-worker] task ${error.taskId} (${error.tenantId}) failed: ${error.code}`);
    }
  } catch (error) {
    console.error('[starter-publication-worker] cycle failed:', error instanceof Error ? error.message : error);
  } finally {
    cycleRunning = false;
  }
}

export function initStarterPublicationPackageWorker(): void {
  const runtimeIssue = starterWorkerRuntimeIssue('STARTER_PUBLICATION_PACKAGE_WORKER_ENABLED');
  if (runtimeIssue || timer) {
    if (runtimeIssue && runtimeIssue !== 'not_explicitly_enabled') {
      console.error(`[starter-publication-worker] not started: ${runtimeIssue}`);
    }
    return;
  }
  const configured = Number(process.env.STARTER_PUBLICATION_PACKAGE_WORKER_INTERVAL_MS || 15_000);
  const intervalMs = Number.isFinite(configured) ? Math.min(Math.max(Math.floor(configured), 5_000), 15 * 60_000) : 15_000;
  void guardedCycle();
  timer = setInterval(() => { void guardedCycle(); }, intervalMs);
  timer.unref?.();
  console.log(`[starter-publication-worker] enabled interval=${intervalMs}ms; durable per-task leases active`);
}

export function stopStarterPublicationPackageWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
