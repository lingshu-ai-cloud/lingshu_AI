import { createHash } from 'node:crypto';
import { store, type DataStore } from '../storage/index.js';

export const OAUTH_TRANSACTION_COLLECTION = 'oauth_transactions';

export type OAuthTransactionRecord = {
  id: string;
  state_hash: string;
  tenant_id: string;
  user_id: string;
  platform: string;
  return_to: string;
  status: 'pending' | 'consumed' | 'expired';
  expires_at: string;
  consumed_at?: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

export type OAuthTransactionIdentity = {
  tenantId: string;
  userId: string;
  platform: string;
  returnTo: string;
  expiresAt: number;
};

export type OAuthTransactionConsumeResult =
  | { ok: true; transaction: OAuthTransactionRecord; identity: OAuthTransactionIdentity }
  | { ok: false; reason: 'not_found' | 'expired' | 'already_consumed' | 'identity_mismatch' | 'conflict' };

function stateHash(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}

function transactionIdentity(record: OAuthTransactionRecord): OAuthTransactionIdentity {
  return {
    tenantId: record.tenant_id,
    userId: record.user_id,
    platform: record.platform,
    returnTo: record.return_to || '/',
    expiresAt: Date.parse(record.expires_at),
  };
}

/**
 * Persist an OAuth transaction before returning the provider URL. Only the
 * SHA-256 digest of the signed state is stored so a database reader cannot
 * replay a transaction without also possessing the browser state value.
 */
export async function createOAuthTransaction(
  input: { state: string } & OAuthTransactionIdentity,
  dataStore: DataStore = store,
): Promise<OAuthTransactionRecord> {
  const now = new Date().toISOString();
  const digest = stateHash(input.state);
  const created = await dataStore.createIfAbsent<OAuthTransactionRecord>(OAUTH_TRANSACTION_COLLECTION, {
    state_hash: digest,
  }, {
    tenant_id: input.tenantId,
    user_id: input.userId,
    platform: input.platform,
    return_to: input.returnTo || '/',
    status: 'pending',
    expires_at: new Date(input.expiresAt).toISOString(),
    consumed_at: '',
    revision: 0,
    created_at: now,
    updated_at: now,
  });
  if (!created.created) throw new Error('oauth_transaction_state_collision');
  return created.record;
}

/**
 * One-way CAS consume. A provider callback gets exactly one chance, including
 * callbacks where the user denied access or the provider omitted a code.
 */
export async function consumeOAuthTransaction(
  input: { state: string; expected: OAuthTransactionIdentity },
  dataStore: DataStore = store,
  nowMs = Date.now(),
): Promise<OAuthTransactionConsumeResult> {
  const result = await dataStore.list<OAuthTransactionRecord>(OAUTH_TRANSACTION_COLLECTION, {
    where: { state_hash: stateHash(input.state) },
    perPage: 1,
  });
  const record = result.items[0];
  if (!record) return { ok: false, reason: 'not_found' };

  const identity = transactionIdentity(record);
  if (
    identity.tenantId !== input.expected.tenantId
    || identity.userId !== input.expected.userId
    || identity.platform !== input.expected.platform
    || identity.returnTo !== input.expected.returnTo
    || identity.expiresAt !== input.expected.expiresAt
  ) return { ok: false, reason: 'identity_mismatch' };

  if (record.status !== 'pending') {
    return { ok: false, reason: record.status === 'expired' ? 'expired' : 'already_consumed' };
  }
  const revision = Number(record.revision || 0);
  const now = new Date(nowMs).toISOString();
  if (!Number.isFinite(identity.expiresAt) || identity.expiresAt <= nowMs) {
    const expired = await dataStore.compareAndSet<OAuthTransactionRecord>(OAUTH_TRANSACTION_COLLECTION, record.id, {
      status: 'pending',
      revision,
    }, {
      status: 'expired',
      revision: revision + 1,
      updated_at: now,
    });
    return { ok: false, reason: expired.ok ? 'expired' : 'conflict' };
  }

  const consumed = await dataStore.compareAndSet<OAuthTransactionRecord>(OAUTH_TRANSACTION_COLLECTION, record.id, {
    status: 'pending',
    revision,
  }, {
    status: 'consumed',
    consumed_at: now,
    updated_at: now,
    revision: revision + 1,
  });
  if (!consumed.ok) return { ok: false, reason: 'conflict' };
  return { ok: true, transaction: consumed.record, identity };
}

const OAUTH_CALLBACK_ROLES = new Set(['super_admin', 'admin', 'social_operator']);

/** Re-check the current user record at callback time; signed state is not RBAC. */
export async function revalidateOAuthActor(
  input: { userId: string; tenantId: string },
  dataStore: DataStore = store,
): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production' && input.userId.startsWith('local_')) return true;
  const user = await dataStore.getById<Record<string, unknown> & { id: string }>('users', input.userId);
  if (!user) return false;
  const tenantId = String(user.tenantId || user.tenant_id || '');
  const role = String(user.role || '');
  return tenantId === input.tenantId && OAUTH_CALLBACK_ROLES.has(role);
}

export const oauthTransactionStateHashForTest = stateHash;
