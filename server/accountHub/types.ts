export type AccountProvider = 'codex' | 'claude';

export type AccountStatus =
  | 'pending_login'
  | 'ready'
  | 'busy'
  | 'cooldown'
  | 'reauthorization_required'
  | 'disabled'
  | 'error';

export type AccountStatusReason =
  | 'login_required'
  | 'authorization_expired'
  | 'rate_limited'
  | 'subscription_inactive'
  | 'provider_unavailable'
  | 'operator_disabled'
  | 'unknown';

/** Safe account metadata. Provider credentials stay on the member's own device. */
export interface AccountRecord {
  id: string;
  provider: AccountProvider;
  /** The sole owner of this provider account. */
  memberId: string;
  label: string;
  status: AccountStatus;
  /** Monotonic CAS generation; incremented whenever the account slot is reassigned/reset. */
  bindingGeneration: number;
  createdAt: string;
  updatedAt: string;
  email?: string;
  plan?: string;
  lastCheckedAt?: string;
  lastAuthenticatedAt?: string;
  lastUsedAt?: string;
  statusReason?: AccountStatusReason;
}

export interface CreateAccountInput {
  id?: string;
  provider: AccountProvider;
  memberId: string;
  label: string;
}

/** Null explicitly clears an optional, non-secret metadata field. */
export interface AccountMetadataPatch {
  email?: string | null;
  plan?: string | null;
  lastCheckedAt?: string | null;
  lastAuthenticatedAt?: string | null;
  lastUsedAt?: string | null;
}

/** One atomic, credential-free update produced by a member connector heartbeat. */
export interface ConnectorAccountStateUpdate {
  expectedMemberId: string;
  expectedBindingGeneration: number;
  status: Exclude<AccountStatus, 'disabled'>;
  statusReason?: AccountStatusReason;
  metadata: AccountMetadataPatch;
}

export interface ReassignAccountOwnerInput {
  accountId: string;
  targetMemberId: string;
  expectedMemberId: string;
  expectedBindingGeneration: number;
}

/** Durable, pseudonymous ownership tombstone. It never contains the Provider email or credentials. */
export interface ProviderIdentityClaim {
  identityHash: string;
  ownerMemberId: string;
  accountId: string;
  claimedAt: string;
}

/** A durable exclusive-use claim. It contains identity metadata, never provider credentials. */
export interface AccountLease {
  leaseId: string;
  accountId: string;
  holderMemberId: string;
  deviceId: string;
  deviceLabel: string;
  acquiredAt: string;
  renewedAt: string;
  expiresAt: string;
}

export interface AcquireLeaseInput {
  accountId: string;
  holderMemberId: string;
  deviceId: string;
  deviceLabel: string;
  /** Required when renewing an existing lease, so a copied device ID cannot impersonate the holder. */
  leaseId?: string;
  ttlMs?: number;
}

export interface ReleaseLeaseInput {
  accountId: string;
  holderMemberId: string;
  deviceId: string;
  /** Required capability; protects a newer lease from delayed release requests. */
  leaseId: string;
}

export type MemberAccountConnectionState = 'authenticated' | 'unauthenticated' | 'error' | 'unknown';

export interface MemberAccountUsageWindow {
  usedPercent: number;
  remainingPercent: number;
  resetsAt: string | null;
  windowDurationMins: number | null;
}

export interface MemberAccountUsageWindowReport {
  usedPercent: number;
  remainingPercent: number;
  resetsAt?: string | null;
  windowDurationMins?: number | null;
}

export interface MemberAccountUsageSnapshot {
  available: boolean;
  primary: MemberAccountUsageWindow | null;
  secondary: MemberAccountUsageWindow | null;
  creditsRemaining: number | null;
  checkedAt: string;
  reason: string | null;
}

/** Credential-free status reported by a member's local Codex/Claude connector. */
export interface MemberAccountStateReport {
  provider: AccountProvider;
  deviceId: string;
  deviceLabel: string;
  state: MemberAccountConnectionState;
  email?: string | null;
  plan?: string | null;
  authMode?: string | null;
  usage?: {
    available: boolean;
    primary?: MemberAccountUsageWindowReport | null;
    secondary?: MemberAccountUsageWindowReport | null;
    creditsRemaining?: number | null;
    checkedAt: string;
    reason?: string | null;
  } | null;
}

export interface MemberAccountStateSnapshot {
  memberId: string;
  provider: AccountProvider;
  state: MemberAccountConnectionState;
  email: string | null;
  plan: string | null;
  authMode: string | null;
  usage: MemberAccountUsageSnapshot | null;
  deviceId: string;
  deviceLabel: string;
  reportedAt: string;
}
