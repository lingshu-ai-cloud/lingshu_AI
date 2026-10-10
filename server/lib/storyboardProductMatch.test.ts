import assert from 'node:assert/strict';
import { matchStoryboardProducts } from './storyboardProductMatch.js';

const products = [{ id: 'lamp', name: '星河吊灯' }, { id: 'cream', name: '晴肤防晒霜' }];
assert.deepEqual((await matchStoryboardProducts({ shotDescription: '在客厅安装星河吊灯', products })).productIds, ['lamp']);
assert.deepEqual((await matchStoryboardProducts({ shotDescription: '星河吊灯和晴肤防晒霜同框', products })).productIds, ['lamp', 'cream']);
assert.equal((await matchStoryboardProducts({ shotDescription: '手持产品特写', products,
  selectWithModel: async () => '{"productIds":["cream"],"confidence":0.9,"reason":"瓶身外观"}' })).productIds[0], 'cream');
const bad = await matchStoryboardProducts({ shotDescription: '手持产品特写', products,
  selectWithModel: async () => '{"productIds":["outside"],"confidence":1}' });
assert.deepEqual(bad.productIds, []);
assert.equal(bad.source, 'unresolved');
console.log('storyboardProductMatch tests passed');
