import '../server/loadEnvironment.js';
import { closePostgresPool, ensurePostgresSchema, postgresPool } from '../server/storage/postgres.js';

async function main(): Promise<void> {
  await ensurePostgresSchema();
  const result = await postgresPool().query<{ version: string }>('SELECT current_setting(\'server_version\') AS version');
  console.log(JSON.stringify({ ok: true, schema: 'lingshu_records', postgresVersion: result.rows[0]?.version || 'unknown' }));
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePostgresPool().catch(() => undefined));
