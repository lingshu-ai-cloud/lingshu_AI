import { publicVideoRecord } from '../routes/videoPublicRecordProjection.js';
import { accountLabelFromUrl, looksLikeAccountUrl } from '../routes/videoCrawlerSourceUrls.js';
import { type CrawledImagePost } from '../socialDiscovery/imagePostEvidenceAnalysis.js';
import { importNewImagePost } from '../socialDiscovery/imagePostImport.js';
import { refreshExistingImagePost } from '../socialDiscovery/imagePostRefresh.js';
import { runConfiguredLinkedInCompanyPaidCollection, type LinkedInCompanyPaidPermit } from '../routes/linkedinCompanyPostPaidCollection.js';
import { store } from '../storage/index.js';
import type { Platform } from '../types/index.js';
import { videoAnalysisOf } from '../lib/videoAnalysisCodec.js';
import { hasDateRange, isPlatformUrl, isWithinDateRange } from '../routes/videoCrawlerNormalization.js';
import { COL, DEFAULT_CRAWL_KEYWORDS } from './runtimeConfig.js';
import type { CrawlVideosResult } from './contracts.js';
import type { VideoApplicationPorts } from './applicationPorts.js';

export function createImagePostCollectionApplication(deps: Pick<VideoApplicationPorts, 'crawlInstagramImagePostsApify' | 'crawlTikTokImagePostsApify' | 'crawlFacebookImagePostsApify' | 'crawlYouTubeCommunityPostsPublicSearch' | 'imagePostRelevant' | 'persistImagePostThumbnail' | 'persistImagePostImages' | 'analyzeImagePostBestEffort' | 'queueImagePostAnalysis'>) {
  const crawlInstagramImagePostsApify: VideoApplicationPorts['crawlInstagramImagePostsApify'] = (...args) => deps.crawlInstagramImagePostsApify(...args);
  const crawlTikTokImagePostsApify: VideoApplicationPorts['crawlTikTokImagePostsApify'] = (...args) => deps.crawlTikTokImagePostsApify(...args);
  const crawlFacebookImagePostsApify: VideoApplicationPorts['crawlFacebookImagePostsApify'] = (...args) => deps.crawlFacebookImagePostsApify(...args);
  const crawlYouTubeCommunityPostsPublicSearch: VideoApplicationPorts['crawlYouTubeCommunityPostsPublicSearch'] = (...args) => deps.crawlYouTubeCommunityPostsPublicSearch(...args);
  const imagePostRelevant: VideoApplicationPorts['imagePostRelevant'] = (...args) => deps.imagePostRelevant(...args);
  const persistImagePostThumbnail: VideoApplicationPorts['persistImagePostThumbnail'] = (...args) => deps.persistImagePostThumbnail(...args);
  const persistImagePostImages: VideoApplicationPorts['persistImagePostImages'] = (...args) => deps.persistImagePostImages(...args);
  const analyzeImagePostBestEffort: VideoApplicationPorts['analyzeImagePostBestEffort'] = (...args) => deps.analyzeImagePostBestEffort(...args);
  const queueImagePostAnalysis: VideoApplicationPorts['queueImagePostAnalysis'] = (...args) => deps.queueImagePostAnalysis(...args);

  async function crawlImagePostsForTenant(input: {
    tenantId: string;
    platform: Platform;
    keyword?: string;
    limit: number;
    mode?: 'keyword' | 'account';
    accountUrl?: string;
    accountName?: string;
    dateFrom?: string;
    dateTo?: string;
    deferImageAnalysis?: boolean;
    /** Trusted worker-issued grant. Ordinary HTTP image crawl never sets this. */
    linkedInPaidCollection?: { runId: string; permit: LinkedInCompanyPaidPermit };
  }): Promise<CrawlVideosResult> {
    if (input.platform === 'linkedin' && (!input.linkedInPaidCollection || input.mode !== 'account'
      || !looksLikeAccountUrl(input.accountUrl ?? '', 'linkedin'))) {
      throw Error('linkedin_company_paid_collection_permit_required');
    }
    if (input.linkedInPaidCollection && input.platform !== 'linkedin') throw Error('linkedin_company_paid_collection_scope_mismatch');
    const target = Math.min(30, Math.max(1, Number(input.limit) || 5));
    const accountMode = input.mode === 'account' && looksLikeAccountUrl(input.accountUrl ?? '', input.platform);
    const accountUrl = accountMode ? String(input.accountUrl).trim() : '';
    const keyword = accountMode
      ? String(input.accountName || accountLabelFromUrl(accountUrl)).trim()
      : String(input.keyword || DEFAULT_CRAWL_KEYWORDS).trim();
    const dateFrom = String(input.dateFrom || '');
    const dateTo = String(input.dateTo || '');
    let items: CrawledImagePost[] = [];
    let crawlerMessage = '';
    const crawlerSource = `${input.platform}-image-${accountMode ? 'account' : 'search'}`;

    try {
      const safeLimit = Math.max(target * 4, target, 12);
      if (input.platform === 'linkedin') {
        const approved = input.linkedInPaidCollection!;
        const result = await runConfiguredLinkedInCompanyPaidCollection({ tenantId: input.tenantId,
          runId: approved.runId, companyUrl: accountUrl, limit: target, dateFrom, dateTo }, approved.permit);
        items = result.images;
      } else if (input.platform === 'instagram') {
        items = await crawlInstagramImagePostsApify(keyword, safeLimit, accountUrl);
      } else if (input.platform === 'tiktok') {
        items = await crawlTikTokImagePostsApify(keyword, safeLimit, accountUrl, dateFrom, dateTo);
      } else if (input.platform === 'facebook') {
        items = await crawlFacebookImagePostsApify(accountUrl || keyword, safeLimit);
      } else if (input.platform === 'youtube') {
        items = await crawlYouTubeCommunityPostsPublicSearch(keyword, safeLimit, accountUrl);
      }
      items = items
        .filter(item => item.platform === input.platform && isPlatformUrl(item.sourceUrl, input.platform))
        .filter(item => accountMode || imagePostRelevant(item, keyword));
      if (hasDateRange(dateFrom, dateTo)) items = items.filter(item => isWithinDateRange(item.uploadedAt, dateFrom, dateTo));
    } catch (e) {
      if (input.platform === 'linkedin') throw e;
      crawlerMessage = e instanceof Error
        ? `${input.platform} 图文采集未找到可入库内容：${e.message}`
        : `${input.platform} 图文采集未找到可入库内容`;
      console.warn(`[videos] ${input.platform} image post crawl degraded:`, e);
      items = [];
    }

    const seen = new Set<string>();
    const orderedItems = items
      .filter(item => {
        if (seen.has(item.sourceUrl)) return false;
        seen.add(item.sourceUrl);
        return true;
      })
      .slice(0, target);

    let imported = 0;
    let skipped = 0;
    let skippedExisting = 0;
    const records: unknown[] = [];
    const existingRecords: unknown[] = [];

    for (const item of orderedItems) {
      const existingByUrl = await store.list(COL, {
        where: { tenantId: input.tenantId, sourceUrl: item.sourceUrl },
        page: 1,
        perPage: 1,
      });
      const existingRecord = existingByUrl.items[0] as Record<string, unknown> | undefined;
      if (existingRecord) {
        skipped += 1;
        skippedExisting += 1;
        if (['queued', 'processing', 'unknown'].includes(String(videoAnalysisOf(existingRecord).imageAnalysisQueueState || ''))) {
          existingRecords.push(existingRecord);
          continue;
        }
        const refreshed = await refreshExistingImagePost({
          store, collection: COL, tenantId: input.tenantId, existingRecord, item, keyword,
          accountMode, accountUrl, deferImageAnalysis: Boolean(input.deferImageAnalysis),
          persistThumbnail: persistImagePostThumbnail, persistImages: persistImagePostImages,
          analyze: analyzeImagePostBestEffort, queue: queueImagePostAnalysis,
        });
        existingRecords.push(refreshed);
        continue;
      }

      const record = await importNewImagePost({
        store, collection: COL, tenantId: input.tenantId, item, keyword, crawlerSource,
        accountMode, accountUrl, deferImageAnalysis: Boolean(input.deferImageAnalysis),
        persistThumbnail: persistImagePostThumbnail, persistImages: persistImagePostImages,
        analyze: analyzeImagePostBestEffort, queue: queueImagePostAnalysis,
      });
      if (record) {
        imported += 1;
        records.push(record);
      }
      if (imported >= target) break;
    }

    const resultRecords = [...records, ...existingRecords].slice(0, target);
    return {
      platform: input.platform,
      keyword,
      imported,
      refreshed: 0,
      skipped,
      skippedExisting,
      returnedExisting: Math.max(0, resultRecords.length - records.length),
      requested: target,
      total: items.length,
      source: crawlerSource,
      message: crawlerMessage || (resultRecords.length
        ? `${accountMode ? '主页图文' : '图文'}采集完成：返回 ${resultRecords.length} 条（新增 ${imported} 条，库内已有 ${Math.max(0, resultRecords.length - records.length)} 条）`
        : `图文采集完成：未找到可入库图文，请换关键词或平台账号主页`),
      items: resultRecords.map(record => publicVideoRecord(record as Record<string, unknown>)),
    };
  }

  return { crawlImagePostsForTenant };
}
