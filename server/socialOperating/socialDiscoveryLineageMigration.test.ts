import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class Field { constructor(value: Record<string, unknown>) { Object.assign(this, value); } name = ''; }
class Fields extends Array<Field> {
  add(field: Field) { this.push(field); }
  removeByName(name: string) { const index = this.findIndex(field => field.name === name); if (index >= 0) this.splice(index, 1); }
}
class Collection {
  constructor(public name: string, fieldNames: string[], public indexes: string[] = []) { this.fields = new Fields(...fieldNames.map(name => new Field({ name }))); }
  fields: Fields;
}
class FakeApp {
  collections = new Map<string, Collection>([
    ['social_discovery_runs', new Collection('social_discovery_runs', ['id', 'tenant_id'])],
    ['social_discovery_gap_tasks', new Collection('social_discovery_gap_tasks', ['id', 'tenant_id', 'productionGap', 'budgetLimitCny', 'spentCny'])],
    ['starter_social_content_rework_queue', new Collection('starter_social_content_rework_queue', ['id', 'tenant_id', 'weekly_task_id'])],
  ]);
  save(collection: Collection) { this.collections.set(collection.name, collection); return collection; }
  findCollectionByNameOrId(name: string) { const value = this.collections.get(name); if (!value) throw new Error(`missing:${name}`); return value; }
}

let up: ((app: FakeApp) => unknown) | undefined;
let down: ((app: FakeApp) => unknown) | undefined;
const source = fs.readFileSync('pb_migrations/1791072003_harden_social_discovery_lineage.js', 'utf8');
vm.runInNewContext(source, { Field, migrate: (forward: typeof up, backward: typeof down) => { up = forward; down = backward; } });
assert.ok(up && down);
const app = new FakeApp();
up!(app);
assert.ok(app.collections.get('social_discovery_runs')?.fields.some(field => field.name === 'evidenceOutcomes'));
assert.ok(app.collections.get('social_discovery_gap_tasks')?.fields.some(field => field.name === 'taskGap'));
assert.ok(app.collections.get('social_discovery_gap_tasks')?.fields.some(field => field.name === 'referenceSelectionRef'));
assert.ok(app.collections.get('starter_social_content_rework_queue')?.fields.some(field => field.name === 'lineage_id'));
assert.ok(app.collections.get('starter_social_content_rework_queue')?.indexes.some(value => value.includes('production_result_id')));
down!(app);
assert.equal(app.collections.get('social_discovery_runs')?.fields.some(field => field.name === 'evidenceOutcomes'), false);
assert.equal(app.collections.get('social_discovery_gap_tasks')?.fields.some(field => field.name === 'taskGap'), false);
assert.equal(app.collections.get('starter_social_content_rework_queue')?.fields.some(field => field.name === 'lineage_id'), false);

console.log('R4 social discovery lineage migration preflight passed');
