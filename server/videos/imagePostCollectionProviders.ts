import { cleanupAnalysisTitle } from '../routes/videoCrawlerProviderProjection.js';
import { apifyFacebookPostToImagePost, apifyInstagramItemToImagePost, apifyTikTokItemToImagePost } from '../routes/videoCrawlerImageProjection.js';
import { cleanSearchResultUrl } from '../routes/videoCrawlerPublicProjection.js';
import { fetchPublicText as fetchText } from '../routes/videoCrawlerPublicDiscovery.js';
import { accountLabelFromUrl, stripTrackingParams } from '../routes/videoCrawlerSourceUrls.js';
import { type CrawledImagePost } from '../socialDiscovery/imagePostEvidenceAnalysis.js';
import { buildApifyTikTokInput } from '../routes/apifyTikTokInput.js';
import { decodeHtml, isPlatformUrl, tagsFromKeyword } from '../routes/videoCrawlerNormalization.js';

import type { VideoApplicationPorts } from './applicationPorts.js';

export function createImagePostCollectionProviders(deps: Pick<VideoApplicationPorts, 'runApifyActorDatasetItems'>) {
  const runApifyActorDatasetItems: VideoApplicationPorts['runApifyActorDatasetItems'] = (...args) => deps.runApifyActorDatasetItems(...args);

  async function crawlInstagramImagePostsApify(keyword: string, limit: number, accountUrl = ''): Promise<CrawledImagePost[]> {
    const token = process.env.APIFY_TOKEN?.trim();
    if (!token) throw new Error('APIFY_TOKEN is not configured');
    const actor = process.env.APIFY_INSTAGRAM_ACTOR?.trim() || 'apify/instagram-scraper';
    const cleanKeyword = keyword.replace(/^#/, '').trim();
    const rows = await runApifyActorDatasetItems(actor, {
      directUrls: [accountUrl || `https://www.instagram.com/explore/tags/${encodeURIComponent(cleanKeyword)}/`],
      resultsType: 'posts',
      resultsLimit: Math.min(50, Math.max(limit * 4, limit, 12)),
      addParentData: false,
    }, Number(process.env.APIFY_TIMEOUT_MS || 240_000), 'Instagram image posts');
    return rows
      .map(item => apifyInstagramItemToImagePost(item, keyword))
      .filter((item): item is CrawledImagePost => Boolean(item))
      .slice(0, limit);
  }

  async function crawlTikTokImagePostsApify(keyword: string, limit: number, accountUrl = '', dateFrom = '', dateTo = ''): Promise<CrawledImagePost[]> {
    const token = process.env.APIFY_TOKEN?.trim();
    if (!token) throw new Error('APIFY_TOKEN is not configured');
    const actor = process.env.APIFY_TIKTOK_ACTOR?.trim() || 'clockworks/tiktok-scraper';
    const input = {
      ...buildApifyTikTokInput(accountUrl || keyword, limit, dateFrom, dateTo),
      shouldDownloadSlideshowImages: true,
    };
    const rows = await runApifyActorDatasetItems(actor, input, Number(process.env.APIFY_TIMEOUT_MS || 240_000), 'TikTok image posts');
    return rows
      .map(item => apifyTikTokItemToImagePost(item, keyword))
      .filter((item): item is CrawledImagePost => Boolean(item))
      .slice(0, limit);
  }

  async function crawlFacebookImagePostsApify(keyword: string, limit: number): Promise<CrawledImagePost[]> {
    const token = process.env.APIFY_TOKEN?.trim();
    if (!token) throw new Error('APIFY_TOKEN is not configured');
    const actor = process.env.APIFY_FACEBOOK_ACTOR?.trim() || 'apify/facebook-posts-scraper';
    const inputUrl = isPlatformUrl(keyword, 'facebook')
      ? keyword
      : await discoverFacebookPageUrl(keyword);
    const rows = await runApifyActorDatasetItems(actor, {
      startUrls: [{ url: inputUrl }],
      resultsLimit: Math.min(50, Math.max(limit * 4, 10)),
      maxPosts: Math.min(50, Math.max(limit * 4, 10)),
    }, Number(process.env.APIFY_TIMEOUT_MS || 240_000), 'Facebook image posts');
    const mapped = rows
      .map(item => apifyFacebookPostToImagePost(item, keyword))
      .filter((item): item is CrawledImagePost => Boolean(item))
      .slice(0, limit);
    if (mapped.length > 0) return mapped;
    return crawlFacebookImagePostsPublicSearch(keyword, limit);
  }

  async function discoverFacebookPageUrl(keyword: string): Promise<string> {
    const actor = process.env.APIFY_FACEBOOK_SEARCH_ACTOR?.trim() || 'apify/facebook-search-scraper';
    const rows = await runApifyActorDatasetItems(actor, {
      categories: [keyword.trim()],
      resultsLimit: 1,
    }, Number(process.env.APIFY_TIMEOUT_MS || 240_000), 'Facebook page search');
    const pageUrl = String(rows[0]?.pageUrl || rows[0]?.facebookUrl || rows[0]?.url || '').trim();
    if (!isPlatformUrl(pageUrl, 'facebook')) throw new Error(`Facebook page search returned no public page for: ${keyword}`);
    return stripTrackingParams(pageUrl);
  }

  async function crawlFacebookImagePostsPublicSearch(keyword: string, limit: number): Promise<CrawledImagePost[]> {
    const query = `site:facebook.com "${keyword}" ("/photos/" OR "photo" OR "/posts/")`;
    const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
    const xml = await fetchText(url, 20_000);
    const items: CrawledImagePost[] = [];
    const seen = new Set<string>();
    for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
      const block = match[1] || '';
      const link = cleanSearchResultUrl(decodeHtml(block.match(/<link>([^<]+)<\/link>/i)?.[1] || '').trim());
      if (!link || !isPlatformUrl(link, 'facebook') || /\/(?:search|watch|reel|videos)\b/i.test(link) || seen.has(link)) continue;
      seen.add(link);
      const title = decodeHtml(block.match(/<title>([^<]+)<\/title>/i)?.[1] || '').trim();
      items.push({
        platform: 'facebook',
        title: cleanupAnalysisTitle(title || `Facebook image post: ${keyword}`),
        sourceUrl: link,
        thumbnailUrl: '',
        caption: title,
        imageUrls: [],
        views: 'Facebook',
        tags: tagsFromKeyword(keyword, 'facebook'),
        source: 'public-search-image',
      });
      if (items.length >= limit) break;
    }
    if (items.length === 0) throw new Error('Facebook public search did not expose image posts for this keyword');
    return items;
  }

  async function crawlYouTubeCommunityPostsPublicSearch(keyword: string, limit: number, accountUrl = ''): Promise<CrawledImagePost[]> {
    const account = accountUrl ? accountLabelFromUrl(accountUrl) : '';
    const query = `site:youtube.com/post "${account || keyword}"`;
    const url = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
    const xml = await fetchText(url, 20_000);
    const items: CrawledImagePost[] = [];
    const seen = new Set<string>();
    const itemMatches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
    for (const match of itemMatches) {
      const block = match[1] || '';
      const link = cleanSearchResultUrl(decodeHtml(block.match(/<link>([^<]+)<\/link>/i)?.[1] || '').trim());
      if (!link || !isPlatformUrl(link, 'youtube') || !/\/post\//i.test(link) || seen.has(link)) continue;
      seen.add(link);
      const title = decodeHtml(block.match(/<title>([^<]+)<\/title>/i)?.[1] || '').trim();
      items.push({
        platform: 'youtube',
        title: cleanupAnalysisTitle(title || `YouTube Community post: ${keyword}`),
        sourceUrl: link,
        thumbnailUrl: '',
        caption: title,
        imageUrls: [],
        views: 'YouTube',
        tags: tagsFromKeyword(keyword, 'youtube'),
        source: 'public-search-image',
      });
      if (items.length >= limit) break;
    }
    if (items.length === 0) throw new Error('YouTube Community posts are not exposed reliably by public search');
    return items;
  }

  function imagePostRelevant(item: CrawledImagePost, keyword: string): boolean {
    const clean = keyword.trim().toLowerCase();
    if (!clean || /^https?:\/\//i.test(clean)) return true;
    const text = `${item.title} ${item.tags.join(' ')}`.toLowerCase();
    return clean.split(/\s+/).some(token => token.length > 1 && text.includes(token.replace(/^#/, '')));
  }

  return { crawlInstagramImagePostsApify, crawlTikTokImagePostsApify, crawlFacebookImagePostsApify, discoverFacebookPageUrl, crawlYouTubeCommunityPostsPublicSearch, imagePostRelevant };
}
