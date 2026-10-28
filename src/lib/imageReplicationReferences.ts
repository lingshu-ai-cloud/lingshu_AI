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
    // Only expose original persisted image routes for this post. A carousel's
    // later frames may have a usable composition when its cover does not.
    return Array.from({ length: 10 }, (_, imageIndex) => ({
      imageIndex, url: `/api/overseas/videos/${encodeURIComponent(post.id)}/image/${imageIndex}`,
    })).filter(({ url }) => analysis.imageUrls.includes(url)).map(({ imageIndex, url }) => ({
      url, imageIndex, title: analysis.imageUrls.length > 1 ? `${post.title} · 第 ${imageIndex + 1} 张` : post.title,
      sourceRecordId: post.id, sourceUrl: post.sourceUrl,
      platform: post.platform, caption: analysis.caption || '', collectedAt: post.crawledAt,
    }));
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

/** Explicitly requested once for an old collected post; a transport failure is never replayed automatically. */
export async function reanalyzeCollectedImageReference(sourceRecordId: string): Promise<void> {
  const response = await fetch(`/api/overseas/videos/${encodeURIComponent(sourceRecordId)}/reanalyze-image`, {
    method: 'POST', headers: authHeader(), cache: 'no-store',
  });
  const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
  if (!response.ok || result.ok !== true) throw new Error(result.error || `参考图补充分析失败（HTTP ${response.status}）`);
}
