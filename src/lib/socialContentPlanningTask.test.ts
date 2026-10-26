import assert from 'node:assert/strict';
import {
  socialPlanningMaterialSource,
  socialPlanningOperationKey,
  socialPlanningTaskInput,
} from './socialContentPlanningTask.js';

const task = socialPlanningTaskInput({
  requestId: 7,
  draftProjectId: 'draft-1',
  title: '秋季新品内容',
  initialScript: '先讲买家痛点，再展示解决方案。',
  specialRequirements: '优先复用现有素材，不默认创建实拍任务。',
  productId: 'product-1',
  productName: '修护精华',
  presenterAssetId: 'presenter-1',
  callToAction: '立即咨询',
  creationPath: 'material_processing',
  uploadedMaterialCount: 1,
  platforms: ['tiktok', 'tiktok'],
  themeId: 'product_value',
});
assert.equal(task.mode, 'instant');
assert.equal(task.productionMode, 'social_ready');
assert.equal(task.managementMode, 'one_click_managed');
assert.equal(task.assetAvailability, 'ready');
assert.equal(task.productId, 'product-1');
assert.deepEqual(task.platforms, ['tiktok']);

const source = socialPlanningMaterialSource({ id: '素材-123', name: '产品正面图' });
assert.match(source.sourceRef, /^socialmaterial:[A-Za-z0-9_-]+$/);
const token = source.sourceRef.replace('socialmaterial:', '').replace(/-/g, '+').replace(/_/g, '/');
const decoded = new TextDecoder().decode(Uint8Array.from(atob(token.padEnd(Math.ceil(token.length / 4) * 4, '=')), char => char.charCodeAt(0)));
assert.equal(decoded, '素材-123');

const keyInput = { requestId: 7, draftProjectId: 'draft-1', title: '秋季新品内容', creationPath: 'material_processing' as const };
assert.equal(socialPlanningOperationKey(keyInput), socialPlanningOperationKey(keyInput));
assert.equal(socialPlanningOperationKey(keyInput), socialPlanningOperationKey({ ...keyInput, requestId: 8 }), 'a saved draft must resume the same task across retries');
assert.notEqual(socialPlanningOperationKey({ ...keyInput, draftProjectId: undefined }), socialPlanningOperationKey({ ...keyInput, draftProjectId: undefined, requestId: 8 }));

console.log('social content planning task contract tests passed');

assert.throws(() => socialPlanningTaskInput({ ...keyInput, uploadedMaterialCount: 0, requestedOutputCount: 3 }), /批量草稿/);

const { syncPlanningTaskMaterials } = await import('./socialContentPlanningTask.js');
const initial = { taskId: 'task-sync', version: '1', brief: { assetAvailability: 'none', productMaterialSelection: { productIds: ['a'], selectedIds: ['old-a'], automaticIds: ['old-a'], dismissedIds: [], preservedProductIds: [], candidateProductIds: { 'old-a': 'a' } } }, sources: [
  { sourceId: 'old-a', status: 'active', ...socialPlanningMaterialSource({ id: 'old-a' }) },
  { sourceId: 'manual', status: 'active', ...socialPlanningMaterialSource({ id: 'manual' }) },
  { sourceId: 'keep-ref', kind: 'reference_link', sourceRef: 'https://example.test/reference', status: 'active' },
] } as unknown as import('../../shared/contracts/socialContentWorkflow.js').SocialContentTaskDetail;
const mutations: string[] = [];
let persisted = initial;
const api = {
  updateTask: async (_taskId: string, input: import('../../shared/contracts/socialContentWorkflow.js').UpdateSocialContentTaskInput) => {
    mutations.push(`availability:${input.changes.assetAvailability}`);
    persisted = { ...persisted, version: String(Number(persisted.version) + 1), brief: { ...persisted.brief, ...input.changes } } as typeof persisted;
    return persisted;
  },
  removeSource: async (taskId: string, sourceId: string, version: string) => {
    assert.equal(taskId, initial.taskId); assert.equal(version, persisted.version);
    mutations.push(`remove:${sourceId}`);
    persisted = { ...persisted, version: String(Number(version) + 1), sources: persisted.sources.map(source => source.sourceId === sourceId ? { ...source, status: 'removed' as const } : source) };
    return { source: persisted.sources[0], task: persisted };
  },
  addSource: async (taskId: string, source: ReturnType<typeof socialPlanningMaterialSource>) => {
    assert.equal(taskId, initial.taskId); mutations.push(`add:${source.sourceRef}`);
    persisted = { ...persisted, version: String(Number(persisted.version) + 1), sources: [...persisted.sources, { ...source, sourceId: 'new-b', status: 'active' } as unknown as typeof persisted.sources[number]] };
    return { source: persisted.sources.at(-1)!, task: persisted };
  },
};
const synced = await syncPlanningTaskMaterials({ task: initial, materials: [{ id: 'new-b', type: 'image' }, { id: 'new-b', type: 'image' }], operationKey: 'sync', isCurrent: () => true, api });
assert.equal(mutations.length, 3, 'remove deselected old material and add selected new material once');
assert.equal(synced.sources.find(source => source.sourceId === 'keep-ref')?.status, 'active', 'reference links are never replaced');
await syncPlanningTaskMaterials({ task: synced, materials: [{ id: 'new-b', type: 'image' }], operationKey: 'sync', isCurrent: () => true, api });
assert.equal(mutations.length, 3, 'retry skips already confirmed sources');
await assert.rejects(syncPlanningTaskMaterials({ task: synced, materials: [], operationKey: 'sync', isCurrent: () => false, api }), /账号或创作需求已变化/);

assert.equal(synced.sources.find(source => source.sourceId === 'manual')?.status, 'active', 'independent manual sources are retained');
const legacy = { ...initial, brief: { ...initial.brief, productMaterialSelection: undefined } };
persisted = legacy; mutations.length = 0;
const retained = await syncPlanningTaskMaterials({ task: legacy, materials: [], operationKey: 'legacy', isCurrent: () => true, api });
assert.equal(retained.sources.find(source => source.sourceId === 'old-a')?.status, 'active', 'legacy tasks without ownership metadata never guess source ownership');
assert.deepEqual(mutations, ['availability:ready'], 'retained active manual materials still count as available');

for (const failureStage of ['remove', 'add']) {
  persisted = { ...initial, brief: { ...initial.brief, assetAvailability: 'none' } };
  let failOnce = true;
  const oldSelection = persisted.brief.productMaterialSelection!;
  const nextSelection = { ...oldSelection, productIds: ['b'], selectedIds: ['new-b'], automaticIds: ['new-b'], candidateProductIds: { 'new-b': 'b' } };
  const retryApi = {
    ...api,
    removeSource: async (...args: Parameters<typeof api.removeSource>) => {
      if (failureStage === 'remove' && failOnce) { failOnce = false; throw Error('remove failed'); }
      return api.removeSource(...args);
    },
    addSource: async (...args: Parameters<typeof api.addSource>) => {
      if (failureStage === 'add' && failOnce) { failOnce = false; throw Error('add failed'); }
      return api.addSource(...args);
    },
  };
  const resume = () => syncPlanningTaskMaterials({ task: persisted, materials: [{ id: 'new-b', type: 'image' }], operationKey: `retry-${failureStage}`,
    previousProductMaterialSelection: persisted.brief.productMaterialSelection,
    selectionChanges: { productId: 'b', productIds: ['b'], productMaterialSelection: nextSelection }, isCurrent: () => true, api: retryApi });
  await assert.rejects(resume(), new RegExp(`${failureStage} failed`));
  assert.deepEqual(persisted.brief.productMaterialSelection, oldSelection, `${failureStage} failure retains old ownership for retry`);
  assert.equal(persisted.brief.assetAvailability, 'none');
  const complete = await resume();
  assert.equal(complete.sources.find(source => source.sourceId === 'old-a')?.status, 'removed');
  assert.equal(complete.sources.find(source => source.sourceId === 'new-b')?.status, 'active');
  assert.equal(complete.sources.find(source => source.sourceId === 'manual')?.status, 'active');
  assert.deepEqual(complete.brief.productMaterialSelection, nextSelection);
  assert.equal(complete.brief.assetAvailability, 'ready');
}
