import assert from 'node:assert/strict';
import test from 'node:test';
import { validateOAuthCredentialPairs } from './socialOAuthCredentialValidation.js';

test('OAuth app ID replacement requires the matching new secret', () => {
  const pair = { label: 'YouTube', clientId: 'new-id', clientSecret: '', savedClientId: 'old-id', savedSecret: true };
  assert.match(validateOAuthCredentialPairs([pair]) || '', /新 Secret/);
  assert.equal(validateOAuthCredentialPairs([{ ...pair, clientSecret: 'new-secret' }]), null);
});

test('unchanged complete app can be saved without re-entering secret', () => {
  assert.equal(validateOAuthCredentialPairs([{ label: 'Meta', clientId: 'app-id', clientSecret: '', savedClientId: 'app-id', savedSecret: true }]), null);
});

test('partial OAuth configuration is rejected before claiming it is saved', () => {
  const base = { label: 'TikTok', clientId: 'app-id', clientSecret: '', savedClientId: '', savedSecret: false };
  assert.match(validateOAuthCredentialPairs([base]) || '', /新 Secret/);
  assert.match(validateOAuthCredentialPairs([{ ...base, clientId: '', clientSecret: 'secret' }]) || '', /应用 ID/);
  assert.match(validateOAuthCredentialPairs([{ ...base, savedClientId: 'old-id', clientId: '' }]) || '', /清除配置/);
});
