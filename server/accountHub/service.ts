import fs from 'node:fs/promises';
import { getAccountPaths } from './paths.js';
import {
  assertCredentialFreeAccountState,
  MemberAccountEmailConflictError,
  MemberAccountStateStore,
} from './memberAccountState.js';
import {
  AccountDisabledError,
  AccountBindingChangedError,
  AccountLeaseConflictError,
  AccountNotReadyError,
  AccountReassignmentStateError,
  AccountRegistry,
} from './registry.js';
import type {
  AccountLease,
  AccountProvider,
  AccountRecord,
  AccountStatusReason,
  ConnectorAccountStateUpdate,
  CreateAccountInput,
  MemberAccountStateReport,
  MemberAccountStateSnapshot,
  MemberAccountUsageSnapshot,
} from './types.js';

type PublicAccountStatus = 'pending' | 'ready' | 'busy' | 'reauthorization_required' | 'unavailable' | 'disabled';
type PublicLocalState = 'authenticated' | 'unauthenticated' | 'unavailable' | 'unknown';
export type AccountTransferBlockedReason =
  | 'account_in_use'
  | 'legacy_managed_profile_cleanup_required'
  | 'local_logout_required'
  | 'fresh_local_logout_required'
  | 'account_not_pending';

export interface PublicLocalAccountState {
  state: PublicLocalState;
  reportedAt: string;
  deviceId: string;
  deviceLabel: string;
  email: string | null;
  plan: string | null;
  authMode: string | null;
  usage: MemberAccountUsageSnapshot | null;
}

export interface PublicAccount {
  id: string;
  provider: AccountProvider;
  memberId: string;
  label: string;
  status: PublicAccountStatus;
  enabled: boolean;
  plan: string | null;
  statusDetail: string | null;
  lastCheckedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  holderMemberId: string | null;
  deviceLabel: string | null;
  acquiredAt: string | null;
  renewedAt: string | null;
  expiresAt: string | null;
  localState: PublicLocalAccountState | null;
  legacyManagedProfilePresent: boolean;
  transferEligible: boolean;
  transferBlockedReason: AccountTransferBlockedReason | null;
}

export interface PublicLeaseResult {
  lease: AccountLease;
}

export class AccountHubServiceError extends Error {
  constructor(readonly code: string, readonly status: number, message = code) {
    super(message);
    this.name = 'AccountHubServiceError';
  }
}

export interface AccountHubServiceOptions {
  registry?: AccountRegistry;
  stateStore?: MemberAccountStateStore;
  now?: () => Date;
}

const LEASE_TTL_MS = 15 * 60_000;
const LOCAL_STATE_MAX_AGE_MS = 6 * 60_000;

const ACCOUNT_REASON_TEXT: Record<AccountStatusReason, string> = {
  login_required: '等待成员在自己的电脑完成官方登录',
  authorization_expired: '成员电脑上的登录状态已失效',
  rate_limited: '账号当前额度或速率已达限制',
  subscription_inactive: '账号订阅当前不可用',
  provider_unavailable: '成员电脑上的官方 CLI 当前不可用',
  operator_disabled: '账号已由管理员禁用',
  unknown: '成员电脑上报的账号状态异常',
};

function publicStatus(account: AccountRecord, leased: boolean): PublicAccountStatus {
  if (account.status === 'disabled') return 'disabled';
  if (leased) return 'busy';
  if (account.status === 'pending_login') return 'pending';
  if (account.status === 'reauthorization_required') return 'reauthorization_required';
  if (account.status === 'ready' || account.status === 'busy') return 'ready';
  return 'unavailable';
}

function localState(snapshot: MemberAccountStateSnapshot): PublicLocalAccountState {
  return {
    state: snapshot.state === 'error' ? 'unavailable' : snapshot.state,
    reportedAt: snapshot.reportedAt,
    deviceId: snapshot.deviceId,
    deviceLabel: snapshot.deviceLabel,
    email: snapshot.email,
    plan: snapshot.plan,
    authMode: snapshot.authMode,
    usage: snapshot.usage,
  };
}

function registryState(snapshot: MemberAccountStateSnapshot): {
  status: ConnectorAccountStateUpdate['status'];
  reason?: AccountStatusReason;
} {
  if (snapshot.state === 'authenticated') return { status: 'ready' };
  if (snapshot.state === 'unauthenticated') return { status: 'pending_login', reason: 'login_required' };
  return { status: 'error', reason: snapshot.state === 'error' ? 'provider_unavailable' : 'unknown' };
}

function snapshotKey(memberId: string, provider: AccountProvider): string {
  return `${provider}:${memberId}`;
}

export class AccountHubService {
  readonly registry: AccountRegistry;
  readonly stateStore: MemberAccountStateStore;
  private readonly now: () => Date;
  private initialized?: Promise<void>;

  constructor(options: AccountHubServiceOptions = {}) {
    this.registry = options.registry ?? new AccountRegistry();
    this.stateStore = options.stateStore ?? new MemberAccountStateStore({ dataDir: this.registry.dataDir });
    this.now = options.now ?? (() => new Date());
  }

  private ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      this.initialized = (async () => {
        await this.registry.reapExpiredLeases();
        // `busy` belonged to the removed web task dispatcher. Durable lease
        // records, not an account status bit, are now authoritative.
        for (const account of await this.registry.listAccounts()) {
          if (account.status === 'busy') await this.registry.updateAccountStatus(account.id, 'ready');
        }
      })();
    }
    return this.initialized;
  }

  async createAccount(input: CreateAccountInput): Promise<PublicAccount> {
    await this.ensureInitialized();
    try {
      return this.toPublicAccount(await this.registry.createAccount(input), null, null);
    } catch (error) {
      if (error instanceof Error && /Member already has a (?:codex|claude) account/.test(error.message)) {
        throw new AccountHubServiceError('member_provider_account_exists', 409);
      }
      throw error;
    }
  }

  async listAccounts(): Promise<PublicAccount[]> {
    await this.ensureInitialized();
    await this.registry.reapExpiredLeases();
    const leases = new Map((await this.registry.listLeases()).map(lease => [lease.accountId, lease]));
    const states = new Map((await this.stateStore.list()).map(snapshot => [
      snapshotKey(snapshot.memberId, snapshot.provider), snapshot,
    ]));
    return Promise.all((await this.registry.listAccounts()).map(account => this.toPublicAccount(
      account,
      leases.get(account.id) ?? null,
      states.get(snapshotKey(account.memberId, account.provider)) ?? null,
    )));
  }

  async assignLegacyAccountOwner(accountId: string, memberId: string): Promise<PublicAccount> {
    await this.ensureInitialized();
    const account = await this.requiredAccount(accountId);
    if (!account.memberId.startsWith('legacy_unassigned:')) {
      throw new AccountHubServiceError('account_owner_immutable', 409);
    }
    try {
      return this.toPublicAccount(await this.registry.assignLegacyAccountMember(accountId, memberId), null, null);
    } catch (error) {
      if (error instanceof Error && /Member already has a (?:codex|claude) account/.test(error.message)) {
        throw new AccountHubServiceError('member_provider_account_exists', 409);
      }
      if (error instanceof Error && error.message === 'Account owner is immutable') {
        throw new AccountHubServiceError('account_owner_immutable', 409);
      }
      throw error;
    }
  }

  async reassignAccountOwner(accountId: string, targetMemberId: string): Promise<PublicAccount> {
    await this.ensureInitialized();
    const account = await this.requiredAccount(accountId);
    if (await this.legacyManagedProfilePresent(account)) {
      throw new AccountHubServiceError('legacy_managed_profile_cleanup_required', 409);
    }
    const snapshot = await this.stateStore.get(account.memberId, account.provider);
    const age = snapshot ? this.now().getTime() - Date.parse(snapshot.reportedAt) : Number.POSITIVE_INFINITY;
    if (!snapshot || age < 0 || age > LOCAL_STATE_MAX_AGE_MS) {
      throw new AccountHubServiceError('fresh_local_logout_required', 409);
    }
    if (snapshot.state !== 'unauthenticated') {
      throw new AccountHubServiceError('local_logout_required', 409);
    }

    try {
      await this.registry.reassignAccountOwner({
        accountId: account.id,
        targetMemberId,
        expectedMemberId: account.memberId,
        expectedBindingGeneration: account.bindingGeneration,
      });
    } catch (error) {
      if (error instanceof AccountLeaseConflictError) throw new AccountHubServiceError('account_in_use', 409);
      if (error instanceof AccountBindingChangedError) throw new AccountHubServiceError('account_assignment_changed', 409);
      if (error instanceof AccountReassignmentStateError) {
        throw new AccountHubServiceError('local_logout_required', 409);
      }
      if (error instanceof Error && /Member already has a (?:codex|claude) account/.test(error.message)) {
        throw new AccountHubServiceError('member_provider_account_exists', 409);
      }
      throw error;
    }
    return this.getAccount(account.id);
  }

  async getAccount(accountId: string): Promise<PublicAccount> {
    await this.ensureInitialized();
    await this.registry.reapExpiredLeases();
    const account = await this.requiredAccount(accountId);
    const lease = (await this.registry.listLeases()).find(item => item.accountId === accountId) ?? null;
    const snapshot = await this.stateStore.get(account.memberId, account.provider) ?? null;
    return this.toPublicAccount(account, lease, snapshot);
  }

  async setAccountEnabled(accountId: string, enabled: boolean): Promise<PublicAccount> {
    await this.ensureInitialized();
    await this.requiredAccount(accountId);
    try {
      await this.registry.setAccountEnabled(accountId, enabled);
    } catch (error) {
      if (error instanceof AccountLeaseConflictError) throw new AccountHubServiceError('account_in_use', 409);
      throw error;
    }
    // Enabling never trusts an old heartbeat: the registry moves the account
    // to pending_login and a fresh local report is required to make it ready.
    return this.getAccount(accountId);
  }

  async reportMemberAccountState(memberId: string, report: MemberAccountStateReport): Promise<{
    accepted: true;
    localState: PublicLocalAccountState;
  }> {
    await this.ensureInitialized();
    try {
      assertCredentialFreeAccountState(report);
      const keys = report && typeof report === 'object' && !Array.isArray(report)
        ? Object.keys(report)
        : [];
      const allowed = new Set(['provider', 'deviceId', 'deviceLabel', 'state', 'email', 'plan', 'authMode', 'usage']);
      if (keys.some(key => !allowed.has(key))) throw new Error('unsupported_connector_report_field');
    } catch {
      throw new AccountHubServiceError('invalid_connector_report', 400);
    }
    if (!report || typeof report !== 'object' || !['codex', 'claude'].includes(report.provider)) {
      throw new AccountHubServiceError('invalid_provider', 400);
    }
    const account = await this.registry.getAccountForMember(memberId, report.provider);
    if (!account) throw new AccountHubServiceError('account_not_bound', 404);
    if (account.status === 'disabled') throw new AccountHubServiceError('account_disabled', 409);
    if (await this.legacyManagedProfilePresent(account)) {
      throw new AccountHubServiceError('legacy_managed_profile_cleanup_required', 409);
    }

    const reportedEmail = typeof report.email === 'string' ? report.email.trim().toLowerCase() : '';
    if (report.state === 'authenticated' && !reportedEmail) {
      throw new AccountHubServiceError('verified_provider_identity_required', 409);
    }
    if (reportedEmail && account.email && account.email.trim().toLowerCase() !== reportedEmail) {
      throw new AccountHubServiceError('provider_identity_changed', 409);
    }
    if (reportedEmail) {
      try {
        await this.registry.assertProviderIdentityAvailable(
          account.id,
          account.memberId,
          account.bindingGeneration,
          reportedEmail,
        );
      } catch (error) {
        if (error instanceof AccountDisabledError) throw new AccountHubServiceError('account_disabled', 409);
        if (error instanceof AccountBindingChangedError) {
          if (error.actualMemberId !== memberId) throw new AccountHubServiceError('account_not_bound', 404);
          throw new AccountHubServiceError('account_assignment_changed', 409);
        }
        if (error instanceof Error && error.message === 'provider_identity_changed') {
          throw new AccountHubServiceError('provider_identity_changed', 409);
        }
        if (error instanceof Error && error.message === 'provider_account_already_bound') {
          throw new AccountHubServiceError('provider_account_already_bound', 409);
        }
        throw error;
      }
    }
    let snapshot: MemberAccountStateSnapshot;
    try {
      snapshot = await this.stateStore.report(memberId, report);
    } catch (error) {
      if (error instanceof MemberAccountEmailConflictError) {
        throw new AccountHubServiceError('provider_account_already_bound', 409);
      }
      throw error;
    }
    const mapped = registryState(snapshot);
    try {
      await this.registry.applyConnectorState(account.id, {
        expectedMemberId: account.memberId,
        expectedBindingGeneration: account.bindingGeneration,
        status: mapped.status,
        statusReason: mapped.reason,
        metadata: {
          // Once first verified, identity cannot be cleared by an unauthenticated
          // heartbeat and silently rebound to a different Provider account.
          email: snapshot.email ?? account.email ?? null,
          plan: snapshot.plan ?? account.plan ?? null,
          lastCheckedAt: snapshot.reportedAt,
          lastAuthenticatedAt: snapshot.state === 'authenticated' ? snapshot.reportedAt : null,
        },
      });
    } catch (error) {
      if (error instanceof AccountDisabledError) throw new AccountHubServiceError('account_disabled', 409);
      if (error instanceof AccountBindingChangedError) {
        if (error.actualMemberId !== memberId) throw new AccountHubServiceError('account_not_bound', 404);
        throw new AccountHubServiceError('account_assignment_changed', 409);
      }
      if (error instanceof Error && error.message === 'provider_identity_changed') {
        throw new AccountHubServiceError('provider_identity_changed', 409);
      }
      if (error instanceof Error && error.message === 'provider_account_already_bound') {
        throw new AccountHubServiceError('provider_account_already_bound', 409);
      }
      throw error;
    }
    // Never return PublicAccount here: it contains the active lease capability.
    // A copied connector token must not be able to learn another process's leaseId.
    return { accepted: true, localState: localState(snapshot) };
  }

  async acquireAccount(input: {
    accountId: string;
    memberId: string;
    deviceId: string;
    deviceLabel: string;
    leaseId?: string;
  }): Promise<PublicLeaseResult> {
    await this.ensureInitialized();
    const account = await this.requiredAccount(input.accountId);
    if (account.memberId !== input.memberId) throw new AccountHubServiceError('account_member_mismatch', 403);
    if (account.status === 'disabled') throw new AccountHubServiceError('account_disabled', 409);
    if (await this.legacyManagedProfilePresent(account)) {
      throw new AccountHubServiceError('legacy_managed_profile_cleanup_required', 409);
    }
    const localSnapshot = await this.stateStore.get(input.memberId, account.provider);
    const snapshotAge = localSnapshot ? this.now().getTime() - Date.parse(localSnapshot.reportedAt) : Number.POSITIVE_INFINITY;
    if (
      localSnapshot?.state !== 'authenticated'
      || localSnapshot.deviceId !== input.deviceId
      || !account.email
      || localSnapshot.email?.trim().toLowerCase() !== account.email.trim().toLowerCase()
      || snapshotAge < 0
      || snapshotAge > LOCAL_STATE_MAX_AGE_MS
    ) {
      throw new AccountHubServiceError('reauthorization_required', 409);
    }
    if (account.status !== 'ready' && account.status !== 'busy') {
      throw new AccountHubServiceError('reauthorization_required', 409);
    }
    let lease: AccountLease;
    try {
      lease = await this.registry.acquireLease({
        accountId: account.id,
        holderMemberId: input.memberId,
        deviceId: input.deviceId,
        deviceLabel: input.deviceLabel,
        leaseId: input.leaseId,
        ttlMs: LEASE_TTL_MS,
      });
    } catch (error) {
      if (error instanceof AccountLeaseConflictError) throw new AccountHubServiceError('account_lease_held', 409);
      if (error instanceof AccountDisabledError) throw new AccountHubServiceError('account_disabled', 409);
      if (error instanceof AccountNotReadyError) throw new AccountHubServiceError('reauthorization_required', 409);
      throw error;
    }
    await this.registry.updateAccountMetadata(account.id, { lastUsedAt: this.now().toISOString() });
    // The connector needs only its own capability. Returning the whole account
    // would unnecessarily expose team/member metadata and duplicate leaseId.
    return { lease };
  }

  /** Local release only drops the coordination lease; it never touches provider auth. */
  async localReleaseAccount(input: {
    accountId: string;
    memberId: string;
    deviceId: string;
    leaseId: string;
  }): Promise<{ released: boolean }> {
    await this.ensureInitialized();
    const account = await this.requiredAccount(input.accountId);
    if (account.memberId !== input.memberId) throw new AccountHubServiceError('account_member_mismatch', 403);
    let released: boolean;
    try {
      released = await this.registry.releaseLease({
        accountId: account.id,
        holderMemberId: input.memberId,
        deviceId: input.deviceId,
        leaseId: input.leaseId,
      });
    } catch (error) {
      if (error instanceof AccountLeaseConflictError) throw new AccountHubServiceError('account_lease_not_owned', 409);
      throw error;
    }
    // Do not return account state after release: another process could acquire
    // in the gap and its new lease capability must never leak to the releaser.
    return { released };
  }

  private async requiredAccount(accountId: string): Promise<AccountRecord> {
    const account = await this.registry.getAccount(accountId);
    if (!account) throw new AccountHubServiceError('account_not_found', 404);
    return account;
  }

  private async legacyManagedProfilePresent(account: AccountRecord): Promise<boolean> {
    const { profileDir } = getAccountPaths(account.id, this.registry.dataDir);
    try {
      // New versions never create or use this directory. Any surviving entry
      // means the legacy managed profile has not been fully migrated.
      const entries = await fs.readdir(profileDir, { withFileTypes: true });
      return entries.length > 0;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      return true;
    }
  }

  private async toPublicAccount(
    account: AccountRecord,
    lease: AccountLease | null,
    snapshot: MemberAccountStateSnapshot | null,
  ): Promise<PublicAccount> {
    const legacyManagedProfilePresent = await this.legacyManagedProfilePresent(account);
    const snapshotAge = snapshot ? this.now().getTime() - Date.parse(snapshot.reportedAt) : Number.POSITIVE_INFINITY;
    const transferBlockedReason: AccountTransferBlockedReason | null = legacyManagedProfilePresent
      ? 'legacy_managed_profile_cleanup_required'
      : lease
      ? 'account_in_use'
      : !snapshot || snapshotAge < 0 || snapshotAge > LOCAL_STATE_MAX_AGE_MS
      ? 'fresh_local_logout_required'
      : snapshot.state !== 'unauthenticated'
      ? 'local_logout_required'
      : account.status !== 'pending_login'
      ? 'account_not_pending'
      : null;
    return {
      id: account.id,
      provider: account.provider,
      memberId: account.memberId,
      label: account.label,
      status: legacyManagedProfilePresent ? 'unavailable' : publicStatus(account, Boolean(lease)),
      enabled: account.status !== 'disabled',
      plan: snapshot?.plan ?? account.plan ?? null,
      statusDetail: legacyManagedProfilePresent
        ? '检测到旧版服务端托管凭据；人工撤销并清理前已禁止连接器使用'
        : lease
        ? `账号正在由设备 ${lease.deviceLabel} 使用`
        : account.statusReason ? ACCOUNT_REASON_TEXT[account.statusReason] : null,
      lastCheckedAt: snapshot?.reportedAt ?? account.lastCheckedAt ?? null,
      lastUsedAt: account.lastUsedAt ?? null,
      createdAt: account.createdAt,
      holderMemberId: lease?.holderMemberId ?? null,
      deviceLabel: lease?.deviceLabel ?? null,
      acquiredAt: lease?.acquiredAt ?? null,
      renewedAt: lease?.renewedAt ?? null,
      expiresAt: lease?.expiresAt ?? null,
      localState: snapshot ? localState(snapshot) : null,
      legacyManagedProfilePresent,
      transferEligible: transferBlockedReason === null,
      transferBlockedReason,
    };
  }
}

let singleton: AccountHubService | undefined;

export function accountHubService(): AccountHubService {
  if (!singleton) singleton = new AccountHubService();
  return singleton;
}
