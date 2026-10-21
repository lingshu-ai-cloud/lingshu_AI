import { getFacebookComments, getFacebookVideos, getInstagramComments, getInstagramMedia } from '../integrations/social.js';
import { getMyVideoComments, type YouTubeConfig } from '../integrations/youtube.js';
import { getLinkedInComments, getLinkedInPostMetrics, linkedInAuthorUrn } from '../integrations/linkedin.js';
import { socialAccessToken, youtubeCredentials } from '../lib/accountCredentials.js';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import type { EngagementIngestionAdapter, EngagementPlatform, PlatformEngagementEvent } from './ingestion.js';
import type { MetricValues } from '../socialMetrics/aggregation.js';

type AccountRecord = Record<string, unknown> & { id: string };

const text = (value: unknown): string => String(value ?? '').trim();
const cursorKey = (event: Pick<PlatformEngagementEvent, 'occurredAt' | 'providerEventId'>) => `${event.occurredAt}|${event.providerEventId}`;
const afterCursor = (events: PlatformEngagementEvent[], cursor?: string) => events
  .filter(event => !cursor || cursorKey(event) > cursor)
  .sort((left, right) => cursorKey(left).localeCompare(cursorKey(right)));

function object(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value === 'string') try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
  return {};
}

async function linkedInRegisteredPosts(tenantId: string, accountId: string, dataStore: DataStore): Promise<string[]> {
  const result = await dataStore.list<Record<string, unknown>>('posts', { where: { tenant_id: tenantId, platform: 'linkedin' }, page: 1, perPage: 500 });
  if (result.totalItems > result.items.length) throw new Error('linkedin_registered_post_scan_incomplete');
  return [...new Set(result.items.map(item => {
    const attempt = object(object(object(item.stats).publishResults)[accountId]);
    return text(attempt.platformPostId || attempt.providerReceiptId);
  }).filter(postId => /^urn:li:(?:share|ugcPost):/.test(postId)))];
}

export function createYouTubeCommentAdapter(account: AccountRecord, verifiedAt: string): EngagementIngestionAdapter {
  const accountId = text(account.id);
  return {
    adapterId: `youtube-comments:${accountId}`,
    capability: { platform: 'youtube', surface: 'comments', status: 'available', reason: 'provider_capability_verified', accountId, verifiedAt },
    async pull(cursor) {
      const comments = await getMyVideoComments(youtubeCredentials(account) as YouTubeConfig, 100, text(account.channelId));
      const events = afterCursor(comments.map(comment => ({
        kind: 'comment' as const, platform: 'youtube' as const, providerEventId: text(comment.id), accountId,
        contentId: text(comment.videoId), body: text(comment.textDisplay), occurredAt: new Date(comment.publishedAt).toISOString(),
        actorRef: text(comment.authorName) || undefined, raw: comment,
      })), cursor);
      return { events, cursor: events.at(-1) ? cursorKey(events.at(-1)!) : cursor };
    },
  };
}

export function createMetaCommentAdapter(
  account: AccountRecord,
  platform: Extract<EngagementPlatform, 'facebook' | 'instagram'>,
  verifiedAt: string,
  graphVersion = 'v25.0',
): EngagementIngestionAdapter {
  const accountId = text(account.id);
  return {
    adapterId: `${platform}-comments:${accountId}`,
    capability: { platform, surface: 'comments', status: 'available', reason: 'provider_capability_verified', accountId, verifiedAt },
    async pull(cursor) {
      const accessToken = socialAccessToken(account);
      const providerAccountId = text(account.providerAccountId);
      const content = platform === 'facebook'
        ? await getFacebookVideos(providerAccountId, accessToken, graphVersion, 25)
        : await getInstagramMedia(providerAccountId, accessToken, graphVersion, 25);
      const events: PlatformEngagementEvent[] = [];
      for (const post of content) {
        const comments = platform === 'facebook'
          ? await getFacebookComments(post.id, accessToken, graphVersion, 100)
          : await getInstagramComments(post.id, accessToken, graphVersion, 100);
        events.push(...comments.map((comment: Record<string, unknown> & { publishedAt: string }) => ({
          kind: 'comment' as const, platform, providerEventId: text(comment.id), accountId,
          contentId: text(post.id), body: text(comment.textDisplay), occurredAt: new Date(comment.publishedAt).toISOString(),
          actorRef: text(comment.authorName) || undefined, raw: comment,
        })));
      }
      const filtered = afterCursor(events, cursor);
      return { events: filtered, cursor: filtered.at(-1) ? cursorKey(filtered.at(-1)!) : cursor };
    },
  };
}

export function createLinkedInCommentAdapter(
  account: AccountRecord,
  verifiedAt: string,
  options: {
    dataStore?: DataStore;
    onMetric?: (input: {
      tenantId: string;
      accountId: string;
      contentId: string;
      metrics: MetricValues;
      rawMetrics: Record<string, number | undefined>;
    }) => Promise<void>;
  } = {},
): EngagementIngestionAdapter {
  const accountId = text(account.id);
  const tenantId = text(account.tenantId ?? account.tenant_id);
  return {
    adapterId: `linkedin-comments:${accountId}`,
    capability: { platform: 'linkedin', surface: 'comments', status: 'available', reason: 'provider_capability_verified', accountId, verifiedAt },
    async pull(cursor) {
      const accessToken = socialAccessToken(account);
      const authorUrn = linkedInAuthorUrn({ providerAccountId: text(account.providerAccountId), parentPageId: text(account.parentPageId) });
      const posts = await linkedInRegisteredPosts(tenantId, accountId, options.dataStore ?? store);
      const events: PlatformEngagementEvent[] = [];
      for (const postId of posts) {
        const [metrics, comments] = await Promise.all([
          getLinkedInPostMetrics({ accessToken, postId, authorUrn }),
          getLinkedInComments({ accessToken, postId, count: 100 }),
        ]);
        if (options.onMetric) await options.onMetric({
          tenantId,
          accountId,
          contentId: postId,
          metrics: {
            views: metrics.views,
            reach: metrics.impressions,
            likes: metrics.likes,
            comments: metrics.comments,
            shares: metrics.shares,
          },
          rawMetrics: { ...metrics },
        });
        events.push(...comments.map(comment => ({
          kind: 'comment' as const,
          platform: 'linkedin' as const,
          providerEventId: comment.id,
          accountId,
          contentId: postId,
          body: comment.textDisplay,
          occurredAt: comment.publishedAt,
          actorRef: comment.authorName,
          raw: comment,
        })));
      }
      const filtered = afterCursor(events, cursor);
      return { events: filtered, cursor: filtered.at(-1) ? cursorKey(filtered.at(-1)!) : cursor };
    },
  };
}
