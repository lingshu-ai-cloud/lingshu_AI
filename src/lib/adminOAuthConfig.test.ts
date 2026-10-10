import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeAdminOAuthConfig } from './adminOAuthConfig';

const legacy = normalizeAdminOAuthConfig({
  admin: 'owner', values: { metaSocialAppId: 'meta-app', youtubeOAuthClientId: 'youtube-app' },
  callbacks: { facebook: 'https://app.example/callback/facebook' },
  secretSet: { metaSocialAppSecret: true },
});
assert.equal(legacy.values.instagramAppId.trim(), '');
assert.equal(legacy.values.instagramAppSecret, '');
assert.equal(legacy.callbacks.instagram, '');
assert.equal(legacy.secretSet.instagramAppSecret, false);
assert.equal(legacy.secretSet.metaSocialAppSecret, true);
assert.equal(legacy.values.metaSocialAppId, 'meta-app');
const missing = normalizeAdminOAuthConfig({ values: { instagramAppId: 'new-app' } });
assert.equal(missing.secretSet.instagramAppSecret, false);
assert.equal(missing.values.instagramAppId, 'new-app');
assert.equal(missing.values.advancedManualConnectEnabled, false);
const modern = normalizeAdminOAuthConfig({ values: { instagramAppId: 'app', advancedManualConnectEnabled: true }, secretSet: { instagramAppSecret: true }, callbacks: { instagram: 'https://app.example/callback/instagram' } });
assert.equal(modern.secretSet.instagramAppSecret, true);
assert.equal(modern.callbacks.instagram, 'https://app.example/callback/instagram');
assert.equal(modern.values.advancedManualConnectEnabled, true);
// All successful read, save, and clear responses must cross the same normalization boundary.
const component = readFileSync(new URL('../components/AdminSocialAccountSetup.tsx', import.meta.url), 'utf8');
assert.equal((component.match(/normalizeAdminOAuthConfig\(data(?:\.config)?\)/g) || []).length, 3);
console.log('admin OAuth legacy response compatibility passed');
