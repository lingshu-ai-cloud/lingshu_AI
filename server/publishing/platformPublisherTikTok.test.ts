import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { store } from '../storage/index.js';
import { publishVideoToAccount, resolvePendingPublishToAccount } from './platformPublisher.js';

const originalAxios = { post: axios.post, put: axios.put };
const originalStore = {
  list: store.list,
  getById: store.getById,
  create: store.create,
  update: store.update,
};
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-platform-tiktok-'));
const videoPath = path.join(temporaryRoot, 'fixture.mp4');
fs.writeFileSync(videoPath, Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70]));

const rows: Record<string, Array<Record<string, any>>> = {
  social_accounts: [{
    id: 'tiktok-account', tenantId: 'tenant-1', platform: 'tiktok',
    providerAccountId: 'open-id', accessToken: 'token', status: 'connected',
  }],
  posts: [],
  tenant_platform_apps: [],
};
let uploadCalls = 0;
let providerStatus = 'PROCESSING_UPLOAD';
try {
  store.list = (async (collection: string, query: { where?: Record<string, unknown>; page?: number; perPage?: number } = {}) => {
    const matching = (rows[collection] || []).filter(row => Object.entries(query.where || {})
      .every(([key, value]) => String(row[key] ?? '') === String(value)));
    return {
      items: structuredClone(matching), totalItems: matching.length,
      totalPages: matching.length ? 1 : 0, page: query.page || 1, perPage: query.perPage || 500,
    };
  }) as typeof store.list;
  store.getById = (async (collection: string, id: string) => structuredClone(
    (rows[collection] || []).find(row => row.id === id) || null,
  )) as typeof store.getById;
  store.create = (async (collection: string, data: Record<string, unknown>) => {
    const row = { id: String(data.id || `post-${(rows[collection] || []).length + 1}`), ...structuredClone(data) };
    (rows[collection] ||= []).push(row);
    return structuredClone(row);
  }) as typeof store.create;
  store.update = (async (collection: string, id: string, patch: Record<string, unknown>) => {
    const row = (rows[collection] || []).find(candidate => candidate.id === id);
    if (!row) return false;
    Object.assign(row, structuredClone(patch));
    return true;
  }) as typeof store.update;
  axios.post = (async (url: string) => url.endsWith('/video/init/')
    ? { data: { data: { upload_url: 'https://upload.invalid/one', publish_id: 'publish-receipt-1' } } }
    : { data: { data: {
      status: providerStatus,
      publicaly_available_post_id: providerStatus === 'PUBLISH_COMPLETE' ? ['public-post-1'] : [],
    } } }) as typeof axios.post;
  axios.put = (async (_url: string, body: AsyncIterable<unknown>) => {
    for await (const _chunk of body) { /* consume mocked upload */ }
    uploadCalls += 1;
    return { data: {} };
  }) as typeof axios.put;

  const accepted = await publishVideoToAccount({
    tenantId: 'tenant-1',
    accountId: 'tiktok-account',
    platform: 'tiktok',
    videoPath,
    title: 'Async TikTok fixture',
    privacyStatus: 'public',
    contentId: 'content-1',
    trackWaLink: false,
  });
  assert.equal(accepted.deliveryStatus, 'provider_accepted');
  assert.equal(accepted.platformPostId, '');
  assert.equal(accepted.publishRecord, null);
  assert.equal((accepted.tracking.stats as any).status, 'provider_processing');
  assert.equal((accepted.tracking.stats as any).publishResults['tiktok-account'].providerReceiptId, 'publish-receipt-1');
  assert.equal(rows.posts[0]?.platform_post_id, '', 'provider init must not finalize local tracking');

  await assert.rejects(() => publishVideoToAccount({
    tenantId: 'tenant-1',
    accountId: 'tiktok-account',
    platform: 'tiktok',
    videoPath,
    title: 'Duplicate attempt',
    privacyStatus: 'public',
    contentId: 'content-1',
    trackWaLink: false,
  }), /禁止重复提交/);
  assert.equal(uploadCalls, 1, 'an unresolved provider receipt prevents a duplicate upload');

  providerStatus = 'PUBLISH_COMPLETE';
  const resolved = await resolvePendingPublishToAccount({
    tenantId: 'tenant-1',
    accountId: 'tiktok-account',
    platform: 'tiktok',
    providerReceiptId: 'publish-receipt-1',
  });
  assert.equal(resolved.status, 'published');
  assert.equal(resolved.platformPostId, 'public-post-1');
} finally {
  Object.assign(axios, originalAxios);
  Object.assign(store, originalStore);
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log('platform publisher TikTok terminal-state tests passed');
