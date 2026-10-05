import '../server/loadEnvironment.js';
import { closeBullMq, checkBullMq, selectedQueueBackend } from '../server/queues/bullmq.js';
import { getPbAdminToken, getPbUrl } from '../server/storage/pb.js';
import { objectStorageConfigurationIssues, objectStorageDriver, objectStorageEnabled, objectStorageList } from '../server/storage/objectStorage.js';
import { closePostgresPool, postgresPool, selectedDataBackend } from '../server/storage/postgres.js';

type Check = { ready: boolean; detail?: string };

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error || 'unknown')).replace(/postgres(?:ql)?:\/\/[^\s@]+@/gi, 'postgresql://***@').slice(0, 300);
}

async function capture(action: () => Promise<string | void>): Promise<Check> {
  try {
    const detail = await action();
    return { ready: true, ...(detail ? { detail } : {}) };
  } catch (error) {
    return { ready: false, detail: message(error) };
  }
}

async function main(): Promise<void> {
  const dataBackend = selectedDataBackend();
  const queueBackend = selectedQueueBackend();
  const report: Record<string, Check | string> = {
    dataBackend,
    queueBackend,
    objectStorageDriver: objectStorageDriver(),
  };

  report.postgres = dataBackend !== 'postgres'
    ? { ready: false, detail: 'DATA_BACKEND must be postgres' }
    : await capture(async () => {
      const connection = await postgresPool().query<{ version: string; schema: string | null }>(
        "SELECT current_setting('server_version') AS version, to_regclass('public.lingshu_records')::text AS schema",
      );
      return `connected; schema=${connection.rows[0]?.schema || 'not_applied_yet'}; version=${connection.rows[0]?.version || 'unknown'}`;
    });

  report.redis = queueBackend !== 'bullmq'
    ? { ready: false, detail: 'QUEUE_BACKEND must be bullmq' }
    : await capture(async () => {
      await checkBullMq();
      return 'connected';
    });

  const storageIssues = objectStorageConfigurationIssues();
  report.cos = objectStorageDriver() !== 'cos' || !objectStorageEnabled() || storageIssues.length
    ? { ready: false, detail: storageIssues.length ? storageIssues.join(',') : 'OBJECT_STORAGE_DRIVER must be cos' }
    : await capture(async () => {
      await objectStorageList({ limit: 1 });
      return 'connected; read-only list succeeded';
    });

  report.pocketBaseSource = await capture(async () => {
    const health = await fetch(`${getPbUrl()}/api/health`, { signal: AbortSignal.timeout(5_000) });
    if (!health.ok) throw new Error(`health_${health.status}`);
    const token = await getPbAdminToken();
    if (!token) throw new Error('admin_auth_failed');
    const collections = await fetch(`${getPbUrl()}/api/collections?page=1&perPage=1`, {
      headers: { Authorization: token },
      signal: AbortSignal.timeout(10_000),
    });
    if (!collections.ok) throw new Error(`collection_read_${collections.status}`);
    return 'connected; admin collection read succeeded';
  });

  const checks = Object.values(report).filter((value): value is Check => Boolean(value && typeof value === 'object' && 'ready' in value));
  const ready = checks.every(check => check.ready);
  console.log(JSON.stringify({ ready, destructive: false, checks: report }, null, 2));
  if (!ready) process.exitCode = 2;
}

main()
  .catch(error => {
    console.error(JSON.stringify({ ready: false, destructive: false, error: message(error) }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([closePostgresPool(), closeBullMq()]);
  });
