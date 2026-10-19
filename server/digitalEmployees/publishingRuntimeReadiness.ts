import {
  getTenantAwareGoogleOAuthClient,
  getTenantAwareInstagramOAuthClient,
  getTenantAwareMetaOAuthClient,
  getTenantAwareTikTokOAuthClient,
} from '../lib/oauthConfig.js';
import { buildPublishingReadinessSnapshot, type PublishingReadinessSnapshot } from './publishingOAuthReadiness.js';
import { listConnectedPublishingAccounts, type ConnectedPublishingAccount } from './publishingTargets.js';

export type TenantPublishingReadiness = {
  snapshot: PublishingReadinessSnapshot;
  connectedAccounts: ConnectedPublishingAccount[];
};

/**
 * Reads the real, tenant-scoped publishing prerequisites used by both the
 * overview and the background recovery loop. Keeping this in one place avoids
 * the UI and worker disagreeing after an OAuth app or account is connected.
 */
export async function readTenantPublishingReadiness(
  tenantId: string,
  required: boolean,
  targetPlatforms: string[],
): Promise<TenantPublishingReadiness> {
  if (!required) {
    return {
      connectedAccounts: [],
      snapshot: buildPublishingReadinessSnapshot({
        required: false,
        targetPlatforms,
        connectedPlatforms: [],
        clients: { meta: false, instagram: false, tiktok: false, google: false },
      }),
    };
  }
  const [connectedAccounts, metaClient, instagramClient, tiktokClient, googleClient] = await Promise.all([
    listConnectedPublishingAccounts(tenantId),
    getTenantAwareMetaOAuthClient(tenantId),
    getTenantAwareInstagramOAuthClient(tenantId),
    getTenantAwareTikTokOAuthClient(tenantId),
    getTenantAwareGoogleOAuthClient(tenantId),
  ]);
  return {
    connectedAccounts,
    snapshot: buildPublishingReadinessSnapshot({
      required: true,
      targetPlatforms,
      connectedPlatforms: connectedAccounts.map(account => account.platform),
      clients: {
        meta: Boolean(metaClient),
        instagram: Boolean(instagramClient),
        tiktok: Boolean(tiktokClient),
        google: Boolean(googleClient),
      },
    }),
  };
}
