import assert from 'node:assert/strict';
import { automaticStoryboardTrim, matchMaterialsToStoryboardLocally } from './AiCreateStudio.js';

const clips = [
  { id: 'portrait-1', name: '产品全景', folder: 'product', type: 'video', duration: 5, width: 1080, height: 1920 },
  { id: 'portrait-2', name: '工厂产线', folder: 'factory', type: 'video', duration: 6, width: 1080, height: 1920 },
  { id: 'landscape-1', name: '细节特写', folder: 'detail', type: 'video', duration: 4, width: 1920, height: 1080 },
  { id: 'landscape-2', name: '操作场景', folder: 'scene', type: 'video', duration: 5, width: 1920, height: 1080 },
  { id: 'square-1', name: '包装展示', folder: 'packaging', type: 'video', duration: 4, width: 1080, height: 1080 },
] as any[];

const slots = Array.from({ length: 5 }, (_, index) => ({
  id: `slot-${index + 1}`,
  start: index * 3,
  end: (index + 1) * 3,
  title: ['开场钩子', '产品展示', '细节特写', '工厂实力', '包装收尾'][index],
  detail: '',
})) as any[];

const assignments = matchMaterialsToStoryboardLocally(clips, slots, [], { targetRatio: '9:16' });
assert.equal(Object.keys(assignments).length, slots.length, '每个分镜都应拿到素材');
assert.equal(new Set(Object.values(assignments)).size, slots.length, '素材数量足够时，同一视频内不应重复使用素材');
assert.ok(Object.values(assignments).includes('portrait-1'), '同画幅素材仍应优先入选');

const limitedAssignments = matchMaterialsToStoryboardLocally(clips.slice(0, 2), slots, [], { targetRatio: '9:16' });
assert.equal(Object.keys(limitedAssignments).length, slots.length, '素材不足时仍应覆盖全部分镜');
assert.equal(new Set(Object.values(limitedAssignments)).size, 2, '只有素材池耗尽后才允许复用');

assert.deepEqual(
  automaticStoryboardTrim(12, 4, 'video'),
  { trimStart: 0, trimEnd: 4, targetDuration: 4 },
  '长素材应从第一帧开始，只截取到分镜结束时间',
);
assert.deepEqual(
  automaticStoryboardTrim(2.5, 4, 'video'),
  { trimStart: 0, trimEnd: 2.5, targetDuration: 4 },
  '短素材不应虚构超出源文件的裁切终点',
);

console.log('studio material matching regression passed');
