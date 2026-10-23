import { AssistantActionError } from '../assistant/actionRouting.js';
import type { DataStore } from '../storage/datastore.js';
import { STARTER_COLLECTIONS, type StarterRecord } from '../starter198/repository.js';

export type PendingContentTaskBinding = {
  intentFingerprint: string;
  idempotencyKey: string;
  contentTaskId: string | null;
  createdAt: string;
};

const invalid = (): never => {
  throw new AssistantActionError(
    'assistant_thread_pending_binding_invalid',
    400,
    '待恢复任务信息无效。',
  );
};

function text(value: unknown, limit: number): string {
  if (typeof value !== 'string') return invalid();
  const normalized = value.trim();
  return normalized && Buffer.byteLength(normalized, 'utf8') <= limit ? normalized : invalid();
}

export function parsePendingContentTaskBinding(value: unknown): PendingContentTaskBinding | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const source = value as Record<string, unknown>;
  const intentFingerprint = text(source.intentFingerprint, 80);
  const idempotencyKey = text(source.idempotencyKey, 160);
  const contentTaskId = source.contentTaskId === null ? null : text(source.contentTaskId, 240);
  const createdAt = text(source.createdAt, 64);
  if (!/^assistant-content-intent:[0-9a-f]{8}$/u.test(intentFingerprint)
    || !/^assistant-content:[0-9]+:[0-9a-f]{8}$/u.test(idempotencyKey)
    || (contentTaskId !== null && !/^[a-z0-9:_-]{1,200}$/iu.test(contentTaskId))
    || !Number.isFinite(Date.parse(createdAt))) return invalid();
  return { intentFingerprint, idempotencyKey, contentTaskId, createdAt };
}

export async function findAssistantContentTaskId(
  store: DataStore,
  identity: { tenantId: string; userId: string },
  idempotencyKey: string,
): Promise<string | null> {
  const result = await store.list<StarterRecord>(STARTER_COLLECTIONS.socialContentTasks, {
    where: { tenant_id: identity.tenantId, created_by: identity.userId, create_idempotency_key: idempotencyKey },
    page: 1,
    perPage: 2,
  });
  const rows = result.items.filter(row => row.tenant_id === identity.tenantId
    && row.created_by === identity.userId && row.create_idempotency_key === idempotencyKey);
  const taskId = rows.length === 1 && result.totalItems === 1 ? String(rows[0]?.task_id || '').trim() : '';
  return /^[a-z0-9:_-]{1,200}$/iu.test(taskId) ? taskId : null;
}
