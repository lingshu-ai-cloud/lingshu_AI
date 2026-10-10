import type { Message } from '../appSession';
import type {
  AgentThreadState,
  AssistantCardAction,
  AssistantTaskCard,
  OrbitAgentId,
} from '../stores/assistantStore';

export type AssistantJournalScope = { tenantId: string; userId: string };

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type AssistantThreadJournal = {
  schema: 1;
  tenantId: string;
  userId: string;
  agentId: OrbitAgentId;
  savedAt: string;
  snapshot: AgentThreadState;
};

const JOURNAL_PREFIX = 'lingshu:assistant-thread-journal:v1';
const JOURNAL_MAX_MESSAGES = 80;
const JOURNAL_MAX_TASK_CARDS = 30;
const JOURNAL_MAX_BYTES = 96 * 1024;
const MESSAGE_MAX_CHARS = 12_000;

function isSecretKey(value: string): boolean {
  const normalized = value.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (!normalized) return false;
  return normalized === 'authorization'
    || normalized === 'password'
    || normalized === 'passwd'
    || normalized === 'credential'
    || normalized === 'credentials'
    || normalized === 'secret'
    || normalized === 'apikey'
    || normalized === 'privatekey'
    || normalized === 'sig'
    || normalized === 'policy'
    || normalized === 'keypairid'
    || normalized === 'awsaccesskeyid'
    || normalized === 'accesskeyid'
    || normalized === 'ossaccesskeyid'
    || normalized.startsWith('xamz')
    || normalized.startsWith('xgoog')
    || normalized.endsWith('token')
    || normalized.endsWith('signature')
    || normalized.endsWith('secret')
    || normalized.endsWith('password')
    || normalized.endsWith('credential')
    || normalized.endsWith('apikey')
    || normalized.endsWith('privatekey');
}

function cleanId(value: string): string {
  return value.trim().slice(0, 256);
}

function scrubSensitiveUri(raw: string): string | undefined {
  try {
    const parsed = new URL(raw, 'https://local.invalid');
    parsed.username = '';
    parsed.password = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSecretKey(key)) parsed.searchParams.delete(key);
    }
    if (parsed.origin === 'https://local.invalid') return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function redactSensitiveText(value: string, maxLength: number): string {
  return value
    .slice(0, maxLength)
    .replace(/(?:https?:\/\/|\/(?:api|files|media|uploads)\/)[^\s<>"'，。；！）】]+/gi, raw => scrubSensitiveUri(raw) ?? raw)
    .replace(/\bBearer\s+[^\s]+/gi, '[已移除凭据]')
    .replace(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{10,}\b/g, '[已移除凭据]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[已移除凭据]')
    .replace(/\b((?:(?:access|refresh|session|auth|bearer|id)[_-]?token|password|passwd|(?:client|api|private)[_-]?(?:secret|key)|secret|authorization|credential)\s*[:=]\s*)[^\s,;]+/gi, '$1[已移除凭据]');
}

function safeUri(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || /^(?:data|blob):/i.test(raw)) return undefined;
  return scrubSensitiveUri(raw) ?? redactSensitiveText(raw, 2_000);
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (/^(?:https?:\/\/|\/(?:api|files|media|uploads)\/|\/?\?)/i.test(value.trim())) return safeUri(value);
    return redactSensitiveText(value, 4_000);
  }
  if (Array.isArray(value)) return value.slice(0, 30).map(item => sanitizeValue(item, depth + 1)).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source).slice(0, 50)) {
    if (isSecretKey(key) || child instanceof ArrayBuffer || ArrayBuffer.isView(child)) continue;
    const sanitized = sanitizeValue(child, depth + 1);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  return result;
}

function sanitizeMessage(value: Message): Message {
  return {
    role: value.role === 'assistant' ? 'assistant' : 'user',
    content: redactSensitiveText(String(value.content || ''), MESSAGE_MAX_CHARS),
    ...(Array.isArray(value.sources) ? {
      sources: value.sources.slice(0, 10).flatMap(source => {
        const uri = safeUri(source?.uri);
        return uri ? [{ title: redactSensitiveText(String(source?.title || ''), 500), uri }] : [];
      }),
    } : {}),
  };
}

function sanitizeAction(value: AssistantCardAction | undefined): AssistantCardAction | undefined {
  if (!value?.id?.trim() || !value.label?.trim()) return undefined;
  const target = value.target && typeof value.target === 'object'
    ? {
      objectType: value.target.objectType,
      ...(value.target.objectId ? { objectId: cleanId(value.target.objectId) } : {}),
      ...(value.target.expectedVersion ? { expectedVersion: redactSensitiveText(value.target.expectedVersion, 500) } : {}),
    }
    : undefined;
  const parameters = sanitizeValue(value.parameters);
  return {
    id: cleanId(value.id),
    label: redactSensitiveText(value.label, 500),
    ...(value.actionId ? { actionId: value.actionId } : {}),
    ...(value.href ? { href: safeUri(value.href) } : {}),
    ...(target ? { target } : {}),
    ...(parameters && typeof parameters === 'object' && !Array.isArray(parameters)
      ? { parameters: parameters as Record<string, unknown> }
      : {}),
    ...(value.prompt ? { prompt: redactSensitiveText(value.prompt, 4_000) } : {}),
    ...(value.disabled ? { disabled: true } : {}),
  };
}

function sanitizeCard(value: AssistantTaskCard): AssistantTaskCard | null {
  if (!value?.taskId?.trim() || !value.title?.trim()) return null;
  const primaryAction = sanitizeAction(value.primaryAction);
  const workspaceHref = safeUri(value.workspace?.href);
  return {
    taskId: cleanId(value.taskId),
    title: redactSensitiveText(value.title, 1_000),
    conclusion: redactSensitiveText(value.conclusion || '', 4_000),
    details: (value.details || []).slice(0, 3).map(item => redactSensitiveText(String(item), 2_000)),
    items: (value.items || []).slice(0, 20).map(item => ({
      id: cleanId(String(item.id || '')),
      title: redactSensitiveText(String(item.title || ''), 1_000),
      ...(safeUri(item.thumbnailUrl) ? { thumbnailUrl: safeUri(item.thumbnailUrl) } : {}),
      ...(item.accountLabel ? { accountLabel: redactSensitiveText(item.accountLabel, 500) } : {}),
      ...(item.transition ? { transition: redactSensitiveText(item.transition, 500) } : {}),
      ...(item.note ? { note: redactSensitiveText(item.note, 1_000) } : {}),
    })).filter(item => item.id && item.title),
    status: value.status,
    notificationReason: value.notificationReason,
    ...(primaryAction ? { primaryAction } : {}),
    secondaryActions: (value.secondaryActions || []).slice(0, 2).flatMap(action => {
      const sanitized = sanitizeAction(action);
      return sanitized ? [sanitized] : [];
    }),
    ...(value.workspace && workspaceHref ? {
      workspace: { label: redactSensitiveText(value.workspace.label, 500), href: workspaceHref },
    } : {}),
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
  };
}

export function sanitizeAssistantThreadForJournal(thread: AgentThreadState): AgentThreadState {
  const cards = Object.values(thread.taskCards || {})
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, JOURNAL_MAX_TASK_CARDS)
    .flatMap(card => {
      const sanitized = sanitizeCard(card);
      return sanitized ? [[sanitized.taskId, sanitized] as const] : [];
    });
  const taskCards = Object.fromEntries(cards);
  return {
    version: Number.isSafeInteger(thread.version) && thread.version >= 0 ? thread.version : 0,
    updatedAt: typeof thread.updatedAt === 'string' ? thread.updatedAt.slice(0, 100) : '',
    messages: (thread.messages || []).slice(-JOURNAL_MAX_MESSAGES).map(sanitizeMessage),
    draftInput: redactSensitiveText(String(thread.draftInput || ''), 4_000),
    scrollPosition: Number.isFinite(thread.scrollPosition) ? Math.max(0, thread.scrollPosition) : 0,
    unreadCount: Number.isSafeInteger(thread.unreadCount) ? Math.max(0, thread.unreadCount) : 0,
    isFollowingLatest: Boolean(thread.isFollowingLatest),
    paused: Boolean(thread.paused),
    taskCards,
    focusedTaskId: thread.focusedTaskId && taskCards[thread.focusedTaskId] ? thread.focusedTaskId : null,
  };
}

export function assistantThreadJournalKey(scope: AssistantJournalScope, agentId: OrbitAgentId): string {
  return `${JOURNAL_PREFIX}:${encodeURIComponent(cleanId(scope.tenantId))}:${encodeURIComponent(cleanId(scope.userId))}:${agentId}`;
}

function journalBytes(value: string): number {
  return typeof TextEncoder === 'function' ? new TextEncoder().encode(value).byteLength : value.length * 2;
}

function serializedJournal(scope: AssistantJournalScope, agentId: OrbitAgentId, thread: AgentThreadState): string | null {
  const snapshot = sanitizeAssistantThreadForJournal(thread);
  const entry: AssistantThreadJournal = {
    schema: 1,
    tenantId: cleanId(scope.tenantId),
    userId: cleanId(scope.userId),
    agentId,
    savedAt: new Date().toISOString(),
    snapshot,
  };
  let serialized = JSON.stringify(entry);
  while (journalBytes(serialized) > JOURNAL_MAX_BYTES && snapshot.messages.length > 1) {
    snapshot.messages.shift();
    serialized = JSON.stringify(entry);
  }
  while (journalBytes(serialized) > JOURNAL_MAX_BYTES && Object.keys(snapshot.taskCards).length > 1) {
    const oldest = Object.values(snapshot.taskCards).sort((left, right) => left.updatedAt - right.updatedAt)[0];
    delete snapshot.taskCards[oldest.taskId];
    if (snapshot.focusedTaskId === oldest.taskId) snapshot.focusedTaskId = null;
    serialized = JSON.stringify(entry);
  }
  return journalBytes(serialized) <= JOURNAL_MAX_BYTES ? serialized : null;
}

export function writeAssistantThreadJournal(
  storage: StorageLike,
  scope: AssistantJournalScope,
  agentId: OrbitAgentId,
  thread: AgentThreadState,
): boolean {
  if (!cleanId(scope.tenantId) || !cleanId(scope.userId)) return false;
  const serialized = serializedJournal(scope, agentId, thread);
  if (!serialized) return false;
  try {
    storage.setItem(assistantThreadJournalKey(scope, agentId), serialized);
    return true;
  } catch {
    return false;
  }
}

export function readAssistantThreadJournal(
  storage: StorageLike,
  scope: AssistantJournalScope,
  agentId: OrbitAgentId,
): AgentThreadState | null {
  if (!cleanId(scope.tenantId) || !cleanId(scope.userId)) return null;
  try {
    const parsed = JSON.parse(storage.getItem(assistantThreadJournalKey(scope, agentId)) || 'null') as Partial<AssistantThreadJournal> | null;
    if (
      !parsed
      || parsed.schema !== 1
      || parsed.tenantId !== cleanId(scope.tenantId)
      || parsed.userId !== cleanId(scope.userId)
      || parsed.agentId !== agentId
      || !parsed.snapshot
    ) return null;
    return sanitizeAssistantThreadForJournal(parsed.snapshot as AgentThreadState);
  } catch {
    return null;
  }
}

export function clearAssistantThreadJournal(
  storage: StorageLike,
  scope: AssistantJournalScope,
  agentId: OrbitAgentId,
): void {
  try { storage.removeItem(assistantThreadJournalKey(scope, agentId)); } catch { /* storage is best effort */ }
}

export function sameAssistantThreadJournalContent(left: AgentThreadState, right: AgentThreadState): boolean {
  const normalize = (thread: AgentThreadState) => {
    const snapshot = sanitizeAssistantThreadForJournal(thread);
    return { ...snapshot, version: 0, updatedAt: '' };
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}
