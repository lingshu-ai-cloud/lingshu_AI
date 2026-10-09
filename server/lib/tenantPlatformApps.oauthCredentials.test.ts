import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptSecret, validateTenantOAuthCredentialPair, signOAuthState, parseOAuthState, type TenantPlatformAppRecord } from './tenantPlatformApps.js';

const existing: TenantPlatformAppRecord = {
  id: 'app-1', tenant_id: 'tenant-1', platform: 'google', app_id: 'old-id', app_secret: encryptSecret('old-secret'),
};

test('Messenger purpose survives signed state recovery and rejects tampering', () => {
  const state = signOAuthState({ tenantId: 'tenant-1', userId: 'user-1', platform: 'facebook', returnTo: '/?page=channels', purpose: 'messenger' });
  assert.equal(parseOAuthState(state)?.purpose, 'messenger');
  assert.equal(parseOAuthState(state.split('.')[0] + '.invalid'), null);
  assert.equal(parseOAuthState(state.replace(/^./, state[0] === 'a' ? 'b' : 'a')), null);
});

test('a matching existing OAuth pair permits an empty secret as no change', () => {
  assert.equal(validateTenantOAuthCredentialPair({ appId: 'old-id', appSecret: '', existing }), null);
});

test('changing an OAuth app ID requires its new secret', () => {
  assert.equal(validateTenantOAuthCredentialPair({ appId: 'new-id', appSecret: '', existing }), 'oauth_app_secret_required');
  assert.equal(validateTenantOAuthCredentialPair({ appId: 'new-id', appSecret: 'new-secret', existing }), null);
});

test('a new or incomplete OAuth pair must be completed before save', () => {
  assert.equal(validateTenantOAuthCredentialPair({ appId: 'id', appSecret: '', existing: null }), 'oauth_app_secret_required');
  assert.equal(validateTenantOAuthCredentialPair({ appId: '', appSecret: 'secret', existing: null }), 'oauth_app_id_required');
  assert.equal(validateTenantOAuthCredentialPair({ appId: 'id', appSecret: 'secret', existing: null }), null);
  assert.equal(validateTenantOAuthCredentialPair({ appId: 'id', appSecret: '', existing: { ...existing, app_id: 'id', app_secret: '' } }), 'oauth_app_secret_required');
});

test('clearing an existing OAuth ID requires the disconnecting delete route', () => {
  assert.equal(validateTenantOAuthCredentialPair({ appId: '', appSecret: '', existing }), 'oauth_app_id_clear_requires_delete');
});
