import {assertPublicationAtomicStore} from './publicationAtomicStore.js';
import {weeklyReceiptLookupAuthority,type WeeklyPublishingPurpose} from './weeklyReceiptLookupAuthority.js';
import { fileURLToPath } from 'node:url';
import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import { socialAccessToken } from '../lib/accountCredentials.js';
import { ensurePlatformCapability } from './platformCapabilities.js';
import { publishVideoToAccount, resolvePendingPublishToAccount, type PublishToAccountInput, type PublishToAccountResult, type PendingPublishResolution } from './platformPublisher.js';
import { socialProductionPublishSourceClaim } from './publishSourceClaim.js';
import { materializeSocialProductionVideo } from './socialProductionMedia.js';
import type { WeeklyPublishingProviderAdapter } from './weeklyLineage.js';

type SocialAccount = {
  id: string;
  tenantId: string;
  platform: string;
  accessToken: string;
  status: string;
};

export interface TikTokWeeklyPublishingPorts {
  publish(input: PublishToAccountInput): Promise<PublishToAccountResult>;
  reconcile(input: { tenantId: string; accountId: string; platform: 'tiktok'; providerReceiptId: string }): Promise<PendingPublishResolution>;
}

function localVideoPath(downloadUrl: string): string {
  const value = downloadUrl.trim();
  if (value.startsWith('file://')) return fileURLToPath(value);
  return value.startsWith('/') && !value.startsWith('/api/') ? value : '';
}

/**
 * Account-scoped official TikTok adapter. Availability means the connected
 * account, decryptable credential, and publish permission probe exist.
 * Receipt lookup is probed later with the real receipt returned by first
 * submission, avoiding a circular prerequisite. Configuration alone never
 * opens the gate.
 */
export async function createTikTokWeeklyPublishingAdapter(input: {
  tenantId: string;
  accountId: string;
  dataStore?: DataStore;
  now?: Date;
  ports?: TikTokWeeklyPublishingPorts;
  purpose?:WeeklyPublishingPurpose;
  providerReceiptId?:string;
}): Promise<WeeklyPublishingProviderAdapter> {
  const dataStore = input.dataStore ?? store;
  const account = await dataStore.getById<SocialAccount>('social_accounts', input.accountId);
  let unavailableReason = '';
  if (!account || account.tenantId !== input.tenantId || account.platform !== 'tiktok') unavailableReason = 'tiktok_account_not_found';
  else if (account.status !== 'connected') unavailableReason = 'tiktok_account_not_connected';
  else {
    try { socialAccessToken(account as unknown as Record<string, unknown>); }
    catch { unavailableReason = 'tiktok_credential_unavailable'; }
  }
  const lookup=input.purpose==='receipt_lookup'?await weeklyReceiptLookupAuthority({...input,platform:'tiktok',dataStore}):null;
  if(lookup)unavailableReason=lookup.reason;
  if (!unavailableReason&&!lookup) {
    const publishDecision = await ensurePlatformCapability({ tenantId: input.tenantId, accountId: input.accountId, platform: 'tiktok', capability: 'publishing.official', now: input.now, dataStore });
    if (publishDecision.status !== 'available') unavailableReason = publishDecision.reason;
  }
  const ports = input.ports ?? { publish: publishVideoToAccount, reconcile: resolvePendingPublishToAccount };

  return {
    provider: 'tiktok-content-posting-api', platform: 'tiktok',
    capability: unavailableReason ? 'unavailable' : 'available',
    ...(unavailableReason ? { unavailableReason } : {}),
    async publish({ assignment, publicationPackage, attemptId }) {
      await assertPublicationAtomicStore(dataStore);
      if(input.purpose==='receipt_lookup')return {status:'rejected',failureCode:'receipt_lookup_adapter_read_only'};
      if(unavailableReason)return {status:'rejected',failureCode:unavailableReason};
      if (assignment.tenantId !== input.tenantId || assignment.accountId !== input.accountId) return { status: 'rejected', failureCode: 'adapter_account_scope_mismatch' };
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
      try {
        const sourceClaim = await socialProductionPublishSourceClaim({
          tenantId: assignment.tenantId, artifactId, weeklyAssignment:assignment,
          productionResultId: assignment.lineage.productionResultRef.id,
          contentVersion: publicationPackage.contentVersion,
          contentHash: publicationPackage.contentHash,
          videoHash: video.contentHash, videoPath: materialized.videoPath,
          ...(materialized.sourceUrl ? { artifactVideoUrl: materialized.sourceUrl } : {}), dataStore,
        });
        const result = await ports.publish({
          tenantId: assignment.tenantId, accountId: assignment.accountId, platform: 'tiktok',
          videoPath: materialized.videoPath, title: publicationPackage.copy.title, description: publicationPackage.copy.body,
          tags: publicationPackage.copy.hashtags, contentId: publicationPackage.contentId,
          sourceClaim, publishAttemptId: attemptId,
        });
        if (result.deliveryStatus === 'provider_accepted' && result.providerReceiptId) return { status: 'accepted', providerReceiptId: result.providerReceiptId };
        if (result.platformPostId) return { status: 'published', providerReceiptId: result.providerReceiptId || result.platformPostId, platformPostId: result.platformPostId, ...(result.platformUrl ? { platformUrl: result.platformUrl } : {}) };
        return { status: 'unknown', providerReceiptId: result.providerReceiptId, failureCode: 'tiktok_publish_outcome_unknown' };
      } finally { await materialized.cleanup(); }
    },
    async reconcile({ assignment, attempt }) {
      if(input.purpose==='receipt_lookup'){if(assignment.tenantId!==input.tenantId||assignment.accountId!==input.accountId||assignment.platform!=='tiktok'||attempt.tenant_id!==input.tenantId||attempt.assignment_id!==assignment.assignmentId||attempt.package_id!==assignment.packageId||!['unknown','in_flight'].includes(attempt.status)||attempt.provider!=='tiktok-content-posting-api'||attempt.provider_receipt_id!==input.providerReceiptId)return {status:'unknown',failureCode:'receipt_lookup_scope_mismatch'};const fresh=await weeklyReceiptLookupAuthority({...input,platform:'tiktok',dataStore});if(fresh.reason||fresh.identityHash!==lookup?.identityHash)return {status:'unknown',failureCode:fresh.reason||'receipt_lookup_account_changed'};}
      if (!attempt.provider_receipt_id) return { status: 'unknown', failureCode: 'provider_receipt_missing' };
      const lookupDecision = await ensurePlatformCapability({
        tenantId: assignment.tenantId, accountId: assignment.accountId, platform: 'tiktok',
        capability: 'publishing.receipt_lookup', receiptId: attempt.provider_receipt_id, dataStore,
        now: input.now,
      });
      if (lookupDecision.status !== 'available') return { status: 'unknown', providerReceiptId: attempt.provider_receipt_id, failureCode: lookupDecision.reason };
      const result = await ports.reconcile({ tenantId: assignment.tenantId, accountId: assignment.accountId, platform: 'tiktok', providerReceiptId: attempt.provider_receipt_id });
      if(input.purpose==='receipt_lookup'){const after=await weeklyReceiptLookupAuthority({...input,platform:'tiktok',dataStore});if(after.reason||after.identityHash!==lookup?.identityHash)return {status:'unknown',providerReceiptId:attempt.provider_receipt_id,failureCode:after.reason||'receipt_lookup_account_changed'};}
      if(result.providerReceiptId!==attempt.provider_receipt_id)return {status:'unknown',failureCode:'provider_receipt_mismatch'};
      if (result.status === 'published' && result.platformPostId) return { status: 'published', providerReceiptId: result.providerReceiptId, platformPostId: result.platformPostId, platformUrl: result.platformUrl };
      if (result.status === 'failed') return { status: 'failed', providerReceiptId: result.providerReceiptId, failureCode: result.error || result.providerStatus || 'provider_rejected' };
      return { status: 'unknown', providerReceiptId: result.providerReceiptId, failureCode: result.error || result.providerStatus || 'provider_outcome_unknown' };
    },
  };
}
