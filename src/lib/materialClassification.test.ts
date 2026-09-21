import assert from 'node:assert/strict';
import { materialIndustryKey, materialThemeBucket } from './materialClassification.js';

assert.equal(materialIndustryKey({ industry: '美妆制造' }), 'beauty_skincare');
assert.equal(materialIndustryKey({ industry: 'Metalworking' }), 'metalworking');
assert.equal(materialIndustryKey({ industry: '' }), 'unclassified');

const factoryWithProductDisclaimer = {
  shotFunction: '建立工厂规模',
  applicability: '不得宣称为客户自有产品',
  tags: '工厂,生产线,美妆B2B',
};
assert.equal(materialThemeBucket(factoryWithProductDisclaimer), 'supplier_capability', 'a legal disclaimer mentioning product must not turn factory footage into product footage');
assert.equal(materialThemeBucket({
  shotFunction: 'product_demo',
  tags: '精华瓶,包装特写',
}), 'product_value');
assert.equal(materialThemeBucket({
  shotFunction: '突出灌装工艺',
  tags: '灌装,自动化产线',
}), 'customization_process');
assert.equal(materialThemeBucket({
  tags: '普通素材',
  segments: [{ productVisible: true, productClarity: 'high' }],
}), 'product_value');

console.log('material classification uses one visual theme and keeps factory footage out of product results');
