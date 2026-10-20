import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { AxiosInstance } from 'axios';
import {
  exchangeLinkedInCode,
  getLinkedInComments,
  getLinkedInPost,
  getLinkedInPostMetrics,
  linkedInAuthorUrn,
  linkedInOAuthScopes,
  linkedInRequiredPublishingScope,
  publishLinkedInImages,
  publishLinkedInVideo,
} from './linkedin.js';

test('LinkedIn identity and publishing scope distinguish people from organizations', () => {
  assert.equal(linkedInAuthorUrn({ providerAccountId: 'member-123' }), 'urn:li:person:member-123');
  assert.equal(linkedInRequiredPublishingScope({ providerAccountId: 'member-123' }), 'w_member_social');
  assert.equal(
    linkedInAuthorUrn({ providerAccountId: 'member-123', parentPageId: 'urn:li:organization:456' }),
    'urn:li:organization:456',
  );
  assert.equal(
    linkedInRequiredPublishingScope({ providerAccountId: 'member-123', parentPageId: 'urn:li:organization:456' }),
    'w_organization_social',
  );
  assert.deepEqual(linkedInOAuthScopes({} as NodeJS.ProcessEnv), ['openid', 'profile', 'email', 'w_member_social']);
  const memberReadScopes = linkedInOAuthScopes({ LINKEDIN_MEMBER_READ_ENABLED: 'true' } as NodeJS.ProcessEnv);
  assert.ok(memberReadScopes.includes('r_member_social'));
  assert.ok(memberReadScopes.includes('r_member_social_feed'));
  const organizationScopes = linkedInOAuthScopes({ LINKEDIN_ORGANIZATION_PUBLISHING_ENABLED: 'true' } as NodeJS.ProcessEnv);
  assert.ok(organizationScopes.includes('rw_organization_admin'));
  assert.ok(organizationScopes.includes('r_organization_social_feed'));
});

test('LinkedIn image publishing uploads approved images and persists one post receipt', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'linkedin-images-'));
  const imagePaths = [path.join(directory, 'one.jpg'), path.join(directory, 'two.png')];
  imagePaths.forEach((imagePath, index) => fs.writeFileSync(imagePath, Buffer.alloc(1_024 + index, index + 1)));
  const postId = 'urn:li:share:987654';
  let initialized = 0;
  const publishedBodies: Array<Record<string, any>> = [];
  const http = {
    async post(url: string, body: Record<string, any>) {
      if (url.endsWith('/rest/images?action=initializeUpload')) {
        initialized += 1;
        return { data: { value: { image: `urn:li:image:image-${initialized}`, uploadUrl: `https://upload.example.test/image-${initialized}` } } };
      }
      publishedBodies.push(body);
      return { data: {}, headers: { 'x-restli-id': postId } };
    },
    async put() { return { data: {} }; },
  } as unknown as AxiosInstance;
  try {
    let receipt = '';
    const result = await publishLinkedInImages({
      accessToken: 'access', account: { providerAccountId: 'member-123' }, imagePaths,
      title: 'Factory proof', commentary: 'Same approved caption #OEM', http,
      async onProviderReceipt(value) { receipt = value; },
    });
    assert.equal(initialized, 2);
    assert.equal(result.imageUrns.length, 2);
    assert.equal(receipt, postId);
    assert.deepEqual(publishedBodies[0]?.content.multiImage.images.map((item: { id: string }) => item.id), ['urn:li:image:image-1', 'urn:li:image:image-2']);
    assert.equal(publishedBodies[0]?.commentary, 'Same approved caption #OEM');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('LinkedIn registered-post metrics and comments normalize provider evidence', async () => {
  const postId = 'urn:li:ugcPost:123';
  const http = {
    async get(url: string) {
      if (url.endsWith('/comments')) return { data: { elements: [{ id: 'comment-1', actor: 'urn:li:person:1', message: { text: 'Interested' }, likesSummary: { totalLikes: 2 }, created: { time: 1_760_000_000_000 } }] } };
      assert.match(url, /\/rest\/socialMetadata\//);
      return { data: { entity: postId, reactionSummaries: { LIKE: { count: 4 } }, commentSummary: { count: 1 } } };
    },
  } as unknown as AxiosInstance;
  const metrics = await getLinkedInPostMetrics({ accessToken: 'access', postId, http });
  assert.deepEqual(metrics, { likes: 4, comments: 1 });
  const comments = await getLinkedInComments({ accessToken: 'access', postId, http });
  assert.equal(comments[0]?.textDisplay, 'Interested');
  assert.equal(comments[0]?.postId, postId);
});

test('LinkedIn organization metrics merge official share statistics for the exact registered post', async () => {
  const postId = 'urn:li:share:456';
  const http = {
    async get(url: string, config?: { params?: Record<string, string> }) {
      if (url.includes('/rest/socialMetadata/')) {
        return { data: { entity: postId, reactionSummaries: { LIKE: { count: 2 } }, commentSummary: { count: 1 } } };
      }
      assert.match(url, /organizationalEntityShareStatistics$/);
      assert.equal(config?.params?.organizationalEntity, 'urn:li:organization:99');
      assert.equal(config?.params?.shares, `List(${postId})`);
      return { data: { elements: [{ share: postId, totalShareStatistics: {
        impressionCount: 120, uniqueImpressionsCount: 90, likeCount: 5, commentCount: 3, shareCount: 4, clickCount: 8,
      } }] } };
    },
  } as unknown as AxiosInstance;
  const metrics = await getLinkedInPostMetrics({
    accessToken: 'access', postId, authorUrn: 'urn:li:organization:99', http,
  });
  assert.deepEqual(metrics, { views: 120, impressions: 90, likes: 5, comments: 3, shares: 4, clicks: 8 });
});

test('LinkedIn OAuth exchange sends the exact authorization-code contract', async () => {
  let request = '';
  const http = {
    async post(url: string, body: string) {
      request = `${url}?${body}`;
      return { data: { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'openid w_member_social' } };
    },
  } as unknown as AxiosInstance;
  const tokens = await exchangeLinkedInCode({
    clientId: 'client', clientSecret: 'secret', code: 'code', redirectUri: 'https://example.test/callback', http,
  });
  assert.equal(tokens.accessToken, 'access');
  assert.equal(tokens.scope, 'openid w_member_social');
  assert.match(request, /^https:\/\/www\.linkedin\.com\/oauth\/v2\/accessToken\?/);
  assert.match(request, /grant_type=authorization_code/);
  assert.match(request, /redirect_uri=https%3A%2F%2Fexample\.test%2Fcallback/);
});

test('LinkedIn MP4 upload persists the real post receipt and can reconcile it', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'linkedin-publish-'));
  const filePath = path.join(directory, 'video.mp4');
  fs.writeFileSync(filePath, Buffer.alloc(80 * 1024, 7));
  const calls: string[] = [];
  const postId = 'urn:li:share:123456';
  const http = {
    async post(url: string, body: Record<string, unknown>) {
      calls.push(`POST ${url}`);
      if (url.endsWith('/rest/videos?action=initializeUpload')) {
        return { data: { value: { video: 'urn:li:video:abc', uploadToken: 'token', uploadInstructions: [{ firstByte: 0, lastByte: 80 * 1024 - 1, uploadUrl: 'https://upload.example.test/part' }] } } };
      }
      if (url.endsWith('/rest/videos?action=finalizeUpload')) {
        assert.deepEqual(body, { finalizeUploadRequest: { video: 'urn:li:video:abc', uploadToken: 'token', uploadedPartIds: ['etag-1'] } });
        return { data: {} };
      }
      assert.equal(url, 'https://api.linkedin.com/rest/posts');
      assert.equal(body.author, 'urn:li:person:member-123');
      return { data: {}, headers: { 'x-restli-id': postId } };
    },
    async put(url: string, body: Buffer) {
      calls.push(`PUT ${url}`);
      assert.equal(body.byteLength, 80 * 1024);
      return { data: {}, headers: { etag: '"etag-1"' } };
    },
    async get(url: string) {
      calls.push(`GET ${url}`);
      return { data: { id: postId, author: 'urn:li:person:member-123', lifecycleState: 'PUBLISHED' } };
    },
  } as unknown as AxiosInstance;
  try {
    let savedReceipt = '';
    const published = await publishLinkedInVideo({
      accessToken: 'access', account: { providerAccountId: 'member-123' }, filePath,
      title: 'Product demo', commentary: 'Verified product footage.', http,
      async onProviderReceipt(receipt) { savedReceipt = receipt; },
    });
    assert.equal(published.providerReceiptId, postId);
    assert.equal(savedReceipt, postId);
    assert.equal(published.url, `https://www.linkedin.com/feed/update/${postId}`);
    const reconciled = await getLinkedInPost({ accessToken: 'access', postId, http });
    assert.deepEqual(reconciled, {
      id: postId, author: 'urn:li:person:member-123', lifecycleState: 'PUBLISHED',
      url: `https://www.linkedin.com/feed/update/${postId}`,
    });
    assert.equal(calls.filter(call => call.startsWith('PUT ')).length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
