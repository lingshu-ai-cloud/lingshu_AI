import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ensureDeliveryCollections } from '../storage/ensureDeliveryCollections.js';
import { AD_SCHEMA_REQUIREMENTS, inspectAdCollectionSchema } from './schemaReadiness.js';

type FieldDefinition = {
  id?: string;
  name: string;
  type: string;
  system?: boolean;
  required?: boolean;
  values?: string[];
  onCreate?: boolean;
  onUpdate?: boolean;
};

type CollectionDefinition = {
  name: string;
  type?: string;
  system?: boolean;
  fields?: FieldDefinition[];
  indexes?: string[];
};

class FakeField implements FieldDefinition {
  id?: string;
  name: string;
  type: string;
  system?: boolean;
  required?: boolean;
  values?: string[];
  onCreate?: boolean;
  onUpdate?: boolean;

  constructor(definition: FieldDefinition) {
    Object.assign(this, definition);
    this.name = definition.name;
    this.type = definition.type;
  }
}

class FakeFields {
  readonly items: FakeField[];

  constructor(fields: FieldDefinition[]) {
    this.items = fields.map(field => new FakeField(field));
  }

  get length(): number {
    return this.items.length;
  }

  getByName(name: string): FakeField {
    const field = this.items.find(item => item.name === name);
    if (!field) throw new Error(`field not found: ${name}`);
    return field;
  }

  addAt(index: number, field: FakeField): void {
    const sameId = field.id ? this.items.findIndex(item => item.id === field.id) : -1;
    if (sameId >= 0) this.items[sameId] = field;
    else this.items.splice(index, 0, field);
  }

  removeById(id: string): void {
    const index = this.items.findIndex(item => item.id === id);
    if (index >= 0) this.items.splice(index, 1);
  }
}

class FakeCollection {
  name: string;
  type: string;
  system: boolean;
  fields: FakeFields;
  indexes: string[];

  constructor(definition: CollectionDefinition) {
    this.name = definition.name;
    this.type = definition.type ?? 'base';
    this.system = definition.system ?? false;
    this.fields = new FakeFields(definition.fields ?? []);
    this.indexes = [...(definition.indexes ?? [])];
  }
}

class FakeApp {
  readonly collections = new Map<string, FakeCollection>();

  findCollectionByNameOrId(name: string): FakeCollection {
    const collection = this.collections.get(name);
    if (!collection) throw new Error(`collection not found: ${name}`);
    return collection;
  }

  save(collection: FakeCollection): FakeCollection {
    this.collections.set(collection.name, collection);
    return collection;
  }

  delete(collection: FakeCollection): FakeCollection {
    this.collections.delete(collection.name);
    return collection;
  }
}

type MigrationCallback = (app: FakeApp) => unknown;
const migrationPath = new URL('../../pb_migrations/1790035200_create_platform_ad_schema.js', import.meta.url);
const migrationSource = fs.readFileSync(migrationPath, 'utf8');
let forward: MigrationCallback | undefined;
let backward: MigrationCallback | undefined;
vm.runInNewContext(migrationSource, {
  Collection: FakeCollection,
  Field: FakeField,
  migrate: (up: MigrationCallback, down: MigrationCallback) => {
    forward = up;
    backward = down;
  },
});
assert.ok(forward, 'migration must register a forward callback');
assert.ok(backward, 'migration must register a rollback callback');

const expectedNames = Object.keys(AD_SCHEMA_REQUIREMENTS).sort();
const runtimeSchemas = new Map<string, CollectionDefinition>();
const previousFetch = globalThis.fetch;
const previousPbUrl = process.env.PB_URL;
const previousAdminEmail = process.env.PB_ADMIN_EMAIL;
const previousAdminPassword = process.env.PB_ADMIN_PASSWORD;
process.env.PB_URL = 'http://platform-ad-schema.invalid';
process.env.PB_ADMIN_EMAIL = '';
process.env.PB_ADMIN_PASSWORD = '';
globalThis.fetch = (async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  assert.equal(url.origin, 'http://platform-ad-schema.invalid', 'schema parity test must never contact a real PocketBase');
  const method = init?.method ?? 'GET';
  if (method === 'GET' && /^\/api\/collections\/[a-z0-9_]+$/.test(url.pathname)) {
    return new Response('{}', { status: 404 });
  }
  if (method === 'POST' && url.pathname === '/api/collections') {
    const body = init?.body;
    if (typeof body !== 'string') throw new Error('collection create body must be JSON text');
    const definition = JSON.parse(body) as CollectionDefinition;
    runtimeSchemas.set(definition.name, definition);
    return new Response('{}', { status: 200 });
  }
  throw new Error(`unexpected schema parity request: ${method} ${url.pathname}`);
}) as typeof fetch;

try {
  await ensureDeliveryCollections();
} finally {
  globalThis.fetch = previousFetch;
  if (previousPbUrl === undefined) delete process.env.PB_URL;
  else process.env.PB_URL = previousPbUrl;
  if (previousAdminEmail === undefined) delete process.env.PB_ADMIN_EMAIL;
  else process.env.PB_ADMIN_EMAIL = previousAdminEmail;
  if (previousAdminPassword === undefined) delete process.env.PB_ADMIN_PASSWORD;
  else process.env.PB_ADMIN_PASSWORD = previousAdminPassword;
}

assert.deepEqual(
  [...runtimeSchemas.keys()].filter(name => name.startsWith('platform_ad_')).sort(),
  expectedNames,
  'runtime schema writer and read-only readiness preflight must cover the same advertising collections',
);

function normalizedFields(fields: FieldDefinition[]): Array<Record<string, unknown>> {
  return Array.from(fields)
    .filter(field => field.name !== 'id' && !field.system)
    .map(field => ({
      name: field.name,
      type: field.type,
      required: Boolean(field.required),
      ...(field.type === 'select' ? { values: [...(field.values ?? [])] } : {}),
      ...(field.type === 'autodate' ? { onCreate: Boolean(field.onCreate), onUpdate: Boolean(field.onUpdate) } : {}),
    }))
    .sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

function assertSchemaParity(app: FakeApp): void {
  assert.deepEqual([...app.collections.keys()].sort(), expectedNames);
  for (const name of expectedNames) {
    const runtime = runtimeSchemas.get(name);
    assert.ok(runtime, `runtime schema must define ${name}`);
    const migrated = app.findCollectionByNameOrId(name);
    assert.deepEqual(normalizedFields(migrated.fields.items), normalizedFields(runtime.fields ?? []), `${name} migration fields must match the runtime definition`);
    assert.deepEqual([...migrated.indexes].sort(), [...(runtime.indexes ?? [])].sort(), `${name} migration indexes must match the runtime definition`);
    assert.deepEqual(inspectAdCollectionSchema(name, { fields: migrated.fields.items }), [], `${name} must satisfy read-only schema readiness`);
  }
}

const fresh = new FakeApp();
forward(fresh);
assertSchemaParity(fresh);
const firstApplication = JSON.stringify([...fresh.collections].map(([name, collection]) => [name, normalizedFields(collection.fields.items)]));
forward(fresh);
assertSchemaParity(fresh);
assert.equal(JSON.stringify([...fresh.collections].map(([name, collection]) => [name, normalizedFields(collection.fields.items)])), firstApplication, 'forward migration must be idempotent');
backward(fresh);
assert.equal(fresh.collections.size, 0, 'rollback must remove every collection created by the migration');

const adopted = new FakeApp();
adopted.save(new FakeCollection({
  name: 'platform_ad_connections',
  fields: [
    { id: 'id', name: 'id', type: 'text', system: true, required: true },
    { id: 'legacy_tenant', name: 'tenant_id', type: 'text', required: false },
  ],
}));
forward(adopted);
assertSchemaParity(adopted);
assert.equal(adopted.findCollectionByNameOrId('platform_ad_connections').fields.getByName('tenant_id').required, true, 'adopted runtime collections must normalize required fields');

const uniqueMigrationPath = new URL('../../pb_migrations/1790208001_unique_platform_ad_execution_requests.js', import.meta.url);
const uniqueMigrationSource = fs.readFileSync(uniqueMigrationPath, 'utf8');
let uniqueForward: MigrationCallback | undefined;
let uniqueBackward: MigrationCallback | undefined;
vm.runInNewContext(uniqueMigrationSource, {
  migrate: (up: MigrationCallback, down: MigrationCallback) => {
    uniqueForward = up;
    uniqueBackward = down;
  },
});
assert.ok(uniqueForward && uniqueBackward, 'execution-idempotency migration must register both callbacks');
const indexed = new FakeApp();
forward(indexed);
uniqueForward(indexed);
let executionIndexes = indexed.findCollectionByNameOrId('platform_ad_executions').indexes;
assert.equal(executionIndexes.filter(index => index.includes('idx_platform_ad_execution_request')).length, 1);
assert.match(executionIndexes[0] || '', /tenant_id, taskId, requestId/);
uniqueForward(indexed);
executionIndexes = indexed.findCollectionByNameOrId('platform_ad_executions').indexes;
assert.equal(executionIndexes.filter(index => index.includes('idx_platform_ad_execution_request')).length, 1, 'follow-up migration is idempotent');
uniqueBackward(indexed);
assert.equal(indexed.findCollectionByNameOrId('platform_ad_executions').indexes.some(index => index.includes('idx_platform_ad_execution_request')), false);

console.log('Platform advertising migration fresh/adoption/rollback parity tests passed (in-memory only; no PocketBase connection)');
