import assert from 'node:assert/strict';
import {
  asTikTokPreflightFailure,
  instagramPublishedMediaId,
  normalizeTikTokPublishStatus,
  tikTokUploadPlan,
  waitForTikTokPublishComplete,
} from './social.js';
import { youtubeRefreshTokenRequest } from './youtube.js';

const youtubeRefresh = youtubeRefreshTokenRequest({
  clientId: 'client id',
  clientSecret: 'client&secret',
  refreshToken: 'refresh+token',
}, { timeoutMs: 10 * 60_000 });
assert.equal(youtubeRefresh.timeoutMs, 30_000);
assert.equal(new URLSearchParams(youtubeRefresh.body).get('grant_type'), 'refresh_token');
assert.equal(new URLSearchParams(youtubeRefresh.body).get('client_secret'), 'client&secret');

assert.deepEqual(tikTokUploadPlan(64 * 1024 * 1024), {
  chunkSize: 64 * 1024 * 1024,
  totalChunkCount: 1,
});
assert.deepEqual(tikTokUploadPlan(65 * 1024 * 1024), {
  chunkSize: 32 * 1024 * 1024,
  totalChunkCount: 2,
});
assert.deepEqual(tikTokUploadPlan(128 * 1024 * 1024), {
  chunkSize: 64 * 1024 * 1024,
  totalChunkCount: 2,
});
assert.throws(() => tikTokUploadPlan(0), /tiktok_video_size_invalid/);

const preflightFailure = asTikTokPreflightFailure(Object.assign(new Error('creator info timeout'), { code: 'ETIMEDOUT' }));
assert.deepEqual((preflightFailure as Error & { publishFailureClassification?: unknown }).publishFailureClassification, {
  disposition: 'definitive_rejection',
  outcomeUnknown: false,
  retrySafe: true,
  statusCode: null,
  reason: 'provider_preflight',
});

assert.equal(instagramPublishedMediaId({ id: 'ig-media-1' }, 'ig-container-1'), 'ig-media-1');
assert.throws(
  () => instagramPublishedMediaId({}, 'ig-container-unknown'),
  (error: unknown) => {
    const candidate = error as {
      providerOperationId?: string;
      publishFailureClassification?: { outcomeUnknown?: boolean; retrySafe?: boolean };
    };
    assert.equal(candidate.providerOperationId, 'ig-container-unknown');
    assert.equal(candidate.publishFailureClassification?.outcomeUnknown, true);
    assert.equal(candidate.publishFailureClassification?.retrySafe, false);
    return true;
  },
);

assert.deepEqual(normalizeTikTokPublishStatus({
  data: {
    status: 'PUBLISH_COMPLETE',
    publicaly_available_post_id: ['post-1'],
  },
  error: { code: 'ok' },
}), {
  status: 'PUBLISH_COMPLETE',
  failReason: '',
  publicPostIds: ['post-1'],
});

{
  let clock = 0;
  const responses = [
    { data: { status: 'PROCESSING_UPLOAD' }, error: { code: 'ok' } },
    { data: { status: 'PROCESSING_DOWNLOAD' }, error: { code: 'ok' } },
    { data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['public-post-9'] }, error: { code: 'ok' } },
  ];
  const publicPostId = await waitForTikTokPublishComplete({
    accessToken: 'token', publishId: 'publish-op-9', deadlineMs: 20_000,
  }, {
    now: () => clock,
    fetchStatus: async () => responses.shift(),
    sleep: async ms => { clock += ms; },
    pollIntervalMs: 2_000,
  });
  assert.equal(publicPostId, 'public-post-9');
  assert.equal(clock, 4_000);
}

assert.equal(await waitForTikTokPublishComplete({
  accessToken: 'token',
  publishId: 'private-publish-op',
  deadlineMs: 5_000,
  publicPostIdRequired: false,
}, {
  now: () => 0,
  fetchStatus: async () => ({ data: { status: 'PUBLISH_COMPLETE' }, error: { code: 'ok' } }),
}), 'tiktok-publish:private-publish-op', 'non-public posts complete without a public post id');

await assert.rejects(
  waitForTikTokPublishComplete({
    accessToken: 'token', publishId: 'publish-op-failed', deadlineMs: 20_000,
  }, {
    now: () => 0,
    fetchStatus: async () => ({
      data: { status: 'FAILED', fail_reason: 'spam_risk' }, error: { code: 'ok' },
    }),
  }),
  (error: unknown) => {
    const candidate = error as {
      statusCode?: number;
      providerOperationId?: string;
      publishFailureClassification?: { outcomeUnknown?: boolean };
    };
    assert.equal(candidate.statusCode, 422);
    assert.equal(candidate.providerOperationId, 'publish-op-failed');
    assert.equal(candidate.publishFailureClassification?.outcomeUnknown, false);
    return true;
  },
);

{
  let clock = 0;
  await assert.rejects(
    waitForTikTokPublishComplete({
      accessToken: 'token', publishId: 'publish-op-timeout', deadlineMs: 5_000,
    }, {
      now: () => clock,
      fetchStatus: async () => ({ data: { status: 'PROCESSING_UPLOAD' }, error: { code: 'ok' } }),
      sleep: async ms => { clock += ms; },
      pollIntervalMs: 2_000,
    }),
    (error: unknown) => {
      const candidate = error as {
        providerOperationId?: string;
        publishFailureClassification?: { outcomeUnknown?: boolean; retrySafe?: boolean };
      };
      assert.equal(candidate.providerOperationId, 'publish-op-timeout');
      assert.equal(candidate.publishFailureClassification?.outcomeUnknown, true);
      assert.equal(candidate.publishFailureClassification?.retrySafe, false);
      return true;
    },
  );
}

await assert.rejects(
  waitForTikTokPublishComplete({
    accessToken: 'token', publishId: 'publish-op-query-error', deadlineMs: 5_000,
  }, {
    now: () => 0,
    fetchStatus: async () => ({ error: { code: 'access_token_invalid', message: 'expired' } }),
  }),
  (error: unknown) => {
    const candidate = error as { providerOperationId?: string; publishFailureClassification?: { outcomeUnknown?: boolean } };
    assert.equal(candidate.providerOperationId, 'publish-op-query-error');
    assert.equal(candidate.publishFailureClassification?.outcomeUnknown, true);
    return true;
  },
);

console.log('social publish completion tests passed');
