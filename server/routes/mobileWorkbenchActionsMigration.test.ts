import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pocketbase = process.env.MOBILE_WORKBENCH_MIGRATION_TEST_POCKETBASE || '/Users/julia1/.local/share/lingshu/pocketbase/pocketbase';
const sqlite = process.env.MOBILE_WORKBENCH_MIGRATION_TEST_SQLITE || '/usr/bin/sqlite3';
const migrationName = '1791597601_mobile_workbench_action_receipts.js';
const migrationPath = join(dirname(fileURLToPath(import.meta.url)), '../../pb_migrations', migrationName);

test('real PocketBase action receipt migration is private, unique, reversible and replayable', {
  skip: !existsSync(pocketbase) || !existsSync(sqlite) ? 'PocketBase and sqlite are required for the real migration smoke test' : false,
}, () => {
  const scratch = mkdtempSync(join(tmpdir(), 'lingshu-mobile-actions-migration-'));
  const dataDir = join(scratch, 'pb_data');
  const migrationsDir = join(scratch, 'pb_migrations');
  const hooksDir = join(scratch, 'pb_hooks');
  mkdirSync(migrationsDir); mkdirSync(hooksDir);
  copyFileSync(migrationPath, join(migrationsDir, migrationName));
  const database = join(dataDir, 'data.db');
  const migrate = (...args: string[]) => execFileSync(pocketbase, ['migrate', ...args, '--dir', dataDir, '--migrationsDir', migrationsDir, '--hooksDir', hooksDir, '--automigrate=false'], { input: 'y\n', encoding: 'utf8', timeout: 20_000, cwd: scratch, stdio: ['pipe', 'pipe', 'pipe'] });
  const query = (sql: string) => execFileSync(sqlite, [database, sql], { encoding: 'utf8', timeout: 5_000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const verify = () => {
    const raw = query("SELECT json_object('fields',json(fields),'indexes',json(indexes),'listRule',listRule,'viewRule',viewRule,'createRule',createRule,'updateRule',updateRule,'deleteRule',deleteRule) FROM _collections WHERE name='mobile_workbench_action_receipts';");
    const collection = JSON.parse(raw) as { fields: Array<Record<string, unknown>>; indexes: string[]; [key: string]: unknown };
    for (const name of ['id', 'tenant_id', 'user_id', 'kind', 'target_id', 'expected_version', 'idempotency_key', 'request_hash', 'payload', 'status', 'accepted_at', 'started_at', 'finished_at', 'result', 'error']) assert.ok(collection.fields.some(field => field.name === name), name);
    for (const name of ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule']) assert.equal(collection[name], null, `${name} must remain server-only`);
    assert.match(collection.indexes.join('\n'), /UNIQUE INDEX idx_mobile_action_idempotency/);
    assert.equal(query(`SELECT count(*) FROM _migrations WHERE file='${migrationName}';`), '1');
  };
  const insert = (id: string, key: string) => query(`INSERT INTO mobile_workbench_action_receipts (id,tenant_id,user_id,kind,target_id,expected_version,idempotency_key,request_hash,payload,status,accepted_at) VALUES ('${id}','tenant-a','user-a','retry_task','task-a','1','${key}','${'a'.repeat(64)}','{}','accepted','2026-10-10T00:00:00Z');`);
  try {
    migrate('up'); verify(); migrate('up'); verify();
    insert('111111111111111111111111', 'retry-0001');
    assert.throws(() => insert('222222222222222222222222', 'retry-0001'), /UNIQUE constraint failed/);
    migrate('down', '1');
    assert.equal(query("SELECT count(*) FROM _collections WHERE name='mobile_workbench_action_receipts';"), '0');
    migrate('up'); verify();
    assert.equal(query('SELECT count(*) FROM mobile_workbench_action_receipts;'), '0');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
