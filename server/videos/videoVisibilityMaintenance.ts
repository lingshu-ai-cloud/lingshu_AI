import { firstImageUrl, normalizeThumbnailUrl } from '../routes/videoCrawlerProviderProjection.js';
import { normalizeCrawledVideo, thumbnailForPlatform } from '../routes/videoCrawlerPublicProjection.js';
import { metadataFallbackAnalysis } from '../routes/videoCrawlerMetadataFallback.js';
import { analysisQueuePositions, publicVideoRecord, recordMatchesKeyword } from '../routes/videoPublicRecordProjection.js';
import { isPublicTestTenantVideo, recordContentFormat } from '../routes/videoRecordVisibility.js';
import { isExpiredSignedThumbnail, isSignedExpiringThumbnail } from '../routes/videoThumbnailPersistence.js';
import { compactVideoPipelineError } from '../routes/videoAnalysisRecovery.js';
import { canonicalSourceUrl, youtubeThumbnailFromUrl } from '../routes/videoCrawlerSourceUrls.js';
import { store } from '../storage/index.js';
import type { Platform, VideoStatus } from '../types/index.js';
import { isDemoMode } from '../lib/demo.js';
import { recordVideoAdminAlert } from '../lib/videoAdminAlerts.js';
import { signAssetUrl } from '../lib/assetAccess.js';
import { localFallbacksEnabled } from '../lib/localFallbackPolicy.js';
import { currentDataAuthority } from '../storage/dataAuthority.js';
import { videoAnalysisOf } from '../lib/videoAnalysisCodec.js';
import { isDiscoveryVideoEligible } from '../../shared/contracts/discoveryVideoPolicy.js';
import { hasRealThumbnail, inferPlatformFromUrl, isKeywordRelevant, isPlatformUrl, isWithinDateRange, parseJsonRecord, sortByHeat, type CrawledVideo } from '../routes/videoCrawlerNormalization.js';
import { COL, DEFAULT_CRAWL_KEYWORDS } from './runtimeConfig.js';
import type { TestTenantVideoBackfillInput } from './contracts.js';
import type { VideoApplicationPorts } from './applicationPorts.js';

export function createVideoVisibilityMaintenance(deps: Pick<VideoApplicationPorts, 'crawlYouTubeSearch' | 'crawlTikTokWithApifyFallback' | 'crawlInstagramWithApifyFallback' | 'crawlSocialUrlOrFallback' | 'analyzeSourceVideoJob' | 'shouldQueueVideoAnalysis' | 'queueAnalyzeSource' | 'runApifyActorDatasetItems' | 'isMissingLocalThumbnail' | 'cacheThumbnailLocally' | 'crawlYtDlpMetadata' | 'downloadMaterialJob'>) {
  const crawlYouTubeSearch: VideoApplicationPorts['crawlYouTubeSearch'] = (...args) => deps.crawlYouTubeSearch(...args);
  const crawlTikTokWithApifyFallback: VideoApplicationPorts['crawlTikTokWithApifyFallback'] = (...args) => deps.crawlTikTokWithApifyFallback(...args);
  const crawlInstagramWithApifyFallback: VideoApplicationPorts['crawlInstagramWithApifyFallback'] = (...args) => deps.crawlInstagramWithApifyFallback(...args);
  const crawlSocialUrlOrFallback: VideoApplicationPorts['crawlSocialUrlOrFallback'] = (...args) => deps.crawlSocialUrlOrFallback(...args);
  const analyzeSourceVideoJob: VideoApplicationPorts['analyzeSourceVideoJob'] = (...args) => deps.analyzeSourceVideoJob(...args);
  const shouldQueueVideoAnalysis: VideoApplicationPorts['shouldQueueVideoAnalysis'] = (...args) => deps.shouldQueueVideoAnalysis(...args);
  const queueAnalyzeSource: VideoApplicationPorts['queueAnalyzeSource'] = (...args) => deps.queueAnalyzeSource(...args);
  const runApifyActorDatasetItems: VideoApplicationPorts['runApifyActorDatasetItems'] = (...args) => deps.runApifyActorDatasetItems(...args);
  const isMissingLocalThumbnail: VideoApplicationPorts['isMissingLocalThumbnail'] = (...args) => deps.isMissingLocalThumbnail(...args);
  const cacheThumbnailLocally: VideoApplicationPorts['cacheThumbnailLocally'] = (...args) => deps.cacheThumbnailLocally(...args);
  const crawlYtDlpMetadata: VideoApplicationPorts['crawlYtDlpMetadata'] = (...args) => deps.crawlYtDlpMetadata(...args);
  const downloadMaterialJob: VideoApplicationPorts['downloadMaterialJob'] = (...args) => deps.downloadMaterialJob(...args);

  let legacyFakePurgePromise: Promise<void> | null = null;

  const pendingVisibleBackfillJobs = new Set<string>();

  const pocketBaseBackfillFailures = new Map<string, number>();

  function isTestTenantRecord(tenant: Record<string, unknown> | null): boolean {
    if (isDemoMode()) return true;
    const plan = String(tenant?.subscriptionPlan || '').toLowerCase();
    const status = String(tenant?.subscriptionStatus || '').toLowerCase();
    return plan === 'trial' || plan === 'admin' || status === 'trialing';
  }

  async function isTestTenantId(tenantId: string): Promise<boolean> {
    if (!tenantId) return false;
    if (localFallbacksEnabled() && currentDataAuthority() !== 'pocketbase' && tenantId.startsWith('local_tenant_')) return true;
    const tenant = await store.getById<Record<string, unknown>>('tenants', tenantId);
    return isTestTenantRecord(tenant);
  }

  const analysisQueuePositionCache = new Map<string, { expiresAt: number; positions: Map<string, number> }>();

  async function tenantAnalysisQueuePositions(tenantId: string): Promise<Map<string, number>> {
    const key = `${currentDataAuthority() || 'default'}:${tenantId}`;
    const cached = analysisQueuePositionCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.positions;
    const records: Record<string, unknown>[] = [];
    for (let page = 1; page <= 50; page += 1) {
      const result = await store.list<Record<string, unknown>>(COL, { where: { tenantId }, page, perPage: 100, sort: 'updated' });
      records.push(...result.items);
      if (page >= result.totalPages || result.items.length < 100) break;
    }
    const positions = analysisQueuePositions(records);
    analysisQueuePositionCache.set(key, { expiresAt: Date.now() + 2_000, positions });
    return positions;
  }

  function withSignedThumbnail<T extends Record<string, unknown>>(record: T, tenantId: string): T {
    const thumbnailUrl = String(record.thumbnailUrl || '');
    if (!thumbnailUrl.startsWith('/media/')) return record;
    return { ...record, thumbnailUrl: signAssetUrl(thumbnailUrl, tenantId) } as T;
  }

  async function listVisibleTestTenantVideos(input: {
    tenantId: string;
    platform?: Platform;
    keyword?: string;
    limit: number;
  }): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    const seenSourceUrls = new Set<string>();
    let page = 1;
    let totalPages = 1;
    do {
      const result = await store.list<Record<string, unknown>>(COL, {
        where: input.platform ? { tenantId: input.tenantId, platform: input.platform } : { tenantId: input.tenantId },
        sort: '-crawledAt',
        page,
        perPage: 100,
      });
      for (const record of result.items) {
        if (!isPublicTestTenantVideo(record)) continue;
        if (input.keyword && !recordMatchesKeyword(record, input.keyword)) continue;
        const sourceUrl = String(record.sourceUrl || '').trim();
        if (sourceUrl && seenSourceUrls.has(sourceUrl)) continue;
        if (sourceUrl) seenSourceUrls.add(sourceUrl);
        out.push(publicVideoRecord(record));
        if (out.length >= input.limit) return out;
      }
      totalPages = result.totalPages || 1;
      page += 1;
    } while (page <= totalPages && page <= 50);
    return out;
  }

  async function existingTenantSourceUrls(tenantId: string): Promise<Set<string>> {
    const urls = new Set<string>();
    let page = 1;
    let totalPages = 1;
    do {
      const result = await store.list<Record<string, unknown>>(COL, {
        where: { tenantId },
        page,
        perPage: 100,
      });
      for (const record of result.items) {
        const sourceUrl = String(record.sourceUrl || '').trim();
        if (sourceUrl) urls.add(sourceUrl);
      }
      totalPages = result.totalPages || 1;
      page += 1;
    } while (page <= totalPages && page <= 50);
    return urls;
  }

  function scheduleTestTenantVideoBackfill(input: TestTenantVideoBackfillInput): void {
    const key = [
      input.tenantId,
      input.platform,
      input.keyword || '',
      input.dateFrom || '',
      input.dateTo || '',
      input.replacementForRecordId || '',
    ].join('|');
    if (pendingVisibleBackfillJobs.has(key)) return;

    pendingVisibleBackfillJobs.add(key);
    void ensureTestTenantVideoBackfill(input)
      .catch((e) => {
        const error = compactVideoPipelineError(e instanceof Error ? e.message : e);
        console.warn('[videos] test tenant video backfill failed:', error);
        recordVideoAdminAlert({
          recordId: input.replacementForRecordId || '',
          tenantId: input.tenantId,
          platform: input.platform,
          title: `${input.platform} ${input.keyword || ''}`.trim(),
          sourceUrl: '',
          reason: input.reason || 'fresh_video_level_backfill_failed',
          error,
        });
      })
      .finally(() => {
        pendingVisibleBackfillJobs.delete(key);
      });
  }

  async function ensureTestTenantVideoBackfill(input: TestTenantVideoBackfillInput): Promise<Record<string, unknown>[]> {
    if (!await isTestTenantId(input.tenantId)) return [];

    const keyword = input.keyword || '';
    const target = Math.max(1, Math.min(10, input.target));
    const existingVisible = await listVisibleTestTenantVideos({
      tenantId: input.tenantId,
      platform: input.platform,
      keyword,
      limit: target,
    });
    if (!input.forceCreate && existingVisible.length >= target) return existingVisible;

    const sourceUrls = await existingTenantSourceUrls(input.tenantId);
    const created: Record<string, unknown>[] = [];
    const needed = input.forceCreate ? target : Math.max(0, target - existingVisible.length);
    const candidates = await discoverFreshBackfillCandidates({
      platform: input.platform,
      keyword,
      limit: Math.max(needed * 40, 80),
      excludedSourceUrls: sourceUrls,
      dateFrom: input.dateFrom || '',
      dateTo: input.dateTo || '',
    });

    const maxAnalysisAttempts = Math.max(1, Math.min(10, Number(process.env.VIDEO_BACKFILL_MAX_ANALYSIS_ATTEMPTS || 3)));
    let attempted = 0;
    for (const item of candidates) {
      if (created.length >= needed) break;
      if (attempted >= maxAnalysisAttempts) break;
      attempted += 1;
      const record = await createAndAnalyzeFreshBackfillVideo({
        tenantId: input.tenantId,
        item,
        keyword,
        replacementForRecordId: input.replacementForRecordId,
        reason: input.reason || 'fresh_video_level_backfill',
        dateFrom: input.dateFrom || '',
        dateTo: input.dateTo || '',
      });
      if (!record) continue;
      sourceUrls.add(String(record.sourceUrl || ''));
      created.push(record);
    }

    return [...created, ...existingVisible].slice(0, target);
  }

  async function discoverFreshBackfillCandidates(input: {
    platform: Platform;
    keyword: string;
    limit: number;
    excludedSourceUrls: Set<string>;
    dateFrom: string;
    dateTo: string;
  }): Promise<CrawledVideo[]> {
    const limit = Math.max(1, Math.min(120, input.limit));
    const keyword = input.keyword || DEFAULT_CRAWL_KEYWORDS;
    const candidates: CrawledVideo[] = [];

    try {
      if (input.platform === 'youtube') {
        candidates.push(...await crawlYouTubeSearch(keyword, limit, input.dateFrom, input.dateTo));
      } else if (input.platform === 'tiktok') {
        candidates.push(...await crawlTikTokWithApifyFallback(keyword, limit, input.dateFrom, input.dateTo));
      } else if (input.platform === 'instagram') {
        candidates.push(...await crawlInstagramWithApifyFallback(keyword, limit, input.dateFrom, input.dateTo));
      } else if (input.platform === 'facebook') {
        candidates.push(...await crawlSocialUrlOrFallback(input.platform, keyword, limit, input.dateFrom, input.dateTo));
      }
    } catch (e) {
      console.warn(`[videos] fresh ${input.platform} backfill search failed:`, e instanceof Error ? e.message : e);
    }

    const seen = new Set<string>();
    return sortByHeat(candidates.map(normalizeCrawledVideo))
      .filter(item => item.platform === input.platform && isPlatformUrl(item.sourceUrl, input.platform))
      .filter(item => isDiscoveryVideoEligible(item))
      .filter(item => !input.excludedSourceUrls.has(item.sourceUrl))
      .filter(item => !seen.has(item.sourceUrl) && seen.add(item.sourceUrl))
      .filter(item => isKeywordRelevant(item, keyword))
      .filter(item => item.dateEvidence === 'youtube-upload-filter' || isWithinDateRange(item.uploadedAt, input.dateFrom, input.dateTo))
      .filter(hasRealThumbnail)
      .slice(0, limit);
  }

  async function createAndAnalyzeFreshBackfillVideo(input: {
    tenantId: string;
    item: CrawledVideo;
    keyword: string;
    replacementForRecordId?: string;
    reason: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<Record<string, unknown> | null> {
    const existing = await store.list(COL, {
      where: { tenantId: input.tenantId, sourceUrl: input.item.sourceUrl },
      page: 1,
      perPage: 1,
    });
    if (existing.items[0]) return null;

    const record = await store.create<Record<string, unknown>>(COL, {
      tenantId: input.tenantId,
      platform: input.item.platform,
      title: input.item.title,
      thumbnailUrl: input.item.thumbnailUrl,
      videoFileId: '',
      duration: input.item.duration,
      sourceUrl: input.item.sourceUrl,
      tags: JSON.stringify(input.item.tags),
      aiAnalysis: JSON.stringify({
        source: input.item.source || `${input.item.platform}-search`,
        views: input.item.views,
        uploadedAt: input.item.uploadedAt,
        dateEvidence: input.item.dateEvidence,
        gemini: metadataFallbackAnalysis(input.item),
        analysisSource: 'metadata-fallback',
        analysisQuality: 'metadata',
        keyword: input.keyword,
        crawlRule: '关键词检索',
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        replacementForRecordId: input.replacementForRecordId,
        backfillReason: input.reason,
        importedAt: new Date().toISOString(),
        userVisible: false,
      }),
      status: 'analyzed' as VideoStatus,
      crawledAt: new Date().toISOString(),
    });
    if (!record) return null;

    try {
      await analyzeSourceVideoJob({
        record,
        sourceUrl: input.item.sourceUrl,
        title: input.item.title,
        platform: input.item.platform,
        suppressVisibleBackfill: true,
      });
    } catch {
      // The record itself is marked for admin review by the analysis path.
    }

    const recordId = String((record as Record<string, unknown>).id || '');
    if (!recordId) return null;
    const latest = await store.getById<Record<string, unknown>>(COL, recordId);
    if (!latest || !isPublicTestTenantVideo(latest)) return null;
    return publicVideoRecord(latest);
  }

  async function analyzeFreshCrawledRecordsForTestTenant(records: unknown[], target: number): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    const seenSourceUrls = new Set<string>();
    const configuredSyncAttempts = process.env.VIDEO_CRAWL_SYNC_URL_ANALYSIS_ATTEMPTS;
    const syncYouTubeAttempts = Math.max(0, Math.min(
      10,
      configuredSyncAttempts === undefined ? Math.min(target, 3) : Number(configuredSyncAttempts),
    ));
    let attemptedYouTube = 0;

    // Publish the whole real candidate batch as "analysis queued" before doing
    // synchronous work.  Otherwise candidate 2/3 stay as metadata-only rows
    // while candidate 1 downloads, so the user sees only one result even though
    // all three were retrieved and are scheduled for automatic analysis.
    for (const raw of records.slice(0, target)) {
      const record = raw as Record<string, unknown>;
      const id = String(record.id || '');
      const sourceUrl = String(record.sourceUrl || '').trim();
      const platform = (record.platform || inferPlatformFromUrl(sourceUrl)) as Platform;
      if (!id || !isPlatformUrl(sourceUrl, platform) || !hasRealThumbnail({ thumbnailUrl: String(record.thumbnailUrl || '') } as CrawledVideo)) continue;
      const latest = await store.getById<Record<string, unknown>>(COL, id);
      if (!latest || isPublicTestTenantVideo(latest) || !shouldQueueVideoAnalysis(latest)) continue;
      const analysis = videoAnalysisOf(latest);
      await store.update(COL, id, {
        status: 'pending' as VideoStatus,
        aiAnalysis: JSON.stringify({
          ...analysis,
          userVisible: false,
          downloadStatus: 'queued',
          videoFetchStatus: 'queued',
          geminiStatus: 'waiting_for_video',
          crawlerOpsStatus: 'queued',
          analysisQueuedAt: new Date().toISOString(),
        }),
      });
    }

    for (const raw of records) {
      const record = raw as Record<string, unknown>;
      const id = String(record.id || '');
      const sourceUrl = String(record.sourceUrl || '').trim();
      if (!id || !sourceUrl) continue;

      const platform = (record.platform || inferPlatformFromUrl(sourceUrl)) as Platform;
      if (platform === 'youtube' && attemptedYouTube < syncYouTubeAttempts) {
        attemptedYouTube += 1;
        try {
          await analyzeSourceVideoJob({
            record,
            sourceUrl,
            title: String(record.title || 'youtube-video'),
            platform,
            suppressVisibleBackfill: true,
          });
        } catch (e) {
          console.warn('[videos] test tenant crawl URL analysis failed:', e instanceof Error ? e.message : e);
        }
      } else {
        await queueTestTenantVideoLevelAnalysis(record);
      }

      const latest = await store.getById<Record<string, unknown>>(COL, id);
      if (!latest || !isPublicTestTenantVideo(latest)) continue;
      const latestSourceUrl = String(latest.sourceUrl || '').trim();
      if (latestSourceUrl && seenSourceUrls.has(latestSourceUrl)) continue;
      if (latestSourceUrl) seenSourceUrls.add(latestSourceUrl);
      out.push(publicVideoRecord(latest));
      if (out.length >= target) break;
    }

    return out;
  }

  function shouldCreateTestTenantAnalysisJob(analysis: Record<string, unknown>, normallyQueueable: boolean): boolean {
    return normallyQueueable || !analysis.crawlerOpsTaskId;
  }

  async function queueTestTenantVideoLevelAnalysis(record: Record<string, unknown>): Promise<void> {
    const id = String(record.id || '');
    if (!id) return;
    const latest = await store.getById<Record<string, unknown>>(COL, id);
    if (!latest || isPublicTestTenantVideo(latest)) return;

    const sourceUrl = String(latest.sourceUrl || '').trim();
    if (!sourceUrl) return;
    const platform = (latest.platform || inferPlatformFromUrl(sourceUrl)) as Platform;
    const analysis = parseJsonRecord<Record<string, unknown>>(latest.aiAnalysis, {});
    // The batch preflight intentionally marks every candidate as queued before
    // individual jobs are created. A queued marker without a durable ops receipt
    // must continue into queueAnalyzeSource; otherwise Facebook/Instagram rows
    // remain metadata-only forever. A receipt means the job was already accepted.
    if (!shouldCreateTestTenantAnalysisJob(analysis, shouldQueueVideoAnalysis(latest))) return;
    await store.update(COL, id, {
      status: 'pending' as VideoStatus,
      aiAnalysis: JSON.stringify({
        ...analysis,
        userVisible: false,
        downloadStatus: 'queued',
        videoFetchStatus: 'queued',
        geminiStatus: 'waiting_for_video',
        analysisQueuedAt: new Date().toISOString(),
      }),
    });

    await queueAnalyzeSource(latest, {
      record: latest,
      sourceUrl,
      title: String(latest.title || `${platform}-video`),
      platform,
    });
  }

  async function recrawlImagePostThumbnail(record: Record<string, unknown>): Promise<string> {
    const platform = String(record.platform || '') as Platform;
    const sourceUrl = String(record.sourceUrl || '').trim();
    if (!sourceUrl) return '';

    // Instagram 的公开 media 端点会重定向到当前有效的 CDN 图片，不需要登录态，
    // 可用于恢复数据库仍在但本地缓存文件已丢失的历史图文。
    if (platform === 'instagram' && /instagram\.com\/p\/[^/?#]+\/?$/i.test(sourceUrl)) {
      return `${sourceUrl.replace(/\/$/, '')}/media/?size=l`;
    }
    if (!process.env.APIFY_TOKEN?.trim()) return '';

    try {
      if (platform === 'instagram') {
        const actor = process.env.APIFY_INSTAGRAM_ACTOR?.trim() || 'apify/instagram-scraper';
        const rows = await runApifyActorDatasetItems(actor, {
          directUrls: [sourceUrl],
          resultsType: 'posts',
          resultsLimit: 1,
          addParentData: false,
        }, Number(process.env.APIFY_TIMEOUT_MS || 240_000), 'Instagram thumbnail repair');
        return firstImageUrl(rows.map(item => [item.displayUrl, item.images, item]));
      }
    } catch (error) {
      console.warn('[videos] image post thumbnail recrawl failed:', error instanceof Error ? error.message : error);
    }
    return '';
  }

  async function repairMissingCrawledThumbnails(records: unknown[], limit = 5): Promise<number> {
    const normalizedRecords = records.map(raw => raw as Record<string, unknown>);
    const candidates = normalizedRecords
      .filter(record => ['youtube', 'tiktok', 'facebook', 'instagram'].includes(String(record.platform || '')))
      .filter(record => /^https?:\/\//i.test(String(record.sourceUrl || '')))
      .filter(record => {
        const thumb = normalizeThumbnailUrl(String(record.thumbnailUrl || ''));
        const stableYouTubeThumbnail = record.platform === 'youtube'
          ? youtubeThumbnailFromUrl(String(record.sourceUrl || ''))
          : '';
        return !thumb
          || isMissingLocalThumbnail(thumb)
          || isSignedExpiringThumbnail(thumb)
          || Boolean(stableYouTubeThumbnail && thumb !== stableYouTubeThumbnail)
          || canonicalSourceUrl(record.platform as Platform, String(record.sourceUrl || ''), '') !== String(record.sourceUrl || '');
      })
      .slice(0, Math.max(1, limit));

    let repaired = 0;
    for (const record of candidates) {
      try {
        const platform = record.platform as Platform;
        const existingSourceUrl = String(record.sourceUrl || '');
        const canonicalUrl = canonicalSourceUrl(platform, existingSourceUrl, '');
        const existingThumbnail = normalizeThumbnailUrl(String(record.thumbnailUrl || ''));
        const usableExistingThumbnail = isMissingLocalThumbnail(existingThumbnail) ? '' : existingThumbnail;
        // YouTube may return hq720/custom thumbnails that later become 404.
        // The standard hqdefault endpoint is stable for public videos, so always
        // canonicalize old YouTube thumbnail URLs during opportunistic repair.
        let thumbnailUrl = platform === 'youtube'
          ? youtubeThumbnailFromUrl(canonicalUrl)
          : thumbnailForPlatform(platform, canonicalUrl, usableExistingThumbnail);
        let sourceUrl = canonicalUrl;
        const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
        if (!thumbnailUrl && analysis.contentFormat === 'image') {
          const refreshedImage = await recrawlImagePostThumbnail(record);
          if (refreshedImage) {
            const local = await cacheThumbnailLocally(String(record.id), refreshedImage);
            thumbnailUrl = local || refreshedImage;
          }
        }
        if (!thumbnailUrl || isExpiredSignedThumbnail(thumbnailUrl)) {
          const meta = await crawlYtDlpMetadata(platform, sourceUrl, String(record.title || platform));
          sourceUrl = meta.sourceUrl || sourceUrl;
          thumbnailUrl = meta.thumbnailUrl || thumbnailUrl;
        }
        if (isSignedExpiringThumbnail(thumbnailUrl) && !isExpiredSignedThumbnail(thumbnailUrl)) {
          const local = await cacheThumbnailLocally(String(record.id), thumbnailUrl);
          if (local) thumbnailUrl = local;
        }
        if (thumbnailUrl && (sourceUrl !== existingSourceUrl || thumbnailUrl !== String(record.thumbnailUrl || ''))) {
          await store.update(COL, String(record.id), { sourceUrl, thumbnailUrl });
          repaired += 1;
        }
      } catch (e) {
        console.warn('[videos] thumbnail repair skipped:', e instanceof Error ? e.message : e);
      }
    }
    return repaired;
  }

  async function backfillMissingCrawledMedia(records: unknown[]): Promise<void> {
    const normalizedRecords = records
      .map(raw => raw as Record<string, unknown>)
      .filter(record => recordContentFormat(record) === 'video');
    for (const record of normalizedRecords) {
      const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
      if (record.videoFileId && !analysis.videoStorage) {
        await store.update(COL, String(record.id), {
          aiAnalysis: JSON.stringify({ ...analysis, videoStorage: 'pocketbase' }),
        });
        record.aiAnalysis = JSON.stringify({ ...analysis, videoStorage: 'pocketbase' });
      }
    }
    const storageCandidates = normalizedRecords.filter(record => {
      const analysis = parseJsonRecord<Record<string, unknown>>(record.aiAnalysis, {});
      const recordId = String(record.id || '');
      const retryAfter = pocketBaseBackfillFailures.get(recordId) || 0;
      return !record.videoFileId
        && !analysis.videoObjectKey
        && /^https?:\/\//i.test(String(record.sourceUrl || ''))
        && Date.now() >= retryAfter
        && !['downloading', 'queued', 'failed', 'download_failed', 'unavailable', 'metadata_only'].includes(String(analysis.downloadStatus || ''));
    }).slice(0, 3);
    for (const record of storageCandidates) {
      const recordId = String(record.id || '');
      void downloadMaterialJob({ record, tenantId: String(record.tenantId || ''), sourceUrl: String(record.sourceUrl), title: String(record.title || '爬取视频'), platform: record.platform as Platform, duration: Number(record.duration || 0) })
        .then(() => pocketBaseBackfillFailures.delete(recordId))
        .catch(error => {
          // Failed public downloads should not be hammered every minute. Manual retry remains available.
          pocketBaseBackfillFailures.set(recordId, Date.now() + 6 * 60 * 60 * 1000);
          console.warn('[videos] PocketBase video backfill failed:', error instanceof Error ? error.message : error);
        });
    }
    await repairMissingCrawledThumbnails(normalizedRecords, 5);
  }

  async function purgeLegacyFakeVideos(): Promise<void> {
    if (process.env.NODE_ENV !== 'production' && process.env.PB_URL === undefined) return;
    if (!legacyFakePurgePromise) {
      legacyFakePurgePromise = (async () => {
        let page = 1;
        let removed = 0;
        while (page < 50) {
          const result = await store.list(COL, { page, perPage: 100 });
          for (const record of result.items) {
            const title = String(record.title || '');
            const sourceUrl = String(record.sourceUrl || '');
            if (isLegacyFakeVideo(title, sourceUrl)) {
              if (await store.delete(COL, record.id)) removed += 1;
            }
          }
          if (page >= result.totalPages || result.items.length === 0) break;
          page += 1;
        }
        if (removed > 0) console.log(`[videos] purged ${removed} legacy fake crawl records`);
      })().catch((e) => {
        legacyFakePurgePromise = null;
        console.warn('[videos] legacy fake purge failed:', e);
      });
    }
    await legacyFakePurgePromise;
  }

  function isLegacyFakeVideo(title: string, sourceUrl: string): boolean {
    return /auto-crawl sample/i.test(title)
      || /#auto-crawl-\d+/i.test(sourceUrl)
      || /\/search\/video\?q=.*#auto-crawl/i.test(sourceUrl)
      || /explore\/search\/keyword\/\?q=.*#auto-crawl/i.test(sourceUrl);
  }

  return { isTestTenantId, tenantAnalysisQueuePositions, withSignedThumbnail, scheduleTestTenantVideoBackfill, analyzeFreshCrawledRecordsForTestTenant, shouldCreateTestTenantAnalysisJob, queueTestTenantVideoLevelAnalysis, repairMissingCrawledThumbnails, backfillMissingCrawledMedia, purgeLegacyFakeVideos };
}
