import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

type Definition = { name: string; fields: Array<{ name: string }>; indexes: string[] };
let forward: ((app: FakeApp) => unknown) | undefined;
let backward: ((app: FakeApp) => unknown) | undefined;
class Collection { constructor(public definition: Definition) { Object.assign(this, definition); } name = ''; fields: Array<{ name: string }> = []; indexes: string[] = []; }
class FakeApp {
  collections = new Map<string, Collection>();
  rows = new Map<string, unknown[]>();
  save(collection: Collection) { this.collections.set(collection.name, collection); return collection; }
  delete(collection: Collection) { this.collections.delete(collection.name); return true; }
  findCollectionByNameOrId(name: string) { const value = this.collections.get(name); if (!value) throw Error(`missing:${name}`); return value; }
}

const source = fs.readFileSync('pb_migrations/1790985600_create_social_operating_evidence.js', 'utf8');
vm.runInNewContext(source, { Collection, migrate: (up: typeof forward, down: typeof backward) => { forward = up; backward = down; } });
assert.ok(forward && backward, 'migration must register executable forward and rollback callbacks');
const expected = ['social_business_content_goals', 'social_operating_decisions', 'social_candidate_evidence', 'social_reference_selections', 'social_discovery_gap_tasks'];

const fresh = new FakeApp();
forward!(fresh);
assert.deepEqual([...fresh.collections.keys()], expected, 'fresh migration creates every T1/T4 collection');
for (const name of expected) {
  const collection = fresh.collections.get(name)!;
  assert.ok(collection.fields.some(field => field.name === 'tenant_id'), `${name} must be tenant scoped`);
  assert.equal((collection as any).updateRule === null, name === 'social_discovery_gap_tasks', `${name} mutability must match its state model`);
}
assert.ok(fresh.collections.get('social_candidate_evidence')!.indexes.some(value => value.includes('(tenant_id, candidateId, version)')));

const upgrade = new FakeApp();
upgrade.collections.set('social_weekly_operating_packages', new Collection({ name: 'social_weekly_operating_packages', fields: [{ name: 'sentinel' }], indexes: [] }));
upgrade.rows.set('social_weekly_operating_packages', [{ id: 'historic-weekly-package' }]);
forward!(upgrade);
assert.deepEqual(upgrade.rows.get('social_weekly_operating_packages'), [{ id: 'historic-weekly-package' }], 'upgrade does not rewrite historical rows');
assert.ok(upgrade.collections.get('social_weekly_operating_packages')?.fields.some(field => field.name === 'sentinel'), 'upgrade does not replace an existing schema');
backward!(upgrade);
assert.ok(upgrade.collections.has('social_weekly_operating_packages'), 'rollback leaves pre-existing collections intact');
assert.deepEqual(expected.filter(name => upgrade.collections.has(name)), [], 'rollback removes only the new collections');

console.log('Gap-V1 operating migration fresh/upgrade executable preflight passed');
