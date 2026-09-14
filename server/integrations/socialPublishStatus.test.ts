import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { getTikTokPublishStatus, uploadTikTokVideo } from './social.js';

const originalPost = axios.post;
const originalPut = axios.put;
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-tiktok-status-'));
const videoPath = path.join(temporaryRoot, 'fixture.mp4');
fs.writeFileSync(videoPath, Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70]));

let providerStatus = 'PROCESSING_UPLOAD';
let providerPostIds: string[] = [];
let uploadCalls = 0;
try {
  axios.post = (async (url: string, body: unknown) => {
    if (url.endsWith('/video/init/')) {
      return { data: { data: { upload_url: 'https://upload.invalid/one', publish_id: 'publish-receipt-1' } } };
    }
    assert.equal(url.endsWith('/status/fetch/'), true);
    assert.deepEqual(body, { publish_id: 'publish-receipt-1' });
    return {
      data: {
        data: {
          status: providerStatus,
          publicaly_available_post_id: providerPostIds,
          fail_reason: providerStatus === 'FAILED' ? 'provider rejected media' : '',
        },
      },
    };
  }) as typeof axios.post;
  axios.put = (async (_url: string, body: AsyncIterable<unknown>) => {
    for await (const _chunk of body) { /* consume the mocked upload stream */ }
    uploadCalls += 1;
    return { data: {} };
  }) as typeof axios.put;

  const accepted = await uploadTikTokVideo('token', {
    filePath: videoPath,
    title: 'truthful async upload',
    privacyStatus: 'public',
  });
  assert.equal(uploadCalls, 1);
  assert.equal(accepted.deliveryStatus, 'provider_accepted');
  assert.equal(accepted.providerReceiptId, 'publish-receipt-1');
  assert.equal(accepted.id, '', 'an asynchronous publish id must not masquerade as a public post id');

  const processing = await getTikTokPublishStatus('token', 'publish-receipt-1');
  assert.equal(processing.state, 'processing');
  assert.equal(processing.platformPostId, '');

  providerStatus = 'PUBLISH_COMPLETE';
  const completeWithoutPost = await getTikTokPublishStatus('token', 'publish-receipt-1');
  assert.equal(completeWithoutPost.state, 'unknown', 'completion without a public post id must fail closed');

  providerPostIds = ['public-post-1'];
  const published = await getTikTokPublishStatus('token', 'publish-receipt-1');
  assert.equal(published.state, 'published');
  assert.equal(published.platformPostId, 'public-post-1');

  providerStatus = 'FAILED';
  providerPostIds = [];
  const failed = await getTikTokPublishStatus('token', 'publish-receipt-1');
  assert.equal(failed.state, 'failed');
  assert.equal(failed.failureReason, 'provider rejected media');
} finally {
  axios.post = originalPost;
  axios.put = originalPut;
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log('TikTok asynchronous publish status tests passed');
