import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPublishingReadinessSnapshot, missingPublishingOAuthConfiguration, publishingAccountConnectionMessage, publishingOAuthConfigurationMessage } from './publishingOAuthReadiness.js';

test('only unconnected target platforms require administrator OAuth configuration', () => {
  const missing = missingPublishingOAuthConfiguration({
    targetPlatforms: ['facebook', 'tiktok', 'youtube'],
    connectedPlatforms: ['facebook'],
    clients: { meta: false, instagram: false, tiktok: false, google: true },
  });
  assert.deepEqual(missing, ['tiktok']);
  assert.equal(publishingOAuthConfigurationMessage(missing),
    'TikTok 授权服务尚未配置，管理员需先配置平台应用与回调地址');
  assert.equal(publishingAccountConnectionMessage(['tiktok', 'facebook']),
    'TikTok、Facebook 尚未连接真实发布账号，请先在账号管理完成授权');
});

test('Instagram may connect through either Instagram Login or the Meta application', () => {
  assert.deepEqual(missingPublishingOAuthConfiguration({
    targetPlatforms: ['instagram'], connectedPlatforms: [],
    clients: { meta: true, instagram: false, tiktok: false, google: false },
  }), []);
  assert.deepEqual(missingPublishingOAuthConfiguration({
    targetPlatforms: ['instagram'], connectedPlatforms: [],
    clients: { meta: false, instagram: true, tiktok: false, google: false },
  }), []);
});

test('LinkedIn requires its own application unless a real account is already connected', () => {
  assert.deepEqual(missingPublishingOAuthConfiguration({
    targetPlatforms: ['linkedin'], connectedPlatforms: [],
    clients: { meta: true, instagram: true, tiktok: true, google: true, linkedin: false },
  }), ['linkedin']);
  assert.deepEqual(missingPublishingOAuthConfiguration({
    targetPlatforms: ['linkedin'], connectedPlatforms: ['linkedin'],
    clients: { meta: false, instagram: false, tiktok: false, google: false, linkedin: false },
  }), []);
});

test('unknown or already connected platforms never create a false configuration blocker', () => {
  assert.deepEqual(missingPublishingOAuthConfiguration({
    targetPlatforms: ['facebook', 'unknown', 'toString'], connectedPlatforms: ['facebook'],
    clients: { meta: false, instagram: false, tiktok: false, google: false },
  }), []);
});

test('the pre-start snapshot warns without pretending that content production is blocked', () => {
  const readiness = buildPublishingReadinessSnapshot({
    required: true,
    targetPlatforms: ['tiktok', 'facebook'],
    connectedPlatforms: [],
    clients: { meta: false, instagram: false, tiktok: false, google: false },
  });
  assert.equal(readiness.status, 'action_required');
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.missingOAuthPlatforms, ['tiktok', 'facebook']);
  assert.deepEqual(readiness.missingAccountPlatforms, ['tiktok', 'facebook']);
  assert.match(readiness.summary, /TikTok、Facebook 授权服务尚未配置/);
  assert.match(readiness.summary, /TikTok、Facebook 尚未连接真实发布账号/);
});

test('a content-only week does not require publishing setup', () => {
  const readiness = buildPublishingReadinessSnapshot({
    required: false,
    targetPlatforms: ['tiktok'],
    connectedPlatforms: [],
    clients: { meta: false, instagram: false, tiktok: false, google: false },
  });
  assert.equal(readiness.status, 'not_required');
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.missingAccountPlatforms, []);
});
