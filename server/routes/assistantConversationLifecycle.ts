import type { Router } from 'express';
import type { DataStore } from '../storage/datastore.js';
import type { AuthLocals } from '../middleware/auth.js';

type StoredRecord = { id: string } & Record<string, unknown>;

function pendingImageReplicationKeys(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  const keys = new Set<string>();
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const portal = (message as Record<string, unknown>).creationPortal;
    if (!portal || typeof portal !== 'object') continue;
    const value = portal as Record<string, unknown>;
    const imageReplication = value.imageReplication;
    if (!imageReplication || typeof imageReplication !== 'object') continue;
    const intake = (imageReplication as Record<string, unknown>).intake;
    if (!intake || typeof intake !== 'object') continue;
    const checkpoint = intake as Record<string, unknown>;
    if (checkpoint.submitted !== true || typeof checkpoint.imageTaskId === 'string') continue;
    if (typeof value.id === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(value.id)) keys.add(`${value.id}:content`);
  }
  return [...keys];
}

function isUnstartedAssistantDraft(row: StoredRecord, userId: string, idempotencyKey: string): boolean {
  const emptyCount = (key: string) => Number(row[key] ?? 0) === 0;
  return row.created_by === userId
    && row.create_idempotency_key === idempotencyKey
    && typeof row.task_id === 'string' && row.task_id.length > 0
    && row.task_mode === 'instant'
    && (row.status === 'draft' || row.status === 'plan_review')
    && Number.isSafeInteger(Number(row.version)) && Number(row.version) >= 1
    && !row.run_id && !row.weekly_plan_id
    && ['source_count', 'knowledge_source_count', 'material_source_count', 'artifact_count', 'approved_artifact_count',
      'delivery_package_count', 'publication_count', 'metric_submission_count'].every(emptyCount);
}

function resetRestoredImageDrafts(messages: unknown, version: number): unknown {
  if (!Array.isArray(messages)) return messages;
  return structuredClone(messages).map(message => {
    if (!message || typeof message !== 'object') return message;
    const portal = (message as Record<string, unknown>).creationPortal;
    if (!portal || typeof portal !== 'object') return message;
    const value = portal as Record<string, unknown>;
    const imageReplication = value.imageReplication;
    if (!imageReplication || typeof imageReplication !== 'object') return message;
    const intake = (imageReplication as Record<string, unknown>).intake;
    if (!intake || typeof intake !== 'object') return message;
    const checkpoint = intake as Record<string, unknown>;
    if (checkpoint.submitted !== true || typeof checkpoint.imageTaskId === 'string' || typeof value.id !== 'string') return message;
    value.id = `${value.id.slice(0, 80)}-retry-${version}`;
    checkpoint.submitted = false;
    return message;
  });
}

/**
 * Remove a half-created assistant draft from active queues without deleting
 * its audit row. Formal tasks, weekly work and anything with a run or output
 * fail closed and remain untouched.
 */
async function cancelUnstartedAssistantDrafts(store: DataStore, tenantId: string, userId: string, messages: unknown, updatedAt: string) {
  for (const idempotencyKey of pendingImageReplicationKeys(messages)) {
    const result = await store.list<StoredRecord>('starter_social_content_tasks', {
      where: { tenant_id: tenantId, create_idempotency_key: idempotencyKey }, perPage: 2,
    });
    if (result.totalItems > 1 || result.items.length > 1) throw new Error('assistant_draft_task_integrity_violation');
    const row = result.items[0];
    if (!row || !isUnstartedAssistantDraft(row, userId, idempotencyKey)) continue;
    const childRuns = await store.list<StoredRecord>('studio_projects', {
      where: { tenant_id: tenantId, workflow_task_id: String(row.task_id || '') }, perPage: 2,
    });
    if (childRuns.totalItems || childRuns.items.length) continue;
    if (!store.compareAndSwap) throw new Error('assistant_draft_task_cas_unavailable');
    const nextVersion = String(Number(row.version) + 1);
    const cancelled = await store.compareAndSwap('starter_social_content_tasks', row.id, {
      tenant_id: tenantId, created_by: userId, create_idempotency_key: idempotencyKey,
      task_mode: 'instant', status: row.status, run_id: row.run_id, version: row.version,
    }, { status: 'cancelled', version: nextVersion, updated_by: userId, updated_at: updatedAt,
      cancellation_reason: 'assistant_conversation_discarded' });
    if (!cancelled) throw new Error('assistant_draft_task_changed');
  }
}

/** Scrub only the conversation; retain the row/version to reject stale writers. */
export function registerAssistantConversationLifecycle(router: Router, store: DataStore) {
  router.post('/:agentId/clear', handle(false));
  router.delete('/:agentId', handle(true));
  router.post('/:agentId/restore', handle(false, true));
  function handle(deleting: boolean, restoring = false) {
    return async (req: import('express').Request, res: import('express').Response) => {
      const { tenantId, userId } = res.locals as AuthLocals;
      const agentId = req.params.agentId;
      if (!/^(?:business|conversation:[a-zA-Z0-9-]+)$/.test(agentId)) {
        res.status(400).json({ error: 'assistant_conversation_invalid', message: '会话编号无效。' }); return;
      }
      const expectedVersion = req.body?.expectedVersion;
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
        res.status(428).json({ error: 'assistant_thread_version_required', message: '请刷新会话后重试。' }); return;
      }
      try {
        const owner = { tenantId, userId, agentId };
        const result = await store.list('assistant_threads', { where: owner, perPage: 1 });
        const current = result.items[0];
        if (!current || (current.deletedAt && !restoring) || (current.source && current.source !== 'desktop')) {
          res.status(404).json({ error: 'assistant_conversation_not_found', message: '会话已删除或不存在。' }); return;
        }
        if (current.version !== expectedVersion) {
          res.status(409).json({ error: 'assistant_thread_version_conflict', message: '会话已在其他位置更新，请重新打开后操作。' }); return;
        }
        if (current.pendingContentTaskBinding) {
          res.status(409).json({ error: 'assistant_task_receipt_pending', message: '请先恢复当前任务回执，再清空或删除会话。' }); return;
        }
        const version = expectedVersion + 1;
        const updatedAt = new Date().toISOString();
        const recovery = current.conversationRecovery && typeof current.conversationRecovery === 'object'
          ? current.conversationRecovery as Record<string, unknown> : null;
        if (restoring && !recovery) {
          res.status(409).json({ error: 'assistant_recovery_unavailable', message: '这条会话暂无可恢复的备份。' }); return;
        }
        const backupKeys = ['messages', 'draftInput', 'creationDraft', 'scrollPosition', 'unreadCount',
          'isFollowingLatest', 'focusedTaskId', 'taskCards', 'title', 'paused'];
        const snapshot = Object.fromEntries(backupKeys.filter(key => current[key] !== undefined).map(key => [key, current[key]]));
        if (!restoring) await cancelUnstartedAssistantDrafts(store, tenantId, userId, current.messages, updatedAt);
        const restoredRecovery = restoring && recovery
          ? { ...recovery, messages: resetRestoredImageDrafts(recovery.messages, version) } : recovery;
        const patch = restoring ? { ...restoredRecovery, deletedAt: '', conversationRecovery: null,
          conversationResetVersion: version, version, updatedAt } : { conversationRecovery: snapshot, messages: [], draftInput: '', creationDraft: null, scrollPosition: 0,
          unreadCount: 0, isFollowingLatest: true, focusedTaskId: null, taskCards: {},
          title: deleting ? '' : current.title || '新会话', deletedAt: deleting ? updatedAt : '',
          conversationResetVersion: version, version, updatedAt };
        // pendingContentTaskBinding is recovery evidence, not chat text. Preserve it.
        if (!await store.compareAndSwap?.('assistant_threads', current.id, { ...owner, version: expectedVersion }, patch)) {
          res.status(409).json({ error: 'assistant_thread_version_conflict', message: '会话状态已变化，请重新打开后操作。' }); return;
        }
        const next = { ...current, ...patch };
        // PocketBase stores an optional text value as ''. Keep lifecycle
        // responses compatible with the normal GET/PUT conversation contract.
        res.json({ ...next, focusedTaskId: next.focusedTaskId || null });
      } catch {
        res.status(503).json({ error: 'assistant_conversation_unavailable', message: '会话暂时无法更新，请稍后重试。' });
      }
    };
  }
}
