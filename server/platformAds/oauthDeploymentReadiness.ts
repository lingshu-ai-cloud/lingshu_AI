import { getMetaAdOAuthConfig, metaOAuthMissingConfiguration, isTemporaryMetaOAuthHost } from './oauthConfig.js';
import { isIP } from 'node:net';

/** Configuration evidence only; never substitutes for Meta review or callback verification. */
export function metaOAuthDeploymentReadiness() {
  const missing = metaOAuthMissingConfiguration();
  let valid = false, fixedHttpsCandidate = false, environment = '';
  try {
    const config = getMetaAdOAuthConfig();
    const callback = new URL(config.redirectUri);
    environment = config.environment;
    valid = true;
    fixedHttpsCandidate = callback.protocol === 'https:'
      && !isIP(callback.hostname.replace(/^\[|\]$/g, ''))
      && !['localhost', '127.0.0.1', '[::1]'].includes(callback.hostname)
      && callback.hostname.includes('.')
      && !callback.hostname.endsWith('.local')
      && !callback.hostname.endsWith('.localhost')
      && !isTemporaryMetaOAuthHost(callback.hostname);
  } catch { /* Do not expose configuration values or provider credentials. */ }
  return {
    configured: valid,
    missing,
    callbackConfigurationValid: valid,
    fixedHttpsCandidate,
    environment,
    encryptionConfigured: Boolean(process.env.TENANT_PLATFORM_APP_KEY?.trim()),
    callbackRegistration: 'not_verified' as const,
    callbackReachability: 'not_verified' as const,
    externalBusinessAccess: 'not_verified' as const,
    liveBinding: 'not_verified' as const,
    productionReady: false as const,
  };
}
