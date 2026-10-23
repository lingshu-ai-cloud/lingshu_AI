import { authHeader } from '../../lib/auth';
import { crawlInspirationImages, type InspirationImageCrawlPlatform } from '../../lib/inspirationImageCrawl';
import type { ContentFormat, Platform } from '../../lib/inspirationTypes';
import { recordsToVideos, type CrawlerRecord } from './inspirationVideoProjection';

interface ImageCrawlActionContext {
  busy: boolean;
  platform: InspirationImageCrawlPlatform;
  keyword: string;
  limit: number;
  setBusy: (value: boolean) => void;
  setError: (value: string) => void;
  setContentFormat: (value: ContentFormat) => void;
  setPlatform: (value: Platform) => void;
  setCrawlTimeRange: (value: 'all') => void;
  setSearch: (value: string) => void;
  searchRef: { current: string };
  setSortMode: (value: 'crawlTime') => void;
  setLastCrawlVideoIds: (value: string[]) => void;
  setOpen: (value: boolean) => void;
  setMaterialMessage: (value: string) => void;
  refreshInventory: (format: ContentFormat) => Promise<unknown>;
  refreshVideos: (page: number, quiet: boolean, filters: {
    contentFormat: ContentFormat;
    crawlTimeRange: 'all';
    platform: Platform;
    search: string;
  }) => Promise<unknown>;
  crawl?: typeof crawlInspirationImages;
  authorization?: typeof authHeader;
}

export async function runInspirationImageCrawl(context: ImageCrawlActionContext): Promise<void> {
  if (context.busy) return;
  context.setBusy(true);
  context.setError('');
  const authorization = context.authorization || authHeader;
  const requestAuthorization = authorization();
  const sameAuthorization = () => authorization().Authorization === requestAuthorization.Authorization;
  try {
    const result = await (context.crawl || crawlInspirationImages)({
      platform: context.platform,
      keyword: context.keyword,
      limit: context.limit,
    }, { headers: requestAuthorization });
    if (!sameAuthorization()) return;
    if (!result.items.length) {
      context.setError(result.message || '未找到可入库图片，请换一个关键词或平台');
      return;
    }
    const crawled = recordsToVideos(result.items as CrawlerRecord[]);
    context.setContentFormat('image');
    context.setPlatform(context.platform);
    context.setCrawlTimeRange('all');
    context.setSearch('');
    context.searchRef.current = '';
    context.setSortMode('crawlTime');
    context.setLastCrawlVideoIds(crawled.map(item => item.id));
    context.setOpen(false);
    context.setMaterialMessage(result.message || `图片采集完成，共返回 ${result.items.length} 条`);
    await Promise.all([
      context.refreshInventory('image'),
      context.refreshVideos(1, false, {
        contentFormat: 'image', crawlTimeRange: 'all', platform: context.platform, search: '',
      }),
    ]);
  } catch (error) {
    if (sameAuthorization()) context.setError(error instanceof Error ? error.message : '图片采集失败');
  } finally {
    context.setBusy(false);
  }
}
