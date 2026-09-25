import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DataStore, ListQuery, Record_ } from '../storage/datastore.js';
import { createSocialDigitalPresenterAdapter } from './socialContentDigitalPresenterAdapter.js';
import { auditSocialHeyGenPresenters, createSocialHeyGenBridgePorts, socialHeyGenBridgeReadiness } from './socialContentHeyGenBridge.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'social-heygen-bridge-'));
const previousCwd = process.cwd();
process.chdir(tmp);

type Row = Record_ & Record<string, any>;
class MemoryStore implements DataStore {
  rows = new Map<string, Row[]>();
  sequence = 0;
  async getById<T = Record_>(collection: string, id: string) { return (this.rows.get(collection) || []).find(row => row.id === id) as T || null; }
  async create<T = Record_>(collection: string, data: Record<string, unknown>) {
    const bucket = this.rows.get(collection) || [];
    if (bucket.some(row => row.tenant_id === data.tenant_id && row.request_id === data.request_id)) return null;
    const row = { id: `row-${++this.sequence}`, ...structuredClone(data) } as Row; bucket.push(row); this.rows.set(collection, bucket); return row as T;
  }
  async update(collection: string, id: string, data: Record<string, unknown>) { const row = (this.rows.get(collection) || []).find(item => item.id === id); if (!row) return false; Object.assign(row, data); return true; }
  async delete() { return false; }
  async list<T = Record_>(collection: string, query: ListQuery = {}) {
    const items = (this.rows.get(collection) || []).filter(row => Object.entries(query.where || {}).every(([key, value]) => row[key] === value));
    return { items: items as T[], totalItems: items.length, page: 1, perPage: query.perPage || 20, totalPages: 1 };
  }
}

assert.deepEqual(socialHeyGenBridgeReadiness({ enabled: 'false', generationEnabled: 'true', apiKey: 'key', storageReady: true,
  budget: { allowed: true, reservationCny: 1, reason: '' } }), { ready: false, reasons: ['SOCIAL_CONTENT_HEYGEN_ENABLED'] });

assert.deepEqual(auditSocialHeyGenPresenters([
  { id: 'ready', authorized: true, toolMappings: { heygen: { avatarId: 'avatar', voiceId: 'voice' } }, authorizationRef: 'rights', consentRef: 'consent' },
  { id: 'blocked', authorized: true, avatarId: 'avatar' },
]), { total: 2, executable: 1, missingByPresenter: [{ presenterAssetId: 'blocked', requirements: ['HeyGen voiceId', 'authorizationRef', 'consentRef'] }] });

const store = new MemoryStore();
store.rows.set('studio_production_defaults', [{ id: 'defaults', tenant_id: 'tenant-a', payload: { presenters: [{
  id: 'presenter-a', authorized: true, assetVersion: 2, avatarId: 'avatar-a', voiceId: 'voice-a',
  rightsEvidence: { authorizationRef: 'rights://tenant-a/presenter-a/v1', consentRef: 'consent://tenant-a/presenter-a/v1',
    grantedAt: '2026-09-01T00:00:00Z', subjectAdultConfirmed: true, permittedProviders: ['heygen'],
    permittedUses: ['digital_presenter', 'voice_synthesis'] },
}] } }]);
let creates = 0;
let reserves = 0;
const ports = createSocialHeyGenBridgePorts({ store,
  client: {
    async create(_input, requestId) { creates += 1; assert.match(requestId, /^social-presenter:/); return 'provider-task-a'; },
    async status() { return { status: 'completed' as const, url: 'https://files.heygen.ai/output.mp4', duration: 3 }; },
  },
  budget: { status: () => ({ allowed: true, reservationCny: 1.2, remainingCny: 10, reason: '' }), async reserve() { reserves += 1; } },
  storageReady: () => true,
  download: async () => Buffer.alloc(12_000, 1),
  upload: async () => 'https://storage.test/object',
  head: async () => ({ size: 12_000, etag: 'etag-a', contentType: 'video/mp4', lastModified: new Date() }),
  pollIntervalMs: 0,
});
const adapter = createSocialDigitalPresenterAdapter(ports);
const context: any = { tenantId: 'tenant-a', taskId: 'task-a', outputDirectory: tmp,
  shot: { shotId: 'shot-a', sourceStrategy: 'authorized_digital_presenter', sourceRefs: ['presenter-a'],
    digitalHumanPlan: { method: 'talking', presenterAssetIds: ['presenter-a'], executionState: 'ready_for_capability_check' } },
  baselineScene: { narration: '已确认口播' }, availableAssets: [] };
const result = await adapter.execute(context);
assert.equal(result?.asset.providerTaskId, 'provider-task-a');
assert.equal(result?.asset.authorizationRef, 'rights://tenant-a/presenter-a/v1');
assert.equal(creates, 1);
assert.equal(reserves, 1);
assert.equal(store.rows.get('studio_social_presenter_jobs')?.[0]?.status, 'completed');

// The same logical request resumes the recorded supplier task. It may poll and
// verify storage again, but must not create or reserve another paid generation.
await adapter.execute(context);
assert.equal(creates, 1);
assert.equal(reserves, 2); // budget ledger reserve is itself idempotent by request key

store.rows.set('studio_production_defaults', [{ id: 'defaults', tenant_id: 'tenant-a', payload: { presenters: [{
  id: 'presenter-a', authorized: true, avatarId: 'avatar-a', voiceId: 'voice-a', rightsEvidence: {
    authorizationRef: 'rights://tenant-a/presenter-a/v1', consentRef: '', grantedAt: '2026-09-01T00:00:00Z',
    subjectAdultConfirmed: true, permittedProviders: ['heygen'], permittedUses: ['digital_presenter', 'voice_synthesis'] },
}] } }]);
assert.equal(await adapter.execute(context), null);

process.chdir(previousCwd);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('social HeyGen bridge tests passed');
