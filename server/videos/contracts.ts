import type { PaidApifyTikTokPermit } from '../routes/apifyPaidTikTokTransport.js';
import type { LinkedInCompanyPaidPermit } from '../routes/linkedinCompanyPostPaidCollection.js';
import type { VerifiedWeeklyOriginalDatasetReplay } from '../socialDiscovery/weeklyAccountCollectionDatasetContinuation.js';
import type { DataStore } from '../storage/datastore.js';
import type { Platform } from '../types/index.js';
import type { SocialDiscoveryMode } from '../../shared/contracts/socialContentWorkflow.js';

export interface Material {
  id: string;
  name: string;
  folder: string;
  type: 'video' | 'image' | 'audio';
  duration: number;
  size: string;
  file: string;
  url: string;
  poster?: string;
  objectKey?: string;
  tenantId?: string;
  scope: 'shared' | 'own';
  usage?: 'editable' | 'reference_only';
  sourceType?: string;
  sourceUrl?: string;
  rightsReviewStatus?: string;
  commercialUseApproved?: boolean;
  derivativesApproved?: boolean;
  rawLibraryUseApproved?: boolean;
  mayAnalyze?: boolean;
  mayUseInProduction?: boolean;
  pinned?: boolean;
  contentSha256?: string;
  provenance?: Record<string, unknown>;
  createdAt: string;
}

export interface TestTenantVideoBackfillInput {
  tenantId: string;
  platform: Platform;
  keyword?: string;
  target: number;
  replacementForRecordId?: string;
  reason?: string;
  forceCreate?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface CrawlVideosInput {
  tenantId: string;
  platform?: Platform;
  keyword?: string;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
  // 对标账号主页采集：mode='account' 时 accountUrl 为账号主页 URL，
  // 采集该账号最新视频而非按关键词检索。
  mode?: 'keyword' | 'account';
  accountUrl?: string;
  accountName?: string;
  cloudFallback?: boolean;
  /** One-shot diagnostics must never fan out into automatic replacement crawls. */
  disableBackfill?: boolean;
  /** Scheduled collection finishes after persistence; analysis owns its own queue. */
  deferAnalysis?: boolean;
  /** Maintenance callers may take immediate ownership of exact analysis after persistence. */
  suppressAnalysisQueue?: boolean;
  /** Approved discovery only counts newly imported videos, never a previously stored URL or platform video ID. */
  newCandidatesOnly?: boolean;
  /** Mandatory authority for scoped weekly TikTok account collection; never used by manual crawls. */
  paidPermit?: PaidApifyTikTokPermit;
  /** Trusted discovery worker only; the HTTP crawler never accepts a permit from request JSON. */
  linkedInPaidPermit?: LinkedInCompanyPaidPermit;
  /** Opaque, in-process proof issued only after the original journal and wallet agree. */
  originalDatasetReplay?: VerifiedWeeklyOriginalDatasetReplay;
  /** Trusted worker store; never accepted from an HTTP request. */
  dataStore?: DataStore;
  /** Immutable discovery provenance attached to every imported or deduplicated candidate. */
  discoveryContext?: {
    runId: string;
    scopeId: string;
    scopeVersion: number;
    mode: SocialDiscoveryMode;
    queryRef: string;
    /** A same-run five-video collection is never eligible for legacy Actor
     * sync or a second Actor download, even when an old paid permit exists. */
    weeklyOriginalAccountCollection?: {originalRunKey:string;accountUrl:string;actorInputSha256:string};
  };
}

export interface CrawlVideosResult {
  outcome?: 'collected' | 'no_data';
  candidateIds?: string[];
  analysisPending?: boolean;
  platform: Platform;
  keyword: string;
  imported: number;
  refreshed: number;
  skipped: number;
  skippedExisting: number;
  skippedNearDuplicate?: number;
  nearDuplicateUnchecked?: number;
  returnedExisting: number;
  requested: number;
  total: number;
  source: string;
  message: string;
  items: unknown[];
}

export type TikTokPublicApiData = {
  id?: string; title?: string; duration?: number; cover?: string; origin_cover?: string;
  play?: string; hdplay?: string; play_count?: number; digg_count?: number;
  comment_count?: number; share_count?: number; create_time?: number;
  author?: { nickname?: string; unique_id?: string; };
};

export type VideoAsrSegment = { words?: Array<{start: number; end: number; text: string}>; start: number; end: number; text: string; timingPrecision?: 'phrase' | 'coarse'; provenance?: string; needsReview?: boolean };

export type ApifyVideoUsageDay = {
  total: number;
  tenants: Record<string, number>;
};

export type ApifyVideoUsageStore = Record<string, number | ApifyVideoUsageDay>;
