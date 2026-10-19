import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { storyboardAigcAssignmentIssues, storyboardAigcCurrentKbIssues } from './storyboardAigcAssignment.js';
import { storyboardProjectShotInput } from './storyboardProjectShotInput.js';

const accepted = { phase: 'video', status: 'passed', passed: true, reviewDecision: 'accept', reportId: 'r1' };
const spec = { activeAssemblyId: 'assembly-a', shootingSlots: [{ id: 'persisted-a', slotId: 'shot-a', detail: '手持产品', duration: 4 }],
  storyboardSourcePlans: { 'shot-a': { productIds: ['product-a'] } }, storyboardAssignments: { 'shot-a': 'video' } };
const shotSpec = { assets: [{ role: 'product', source: 'knowledge_base', id: 'product-a', version: 'image-sha-1' }] };
const projectShotFingerprint = storyboardProjectShotInput(spec, 'shot-a')!.fingerprint;
const firstFrame = { id: 'frame', tenantId: 'tenant-a', type: 'image', sourceType: 'ai-storyboard-first-frame', provenance: {
  projectId: 'project-a', shotId: 'shot-a', fingerprint: 'hash', projectShotFingerprint, confirmed: true,
  firstFrameQuality: { phase: 'first_frame', passed: true, status: 'passed', reviewDecision: 'accept' }, shotSpec, productIds: ['product-a'],
} };
const video = { id: 'video', tenantId: 'tenant-a', type: 'video', sourceType: 'ai-seedance', provenance: {
  storyboardAigc: true, projectId: 'project-a', shotId: 'shot-a', firstFrameMaterialId: 'frame',
  firstFrameFingerprint: 'hash', storyboardQualityReport: accepted, shotSpec,
} };
const input = { tenantId: 'tenant-a', projectId: 'project-a', spec, materials: [firstFrame, video] };
assert.deepEqual(storyboardAigcAssignmentIssues(input), []);
assert.equal(storyboardAigcAssignmentIssues({ ...input, projectId: 'project-b' }).length, 1);
assert.equal(storyboardAigcAssignmentIssues({ ...input, spec: { ...spec, storyboardAssignments: { 'shot-b': 'video' } } }).length, 1);
assert.equal(storyboardAigcAssignmentIssues({ ...input, materials: [firstFrame, { ...video, provenance: { ...video.provenance, storyboardQualityReport: { ...accepted, passed: false } } }] }).length, 1);
assert.equal(storyboardAigcAssignmentIssues({ ...input, materials: [{ ...firstFrame, provenance: { ...firstFrame.provenance, confirmed: false } }, video] }).length, 1);
assert.equal(storyboardAigcAssignmentIssues({ ...input, spec: { ...spec, storyboardAssignments: {}, storyboardAssemblies: [{ id: 'assembly-a', assignments: { 'shot-b': 'video' } }] } }).length, 1);
assert.equal(storyboardAigcAssignmentIssues({ ...input, spec: { ...spec, shootingSlots: [{ ...spec.shootingSlots[0], detail: '产品已经换成另一种' }] } }).length, 1, 'editing this shot must stale accepted video');
assert.equal(storyboardAigcAssignmentIssues({ ...input, materials: [firstFrame, { ...video, provenance: { ...video.provenance,
  shotSpec: { assets: [{ role: 'product', source: 'knowledge_base', id: 'product-a', version: 'image-sha-2' }] } } }] }).length, 1, 'video must reference the exact KB product image version used by the first frame');

const currentImage = Buffer.from('current-enterprise-product').toString('base64');
const currentHash = createHash('sha256').update(currentImage).digest('hex');
const currentFrame = { ...firstFrame, provenance: { ...firstFrame.provenance,
  shotSpec: { assets: [{ role: 'product', source: 'knowledge_base', id: 'product-a', version: currentHash }] } } };
const currentSpec = { ...spec, selectedProductIds: ['product-a'], storyboardAssemblies: [{ id: 'assembly-a', assignments: { 'shot-a': 'video' } }] };
let reads = 0;
const kbInput = { spec: currentSpec, materials: [currentFrame, video], readCurrentProductImage: async (_id: string) => { reads += 1; return currentImage; } };
assert.deepEqual(await storyboardAigcCurrentKbIssues(kbInput), []);
assert.equal(reads, 1, 'multiple references to one product should read its image only once');
assert.equal((await storyboardAigcCurrentKbIssues({ ...kbInput, readCurrentProductImage: async () => Buffer.from('changed').toString('base64') })).length, 1);
assert.equal((await storyboardAigcCurrentKbIssues({ ...kbInput, readCurrentProductImage: async () => null })).length, 1);
assert.equal((await storyboardAigcCurrentKbIssues({ ...kbInput, spec: { ...currentSpec, selectedProductIds: [] } })).length, 1);
assert.deepEqual(await storyboardAigcCurrentKbIssues({ ...kbInput, spec: { ...currentSpec, storyboardAssignments: {}, storyboardAssemblies: [] },
  readCurrentProductImage: async () => { throw new Error('should not read KB for an unassigned candidate'); } }), []);

// Automatic replication adoption uses real QA evidence, without human fields.
const { buildStoryboardQaReport } = await import('./storyboardAigcQuality.js');
const autoShotSpec = { ...shotSpec, mode: 'replication', constraints: ['product_identity'] };
const qaBase = { sceneType: 'product' as const, hasProduct: true, hasNamedPerson: false, hasContact: false, hasAction: false, evidenceFrameLabels: ['候选0s', '候选4s'] };
const autoFrameQa = buildStoryboardQaReport({ ...qaBase, phase: 'first_frame', observations: [] });
const autoVideoQa = buildStoryboardQaReport({ ...qaBase, phase: 'video', observations: [] });
const autoFrame = { ...firstFrame, provenance: { ...firstFrame.provenance, confirmed: false, firstFrameQuality: autoFrameQa, shotSpec: autoShotSpec } };
const autoVideo = { ...video, provenance: { ...video.provenance, storyboardQualityReport: autoVideoQa, shotSpec: autoShotSpec } };
const autoInput = { ...input, materials: [autoFrame, autoVideo] };
assert.equal(storyboardAigcAssignmentIssues(autoInput).length, 1, 'missing product observations cannot prove automatic admission');
const provenObservations = ['product_identity', 'packaging_visibility', 'subject_visibility', 'layout', 'layout_continuity', 'visual_integrity'].map(key => ({ key, verdict: 'pass', evidenceFrames: ['候选0s', '候选4s'] }));
const provenInput = { ...input, materials: [{ ...autoFrame, provenance: { ...autoFrame.provenance, firstFrameQuality: buildStoryboardQaReport({ ...qaBase, phase: 'first_frame', observations: provenObservations }) } }, { ...autoVideo, provenance: { ...autoVideo.provenance, storyboardQualityReport: buildStoryboardQaReport({ ...qaBase, phase: 'video', observations: provenObservations }) } }] };
assert.deepEqual(storyboardAigcAssignmentIssues(provenInput), [], 'complete QA evidence admits automatic replication without a forged human review');
const hardProduct = buildStoryboardQaReport({ ...qaBase, phase: 'video', observations: [{ key: 'product_identity', verdict: 'fail', evidenceFrames: ['候选0s'], note: '包装错误', action: 'retry_video' }] });
assert.equal(storyboardAigcAssignmentIssues({ ...autoInput, materials: [autoFrame, { ...autoVideo, provenance: { ...autoVideo.provenance, storyboardQualityReport: hardProduct } }] }).length, 1, 'automatic policy never bypasses product hard failure');
assert.equal(storyboardAigcAssignmentIssues({ ...autoInput, tenantId: 'foreign-tenant' }).length, 1);
assert.equal(storyboardAigcAssignmentIssues({ ...autoInput, materials: [{ ...autoFrame, provenance: { ...autoFrame.provenance, projectShotFingerprint: 'stale' } }, autoVideo] }).length, 1);
assert.equal(storyboardAigcAssignmentIssues({ ...autoInput, materials: [{ ...autoFrame, provenance: { ...autoFrame.provenance, fingerprint: 'wrong-hash' } }, autoVideo] }).length, 1);

const fallbackShotSpec = { ...shotSpec, mode: 'free_creation', constraints: ['product_identity'] };
const fallbackSpec = { ...spec, storyboardSourcePlans: { 'shot-a': { productIds: ['product-a'], mode: 'ai', fallbackMode: 'enterprise_product_display' } } };
const fallbackFrame = { ...firstFrame, provenance: { ...firstFrame.provenance, confirmed: false, mode: 'free_creation',
  projectShotFingerprint: storyboardProjectShotInput(fallbackSpec, 'shot-a')!.fingerprint,
  firstFrameQualityState: 'evaluated', firstFrameQuality: buildStoryboardQaReport({ ...qaBase, phase: 'first_frame', observations: provenObservations }), shotSpec: fallbackShotSpec } };
const fallbackVideo = { ...video, provenance: { ...video.provenance,
  storyboardQualityReport: buildStoryboardQaReport({ ...qaBase, phase: 'video', observations: provenObservations }), shotSpec: fallbackShotSpec } };
assert.deepEqual(storyboardAigcAssignmentIssues({ ...input, spec: fallbackSpec, materials: [fallbackFrame, fallbackVideo] }), [],
  'server-owned enterprise-product fallback accepts complete frame and video QA without a human review click');
const controlledFrame = { ...fallbackFrame, sourceType: 'storyboard-controlled-product-source-frame' };
const controlledVideo = { ...fallbackVideo, sourceType: 'controlled-product-image-animation', provenance: {
  ...fallbackVideo.provenance, controlledProductImageAnimation: true } };
assert.deepEqual(storyboardAigcAssignmentIssues({ ...input, spec: fallbackSpec, materials: [controlledFrame, controlledVideo] }), [],
  'a deterministic authorized product-image animation still requires and can satisfy complete managed QA');
assert.equal(storyboardAigcAssignmentIssues({ ...input, spec: fallbackSpec, materials: [fallbackFrame, controlledVideo] }).length, 1,
  'controlled motion provenance cannot be paired with a generative first frame');
assert.equal(storyboardAigcAssignmentIssues({ ...input, spec: { ...fallbackSpec, storyboardSourcePlans: { 'shot-a': { mode: 'ai' } } }, materials: [fallbackFrame, fallbackVideo] }).length, 1,
  'ordinary free creation cannot acquire managed fallback admission');
