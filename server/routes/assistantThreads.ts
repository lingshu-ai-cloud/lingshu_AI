import { Router, type Request, type RequestHandler, type Response } from 'express';
import { store } from '../storage/index.js';
import type { DataStore } from '../storage/datastore.js';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import {
  AssistantActionError,
  createAssistantActionService,
  type AssistantActionSupportProbe,
  type AssistantActionService,
} from '../assistant/actionRouting.js';
import { createStarter198AssistantCommandBus } from '../assistant/starter198CommandBus.js';
import {
  Starter198RepositoryError,
  starter198Repository,
} from '../starter198/repository.js';
import {
  isAssistantActionId,
  type AssistantActionId,
} from '../../shared/contracts/assistantActions.js';

const MAX_THREAD_BYTES = 96 * 1024;
const MAX_MESSAGES = 120;
const MAX_MESSAGE_BYTES = 8 * 1024;
const MAX_MESSAGE_SOURCES = 8;
const MAX_DRAFT_BYTES = 8 * 1024;
const MAX_TASK_CARDS = 50;
const MAX_CARD_BYTES = 16 * 1024;
const MAX_SCROLL_POSITION = 10_000_000;
const MAX_UNREAD_COUNT = 10_000;
const SAFE_TASK_ID = /^[a-z0-9:_-]{1,200}$/i;
const UNSAFE_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const CARD_STATUSES = new Set([
  'needs_input', 'approval', 'ready', 'running', 'paused', 'failed', 'completed',
]);
const CARD_NOTIFICATION_REASONS = new Set([
  'missing_input', 'approval_required', 'failed', 'routine',
]);
const STARTER_SCOPED_ACTIONS = new Set<AssistantActionId>([
  'view_status',
  'start_task',
  'pause_task',
  'resume_task',
  'confirm_choice',
  'accept_result',
  'request_revision',
]);

const supportsDefaultAssistantExecution: AssistantActionSupportProbe = async (command, context) => {
  if (!STARTER_SCOPED_ACTIONS.has(command.actionId)) return true;
  try {
    await starter198Repository.access(context.tenantId);
    return true;
  } catch (error) {
    if (error instanceof Starter198RepositoryError && error.code === 'starter_198_not_provisioned') {
      return false;
    }
    if (error instanceof Starter198RepositoryError) {
      throw new AssistantActionError(
        'assistant_action_access_unavailable',
        503,
        '助手操作服务暂时不可用。',
      );
    }
    throw error;
  }
};

type AssistantThreadAction = {
  id: string;
  label: string;
  href?: string;
  prompt?: string;
  disabled?: boolean;
};

type AssistantThreadTaskCard = {
  taskId: string;
  title: string;
  conclusion: string;
  details: string[];
  items?: Array<{
    id: string;
    title: string;
    thumbnailUrl?: string;
    accountLabel?: string;
    transition?: string;
    note?: string;
  }>;
  status: string;
  notificationReason: string;
  primaryAction?: AssistantThreadAction;
  secondaryActions: AssistantThreadAction[];
  workspace?: { label: string; href: string };
  updatedAt: number;
};

type AssistantThread = {
  id: string;
  tenantId: string;
  userId: string;
  agentId: string;
  version: number;
  messages: unknown[];
  draftInput: string;
  scrollPosition: number;
  unreadCount: number;
  isFollowingLatest: boolean;
  paused: boolean;
  taskCards: Record<string, AssistantThreadTaskCard>;
  focusedTaskId: string | null;
  updatedAt: string;
};

export type AssistantThreadsRouterDependencies = {
  dataStore?: DataStore;
  authMiddleware?: RequestHandler;
  actionService?: AssistantActionService;
};

function actionHttpStatus(status: string): number {
  if (status === 'accepted' || status === 'delegated') return 202;
  if (status === 'missing_required_input') return 422;
  if (status === 'stale_action') return 409;
  if (status === 'failed') return 502;
  return 200;
}

function safeAgentId(value: unknown): string {
  const agentId = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-z0-9:_-]{1,80}$/i.test(agentId)) {
    throw new AssistantActionError('assistant_agent_id_invalid', 400, '助手编号无效。');
  }
  return agentId;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function threadInputError(code: string, message: string, status = 400): never {
  throw new AssistantActionError(code, status, message);
}

function expectedThreadVersion(value: unknown): number {
  const source = object(value);
  const version = source?.expectedVersion;
  if (!Number.isSafeInteger(version) || Number(version) < 0) {
    return threadInputError(
      'assistant_thread_version_required',
      '会话版本缺失，请刷新后重试。',
      428,
    );
  }
  return Number(version);
}

function boundedText(value: unknown, maxBytes: number, code: string, label: string, required = false): string {
  if (typeof value !== 'string') {
    if (!required && value === undefined) return '';
    return threadInputError(code, `${label}格式无效。`);
  }
  const normalized = value.trim();
  if ((required && !normalized) || byteLength(value) > maxBytes) {
    return threadInputError(code, `${label}${required && !normalized ? '不能为空' : '过长'}。`);
  }
  return value;
}

function safeLocalHref(value: unknown, code: string): string | undefined {
  if (value === undefined) return undefined;
  const href = boundedText(value, 2_048, code, '工作区链接', true).trim();
  if (!/^\/(?!\/)/.test(href) || /[\\\u0000-\u001f]/.test(href)) {
    return threadInputError(code, '工作区链接无效。');
  }
  return href;
}

function parsePersistedAction(value: unknown): AssistantThreadAction {
  const source = object(value);
  if (!source) return threadInputError('assistant_thread_action_invalid', '卡片操作无效。');
  const id = boundedText(source.id, 100, 'assistant_thread_action_invalid', '卡片操作编号', true).trim();
  const label = boundedText(source.label, 120, 'assistant_thread_action_invalid', '卡片操作名称', true).trim();
  if (!SAFE_TASK_ID.test(id)) return threadInputError('assistant_thread_action_invalid', '卡片操作编号无效。');
  if (source.actionId !== undefined && !isAssistantActionId(source.actionId)) {
    return threadInputError('assistant_thread_action_invalid', '卡片操作类型无效。');
  }
  if (source.disabled !== undefined && typeof source.disabled !== 'boolean') {
    return threadInputError('assistant_thread_action_invalid', '卡片操作状态无效。');
  }
  const prompt = source.prompt === undefined
    ? undefined
    : boundedText(source.prompt, 4_000, 'assistant_thread_action_invalid', '卡片操作提示', true).trim();
  return {
    id,
    label,
    // Executable identity, target/version and parameters are server-issued
    // response data, not client-owned thread state. Keep display affordances
    // only; a fresh server response must rebuild an executable action.
    ...(source.href === undefined ? {} : { href: safeLocalHref(source.href, 'assistant_thread_action_invalid')! }),
    ...(prompt ? { prompt } : {}),
    ...(source.disabled === undefined ? {} : { disabled: source.disabled }),
  };
}

function parseTaskCard(value: unknown, key: string): AssistantThreadTaskCard {
  const source = object(value);
  if (!source) return threadInputError('assistant_thread_task_card_invalid', '任务卡片无效。');
  let encoded = '';
  try { encoded = JSON.stringify(source); }
  catch { return threadInputError('assistant_thread_task_card_invalid', '任务卡片无效。'); }
  if (byteLength(encoded) > MAX_CARD_BYTES) {
    return threadInputError('assistant_thread_task_card_too_large', '单张任务卡片内容过多。', 413);
  }
  const taskId = boundedText(source.taskId, 200, 'assistant_thread_task_card_invalid', '任务卡片编号', true).trim();
  if (!SAFE_TASK_ID.test(taskId) || taskId !== key) {
    return threadInputError('assistant_thread_task_card_invalid', '任务卡片编号无效。');
  }
  const title = boundedText(source.title, 240, 'assistant_thread_task_card_invalid', '任务卡片标题', true).trim();
  const conclusion = boundedText(source.conclusion, 2_000, 'assistant_thread_task_card_invalid', '任务卡片结论', true).trim();
  if (!CARD_STATUSES.has(String(source.status)) || !CARD_NOTIFICATION_REASONS.has(String(source.notificationReason))) {
    return threadInputError('assistant_thread_task_card_invalid', '任务卡片状态无效。');
  }
  if (!Array.isArray(source.details) || source.details.length > 3) {
    return threadInputError('assistant_thread_task_card_invalid', '任务卡片最多保留 3 条必要信息。');
  }
  const details = source.details.map(item => boundedText(
    item, 800, 'assistant_thread_task_card_invalid', '任务卡片详情', true,
  ).trim());
  if (source.items !== undefined && (!Array.isArray(source.items) || source.items.length > 20)) {
    return threadInputError('assistant_thread_task_card_invalid', '任务卡片最多保留 20 条业务记录。');
  }
  const items = (Array.isArray(source.items) ? source.items : []).map(item => {
    const value = object(item);
    if (!value) return threadInputError('assistant_thread_task_card_invalid', '任务卡片业务记录无效。');
    const id = boundedText(value.id, 200, 'assistant_thread_task_card_invalid', '业务记录编号', true).trim();
    if (!SAFE_TASK_ID.test(id)) return threadInputError('assistant_thread_task_card_invalid', '业务记录编号无效。');
    const thumbnailUrl = value.thumbnailUrl === undefined
      ? ''
      : boundedText(value.thumbnailUrl, 2_048, 'assistant_thread_task_card_invalid', '业务记录缩略图', true).trim();
    if (thumbnailUrl && !/^https?:\/\//i.test(thumbnailUrl) && !/^\/(?!\/)/.test(thumbnailUrl)) {
      return threadInputError('assistant_thread_task_card_invalid', '业务记录缩略图无效。');
    }
    const optional = (name: 'accountLabel' | 'transition' | 'note') => value[name] === undefined
      ? ''
      : boundedText(value[name], 500, 'assistant_thread_task_card_invalid', '业务记录信息', true).trim();
    const accountLabel = optional('accountLabel');
    const transition = optional('transition');
    const note = optional('note');
    return {
      id,
      title: boundedText(value.title, 500, 'assistant_thread_task_card_invalid', '业务记录标题', true).trim(),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      ...(accountLabel ? { accountLabel } : {}),
      ...(transition ? { transition } : {}),
      ...(note ? { note } : {}),
    };
  });
  if (!Array.isArray(source.secondaryActions) || source.secondaryActions.length > 2) {
    return threadInputError('assistant_thread_task_card_invalid', '任务卡片最多保留 2 个次要操作。');
  }
  const updatedAt = Number(source.updatedAt);
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) {
    return threadInputError('assistant_thread_task_card_invalid', '任务卡片更新时间无效。');
  }
  let workspace: AssistantThreadTaskCard['workspace'];
  if (source.workspace !== undefined) {
    const value = object(source.workspace);
    if (!value) return threadInputError('assistant_thread_task_card_invalid', '任务卡片工作区无效。');
    workspace = {
      label: boundedText(value.label, 120, 'assistant_thread_task_card_invalid', '工作区名称', true).trim(),
      href: safeLocalHref(value.href, 'assistant_thread_task_card_invalid')!,
    };
  }
  return {
    taskId,
    title,
    conclusion,
    details,
    ...(source.items === undefined ? {} : { items }),
    status: String(source.status),
    notificationReason: String(source.notificationReason),
    ...(source.primaryAction === undefined ? {} : { primaryAction: parsePersistedAction(source.primaryAction) }),
    secondaryActions: source.secondaryActions.map(parsePersistedAction),
    ...(workspace ? { workspace } : {}),
    updatedAt,
  };
}

function parseTaskCards(value: unknown): Record<string, AssistantThreadTaskCard> {
  if (value === undefined) return {};
  const source = object(value);
  if (!source) return threadInputError('assistant_thread_task_cards_invalid', '任务卡片数据无效。');
  const entries = Object.entries(source);
  if (entries.length > MAX_TASK_CARDS) {
    return threadInputError('assistant_thread_task_cards_too_many', `任务卡片最多保留 ${MAX_TASK_CARDS} 张。`, 413);
  }
  const cards: Record<string, AssistantThreadTaskCard> = Object.create(null) as Record<string, AssistantThreadTaskCard>;
  for (const [key, card] of entries) {
    if (!SAFE_TASK_ID.test(key) || UNSAFE_RECORD_KEYS.has(key)) {
      return threadInputError('assistant_thread_task_card_invalid', '任务卡片编号无效。');
    }
    cards[key] = parseTaskCard(card, key);
  }
  return cards;
}

function parseMessages(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MESSAGES) {
    return threadInputError('assistant_thread_messages_invalid', `会话最多保留 ${MAX_MESSAGES} 条消息。`, 413);
  }
  return value.map(item => {
    const source = object(item);
    if (!source || !['user', 'assistant'].includes(String(source.role))) {
      return threadInputError('assistant_thread_message_invalid', '会话消息无效。');
    }
    const content = boundedText(source.content, MAX_MESSAGE_BYTES, 'assistant_thread_message_invalid', '会话消息');
    let sources: Array<{ title: string; uri: string }> | undefined;
    if (source.sources !== undefined) {
      if (!Array.isArray(source.sources) || source.sources.length > MAX_MESSAGE_SOURCES) {
        return threadInputError('assistant_thread_message_invalid', '消息来源数量无效。');
      }
      sources = source.sources.map(item => {
        const entry = object(item);
        if (!entry) return threadInputError('assistant_thread_message_invalid', '消息来源无效。');
        return {
          title: boundedText(entry.title, 240, 'assistant_thread_message_invalid', '消息来源名称', true).trim(),
          uri: boundedText(entry.uri, 2_048, 'assistant_thread_message_invalid', '消息来源地址', true).trim(),
        };
      });
    }
    return { role: source.role, content, ...(sources ? { sources } : {}) };
  });
}

function parseThreadPayload(
  value: unknown,
  identity: AuthLocals,
  agentId: string,
  current?: AssistantThread,
): Omit<AssistantThread, 'id'> {
  const source = object(value);
  if (!source) return threadInputError('assistant_thread_invalid', '会话数据无效。');
  let encoded = '';
  try { encoded = JSON.stringify(source); }
  catch { return threadInputError('assistant_thread_invalid', '会话数据无效。'); }
  if (byteLength(encoded) > MAX_THREAD_BYTES) {
    return threadInputError('assistant_thread_too_large', '会话内容过多，请新建会话后继续。', 413);
  }
  const prior = current ? threadWithDefaults(current) : null;
  const messages = source.messages === undefined ? prior?.messages ?? [] : parseMessages(source.messages);
  const draftInput = source.draftInput === undefined
    ? prior?.draftInput ?? ''
    : boundedText(source.draftInput, MAX_DRAFT_BYTES, 'assistant_thread_draft_too_large', '草稿');
  const scrollPosition = source.scrollPosition === undefined ? prior?.scrollPosition ?? 0 : Number(source.scrollPosition);
  const unreadCount = source.unreadCount === undefined ? prior?.unreadCount ?? 0 : Number(source.unreadCount);
  if (!Number.isFinite(scrollPosition) || scrollPosition < 0 || scrollPosition > MAX_SCROLL_POSITION) {
    return threadInputError('assistant_thread_scroll_position_invalid', '会话滚动位置无效。');
  }
  if (!Number.isSafeInteger(unreadCount) || unreadCount < 0 || unreadCount > MAX_UNREAD_COUNT) {
    return threadInputError('assistant_thread_unread_count_invalid', '会话未读数量无效。');
  }
  if (source.isFollowingLatest !== undefined && typeof source.isFollowingLatest !== 'boolean') {
    return threadInputError('assistant_thread_follow_state_invalid', '会话跟随状态无效。');
  }
  if (source.paused !== undefined && typeof source.paused !== 'boolean') {
    return threadInputError('assistant_thread_pause_state_invalid', '会话暂停状态无效。');
  }
  const taskCards = source.taskCards === undefined ? prior?.taskCards ?? {} : parseTaskCards(source.taskCards);
  let focusedTaskId: string | null = source.focusedTaskId === undefined
    ? prior?.focusedTaskId ?? null
    : null;
  if (source.focusedTaskId !== undefined && source.focusedTaskId !== null) {
    focusedTaskId = boundedText(
      source.focusedTaskId, 200, 'assistant_thread_focused_task_invalid', '焦点任务编号', true,
    ).trim();
    if (!SAFE_TASK_ID.test(focusedTaskId) || !taskCards[focusedTaskId]) {
      return threadInputError('assistant_thread_focused_task_invalid', '焦点任务不存在。');
    }
  }
  const payload = {
    tenantId: identity.tenantId,
    userId: identity.userId,
    agentId,
    version: (prior?.version ?? 0) + 1,
    messages,
    draftInput,
    scrollPosition,
    unreadCount,
    isFollowingLatest: source.isFollowingLatest === undefined
      ? prior?.isFollowingLatest ?? true
      : source.isFollowingLatest,
    paused: source.paused === undefined ? prior?.paused ?? false : source.paused,
    taskCards,
    focusedTaskId,
    updatedAt: new Date().toISOString(),
  };
  if (byteLength(JSON.stringify(payload)) > MAX_THREAD_BYTES) {
    return threadInputError('assistant_thread_too_large', '会话内容过多，请新建会话后继续。', 413);
  }
  return payload;
}

function safely<T>(read: () => T, fallback: T): T {
  try { return read(); }
  catch { return fallback; }
}

function threadWithDefaults(thread: AssistantThread): AssistantThread {
  let messages = safely(() => parseMessages(thread.messages), []);
  let draftInput = safely(
    () => boundedText(thread.draftInput, MAX_DRAFT_BYTES, 'assistant_thread_draft_too_large', '草稿'),
    '',
  );
  const scrollPosition = Number.isFinite(thread.scrollPosition)
    && thread.scrollPosition >= 0
    && thread.scrollPosition <= MAX_SCROLL_POSITION
    ? thread.scrollPosition
    : 0;
  const unreadCount = Number.isSafeInteger(thread.unreadCount)
    && thread.unreadCount >= 0
    && thread.unreadCount <= MAX_UNREAD_COUNT
    ? thread.unreadCount
    : 0;
  let taskCards = safely(() => parseTaskCards(thread.taskCards), {});
  let focusedTaskId = typeof thread.focusedTaskId === 'string'
    && SAFE_TASK_ID.test(thread.focusedTaskId)
    && Boolean(taskCards[thread.focusedTaskId])
    ? thread.focusedTaskId
    : null;
  const boundedSnapshotSize = () => byteLength(JSON.stringify({ messages, draftInput, taskCards, focusedTaskId }));
  if (boundedSnapshotSize() > MAX_THREAD_BYTES) messages = [];
  if (boundedSnapshotSize() > MAX_THREAD_BYTES) {
    taskCards = {};
    focusedTaskId = null;
  }
  if (boundedSnapshotSize() > MAX_THREAD_BYTES) draftInput = '';
  return {
    id: typeof thread.id === 'string' ? thread.id : '',
    tenantId: typeof thread.tenantId === 'string' ? thread.tenantId : '',
    userId: typeof thread.userId === 'string' ? thread.userId : '',
    agentId: typeof thread.agentId === 'string' ? thread.agentId : '',
    version: Number.isSafeInteger(thread.version) && thread.version > 0 ? thread.version : 0,
    messages,
    draftInput,
    scrollPosition,
    unreadCount,
    isFollowingLatest: typeof thread.isFollowingLatest === 'boolean' ? thread.isFollowingLatest : true,
    paused: typeof thread.paused === 'boolean' ? thread.paused : false,
    taskCards,
    focusedTaskId,
    updatedAt: typeof thread.updatedAt === 'string' ? thread.updatedAt : '',
  };
}

export function createAssistantThreadsRouter(
  dependencies: AssistantThreadsRouterDependencies = {},
): Router {
  const router = Router();
  const dataStore = dependencies.dataStore ?? store;
  const actionService = dependencies.actionService ?? createAssistantActionService({
    commandBus: createStarter198AssistantCommandBus(),
    supportsExecution: supportsDefaultAssistantExecution,
  });
  const writeTails = new Map<string, Promise<void>>();
  const withWriteLock = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const previous = writeTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>(resolve => { release = resolve; });
    const queued = previous.then(() => tail);
    writeTails.set(key, queued);
    await previous;
    try { return await work(); }
    finally {
      release();
      if (writeTails.get(key) === queued) writeTails.delete(key);
    }
  };
  router.use(dependencies.authMiddleware ?? requireAuth);

  router.get('/', async (_req: Request, res: Response) => {
    const identity = res.locals as AuthLocals;
    const result = await dataStore.list<AssistantThread>('assistant_threads', {
      where: { tenantId: identity.tenantId, userId: identity.userId },
      perPage: 20,
    });
    res.json({ items: result.items.map(threadWithDefaults) });
  });

  router.get('/:agentId', async (req: Request, res: Response) => {
    const identity = res.locals as AuthLocals;
    let agentId: string;
    try { agentId = safeAgentId(req.params.agentId); }
    catch (error) {
      const failure = error as AssistantActionError;
      res.status(failure.status).json({ error: failure.code, message: failure.publicMessage });
      return;
    }
    const result = await dataStore.list<AssistantThread>('assistant_threads', {
      where: { tenantId: identity.tenantId, userId: identity.userId, agentId },
      perPage: 1,
    });
    res.json(result.items[0] ? threadWithDefaults(result.items[0]) : {
      id: '',
      tenantId: identity.tenantId,
      userId: identity.userId,
      agentId,
      version: 0,
      messages: [],
      draftInput: '',
      scrollPosition: 0,
      unreadCount: 0,
      isFollowingLatest: true,
      paused: false,
      taskCards: {},
      focusedTaskId: null,
    });
  });

  router.put('/:agentId', async (req: Request, res: Response) => {
    const identity = res.locals as AuthLocals;
    let agentId: string;
    try { agentId = safeAgentId(req.params.agentId); }
    catch (error) {
      const failure = error as AssistantActionError;
      res.status(failure.status).json({ error: failure.code, message: failure.publicMessage });
      return;
    }
    let expectedVersion: number;
    try {
      expectedVersion = expectedThreadVersion(req.body);
    }
    catch (error) {
      const failure = error instanceof AssistantActionError
        ? error
        : new AssistantActionError('assistant_thread_invalid', 400, '会话数据无效。');
      res.status(failure.status).json({ error: failure.code, message: failure.publicMessage });
      return;
    }
    const owner = { tenantId: identity.tenantId, userId: identity.userId, agentId };
    const lockKey = `${identity.tenantId}\0${identity.userId}\0${agentId}`;
    await withWriteLock(lockKey, async () => {
      let current: AssistantThread | undefined;
      let payload: Omit<AssistantThread, 'id'>;
      try {
        const existing = await dataStore.list<AssistantThread>('assistant_threads', {
          where: owner,
          perPage: 1,
        });
        current = existing.items[0];
        const actualVersion = current ? threadWithDefaults(current).version : 0;
        if (expectedVersion !== actualVersion) {
          res.status(409).json({
            error: 'assistant_thread_version_conflict',
            message: '会话已在其他位置更新，请合并后重试。',
            current: current ? threadWithDefaults(current) : { ...owner, id: '', version: 0 },
          });
          return;
        }
        payload = parseThreadPayload(req.body, identity, agentId, current);
      }
      catch (error) {
        const failure = error instanceof AssistantActionError
          ? error
          : new AssistantActionError('assistant_thread_storage_unavailable', 503, '会话暂时无法保存。');
        res.status(failure.status).json({ error: failure.code, message: failure.publicMessage });
        return;
      }
      if (current?.id) {
        let updated = false;
        try {
          updated = dataStore.compareAndSwap
            ? await dataStore.compareAndSwap('assistant_threads', current.id, {
              ...owner,
              version: expectedVersion,
            }, payload)
            : false;
        } catch { updated = false; }
        if (!updated) {
          try {
            const latest = await dataStore.list<AssistantThread>('assistant_threads', { where: owner, perPage: 1 });
            const latestThread = latest.items[0];
            if (latestThread && threadWithDefaults(latestThread).version !== expectedVersion) {
              res.status(409).json({
                error: 'assistant_thread_version_conflict',
                message: '会话已在其他位置更新，请合并后重试。',
                current: threadWithDefaults(latestThread),
              });
              return;
            }
          } catch {
            // Preserve the original storage failure below.
          }
          res.status(503).json({ error: 'assistant_thread_storage_unavailable', message: '会话暂时无法保存。' });
          return;
        }
        res.json({ ...current, ...payload });
        return;
      }
      let created: AssistantThread | null = null;
      try { created = await dataStore.create<AssistantThread>('assistant_threads', payload); }
      catch { created = null; }
      if (!created) {
        try {
          const latest = await dataStore.list<AssistantThread>('assistant_threads', { where: owner, perPage: 1 });
          if (latest.items[0]) {
            res.status(409).json({
              error: 'assistant_thread_version_conflict',
              message: '会话已在其他位置创建，请合并后重试。',
              current: threadWithDefaults(latest.items[0]),
            });
            return;
          }
        } catch {
          // Preserve the original storage failure below.
        }
        res.status(503).json({ error: 'assistant_thread_storage_unavailable', message: '会话暂时无法保存。' });
        return;
      }
      res.json(threadWithDefaults(created));
    });
  });

  router.post('/:agentId/actions', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const identity = res.locals as AuthLocals;
    try {
      safeAgentId(req.params.agentId);
      const result = await actionService.route(req.body, {
        tenantId: identity.tenantId,
        userId: identity.userId,
        authorization: req.headers.authorization,
      });
      res.status(actionHttpStatus(result.status)).json(result);
    } catch (error) {
      const failure = error instanceof AssistantActionError
        ? error
        : new AssistantActionError('assistant_action_unavailable', 503, '助手操作服务暂时不可用。');
      res.status(failure.status).json({
        error: failure.code,
        message: failure.publicMessage,
        notification: { reason: 'failure', message: failure.publicMessage },
      });
    }
  });

  return router;
}

export const assistantThreadsRouter = createAssistantThreadsRouter();
