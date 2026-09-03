export const DIGITAL_HUMAN_RESULT_SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type DigitalHumanResultOutboxPhase = 'upload_pending' | 'finalize_pending' | 'acked' | 'dead_letter';

export interface DigitalHumanResultOutboxRecord {
  id: string;
  remoteJobId: string;
  localJobId: string;
  workerId: string;
  leaseId: string;
  deliveryKind?: 'completed_result' | 'terminal_notification';
  outputPath?: string;
  sha256?: string;
  sizeBytes?: number;
  terminalStatus?: 'failed' | 'cancelled';
  errorCode?: string;
  error?: string;
  quality?: Record<string, unknown>;
  phase: DigitalHumanResultOutboxPhase;
  attempts: number;
  nextAttemptAt: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt?: string;
  deadLetterResumePhase?: 'upload_pending' | 'finalize_pending';
  deadLetterRecoveries?: number;
}

export function digitalHumanDeliveryKind(record: DigitalHumanResultOutboxRecord): 'completed_result' | 'terminal_notification' {
  return record.deliveryKind || 'completed_result';
}

export function normalizeDigitalHumanResultSha256(value: unknown): string | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  return DIGITAL_HUMAN_RESULT_SHA256_PATTERN.test(normalized) ? normalized : undefined;
}

export function digitalHumanResultRetryDelayMs(
  attempt: number,
  baseMs = 2_000,
  maxMs = 5 * 60_000,
): number {
  const safeAttempt = Math.max(1, Math.min(30, Math.floor(Number(attempt) || 1)));
  const safeBase = Math.max(250, Math.floor(Number(baseMs) || 2_000));
  const safeMax = Math.max(safeBase, Math.floor(Number(maxMs) || 5 * 60_000));
  return Math.min(safeMax, safeBase * (2 ** (safeAttempt - 1)));
}

export function markDigitalHumanResultUploaded(
  record: DigitalHumanResultOutboxRecord,
  nowMs = Date.now(),
): DigitalHumanResultOutboxRecord {
  const now = new Date(nowMs).toISOString();
  return {
    ...record,
    phase: 'finalize_pending',
    attempts: 0,
    nextAttemptAt: now,
    lastError: undefined,
    updatedAt: now,
  };
}

export function acknowledgeDigitalHumanResult(
  record: DigitalHumanResultOutboxRecord,
  nowMs = Date.now(),
): DigitalHumanResultOutboxRecord {
  const now = new Date(nowMs).toISOString();
  return {
    ...record,
    phase: 'acked',
    attempts: 0,
    nextAttemptAt: now,
    lastError: undefined,
    updatedAt: now,
    acknowledgedAt: now,
  };
}

export function retryDigitalHumanResult(
  record: DigitalHumanResultOutboxRecord,
  error: unknown,
  nowMs = Date.now(),
  baseMs = 2_000,
  maxMs = 5 * 60_000,
  maxAttempts = 8,
): DigitalHumanResultOutboxRecord {
  const attempts = record.attempts + 1;
  const now = new Date(nowMs).toISOString();
  if (attempts >= Math.max(1, maxAttempts)) return {
    ...record,
    phase: 'dead_letter',
    deadLetterResumePhase: record.phase === 'upload_pending' ? 'upload_pending' : 'finalize_pending',
    attempts,
    nextAttemptAt: now,
    lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
    updatedAt: now,
  };
  return {
    ...record,
    attempts,
    nextAttemptAt: new Date(nowMs + digitalHumanResultRetryDelayMs(attempts, baseMs, maxMs)).toISOString(),
    lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
    updatedAt: now,
  };
}

export function reviveDigitalHumanDeadLetter(
  record: DigitalHumanResultOutboxRecord,
  nowMs = Date.now(),
  maxRecoveries = 2,
): DigitalHumanResultOutboxRecord {
  if (record.phase !== 'dead_letter' || (record.deadLetterRecoveries || 0) >= Math.max(0, maxRecoveries)) return record;
  const now = new Date(nowMs).toISOString();
  return {
    ...record,
    phase: record.deadLetterResumePhase || (digitalHumanDeliveryKind(record) === 'terminal_notification' ? 'finalize_pending' : 'upload_pending'),
    attempts: 0,
    deadLetterRecoveries: (record.deadLetterRecoveries || 0) + 1,
    nextAttemptAt: now,
    updatedAt: now,
  };
}

export function dueDigitalHumanResultOutbox(
  records: DigitalHumanResultOutboxRecord[],
  nowMs = Date.now(),
): DigitalHumanResultOutboxRecord[] {
  return records
    .filter(record => (
      record.phase === 'upload_pending' || record.phase === 'finalize_pending'
    ) && Date.parse(record.nextAttemptAt) <= nowMs)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
