import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { externalVideoApprovalHash, externalVideoApprovalSnapshot, externalVideoApprovalValid, externalVideoSha256 } from './externalVideoApproval.js';
import { isScheduledPostDue } from './scheduledPublisher.js';
import type { PostRecord } from './waLink.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'external-video-approval-'));
try {
  const videoPath = path.join(root, 'manual-test.mp4');
  fs.writeFileSync(videoPath, 'approved-video');
  const videoSha256 = await externalVideoSha256(videoPath);
  const post: PostRecord = {
    id: 'approval-1', tenant_id: 'tenant-a', platform: 'youtube', title: 'Approved title',
    published_at: '2026-09-26T08:00:00.000Z', track_code: 'V1001',
    stats: {
      origin: 'authorized_external_video', status: 'awaiting_approval',
      description: 'Approved copy', firstComment: '', videoPath, videoSha256,
      publishSourceClaim: { sourceFingerprint: 'a'.repeat(64) },
      targetAccountIds: ['account-a'], trackWaLink: false,
    },
  };
  const stats = post.stats!;
  const contentHash = externalVideoApprovalHash(externalVideoApprovalSnapshot(post));
  assert.equal(isScheduledPostDue(post, Date.parse('2026-09-26T09:00:00.000Z')), false, 'unapproved external video must not enter the worker');
  stats.externalApprovalStatus = 'approved';
  stats.externalApprovedContentHash = contentHash;
  stats.status = 'scheduled';
  assert.equal(externalVideoApprovalValid(post), true);
  assert.equal(externalVideoApprovalValid({ ...post, stats: JSON.stringify(stats) as unknown as PostRecord['stats'] }), true,
    'PocketBase JSON text representation must preserve approval validity');
  assert.equal(isScheduledPostDue(post, Date.parse('2026-09-26T09:00:00.000Z')), true);
  for (const tamper of [
    { title: 'Changed title' }, { published_at: '2026-09-26T08:01:00.000Z' },
    { stats: { ...stats, targetAccountIds: ['account-b'] } },
    { stats: { ...stats, description: 'Changed copy' } },
    { stats: { ...stats, videoPath: '/tmp/replacement.mp4' } },
    { stats: { ...stats, videoSha256: 'b'.repeat(64) } },
  ]) {
    const changed = { ...post, ...tamper } as PostRecord;
    assert.equal(isScheduledPostDue(changed, Date.parse('2026-09-26T09:00:00.000Z')), false,
      `approved snapshot must reject modified ${Object.keys(tamper).join(',')}`);
  }
  fs.writeFileSync(videoPath, 'swapped-video');
  assert.notEqual(await externalVideoSha256(videoPath), videoSha256, 'replaced bytes must fail the provider-boundary SHA256 check');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('external video approval snapshot tests passed');
