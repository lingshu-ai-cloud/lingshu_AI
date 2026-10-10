import { Router, type Request, type Response } from 'express';
import { store } from '../storage/index.js';
import { requireAuth, enforceSupportSessionReadOnly, type AuthLocals } from '../middleware/auth.js';

type AssistantThread = {
  id: string;
  tenantId: string;
  userId: string;
  source?: string;
  agentId: string;
  messages: unknown[];
  draftInput: string;
  scrollPosition: number;
  unreadCount: number;
  updatedAt: string;
};

export const assistantThreadsRouter = Router();
assistantThreadsRouter.use(requireAuth, enforceSupportSessionReadOnly);

assistantThreadsRouter.get('/', async (_req: Request, res: Response) => {
  const identity = res.locals as AuthLocals;
  const result = await store.list<AssistantThread>('assistant_threads', {
    where: { tenantId: identity.tenantId, userId: identity.userId, source: 'desktop' },
    perPage: 20,
  });
  res.json({ items: result.items });
});

assistantThreadsRouter.get('/:agentId', async (req: Request, res: Response) => {
  const identity = res.locals as AuthLocals;
  const result = await store.list<AssistantThread>('assistant_threads', {
    where: { tenantId: identity.tenantId, userId: identity.userId, source: 'desktop', agentId: req.params.agentId },
    perPage: 1,
  });
  res.json(result.items[0] ?? {
    id: '',
    tenantId: identity.tenantId,
    userId: identity.userId,
    source: 'desktop',
    agentId: req.params.agentId,
    messages: [],
    draftInput: '',
    scrollPosition: 0,
    unreadCount: 0,
  });
});

assistantThreadsRouter.put('/:agentId', async (req: Request, res: Response) => {
  const identity = res.locals as AuthLocals;
  const existing = await store.list<AssistantThread>('assistant_threads', {
    where: { tenantId: identity.tenantId, userId: identity.userId, source: 'desktop', agentId: req.params.agentId },
    perPage: 1,
  });
  const payload = {
    tenantId: identity.tenantId,
    userId: identity.userId,
    source: 'desktop',
    agentId: req.params.agentId,
    messages: Array.isArray(req.body.messages) ? req.body.messages : [],
    draftInput: String(req.body.draftInput ?? ''),
    scrollPosition: Number(req.body.scrollPosition ?? 0),
    unreadCount: Math.max(0, Number(req.body.unreadCount ?? 0)),
    updatedAt: new Date().toISOString(),
  };
  const current = existing.items[0];
  if (current?.id) {
    await store.update('assistant_threads', current.id, payload);
    res.json({ ...current, ...payload });
    return;
  }
  const created = await store.create<AssistantThread>('assistant_threads', payload);
  res.json(created ?? { id: '', ...payload });
});
