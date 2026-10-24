import assert from 'node:assert/strict';
import { getMetaAdOAuthConfig, metaOAuthMissingConfiguration, metaOAuthStateHash, META_AD_CALLBACK_PATH } from './oauthConfig.js';
const keys = ['NODE_ENV', 'META_ADS_APP_ID', 'META_ADS_APP_SECRET', 'META_ADS_API_VERSION', 'META_ADS_REDIRECT_URI', 'META_ADS_LOGIN_MODE', 'META_ADS_LOGIN_CONFIG_ID', 'META_ADS_OAUTH_ENVIRONMENT'];
const previous = new Map(keys.map(key => [key, process.env[key]]));
try {
  Object.assign(process.env, { NODE_ENV: 'test', META_ADS_APP_ID: '123', META_ADS_APP_SECRET: 'isolated-test-secret', META_ADS_API_VERSION: 'v26.0', META_ADS_REDIRECT_URI: `https://ads-dev.example.com${META_AD_CALLBACK_PATH}`, META_ADS_LOGIN_MODE: 'business', META_ADS_LOGIN_CONFIG_ID: '456', META_ADS_OAUTH_ENVIRONMENT: 'development' });
  assert.equal(getMetaAdOAuthConfig().loginConfigId, '456');
  const initial = metaOAuthStateHash('random-state');
  for (const [key, value] of [['META_ADS_OAUTH_ENVIRONMENT', 'staging'], ['META_ADS_REDIRECT_URI', `https://ads-prod.example.com${META_AD_CALLBACK_PATH}`], ['META_ADS_APP_ID', '321'], ['META_ADS_LOGIN_CONFIG_ID', '654'], ['META_ADS_API_VERSION', 'v25.0']]) {
    const old = process.env[key]; process.env[key] = value;
    assert.notEqual(metaOAuthStateHash('random-state'), initial, `session must bind ${key}`);
    process.env[key] = old;
  }
  delete process.env.META_ADS_LOGIN_CONFIG_ID;
  assert.ok(metaOAuthMissingConfiguration().includes('META_ADS_LOGIN_CONFIG_ID'));
  assert.throws(getMetaAdOAuthConfig, /尚未配置/);
  process.env.META_ADS_LOGIN_CONFIG_ID = '456';
  for (const address of [`https://example.com/wrong-path`, `https://user:password@example.com${META_AD_CALLBACK_PATH}`, `https://example.com${META_AD_CALLBACK_PATH}?redirect=https://evil.invalid`, `ftp://localhost${META_AD_CALLBACK_PATH}`]) {
    process.env.META_ADS_REDIRECT_URI = address; assert.throws(getMetaAdOAuthConfig, /回调/);
  }
  process.env.META_ADS_REDIRECT_URI = `http://127.0.0.1:5187${META_AD_CALLBACK_PATH}`;
  assert.equal(getMetaAdOAuthConfig().environment, 'development', 'local HTTP remains development-only; this does not assert Meta accepts it');
  process.env.NODE_ENV = 'production';
  process.env.META_ADS_OAUTH_ENVIRONMENT = 'production';
  for (const address of [`http://example.com${META_AD_CALLBACK_PATH}`, `https://127.0.0.1${META_AD_CALLBACK_PATH}`, `https://[::1]${META_AD_CALLBACK_PATH}`, `https://localhost${META_AD_CALLBACK_PATH}`, `https://app.localhost${META_AD_CALLBACK_PATH}`, `https://app.local${META_AD_CALLBACK_PATH}`, `https://192.168.1.1${META_AD_CALLBACK_PATH}`]) {
    process.env.META_ADS_REDIRECT_URI = address; assert.throws(getMetaAdOAuthConfig, /回调|生产/);
  }
  process.env.META_ADS_REDIRECT_URI = `https://app.example.com${META_AD_CALLBACK_PATH}`;
  assert.equal(getMetaAdOAuthConfig().environment, 'production');
  process.env.META_ADS_OAUTH_ENVIRONMENT = 'development';
  assert.throws(getMetaAdOAuthConfig, /production/);
  console.log('Meta OAuth production configuration, HTTPS, fixed path and environment-bound state tests passed; no network or store access');
} finally {
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
