import { withStarter198RunMutationLease } from '../starter198/runMutationLease.js';
import { createHash } from 'node:crypto';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { cancelDigitalEmployeeRun } from '../digitalEmployees/runCancellation.js';
import { controlContentExecutionJob } from '../contentExecution/durableQueue.js';
import { parseContentProviderReceipts } from '../contentExecution/context.js';
import { acquireDurableOperationLease, assertDurableOperationLease, renewDurableOperationLease, releaseDurableOperationLease } from '../runtime/durableLease.js';
import { SocialProgramError } from './service.js';

export const WEEKLY_CANCELLATIONS = 'social_weekly_cancellations';
type Effect = { resourceType: 'production_job' | 'publication_attempt'; resourceId: string; outcome: 'irreversible' | 'unknown_requires_reconciliation'; receiptRefs: string[] };
type CancellationRow = Record_ & { tenant_id: string; package_id: string; package_version: number; status: string; checkpoints: string[]; effects: Effect[] };
const text = (value: unknown) => String(value ?? '').trim();
async function all(store: DataStore, collection: string, where: Record<string, string | number>) {
  const rows: Record_[] = [];
  for (let page = 1; ; page++) {
    const result = await store.list<Record_>(collection, { where, sort: 'id', page, perPage: 500 });
    rows.push(...result.items.filter(row => Object.entries(where).every(([key, value]) => row[key] === value)));
    if (page >= result.totalPages || !result.items.length) return rows;
  }
}

/** Stop future stages. Existing paid, sent or published effects remain evidence, never a fictitious rollback. */
export async function reconcileWeeklyCancellation(input: {
  dataStore: DataStore; tenantId: string; programId: string; packageId: string; packageVersion: number;
  reason: string; now: string; cancelPending: () => Promise<void>;
}): Promise<CancellationRow> {
  const { dataStore: store, tenantId, packageId, packageVersion } = input;
  const id = createHash('sha256').update(`${tenantId}\0${packageId}\0${packageVersion}`).digest('hex').slice(0, 15);
  let lease = await acquireDurableOperationLease({ dataStore: store, tenantId, scope: 'social-weekly-cancellation', subjectId: id, ownerId: `cancel:${process.pid}`, leaseDurationMs: 120_000 });
  if (!lease) throw new SocialProgramError('weekly_cancellation_busy', 409, '撤回补偿处理中，请稍后重试。');
  let receipt: CancellationRow | null = null;
  try {
    receipt = await store.getById<CancellationRow>(WEEKLY_CANCELLATIONS, id);
    if (!receipt) receipt = await store.create<CancellationRow>(WEEKLY_CANCELLATIONS, {
      id, tenant_id: tenantId, program_id: input.programId, package_id: packageId, package_version: packageVersion,
      status: 'in_progress', reason: input.reason, checkpoints: [], effects: [], last_error: null,
      boundary: 'stop_future_work_preserve_external_effects', created_at: input.now, updated_at: input.now,
    });
    if (!receipt || receipt.tenant_id !== tenantId || receipt.package_id !== packageId || receipt.package_version !== packageVersion) throw new Error('weekly_cancellation_receipt_unavailable');
    if (['completed', 'completed_with_external_effects'].includes(receipt.status)) return receipt;
    const assertLease = async () => {
      await assertDurableOperationLease({ dataStore: store, lease: lease!, minimumRemainingMs: 1 });
      if (Date.parse(lease!.expiresAt) - Date.now() < 30_000) lease = await renewDurableOperationLease({ dataStore: store, lease: lease!, leaseDurationMs: 120_000 });
    };
    const checkpoint = async (key: string, action: () => Promise<void>) => {
      await assertLease();
      if (receipt!.checkpoints.includes(key)) return;
      await action();
      await assertLease();
      const checkpoints = [...receipt!.checkpoints, key];
      if (!await store.update(WEEKLY_CANCELLATIONS, id, { status: 'in_progress', checkpoints, effects: receipt!.effects, last_error: null, updated_at: input.now })) throw new Error('weekly_cancellation_checkpoint_unavailable');
      receipt!.checkpoints = checkpoints;
    };
    await checkpoint('weekly_tasks', input.cancelPending);
    const bindings = (await all(store, 'starter_social_content_tasks', { tenant_id: tenantId, weekly_plan_id: packageId }))
      .filter(row => text(row.create_idempotency_key).startsWith(`weekly-production:${packageId}:${packageVersion}:`));
    for (const binding of bindings) {
      const runId = text(binding.run_id);
      if (runId) {
        for (const job of await all(store, 'content_execution_jobs', { tenant_id: tenantId, run_id: runId, task_id: text(binding.task_id) })) {
          await checkpoint(`job:${job.id}`, async () => {
            const receipts = parseContentProviderReceipts(job.provider_receipts);
            const unknown = ['running', 'reconciling'].includes(text(job.status)) || receipts.some(item => ['unknown', 'submitting', 'accepted'].includes(text(item.state)));
            if (receipts.length || unknown || job.status === 'succeeded') {
              receipt!.effects = [...receipt!.effects.filter(effect => effect.resourceId !== job.id), { resourceType: 'production_job', resourceId: job.id, outcome: unknown ? 'unknown_requires_reconciliation' : 'irreversible', receiptRefs: receipts.map(item => text(item.providerTaskId || item.requestId)).filter(Boolean) }];
            }
            if (!['succeeded', 'cancelled'].includes(text(job.status))) await controlContentExecutionJob({ dataStore: store, tenantId, jobId: job.id, action: 'cancel', now: new Date(input.now) });
          });
        }
        await checkpoint(`run:${runId}`, async () => withStarter198RunMutationLease({ dataStore: store, tenantId, runId, action: async () => {
          const run = await store.getById<Record_>('workflow_runs', runId);
          if (!run || run.tenant_id !== tenantId) throw new Error('weekly_cancellation_run_identity_invalid');
          if (!['succeeded', 'failed', 'completed', 'cancelled'].includes(text(run.status))) await cancelDigitalEmployeeRun({ dataStore: store, tenantId, userId: 'weekly-cancellation', runId, reason: input.reason, now: new Date(input.now) });
        } }));
      }
      await checkpoint(`binding:${binding.id}`, async () => {
        if (!['completed', 'cancelled'].includes(text(binding.status)) && !await store.update('starter_social_content_tasks', binding.id, { status: 'paused', updated_at: input.now, cancellation_reason: input.reason })) throw new Error('weekly_cancellation_binding_unavailable');
      });
    }
    for (const assignment of await all(store, 'social_publication_assignments', { tenant_id: tenantId, operating_package_id: packageId, operating_package_version: packageVersion })) {
      await checkpoint(`assignment:${assignment.id}`, async () => {
        const attempts = await all(store, 'social_publication_attempts', { tenant_id: tenantId, assignment_id: text(assignment.assignment_id) });
        const affected = attempts.filter(row => ['published', 'unknown', 'in_flight'].includes(text(row.status)));
        for (const attempt of affected) receipt!.effects = [...receipt!.effects.filter(effect => effect.resourceId !== attempt.id), { resourceType: 'publication_attempt', resourceId: attempt.id, outcome: attempt.status === 'published' ? 'irreversible' : 'unknown_requires_reconciliation', receiptRefs: [text(attempt.provider_receipt_id), text(attempt.platform_post_id)].filter(Boolean) }];
        if (!await store.update('social_publication_assignments', assignment.id, { status: 'revoked', authorization_revoked_at: input.now, authorization_revoked_by: input.reason, receipt_recovery_required: affected.some(row => row.status !== 'published'), updated_at: input.now })) throw new Error('weekly_cancellation_assignment_unavailable');
      });
    }
    await assertLease();
    const status = receipt.effects.length ? 'completed_with_external_effects' : 'completed';
    if (!await store.update(WEEKLY_CANCELLATIONS, id, { status, effects: receipt.effects, updated_at: input.now, completed_at: input.now, last_error: null })) throw new Error('weekly_cancellation_finalize_unavailable');
    return { ...receipt, status, last_error: null, completed_at: input.now, updated_at: input.now };
  } catch (error) {
    if (receipt) {
      await assertDurableOperationLease({ dataStore: store, lease: lease!, minimumRemainingMs: 1 });
      await store.update(WEEKLY_CANCELLATIONS, id, { status: 'partial_failure', effects: receipt.effects, last_error: error instanceof Error ? error.message : 'weekly_cancellation_failed', updated_at: input.now });
    }
    throw new SocialProgramError('weekly_cancellation_partial_failure', 503, '已停止部分后续工作，已有付费或发布结果不会回滚；撤回记录已保留，请重试继续补偿。');
  } finally { await releaseDurableOperationLease({ dataStore: store, lease }); }
}

export async function readWeeklyCancellationReceipt(input: { dataStore: DataStore; tenantId: string; programId: string; packageId: string; packageVersion: number }) {
  const id = createHash('sha256').update(`${input.tenantId}\0${input.packageId}\0${input.packageVersion}`).digest('hex').slice(0, 15);
  const receipt = await input.dataStore.getById<CancellationRow>(WEEKLY_CANCELLATIONS, id);
  if (!receipt || receipt.tenant_id !== input.tenantId || receipt.program_id !== input.programId || receipt.package_id !== input.packageId || receipt.package_version !== input.packageVersion) return null;
  return receipt;
}

export async function readWeeklyCancellation(dataStore: DataStore, tenantId: string, programId: string, packageId: string, version: number) {
  const receipt = await readWeeklyCancellationReceipt({ dataStore, tenantId, programId, packageId, packageVersion: version });
  if (!receipt) return null;
  return { status: receipt.status, boundary: String(receipt.boundary), effects: receipt.effects.map(effect => ({ resourceType: effect.resourceType, resourceId: effect.resourceId, outcome: effect.outcome, receiptCount: effect.receiptRefs.length })), lastError: receipt.last_error ? '部分清理未完成，请重试撤回以继续补偿。' : null, updatedAt: String(receipt.updated_at) };
}

/** Serializes creation/admission against cancellation; a cancelled package never admits a new provider job. */
export async function withWeeklyProductionAdmissionGuard<T>(input: { dataStore: DataStore; tenantId: string; packageId: string; packageVersion: number; action: (assertActive: () => Promise<void>) => Promise<T> }): Promise<T> {
  const id = createHash('sha256').update(`${input.tenantId}\0${input.packageId}\0${input.packageVersion}`).digest('hex').slice(0, 15);
  let lease = await acquireDurableOperationLease({ dataStore: input.dataStore, tenantId: input.tenantId, scope: 'social-weekly-cancellation', subjectId: id, ownerId: `admission:${process.pid}`, leaseDurationMs: 120_000 });
  if (!lease) throw new SocialProgramError('weekly_cancellation_busy', 409, '本周撤回或生产准入正在处理，请重试。');
  let lost: unknown = null;
  let renewal: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    renewal = renewal.then(async () => {
      if (!lost) {
        try { lease = await renewDurableOperationLease({ dataStore: input.dataStore, lease: lease!, leaseDurationMs: 120_000 }); }
        catch (error) { lost = error; }
      }
    });
  }, 30_000);
  timer.unref();
  const assertActive = async () => {
    await renewal;
    if (lost) throw lost;
    await assertDurableOperationLease({ dataStore: input.dataStore, lease: lease!, minimumRemainingMs: 1 });
  };
  try {
    const receipt = await input.dataStore.getById<CancellationRow>(WEEKLY_CANCELLATIONS, id);
    if (receipt) throw new SocialProgramError('weekly_package_cancelled', 409, '该周版本已开始撤回，不能创建或启动新的生产。');
    await assertActive();
    const result = await input.action(assertActive);
    await assertActive();
    return result;
  } finally { clearInterval(timer); await renewal; await releaseDurableOperationLease({ dataStore: input.dataStore, lease: lease! }); }
}
