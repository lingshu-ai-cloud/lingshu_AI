import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaterialConnectionInterventions } from './materialConnection.js';
import type { DataStore } from '../storage/datastore.js';
const scope = { tenantId: 'a', userId: 'u' };
function fixture() {
 const task = { id: 's', tenant_id: 'a', payload: { title: '实拍', createdAt: 'v1', shotBrief: '近景', suggestedDurationSec: 5, uploadedMaterialIds: [] as string[] } };
 const account = { id: 'c', tenantId: 'a', title: '账号', platform: 'tiktok', status: 'connected', scope: 'user.info.basic', accessToken: 'secret' };
 const store = { getById: async (c: string) => c === 'social_accounts' ? account : task, update: async (_c: string, _id: string, data: any) => { Object.assign(task, data); return true; } } as unknown as DataStore;
 return { task, store };
}
test('tenant isolation and sanitized projection', async () => {
 const f = fixture(); const a = createMaterialConnectionInterventions({ store: f.store, validateMaterials: async () => ({ valid: true, issues: [] }) });
 await assert.rejects(a.materialDetail({ ...scope, tenantId: 'b' }, { matterId: 'm', shootingTaskId: 's' }), /not_found/);
 const d = await a.connectionDetail(scope, { matterId: 'm', accountId: 'c', requiredScopes: ['video.publish'], affectedTaskIds: [] });
 assert.equal(d.actionOptions[0].enabled, false); assert.deepEqual(d.connection.missingScopes, ['video.publish']); assert.equal(JSON.stringify(d).includes('secret'), false);
 await assert.rejects(a.fulfillMaterials(scope, { shootingTaskId: 's', checkpointId: 'cp', materialIds: ['v'], expectedVersion: 'v1' }), /unavailable/);
 assert.deepEqual(f.task.payload.uploadedMaterialIds, []);
});
test('validated structured fulfillment and version check', async () => {
 const f = fixture(); const calls: unknown[] = []; const a = createMaterialConnectionInterventions({ store: f.store, validateMaterials: async i => ({ valid: i.materialIds[0] !== 'foreign', issues: ['ownership'] }), resumeMaterials: async i => { calls.push(i); return { runId: 'r' }; } });
 const p = { shootingTaskId: 's', checkpointId: 'cp', materialIds: ['foreign'], expectedVersion: 'v1' };
 await assert.rejects(a.fulfillMaterials(scope, p), /validation_failed/);
 await assert.rejects(a.fulfillMaterials(scope, { ...p, expectedVersion: 'old' }), /version_conflict/);
 await a.fulfillMaterials(scope, { ...p, materialIds: ['v', 'v'] }); assert.deepEqual(f.task.payload.uploadedMaterialIds, ['v']);
 assert.deepEqual(calls[0], { ...scope, shootingTaskId: 's', checkpointId: 'cp', materialIds: ['v'] });
});
test('stored connected flag never replaces live permission verification', async () => {
 const f = fixture(); let resumed = false; const a = createMaterialConnectionInterventions({ store: f.store, validateMaterials: async () => ({ valid: true, issues: [] }), verifyConnection: async () => ({ valid: false, missingScopes: ['video.publish'], checkedAt: 'now' }), resumeConnection: async () => { resumed = true; } });
 await assert.rejects(a.repairConnection(scope, { accountId: 'c', checkpointId: 'cp', requiredScopes: ['video.publish'] }), /not_restored/); assert.equal(resumed, false);
});
test('real library projection excludes foreign, wrong ratio, short and reference videos', async () => {
 const f = fixture(); (f.task.payload as any).ratio = '9:16';
 const rows = [
  { id: 'ok', tenantId: 'a', name: '合格', type: 'video', duration: 6, width: 1080, height: 1920 },
  { id: 'foreign', tenantId: 'b', type: 'video', duration: 6, width: 1080, height: 1920 },
  { id: 'short', tenantId: 'a', type: 'video', duration: 1, width: 1080, height: 1920 },
  { id: 'wide', tenantId: 'a', type: 'video', duration: 6, width: 1920, height: 1080 },
  { id: 'reference', tenantId: 'a', usage: 'reference_only', type: 'video', duration: 6, width: 1080, height: 1920 },
 ];
 const a = createMaterialConnectionInterventions({ store: f.store, readMaterials: async () => ({ items: rows, status: 'ready', sources: [] }), resumeMaterials: async () => ({ runId: 'r' }) });
 const d = await a.materialDetail(scope, { matterId: 'm', shootingTaskId: 's', checkpointId: 'cp' });
 assert.deepEqual(d.materials.items.map(i => i.id), ['ok']);
 await assert.rejects(a.fulfillMaterials(scope, { shootingTaskId: 's', materialIds: ['foreign'], checkpointId: 'cp', expectedVersion: 'v1' }), /validation_failed/);
 await a.fulfillMaterials(scope, { shootingTaskId: 's', materialIds: ['ok'], checkpointId: 'cp', expectedVersion: 'v1' });
 assert.deepEqual(f.task.payload.uploadedMaterialIds, ['ok']);
});
