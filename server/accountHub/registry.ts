import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertValidAccountId, resolveAccountHubDataDir } from './paths.js';
import { ACCOUNT_STATUSES, ACCOUNT_STATUS_REASONS, AccountBindingChangedError, AccountDisabledError, AccountLeaseConflictError, AccountNotReadyError, AccountReassignmentStateError, DEVICE_ID_PATTERN, LEGACY_TASK_STATUSES, MEMBER_ID_PATTERN, PROVIDERS, assertNoCredentialMaterial, assertOnlyKeys, assertPlainObject, clone, delay, emptyDocument, hasOwn, isLeaseExpired, optionalIsoDate, parseEmail, providerIdentityHash, requiredIdentifier, requiredIsoDate, requiredNonNegativeInteger, requiredString, strictSafeLabel, type AccountRegistryOptions, type LegacyTaskSummary, type RegistryDocument } from './registrySupport.js';
export { AccountBindingChangedError, AccountDisabledError, AccountLeaseConflictError, AccountNotReadyError, AccountReassignmentStateError, assertNoCredentialMaterial } from './registrySupport.js';
import type {
  AccountLease,
  AccountProvider,
  AccountMetadataPatch,
  AccountRecord,
  AccountStatus,
  AccountStatusReason,
  AcquireLeaseInput,
  ConnectorAccountStateUpdate,
  CreateAccountInput,
  ProviderIdentityClaim,
  ReassignAccountOwnerInput,
  ReleaseLeaseInput,
} from './types.js';

/** Read-only compatibility shape for task indexes created before web dispatch was removed. */
const DEFAULT_LEASE_TTL_MS = 5 * 60_000;
const MAX_LEASE_TTL_MS = 24 * 60 * 60_000;
const REGISTRY_LOCK_STALE_MS = 30_000;
const REGISTRY_LOCK_TIMEOUT_MS = 5_000;


function parseAccount(value: unknown): AccountRecord {
  assertPlainObject(value, 'account');
  assertOnlyKeys(value, [
    'id', 'provider', 'memberId', 'label', 'status', 'bindingGeneration', 'createdAt', 'updatedAt',
    'email', 'plan', 'lastCheckedAt', 'lastAuthenticatedAt', 'lastUsedAt', 'statusReason',
  ], 'account');
  const provider = value.provider;
  const status = value.status;
  const statusReason = value.statusReason;
  if (!PROVIDERS.has(provider as AccountProvider)) throw new Error('Invalid account provider');
  if (!ACCOUNT_STATUSES.has(status as AccountStatus)) throw new Error('Invalid account status');
  if (statusReason !== undefined && !ACCOUNT_STATUS_REASONS.has(statusReason as AccountStatusReason)) {
    throw new Error('Invalid account status reason');
  }
  const id = requiredString(value.id, 'account id', 80);
  assertValidAccountId(id);
  return {
    id,
    provider: provider as AccountProvider,
    // Accounts created by the first prototype had no owner field. Keep them
    // readable but unusable until an administrator explicitly assigns one.
    memberId: value.memberId === undefined
      ? `legacy_unassigned:${id}`
      : requiredIdentifier(value.memberId, 'member id', MEMBER_ID_PATTERN),
    label: requiredString(value.label, 'account label', 100).trim(),
    status: status as AccountStatus,
    bindingGeneration: value.bindingGeneration === undefined
      ? 0
      : requiredNonNegativeInteger(value.bindingGeneration, 'binding generation'),
    createdAt: requiredIsoDate(value.createdAt, 'createdAt'),
    updatedAt: requiredIsoDate(value.updatedAt, 'updatedAt'),
    ...(value.email === undefined ? {} : { email: parseEmail(value.email) }),
    ...(value.plan === undefined ? {} : { plan: strictSafeLabel(value.plan, 'plan', 100) }),
    ...(value.lastCheckedAt === undefined ? {} : { lastCheckedAt: optionalIsoDate(value.lastCheckedAt, 'lastCheckedAt') }),
    ...(value.lastAuthenticatedAt === undefined ? {} : { lastAuthenticatedAt: optionalIsoDate(value.lastAuthenticatedAt, 'lastAuthenticatedAt') }),
    ...(value.lastUsedAt === undefined ? {} : { lastUsedAt: optionalIsoDate(value.lastUsedAt, 'lastUsedAt') }),
    ...(statusReason === undefined ? {} : { statusReason: statusReason as AccountStatusReason }),
  };
}

function parseLease(value: unknown): AccountLease {
  assertPlainObject(value, 'lease');
  assertOnlyKeys(value, [
    'leaseId', 'accountId', 'holderMemberId', 'deviceId', 'deviceLabel',
    'acquiredAt', 'renewedAt', 'expiresAt',
  ], 'lease');
  const accountId = requiredString(value.accountId, 'lease account id', 80);
  assertValidAccountId(accountId);
  return {
    leaseId: requiredString(value.leaseId, 'lease id', 100),
    accountId,
    holderMemberId: requiredIdentifier(value.holderMemberId, 'lease holder member id', MEMBER_ID_PATTERN),
    deviceId: requiredIdentifier(value.deviceId, 'lease device id', DEVICE_ID_PATTERN),
    deviceLabel: requiredString(value.deviceLabel, 'lease device label', 100).trim(),
    acquiredAt: requiredIsoDate(value.acquiredAt, 'lease acquiredAt'),
    renewedAt: requiredIsoDate(value.renewedAt, 'lease renewedAt'),
    expiresAt: requiredIsoDate(value.expiresAt, 'lease expiresAt'),
  };
}


function parseIdentityClaim(value: unknown): ProviderIdentityClaim {
  assertPlainObject(value, 'provider identity claim');
  assertOnlyKeys(value, ['identityHash', 'ownerMemberId', 'accountId', 'claimedAt'], 'provider identity claim');
  const identityHash = requiredString(value.identityHash, 'provider identity hash', 64);
  if (!/^[a-f0-9]{64}$/.test(identityHash)) throw new Error('Invalid provider identity hash');
  const accountId = requiredString(value.accountId, 'provider identity account id', 80);
  assertValidAccountId(accountId);
  return {
    identityHash,
    ownerMemberId: requiredIdentifier(value.ownerMemberId, 'provider identity owner member id', MEMBER_ID_PATTERN),
    accountId,
    claimedAt: requiredIsoDate(value.claimedAt, 'provider identity claimedAt'),
  };
}

function assertProviderIdentityOwnership(
  document: RegistryDocument,
  account: AccountRecord,
  email: string,
  claimedAt: string,
  create: boolean,
): void {
  const identityHash = providerIdentityHash(account.provider, email);
  const claim = document.identityClaims[identityHash];
  if (claim && claim.ownerMemberId !== account.memberId) throw new Error('provider_account_already_bound');
  if (!claim && create) {
    document.identityClaims[identityHash] = {
      identityHash,
      ownerMemberId: account.memberId,
      accountId: account.id,
      claimedAt,
    };
  }
}

function normalizeMetadataPatch(patch: AccountMetadataPatch): AccountMetadataPatch {
  assertNoCredentialMaterial(patch);
  assertPlainObject(patch, 'account metadata patch');
  assertOnlyKeys(
    patch,
    ['email', 'plan', 'lastCheckedAt', 'lastAuthenticatedAt', 'lastUsedAt'],
    'account metadata patch',
  );
  const normalized: AccountMetadataPatch = {};
  if ('email' in patch) normalized.email = patch.email === null ? null : parseEmail(patch.email);
  if ('plan' in patch) normalized.plan = patch.plan === null ? null : strictSafeLabel(patch.plan, 'plan', 100);
  for (const key of ['lastCheckedAt', 'lastAuthenticatedAt', 'lastUsedAt'] as const) {
    if (key in patch) normalized[key] = patch[key] === null ? null : optionalIsoDate(patch[key], key)!;
  }
  return normalized;
}

function applyMetadataPatch(
  document: RegistryDocument,
  account: AccountRecord,
  normalized: AccountMetadataPatch,
  claimedAt: string,
): void {
  if (normalized.email === null && account.email) throw new Error('provider_identity_changed');
  if (typeof normalized.email === 'string') {
    const email = normalized.email.toLowerCase();
    if (account.email && account.email.toLowerCase() !== email) throw new Error('provider_identity_changed');
    assertProviderIdentityOwnership(document, account, email, claimedAt, true);
    if (Object.values(document.accounts).some(candidate => (
      candidate.id !== account.id
      && candidate.provider === account.provider
      && candidate.email?.toLowerCase() === email
    ))) throw new Error('provider_account_already_bound');
  }
  for (const [key, value] of Object.entries(normalized) as [keyof AccountMetadataPatch, string | null][]) {
    if (value === null) delete account[key];
    else account[key] = value;
  }
}

function parseLegacyTask(value: unknown): LegacyTaskSummary {
  assertPlainObject(value, 'task');
  assertOnlyKeys(value, [
    'id', 'accountId', 'provider', 'status', 'createdAt', 'updatedAt', 'startedAt', 'finishedAt',
  ], 'task');
  if (!PROVIDERS.has(value.provider as AccountProvider)) throw new Error('Invalid task provider');
  if (!LEGACY_TASK_STATUSES.has(value.status as LegacyTaskSummary['status'])) throw new Error('Invalid task status');
  const accountId = requiredString(value.accountId, 'task account id', 80);
  assertValidAccountId(accountId);
  return {
    id: requiredString(value.id, 'task id', 100),
    accountId,
    provider: value.provider as AccountProvider,
    status: value.status as LegacyTaskSummary['status'],
    createdAt: requiredIsoDate(value.createdAt, 'createdAt'),
    updatedAt: requiredIsoDate(value.updatedAt, 'updatedAt'),
    ...(value.startedAt === undefined ? {} : { startedAt: optionalIsoDate(value.startedAt, 'startedAt') }),
    ...(value.finishedAt === undefined ? {} : { finishedAt: optionalIsoDate(value.finishedAt, 'finishedAt') }),
  };
}

function parseDocument(value: unknown): RegistryDocument {
  assertNoCredentialMaterial(value);
  assertPlainObject(value, 'registry');
  assertOnlyKeys(value, ['schemaVersion', 'accounts', 'tasks', 'leases', 'identityClaims'], 'registry');
  if (value.schemaVersion !== 1) throw new Error('Unsupported account registry schema version');
  assertPlainObject(value.accounts, 'accounts index');
  assertPlainObject(value.tasks, 'tasks index');
  if (value.leases !== undefined) assertPlainObject(value.leases, 'leases index');
  if (value.identityClaims !== undefined) assertPlainObject(value.identityClaims, 'identity claims index');
  const accounts = Object.fromEntries(Object.entries(value.accounts).map(([key, item]) => {
    const account = parseAccount(item);
    if (key !== account.id) throw new Error('Account index key does not match account id');
    return [key, account];
  }));
  const tasks = Object.fromEntries(Object.entries(value.tasks).map(([key, item]) => {
    const task = parseLegacyTask(item);
    if (key !== task.id) throw new Error('Task index key does not match task id');
    return [key, task];
  }));
  const leases = Object.fromEntries(Object.entries(value.leases ?? {}).map(([key, item]) => {
    const lease = parseLease(item);
    if (key !== lease.accountId) throw new Error('Lease index key does not match account id');
    return [key, lease];
  }));
  const identityClaims = Object.fromEntries(Object.entries(value.identityClaims ?? {}).map(([key, item]) => {
    const claim = parseIdentityClaim(item);
    if (key !== claim.identityHash) throw new Error('Provider identity claim key does not match hash');
    return [key, claim];
  }));
  // Schema-v1 registries predate tombstones. Seed claims from every still-bound
  // identity in memory; the next mutation persists them without exposing email.
  for (const account of Object.values(accounts)) {
    if (!account.email) continue;
    const identityHash = providerIdentityHash(account.provider, account.email);
    const existing = identityClaims[identityHash];
    if (existing && existing.ownerMemberId !== account.memberId) {
      throw new Error('Provider identity claim conflicts with current account owner');
    }
    if (!existing) {
      identityClaims[identityHash] = {
        identityHash,
        ownerMemberId: account.memberId,
        accountId: account.id,
        claimedAt: account.lastAuthenticatedAt ?? account.updatedAt,
      };
    }
  }
  return { schemaVersion: 1, accounts, tasks, leases, identityClaims };
}

export class AccountRegistry {
  readonly dataDir: string;
  readonly registryFile: string;
  private readonly lockFile: string;
  private readonly now: () => Date;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: AccountRegistryOptions = {}) {
    this.dataDir = resolveAccountHubDataDir(options.dataDir);
    this.registryFile = path.join(this.dataDir, 'registry.json');
    this.lockFile = path.join(this.dataDir, '.registry.lock');
    this.now = options.now ?? (() => new Date());
  }

  private async ensureDataDir(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(this.dataDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe account registry data directory');
    await fs.chmod(this.dataDir, 0o700);
  }

  private async readDocument(): Promise<RegistryDocument> {
    await this.ensureDataDir();
    let content: string;
    try {
      content = await fs.readFile(this.registryFile, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDocument();
      throw error;
    }
    await fs.chmod(this.registryFile, 0o600);
    return parseDocument(JSON.parse(content) as unknown);
  }

  private async writeDocument(document: RegistryDocument): Promise<void> {
    assertNoCredentialMaterial(document);
    await this.ensureDataDir();
    const temporaryFile = path.join(this.dataDir, `.registry-${process.pid}-${randomUUID()}.tmp`);
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(temporaryFile, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(temporaryFile, this.registryFile);
      await fs.chmod(this.registryFile, 0o600);
      const directoryHandle = await fs.open(this.dataDir, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      await fs.rm(temporaryFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** Serialize read-modify-write cycles across registry instances and server processes. */
  private async withRegistryLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensureDataDir();
    const owner = randomUUID();
    const startedAt = Date.now();
    while (true) {
      try {
        const handle = await fs.open(this.lockFile, 'wx', 0o600);
        try {
          await handle.writeFile(JSON.stringify({ owner, createdAt: new Date().toISOString() }), 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const stat = await fs.lstat(this.lockFile);
          if (Date.now() - stat.mtimeMs > REGISTRY_LOCK_STALE_MS) {
            const staleFile = `${this.lockFile}.stale-${randomUUID()}`;
            await fs.rename(this.lockFile, staleFile);
            await fs.rm(staleFile, { force: true });
            continue;
          }
        } catch (lockError) {
          if ((lockError as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw lockError;
        }
        if (Date.now() - startedAt >= REGISTRY_LOCK_TIMEOUT_MS) {
          throw new Error('Account registry is busy; retry the operation');
        }
        await delay(10);
      }
    }

    try {
      return await operation();
    } finally {
      try {
        const lock = JSON.parse(await fs.readFile(this.lockFile, 'utf8')) as { owner?: unknown };
        if (lock.owner === owner) await fs.unlink(this.lockFile);
      } catch {
        // A missing/replaced lock is never deleted on behalf of its new owner.
      }
    }
  }

  private enqueueMutation<T>(mutation: (document: RegistryDocument) => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(() => this.withRegistryLock(async () => {
        const document = await this.readDocument();
        const result = await mutation(document);
        await this.writeDocument(document);
        return result;
      }));
    this.writeQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async createAccount(input: CreateAccountInput): Promise<AccountRecord> {
    assertNoCredentialMaterial(input);
    assertPlainObject(input, 'account input');
    assertOnlyKeys(input, ['id', 'provider', 'memberId', 'label'], 'account input');
    if (!PROVIDERS.has(input.provider)) throw new Error('Invalid account provider');
    const memberId = requiredIdentifier(input.memberId, 'member id', MEMBER_ID_PATTERN);
    const label = requiredString(input.label, 'account label', 100).trim();
    const id = input.id ?? `acct_${input.provider}_${randomUUID()}`;
    return this.enqueueMutation(async document => {
      if (hasOwn(document.accounts, id)) throw new Error(`Account already exists: ${id}`);
      if (Object.values(document.accounts).some(account => (
        account.provider === input.provider && account.memberId === memberId
      ))) {
        throw new Error(`Member already has a ${input.provider} account`);
      }
      const timestamp = this.now().toISOString();
      const account: AccountRecord = {
        id,
        provider: input.provider,
        memberId,
        label,
        status: 'pending_login',
        bindingGeneration: 0,
        statusReason: 'login_required',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      document.accounts[id] = account;
      return clone(account);
    });
  }

  async getAccount(accountId: string): Promise<AccountRecord | undefined> {
    assertValidAccountId(accountId);
    const accounts = (await this.readDocument()).accounts;
    const account = hasOwn(accounts, accountId) ? accounts[accountId] : undefined;
    return account ? clone(account) : undefined;
  }

  async listAccounts(): Promise<AccountRecord[]> {
    return Object.values((await this.readDocument()).accounts)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map(clone);
  }

  async getAccountForMember(memberId: string, provider: AccountProvider): Promise<AccountRecord | undefined> {
    const normalizedMemberId = requiredIdentifier(memberId, 'member id', MEMBER_ID_PATTERN);
    if (!PROVIDERS.has(provider)) throw new Error('Invalid account provider');
    const account = Object.values((await this.readDocument()).accounts).find(candidate => (
      candidate.memberId === normalizedMemberId && candidate.provider === provider
    ));
    return account ? clone(account) : undefined;
  }

  /** Early rejection keeps a forbidden historical identity out of the snapshot store. */
  async assertProviderIdentityAvailable(
    accountId: string,
    expectedMemberIdValue: string,
    expectedBindingGenerationValue: number,
    emailValue: string,
  ): Promise<void> {
    assertValidAccountId(accountId);
    const expectedMemberId = requiredIdentifier(expectedMemberIdValue, 'expected member id', MEMBER_ID_PATTERN);
    const expectedBindingGeneration = requiredNonNegativeInteger(
      expectedBindingGenerationValue,
      'expected binding generation',
    );
    const email = parseEmail(emailValue);
    const document = await this.readDocument();
    const account = hasOwn(document.accounts, accountId) ? document.accounts[accountId] : undefined;
    if (!account) throw new Error(`Account not found: ${accountId}`);
    if (
      account.memberId !== expectedMemberId
      || account.bindingGeneration !== expectedBindingGeneration
    ) {
      throw new AccountBindingChangedError(account.id, account.memberId, account.bindingGeneration);
    }
    if (account.status === 'disabled') throw new AccountDisabledError(account.id);
    if (account.email && account.email.toLowerCase() !== email.toLowerCase()) {
      throw new Error('provider_identity_changed');
    }
    assertProviderIdentityOwnership(document, account, email, this.now().toISOString(), false);
    if (Object.values(document.accounts).some(candidate => (
      candidate.id !== account.id
      && candidate.provider === account.provider
      && candidate.email?.toLowerCase() === email.toLowerCase()
    ))) throw new Error('provider_account_already_bound');
  }

  /** Atomically establishes the immutable Provider identity for an account. */
  async bindProviderIdentity(accountId: string, emailValue: string): Promise<AccountRecord> {
    assertValidAccountId(accountId);
    const email = parseEmail(emailValue);
    const normalized = email.toLowerCase();
    return this.enqueueMutation(async document => {
      const account = hasOwn(document.accounts, accountId) ? document.accounts[accountId] : undefined;
      if (!account) throw new Error(`Account not found: ${accountId}`);
      if (account.email && account.email.toLowerCase() !== normalized) {
        throw new Error('provider_identity_changed');
      }
      const duplicate = Object.values(document.accounts).find(candidate => (
        candidate.id !== account.id
        && candidate.provider === account.provider
        && candidate.email?.toLowerCase() === normalized
      ));
      if (duplicate) throw new Error('provider_account_already_bound');
      assertProviderIdentityOwnership(document, account, email, this.now().toISOString(), true);
      if (!account.email) {
        account.email = email;
        account.updatedAt = this.now().toISOString();
      }
      return clone(account);
    });
  }

  /** Assign ownership only for accounts imported from the owner-less prototype schema. */
  async assignLegacyAccountMember(accountId: string, memberId: string): Promise<AccountRecord> {
    assertValidAccountId(accountId);
    const normalizedMemberId = requiredIdentifier(memberId, 'member id', MEMBER_ID_PATTERN);
    return this.enqueueMutation(async document => {
      const account = hasOwn(document.accounts, accountId) ? document.accounts[accountId] : undefined;
      if (!account) throw new Error(`Account not found: ${accountId}`);
      if (!account.memberId.startsWith('legacy_unassigned:')) {
        throw new Error('Account owner is immutable');
      }
      if (Object.values(document.accounts).some(candidate => (
        candidate.id !== account.id
        && candidate.provider === account.provider
        && candidate.memberId === normalizedMemberId
      ))) {
        throw new Error(`Member already has a ${account.provider} account`);
      }
      for (const claim of Object.values(document.identityClaims)) {
        if (claim.accountId === account.id && claim.ownerMemberId === account.memberId) {
          claim.ownerMemberId = normalizedMemberId;
        }
      }
      account.memberId = normalizedMemberId;
      account.bindingGeneration += 1;
      account.updatedAt = this.now().toISOString();
      return clone(account);
    });
  }

  /** Reassign only the hub slot. Provider credentials never enter this registry. */
  async reassignAccountOwner(input: ReassignAccountOwnerInput): Promise<AccountRecord> {
    assertNoCredentialMaterial(input);
    assertPlainObject(input, 'account owner reassignment');
    assertOnlyKeys(
      input,
      ['accountId', 'targetMemberId', 'expectedMemberId', 'expectedBindingGeneration'],
      'account owner reassignment',
    );
    assertValidAccountId(input.accountId);
    const targetMemberId = requiredIdentifier(input.targetMemberId, 'target member id', MEMBER_ID_PATTERN);
    const expectedMemberId = requiredIdentifier(input.expectedMemberId, 'expected member id', MEMBER_ID_PATTERN);
    const expectedBindingGeneration = requiredNonNegativeInteger(
      input.expectedBindingGeneration,
      'expected binding generation',
    );
    return this.enqueueMutation(async document => {
      const account = hasOwn(document.accounts, input.accountId) ? document.accounts[input.accountId] : undefined;
      if (!account) throw new Error(`Account not found: ${input.accountId}`);
      if (
        account.memberId !== expectedMemberId
        || account.bindingGeneration !== expectedBindingGeneration
      ) {
        throw new AccountBindingChangedError(account.id, account.memberId, account.bindingGeneration);
      }
      if (account.status !== 'pending_login') {
        throw new AccountReassignmentStateError(account.id, account.status);
      }

      const now = this.now();
      const lease = hasOwn(document.leases, account.id) ? document.leases[account.id] : undefined;
      if (lease && !isLeaseExpired(lease, now)) throw new AccountLeaseConflictError(clone(lease));
      if (lease) delete document.leases[account.id];

      if (Object.values(document.accounts).some(candidate => (
        candidate.id !== account.id
        && candidate.provider === account.provider
        && candidate.memberId === targetMemberId
      ))) {
        throw new Error(`Member already has a ${account.provider} account`);
      }

      account.memberId = targetMemberId;
      account.bindingGeneration += 1;
      delete account.email;
      delete account.plan;
      delete account.lastAuthenticatedAt;
      delete account.lastUsedAt;
      delete account.lastCheckedAt;
      account.status = 'pending_login';
      account.statusReason = 'login_required';
      account.updatedAt = now.toISOString();
      return clone(account);
    });
  }

  async updateAccountStatus(
    accountId: string,
    status: AccountStatus,
    statusReason?: AccountStatusReason,
  ): Promise<AccountRecord> {
    assertValidAccountId(accountId);
    if (!ACCOUNT_STATUSES.has(status)) throw new Error('Invalid account status');
    if (statusReason !== undefined && !ACCOUNT_STATUS_REASONS.has(statusReason)) throw new Error('Invalid account status reason');
    if (status === 'disabled') return this.setAccountEnabled(accountId, false);
    return this.enqueueMutation(async document => {
      const account = hasOwn(document.accounts, accountId) ? document.accounts[accountId] : undefined;
      if (!account) throw new Error(`Account not found: ${accountId}`);
      if (account.status === 'disabled') throw new AccountDisabledError(accountId);
      account.status = status;
      account.updatedAt = this.now().toISOString();
      if (statusReason === undefined) delete account.statusReason;
      else account.statusReason = statusReason;
      return clone(account);
    });
  }

  async updateAccountMetadata(accountId: string, patch: AccountMetadataPatch): Promise<AccountRecord> {
    assertValidAccountId(accountId);
    const normalized = normalizeMetadataPatch(patch);
    return this.enqueueMutation(async document => {
      const account = hasOwn(document.accounts, accountId) ? document.accounts[accountId] : undefined;
      if (!account) throw new Error(`Account not found: ${accountId}`);
      applyMetadataPatch(document, account, normalized, this.now().toISOString());
      account.updatedAt = this.now().toISOString();
      return clone(account);
    });
  }

  /** Apply one connector heartbeat without allowing it to revive a disabled account. */
  async applyConnectorState(accountId: string, update: ConnectorAccountStateUpdate): Promise<AccountRecord> {
    assertValidAccountId(accountId);
    assertNoCredentialMaterial(update);
    assertPlainObject(update, 'connector account state update');
    assertOnlyKeys(
      update,
      ['expectedMemberId', 'expectedBindingGeneration', 'status', 'statusReason', 'metadata'],
      'connector account state update',
    );
    const expectedMemberId = requiredIdentifier(update.expectedMemberId, 'expected member id', MEMBER_ID_PATTERN);
    const expectedBindingGeneration = requiredNonNegativeInteger(
      update.expectedBindingGeneration,
      'expected binding generation',
    );
    if (!ACCOUNT_STATUSES.has(update.status as AccountStatus) || (update.status as AccountStatus) === 'disabled') {
      throw new Error('Invalid connector account status');
    }
    if (update.statusReason !== undefined && !ACCOUNT_STATUS_REASONS.has(update.statusReason)) {
      throw new Error('Invalid account status reason');
    }
    const normalized = normalizeMetadataPatch(update.metadata);
    return this.enqueueMutation(async document => {
      const account = hasOwn(document.accounts, accountId) ? document.accounts[accountId] : undefined;
      if (!account) throw new Error(`Account not found: ${accountId}`);
      if (
        account.memberId !== expectedMemberId
        || account.bindingGeneration !== expectedBindingGeneration
      ) {
        throw new AccountBindingChangedError(accountId, account.memberId, account.bindingGeneration);
      }
      if (account.status === 'disabled') throw new AccountDisabledError(accountId);
      applyMetadataPatch(document, account, normalized, this.now().toISOString());
      account.status = update.status;
      if (update.statusReason === undefined) delete account.statusReason;
      else account.statusReason = update.statusReason;
      account.updatedAt = this.now().toISOString();
      return clone(account);
    });
  }

  /** Atomically toggle operator state and validate that no live lease exists. */
  async setAccountEnabled(accountId: string, enabled: boolean): Promise<AccountRecord> {
    assertValidAccountId(accountId);
    if (typeof enabled !== 'boolean') throw new Error('Invalid enabled state');
    return this.enqueueMutation(async document => {
      const account = hasOwn(document.accounts, accountId) ? document.accounts[accountId] : undefined;
      if (!account) throw new Error(`Account not found: ${accountId}`);
      const lease = hasOwn(document.leases, accountId) ? document.leases[accountId] : undefined;
      const now = this.now();
      if (lease && isLeaseExpired(lease, now)) delete document.leases[accountId];
      const activeLease = lease && !isLeaseExpired(lease, now) ? lease : undefined;

      if (!enabled) {
        if (activeLease) throw new AccountLeaseConflictError(clone(activeLease));
        if (account.status === 'disabled') return clone(account);
        account.status = 'disabled';
        account.statusReason = 'operator_disabled';
        account.updatedAt = now.toISOString();
        return clone(account);
      }

      if (activeLease) throw new AccountLeaseConflictError(clone(activeLease));
      if (account.status === 'disabled') {
        account.status = 'pending_login';
        account.statusReason = 'login_required';
        account.updatedAt = now.toISOString();
      }
      return clone(account);
    });
  }

  async deleteAccount(accountId: string): Promise<boolean> {
    assertValidAccountId(accountId);
    return this.enqueueMutation(async document => {
      if (!hasOwn(document.accounts, accountId)) return false;
      delete document.accounts[accountId];
      delete document.leases[accountId];
      for (const [taskId, task] of Object.entries(document.tasks)) {
        if (task.accountId === accountId) delete document.tasks[taskId];
      }
      return true;
    });
  }

  async acquireLease(input: AcquireLeaseInput): Promise<AccountLease> {
    assertNoCredentialMaterial(input);
    assertPlainObject(input, 'lease input');
    assertOnlyKeys(
      input,
      ['accountId', 'holderMemberId', 'deviceId', 'deviceLabel', 'leaseId', 'ttlMs'],
      'lease input',
    );
    assertValidAccountId(input.accountId);
    const holderMemberId = requiredIdentifier(input.holderMemberId, 'lease holder member id', MEMBER_ID_PATTERN);
    const deviceId = requiredIdentifier(input.deviceId, 'lease device id', DEVICE_ID_PATTERN);
    const deviceLabel = requiredString(input.deviceLabel, 'lease device label', 100).trim();
    const renewalLeaseId = input.leaseId === undefined
      ? undefined
      : requiredString(input.leaseId, 'lease id', 100);
    const ttlMs = input.ttlMs ?? DEFAULT_LEASE_TTL_MS;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_LEASE_TTL_MS) {
      throw new Error(`Lease ttlMs must be an integer between 1 and ${MAX_LEASE_TTL_MS}`);
    }

    return this.enqueueMutation(async document => {
      const account = hasOwn(document.accounts, input.accountId) ? document.accounts[input.accountId] : undefined;
      if (!account) throw new Error(`Account not found: ${input.accountId}`);
      if (account.memberId !== holderMemberId) throw new Error('Only the account owner may acquire its lease');
      if (account.status === 'disabled') throw new AccountDisabledError(account.id);
      if (account.status !== 'ready' && account.status !== 'busy') {
        throw new AccountNotReadyError(account.id, account.status);
      }
      const now = this.now();
      const timestamp = now.toISOString();
      const existing = hasOwn(document.leases, account.id) ? document.leases[account.id] : undefined;
      if (existing && !isLeaseExpired(existing, now)) {
        if (
          existing.holderMemberId !== holderMemberId
          || existing.deviceId !== deviceId
          || !renewalLeaseId
          || renewalLeaseId !== existing.leaseId
        ) {
          throw new AccountLeaseConflictError(clone(existing));
        }
        existing.deviceLabel = deviceLabel;
        existing.renewedAt = timestamp;
        existing.expiresAt = new Date(now.getTime() + ttlMs).toISOString();
        return clone(existing);
      }

      const lease: AccountLease = {
        leaseId: randomUUID(),
        accountId: account.id,
        holderMemberId,
        deviceId,
        deviceLabel,
        acquiredAt: timestamp,
        renewedAt: timestamp,
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      };
      document.leases[account.id] = lease;
      return clone(lease);
    });
  }

  /** Local release drops only the coordination lease; member-device Provider login is untouched. */
  async releaseLease(input: ReleaseLeaseInput): Promise<boolean> {
    assertNoCredentialMaterial(input);
    assertPlainObject(input, 'lease release input');
    assertOnlyKeys(input, ['accountId', 'holderMemberId', 'deviceId', 'leaseId'], 'lease release input');
    assertValidAccountId(input.accountId);
    const holderMemberId = requiredIdentifier(input.holderMemberId, 'lease holder member id', MEMBER_ID_PATTERN);
    const deviceId = requiredIdentifier(input.deviceId, 'lease device id', DEVICE_ID_PATTERN);
    const leaseId = requiredString(input.leaseId, 'lease id', 100);
    return this.enqueueMutation(async document => {
      const lease = hasOwn(document.leases, input.accountId) ? document.leases[input.accountId] : undefined;
      if (!lease) return false;
      if (lease.holderMemberId !== holderMemberId || lease.deviceId !== deviceId) {
        throw new AccountLeaseConflictError(clone(lease));
      }
      if (leaseId !== lease.leaseId) {
        throw new AccountLeaseConflictError(clone(lease));
      }
      delete document.leases[input.accountId];
      return true;
    });
  }

  /** Explicit administrative escape hatch; callers must enforce admin authorization. */
  async forceReleaseLease(accountId: string): Promise<boolean> {
    assertValidAccountId(accountId);
    return this.enqueueMutation(async document => {
      if (!hasOwn(document.leases, accountId)) return false;
      delete document.leases[accountId];
      return true;
    });
  }

  async listLeases(holderMemberId?: string): Promise<AccountLease[]> {
    const normalizedMemberId = holderMemberId === undefined
      ? undefined
      : requiredIdentifier(holderMemberId, 'lease holder member id', MEMBER_ID_PATTERN);
    return Object.values((await this.readDocument()).leases)
      .filter(lease => normalizedMemberId === undefined || lease.holderMemberId === normalizedMemberId)
      .sort((left, right) => left.acquiredAt.localeCompare(right.acquiredAt) || left.accountId.localeCompare(right.accountId))
      .map(clone);
  }

  async reapExpiredLeases(): Promise<AccountLease[]> {
    return this.enqueueMutation(async document => {
      const now = this.now();
      const expired: AccountLease[] = [];
      for (const [accountId, lease] of Object.entries(document.leases)) {
        if (!isLeaseExpired(lease, now)) continue;
        expired.push(clone(lease));
        delete document.leases[accountId];
      }
      return expired;
    });
  }

}
