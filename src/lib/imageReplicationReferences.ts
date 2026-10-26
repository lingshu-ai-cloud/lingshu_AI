import { z } from 'zod';
import { authHeader } from './auth';
import type { ImageReplicationReference } from './imageReplicationDraft';

const postSchema = z.object({
  id: z.string().min(1), title: z.string(), platform: z.enum(['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin']),
  sourceUrl: z.string().url(), crawledAt: z.string().optional(), aiAnalysis: z.unknown(),
});
const analysisSchema = z.object({
  contentFormat: z.literal('image'), source: z.enum(['apify-image', 'public-search-image', 'apify-linkedin-company-posts']),
  caption: z.string().optional(), imageUrls: z.array(z.string()).min(1),
});
const domains = { instagram: 'instagram.com', facebook: 'facebook.com', tiktok: 'tiktok.com', youtube: 'youtube.com', linkedin: 'linkedin.com' };

/** Only collected social posts qualify; local products and generated assets never enter this selector. */
export function collectedImageReferences(rows: unknown[]): ImageReplicationReference[] {
  return rows.flatMap(raw => {
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) return [];
    const post = parsed.data;
    let value: unknown = post.aiAnalysis;
    try { if (typeof value === 'string') value = JSON.parse(value); } catch { return []; }
    const parsedAnalysis = analysisSchema.safeParse(value);
    if (!parsedAnalysis.success) return [];
    const source = new URL(post.sourceUrl);
    const domain = domains[post.platform];
    if (source.protocol !== 'https:' || !(source.hostname === domain || source.hostname.endsWith(`.${domain}`))) return [];
    const analysis = parsedAnalysis.data;
    // Use only the persisted full image, never a generated substitute or a remote thumbnail.
    const route = `/api/overseas/videos/${encodeURIComponent(post.id)}/image/0`;
    if (!analysis.imageUrls.includes(route)) return [];
    return [{ url: route, title: post.title, sourceRecordId: post.id, sourceUrl: post.sourceUrl,
      platform: post.platform, caption: analysis.caption || '', collectedAt: post.crawledAt }];
  });
}

export async function readImageReplicationReferences(selectedId?: string): Promise<ImageReplicationReference[]> {
  const response = await fetch('/api/overseas/videos?page=1&perPage=100&contentFormat=image&crawlRange=all', {
    headers: authHeader(), cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('已采集图文读取失败，请重新读取。');
  const result = z.object({ items: z.array(z.unknown()) }).safeParse(await response.json());
  if (!result.success) throw new Error('已采集图文返回格式异常，请重新读取。');
  const items = collectedImageReferences(result.data.items);
  if (selectedId && !items.some(item => item.sourceRecordId === selectedId)) {
    const record = await fetch(`/api/overseas/videos/${encodeURIComponent(selectedId)}`, {
      headers: authHeader(), cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    if (record.ok) items.unshift(...collectedImageReferences([await record.json()]));
  }
  return items;
}
