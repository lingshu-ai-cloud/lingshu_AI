import path from 'node:path';
import { signAssetUrl } from '../lib/assetAccess.js';
import { localPublishingVideo } from './publishSourceClaim.js';
import type { PostRecord } from './waLink.js';

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function numberValue(value: unknown): number {
  const next = Number(value || 0);
  return Number.isFinite(next) ? next : 0;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return fallback;
}

export function publishingPreviewUrl(tenantId: string, videoPath: unknown): string {
  const localVideo = localPublishingVideo(tenantId, videoPath);
  if (!localVideo) return '';
  const route = `/api/overseas/publishing/local-videos/${encodeURIComponent(path.basename(localVideo))}`;
  return signAssetUrl(route, tenantId, 24 * 60 * 60 * 1000);
}

export function publicPost(post: PostRecord) {
  const stats = parseJson<Record<string, unknown>>(post.stats, {});
  return {
    id: post.id,
    tenantId: post.tenant_id,
    contentId: text(post.content_id),
    platform: text(post.platform),
    platformPostId: text(post.platform_post_id),
    title: text(post.title) || text(post.track_code),
    description: text(stats.description),
    publishedAt: text(post.published_at || post.created),
    trackCode: text(post.track_code),
    waLink: text(post.wa_link),
    stats,
    status: text(stats.status) || (post.platform_post_id ? 'published' : 'scheduled'),
    coverUrl: text(stats.coverUrl),
    videoUrl: text(stats.videoUrl || stats.mediaUrl || stats.url),
    duration: numberValue(stats.duration),
    firstComment: text(stats.firstComment),
    videoPath: text(stats.videoPath),
    imagePaths: Array.isArray(stats.imagePaths) ? stats.imagePaths.map(String).map(text).filter(Boolean) : [],
    videoPreviewUrl: publishingPreviewUrl(post.tenant_id, stats.videoPath) || text(stats.videoPreviewUrl),
    trackWaLink: stats.trackWaLink !== false,
    scheduleLocked: Boolean(stats.scheduleLocked),
    targetAccountIds: Array.isArray(stats.targetAccountIds) ? stats.targetAccountIds.map(String).map(text).filter(Boolean) : [],
    targetAccountLabels: Array.isArray(stats.targetAccountLabels) ? stats.targetAccountLabels.map(String).map(text).filter(Boolean) : [],
    warnings: Array.isArray(stats.warnings) ? stats.warnings : [],
    publishError: text(stats.publishError),
    publishAttempts: numberValue(stats.publishAttempts),
    nextPublishAttemptAt: text(stats.nextPublishAttemptAt),
    workflowRunId: text(stats.workflowRunId),
    workflowTaskId: text(stats.workflowTaskId),
    workflowTaskKey: text(stats.workflowTaskKey),
    enterpriseFactVersion: text(stats.enterpriseFactVersion),
    copyAudit: stats.copyAudit && typeof stats.copyAudit === 'object' ? stats.copyAudit : undefined,
    isRecycle: Boolean(stats.isRecycle),
    inquiries: numberValue(post.inquiries),
    deals: numberValue(post.deals),
  };
}

export function hasPublishedTargets(post: PostRecord): boolean {
  if (text(post.platform_post_id)) return true;
  const stats = parseJson<Record<string, unknown>>(post.stats, {});
  const results = stats.publishResults;
  if (!results || typeof results !== 'object' || Array.isArray(results)) return false;
  return Object.values(results).some(result => Boolean(result && typeof result === 'object' && text((result as Record<string, unknown>).status) === 'published'));
}
