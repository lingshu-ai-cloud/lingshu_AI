import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDownloadedReferenceMaterial } from './downloadedReferenceMaterial.js';
import { isReferenceOnlyMaterial } from './materialPolicy.js';

test('downloaded competitor media is tenant-scoped and fail-closed for rights', () => {
  const material = buildDownloadedReferenceMaterial({
    id: 'material-1', tenantId: 'tenant-a', name: '参考视频', platform: 'youtube',
    sourceUrl: 'https://www.youtube.com/watch?v=abcDEF_1234', duration: 12, size: '1 MB',
    file: 'tenants/tenant-a/material-1.mp4', poster: 'tenants/tenant-a/material-1.poster.jpg',
    contentSha256: 'a'.repeat(64), createdAt: '2026-09-26T00:00:00.000Z',
  });
  assert.equal(material.tenantId, 'tenant-a');
  assert.equal(material.usage, 'reference_only');
  assert.equal(material.sourceType, 'youtube');
  assert.equal(material.commercialUseApproved, false);
  assert.equal(material.derivativesApproved, false);
  assert.equal(material.rawLibraryUseApproved, false);
  assert.equal(material.mayUseInProduction, false);
  assert.equal(isReferenceOnlyMaterial(material), true);
  assert.match(material.url, /^\/media\/tenants\/tenant-a\//);
  assert.match(material.poster || '', /^\/media\/tenants\/tenant-a\//);
});
