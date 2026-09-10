import assert from 'node:assert/strict';
import {
  automaticStoryboardTrim,
  fitStoryboardSlotsToDuration,
  fitTimelineToVoiceover,
  fitTimelineToVoiceoverCues,
  matchMaterialsToStoryboardLocally,
} from './AiCreateStudio.js';

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

const variantClips = [
  ...clips,
  { id: 'portrait-3', name: '真人开场', folder: 'presenter', type: 'video', duration: 5, width: 1080, height: 1920 },
  { id: 'portrait-4', name: '产品旋转', folder: 'product', type: 'video', duration: 5, width: 1080, height: 1920 },
  { id: 'portrait-5', name: '纹理细节', folder: 'detail', type: 'video', duration: 4, width: 1080, height: 1920 },
  { id: 'portrait-6', name: '仓库备货', folder: 'factory', type: 'video', duration: 6, width: 1080, height: 1920 },
  { id: 'portrait-7', name: '品牌包装', folder: 'packaging', type: 'video', duration: 4, width: 1080, height: 1920 },
] as any[];
const firstVariant = matchMaterialsToStoryboardLocally(variantClips, slots, [], { variantIndex: 0, targetRatio: '9:16' });
const secondVariant = matchMaterialsToStoryboardLocally(variantClips, slots, [], {
  variantIndex: 1,
  previousAssignments: [firstVariant],
  targetRatio: '9:16',
});
const firstVariantIds = new Set(Object.values(firstVariant));
const secondVariantIds = new Set(Object.values(secondVariant));
const freshSecondVariantIds = [...secondVariantIds].filter(id => !firstVariantIds.has(id));
assert.notDeepEqual([...secondVariantIds].sort(), [...firstVariantIds].sort(), '素材充足时，新版本不能只是沿用同一组素材');
assert.ok(freshSecondVariantIds.length >= 3, '第二个版本应至少替换 60% 的分镜素材');

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

const approvedTimeline = [
  { targetStart: 0, targetEnd: 6, targetDuration: 6, trimStart: 0, trimEnd: 6, speed: 1 },
  { targetStart: 6, targetEnd: 13, targetDuration: 7, trimStart: 0, trimEnd: 7, speed: 1 },
];
assert.equal(
  fitTimelineToVoiceover(approvedTimeline, 9.1),
  approvedTimeline,
  '较短配音不得把已确认的 13 秒分镜压缩成 9.1 秒',
);
assert.equal(
  fitStoryboardSlotsToDuration(slots, 9.1),
  slots,
  '较短配音不得改写分镜时间戳',
);
assert.equal(
  fitTimelineToVoiceover(approvedTimeline, 15).at(-1)?.targetEnd,
  15,
  '配音更长时应延展画面，避免旁白被截断',
);
const englishCues = [
  { start: 0, end: 2.31, text: 'First line.' },
  { start: 2.46, end: 5.74, text: 'Second line.' },
];
const alignedTimeline = fitTimelineToVoiceoverCues(approvedTimeline, 5.89, englishCues);
assert.equal(alignedTimeline[0]?.targetEnd, 2.46, '第二镜必须从第二句真实开始时间切入');
assert.equal(alignedTimeline[1]?.targetStart, 2.46, '镜头和口播必须共享同一个边界');
assert.equal(alignedTimeline.at(-1)?.targetEnd, 5.89, '各语言成片应结束于该语言真实音频结尾');

console.log('studio material matching regression passed');
