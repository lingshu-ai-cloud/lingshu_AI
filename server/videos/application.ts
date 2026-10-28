import { normalizeThumbnailUrl } from '../routes/videoCrawlerProviderProjection.js';
import { readSocialImageReferenceBytes } from '../socialImage/socialImageReferenceBytes.js';
import { createVideoTenantListing } from '../routes/videoTenantListing.js';
import { registerVideoListingRoutes } from '../routes/videoListingRoutes.js';
import { createVideoThumbnailPersistence } from '../routes/videoThumbnailPersistence.js';
import { createImagePostEvidenceAnalyzer } from '../socialDiscovery/imagePostEvidenceAnalysis.js';
import { createImagePostAnalysisQueue } from '../socialDiscovery/imagePostAnalysisQueue.js';
import { createImagePostMediaPersistence } from '../socialDiscovery/imagePostMediaPersistence.js';
import { AnalysisLeaseRegistry } from '../lib/analysisLease.js';
import { RecordWorkRegistry } from '../lib/downloadExecution.js';
import { Router } from 'express';
import path from 'path';
import { store } from '../storage/index.js';
import { attachFile } from '../storage/files.js';
import { COL, __dirname, MEDIA_DIR } from './runtimeConfig.js';
import type { VideoApplicationPorts } from './applicationPorts.js';
import { crawlerCosKey, uploadCrawlerCosObject, recoverCrawlerImageObjectKey, streamCrawlerCosObject, storedCrawlerVideo } from './crawlerObjectStorage.js';
import { createExactEvidencePersistence } from './exactEvidencePersistence.js';
import { createVideoVisibilityMaintenance } from './videoVisibilityMaintenance.js';
import { createVideoCollectionApplication } from './videoCollectionApplication.js';
import { createImagePostCollectionApplication } from './imagePostCollectionApplication.js';
import { createVideoCollectionRoutes } from '../routes/videoCollectionRoutes.js';
import { createVideoSourceRequestRoutes } from '../routes/videoSourceRequestRoutes.js';
import { createVideoOpsRoutes } from '../routes/videoOpsRoutes.js';
import { createVideoReferenceImportRoutes } from '../routes/videoReferenceImportRoutes.js';
import { createVideoRecordMutationRoutes } from '../routes/videoRecordMutationRoutes.js';
import { createVideoReferenceReviewRoutes } from '../routes/videoReferenceReviewRoutes.js';
import { createVideoAssetRoutes } from '../routes/videoAssetRoutes.js';
import { createVideoAnalysisControlRoutes } from '../routes/videoAnalysisControlRoutes.js';
import { createSourceAnalysisSubmission } from './sourceAnalysisSubmission.js';
import { createVideoBackgroundWorkers } from './videoBackgroundWorkers.js';
import { createMaterialAcquisitionApplication } from './materialAcquisitionApplication.js';
import { createVideoDownloadRuntime } from './videoDownloadRuntime.js';
import { createSourceAnalysisExecution } from './sourceAnalysisExecution.js';
import { createMaterialAnalysisExecution } from './materialAnalysisExecution.js';
import { createQueuedMaterialAnalysis } from './queuedMaterialAnalysis.js';
import { createVideoCollectionProviders } from './videoCollectionProviders.js';
import { createImagePostCollectionProviders } from './imagePostCollectionProviders.js';
import { createVideoDiscoverySearch } from './videoDiscoverySearch.js';
import { createAccountCollectionProvider } from './accountCollectionProvider.js';
import { createVideoDownloadFallbacks } from './videoDownloadFallbacks.js';
import { runApifyActorDatasetItems, apifyVideoDailyLimit, apifyVideoTenantDailyLimit, apifyTenantIdFromRecord, apifyVideoUsageToday, canUseApifyVideoFallback, canUseApifyInstagramCrawlFallback, canUseApifyFacebookCrawlFallback, canUseApifyTikTokCrawlFallback, recordApifyVideoFallbackUse } from './apifyFallbackRuntime.js';
import { createVideoAnalysisProvider } from './videoAnalysisProvider.js';
import { coarseAsrSentences, lockAsrTimeline, assertFullVideoTimeline, analyzeExactLongVideoChunks, exactAnalysisChunkRanges, exactAnalysisDuration, exactSourceClockDuration, referenceNarrationForVideoAnalysis } from './exactVideoAnalysis.js';
import { createVideoDownloaderTransport } from './videoDownloaderTransport.js';
import { createCrawlerOpsApplication } from './crawlerOpsApplication.js';
import { loadMaterials, persistMaterials } from './materialFileRepository.js';
import { compressPocketBasePreview, compressVideoBufferForPocketBase, runFfmpeg, extractPoster, probeDuration } from './localMediaProcessing.js';
import { createVideoAnalysisRequestPolicy } from './videoAnalysisRequestPolicy.js';
import { createReferenceImportApplication } from './referenceImportApplication.js';

export function createVideoApplication(videosRouter: Router) {
  const activeAnalysisRecords = new RecordWorkRegistry();
  const durableAnalysisRecords = new AnalysisLeaseRegistry(path.join(__dirname, '../../data/analysis-locks'));

  const ports: VideoApplicationPorts = {
    get isQwenConfigured() { return isQwenConfigured; },
    get uploadCrawlerCosObject() { return uploadCrawlerCosObject; },
    get crawlYouTubeSearch() { return crawlYouTubeSearch; },
    get crawlTikTokWithApifyFallback() { return crawlTikTokWithApifyFallback; },
    get crawlInstagramWithApifyFallback() { return crawlInstagramWithApifyFallback; },
    get crawlSocialUrlOrFallback() { return crawlSocialUrlOrFallback; },
    get analyzeSourceVideoJob() { return analyzeSourceVideoJob; },
    get shouldQueueVideoAnalysis() { return shouldQueueVideoAnalysis; },
    get queueAnalyzeSource() { return queueAnalyzeSource; },
    get runApifyActorDatasetItems() { return runApifyActorDatasetItems; },
    get isMissingLocalThumbnail() { return isMissingLocalThumbnail; },
    get cacheThumbnailLocally() { return cacheThumbnailLocally; },
    get crawlYtDlpMetadata() { return crawlYtDlpMetadata; },
    get downloadMaterialJob() { return downloadMaterialJob; },
    get purgeLegacyFakeVideos() { return purgeLegacyFakeVideos; },
    get isTestTenantId() { return isTestTenantId; },
    get crawlTikTokWithPaidPermit() { return crawlTikTokWithPaidPermit; },
    get crawlAccountHomepage() { return crawlAccountHomepage; },
    get crawlFacebook() { return crawlFacebook; },
    get topUpCrawledItems() { return topUpCrawledItems; },
    get persistThumbnailIfExpiring() { return persistThumbnailIfExpiring; },
    get queueTestTenantVideoLevelAnalysis() { return queueTestTenantVideoLevelAnalysis; },
    get analyzeFreshCrawledRecordsForTestTenant() { return analyzeFreshCrawledRecordsForTestTenant; },
    get scheduleTestTenantVideoBackfill() { return scheduleTestTenantVideoBackfill; },
    get enqueueCrawledRecordsForAnalysis() { return enqueueCrawledRecordsForAnalysis; },
    get crawlInstagramImagePostsApify() { return crawlInstagramImagePostsApify; },
    get crawlTikTokImagePostsApify() { return crawlTikTokImagePostsApify; },
    get crawlFacebookImagePostsApify() { return crawlFacebookImagePostsApify; },
    get crawlYouTubeCommunityPostsPublicSearch() { return crawlYouTubeCommunityPostsPublicSearch; },
    get imagePostRelevant() { return imagePostRelevant; },
    get persistImagePostThumbnail() { return persistImagePostThumbnail; },
    get persistImagePostImages() { return persistImagePostImages; },
    get analyzeImagePostBestEffort() { return analyzeImagePostBestEffort; },
    get queueImagePostAnalysis() { return queueImagePostAnalysis; },
    get videosRouter() { return videosRouter; },
    get crawlVideosForTenant() { return crawlVideosForTenant; },
    get crawlImagePostsForTenant() { return crawlImagePostsForTenant; },
    get resolvedPublicVideoSource() { return resolvedPublicVideoSource; },
    get loadMaterials() { return loadMaterials; },
    get persistMaterials() { return persistMaterials; },
    get copyStoredCrawlerVideoToMaterial() { return copyStoredCrawlerVideoToMaterial; },
    get crawlerOpsRecordIdsForTenant() { return crawlerOpsRecordIdsForTenant; },
    get loadCrawlerOpsTasks() { return loadCrawlerOpsTasks; },
    get crawlerOpsStats() { return crawlerOpsStats; },
    get runCrawlerOpsWorkerOnce() { return runCrawlerOpsWorkerOnce; },
    get persistCrawlerOpsTasks() { return persistCrawlerOpsTasks; },
    get analyzeOpsVideo() { return analyzeOpsVideo; },
    get referenceVideoDuration() { return referenceVideoDuration; },
    get findTenantReferenceByHash() { return findTenantReferenceByHash; },
    get recoverExistingReferenceImport() { return recoverExistingReferenceImport; },
    get clearTenantVisibleListCache() { return clearTenantVisibleListCache; },
    get startQueuedLocalAnalysis() { return startQueuedLocalAnalysis; },
    get compressVideoBufferForPocketBase() { return compressVideoBufferForPocketBase; },
    get localReferenceVideoPath() { return localReferenceVideoPath; },
    get crawlerCosKey() { return crawlerCosKey; },
    get streamCrawlerCosObject() { return streamCrawlerCosObject; },
    get durableAnalysisRecords() { return durableAnalysisRecords; },
    get probeDuration() { return probeDuration; },
    get ensureLocalReferenceVideoPath() { return ensureLocalReferenceVideoPath; },
    get downloadVideoForAnalysis() { return downloadVideoForAnalysis; },
    get cleanupTempVideo() { return cleanupTempVideo; },
    get extractPoster() { return extractPoster; },
    get recoverCrawlerImageObjectKey() { return recoverCrawlerImageObjectKey; },
    get storeThumbnailBuffer() { return storeThumbnailBuffer; },
    get resolveCrawlerOpsTasksForRecord() { return resolveCrawlerOpsTasksForRecord; },
    get activeAnalysisRequest() { return activeAnalysisRequest; },
    get resetCrawlerOpsTaskForExplicitRetry() { return resetCrawlerOpsTaskForExplicitRetry; },
    get canRepairStoredExactClassification() { return canRepairStoredExactClassification; },
    get analyzeDownloadedVideoWithFallback() { return analyzeDownloadedVideoWithFallback; },
    get persistExactShotEvidence() { return persistExactShotEvidence; },
    get exactSourceClockDuration() { return exactSourceClockDuration; },
    get enqueueCrawlerOpsTask() { return enqueueCrawlerOpsTask; },
    get updateCrawlerOpsTask() { return updateCrawlerOpsTask; },
    get activeAnalysisRecords() { return activeAnalysisRecords; },
    get backfillMissingCrawledMedia() { return backfillMissingCrawledMedia; },
    get executeQueuedLocalAnalysisRecord() { return executeQueuedLocalAnalysisRecord; },
    get enqueueOpsTasksFromRecords() { return enqueueOpsTasksFromRecords; },
    get pendingCrawlerOpsTasks() { return pendingCrawlerOpsTasks; },
    get persistManualVideoFailure() { return persistManualVideoFailure; },
    get apifyVideoUsageToday() { return apifyVideoUsageToday; },
    get apifyVideoDailyLimit() { return apifyVideoDailyLimit; },
    get apifyVideoTenantDailyLimit() { return apifyVideoTenantDailyLimit; },
    get storedCrawlerVideo() { return storedCrawlerVideo; },
    get withDownloadSlot() { return withDownloadSlot; },
    get downloadVideoToMaterial() { return downloadVideoToMaterial; },
    get compressPocketBasePreview() { return compressPocketBasePreview; },
    get analyzeDownloadedMaterial() { return analyzeDownloadedMaterial; },
    get isWeeklyOriginalAccountCollectionRecord() { return isWeeklyOriginalAccountCollectionRecord; },
    get ytDlpPythonPath() { return ytDlpPythonPath; },
    get buildYtDlpArgs() { return buildYtDlpArgs; },
    get crawlerExecEnv() { return crawlerExecEnv; },
    get execYtDlpWithCookieFallback() { return execYtDlpWithCookieFallback; },
    get apifyTenantIdFromRecord() { return apifyTenantIdFromRecord; },
    get canUseApifyVideoFallback() { return canUseApifyVideoFallback; },
    get downloadInstagramVideoViaApify() { return downloadInstagramVideoViaApify; },
    get downloadTikTokVideoViaApify() { return downloadTikTokVideoViaApify; },
    get downloadFacebookVideoViaApify() { return downloadFacebookVideoViaApify; },
    get downloadYouTubeVideoViaApify() { return downloadYouTubeVideoViaApify; },
    get readTikTokPublicApi() { return readTikTokPublicApi; },
    get shouldUseQwenFirst() { return shouldUseQwenFirst; },
    get isTikTokUnusableWithoutVideoFallback() { return isTikTokUnusableWithoutVideoFallback; },
    get pushCrawlerOpsTask() { return pushCrawlerOpsTask; },
    get isRetryableAnalysisFailure() { return isRetryableAnalysisFailure; },
    get triggerVideoAnalysis() { return triggerVideoAnalysis; },
    get crawlPublicSearch() { return crawlPublicSearch; },
    get canUseApifyTikTokCrawlFallback() { return canUseApifyTikTokCrawlFallback; },
    get canUseApifyInstagramCrawlFallback() { return canUseApifyInstagramCrawlFallback; },
    get canUseApifyFacebookCrawlFallback() { return canUseApifyFacebookCrawlFallback; },
    get discoverFacebookPageUrl() { return discoverFacebookPageUrl; },
    get fetchFacebookHtml() { return fetchFacebookHtml; },
    get crawlInstagramApify() { return crawlInstagramApify; },
    get crawlYtDlpSearch() { return crawlYtDlpSearch; },
    get crawlTikTokApify() { return crawlTikTokApify; },
    get crawlFacebookAccountApify() { return crawlFacebookAccountApify; },
    get recordApifyVideoFallbackUse() { return recordApifyVideoFallbackUse; },
    get referenceNarrationForVideoAnalysis() { return referenceNarrationForVideoAnalysis; },
    get analyzeExactLongVideoChunks() { return analyzeExactLongVideoChunks; },
    get lockAsrTimeline() { return lockAsrTimeline; },
    get assertFullVideoTimeline() { return assertFullVideoTimeline; },
    get enrichExactGeminiEvidence() { return enrichExactGeminiEvidence; },
    get runFfmpeg() { return runFfmpeg; },
    get proxyUrl() { return proxyUrl; },
    get isGeminiConfigured() { return isGeminiConfigured; },
    get shouldResumeReferenceAnalysis() { return shouldResumeReferenceAnalysis; },
  };

  const exactEvidenceApplication = createExactEvidencePersistence(ports);
  const { persistExactShotEvidence, enrichExactGeminiEvidence } = exactEvidenceApplication;

  const visibilityMaintenanceApplication = createVideoVisibilityMaintenance(ports);
  const { isTestTenantId, tenantAnalysisQueuePositions, withSignedThumbnail, scheduleTestTenantVideoBackfill, analyzeFreshCrawledRecordsForTestTenant, shouldCreateTestTenantAnalysisJob, queueTestTenantVideoLevelAnalysis, repairMissingCrawledThumbnails, backfillMissingCrawledMedia, purgeLegacyFakeVideos } = visibilityMaintenanceApplication;

  const collectionApplication = createVideoCollectionApplication(ports);
  const { acquireDiscoveryAdmissionLease, crawlVideosForTenant } = collectionApplication;

  const imageCollectionApplication = createImagePostCollectionApplication(ports);
  const { crawlImagePostsForTenant } = imageCollectionApplication;

  const collectionRoutesApplication = createVideoCollectionRoutes(ports);

  const sourceRoutesApplication = createVideoSourceRequestRoutes(ports);

  const opsRoutesApplication = createVideoOpsRoutes(ports);

  const referenceImportApplication = createVideoReferenceImportRoutes(ports);

  const recordRoutesApplication = createVideoRecordMutationRoutes(ports);

  const reviewRoutesApplication = createVideoReferenceReviewRoutes(ports);

  const mediaRoutesApplication = createVideoAssetRoutes(ports);
  const { localReferenceVideoPath, ensureLocalReferenceVideoPath } = mediaRoutesApplication;

  const analysisControlRoutesApplication = createVideoAnalysisControlRoutes(ports);

  const sourceSubmissionApplication = createSourceAnalysisSubmission(ports);
  const { triggerVideoAnalysis, queueAnalyzeSource, queueExactSourceAnalysisForTenant, enqueueCrawledRecordsForAnalysis } = sourceSubmissionApplication;

  const workersApplication = createVideoBackgroundWorkers(ports);
  const { initPocketBaseVideoBackfill, proxyUrl, crawlerExecEnv, runQueuedLocalAnalysisWorkerOnce, initCrawlerOpsWorker, runCrawlerOpsWorkerOnce, crawlerOpsStats } = workersApplication;

  const materialApplicationApplication = createMaterialAcquisitionApplication(ports);
  const { copyStoredCrawlerVideoToMaterial, downloadMaterialJob } = materialApplicationApplication;

  const downloadApplication = createVideoDownloadRuntime(ports);
  const { withDownloadSlot, downloadVideoToMaterial, downloadVideoForAnalysis, cleanupTempVideo } = downloadApplication;

  const sourceAnalysisApplication = createSourceAnalysisExecution(ports);
  const { analyzeSourceVideoJob, persistManualVideoFailure } = sourceAnalysisApplication;

  const materialAnalysisApplication = createMaterialAnalysisExecution(ports);
  const { analyzeDownloadedMaterial } = materialAnalysisApplication;

  const queuedAnalysisApplication = createQueuedMaterialAnalysis(ports);
  const { startQueuedLocalAnalysis, executeQueuedLocalAnalysisRecord } = queuedAnalysisApplication;

  const videoProvidersApplication = createVideoCollectionProviders(ports);
  const { crawlSocialUrlOrFallback, crawlTikTokWithApifyFallback, readTikTokPublicApi, crawlTikTokApify, crawlTikTokWithPaidPermit, crawlInstagramWithApifyFallback, crawlInstagramApify, crawlFacebookAccountApify, buildApifyFacebookAccountInput, crawlFacebook } = videoProvidersApplication;

  const imageProvidersApplication = createImagePostCollectionProviders(ports);
  const { crawlInstagramImagePostsApify, crawlTikTokImagePostsApify, crawlFacebookImagePostsApify, discoverFacebookPageUrl, crawlYouTubeCommunityPostsPublicSearch, imagePostRelevant } = imageProvidersApplication;

  const searchApplication = createVideoDiscoverySearch(ports);
  const { crawlYtDlpMetadata, crawlYouTubeSearch, crawlYtDlpSearch, crawlPublicSearch, topUpCrawledItems, fetchFacebookHtml } = searchApplication;

  const accountCollectionApplication = createAccountCollectionProvider(ports);
  const { crawlAccountHomepage } = accountCollectionApplication;

  const downloadFallbacksApplication = createVideoDownloadFallbacks(ports);
  const { downloadTikTokVideoViaApify, downloadYouTubeVideoViaApify, downloadInstagramVideoViaApify, downloadFacebookVideoViaApify } = downloadFallbacksApplication;

  const analysisProviderApplication = createVideoAnalysisProvider(ports);
  const { isQwenConfigured, isGeminiConfigured, shouldUseQwenFirst, isRetryableAnalysisFailure, permitsCrossProviderHookMotionInspection, readExactQwenScopeContinuity, analyzeDownloadedVideoWithFallback } = analysisProviderApplication;

  const downloaderTransportApplication = createVideoDownloaderTransport(ports);
  const { ytDlpPythonPath, buildYtDlpArgs, execYtDlpWithCookieFallback } = downloaderTransportApplication;

  const opsQueueApplication = createCrawlerOpsApplication(ports);
  const { loadCrawlerOpsTasks, crawlerOpsRecordIdsForTenant, persistCrawlerOpsTasks, updateCrawlerOpsTask, resetCrawlerOpsTaskForExplicitRetry, resolveCrawlerOpsTasksForRecord, enqueueCrawlerOpsTask, pendingCrawlerOpsTasks, enqueueOpsTasksFromRecords, getVideoPipelineStats, pushCrawlerOpsTask, analyzeOpsVideo } = opsQueueApplication;

  const requestPolicyApplication = createVideoAnalysisRequestPolicy(ports);
  const { activeAnalysisRequest, isWeeklyOriginalAccountCollectionRecord, shouldResumeReferenceAnalysis, canRepairStoredExactClassification, shouldQueueVideoAnalysis, resolvedPublicVideoSource, isTikTokUnusableWithoutVideoFallback } = requestPolicyApplication;

  const referenceImportApplicationApplication = createReferenceImportApplication(ports);
  const { referenceVideoDuration, findTenantReferenceByHash, recoverExistingReferenceImport, attachManualVideoUploadAndQueue } = referenceImportApplicationApplication;

  const { isMissingLocalThumbnail, cacheThumbnailLocally, storeThumbnailBuffer, persistThumbnailIfExpiring } = createVideoThumbnailPersistence({
    collection: COL, mediaDir: MEDIA_DIR, uploadObject: uploadCrawlerCosObject, dataStore: store, attachFile,
  });

  const { fetchImageForAnalysis, analyzeImagePostBestEffort } = createImagePostEvidenceAnalyzer({
    store, collection: COL, mediaDir: MEDIA_DIR, normalizeThumbnailUrl,
    readStoredReference: readSocialImageReferenceBytes,
  });

  const { persistThumbnail: persistImagePostThumbnail, persistImages: persistImagePostImages } = createImagePostMediaPersistence({
    store, collection: COL, cacheThumbnail: cacheThumbnailLocally,
    fetchImage: fetchImageForAnalysis, uploadObject: uploadCrawlerCosObject,
  });

  const imagePostAnalysisQueue = createImagePostAnalysisQueue({ store, collection: COL, analyze: analyzeImagePostBestEffort });

  const queueImagePostAnalysis = imagePostAnalysisQueue.queue;

  const videoTenantListing = createVideoTenantListing({
    store,
    collection: COL,
    isTestTenantId,
  });

  const { clearTenantVisibleListCache } = videoTenantListing;

  function registerListingRoutes() {
    registerVideoListingRoutes(videosRouter, {
      listing: videoTenantListing,
      tenantAnalysisQueuePositions,
      withSignedThumbnail,
    });
  }

  return { shouldCreateTestTenantAnalysisJob, repairMissingCrawledThumbnails, backfillMissingCrawledMedia, acquireDiscoveryAdmissionLease, crawlVideosForTenant, crawlImagePostsForTenant, queueAnalyzeSource, queueExactSourceAnalysisForTenant, initPocketBaseVideoBackfill, runQueuedLocalAnalysisWorkerOnce, initCrawlerOpsWorker, runCrawlerOpsWorkerOnce, downloadVideoForAnalysis, analyzeSourceVideoJob, buildApifyFacebookAccountInput, permitsCrossProviderHookMotionInspection, readExactQwenScopeContinuity, analyzeDownloadedVideoWithFallback, coarseAsrSentences, lockAsrTimeline, exactAnalysisChunkRanges, exactAnalysisDuration, exactSourceClockDuration, referenceNarrationForVideoAnalysis, buildYtDlpArgs, getVideoPipelineStats, activeAnalysisRequest, isWeeklyOriginalAccountCollectionRecord, shouldResumeReferenceAnalysis, canRepairStoredExactClassification, attachManualVideoUploadAndQueue, imagePostAnalysisQueue, registerListingRoutes, collectionRoutesApplication, sourceRoutesApplication, opsRoutesApplication, referenceImportApplication, recordRoutesApplication, reviewRoutesApplication, mediaRoutesApplication, analysisControlRoutesApplication };
}
