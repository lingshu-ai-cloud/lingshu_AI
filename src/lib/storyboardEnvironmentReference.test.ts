import assert from 'node:assert/strict';
import { factoryAiAutoPromotionReady, matchStoryboardEnvironmentImage, retainStoryboardReferenceImages } from './storyboardEnvironmentReference.js';

const selected = [
  { id: 'machine', type: 'image', name: '企业车间设备照片' },
  { id: 'worker', type: 'image', name: '工厂工人装配作业' },
  { id: 'other', type: 'image', name: '产品桌面照片' },
];
assert.equal(matchStoryboardEnvironmentImage('工厂工人装配近景', selected), 'worker');
assert.equal(matchStoryboardEnvironmentImage('工厂设备特写', selected), 'machine');
assert.equal(matchStoryboardEnvironmentImage('工厂设备特写', [...selected, { id: 'machine-2', type: 'image', name: '另一张工厂设备图' }]), undefined,
  'equally relevant images require correction rather than arbitrary pick');
assert.equal(matchStoryboardEnvironmentImage('工厂工人工作', [{ id: 'machine', type: 'image', name: '工厂设备图' }]), undefined,
  'a generic factory image cannot prove a requested worker scene');
assert.equal(matchStoryboardEnvironmentImage('工厂场景空镜', [{ id: 'factory', type: 'image', name: '工厂车间照片' }]), 'factory');
assert.equal(matchStoryboardEnvironmentImage('工厂设备特写', [{ id: 'video', type: 'video', name: '工厂设备视频' }]), undefined);
assert.deepEqual(retainStoryboardReferenceImages(['factory-video'], ['factory-image', 'unused-video'], [
  { id: 'factory-video', type: 'video' }, { id: 'factory-image', type: 'image' }, { id: 'unused-video', type: 'video' },
]), ['factory-video', 'factory-image'], 'local video matching must retain the factory image selected for a later AI shot');
assert.equal(factoryAiAutoPromotionReady('本厂指定产线设备近景', [{ id: 'factory-video', type: 'video', name: '工厂视频' }], {}), false);
assert.equal(factoryAiAutoPromotionReady('本厂指定产线设备近景', [{ id: 'factory-image', type: 'image', name: '本厂产线设备图' }], {}), true);
assert.equal(factoryAiAutoPromotionReady('通用工厂设备近景', [], {}), true);
console.log('storyboardEnvironmentReference tests passed');
