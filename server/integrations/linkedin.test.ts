import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { AxiosInstance } from 'axios';
import {
  exchangeLinkedInCode,
  getLinkedInPost,
  linkedInAuthorUrn,
  linkedInOAuthScopes,
  linkedInRequiredPublishingScope,
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
  assert.ok(linkedInOAuthScopes({ LINKEDIN_MEMBER_READ_ENABLED: 'true' } as NodeJS.ProcessEnv).includes('r_member_social'));
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
