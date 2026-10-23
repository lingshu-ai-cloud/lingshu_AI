import { type LinkedInCompanyPaidPermit } from './linkedinCompanyPostPaidCollection.js';
import type { DataStore } from '../storage/datastore.js';
import { registerReferenceExactShotMaterializationRoutes } from './referenceExactShotMaterialization.js';
import { prepareReferenceNarration, readCachedReferenceNarration } from '../lib/referenceNarration.js';
import { type ReferenceSpeechTranscript } from '../lib/referenceSpeechAnalysis.js';
import { DownloadBudget } from '../lib/downloadExecution.js';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import type { Platform, VideoAiAnalysis } from '../types/index.js';
import { execFileAsync } from '../videos/runtimeConfig.js';
import type { CrawlVideosInput, CrawlVideosResult, VideoAsrSegment } from '../videos/contracts.js';
import { createVideoApplication } from '../videos/application.js';
import type { SourceAnalysisAdapters } from '../videos/applicationPorts.js';
export type { SourceAnalysisAdapters } from '../videos/applicationPorts.js';
export type { CrawlVideosInput, CrawlVideosResult } from '../videos/contracts.js';
export { crawlFailureMessage, youtubeHtmlSearchUrl } from './videoCrawlerPublicProjection.js';
export { isDisplayableTestTenantVideo } from './videoRecordVisibility.js';
export { recordThumbnailUrl } from './videoThumbnailPersistence.js';
export { matchesVideoSearch, matchesCrawlRange } from './videoTenantListing.js';
export { groupExactObservationWindows, selectFramesForPhysicalCuts, splitExactGeminiShotsAtSceneCuts } from './videoAnalysisTimelineProjection.js';
export { describeVideoAnalysisRecovery, queuedMaterialFailureRequiresSourceFallback, queuedVideoAnalysisFailurePatch, videoAnalysisRetryQueuePatch } from './videoAnalysisRecovery.js';
export type { VideoAnalysisRecovery, VideoAnalysisRetryQueueKind } from './videoAnalysisRecovery.js';
export { accountLabelFromUrl, looksLikeAccountUrl } from './videoCrawlerSourceUrls.js';
export { filterCrawlerOpsTasksForRecordIds, recoverInterruptedCrawlerOpsTask, resetCrawlerOpsTaskForExplicitRetryState, selectPendingCrawlerOpsTasks, terminalizeExhaustedCrawlerOpsTask } from './videoCrawlerOpsTaskState.js';
export { buildApifyTikTokInput } from './apifyTikTokInput.js';
export { platformReferer } from './videoDownloaderArgs.js';
export { extractQwenAnalysisFrames } from './videoFrameExtraction.js';
export { apifyCandidateWindow, inferPlatformFromUrl } from './videoCrawlerNormalization.js';

export const videosRouter = Router();
videosRouter.use(requireAuth);
registerReferenceExactShotMaterializationRoutes(videosRouter, store);

const application = createVideoApplication(videosRouter);
export const imagePostAnalysisQueue = application.imagePostAnalysisQueue;
export const permitsCrossProviderHookMotionInspection = application.permitsCrossProviderHookMotionInspection;

application.collectionRoutesApplication.registerPostCrawl();
application.collectionRoutesApplication.registerPostCrawlImagePosts();
application.sourceRoutesApplication.registerPostDownloadMaterial();
application.sourceRoutesApplication.registerPostIdDownloadMaterial();
application.sourceRoutesApplication.registerPostAnalyzeSource();
application.sourceRoutesApplication.registerPostIdAnalyzeSource();
application.sourceRoutesApplication.registerPostIdContextAssessment();
application.sourceRoutesApplication.registerPostIdContextAssessmentAssessmentIdEvaluate();
application.opsRoutesApplication.registerGetOpsQueue();
application.opsRoutesApplication.registerGetOpsStats();
application.opsRoutesApplication.registerPostOpsRunOnce();
application.opsRoutesApplication.registerPostOpsTaskIdResolve();
application.referenceImportApplication.registerPostImportReferenceFile();
application.referenceImportApplication.registerPostIngest();
application.registerListingRoutes();
application.recordRoutesApplication.registerPostIdReanalyzeImage();
application.recordRoutesApplication.registerPatchId();
application.recordRoutesApplication.registerDeleteId();
application.reviewRoutesApplication.registerGetIdShotReview();
application.reviewRoutesApplication.registerPutIdShotReview();
application.reviewRoutesApplication.registerPostIdShotReviewShotIdMaterialize();
application.reviewRoutesApplication.registerGetIdShotReviewShotIdKind();
application.reviewRoutesApplication.registerGetIdReviewHandoff();
application.reviewRoutesApplication.registerGetIdVerifiedSpeech();
application.reviewRoutesApplication.registerPutIdVerifiedSpeech();
application.reviewRoutesApplication.registerPostIdSalesPresenterReview();
application.reviewRoutesApplication.registerPostIdAlignSpeech();
application.reviewRoutesApplication.registerPostIdClassifyCriticalShots();
application.reviewRoutesApplication.registerPostIdRouteProduction();
application.reviewRoutesApplication.registerPostIdPhraseAsr();
application.reviewRoutesApplication.registerPostIdSpeechTimeline();
application.reviewRoutesApplication.registerGetId();
application.mediaRoutesApplication.registerGetIdMedia();
application.mediaRoutesApplication.registerGetIdShotNumberKind();
application.mediaRoutesApplication.registerGetIdMediaUrl();
application.mediaRoutesApplication.registerGetIdThumbnail();
application.mediaRoutesApplication.registerGetIdImageIndex();
application.reviewRoutesApplication.registerPatchIdAnalysisCorrections();
application.reviewRoutesApplication.registerPostIdRefinementSync();
application.analysisControlRoutesApplication.registerPostIdAnalysisPause();
application.analysisControlRoutesApplication.registerPostIdAnalysisCancel();
application.analysisControlRoutesApplication.registerPostIdAnalysisResume();
application.analysisControlRoutesApplication.registerPostMaterialExactAnalysis();
application.analysisControlRoutesApplication.registerPatchIdReanalyze();

export function activeAnalysisRequest(analysis: Record<string, unknown>, mode?: 'strategy' | 'exact'): boolean {
  return application.activeAnalysisRequest(analysis, mode);
}

export function isWeeklyOriginalAccountCollectionRecord(record?:Record<string,unknown>|null):boolean {
  return application.isWeeklyOriginalAccountCollectionRecord(record);
}

export async function acquireDiscoveryAdmissionLease(tenantId: string, dataStore:DataStore=store) {
  return application.acquireDiscoveryAdmissionLease(tenantId, dataStore);
}

export async function crawlImagePostsForTenant(input: {
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
  return application.crawlImagePostsForTenant(input);
}

export async function crawlVideosForTenant(input: CrawlVideosInput): Promise<CrawlVideosResult> {
  return application.crawlVideosForTenant(input);
}

export function shouldCreateTestTenantAnalysisJob(analysis: Record<string, unknown>, normallyQueueable: boolean): boolean {
  return application.shouldCreateTestTenantAnalysisJob(analysis, normallyQueueable);
}

export function shouldResumeReferenceAnalysis(analysis: Record<string, unknown>, duration = 0): boolean {
  return application.shouldResumeReferenceAnalysis(analysis, duration);
}

export function canRepairStoredExactClassification(
  record: Record<string, unknown>,
  analysis: Record<string, unknown>,
): boolean {
  return application.canRepairStoredExactClassification(record, analysis);
}

export async function attachManualVideoUploadAndQueue(input: {
  recordId: string;
  videoBase64: string;
  mimeType?: string;
  filename?: string;
  uploadedBy?: string;
}): Promise<{ recordId: string; filename: string; status: 'queued' }> {
  return application.attachManualVideoUploadAndQueue(input);
}

export async function queueAnalyzeSource(
  record: Record<string, unknown>,
  job?: { record: Record<string, unknown> | null; sourceUrl: string; title: string; platform: Platform },
): Promise<void> {
  return application.queueAnalyzeSource(record, job);
}

export async function queueExactSourceAnalysisForTenant(input: {
  tenantId: string;
  recordId: string;
}): Promise<'already_ready' | 'queued'> {
  return application.queueExactSourceAnalysisForTenant(input);
}

export async function repairMissingCrawledThumbnails(records: unknown[], limit = 5): Promise<number> {
  return application.repairMissingCrawledThumbnails(records, limit);
}

export async function backfillMissingCrawledMedia(records: unknown[]): Promise<void> {
  return application.backfillMissingCrawledMedia(records);
}

export function initPocketBaseVideoBackfill(): void {
  return application.initPocketBaseVideoBackfill();
}

export async function analyzeSourceVideoJob(input: {
  record: Record<string, unknown> | null;
  sourceUrl: string;
  title: string;
  platform: Platform;
  opsTaskId?: string;
  suppressOpsRequeue?: boolean;
  skipYoutubeUrlAnalysis?: boolean;
  suppressVisibleBackfill?: boolean;
  forceManualFailure?: boolean;
}, adapters: SourceAnalysisAdapters = {}): Promise<unknown> {
  return application.analyzeSourceVideoJob(input, adapters);
}

export function buildApifyFacebookAccountInput(accountUrl: string, limit: number, strictProviderLimit = false): Record<string, unknown> {
  return application.buildApifyFacebookAccountInput(accountUrl, limit, strictProviderLimit);
}

export async function downloadVideoForAnalysis(input: {
  sourceUrl: string;
  title: string;
  platform: Platform;
  record?: Record<string, unknown> | null;
  allowPaidFallback?: boolean;
  allowCookieFallback?: boolean;
}, executeDownload = execFileAsync, budget = new DownloadBudget(Math.max(10_000, Number(process.env.VIDEO_ANALYSIS_DOWNLOAD_TIMEOUT_MS || 150_000)))): Promise<{ filePath: string; fileName: string; mimeType: string; size: number }> {
  return application.downloadVideoForAnalysis(input, executeDownload, budget);
}

export function coarseAsrSentences(text: string, start: number, end: number): VideoAsrSegment[] {
  return application.coarseAsrSentences(text, start, end);
}

export function lockAsrTimeline(analysis: VideoAiAnalysis, transcript?: ReferenceSpeechTranscript): VideoAiAnalysis {
  return application.lockAsrTimeline(analysis, transcript);
}

export function exactAnalysisChunkRanges(duration: number, chunkSeconds = 6): Array<{ start: number; end: number }> {
  return application.exactAnalysisChunkRanges(duration, chunkSeconds);
}

export function exactAnalysisDuration(duration: number, frameTimes: number[]): number {
  return application.exactAnalysisDuration(duration, frameTimes);
}

export function exactSourceClockDuration(analysis: VideoAiAnalysis, expectedRunId: string): number | undefined {
  return application.exactSourceClockDuration(analysis, expectedRunId);
}

export async function referenceNarrationForVideoAnalysis(
  filePath: string,
  duration: number,
  tenantId: string,
  ports: {
    readCached?: typeof readCachedReferenceNarration;
    prepare?: typeof prepareReferenceNarration;
  } = {},
) {
  return application.referenceNarrationForVideoAnalysis(filePath, duration, tenantId, ports);
}

export function readExactQwenScopeContinuity() {
  return application.readExactQwenScopeContinuity();
}

export async function analyzeDownloadedVideoWithFallback(opts: {
  filePath: string;
  mimeType: string;
  title?: string;
  platform?: Platform;
  duration?: number;
  views?: string;
  tags?: string[];
  sourceLabel: string;
  videoId?: string;
  tenantId?: string;
  analysisMode?: 'strategy' | 'exact';
  analysisRunId?: string;
  videoObjectKey?: string;
}): Promise<{ analysis: VideoAiAnalysis; source: string }> {
  return application.analyzeDownloadedVideoWithFallback(opts);
}

export function buildYtDlpArgs(extra: string[], url: string, withCookies: boolean): string[] {
  return application.buildYtDlpArgs(extra, url, withCookies);
}

export async function runQueuedLocalAnalysisWorkerOnce(options: { recoverInterrupted?: boolean; tenantId?: string } = {}): Promise<{
  picked: number;
  completed: number;
  failed: number;
  skipped: number;
}> {
  return application.runQueuedLocalAnalysisWorkerOnce(options);
}

export function initCrawlerOpsWorker(): void {
  return application.initCrawlerOpsWorker();
}

export async function runCrawlerOpsWorkerOnce(options: { recoverInterrupted?: boolean; tenantId?: string } = {}): Promise<{
  ok: boolean;
  picked: number;
  resolved: number;
  retried: number;
  failed: number;
  skipped: number;
}> {
  return application.runCrawlerOpsWorkerOnce(options);
}

export async function getVideoPipelineStats(tenantId?: string): Promise<Record<string, unknown>> {
  return application.getVideoPipelineStats(tenantId);
}
