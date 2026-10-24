import { randomBytes } from 'node:crypto';
import { store } from '../storage/index.js';
import { encryptSecret, decryptSecret } from '../lib/tenantPlatformApps.js';
import { withPlatformAdTaskLock } from './taskLock.js';
import { AdProviderError } from './metaAdapter.js';
import { connectAccount, AD_CONNECTIONS } from './connections.js';
import { authorizedPages, readAuthorizationEdge } from './metaAuthorization.js';
import { MetaAdsAdapter } from './metaAdapter.js';
import { getMetaAdOAuthConfig as config, metaOAuthMissingConfiguration, metaOAuthStateHash } from './oauthConfig.js';
export const AD_OAUTH_STATES = 'platform_ad_oauth_states';
// Ads permissions do not grant access to the Page identity used by creatives.
// Match the permissions offered by Meta's Marketing API authorization tool.
export const META_AD_OAUTH_SCOPES = ['ads_read', 'ads_management', 'pages_show_list', 'pages_read_engagement', 'pages_manage_ads'] as const;
type OAuthState = { id: string; tenant_id: string; userId: string; stateHash: string; expiresAt: string; status: string; tokenCipher?: string; accounts?: Array<{ id: string; name: string; currency: string; accountStatus: number | null; timezoneName: string }> };
export function metaOAuthConfigured() { try { config(); return true; } catch { return false; } }
export function metaOAuthReadiness() {
  const missing = metaOAuthMissingConfiguration();
  return { configured: metaOAuthConfigured(), missing, reason: metaOAuthConfigured() ? '' : '管理员尚未完成现有 Meta 应用的官方登录配置；无需你提供令牌或重新注册账号。' };
}
export async function beginMetaOAuth(tenantId: string, userId: string) {
  const cfg = config();
  const state = randomBytes(32).toString('base64url');
  const record = await store.create<OAuthState>(AD_OAUTH_STATES, { tenant_id: tenantId, userId, stateHash: metaOAuthStateHash(state), expiresAt: new Date(Date.now() + 10 * 60000).toISOString(), status: 'pending' });
  if (!record) throw new AdProviderError('无法创建授权会话', 'STORAGE_ERROR');
  const url = new URL(`https://www.facebook.com/${cfg.version}/dialog/oauth`);
  url.search = new URLSearchParams({ client_id: cfg.appId, redirect_uri: cfg.redirectUri, state, response_type: 'code', ...(cfg.mode === 'business' ? { config_id: cfg.loginConfigId } : { scope: META_AD_OAUTH_SCOPES.join(',') }) }).toString();
  return { url: url.toString(), sessionId: record.id };
}
export async function finishMetaOAuth(state: string, code: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length > 10000) throw new AdProviderError('授权回调参数无效', 'INVALID_INPUT');
  const hash = metaOAuthStateHash(state);
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
      const items = await readAuthorizationEdge(new MetaAdsAdapter(String(token.access_token)), 'me/adaccounts', 'id,name,currency,account_status,timezone_name');
      const accounts = items.filter(item => /^(act_)?\d+$/.test(String(item.id))).map(item => ({ id: String(item.id), name: String(item.name || item.id), currency: String(item.currency || ''), accountStatus: item.account_status != null && Number.isSafeInteger(Number(item.account_status)) ? Number(item.account_status) : null, timezoneName: String(item.timezone_name || '') }));
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
export async function oauthPages(tenantId: string, userId: string, id: string, accountId: string) {
  const state = await oauthAccounts(tenantId, userId, id);
  if (state.status !== 'ready' || !state.accounts.some(account => account.id === accountId)) throw new AdProviderError('请从已授权账户中选择', 'AUTH_REQUIRED');
  const record = await store.getById<OAuthState>(AD_OAUTH_STATES, id);
  return authorizedPages(decryptSecret(record?.tokenCipher), accountId);
}
export async function selectOAuthAccount(tenantId: string, userId: string, id: string, accountId: string, pageId: string) {
  return withPlatformAdTaskLock(tenantId, `oauth-connect-${id}`, async () => {
    if (!/^\d+$/.test(pageId)) throw new AdProviderError('请选择已授权的 Facebook 主页', 'INVALID_INPUT');
    const pages = await oauthPages(tenantId, userId, id, accountId);
    const page = pages.find(p => p.id === pageId);
    if (!page) throw new AdProviderError('所选主页不在该账户可投放且本人获授权的范围内，请重新选择', 'PAGE_AUTH_REQUIRED');
    await oauthAccounts(tenantId, userId, id);
    const record = await store.getById<OAuthState>(AD_OAUTH_STATES, id);
    const accessToken = decryptSecret(record?.tokenCipher);
    await new MetaAdsAdapter(accessToken).pageCreativeAdapter(pageId);
    const connection = await connectAccount(tenantId, { provider: 'meta', accountId, accessToken });
    const defaultPage = { id: page.id, name: page.name, verifiedAt: new Date().toISOString() };
    if (!await store.update(AD_CONNECTIONS, connection.id, { defaultPage })) throw new AdProviderError('账户已连接，但主页选择保存失败；请重新确认，不要重复创建资源', 'STORAGE_ERROR');
    return { ...connection, defaultPage };
  });
}
export async function cancelMetaOAuth(state: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new AdProviderError('授权会话无效', 'INVALID_INPUT');
  const stateHash = metaOAuthStateHash(state);
  const record = (await store.list<OAuthState>(AD_OAUTH_STATES, { where: { stateHash } })).items[0];
  if (!record) throw new AdProviderError('授权会话无效', 'AUTH_REQUIRED');
  await withPlatformAdTaskLock(record.tenant_id, `oauth-${record.id}`, async () => {
    const fresh = await store.getById<OAuthState>(AD_OAUTH_STATES, record.id);
    if (fresh?.status === 'pending' && Date.parse(fresh.expiresAt) > Date.now()) await store.update(AD_OAUTH_STATES, fresh.id, { status: 'cancelled' });
  });
}
