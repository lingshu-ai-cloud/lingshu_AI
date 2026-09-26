import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { PostRecord } from './waLink.js';

export const EXTERNAL_VIDEO_APPROVAL_SCHEMA = 'external_video_approval.v1';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const object = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'string') {
    try { return object(JSON.parse(value) as unknown); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
};

export interface ExternalVideoApprovalSnapshot {
  schemaVersion: typeof EXTERNAL_VIDEO_APPROVAL_SCHEMA;
  origin: 'authorized_external_video';
  tenantId: string;
  platform: string;
  title: string;
  description: string;
  firstComment: string;
  videoPath: string;
  videoSha256: string;
  sourceFingerprint: string;
  scheduledAt: string;
  targetAccountIds: string[];
  trackWaLink: boolean;
}

export function externalVideoApprovalSnapshot(post: PostRecord): ExternalVideoApprovalSnapshot {
  const stats = object(post.stats);
  const sourceClaim = object(stats.publishSourceClaim);
  return {
    schemaVersion: EXTERNAL_VIDEO_APPROVAL_SCHEMA,
    origin: 'authorized_external_video',
    tenantId: text(post.tenant_id),
    platform: text(post.platform),
    title: text(post.title),
    description: text(stats.description),
    firstComment: text(stats.firstComment),
    videoPath: text(stats.videoPath),
    videoSha256: text(stats.videoSha256),
    sourceFingerprint: text(sourceClaim.sourceFingerprint),
    scheduledAt: text(post.published_at),
    targetAccountIds: Array.isArray(stats.targetAccountIds) ? stats.targetAccountIds.map(text).filter(Boolean) : [],
    trackWaLink: stats.trackWaLink === true,
  };
}

export function externalVideoApprovalHash(snapshot: ExternalVideoApprovalSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

export async function externalVideoSha256(videoPath: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of fs.createReadStream(videoPath)) digest.update(chunk);
  return digest.digest('hex');
}

export function externalVideoApprovalValid(post: PostRecord): boolean {
  const stats = object(post.stats);
  if (stats.origin !== 'authorized_external_video') return true;
  const snapshot = externalVideoApprovalSnapshot(post);
  return stats.externalApprovalStatus === 'approved'
    && text(stats.externalApprovedContentHash) === externalVideoApprovalHash(snapshot)
    && snapshot.sourceFingerprint.length === 64
    && snapshot.videoSha256.length === 64
    && snapshot.targetAccountIds.length > 0;
}
