import { AssistantActionError } from '../assistant/actionRouting.js';

export type PendingContentTaskBinding = {
  intentFingerprint: string;
  idempotencyKey: string;
  contentTaskId: string;
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
  const contentTaskId = text(source.contentTaskId, 240);
  const createdAt = text(source.createdAt, 64);
  if (!/^assistant-content-intent:[0-9a-f]{8}$/u.test(intentFingerprint)
    || !/^assistant-content:[0-9]+:[0-9a-f]{8}$/u.test(idempotencyKey)
    || !/^[a-z0-9:_-]{1,200}$/iu.test(contentTaskId)
    || !Number.isFinite(Date.parse(createdAt))) return invalid();
  return { intentFingerprint, idempotencyKey, contentTaskId, createdAt };
}
