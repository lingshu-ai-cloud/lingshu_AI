import { apifyTikTokItemToCrawledVideo } from '../routes/videoCrawlerProviderProjection.js';
import { normalizeCrawledVideo } from '../routes/videoCrawlerPublicProjection.js';
import { metadataFallbackAnalysis } from '../routes/videoCrawlerMetadataFallback.js';
import { fetchThumbnailBuffer, isSignedExpiringThumbnail } from '../routes/videoThumbnailPersistence.js';
import { accountLabelFromUrl, looksLikeAccountUrl } from '../routes/videoCrawlerSourceUrls.js';
import { assertConfiguredLinkedInCompanyPaidCollection, runConfiguredLinkedInCompanyPaidCollection } from '../routes/linkedinCompanyPostPaidCollection.js';
import { frozenWeeklyAccountFiveVideoActorInput } from '../socialDiscovery/weeklyAccountCollectionBudget.js';
import { readVerifiedWeeklyOriginalDatasetReplay } from '../socialDiscovery/weeklyAccountCollectionDatasetContinuation.js';
import type { DataStore } from '../storage/datastore.js';
import { discoveryVideoRecordId, loadKnownVideoSourceIdentities, sourceAccountFromProviderMetadata, sourceAccountFromVideoUrl, videoSourceIdentity } from '../routes/videoSourceIdentity.js';
import { canFingerprintThumbnailUrl, fingerprintVideoThumbnail, likelySameVideoThumbnail, loadKnownVideoThumbnailFingerprints } from '../routes/videoThumbnailDuplicate.js';
import { acquireDurableOperationLease, assertDurableOperationLease, releaseDurableOperationLease } from '../runtime/durableLease.js';
import { createHash, randomUUID } from 'node:crypto';
import { store } from '../storage/index.js';
import type { VideoStatus } from '../types/index.js';
import { isDiscoveryVideoEligible } from '../../shared/contracts/discoveryVideoPolicy.js';
import { filterDateRangeItems, filterKeywordRelevantItems, filterRealMediaItems, hasDateRange, isPlatformUrl, parseJsonRecord, sortByHeat, videoDedupeKey, type CrawledVideo } from '../routes/videoCrawlerNormalization.js';
import { COL, DEFAULT_CRAWL_KEYWORDS } from './runtimeConfig.js';
import type { CrawlVideosInput, CrawlVideosResult } from './contracts.js';
import { NoCrawlResultsError } from './crawlErrors.js';
import type { VideoApplicationPorts } from './applicationPorts.js';

export function createVideoCollectionApplication(deps: Pick<VideoApplicationPorts, 'purgeLegacyFakeVideos' | 'isTestTenantId' | 'crawlTikTokWithPaidPermit' | 'crawlAccountHomepage' | 'crawlYouTubeSearch' | 'crawlFacebook' | 'crawlTikTokWithApifyFallback' | 'crawlInstagramWithApifyFallback' | 'topUpCrawledItems' | 'persistThumbnailIfExpiring' | 'queueTestTenantVideoLevelAnalysis' | 'analyzeFreshCrawledRecordsForTestTenant' | 'scheduleTestTenantVideoBackfill' | 'enqueueCrawledRecordsForAnalysis'>) {
  const purgeLegacyFakeVideos: VideoApplicationPorts['purgeLegacyFakeVideos'] = (...args) => deps.purgeLegacyFakeVideos(...args);
  const isTestTenantId: VideoApplicationPorts['isTestTenantId'] = (...args) => deps.isTestTenantId(...args);
  const crawlTikTokWithPaidPermit: VideoApplicationPorts['crawlTikTokWithPaidPermit'] = (...args) => deps.crawlTikTokWithPaidPermit(...args);
  const crawlAccountHomepage: VideoApplicationPorts['crawlAccountHomepage'] = (...args) => deps.crawlAccountHomepage(...args);
  const crawlYouTubeSearch: VideoApplicationPorts['crawlYouTubeSearch'] = (...args) => deps.crawlYouTubeSearch(...args);
  const crawlFacebook: VideoApplicationPorts['crawlFacebook'] = (...args) => deps.crawlFacebook(...args);
  const crawlTikTokWithApifyFallback: VideoApplicationPorts['crawlTikTokWithApifyFallback'] = (...args) => deps.crawlTikTokWithApifyFallback(...args);
  const crawlInstagramWithApifyFallback: VideoApplicationPorts['crawlInstagramWithApifyFallback'] = (...args) => deps.crawlInstagramWithApifyFallback(...args);
  const topUpCrawledItems: VideoApplicationPorts['topUpCrawledItems'] = (...args) => deps.topUpCrawledItems(...args);
  const persistThumbnailIfExpiring: VideoApplicationPorts['persistThumbnailIfExpiring'] = (...args) => deps.persistThumbnailIfExpiring(...args);
  const queueTestTenantVideoLevelAnalysis: VideoApplicationPorts['queueTestTenantVideoLevelAnalysis'] = (...args) => deps.queueTestTenantVideoLevelAnalysis(...args);
  const analyzeFreshCrawledRecordsForTestTenant: VideoApplicationPorts['analyzeFreshCrawledRecordsForTestTenant'] = (...args) => deps.analyzeFreshCrawledRecordsForTestTenant(...args);
  const scheduleTestTenantVideoBackfill: VideoApplicationPorts['scheduleTestTenantVideoBackfill'] = (...args) => deps.scheduleTestTenantVideoBackfill(...args);
  const enqueueCrawledRecordsForAnalysis: VideoApplicationPorts['enqueueCrawledRecordsForAnalysis'] = (...args) => deps.enqueueCrawledRecordsForAnalysis(...args);

  function discoveryOrigins(
    existing: unknown,
    context: CrawlVideosInput['discoveryContext'],
  ): Array<Record<string, unknown>> | undefined {
    if (!context) return Array.isArray(existing) ? existing as Array<Record<string, unknown>> : undefined;
    const previous = Array.isArray(existing) ? existing.filter(item => item && typeof item === 'object') as Array<Record<string, unknown>> : [];
    const origin = { ...context, observedAt: new Date().toISOString() };
    return [...previous.filter(item => item.runId !== context.runId || item.mode !== context.mode || item.queryRef !== context.queryRef), origin].slice(-20);
  }

  async function acquireDiscoveryAdmissionLease(tenantId: string, dataStore:DataStore=store) {
    const deadline = Date.now() + 90_000;
    for (;;) {
      const lease = await acquireDurableOperationLease({
        dataStore, tenantId, scope: 'social-discovery-video-admission',
        subjectId: 'tenant-candidates', ownerId: randomUUID(), leaseDurationMs: 30_000,
      });
      if (lease) return lease;
      if (Date.now() >= deadline) throw Error('discovery_video_admission_busy');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async function crawlVideosForTenant(input: CrawlVideosInput): Promise<CrawlVideosResult> {
    const dataStore=input.dataStore??store;
    const tenantId = input.tenantId;
    const platform = input.platform ?? 'youtube';
    const accountMode = input.mode === 'account' && looksLikeAccountUrl(input.accountUrl ?? '', platform);
    const accountUrl = accountMode ? String(input.accountUrl).trim() : '';
    const accountName = accountMode ? String(input.accountName || accountLabelFromUrl(accountUrl)) : '';
    // 对标账号采集时用账号名/URL 作为关键词占位，便于溯源与去重信息展示。
    const keyword = accountMode ? (accountName || accountUrl) : (input.keyword ?? DEFAULT_CRAWL_KEYWORDS);
    const limit = input.limit ?? 5;
    const dateFrom = input.dateFrom ?? '';
    const dateTo = input.dateTo ?? '';
    const crawlRule = accountMode ? '对标账号主页' : '关键词检索';

    const originalFive=input.discoveryContext?.weeklyOriginalAccountCollection;
    const replay=input.originalDatasetReplay?readVerifiedWeeklyOriginalDatasetReplay(input.originalDatasetReplay):null;
    if(originalFive){
      const expected=originalFive.accountUrl===accountUrl&&input.mode==='account'&&platform==='tiktok'&&input.limit===5&&
        originalFive.originalRunKey.startsWith('weekly-preproduction:')&&
        createHash('sha256').update(JSON.stringify(frozenWeeklyAccountFiveVideoActorInput(originalFive.accountUrl))).digest('hex')===originalFive.actorInputSha256;
      if(!expected)throw Error('weekly_preproduction_collection_original_input_changed');
      if(!replay||replay.tenantId!==tenantId||replay.originalRunKey!==originalFive.originalRunKey||replay.accountUrl!==accountUrl||
        input.discoveryContext?.queryRef!==accountUrl||input.discoveryContext.mode!=='account'||!input.newCandidatesOnly||!input.disableBackfill||input.paidPermit)
        throw Error('weekly_preproduction_collection_original_transport_required');
    }else if(replay){
      throw Error('weekly_original_dataset_replay_scope_mismatch');
    }

    // A weekly account run must not accidentally fall through the historical
    // synchronous Actor fallback, which loses the paid run ID on interruption.
    if (input.discoveryContext && input.mode === 'account' && platform === 'tiktok' && !input.paidPermit && !replay) {
      throw Error('weekly_preproduction_collection_paid_permit_required');
    }
    if (input.paidPermit && (!input.discoveryContext || !accountMode || platform !== 'tiktok')) {
      throw Error('apify_paid_permit_scope_mismatch');
    }
    if (platform === 'linkedin' && (!input.linkedInPaidPermit || !accountMode
      || !input.discoveryContext || input.discoveryContext.mode !== 'account'
      || input.discoveryContext.queryRef !== accountUrl)) {
      throw Error('linkedin_company_paid_collection_permit_required');
    }
    if (input.linkedInPaidPermit && platform !== 'linkedin') throw Error('linkedin_company_paid_collection_scope_mismatch');
    if (platform === 'linkedin') await assertConfiguredLinkedInCompanyPaidCollection({ tenantId,
      runId: input.discoveryContext!.runId, companyUrl: accountUrl,
      limit: Math.min(30, Math.max(1, Number(limit) || 5)), dateFrom, dateTo }, input.linkedInPaidPermit);

    if(!replay && platform !== 'linkedin')await purgeLegacyFakeVideos();
    const testTenant = replay || platform === 'linkedin' ? false : await isTestTenantId(tenantId);
    const target = Math.min(30, Math.max(1, Number(limit) || 5));
    let crawlerSource = accountMode ? `${platform}-account` : `${platform}-search`;
    let crawlerMessage = '';
    let crawlerTopUpMessage = '';
    let items: CrawledVideo[];
    // 账号主页采集与直链一样跳过关键词/封面/补齐等以搜索为前提的过滤。
    const directUrlInput = accountMode || isPlatformUrl(keyword, platform);
    try {
      // Approved discovery has a separately reserved daily item budget. Do not
      // turn one reserved candidate into five provider-fetched candidates.
      const safeLimit = input.newCandidatesOnly ? target : Math.min(120, Math.max(target * 5, target));
      if (replay) {
        items=replay.rows.map(row=>apifyTikTokItemToCrawledVideo(row,keyword)).filter((item):item is CrawledVideo=>Boolean(item));
        crawlerSource='apify-tiktok-original-dataset-journal';
      } else if (input.paidPermit) {
        items = await crawlTikTokWithPaidPermit(accountUrl, target, dateFrom, dateTo, input.paidPermit);
        crawlerSource = 'apify-tiktok-account';
        if (hasDateRange(dateFrom, dateTo)) items = filterDateRangeItems(items, dateFrom, dateTo);
      } else if (platform === 'linkedin') {
        const result = await runConfiguredLinkedInCompanyPaidCollection({ tenantId,
          runId: input.discoveryContext!.runId, companyUrl: accountUrl, limit: target,
          dateFrom, dateTo }, input.linkedInPaidPermit);
        items = result.videos;
        crawlerSource = 'apify-linkedin-company-posts';
      } else if (accountMode) {
        items = await crawlAccountHomepage(platform, accountUrl, Math.max(target, Math.min(safeLimit, 30)), dateFrom, dateTo, input.cloudFallback === true, input.newCandidatesOnly === true);
        if (hasDateRange(dateFrom, dateTo)) items = filterDateRangeItems(items, dateFrom, dateTo);
        if (items.some(item => item.source === 'apify')) crawlerSource = `apify-${platform}-account`;
      } else if (platform === 'youtube') {
        items = await crawlYouTubeSearch(keyword, safeLimit, dateFrom, dateTo);
      } else if (platform === 'facebook') {
        crawlerSource = /^https?:\/\/(?:www\.|m\.|mbasic\.)?facebook\.com\//i.test(keyword.trim()) ? 'facebook-url' : 'facebook-search';
        items = await crawlFacebook(keyword, safeLimit, dateFrom, dateTo, input.newCandidatesOnly === true);
      } else if (platform === 'tiktok') {
        crawlerSource = isPlatformUrl(keyword, 'tiktok') ? 'tiktok-url' : 'tiktok-search';
        items = await crawlTikTokWithApifyFallback(keyword, safeLimit, dateFrom, dateTo, input.newCandidatesOnly === true);
        if (items.some(item => item.source === 'apify')) crawlerSource = 'apify-tiktok';
      } else if (platform === 'instagram') {
        crawlerSource = isPlatformUrl(keyword, 'instagram') ? 'instagram-url' : 'instagram-search';
        items = await crawlInstagramWithApifyFallback(keyword, safeLimit, dateFrom, dateTo);
        if (items.some(item => item.source === 'apify')) crawlerSource = 'apify-instagram';
      } else {
        throw new Error(`${platform} adapter pending`);
      }
      const beforeShortFormFilter = items.length;
      items = items.filter(item => isDiscoveryVideoEligible(item));
      if (items.length === 0 && beforeShortFormFilter > 0) {
        throw new NoCrawlResultsError(platform === 'youtube'
          ? `候选 ${beforeShortFormFilter} 条均不符合硬规则：只采集 YouTube Shorts，且时长必须在 1–60 秒`
          : `候选 ${beforeShortFormFilter} 条均不符合硬规则：视频时长必须在 1–60 秒`);
      }
      if (!directUrlInput) {
        const beforeDateFilter = items.length;
        items = filterDateRangeItems(items, dateFrom, dateTo);
        if (items.length === 0 && hasDateRange(dateFrom, dateTo)) {
          throw new NoCrawlResultsError(`没有找到发布时间在 ${dateFrom || '不限'} 至 ${dateTo || '不限'} 内的公开视频（候选 ${beforeDateFilter} 条已过滤）`);
        }
      }
      if (!directUrlInput) {
        const beforeRealMediaFilter = items.length;
        items = filterRealMediaItems(items);
        if (items.length === 0) {
          throw new NoCrawlResultsError(`没有拿到带真实封面的公开视频（候选 ${beforeRealMediaFilter} 条已过滤）`);
        }
      }
      if (!directUrlInput) {
        const beforeFilter = items.length;
        items = filterKeywordRelevantItems(items, keyword);
        if (items.length === 0) {
          throw new NoCrawlResultsError(`没有找到与关键词「${keyword}」相关的公开视频（候选 ${beforeFilter} 条已过滤）`);
        }
      }
      if (!input.disableBackfill && !directUrlInput && items.length < target) {
        const beforeTopUp = items.length;
        items = await topUpCrawledItems({ platform, keyword, target, items, dateFrom, dateTo });
        const topUpCount = Math.max(0, items.length - beforeTopUp);
        if (topUpCount > 0) {
          crawlerTopUpMessage = `；过滤后补齐 ${topUpCount} 条`;
        }
      }
    } catch (e) {
      if (!(e instanceof NoCrawlResultsError)) throw e;
      crawlerMessage = e instanceof Error
        ? `${platform} 公开采集未找到可入库的真实视频：${e.message}`
        : `${platform} 公开采集未找到可入库的真实视频`;
      console.warn(`[videos] ${platform} crawl degraded:`, e);
      items = [];
    }

    let imported = 0;
    const refreshed = 0;
    let skipped = 0;
    let skippedExisting = 0;
    const records: unknown[] = [];
    const existingRecords: unknown[] = [];
    const seenKeys = new Set<string>();
    let skippedNearDuplicate = 0;
    let nearDuplicateUnchecked = 0;
    const knownSourceIdentities = new Set<string>();
    const knownThumbnailFingerprints: Awaited<ReturnType<typeof loadKnownVideoThumbnailFingerprints>> = [];
    const orderedItems = sortByHeat(items.map(normalizeCrawledVideo))
      .filter(item => item.platform === platform && isPlatformUrl(item.sourceUrl, platform))
      .filter(item => isDiscoveryVideoEligible(item))
      .filter(item => {
        const key = videoDedupeKey(item);
        if (seenKeys.has(key)) {
          skipped += 1;
          return false;
        }
        seenKeys.add(key);
        return true;
      });
    if (platform === 'youtube' && items.length > 0 && orderedItems.length === 0) {
      console.warn('[videos] YouTube candidates rejected before import', {
        candidates: items.length,
        sampleSourceUrl: items[0]?.sourceUrl || '',
        samplePlatform: items[0]?.platform || '',
      });
    }

    for (const item of orderedItems) {
      // Re-read under the existing database-backed lease: two source queries can
      // return the same picture under different URLs after both initially see an
      // empty inventory. The stable source-ID alone cannot arbitrate that race.
      const admissionLease = input.newCandidatesOnly ? await acquireDiscoveryAdmissionLease(tenantId,dataStore) : null;
      try {
        if (admissionLease) {
          knownSourceIdentities.clear();
          for (const known of await loadKnownVideoSourceIdentities(dataStore, COL, tenantId)) knownSourceIdentities.add(known);
          knownThumbnailFingerprints.splice(0, knownThumbnailFingerprints.length, ...await loadKnownVideoThumbnailFingerprints(dataStore, tenantId));
        }
        const identity = videoSourceIdentity(item.platform, item.sourceUrl);
        const videoUrlAccount = sourceAccountFromVideoUrl(item.platform,item.sourceUrl);
        const metadataAccount = sourceAccountFromProviderMetadata(item.platform,item.sourceAccountUrl || '');
        const homepageAccount = accountMode ? sourceAccountFromProviderMetadata(item.platform,accountUrl) : null;
        const resolvedAccount = videoUrlAccount ?? metadataAccount ?? homepageAccount;
        const sourceAccountEvidence = videoUrlAccount ? 'video_url' : metadataAccount ? 'provider_metadata' : homepageAccount ? 'account_homepage' : undefined;
        if (input.newCandidatesOnly && knownSourceIdentities.has(identity) && !replay) {
          skipped += 1;
          skippedExisting += 1;
          continue;
        }
        const existingByUrl = await dataStore.list(COL, {
          where: { tenantId, sourceUrl: item.sourceUrl },
          page: 1,
          perPage: 1,
        });
        const existingRecord = existingByUrl?.items[0];
        if (existingRecord) {
          if(replay){
            const analysis=parseJsonRecord<Record<string,unknown>>(existingRecord.aiAnalysis,{});
            const origins=Array.isArray(analysis.discoveryOrigins)?analysis.discoveryOrigins:[];
            const sameRun=origins.some(origin=>origin&&typeof origin==='object'&&
              (origin as Record<string,unknown>).runId===input.discoveryContext?.runId&&
              (origin as Record<string,unknown>).scopeId===input.discoveryContext?.scopeId&&
              (origin as Record<string,unknown>).scopeVersion===input.discoveryContext?.scopeVersion&&
              (origin as Record<string,unknown>).queryRef===accountUrl&&
              JSON.stringify((origin as Record<string,unknown>).weeklyOriginalAccountCollection)===JSON.stringify(originalFive));
            if(!sameRun){skipped++;skippedExisting++;continue;}
            existingRecords.push(existingRecord);
            knownSourceIdentities.add(identity);
            continue;
          }
          skipped += 1;
          skippedExisting += 1;
          if (input.newCandidatesOnly) { knownSourceIdentities.add(identity); continue; }
          const existingAnalysis = parseJsonRecord<Record<string, unknown>>(existingRecord.aiAnalysis, {});
          const refreshedRecord = {
            ...existingRecord,
            platform: item.platform,
            title: item.title,
            thumbnailUrl: item.thumbnailUrl,
            duration: item.duration,
            sourceUrl: item.sourceUrl,
            tags: JSON.stringify(item.tags.length > 0 ? item.tags : parseJsonRecord<string[]>(existingRecord.tags, [])),
            aiAnalysis: JSON.stringify({
              ...existingAnalysis,
              views: item.views || existingAnalysis.views,
              uploadedAt: item.uploadedAt || existingAnalysis.uploadedAt,
              dateEvidence: item.dateEvidence || existingAnalysis.dateEvidence,
              author: item.author || existingAnalysis.author || (accountMode ? accountName : undefined),
              keyword,
              crawlRule,
              sourceAccount: resolvedAccount ?? existingAnalysis.sourceAccount,
              sourceAccountName: resolvedAccount ? item.author || (accountMode ? accountName : existingAnalysis.sourceAccountName) : existingAnalysis.sourceAccountName,
              sourceAccountEvidence: resolvedAccount ? sourceAccountEvidence : existingAnalysis.sourceAccountEvidence,
              dateFrom,
              dateTo,
              discoveryOrigins: discoveryOrigins(existingAnalysis.discoveryOrigins, input.discoveryContext),
            }),
          };
          // 已有本地落盘缩略图时不要用新的临时签名链接覆盖
          const keepLocalThumb = String(existingRecord.thumbnailUrl || '').startsWith('/media/') && isSignedExpiringThumbnail(item.thumbnailUrl);
          await dataStore.update(COL, String(existingRecord.id), {
            contentFormat: 'video',
            thumbnailUrl: keepLocalThumb ? String(existingRecord.thumbnailUrl) : (item.thumbnailUrl || String(existingRecord.thumbnailUrl || '')),
            sourceUrl: item.sourceUrl || String(existingRecord.sourceUrl || ''),
            aiAnalysis: refreshedRecord.aiAnalysis,
          });
          if (!keepLocalThumb) {
            void persistThumbnailIfExpiring(String(existingRecord.id), item.thumbnailUrl).catch(() => {});
          }
          existingRecords.push(refreshedRecord);
          continue;
        }

        let thumbnailFingerprint: Awaited<ReturnType<typeof fingerprintVideoThumbnail>> | null = null;
        if (input.newCandidatesOnly && !replay && canFingerprintThumbnailUrl(item.platform,item.thumbnailUrl)) {
          const image = await fetchThumbnailBuffer(item.thumbnailUrl, 5_000, true);
          if (image) {
            try { thumbnailFingerprint = await fingerprintVideoThumbnail(image.buf); } catch { /* invalid image stays unverified */ }
          }
        }
        if (input.newCandidatesOnly && !thumbnailFingerprint) nearDuplicateUnchecked += 1;
        if (thumbnailFingerprint && knownThumbnailFingerprints.some(existing => likelySameVideoThumbnail(
          {fingerprint:thumbnailFingerprint!,title:item.title,duration:item.duration},existing))) {
          skipped += 1;
          skippedNearDuplicate += 1;
          continue;
        }

        // A stable row ID makes simultaneous approved collections of the same
        // platform video elect one winner even if both read an empty inventory.
        const newCandidateId = input.newCandidatesOnly ? discoveryVideoRecordId(tenantId,item.platform,item.sourceUrl) : null;
        if (admissionLease) await assertDurableOperationLease({dataStore,lease:admissionLease});
        let record: Record<string, unknown> | null;
        try { record = await dataStore.create<Record<string, unknown>>(COL, {
            ...(newCandidateId ? {id:newCandidateId} : {}),
            tenantId,
            contentFormat: 'video',
            platform: item.platform,
            title: item.title,
            thumbnailUrl: item.thumbnailUrl,
            videoFileId: '',
            duration: item.duration,
            sourceUrl: item.sourceUrl,
            tags: JSON.stringify(item.tags),
            aiAnalysis: JSON.stringify({
              source: crawlerSource,
              views: item.views,
              uploadedAt: item.uploadedAt,
              dateEvidence: item.dateEvidence,
              author: item.author || (accountMode ? accountName : undefined),
              gemini: metadataFallbackAnalysis(item),
              analysisSource: 'metadata-fallback',
              analysisQuality: 'metadata',
              keyword,
              crawlRule,
              sourceAccount: resolvedAccount ?? undefined,
              sourceAccountName: resolvedAccount ? item.author || (accountMode ? accountName : undefined) : undefined,
              sourceAccountEvidence,
              thumbnailFingerprint: thumbnailFingerprint ?? undefined,
              dateFrom,
              dateTo,
              importedAt: new Date().toISOString(),
              userVisible: testTenant ? false : undefined,
              discoveryOrigins: discoveryOrigins(undefined, input.discoveryContext),
            }),
            status: 'analyzed' as VideoStatus,
            crawledAt: new Date().toISOString(),
          }); } catch (cause) {
          if (!newCandidateId) throw cause;
          const winner = await dataStore.getById<Record<string, unknown>>(COL, newCandidateId);
          if (!winner || videoSourceIdentity(String(winner.platform || item.platform), String(winner.sourceUrl || '')) !== identity) throw cause;
          skipped += 1; skippedExisting += 1; knownSourceIdentities.add(identity); continue;
        }
        if (!record && newCandidateId) {
          const winner = await dataStore.getById<Record<string, unknown>>(COL, newCandidateId);
          if (!winner || videoSourceIdentity(String(winner.platform || item.platform), String(winner.sourceUrl || '')) !== identity) throw Error('discovery_video_identity_conflict');
          skipped += 1; skippedExisting += 1; knownSourceIdentities.add(identity); continue;
        }
        if (record) {
          imported += 1;
          records.push(record);
          if (input.newCandidatesOnly) knownSourceIdentities.add(identity);
          if (thumbnailFingerprint) knownThumbnailFingerprints.push({fingerprint:thumbnailFingerprint,title:item.title,duration:item.duration});
          if(!replay)void persistThumbnailIfExpiring(String((record as Record<string, unknown>).id), item.thumbnailUrl).catch(() => {});
        }
        if (imported >= target) break;
      } finally {
        if (admissionLease) await releaseDurableOperationLease({dataStore,lease:admissionLease});
      }
    }

    let resultRecords = [...records, ...existingRecords].slice(0, target);
    const returnedNew = Math.min(records.length, resultRecords.length);
    let returnedExisting = Math.max(0, resultRecords.length - returnedNew);
    let visibleNewCount = 0;
    const candidateIds = resultRecords.map(record => String((record as Record<string, unknown>).id));
    if (input.suppressAnalysisQueue) {
      // Keep the durable records and candidate ids, but do not race a maintenance
      // job that will immediately run a fresh exact analysis for every candidate.
      resultRecords = [];
      returnedExisting = 0;
    } else if (testTenant && input.deferAnalysis) {
      for (const record of resultRecords) {
        await queueTestTenantVideoLevelAnalysis(record as Record<string, unknown>);
      }
      // Do not expose metadata-only records as analysis-ready results.
      resultRecords = [];
      returnedExisting = 0;
    } else if (testTenant) {
      // A repeated keyword commonly finds URLs that were inserted by an earlier
      // run but whose video-level analysis did not finish.  They are still real
      // crawl candidates and must be resumed instead of being silently skipped.
      // analyzeFreshCrawledRecordsForTestTenant only returns records that pass the
      // strict video-level evidence gate, so failed/metadata-only rows stay hidden.
      resultRecords = await analyzeFreshCrawledRecordsForTestTenant(
        [...records, ...existingRecords].slice(0, target),
        target,
      );
      visibleNewCount = resultRecords.length;
      returnedExisting = 0;
      if (visibleNewCount < target && !input.disableBackfill) {
        scheduleTestTenantVideoBackfill({
          tenantId,
          platform,
          keyword,
          target: target - visibleNewCount,
          reason: 'crawl_result_visible_backfill',
          dateFrom,
          dateTo,
          forceCreate: true,
        });
      }
    } else if (resultRecords.length > 0 && !replay) {
      await enqueueCrawledRecordsForAnalysis(resultRecords);
    }

    const message = input.deferAnalysis && candidateIds.length > 0
      ? `已采集 ${candidateIds.length} 条真实候选（新增 ${imported} 条）；视频分析在后台继续，分析通过后才可作为参考。`
      : testTenant
        ? (crawlerMessage || (resultRecords.length === 0
          ? `采集完成：本次新增 ${imported} 条候选，跳过已入库 ${skippedExisting} 条；暂无新增视频级可用结果，后台继续按同关键词补位，失败/不可分析结果已隐藏并进入人工处理。`
          : resultRecords.length < target
            ? `采集完成：本次返回 ${resultRecords.length} 条新增视频级结果（新增候选 ${imported} 条，跳过已入库 ${skippedExisting} 条），未达到用户输入数量 ${target}；后台继续按同关键词补位。`
            : `采集完成：本次返回 ${resultRecords.length} 条新增视频级结果（新增候选 ${imported} 条，跳过已入库 ${skippedExisting} 条）${crawlerTopUpMessage}`))
        : crawlerMessage
        || (resultRecords.length === 0
          ? `有效去重后没有新增视频，返回库内已有匹配 ${returnedExisting} 条；请换关键词、放宽日期范围或降低数量。`
          : resultRecords.length < target
            ? `采集完成：返回 ${resultRecords.length} 条（新增 ${imported} 条，库内已有 ${returnedExisting} 条），未达到用户输入数量 ${target}；可换关键词或放宽日期范围。`
            : `采集完成：返回 ${resultRecords.length} 条（新增 ${imported} 条，库内已有 ${returnedExisting} 条）${crawlerTopUpMessage}${visibleNewCount > 0 ? `；已返回 ${visibleNewCount} 条视频级可用结果` : ''}`);

    return {
      outcome: candidateIds.length > 0 ? 'collected' : 'no_data',
      candidateIds,
      analysisPending: candidateIds.length > 0 && (input.deferAnalysis === true || (testTenant && resultRecords.length < candidateIds.length)),
      platform,
      keyword,
      imported,
      refreshed,
      skipped,
      skippedExisting,
      skippedNearDuplicate,
      nearDuplicateUnchecked,
      returnedExisting,
      requested: target,
      total: items.length,
      source: crawlerSource,
      message,
      items: resultRecords,
    };
  }

  return { acquireDiscoveryAdmissionLease, crawlVideosForTenant };
}
