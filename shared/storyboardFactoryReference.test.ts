import assert from 'node:assert/strict';
import { storyboardFactoryProductRequired, storyboardFactoryReferenceRequired } from './storyboardFactoryReference';

assert.equal(storyboardFactoryReferenceRequired('工厂流水线设备近景'), false);
assert.equal(storyboardFactoryReferenceRequired('展示本厂流水线设备近景'), true);
assert.equal(storyboardFactoryReferenceRequired('使用同一台设备完成装配'), true);
assert.equal(storyboardFactoryReferenceRequired('复刻原片工厂构图，改用通用设备'), false);
assert.equal(storyboardFactoryReferenceRequired('本企业产品放在通用工厂流水线上'), false);
assert.equal(storyboardFactoryReferenceRequired('our factory production line'), true);
assert.equal(storyboardFactoryProductRequired('工厂流水线设备近景'), false);
assert.equal(storyboardFactoryProductRequired('展示产品在传送带上移动的特写'), true);
assert.equal(storyboardFactoryProductRequired('工人包装产品'), true);
assert.equal(storyboardFactoryProductRequired('介绍产品生产流程，但画面只有设备'), false);
console.log('storyboardFactoryReference tests passed');
