import assert from 'node:assert/strict';
import { materialSourceCategoryOf, materialThemeTagsOf } from './materialTaxonomy.js';

assert.equal(materialSourceCategoryOf({ sourceType: 'local-upload' }), 'local_upload');
assert.equal(materialSourceCategoryOf({ sourceType: 'enterprise_product_table' }), 'local_upload');
assert.equal(materialSourceCategoryOf({ sourceType: 'mini-program-capture' }), 'local_upload');
assert.equal(materialSourceCategoryOf({ sourceType: 'official-viral', scope: 'shared' }), 'official_import');
assert.equal(materialSourceCategoryOf({ sourceType: 'ai-seedance' }), 'user_generated');
assert.equal(materialSourceCategoryOf({ sourceType: 'gemini-generated' }), 'user_generated');
assert.deepEqual(materialThemeTagsOf({ segments: [{ materialType: 'factory' }, { materialType: 'product' }, { materialType: 'unknown' }] }), ['factory', 'product']);
assert.deepEqual(materialThemeTagsOf({ visualObservations: ['工厂灌装生产线运行，产品瓶身经过质检'] }), ['factory', 'product']);
console.log('material taxonomy passed');
