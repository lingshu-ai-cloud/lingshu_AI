import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { sealAccountCredential } from '../lib/accountCredentials.js';
import { createTikTokWeeklyPublishingAdapter } from './tiktokWeeklyPublishingAdapter.js';

type Row = { id: string; [key: string]: any };
function memoryStore(): DataStore & { rows: Map<string, Row[]> } {
  const rows = new Map<string, Row[]>();
  return {
    rows,
    async list<T>(collection: string, query: ListQuery = {}) {
      let items = [...(rows.get(collection) || [])];
      for (const [key, value] of Object.entries(query.where || {})) items = items.filter(item => item[key] === value);
      if (query.sort) { const desc = query.sort.startsWith('-'), key = desc ? query.sort.slice(1) : query.sort; items.sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || '')) * (desc ? -1 : 1)); }
      const page = query.page ?? 1, perPage = query.perPage ?? 500;
      return { items: items.slice((page - 1) * perPage, page * perPage) as T[], totalItems: items.length, totalPages: Math.ceil(items.length / perPage), page, perPage };
    },
    async getById<T>(collection: string, id: string) { return (rows.get(collection) || []).find(row => row.id === id) as T || null; },
    async create<T>() { return null as T | null; }, async update() { return false; }, async delete() { return false; },
  };
}

process.env.PLATFORM_TOKEN_ENCRYPTION_KEY = 'weekly-adapter-test-key';
const dataStore = memoryStore();
const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-tiktok-source-'));
const videoPath = path.join(mediaDir, 'video.mp4');
fs.writeFileSync(videoPath, Buffer.from('approved-video-fixture'));
const videoHash = createHash('sha256').update(fs.readFileSync(videoPath)).digest('hex');
dataStore.rows.set('social_accounts', [{ id: 'account-1', tenantId: 'tenant-a', platform: 'tiktok', status: 'connected', accessToken: sealAccountCredential('token') }]);
const evidence = (capability: string) => ({ id: capability, tenant_id: 'tenant-a', account_id: 'account-1', platform: 'tiktok', capability, status: 'verified', evidence_source: 'provider_probe', evidence_ref: `probe-${capability}`, verified_at: '2026-09-25T00:00:00Z', created_at: '2026-09-25T00:00:00Z', updated_at: '2026-09-25T00:00:00Z' });
dataStore.rows.set('social_platform_capability_evidence', [evidence('publishing.official'), evidence('publishing.receipt_lookup')]);
dataStore.rows.set('starter_social_content_artifacts', [{
  id: 'artifact-row', tenant_id: 'tenant-a', artifact_id: 'artifact-1', version: 'v1', status: 'approved',
  task_id: 'task-1', resource_ref: 'socialfile:socialfile_aaaaaaaaaaaaaaaaaaaaaaaa', content_hash: videoHash, content: {
    productionResult: { productionResultId: 'production-1', version: 'v1', status: 'asset_review', technicalReview: { approved: true }, creativeReview: { approved: true } },
    mediaStorage: { video: { url: videoPath, fileId: 'socialfile_aaaaaaaaaaaaaaaaaaaaaaaa', fileRef: 'socialfile:socialfile_aaaaaaaaaaaaaaaaaaaaaaaa', sha256: videoHash } },
  },
}]);
let publishes = 0, reconciles = 0;
const adapter = await createTikTokWeeklyPublishingAdapter({ tenantId: 'tenant-a', accountId: 'account-1', dataStore, now: new Date('2026-09-26T00:00:00Z'), ports: {
  async publish(input) { publishes += 1; assert.equal(input.videoPath, videoPath); assert.equal(input.sourceClaim?.sourceKind, 'social_production_artifact'); return { video: {}, tracking: {} as any, publishRecord: null, platformPostId: '', deliveryStatus: 'provider_accepted', providerReceiptId: 'receipt-1' }; },
  async reconcile() { reconciles += 1; return { status: 'published', providerReceiptId: 'receipt-1', platformPostId: 'post-1', platformUrl: 'https://tiktok.example/post-1', providerStatus: 'PUBLISH_COMPLETE', error: '' }; },
} });
assert.equal(adapter.capability, 'available');
const assignment = { tenantId: 'tenant-a', accountId: 'account-1', publicationTaskId: 'task-1', lineage: { productionResultRef: { id: 'production-1' } } } as any;
const publicationPackage = { contentId: 'artifact-1:task-1', contentVersion: 'v1', contentHash: videoHash, operatingLineage: { productionResultRef: { id: 'production-1' } }, copy: { title: 'Title', body: 'Body', hashtags: [] }, assets: [{ kind: 'video', downloadUrl: `file://${videoPath}`, contentHash: videoHash }] } as any;
assert.deepEqual(await adapter.publish({ assignment, publicationPackage, attemptId: 'attempt-1' }), { status: 'accepted', providerReceiptId: 'receipt-1' });
const reconciled = await adapter.reconcile({ assignment, publicationPackage, attempt: { provider_receipt_id: 'receipt-1' } as any });
assert.equal(reconciled.status, 'published');
assert.equal(reconciled.platformPostId, 'post-1');
assert.equal(publishes, 1); assert.equal(reconciles, 1);

const artifact = dataStore.rows.get('starter_social_content_artifacts')![0]!;
artifact.content.productionResult.technicalReview.approved = false;
await assert.rejects(
  adapter.publish({ assignment, publicationPackage, attemptId: 'attempt-after-revocation' }),
  /social_production_artifact_stale/,
  'the approved production row must be rechecked before each provider effect',
);
assert.equal(publishes, 1);
artifact.content.productionResult.technicalReview.approved = true;

dataStore.rows.set('social_platform_capability_evidence', [evidence('publishing.official')]);
const unavailable = await createTikTokWeeklyPublishingAdapter({ tenantId: 'tenant-a', accountId: 'account-1', dataStore, now: new Date('2026-09-26T00:00:00Z'), ports: { async publish() { throw new Error('must not run'); }, async reconcile() { throw new Error('must not run'); } } });
assert.equal(unavailable.capability, 'unavailable');
assert.equal(unavailable.unavailableReason, 'provider_capability_not_verified');
console.log('TikTok weekly official publishing adapter tests passed');
fs.rmSync(mediaDir, { recursive: true, force: true });
