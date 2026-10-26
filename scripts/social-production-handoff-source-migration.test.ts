import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const migrationName = '1792944000_allow_original_social_production_handoffs.js';
const migrationPath = `pb_migrations/${migrationName}`;

const loadMigration = () => {
  const source = readFileSync(migrationPath, 'utf8');
  let up: ((app: unknown) => unknown) | undefined;
  let down: ((app: unknown) => unknown) | undefined;
  vm.runInNewContext(source, {
    migrate: (forward: typeof up, rollback: typeof down) => {
      up = forward;
      down = rollback;
    },
  });
  assert.ok(up);
  assert.ok(down);
  return { source, up, down };
};

const createApp = () => {
  const fields = new Map([
    ['source_analysis_id', { name: 'source_analysis_id', required: true }],
    ['source_analysis_version', { name: 'source_analysis_version', required: true }],
    ['task_id', { name: 'task_id', required: true }],
  ]);
  const collection = {
    name: 'starter_social_production_handoffs',
    fields: {
      getByName(name: string) {
        const field = fields.get(name);
        if (!field) throw new Error(`unknown field: ${name}`);
        return field;
      },
    },
  };
  const calls: string[] = [];
  return {
    fields,
    calls,
    app: {
      findCollectionByNameOrId(name: string) {
        calls.push(`find:${name}`);
        assert.equal(name, collection.name);
        return collection;
      },
      save(value: unknown) {
        calls.push('save');
        assert.equal(value, collection);
        return value;
      },
    },
  };
};

test('original production handoff migration makes only source-analysis projections optional and rolls them back', () => {
  const { up, down } = loadMigration();
  const fixture = createApp();

  up(fixture.app);
  assert.equal(fixture.fields.get('source_analysis_id')?.required, false);
  assert.equal(fixture.fields.get('source_analysis_version')?.required, false);
  assert.equal(fixture.fields.get('task_id')?.required, true);

  down(fixture.app);
  assert.equal(fixture.fields.get('source_analysis_id')?.required, true);
  assert.equal(fixture.fields.get('source_analysis_version')?.required, true);
  assert.equal(fixture.fields.get('task_id')?.required, true);
  assert.deepEqual(fixture.calls, [
    'find:starter_social_production_handoffs',
    'save',
    'find:starter_social_production_handoffs',
    'save',
  ]);
});

test('original production handoff migration is registered by immutable checksum', () => {
  const { source } = loadMigration();
  const manifest = JSON.parse(readFileSync('scripts/pb-migration-checksums.json', 'utf8')) as {
    migrations: Record<string, string>;
  };
  assert.equal(
    manifest.migrations[migrationName],
    createHash('sha256').update(source).digest('hex'),
  );
});
