import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { createVideoCollectionApplication } from './videoCollectionApplication.js';
import { createImagePostCollectionApplication } from './imagePostCollectionApplication.js';
import { createVideoDownloadRuntime } from './videoDownloadRuntime.js';
import { createSourceAnalysisExecution } from './sourceAnalysisExecution.js';
import { createVideoAnalysisRequestPolicy } from './videoAnalysisRequestPolicy.js';
import { MAX_DOWNLOAD_JOBS } from './runtimeConfig.js';
import { RecordWorkRegistry } from '../lib/downloadExecution.js';
import { AnalysisLeaseRegistry } from '../lib/analysisLease.js';

const unexpected = (..._args: unknown[]): never => { throw new Error('Unapproved work crossed the tested boundary'); };

function collection() {
  return createVideoCollectionApplication({
    purgeLegacyFakeVideos: unexpected, isTestTenantId: unexpected, crawlTikTokWithPaidPermit: unexpected,
    crawlAccountHomepage: unexpected, crawlYouTubeSearch: unexpected, crawlFacebook: unexpected,
    crawlTikTokWithApifyFallback: unexpected, crawlInstagramWithApifyFallback: unexpected,
    topUpCrawledItems: unexpected, persistThumbnailIfExpiring: unexpected, queueTestTenantVideoLevelAnalysis: unexpected,
    analyzeFreshCrawledRecordsForTestTenant: unexpected, scheduleTestTenantVideoBackfill: unexpected,
    enqueueCrawledRecordsForAnalysis: unexpected,
  });
}

test('LinkedIn collection rejects missing worker authority before provider, store or backfill work', async () => {
  await assert.rejects(collection().crawlVideosForTenant({
    tenantId: 'tenant', platform: 'linkedin', mode: 'account', accountUrl: 'https://www.linkedin.com/company/example/',
  }), /linkedin_company_paid_collection_permit_required/);
});

test('scoped weekly TikTok account collection cannot enter the historical fallback without its permit', async () => {
  await assert.rejects(collection().crawlVideosForTenant({
    tenantId: 'tenant', platform: 'tiktok', mode: 'account', accountUrl: 'https://www.tiktok.com/@example',
    discoveryContext: { runId: 'run', scopeId: 'scope', scopeVersion: 1, mode: 'account', queryRef: 'https://www.tiktok.com/@example' },
  }), /weekly_preproduction_collection_paid_permit_required/);
});

test('image collection rejects missing LinkedIn authority before downloading or analyzing images', async () => {
  const app = createImagePostCollectionApplication({
    crawlInstagramImagePostsApify: unexpected, crawlTikTokImagePostsApify: unexpected,
    crawlFacebookImagePostsApify: unexpected, crawlYouTubeCommunityPostsPublicSearch: unexpected,
    imagePostRelevant: unexpected, persistImagePostThumbnail: unexpected, persistImagePostImages: unexpected,
    analyzeImagePostBestEffort: unexpected, queueImagePostAnalysis: unexpected,
  });
  await assert.rejects(app.crawlImagePostsForTenant({
    tenantId: 'tenant', platform: 'linkedin', limit: 5, mode: 'account', accountUrl: 'https://www.linkedin.com/company/example/',
  }), /linkedin_company_paid_collection_permit_required/);
});

function downloads(overrides: Partial<Parameters<typeof createVideoDownloadRuntime>[0]> = {}) {
  return createVideoDownloadRuntime({
    isWeeklyOriginalAccountCollectionRecord: unexpected, ytDlpPythonPath: unexpected,
    buildYtDlpArgs: unexpected, crawlerExecEnv: unexpected, execYtDlpWithCookieFallback: unexpected,
    apifyTenantIdFromRecord: unexpected, canUseApifyVideoFallback: unexpected,
    downloadInstagramVideoViaApify: unexpected, downloadTikTokVideoViaApify: unexpected,
    extractPoster: unexpected, probeDuration: unexpected, persistMaterials: unexpected, loadMaterials: unexpected,
    downloadFacebookVideoViaApify: unexpected, downloadYouTubeVideoViaApify: unexpected, readTikTokPublicApi: unexpected,
    ...overrides,
  });
}

test('same-run original media cannot fall through to a second independent download', async () => {
  const policy = createVideoAnalysisRequestPolicy({ canUseApifyVideoFallback: unexpected, apifyTenantIdFromRecord: unexpected });
  const app = downloads({ isWeeklyOriginalAccountCollectionRecord: policy.isWeeklyOriginalAccountCollectionRecord });
  await assert.rejects(app.downloadVideoForAnalysis({
    sourceUrl: 'https://www.tiktok.com/@example/video/12345', title: 'original', platform: 'tiktok',
    record: { aiAnalysis: { discoveryOrigins: [{ weeklyOriginalAccountCollection: { originalRunKey: 'weekly-preproduction:run' } }] } },
  }), /weekly_original_account_media_requires_same_run_kv/);
});

test('download concurrency remains bounded and a rejected operation releases its slot', async () => {
  assert.ok(Number.isInteger(MAX_DOWNLOAD_JOBS) && MAX_DOWNLOAD_JOBS > 0 && MAX_DOWNLOAD_JOBS < 100, 'use a bounded concurrency fixture');
  const app = downloads();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let active = 0;
  let maximum = 0;
  const occupied = Array.from({ length: MAX_DOWNLOAD_JOBS }, (_, index) => app.withDownloadSlot(async () => {
    active++;
    maximum = Math.max(maximum, active);
    try { await gate; if (index === 0) throw new Error('download failed'); return index; }
    finally { active--; }
  }));
  const settled = Promise.allSettled(occupied);
  let queuedStarted = false;
  const queued = app.withDownloadSlot(async () => { queuedStarted = true; return 42; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(queuedStarted, false);
  release();
  const results = await settled;
  assert.equal(results.filter(item => item.status === 'rejected').length, 1);
  assert.equal(await queued, 42);
  assert.equal(maximum, MAX_DOWNLOAD_JOBS);
  assert.equal(active, 0);
  let releaseSecond!: () => void;
  const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
  let secondStarted = 0;
  const second = Array.from({ length: MAX_DOWNLOAD_JOBS }, () => app.withDownloadSlot(async () => {
    secondStarted++;
    await secondGate;
  }));
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(secondStarted, MAX_DOWNLOAD_JOBS, 'the rejected operation must not leave an occupied slot');
  } finally {
    releaseSecond();
    await Promise.all(second);
  }
});

class ForbiddenLease extends AnalysisLeaseRegistry {
  override async run<T>(_key: string, _action: () => Promise<T>): Promise<T> {
    throw new Error('Unexpected analysis lease');
  }
}

test('unsafe source analysis cannot acquire a work slot or an analysis lease', async () => {
  const app = createSourceAnalysisExecution({
    withDownloadSlot: unexpected, activeAnalysisRecords: new RecordWorkRegistry(),
    durableAnalysisRecords: new ForbiddenLease(path.join(os.tmpdir(), '1006-unused-video-boundary-lease')),
    shouldUseQwenFirst: unexpected, downloadVideoForAnalysis: unexpected, compressPocketBasePreview: unexpected,
    uploadCrawlerCosObject: unexpected, analyzeDownloadedVideoWithFallback: unexpected,
    persistExactShotEvidence: unexpected, exactSourceClockDuration: unexpected,
    isTikTokUnusableWithoutVideoFallback: unexpected, updateCrawlerOpsTask: unexpected,
    enqueueCrawlerOpsTask: unexpected, pushCrawlerOpsTask: unexpected, isRetryableAnalysisFailure: unexpected,
    cleanupTempVideo: unexpected, scheduleTestTenantVideoBackfill: unexpected,
  });
  await assert.rejects(app.analyzeSourceVideoJob({
    record: { id: 'record', tenantId: 'tenant' }, sourceUrl: 'http://127.0.0.1/private', title: 'unsafe', platform: 'tiktok',
  }), /unsafe_public_video_source/);
});
