import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { HealthCheckResult } from './health.js';

function configuredMinimumFreeBytes(): number {
  const candidate = Number(process.env.APP_DATA_MIN_FREE_BYTES || 512 * 1024 * 1024);
  return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : 512 * 1024 * 1024;
}

export function applicationDataRoot(): string {
  return path.resolve(String(process.env.APP_DATA_ROOT || path.join(process.cwd(), 'data')));
}

export async function dataVolumeHealthCheck(input: {
  root?: string;
  minimumFreeBytes?: number;
} = {}): Promise<HealthCheckResult> {
  const root = path.resolve(input.root || applicationDataRoot());
  const minimumFreeBytes = input.minimumFreeBytes ?? configuredMinimumFreeBytes();
  const token = `${process.pid}-${randomUUID()}`;
  const temporary = path.join(root, `.readyz-${token}.tmp`);
  const committed = path.join(root, `.readyz-${token}.ok`);
  let handle: fs.FileHandle | null = null;
  try {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const metadata = await fs.lstat(root);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      return { ok: false, message: 'app_data_root_invalid', details: { root } };
    }
    const stat = await fs.statfs(root);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    if (!Number.isFinite(freeBytes) || freeBytes < minimumFreeBytes) {
      return { ok: false, message: 'app_data_free_space_low', details: { freeBytes, minimumFreeBytes } };
    }
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(Buffer.from(`lingshu-data-canary:${token}`, 'utf8'));
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, committed);
    const directory = await fs.open(root, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    await fs.unlink(committed);
    return { ok: true, details: { freeBytes } };
  } catch (error) {
    return {
      ok: false,
      message: 'app_data_volume_unwritable',
      details: { code: String((error as NodeJS.ErrnoException)?.code || 'unknown') },
    };
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.unlink(temporary).catch(() => undefined);
    await fs.unlink(committed).catch(() => undefined);
  }
}
