import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LINGSHU_TEMP_PREFIXES = [
  'lingshu-material-upload-',
  'lingshu-material-analysis-',
  'lingshu-photo-ingress-',
  'runway-reference-',
  'fast-head-worker-',
] as const;

export interface LocalTempSweepReport {
  scanned: number;
  removed: string[];
  retained: string[];
  errors: Array<{ name: string; error: string }>;
}

export async function sweepStaleTemporaryDirectories(input: {
  root?: string;
  retentionMs?: number;
  now?: number;
  prefixes?: readonly string[];
  apply?: boolean;
} = {}): Promise<LocalTempSweepReport> {
  const root = path.resolve(input.root || os.tmpdir());
  const retentionMs = Math.max(6 * 60 * 60_000, input.retentionMs ?? 24 * 60 * 60_000);
  const now = input.now ?? Date.now();
  const prefixes = input.prefixes?.length ? input.prefixes : LINGSHU_TEMP_PREFIXES;
  const report: LocalTempSweepReport = { scanned: 0, removed: [], retained: [], errors: [] };
  let entries: import('node:fs').Dirent[] = [];
  try { entries = await fs.readdir(root, { withFileTypes: true }); }
  catch (error) {
    report.errors.push({ name: root, error: error instanceof Error ? error.message : String(error) });
    return report;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !prefixes.some(prefix => entry.name.startsWith(prefix))) continue;
    report.scanned += 1;
    const target = path.resolve(root, entry.name);
    if (!target.startsWith(`${root}${path.sep}`)) {
      report.errors.push({ name: entry.name, error: 'temporary path escaped its root' });
      continue;
    }
    try {
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || now - stat.mtimeMs < retentionMs) {
        report.retained.push(entry.name);
        continue;
      }
      if (input.apply !== false) await fs.rm(target, { recursive: true, force: true });
      report.removed.push(entry.name);
    } catch (error) {
      report.errors.push({ name: entry.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}

let timer: NodeJS.Timeout | undefined;

export function initLocalTempMaintenance(): void {
  if (timer || process.env.LOCAL_TEMP_CLEANUP_ENABLED === 'false') return;
  const configuredRetention = Number(process.env.LOCAL_TEMP_RETENTION_HOURS || 24);
  const configuredInterval = Number(process.env.LOCAL_TEMP_CLEANUP_INTERVAL_HOURS || 6);
  const retentionHours = Number.isFinite(configuredRetention) ? Math.max(6, configuredRetention) : 24;
  const intervalHours = Number.isFinite(configuredInterval) ? Math.max(1, configuredInterval) : 6;
  const run = async () => {
    const report = await sweepStaleTemporaryDirectories({ retentionMs: retentionHours * 60 * 60_000 });
    if (report.removed.length || report.errors.length) {
      console.log('[storage] local temporary-file sweep', {
        scanned: report.scanned,
        removed: report.removed.length,
        errors: report.errors.length,
      });
    }
  };
  void run();
  timer = setInterval(() => void run(), intervalHours * 60 * 60_000);
  timer.unref?.();
}
