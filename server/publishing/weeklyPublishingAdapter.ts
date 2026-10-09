import {materializeInstagramDelivery} from './instagramDeliveryMedia.js';
import {instagramDeliveryPublishSourceClaim} from './publishSourceClaim.js';
import { fileURLToPath } from 'node:url';
import { socialAccessToken, youtubeCredentials } from '../lib/accountCredentials.js';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import { ensurePlatformCapability } from './platformCapabilities.js';
import { publishVideoToAccount, resolvePendingPublishToAccount, type PendingPublishResolution, type PublishToAccountInput, type PublishToAccountResult } from './platformPublisher.js';
import { socialProductionPublishSourceClaim } from './publishSourceClaim.js';
import { materializeSocialProductionVideo } from './socialProductionMedia.js';
import { createTikTokWeeklyPublishingAdapter } from './tiktokWeeklyPublishingAdapter.js';
import type { WeeklyPublishingProviderAdapter } from './weeklyLineage.js';

type Platform = WeeklyPublishingProviderAdapter['platform'];
type SocialAccount = { id: string; tenantId: string; platform: string; accessToken: string; status: string };
type YouTubeAccount = { id: string; tenantId: string; clientId: string; clientSecret: string; refreshToken: string; accessToken?: string; status: string };

export interface WeeklyPublishingPorts {
  publish(input: PublishToAccountInput): Promise<PublishToAccountResult>;
  reconcile(input: { tenantId: string; accountId: string; platform: Exclude<Platform, 'tiktok'>; providerReceiptId: string }): Promise<PendingPublishResolution>;
}

function localVideoPath(downloadUrl: string): string {
  const value = downloadUrl.trim();
  if (value.startsWith('file://')) return fileURLToPath(value);
  return value.startsWith('/') && !value.startsWith('/api/') ? value : '';
}

async function accountUnavailableReason(input: {
  tenantId: string;
  accountId: string;
  platform: Exclude<Platform, 'tiktok'>;
  dataStore: DataStore;
}): Promise<string> {
  if (input.platform === 'youtube') {
    const account = await input.dataStore.getById<YouTubeAccount>('youtube_accounts', input.accountId);
    if (!account || account.tenantId !== input.tenantId) return 'youtube_account_not_found';
    if (account.status !== 'connected') return 'youtube_account_not_connected';
    try { youtubeCredentials(account as unknown as Record<string, unknown>); }
    catch { return 'youtube_credential_unavailable'; }
    return '';
  }
  const account = await input.dataStore.getById<SocialAccount>('social_accounts', input.accountId);
  if (!account || account.tenantId !== input.tenantId || account.platform !== input.platform) return `${input.platform}_account_not_found`;
  if (account.status !== 'connected') return `${input.platform}_account_not_connected`;
  try { socialAccessToken(account as unknown as Record<string, unknown>); }
  catch { return `${input.platform}_credential_unavailable`; }
  return '';
}

async function createSynchronousWeeklyPublishingAdapter(input: {
  tenantId: string;
  accountId: string;
  platform: Exclude<Platform, 'tiktok'>;
  dataStore?: DataStore;
  now?: Date;
  ports?: WeeklyPublishingPorts;
}): Promise<WeeklyPublishingProviderAdapter> {
  const dataStore = input.dataStore ?? store;
  let unavailableReason = await accountUnavailableReason({ ...input, dataStore });
  if (!unavailableReason) {
    const decision = await ensurePlatformCapability({
      tenantId: input.tenantId, accountId: input.accountId, platform: input.platform,
      capability: 'publishing.official', now: input.now, dataStore,
    });
    if (decision.status !== 'available') unavailableReason = decision.reason;
  }
  const ports = input.ports ?? { publish: publishVideoToAccount, reconcile: resolvePendingPublishToAccount };

  return {
    provider: input.platform === 'youtube' ? 'youtube-data-api' : 'meta-graph-api',
    platform: input.platform,
    capability: unavailableReason ? 'unavailable' : 'available',
    ...(unavailableReason ? { unavailableReason } : {}),
    async publish({ assignment, publicationPackage, attemptId }) {
      if (assignment.tenantId !== input.tenantId || assignment.accountId !== input.accountId
        || assignment.platform !== input.platform) return { status: 'rejected', failureCode: 'adapter_account_scope_mismatch' };
      const video = publicationPackage.assets.find(asset => asset.kind === 'video');
      const suffix = `:${assignment.publicationTaskId}`;
      if (!publicationPackage.contentId.endsWith(suffix) || !video
        || assignment.lineage.productionResultRef.id !== publicationPackage.operatingLineage?.productionResultRef.id) {
        return { status: 'rejected', failureCode: 'social_production_lineage_mismatch' };
      }
      const artifactId = publicationPackage.contentId.slice(0, -suffix.length);
      const directPath = localVideoPath(video.downloadUrl);
      const materialized = directPath ? { videoPath: directPath, sourceUrl: '', async cleanup() {} }
        : await materializeSocialProductionVideo({ tenantId: assignment.tenantId, artifactId, attemptId, expectedHash: video.contentHash, dataStore });
      let delivery:Awaited<ReturnType<typeof materializeInstagramDelivery>>|null=null;
      try {
        let sourceClaim = await socialProductionPublishSourceClaim({
          tenantId: assignment.tenantId, artifactId, weeklyAssignment:assignment,
          productionResultId: assignment.lineage.productionResultRef.id,
          contentVersion: publicationPackage.contentVersion,
          contentHash: publicationPackage.contentHash,
          videoHash: video.contentHash, videoPath: materialized.videoPath,
          ...(materialized.sourceUrl ? { artifactVideoUrl: materialized.sourceUrl } : {}), dataStore,
        });
        if(input.platform==='instagram'){if(!assignment.lineage.instagramDelivery)return {status:'rejected',failureCode:'instagram_delivery_frozen_proof_missing'};delivery=await materializeInstagramDelivery(dataStore,assignment.lineage.instagramDelivery);sourceClaim=await instagramDeliveryPublishSourceClaim({tenantId:assignment.tenantId,assignment,sourceClaim,videoPath:delivery.videoPath,dataStore});}
        const result = await ports.publish({
          tenantId: assignment.tenantId, accountId: assignment.accountId, platform: input.platform,
          videoPath: delivery?.videoPath??materialized.videoPath, title: publicationPackage.copy.title,
          description: publicationPackage.copy.body, tags: publicationPackage.copy.hashtags,
          contentId: publicationPackage.contentId, sourceClaim, publishAttemptId: attemptId,
        });
        if (result.deliveryStatus === 'provider_accepted' && result.providerReceiptId) {
          return { status: 'accepted', providerReceiptId: result.providerReceiptId };
        }
        if (result.platformPostId) return {
          status: 'published', providerReceiptId: result.providerReceiptId || result.platformPostId,
          platformPostId: result.platformPostId, ...(result.platformUrl ? { platformUrl: result.platformUrl } : {}),
        };
        return { status: 'unknown', providerReceiptId: result.providerReceiptId, failureCode: `${input.platform}_publish_outcome_unknown` };
      } finally { if(delivery)await delivery.cleanup();await materialized.cleanup(); }
    },
    async reconcile({ assignment, attempt }) {
      if (!attempt.provider_receipt_id) return { status: 'unknown', failureCode: 'provider_receipt_missing' };
      const result = await ports.reconcile({
        tenantId: assignment.tenantId, accountId: assignment.accountId,
        platform: input.platform, providerReceiptId: attempt.provider_receipt_id,
      });
      if (result.status === 'published' && result.platformPostId) return {
        status: 'published', providerReceiptId: result.providerReceiptId,
        platformPostId: result.platformPostId, platformUrl: result.platformUrl,
      };
      if (result.status === 'failed') return {
        status: 'failed', providerReceiptId: result.providerReceiptId,
        failureCode: result.error || result.providerStatus || 'provider_rejected',
      };
      return {
        status: 'unknown', providerReceiptId: result.providerReceiptId,
        failureCode: result.error || result.providerStatus || `${input.platform}_provider_outcome_unknown`,
      };
    },
  };
}

/** Builds the official account-scoped adapter used by the weekly worker. */
export async function createWeeklyPublishingAdapter(input: {
  tenantId: string;
  accountId: string;
  platform: Platform;
  dataStore?: DataStore;
  now?: Date;
  ports?: WeeklyPublishingPorts;
}): Promise<WeeklyPublishingProviderAdapter> {
  if (input.platform === 'tiktok') return createTikTokWeeklyPublishingAdapter({
    tenantId: input.tenantId, accountId: input.accountId, dataStore: input.dataStore, now: input.now,
  });
  return createSynchronousWeeklyPublishingAdapter(input as Parameters<typeof createSynchronousWeeklyPublishingAdapter>[0]);
}
