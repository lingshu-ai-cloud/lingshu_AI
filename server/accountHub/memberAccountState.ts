import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveAccountHubDataDir } from './paths.js';
import type {
  AccountProvider,
  MemberAccountConnectionState,
  MemberAccountStateReport,
  MemberAccountStateSnapshot,
  MemberAccountUsageSnapshot,
  MemberAccountUsageWindow,
} from './types.js';

interface MemberAccountStateDocument {
  schemaVersion: 1;
  snapshots: Record<string, MemberAccountStateSnapshot>;
}

export interface MemberAccountStateStoreOptions {
  dataDir?: string;
  now?: () => Date;
}

type UnknownRecord = Record<string, unknown>;

const PROVIDERS = new Set<AccountProvider>(['codex', 'claude']);
const CONNECTION_STATES = new Set<MemberAccountConnectionState>([
  'authenticated', 'unauthenticated', 'error', 'unknown',
]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/;
const FORBIDDEN_CREDENTIAL_KEY = /(password|passwd|passphrase|cookie|token|secret|credential|api[_-]?key|authorization|auth[_-]?json|private[_-]?key|session[_-]?key)/i;
const SECRET_LIKE_VALUE = /^(?:Bearer\s+\S+|sk-[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})$/i;
const LOCK_STALE_MS = 30_000;
const LOCK_TIMEOUT_MS = 5_000;

function emptyDocument(): MemberAccountStateDocument {
  return { schemaVersion: 1, snapshots: {} };
}

function plainObject(value: unknown, field: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`invalid_${field}`);
  return value as UnknownRecord;
}

function assertAllowedFields(value: UnknownRecord, allowed: readonly string[], field: string): void {
  const allowedSet = new Set(allowed);
  const unsupported = Object.keys(value).find(key => !allowedSet.has(key));
  if (unsupported) throw new Error(`unsupported_${field}_field:${unsupported}`);
}

/** Reject credential-shaped fields and recognizable raw bearer/API/JWT values at any nesting level. */
export function assertCredentialFreeAccountState(value: unknown): void {
  const seen = new WeakSet<object>();
  const visit = (current: unknown): void => {
    if (typeof current === 'string') {
      if (SECRET_LIKE_VALUE.test(current.trim())) throw new Error('credential_material_not_accepted');
      return;
    }
    if (!current || typeof current !== 'object') return;
    if (seen.has(current)) return;
    seen.add(current);
    for (const [key, child] of Object.entries(current)) {
      if (FORBIDDEN_CREDENTIAL_KEY.test(key)) throw new Error('credential_material_not_accepted');
      visit(child);
    }
  };
  visit(value);
}

function identifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new Error(`invalid_${field}`);
  return value;
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`invalid_${field}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || normalized.includes('\0')) throw new Error(`invalid_${field}`);
  if (SECRET_LIKE_VALUE.test(normalized)) throw new Error('credential_material_not_accepted');
  return normalized;
}

function nullableText(value: unknown, field: string, maximum: number): string | null {
  return value === undefined || value === null ? null : text(value, field, maximum);
}

function email(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = text(value, 'email', 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('invalid_email');
  return normalized;
}

function isoDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`invalid_${field}`);
  return value;
}

function nullableIsoDate(value: unknown, field: string): string | null {
  return value === undefined || value === null ? null : isoDate(value, field);
}

function percentage(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`invalid_${field}`);
  }
  return value;
}

function nullableNonNegativeNumber(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`invalid_${field}`);
  return value;
}

function usageWindow(value: unknown, field: string): MemberAccountUsageWindow | null {
  if (value === undefined || value === null) return null;
  const source = plainObject(value, field);
  assertAllowedFields(source, ['usedPercent', 'remainingPercent', 'resetsAt', 'windowDurationMins'], field);
  return {
    usedPercent: percentage(source.usedPercent, `${field}_used_percent`),
    remainingPercent: percentage(source.remainingPercent, `${field}_remaining_percent`),
    resetsAt: nullableIsoDate(source.resetsAt, `${field}_resets_at`),
    windowDurationMins: nullableNonNegativeNumber(source.windowDurationMins, `${field}_window_duration_mins`),
  };
}

function usageSnapshot(value: unknown): MemberAccountUsageSnapshot | null {
  if (value === undefined || value === null) return null;
  const source = plainObject(value, 'usage');
  assertAllowedFields(
    source,
    ['available', 'primary', 'secondary', 'creditsRemaining', 'checkedAt', 'reason'],
    'usage',
  );
  if (typeof source.available !== 'boolean') throw new Error('invalid_usage_available');
  return {
    available: source.available,
    primary: usageWindow(source.primary, 'primary'),
    secondary: usageWindow(source.secondary, 'secondary'),
    creditsRemaining: nullableNonNegativeNumber(source.creditsRemaining, 'usage_credits_remaining'),
    checkedAt: isoDate(source.checkedAt, 'usage_checked_at'),
    reason: nullableText(source.reason, 'usage_reason', 120),
  };
}

function provider(value: unknown): AccountProvider {
  if (!PROVIDERS.has(value as AccountProvider)) throw new Error('invalid_provider');
  return value as AccountProvider;
}

function connectionState(value: unknown): MemberAccountConnectionState {
  if (!CONNECTION_STATES.has(value as MemberAccountConnectionState)) throw new Error('invalid_connection_state');
  return value as MemberAccountConnectionState;
}

function stateKey(memberId: string, accountProvider: AccountProvider): string {
  return `${accountProvider}:${memberId}`;
}

function normalizeReport(
  memberIdValue: unknown,
  reportValue: unknown,
  reportedAt: string,
): MemberAccountStateSnapshot {
  const memberId = identifier(memberIdValue, 'member_id');
  assertCredentialFreeAccountState(reportValue);
  const report = plainObject(reportValue, 'report');
  assertAllowedFields(
    report,
    ['provider', 'deviceId', 'deviceLabel', 'state', 'email', 'plan', 'authMode', 'usage'],
    'report',
  );
  const normalizedState = connectionState(report.state);
  const normalizedEmail = email(report.email);
  if (normalizedState === 'authenticated' && !normalizedEmail) {
    throw new Error('verified_provider_identity_required');
  }
  return {
    memberId,
    provider: provider(report.provider),
    state: normalizedState,
    email: normalizedEmail,
    plan: nullableText(report.plan, 'plan', 100),
    authMode: nullableText(report.authMode, 'auth_mode', 64),
    usage: usageSnapshot(report.usage),
    deviceId: identifier(report.deviceId, 'device_id'),
    deviceLabel: text(report.deviceLabel, 'device_label', 100),
    reportedAt,
  };
}

/** Best-effort legacy parsing: unsafe or malformed records are skipped rather than re-persisted. */
function parseLegacySnapshot(value: unknown): MemberAccountStateSnapshot | undefined {
  try {
    assertCredentialFreeAccountState(value);
    const source = plainObject(value, 'snapshot');
    const snapshotProvider = provider(source.provider);
    const stateValue = source.state === undefined ? 'unknown' : connectionState(source.state);
    let parsedUsage: MemberAccountUsageSnapshot | null = null;
    try { parsedUsage = usageSnapshot(source.usage); } catch { parsedUsage = null; }
    let parsedEmail: string | null = null;
    try { parsedEmail = email(source.email); } catch { parsedEmail = null; }
    return {
      memberId: identifier(source.memberId, 'member_id'),
      provider: snapshotProvider,
      state: stateValue,
      email: parsedEmail,
      plan: nullableText(source.plan, 'plan', 100),
      authMode: nullableText(source.authMode, 'auth_mode', 64),
      usage: parsedUsage,
      deviceId: identifier(source.deviceId, 'device_id'),
      deviceLabel: text(source.deviceLabel, 'device_label', 100),
      reportedAt: isoDate(source.reportedAt, 'reported_at'),
    };
  } catch {
    return undefined;
  }
}

function parseDocument(value: unknown): MemberAccountStateDocument {
  const source = plainObject(value, 'state_document');
  const rawSnapshots = Array.isArray(source.snapshots)
    ? source.snapshots
    : Object.values(source.snapshots && typeof source.snapshots === 'object' ? source.snapshots : {});
  const latestByMemberProvider: Record<string, MemberAccountStateSnapshot> = {};
  for (const candidate of rawSnapshots) {
    const snapshot = parseLegacySnapshot(candidate);
    if (!snapshot) continue;
    const key = stateKey(snapshot.memberId, snapshot.provider);
    const previous = latestByMemberProvider[key];
    if (!previous || Date.parse(previous.reportedAt) <= Date.parse(snapshot.reportedAt)) {
      latestByMemberProvider[key] = snapshot;
    }
  }
  const snapshots: Record<string, MemberAccountStateSnapshot> = {};
  const claimedEmails = new Set<string>();
  for (const snapshot of Object.values(latestByMemberProvider).sort((left, right) => (
    Date.parse(right.reportedAt) - Date.parse(left.reportedAt)
  ))) {
    const emailKey = snapshot.email ? `${snapshot.provider}:${snapshot.email.toLowerCase()}` : undefined;
    if (emailKey && claimedEmails.has(emailKey)) continue;
    if (emailKey) claimedEmails.add(emailKey);
    snapshots[stateKey(snapshot.memberId, snapshot.provider)] = snapshot;
  }
  return { schemaVersion: 1, snapshots };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export class MemberAccountEmailConflictError extends Error {
  constructor(
    readonly provider: AccountProvider,
    readonly email: string,
    readonly existingMemberId: string,
  ) {
    super('This email is already reported by another member for the same provider');
    this.name = 'MemberAccountEmailConflictError';
  }
}

export class MemberAccountStateStore {
  readonly dataDir: string;
  readonly stateFile: string;
  private readonly lockFile: string;
  private readonly now: () => Date;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: MemberAccountStateStoreOptions = {}) {
    this.dataDir = resolveAccountHubDataDir(options.dataDir);
    this.stateFile = path.join(this.dataDir, 'member-account-state.json');
    this.lockFile = path.join(this.dataDir, '.member-account-state.lock');
    this.now = options.now ?? (() => new Date());
  }

  private async ensureDataDir(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(this.dataDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('unsafe_member_account_state_directory');
    await fs.chmod(this.dataDir, 0o700);
  }

  private async readDocument(): Promise<MemberAccountStateDocument> {
    await this.ensureDataDir();
    let content: string;
    try {
      content = await fs.readFile(this.stateFile, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDocument();
      throw error;
    }
    await fs.chmod(this.stateFile, 0o600);
    return parseDocument(JSON.parse(content) as unknown);
  }

  private async writeDocument(document: MemberAccountStateDocument): Promise<void> {
    assertCredentialFreeAccountState(document);
    await this.ensureDataDir();
    const temporaryFile = path.join(this.dataDir, `.member-account-state-${process.pid}-${randomUUID()}.tmp`);
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(temporaryFile, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(temporaryFile, this.stateFile);
      await fs.chmod(this.stateFile, 0o600);
      const directoryHandle = await fs.open(this.dataDir, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      await fs.rm(temporaryFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
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
          if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
            const staleFile = `${this.lockFile}.stale-${randomUUID()}`;
            await fs.rename(this.lockFile, staleFile);
            await fs.rm(staleFile, { force: true });
            continue;
          }
        } catch (lockError) {
          if ((lockError as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw lockError;
        }
        if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) throw new Error('member_account_state_store_busy');
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
        // Never unlink a missing or replaced lock belonging to another writer.
      }
    }
  }

  private enqueueMutation<T>(mutation: (document: MemberAccountStateDocument) => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(() => this.withFileLock(async () => {
      const document = await this.readDocument();
      const result = await mutation(document);
      await this.writeDocument(document);
      return result;
    }));
    this.writeQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  async report(memberId: string, report: MemberAccountStateReport): Promise<MemberAccountStateSnapshot> {
    const snapshot = normalizeReport(memberId, report, this.now().toISOString());
    return this.enqueueMutation(async document => {
      if (snapshot.email) {
        const normalizedEmail = snapshot.email.toLowerCase();
        const conflict = Object.values(document.snapshots).find(existing => (
          existing.provider === snapshot.provider
          && existing.memberId !== snapshot.memberId
          && existing.email?.toLowerCase() === normalizedEmail
        ));
        if (conflict) {
          throw new MemberAccountEmailConflictError(snapshot.provider, snapshot.email, conflict.memberId);
        }
      }
      document.snapshots[stateKey(snapshot.memberId, snapshot.provider)] = snapshot;
      return clone(snapshot);
    });
  }

  async get(memberId: string, accountProvider: AccountProvider): Promise<MemberAccountStateSnapshot | undefined> {
    const normalizedMemberId = identifier(memberId, 'member_id');
    const normalizedProvider = provider(accountProvider);
    const snapshot = (await this.readDocument()).snapshots[stateKey(normalizedMemberId, normalizedProvider)];
    return snapshot ? clone(snapshot) : undefined;
  }

  async list(memberId?: string): Promise<MemberAccountStateSnapshot[]> {
    const normalizedMemberId = memberId === undefined ? undefined : identifier(memberId, 'member_id');
    return Object.values((await this.readDocument()).snapshots)
      .filter(snapshot => normalizedMemberId === undefined || snapshot.memberId === normalizedMemberId)
      .sort((left, right) => (
        left.memberId.localeCompare(right.memberId)
        || left.provider.localeCompare(right.provider)
      ))
      .map(clone);
  }
}
