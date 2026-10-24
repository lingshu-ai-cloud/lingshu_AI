import assert from 'node:assert/strict';
import { metaOAuthDeploymentReadiness } from './oauthDeploymentReadiness.js';
const keys = ['NODE_ENV', 'META_ADS_APP_ID', 'META_ADS_APP_SECRET', 'META_ADS_API_VERSION', 'META_ADS_REDIRECT_URI', 'META_ADS_LOGIN_MODE', 'META_ADS_LOGIN_CONFIG_ID', 'META_ADS_OAUTH_ENVIRONMENT', 'TENANT_PLATFORM_APP_KEY'];
const previous = new Map(keys.map(key => [key, process.env[key]]));
try {
  Object.assign(process.env, { NODE_ENV: 'test', META_ADS_APP_ID: '123', META_ADS_APP_SECRET: 'secret-never-public', META_ADS_API_VERSION: 'v26.0', META_ADS_LOGIN_MODE: 'business', META_ADS_LOGIN_CONFIG_ID: '456', META_ADS_OAUTH_ENVIRONMENT: 'development', TENANT_PLATFORM_APP_KEY: 'private-key' });
  const path = '/api/overseas/platform-ads/oauth/meta/callback';
  for (const origin of ['http://localhost:5197', 'https://localhost', 'https://192.168.1.1', 'https://test.trycloudflare.com', 'https://test.ngrok-free.app', 'https://test.ngrok.io', 'https://test.loca.lt']) {
    process.env.META_ADS_REDIRECT_URI = origin + path;
    assert.equal(metaOAuthDeploymentReadiness().fixedHttpsCandidate, false, origin);
  }
  process.env.META_ADS_REDIRECT_URI = 'https://ads.example.com' + path;
  const result = metaOAuthDeploymentReadiness();
  assert.equal(result.fixedHttpsCandidate, true);
  assert.equal(result.configured, true);
  assert.equal(result.productionReady, false, 'configuration cannot establish vendor readiness');
  assert.equal(result.liveBinding, 'not_verified');
  assert.ok(!JSON.stringify(result).includes('secret-never-public'));
  assert.ok(!JSON.stringify(result).includes('private-key'));
  delete process.env.META_ADS_LOGIN_CONFIG_ID;
  assert.equal(metaOAuthDeploymentReadiness().configured, false);
  assert.ok(metaOAuthDeploymentReadiness().missing.includes('META_ADS_LOGIN_CONFIG_ID'));
  process.env.META_ADS_LOGIN_CONFIG_ID = '456';
  process.env.META_ADS_REDIRECT_URI = 'https://ads.example.com/wrong';
  assert.equal(metaOAuthDeploymentReadiness().callbackConfigurationValid, false);
  console.log('OAuth deployment evidence distinguishes configuration, durable HTTPS and unverified vendor readiness');
} finally {
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
