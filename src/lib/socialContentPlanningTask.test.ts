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
