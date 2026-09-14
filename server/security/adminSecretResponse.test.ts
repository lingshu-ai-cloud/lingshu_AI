import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
  TENANT_PLATFORM_APP_KEY: process.env.TENANT_PLATFORM_APP_KEY,
  YOUTUBE_OAUTH_CLIENT_ID: process.env.YOUTUBE_OAUTH_CLIENT_ID,
  YOUTUBE_OAUTH_CLIENT_SECRET: process.env.YOUTUBE_OAUTH_CLIENT_SECRET,
  META_SOCIAL_APP_ID: process.env.META_SOCIAL_APP_ID,
  META_SOCIAL_APP_SECRET: process.env.META_SOCIAL_APP_SECRET,
  TIKTOK_CLIENT_KEY: process.env.TIKTOK_CLIENT_KEY,
  TIKTOK_CLIENT_SECRET: process.env.TIKTOK_CLIENT_SECRET,
};
const sentinels = {
  youtube: 'youtube-client-secret-must-not-leak',
  meta: 'meta-client-secret-must-not-leak',
  tiktok: 'tiktok-client-secret-must-not-leak',
  app: 'tenant-app-secret-must-not-leak',
  access: 'tenant-access-token-must-not-leak',
  encoding: 'wecom-encoding-key-must-not-leak',
  webhook: 'webhook-verify-token-must-not-leak',
};

process.env.NODE_ENV = 'test';
process.env.PUBLIC_BASE_URL = 'https://app.example.test';
process.env.TENANT_PLATFORM_APP_KEY = 'test-only-platform-encryption-key';
process.env.YOUTUBE_OAUTH_CLIENT_ID = 'youtube-public-client-id';
process.env.YOUTUBE_OAUTH_CLIENT_SECRET = sentinels.youtube;
process.env.META_SOCIAL_APP_ID = 'meta-public-app-id';
process.env.META_SOCIAL_APP_SECRET = sentinels.meta;
process.env.TIKTOK_CLIENT_KEY = 'tiktok-public-client-key';
process.env.TIKTOK_CLIENT_SECRET = sentinels.tiktok;

const tenantPlatformApps = await import('../lib/tenantPlatformApps.js');
const { adminTenantPlatformApp, publicOAuthConfig } = await import('../routes/admin.js');
const request = {
  headers: {},
  protocol: 'https',
  get: (name: string) => name.toLowerCase() === 'host' ? 'app.example.test' : undefined,
} as unknown as Request;

function assertNoSecretValue(value: unknown, label: string): void {
  const serialized = JSON.stringify(value);
  for (const secret of Object.values(sentinels)) {
    assert.doesNotMatch(serialized, new RegExp(secret), `${label} must not contain secret/token plaintext`);
  }
}

try {
  const oauthResponse = publicOAuthConfig(request, 'admin@example.test');
  assert.equal(oauthResponse.values.youtubeOAuthClientId, 'youtube-public-client-id');
  assert.equal(oauthResponse.values.metaSocialAppId, 'meta-public-app-id');
  assert.equal(oauthResponse.values.tiktokClientKey, 'tiktok-public-client-key');
  assert.equal(oauthResponse.values.youtubeOAuthClientSecret, '');
  assert.equal(oauthResponse.values.metaSocialAppSecret, '');
  assert.equal(oauthResponse.values.tiktokClientSecret, '');
  assert.equal(oauthResponse.secretSet.youtubeOAuthClientSecret, true);
  assert.equal(oauthResponse.secretSet.metaSocialAppSecret, true);
  assert.equal(oauthResponse.secretSet.tiktokClientSecret, true);
  assert.equal(oauthResponse.secretLength.youtubeOAuthClientSecret, sentinels.youtube.length);
  assertNoSecretValue(oauthResponse, 'global OAuth config response');

  const storedApp = {
    id: 'tenant-app-record',
    tenant_id: 'tenant-secret-contract',
    platform: 'meta' as const,
    app_id: 'public-app-id',
    app_secret: tenantPlatformApps.encryptSecret(sentinels.app),
    phone_number_id: '1234567890',
    webhook_verify_token: sentinels.webhook,
    wecom_encoding_aes_key: tenantPlatformApps.encryptSecret(sentinels.encoding),
    access_token: tenantPlatformApps.encryptSecret(sentinels.access),
    status: 'active' as const,
  };
  const tenantResponse = tenantPlatformApps.publicTenantPlatformApp(request, storedApp);
  const adminResponse = adminTenantPlatformApp(request, storedApp);
  for (const response of [tenantResponse, adminResponse]) {
    assert.equal(response.appId, 'public-app-id');
    assert.equal(response.phoneNumberId, '1234567890');
    assert.equal(response.appSecretSet, true);
    assert.equal(response.appSecretLength, sentinels.app.length);
    assert.equal(response.accessTokenSet, true);
    assert.equal(response.accessTokenLength, sentinels.access.length);
    assert.equal(response.wecomEncodingAesKeySet, true);
    assert.equal(response.wecomEncodingAesKeyLength, sentinels.encoding.length);
    assert.equal(response.webhookVerifyToken, '');
    assert.equal(response.webhookVerifyTokenSet, true);
    assert.equal(response.webhookVerifyTokenLength, sentinels.webhook.length);
    assertNoSecretValue(response, 'tenant platform app response');
  }
  assert.equal(adminResponse.appSecret, '', 'internal delivery responses must also keep appSecret write-only');

  const adminSource = fs.readFileSync(path.resolve(process.cwd(), 'server/routes/admin.ts'), 'utf8');
  assert.match(adminSource, /get\('\/oauth-config'[\s\S]*?publicOAuthConfig/, 'OAuth GET must use the safe projection');
  assert.match(adminSource, /put\('\/oauth-config'[\s\S]*?publicOAuthConfig/, 'OAuth PUT must use the safe projection');
  assert.match(adminSource, /delete\('\/oauth-config\/:platform'[\s\S]*?publicOAuthConfig/, 'OAuth DELETE must use the safe projection');
  assert.match(adminSource, /publicDeliveryTenant[\s\S]*?adminTenantPlatformApp/, 'delivery list must use the safe platform projection');
  assert.match(adminSource, /put\('\/delivery\/platform-apps\/:tenantId\/:platform'[\s\S]*?adminTenantPlatformApp/, 'delivery save must use the safe platform projection');
  assert.match(adminSource, /post\('\/delivery\/platform-apps\/:tenantId\/:platform\/complete'[\s\S]*?adminTenantPlatformApp/, 'delivery completion must use the safe platform projection');
  assert.match(adminSource, /webhookVerifyToken:\s*bodyText\(req\.body\?\.webhookVerifyToken\)/, 'delivery must accept a caller-chosen webhook token as write-only input');

  const tenantRouteSource = fs.readFileSync(path.resolve(process.cwd(), 'server/routes/platformIntegrations.ts'), 'utf8');
  const platformStoreSource = fs.readFileSync(path.resolve(process.cwd(), 'server/lib/tenantPlatformApps.ts'), 'utf8');
  const deliveryUiSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/AdminDeliveryPage.tsx'), 'utf8');
  const tenantUiSource = fs.readFileSync(path.resolve(process.cwd(), 'src/components/UserSocialAppCredentials.tsx'), 'utf8');
  assert.match(tenantRouteSource, /webhookVerifyToken:\s*text\(req\.body\?\.metaWebhookVerifyToken\)/);
  assert.match(platformStoreSource, /webhook_verify_token:\s*input\.webhookVerifyToken\s*\|\|\s*existing\?\.webhook_verify_token/);
  assert.match(deliveryUiSource, /secret[^\n]+webhookVerifyToken/, 'delivery UI must treat webhook tokens as write-only secrets');
  assert.match(tenantUiSource, /secret[^\n]+metaWebhookVerifyToken/, 'tenant UI must treat webhook tokens as write-only secrets');

  console.log('admin secret response tests passed');
} finally {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
