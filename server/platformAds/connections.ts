import { store } from '../storage/index.js';
import { decryptSecret, encryptSecret } from '../lib/tenantPlatformApps.js';
import { AdProviderError, MetaAdsAdapter, metaAccountId } from './metaAdapter.js';
import { GoogleAdsAdapter, TikTokAdsAdapter } from './otherAdapters.js';
export const AD_CONNECTIONS = 'platform_ad_connections';
export type AdConnection = { id: string; tenant_id: string; provider: string; accountId: string; name: string; currency: string; tokenCipher: string; status: string; updatedAt: string };
export function publicConnection(record: AdConnection) {
  return { id: record.id, provider: record.provider, accountId: record.accountId, name: record.name, currency: record.currency, status: record.status, updatedAt: record.updatedAt };
}
export async function listConnections(tenantId: string) {
  return (await store.list<AdConnection>(AD_CONNECTIONS, { where: { tenant_id: tenantId }, perPage: 200 })).items.map(publicConnection);
}
export async function getConnectionCredential(tenantId: string, id: string) {
  const connection = await store.getById<AdConnection>(AD_CONNECTIONS, id);
  if (!connection || connection.tenant_id !== tenantId) throw new AdProviderError('未找到广告账户连接', 'NOT_FOUND');
  const accessToken = decryptSecret(connection.tokenCipher);
  if (!accessToken) throw new AdProviderError('广告账户需要重新授权', 'AUTH_REQUIRED');
  return { connection, accessToken };
}
export async function connectAccount(tenantId: string, input: Record<string, unknown>) {
  const provider = String(input.provider || '');
  if (!['meta', 'tiktok', 'google'].includes(provider)) throw new AdProviderError('该平台连接暂未开放', 'NOT_SUPPORTED');
  const accountId = metaAccountId(String(input.accountId || '').replace(/-/g, ''));
  const token = typeof input.accessToken === 'string' ? input.accessToken.trim() : '';
  if (!token || token.length > 10000) throw new AdProviderError('请输入有效广告访问令牌', 'INVALID_INPUT');
  const account = provider === 'meta' ? await new MetaAdsAdapter(token).account(accountId) : provider === 'tiktok' ? await new TikTokAdsAdapter(token).account(accountId) : await new GoogleAdsAdapter(token).account(accountId);
  const existing = (await store.list<AdConnection>(AD_CONNECTIONS, { where: { tenant_id: tenantId, provider, accountId } })).items[0];
  const patch = { tenant_id: tenantId, provider, accountId, name: String(account.name || accountId), currency: String(account.currency || ''), tokenCipher: encryptSecret(token), status: provider === 'meta' ? Number(account.account_status) === 1 ? 'connected' : 'restricted' : account.status, updatedAt: new Date().toISOString() };
  if (existing) {
    if (!await store.update(AD_CONNECTIONS, existing.id, patch)) throw new AdProviderError('广告连接保存失败', 'STORAGE_ERROR');
    return publicConnection({ ...existing, ...patch });
  }
  const result = await store.create<AdConnection>(AD_CONNECTIONS, patch);
  if (!result) throw new AdProviderError('广告连接保存失败', 'STORAGE_ERROR');
  return publicConnection(result);
}
