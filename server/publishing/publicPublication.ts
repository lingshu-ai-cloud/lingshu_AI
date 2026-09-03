import type { SocialPublishRecord } from '../lib/publishHistory.js';
import { publishingVideoReference } from './localVideoSecurity.js';
import type { PostRecord } from './waLink.js';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function object(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch { return {}; }
  }
  return {};
}

function publicPublishResults(value: unknown): Record<string, unknown> {
  const results = object(value);
  return Object.fromEntries(Object.entries(results).map(([accountId, result]) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return [accountId, result];
    const { providerOperationId: _providerOperationId, ...publicResult } = result as Record<string, unknown>;
    return [accountId, publicResult];
  }));
}

/** Remove provider reconciliation handles from a successful upload response. */
export function publicPublishedVideo(video: unknown): unknown {
  if (!video || typeof video !== 'object' || Array.isArray(video)) return video;
  const { providerOperationId: _providerOperationId, ...publicVideo } = video as Record<string, unknown>;
  return publicVideo;
}

/** Remove encrypted reconciliation evidence and host filesystem paths. */
export function publicPublishingStats(post: Partial<PostRecord>): Record<string, unknown> {
  const durable = object(post.stats);
  const { providerOperationHandles: _providerOperationHandles, ...stats } = durable;
  if (Object.prototype.hasOwnProperty.call(durable, 'publishResults')) {
    stats.publishResults = publicPublishResults(durable.publishResults);
  }
  if (Object.prototype.hasOwnProperty.call(durable, 'videoPath')) {
    stats.videoPath = publishingVideoReference(text(post.tenant_id), durable.videoPath);
  }
  return stats;
}

export function publicPublishTracking(post: PostRecord): Record<string, unknown> {
  const stats = publicPublishingStats(post);
  return {
    id: post.id,
    contentId: text(post.content_id),
    platform: text(post.platform),
    platformPostId: text(post.platform_post_id),
    title: text(post.title),
    publishedAt: text(post.published_at || post.created),
    trackCode: text(post.track_code),
    waLink: text(post.wa_link),
    stats,
    status: text(stats.status) || (post.platform_post_id ? 'published' : 'scheduled'),
    publishRevision: Number(post.publish_revision || 0),
    reconciliationRequired: post.reconciliation_required === true,
  };
}

export function publicPublishHistoryRecord(
  record: SocialPublishRecord | null,
  tenantId: string,
): Record<string, unknown> | null {
  if (!record) return null;
  const {
    tenantId: _tenantId,
    contentFingerprint: _contentFingerprint,
    videoPath,
    ...publicRecord
  } = record;
  return {
    ...publicRecord,
    ...(videoPath ? { videoPath: publishingVideoReference(tenantId, videoPath) } : {}),
  };
}
