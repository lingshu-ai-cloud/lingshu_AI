import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const WORKER_HEARTBEAT_COLLECTION = 'social_operating_worker_heartbeats';
const DEFAULT_HEARTBEAT_RETENTION_HOURS = 24;
const DEFAULT_HEARTBEAT_MAX_RECORDS = 128;
const LOCAL_COLLECTION_TEMP_RETENTION_MS = 6 * 60 * 60_000;
const LOCAL_COLLECTION_TEMP_SWEEP_INTERVAL_MS = 60 * 60_000;
const lastTemporarySweepAt = new Map<string, number>();

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), minimum), maximum);
}

/**
 * Heartbeats are liveness data rather than an audit log. Local JSON fallback
 * must stay bounded even when development workers restart frequently.
 */
export function compactLocalCollectionRecords(
  collection: string,
  records: unknown[],
  options: { env?: NodeJS.ProcessEnv; now?: number } = {},
): unknown[] {
  if (collection !== WORKER_HEARTBEAT_COLLECTION) return records;
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  const retentionHours = boundedInteger(
    env.WORKER_HEARTBEAT_RETENTION_HOURS,
    DEFAULT_HEARTBEAT_RETENTION_HOURS,
    1,
    168,
  );
  const maxRecords = boundedInteger(
    env.WORKER_HEARTBEAT_LOCAL_MAX_RECORDS,
    DEFAULT_HEARTBEAT_MAX_RECORDS,
    1,
    1_024,
  );
  const cutoff = now - retentionHours * 60 * 60_000;
  return records
    .map((record, index) => ({ record, index, seenAt: Date.parse(String((record as Record<string, unknown>)?.last_seen_at ?? '')) }))
    .filter(item => Number.isFinite(item.seenAt) && item.seenAt >= cutoff)
    .sort((left, right) => right.seenAt - left.seenAt || left.index - right.index)
    .slice(0, maxRecords)
    .map(item => item.record);
}

/** Remove only this writer's stale PID + UUID temporary-file format. */
export function sweepStaleLocalCollectionTemporaryFiles(
  file: string,
  options: { now?: number; retentionMs?: number; force?: boolean } = {},
): number {
  const now = options.now ?? Date.now();
  const retentionMs = Math.max(60 * 60_000, options.retentionMs ?? LOCAL_COLLECTION_TEMP_RETENTION_MS);
  if (!options.force && now - (lastTemporarySweepAt.get(file) ?? 0) < LOCAL_COLLECTION_TEMP_SWEEP_INTERVAL_MS) return 0;
  lastTemporarySweepAt.set(file, now);
  const directory = path.dirname(file);
  const prefix = `${path.basename(file)}.`;
  let removed = 0;
  let entries: string[];
  try { entries = fs.readdirSync(directory); } catch { return 0; }
  for (const name of entries) {
    if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue;
    const identity = name.slice(prefix.length, -'.tmp'.length);
    if (!/^\d+\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identity)) continue;
    const candidate = path.join(directory, name);
    try {
      const stat = fs.lstatSync(candidate);
      if (!stat.isFile() || stat.isSymbolicLink() || now - stat.mtimeMs < retentionMs) continue;
      fs.unlinkSync(candidate);
      removed += 1;
    } catch {
      // A concurrent cleanup or filesystem error must not block a new commit.
    }
  }
  return removed;
}

/** Write a collection atomically and never retain a failed full-size copy. */
export function atomicWriteLocalCollection(file: string, records: unknown[]): void {
  const directory = path.dirname(file);
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.mkdirSync(directory, { recursive: true });
  sweepStaleLocalCollectionTemporaryFiles(file);
  try {
    fs.writeFileSync(temporary, JSON.stringify(records, null, 2), { encoding: 'utf8', mode: 0o600 });
    const descriptor = fs.openSync(temporary, 'r');
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, file);
    const directoryDescriptor = fs.openSync(directory, 'r');
    try { fs.fsyncSync(directoryDescriptor); } finally { fs.closeSync(directoryDescriptor); }
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // Some platforms ignore POSIX file modes.
    }
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[storage] failed to remove local collection temporary file', {
          collection: path.basename(file),
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    }
    throw error;
  }
}
