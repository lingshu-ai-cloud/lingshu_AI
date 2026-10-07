import test from 'node:test';
import assert from 'node:assert/strict';
import { materialAssetBadge, materialAssetTabOf } from './InspirationDashboard.js';

test('企业知识库和内容工作台上传归入同一个企业上传素材 Tab', () => {
  assert.equal(materialAssetTabOf({ sourceType: 'enterprise-knowledge-upload', folder: 'product', scope: 'own' }), 'enterprise');
  assert.equal(materialAssetTabOf({ sourceType: 'local-upload', folder: 'social', scope: 'own' }), 'enterprise');
  assert.equal(materialAssetBadge({ sourceType: 'enterprise-knowledge-upload', folder: 'product', scope: 'own' }).label, '企业知识库上传');
  assert.equal(materialAssetBadge({ sourceType: 'local-upload', folder: 'social', scope: 'own' }).label, '内容工作台上传');
});

test('AI 生成与平台公共云爆款保持独立资产分类', () => {
  assert.equal(materialAssetTabOf({ sourceType: 'seedance-generated', folder: 'social', scope: 'own' }), 'ai');
  assert.equal(materialAssetTabOf({ sourceType: 'ai-seedance', folder: 'upload', scope: 'own' }), 'ai');
  assert.equal(materialAssetTabOf({ sourceType: 'official-viral', folder: 'hot', scope: 'shared' }), 'cloud');
  assert.equal(materialAssetTabOf({ sourceType: 'licensed-stock', folder: 'social', scope: 'shared' }), 'cloud');
});
