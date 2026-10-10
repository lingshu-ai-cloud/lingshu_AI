import { execFileSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { store } from '../storage/index.js';
import { socialUploadHttpResponse } from '../routes/social.js';
import { publishVideoToAccount, resolvePendingPublishToAccount, readTikTokCanonicalAttemptReceipt } from './platformPublisher.js';
import { publishingUploadDir } from './publishSourceClaim.js';

const originalAxios = { post: axios.post, put: axios.put, get: axios.get };
const originalTikTokReleaseMode = process.env.TIKTOK_DIRECT_POST_RELEASE_MODE;
process.env.TIKTOK_DIRECT_POST_RELEASE_MODE = 'approved';
const originalStore = {
  supportsAtomicOperationLease: store.supportsAtomicOperationLease,
  list: store.list,
  getById: store.getById,
  create: store.create,
  update: store.update,
  delete: store.delete,
};
const temporaryRoot = publishingUploadDir('tenant-1');
fs.mkdirSync(temporaryRoot, { recursive: true });
const videoPath = path.join(temporaryRoot, `manual-${process.pid}-${Date.now()}-fixture.mp4`);
execFileSync(String(ffmpegStatic), ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=64x64:d=1','-c:v','libx264','-pix_fmt','yuv420p','-y',videoPath]);

const rows: Record<string, Array<Record<string, any>>> = {
  social_accounts: [{
    id: 'tiktok-account', tenantId: 'tenant-1', platform: 'tiktok',
    providerAccountId: 'open-id', accessToken: 'token', status: 'connected', scope: 'user.info.basic video.publish',
  }],
  posts: [],
  tenant_platform_apps: [],
};
let uploadCalls = 0;
let initCalls = 0;
let providerStatus = 'PROCESSING_UPLOAD';
let uploadEntered!: () => void;
let releaseUpload!: () => void;
const uploadStarted = new Promise<void>(resolve => { uploadEntered = resolve; });
const uploadGate = new Promise<void>(resolve => { releaseUpload = resolve; });
try {
  // The controlled store below arbitrates the tenant/scope/subject unique key.
  store.supportsAtomicOperationLease = () => true;
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
  axios.get = (async () => ({ data: { data: { user: { open_id: 'open-id', display_name: 'Controlled' } }, error: { code: 'ok' } } })) as typeof axios.get;
  axios.post = (async (url: string) => {
    if (url.endsWith('/creator_info/query/')) return { data: { data: {creator_username:'controlled',creator_nickname:'Controlled',privacy_level_options:['PUBLIC_TO_EVERYONE'],comment_disabled:true,duet_disabled:true,stitch_disabled:true,max_video_post_duration_sec:60}, error:{code:'ok'} } };
    if (url.endsWith('/video/init/')) return (initCalls++, {data:{data:{upload_url:'https://open-upload.tiktokapis.com/one',publish_id:'publish-receipt-1'},error:{code:'ok'}}});
    return {data:{data:{status:providerStatus,publicaly_available_post_id:providerStatus==='PUBLISH_COMPLETE'?['public-post-1']:[]},error:{code:'ok'}}};
  }) as typeof axios.post;
  axios.put = (async (_url: string, body: AsyncIterable<unknown>) => {
    uploadEntered();
    await uploadGate;
    for await (const _chunk of body) { /* consume mocked upload */ }
    uploadCalls += 1;
    return { data: {} };
  }) as typeof axios.put;

  const publishInput = {
    tenantId: 'tenant-1',
    accountId: 'tiktok-account',
    platform: 'tiktok',
    videoPath,
    title: 'Async TikTok fixture',
    privacyStatus: 'public',
    tiktokPostOptions: {privacyLevel:'PUBLIC_TO_EVERYONE',allowComment:false,allowDuet:false,allowStitch:false,commercial:{ownBrand:false,brandedContent:false},isAigc:false,musicUsageConfirmed:true,userConsent:true},
    contentId: 'content-1',
    trackWaLink: false,
    sourceKind: 'manual_upload',
  } as const;
  const firstPublish = publishVideoToAccount(publishInput);
  await uploadStarted;
  await assert.rejects(
    publishVideoToAccount({ ...publishInput, title: 'Concurrent duplicate' }),
    /禁止重复提交/,
    'the durable content/account lease must reject a simultaneous direct publish',
  );
  assert.equal(initCalls, 1, 'the losing request must be fenced before a provider call');
  releaseUpload();
  const accepted = await firstPublish;
  assert.equal(accepted.deliveryStatus, 'provider_accepted');
  assert.equal(accepted.platformPostId, '');
  assert.equal(accepted.publishRecord, null);
  assert.equal((accepted.tracking.stats as any).status, 'provider_processing');
  assert.equal((accepted.tracking.stats as any).publishResults['tiktok-account'].providerReceiptId, 'publish-receipt-1');
  assert.equal(rows.posts[0]?.platform_post_id, '', 'provider init must not finalize local tracking');
  const originalAttemptId = String(rows.posts[0]?.stats?.publishResults?.['tiktok-account']?.attemptId);
  assert.equal(await readTikTokCanonicalAttemptReceipt({tenantId:'tenant-1',accountId:'tiktok-account',attemptId:originalAttemptId}), 'publish-receipt-1');
  assert.equal(await readTikTokCanonicalAttemptReceipt({tenantId:'tenant-other',accountId:'tiktok-account',attemptId:originalAttemptId}), null);
  assert.equal(await readTikTokCanonicalAttemptReceipt({tenantId:'tenant-1',accountId:'tiktok-account',attemptId:'different-attempt'}), null);
  rows.social_accounts[0]!.accessToken = 'changed-token';
  assert.equal(await readTikTokCanonicalAttemptReceipt({tenantId:'tenant-1',accountId:'tiktok-account',attemptId:originalAttemptId}), null);
  rows.social_accounts[0]!.accessToken = 'token';
  const canonicalSnapshot = structuredClone(rows.posts[0]!);
  rows.posts.push({...structuredClone(canonicalSnapshot),id:'duplicate-canonical'});
  assert.equal(await readTikTokCanonicalAttemptReceipt({tenantId:'tenant-1',accountId:'tiktok-account',attemptId:originalAttemptId}), null);
  rows.posts.pop();
  const canonicalAttempt = rows.posts[0]?.stats?.publishResults?.['tiktok-account'];
  const savedReceipt = canonicalAttempt.providerReceiptId;
  delete canonicalAttempt.providerReceiptId;
  assert.equal(await readTikTokCanonicalAttemptReceipt({tenantId:'tenant-1',accountId:'tiktok-account',attemptId:originalAttemptId}), null);
  canonicalAttempt.providerReceiptId = savedReceipt;


  const acceptedHttp = socialUploadHttpResponse(accepted);
  assert.equal(acceptedHttp.statusCode, 202, 'provider acceptance is an asynchronous HTTP result, not created/published');
  assert.equal(acceptedHttp.body.deliveryStatus, 'provider_accepted');
  assert.equal(acceptedHttp.body.providerReceiptId, 'publish-receipt-1');
  assert.equal(acceptedHttp.body.platformPostId, '');
  assert.equal(acceptedHttp.body.publishRecord, null);
  assert.throws(() => socialUploadHttpResponse({ ...accepted, providerReceiptId: undefined }), /可追踪回执/);

  const publishedHttp = socialUploadHttpResponse({
    ...accepted,
    deliveryStatus: 'published',
    platformPostId: 'public-post-1',
  });
  assert.equal(publishedHttp.statusCode, 201);
  assert.equal(publishedHttp.body.deliveryStatus, 'published');
  assert.equal(publishedHttp.body.platformPostId, 'public-post-1');

  await assert.rejects(() => publishVideoToAccount({
    tenantId: 'tenant-1',
    accountId: 'tiktok-account',
    platform: 'tiktok',
    videoPath,
    title: 'Duplicate attempt',
    privacyStatus: 'public',
    contentId: 'content-1',
    trackWaLink: false,
    sourceKind: 'manual_upload',
  }), /禁止重复提交/);
  assert.equal(uploadCalls, 1, 'an unresolved provider receipt prevents a duplicate upload');
  assert.equal(initCalls, 1);

  providerStatus = 'PUBLISH_COMPLETE';
  const resolved = await resolvePendingPublishToAccount({
    tenantId: 'tenant-1',
    accountId: 'tiktok-account',
    platform: 'tiktok',
    providerReceiptId: 'publish-receipt-1',
  });
  assert.equal(resolved.status, 'published');
  assert.equal(resolved.platformPostId, 'public-post-1');

  rows.posts = [];
  rows.youtube_accounts = [{
    id: 'youtube-account', tenantId: 'tenant-1', clientId: 'client', clientSecret: 'secret',
    accessToken: 'access-token', refreshToken: '', status: 'connected',
  }];
  let youtubeInitCalls = 0;
  let youtubeUploadCalls = 0;
  axios.post = (async (url: string) => {
    assert.match(url, /googleapis\.com\/upload\/youtube/);
    youtubeInitCalls += 1;
    return { headers: { location: 'https://upload.youtube.invalid/session' } };
  }) as typeof axios.post;
  axios.put = (async (_url: string, body: AsyncIterable<unknown>) => {
    for await (const _chunk of body) { /* provider accepted bytes before the connection reset */ }
    youtubeUploadCalls += 1;
    throw new Error('simulated connection reset after upload submission');
  }) as typeof axios.put;
  const youtubeInput = {
    tenantId: 'tenant-1', accountId: 'youtube-account', platform: 'youtube', videoPath,
    title: 'YouTube uncertain fixture', privacyStatus: 'public', contentId: 'youtube-content', trackWaLink: false,
    sourceKind: 'manual_upload',
  } as const;
  await assert.rejects(publishVideoToAccount(youtubeInput), /simulated connection reset/);
  const youtubePost = rows.posts[0];
  assert.equal(youtubePost?.stats?.status, 'needs_attention');
  assert.equal(youtubePost?.stats?.publishResults?.['youtube-account']?.status, 'unknown');
  await assert.rejects(
    publishVideoToAccount({ ...youtubeInput, title: 'YouTube blind retry' }),
    /禁止重复提交/,
    'an uncertain YouTube upload must be persisted and block a blind retry',
  );
  assert.equal(youtubeInitCalls, 1);
  assert.equal(youtubeUploadCalls, 1);
} finally {
  if (originalTikTokReleaseMode === undefined) delete process.env.TIKTOK_DIRECT_POST_RELEASE_MODE;
  else process.env.TIKTOK_DIRECT_POST_RELEASE_MODE = originalTikTokReleaseMode;
  Object.assign(axios, originalAxios);
  Object.assign(store, originalStore);
  fs.rmSync(videoPath, { force: true });
}

console.log('platform publisher concurrency and terminal-state tests passed');
