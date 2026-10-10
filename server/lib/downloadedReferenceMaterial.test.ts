import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDownloadedReferenceMaterial } from './downloadedReferenceMaterial.js';
import { isReferenceOnlyMaterial } from './materialPolicy.js';

test('downloaded competitor media becomes a tenant-scoped editable library asset', () => {
  const material = buildDownloadedReferenceMaterial({
    id: 'material-1', tenantId: 'tenant-a', name: '参考视频', platform: 'youtube',
    sourceUrl: 'https://www.youtube.com/watch?v=abcDEF_1234', duration: 12, size: '1 MB',
    file: 'tenants/tenant-a/material-1.mp4', poster: 'tenants/tenant-a/material-1.poster.jpg',
    contentSha256: 'a'.repeat(64), createdAt: '2026-09-26T00:00:00.000Z',
  });
  assert.equal(material.tenantId, 'tenant-a');
  assert.equal(material.usage, 'editable');
  assert.equal(material.pinned, true);
  assert.equal(material.sourceType, 'youtube');
  assert.equal(material.commercialUseApproved, true);
  assert.equal(material.derivativesApproved, true);
  assert.equal(material.rawLibraryUseApproved, true);
  assert.equal(material.mayUseInProduction, true);
  assert.equal(isReferenceOnlyMaterial(material), false);
  assert.match(material.url, /^\/media\/tenants\/tenant-a\//);
  assert.match(material.poster || '', /^\/media\/tenants\/tenant-a\//);
  assert.equal(isReferenceOnlyMaterial({ ...material, usage: 'editable', commercialUseApproved: true,
    derivativesApproved: true, rawLibraryUseApproved: true, mayUseInProduction: true }), true,
    '显式仅供参考的原片不能通过添加授权字段绕过隔离');
});

test('locally imported video requires every production right before joining editable materials', () => {
  const imported = { usage: 'editable', sourceType: 'tiktok_reference',
    sourceUrl: 'https://www.tiktok.com/example', commercialUseApproved: true,
    derivativesApproved: true, rawLibraryUseApproved: true, mayUseInProduction: true };
  assert.equal(isReferenceOnlyMaterial(imported), false);
  assert.equal(isReferenceOnlyMaterial({ ...imported, derivativesApproved: false }), true);
});
