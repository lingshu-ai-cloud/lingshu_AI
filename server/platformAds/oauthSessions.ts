import { withPlatformAdTaskLock } from './taskLock.js';
import { store } from '../storage/index.js';
import { getMetaAdOAuthConfig } from './oauthConfig.js';
import { AdProviderError } from './metaAdapter.js';
import type { AdAuthorization } from './authorizationLifecycle.js';
export const AD_OAUTH_STATES = 'platform_ad_oauth_states';
export type OAuthState = {
  id: string; tenant_id: string; userId: string; stateHash: string; expiresAt: string; status: string;
  context?: string; appId?: string; providerUserId?: string; tokenCipher?: string; authorization?: AdAuthorization;
  accounts?: Array<{ id: string; name: string; currency: string; accountStatus: number | null; timezoneName: string }>;
};
export async function clearOAuthState(record: OAuthState, status: string) {
  if (!await store.update(AD_OAUTH_STATES, record.id, { status, tokenCipher: '', accounts: [] })) throw new AdProviderError('无法清理授权会话', 'STORAGE_ERROR');
}
export async function ownedOAuthState(tenantId: string, userId: string, id: string) {
  const record = await store.getById<OAuthState>(AD_OAUTH_STATES, id);
  if (!record || record.tenant_id !== tenantId || record.userId !== userId) throw new AdProviderError('授权会话无效', 'AUTH_REQUIRED');
  if (record.context !== getMetaAdOAuthConfig().context) {
    await clearOAuthState(record, 'invalidated');
    throw new AdProviderError('授权配置已变化，请重新连接', 'AUTH_REQUIRED');
  }
  if (!Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= Date.now()) {
    await clearOAuthState(record, 'expired');
    throw new AdProviderError('授权会话无效或过期', 'AUTH_REQUIRED');
  }
  return record;
}
export async function currentMetaOAuth(tenantId: string, userId: string) {
  const context = getMetaAdOAuthConfig().context;
  let latest: OAuthState | undefined;
  // Process every page: expired tokens must not be hidden behind the most recent session.
  for (let page = 1;; page++) {
    const rows = await store.list<OAuthState>(AD_OAUTH_STATES, { where: { tenant_id: tenantId, userId }, perPage: 100, page });
    for (const record of rows.items) {
      if (!['pending', 'exchanging', 'ready'].includes(record.status)) continue;
      if (record.context !== context || !Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= Date.now()) {
        await clearOAuthState(record, record.context !== context ? 'invalidated' : 'expired'); continue;
      }
      if (!latest || record.expiresAt > latest.expiresAt) latest = record;
    }
    if (page >= rows.totalPages) break;
  }
  return { session: latest ? { sessionId: latest.id, status: latest.status, expiresAt: latest.expiresAt, accounts: latest.status === 'ready' ? latest.accounts || [] : [] } : null };
}
export async function cancelOwnedMetaOAuth(tenantId: string, userId: string, id: string) {
  return withPlatformAdTaskLock(tenantId, `oauth-${id}`, async () => {
  const record = await ownedOAuthState(tenantId, userId, id);
  if (record.status === 'exchanging') throw new AdProviderError('授权正在处理，请稍后检查', 'AUTH_REQUIRED');
  await clearOAuthState(record, 'cancelled');
  return { status: 'cancelled' };
  });
}
/** Local storage housekeeping only; never exchanges codes or contacts Meta. */
export async function sweepExpiredOAuthStates(now = Date.now()) {
  let cleared = 0;
  for (let page = 1;; page++) {
    const rows = await store.list<OAuthState>(AD_OAUTH_STATES, { perPage: 100, page });
    for (const record of rows.items) {
      const expired = !Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= now;
      const terminal = ['cancelled', 'failed', 'expired', 'invalidated', 'revoked'].includes(record.status);
      if ((!expired && !terminal) || !record.tokenCipher && !record.accounts?.length) continue;
      await clearOAuthState(record, expired ? 'expired' : record.status);
      cleared++;
    }
    if (page >= rows.totalPages) break;
  }
  return { cleared };
}
