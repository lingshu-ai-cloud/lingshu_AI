import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pocketbase = process.env.DECISION_MIGRATION_TEST_POCKETBASE || '/Users/julia1/.local/share/lingshu/pocketbase/pocketbase';
const sqlite = process.env.DECISION_MIGRATION_TEST_SQLITE || '/usr/bin/sqlite3';
const migrationName = '1791586800_create_assistant_decision_memories.js';
const migrationPath = join(dirname(fileURLToPath(import.meta.url)), '../../pb_migrations', migrationName);

test('real PocketBase decision migration: isolated forward, repeat, uniqueness, rollback and replay', {
  skip: !existsSync(pocketbase) || !existsSync(sqlite) ? 'Set DECISION_MIGRATION_TEST_POCKETBASE and DECISION_MIGRATION_TEST_SQLITE to run real database smoke test' : false,
}, () => {
  // Every database operation, including destructive rollback, targets this disposable directory.
  const scratch = mkdtempSync(join(tmpdir(), 'lingshu-decision-migration-'));
  const dataDir = join(scratch,'pb_data');
  const migrationsDir = join(scratch,'pb_migrations');
  const hooksDir = join(scratch,'pb_hooks');
  mkdirSync(migrationsDir); mkdirSync(hooksDir);
  copyFileSync(migrationPath,join(migrationsDir,migrationName));
  const database = join(dataDir,'data.db');
  const migrate = (...args: string[]) => execFileSync(pocketbase,['migrate',...args,'--dir',dataDir,'--migrationsDir',migrationsDir,'--hooksDir',hooksDir,'--automigrate=false'], { input:'y\n', encoding:'utf8', timeout:20000, cwd:scratch, stdio:['pipe','pipe','pipe'] });
  const query = (sql:string) => execFileSync(sqlite,[database,sql], { encoding:'utf8', timeout:5000, stdio:['pipe','pipe','pipe'] }).trim();
  const verifySchema = () => {
    const raw = query("SELECT json_object('fields',json(fields),'indexes',json(indexes),'listRule',listRule,'viewRule',viewRule,'createRule',createRule,'updateRule',updateRule,'deleteRule',deleteRule) FROM _collections WHERE name='assistant_decision_memories';");
    const collection = JSON.parse(raw) as {fields: Array<Record<string,unknown>>; indexes:string[]; [key:string]:unknown};
    const names=collection.fields.map(field=>field.name);
    for(const name of ['id','tenant_id','user_id','memory_id','version','content','status','source_message_id','confirmed_at','created_at','expires_at','schema_version']) assert.ok(names.includes(name),name);
    assert.equal(collection.fields.find(field=>field.name==='content')?.max,2000);
    assert.equal(collection.fields.find(field=>field.name==='version')?.onlyInt,true);
    for(const name of ['listRule','viewRule','createRule','updateRule','deleteRule']) assert.equal(collection[name],null,`${name} must remain server-only`);
    assert.equal(query("SELECT count(*) FROM sqlite_master WHERE type='index' AND name IN ('idx_assistant_decision_revision','idx_assistant_decision_recent');"),'2');
    assert.match(collection.indexes.join('\n'),/UNIQUE INDEX idx_assistant_decision_revision/);
    assert.equal(query(`SELECT count(*) FROM _migrations WHERE file='${migrationName}';`),'1');
  };
  try {
    migrate('up'); verifySchema();
    migrate('up'); verifySchema();
    query("INSERT INTO assistant_decision_memories (id,tenant_id,user_id,memory_id,version,content,status,source_message_id,confirmed_at,created_at,expires_at,schema_version) VALUES ('111111111111111','tenant-a','user-a','memory-a',1,'Confirmed preference','confirmed','user-message-1','2026-10-10T00:00:00Z','2026-10-10T00:00:00Z','','assistant-decision-v1');");
    assert.throws(()=>query("INSERT INTO assistant_decision_memories (id,tenant_id,user_id,memory_id,version,content,status,source_message_id,confirmed_at,created_at,expires_at,schema_version) SELECT '222222222222222',tenant_id,user_id,memory_id,version,content,status,source_message_id,confirmed_at,created_at,expires_at,schema_version FROM assistant_decision_memories WHERE id='111111111111111';"),/UNIQUE constraint failed/);
    assert.equal(query('SELECT count(*) FROM assistant_decision_memories;'),'1');
    migrate('up'); assert.equal(query('SELECT count(*) FROM assistant_decision_memories;'),'1');
    migrate('down','1');
    assert.equal(query("SELECT count(*) FROM _collections WHERE name='assistant_decision_memories';"),'0');
    assert.equal(query("SELECT count(*) FROM sqlite_master WHERE name='assistant_decision_memories';"),'0');
    migrate('up'); verifySchema();
    assert.equal(query('SELECT count(*) FROM assistant_decision_memories;'),'0');
  } finally { rmSync(scratch,{recursive:true,force:true}); }
});
