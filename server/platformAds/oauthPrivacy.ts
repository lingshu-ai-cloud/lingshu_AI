import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { store } from '../storage/index.js';
import { AD_CONNECTIONS, type AdConnection } from './connections.js';
import { AD_OAUTH_STATES, clearOAuthState, type OAuthState } from './oauthSessions.js';
import { getMetaAdOAuthConfig } from './oauthConfig.js';
import { AdProviderError } from './metaAdapter.js';
export const AD_PRIVACY_REQUESTS = 'platform_ad_privacy_requests';
type PrivacyRequest = { id: string; confirmationCodeHash: string; providerUserId: string; appId: string; status: string; requestedAt: string; issuedAt: string; requestFingerprint: string };
export function verifyMetaSignedRequest(value: unknown) {
  if (typeof value !== 'string' || value.length > 12000) throw new AdProviderError('Meta 请求签名无效', 'INVALID_INPUT');
  const [signature, payload, extra] = value.split('.');
  if (extra !== undefined || !/^[A-Za-z0-9_-]{43}$/.test(signature || '') || !/^[A-Za-z0-9_-]+$/.test(payload || '')) throw new AdProviderError('Meta 请求签名无效', 'INVALID_INPUT');
  const appId = process.env.META_ADS_APP_ID?.trim() || '', appSecret = process.env.META_ADS_APP_SECRET?.trim() || '';
  if (!/^\d+$/.test(appId) || !appSecret) throw new AdProviderError('Meta 应用尚未配置', 'NOT_CONFIGURED');
  const cfg = { appId, appSecret };
  const expected = createHmac('sha256', cfg.appSecret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AdProviderError('Meta 请求签名无效', 'INVALID_INPUT');
  let decoded: Record<string, unknown>;
  try { decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); }
  catch { throw new AdProviderError('Meta 请求内容无效', 'INVALID_INPUT'); }
  if (!decoded || decoded.algorithm !== 'HMAC-SHA256' || !/^\d+$/.test(String(decoded.user_id || '')) || typeof decoded.issued_at !== 'number' || !Number.isSafeInteger(decoded.issued_at) || decoded.issued_at <= Date.now() / 1000 - 7 * 86400 || decoded.issued_at > Date.now() / 1000 + 300 || decoded.app_id !== undefined && String(decoded.app_id) !== cfg.appId) throw new AdProviderError('Meta 请求内容无效', 'INVALID_INPUT');
  return { appId: cfg.appId, providerUserId: String(decoded.user_id), issuedAt: new Date(decoded.issued_at * 1000 + 999).toISOString(), requestFingerprint: createHash('sha256').update(value).digest('hex') };
}
const codeHash = (code: string) => createHash('sha256').update(code).digest('hex');
/** Business records remain intact. A deletion request is queued for verified handling, never reported as deleted. */
export async function handleMetaPrivacyRequest(signedRequest: unknown, deletion: boolean) {
  const identity = verifyMetaSignedRequest(signedRequest);
  const requestFingerprint = createHash('sha256').update(`${deletion}:${identity.requestFingerprint}`).digest('hex');
  const code = createHmac('sha256', process.env.META_ADS_APP_SECRET!.trim()).update(`meta-privacy-status:${requestFingerprint}`).digest('base64url');
  const requestedAt = new Date().toISOString();
  const existing = (await store.list<PrivacyRequest>(AD_PRIVACY_REQUESTS, { where: { requestFingerprint }, perPage: 1 })).items[0];
  const record = existing || await store.create<PrivacyRequest>(AD_PRIVACY_REQUESTS, { ...identity, requestFingerprint, confirmationCodeHash: codeHash(code), requestedAt, status: deletion ? 'pending' : 'revoked' });
  if (!record) throw new AdProviderError('无法保存授权撤销请求', 'STORAGE_ERROR');
  // Persist the revocation fence before clearing credentials, so interrupted delivery remains fail-closed.
  for (let page = 1;; page++) {
    const rows = await store.list<AdConnection>(AD_CONNECTIONS, { where: { provider: 'meta' }, perPage: 100, page });
    for (const connection of rows.items) {
      if (connection.authorization?.appId !== identity.appId || connection.authorization?.providerUserId !== identity.providerUserId) continue;
      if (!deletion && (connection.authorization.checkedAt || '') > identity.issuedAt) continue;
      if (!await store.update(AD_CONNECTIONS, connection.id, { tokenCipher: '', status: 'reauth_required', updatedAt: requestedAt, authorization: { ...connection.authorization, status: 'revoked', reasonCode: deletion ? 'DATA_DELETION_REQUESTED' : 'USER_REVOKED', checkedAt: requestedAt } })) throw new AdProviderError('授权撤销尚未完成，请重试', 'STORAGE_ERROR');
    }
    if (page >= rows.totalPages) break;
  }
  for (let page = 1;; page++) {
    const rows = await store.list<OAuthState>(AD_OAUTH_STATES, { where: { appId: identity.appId, providerUserId: identity.providerUserId }, perPage: 100, page });
    for (const session of rows.items) {
      if (deletion || !session.authorization?.checkedAt || session.authorization.checkedAt <= identity.issuedAt) await clearOAuthState(session, 'revoked');
    }
    if (page >= rows.totalPages) break;
  }
  if (!deletion) return { url: '', confirmation_code: code };
  const url = new URL(getMetaAdOAuthConfig().redirectUri);
  url.pathname = `/api/overseas/platform-ads/oauth/meta/data-deletion/status/${code}`;
  return { url: url.toString(), confirmation_code: code };
}
export async function assertMetaAuthorizationNotRevoked(identity: { appId?: string; providerUserId?: string; checkedAt?: string }) {
  if (!identity.appId || !identity.providerUserId || !identity.checkedAt) throw new AdProviderError('授权身份缺失，请重新连接', 'AUTH_REQUIRED');
  for (let page = 1;; page++) {
    const rows = await store.list<PrivacyRequest>(AD_PRIVACY_REQUESTS, { where: { appId: identity.appId, providerUserId: identity.providerUserId }, perPage: 100, page });
    if (rows.items.some(request => request.status === 'pending' || request.issuedAt >= identity.checkedAt!)) throw new AdProviderError('Meta 授权已撤销或删除请求待处理，请重新连接或联系管理员', 'AUTH_REQUIRED');
    if (page >= rows.totalPages) break;
  }
}
export async function metaDeletionRequestStatus(code: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new AdProviderError('未找到请求', 'NOT_FOUND');
  const record = (await store.list<PrivacyRequest>(AD_PRIVACY_REQUESTS, { where: { confirmationCodeHash: codeHash(code) }, perPage: 1 })).items[0];
  if (!record || record.status === 'revoked') throw new AdProviderError('未找到请求', 'NOT_FOUND');
  return { confirmation_code: code, status: record.status, message: record.status === 'completed' ? '删除请求已处理。' : '已接收删除请求并撤销相关授权，业务数据删除仍待核实处理。' };
}
