import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveAccountHubDataDir } from './paths.js';
import { containsCredentialLikeText, isSafeTelemetryIdentifier } from './safeText.js';

const MAX_EVENTS = 100_000;
const MEMBER_TOKEN_PREFIX = 'cdu_';
const CONNECTOR_TOKEN_PREFIX = 'cdc_';
const TEAM_USAGE_LOCK_STALE_MS = 30_000;
const TEAM_USAGE_LOCK_TIMEOUT_MS = 5_000;

export type UsageRange = '1d' | '7d' | '30d';

export interface TeamMember {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
}

interface StoredTeamMember extends TeamMember {
  ingestTokenHash: string;
  connectorTokenHash?: string;
}

export interface TeamUsageEvent {
  id: string;
  memberId: string;
  eventAt: string;
  receivedAt: string;
  conversationHash: string | null;
  model: string | null;
  source: string | null;
  clientVersion: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

interface TeamUsageDocument {
  schemaVersion: 1;
  members: Record<string, StoredTeamMember>;
  events: TeamUsageEvent[];
}

export interface TeamUsageMemberSummary extends TeamMember {
  online: boolean;
  eventCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface TeamUsageSummary {
  range: UsageRange;
  generatedAt: string;
  freshness: 'near_realtime';
  accounting: 'telemetry_estimate';
  totals: Omit<TeamUsageMemberSummary, keyof TeamMember | 'online'>;
  members: TeamUsageMemberSummary[];
  timeline: Array<{
    date: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>;
  recent: TeamUsageEvent[];
}

type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid_member_name');
  const normalized = value.trim();
  if (!normalized || normalized.length > 80 || normalized.includes('\0')) throw new Error('invalid_member_name');
  if (containsCredentialLikeText(normalized)) throw new Error('credential_material_not_accepted');
  return normalized;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function tokenHashMatches(candidate: string, expectedHash: string): boolean {
  const actual = Buffer.from(sha256(candidate), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function emptyDocument(): TeamUsageDocument {
  return { schemaVersion: 1, members: {}, events: [] };
}

function publicMember(member: StoredTeamMember): TeamMember {
  const { ingestTokenHash: _telemetrySecret, connectorTokenHash: _connectorSecret, ...safe } = member;
  return structuredClone(safe);
}

function finiteToken(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function otlpValue(value: unknown): unknown {
  const source = object(value);
  if (!source) return value;
  for (const key of ['stringValue', 'intValue', 'doubleValue', 'boolValue'] as const) {
    if (source[key] !== undefined) return source[key];
  }
  return undefined;
}

function attributes(value: unknown): Map<string, unknown> {
  const values = new Map<string, unknown>();
  if (!Array.isArray(value)) return values;
  for (const item of value) {
    const entry = object(item);
    if (typeof entry?.key === 'string') values.set(entry.key, otlpValue(entry.value));
  }
  return values;
}

function firstText(values: Map<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = values.get(key);
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 200);
  }
  return null;
}

function firstSafeDimension(values: Map<string, unknown>, ...keys: string[]): string | null {
  const value = firstText(values, ...keys);
  if (value === null) return null;
  if (containsCredentialLikeText(value)) throw new Error('credential_material_not_accepted');
  if (!isSafeTelemetryIdentifier(value)) throw new Error('invalid_telemetry_metadata');
  return value;
}

function firstToken(values: Map<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const parsed = finiteToken(values.get(key));
    if (parsed !== null) return parsed;
  }
  return 0;
}

function eventTime(record: UnknownRecord, fallback: Date): string {
  const raw = record.timeUnixNano ?? record.observedTimeUnixNano;
  try {
    if (typeof raw === 'string' && /^\d+$/.test(raw)) {
      const millis = Number(BigInt(raw) / 1_000_000n);
      if (Number.isFinite(millis)) return new Date(millis).toISOString();
    }
  } catch { /* malformed timestamp falls back to receipt time */ }
  return fallback.toISOString();
}

function parseLogRecords(payload: unknown, memberId: string, receivedAt: Date): TeamUsageEvent[] {
  const root = object(payload);
  const resourceLogs = Array.isArray(root?.resourceLogs) ? root.resourceLogs : [];
  const parsed: TeamUsageEvent[] = [];

  for (const resourceLogValue of resourceLogs) {
    const resourceLog = object(resourceLogValue);
    const resource = object(resourceLog?.resource);
    const resourceAttributes = attributes(resource?.attributes);
    const scopeLogs = Array.isArray(resourceLog?.scopeLogs) ? resourceLog.scopeLogs : [];
    for (const scopeLogValue of scopeLogs) {
      const scopeLog = object(scopeLogValue);
      const logRecords = Array.isArray(scopeLog?.logRecords) ? scopeLog.logRecords : [];
      for (const recordValue of logRecords) {
        const record = object(recordValue);
        if (!record) continue;
        const values = new Map(resourceAttributes);
        for (const [key, value] of attributes(record.attributes)) values.set(key, value);

        const inputTokens = firstToken(values, 'gen_ai.usage.input_tokens', 'input_token_count', 'input_tokens');
        const cachedInputTokens = firstToken(values, 'gen_ai.usage.cache_read.input_tokens', 'cached_token_count', 'cached_input_tokens');
        const cacheWriteInputTokens = firstToken(values, 'gen_ai.usage.cache_write.input_tokens', 'cache_write_token_count', 'cache_write_input_tokens');
        const outputTokens = firstToken(values, 'gen_ai.usage.output_tokens', 'output_token_count', 'output_tokens');
        const reasoningOutputTokens = firstToken(values, 'codex.usage.reasoning_output_tokens', 'reasoning_token_count', 'reasoning_output_tokens');
        const explicitTotal = firstToken(values, 'codex.usage.total_tokens', 'total_token_count', 'total_tokens');
        const totalTokens = explicitTotal || inputTokens + outputTokens;
        if (totalTokens === 0 && inputTokens === 0 && outputTokens === 0) continue;

        const eventAt = eventTime(record, receivedAt);
        const conversationId = firstSafeDimension(values, 'conversation.id', 'conversation_id');
        const model = firstSafeDimension(values, 'model', 'gen_ai.request.model');
        const source = firstSafeDimension(values, 'session_source', 'originator', 'service.name');
        const clientVersion = firstSafeDimension(values, 'app.version', 'service.version');
        const identity = JSON.stringify({
          memberId, eventAt, conversationId, model, inputTokens, cachedInputTokens,
          cacheWriteInputTokens, outputTokens, reasoningOutputTokens, totalTokens,
        });
        parsed.push({
          id: `usage_${sha256(identity).slice(0, 32)}`,
          memberId,
          eventAt,
          receivedAt: receivedAt.toISOString(),
          conversationHash: conversationId ? sha256(conversationId).slice(0, 16) : null,
          model,
          source,
          clientVersion,
          inputTokens,
          cachedInputTokens,
          cacheWriteInputTokens,
          outputTokens,
          reasoningOutputTokens,
          totalTokens,
        });
      }
    }
  }
  return parsed;
}

function assertDocument(value: unknown): TeamUsageDocument {
  const source = object(value);
  if (source?.schemaVersion !== 1 || !object(source.members) || !Array.isArray(source.events)) {
    throw new Error('invalid_team_usage_store');
  }
  for (const memberValue of Object.values(source.members as UnknownRecord)) {
    const member = object(memberValue);
    if (!member || typeof member.name !== 'string' || containsCredentialLikeText(member.name)) {
      throw new Error('invalid_team_usage_store');
    }
  }
  for (const eventValue of source.events) {
    const event = object(eventValue);
    if (!event) throw new Error('invalid_team_usage_store');
    if (
      event.conversationHash !== null
      && (typeof event.conversationHash !== 'string' || !/^[a-f0-9]{16}$/.test(event.conversationHash))
    ) throw new Error('invalid_team_usage_store');
    for (const field of ['model', 'source', 'clientVersion'] as const) {
      const text = event[field];
      if (text !== null && (
        typeof text !== 'string'
        || text.length > 200
        || containsCredentialLikeText(text)
        || !isSafeTelemetryIdentifier(text)
      )) throw new Error('invalid_team_usage_store');
    }
  }
  return source as unknown as TeamUsageDocument;
}

function rangeStart(range: UsageRange, now: Date): number {
  const days = range === '1d' ? 1 : range === '7d' ? 7 : 30;
  return now.getTime() - days * 24 * 60 * 60_000;
}

function emptyTotals() {
  return {
    eventCount: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function addEvent<T extends ReturnType<typeof emptyTotals>>(totals: T, event: TeamUsageEvent): T {
  totals.eventCount += 1;
  totals.inputTokens += event.inputTokens;
  totals.cachedInputTokens += event.cachedInputTokens;
  totals.cacheWriteInputTokens += event.cacheWriteInputTokens;
  totals.outputTokens += event.outputTokens;
  totals.reasoningOutputTokens += event.reasoningOutputTokens;
  totals.totalTokens += event.totalTokens;
  return totals;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export class TeamUsageStore {
  readonly dataDir: string;
  readonly file: string;
  private readonly lockFile: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: { dataDir?: string; now?: () => Date } = {}) {
    this.dataDir = resolveAccountHubDataDir(options.dataDir);
    this.file = path.join(this.dataDir, 'team-usage.json');
    this.lockFile = path.join(this.dataDir, '.team-usage.lock');
    this.now = options.now ?? (() => new Date());
  }

  private readonly now: () => Date;

  private async ensureDataDir(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(this.dataDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('unsafe_team_usage_directory');
    await fs.chmod(this.dataDir, 0o700);
  }

  private async read(): Promise<TeamUsageDocument> {
    await this.ensureDataDir();
    try {
      const document = assertDocument(JSON.parse(await fs.readFile(this.file, 'utf8')) as unknown);
      await fs.chmod(this.file, 0o600);
      return document;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDocument();
      throw error;
    }
  }

  private async write(document: TeamUsageDocument): Promise<void> {
    await this.ensureDataDir();
    const temporary = path.join(this.dataDir, `.team-usage-${process.pid}-${randomUUID()}.tmp`);
    let handle: fs.FileHandle | undefined;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(temporary, this.file);
      await fs.chmod(this.file, 0o600);
      const directoryHandle = await fs.open(this.dataDir, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      await fs.rm(temporary, { force: true }).catch(() => undefined);
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
          if (Date.now() - stat.mtimeMs > TEAM_USAGE_LOCK_STALE_MS) {
            const staleFile = `${this.lockFile}.stale-${randomUUID()}`;
            await fs.rename(this.lockFile, staleFile);
            await fs.rm(staleFile, { force: true });
            continue;
          }
        } catch (lockError) {
          if ((lockError as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw lockError;
        }
        if (Date.now() - startedAt >= TEAM_USAGE_LOCK_TIMEOUT_MS) throw new Error('team_usage_store_busy');
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
        // Never remove a missing, malformed, or replaced lock owned by another writer.
      }
    }
  }

  private mutate<T>(operation: (document: TeamUsageDocument) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(() => this.withFileLock(async () => {
      // Always re-read after acquiring the process-wide lock. A snapshot read
      // before the lock could overwrite a concurrent disable or token rotate.
      const document = await this.read();
      const result = await operation(document);
      await this.write(document);
      return result;
    }));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async listMembers(): Promise<TeamMember[]> {
    return Object.values((await this.read()).members)
      .map(publicMember)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async createMember(nameValue: unknown): Promise<{
    member: TeamMember;
    ingestToken: string;
    connectorToken: string;
  }> {
    const name = cleanName(nameValue);
    const ingestToken = `${MEMBER_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const connectorToken = `${CONNECTOR_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    return this.mutate(document => {
      if (Object.values(document.members).some(member => member.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        throw new Error('member_name_exists');
      }
      const timestamp = this.now().toISOString();
      const member: StoredTeamMember = {
        id: `member_${randomUUID()}`,
        name,
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        ingestTokenHash: sha256(ingestToken),
        connectorTokenHash: sha256(connectorToken),
      };
      document.members[member.id] = member;
      return { member: publicMember(member), ingestToken, connectorToken };
    });
  }

  async setMemberEnabled(memberId: string, enabled: boolean): Promise<TeamMember> {
    return this.mutate(document => {
      const member = document.members[memberId];
      if (!member) throw new Error('member_not_found');
      member.enabled = enabled;
      member.updatedAt = this.now().toISOString();
      return publicMember(member);
    });
  }

  async rotateToken(memberId: string): Promise<{
    member: TeamMember;
    ingestToken: string;
    connectorToken: string;
  }> {
    const ingestToken = `${MEMBER_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const connectorToken = `${CONNECTOR_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    return this.mutate(document => {
      const member = document.members[memberId];
      if (!member) throw new Error('member_not_found');
      member.ingestTokenHash = sha256(ingestToken);
      member.connectorTokenHash = sha256(connectorToken);
      member.updatedAt = this.now().toISOString();
      return { member: publicMember(member), ingestToken, connectorToken };
    });
  }

  async authenticateIngestToken(ingestToken: string): Promise<TeamMember> {
    if (!ingestToken.startsWith(MEMBER_TOKEN_PREFIX)) throw new Error('invalid_ingest_token');
    const member = Object.values((await this.read()).members)
      .find(candidate => tokenHashMatches(ingestToken, candidate.ingestTokenHash));
    if (!member || !member.enabled) throw new Error('invalid_ingest_token');
    return publicMember(member);
  }

  async authenticateConnectorToken(connectorToken: string): Promise<TeamMember> {
    if (!connectorToken.startsWith(CONNECTOR_TOKEN_PREFIX)) throw new Error('invalid_ingest_token');
    const member = Object.values((await this.read()).members)
      .find(candidate => (
        candidate.connectorTokenHash
        && tokenHashMatches(connectorToken, candidate.connectorTokenHash)
      ));
    if (!member || !member.enabled) throw new Error('invalid_ingest_token');
    return publicMember(member);
  }

  async ingest(ingestToken: string, payload: unknown): Promise<{ accepted: number; memberId: string }> {
    if (!ingestToken.startsWith(MEMBER_TOKEN_PREFIX)) throw new Error('invalid_ingest_token');
    return this.mutate(document => {
      const member = Object.values(document.members).find(candidate => tokenHashMatches(ingestToken, candidate.ingestTokenHash));
      if (!member || !member.enabled) throw new Error('invalid_ingest_token');
      const receivedAt = this.now();
      const incoming = parseLogRecords(payload, member.id, receivedAt);
      const existingIds = new Set(document.events.map(event => event.id));
      const unique = incoming.filter(event => !existingIds.has(event.id));
      document.events.push(...unique);
      if (document.events.length > MAX_EVENTS) document.events.splice(0, document.events.length - MAX_EVENTS);
      member.lastSeenAt = receivedAt.toISOString();
      member.updatedAt = receivedAt.toISOString();
      return { accepted: unique.length, memberId: member.id };
    });
  }

  async summary(range: UsageRange): Promise<TeamUsageSummary> {
    const document = await this.read();
    const now = this.now();
    const start = rangeStart(range, now);
    const events = document.events.filter(event => Date.parse(event.eventAt) >= start);
    const memberTotals = new Map<string, ReturnType<typeof emptyTotals>>();
    const totals = emptyTotals();
    const days = new Map<string, ReturnType<typeof emptyTotals>>();
    for (const event of events) {
      addEvent(totals, event);
      addEvent(memberTotals.get(event.memberId) ?? memberTotals.set(event.memberId, emptyTotals()).get(event.memberId)!, event);
      const day = event.eventAt.slice(0, 10);
      addEvent(days.get(day) ?? days.set(day, emptyTotals()).get(day)!, event);
    }
    const members = Object.values(document.members)
      .map(member => ({
        ...publicMember(member),
        online: Boolean(member.lastSeenAt && now.getTime() - Date.parse(member.lastSeenAt) <= 2 * 60_000),
        ...(memberTotals.get(member.id) ?? emptyTotals()),
      }))
      .sort((left, right) => right.totalTokens - left.totalTokens || left.name.localeCompare(right.name, 'zh-CN'));
    return {
      range,
      generatedAt: now.toISOString(),
      freshness: 'near_realtime',
      accounting: 'telemetry_estimate',
      totals,
      members,
      timeline: [...days.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, value]) => ({
        date,
        inputTokens: value.inputTokens,
        cachedInputTokens: value.cachedInputTokens,
        outputTokens: value.outputTokens,
        totalTokens: value.totalTokens,
      })),
      recent: events.slice().sort((left, right) => right.eventAt.localeCompare(left.eventAt)).slice(0, 30),
    };
  }
}

let singleton: TeamUsageStore | undefined;

export function teamUsageStore(): TeamUsageStore {
  if (!singleton) singleton = new TeamUsageStore();
  return singleton;
}
