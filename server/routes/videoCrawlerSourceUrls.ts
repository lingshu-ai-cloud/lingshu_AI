import type { Platform } from '../types/index.js';
import { isPlatformUrl } from './videoCrawlerNormalization.js';

export function youtubeVideoId(url: string): string {
  const trimmed = String(url || '').trim();
  // Flat playlists may return a bare 11-character video ID.
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.includes('youtu.be')) return parsed.pathname.replace(/^\//, '');
    return parsed.searchParams.get('v') || parsed.pathname.match(/\/(?:shorts|embed)\/([^/?#]+)/)?.[1] || '';
  } catch {
    return trimmed.match(/(?:v=|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{6,})/)?.[1] || '';
  }
}

export function looksLikeVideoUrl(url: string, platform: Platform): boolean {
  if (platform === 'tiktok') return /\/video\/\d+/i.test(url);
  if (platform === 'instagram') return /\/(?:reel|p)\//i.test(url);
  if (platform === 'facebook') return /\/(?:reel|watch|videos)\b/i.test(url) || /[?&]v=\d+/i.test(url);
  if (platform === 'linkedin') return /\/(?:posts|feed\/update)\//i.test(url) || /activity[:-]\d+/i.test(url);
  return true;
}

/** Account homepage, not a single content URL or a lookalike host. */
export function looksLikeAccountUrl(input: string, platform: Platform): boolean {
  const url = String(input || '').trim();
  if (!isPlatformUrl(url, platform)) return false;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    const segments = path.split('/').filter(Boolean);
    if (platform === 'youtube') {
      if (youtubeVideoId(url)) return false;
      return /\/(?:@[^/?#]+|channel\/[^/?#]+|c\/[^/?#]+|user\/[^/?#]+)/i.test(path);
    }
    if (platform === 'tiktok') return /\/@[^/?#]+/i.test(path) && !/\/video\/\d+/i.test(path);
    if (platform === 'instagram') {
      if (looksLikeVideoUrl(url, 'instagram')) return false;
      const first = segments[0] || '';
      return Boolean(first) && !['accounts', 'explore', 'reel', 'reels', 'p', 'stories', 'tv', 'direct'].includes(first.toLowerCase());
    }
    if (platform === 'facebook') {
      if (looksLikeVideoUrl(url, 'facebook')) return false;
      const first = segments[0] || '';
      return Boolean(first) && !['watch', 'reel', 'reels', 'videos', 'groups', 'events', 'marketplace', 'share'].includes(first.toLowerCase());
    }
    if (platform === 'linkedin') return segments[0]?.toLowerCase() === 'company' && Boolean(segments[1]);
  } catch { return false; }
  return false;
}
