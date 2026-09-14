import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

/** Shared-volume lock; deliberately never expires while an upstream call may still be running.
 * A crashed worker leaves a lock requiring operator reconciliation, not an automatic paid retry.
 * All workers must mount the same data directory. This is not a distributed database lock.
 */
export async function withPaidOperationLock<T>(root: string, key: string, operation: () => Promise<T>): Promise<T> {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, `${createHash('sha256').update(key).digest('hex')}.lock`);
  const owner = randomUUID();
  let fd: number;
  try { fd = fs.openSync(file, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('任务正在处理或上次进程异常中断；请稍后刷新，持续占用需管理员核对，禁止重新付费提交');
    throw new Error('付费任务锁不可写，未调用供应商');
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({ owner, createdAt: new Date().toISOString() }));
    return await operation();
  } finally {
    fs.closeSync(fd);
    // Never remove a replacement lock that belongs to another process.
    try { if (JSON.parse(fs.readFileSync(file, 'utf8')).owner === owner) fs.unlinkSync(file); } catch { /* fail closed */ }
  }
}
