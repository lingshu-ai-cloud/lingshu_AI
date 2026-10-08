import assert from 'node:assert/strict';
import { createProductionRouter } from '../routes/production.js';
import { newShotProduction } from '../../src/lib/shotProduction.js';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { advanceAutomatedReplication, invokeReplicationRoute } from './automatedReplicationBridge.js';
const rows = new Map<string, any>(); let seq = 0;
const store: DataStore = {
  async getById<T>(collection: string, id: string) { return structuredClone(rows.get(`${collection}/${id}`) || null) as T | null; },
  async create<T>(collection: string, value: Record<string, unknown>) { const row = { ...structuredClone(value), id: `r${++seq}` }; rows.set(`${collection}/${row.id}`, row); return structuredClone(row) as T; },
  async update(collection, id, patch) { const key = `${collection}/${id}`; if (!rows.has(key)) return false; rows.set(key, { ...rows.get(key), ...structuredClone(patch) }); return true; },
  async delete(collection, id) { return rows.delete(`${collection}/${id}`); },
  async list<T>(collection: string, query: ListQuery = {}) { const items = [...rows.entries()].filter(([key, row]) => key.startsWith(`${collection}/`) && Object.entries(query.where || {}).every(([field, value]) => row[field] === value)).map(([, row]) => structuredClone(row) as T); return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 500 }; },
};
const shot: any = { ...newShotProduction('企业自己的台词', 'sales'), source: 'avatar', sound: 'source', digitalHuman: { workflow: 'viral_replication', method: 'reenact', replicationMode: 'sentence_first_frame', contentConfirmed: false, action: '介绍产品', scene: '场景', preserve: '动作', reference: { materialId: 'source', originalText: '不能偷用的原片台词', videoUrl: '/source.mp4', start: 0, end: 4, derivativeAuthorized: false, cues: [{ id: 'cue', start: 0, end: 4, originalText: '原片台词', targetText: '企业自己的台词', shotIds: ['slot'], personShot: true, compositionClusterId: 'cluster', sourceFirstFrame: { time: 0 } }] } } };
rows.set('studio_projects/project', { id: 'project', tenant_id: 'tenant', status: 'draft', spec: { ratio: '9:16', activeAssemblyId: 'assembly', shootingSlots: [{ id: 'shot', slotId: 'slot', duration: 4 }], automatedReplicationShots: [{ shotId: 'shot', slotId: 'slot', kind: 'person', start: 0, end: 4 }], shotProductions: { 'assembly:shot': shot } } });
rows.set('studio_production_defaults/defaults', { id: 'defaults', tenant_id: 'tenant', payload: { presenters: [{ id: 'sales', name: '销售', authorized: true, assetVersion: 1, referenceMaterialIds: ['portrait'] }] } });
let extractions = 0; let submissions = 0; let attempts = 0;
const nativeRouter = createProductionRouter(store, async () => 'unused', {
  sentenceReplicationReadiness: () => ({ ready: true, missing: [] }), verifyCandidateOutput: async () => true,
  prepareSentenceFirstFrames: async input => { extractions++; return input.cues.map(cue => ({ ...cue, sourceFirstFrame: { time: cue.start, materialId: 'source-frame' } })); },
  runSentenceReplication: async input => {
    attempts++; assert.equal(input.cues[0]!.targetText, '企业自己的台词');
    if (!input.existingProviderTasks) { submissions++; await input.onProviderTaskSubmitted?.('cue', 'provider-task'); throw new Error('逐句下载超时'); }
    assert.deepEqual(input.existingProviderTasks, { cue: 'provider-task' });
    return { state: 'completed', cues: input.cues, materialId: 'candidate', candidateUrl: '/candidate.mp4', providerTaskIds: ['provider-task'], candidateOutput: { materialId: 'candidate', objectKey: 'materials/tenants/dGVuYW50/candidate.mp4', contentSha256: 'a'.repeat(64), objectEtag: 'etag' }, cueQuality: [{ cueId: 'cue', kind: 'person_generated', state: 'accepted', checks: [{ key: 'media', status: 'passed', evidence: 'decoded' }] }], failedCueIds: [] };
  },
});
const deps: any = { call: async (_surface: string, method: 'get' | 'post', route: string, body: any) => invokeReplicationRoute(nativeRouter, 'tenant', method, route, body), materials: () => [{ id: 'candidate', tenantId: 'tenant', scope: 'own', type: 'video' }], validateVideo: async () => {} };
const advance = () => advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store, maxCostCny: 12 }, deps);
const first = await advance(); assert.equal(first.state, 'pending', JSON.stringify(first)); assert.equal(extractions, 1);
assert.equal(rows.get('studio_projects/project').spec.shotProductions['assembly:shot'].digitalHuman.reference.cues[0].sourceFirstFrame.materialId, 'source-frame');
assert.equal((await advance()).state, 'blocked'); assert.equal(submissions, 1);
const resumed = await advance(); assert.equal(resumed.state, 'pending', JSON.stringify(resumed)); assert.equal(submissions, 1); assert.equal(attempts, 2);
// Simulate restart after the native completed receipt was stored but before
// the bridge's result was retained: recover the existing native job, no charge.
delete rows.get('studio_projects/project').spec.automatedReplicationProgress.shot.result;
const recovered = await advance(); assert.equal(recovered.state, 'pending', JSON.stringify(recovered)); assert.equal(attempts, 2);
assert.equal((await advance()).state, 'pending');
const project = rows.get('studio_projects/project'); assert.equal(project.spec.storyboardAssignments.slot, 'candidate');
assert.equal(project.spec.digitalHumanAssemblyAdoptions['assembly:shot'].candidateContentSha256, 'a'.repeat(64));
assert.equal((await advance()).state, 'ready'); assert.equal(attempts, 2);
assert.equal((await advanceAutomatedReplication({ tenantId: 'foreign', projectId: 'project', store }, deps)).state, 'blocked');
assert.equal((await store.list('studio_sentence_replication_jobs')).totalItems, 1);
assert.equal((await store.list('studio_digital_human_executions')).totalItems, 1);
console.log('automatedReplicationBridge native production integration passed');
