import { type AuthLocals } from '../middleware/auth.js';
import type { Platform } from '../types/index.js';
import { DEFAULT_CRAWL_KEYWORDS } from '../videos/runtimeConfig.js';
import type { VideoApplicationPorts } from '../videos/applicationPorts.js';

export function createVideoCollectionRoutes(deps: Pick<VideoApplicationPorts, 'videosRouter' | 'crawlVideosForTenant' | 'crawlImagePostsForTenant'>) {
  const videosRouter = deps.videosRouter;
  const crawlVideosForTenant: VideoApplicationPorts['crawlVideosForTenant'] = (...args) => deps.crawlVideosForTenant(...args);
  const crawlImagePostsForTenant: VideoApplicationPorts['crawlImagePostsForTenant'] = (...args) => deps.crawlImagePostsForTenant(...args);

  function registerPostCrawl() {
    videosRouter.post('/crawl', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const {
        platform = 'youtube',
        keyword = DEFAULT_CRAWL_KEYWORDS,
        limit = 5,
        dateFrom = '',
        dateTo = '',
        mode,
        accountUrl = '',
        accountName = '',
      } = req.body as {
        platform?: Platform;
        keyword?: string;
        limit?: number;
        dateFrom?: string;
        dateTo?: string;
        mode?: 'keyword' | 'account';
        accountUrl?: string;
        accountName?: string;
      };

      if (!['youtube', 'tiktok', 'facebook', 'instagram'].includes(platform)) {
        res.status(400).json({ error: 'Only youtube, tiktok, facebook and instagram are supported by this crawler task' });
        return;
      }

      try {
        const result = await crawlVideosForTenant({ tenantId, platform, keyword, limit, dateFrom, dateTo, mode, accountUrl, accountName });
        res.json(result);
      } catch (e) {
        console.error('[videos] crawl failed:', e);
        res.status(502).json({ error: e instanceof Error ? e.message : 'Crawl failed' });
      }
    });
  }

  function registerPostCrawlImagePosts() {
    videosRouter.post('/crawl-image-posts', async (req, res) => {
      const { tenantId } = res.locals as AuthLocals;
      const { platform = 'instagram', keyword = DEFAULT_CRAWL_KEYWORDS, limit = 5 } = req.body as {
        platform?: Platform;
        keyword?: string;
        limit?: number;
      };

      if (!['youtube', 'tiktok', 'facebook', 'instagram'].includes(platform)) {
        res.status(400).json({ error: 'Only youtube, tiktok, facebook and instagram are supported by this crawler task' });
        return;
      }

      try {
        const result = await crawlImagePostsForTenant({
          tenantId,
          platform,
          keyword,
          limit,
        });
        res.json(result);
      } catch (e) {
        console.error('[videos] image post crawl failed:', e);
        res.status(502).json({ error: e instanceof Error ? e.message : 'Image post crawl failed' });
      }
    });
  }

  return { registerPostCrawl, registerPostCrawlImagePosts };
}
