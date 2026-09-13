import { createHash, randomBytes } from 'node:crypto';
import { store } from '../storage/index.js';
import { encryptSecret, decryptSecret } from '../lib/tenantPlatformApps.js';
import { withPlatformAdTaskLock } from './taskLock.js';
import { AdProviderError } from './metaAdapter.js';
import { connectAccount } from './connections.js';
export const AD_OAUTH_STATES = 'platform_ad_oauth_states';
type OAuthState = { id: string; tenant_id: string; userId: string; stateHash: string; expiresAt: string; status: string; tokenCipher?: string; accounts?: Array<{ id: string; name: string; currency: string }> };
function config() {
  const appId = process.env.META_ADS_APP_ID, appSecret = process.env.META_ADS_APP_SECRET, redirectUri = process.env.META_ADS_REDIRECT_URI, version = process.env.META_ADS_API_VERSION;
  if (!appId || !appSecret || !redirectUri || !version || !/^v\d+\.0$/.test(version)) throw new AdProviderError('Meta 广告 OAuth 尚未配置', 'NOT_CONFIGURED');
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== 'https:' && redirect.hostname !== 'localhost' && redirect.hostname !== '127.0.0.1') throw new AdProviderError('Meta 回调必须使用 HTTPS', 'NOT_CONFIGURED');
  return { appId, appSecret, redirectUri, version };
}
export function metaOAuthConfigured() { try { config(); return true; } catch { return false; } }
export async function beginMetaOAuth(tenantId: string, userId: string) {
  const cfg = config();
  const state = randomBytes(32).toString('base64url');
  const record = await store.create<OAuthState>(AD_OAUTH_STATES, { tenant_id: tenantId, userId, stateHash: createHash('sha256').update(state).digest('hex'), expiresAt: new Date(Date.now() + 10 * 60000).toISOString(), status: 'pending' });
  if (!record) throw new AdProviderError('无法创建授权会话', 'STORAGE_ERROR');
  const url = new URL(`https://www.facebook.com/${cfg.version}/dialog/oauth`);
  url.search = new URLSearchParams({ client_id: cfg.appId, redirect_uri: cfg.redirectUri, state, response_type: 'code', scope: 'ads_read,ads_management' }).toString();
  return { url: url.toString(), sessionId: record.id };
}
export async function finishMetaOAuth(state: string, code: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length > 10000) throw new AdProviderError('授权回调参数无效', 'INVALID_INPUT');
  const hash = createHash('sha256').update(state).digest('hex');
  const record = (await store.list<OAuthState>(AD_OAUTH_STATES, { where: { stateHash: hash } })).items[0];
  if (!record) throw new AdProviderError('授权会话无效', 'AUTH_REQUIRED');
  return withPlatformAdTaskLock(record.tenant_id, `oauth-${record.id}`, async () => {
    const fresh = await store.getById<OAuthState>(AD_OAUTH_STATES, record.id);
    if (!fresh || fresh.status !== 'pending' || Date.parse(fresh.expiresAt) <= Date.now()) throw new AdProviderError('授权会话已使用或过期', 'AUTH_REQUIRED');
    if (!await store.update(AD_OAUTH_STATES, fresh.id, { status: 'exchanging' })) throw new AdProviderError('无法消费授权会话', 'STORAGE_ERROR');
    const cfg = config();
    try {
      const response = await fetch(`https://graph.facebook.com/${cfg.version}/oauth/access_token`, { method: 'POST', body: new URLSearchParams({ client_id: cfg.appId, client_secret: cfg.appSecret, redirect_uri: cfg.redirectUri, code }), signal: AbortSignal.timeout(30000) });
      const token = await response.json() as any;
      if (!response.ok || !token.access_token) throw new AdProviderError('Meta 授权交换失败，请重新连接', 'AUTH_REQUIRED');
      const accountsResponse = await fetch(`https://graph.facebook.com/${cfg.version}/me/adaccounts?fields=id,name,currency&limit=100`, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(30000) });
      const body = await accountsResponse.json() as any;
      if (!accountsResponse.ok || !Array.isArray(body.data)) throw new AdProviderError('无法获取 Meta 广告账户', 'AUTH_REQUIRED');
      const accounts = body.data.map((item: any) => ({ id: String(item.id), name: String(item.name || item.id), currency: String(item.currency || '') }));
      if (!await store.update(AD_OAUTH_STATES, fresh.id, { status: 'ready', tokenCipher: encryptSecret(String(token.access_token)), accounts })) throw new AdProviderError('无法保存授权结果', 'STORAGE_ERROR');
      return fresh.id;
    } catch (error) {
      await store.update(AD_OAUTH_STATES, fresh.id, { status: 'failed' });
      throw error instanceof AdProviderError ? error : new AdProviderError('Meta 授权暂时失败，请重新连接', 'AUTH_REQUIRED');
    }
  });
}
export async function oauthAccounts(tenantId: string, userId: string, id: string) {
  const record = await store.getById<OAuthState>(AD_OAUTH_STATES, id);
  if (!record || record.tenant_id !== tenantId || record.userId !== userId || Date.parse(record.expiresAt) <= Date.now()) throw new AdProviderError('授权会话无效或过期', 'AUTH_REQUIRED');
  return { status: record.status, accounts: record.accounts || [] };
}
export async function selectOAuthAccount(tenantId: string, userId: string, id: string, accountId: string) {
  const state = await oauthAccounts(tenantId, userId, id);
  if (state.status !== 'ready' || !state.accounts.some(account => account.id === accountId)) throw new AdProviderError('请从已授权账户中选择', 'AUTH_REQUIRED');
  const record = await store.getById<OAuthState>(AD_OAUTH_STATES, id);
  return connectAccount(tenantId, { provider: 'meta', accountId, accessToken: decryptSecret(record?.tokenCipher) });
}
