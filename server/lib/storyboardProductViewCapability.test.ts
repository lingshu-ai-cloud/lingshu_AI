import assert from 'node:assert/strict';
import { storyboardMissingProductViews, storyboardRequiresAdditionalProductView } from './storyboardProductViewCapability.js';

assert.equal(storyboardRequiresAdditionalProductView('把产品旋转180度展示背面'), true);
assert.equal(storyboardRequiresAdditionalProductView('镜头轻微推近桌面上的产品'), false);
assert.equal(storyboardRequiresAdditionalProductView('背景工人转身，产品保持正面'), false);
assert.deepEqual(storyboardMissingProductViews({ description: '把产品旋转180度展示背面',
  products: [{ id: 'a', viewCount: 1 }, { id: 'b', viewCount: 2 }] }), ['a']);
assert.deepEqual(storyboardMissingProductViews({ description: '正面轻微运镜',
  products: [{ id: 'a', viewCount: 1 }] }), []);
assert.deepEqual(storyboardMissingProductViews({ description: '展示产品',
  action: { endState: '产品翻到背面' }, products: [{ id: 'a', viewCount: 1 }] }), ['a']);
assert.deepEqual(storyboardMissingProductViews({ description: '展示产品',
  layout: { productView: 'side view' }, products: [{ id: 'a', viewCount: 1 }] }), ['a']);
