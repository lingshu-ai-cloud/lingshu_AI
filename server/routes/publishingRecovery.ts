import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { isBrowserReadToken } from '../digitalEmployees/browserReadSession.js';
import { store } from '../storage/index.js';
import type { PostRecord } from '../publishing/waLink.js';
import { recoverPublishingReceipt } from '../publishing/receiptRecovery.js';
export const publishingRecoveryRouter = Router();
publishingRecoveryRouter.use(requireAuth);
publishingRecoveryRouter.get('/posts/:postId/attempts', async (req, res) => {
  const post = await store.getById<PostRecord>('posts', String(req.params.postId));
  if (!post || post.tenant_id !== (res.locals as AuthLocals).tenantId) { res.status(404).json({ error: '发布记录不存在' }); return; }
  res.json({ postId: post.id, platform: post.platform, status: post.stats?.status, attempts: post.stats?.publishResults || {}, querySupported: post.platform === 'youtube' });
});
publishingRecoveryRouter.post('/posts/:postId/reconcile', async (req, res) => {
  if (isBrowserReadToken(req.headers.authorization)) { res.status(403).json({ error: '只读会话不能补写回执' }); return; }
  try {
    const post = await recoverPublishingReceipt({ tenantId: (res.locals as AuthLocals).tenantId, postId: String(req.params.postId), accountId: String(req.body.accountId || ''), attemptId: String(req.body.attemptId || ''), platformPostId: String(req.body.platformPostId || '') });
    res.json({ post });
  } catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : '回执核对失败' }); }
});
