export const INSPIRATION_IMAGE_CRAWL_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube'] as const;

export type InspirationImageCrawlPlatform = typeof INSPIRATION_IMAGE_CRAWL_PLATFORMS[number];

export interface InspirationImageCrawlRecord {
  id?: string;
  platform?: string;
  title?: string;
  thumbnailUrl?: string;
  duration?: number;
  sourceUrl?: string;
  tags?: string;
  aiAnalysis?: string;
  status?: 'pending' | 'analyzed' | 'failed';
  videoFileId?: string;
  crawledAt?: string;
  canManage?: boolean;
}

export interface InspirationImageCrawlResult {
  platform: InspirationImageCrawlPlatform;
  keyword: string;
  imported: number;
  skipped: number;
  returnedExisting: number;
  requested: number;
  total: number;
  message: string;
  items: InspirationImageCrawlRecord[];
}

type ImageCrawlRequest = {
  platform: InspirationImageCrawlPlatform;
  keyword: string;
  limit: number;
};

type ImageCrawlOptions = {
  fetcher?: typeof fetch;
  headers?: HeadersInit;
};

export async function crawlInspirationImages(
  input: ImageCrawlRequest,
  options: ImageCrawlOptions = {},
): Promise<InspirationImageCrawlResult> {
  const keyword = input.keyword.trim();
  if (!keyword) throw new Error('请输入采集关键词');
  if (!INSPIRATION_IMAGE_CRAWL_PLATFORMS.includes(input.platform)) throw new Error('暂不支持该平台的图片采集');
  const limit = Math.min(30, Math.max(1, Math.round(Number(input.limit) || 0)));
  if (!limit) throw new Error('请选择采集数量');

  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const response = await fetcher('/api/overseas/videos/crawl-image-posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: JSON.stringify({ platform: input.platform, keyword, limit }),
  });
  const result = await response.json().catch(() => ({})) as Partial<InspirationImageCrawlResult> & { error?: string };
  if (!response.ok) throw new Error(result.error || `图片采集失败（HTTP ${response.status}）`);

  return {
    platform: input.platform,
    keyword,
    imported: Math.max(0, Number(result.imported || 0)),
    skipped: Math.max(0, Number(result.skipped || 0)),
    returnedExisting: Math.max(0, Number(result.returnedExisting || 0)),
    requested: Math.max(0, Number(result.requested || limit)),
    total: Math.max(0, Number(result.total || 0)),
    message: String(result.message || '').trim(),
    items: Array.isArray(result.items) ? result.items : [],
  };
}
