import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
test('deadline assessment migration preserves scoped history and restricts direct client writes', () => {
  const name = '1791072033_create_weekly_deadline_assessments.js';
  const source = readFileSync(`pb_migrations/${name}`, 'utf8');
  let up: any, down: any, collection: any;
  vm.runInNewContext(source, { Collection: class { constructor(value: any) { Object.assign(this, value); } }, migrate: (a: any, b: any) => { up = a; down = b; } });
  up({ save: (value: any) => { collection = value; } });
  assert.equal(collection.name, 'social_weekly_deadline_assessments');
  for (const rule of ['listRule','viewRule','createRule','updateRule','deleteRule']) assert.equal(collection[rule], null);
  for (const name of ['tenant_id','program_id','package_id','package_version','assessment_id','evidence_hash','content_hash','payload']) assert.equal(collection.fields.find((field: any) => field.name === name)?.required, true);
  assert.match(collection.indexes[0], /UNIQUE.*\(tenant_id,evidence_hash\)/);
  let removed = ''; down({ findCollectionByNameOrId: (name: string) => name, delete: (name: string) => { removed = name; } });
  assert.equal(removed, collection.name);
  assert.equal(JSON.parse(readFileSync('scripts/pb-migration-checksums.json','utf8')).migrations[name], createHash('sha256').update(source).digest('hex'));
});
