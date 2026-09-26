import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import { socialAccessToken, youtubeCredentials } from '../lib/accountCredentials.js';
import { getMyChannelInfo, probeYouTubeUploadPermission } from '../integrations/youtube.js';
import { getFacebookPage, getInstagramAccount, getMetaGrantedPermissions, getTikTokPublishStatus, getTikTokUser, probeTikTokPublishingPermission } from '../integrations/social.js';

export const PLATFORM_CAPABILITY_EVIDENCE_COLLECTION = 'social_platform_capability_evidence';

export type RuntimeSocialPlatform = 'youtube' | 'facebook' | 'instagram' | 'tiktok';
export type RuntimePlatformCapability =
  | 'publishing.official'
  | 'publishing.receipt_lookup'
  | 'engagement.comments'
  | 'engagement.direct_messages';

export interface PlatformCapabilityEvidence {
  id: string;
  tenant_id: string;
  account_id: string;
  platform: RuntimeSocialPlatform;
  capability: RuntimePlatformCapability;
  status: 'verified' | 'unavailable' | 'revoked';
  evidence_source: 'provider_probe' | 'provider_webhook' | 'operator_review';
  evidence_ref: string;
  verified_at: string;
  expires_at?: string;
  reason_code?: string;
  created_at: string;
  updated_at: string;
}

export interface PlatformCapabilityDecision {
  platform: RuntimeSocialPlatform;
  accountId: string;
  capability: RuntimePlatformCapability;
  status: 'available' | 'unavailable';
  reason: string;
  verifiedAt?: string;
  evidenceRef?: string;
}

const text = (value: unknown): string => String(value ?? '').trim();

export const PLATFORM_CAPABILITY_PROBE_TTL_MS = 15 * 60_000;
export const PLATFORM_CAPABILITY_MAX_EVIDENCE_AGE_MS = 30 * 60_000;

const LIVE_PROBE_REQUIRED = new Set<RuntimePlatformCapability>([
  'publishing.official',
  'publishing.receipt_lookup',
]);

export function platformCapabilityEvidenceIsCurrent(item: PlatformCapabilityEvidence, now = new Date()): boolean {
  if (item.status !== 'verified' || !text(item.evidence_ref) || !Number.isFinite(Date.parse(item.verified_at))) return false;
  const verifiedAt = Date.parse(item.verified_at);
  const expiry = Date.parse(text(item.expires_at));
  if (LIVE_PROBE_REQUIRED.has(item.capability)) {
    if (item.evidence_source !== 'provider_probe' || !Number.isFinite(expiry)) return false;
    if (!item.evidence_ref.startsWith(`provider:${item.platform}:`)) return false;
    if (verifiedAt > now.getTime() + 60_000 || now.getTime() - verifiedAt > PLATFORM_CAPABILITY_MAX_EVIDENCE_AGE_MS) return false;
    if (expiry > verifiedAt + PLATFORM_CAPABILITY_PROBE_TTL_MS + 60_000) return false;
  }
  return !Number.isFinite(expiry) || expiry > now.getTime();
}

/**
 * Runtime capability truth is based on a persisted provider observation. A
 * configured environment variable, OAuth client, or connected-looking account
 * is deliberately insufficient evidence that a tenant can use the capability.
 */
export async function platformCapabilityDecision(input: {
  tenantId: string;
  accountId: string;
  platform: RuntimeSocialPlatform;
  capability: RuntimePlatformCapability;
  now?: Date;
  dataStore?: DataStore;
}): Promise<PlatformCapabilityDecision> {
  const dataStore = input.dataStore ?? store;
  const result = await dataStore.list<PlatformCapabilityEvidence>(PLATFORM_CAPABILITY_EVIDENCE_COLLECTION, {
    where: {
      tenant_id: text(input.tenantId), account_id: text(input.accountId),
      platform: input.platform, capability: input.capability,
    },
    sort: '-verified_at', page: 1, perPage: 2,
  }).catch(() => ({ items: [], totalItems: 0, totalPages: 0, page: 1, perPage: 2 }));
  if (result.totalItems > 1 && result.items.length > 1
    && result.items[0]?.verified_at === result.items[1]?.verified_at) {
    return { platform: input.platform, accountId: input.accountId, capability: input.capability, status: 'unavailable', reason: 'capability_evidence_ambiguous' };
  }
  const evidence = result.items[0];
  if (!evidence) return { platform: input.platform, accountId: input.accountId, capability: input.capability, status: 'unavailable', reason: 'provider_capability_not_verified' };
  if (!platformCapabilityEvidenceIsCurrent(evidence, input.now ?? new Date())) {
    return {
      platform: input.platform, accountId: input.accountId, capability: input.capability,
      status: 'unavailable', reason: evidence.reason_code || (evidence.status === 'revoked' ? 'provider_capability_revoked' : 'provider_capability_expired_or_unavailable'),
      verifiedAt: evidence.verified_at, evidenceRef: evidence.evidence_ref,
    };
  }
  return {
    platform: input.platform, accountId: input.accountId, capability: input.capability,
    status: 'available', reason: 'provider_capability_verified', verifiedAt: evidence.verified_at, evidenceRef: evidence.evidence_ref,
  };
}

type AccountRecord = Record<string, unknown> & { id: string };

export interface PlatformCapabilityProbeProviders {
  youtube(config: ReturnType<typeof youtubeCredentials>): Promise<{ id: string; publishGranted: boolean }>;
  facebook(accessToken: string, graphVersion: string, accountId: string): Promise<{ id: string; publishGranted: boolean }>;
  instagram(accountId: string, accessToken: string, graphVersion: string): Promise<{ id: string; publishGranted: boolean }>;
  tiktok(accessToken: string): Promise<{ openId: string; publishGranted: boolean }>;
  tiktokReceipt(accessToken: string, receiptId: string): Promise<{ publishId: string }>;
}

const liveProviders: PlatformCapabilityProbeProviders = {
  youtube: async config => {
    const [channel, permission] = await Promise.all([getMyChannelInfo(config), probeYouTubeUploadPermission(config)]);
    return { id: channel.id, publishGranted: permission.granted };
  },
  facebook: async (token, version, id) => {
    const [page, permissions] = await Promise.all([getFacebookPage(token, version, id), getMetaGrantedPermissions(token, version)]);
    return { id: page.id, publishGranted: permissions.includes('pages_manage_posts') };
  },
  instagram: async (id, token, version) => {
    const [account, permissions] = await Promise.all([getInstagramAccount(id, token, version), getMetaGrantedPermissions(token, version)]);
    return { id: account.id, publishGranted: permissions.includes('instagram_content_publish') };
  },
  tiktok: async token => {
    const [user, permission] = await Promise.all([getTikTokUser(token), probeTikTokPublishingPermission(token)]);
    return { openId: user.openId, publishGranted: permission.granted };
  },
  tiktokReceipt: getTikTokPublishStatus,
};

function scopeSet(record: AccountRecord): Set<string> {
  return new Set(text(record.scope).split(/[\s,]+/).filter(Boolean));
}

async function persistProbeEvidence(input: {
  tenantId: string; accountId: string; platform: RuntimeSocialPlatform; capability: RuntimePlatformCapability;
  status: PlatformCapabilityEvidence['status']; reasonCode?: string; providerRef: string; now: Date; dataStore: DataStore;
}): Promise<PlatformCapabilityEvidence> {
  const verifiedAt = input.now.toISOString();
  const record = await input.dataStore.create<PlatformCapabilityEvidence>(PLATFORM_CAPABILITY_EVIDENCE_COLLECTION, {
    tenant_id: input.tenantId,
    account_id: input.accountId,
    platform: input.platform,
    capability: input.capability,
    status: input.status,
    evidence_source: 'provider_probe',
    evidence_ref: `provider:${input.platform}:${input.providerRef}`,
    verified_at: verifiedAt,
    expires_at: new Date(input.now.getTime() + PLATFORM_CAPABILITY_PROBE_TTL_MS).toISOString(),
    reason_code: input.reasonCode || '',
    created_at: verifiedAt,
    updated_at: verifiedAt,
  });
  if (!record) throw new Error('platform_capability_evidence_persist_failed');
  return record;
}

/**
 * Performs a read-only call against the provider using the tenant account's
 * encrypted credential. It never infers permission from `status=connected` or
 * from an operator assertion. TikTok receipt lookup additionally needs a real
 * provider receipt because the provider exposes no credential-only capability
 * endpoint for that operation.
 */
export async function refreshPlatformCapabilityEvidence(input: {
  tenantId: string;
  accountId: string;
  platform: RuntimeSocialPlatform;
  capability: 'publishing.official' | 'publishing.receipt_lookup';
  receiptId?: string;
  now?: Date;
  dataStore?: DataStore;
  providers?: PlatformCapabilityProbeProviders;
}): Promise<PlatformCapabilityEvidence> {
  const dataStore = input.dataStore ?? store;
  const providers = input.providers ?? liveProviders;
  const now = input.now ?? new Date();
  const collection = input.platform === 'youtube' ? 'youtube_accounts' : 'social_accounts';
  const account = await dataStore.getById<AccountRecord>(collection, text(input.accountId));
  const belongsToTenant = account && text(account.tenantId) === text(input.tenantId);
  const matchesPlatform = input.platform === 'youtube' || text(account?.platform) === input.platform;
  if (!belongsToTenant || !matchesPlatform || account?.status !== 'connected') {
    return persistProbeEvidence({ ...input, status: 'unavailable', reasonCode: 'provider_account_not_connected', providerRef: 'account-unavailable', now, dataStore });
  }

  try {
    let providerRef = '';
    if (input.capability === 'publishing.receipt_lookup') {
      if (input.platform !== 'tiktok' || !text(input.receiptId)) {
        return persistProbeEvidence({ ...input, status: 'unavailable', reasonCode: 'real_provider_receipt_required', providerRef: 'receipt-unavailable', now, dataStore });
      }
      const result = await providers.tiktokReceipt(socialAccessToken(account), text(input.receiptId));
      if (text(result.publishId) !== text(input.receiptId)) throw new Error('provider_receipt_mismatch');
      providerRef = `receipt:${text(input.receiptId)}`;
    } else if (input.platform === 'youtube') {
      const result = await providers.youtube(youtubeCredentials(account));
      if (!text(result.id) || text(result.id) !== text(account.channelId)) throw new Error('provider_account_mismatch');
      if (!result.publishGranted) throw new Error('provider_publish_permission_not_granted');
      providerRef = `account:${text(result.id)}`;
    } else if (input.platform === 'facebook') {
      if (!scopeSet(account).has('pages_manage_posts')) throw new Error('provider_publish_scope_missing');
      const result = await providers.facebook(socialAccessToken(account), process.env.META_GRAPH_VERSION?.trim() || 'v25.0', text(account.providerAccountId));
      if (text(result.id) !== text(account.providerAccountId)) throw new Error('provider_account_mismatch');
      if (!result.publishGranted) throw new Error('provider_publish_permission_not_granted');
      providerRef = `account:${text(result.id)}`;
    } else if (input.platform === 'instagram') {
      if (!scopeSet(account).has('instagram_content_publish')) throw new Error('provider_publish_scope_missing');
      const result = await providers.instagram(text(account.providerAccountId), socialAccessToken(account), process.env.META_GRAPH_VERSION?.trim() || 'v25.0');
      if (text(result.id) !== text(account.providerAccountId)) throw new Error('provider_account_mismatch');
      if (!result.publishGranted) throw new Error('provider_publish_permission_not_granted');
      providerRef = `account:${text(result.id)}`;
    } else {
      if (!scopeSet(account).has('video.publish')) throw new Error('provider_publish_scope_missing');
      const result = await providers.tiktok(socialAccessToken(account));
      if (text(result.openId) !== text(account.providerAccountId)) throw new Error('provider_account_mismatch');
      if (!result.publishGranted) throw new Error('provider_publish_permission_not_granted');
      providerRef = `account:${text(result.openId)}`;
    }
    return persistProbeEvidence({ ...input, status: 'verified', providerRef, now, dataStore });
  } catch (error) {
    const reason = text(error instanceof Error ? error.message : error) || 'provider_probe_failed';
    return persistProbeEvidence({ ...input, status: 'unavailable', reasonCode: reason.slice(0, 120), providerRef: 'probe-failed', now, dataStore });
  }
}

/**
 * Production gate used by adapters. A missing/expired observation triggers one
 * read-only provider probe. A recent failed probe is honored until its short
 * TTL expires so a provider outage cannot cause a hot retry loop.
 */
export async function ensurePlatformCapability(input: {
  tenantId: string;
  accountId: string;
  platform: RuntimeSocialPlatform;
  capability: 'publishing.official' | 'publishing.receipt_lookup';
  receiptId?: string;
  now?: Date;
  dataStore?: DataStore;
  providers?: PlatformCapabilityProbeProviders;
}): Promise<PlatformCapabilityDecision> {
  const dataStore = input.dataStore ?? store;
  const now = input.now ?? new Date();
  const decision = await platformCapabilityDecision({ ...input, now, dataStore });
  const requestedReceiptRef = input.capability === 'publishing.receipt_lookup' && text(input.receiptId)
    ? `provider:${input.platform}:receipt:${text(input.receiptId)}` : '';
  if (decision.status === 'available' && (!requestedReceiptRef || decision.evidenceRef === requestedReceiptRef)) return decision;
  const latest = await dataStore.list<PlatformCapabilityEvidence>(PLATFORM_CAPABILITY_EVIDENCE_COLLECTION, {
    where: { tenant_id: text(input.tenantId), account_id: text(input.accountId), platform: input.platform, capability: input.capability },
    sort: '-verified_at', page: 1, perPage: 1,
  }).catch(() => ({ items: [], totalItems: 0, totalPages: 0, page: 1, perPage: 1 }));
  const retryAfter = Date.parse(text(latest.items[0]?.expires_at));
  const latestMatchesRequest = !requestedReceiptRef || latest.items[0]?.evidence_ref === requestedReceiptRef;
  if (latestMatchesRequest && latest.items[0]?.status !== 'verified' && Number.isFinite(retryAfter) && retryAfter > now.getTime()) return decision;
  const refreshed = await refreshPlatformCapabilityEvidence({ ...input, now, dataStore });
  if (platformCapabilityEvidenceIsCurrent(refreshed, now)
    && (!requestedReceiptRef || refreshed.evidence_ref === requestedReceiptRef)) {
    return { platform: input.platform, accountId: input.accountId, capability: input.capability, status: 'available', reason: 'provider_capability_verified', verifiedAt: refreshed.verified_at, evidenceRef: refreshed.evidence_ref };
  }
  return { platform: input.platform, accountId: input.accountId, capability: input.capability, status: 'unavailable', reason: refreshed.reason_code || 'provider_capability_expired_or_unavailable', verifiedAt: refreshed.verified_at, evidenceRef: refreshed.evidence_ref };
}

export async function listTenantCapabilityEvidence(
  tenantId: string,
  dataStore: DataStore = store,
): Promise<PlatformCapabilityEvidence[]> {
  const result = await dataStore.list<PlatformCapabilityEvidence>(PLATFORM_CAPABILITY_EVIDENCE_COLLECTION, {
    where: { tenant_id: text(tenantId) }, sort: '-verified_at', page: 1, perPage: 500,
  }).catch(() => ({ items: [], totalItems: 0, totalPages: 0, page: 1, perPage: 500 }));
  return result.items;
}
