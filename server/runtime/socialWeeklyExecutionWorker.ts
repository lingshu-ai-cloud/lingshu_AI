import type { DataStore } from '../storage/datastore.js';
import type {
  VersionedSocialRef,
  WeeklyExecutionTask,
  WeeklyOperatingWorkflowKind,
} from '../../shared/contracts/socialProgram.js';
import {
  acquireDurableOperationLease,
  assertDurableOperationLease,
  releaseDurableOperationLease,
  renewDurableOperationLease,
  type DurableOperationLease,
} from './durableLease.js';
import {
  getWeeklyExecutionTaskRow,
  recomputePackageExecution,
  SOCIAL_WEEKLY_EXECUTION_LEASE_SCOPE,
  WEEKLY_EXECUTION_TASKS,
  withWeeklyExecutionTaskMutation,
  writeWeeklyExecutionTask,
  type WeeklyExecutionTaskRow,
} from '../socialPrograms/executionTasks.js';
import { SocialProgramError } from '../socialPrograms/service.js';

export interface WeeklyExecutionClaim {
  task: WeeklyExecutionTask;
  lease: DurableOperationLease;
}

function validRef(value: VersionedSocialRef): boolean {
  return Boolean(value?.type?.trim() && value?.id?.trim() && Number.isSafeInteger(value.version) && value.version > 0);
}

function sameLease(task: WeeklyExecutionTask, lease: DurableOperationLease): boolean {
  return task.lease?.leaseId === lease.id
    && task.lease.token === lease.token
    && task.lease.workerId === lease.ownerId
    && task.lease.expiresAt === lease.expiresAt;
}

async function candidates(dataStore: DataStore, tenantId: string): Promise<WeeklyExecutionTaskRow[]> {
  const [queued, leased] = await Promise.all([
    dataStore.list<WeeklyExecutionTaskRow>(WEEKLY_EXECUTION_TASKS, {
      where: { tenant_id: tenantId, status: 'queued' }, sort: 'created_at', page: 1, perPage: 500,
    }),
    dataStore.list<WeeklyExecutionTaskRow>(WEEKLY_EXECUTION_TASKS, {
      where: { tenant_id: tenantId, status: 'leased' }, sort: 'updated_at', page: 1, perPage: 500,
    }),
  ]);
  return [...queued.items, ...leased.items];
}

/**
 * Storage-backed consumer port only. It intentionally has no discovery,
 * generation, production or publishing adapter; callers execute the claimed
 * snapshot and return versioned result references through complete().
 */
export function createSocialWeeklyExecutionWorker(dataStore: DataStore) {
  async function currentClaim(claim: WeeklyExecutionClaim, now: Date): Promise<WeeklyExecutionTaskRow> {
    await assertDurableOperationLease({ dataStore, lease: claim.lease, now, minimumRemainingMs: 1 });
    const row = await getWeeklyExecutionTaskRow(dataStore, claim.task.tenantId, claim.task.taskId);
    if (row.payload.status !== 'leased' || !sameLease(row.payload, claim.lease)) {
      throw new SocialProgramError('weekly_execution_lease_lost', 409, '执行任务租约已丢失。');
    }
    return row;
  }

  async function recompute(task: WeeklyExecutionTask, now: Date) {
    await recomputePackageExecution(
      dataStore, task.tenantId, task.programId, task.packageId, task.packageVersion, now.toISOString(), true,
    );
  }

  return {
    async claimNext(input: {
      tenantId: string;
      workerId: string;
      kinds?: WeeklyOperatingWorkflowKind[];
      now?: Date;
      leaseDurationMs?: number;
      reclaimGraceMs?: number;
    }): Promise<WeeklyExecutionClaim | null> {
      const now = input.now ?? new Date();
      for (const row of await candidates(dataStore, input.tenantId)) {
        const task = row.payload;
        if (input.kinds?.length && !input.kinds.includes(task.workflowKind)) continue;
        if (task.status === 'queued' && task.nextAttemptAt && Date.parse(task.nextAttemptAt) > now.getTime()) continue;
        if (task.status === 'leased' && task.lease && Date.parse(task.lease.expiresAt) > now.getTime()) continue;
        const lease = await acquireDurableOperationLease({
          dataStore,
          tenantId: input.tenantId,
          scope: SOCIAL_WEEKLY_EXECUTION_LEASE_SCOPE,
          subjectId: task.taskId,
          ownerId: input.workerId,
          now,
          leaseDurationMs: input.leaseDurationMs,
          reclaimGraceMs: input.reclaimGraceMs,
        });
        if (!lease) continue;
        try {
          const claimed = await withWeeklyExecutionTaskMutation(dataStore, input.tenantId, task.taskId, async () => {
            const latest = await getWeeklyExecutionTaskRow(dataStore, input.tenantId, task.taskId);
            if (!['queued', 'leased'].includes(latest.payload.status)) return null;
            const next: WeeklyExecutionTask = {
              ...latest.payload,
              status: 'leased',
              attempt: latest.payload.attempt + 1,
              nextAttemptAt: null,
              lease: {
                leaseId: lease.id,
                token: lease.token,
                workerId: lease.ownerId,
                acquiredAt: lease.acquiredAt,
                expiresAt: lease.expiresAt,
              },
              lastError: latest.payload.status === 'leased' ? {
                code: 'lease_expired', message: '上一个 Worker 租约过期，任务已被重新领取。', retryable: true, occurredAt: now.toISOString(),
              } : latest.payload.lastError,
              updatedAt: now.toISOString(),
            };
            await writeWeeklyExecutionTask(dataStore, latest, next);
            return next;
          });
          if (!claimed) {
            await releaseDurableOperationLease({ dataStore, lease });
            continue;
          }
          return { task: claimed, lease };
        } catch (error) {
          await releaseDurableOperationLease({ dataStore, lease });
          throw error;
        }
      }
      return null;
    },

    async renew(claim: WeeklyExecutionClaim, input: { now?: Date; leaseDurationMs?: number } = {}): Promise<WeeklyExecutionClaim> {
      const now = input.now ?? new Date();
      return withWeeklyExecutionTaskMutation(dataStore, claim.task.tenantId, claim.task.taskId, async () => {
        const row = await currentClaim(claim, now);
        const lease = await renewDurableOperationLease({ dataStore, lease: claim.lease, now, leaseDurationMs: input.leaseDurationMs });
        const task: WeeklyExecutionTask = {
          ...row.payload,
          lease: { ...row.payload.lease!, expiresAt: lease.expiresAt },
          updatedAt: now.toISOString(),
        };
        await writeWeeklyExecutionTask(dataStore, row, task);
        return { task, lease };
      });
    },

    async complete(claim: WeeklyExecutionClaim, resultRefs: VersionedSocialRef[], now = new Date()): Promise<WeeklyExecutionTask> {
      if (!Array.isArray(resultRefs) || resultRefs.some(ref => !validRef(ref))) {
        throw new SocialProgramError('weekly_execution_result_refs_invalid', 400, '执行结果必须是有效的版本引用。');
      }
      const task = await withWeeklyExecutionTaskMutation(dataStore, claim.task.tenantId, claim.task.taskId, async () => {
        const row = await currentClaim(claim, now);
        const next: WeeklyExecutionTask = {
          ...row.payload, status: 'succeeded', resultRefs: structuredClone(resultRefs), lease: null,
          nextAttemptAt: null, updatedAt: now.toISOString(),
        };
        await writeWeeklyExecutionTask(dataStore, row, next);
        return next;
      });
      await releaseDurableOperationLease({ dataStore, lease: claim.lease });
      await recompute(task, now);
      return task;
    },

    async fail(claim: WeeklyExecutionClaim, input: {
      code: string;
      message: string;
      retryable: boolean;
      retryDelayMs?: number;
      now?: Date;
    }): Promise<WeeklyExecutionTask> {
      const now = input.now ?? new Date();
      const delay = Math.min(Math.max(Math.floor(input.retryDelayMs ?? 30_000), 0), 24 * 60 * 60_000);
      const task = await withWeeklyExecutionTaskMutation(dataStore, claim.task.tenantId, claim.task.taskId, async () => {
        const row = await currentClaim(claim, now);
        const retry = input.retryable && row.payload.attempt < row.payload.maxAttempts;
        const next: WeeklyExecutionTask = {
          ...row.payload,
          status: retry ? 'queued' : 'dead_letter',
          lease: null,
          nextAttemptAt: retry ? new Date(now.getTime() + delay).toISOString() : null,
          lastError: {
            code: input.code.trim().slice(0, 120) || 'worker_failed',
            message: input.message.trim().slice(0, 2_000) || '执行失败。',
            retryable: input.retryable,
            occurredAt: now.toISOString(),
          },
          updatedAt: now.toISOString(),
        };
        await writeWeeklyExecutionTask(dataStore, row, next);
        return next;
      });
      await releaseDurableOperationLease({ dataStore, lease: claim.lease });
      await recompute(task, now);
      return task;
    },
  };
}
