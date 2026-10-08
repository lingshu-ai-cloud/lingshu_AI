import assert from 'node:assert/strict';
import { inferStoryboardTopic } from './storyboardTopic.js';

assert.equal(inferStoryboardTopic({ title: '销售人员口播', visual: '主讲人对镜头介绍产品' }), 'presenter');
assert.equal(inferStoryboardTopic({ title: '工厂分镜', visual: '工人操作流水线上的瓶罐' }), 'factory');
assert.equal(inferStoryboardTopic({ title: '产品特写', visual: '单瓶精华和滴管近景' }), 'product');
assert.equal(inferStoryboardTopic({ title: '使用场景', visual: '双手轻触脸颊，背景是卧室' }), 'consumer_demo');
assert.equal(inferStoryboardTopic({ title: '效果展示', visual: '消费者展示使用前后效果' }), 'consumer_demo');
assert.equal(inferStoryboardTopic({ title: '开场', visual: '人物对镜头说话', presenterConfirmed: true }), 'presenter');
