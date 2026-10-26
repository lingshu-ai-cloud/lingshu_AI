import type { Router } from 'express';
import type { DataStore } from '../storage/datastore.js';
import type { AuthLocals } from '../middleware/auth.js';

/** Scrub only the conversation; retain the row/version to reject stale writers. */
export function registerAssistantConversationLifecycle(router: Router, store: DataStore) {
  router.post('/:agentId/clear', handle(false));
  router.delete('/:agentId', handle(true));
  function handle(deleting: boolean) {
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
        if (!current || current.deletedAt || (current.source && current.source !== 'desktop')) {
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
        const patch = { messages: [], draftInput: '', creationDraft: null, scrollPosition: 0,
          unreadCount: 0, isFollowingLatest: true, focusedTaskId: null, taskCards: {},
          title: deleting ? '' : current.title || '新会话', deletedAt: deleting ? updatedAt : '',
          conversationResetVersion: version, version, updatedAt };
        // pendingContentTaskBinding is recovery evidence, not chat text. Preserve it.
        if (!await store.compareAndSwap?.('assistant_threads', current.id, { ...owner, version: expectedVersion }, patch)) {
          res.status(409).json({ error: 'assistant_thread_version_conflict', message: '会话状态已变化，请重新打开后操作。' }); return;
        }
        res.json({ ...current, ...patch });
      } catch {
        res.status(503).json({ error: 'assistant_conversation_unavailable', message: '会话暂时无法更新，请稍后重试。' });
      }
    };
  }
}
