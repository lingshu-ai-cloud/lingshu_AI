import assert from 'node:assert/strict';
import { test } from 'node:test';
import axios from 'axios';
import { publishInstagramReel } from '../integrations/social.js';
import { publishVideoToAccount, resolvePendingPublishToAccount } from './platformPublisher.js';
import { store } from '../storage/index.js';

test('native Instagram persists container and final media before returning without legacy Graph traffic', async () => {
  const original = { get: axios.get, post: axios.post };
  const effects: string[] = [];
  try {
    axios.post = (async (url: string, _data: unknown, config: any) => {
      assert.ok(url.startsWith('https://graph.instagram.com/v25.0/target/'));
      assert.equal(config.maxRedirects, 0); assert.equal(config.params.access_token, 'native-token');
      effects.push(url.endsWith('/media') ? 'create' : 'publish');
      return { data: { id: url.endsWith('/media') ? 'container-original' : 'media-original' } };
    }) as typeof axios.post;
    axios.get = (async (url: string, config: any) => {
      assert.equal(url, 'https://graph.instagram.com/v25.0/container-original');
      assert.equal(config.maxRedirects, 0); effects.push('poll');
      return { data: { id: 'container-original', status_code: 'FINISHED' } };
    }) as typeof axios.get;
    const result = await publishInstagramReel('target', 'native-token', 'v25.0', { title: 'controlled', videoUrl: 'https://controlled.invalid/video.mp4' }, {
      graphHost: 'https://graph.instagram.com', async onContainerCreated(id) { assert.equal(id, 'container-original'); effects.push('persist-container'); },
      async onPublishedMedia(id) { assert.equal(id, 'media-original'); effects.push('persist-media'); },
    });
    assert.equal(result.id, 'media-original');
    assert.equal(result.providerReceiptId, 'ig-container:container-original');
    assert.deepEqual(effects, ['create', 'persist-container', 'poll', 'publish', 'persist-media']);
  } finally { Object.assign(axios, original); }
});

test('native unknown recovery only reads original identities and verifies target-account membership', async () => {
  const original = { get: axios.get, post: axios.post, getById: store.getById };
  let lookups = 0, submissions = 0, owned = true, readScope = 'instagram_business_basic';
  try {
    store.getById = (async () => ({ id: 'account', tenantId: 'tenant', platform: 'instagram', status: 'connected', oauthProvider: 'instagram_login', scope: readScope, providerAccountId: 'target', accessToken: 'native-token' })) as typeof store.getById;
    axios.post = (async () => { submissions++; throw Error('no submissions allowed'); }) as typeof axios.post;
    axios.get = (async (url: string, config: any) => {
      lookups++; assert.ok(url.startsWith('https://graph.instagram.com/')); assert.equal(config.maxRedirects, 0);
      if (url.endsWith('/container-original')) return { data: { id: 'container-original', status_code: 'PUBLISHED' } };
      if (url.endsWith('/target/media')) return { data: { data: [{ id: owned ? 'media-original' : 'different-media' }] } };
      assert.ok(url.endsWith('/media-original'));
      return { data: { id: 'media-original', permalink: 'https://instagram.com/reel/original', media_type: 'VIDEO' } };
    }) as typeof axios.get;
    const input = { tenantId: 'tenant', accountId: 'account', platform: 'instagram' as const, providerReceiptId: 'ig-container:container-original' };
    assert.equal((await resolvePendingPublishToAccount(input)).status, 'unknown');
    for (let retry = 0; retry < 2; retry++) {
      const result = await resolvePendingPublishToAccount({ ...input, platformPostId: 'media-original' });
      assert.equal(result.status, 'published'); assert.equal(result.providerReceiptId, input.providerReceiptId); assert.equal(result.platformPostId, 'media-original');
    }
    owned = false;
    assert.equal((await resolvePendingPublishToAccount({ ...input, platformPostId: 'media-original' })).status, 'unknown');
    assert.equal(submissions, 0); assert.equal(lookups, 7);
    readScope = 'instagram_business_content_publish';
    await assert.rejects(resolvePendingPublishToAccount({ ...input, platformPostId: 'media-original' }), /provider_read_scope_missing/);
    assert.equal(lookups, 7, 'missing basic scope rejects before HTTP');
  } finally { axios.get = original.get; axios.post = original.post; store.getById = original.getById; }
});

test('native publication stops on wrong container and surfaces lost final-media persistence', async () => {
  const original = { get: axios.get, post: axios.post };
  let publishCalls = 0, wrongContainer = true, savedContainer = '';
  try {
    axios.post = (async (url: string) => {
      assert.ok(url.startsWith('https://graph.instagram.com/'));
      if (url.endsWith('/media')) return { data: { id: 'original-container' } };
      publishCalls++; return { data: { id: 'original-media' } };
    }) as typeof axios.post;
    axios.get = (async () => ({ data: { id: wrongContainer ? 'other-container' : 'original-container', status_code: 'FINISHED' } })) as typeof axios.get;
    const lifecycle = { graphHost: 'https://graph.instagram.com' as const, async onContainerCreated(id: string) { savedContainer = id; }, async onPublishedMedia(id: string) { assert.equal(id, 'original-media'); throw Error('controlled final media persistence lost'); } };
    const input = { title: 'controlled', videoUrl: 'https://controlled.invalid/video.mp4' };
    await assert.rejects(publishInstagramReel('target', 'native-token', 'v25.0', input, { ...lifecycle, async onContainerCreated() { throw Error('controlled container receipt persistence lost'); } }), /container receipt persistence lost/);
    assert.equal(publishCalls, 0);
    await assert.rejects(publishInstagramReel('target', 'native-token', 'v25.0', input, lifecycle), /容器回执不匹配/);
    assert.equal(publishCalls, 0); assert.equal(savedContainer, 'original-container');
    wrongContainer = false;
    await assert.rejects(publishInstagramReel('target', 'native-token', 'v25.0', input, lifecycle), /final media persistence lost/);
    assert.equal(publishCalls, 1);
  } finally { Object.assign(axios, original); }
});

 test('Instagram external tracking requires both durable callbacks before provider effects', async () => {
  const original = { getById: store.getById, get: axios.get, post: axios.post };
  let effects = 0;
  try {
    store.getById = (async () => ({ id: 'account', tenantId: 'tenant', platform: 'instagram', status: 'connected', oauthProvider: 'instagram_login', scope: 'instagram_business_basic instagram_business_content_publish', providerAccountId: 'target', accessToken: 'controlled' })) as typeof store.getById;
    axios.post = (async () => { effects++; throw Error('unexpected submission'); }) as typeof axios.post;
    axios.get = (async () => { effects++; throw Error('unexpected lookup'); }) as typeof axios.get;
    const input = { tenantId: 'tenant', accountId: 'account', platform: 'instagram' as const, title: 'controlled', videoUrl: 'https://controlled.invalid/video.mp4', finalizeTracking: false };
    await assert.rejects(publishVideoToAccount(input), /instagram_container_persistence_required/);
    await assert.rejects(publishVideoToAccount({ ...input, async onProviderReceipt() {} }), /instagram_media_persistence_required/);
    assert.equal(effects, 0);
  } finally { store.getById = original.getById; axios.get = original.get; axios.post = original.post; }
});
