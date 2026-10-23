import { compactNumber, firstImageUrl } from '../routes/videoCrawlerProviderProjection.js';
import { metaToCrawledVideo, normalizeCrawledVideo, thumbnailForPlatform } from '../routes/videoCrawlerPublicProjection.js';
import { crawlYouTubePublicSearch, searchPublicVideoUrls } from '../routes/videoCrawlerPublicDiscovery.js';
import { tiktokKeywordSources, verifiedKeywordSeedItems, verifiedSeedUrls } from '../routes/videoCrawlerSeedCatalog.js';
import { canonicalSourceUrl } from '../routes/videoCrawlerSourceUrls.js';
import { usesServerCookiesForCrawl } from '../routes/videoCrawlerRuntimeConfig.js';
import type { Platform } from '../types/index.js';
import { isDiscoveryVideoEligible } from '../../shared/contracts/discoveryVideoPolicy.js';
import { extractFacebookWatchUrls, hasRealThumbnail, isGenericSocialTitle, isKeywordRelevant, isWithinDateRange, metadataCreatorAccount, metadataTitle, metadataUploader, tagsFromKeyword, uploadedAtFromMeta, videoDedupeKey, ytdlpDateArgs, type CrawledVideo } from '../routes/videoCrawlerNormalization.js';
import { execFileAsync } from './runtimeConfig.js';
import type { VideoApplicationPorts } from './applicationPorts.js';

export function createVideoDiscoverySearch(deps: Pick<VideoApplicationPorts, 'ytDlpPythonPath' | 'buildYtDlpArgs' | 'crawlerExecEnv' | 'execYtDlpWithCookieFallback'>) {
  const ytDlpPythonPath: VideoApplicationPorts['ytDlpPythonPath'] = (...args) => deps.ytDlpPythonPath(...args);
  const buildYtDlpArgs: VideoApplicationPorts['buildYtDlpArgs'] = (...args) => deps.buildYtDlpArgs(...args);
  const crawlerExecEnv: VideoApplicationPorts['crawlerExecEnv'] = (...args) => deps.crawlerExecEnv(...args);
  const execYtDlpWithCookieFallback: VideoApplicationPorts['execYtDlpWithCookieFallback'] = (...args) => deps.execYtDlpWithCookieFallback(...args);

  const crawlPacingQueues = new Map<string, Promise<void>>();

  const CRAWL_MIN_INTERVAL_MS = Number(process.env.CRAWLER_MIN_INTERVAL_MS || 3000);

  const CRAWL_JITTER_MS = Number(process.env.CRAWLER_JITTER_MS || 4000);

  async function withPlatformCrawlPacing<T>(platform: string, task: () => Promise<T>): Promise<T> {
    const prev = crawlPacingQueues.get(platform) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    crawlPacingQueues.set(platform, prev.then(() => gate));
    await prev;
    try {
      return await task();
    } finally {
      setTimeout(release, CRAWL_MIN_INTERVAL_MS + Math.random() * CRAWL_JITTER_MS);
    }
  }

  async function crawlYtDlpMetadata(platform: Platform, url: string, keyword: string): Promise<CrawledVideo> {
    return withPlatformCrawlPacing(platform, () => crawlYtDlpMetadataNow(platform, url, keyword));
  }

  async function crawlYtDlpMetadataNow(platform: Platform, url: string, keyword: string): Promise<CrawledVideo> {
    let stdout = '';
    try {
      ({ stdout } = await execFileAsync(ytDlpPythonPath(), buildYtDlpArgs(['--dump-json', '--skip-download'], url, false), { maxBuffer: 8 * 1024 * 1024, timeout: 45_000, env: crawlerExecEnv() }));
    } catch {
      if (!usesServerCookiesForCrawl(platform)) throw new Error(`${platform} anonymous metadata crawl failed`);
      stdout = await execYtDlpWithCookieFallback(['--dump-json', '--skip-download'], url, 60_000, 8 * 1024 * 1024);
    }
    const line = stdout.split('\n').find(Boolean);
    if (!line) throw new Error(`${platform} returned empty metadata`);
    const meta = JSON.parse(line) as Record<string, unknown>;
    const webpageUrl = canonicalSourceUrl(platform, String(meta.webpage_url || meta.original_url || meta.url || url), metadataUploader(meta));
    const title = metadataTitle(platform, meta);
    const thumbnail = thumbnailForPlatform(platform, webpageUrl, firstImageUrl([meta.thumbnails, meta.thumbnail, meta]));
    const duration = Number(meta.duration || 0);
    const uploadedAt = uploadedAtFromMeta(meta);
    const views = typeof meta.view_count === 'number' ? compactNumber(meta.view_count) : platform;
    const tags = Array.isArray(meta.tags)
      ? meta.tags.filter((t): t is string => typeof t === 'string').slice(0, 5)
      : [];
    return normalizeCrawledVideo({ platform, title, sourceUrl: webpageUrl, thumbnailUrl: thumbnail, duration, views, tags, uploadedAt,sourceAccountUrl:metadataCreatorAccount(platform,meta) });
  }

  async function crawlYouTubeSearch(keyword: string, limit: number, dateFrom = '', dateTo = ''): Promise<CrawledVideo[]> {
    return crawlYouTubePublicSearch({ keyword, limit, dateFrom, dateTo, crawlFlatSearch: crawlYtDlpSearch });
  }

  async function crawlYtDlpSearch(platform: Platform, searchUrl: string, keyword: string, limit: number, dateFrom = '', dateTo = '', youtubeShortsSource = false): Promise<CrawledVideo[]> {
    const dateArgs = ytdlpDateArgs(dateFrom, dateTo);
    const { stdout } = await withPlatformCrawlPacing(platform, () => execFileAsync(ytDlpPythonPath(), buildYtDlpArgs(['--dump-json', '--flat-playlist', '--playlist-end', String(limit), ...dateArgs], searchUrl, false), {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 45_000,
      env: crawlerExecEnv(),
    }));
    const items = stdout.split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line) as Record<string, unknown>)
      .map(metaToCrawledVideo(platform, keyword, youtubeShortsSource))
      .filter((item): item is CrawledVideo => Boolean(item));
    if (items.length === 0) throw new Error(`${platform} search returned no videos`);
    return items.slice(0, limit);
  }

  async function crawlPublicSearch(platform: Platform, keyword: string, limit: number, dateFrom = '', dateTo = ''): Promise<CrawledVideo[]> {
    const candidates = await searchPublicVideoUrls(platform, keyword, Math.max(limit * 3, 12));
    const items: CrawledVideo[] = [];
    const errors: string[] = [];
    for (const url of candidates) {
      try {
        const item = await crawlYtDlpMetadata(platform, url, keyword);
        if (isKeywordRelevant(item, keyword) && isWithinDateRange(item.uploadedAt, dateFrom, dateTo) && hasRealThumbnail(item)) items.push(item);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
      if (items.length >= limit) break;
    }
    if (items.length < limit) {
      const fallbackItems = await crawlKeywordFallbackPool(platform, keyword, limit - items.length, new Set(items.map(item => item.sourceUrl)), dateFrom, dateTo);
      items.push(...fallbackItems);
    }
    if (items.length === 0) {
      throw new Error(errors[0] || `${platform} keyword search did not expose public video URLs`);
    }
    return items.slice(0, limit);
  }

  async function crawlVerifiedPublicSources(platform: Platform, keyword: string, limit: number): Promise<CrawledVideo[]> {
    if (platform === 'tiktok') {
      return crawlYtDlpSearch('tiktok', pickTikTokSource(keyword), keyword, limit);
    }
    if (platform === 'facebook' || platform === 'instagram') {
      return crawlPublicSearch(platform, keyword, limit);
    }

    const seeds = verifiedSeedUrls(platform, keyword).slice(0, Math.max(1, limit));
    const items: CrawledVideo[] = [];
    const errors: string[] = [];
    for (const url of seeds) {
      try {
        items.push(await crawlYtDlpMetadata(platform, url, keyword));
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
      if (items.length >= limit) break;
    }
    if (items.length === 0) throw new Error(errors[0] || `${platform} verified public sources returned no videos`);
    return items;
  }

  function pickTikTokSource(keyword: string): string {
    const normalized = keyword.toLowerCase();
    if (normalized.includes('home') || normalized.includes('amazon') || normalized.includes('gadget')) {
      return 'tiktokuser:MS4wLjABAAAAr3NGz5igiD2kKCB-gnrNbB0TSfd4ScfTrgVOHqFor0lZfeVtDObaCXsugZMD5MDb';
    }
    return 'tiktokuser:MS4wLjABAAAAr3NGz5igiD2kKCB-gnrNbB0TSfd4ScfTrgVOHqFor0lZfeVtDObaCXsugZMD5MDb';
  }

  async function crawlKeywordFallbackPool(platform: Platform, keyword: string, limit: number, excluded = new Set<string>(), dateFrom = '', dateTo = ''): Promise<CrawledVideo[]> {
    if (limit <= 0) return [];
    if (platform === 'tiktok') return crawlTikTokKeywordFallback(keyword, limit, excluded, dateFrom, dateTo);
    return [];
  }

  async function topUpCrawledItems(input: {
    platform: Platform;
    keyword: string;
    target: number;
    items: CrawledVideo[];
    dateFrom: string;
    dateTo: string;
  }): Promise<CrawledVideo[]> {
    const out = [...input.items];
    const seen = new Set(out.map(item => videoDedupeKey(item)));
    const add = (candidates: CrawledVideo[], dateEvidence: string) => {
      for (const candidate of candidates.map(normalizeCrawledVideo)) {
        if (!isDiscoveryVideoEligible(candidate)) continue;
        const key = videoDedupeKey(candidate);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...candidate, dateEvidence: candidate.dateEvidence || dateEvidence });
        if (out.length >= input.target) break;
      }
    };

    try {
      const strict = await crawlKeywordFallbackPool(
        input.platform,
        input.keyword,
        input.target - out.length,
        new Set(out.map(item => item.sourceUrl)),
        input.dateFrom,
        input.dateTo,
      );
      add(strict, 'fallback-strict');
    } catch (e) {
      console.warn(`[videos] ${input.platform} strict top-up failed:`, e instanceof Error ? e.message : e);
    }

    if (out.length < input.target) {
      try {
        const relaxed = await crawlKeywordFallbackPool(
          input.platform,
          input.keyword,
          input.target - out.length,
          new Set(out.map(item => item.sourceUrl)),
          '',
          '',
        );
        add(relaxed, 'fallback-relaxed');
      } catch (e) {
        console.warn(`[videos] ${input.platform} relaxed top-up failed:`, e instanceof Error ? e.message : e);
      }
    }

    return out.slice(0, Math.max(input.target, input.items.length));
  }

  async function crawlSeedMetadataFallback(platform: Platform, keyword: string, limit: number, excluded = new Set<string>(), dateFrom = '', dateTo = ''): Promise<CrawledVideo[]> {
    const seeds = verifiedKeywordSeedItems(platform, keyword)
      .filter(item => !excluded.has(item.sourceUrl))
      .filter(item => isKeywordRelevant(item, keyword))
      .filter(item => platform === 'tiktok' || isWithinDateRange(item.uploadedAt, dateFrom, dateTo));
    const out: CrawledVideo[] = [];
    for (const seed of seeds) {
      try {
        const item = await crawlYtDlpMetadata(platform, seed.sourceUrl, keyword);
        const enrichedItem = {
          ...item,
          title: item.title && !isGenericSocialTitle(item.title, platform) ? item.title : seed.title,
          tags: item.tags.length > 0 ? item.tags : seed.tags,
          uploadedAt: item.uploadedAt || seed.uploadedAt,
        };
        if (!isKeywordRelevant(enrichedItem, keyword)) continue;
        if (!isWithinDateRange(enrichedItem.uploadedAt, dateFrom, dateTo)) continue;
        if (!hasRealThumbnail(enrichedItem)) continue;
        out.push(enrichedItem);
      } catch (e) {
        console.warn(`[videos] ${platform} seed metadata failed (${seed.sourceUrl}):`, e);
      }
      if (out.length >= limit) break;
    }
    return out;
  }

  async function crawlTikTokKeywordFallback(keyword: string, limit: number, excluded = new Set<string>(), dateFrom = '', dateTo = ''): Promise<CrawledVideo[]> {
    const sources = tiktokKeywordSources(keyword);
    const out: CrawledVideo[] = [];
    const seen = new Set<string>(excluded);

    for (const source of sources) {
      try {
        const sourceLimit = Math.min(36, Math.max(limit * 2, 12));
        const items = await crawlYtDlpSearch('tiktok', source, keyword, sourceLimit, dateFrom, dateTo);
        for (const item of items) {
          if (seen.has(item.sourceUrl) || !isKeywordRelevant(item, keyword) || !isWithinDateRange(item.uploadedAt, dateFrom, dateTo) || !hasRealThumbnail(item)) continue;
          seen.add(item.sourceUrl);
          out.push(item);
          if (out.length >= limit) return out;
        }
      } catch (e) {
        console.warn(`[videos] TikTok fallback source failed (${source}):`, e);
      }
    }

    return out.slice(0, limit);
  }

  async function crawlFacebookSearch(keyword: string, limit: number): Promise<CrawledVideo[]> {
    const url = `https://www.facebook.com/search/videos?q=${encodeURIComponent(keyword)}`;
    const html = await fetchFacebookHtml(url);
    const candidates = extractFacebookWatchUrls(html);

    const out: CrawledVideo[] = [];
    const tags = tagsFromKeyword(keyword, 'facebook');
    for (const sourceUrl of candidates.slice(0, limit)) {
      out.push({
        platform: 'facebook',
        title: `Facebook video result for ${keyword}`,
        sourceUrl,
        thumbnailUrl: '',
        duration: 0,
        views: 'Facebook',
        tags,
      });
    }

    if (out.length === 0) throw new Error('Facebook public search did not expose parseable video results without login');
    return out;
  }

  async function fetchFacebookHtml(url: string): Promise<string> {
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
    const args = [
      '-s',
      '-L',
      '--max-time',
      '20',
      '--noproxy',
      '*',
      '-A',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36',
    ];
    if (proxy) args.push('-x', proxy);
    args.push(url);
    const { stdout } = await execFileAsync('curl', args, { maxBuffer: 4 * 1024 * 1024, env: crawlerExecEnv() });
    if (!stdout || stdout.length < 500) throw new Error('Facebook returned an empty page');
    return stdout;
  }

  return { crawlYtDlpMetadata, crawlYouTubeSearch, crawlYtDlpSearch, crawlPublicSearch, topUpCrawledItems, fetchFacebookHtml };
}
