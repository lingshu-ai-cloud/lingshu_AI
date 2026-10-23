import { mergeCrawledVideos, metaToCrawledVideo, normalizeCrawledVideo } from '../routes/videoCrawlerPublicProjection.js';
import { searchPublicVideoUrlsByQuery } from '../routes/videoCrawlerPublicDiscovery.js';
import { accountLabelFromUrl, accountListUrlCandidates, normalizeAccountListUrl } from '../routes/videoCrawlerSourceUrls.js';
import type { Platform } from '../types/index.js';
import { isDiscoveryVideoEligible } from '../../shared/contracts/discoveryVideoPolicy.js';
import { hasDateRange, hasRealThumbnail, isWithinDateRange, type CrawledVideo } from '../routes/videoCrawlerNormalization.js';

import type { VideoApplicationPorts } from './applicationPorts.js';

export function createAccountCollectionProvider(deps: Pick<VideoApplicationPorts, 'canUseApifyInstagramCrawlFallback' | 'crawlInstagramApify' | 'crawlYtDlpSearch' | 'canUseApifyTikTokCrawlFallback' | 'crawlTikTokApify' | 'canUseApifyFacebookCrawlFallback' | 'crawlFacebookAccountApify' | 'crawlYtDlpMetadata' | 'execYtDlpWithCookieFallback'>) {
  const canUseApifyInstagramCrawlFallback: VideoApplicationPorts['canUseApifyInstagramCrawlFallback'] = (...args) => deps.canUseApifyInstagramCrawlFallback(...args);
  const crawlInstagramApify: VideoApplicationPorts['crawlInstagramApify'] = (...args) => deps.crawlInstagramApify(...args);
  const crawlYtDlpSearch: VideoApplicationPorts['crawlYtDlpSearch'] = (...args) => deps.crawlYtDlpSearch(...args);
  const canUseApifyTikTokCrawlFallback: VideoApplicationPorts['canUseApifyTikTokCrawlFallback'] = (...args) => deps.canUseApifyTikTokCrawlFallback(...args);
  const crawlTikTokApify: VideoApplicationPorts['crawlTikTokApify'] = (...args) => deps.crawlTikTokApify(...args);
  const canUseApifyFacebookCrawlFallback: VideoApplicationPorts['canUseApifyFacebookCrawlFallback'] = (...args) => deps.canUseApifyFacebookCrawlFallback(...args);
  const crawlFacebookAccountApify: VideoApplicationPorts['crawlFacebookAccountApify'] = (...args) => deps.crawlFacebookAccountApify(...args);
  const crawlYtDlpMetadata: VideoApplicationPorts['crawlYtDlpMetadata'] = (...args) => deps.crawlYtDlpMetadata(...args);
  const execYtDlpWithCookieFallback: VideoApplicationPorts['execYtDlpWithCookieFallback'] = (...args) => deps.execYtDlpWithCookieFallback(...args);

  async function crawlAccountHomepage(platform: Platform, accountUrl: string, limit: number, dateFrom = '', dateTo = '', cloudFallback = false, strictProviderLimit = false): Promise<CrawledVideo[]> {
    if (platform === 'instagram') {
      let instagramItems: CrawledVideo[] = [];
      if (canUseApifyInstagramCrawlFallback()) {
        try {
          instagramItems = await crawlInstagramApify(accountUrl, Math.max(1, limit), dateFrom, dateTo);
        } catch (e) {
          console.warn('[videos] Instagram account Apify crawl failed:', e instanceof Error ? e.message : e);
        }
      }
      try {
        instagramItems = mergeCrawledVideos(instagramItems, await crawlYtDlpSearch(platform, normalizeAccountListUrl(platform, accountUrl), '', Math.max(1, limit), '', ''));
      } catch (e) {
        console.warn('[videos] Instagram account public crawl failed:', e instanceof Error ? e.message : e);
      }
      if (instagramItems.length === 0) throw new Error('Instagram 账号主页未抓到可用视频：请配置 APIFY_TOKEN 默认采集');
      return instagramItems.slice(0, limit);
    }
    const listUrl = normalizeAccountListUrl(platform, accountUrl);
    const safeLimit = Math.max(1, limit);
    let items: CrawledVideo[];
    if (platform === 'tiktok' && cloudFallback && canUseApifyTikTokCrawlFallback()) {
      try {
        const apifyItems = await crawlTikTokApify(accountUrl, safeLimit, dateFrom, dateTo, strictProviderLimit);
        const eligible = apifyItems.filter(item => isDiscoveryVideoEligible(item));
        if (eligible.length > 0) return eligible.slice(0, limit);
      } catch (apifyError) {
        console.warn('[videos] TikTok account cloud Apify crawl failed:', apifyError instanceof Error ? apifyError.message : apifyError);
      }
    }
    if (platform === 'facebook') {
      items = [];
      if (canUseApifyFacebookCrawlFallback()) {
        try {
          const apifyItems = await crawlFacebookAccountApify(accountUrl, safeLimit, dateFrom, dateTo, strictProviderLimit);
          items = mergeCrawledVideos(items, apifyItems);
        } catch (apifyError) {
          console.warn('[videos] Facebook account Apify crawl failed:', apifyError instanceof Error ? apifyError.message : apifyError);
        }
      }

      if (items.length < safeLimit) {
        try {
          const publicItems = await crawlFacebookAccountByPublicSearch(accountUrl, safeLimit - items.length);
          items = mergeCrawledVideos(items, publicItems);
        } catch (publicError) {
          console.warn('[videos] Facebook account public URL search failed:', publicError instanceof Error ? publicError.message : publicError);
        }
      }

      if (items.length === 0) {
        throw new Error('Facebook 账号主页未抓到可用视频：请配置 APIFY_TOKEN 默认采集');
      }
      const withinRange = hasDateRange(dateFrom, dateTo)
        ? items.filter(item => isWithinDateRange(item.uploadedAt, dateFrom, dateTo))
        : items;
      return (withinRange.length ? withinRange : items).slice(0, limit);
    }
    const candidates = accountListUrlCandidates(platform, accountUrl);
    const errors: unknown[] = [];
    for (const candidate of candidates) {
      try {
        items = await crawlYtDlpSearch(platform, candidate, '', safeLimit, '', '', platform === 'youtube');
        break;
      } catch (e) {
        errors.push(e);
        console.warn('[videos] account homepage flat enumeration failed:', e);
      }
    }
    if (!items!) {
      for (const candidate of candidates) {
        try {
          items = await enumerateAccountWithCookies(platform, candidate, safeLimit);
          break;
        } catch (cookieError) {
          errors.push(cookieError);
          console.warn('[videos] account homepage cookie enumeration failed:', cookieError);
        }
      }
    }
    if (!items!) {
      const lastError = errors[errors.length - 1];
      throw lastError instanceof Error ? lastError : new Error(`${platform} 账号主页未抓到可用视频`);
    }
    const withinRange = hasDateRange(dateFrom, dateTo)
      ? items.filter(item => isWithinDateRange(item.uploadedAt, dateFrom, dateTo))
      : items;
    return (withinRange.length ? withinRange : items)
      .map(normalizeCrawledVideo)
      .filter(item => isDiscoveryVideoEligible(item))
      .slice(0, limit);
  }

  async function crawlFacebookAccountByPublicSearch(accountUrl: string, limit: number): Promise<CrawledVideo[]> {
    const account = accountLabelFromUrl(accountUrl).replace(/^@/, '').trim();
    const hostPath = (() => {
      try {
        const url = new URL(accountUrl);
        return `${url.hostname.replace(/^www\./, '')}/${url.pathname.split('/').filter(Boolean)[0] || account}`;
      } catch {
        return `facebook.com/${account}`;
      }
    })();
    const query = `site:${hostPath} ("/videos/" OR "/reel/" OR "watch")`;
    const candidates = await searchPublicVideoUrlsByQuery('facebook', query, Math.max(limit * 4, 12));
    const items: CrawledVideo[] = [];
    for (const url of candidates) {
      try {
        const item = await crawlYtDlpMetadata('facebook', url, account);
        if (hasRealThumbnail(item)) items.push(item);
      } catch (e) {
        console.warn('[videos] Facebook account candidate failed:', e instanceof Error ? e.message : e);
      }
      if (items.length >= limit) break;
    }
    if (items.length === 0) throw new Error('Facebook 账号主页暂未搜索到可用公开视频');
    return items.slice(0, limit);
  }

  async function enumerateAccountWithCookies(platform: Platform, listUrl: string, limit: number): Promise<CrawledVideo[]> {
    const stdout = await execYtDlpWithCookieFallback(
      ['--dump-json', '--flat-playlist', '--playlist-end', String(limit)],
      listUrl,
      60_000,
      16 * 1024 * 1024,
    );
    const items = stdout.split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; } })
      .filter((meta): meta is Record<string, unknown> => Boolean(meta))
      .map(metaToCrawledVideo(platform, '', platform === 'youtube' && /\/shorts(?:[/?#]|$)/i.test(listUrl)))
      .filter((item): item is CrawledVideo => Boolean(item));
    if (items.length === 0) throw new Error(`${platform} 账号主页没有枚举到可用视频`);
    return items.slice(0, limit);
  }

  return { crawlAccountHomepage };
}
