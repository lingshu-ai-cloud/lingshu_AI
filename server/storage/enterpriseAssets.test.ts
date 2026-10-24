import assert from 'node:assert/strict';
import test from 'node:test';
import { enterpriseAssetContentType, enterpriseAssetTypeAllowed } from './enterpriseAssets.js';

test('enterprise onboarding source documents resolve safe MIME types from generic uploads', () => {
  assert.equal(enterpriseAssetContentType('products.xlsx', 'application/octet-stream'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(enterpriseAssetContentType('products.csv'), 'text/csv');
  assert.equal(enterpriseAssetContentType('products.txt', 'text/plain; charset=utf-8'), 'text/plain; charset=utf-8');
});

test('enterprise assets allow supported onboarding documents but reject generic binary files', () => {
  for (const type of [
    'application/pdf', 'text/csv; charset=utf-8', 'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
  ]) assert.equal(enterpriseAssetTypeAllowed(type), true, type);
  assert.equal(enterpriseAssetTypeAllowed('application/octet-stream'), false);
  assert.equal(enterpriseAssetTypeAllowed('application/x-sh'), false);
});
