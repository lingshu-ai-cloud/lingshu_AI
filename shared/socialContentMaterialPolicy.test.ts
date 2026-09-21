import assert from 'node:assert/strict';
import { socialContentMaterialPolicy } from './socialContentMaterialPolicy';

const factory = socialContentMaterialPolicy('supplier_capability');
assert.match(factory.subjectLabel, /工厂|供应/);
assert.match(factory.quickStartDetail, /不要求必须出现产品/);
assert.doesNotMatch(factory.missingMessage, /产品视频|产品图片/);

const product = socialContentMaterialPolicy('product_value');
assert.match(product.subjectLabel, /产品/);
assert.match(product.missingMessage, /产品/);

const customization = socialContentMaterialPolicy('customization_process');
assert.match(customization.missingMessage, /打样|生产|包装|交付/);

const customerCase = socialContentMaterialPolicy('customer_case');
assert.match(customerCase.subjectLabel, /授权/);

const generic = socialContentMaterialPolicy(null);
assert.match(generic.subjectLabel, /主题相关/);

console.log('social content material policy tests passed');
