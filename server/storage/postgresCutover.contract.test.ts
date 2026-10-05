import assert from 'node:assert/strict';
import fs from 'node:fs';

function source(relative: string): string {
  return fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
}

const repository = source('../starter198/repository.ts');
const provisioning = source('../starter198/provisioningCompatibility.ts');
const sourceOptions = source('../starter198/socialContentSourceOptions.ts');
const observability = source('../runtime/socialOperatingObservability.ts');
const readiness = source('../runtime/readiness.ts');

for (const [name, value] of [
  ['starter repository', repository],
  ['provisioning compatibility', provisioning],
  ['content source options', sourceOptions],
] as const) {
  assert.match(
    value,
    /dataBackend === 'pocketbase'/,
    `${name} must use strict PocketBase reads only while PocketBase is the selected business backend`,
  );
}

assert.match(observability, /return store\.list<T>\(collection/);
assert.match(observability, /dataBackend === 'pocketbase'/);
assert.match(readiness, /backend === 'postgres'.*store\.list\('starter_198_access'/s);
assert.doesNotMatch(
  readiness,
  /if \(backend === 'postgres'\)[^;]+pbListStrict\('starter_198_access'/s,
  'PostgreSQL readiness must not validate migrated business collections through PocketBase',
);

console.log('PostgreSQL cutover routing contract passed');
