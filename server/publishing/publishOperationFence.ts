import { randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import { compareAndSetRecord } from '../digitalEmployees/reliableKernel.js';
import type { PostRecord } from './waLink.js';

export type PublishOperationState = 'active' | 'quiescing' | 'quiesced';

export function newPublishOperationId(): string {
  return randomUUID();
}

export function publishOperationCooldownMs(): number {
  const configured = Number(process.env.PUBLISH_OPERATION_SAFE_COOLDOWN_MS ?? 60_000);
  return Number.isFinite(configured) ? Math.max(5_000, Math.min(24 * 60 * 60_000, configured)) : 60_000;
}

export function publishOperationStartPatch(operationId: string): Record<string, unknown> {
  return {
    publish_operation_id: operationId,
    publish_operation_state: 'active',
    publish_operation_quiesced_at: '',
    publish_retry_not_before: '',
  };
}

export function publishOperationQuiescingPatch(operationId: string): Record<string, unknown> {
  return {
    publish_operation_id: operationId,
    publish_operation_state: 'quiescing',
    publish_operation_quiesced_at: '',
    publish_retry_not_before: '',
  };
}

export function publishOperationQuiescedPatch(
  operationId: string,
  options: { now?: number; requireCooldown?: boolean } = {},
): Record<string, unknown> {
  const now = options.now ?? Date.now();
  return {
    publish_operation_id: operationId,
    publish_operation_state: 'quiesced',
    publish_operation_quiesced_at: new Date(now).toISOString(),
    publish_retry_not_before: options.requireCooldown
      ? new Date(now + publishOperationCooldownMs()).toISOString()
      : '',
  };
}

export function reconciliationOperationBlock(
  post: PostRecord,
  now = Date.now(),
): 'publish_operation_not_quiesced' | 'publish_operation_cooldown_active' | null {
  const state = String(post.publish_operation_state || '');
  if (state === 'active') return 'publish_operation_not_quiesced';
  if (state === 'quiescing') {
    let stats: Record<string, unknown> = {};
    if (post.stats && typeof post.stats === 'object' && !Array.isArray(post.stats)) {
      stats = post.stats as Record<string, unknown>;
    } else if (typeof post.stats === 'string') {
      try {
        const parsed = JSON.parse(post.stats) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stats = parsed as Record<string, unknown>;
      } catch { /* malformed durable stats remain fail-closed below */ }
    }
    const reconciliationStartedAt = Date.parse(String(stats.reconciliationStartedAt || ''));
    const leaseExpiresAt = Date.parse(String(post.publish_lease_expires_at || ''));
    const accountTimeoutMs = Math.max(30_000, Number(process.env.PUBLISH_ACCOUNT_TIMEOUT_MS || 10 * 60_000) || 10 * 60_000);
    const configured = Number(process.env.PUBLISH_ORPHANED_OPERATION_SETTLE_MS || Math.max(30 * 60_000, accountTimeoutMs + publishOperationCooldownMs()));
    const settleMs = Number.isFinite(configured)
      ? Math.max(5 * 60_000, Math.min(24 * 60 * 60_000, configured))
      : 30 * 60_000;
    const deadlines = [
      ...(Number.isFinite(reconciliationStartedAt) ? [reconciliationStartedAt + settleMs] : []),
      ...(Number.isFinite(leaseExpiresAt) ? [leaseExpiresAt] : []),
    ];
    // Missing durable timing evidence remains fail-closed. Once a crashed
    // transport has exceeded every conservative deadline, a human-confirmed
    // not-published decision may close the orphan and start a fresh operation.
    if (!deadlines.length || Math.max(...deadlines) > now) return 'publish_operation_not_quiesced';
  }
  const retryNotBefore = Date.parse(String(post.publish_retry_not_before || ''));
  if (Number.isFinite(retryNotBefore) && retryNotBefore > now) return 'publish_operation_cooldown_active';
  return null;
}

/**
 * Persist an operation-state transition without allowing a late timeout
 * callback to move a settled operation back to `quiescing`.
 *
 * Operation state intentionally has its own CAS dimension. Bumping the post's
 * publish revision here would make a transport-settlement callback race the
 * result persistence that owns that revision.
 */
export async function persistPublishOperationTransition(input: {
  store: DataStore;
  postId: string;
  operationId: string;
  patch: Record<string, unknown>;
  maxAttempts?: number;
}): Promise<void> {
  const target = String(input.patch.publish_operation_state || '') as PublishOperationState;
  if (!['quiescing', 'quiesced'].includes(target)) {
    throw new Error('publish_operation_transition_target_invalid');
  }
  for (let attempt = 0; attempt < (input.maxAttempts ?? 4); attempt += 1) {
    const current = await input.store.getById<PostRecord>('posts', input.postId);
    if (!current || String(current.publish_operation_id || '') !== input.operationId) return;
    const state = String(current.publish_operation_state || '') as PublishOperationState | '';
    if (state === 'quiesced') return;
    if (target === 'quiescing' && state !== 'active') return;
    if (target === 'quiesced' && !['active', 'quiescing'].includes(state)) return;
    const changed = await compareAndSetRecord<PostRecord>({
      store: input.store,
      collection: 'posts',
      id: input.postId,
      expected: {
        publish_operation_id: input.operationId,
        publish_operation_state: state,
      },
      patch: input.patch,
    });
    if (changed.ok) return;
  }
  const current = await input.store.getById<PostRecord>('posts', input.postId);
  if (!current || String(current.publish_operation_id || '') !== input.operationId
    || String(current.publish_operation_state || '') === 'quiesced') return;
  throw new Error('publish_operation_state_transition_conflict');
}

export type AbortablePublishOperationOptions = {
  timeoutMs: number;
  onTimeout?: () => void | Promise<void>;
  onSettled?: (settledAfterTimeout: boolean) => void | Promise<void>;
};

/**
 * Return promptly on deadline, but retain an explicit settlement callback for
 * the underlying transport. A provider may ignore AbortSignal after accepting
 * bytes; callers keep the durable fence closed until onSettled runs.
 */
export async function runAbortablePublishOperation<T>(
  work: (signal: AbortSignal) => Promise<T>,
  options: AbortablePublishOperationOptions,
): Promise<T> {
  const requestedTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.max(1, Math.floor(requestedTimeout))
    : 10 * 60_000;
  const controller = new AbortController();
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;
  const transport = Promise.resolve().then(() => work(controller.signal));
  const operation = transport.then(
    async value => {
      await options.onSettled?.(timedOut);
      return value;
    },
    async error => {
      await options.onSettled?.(timedOut);
      throw error;
    },
  );
  const settlement = operation.then(() => undefined, () => undefined);
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(Object.assign(new Error('platform_publish_transport_timeout'), { code: 'ETIMEDOUT' }));
      void Promise.resolve(options.onTimeout?.()).catch(() => undefined).then(() => {
        reject(Object.assign(new Error(`平台发布在 ${timeoutMs}ms 内未返回确定结果`), {
          code: 'ETIMEDOUT',
          statusCode: 504,
          publishOperationTimedOut: true,
          publishOperationSettlement: settlement,
        }));
      });
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
