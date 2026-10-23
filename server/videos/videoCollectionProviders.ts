import { apifyFacebookPostToCrawledVideo, apifyInstagramItemToCrawledVideo, apifyTikTokItemToCrawledVideo, compactNumber } from '../routes/videoCrawlerProviderProjection.js';
import { crawlFailureMessage } from '../routes/videoCrawlerPublicProjection.js';
import { runPaidApifyTikTokDataset, type PaidApifyTikTokPermit } from '../routes/apifyPaidTikTokTransport.js';
import { buildApifyTikTokInput } from '../routes/apifyTikTokInput.js';
import { browserUserAgent } from '../routes/videoCrawlerRuntimeConfig.js';
import type { Platform } from '../types/index.js';
import { apifyCandidateWindow, cleanupFacebookTitle, decodeHtml, extractFacebookViews, extractMeta, extractTitle, hasRealThumbnail, isKeywordRelevant, isPlatformUrl, isWithinDateRange, sortByHeat, tagsFromKeyword, type CrawledVideo } from '../routes/videoCrawlerNormalization.js';
import type { TikTokPublicApiData } from './contracts.js';
import type { VideoApplicationPorts } from './applicationPorts.js';

export function createVideoCollectionProviders(deps: Pick<VideoApplicationPorts, 'crawlYtDlpMetadata' | 'crawlPublicSearch' | 'canUseApifyTikTokCrawlFallback' | 'canUseApifyInstagramCrawlFallback' | 'runApifyActorDatasetItems' | 'canUseApifyFacebookCrawlFallback' | 'discoverFacebookPageUrl' | 'fetchFacebookHtml'>) {
  const crawlYtDlpMetadata: VideoApplicationPorts['crawlYtDlpMetadata'] = (...args) => deps.crawlYtDlpMetadata(...args);
  const crawlPublicSearch: VideoApplicationPorts['crawlPublicSearch'] = (...args) => deps.crawlPublicSearch(...args);
  const canUseApifyTikTokCrawlFallback: VideoApplicationPorts['canUseApifyTikTokCrawlFallback'] = (...args) => deps.canUseApifyTikTokCrawlFallback(...args);
  const canUseApifyInstagramCrawlFallback: VideoApplicationPorts['canUseApifyInstagramCrawlFallback'] = (...args) => deps.canUseApifyInstagramCrawlFallback(...args);
  const runApifyActorDatasetItems: VideoApplicationPorts['runApifyActorDatasetItems'] = (...args) => deps.runApifyActorDatasetItems(...args);
  const canUseApifyFacebookCrawlFallback: VideoApplicationPorts['canUseApifyFacebookCrawlFallback'] = (...args) => deps.canUseApifyFacebookCrawlFallback(...args);
  const discoverFacebookPageUrl: VideoApplicationPorts['discoverFacebookPageUrl'] = (...args) => deps.discoverFacebookPageUrl(...args);
  const fetchFacebookHtml: VideoApplicationPorts['fetchFacebookHtml'] = (...args) => deps.fetchFacebookHtml(...args);

  async function crawlSocialUrlOrFallback(platform: Platform, keyword: string, limit: number, dateFrom = '', dateTo = ''): Promise<CrawledVideo[]> {
    const input = keyword.trim();
    if (isPlatformUrl(input, platform)) return [await crawlYtDlpMetadata(platform, input, keyword)];
    return crawlPublicSearch(platform, input, limit, dateFrom, dateTo);
  }

  async function crawlTikTokWithApifyFallback(keyword: string, limit: number, dateFrom = '', dateTo = '', strictProviderLimit = false): Promise<CrawledVideo[]> {
    const input = keyword.trim();
    if (isPlatformUrl(input, 'tiktok')) {
      try {
        return [await crawlYtDlpMetadata('tiktok', input, keyword)];
      } catch (error) {
        console.warn('[videos] TikTok direct metadata via yt-dlp failed, trying public API:', error instanceof Error ? error.message : error);
        return [await crawlTikTokPublicApi(input)];
      }
    }

    const items: CrawledVideo[] = [];
    const failures: string[] = [];
    try {
      items.push(...await crawlPublicSearch('tiktok', input, limit, dateFrom, dateTo));
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
      console.warn('[videos] TikTok local crawl failed, trying Apify:', e instanceof Error ? e.message : e);
    }

    const seen = new Set(items.map(item => item.sourceUrl));
    if (items.length < limit && canUseApifyTikTokCrawlFallback()) {
      try {
        const apifyItems = await crawlTikTokApify(input, Math.max(limit - items.length, limit), dateFrom, dateTo, strictProviderLimit);
        for (const item of apifyItems) {
          if (seen.has(item.sourceUrl)) continue;
          if (!isKeywordRelevant(item, input)) continue;
          if (!isWithinDateRange(item.uploadedAt, dateFrom, dateTo)) continue;
          if (!hasRealThumbnail(item)) continue;
          seen.add(item.sourceUrl);
          items.push(item);
          if (items.length >= limit) break;
        }
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
        console.warn('[videos] TikTok Apify fallback failed:', e instanceof Error ? e.message : e);
      }
    }

    if (items.length === 0) throw new Error(crawlFailureMessage('TikTok', failures, 'keyword search returned no usable videos'));
    return sortByHeat(items).slice(0, limit);
  }

  async function readTikTokPublicApi(sourceUrl: string): Promise<TikTokPublicApiData> {
    const endpoint = String(process.env.TIKTOK_PUBLIC_DOWNLOAD_API || 'https://www.tikwm.com/api/').trim();
    const url = new URL(endpoint);
    url.searchParams.set('url', sourceUrl);
    url.searchParams.set('hd', '1');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': browserUserAgent(), Accept: 'application/json' } });
      const raw = await response.text();
      if (!response.ok) throw new Error(`TikTok public API HTTP ${response.status}`);
      const body = JSON.parse(raw) as { code?: number; msg?: string; data?: TikTokPublicApiData };
      if (body.code !== 0 || !body.data?.id) throw new Error(`TikTok public API rejected: ${String(body.msg || body.code || 'invalid_response')}`);
      return body.data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function crawlTikTokPublicApi(sourceUrl: string): Promise<CrawledVideo> {
    const data = await readTikTokPublicApi(sourceUrl);
    const uploadedAt = Number.isFinite(Number(data.create_time)) && Number(data.create_time) > 0
      ? new Date(Number(data.create_time) * 1000).toISOString() : undefined;
    return {
      platform: 'tiktok', title: String(data.title || `TikTok ${data.id}`).trim(), sourceUrl,
      thumbnailUrl: String(data.origin_cover || data.cover || '').trim(), duration: Number(data.duration || 0),
      views: compactNumber(Number(data.play_count || 0)), tags: [...String(data.title || '').matchAll(/#([^\s#]+)/g)].map(match => match[1]!).slice(0, 20),
      uploadedAt, dateEvidence: uploadedAt ? 'provider_create_time' : undefined,
      author: String(data.author?.nickname || data.author?.unique_id || '').trim() || undefined,
      likes: compactNumber(Number(data.digg_count || 0)), comments: compactNumber(Number(data.comment_count || 0)),
      shares: compactNumber(Number(data.share_count || 0)), plays: compactNumber(Number(data.play_count || 0)), source: 'tiktok-public-api',
    };
  }

  async function crawlTikTokApify(keyword: string, limit: number, dateFrom = '', dateTo = '', strictProviderLimit = false): Promise<CrawledVideo[]> {
    const token = process.env.APIFY_TOKEN?.trim();
    if (!token) throw new Error('APIFY_TOKEN is not configured');
    const actor = process.env.APIFY_TIKTOK_ACTOR?.trim() || 'clockworks/tiktok-scraper';
    // Manual collection keeps its video/slideshow oversampling. Approved weekly
    // discovery requests only its reserved item count from the paid actor.
    const input = buildApifyTikTokInput(keyword, apifyCandidateWindow(limit, 'tiktok', strictProviderLimit), dateFrom, dateTo);
    const runUrl = `https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items?clean=true&token=${encodeURIComponent(token)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.APIFY_TIMEOUT_MS || 120_000));
    try {
      const r = await fetch(runUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`Apify TikTok HTTP ${r.status}: ${text.slice(0, 300)}`);
      const data = JSON.parse(text) as unknown;
      const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [];
      return rows
        .map(item => apifyTikTokItemToCrawledVideo(item, keyword))
        .filter((item): item is CrawledVideo => Boolean(item))
        .slice(0, limit);
    } finally {
      clearTimeout(timer);
    }
  }

  async function crawlTikTokWithPaidPermit(accountUrl: string, limit: number, dateFrom: string, dateTo: string, permit: PaidApifyTikTokPermit): Promise<CrawledVideo[]> {
    const token = process.env.APIFY_TOKEN?.trim();
    if (!token) throw Error('apify_paid_credentials_required');
    const actor = process.env.APIFY_TIKTOK_ACTOR?.trim() || 'clockworks/tiktok-scraper';
    const rows = await runPaidApifyTikTokDataset({
      actorId: actor,
      actorInput: buildApifyTikTokInput(accountUrl, Math.max(1, limit), dateFrom, dateTo),
      permit,
      token,
      maxItems: Math.max(1, limit),
      timeoutMs: Number(process.env.APIFY_TIMEOUT_MS || 120_000),
      pollIntervalMs: Number(process.env.APIFY_POLL_INTERVAL_MS || 5_000),
    });
    return rows.map(item => apifyTikTokItemToCrawledVideo(item, accountUrl))
      .filter((item): item is CrawledVideo => Boolean(item)).slice(0, limit);
  }

  async function crawlInstagramWithApifyFallback(keyword: string, limit: number, dateFrom = '', dateTo = ''): Promise<CrawledVideo[]> {
    const input = keyword.trim();
    const directUrl = isPlatformUrl(input, 'instagram');
    const items: CrawledVideo[] = [];
    const failures: string[] = [];

    if (directUrl) {
      // 直链优先走 yt-dlp（配置了 cookie 文件即可，免 Apify 费用）；成功即返回，不再叠加 Apify。
      try {
        return [await crawlYtDlpMetadata('instagram', input, keyword)];
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
        console.warn('[videos] Instagram yt-dlp metadata failed, trying Apify:', e instanceof Error ? e.message : e);
      }
    }

    const seen = new Set(items.map(item => item.sourceUrl));
    if (items.length < limit && canUseApifyInstagramCrawlFallback()) {
      try {
        const apifyItems = await crawlInstagramApify(input, Math.max(limit - items.length, limit), dateFrom, dateTo);
        for (const item of apifyItems) {
          if (seen.has(item.sourceUrl)) continue;
          if (!directUrl && !isKeywordRelevant(item, input)) continue;
          if (!directUrl && !isWithinDateRange(item.uploadedAt, dateFrom, dateTo)) continue;
          if (!hasRealThumbnail(item)) continue;
          seen.add(item.sourceUrl);
          items.push(item);
          if (items.length >= limit) break;
        }
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
        console.warn('[videos] Instagram Apify fallback failed:', e instanceof Error ? e.message : e);
      }
    }

    if (items.length === 0) {
      throw new Error(crawlFailureMessage('Instagram', failures, '抓取无可用视频'));
    }
    return directUrl ? items.slice(0, limit) : sortByHeat(items).slice(0, limit);
  }

  async function crawlInstagramApify(keyword: string, limit: number, dateFrom = '', dateTo = ''): Promise<CrawledVideo[]> {
    const token = process.env.APIFY_TOKEN?.trim();
    if (!token) throw new Error('APIFY_TOKEN is not configured');
    const directUrl = isPlatformUrl(keyword.trim(), 'instagram');
    const actor = directUrl
      ? (process.env.APIFY_INSTAGRAM_ACTOR?.trim() || 'apify/instagram-scraper')
      : (process.env.APIFY_INSTAGRAM_SEARCH_ACTOR?.trim()
        || process.env.APIFY_INSTAGRAM_ACTOR?.trim()
        || 'apify/instagram-scraper');
    // Hashtag results mix image posts and Reels. Fetching exactly `limit` rows can
    // return only images which are correctly filtered below, leaving a false zero.
    // Oversample keyword searches, then keep the requested number of real videos.
    const fetchLimit = limit;
    const input = buildApifyInstagramInput(keyword, fetchLimit, dateFrom, dateTo);
    const rows = await runApifyActorDatasetItems(actor, input, Number(process.env.APIFY_TIMEOUT_MS || 240_000), 'Instagram crawl');
    return rows
      .map(item => apifyInstagramItemToCrawledVideo(item, keyword))
      .filter((item): item is CrawledVideo => Boolean(item))
      .slice(0, limit);
  }

  function buildApifyInstagramInput(keyword: string, limit: number, dateFrom = '', _dateTo = ''): Record<string, unknown> {
    const input = keyword.trim();
    const resultsLimit = Math.min(50, Math.max(1, limit));
    const base: Record<string, unknown> = {
      resultsType: 'reels',
      resultsLimit,
      addParentData: false,
    };
    if (isPlatformUrl(input, 'instagram')) {
      base.directUrls = [input];
      if (dateFrom) base.onlyPostsNewerThan = dateFrom;
    } else {
      // The actor's search mode currently redirects some English hashtags to an
      // unrelated localized tag page. Direct hashtag URLs are stable; fetch a
      // small page and apply the requested date window locally below.
      const tag = input.replace(/^#/, '').trim();
      base.directUrls = [`https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`];
    }
    return base;
  }

  async function crawlFacebookAccountApify(accountUrl: string, limit: number, dateFrom = '', dateTo = '', strictProviderLimit = false): Promise<CrawledVideo[]> {
    const token = process.env.APIFY_TOKEN?.trim();
    if (!token) throw new Error('APIFY_TOKEN is not configured');
    const actor = process.env.APIFY_FACEBOOK_ACTOR?.trim() || 'apify/facebook-posts-scraper';
    const input = buildApifyFacebookAccountInput(accountUrl, limit, strictProviderLimit);
    const rows = await runApifyActorDatasetItems(actor, input, Number(process.env.APIFY_TIMEOUT_MS || 240_000), 'Facebook account crawl');
    return rows
      .map(item => apifyFacebookPostToCrawledVideo(item, accountUrl))
      .filter((item): item is CrawledVideo => Boolean(item))
      .filter(item => isWithinDateRange(item.uploadedAt, dateFrom, dateTo))
      .slice(0, limit);
  }

  function buildApifyFacebookAccountInput(accountUrl: string, limit: number, strictProviderLimit = false): Record<string, unknown> {
    const resultsLimit = apifyCandidateWindow(limit, 'facebook', strictProviderLimit);
    return {
      startUrls: [{ url: accountUrl }],
      resultsLimit,
      maxPosts: resultsLimit,
    };
  }

  async function crawlFacebook(keyword: string, limit: number, dateFrom = '', dateTo = '', strictProviderLimit = false): Promise<CrawledVideo[]> {
    const input = keyword.trim();
    if (/^https?:\/\/(?:www\.|m\.|mbasic\.)?facebook\.com\//i.test(input)) {
      return [await crawlFacebookUrl(input, keyword)];
    }
    try {
      const publicItems = await crawlPublicSearch('facebook', input, limit, dateFrom, dateTo);
      if (publicItems.length > 0) return publicItems;
    } catch (publicError) {
      if (!canUseApifyFacebookCrawlFallback()) throw publicError;
    }
    if (!canUseApifyFacebookCrawlFallback()) throw new Error(`Facebook public search returned no videos for: ${input}`);
    const pageUrl = await discoverFacebookPageUrl(input);
    return crawlFacebookAccountApify(pageUrl, limit, dateFrom, dateTo, strictProviderLimit);
  }

  async function crawlFacebookUrl(url: string, keyword: string): Promise<CrawledVideo> {
    try {
      return await crawlYtDlpMetadata('facebook', url, keyword);
    } catch {
      // Fall back to lightweight OG parsing for public pages where yt-dlp cannot parse.
    }
    const html = await fetchFacebookHtml(url);
    const title = decodeHtml(extractMeta(html, 'og:title') || extractTitle(html) || 'Facebook video');
    const sourceUrl = decodeHtml(extractMeta(html, 'og:url') || url);
    const thumbnailUrl = decodeHtml(extractMeta(html, 'og:image') || '');
    const views = extractFacebookViews(title) || 'Facebook';

    return {
      platform: 'facebook',
      title: cleanupFacebookTitle(title),
      sourceUrl,
      thumbnailUrl,
      duration: 0,
      views,
      tags: tagsFromKeyword(keyword, 'facebook'),
    };
  }

  return { crawlSocialUrlOrFallback, crawlTikTokWithApifyFallback, readTikTokPublicApi, crawlTikTokApify, crawlTikTokWithPaidPermit, crawlInstagramWithApifyFallback, crawlInstagramApify, crawlFacebookAccountApify, buildApifyFacebookAccountInput, crawlFacebook };
}
