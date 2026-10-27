import { AUTHORITATIVE_NEWS_SOURCES } from '../../shared/authoritativeNewsSources';
import { sourceEmbedUrl } from './inspirationVideoPlayback';

export type ReplySource = { title: string; uri: string };

export function safeSourceUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}

export function trustedReplyUrl(value: string, sources: ReplySource[] = []): boolean {
  const url = safeSourceUrl(value);
  if (!url) return false;
  return AUTHORITATIVE_NEWS_SOURCES.some(source => source.index === url.href)
    || url.host === 'vertexaisearch.cloud.google.com'
    || sources.some(source => safeSourceUrl(source.uri)?.host === url.host);
}

export function replySourceLabel(value: string): string {
  return AUTHORITATIVE_NEWS_SOURCES.find(source => source.index === value)?.label
    ?? safeSourceUrl(value)?.hostname ?? value;
}

export function replyVideoPreview(value: string): { kind: 'video' | 'embed'; url: string } | null {
  const url = safeSourceUrl(value);
  if (!url) return null;
  if (/\.(?:mp4|webm|mov|m4v|ogv)$/i.test(url.pathname)) return { kind: 'video', url: url.href };
  const platform = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname) ? 'youtube'
    : ['www.tiktok.com', 'tiktok.com'].includes(url.hostname) && /\/video\/\d+/.test(url.pathname) ? 'tiktok'
      : ['www.instagram.com', 'instagram.com'].includes(url.hostname) && /\/(?:reel|tv)\//.test(url.pathname) ? 'instagram' : null;
  if (!platform) return null;
  const embed = sourceEmbedUrl({ platform, sourceUrl: url.href });
  if (!embed) return null;
  const preview = new URL(embed);
  preview.searchParams.set('autoplay', '0');
  return { kind: 'embed', url: preview.href };
}
