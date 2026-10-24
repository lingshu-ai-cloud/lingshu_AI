import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { AdProviderError } from './metaAdapter.js';
export const META_AD_CALLBACK_PATH = '/api/overseas/platform-ads/oauth/meta/callback';
const text = (name: string) => process.env[name]?.trim() || '';
export const isTemporaryMetaOAuthHost = (host: string) => /(?:^|\.)(?:trycloudflare\.com|ngrok(?:-free)?\.(?:app|io)|loca\.lt|localtunnel\.me)$/.test(host);
export function metaOAuthMissingConfiguration() {
  const keys = ['META_ADS_APP_ID', 'META_ADS_APP_SECRET', 'META_ADS_REDIRECT_URI', 'META_ADS_API_VERSION'];
  if ((text('META_ADS_LOGIN_MODE') || 'business') === 'business') keys.push('META_ADS_LOGIN_CONFIG_ID');
  return keys.filter(key => !text(key));
}
export function getMetaAdOAuthConfig() {
  if (metaOAuthMissingConfiguration().length) throw new AdProviderError('Meta 广告 OAuth 尚未配置', 'NOT_CONFIGURED');
  const appId = text('META_ADS_APP_ID'), appSecret = text('META_ADS_APP_SECRET'), redirectUri = text('META_ADS_REDIRECT_URI'), version = text('META_ADS_API_VERSION');
  const mode = text('META_ADS_LOGIN_MODE') || 'business';
  const loginConfigId = mode === 'business' ? text('META_ADS_LOGIN_CONFIG_ID') : '';
  const environment = text('META_ADS_OAUTH_ENVIRONMENT') || process.env.NODE_ENV || 'development';
  if (!/^\d+$/.test(appId) || !/^v\d+\.0$/.test(version) || !['business', 'classic'].includes(mode) || mode === 'business' && !/^\d+$/.test(loginConfigId) || !/^[a-z][a-z0-9_-]{0,31}$/.test(environment)) throw new AdProviderError('Meta 应用、版本或登录配置格式无效', 'NOT_CONFIGURED');
  let redirect: URL;
  try { redirect = new URL(redirectUri); } catch { throw new AdProviderError('Meta 回调地址格式无效', 'NOT_CONFIGURED'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
  if (redirect.username || redirect.password || redirect.hash || redirect.search || redirect.pathname !== META_AD_CALLBACK_PATH || !(redirect.protocol === 'https:' || redirect.protocol === 'http:' && local)) throw new AdProviderError('Meta 回调须使用固定回调路径与 HTTPS；仅开发允许本机 HTTP', 'NOT_CONFIGURED');
  if (process.env.NODE_ENV === 'production' || environment === 'production') {
    if (redirect.protocol !== 'https:' || local || isIP(redirect.hostname.replace(/^\[|\]$/g, '')) || !redirect.hostname.includes('.') || redirect.hostname.endsWith('.localhost') || redirect.hostname.endsWith('.local') || isTemporaryMetaOAuthHost(redirect.hostname) || environment !== 'production') throw new AdProviderError('生产 Meta 授权必须使用 production 环境和固定 HTTPS 域名，不能指向本机、IP 或临时隧道', 'NOT_CONFIGURED');
  }
  // Public settings only: never incorporate or persist App Secret in session metadata.
  const context = createHash('sha256').update(JSON.stringify([appId, redirectUri, version, mode, loginConfigId, environment])).digest('hex');
  return { appId, appSecret, redirectUri, version, mode, loginConfigId, environment, context };
}
/** A callback from another environment/configuration cannot consume this session. */
export function metaOAuthStateHash(state: string) {
  return createHash('sha256').update(`${getMetaAdOAuthConfig().context}:${state}`).digest('hex');
}
