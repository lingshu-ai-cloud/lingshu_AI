import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertValidAccountId, resolveAccountHubDataDir } from './paths.js';
import type {
  AccountLease,
  AccountProvider,
  AccountMetadataPatch,
  AccountRecord,
  AccountStatus,
  AccountStatusReason,
  AcquireLeaseInput,
  CreateAccountInput,
  ReleaseLeaseInput,
} from './types.js';

/** Read-only compatibility shape for task indexes created before web dispatch was removed. */
interface LegacyTaskSummary {
  id: string;
  accountId: string;
  provider: AccountProvider;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

interface RegistryDocument {
  schemaVersion: 1;
  accounts: Record<string, AccountRecord>;
  tasks: Record<string, LegacyTaskSummary>;
  leases: Record<string, AccountLease>;
}

export interface AccountRegistryOptions {
  dataDir?: string;
  now?: () => Date;
}

const ACCOUNT_STATUSES = new Set<AccountStatus>([
  'pending_login',
  'ready',
  'busy',
  'cooldown',
  'reauthorization_required',
  'disabled',
  'error',
]);
const ACCOUNT_STATUS_REASONS = new Set<AccountStatusReason>([
  'login_required',
  'authorization_expired',
  'rate_limited',
  'subscription_inactive',
  'provider_unavailable',
  'operator_disabled',
  'unknown',
]);
const PROVIDERS = new Set<AccountProvider>(['codex', 'claude']);
const LEGACY_TASK_STATUSES = new Set<LegacyTaskSummary['status']>(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
const SENSITIVE_KEY = /(password|passwd|passphrase|cookie|token|secret|credential|api[_-]?key|authorization|auth[_-]?json|private[_-]?key|session[_-]?key)/i;
const MEMBER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
const DEFAULT_LEASE_TTL_MS = 5 * 60_000;
const MAX_LEASE_TTL_MS = 24 * 60 * 60_000;
const REGISTRY_LOCK_STALE_MS = 30_000;
const REGISTRY_LOCK_TIMEOUT_MS = 5_000;

function emptyDocument(): RegistryDocument {
  return { schemaVersion: 1, accounts: {}, tasks: {}, leases: {} };
}

function assertPlainObject(value: unknown, context: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be a plain object`);
  }
}

/** Reject credential-shaped keys at every depth before any value can reach disk. */
export function assertNoCredentialMaterial(value: unknown): void {
  const visited = new WeakSet<object>();
  const visit = (current: unknown): void => {
    if (!current || typeof current !== 'object') return;
    if (visited.has(current)) return;
    visited.add(current);
    for (const [key, child] of Object.entries(current)) {
      if (SENSITIVE_KEY.test(key)) {
        throw new Error(`Credential material is forbidden in account registry field: ${key}`);
      }
      visit(child);
    }
  };
  visit(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], context: string): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).find(key => !allowedSet.has(key));
  if (unexpected) throw new Error(`Unsupported ${context} field: ${unexpected}`);
}

function requiredString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}

function requiredIdentifier(value: unknown, field: string, pattern: RegExp): string {
  const identifier = requiredString(value, field, 128);
  if (!pattern.test(identifier)) throw new Error(`Invalid ${field}`);
  return identifier;
}

function optionalIsoDate(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${field}`);
  return value;
}

function requiredIsoDate(value: unknown, field: string): string {
  const parsed = optionalIsoDate(value, field);
  if (!parsed) throw new Error(`Invalid ${field}`);
  return parsed;
}

function hasOwn(index: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(index, key);
}

function parseAccount(value: unknown): AccountRecord {
  assertPlainObject(value, 'account');
  assertOnlyKeys(value, [
    'id', 'provider', 'memberId', 'label', 'status', 'createdAt', 'updatedAt',
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
    createdAt: requiredIsoDate(value.createdAt, 'createdAt'),
    updatedAt: requiredIsoDate(value.updatedAt, 'updatedAt'),
    ...(value.email === undefined ? {} : { email: parseEmail(value.email) }),
    ...(value.plan === undefined ? {} : { plan: requiredString(value.plan, 'plan', 100).trim() }),
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

function parseEmail(value: unknown): string {
  const email = requiredString(value, 'email', 254).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email');
  return email;
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
  assertOnlyKeys(value, ['schemaVersion', 'accounts', 'tasks', 'leases'], 'registry');
  if (value.schemaVersion !== 1) throw new Error('Unsupported account registry schema version');
  assertPlainObject(value.accounts, 'accounts index');
  assertPlainObject(value.tasks, 'tasks index');
  if (value.leases !== undefined) assertPlainObject(value.leases, 'leases index');
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
  return { schemaVersion: 1, accounts, tasks, leases };
}

function isLeaseExpired(lease: AccountLease, now: Date): boolean {
  return Date.parse(lease.expiresAt) <= now.getTime();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export class AccountLeaseConflictError extends Error {
  constructor(readonly lease: AccountLease) {
    super('Account is already in use by another device');
    this.name = 'AccountLeaseConflictError';
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
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
      account.memberId = normalizedMemberId;
      account.updatedAt = this.now().toISOString();
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
    return this.enqueueMutation(async document => {
      const account = hasOwn(document.accounts, accountId) ? document.accounts[accountId] : undefined;
      if (!account) throw new Error(`Account not found: ${accountId}`);
      account.status = status;
      account.updatedAt = this.now().toISOString();
      if (statusReason === undefined) delete account.statusReason;
      else account.statusReason = statusReason;
      return clone(account);
    });
  }

  async updateAccountMetadata(accountId: string, patch: AccountMetadataPatch): Promise<AccountRecord> {
    assertValidAccountId(accountId);
    assertNoCredentialMaterial(patch);
    assertPlainObject(patch, 'account metadata patch');
    assertOnlyKeys(
      patch,
      ['email', 'plan', 'lastCheckedAt', 'lastAuthenticatedAt', 'lastUsedAt'],
      'account metadata patch',
    );
    const normalized: AccountMetadataPatch = {};
    if ('email' in patch) normalized.email = patch.email === null ? null : parseEmail(patch.email);
    if ('plan' in patch) normalized.plan = patch.plan === null ? null : requiredString(patch.plan, 'plan', 100).trim();
    for (const key of ['lastCheckedAt', 'lastAuthenticatedAt', 'lastUsedAt'] as const) {
      if (key in patch) normalized[key] = patch[key] === null ? null : optionalIsoDate(patch[key], key)!;
    }
    return this.enqueueMutation(async document => {
      const account = hasOwn(document.accounts, accountId) ? document.accounts[accountId] : undefined;
      if (!account) throw new Error(`Account not found: ${accountId}`);
      if (normalized.email === null && account.email) throw new Error('provider_identity_changed');
      if (typeof normalized.email === 'string') {
        const email = normalized.email.toLowerCase();
        if (account.email && account.email.toLowerCase() !== email) throw new Error('provider_identity_changed');
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
      account.updatedAt = this.now().toISOString();
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
    if (input.leaseId !== undefined) requiredString(input.leaseId, 'lease id', 100);
    return this.enqueueMutation(async document => {
      const lease = hasOwn(document.leases, input.accountId) ? document.leases[input.accountId] : undefined;
      if (!lease) return false;
      if (lease.holderMemberId !== holderMemberId || lease.deviceId !== deviceId) {
        throw new AccountLeaseConflictError(clone(lease));
      }
      if (input.leaseId !== undefined && input.leaseId !== lease.leaseId) {
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
