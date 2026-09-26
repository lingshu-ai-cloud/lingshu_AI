import type { DataStore } from '../storage/datastore.js';
import { store } from '../storage/index.js';

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

function evidenceIsCurrent(item: PlatformCapabilityEvidence, now: Date): boolean {
  if (item.status !== 'verified' || !text(item.evidence_ref) || !Number.isFinite(Date.parse(item.verified_at))) return false;
  const expiry = Date.parse(text(item.expires_at));
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
  if (!evidenceIsCurrent(evidence, input.now ?? new Date())) {
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

export async function listTenantCapabilityEvidence(
  tenantId: string,
  dataStore: DataStore = store,
): Promise<PlatformCapabilityEvidence[]> {
  const result = await dataStore.list<PlatformCapabilityEvidence>(PLATFORM_CAPABILITY_EVIDENCE_COLLECTION, {
    where: { tenant_id: text(tenantId) }, sort: '-verified_at', page: 1, perPage: 500,
  }).catch(() => ({ items: [], totalItems: 0, totalPages: 0, page: 1, perPage: 500 }));
  return result.items;
}
