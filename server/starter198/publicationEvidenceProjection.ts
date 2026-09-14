import { STARTER_198_PROFILE_VERSION } from '../../shared/contracts/starter198.js';
import {
  readStarterPublicationEvidenceSnapshot,
  StarterPublicationPackageError,
  type StarterPublicationEvidenceSnapshot,
  type VerifiedPublicationEvidence,
} from '../publishing/starterPublicationPackage.js';
import type { DataStore } from '../storage/datastore.js';
import {
  createStarter198Repository,
  STARTER_COLLECTIONS,
  type Starter198Repository,
  type StarterRecord,
} from './repository.js';
import { Starter198RunMutationLeaseError, withStarter198RunMutationLease } from './runMutationLease.js';
import { object, stableHash, stringArray, text } from './orchestratorWorkerValues.js';
import { contentSubjectFromApproval, StarterPublicationPackageWorkerError } from './publicationPackageArtifact.js';
import {
  listStarter198PendingApprovals,
  starter198RunInScope,
  starter198TaskInScope,
  STARTER_198_STANDARD_TASK_KEYS,
} from './workflowScope.js';

const PACKAGE_TASK_KEY = 'starter_publication_package';
const EVIDENCE_TASK_KEY = 'starter_publication_evidence';
const APPROVAL_TASK_KEY = 'starter_content_release_approval';
const CLOSED_RUN_STATUSES = new Set([
  'waiting_approval', 'paused', 'cancelling', 'cancelled', 'failed', 'succeeded', 'completed',
]);
const PROJECTABLE_RUN_STATUSES = new Set(['queued', 'running', 'waiting_external', 'waiting_human']);
const HASH = /^[a-f0-9]{64}$/;
const NO_EFFECTS = Object.freeze({
  sourceReadOnly: true,
  providerCalls: 0,
  externalEffectsPerformed: false,
});

const exactKeys = (value: Record<string, unknown>, keys: string[]): boolean => (
  Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000')
);

export type StarterPublicationEvidenceProjectionOutput = {
  schemaVersion: 'starter-198.publication-evidence-output.v1';
  executionStatus: 'completed' | 'waiting_external';
  verificationStatus: 'not_submitted' | 'pending' | 'rejected' | 'verified';
  runId: string;
  taskId: string;
  packageId: string;
  packageHash: string;
  contentId: string;
  contentVersion: string;
  contentHash: string;
  platform: string;
  evidenceHash: string;
  verifier: string;
  verifiedAt: string;
  verificationReceiptHash: string;
  reasonCode: string;
  bindingHash: string;
  sourceReadOnly: true;
  providerCalls: 0;
  externalEffectsPerformed: false;
  outputHash: string;
};

export interface StarterPublicationEvidenceProjectionResult {
  state: 'ready' | 'waiting' | 'ignored';
  reason: string;
  taskUpdated: boolean;
  runTransitioned: boolean;
}

export class StarterPublicationEvidenceProjectionError extends Error {
  constructor(readonly code: string, readonly retryable = false) {
    super(code);
    this.name = 'StarterPublicationEvidenceProjectionError';
  }
}

const ignored = (reason: string): StarterPublicationEvidenceProjectionResult => ({
  state: 'ignored', reason, taskUpdated: false, runTransitioned: false,
});

function completeTasks(input: {
  items: StarterRecord[];
  totalItems: number;
  tenantId: string;
  runId: string;
}): Map<string, StarterRecord> {
  const keys = input.items.map(task => text(task.task_key));
  if (input.totalItems !== input.items.length
    || input.items.length !== STARTER_198_STANDARD_TASK_KEYS.length
    || new Set(keys).size !== keys.length
    || stableHash(keys) !== stableHash(STARTER_198_STANDARD_TASK_KEYS)
    || input.items.some((task, index) => !starter198TaskInScope(task, input.tenantId, input.runId)
      || Number(task.sequence) !== index + 1)) {
    throw new StarterPublicationEvidenceProjectionError('starter_publication_evidence_graph_invalid');
  }
  return new Map(input.items.map(task => [text(task.task_key), task]));
}

function expectedTaskContract(input: {
  task: StarterRecord;
  tenantId: string;
  runId: string;
  key: typeof PACKAGE_TASK_KEY | typeof EVIDENCE_TASK_KEY;
}): boolean {
  const evidence = input.key === EVIDENCE_TASK_KEY;
  return starter198TaskInScope(input.task, input.tenantId, input.runId)
    && text(input.task.policy_source) === STARTER_198_PROFILE_VERSION
    && text(input.task.task_key) === input.key
    && text(input.task.agent_role) === 'traffic'
    && text(input.task.business_domain) === 'publishing'
    && text(input.task.capability_key) === (evidence ? 'publishing.evidence.submit' : 'publishing.package.generate')
    && text(input.task.execution_mode) === (evidence ? 'observe' : 'internal')
    && text(input.task.external_effect) === (evidence ? 'none' : 'draft')
    && input.task.automatic_execution_allowed === true
    && stableHash(stringArray(input.task.depends_on)) === stableHash([
      evidence ? PACKAGE_TASK_KEY : APPROVAL_TASK_KEY,
    ]);
}

function packageTaskMatches(task: StarterRecord, snapshot: StarterPublicationEvidenceSnapshot): boolean {
  const output = object(task.output);
  const packageManifest = snapshot.package;
  return Boolean(output) && exactKeys(output!, [
    'schemaVersion', 'packageId', 'packageHash', 'contentId', 'contentVersion',
    'status', 'externalPublishPerformed',
  ])
    && text(task.status) === 'succeeded'
    && output?.schemaVersion === 'starter-198.publication-package-output.v1'
    && text(output.packageId) === packageManifest.packageId
    && text(output.packageHash) === packageManifest.packageHash
    && text(output.contentId) === packageManifest.contentId
    && text(output.contentVersion) === packageManifest.contentVersion
    && ['awaiting_user_publish', 'evidence_submitted', 'evidence_rejected'].includes(text(output.status))
    && output.externalPublishPerformed === false;
}

function approvalMatchesPackage(input: {
  task: StarterRecord;
  approval: StarterRecord;
  snapshot: StarterPublicationEvidenceSnapshot;
  tenantId: string;
  runId: string;
}): boolean {
  const output = object(input.task.output);
  if (!starter198TaskInScope(input.task, input.tenantId, input.runId)
    || text(input.task.task_key) !== APPROVAL_TASK_KEY
    || text(input.task.agent_role) !== 'content'
    || text(input.task.business_domain) !== 'content'
    || text(input.task.capability_key) !== 'orchestrator.decision.resolve'
    || text(input.task.execution_mode) !== 'approval'
    || text(input.task.external_effect) !== 'none'
    || input.task.automatic_execution_allowed !== false
    || stableHash(stringArray(input.task.depends_on)) !== stableHash(['starter_content_quality_gate'])
    || text(input.task.status) !== 'succeeded'
    || !output || !exactKeys(output, [
      'decision', 'note', 'approvedAt', 'publicationPackageTaskId',
      'publicationState', 'externalPublishPerformed',
    ])
    || output?.decision !== 'approved'
    || !text(output.publicationPackageTaskId)
    || output.publicationState !== 'package_generation_queued'
    || output.externalPublishPerformed !== false
    || !Number.isFinite(Date.parse(text(output.approvedAt)))
    || text(input.approval.tenant_id) !== input.tenantId
    || text(input.approval.run_id) !== input.runId
    || text(input.approval.task_id) !== input.task.id
    || text(input.approval.status) !== 'approved'
    || text(input.approval.decided_at) !== text(output.approvedAt)
    || !text(input.approval.decided_by)
    || text(input.approval.content_hash) !== input.snapshot.package.contentHash) return false;
  try {
    const subject = contentSubjectFromApproval(input.approval);
    const workflow = input.snapshot.package.workflowBinding;
    return workflow?.schemaVersion === 'starter-198.publication-workflow-binding.v1'
      && workflow.runId === input.runId
      && workflow.approvalId === input.approval.id
      && workflow.approvalTaskId === input.task.id
      && workflow.agentTaskId === text(output.publicationPackageTaskId)
      && subject.tenantId === input.tenantId
      && subject.runId === input.runId
      && subject.contentId === input.snapshot.package.contentId
      && subject.contentVersion === input.snapshot.package.contentVersion
      && subject.contentHash === input.snapshot.package.contentHash
      && subject.platform === input.snapshot.package.platform;
  } catch (error) {
    if (error instanceof StarterPublicationPackageWorkerError) return false;
    throw error;
  }
}

function safeRejectionReason(value: unknown): string {
  const reason = text(value);
  return /^[a-z0-9_.:-]{1,120}$/i.test(reason) ? reason : 'publication_evidence_rejected';
}

function projectionOutput(input: {
  tenantId: string;
  runId: string;
  taskId: string;
  snapshot: StarterPublicationEvidenceSnapshot;
}): StarterPublicationEvidenceProjectionOutput {
  const { package: publication, evidence } = input.snapshot;
  const verified = evidence?.verificationStatus === 'verified'
    ? evidence as VerifiedPublicationEvidence
    : null;
  const rejected = evidence?.verificationStatus === 'rejected'
    ? evidence as VerifiedPublicationEvidence
    : null;
  const verificationStatus: StarterPublicationEvidenceProjectionOutput['verificationStatus'] = verified
    ? 'verified'
    : rejected
      ? 'rejected'
      : evidence
        ? 'pending'
        : 'not_submitted';
  const reasonCode = verified
    ? ''
    : rejected
      ? safeRejectionReason(rejected.rejectionReason)
      : evidence
        ? 'publication_evidence_verification_pending'
        : 'publication_evidence_not_submitted';
  const binding = {
    tenantId: input.tenantId,
    runId: input.runId,
    taskId: input.taskId,
    packageId: publication.packageId,
    packageHash: publication.packageHash,
    contentId: publication.contentId,
    contentVersion: publication.contentVersion,
    contentHash: publication.contentHash,
    platform: publication.platform,
    evidenceHash: text(evidence?.evidenceHash),
    verificationReceiptHash: text(verified?.verificationReceiptHash ?? rejected?.verificationReceiptHash),
  };
  const core = {
    schemaVersion: 'starter-198.publication-evidence-output.v1' as const,
    executionStatus: (verified ? 'completed' : 'waiting_external') as 'completed' | 'waiting_external',
    verificationStatus,
    runId: input.runId,
    taskId: input.taskId,
    packageId: publication.packageId,
    packageHash: publication.packageHash,
    contentId: publication.contentId,
    contentVersion: publication.contentVersion,
    contentHash: publication.contentHash,
    platform: publication.platform,
    evidenceHash: text(evidence?.evidenceHash),
    verifier: text(verified?.verifier ?? rejected?.verifier),
    verifiedAt: text(verified?.verifiedAt ?? rejected?.verifiedAt),
    verificationReceiptHash: binding.verificationReceiptHash,
    reasonCode,
    bindingHash: stableHash(binding),
    ...NO_EFFECTS,
  };
  return { ...core, outputHash: stableHash(core) };
}

function parsedProjectionOutput(value: unknown): StarterPublicationEvidenceProjectionOutput | null {
  const output = object(value);
  if (!output) return null;
  const core = {
    schemaVersion: output.schemaVersion,
    executionStatus: output.executionStatus,
    verificationStatus: output.verificationStatus,
    runId: output.runId,
    taskId: output.taskId,
    packageId: output.packageId,
    packageHash: output.packageHash,
    contentId: output.contentId,
    contentVersion: output.contentVersion,
    contentHash: output.contentHash,
    platform: output.platform,
    evidenceHash: output.evidenceHash,
    verifier: output.verifier,
    verifiedAt: output.verifiedAt,
    verificationReceiptHash: output.verificationReceiptHash,
    reasonCode: output.reasonCode,
    bindingHash: output.bindingHash,
    sourceReadOnly: output.sourceReadOnly,
    providerCalls: output.providerCalls,
    externalEffectsPerformed: output.externalEffectsPerformed,
  };
  const status = text(core.verificationStatus);
  const resolved = status === 'verified' || status === 'rejected';
  if (!exactKeys(output, [...Object.keys(core), 'outputHash'])
    || core.schemaVersion !== 'starter-198.publication-evidence-output.v1'
    || !['completed', 'waiting_external'].includes(text(core.executionStatus))
    || !['not_submitted', 'pending', 'rejected', 'verified'].includes(status)
    || (status === 'verified') !== (core.executionStatus === 'completed')
    || !text(core.runId) || !text(core.taskId) || !text(core.packageId)
    || !text(core.contentId) || !text(core.contentVersion)
    || !['facebook', 'instagram', 'tiktok', 'youtube'].includes(text(core.platform))
    || ![core.packageHash, core.contentHash, core.bindingHash].every(value => HASH.test(text(value)))
    || (status === 'not_submitted' ? text(core.evidenceHash) : !HASH.test(text(core.evidenceHash)))
    || (resolved ? !HASH.test(text(core.verificationReceiptHash)) : Boolean(text(core.verificationReceiptHash)))
    || (resolved ? !['platform_receipt', 'assisted_session', 'human_review'].includes(text(core.verifier)) : Boolean(text(core.verifier)))
    || (resolved ? !Number.isFinite(Date.parse(text(core.verifiedAt))) : Boolean(text(core.verifiedAt)))
    || (status === 'verified' ? Boolean(text(core.reasonCode)) : !text(core.reasonCode))
    || core.sourceReadOnly !== true || core.providerCalls !== 0
    || core.externalEffectsPerformed !== false
    || text(output.outputHash) !== stableHash(core)) return null;
  return output as unknown as StarterPublicationEvidenceProjectionOutput;
}

export function verifiedStarterPublicationEvidenceOutput(
  value: unknown,
): StarterPublicationEvidenceProjectionOutput | null {
  const output = parsedProjectionOutput(value);
  return output?.verificationStatus === 'verified' ? output : null;
}

function waitingHumanOwned(input: {
  run: StarterRecord;
  task: StarterRecord;
  tenantId: string;
  runId: string;
  snapshot: StarterPublicationEvidenceSnapshot;
}): boolean {
  if (text(input.run.current_controller) !== 'human' || text(input.task.status) !== 'waiting_external') return false;
  const output = object(input.task.output);
  const initial = Boolean(output) && exactKeys(output!, [
    'schemaVersion', 'packageId', 'contentHash', 'evidenceVerified', 'externalPublishPerformed',
  ]) && output?.schemaVersion === 'starter-198.publication-evidence-wait.v1'
    && text(output.packageId) === input.snapshot.package.packageId
    && text(output.contentHash) === input.snapshot.package.contentHash
    && output.evidenceVerified === false
    && output.externalPublishPerformed === false
    && text(input.run.pause_reason) === '灵小量已生成发布包；等待用户自行发布并回填公开 URL 或平台帖子 ID。';
  if (initial) return true;
  const prior = parsedProjectionOutput(output);
  if (!prior
    || prior.runId !== input.runId || prior.taskId !== input.task.id
    || prior.packageId !== input.snapshot.package.packageId
    || prior.packageHash !== input.snapshot.package.packageHash
    || prior.contentId !== input.snapshot.package.contentId
    || prior.contentVersion !== input.snapshot.package.contentVersion
    || prior.contentHash !== input.snapshot.package.contentHash
    || prior.platform !== input.snapshot.package.platform
    || prior.bindingHash !== stableHash({
      tenantId: input.tenantId, runId: input.runId, taskId: input.task.id,
      packageId: prior.packageId, packageHash: prior.packageHash, contentId: prior.contentId,
      contentVersion: prior.contentVersion, contentHash: prior.contentHash, platform: prior.platform,
      evidenceHash: prior.evidenceHash, verificationReceiptHash: prior.verificationReceiptHash,
    })) return false;
  return prior.verificationStatus === 'rejected'
    ? text(input.run.pause_reason) === `发布证据未通过核验：${prior.reasonCode}`
    : prior.verificationStatus === 'not_submitted'
      && text(input.run.pause_reason) === '等待用户自行发布并回填公开 URL 或平台帖子 ID。';
}

async function projectUnderLease(input: {
  dataStore: DataStore;
  repository: Starter198Repository;
  tenantId: string;
  runId: string;
  packageId: string;
  now: Date;
}): Promise<StarterPublicationEvidenceProjectionResult> {
  const [run, tasksResult, snapshot] = await Promise.all([
    input.repository.get(STARTER_COLLECTIONS.runs, input.tenantId, input.runId),
    input.repository.list(STARTER_COLLECTIONS.tasks, input.tenantId, {
      where: { run_id: input.runId }, sort: 'sequence', perPage: 500,
    }),
    readStarterPublicationEvidenceSnapshot(input.tenantId, input.packageId, input.dataStore),
  ]);
  if (!starter198RunInScope(run, input.tenantId) || !snapshot) return ignored('projection_scope_not_found');
  const runStatus = text(run.status);
  if (CLOSED_RUN_STATUSES.has(runStatus)) return ignored(`run_${runStatus}`);
  if (!PROJECTABLE_RUN_STATUSES.has(runStatus)) return ignored('run_not_projectable');
  const tasks = completeTasks({ ...tasksResult, tenantId: input.tenantId, runId: input.runId });
  const packageTask = tasks.get(PACKAGE_TASK_KEY);
  const evidenceTask = tasks.get(EVIDENCE_TASK_KEY);
  const approvalTask = tasks.get(APPROVAL_TASK_KEY);
  if ([...tasks.values()].some(task => ['failed', 'cancelled'].includes(text(task.status)))) {
    return ignored('workflow_contains_failed_or_cancelled_task');
  }
  if (!packageTask || !evidenceTask || !approvalTask
    || !expectedTaskContract({ task: packageTask, tenantId: input.tenantId, runId: input.runId, key: PACKAGE_TASK_KEY })
    || !expectedTaskContract({ task: evidenceTask, tenantId: input.tenantId, runId: input.runId, key: EVIDENCE_TASK_KEY })
    || !packageTaskMatches(packageTask, snapshot)) return ignored('publication_binding_not_exact');
  const approvals = await input.repository.list(STARTER_COLLECTIONS.approvals, input.tenantId, {
    where: { run_id: input.runId, task_id: approvalTask.id }, perPage: 2,
  });
  if (approvals.totalItems !== 1 || approvals.items.length !== 1
    || !approvalMatchesPackage({
      task: approvalTask, approval: approvals.items[0]!, snapshot,
      tenantId: input.tenantId, runId: input.runId,
    })) return ignored('content_approval_binding_not_exact');
  if (runStatus === 'waiting_human' && !waitingHumanOwned({
    run, task: evidenceTask, tenantId: input.tenantId, runId: input.runId, snapshot,
  })) return ignored('waiting_human_not_owned_by_publication_evidence');
  if (['failed', 'cancelled', 'skipped'].includes(text(evidenceTask.status))) {
    return ignored(`evidence_task_${text(evidenceTask.status)}`);
  }
  const pendingApprovals = await listStarter198PendingApprovals({
    repository: input.repository, tenantId: input.tenantId, run, tasks: [...tasks.values()],
  });
  if (pendingApprovals.length) return ignored('pending_approval');

  const freshSnapshot = await readStarterPublicationEvidenceSnapshot(
    input.tenantId, input.packageId, input.dataStore,
  );
  if (!freshSnapshot || stableHash(freshSnapshot) !== stableHash(snapshot)) {
    return ignored('publication_state_changed');
  }
  const output = projectionOutput({
    tenantId: input.tenantId, runId: input.runId, taskId: evidenceTask.id, snapshot,
  });
  const targetStatus = output.verificationStatus === 'verified' ? 'succeeded' : 'waiting_external';
  if (text(evidenceTask.status) === 'succeeded'
    && (!verifiedStarterPublicationEvidenceOutput(evidenceTask.output)
      || text(object(evidenceTask.output)?.outputHash) !== output.outputHash)) {
    throw new StarterPublicationEvidenceProjectionError('starter_publication_evidence_success_conflict');
  }
  const desired = output.verificationStatus === 'verified'
    ? { status: 'running', controller: 'agent', pause: '' }
    : output.verificationStatus === 'pending'
      ? { status: 'waiting_external', controller: 'system', pause: '发布证据已提交，等待可信 verifier 核验。' }
      : { status: 'waiting_human', controller: 'human', pause: output.verificationStatus === 'rejected'
        ? `发布证据未通过核验：${output.reasonCode}`
        : '等待用户自行发布并回填公开 URL 或平台帖子 ID。' };
  let runTransitioned = false;
  const transitionRun = async (): Promise<boolean> => {
    const freshRun = await input.repository.get(STARTER_COLLECTIONS.runs, input.tenantId, input.runId);
    if (!starter198RunInScope(freshRun, input.tenantId)
      || !PROJECTABLE_RUN_STATUSES.has(text(freshRun.status))) return false;
    if (text(freshRun.status) === desired.status && text(freshRun.current_controller) === desired.controller
      && text(freshRun.pause_reason) === desired.pause) return true;
    await input.repository.update(STARTER_COLLECTIONS.runs, input.tenantId, input.runId, {
      status: desired.status, current_controller: desired.controller,
      pause_reason: desired.pause, completed_at: '',
    });
    const written = await input.repository.get(STARTER_COLLECTIONS.runs, input.tenantId, input.runId);
    if (!starter198RunInScope(written, input.tenantId) || text(written.status) !== desired.status) {
      throw new StarterPublicationEvidenceProjectionError('starter_publication_evidence_run_write_lost', true);
    }
    runTransitioned = true;
    return true;
  };
  // When leaving a human pause, move the run first. If the following task
  // write crashes, replay remains projectable without weakening pause ownership.
  const leaveHumanPause = runStatus === 'waiting_human' && desired.status !== 'waiting_human';
  if (leaveHumanPause && !await transitionRun()) return ignored('run_changed_before_transition');
  let taskUpdated = false;
  if (text(evidenceTask.status) !== targetStatus
    || text(object(evidenceTask.output)?.outputHash) !== output.outputHash) {
    await input.repository.update(STARTER_COLLECTIONS.tasks, input.tenantId, evidenceTask.id, {
      status: targetStatus,
      output,
      blocked_reason: output.reasonCode,
      updated_at: input.now.toISOString(),
    });
    const written = await input.repository.get(STARTER_COLLECTIONS.tasks, input.tenantId, evidenceTask.id);
    if (!written || text(written.status) !== targetStatus
      || text(object(written.output)?.outputHash) !== output.outputHash) {
      throw new StarterPublicationEvidenceProjectionError('starter_publication_evidence_task_write_lost', true);
    }
    taskUpdated = true;
  }
  if (!leaveHumanPause && !await transitionRun()) return ignored('run_changed_before_transition');
  return {
    state: output.verificationStatus === 'verified' ? 'ready' : 'waiting',
    reason: output.reasonCode || 'publication_evidence_verified',
    taskUpdated,
    runTransitioned,
  };
}

/**
 * Internal event hook for an already-persisted package state. It does not call
 * a platform, accept proof, or mark evidence verified. A future trusted
 * verifier calls this after its own write; no customer verification route exists.
 */
export async function notifyStarterPublicationEvidenceChanged(input: {
  dataStore: DataStore;
  tenantId: string;
  runId: string;
  packageId: string;
  repository?: Starter198Repository;
  now?: () => Date;
}): Promise<StarterPublicationEvidenceProjectionResult> {
  if (!text(input.tenantId) || !text(input.runId) || !text(input.packageId)) {
    return ignored('projection_identity_invalid');
  }
  const repository = input.repository ?? createStarter198Repository(input.dataStore);
  try {
    return await withStarter198RunMutationLease({
      dataStore: input.dataStore,
      tenantId: input.tenantId,
      runId: input.runId,
      action: () => projectUnderLease({
        ...input, repository, now: input.now?.() ?? new Date(),
      }),
    });
  } catch (error) {
    if (error instanceof Starter198RunMutationLeaseError
      && error.code === 'starter_run_mutation_busy') return ignored('run_mutation_busy');
    if (error instanceof StarterPublicationPackageError) {
      throw new StarterPublicationEvidenceProjectionError(error.code, true);
    }
    throw error;
  }
}
