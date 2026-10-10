import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import axios from 'axios';
import { store } from '../storage/index.js';
import { publishVideoToAccount, resolvePendingPublishToAccount } from './platformPublisher.js';
import { freezePublishSourceClaim, publishingUploadDir } from './publishSourceClaim.js';

const originalAxios = { post: axios.post, put: axios.put, get: axios.get };
const originalAtomicCapability = store.supportsAtomicOperationLease;
store.supportsAtomicOperationLease = async () => true;
const originalStore = {
  list: store.list,
  getById: store.getById,
  create: store.create,
  update: store.update,
  delete: store.delete,
};
const temporaryRoot = publishingUploadDir('tenant-1');
fs.mkdirSync(temporaryRoot, { recursive: true });
const videoPath = path.join(temporaryRoot, `manual-${process.pid}-${Date.now()}-fixture.mp4`);
fs.writeFileSync(videoPath, Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70]));

const rows: Record<string, Array<Record<string, any>>> = {social_accounts: [],posts: [],tenant_platform_apps: []};
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
    if (collection === 'durable_operation_leases' && (rows[collection] || []).some(row =>
      row.tenant_id === data.tenant_id && row.lease_scope === data.lease_scope && row.subject_id === data.subject_id)) return null;
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
  store.delete = (async (collection: string, id: string) => {
    const index = (rows[collection] || []).findIndex(row => row.id === id);
    if (index < 0) return false;
    rows[collection].splice(index, 1);
    return true;
  }) as typeof store.delete;
  rows.posts = [];
  rows.social_accounts.push({ id: 'instagram-account', tenantId: 'tenant-1', platform: 'instagram', providerAccountId: 'ig-user', accessToken: 'token', status: 'connected' });
  let containers = 0, submissions = 0, lookups = 0;
  axios.post = (async (url: string) => {
    if (url.endsWith('/media')) { containers++; return {data:{id:'ig-container'}}; }
    assert.ok(url.endsWith('/media_publish'));
    submissions++;
    throw new Error('controlled Instagram response lost after submission');
  }) as typeof axios.post;
  axios.get = (async () => ({data:{id:'ig-container',status_code:'FINISHED'}})) as typeof axios.get;
  const igSource = await freezePublishSourceClaim('tenant-1',{videoPath,sourceKind:'manual_upload'});
  const sourceHash = createHash('sha256').update(fs.readFileSync(videoPath)).digest('hex');
  assert.equal(igSource.sourceVideoPath,videoPath);
  assert.ok(igSource.sourceFingerprint);
  const instagramInput = {sourceClaim:igSource,tenantId:'tenant-1',accountId:'instagram-account',platform:'instagram',videoPath,videoUrl:'https://controlled.invalid/video.mp4',title:'Controlled Instagram recovery',privacyStatus:'public',contentId:'ig-content',trackWaLink:false,sourceKind:'manual_upload'} as const;
  await assert.rejects(publishVideoToAccount(instagramInput), /response lost/);
  assert.equal(rows.posts[0]?.stats?.publishResults?.['instagram-account']?.status,'unknown');
  await assert.rejects(publishVideoToAccount(instagramInput), /禁止重复提交/);
  assert.equal(containers,1);assert.equal(submissions,1);
  assert.equal(rows.posts[0]?.stats?.publishResults?.['instagram-account']?.providerReceiptId, 'ig-container:ig-container');
  axios.get = (async (url: string) => { lookups++; assert.ok(url.endsWith('/ig-container')); return { data: { id: 'ig-container', status_code: 'PUBLISHED' } }; }) as typeof axios.get;
  const containerRecovered = await resolvePendingPublishToAccount({tenantId:'tenant-1',accountId:'instagram-account',platform:'instagram',providerReceiptId:'ig-container:ig-container'});
  assert.equal(containerRecovered.status, 'unknown');
  assert.equal(containerRecovered.platformPostId, '');
  assert.equal(containers,1); assert.equal(submissions,1);
  lookups = 0;
  // An externally reconciled original receipt may be queried, never re-created.
  axios.get = (async (url: string) => {lookups++;assert.ok(url.endsWith('/ig-original-media'));return {data:{id:'ig-original-media',permalink:'https://instagram.invalid/reel/original',media_type:'VIDEO'}};}) as typeof axios.get;
  const recovered = await resolvePendingPublishToAccount({tenantId:'tenant-1',accountId:'instagram-account',platform:'instagram',providerReceiptId:'ig-original-media'});
  assert.equal(recovered.status,'published');assert.equal(recovered.platformPostId,'ig-original-media');
  assert.equal(lookups,1);assert.equal(containers,1);assert.equal(submissions,1);
  assert.equal(createHash('sha256').update(fs.readFileSync(videoPath)).digest('hex'),sourceHash);
} finally {
  store.supportsAtomicOperationLease = originalAtomicCapability;
  Object.assign(axios, originalAxios);
  Object.assign(store, originalStore);
  fs.rmSync(videoPath, { force: true });
}
console.log('controlled Instagram publication lost-response acceptance passed');
