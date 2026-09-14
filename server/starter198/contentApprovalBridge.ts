import { withDigitalEmployeeRunLock } from '../digitalEmployees/runControl.js';
import type { DataStore } from '../storage/datastore.js';
import {
  contentSubjectFromApproval,
  readCanonicalStarterContentArtifact,
  sha256Json,
  StarterPublicationPackageWorkerError,
  type CanonicalStarterContentArtifact,
  type StarterContentSubjectV1,
} from './publicationPackageArtifact.js';
import {
  STARTER_COLLECTIONS,
  Starter198RepositoryError,
  type Starter198Repository,
  type StarterRecord,
} from './repository.js';
import { buildStarter198CapabilityManifest, starter198CapabilityAllowed } from './profile.js';

const STARTER_PROFILE = 'starter_198';
const QUALITY_TASK_KEY = 'starter_content_quality_gate';
const APPROVAL_TASK_KEY = 'starter_content_release_approval';
const MUTABLE_RUN_STATUSES = new Set(['queued', 'running']);

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const version = (value: unknown): string => typeof value === 'number' && Number.isFinite(value)
  ? String(value)
  : text(value);

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

function array(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try { return array(JSON.parse(value)); } catch { return []; }
}

export class StarterContentApprovalBridgeError extends Error {
  constructor(readonly code: string, readonly retryable = false) {
    super(code);
    this.name = 'StarterContentApprovalBridgeError';
  }
}

export interface StarterContentQualityBindingV1 {
  schemaVersion: 'starter-198.content-quality-output.v1';
  executionStatus: 'completed';
  qualityPassed: true;
  tenantId: string;
  runId: string;
  qualityTaskId: string;
  qualityTaskVersion: string;
  canonicalContent: {
    type: 'studio_project';
    id: string;
    version: string;
    sourceContentHash: string;
    contentHash: string;
    platform: StarterContentSubjectV1['platform'];
    fileName: string;
    fileHash: string;
  };
  bindingHash: string;
}

type QualityBindingBusinessValue = Omit<StarterContentQualityBindingV1, 'bindingHash'>;

function qualityBindingHash(value: QualityBindingBusinessValue): string {
  return sha256Json(value);
}

/**
 * Fixed hand-off contract for the future quality executor. Building this value
 * does not bless a project: the approval bridge always rebuilds the canonical
 * artifact and compares every frozen field before creating an approval.
 */
export function buildStarterContentQualityBinding(input: {
  tenantId: string;
  runId: string;
  qualityTaskId: string;
  qualityTaskVersion: string;
  artifact: CanonicalStarterContentArtifact;
}): StarterContentQualityBindingV1 {
  const asset = input.artifact.subject.assets[0];
  if (!asset) throw new StarterContentApprovalBridgeError('starter_content_quality_asset_missing');
  const businessValue: QualityBindingBusinessValue = {
    schemaVersion: 'starter-198.content-quality-output.v1',
    executionStatus: 'completed',
    qualityPassed: true,
    tenantId: text(input.tenantId),
    runId: text(input.runId),
    qualityTaskId: text(input.qualityTaskId),
    qualityTaskVersion: version(input.qualityTaskVersion),
    canonicalContent: {
      type: 'studio_project',
      id: input.artifact.subject.contentId,
      version: input.artifact.subject.contentVersion,
      sourceContentHash: input.artifact.subject.sourceContentHash,
      contentHash: input.artifact.subject.contentHash,
      platform: input.artifact.subject.platform,
      fileName: asset.fileName,
      fileHash: asset.contentHash,
    },
  };
  return parseQualityBinding({ ...businessValue, bindingHash: qualityBindingHash(businessValue) });
}

function parseQualityBinding(value: unknown): StarterContentQualityBindingV1 {
  const source = object(value);
  const canonical = object(source?.canonicalContent);
  if (!source || !canonical) {
    throw new StarterContentApprovalBridgeError('starter_content_quality_binding_invalid');
  }
  const businessValue: QualityBindingBusinessValue = {
    schemaVersion: source.schemaVersion as QualityBindingBusinessValue['schemaVersion'],
    executionStatus: source.executionStatus as QualityBindingBusinessValue['executionStatus'],
    qualityPassed: source.qualityPassed as QualityBindingBusinessValue['qualityPassed'],
    tenantId: text(source.tenantId),
    runId: text(source.runId),
    qualityTaskId: text(source.qualityTaskId),
    qualityTaskVersion: version(source.qualityTaskVersion),
    canonicalContent: {
      type: canonical.type as 'studio_project',
      id: text(canonical.id),
      version: version(canonical.version),
      sourceContentHash: text(canonical.sourceContentHash).toLowerCase(),
      contentHash: text(canonical.contentHash).toLowerCase(),
      platform: text(canonical.platform).toLowerCase() as StarterContentSubjectV1['platform'],
      fileName: text(canonical.fileName),
      fileHash: text(canonical.fileHash).toLowerCase(),
    },
  };
  const hashes = [
    businessValue.canonicalContent.sourceContentHash,
    businessValue.canonicalContent.contentHash,
    businessValue.canonicalContent.fileHash,
  ];
  if (businessValue.schemaVersion !== 'starter-198.content-quality-output.v1'
    || businessValue.executionStatus !== 'completed'
    || businessValue.qualityPassed !== true
    || !businessValue.tenantId || !businessValue.runId
    || !businessValue.qualityTaskId || !businessValue.qualityTaskVersion
    || businessValue.canonicalContent.type !== 'studio_project'
    || !businessValue.canonicalContent.id || !businessValue.canonicalContent.version
    || !['facebook', 'instagram', 'tiktok', 'youtube'].includes(businessValue.canonicalContent.platform)
    || !businessValue.canonicalContent.fileName
    || hashes.some(hash => !/^[a-f0-9]{64}$/.test(hash))
    || text(source.bindingHash).toLowerCase() !== qualityBindingHash(businessValue)) {
    throw new StarterContentApprovalBridgeError('starter_content_quality_binding_invalid');
  }
  return { ...businessValue, bindingHash: text(source.bindingHash).toLowerCase() };
}

function assertCanonicalBinding(
  binding: StarterContentQualityBindingV1,
  artifact: CanonicalStarterContentArtifact,
): void {
  const subject = artifact.subject;
  const asset = subject.assets[0];
  if (binding.tenantId !== subject.tenantId
    || binding.runId !== subject.runId
    || binding.canonicalContent.id !== subject.contentId
    || binding.canonicalContent.version !== subject.contentVersion
    || binding.canonicalContent.sourceContentHash !== subject.sourceContentHash
    || binding.canonicalContent.contentHash !== subject.contentHash
    || binding.canonicalContent.platform !== subject.platform
    || !asset
    || binding.canonicalContent.fileName !== asset.fileName
    || binding.canonicalContent.fileHash !== asset.contentHash) {
    throw new StarterContentApprovalBridgeError('starter_content_quality_canonical_changed');
  }
}

function qualityEvidence(binding: StarterContentQualityBindingV1): Record<string, unknown> {
  return {
    type: 'starter_content_quality_binding',
    schemaVersion: binding.schemaVersion,
    qualityTaskId: binding.qualityTaskId,
    qualityTaskVersion: binding.qualityTaskVersion,
    bindingHash: binding.bindingHash,
  };
}

function approvalMatches(input: {
  approval: StarterRecord;
  tenantId: string;
  runId: string;
  goalId: string;
  taskId: string;
  subjectVersion: string;
  subject: StarterContentSubjectV1;
  binding: StarterContentQualityBindingV1;
}): boolean {
  const approval = input.approval;
  if (text(approval.tenant_id) !== input.tenantId
    || text(approval.run_id) !== input.runId
    || text(approval.goal_id) !== input.goalId
    || text(approval.task_id) !== input.taskId
    || text(approval.status) !== 'pending'
    || version(approval.subject_version) !== input.subjectVersion
    || text(approval.content_hash).toLowerCase() !== input.subject.contentHash
    || text(approval.requested_by_agent) !== 'content') return false;
  try {
    const frozen = contentSubjectFromApproval(approval);
    if (sha256Json(frozen) !== sha256Json(input.subject)) return false;
  } catch {
    return false;
  }
  const evidence = array(approval.evidence).map(object).filter(Boolean) as Record<string, unknown>[];
  const bindings = evidence.filter(item => text(item.type) === 'starter_content_quality_binding');
  return bindings.length === 1
    && sha256Json(bindings[0]) === sha256Json(qualityEvidence(input.binding));
}

async function oneApproval(
  repository: Starter198Repository,
  tenantId: string,
  taskId: string,
): Promise<StarterRecord | null> {
  const result = await repository.list(STARTER_COLLECTIONS.approvals, tenantId, {
    where: { task_id: taskId }, perPage: 2,
  });
  if (result.totalItems > 1 || result.items.length > 1) {
    throw new StarterContentApprovalBridgeError('starter_content_approval_integrity_violation');
  }
  return result.items[0] ?? null;
}

async function canonicalArtifact(input: {
  dataStore: DataStore;
  tenantId: string;
  runId: string;
  contentId: string;
  publishingRoot?: string;
}): Promise<CanonicalStarterContentArtifact> {
  try {
    return await readCanonicalStarterContentArtifact(input);
  } catch (error) {
    if (error instanceof StarterPublicationPackageWorkerError) {
      throw new StarterContentApprovalBridgeError(
        error.code,
        error.retryable || ['starter_publication_asset_unavailable', 'starter_publication_content_not_found']
          .includes(error.code),
      );
    }
    throw error;
  }
}

export interface StarterContentApprovalBridgeDependencies {
  dataStore: DataStore;
  repository: Starter198Repository;
  publishingRoot?: string;
  now?: () => Date;
  executionFence: string;
  assertExecutionFence: () => Promise<void>;
}

export interface StarterContentApprovalBridgeResult {
  approvalId: string;
  created: boolean;
  subjectVersion: string;
  contentId: string;
  contentVersion: string;
  contentHash: string;
}

/**
 * Approval creation and the workflow projection share the run-control lock.
 * The lease callback fences an expired orchestrator owner before each durable
 * boundary. No package node, calendar row, provider or publishing API is used.
 */
export async function bridgeStarterContentReleaseApproval(input: {
  tenantId: string;
  runId: string;
  approvalTaskId: string;
  dependencies: StarterContentApprovalBridgeDependencies;
}): Promise<StarterContentApprovalBridgeResult> {
  const { dependencies } = input;
  return withDigitalEmployeeRunLock(input.tenantId, input.runId, async () => {
    const operationNow = dependencies.now?.() ?? new Date();
    await dependencies.assertExecutionFence();
    const [access, run, approvalTask, tasks] = await Promise.all([
      dependencies.repository.access(input.tenantId),
      dependencies.repository.get(STARTER_COLLECTIONS.runs, input.tenantId, input.runId),
      dependencies.repository.get(STARTER_COLLECTIONS.tasks, input.tenantId, input.approvalTaskId),
      dependencies.repository.list(STARTER_COLLECTIONS.tasks, input.tenantId, {
        where: { run_id: input.runId }, perPage: 500,
      }),
    ]);
    if (!starter198CapabilityAllowed(
      buildStarter198CapabilityManifest(access, operationNow),
      'orchestrator.decision.resolve',
    )) throw new StarterContentApprovalBridgeError('starter_content_approval_capability_unavailable');
    if (!run || text(run.product_profile) !== STARTER_PROFILE
      || !MUTABLE_RUN_STATUSES.has(text(run.status))) {
      throw new StarterContentApprovalBridgeError('starter_content_approval_run_changed', true);
    }
    if (!approvalTask || text(approvalTask.run_id) !== input.runId
      || text(approvalTask.task_key) !== APPROVAL_TASK_KEY
      || !['pending', 'running'].includes(text(approvalTask.status))) {
      throw new StarterContentApprovalBridgeError('starter_content_approval_task_changed', true);
    }
    if (tasks.totalItems > tasks.items.length
      || tasks.items.some(task => text(task.run_id) !== input.runId)) {
      throw new StarterContentApprovalBridgeError('starter_content_approval_task_list_incomplete', true);
    }
    const qualityTasks = tasks.items.filter(task => text(task.task_key) === QUALITY_TASK_KEY);
    if (qualityTasks.length !== 1 || text(qualityTasks[0]!.status) !== 'succeeded') {
      throw new StarterContentApprovalBridgeError('starter_content_quality_task_not_succeeded');
    }
    const qualityTask = qualityTasks[0]!;
    const binding = parseQualityBinding(qualityTask.output);
    if (binding.tenantId !== input.tenantId || binding.runId !== input.runId
      || binding.qualityTaskId !== qualityTask.id
      || binding.qualityTaskVersion !== version(qualityTask.task_version)) {
      throw new StarterContentApprovalBridgeError('starter_content_quality_binding_scope_mismatch');
    }
    const artifact = await canonicalArtifact({
      dataStore: dependencies.dataStore,
      tenantId: input.tenantId,
      runId: input.runId,
      contentId: binding.canonicalContent.id,
      ...(dependencies.publishingRoot ? { publishingRoot: dependencies.publishingRoot } : {}),
    });
    assertCanonicalBinding(binding, artifact);
    const goalId = text(run.goal_id);
    const subjectVersion = version(approvalTask.task_version);
    if (!goalId || !subjectVersion) {
      throw new StarterContentApprovalBridgeError('starter_content_approval_context_invalid');
    }
    const goal = await dependencies.repository.get(STARTER_COLLECTIONS.goals, input.tenantId, goalId);
    if (!goal) throw new StarterContentApprovalBridgeError('starter_content_approval_goal_missing');

    const matchInput = {
      tenantId: input.tenantId,
      runId: input.runId,
      goalId,
      taskId: approvalTask.id,
      subjectVersion,
      subject: artifact.subject,
      binding,
    };
    let approval = await oneApproval(dependencies.repository, input.tenantId, approvalTask.id);
    let created = false;
    if (approval && !approvalMatches({ approval, ...matchInput })) {
      if (text(approval.status) === 'pending') {
        await dependencies.repository.update(STARTER_COLLECTIONS.approvals, input.tenantId, approval.id, {
          status: 'superseded',
          decision_note: '审批冻结主体与当前 canonical 内容不一致，旧审批已失效。',
          decided_at: operationNow.toISOString(),
        });
      }
      throw new StarterContentApprovalBridgeError('starter_content_approval_conflict');
    }
    if (!approval) {
      const now = operationNow.toISOString();
      try {
        approval = await dependencies.repository.create(STARTER_COLLECTIONS.approvals, input.tenantId, {
          goal_id: goalId,
          run_id: input.runId,
          task_id: approvalTask.id,
          status: 'pending',
          action_summary: '批准当前冻结内容生成自助发布包；不连接平台账号、不创建发布日历、不执行发布。',
          risk_level: 'L1',
          evidence: [artifact.subject, qualityEvidence(binding)],
          requested_by_agent: 'content',
          decided_by: '',
          decision_note: '',
          created_at: now,
          decided_at: '',
          subject_version: Number(subjectVersion),
          content_hash: artifact.subject.contentHash,
        });
        created = true;
      } catch (error) {
        if (!(error instanceof Starter198RepositoryError)) throw error;
        approval = await oneApproval(dependencies.repository, input.tenantId, approvalTask.id);
        if (!approval || !approvalMatches({ approval, ...matchInput })) {
          throw new StarterContentApprovalBridgeError('starter_content_approval_storage_unavailable', true);
        }
      }
    }

    await dependencies.assertExecutionFence();
    const [freshRun, freshTask] = await Promise.all([
      dependencies.repository.get(STARTER_COLLECTIONS.runs, input.tenantId, input.runId),
      dependencies.repository.get(STARTER_COLLECTIONS.tasks, input.tenantId, approvalTask.id),
    ]);
    if (!freshRun || !MUTABLE_RUN_STATUSES.has(text(freshRun.status))
      || !freshTask || !['pending', 'running'].includes(text(freshTask.status))) {
      if (created && text(approval.status) === 'pending') {
        await dependencies.repository.update(STARTER_COLLECTIONS.approvals, input.tenantId, approval.id, {
          status: 'superseded',
          decision_note: '运行或审批节点已改变，未形成有效授权。',
          decided_at: operationNow.toISOString(),
        });
      }
      throw new StarterContentApprovalBridgeError('starter_content_approval_run_changed', true);
    }
    const now = operationNow.toISOString();
    const output = {
      schemaVersion: 'starter-198.content-release-approval-output.v1',
      executionStatus: 'waiting_approval',
      approvalId: approval.id,
      subjectVersion,
      contentId: artifact.subject.contentId,
      contentVersion: artifact.subject.contentVersion,
      contentHash: artifact.subject.contentHash,
      qualityBindingHash: binding.bindingHash,
      externalPublishPerformed: false,
      publicationPackageCreated: false,
      executionFence: dependencies.executionFence,
    };
    await dependencies.repository.update(STARTER_COLLECTIONS.tasks, input.tenantId, approvalTask.id, {
      status: 'waiting_approval',
      output,
      business_refs: [{
        type: 'studio_project', id: artifact.subject.contentId,
        version: artifact.subject.contentVersion, contentHash: artifact.subject.contentHash,
      }],
      blocked_reason: '等待用户在灵小枢批准当前冻结内容版本',
      updated_at: now,
    });
    await dependencies.assertExecutionFence();
    const written = await dependencies.repository.get(STARTER_COLLECTIONS.tasks, input.tenantId, approvalTask.id);
    const writtenOutput = object(written?.output);
    if (!written || text(written.status) !== 'waiting_approval'
      || text(writtenOutput?.approvalId) !== approval.id
      || text(writtenOutput?.executionFence) !== dependencies.executionFence) {
      throw new StarterContentApprovalBridgeError('starter_content_approval_fenced_write_lost', true);
    }
    const runBeforeWrite = await dependencies.repository.get(STARTER_COLLECTIONS.runs, input.tenantId, input.runId);
    if (!runBeforeWrite || !MUTABLE_RUN_STATUSES.has(text(runBeforeWrite.status))) {
      throw new StarterContentApprovalBridgeError('starter_content_approval_run_changed', true);
    }
    await dependencies.repository.update(STARTER_COLLECTIONS.runs, input.tenantId, input.runId, {
      status: 'waiting_approval',
      current_controller: 'human',
      pause_reason: '内容已冻结，等待用户在灵小枢批准生成自助发布包。',
    });
    await dependencies.assertExecutionFence();
    return {
      approvalId: approval.id,
      created,
      subjectVersion,
      contentId: artifact.subject.contentId,
      contentVersion: artifact.subject.contentVersion,
      contentHash: artifact.subject.contentHash,
    };
  });
}
