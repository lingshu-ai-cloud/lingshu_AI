import type { DataStore, ListResult } from '../storage/datastore.js';
import { store } from '../storage/index.js';
import { ensureStarterQuoteArtifact } from './quoteArtifact.js';
import { buildStarter198CapabilityManifest, starter198CapabilityAllowed } from './profile.js';
import { createStarter198Repository, STARTER_COLLECTIONS, type StarterRecord } from './repository.js';
import { starterWorkerRuntimeIssue } from './workerRuntime.js';
import { starterWorkerDataStore } from './workerStorage.js';

type QuoteRow = { id: string; tenant_id?: unknown; input_hash?: unknown; status?: unknown };
type AccessRow = { id: string; tenant_id?: unknown };
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export interface StarterQuoteArtifactCycleResult {
  scanned: number;
  tenantsScanned: number;
  created: number;
  existing: number;
  failed: Array<{ tenantId: string; draftId: string; code: string }>;
  nextCursor: string | null;
  scanComplete: boolean;
}

type ScanCursorV1 = {
  schemaVersion: 'starter-198.quote-artifact-scan.v1';
  accessPage: number;
  accessOffset: number;
  draftPage: number;
  draftOffset: number;
};

const ACCESS_PAGE_SIZE = 100;
const DRAFT_PAGE_SIZE = 100;
const INITIAL_CURSOR: ScanCursorV1 = {
  schemaVersion: 'starter-198.quote-artifact-scan.v1',
  accessPage: 1,
  accessOffset: 0,
  draftPage: 1,
  draftOffset: 0,
};

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

function boundedInteger(value: number | undefined, fallback: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(1, Math.floor(value!))) : fallback;
}

function validCursorInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function decodeCursor(value: string | null | undefined): ScanCursorV1 {
  if (!value) return { ...INITIAL_CURSOR };
  try {
    if (value.length > 512 || !/^[a-z0-9_-]+$/i.test(value)) throw new Error('invalid');
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== value) throw new Error('invalid');
    const parsed = JSON.parse(decoded) as Partial<ScanCursorV1>;
    if (parsed.schemaVersion !== INITIAL_CURSOR.schemaVersion
      || !validCursorInteger(parsed.accessPage, 1, Number.MAX_SAFE_INTEGER)
      || !validCursorInteger(parsed.accessOffset, 0, ACCESS_PAGE_SIZE - 1)
      || !validCursorInteger(parsed.draftPage, 1, Number.MAX_SAFE_INTEGER)
      || !validCursorInteger(parsed.draftOffset, 0, DRAFT_PAGE_SIZE - 1)) throw new Error('invalid');
    return parsed as ScanCursorV1;
  } catch {
    throw new Error('starter_198_quote_artifact_cursor_invalid');
  }
}

function encodeCursor(cursor: ScanCursorV1): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function nextDraft(cursor: ScanCursorV1): void {
  cursor.draftOffset += 1;
  if (cursor.draftOffset >= DRAFT_PAGE_SIZE) {
    cursor.draftPage += 1;
    cursor.draftOffset = 0;
  }
}

function nextTenant(cursor: ScanCursorV1): void {
  cursor.accessOffset += 1;
  if (cursor.accessOffset >= ACCESS_PAGE_SIZE) {
    cursor.accessPage += 1;
    cursor.accessOffset = 0;
  }
  cursor.draftPage = 1;
  cursor.draftOffset = 0;
}

function validPage(value: {
  items: unknown[];
  totalItems: number;
  totalPages: number;
  page: number;
  perPage: number;
}, expectedPage: number, expectedPageSize: number): boolean {
  const expectedTotalPages = Number.isInteger(value.totalItems) && value.totalItems >= 0
    ? (value.totalItems === 0 ? 0 : Math.ceil(value.totalItems / expectedPageSize))
    : -1;
  return Array.isArray(value.items) && value.items.length <= expectedPageSize
    && Number.isInteger(value.totalItems) && value.totalItems >= 0
    && Number.isInteger(value.totalPages) && value.totalPages >= 0
    && value.totalPages === expectedTotalPages
    && value.page === expectedPage
    && value.perPage === expectedPageSize
    && (value.items.length > 0 || value.totalItems === 0 || expectedPage > value.totalPages);
}

/**
 * Repairs the narrow crash window between immutable quote approval and local
 * artifact persistence. It has no provider/API side effect; uniqueness on
 * (tenant_id,draft_id) makes concurrent workers converge on one byte stream.
 */
export async function runStarterQuoteArtifactCycle(input: {
  dataStore?: DataStore;
  maxDrafts?: number;
  maxTenants?: number;
  cursor?: string | null;
  now?: Date;
} = {}): Promise<StarterQuoteArtifactCycleResult> {
  const dataStore = starterWorkerDataStore(input.dataStore ?? store);
  const repository = createStarter198Repository(dataStore);
  const maxDrafts = boundedInteger(input.maxDrafts,
    integerEnv('STARTER_QUOTE_ARTIFACT_WORKER_MAX_DRAFTS', 100, 1, 500), 500);
  const maxTenants = boundedInteger(input.maxTenants,
    integerEnv('STARTER_QUOTE_ARTIFACT_WORKER_MAX_TENANTS', 100, 1, 500), 500);
  const cursor = decodeCursor(input.cursor);
  const result: StarterQuoteArtifactCycleResult = {
    scanned: 0, tenantsScanned: 0, created: 0, existing: 0, failed: [],
    nextCursor: null, scanComplete: false,
  };
  let loadedAccessPage = 0;
  let accessBatch: ListResult<AccessRow> | null = null;

  // Both dimensions are bounded. The opaque cursor resumes inside a tenant's
  // ordered approved-draft pages, so existing or bad rows cannot pin page one.
  while (result.scanned < maxDrafts && result.tenantsScanned < maxTenants) {
    if (!accessBatch || loadedAccessPage !== cursor.accessPage) {
      accessBatch = await dataStore.list<AccessRow>(STARTER_COLLECTIONS.access, {
        where: { product_profile: 'starter_198', status: 'active' },
        sort: 'tenant_id,id', page: cursor.accessPage, perPage: ACCESS_PAGE_SIZE,
      });
      loadedAccessPage = cursor.accessPage;
      if (!validPage(accessBatch, cursor.accessPage, ACCESS_PAGE_SIZE)) {
        throw new Error('starter_198_quote_artifact_access_scan_invalid');
      }
    }
    if (cursor.accessOffset >= accessBatch.items.length) {
      if (cursor.accessPage < accessBatch.totalPages) {
        cursor.accessPage += 1;
        cursor.accessOffset = 0;
        cursor.draftPage = 1;
        cursor.draftOffset = 0;
        continue;
      }
      result.scanComplete = true;
      break;
    }

    const tenantId = text(accessBatch.items[cursor.accessOffset]?.tenant_id);
    result.tenantsScanned += 1;
    if (!tenantId) {
      result.failed.push({ tenantId: '', draftId: '', code: 'starter_198_quote_artifact_access_invalid' });
      nextTenant(cursor);
      continue;
    }
    try {
      const access = await repository.access(tenantId);
      const manifest = buildStarter198CapabilityManifest(access, input.now ?? new Date());
      if (!starter198CapabilityAllowed(manifest, 'quotation.calculate')) {
        nextTenant(cursor);
        continue;
      }
      let loadedDraftPage = 0;
      let draftBatch: ListResult<StarterRecord> | null = null;
      while (result.scanned < maxDrafts) {
        if (!draftBatch || loadedDraftPage !== cursor.draftPage) {
          draftBatch = await repository.list(STARTER_COLLECTIONS.quoteDrafts, tenantId, {
            where: { status: 'approved' }, sort: 'updated_at,id',
            page: cursor.draftPage, perPage: DRAFT_PAGE_SIZE,
          });
          loadedDraftPage = cursor.draftPage;
          if (!validPage(draftBatch, cursor.draftPage, DRAFT_PAGE_SIZE)) {
            throw new Error('starter_198_quote_artifact_draft_scan_invalid');
          }
        }
        if (cursor.draftOffset >= draftBatch.items.length) {
          if (cursor.draftPage < draftBatch.totalPages) {
            cursor.draftPage += 1;
            cursor.draftOffset = 0;
            continue;
          }
          nextTenant(cursor);
          break;
        }
        const draft = draftBatch.items[cursor.draftOffset] as QuoteRow;
        nextDraft(cursor);
        result.scanned += 1;
        const inputHash = text(draft.input_hash);
        if (!draft.id || !inputHash) {
          result.failed.push({ tenantId, draftId: draft.id || '', code: 'starter_198_quote_artifact_draft_invalid' });
          continue;
        }
        try {
          const ensured = await ensureStarterQuoteArtifact({
            tenantId,
            userId: 'starter_quote_artifact_worker',
            draftId: draft.id,
            expectedInputHash: inputHash,
            idempotencyKey: `quote-artifact-worker:${draft.id}:${inputHash.slice(0, 24)}`,
            dataStore,
            repository,
            now: input.now,
          });
          if (ensured.created) result.created += 1;
          else result.existing += 1;
        } catch (error) {
          result.failed.push({
            tenantId,
            draftId: draft.id,
            code: error instanceof Error ? error.message.slice(0, 160) : 'starter_198_quote_artifact_failed',
          });
        }
      }
    } catch (error) {
      result.failed.push({
        tenantId,
        draftId: '',
        code: error instanceof Error ? error.message.slice(0, 160) : 'starter_198_quote_artifact_access_invalid',
      });
      nextTenant(cursor);
    }
  }
  result.nextCursor = result.scanComplete ? null : encodeCursor(cursor);
  return result;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let scanCursor: string | null = null;

async function guardedCycle(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const result = await runStarterQuoteArtifactCycle({ cursor: scanCursor });
    scanCursor = result.nextCursor;
    if (result.created || result.failed.length) {
      console.log(`[starter-quote-artifact-worker] scanned=${result.scanned} created=${result.created} failed=${result.failed.length}`);
    }
  } catch (error) {
    console.error('[starter-quote-artifact-worker] cycle failed:', error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

export function initStarterQuoteArtifactWorker(): void {
  const runtimeIssue = starterWorkerRuntimeIssue('STARTER_QUOTE_ARTIFACT_WORKER_ENABLED');
  if (runtimeIssue || timer) {
    if (runtimeIssue && runtimeIssue !== 'not_explicitly_enabled') {
      console.error(`[starter-quote-artifact-worker] not started: ${runtimeIssue}`);
    }
    return;
  }
  const intervalMs = integerEnv('STARTER_QUOTE_ARTIFACT_WORKER_INTERVAL_MS', 30_000, 5_000, 15 * 60_000);
  void guardedCycle();
  timer = setInterval(() => { void guardedCycle(); }, intervalMs);
  timer.unref?.();
  console.log(`[starter-quote-artifact-worker] enabled interval=${intervalMs}ms`);
}

export function stopStarterQuoteArtifactWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
