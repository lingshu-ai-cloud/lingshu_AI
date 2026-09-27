import { scheduleManagedSocialArtifact, reconcileManagedSocialPublications } from './socialContentManagedPublishing.js';
import { store } from '../storage/index.js';
import type { DataStore } from '../storage/datastore.js';
import { createStarter198Repository, STARTER_COLLECTIONS, type StarterRecord } from './repository.js';
import { createStarter198OrchestratorQueue } from './orchestratorQueue.js';
import { startSocialContentTask } from './socialContentTasks.js';
import { socialJson, socialObject, socialText } from './socialContentValidation.js';
import { starterWorkerRuntimeIssue } from './workerRuntime.js';
import { withSocialContentSubjectLease, assertSocialContentSubjectLease } from './socialContentMutation.js';

export function managedReferenceResume(row: StarterRecord, now: Date): { requestId: string; userId: string; attempts: number } | null {
  const brief = socialObject(socialJson(row.brief));
  const intent = socialObject(brief?._managedStart);
  if (brief?.managementMode !== 'one_click_managed' || !['draft', 'needs_input', 'plan_review'].includes(socialText(row.status))
    || intent?.status !== 'queued' || !socialText(intent.requestId) || !socialText(intent.userId)
    || !Number.isInteger(intent.attempts) || Number(intent.attempts) < 0 || Number(intent.attempts) >= 8
    || !Number.isFinite(Date.parse(socialText(intent.nextAttemptAt))) || Date.parse(socialText(intent.nextAttemptAt)) > now.getTime()) return null;
  return { requestId: socialText(intent.requestId), userId: socialText(intent.userId), attempts: Number(intent.attempts) };
}

async function statusRows(dataStore: DataStore, status: string): Promise<StarterRecord[]> {
  // Snapshot identities before mutating statuses, otherwise page shifts can skip work.
  const rows: StarterRecord[] = [];
  for (let page = 1; ; page++) {
    const result = await dataStore.list<StarterRecord>(STARTER_COLLECTIONS.socialContentTasks, { where: { status }, sort: 'id', page, perPage: 100 });
    rows.push(...result.items);
    if (!result.items.length || page >= result.totalPages) return rows;
  }
}

/** Resume only an explicit persisted start command, never arbitrary saved drafts. */
export async function runSocialContentManagedRecovery(input: { dataStore?: DataStore; now?: Date } = {}): Promise<{ resumed: number; blocked: number }> {
  const dataStore = input.dataStore ?? store;
  const repository = createStarter198Repository(dataStore);
  const now = input.now ?? new Date();
  const queue = createStarter198OrchestratorQueue({ repository, dataStore });
  const outcome = { resumed: 0, blocked: 0 };
  for (const status of ['needs_input', 'plan_review']) {
    const rows = await statusRows(dataStore, status);
    for (const row of rows) {
      const resume = managedReferenceResume(row, now);
      const tenantId = socialText(row.tenant_id);
      const taskId = socialText(row.task_id);
      if (!resume || !tenantId || !taskId) continue;
      try {
        await startSocialContentTask({ repository, orchestratorQueue: queue, tenantId, taskId, userId: resume.userId,
          expectedVersion: socialText(row.version), idempotencyKey: `managed-reference:${resume.requestId}:${resume.attempts}`, now });
        outcome.resumed++;
      } catch (error) {
        const reason = socialText((error as { code?: string }).code) || 'managed_reference_resume_failed';
        if (['social_content_task_version_conflict', 'social_content_subject_busy', 'social_content_operation_in_progress'].includes(reason)) continue;
        await withSocialContentSubjectLease({ repository, tenantId, subjectId: taskId, action: async () => {
          const current = await repository.get(STARTER_COLLECTIONS.socialContentTasks, tenantId, row.id);
          if (!current || !managedReferenceResume(current, now)) return;
          const brief = socialObject(socialJson(current.brief)) || {};
          const intent = socialObject(brief._managedStart) || {};
          if (intent.requestId !== resume.requestId) return;
          await assertSocialContentSubjectLease({ repository, tenantId, subjectId: taskId });
          await repository.update(STARTER_COLLECTIONS.socialContentTasks, tenantId, row.id, {
            brief: { ...brief, _managedStart: { ...intent, status: 'blocked', reason } }, status: 'attention',
            version: String(Number(current.version) + 1), updated_at: now.toISOString(),
          });
          outcome.blocked++;
        } }).catch(() => { outcome.blocked++; });
      }
    }
  }
  // Finished media stays immutable. A publication retry only re-enters the
  // grant/account/calendar bridge, never voice, generation or rendering.
  for (const status of ['delivered', 'awaiting_publish', 'awaiting_metrics']) {
    const rows = await statusRows(dataStore, status);
    for (const row of rows) {
      const brief = socialObject(socialJson(row.brief));
      const pending = socialObject(brief?._managedPublishing);
      const tenantId = socialText(row.tenant_id), taskId = socialText(row.task_id);
      if (tenantId && taskId && brief?.managementMode === 'one_click_managed' && pending?.status === 'scheduled'
        && socialText(pending.artifactId) && Array.isArray(pending.postIds)
        && Number.isFinite(Date.parse(socialText(pending.nextAttemptAt))) && Date.parse(socialText(pending.nextAttemptAt)) <= now.getTime()) {
        const postIds = pending.postIds.map(socialText).filter(Boolean);
        await withSocialContentSubjectLease({ repository, tenantId, subjectId: taskId, action: async () => {
          const before = await repository.get(STARTER_COLLECTIONS.socialContentTasks, tenantId, row.id);
          if (!before || !['delivered', 'awaiting_publish', 'awaiting_metrics'].includes(socialText(before.status))) return;
          const currentPending = socialObject(socialObject(socialJson(before.brief))?._managedPublishing);
          if (currentPending?.status !== 'scheduled' || currentPending.artifactId !== pending.artifactId
            || JSON.stringify(currentPending.postIds) !== JSON.stringify(pending.postIds)) return;
          const receipts = await reconcileManagedSocialPublications({ repository, tenantId, taskId,
            artifactId: socialText(pending.artifactId), postIds });
          const current = await repository.get(STARTER_COLLECTIONS.socialContentTasks, tenantId, row.id);
          if (!current) return;
          await assertSocialContentSubjectLease({ repository, tenantId, subjectId: taskId });
          await repository.update(STARTER_COLLECTIONS.socialContentTasks, tenantId, row.id, {
            brief: { ...socialObject(socialJson(current.brief)), _managedPublishing: { ...currentPending,
              status: receipts.pending === 0 ? 'observing' : 'scheduled', receiptSync: receipts,
              nextAttemptAt: new Date(now.getTime() + 60_000).toISOString(),
            } }, version: String(Number(current.version) + 1), updated_at: now.toISOString(),
          });
        } }).catch(() => { outcome.blocked++; });
        continue;
      }
      if (!tenantId || !taskId || brief?.managementMode !== 'one_click_managed' || pending?.status !== 'blocked'
        || !socialText(pending.artifactId) || !Number.isInteger(pending.attempts) || Number(pending.attempts) >= 12
        || !Number.isFinite(Date.parse(socialText(pending.nextAttemptAt))) || Date.parse(socialText(pending.nextAttemptAt)) > now.getTime()) continue;
      await withSocialContentSubjectLease({ repository, tenantId, subjectId: taskId, action: async () => {
        const before = await repository.get(STARTER_COLLECTIONS.socialContentTasks, tenantId, row.id);
        const currentPending = socialObject(socialObject(socialJson(before?.brief))?._managedPublishing);
        if (!before || !['delivered', 'awaiting_publish'].includes(socialText(before.status))
          || currentPending?.status !== 'blocked' || currentPending.attempts !== pending.attempts) return;
        const result = await scheduleManagedSocialArtifact({ repository, tenantId, taskId, artifactId: socialText(pending.artifactId), now })
          .catch(error => ({ status: 'blocked' as const, reason: error instanceof Error ? error.message : 'managed_publishing_unavailable' }));
        const current = await repository.get(STARTER_COLLECTIONS.socialContentTasks, tenantId, row.id);
        if (!current) return;
        const attempts = Number(pending.attempts) + 1;
        await assertSocialContentSubjectLease({ repository, tenantId, subjectId: taskId });
        await repository.update(STARTER_COLLECTIONS.socialContentTasks, tenantId, row.id, {
          brief: { ...socialObject(socialJson(current.brief)), _managedPublishing: { ...result,
            artifactId: pending.artifactId, attempts,
            retryExhausted: result.status === 'blocked' && attempts >= 12,
            nextAttemptAt: new Date(now.getTime() + Math.min(30 * 60_000, 60_000 * 2 ** attempts)).toISOString(),
          } }, version: String(Number(current.version) + 1), updated_at: now.toISOString(),
        });
        if (result.status === 'scheduled') outcome.resumed++; else outcome.blocked++;
      } }).catch(() => { outcome.blocked++; });
    }
  }
  return outcome;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
export function initSocialContentManagedRecovery(): void {
  if (timer || starterWorkerRuntimeIssue('STARTER_198_ORCHESTRATOR_WORKER_ENABLED')) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runSocialContentManagedRecovery(); }
    catch (error) { console.error('[social-managed-recovery]', error instanceof Error ? error.message : 'recovery_failed'); }
    finally { running = false; }
  };
  void tick(); timer = setInterval(() => { void tick(); }, 30_000); timer.unref?.();
}
