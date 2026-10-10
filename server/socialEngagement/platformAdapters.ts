import { getFacebookComments, getFacebookVideos, getInstagramComments, getInstagramMedia } from '../integrations/social.js';
import { getMyVideoComments, type YouTubeConfig } from '../integrations/youtube.js';
import { socialAccessToken, youtubeCredentials } from '../lib/accountCredentials.js';
import type { EngagementIngestionAdapter, EngagementPlatform, PlatformEngagementEvent } from './ingestion.js';

type AccountRecord = Record<string, unknown> & { id: string };

const text = (value: unknown): string => String(value ?? '').trim();
const cursorKey = (event: Pick<PlatformEngagementEvent, 'occurredAt' | 'providerEventId'>) => `${event.occurredAt}|${event.providerEventId}`;
const afterCursor = (events: PlatformEngagementEvent[], cursor?: string) => events
  .filter(event => !cursor || cursorKey(event) > cursor)
  .sort((left, right) => cursorKey(left).localeCompare(cursorKey(right)));

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
