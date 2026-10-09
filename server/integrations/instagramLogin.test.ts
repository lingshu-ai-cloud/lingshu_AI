import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { exchangeInstagramLoginCode, getInstagramLoginAccount, refreshInstagramLoginToken } from './social.js';

test('Instagram Login exchanges a code for an IG User token and reads the matching professional account', async () => {
  const originalPost = axios.post;
  const originalGet = axios.get;
  const calls: string[] = [];
  try {
    axios.post = (async (url: string, body: string, options: any) => {
      calls.push(url);
      assert.equal(url, 'https://api.instagram.com/oauth/access_token');
      assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
      const fields = new URLSearchParams(body);
      assert.equal(fields.get('client_id'), 'instagram-app');
      assert.equal(fields.get('redirect_uri'), 'https://app.example.test/api/overseas/social/oauth/instagram/callback');
      assert.equal(fields.get('code'), 'one-time-code');
      return { data: { access_token: 'short-token', user_id: 'ig-123', permissions: ['instagram_business_basic', 'instagram_business_manage_messages'] } };
    }) as typeof axios.post;
    axios.get = (async (url: string, options: any) => {
      calls.push(url);
      if (url === 'https://graph.instagram.com/access_token') {
        assert.deepEqual(options.params, { grant_type: 'ig_exchange_token', client_secret: 'instagram-secret', access_token: 'short-token' });
        return { data: { access_token: 'long-token', expires_in: 5184000 } };
      }
      assert.equal(url, 'https://graph.instagram.com/v25.0/me');
      assert.equal(options.params.access_token, 'long-token');
      return { data: { id: 'ig-123', username: 'brand', followers_count: 7, media_count: 2 } };
    }) as typeof axios.get;
    const token = await exchangeInstagramLoginCode({
      appId: 'instagram-app',
      appSecret: 'instagram-secret',
      code: 'one-time-code',
      redirectUri: 'https://app.example.test/api/overseas/social/oauth/instagram/callback',
    });
    assert.equal(token.accessToken, 'long-token');
    assert.equal(token.userId, 'ig-123');
    assert.equal(token.expiresIn, 5184000);
    assert.ok(token.permissions.includes('instagram_business_manage_messages'));
    assert.deepEqual(await getInstagramLoginAccount(token.accessToken, 'v25.0'), {
      id: 'ig-123', userId: undefined, username: 'brand', profilePictureUrl: undefined, followersCount: 7, mediaCount: 2,
    });
    assert.deepEqual(calls, [
      'https://api.instagram.com/oauth/access_token',
      'https://graph.instagram.com/access_token',
      'https://graph.instagram.com/v25.0/me',
    ]);
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
  }
});

test('Instagram long-lived token refresh uses the IG token endpoint', async () => {
  const originalGet = axios.get;
  try {
    axios.get = (async (url: string, options: any) => {
      assert.equal(url, 'https://graph.instagram.com/refresh_access_token');
      assert.deepEqual(options.params, { grant_type: 'ig_refresh_token', access_token: 'long-token' });
      return { data: { access_token: 'renewed-token', expires_in: 5184000 } };
    }) as typeof axios.get;
    assert.deepEqual(await refreshInstagramLoginToken('long-token'), { accessToken: 'renewed-token', expiresIn: 5184000 });
  } finally {
    axios.get = originalGet;
  }
});
