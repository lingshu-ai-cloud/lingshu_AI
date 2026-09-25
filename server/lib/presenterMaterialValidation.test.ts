import assert from 'node:assert/strict';
import test from 'node:test';
import { accessibleMaterial } from './materialLibrary.js';
import { validatePresenterReferenceMaterials } from './presenterMaterialValidation.js';

test('presenter material ownership rules admit tenant/shared real assets only', () => {
  assert.equal(accessibleMaterial({ id: 'own', tenantId: 'tenant-a', scope: 'own', type: 'image', objectKey: 'a' }, 'tenant-a'), true);
  assert.equal(accessibleMaterial({ id: 'other', tenantId: 'tenant-b', scope: 'own', type: 'video', objectKey: 'b' }, 'tenant-a'), false);
  assert.equal(accessibleMaterial({ id: 'shared', tenantId: 'tenant-b', scope: 'shared', type: 'video', objectKey: 'c' }, 'tenant-a'), true);
});

test('presenter references require visible persisted image or video records', async () => {
  const load: any = async () => ({ status: 'ready', sources: [], items: [
    { id: 'portrait', tenantId: 'tenant-a', scope: 'own', type: 'image', objectKey: 'portraits/a.jpg' },
    { id: 'audio', tenantId: 'tenant-a', scope: 'own', type: 'audio', objectKey: 'audio/a.wav' },
    { id: 'local-only', tenantId: 'tenant-a', scope: 'own', type: 'video' },
    { id: 'wrong-trusted-type', tenantId: 'tenant-a', scope: 'own', type: 'video', objectKey: 'videos/a.mp4', seedanceTrustedAsset: { uri: 'asset://asset-image-1', kind: 'image', status: 'active', provider: 'volcengine_ark' } },
    { id: 'trusted-image', tenantId: 'tenant-a', scope: 'own', type: 'image', objectKey: 'portraits/trusted.jpg', seedanceTrustedAsset: { uri: 'asset://asset-image-1', kind: 'image', status: 'active', provider: 'volcengine_ark' } },
  ] });
  await validatePresenterReferenceMaterials('tenant-a', ['portrait', 'trusted-image', 'portrait'], load);
  await assert.rejects(validatePresenterReferenceMaterials('tenant-a', ['missing'], load), /不存在、未授权/);
  await assert.rejects(validatePresenterReferenceMaterials('tenant-a', ['audio'], load), /必须是图片或视频/);
  await assert.rejects(validatePresenterReferenceMaterials('tenant-a', ['local-only'], load), /对象存储/);
  await assert.rejects(validatePresenterReferenceMaterials('tenant-a', ['wrong-trusted-type'], load), /可信资产配置无效/);
});
