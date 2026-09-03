import assert from 'node:assert/strict';
import {
  schedulePayloadHash,
  validateScheduledTikTokPublishOptions,
  verifyApprovedScheduledPost,
  type SchedulePostInput,
} from './scheduleService.js';

const tiktokOptions = {
  privacyLevel: 'SELF_ONLY' as const,
  allowComment: false,
  allowDuet: false,
  allowStitch: false,
  brandContentToggle: false,
  brandOrganicToggle: false,
  isAigc: false,
  userConsent: true,
};

const input: SchedulePostInput = {
  tenantId: 'tenant-a', contentId: 'project-a', platform: 'tiktok', title: 'Approved title',
  scheduledAt: '2026-09-04T09:00:00.000Z', language: 'en', coverUrl: 'https://cdn.example/cover.jpg',
  description: 'Approved description', firstComment: 'Approved first comment', videoPath: '/safe/video.mp4',
  videoSha256: 'a'.repeat(64),
  targetAccountIds: ['account-b', 'account-a'], trackWaLink: true, scheduleLocked: true, source: 'digital_employee',
  tiktokPublishOptionsByAccount: { 'account-b': tiktokOptions, 'account-a': tiktokOptions },
  runId: 'run-a', approvalId: 'approval-a', approvedActionHash: 'c'.repeat(64), runRevision: 7, approvalRevision: 3, fenceRevision: 0,
};
const approvedHash = schedulePayloadHash(input);
assert.equal(schedulePayloadHash({ ...input, targetAccountIds: [...input.targetAccountIds].reverse() }), approvedHash, 'account ordering must not change an exact approval');
assert.equal(schedulePayloadHash({
  ...input,
  tiktokPublishOptionsByAccount: { 'account-a': tiktokOptions, 'account-b': tiktokOptions },
}), approvedHash, 'TikTok option map insertion order must not change an exact approval');
assert.notEqual(schedulePayloadHash({
  ...input,
  tiktokPublishOptionsByAccount: {
    ...input.tiktokPublishOptionsByAccount,
    'account-a': { ...tiktokOptions, allowComment: true },
  },
}), approvedHash, 'every TikTok disclosure and interaction choice must be approval-bound');
assert.deepEqual(validateScheduledTikTokPublishOptions({
  platform: 'tiktok', targetAccountIds: ['account-a'], value: { 'account-a': tiktokOptions }, audited: false,
}), { 'account-a': tiktokOptions });
assert.throws(() => validateScheduledTikTokPublishOptions({
  platform: 'tiktok', targetAccountIds: ['account-a'], value: {
    'account-a': { ...tiktokOptions, privacyLevel: 'PUBLIC_TO_EVERYONE' },
  }, audited: false,
}), /tiktok_unaudited_self_only_required/);
assert.throws(() => validateScheduledTikTokPublishOptions({
  platform: 'tiktok', targetAccountIds: ['account-a'], value: {
    'account-a': { ...tiktokOptions, userConsent: false },
  }, audited: true,
}), /tiktok_user_consent_required/);

const post = {
  id: 'post-a', tenant_id: input.tenantId, content_id: input.contentId, platform: input.platform,
  title: input.title, published_at: input.scheduledAt, track_code: 'V1000',
  digital_employee_run_id: input.runId, digital_employee_approval_id: input.approvalId,
  digital_employee_action_hash: input.approvedActionHash, digital_employee_fence_revision: 0,
  stats: {
    status: 'scheduled', language: input.language, coverUrl: input.coverUrl, description: input.description,
    firstComment: input.firstComment, videoPath: input.videoPath, videoUrl: '', videoSha256: input.videoSha256, targetAccountIds: input.targetAccountIds,
    tiktokPublishOptionsByAccount: input.tiktokPublishOptionsByAccount,
    trackWaLink: true, scheduleLocked: true, source: 'digital_employee', schedulePayloadHash: approvedHash,
    approvedPayloadHash: approvedHash, approvalId: input.approvalId, approvedActionHash: input.approvedActionHash,
    runRevision: input.runRevision, approvalRevision: input.approvalRevision, approvedFenceRevision: 0, authorizedFenceRevision: 0,
  },
};
assert.equal(verifyApprovedScheduledPost(post).ok, true);
assert.equal(verifyApprovedScheduledPost({ ...post, title: 'Tampered title' }).ok, false);
assert.equal(verifyApprovedScheduledPost({ ...post, published_at: '2026-09-05T09:00:00.000Z' }).ok, false);
assert.equal(verifyApprovedScheduledPost({ ...post, stats: { ...post.stats, targetAccountIds: ['attacker-account'] } }).ok, false);
assert.equal(verifyApprovedScheduledPost({ ...post, stats: { ...post.stats, description: 'Tampered copy' } }).ok, false);
assert.equal(verifyApprovedScheduledPost({ ...post, stats: { ...post.stats, tiktokPublishOptionsByAccount: {} } }).ok, false);
assert.equal(verifyApprovedScheduledPost({ ...post, stats: { ...post.stats, videoSha256: 'b'.repeat(64) } }).ok, false);
assert.equal(verifyApprovedScheduledPost({ ...post, digital_employee_run_id: 'run-attacker' }).ok, false);
assert.equal(verifyApprovedScheduledPost({ ...post, digital_employee_action_hash: 'd'.repeat(64) }).ok, false);

console.log('approved schedule integrity tests passed');
