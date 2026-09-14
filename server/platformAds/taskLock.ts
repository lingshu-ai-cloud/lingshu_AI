import { mkdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Cross-process, single-host lock. Never auto-steal: an interrupted write needs reconciliation. */
export async function withPlatformAdTaskLock<T>(tenantId: string, id: string, fn: () => Promise<T>): Promise<T> {
  const root = path.resolve(process.env.LOCAL_STORE_DIR || 'data', 'platform-ad-locks');
  await mkdir(root, { recursive: true });
  const lock = path.join(root, createHash('sha256').update(`${tenantId}\0${id}`).digest('hex'));
  try { await mkdir(lock); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('投放任务正在执行或需要恢复核对，请稍后重试');
    throw error;
  }
  try { return await fn(); } finally { await rmdir(lock); }
}
