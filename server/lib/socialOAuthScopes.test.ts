import assert from 'node:assert/strict';
import test from 'node:test';
import {
  instagramLoginOAuthScopes,
  metaOAuthScopes,
  tikTokDirectPostApproved,
  tikTokOAuthScopes,
  youtubeOAuthScopes,
} from './socialOAuthScopes.js';

test('Instagram Login requests only professional account read and publish access', () => {
  assert.deepEqual(instagramLoginOAuthScopes(), [
    'instagram_business_basic',
    'instagram_business_content_publish',
  ]);
});

test('review defaults request only the first-release scopes', () => {
  assert.deepEqual(tikTokOAuthScopes({}), ['user.info.basic']);
  assert.deepEqual(metaOAuthScopes('facebook', {}), [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
  ]);
  assert.deepEqual(metaOAuthScopes('instagram', {}), [
    'pages_show_list',
    'pages_read_engagement',
    'instagram_basic',
    'instagram_content_publish',
  ]);
  assert.deepEqual(youtubeOAuthScopes({}), [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
  ]);
});

test('legacy Meta feature flags cannot widen the review permission set', () => {
  const legacyFlags = {
    META_COMMENTS_FEATURES_ENABLED: 'true',
    META_INSIGHTS_FEATURES_ENABLED: 'true',
    META_WEBHOOK_FEATURES_ENABLED: 'true',
    META_BUSINESS_ASSET_FEATURES_ENABLED: 'true',
    INSTAGRAM_COMMENTS_FEATURES_ENABLED: 'true',
  };
  assert.deepEqual(metaOAuthScopes('combined', legacyFlags), [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'instagram_basic',
    'instagram_content_publish',
  ]);
  assert.deepEqual(instagramLoginOAuthScopes(), [
    'instagram_business_basic',
    'instagram_business_content_publish',
  ]);
});

test('higher-risk non-Meta scopes retain their independent release gates', () => {
  assert.equal(tikTokDirectPostApproved({ TIKTOK_DIRECT_POST_RELEASE_MODE: 'approved' }), true);
  assert.ok(tikTokOAuthScopes({
    TIKTOK_READ_FEATURES_ENABLED: 'true',
    TIKTOK_DIRECT_POST_RELEASE_MODE: 'approved',
  }).includes('video.publish'));
  assert.ok(youtubeOAuthScopes({ YOUTUBE_COMMENT_FEATURES_ENABLED: 'true' }).includes('https://www.googleapis.com/auth/youtube.force-ssl'));
});
