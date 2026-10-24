import { AdProviderError } from './metaAdapter.js';

export const META_REQUIRED_AD_SCOPES = ['ads_read', 'ads_management', 'pages_show_list', 'pages_read_engagement', 'pages_manage_ads'] as const;
export type AdAuthorization = {
  appId?: string; providerUserId?: string; expiresAt?: string; dataAccessExpiresAt?: string;
  grantedScopes?: string[]; checkedAt?: string;
  status: 'healthy' | 'expiring' | 'expired' | 'revoked' | 'missing_permissions' | 'unknown';
  reasonCode: string;
};
export type AuthorizationMetadata = AdAuthorization;
const iso = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value < 8640000000000 ? new Date(value * 1000).toISOString() : undefined;

/** Local projection only: listing saved history never contacts Meta. */
export function authorizationAt(value?: AdAuthorization, now = Date.now()): AdAuthorization {
  if (!value) return { status: 'unknown', reasonCode: 'AUTH_NOT_CHECKED' };
  const expiry = [value.expiresAt, value.dataAccessExpiresAt].filter(Boolean).map(date => Date.parse(date!));
  if (expiry.some(date => !Number.isFinite(date))) return { ...value, status: 'unknown', reasonCode: 'AUTH_METADATA_INVALID' };
  if (value.status === 'revoked') return { ...value };
  if (expiry.some(date => date <= now)) return { ...value, status: 'expired', reasonCode: 'AUTH_EXPIRED' };
  if (value.status === 'missing_permissions' || value.status === 'unknown' || value.status === 'expired') return { ...value };
  if (expiry.some(date => date <= now + 7 * 86400000)) return { ...value, status: 'expiring', reasonCode: 'AUTH_EXPIRING' };
  return { ...value, status: 'healthy', reasonCode: 'AUTH_VALID' };
}
export function publicAuthorization(value?: AdAuthorization) {
  const { appId: _appId, providerUserId: _providerUserId, ...safe } = authorizationAt(value);
  return safe;
}
export function assertAuthorizationUsable(value?: AdAuthorization) {
  const authorization = authorizationAt(value);
  if (['expired', 'revoked', 'missing_permissions'].includes(authorization.status) || authorization.reasonCode === 'AUTH_METADATA_INVALID') throw new AdProviderError('Meta 授权已失效或缺少权限，请重新授权；历史记录仍保留', authorization.reasonCode);
}

/** Read-only Graph inspection. Never log provider bodies or credential-bearing URLs. */
export async function inspectMetaAuthorization(accessToken: string, options: { transport?: typeof fetch; now?: number } = {}): Promise<AdAuthorization> {
  const appId = process.env.META_ADS_APP_ID?.trim() || '', appSecret = process.env.META_ADS_APP_SECRET?.trim() || '', version = process.env.META_ADS_API_VERSION?.trim() || '';
  if (!/^\d+$/.test(appId) || !appSecret || !/^v\d+\.0$/.test(version)) throw new AdProviderError('管理员尚未完成 Meta 应用配置', 'NOT_CONFIGURED');
  if (!accessToken) throw new AdProviderError('广告账户需要重新授权', 'AUTH_REQUIRED');
  const url = new URL(`https://graph.facebook.com/${version}/debug_token`);
  url.searchParams.set('input_token', accessToken);
  let response: Response;
  try { response = await (options.transport || fetch)(url, { method: 'GET', headers: { Authorization: `Bearer ${appId}|${appSecret}` }, signal: AbortSignal.timeout(30000) }); }
  catch { throw new AdProviderError('暂时无法检查 Meta 授权，请稍后重试', 'AUTH_CHECK_UNAVAILABLE'); }
  let body: { data?: Record<string, unknown>; error?: unknown };
  try { body = await response.json(); } catch { throw new AdProviderError('Meta 授权检查响应无效', 'INVALID_RESPONSE'); }
  if (!response.ok || body.error) throw new AdProviderError('Meta 授权检查暂不可用，请检查平台应用配置', 'AUTH_CHECK_UNAVAILABLE');
  const data = body.data;
  if (!data || typeof data.is_valid !== 'boolean') throw new AdProviderError('Meta 授权检查响应无效', 'INVALID_RESPONSE');
  const now = options.now ?? Date.now(), checkedAt = new Date(now).toISOString();
  if (!data.is_valid) return { appId, status: 'revoked', reasonCode: 'AUTH_REVOKED', checkedAt };
  if (String(data.app_id) !== appId) throw new AdProviderError('授权不属于当前 Meta 应用，请重新授权', 'AUTH_APP_MISMATCH');
  if (!/^\d+$/.test(String(data.user_id || '')) || !Array.isArray(data.scopes) || data.scopes.some(scope => typeof scope !== 'string')) throw new AdProviderError('Meta 授权身份或权限信息缺失', 'INVALID_RESPONSE');
  for (const key of ['expires_at', 'data_access_expires_at']) if (data[key] !== undefined && (typeof data[key] !== 'number' || !Number.isSafeInteger(data[key]) || Number(data[key]) < 0 || Number(data[key]) >= 8640000000000)) throw new AdProviderError('Meta 授权有效期信息无效', 'INVALID_RESPONSE');
  const grantedScopes = [...new Set(data.scopes as string[])];
  const missing = META_REQUIRED_AD_SCOPES.some(scope => !grantedScopes.includes(scope));
  return authorizationAt({ appId, providerUserId: String(data.user_id), expiresAt: iso(data.expires_at), dataAccessExpiresAt: iso(data.data_access_expires_at), grantedScopes, checkedAt, status: missing ? 'missing_permissions' : 'healthy', reasonCode: missing ? 'AUTH_MISSING_PERMISSIONS' : 'AUTH_VALID' }, now);
}
