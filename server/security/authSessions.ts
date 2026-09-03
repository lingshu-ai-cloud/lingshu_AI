import { createHash } from 'node:crypto';
import type { DataStore, Identity } from '../storage/datastore.js';

export const AUTH_SESSION_COLLECTION = 'auth_sessions';

type AuthSessionRecord = {
  id: string;
  token_hash: string;
  user_id: string;
  tenant_id: string;
  status: 'active' | 'revoked';
  session_epoch: number;
  expires_at: string;
  revoked_at?: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

function bearerToken(authHeader: string | undefined): string {
  return authHeader?.replace(/^Bearer\s+/i, '').trim() || '';
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function localDevelopmentToken(token: string): boolean {
  return process.env.NODE_ENV !== 'production' && token.startsWith('local-demo.');
}

function jwtExpiry(token: string): string {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8')) as { exp?: unknown };
    const seconds = Number(payload.exp);
    if (Number.isFinite(seconds) && seconds > Date.now() / 1000) return new Date(seconds * 1000).toISOString();
  } catch {
    // PocketBase may change token shape; the server still validates it first.
  }
  return new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
}

async function sessionByToken(token: string, dataStore: DataStore): Promise<AuthSessionRecord | null> {
  const result = await dataStore.list<AuthSessionRecord>(AUTH_SESSION_COLLECTION, {
    where: { token_hash: tokenHash(token) },
    perPage: 1,
  });
  return result.items[0] || null;
}

export async function registerAuthSession(input: {
  token: string;
  userId: string;
  tenantId: string;
  dataStore: DataStore;
}): Promise<void> {
  if (!input.token || localDevelopmentToken(input.token)) return;
  const user = await input.dataStore.getById<Record<string, unknown> & { id: string }>('users', input.userId);
  if (!user || String(user.tenantId || user.tenant_id || '') !== input.tenantId) throw new Error('auth_session_identity_invalid');
  const epoch = Number(user.session_epoch || 0);
  const now = new Date().toISOString();
  const created = await input.dataStore.createIfAbsent<AuthSessionRecord>(AUTH_SESSION_COLLECTION, {
    token_hash: tokenHash(input.token),
  }, {
    user_id: input.userId,
    tenant_id: input.tenantId,
    status: 'active',
    session_epoch: epoch,
    expires_at: jwtExpiry(input.token),
    revoked_at: '',
    revision: 0,
    created_at: now,
    updated_at: now,
  });
  const record = created.record;
  if (
    record.user_id !== input.userId
    || record.tenant_id !== input.tenantId
    || record.status !== 'active'
    || Number(record.session_epoch || 0) !== epoch
  ) throw new Error('auth_session_token_conflict');
}

export async function validateAuthSession(input: {
  authHeader: string | undefined;
  identity: Identity;
  dataStore: DataStore;
}): Promise<boolean> {
  const token = bearerToken(input.authHeader);
  if (!token) return false;
  if (localDevelopmentToken(token)) return true;
  const session = await sessionByToken(token, input.dataStore);
  // Developers may still have a pre-hardening token. Production is fail-closed.
  if (!session) return process.env.NODE_ENV !== 'production';
  if (session.status !== 'active' || session.user_id !== input.identity.userId || session.tenant_id !== input.identity.tenantId) return false;
  const expiresAt = Date.parse(session.expires_at || '');
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const user = await input.dataStore.getById<Record<string, unknown> & { id: string }>('users', input.identity.userId);
  if (!user || String(user.tenantId || user.tenant_id || '') !== input.identity.tenantId) return false;
  return Number(user.session_epoch || 0) === Number(session.session_epoch || 0);
}

export async function revokeAuthSession(input: {
  authHeader: string | undefined;
  identity: Identity;
  dataStore: DataStore;
}): Promise<boolean> {
  const token = bearerToken(input.authHeader);
  if (!token || localDevelopmentToken(token)) return true;
  const session = await sessionByToken(token, input.dataStore);
  if (!session) return false;
  if (session.user_id !== input.identity.userId || session.tenant_id !== input.identity.tenantId) return false;
  if (session.status === 'revoked') return true;
  const revision = Number(session.revision || 0);
  const now = new Date().toISOString();
  const revoked = await input.dataStore.compareAndSet<AuthSessionRecord>(AUTH_SESSION_COLLECTION, session.id, {
    status: 'active',
    revision,
  }, {
    status: 'revoked',
    revoked_at: now,
    updated_at: now,
    revision: revision + 1,
  });
  return revoked.ok || revoked.current?.status === 'revoked';
}

export async function revokeAllAuthSessions(input: {
  identity: Identity;
  dataStore: DataStore;
}): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const user = await input.dataStore.getById<Record<string, unknown> & { id: string }>('users', input.identity.userId);
    if (!user || String(user.tenantId || user.tenant_id || '') !== input.identity.tenantId) throw new Error('auth_session_identity_invalid');
    const epoch = Number(user.session_epoch || 0);
    const updated = await input.dataStore.compareAndSet('users', input.identity.userId, { session_epoch: epoch }, {
      session_epoch: epoch + 1,
    });
    if (updated.ok) return epoch + 1;
  }
  throw new Error('auth_session_epoch_conflict');
}

export const authSessionTokenHashForTest = tokenHash;
