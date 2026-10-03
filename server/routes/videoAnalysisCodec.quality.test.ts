import assert from 'node:assert/strict';
import type { VideoAiAnalysis } from '../types/index.js';
import { exactVideoReviewReasons, hasCompletedExactVideoEvidence } from '../lib/videoAnalysisCodec.js';

const storedExact = { analysisMode: 'exact', analysisQuality: 'video_review_required', geminiStatus: 'waiting_for_video',
  gemini: { scriptDetails15s: [{ time: '0-1s', visual: '真人靠近镜头' }, { time: '1-3s', visual: '站立口播' }] } };
assert.equal(hasCompletedExactVideoEvidence(storedExact), true,
  '精确分析被错误排入本地链接下载队列后，已完成的待复核证据仍可恢复');
assert.equal(hasCompletedExactVideoEvidence({ ...storedExact, gemini: JSON.stringify(storedExact.gemini) }), true);
assert.equal(hasCompletedExactVideoEvidence({ ...storedExact, analysisMode: 'strategy' }), false);
assert.equal(hasCompletedExactVideoEvidence({ ...storedExact, gemini: { scriptDetails15s: [{ time: 'bad', visual: '无效' }] } }), false);

const analysis = (details: NonNullable<VideoAiAnalysis['scriptDetails15s']>): VideoAiAnalysis => ({
  theme: '产品视频', hooks: [], sellingPoints: [], mood: '', structure: '', recommendedScriptType: 'storyboard',
  scriptDetails15s: details,
});

const repeatedSpeech = Array.from({ length: 41 }, (_, index) => ({
  time: `${(index * 63.72 / 41).toFixed(2)}-${((index + 1) * 63.72 / 41).toFixed(2)}s`,
  visual: `第 ${index + 1} 个镜头展示不同产品动作`,
  dialogue: index < 21
    ? '这里重复了整段很长的解说词，实际上不可能每个镜头都完整口播同一段。'
    : ['第二段完整口播被错误地重复到多个镜头', '第三段完整口播也被整段重复', '第四段完整口播被整段重复'][index % 3],
}));
assert.ok(exactVideoReviewReasons(analysis(repeatedSpeech), 63.72).some(reason => reason.startsWith('repeated_full_dialogue_')),
  '41 镜只有 4 种口播，其中完整长口播被复制 21 次，必须进入人工复核');
assert.equal(new Set(repeatedSpeech.map(row => row.dialogue)).size, 4);
assert.ok(exactVideoReviewReasons(analysis([
  { time: '0-2s', visual: '人物口播', needsReview: true },
  { time: '2-4s', visual: '产品镜头', needsReview: true },
]), 4).includes('unverified_shots_2_of_2'), '未对齐口播造成逐镜待复核时不得标记为生产级分析');

const distinct = Array.from({ length: 8 }, (_, index) => ({
  time: `${index * 2}-${(index + 1) * 2}s`,
  visual: `镜头 ${index + 1} 呈现不同的真实操作与背景变化`,
  dialogue: `这一镜头的第 ${index + 1} 句具体解说内容各不相同。`,
}));
assert.deepEqual(exactVideoReviewReasons(analysis(distinct), 16, [2, 4, 6, 8, 10, 12]), [],
  '真实逐镜台词与覆盖切点的脚本应通过保守门槛');
assert.ok(exactVideoReviewReasons(analysis([
  { time: '0-5.1s', visual: '人物引入产品' },
  { time: '5.1-7.17s', visual: '把修护面膜和美白霜误并为一镜' },
  { time: '7.17-8.63s', visual: '粉底液' },
  { time: '8.63-10s', visual: '抗皱精华' },
  { time: '10-11s', visual: '按摩油' },
  { time: '11-12.57s', visual: '洗发水' },
]), 12.57, [5.1, 5.97, 7.17, 8.63, 10, 11])
  .some(reason => reason.startsWith('uncovered_short_sequence_cuts_')),
  '产品连切少拆一镜也不能作为合格编导交接物');

const noCutBoundaries = [{ time: '0-5s', visual: '工厂全景' }, { time: '5-10s', visual: '产品特写' }, { time: '10-15s', visual: '人物口播' }];
assert.ok(exactVideoReviewReasons(analysis(noCutBoundaries), 15, [1, 3, 6, 8, 11, 13])
  .some(reason => reason.startsWith('uncovered_scene_cuts_')), '大量检测到的切点未在分镜边界体现时应复核');
assert.ok(exactVideoReviewReasons(analysis([{ time: '0-0.1s', visual: '无法辨识' }, { time: '0.1-3s', visual: '产品画面' }]), 3)
  .some(reason => reason.startsWith('sub_200ms_shots_')), '极短分镜不应直接进入生产');
assert.ok(exactVideoReviewReasons(analysis([
  { time: '0-5.40s', visual: '人物走进展厅' },
  { time: '5.40-5.53s', visual: '瞬时切点' },
  { time: '5.53-7.57s', visual: '手持产品' },
  { time: '7.57-7.60s', visual: '瞬时切点' },
  { time: '7.60-10s', visual: '人物展示' },
]), 10).some(reason => reason === 'sub_200ms_shots_2'), '样片中的 0.13s 和 0.03s 镜头需复核');
assert.ok(exactVideoReviewReasons(analysis([{ time: '0-3s', visual: '工厂车间真人口播', environment: '生产线' }]), 3, [],
  { scene: 'showroom', confidence: 0.94 }).includes('opening_frame_factory_showroom_conflict'),
  '独立首帧证据为展厅而分镜声称工厂时需复核');

console.log('video analysis semantic quality tests passed');
