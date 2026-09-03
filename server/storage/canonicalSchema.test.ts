import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANONICAL_AUTH_COLLECTIONS,
  CANONICAL_COLLECTIONS,
  canonicalSchemaFingerprint,
  mergeCanonicalCollections,
} from './canonicalSchema.js';
import { publishQueueProjection as runtimePublishQueueProjection } from '../publishing/publishQueueProjection.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migration = [
  '1788307200_create_digital_employee_mvp.js',
  '1788307201_sync_production_indexes.js',
  '1788307202_harden_crawl_jobs.js',
  '1788307203_harden_tenant_product_api_keys.js',
  '1788307204_harden_auth_tenant_roles.js',
  '1788307205_encrypt_platform_credentials.js',
  '1788307206_harden_assist_links.js',
  '1788307207_harden_publish_content_fences.js',
  '1788307208_harden_whatsapp_webhook_receipts.js',
  '1788307209_harden_oauth_sessions_outbound_operations.js',
  '1788307210_harden_publish_queue_projection.js',
  '1788307211_harden_scheduled_tasks.js',
].map(name => fs.readFileSync(path.join(root, 'pb_migrations', name), 'utf8')).join('\n');
const publishQueueMigration = fs.readFileSync(
  path.join(root, 'pb_migrations/1788307210_harden_publish_queue_projection.js'),
  'utf8',
);
const publishQueueProjection = fs.readFileSync(path.join(root, 'server/publishing/publishQueueProjection.ts'), 'utf8');
const setup = fs.readFileSync(path.join(root, 'scripts/setup-pb.ts'), 'utf8');
const pocketBaseDockerfile = fs.readFileSync(path.join(root, 'Dockerfile.pocketbase'), 'utf8');
const appDockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const dockerIgnore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');
const pocketBaseEntrypoint = fs.readFileSync(path.join(root, 'scripts/pocketbase-entrypoint.sh'), 'utf8');
const atomicSmoke = fs.readFileSync(path.join(root, 'scripts/smoke-pocketbase-atomic.sh'), 'utf8');
const upgradeSmoke = fs.readFileSync(path.join(root, 'scripts/smoke-pocketbase-upgrade.sh'), 'utf8');
const deliveryBootstrap = fs.readFileSync(path.join(root, 'server/storage/ensureDeliveryCollections.ts'), 'utf8');
const scheduler = fs.readFileSync(path.join(root, 'server/routes/scheduler.ts'), 'utf8');

assert.match(
  migration,
  new RegExp(`canonical-schema-fingerprint:\\s*${canonicalSchemaFingerprint()}`),
  'migration fingerprint must match the canonical schema',
);

for (const collection of [...CANONICAL_COLLECTIONS, ...CANONICAL_AUTH_COLLECTIONS]) {
  assert.equal(new Set(collection.fields.map(field => field.name)).size, collection.fields.length,
    `${collection.name} canonical fields must not contain duplicates`);
  assert.ok(migration.includes(`name: "${collection.name}"`) || migration.includes(`augmentCollection("${collection.name}"`),
    `migration must define or augment ${collection.name}`);
  for (const index of collection.indexes) {
    assert.ok(migration.includes(index), `${collection.name} migration is missing index: ${index}`);
  }
  for (const wanted of collection.fields) {
    assert.ok(
      migration.includes(`${wanted.type}("${wanted.name}"`),
      `${collection.name} migration is missing ${wanted.type} field ${wanted.name}`,
    );
  }
}

assert.match(setup, /mergeCanonicalCollections\(mergeDeliveryCollections\(BASE_COLLECTIONS\)\)/);
assert.match(setup, /DELIVERY_COLLECTION_SPECS/,
  'setup-pb and runtime delivery bootstrap must share the same collection field definitions');
assert.match(deliveryBootstrap, /NODE_ENV === 'production'/,
  'the running production application must reject schema drift instead of mutating PocketBase');
assert.match(deliveryBootstrap, /run setup:pb before starting the application/);
assert.match(setup, /CANONICAL_INDEXES/);
assert.match(setup, /name: 'status', type: 'select', values: \['candidate', 'active', 'paused', 'archived'\]/,
  'response strategy bootstrap must preserve the historical PocketBase select field type');
for (const smoke of [atomicSmoke, upgradeSmoke]) {
  assert.match(smoke, /run setup:pb >\/dev\/null/,
    'PocketBase smoke must exercise the full application-container bootstrap before check-only validation');
}
assert.match(migration, /ensureBootstrapCollection\("lsstudio0000001", "studio_projects"/);
assert.match(migration, /ensureBootstrapCollection\("lsposts00000001", "posts"/);
assert.match(pocketBaseDockerfile, /COPY(?:\s+--chown=\S+)?\s+pb_hooks\s+\/pb\/pb_hooks/);
assert.match(appDockerfile, /COPY(?:\s+--from=\S+)?(?:\s+--chown=\S+)?\s+\/app\/desktop\s+\.\/desktop/);
assert.doesNotMatch(appDockerfile, /\/app\/data\s+\.\/data/);
assert.match(dockerIgnore, /^data\s*$/m);
assert.doesNotMatch(dockerIgnore, /^\*\.(?:png|gif)\s*$/m);
for (const asset of ['public/brand-logo.png', 'public/lingshu-mascot.png', 'public/lingshu-expressions.png']) {
  assert.ok(fs.statSync(path.join(root, asset)).isFile(), `${asset} must be included in the Docker build context`);
}
const atomicHook = fs.readFileSync(path.join(root, 'pb_hooks/atomic.pb.js'), 'utf8');
assert.equal((atomicHook.match(/bodyLimit\(2097152\)/g) || []).length, 2);
assert.match(atomicHook, /crawl_jobs:\s*true/, 'crawl job fencing must be enabled by the transactional CAS hook');
assert.match(atomicHook, /publish_content_fences:\s*true/, 'publish content uniqueness must be enabled by the transactional hooks');
assert.match(atomicHook, /webhook_message_receipts:\s*true/, 'webhook receipt fencing must be enabled by the transactional hooks');
assert.match(atomicHook, /whatsapp_customers:\s*true/, 'WhatsApp customer durability must use transactional hooks');
assert.match(atomicHook, /whatsapp_interactions:\s*true/, 'WhatsApp interaction durability must use transactional hooks');
assert.match(atomicHook, /posts:\s*true/, 'post queue projection transitions must use transactional hooks');
for (const collection of [
  'users',
  'auth_sessions',
  'oauth_transactions',
  'social_comment_states',
  'social_reply_operations',
  'whatsapp_outbound_operations',
  'whatsapp_delivery_receipts',
]) {
  assert.match(atomicHook, new RegExp(`${collection}:\\s*true`), `${collection} must use transactional hooks`);
}
assert.match(pocketBaseEntrypoint, /--hooksDir=\/pb\/pb_hooks/);
assert.match(pocketBaseEntrypoint, /--automigrate=false/);
assert.match(pocketBaseEntrypoint, /--hooksWatch=false/);
assert.match(scheduler, /if \(process\.env\.NODE_ENV === 'production'\) \{[\s\S]*await mirrorTasksToPocketBase\(tasks\);[\s\S]*writeTaskSnapshot\(tasks\);/,
  'production scheduler writes must become durable before updating the local snapshot');
assert.match(scheduler, /if \(!remote\.length && process\.env\.NODE_ENV !== 'production'\) return load\(\);/,
  'an empty production datastore must not resurrect a stale local scheduler snapshot');
assert.match(scheduler, /if \(process\.env\.NODE_ENV === 'production'\) throw error;/,
  'production scheduler hydration must fail closed when PocketBase is unavailable');

const merged = mergeCanonicalCollections([{ name: 'posts', fields: [{ name: 'track_code', type: 'text' }] }]);
const posts = merged.find(item => item.name === 'posts');
assert.ok(posts?.fields.some(item => item.name === 'publish_revision' && item.type === 'number'));
assert.ok(posts?.fields.some(item => item.name === 'publish_queue_state' && item.type === 'text'));
assert.ok(posts?.fields.some(item => item.name === 'publish_available_at' && item.type === 'text'));
assert.ok(CANONICAL_COLLECTIONS.find(item => item.name === 'posts')?.indexes.some(index =>
  index === 'CREATE INDEX idx_posts_publish_queue ON posts (publish_queue_state, publish_available_at, id)'));
assert.equal(posts?.fields.filter(item => item.name === 'track_code').length, 1);

assert.match(publishQueueMigration, /findRecordsByFilter\("posts", filter, "id", 500, 0,/,
  'legacy posts must be backfilled with bounded ID-cursor pages');
assert.doesNotMatch(publishQueueMigration, /findAllRecords\("posts"\)/,
  'the queue projection migration must not load the full posts table');
assert.match(publishQueueMigration, /unmarshalJSONField\("stats", stats\)/,
  'PocketBase JSONRaw stats must be explicitly unmarshaled before classification');
for (const state of ['pending', 'direct', 'blocked', 'terminal']) {
  assert.match(publishQueueMigration, new RegExp(`state: "${state}"`), `migration must project ${state}`);
  assert.match(publishQueueProjection, new RegExp(`'${state}'`), `runtime must define ${state}`);
}
assert.match(publishQueueMigration, /lastAttemptAt \+ 15 \* 60 \* 1000/,
  'direct and scheduled publishing recovery must use the runtime 15 minute stale-attempt boundary');
assert.match(publishQueueMigration, /Math\.max\(\.\.\.values\)/,
  'multiple valid availability signals must use their conservative maximum');
assert.match(publishQueueMigration, /if \(retryAt === null\) return \{ state: "terminal"/,
  'legacy failed rows without an explicit retry time must not enter the due queue');

const contractHash = 'a'.repeat(64);
const queueProjectionContract = [
  {
    name: 'valid scheduled',
    post: {
      published_at: '2099-01-01T00:00:00.000Z',
      stats: { status: 'scheduled', source: 'manual', schedulePayloadHash: contractHash, directPublish: false },
    },
    expected: { publish_queue_state: 'pending', publish_available_at: '2099-01-01T00:00:00.000Z' },
  },
  {
    name: 'ambiguous scheduled',
    post: { published_at: '2099-01-01T00:00:00.000Z', stats: { status: 'scheduled', source: 'manual' } },
    expected: { publish_queue_state: 'blocked', publish_available_at: '' },
  },
  {
    name: 'retryable failed',
    post: {
      published_at: '2099-01-01T00:00:00.000Z',
      stats: {
        status: 'failed', source: 'manual', schedulePayloadHash: contractHash,
        publishAttempts: 1, nextPublishAttemptAt: '2099-01-01T02:00:00.000Z',
      },
    },
    expected: { publish_queue_state: 'pending', publish_available_at: '2099-01-01T02:00:00.000Z' },
  },
  {
    name: 'failed without retry evidence',
    post: {
      published_at: '2099-01-01T00:00:00.000Z',
      stats: { status: 'failed', source: 'manual', schedulePayloadHash: contractHash, publishAttempts: 1 },
    },
    expected: { publish_queue_state: 'terminal', publish_available_at: '' },
  },
  {
    name: 'direct publishing',
    post: {
      published_at: '2099-01-01T00:00:00.000Z',
      publish_lease_expires_at: '2099-01-01T00:30:00.000Z',
      stats: { status: 'publishing', directPublish: true, lastPublishAttemptAt: '2099-01-01T00:10:00.000Z' },
    },
    expected: { publish_queue_state: 'direct', publish_available_at: '2099-01-01T00:30:00.000Z' },
  },
  {
    name: 'completed provider post',
    post: { platform_post_id: 'provider-post-upgrade', stats: { status: 'published' } },
    expected: { publish_queue_state: 'terminal', publish_available_at: '' },
  },
] as const;
for (const fixture of queueProjectionContract) {
  assert.deepEqual(runtimePublishQueueProjection(fixture.post), fixture.expected,
    `runtime projection must match the migration smoke contract: ${fixture.name}`);
}

console.log('canonical PocketBase schema, migration, setup, and hook packaging stay synchronized');
