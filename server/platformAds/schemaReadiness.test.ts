import assert from 'node:assert/strict';
import { AD_SCHEMA_REQUIREMENTS, auditAdSchema, inspectAdCollectionSchema } from './schemaReadiness.js';
const modern = (name: string) => ({ fields: AD_SCHEMA_REQUIREMENTS[name].map(field => ({ ...field })) });
for (const name of Object.keys(AD_SCHEMA_REQUIREMENTS)) {
  assert.deepEqual(inspectAdCollectionSchema(name, modern(name)), []);
  const legacy = { schema: AD_SCHEMA_REQUIREMENTS[name].map(({ values, ...field }) => ({ ...field, options: { values } })) };
  assert.deepEqual(inspectAdCollectionSchema(name, legacy), []);
}
const launch = modern('platform_ad_launches');
launch.fields = launch.fields.filter(field => field.name !== 'launchMode');
assert.deepEqual(inspectAdCollectionSchema('platform_ad_launches', launch), [{ collection: 'platform_ad_launches', code: 'missing_field', field: 'launchMode' }]);
const legacyLaunch = { schema: AD_SCHEMA_REQUIREMENTS.platform_ad_launches.map(field => field.name === 'launchMode' ? { ...field, values: ['create_and_activate'] } : field) };
assert.deepEqual(inspectAdCollectionSchema('platform_ad_launches', legacyLaunch)[0].missingValues, ['create_paused']);
assert.equal(inspectAdCollectionSchema('platform_ad_launches', { fields: [{ name: 'launchMode', type: 'text' }] }).find(issue => issue.field === 'launchMode')?.code, 'field_type_mismatch');
assert.equal(inspectAdCollectionSchema('platform_ad_tasks', null)[0].code, 'missing_collection');
assert.equal(inspectAdCollectionSchema('platform_ad_tasks', { secret: 'do-not-echo' })[0].code, 'schema_unreadable');
let calls = 0;
const good = await auditAdSchema(async (pathname, init) => {
  calls++;
  assert.equal(init.method, 'GET');
  assert.match(pathname, /^\/api\/collections\/platform_ad_[a-z_]+$/);
  return new Response(JSON.stringify(modern(pathname.split('/').at(-1)!)));
});
assert.equal(good.ready, true);
assert.equal(good.mutated, false);
assert.equal(calls, Object.keys(AD_SCHEMA_REQUIREMENTS).length);
const bad = await auditAdSchema(async pathname => {
  if (pathname.endsWith('platform_ad_launches')) return new Response('{}', { status: 404 });
  if (pathname.endsWith('platform_ad_tasks')) return new Response('secret-value', { status: 403 });
  throw new Error('credential=do-not-echo');
});
assert.equal(bad.ready, false);
assert.equal(bad.issues.length, Object.keys(AD_SCHEMA_REQUIREMENTS).length);
assert.ok(!JSON.stringify(bad).includes('secret-value'));
assert.ok(!JSON.stringify(bad).includes('do-not-echo'));
assert.equal(bad.issues.find(issue => issue.collection === 'platform_ad_launches')?.code, 'missing_collection');
console.log('Read-only advertising schema readiness tests passed (no network or migrations)');
