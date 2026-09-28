import assert from 'node:assert/strict';
import {
  assessMaterialMatch,
  automaticStoryboardTrim,
  buildReferenceSpeechPlan,
  detectSourceSpeechLanguageCode,
  fitStoryboardSlotsToDuration,
  fitTimelineToVoiceover,
  fitTimelineToVoiceoverCues,
  matchMaterialsToStoryboardLocally,
  resolveWorkbenchSeekTime,
  visualShotRoute,
} from './AiCreateStudio.js';

assert.equal(visualShotRoute({ title: '工厂人物', detail: '画面：工厂工人背影巡检\n口播：销售介绍产品' }), 'material', 'B-roll 画外音不应强制数字人');
assert.equal(visualShotRoute({ title: '销售口播', detail: '画面：销售正面面对镜头说话\n口播：欢迎了解' }), 'presenter', '正面销售口播保持数字人身份');
assert.equal(visualShotRoute({ title: '首镜', detail: '画面：销售转身走向产品\n口播：欢迎了解' }), 'motion', '动作镜头应进入动作路线');
assert.equal(visualShotRoute({ title: '女性左手举至镜头前', detail: '画面：女性左手举至镜头前\n口播：今天看看这款产品' }), 'motion', '首镜举手动作须显示 Seedance 入口');
assert.equal(visualShotRoute({ title: '第 27 镜', detail: '画面：女性正面面对镜头讲解\n口播：这款产品值得试试' }), 'presenter', '第 27 镜正面人物承接口播须显示 HeyGen 入口');

const taggedFactoryClip = { id: 'tagged-factory', name: '工厂实拍', folder: 'factory', type: 'video', duration: 4, width: 1080, height: 1920, tags: '工厂实拍', shotFunction: '建立信任' } as any;
const untaggedFactoryClip = { ...taggedFactoryClip, id: 'untagged-factory', tags: '', shotFunction: '展示产品' } as any;
const factoryProofSlot = { id: 'factory-proof', start: 0, end: 3, title: '工厂产线', detail: '画面：工厂产线实拍\n镜头功能：建立信任\n口播：无' } as any;
assert.deepEqual(matchMaterialsToStoryboardLocally([taggedFactoryClip], [factoryProofSlot]), {}, '默认精确匹配仍要求分段证据');
assert.equal(matchMaterialsToStoryboardLocally([taggedFactoryClip], [factoryProofSlot], [], { allowSemanticMetadata: true })[factoryProofSlot.id], taggedFactoryClip.id, '复刻任务可按视觉主题和表达目的标签匹配');
assert.deepEqual(matchMaterialsToStoryboardLocally([untaggedFactoryClip], [factoryProofSlot], [], { allowSemanticMetadata: true }), {}, '只有视觉主题而缺少表达目的不能占位');
assert.equal(assessMaterialMatch(factoryProofSlot, taggedFactoryClip, '9:16').score, 100, '两项语义都匹配为满分');
const inlineFactorySlot = { ...factoryProofSlot, detail: '画面：自动化灌装机正在向白色瓶口注液；中景，固定镜头 镜头功能：demonstration 口播：无' };
const fillingClip = { ...untaggedFactoryClip, folder: 'social', duration: 6, segments: [{
  id: 'filling', start: 0, end: 6, duration: 6, quality: 98, confidence: 0.98,
  subject: ['工人', '灌装设备'], action: '灌装设备向瓶中灌装', environment: '工厂',
  visualTopic: '产品灌装工序', expressionPurpose: '展示自动化生产环节', recommendedFunctions: [],
}] } as any;
assert.equal(assessMaterialMatch(inlineFactorySlot, fillingClip, '9:16').score, 100, '同一行分镜字段应提取镜头功能并匹配已标注的灌装素材');
assert.equal(matchMaterialsToStoryboardLocally([fillingClip], [inlineFactorySlot], [], { allowSemanticMetadata: true })[inlineFactorySlot.id], fillingClip.id);
assert.equal(assessMaterialMatch(factoryProofSlot, untaggedFactoryClip, '9:16').score, 50, '只匹配视觉主题为半分');
assert.equal(assessMaterialMatch(factoryProofSlot, taggedFactoryClip, '16:9').score, 100, '画幅不能改变语义评级');
assert.equal(assessMaterialMatch(factoryProofSlot, { ...taggedFactoryClip, duration: 40 }, '9:16').score, 100, '时长不能改变语义评级');
const purposeOnlyClip = { ...taggedFactoryClip, id: 'purpose-only', folder: 'scene', name: '未识别画面', tags: '', shotFunction: '建立信任' } as any;
const unrelatedClip = { ...purposeOnlyClip, id: 'unrelated', shotFunction: '展示产品' } as any;
assert.deepEqual(
  [purposeOnlyClip, unrelatedClip].map(clip => assessMaterialMatch(factoryProofSlot, clip, '9:16').score),
  [50, 0],
  '只匹配表达目的为 50 分，均不匹配为 0 分',
);
assert.equal(assessMaterialMatch(factoryProofSlot, purposeOnlyClip, '9:16').level, 'review');
assert.equal(assessMaterialMatch(factoryProofSlot, unrelatedClip, '9:16').level, 'missing');
const segmentedClip = {
  ...unrelatedClip, id: 'split-evidence', duration: 8,
  segments: [
    { id: 'production', start: 0, end: 3, duration: 3, quality: 85, confidence: 0.9,
      subject: ['工厂产线'], action: '工厂生产', environment: '车间', shot: '中景', recommendedFunctions: ['展示工艺'] },
    { id: 'trust', start: 3, end: 6, duration: 3, quality: 85, confidence: 0.9,
      subject: ['产品'], action: '产品陈列', environment: '展厅', shot: '中景', recommendedFunctions: ['建立信任'] },
  ],
} as any;
assert.equal(assessMaterialMatch(factoryProofSlot, segmentedClip, '9:16').score, 50, '视觉主题和表达目的分属两个片段时不能拼成满分');
assert.deepEqual(matchMaterialsToStoryboardLocally([segmentedClip], [factoryProofSlot], [], { allowSemanticMetadata: true }), {}, '跨片段拼接的证据不能自动占用分镜');
assert.equal(assessMaterialMatch(factoryProofSlot, { ...segmentedClip, segments: [
  { ...segmentedClip.segments[0], recommendedFunctions: ['建立信任'] },
] }, '9:16').score, 100, '同一片段内两项均匹配才能自动匹配');
assert.equal(detectSourceSpeechLanguageCode('Are you too smart with 慧妆 foundation? Let us show you the factory.'), 'en');
const speechPlan = buildReferenceSpeechPlan({ referenceAnalysis: { narrationSourceStatus: 'asr_aligned', details: [
  { shotId: 'replication-a', time: '0-2s', shot: '工厂人物', camera: '', visual: '人物口播', speechLines: [{ lineId: 'line-1', referenceText: 'Original brand.', draftText: 'Enterprise brand.', sourceStartSeconds: 0.2, sourceEndSeconds: 2.4, narrationOwnerShotId: 'replication-a', visualShotIds: ['replication-a', 'replication-b'] }] },
  { shotId: 'replication-b', time: '2-4s', shot: '产品展示', camera: '', visual: '产品展示', speechLines: [{ lineId: 'line-1', referenceText: 'Original brand.', draftText: 'Enterprise brand.', sourceStartSeconds: 0.2, sourceEndSeconds: 2.4, narrationOwnerShotId: 'replication-a', visualShotIds: ['replication-a', 'replication-b'] }] },
] } } as any);
assert.equal(speechPlan.lines.length, 1, '跨镜口播只朗读一次');
assert.equal((speechPlan.script.match(/口播：Enterprise brand\./g) || []).length, 1);

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
assert.equal(resolveWorkbenchSeekTime(true, 12.3, 0), 12.3, '正式成片预览必须按整片时间轴定位');
assert.equal(resolveWorkbenchSeekTime(false, 12.3, 4.5), 4.5, '素材预览必须按分镜裁切后的源时间定位');
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
