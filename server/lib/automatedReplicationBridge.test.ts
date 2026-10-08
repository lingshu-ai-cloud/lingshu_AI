import assert from 'node:assert/strict';
import { Router } from 'express';
import { advanceAutomatedReplication, invokeReplicationRoute } from './automatedReplicationBridge.js';

const shot = { source: 'material', sound: 'voiceover', layout: 'full', presenterId: '', productId: '', productMaterialId: '', backgroundMaterialId: '', backgroundMode: 'independent', transparent: false, narration: 'Enterprise script', locked: false, factsConfirmed: false, candidates: [], adoptedId: '', revision: 1 };
function fixture() {
  let project: any = { id: 'project', tenant_id: 'tenant', status: 'draft', spec: { activeAssemblyId: 'video-1', automatedReplicationShots: [{ shotId: 'shot', slotId: 'slot', kind: 'nonperson', start: 0, end: 2, firstFrameRequest: { shotDescription: 'Closeup target product', sourceFirstFrameUrl: '/source.jpg' } }], shotProductions: { 'video-1:shot': shot } } };
  const store: any = { getById: async (_: string, id: string) => id === 'project' ? structuredClone(project) : null, update: async (_: string, _id: string, patch: any) => { project = { ...project, ...structuredClone(patch) }; return true; } };
  return { store, project: () => project };
}
const router = Router();
router.post('/native/:id', async (req, res) => { assert.equal(res.locals.tenantId, 'tenant'); res.status(202).json({ id: req.params.id, value: req.body.value }); });
assert.deepEqual(await invokeReplicationRoute(router, 'tenant', 'post', '/native/one', { value: 2 }), { status: 202, body: { id: 'one', value: 2 } });
const f = fixture(); let calls: string[] = []; let validations = 0;
const deps: any = { validateAdoption: async () => [], materials: () => [{ id: 'video', tenantId: 'tenant', scope: 'own', type: 'video' }], validateVideo: async () => { validations++; }, call: async (_: string, _method: string, route: string, body: any) => { calls.push(route); assert.equal(body.shotId || 'slot', 'slot'); if (route === '/storyboard-first-frame') return { status: 200, body: { ok: true, fingerprint: 'frame-fp', material: { id: 'frame' } } }; if (route === '/seedance-video') { assert.equal(body.duration, 4); assert.equal(body.firstFrameMaterialId, 'frame'); return { status: 200, body: { ok: true, material: { id: 'video' } } }; } return { status: 200, body: { quality: { passed: true } } }; } };
for (let index = 0; index < 4; index++) { const result = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: f.store }, deps); assert.equal(result.state, 'pending'); }
assert.deepEqual(calls, ['/storyboard-first-frame', '/seedance-video', '/storyboard-quality-check']);
assert.equal(f.project().spec.storyboardAssignments.slot, 'video');
assert.equal((await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: f.store }, deps)).state, 'ready');
assert.equal(validations, 4); assert.equal(calls.length, 3);
assert.equal((await advanceAutomatedReplication({ tenantId: 'other', projectId: 'project', store: f.store }, deps)).state, 'blocked');
const rejected = fixture();
const failure = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: rejected.store }, { ...deps, call: async () => ({ status: 429, body: { error: 'Budget exhausted' } }) });
assert.equal(failure.state, 'blocked'); assert.equal(failure.blocker, 'Budget exhausted'); assert.equal(rejected.project().spec.storyboardAssignments, undefined);
const catalog = fixture(); catalog.project().spec.storyboardAssignments = { slot: 'video' };
const invalid = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: catalog.store }, { ...deps, validateVideo: async () => { throw new Error('Catalog image is not video'); } });
assert.equal(invalid.state, 'blocked'); assert.match(invalid.blocker!, /Catalog/);
console.log('automatedReplicationBridge behavior passed');
const matched = fixture(); matched.project().spec.automatedReplicationShots[0].firstFrameRequest.shotDescription = '滴管向瓶中灌装液体';
let matchedCalls = 0;
const matchedDeps: any = { ...deps, call: async () => { matchedCalls++; throw new Error('Matching must avoid paid generation'); }, materials: () => [{ id: 'filling-video', tenantId: 'tenant', scope: 'own', type: 'video', sourceType: 'upload', file: 'filling.mp4', duration: 10, segments: [{ start: 3, end: 6, action: '滴管向瓶中灌装液体', subject: ['瓶', '液体', '滴管'] }] }] };
assert.equal((await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: matched.store }, matchedDeps)).state, 'pending');
assert.equal(matchedCalls, 0); assert.equal(matched.project().spec.storyboardAssignments.slot, 'filling-video');
assert.equal(matched.project().spec.clipEdits.slot.trimStart, 3); assert.equal(matched.project().spec.clipEdits.slot.trimEnd, 5);
assert.ok(matched.project().spec.automatedReplicationProgress.shot.matching.evidence);

const replaced = fixture();
let videoHash = 'a'.repeat(64);
const boundDeps: any = { ...deps, validateVideo: async () => videoHash };
for (let tick = 0; tick < 3; tick++) assert.equal((await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: replaced.store }, boundDeps)).state, 'pending');
assert.equal(replaced.project().spec.automatedReplicationProgress.shot.videoContentSha256, videoHash);
videoHash = 'b'.repeat(64);
const replacedBeforeAdopt = await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: replaced.store }, boundDeps);
assert.equal(replacedBeforeAdopt.state, 'blocked'); assert.match(replacedBeforeAdopt.blocker!, /替换/);
videoHash = 'a'.repeat(64);
assert.equal((await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: replaced.store }, boundDeps)).state, 'pending');
videoHash = 'c'.repeat(64);
assert.equal((await advanceAutomatedReplication({ tenantId: 'tenant', projectId: 'project', store: replaced.store }, boundDeps)).state, 'blocked');
