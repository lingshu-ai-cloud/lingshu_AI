import assert from 'node:assert/strict';
import test from 'node:test';
import {
  metaOAuthScopes,
  tikTokDirectPostApproved,
  tikTokOAuthScopes,
  youtubeOAuthScopes,
} from './socialOAuthScopes.js';

test('review defaults request only the first-release scopes', () => {
  assert.deepEqual(tikTokOAuthScopes({}), ['user.info.basic']);
  assert.deepEqual(metaOAuthScopes('facebook', {}), [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'pages_messaging',
    'pages_manage_metadata',
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

test('Messenger connection requests message and subscription access without publishing or unrelated feature scopes', () => {
  assert.deepEqual(metaOAuthScopes('messenger', { META_COMMENTS_FEATURES_ENABLED: 'true', META_INSIGHTS_FEATURES_ENABLED: 'true', META_BUSINESS_ASSET_FEATURES_ENABLED: 'true' }), ['pages_show_list', 'pages_read_engagement', 'pages_messaging', 'pages_manage_metadata']);
});

test('higher-risk scopes require explicit feature flags', () => {
  assert.equal(tikTokDirectPostApproved({ TIKTOK_DIRECT_POST_RELEASE_MODE: 'approved' }), true);
  assert.ok(tikTokOAuthScopes({
    TIKTOK_READ_FEATURES_ENABLED: 'true',
    TIKTOK_DIRECT_POST_RELEASE_MODE: 'approved',
  }).includes('video.publish'));
  assert.ok(metaOAuthScopes('combined', { META_INSIGHTS_FEATURES_ENABLED: 'true' }).includes('instagram_manage_insights'));
  assert.ok(youtubeOAuthScopes({ YOUTUBE_COMMENT_FEATURES_ENABLED: 'true' }).includes('https://www.googleapis.com/auth/youtube.force-ssl'));
});
