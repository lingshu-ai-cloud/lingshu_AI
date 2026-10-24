import { withPlatformAdTaskLock } from './taskLock.js';
import { store } from '../storage/index.js';
import { decryptSecret, encryptSecret } from '../lib/tenantPlatformApps.js';
import { AdProviderError, MetaAdsAdapter, metaAccountId } from './metaAdapter.js';
import { GoogleAdsAdapter, TikTokAdsAdapter } from './otherAdapters.js';
import { assertAuthorizationUsable, inspectMetaAuthorization, publicAuthorization, type AdAuthorization } from './authorizationLifecycle.js';
import { assertMetaAuthorizationNotRevoked } from './oauthPrivacy.js';
export const AD_CONNECTIONS = 'platform_ad_connections';
export type AdConnection = {
  id: string; tenant_id: string; provider: string; accountId: string; name: string; currency: string;
  tokenCipher: string; status: string; updatedAt: string; businessName?: string; accountStatus?: number;
  timezoneId?: number; timezoneName?: string; timezoneOffsetHoursUtc?: number;
  resourceSyncRunId?: string; resourceSyncedAt?: string;
  defaultPage?: { id: string; name: string; verifiedAt: string };
  authorization?: AdAuthorization;
};
export function publicConnection(record: AdConnection) {
  return {
    id: record.id, provider: record.provider, accountId: record.accountId, name: record.name,
    currency: record.currency, status: record.status, updatedAt: record.updatedAt,
    businessName: record.businessName || '', accountStatus: Number.isSafeInteger(record.accountStatus) ? record.accountStatus : null,
    timezoneId: Number.isSafeInteger(record.timezoneId) ? record.timezoneId : null,
    timezoneName: record.timezoneName || '',
    timezoneOffsetHoursUtc: Number.isFinite(record.timezoneOffsetHoursUtc) ? record.timezoneOffsetHoursUtc : null,
    resourceSyncedAt: record.resourceSyncedAt || '',
    defaultPage: record.defaultPage || null,
    authorization: publicAuthorization(record.authorization),
  };
}
export async function listConnections(tenantId: string) {
  return (await store.list<AdConnection>(AD_CONNECTIONS, { where: { tenant_id: tenantId }, perPage: 200 })).items.map(publicConnection);
}
export async function getConnection(tenantId: string, id: string) {
  const connection = await store.getById<AdConnection>(AD_CONNECTIONS, id);
  if (!connection || connection.tenant_id !== tenantId) throw new AdProviderError('未找到广告账户连接', 'NOT_FOUND');
  return connection;
}
export async function getConnectionCredential(tenantId: string, id: string) {
  const connection = await getConnection(tenantId, id);
  if (connection.provider === 'meta') assertAuthorizationUsable(connection.authorization);
  if (connection.provider === 'meta' && connection.authorization?.providerUserId) await assertMetaAuthorizationNotRevoked(connection.authorization);
  const accessToken = decryptSecret(connection.tokenCipher);
  if (!accessToken) throw new AdProviderError('广告账户需要重新授权', 'AUTH_REQUIRED');
  return { connection, accessToken };
}
export async function connectAccount(tenantId: string, input: Record<string, unknown>, authorization?: AdAuthorization) {
  const provider = String(input.provider || '');
  if (!['meta', 'tiktok', 'google'].includes(provider)) throw new AdProviderError('该平台连接暂未开放', 'NOT_SUPPORTED');
  const accountId = metaAccountId(String(input.accountId || '').replace(/-/g, ''));
  return withPlatformAdTaskLock(tenantId, `ad-connection-${provider}-${accountId}`, async () => {
  const token = typeof input.accessToken === 'string' ? input.accessToken.trim() : '';
  if (!token || token.length > 10000) throw new AdProviderError('请输入有效广告访问令牌', 'INVALID_INPUT');
  if (authorization) assertAuthorizationUsable(authorization);
  if (provider === 'meta' && authorization?.providerUserId) await assertMetaAuthorizationNotRevoked(authorization);
  const account = provider === 'meta' ? await new MetaAdsAdapter(token).account(accountId) : provider === 'tiktok' ? await new TikTokAdsAdapter(token).account(accountId) : await new GoogleAdsAdapter(token).account(accountId);
  const existing = (await store.list<AdConnection>(AD_CONNECTIONS, { where: { tenant_id: tenantId, provider, accountId } })).items[0];
  const patch = {
    tenant_id: tenantId, provider, accountId, name: String(account.name || accountId), currency: String(account.currency || ''),
    tokenCipher: encryptSecret(token), status: provider === 'meta' ? Number(account.account_status) === 1 ? 'connected' : 'restricted' : account.status,
    businessName: provider === 'meta' ? String(account.business_name || '') : '',
    accountStatus: provider === 'meta' && Number.isSafeInteger(Number(account.account_status)) ? Number(account.account_status) : 0,
    timezoneId: provider === 'meta' && Number.isSafeInteger(Number(account.timezone_id)) ? Number(account.timezone_id) : 0,
    timezoneName: provider === 'meta' ? String(account.timezone_name || '') : '',
    timezoneOffsetHoursUtc: provider === 'meta' && Number.isFinite(Number(account.timezone_offset_hours_utc)) ? Number(account.timezone_offset_hours_utc) : 0,
    updatedAt: new Date().toISOString(),
    authorization: authorization || { status: 'unknown' as const, reasonCode: 'AUTH_NOT_CHECKED' },
  };
  if (existing) {
    if (!await store.update(AD_CONNECTIONS, existing.id, patch)) throw new AdProviderError('广告连接保存失败', 'STORAGE_ERROR');
    return publicConnection({ ...existing, ...patch });
  }
  const result = await store.create<AdConnection>(AD_CONNECTIONS, patch);
  if (!result) throw new AdProviderError('广告连接保存失败', 'STORAGE_ERROR');
  return publicConnection(result);
  });
}
/** Explicit health check: GET-only at Meta, updates metadata on this connection only. */
export async function checkConnectionAuthorization(tenantId: string, id: string) {
  const connection = await getConnection(tenantId, id);
  if (connection.provider !== 'meta') throw new AdProviderError('此平台暂不支持授权检查', 'NOT_SUPPORTED');
  const authorization = await inspectMetaAuthorization(decryptSecret(connection.tokenCipher));
  const fresh = await getConnection(tenantId, id);
  // A late check cannot overwrite a replacement grant or a deauthorization callback.
  if (fresh.tokenCipher !== connection.tokenCipher) throw new AdProviderError('授权已更新，请重新检查', 'AUTH_CHECK_STALE');
  if (connection.authorization?.providerUserId) await assertMetaAuthorizationNotRevoked(connection.authorization);
  if (!await store.update(AD_CONNECTIONS, id, { authorization })) throw new AdProviderError('授权状态保存失败', 'STORAGE_ERROR');
  return publicConnection({ ...fresh, authorization });
}
