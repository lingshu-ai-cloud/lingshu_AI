/** Platform-owned credentials. Tenant records store only this reference, never the shared secret. */
export const WHATSAPP_PLATFORM_SECRET_REF = 'ref:whatsapp-platform-app-secret';
export const WHATSAPP_PLATFORM_WEBHOOK_PATH = '/api/webhooks/whatsapp';
export function whatsappPlatformConfig() {
  const value = (key: string) => process.env[key]?.trim() || '';
  const appId = value('WHATSAPP_PLATFORM_APP_ID');
  const appSecret = value('WHATSAPP_PLATFORM_APP_SECRET');
  const configId = value('WHATSAPP_PLATFORM_CONFIG_ID');
  const verifyToken = value('WHATSAPP_PLATFORM_VERIFY_TOKEN');
  const signupMode = value('WHATSAPP_PLATFORM_SIGNUP_MODE') || 'standard';
  const graphVersion = value('META_GRAPH_VERSION') || 'v25.0';
  const validMode = signupMode === 'standard' || signupMode === 'coexistence';
  const missing = { appId: !appId, appSecret: !appSecret, configId: !configId, verifyToken: !verifyToken,
    signupMode: !validMode, graphVersion: !/^v\d+\.\d+$/.test(graphVersion) };
  return { appId, appSecret, configId, verifyToken, signupMode, graphVersion, missing,
    configured: !Object.values(missing).some(Boolean) };
}
