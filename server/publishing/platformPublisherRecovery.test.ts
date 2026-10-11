import assert from 'node:assert/strict';
import axios from 'axios';
import { sealAccountCredential } from '../lib/accountCredentials.js';
import { store } from '../storage/index.js';
import { publishVideoToAccount, resolvePendingPublishToAccount } from './platformPublisher.js';

process.env.PLATFORM_TOKEN_ENCRYPTION_KEY = 'platform-recovery-test-key';
const originalGet = axios.get;
const originalGetById = store.getById;
const accounts: Record<string, Record<string, unknown>> = {
  youtube: {
    id: 'youtube-1', tenantId: 'tenant-a', status: 'connected', clientId: 'client',
    clientSecret: sealAccountCredential('secret'), refreshToken: '', accessToken: sealAccountCredential('youtube-token'),
  },
  facebook: {
    id: 'facebook-1', tenantId: 'tenant-a', platform: 'facebook', status: 'connected',
    providerAccountId: 'page-1', accessToken: sealAccountCredential('facebook-token'),
  },
  instagram: {
    id: 'instagram-1', tenantId: 'tenant-a', platform: 'instagram', status: 'connected',
    providerAccountId: 'ig-1', accessToken: sealAccountCredential('instagram-token'),
  },
};

try {
  store.getById = (async (collection: string, id: string) => {
    if (collection === 'youtube_accounts' && id === 'youtube-1') return structuredClone(accounts.youtube);
    if (collection === 'social_accounts' && id === 'facebook-1') return structuredClone(accounts.facebook);
    if (collection === 'social_accounts' && id === 'instagram-1') return structuredClone(accounts.instagram);
    return null;
  }) as typeof store.getById;

  axios.get = (async (url: string, config: any) => {
    if (url.includes('googleapis.com/youtube')) {
      assert.equal(config.params.id, 'youtube-video-1');
      assert.equal(config.headers.Authorization, 'Bearer youtube-token');
      return { data: { items: [{ id: 'youtube-video-1', status: { uploadStatus: 'processed', privacyStatus: 'public' } }] } };
    }
    if (url.endsWith('/facebook-video-1')) {
      assert.equal(config.params.access_token, 'facebook-token');
      return { data: { id: 'facebook-video-1', permalink_url: 'https://facebook.test/video/1', status: { video_status: 'ready' } } };
    }
    if (url.endsWith('/instagram-media-1')) {
      assert.equal(config.params.access_token, 'instagram-token');
      return { data: { id: 'instagram-media-1', permalink: 'https://instagram.test/reel/1', media_type: 'VIDEO' } };
    }
    throw new Error(`unexpected recovery URL: ${url}`);
  }) as typeof axios.get;

  for (const input of [
    { accountId: 'youtube-1', platform: 'youtube' as const, providerReceiptId: 'youtube-video-1' },
    { accountId: 'facebook-1', platform: 'facebook' as const, providerReceiptId: 'facebook-video-1' },
    { accountId: 'instagram-1', platform: 'instagram' as const, providerReceiptId: 'instagram-media-1' },
  ]) {
    const result = await resolvePendingPublishToAccount({ tenantId: 'tenant-a', ...input });
    assert.equal(result.status, 'published');
    assert.equal(result.platformPostId, input.providerReceiptId);
  }

  await assert.rejects(resolvePendingPublishToAccount({
    tenantId: 'tenant-b', accountId: 'facebook-1', platform: 'facebook', providerReceiptId: 'facebook-video-1',
  }), /Social account not found/);

  // Neither a new submission nor recovery may send IG User tokens to legacy Graph.
  let wrongProviderCalls = 0;
  axios.get = (async () => { wrongProviderCalls++; throw new Error('wrong provider called'); }) as typeof axios.get;
  for (const oauthProvider of ['unknown_login']) {
    accounts.instagram!.oauthProvider = oauthProvider;
    accounts.instagram!.scope = 'instagram_business_content_publish instagram_content_publish';
    for (const providerReceiptId of ['ig-container:original-container', 'instagram-media-1']) {
      await assert.rejects(resolvePendingPublishToAccount({tenantId:'tenant-a',accountId:'instagram-1',platform:'instagram',providerReceiptId}), /instagram_publishing_oauth_provider_unsupported/);
    }
    await assert.rejects(publishVideoToAccount({tenantId:'tenant-a',accountId:'instagram-1',platform:'instagram',title:'blocked IG login',videoUrl:'https://controlled.invalid/video.mp4'}), /instagram_publishing_oauth_provider_unsupported/);
  }
  assert.equal(wrongProviderCalls, 0);
  delete accounts.instagram!.oauthProvider;

  axios.get = (async () => ({
    data: { items: [{ id: 'youtube-private-1', status: { uploadStatus: 'processed', privacyStatus: 'private' } }] },
  })) as typeof axios.get;
  const privateVideo = await resolvePendingPublishToAccount({
    tenantId: 'tenant-a', accountId: 'youtube-1', platform: 'youtube', providerReceiptId: 'youtube-private-1',
  });
  assert.equal(privateVideo.status, 'processing', 'a processed private upload is not a public launch');
  assert.equal(privateVideo.providerStatus, 'processed:private');
  assert.match(privateVideo.error, /尚未公开/);

  axios.get = (async () => ({
    data: { items: [{ id: 'youtube-unlisted-1', status: { uploadStatus: 'processed', privacyStatus: 'unlisted' } }] },
  })) as typeof axios.get;
  const unlistedVideo = await resolvePendingPublishToAccount({
    tenantId: 'tenant-a', accountId: 'youtube-1', platform: 'youtube', providerReceiptId: 'youtube-unlisted-1',
  });
  assert.equal(unlistedVideo.status, 'processing', 'an unlisted upload cannot count as first-release public launch');
  assert.equal(unlistedVideo.providerStatus, 'processed:unlisted');
} finally {
  axios.get = originalGet;
  store.getById = originalGetById;
}

console.log('non-TikTok provider receipt recovery tests passed');
