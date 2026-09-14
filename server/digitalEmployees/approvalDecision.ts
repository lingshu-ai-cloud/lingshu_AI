import type { DataStore } from '../storage/datastore.js';
import type { PublishingApprovalPackage } from './publishingExecution.js';
import { publishingPlatformsCovered } from './executionDiagnostics.js';
import { approvalRunBlockedReason, withDigitalEmployeeRunLock } from './runControl.js';
import { STARTER_CONTENT_RELEASE_APPROVAL_TASK_KEY } from '../../shared/contracts/starter198.js';

type StoredRecord = { id: string; [key: string]: unknown };

export interface ApprovalDecisionRecord extends StoredRecord {
  tenant_id: string;
  run_id: string;
  task_id: string;
  status: string;
  created_at: string;
  subject_version?: unknown;
  content_hash?: unknown;
  evidence?: unknown;
}

export interface ApprovalDecisionTask extends StoredRecord {
  tenant_id: string;
  run_id: string;
  task_key: string;
  status: string;
  task_version?: unknown;
}

export interface ApprovalDecisionRun extends StoredRecord {
  tenant_id: string;
  goal_id: string;
  status: string;
}

export interface ApprovalDecisionGoal extends StoredRecord {
  tenant_id: string;
  content_platforms?: unknown;
}

export interface ApprovalDecisionFollowupBatch extends StoredRecord {
  tenant_id: string;
  run_id: string;
  version: number;
  content_hash: string;
}

export interface ApprovalDecisionConnectedAccount {
  accountId: string;
  platform: string;
}

export type DigitalEmployeeApprovalDecision = 'approved' | 'rejected';

export interface DecideDigitalEmployeeApprovalInput {
  tenantId: string;
  userId: string;
  approvalId: string;
  decision: DigitalEmployeeApprovalDecision;
  note?: string;
  /** Required by versioned command surfaces; optional for the legacy route. */
  expectedSubjectVersion?: string;
  policy?: 'legacy' | 'starter_198';
}

export interface DecideDigitalEmployeeApprovalResult {
  state: 'decided' | 'already_decided';
  decision: string;
  runId: string;
  taskId: string;
  publishingEntries: Array<{ id: string; status: string }>;
  publicationPackageTaskId?: string;
}

export class DigitalEmployeeApprovalDecisionError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'DigitalEmployeeApprovalDecisionError';
  }
}

export interface DigitalEmployeeApprovalDecisionDependencies {
  store: DataStore;
  buildPublishingPackage(input: {
    tenantId: string;
    goal: ApprovalDecisionGoal;
    run: ApprovalDecisionRun;
    task: ApprovalDecisionTask;
    tasks: ApprovalDecisionTask[];
    scheduleAnchor: string;
  }): Promise<PublishingApprovalPackage>;
  listConnectedPublishingAccounts(tenantId: string): Promise<ApprovalDecisionConnectedAccount[]>;
  createPublishingCalendarEntries(input: {
    tenantId: string;
    runId: string;
    approvalTaskId: string;
    approvalId: string;
    approvedContentHash: string;
    package: PublishingApprovalPackage;
  }): Promise<Array<{ id: string; status: string }>>;
  applyFollowupBatchDecision(input: {
    tenantId: string;
    batchId: string;
    decision: DigitalEmployeeApprovalDecision;
    userId: string;
    approvalId: string;
  }): Promise<unknown>;
  appendAudit(input: {
    tenantId: string;
    userId: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;
  appendEvent(input: {
    tenantId: string;
    runId: string;
    taskId: string;
    type: string;
    level: 'error' | 'success';
    summary: string;
    payload: Record<string, unknown>;
  }): Promise<unknown>;
  continueRun(tenantId: string, runId: string): Promise<void>;
  enqueueStarterPublicationPackageTask?(input: {
    tenantId: string;
    runId: string;
    approvalId: string;
    approvalTaskId: string;
    subjectVersion: string;
    contentHash: string;
  }): Promise<{ taskId: string; created: boolean }>;
  now?: () => Date;
}

export type DigitalEmployeeApprovalDecisionApplication = (
  input: DecideDigitalEmployeeApprovalInput,
) => Promise<DecideDigitalEmployeeApprovalResult>;

let productionApplication: DigitalEmployeeApprovalDecisionApplication | null = null;

/**
 * Install the production dependency graph from the Digital Employee runtime.
 * A second, different installation is rejected so tests or routes cannot
 * silently replace the approval authority after startup.
 */
export function registerDigitalEmployeeApprovalDecisionApplication(
  application: DigitalEmployeeApprovalDecisionApplication,
): void {
  if (productionApplication && productionApplication !== application) {
    throw new Error('digital_employee_approval_application_already_registered');
  }
  productionApplication = application;
}

/** Stable lower-layer entry point used by every HTTP surface. */
export async function decideDigitalEmployeeApproval(
  input: DecideDigitalEmployeeApprovalInput,
): Promise<DecideDigitalEmployeeApprovalResult> {
  if (!productionApplication) {
    throw new DigitalEmployeeApprovalDecisionError('approval_decision_handler_unavailable', 503);
  }
  return productionApplication(input);
}

const COLLECTIONS = {
  approvals: 'approval_requests',
  tasks: 'workflow_tasks',
  runs: 'workflow_runs',
  goals: 'weekly_goals',
  followupBatches: 'followup_batches',
} as const;

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function versionString(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown): string[] {
  if (typeof value === 'string') {
    try { return stringArray(JSON.parse(value)); } catch { return []; }
  }
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

function frozenApprovalContentHash(approval: ApprovalDecisionRecord): string {
  const evidence = jsonValue(approval.evidence);
  const items = Array.isArray(evidence) ? evidence : evidence && typeof evidence === 'object' ? [evidence] : [];
  const subject = items.find(item => item && typeof item === 'object'
    && ['publishing_approval_package', 'starter_content_subject'].includes(text((item as Record<string, unknown>).type)));
  if (!subject || typeof subject !== 'object') return '';
  const record = subject as Record<string, unknown>;
  return text(record.contentHash) || text(record.content_hash);
}

async function tenantRecord<T extends StoredRecord & { tenant_id: string }>(
  store: DataStore,
  collection: string,
  id: string,
  tenantId: string,
): Promise<T | null> {
  const result = await store.getById<T>(collection, id);
  return result?.tenant_id === tenantId ? result : null;
}

async function requiredUpdate(
  store: DataStore,
  collection: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!await store.update(collection, id, patch)) {
    throw new DigitalEmployeeApprovalDecisionError('approval_decision_storage_unavailable', 503);
  }
}

async function latestFollowupBatch(
  store: DataStore,
  tenantId: string,
  runId: string,
): Promise<ApprovalDecisionFollowupBatch | null> {
  const result = await store.list<ApprovalDecisionFollowupBatch>(COLLECTIONS.followupBatches, {
    where: { tenant_id: tenantId, run_id: runId },
    sort: '-version',
    page: 1,
    perPage: 1,
  });
  return result.items[0] ?? null;
}

function invalidPublishingAccounts(
  package_: PublishingApprovalPackage,
  connected: ApprovalDecisionConnectedAccount[],
): string[] {
  const byId = new Map(connected.map(account => [account.accountId, account]));
  return [...new Set(package_.items.flatMap(item => item.accountIds.filter(accountId => {
    const account = byId.get(accountId);
    return !account || account.platform !== item.platform;
  })))];
}

export function createDigitalEmployeeApprovalDecisionApplication(
  dependencies: DigitalEmployeeApprovalDecisionDependencies,
): DigitalEmployeeApprovalDecisionApplication {
  return async input => {
    const initialApproval = await tenantRecord<ApprovalDecisionRecord>(
      dependencies.store,
      COLLECTIONS.approvals,
      input.approvalId,
      input.tenantId,
    );
    if (!initialApproval) throw new DigitalEmployeeApprovalDecisionError('approval_not_found', 404);
    if (!['approved', 'rejected'].includes(input.decision)) {
      throw new DigitalEmployeeApprovalDecisionError('invalid_approval_decision', 400, {
        allowed: ['approved', 'rejected'],
      });
    }

    return withDigitalEmployeeRunLock(input.tenantId, initialApproval.run_id, async () => {
      const approval = await tenantRecord<ApprovalDecisionRecord>(
        dependencies.store,
        COLLECTIONS.approvals,
        input.approvalId,
        input.tenantId,
      );
      if (!approval) throw new DigitalEmployeeApprovalDecisionError('approval_not_found', 404);
      if (approval.status !== 'pending') {
        return {
          state: 'already_decided',
          decision: approval.status,
          runId: approval.run_id,
          taskId: approval.task_id,
          publishingEntries: [],
        };
      }
      if (input.expectedSubjectVersion
        && versionString(approval.subject_version) !== input.expectedSubjectVersion) {
        throw new DigitalEmployeeApprovalDecisionError('approval_subject_changed', 409, {
          currentVersion: versionString(approval.subject_version),
        });
      }

      const note = text(input.note).slice(0, 1000);
      const now = (dependencies.now?.() ?? new Date()).toISOString();
      const task = await tenantRecord<ApprovalDecisionTask>(
        dependencies.store,
        COLLECTIONS.tasks,
        approval.task_id,
        input.tenantId,
      );
      const run = await tenantRecord<ApprovalDecisionRun>(
        dependencies.store,
        COLLECTIONS.runs,
        approval.run_id,
        input.tenantId,
      );
      const goal = run ? await tenantRecord<ApprovalDecisionGoal>(
        dependencies.store,
        COLLECTIONS.goals,
        run.goal_id,
        input.tenantId,
      ) : null;
      if (!task || !run || !goal) {
        throw new DigitalEmployeeApprovalDecisionError('approval_context_missing', 409);
      }
      const runBlocker = approvalRunBlockedReason(run, input.tenantId, task.status);
      if (runBlocker) {
        throw new DigitalEmployeeApprovalDecisionError(runBlocker, 409, {
          message: '当前运行或任务不允许审批；请先恢复运行或重新发起审批。',
        });
      }

      const contentReleaseApproval = task.task_key === 'content_release_approval'
        || task.task_key === STARTER_CONTENT_RELEASE_APPROVAL_TASK_KEY;
      if (contentReleaseApproval
        && Number(approval.subject_version || 0) !== Number(task.task_version || 1)) {
        throw new DigitalEmployeeApprovalDecisionError('approval_subject_changed', 409, {
          currentVersion: Number(task.task_version || 1),
        });
      }

      const starterContentApproval = input.policy === 'starter_198'
        && task.task_key === STARTER_CONTENT_RELEASE_APPROVAL_TASK_KEY;
      let publishingPackage: PublishingApprovalPackage | null = null;
      if (task.task_key === 'content_release_approval' && !starterContentApproval) {
        const taskResult = await dependencies.store.list<ApprovalDecisionTask>(COLLECTIONS.tasks, {
          where: { tenant_id: input.tenantId, run_id: run.id },
          sort: 'sequence',
          perPage: 100,
        });
        publishingPackage = await dependencies.buildPublishingPackage({
          tenantId: input.tenantId,
          goal,
          run,
          task,
          tasks: taskResult.items,
          scheduleAnchor: approval.created_at,
        });
        if (!publishingPackage.items.length
          || publishingPackage.contentHash !== text(approval.content_hash)) {
          await requiredUpdate(dependencies.store, COLLECTIONS.approvals, approval.id, {
            status: 'superseded',
            decision_note: '作品、文案、账号或排期已发生变化，请重新发起审批。',
            decided_at: now,
          });
          throw new DigitalEmployeeApprovalDecisionError('approval_subject_changed', 409, {
            currentContentHash: publishingPackage.contentHash,
          });
        }
      }
      if (starterContentApproval) {
        const frozenHash = frozenApprovalContentHash(approval);
        if (!text(approval.content_hash) || !frozenHash) {
          throw new DigitalEmployeeApprovalDecisionError('approval_content_hash_missing', 409);
        }
        if (frozenHash !== text(approval.content_hash)) {
          throw new DigitalEmployeeApprovalDecisionError('approval_subject_changed', 409, {
            currentContentHash: frozenHash,
          });
        }
      }

      let followupBatch: ApprovalDecisionFollowupBatch | null = null;
      if (task.task_key === 'followup_batch_approval') {
        followupBatch = await latestFollowupBatch(dependencies.store, input.tenantId, run.id);
        if (!followupBatch) {
          throw new DigitalEmployeeApprovalDecisionError('followup_batch_missing', 409);
        }
        if (Number(approval.subject_version || 0) !== Number(followupBatch.version || 0)
          || text(approval.content_hash) !== text(followupBatch.content_hash)) {
          throw new DigitalEmployeeApprovalDecisionError('approval_subject_changed', 409, {
            currentVersion: followupBatch.version,
          });
        }
      }

      let publishingEntries: Array<{ id: string; status: string }> = [];
      if (input.decision === 'approved' && publishingPackage) {
        if (!publishingPlatformsCovered(
          stringArray(goal.content_platforms),
          publishingPackage.items,
        )) {
          throw new DigitalEmployeeApprovalDecisionError('publishing_platforms_incomplete', 409, {
            message: '部分目标平台尚未选择发布账号，请补齐后重新发起审批。',
          });
        }
        const connected = await dependencies.listConnectedPublishingAccounts(input.tenantId);
        const invalidAccountIds = invalidPublishingAccounts(publishingPackage, connected);
        if (invalidAccountIds.length) {
          throw new DigitalEmployeeApprovalDecisionError('publishing_accounts_invalid', 409, {
            invalidAccountIds,
            message: '审批包中的发布账号已断开或不再属于当前租户，请重新选择账号并发起审批。',
          });
        }
        publishingEntries = await dependencies.createPublishingCalendarEntries({
          tenantId: input.tenantId,
          runId: run.id,
          approvalTaskId: task.id,
          approvalId: approval.id,
          approvedContentHash: text(approval.content_hash),
          package: publishingPackage,
        });
      }

      let publicationPackageTaskId = '';
      if (starterContentApproval && input.decision === 'approved') {
        if (!dependencies.enqueueStarterPublicationPackageTask) {
          throw new DigitalEmployeeApprovalDecisionError('starter_publication_task_handler_unavailable', 503);
        }
        const queued = await dependencies.enqueueStarterPublicationPackageTask({
          tenantId: input.tenantId,
          runId: run.id,
          approvalId: approval.id,
          approvalTaskId: task.id,
          subjectVersion: versionString(approval.subject_version),
          contentHash: text(approval.content_hash),
        });
        publicationPackageTaskId = queued.taskId;
      }

      await requiredUpdate(dependencies.store, COLLECTIONS.approvals, approval.id, {
        status: input.decision,
        decided_by: input.userId,
        decision_note: note,
        decided_at: now,
      });
      if (followupBatch) {
        await dependencies.applyFollowupBatchDecision({
          tenantId: input.tenantId,
          batchId: followupBatch.id,
          decision: input.decision,
          userId: input.userId,
          approvalId: approval.id,
        });
      }
      await dependencies.appendAudit({
        tenantId: input.tenantId,
        userId: input.userId,
        action: 'approval.decided',
        targetType: 'approval_request',
        targetId: approval.id,
        metadata: {
          decision: input.decision,
          runId: run.id,
          taskId: task.id,
          policy: input.policy ?? 'legacy',
          ...(publicationPackageTaskId ? { publicationPackageTaskId } : {}),
        },
      });

      if (input.decision === 'rejected') {
        await Promise.all([
          requiredUpdate(dependencies.store, COLLECTIONS.tasks, task.id, {
            status: 'failed',
            blocked_reason: note || '审批驳回',
            updated_at: now,
          }),
          requiredUpdate(dependencies.store, COLLECTIONS.runs, run.id, {
            status: 'waiting_external',
            current_controller: 'agent',
            pause_reason: '审批退回修改，其他分支可继续',
            completed_at: '',
          }),
          requiredUpdate(dependencies.store, COLLECTIONS.goals, goal.id, {
            status: 'active',
            updated_at: now,
          }),
        ]);
        await dependencies.appendEvent({
          tenantId: input.tenantId,
          runId: run.id,
          taskId: task.id,
          type: 'approval.decided',
          level: 'error',
          summary: '审批已退回修改，仅阻塞本审批与下游外部动作',
          payload: { decision: input.decision, note },
        });
      } else if (starterContentApproval) {
        await Promise.all([
          requiredUpdate(dependencies.store, COLLECTIONS.tasks, task.id, {
            status: 'succeeded',
            output: {
              decision: input.decision,
              note,
              approvedAt: now,
              publicationPackageTaskId,
              publicationState: 'package_generation_queued',
              externalPublishPerformed: false,
            },
            blocked_reason: '',
            updated_at: now,
          }),
          // Freeze the legacy graph until the typed package task hands back a
          // result. This prevents the periodic reconciler from creating an
          // account calendar or advancing into a platform-publish node.
          requiredUpdate(dependencies.store, COLLECTIONS.runs, run.id, {
            status: 'waiting_human',
            current_controller: 'agent',
            pause_reason: '已进入灵小量发布包待处理队列，等待可用 Worker；未创建日历、未发布。',
          }),
        ]);
        await dependencies.appendEvent({
          tenantId: input.tenantId,
          runId: run.id,
          taskId: task.id,
          type: 'approval.decided',
          level: 'success',
          summary: '内容已批准并进入灵小量发布包待处理队列，等待可用 Worker；未创建日历、未发布',
          payload: {
            decision: input.decision,
            note,
            publicationPackageTaskId,
            externalPublishPerformed: false,
          },
        });
      } else {
        await Promise.all([
          requiredUpdate(dependencies.store, COLLECTIONS.tasks, task.id, {
            status: 'succeeded',
            output: { decision: input.decision, note, approvedAt: now, publishingEntries },
            blocked_reason: '',
            updated_at: now,
          }),
          requiredUpdate(dependencies.store, COLLECTIONS.runs, run.id, {
            status: 'running',
            current_controller: 'agent',
            pause_reason: '',
          }),
        ]);
        await dependencies.appendEvent({
          tenantId: input.tenantId,
          runId: run.id,
          taskId: task.id,
          type: 'approval.decided',
          level: 'success',
          summary: '审批已通过，任务交还数字员工继续执行',
          payload: { decision: input.decision, note },
        });
        await dependencies.continueRun(input.tenantId, run.id);
      }

      return {
        state: 'decided',
        decision: input.decision,
        runId: run.id,
        taskId: task.id,
        publishingEntries,
        ...(publicationPackageTaskId ? { publicationPackageTaskId } : {}),
      };
    });
  };
}
