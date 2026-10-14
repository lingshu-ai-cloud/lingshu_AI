import assert from 'node:assert/strict';
import test from 'node:test';
import { missingPublishingOAuthConfiguration, publishingAccountConnectionMessage, publishingOAuthConfigurationMessage } from './publishingOAuthReadiness.js';

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

test('unknown or already connected platforms never create a false configuration blocker', () => {
  assert.deepEqual(missingPublishingOAuthConfiguration({
    targetPlatforms: ['facebook', 'unknown'], connectedPlatforms: ['facebook'],
    clients: { meta: false, instagram: false, tiktok: false, google: false },
  }), []);
});
