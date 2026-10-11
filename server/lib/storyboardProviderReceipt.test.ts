import assert from 'node:assert/strict';
import { projectStoryboardProviderReceipt } from './storyboardProviderReceipt.js';
let project: any = { id: 'p', tenant_id: 't', spec: {
  automatedReplicationShots: [{ shotId: 's', slotId: 'slot', kind: 'nonperson' }],
  automatedReplicationProgress: { s: { firstFrameMaterialId: 'f', firstFrameFingerprint: 'fp' }, other: { adopted: true } },
} };
const store: any = { getById: async () => structuredClone(project), update: async (_: string, _id: string, patch: any) => {
  project = { ...project, ...structuredClone(patch) }; return true;
} };
const input = { store, tenantId: 't', projectId: 'p', slotId: 'slot', firstFrameMaterialId: 'f', firstFrameFingerprint: 'fp',
  providerTaskId: 'native-1', providerModel: 'model', providerAcceptedAt: '2026-10-11T00:00:00.000Z' };
await projectStoryboardProviderReceipt(input);
assert.equal(project.spec.automatedReplicationProgress.s.providerTaskId, 'native-1');
assert.equal(project.spec.automatedReplicationProgress.s.videoMaterialId, undefined, 'acceptance is not a completed video');
assert.equal(project.spec.automatedReplicationProgress.other.adopted, true);
await projectStoryboardProviderReceipt(input);
await assert.rejects(projectStoryboardProviderReceipt({ ...input, tenantId: 'other' }), /不可访问/);
await assert.rejects(projectStoryboardProviderReceipt({ ...input, firstFrameFingerprint: 'changed' }), /版本已变化/);
await assert.rejects(projectStoryboardProviderReceipt({ ...input, providerTaskId: 'native-2' }), /另一个/);
await assert.rejects(projectStoryboardProviderReceipt({ ...input, providerAcceptedAt: '' }), /不完整/);
console.log('storyboardProviderReceipt behavior passed');
