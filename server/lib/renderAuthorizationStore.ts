import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyRenderToken, type RenderTokenPayload } from './renderToken.js';

export interface StoredRenderManifest {
  jobId: string;
  spec: {
    ratio: string;
    duration: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RenderAuthorizationSnapshot {
  tenantId: string;
  expiresAt: number;
  manifestSha256: string;
  manifest: StoredRenderManifest;
}

export type RenderAuthorizationFailureCode =
  | 'invalid_render_token'
  | 'render_tenant_mismatch'
  | 'render_job_mismatch'
  | 'render_authorization_expired'
  | 'render_authorization_not_found'
  | 'render_manifest_mismatch';

export type RenderAuthorizationResolution =
  | { ok: true; manifest: StoredRenderManifest; token: RenderTokenPayload }
  | { ok: false; code: RenderAuthorizationFailureCode; status: number };

const snapshots = new Map<string, RenderAuthorizationSnapshot>();

function storeFile(): string | undefined {
  const configured = String(process.env.RENDER_AUTHORIZATIONS_FILE || '').trim();
  if (configured) return path.resolve(configured);
  // Unit tests that do not opt into persistence must never touch the repository
  // data directory. Production and development keep the frozen snapshot on the
  // same durable data volume as the render-job journal.
  if (process.env.NODE_ENV === 'test') return undefined;
  return path.resolve(process.cwd(), 'data', 'render-authorizations.json');
}

function loadSnapshots(): Map<string, RenderAuthorizationSnapshot> {
  const file = storeFile();
  if (!file) return new Map(snapshots);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as RenderAuthorizationSnapshot[];
    if (!Array.isArray(parsed)) throw new Error('render authorization store must contain an array');
    return new Map(parsed.map(snapshot => [snapshot.manifest.jobId, snapshot]));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    throw error;
  }
}

function persistSnapshots(records: Map<string, RenderAuthorizationSnapshot>): void {
  snapshots.clear();
  for (const [jobId, snapshot] of records) snapshots.set(jobId, snapshot);
  const file = storeFile();
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify([...records.values()], null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function cloneManifest<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter(key => record[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function renderManifestSha256(manifest: StoredRenderManifest): string {
  return createHash('sha256').update(canonicalJson(manifest)).digest('hex');
}

export function rememberRenderAuthorization(input: {
  tenantId: string;
  expiresAt: number;
  manifest: StoredRenderManifest;
}): { manifestSha256: string } {
  return rememberRenderAuthorizationBatch([input])[0]!;
}

export function rememberRenderAuthorizationBatch(inputs: Array<{
  tenantId: string;
  expiresAt: number;
  manifest: StoredRenderManifest;
}>): Array<{ manifestSha256: string }> {
  const records = loadSnapshots();
  const seen = new Set<string>();
  const results = inputs.map(input => {
    const manifest = cloneManifest(input.manifest);
    const manifestSha256 = renderManifestSha256(manifest);
    if (!manifest.jobId || seen.has(manifest.jobId)) throw new Error('render authorization batch contains a duplicate job id');
    seen.add(manifest.jobId);
    records.set(manifest.jobId, {
      tenantId: input.tenantId,
      expiresAt: input.expiresAt,
      manifestSha256,
      manifest,
    });
    return { manifestSha256 };
  });
  persistSnapshots(records);
  return results;
}

export function forgetRenderAuthorizations(jobIds: readonly string[]): void {
  const records = loadSnapshots();
  let changed = false;
  for (const jobId of jobIds) changed = records.delete(jobId) || changed;
  if (changed) persistSnapshots(records);
}

export function findRenderAuthorizationSnapshot(jobId: string, tenantId: string): RenderAuthorizationSnapshot | null {
  const snapshot = loadSnapshots().get(jobId);
  return snapshot?.tenantId === tenantId ? cloneManifest(snapshot) : null;
}

export function resolveRenderAuthorization(input: {
  token: string | undefined;
  tenantId: string;
  jobId: string;
}): RenderAuthorizationResolution {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = verifyRenderToken(input.token);
  if (!payload || payload.scope !== 'render') return { ok: false, code: 'invalid_render_token', status: 401 };
  if (String(payload.tenantId || '') !== input.tenantId) return { ok: false, code: 'render_tenant_mismatch', status: 403 };
  if (!input.jobId || payload.jti !== input.jobId) return { ok: false, code: 'render_job_mismatch', status: 409 };

  const snapshot = loadSnapshots().get(input.jobId);
  if (!snapshot) return { ok: false, code: 'render_authorization_not_found', status: 410 };
  if (snapshot.expiresAt < nowSeconds || Number(payload.exp) !== snapshot.expiresAt) {
    return { ok: false, code: 'render_authorization_expired', status: 401 };
  }
  if (snapshot.tenantId !== input.tenantId) return { ok: false, code: 'render_tenant_mismatch', status: 403 };

  const tokenDuration = Number(payload.duration);
  const manifestDuration = Number(snapshot.manifest.spec.duration);
  const digest = renderManifestSha256(snapshot.manifest);
  if (
    snapshot.manifest.jobId !== payload.jti
    || String(payload.ratio || '') !== String(snapshot.manifest.spec.ratio || '')
    || !Number.isFinite(tokenDuration)
    || tokenDuration !== manifestDuration
    || String(payload.manifestSha256 || '') !== snapshot.manifestSha256
    || digest !== snapshot.manifestSha256
  ) {
    return { ok: false, code: 'render_manifest_mismatch', status: 409 };
  }

  return { ok: true, manifest: cloneManifest(snapshot.manifest), token: payload };
}

/** Test-only reset; production callers should rely on TTL cleanup. */
export function clearRenderAuthorizationStoreForTests(): void {
  snapshots.clear();
  const file = storeFile();
  if (file) fs.rmSync(file, { force: true });
}

/** Test-only: simulate a process restart while preserving the durable file. */
export function clearRenderAuthorizationMemoryForTests(): void {
  snapshots.clear();
}
