import type { PostRecord } from './waLink.js';

export type PublishQueueState = 'pending' | 'direct' | 'blocked' | 'terminal';

export type PublishQueueProjection = {
  publish_queue_state: PublishQueueState;
  publish_available_at: string;
};

const PUBLISH_STALE_AFTER_MS = 15 * 60_000;

function object(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch { return {}; }
  }
  return {};
}

function iso(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const parsed = Date.parse(raw);
  return raw && Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function maxIso(values: string[]): string {
  const timestamps = values.filter(Boolean).map(value => Date.parse(value)).filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : '';
}

function plusMs(value: string, milliseconds: number): string {
  return value ? new Date(Date.parse(value) + milliseconds).toISOString() : '';
}

/**
 * Derive the indexed queue projection from the durable post state. The nested
 * stats payload remains authoritative; this projection only narrows candidate
 * reads and can never by itself authorize a provider call.
 */
export function publishQueueProjection(post: Partial<PostRecord>): PublishQueueProjection {
  const stats = object(post.stats);
  const status = String(stats.status || '').trim();
  const direct = stats.directPublish === true;
  const scheduledAt = iso(post.published_at);
  const retryAt = iso(stats.nextPublishAttemptAt);
  const leaseExpiresAt = iso(post.publish_lease_expires_at);
  const lastAttemptAt = iso(stats.lastPublishAttemptAt);
  const source = String(stats.source || '').trim();
  const schedulePayloadHash = String(stats.schedulePayloadHash || '').trim();

  if (post.reconciliation_required === true || ['needs_reconciliation', 'on_hold', 'reserving'].includes(status)) {
    return { publish_queue_state: 'blocked', publish_available_at: '' };
  }
  if (String(post.platform_post_id || '').trim()
    || ['published', 'cancelled', 'voided', 'partial'].includes(status)) {
    return { publish_queue_state: 'terminal', publish_available_at: '' };
  }
  if (direct) {
    if (status === 'failed') return { publish_queue_state: 'terminal', publish_available_at: '' };
    if (status !== 'publishing') return { publish_queue_state: 'blocked', publish_available_at: '' };
    const availableAt = maxIso([
      leaseExpiresAt,
      plusMs(lastAttemptAt, PUBLISH_STALE_AFTER_MS),
    ]);
    return availableAt
      ? { publish_queue_state: 'direct', publish_available_at: availableAt }
      : { publish_queue_state: 'blocked', publish_available_at: '' };
  }

  const validScheduledAdmission = ['manual', 'digital_employee'].includes(source)
    && /^[a-f0-9]{64}$/.test(schedulePayloadHash)
    && Boolean(scheduledAt);
  if (!validScheduledAdmission) return { publish_queue_state: 'blocked', publish_available_at: '' };

  if (status === 'scheduled') {
    return {
      publish_queue_state: 'pending',
      publish_available_at: maxIso([
        scheduledAt,
        post.publish_lease_owner ? leaseExpiresAt : '',
      ]),
    };
  }
  if (status === 'failed') {
    const attempts = Number(stats.publishAttempts || 0);
    if (Number.isInteger(attempts) && attempts >= 0 && attempts < 3 && retryAt) {
      return { publish_queue_state: 'pending', publish_available_at: maxIso([scheduledAt, retryAt]) };
    }
    return { publish_queue_state: 'terminal', publish_available_at: '' };
  }
  if (status === 'publishing') {
    if (!lastAttemptAt) return { publish_queue_state: 'blocked', publish_available_at: '' };
    return {
      publish_queue_state: 'pending',
      publish_available_at: maxIso([
        scheduledAt,
        plusMs(lastAttemptAt, PUBLISH_STALE_AFTER_MS),
        leaseExpiresAt,
      ]),
    };
  }
  return { publish_queue_state: 'blocked', publish_available_at: '' };
}

/** Atomically dual-write a status mutation and its indexed projection. */
export function withPublishQueueProjection(
  current: Partial<PostRecord>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const projected = {
    ...current,
    ...patch,
    stats: Object.prototype.hasOwnProperty.call(patch, 'stats') ? patch.stats : current.stats,
  } as Partial<PostRecord>;
  return { ...patch, ...publishQueueProjection(projected) };
}
