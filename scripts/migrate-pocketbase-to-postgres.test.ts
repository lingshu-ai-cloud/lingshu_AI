import assert from 'node:assert/strict';
import {
  canonicalJson,
  collectionDigest,
  parseMigrationOptions,
  postgresUniqueIndexStatement,
  sourceRecordHash,
} from './migrate-pocketbase-to-postgres.js';

assert.equal(canonicalJson({ b: 2, a: [3, { d: 4, c: 5 }] }), '{"a":[3,{"c":5,"d":4}],"b":2}');
assert.equal(sourceRecordHash({ id: 'x', a: 1 }), sourceRecordHash({ a: 1, id: 'x' }));
assert.equal(
  collectionDigest([{ id: 'b', sourceHash: '2' }, { id: 'a', sourceHash: '1' }]),
  collectionDigest([{ id: 'a', sourceHash: '1' }, { id: 'b', sourceHash: '2' }]),
);
assert.equal(parseMigrationOptions([], {}).mode, 'plan');
assert.equal(parseMigrationOptions(['--verify'], {}).mode, 'verify');
assert.throws(() => parseMigrationOptions(['--apply'], {}), /MIGRATION_APPLY=true/);
const apply = parseMigrationOptions(['--apply', '--copy-files', '--collections=materials,users'], { MIGRATION_APPLY: 'true', MIGRATION_RUN_ID: 'run-1' });
assert.equal(apply.mode, 'apply');
assert.equal(apply.copyFiles, true);
assert.deepEqual([...apply.collections!], ['materials', 'users']);
assert.equal(apply.runId, 'run-1');
const unique = postgresUniqueIndexStatement(
  'workflow_runs',
  "CREATE UNIQUE INDEX idx_active ON workflow_runs (tenant_id) WHERE product_profile = 'starter_198' AND status = 'running'",
);
assert.match(unique || '', /CREATE UNIQUE INDEX IF NOT EXISTS/);
assert.match(unique || '', /data ->> 'tenant_id'/);
assert.match(unique || '', /data ->> 'product_profile'/);
assert.equal(postgresUniqueIndexStatement('workflow_runs', 'CREATE INDEX idx_status ON workflow_runs (status)'), null);
assert.throws(
  () => postgresUniqueIndexStatement('workflow_runs', 'CREATE UNIQUE INDEX idx_bad ON another_table (tenant_id)'),
  /collection mismatch/,
);

console.log('PocketBase to PostgreSQL migration contract passed');
