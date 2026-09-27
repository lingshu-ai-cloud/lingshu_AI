import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

type Definition = { name: string; fields: Array<{ name: string }>; indexes: string[] };
let forward: ((app: FakeApp) => unknown) | undefined;
let backward: ((app: FakeApp) => unknown) | undefined;
class Collection {
  name = '';
  fields: Array<{ name: string }> = [];
  indexes: string[] = [];
  constructor(definition: Definition) { Object.assign(this, definition); }
}
class FakeApp {
  collections = new Map<string, Collection>();
  save(collection: Collection) { this.collections.set(collection.name, collection); return collection; }
  delete(collection: Collection) { this.collections.delete(collection.name); return true; }
  findCollectionByNameOrId(name: string) { const collection = this.collections.get(name); if (!collection) throw new Error(`missing:${name}`); return collection; }
}

const source = fs.readFileSync('pb_migrations/1791072001_create_social_operating_orchestration.js', 'utf8');
vm.runInNewContext(source, { Collection, migrate: (up: typeof forward, down: typeof backward) => { forward = up; backward = down; } });
assert.ok(forward && backward);
const app = new FakeApp();
forward!(app);
assert.deepEqual([...app.collections.keys()], ['social_operating_constraints', 'social_operating_authority_snapshots']);
for (const name of app.collections.keys()) {
  const collection = app.collections.get(name)!;
  assert.ok(collection.fields.some(field => field.name === 'tenant_id'));
  assert.ok(collection.fields.some(field => field.name === 'program_id'));
  assert.ok(collection.indexes.some(index => index.includes('(tenant_id, program_id')));
}
backward!(app);
assert.equal(app.collections.size, 0);
console.log('social operating orchestration migration preflight passed');
