import assert from 'node:assert/strict';
import { storyboardFactoryReferenceRequired } from '../../shared/storyboardFactoryReference.js';
import {
  assessMaterialMatch,
  automaticStoryboardTrim,
  buildReferenceSpeechPlan,
  confirmReferenceSpeechEdits,
  detectSourceSpeechLanguageCode,
  fitStoryboardSlotsToDuration,
  fitTimelineToVoiceover,
  fitTimelineToVoiceoverCues,
  matchMaterialsToStoryboardLocally,
  isProductionEligibleClip,
  isAutomaticViralMaterialCandidate,
  referenceProductSlots,
  resolveWorkbenchSeekTime,
  visualShotRoute,
} from './AiCreateStudio.js';

assert.equal(visualShotRoute({ title: '工厂人物', detail: '画面：工厂工人背影巡检\n口播：销售介绍产品' }), 'material', 'B-roll 画外音不应强制数字人');
assert.equal(visualShotRoute({ title: '工厂实拍', detail: '画面：穿蓝色防护服女性在车间中央行走，身后有多名工人操作设备；近景特写，固定镜头\n口播：We support packaging.' }), 'material', '背景或工序人物不是对镜口播主体，不能路由到数字人');
assert.equal(visualShotRoute({ title: '销售口播', detail: '画面：销售正面面对镜头说话\n口播：欢迎了解' }), 'presenter', '正面销售口播保持数字人身份');
assert.equal(visualShotRoute({ title: '首镜', detail: '画面：销售转身走向产品\n口播：欢迎了解' }), 'motion', '动作镜头应进入动作路线');
assert.equal(visualShotRoute({ title: '女性左手举至镜头前', detail: '画面：女性左手举至镜头前\n口播：今天看看这款产品' }), 'motion', '首镜举手动作须显示 Seedance 入口');
assert.equal(visualShotRoute({ title: '第 27 镜', detail: '画面：女性正面面对镜头讲解\n口播：这款产品值得试试' }), 'presenter', '第 27 镜正面人物承接口播须显示 HeyGen 入口');

const taggedFactoryClip = { id: 'tagged-factory', name: '工厂实拍', folder: 'factory', type: 'video', duration: 4, width: 1080, height: 1920, tags: '工厂实拍', shotFunction: '建立信任' } as any;
const untaggedFactoryClip = { ...taggedFactoryClip, id: 'untagged-factory', tags: '', shotFunction: '展示产品' } as any;
const factoryProofSlot = { id: 'factory-proof', start: 0, end: 3, title: '工厂产线', detail: '画面：工厂产线实拍\n镜头功能：建立信任\n口播：无' } as any;
assert.deepEqual(matchMaterialsToStoryboardLocally([taggedFactoryClip], [factoryProofSlot]), {}, '默认精确匹配仍要求分段证据');
assert.equal(matchMaterialsToStoryboardLocally([taggedFactoryClip], [factoryProofSlot], [], { allowSemanticMetadata: true })[factoryProofSlot.id], taggedFactoryClip.id, '复刻任务可按视觉主题和表达目的标签匹配');
const specificFactorySlot = { ...factoryProofSlot, id: 'specific-factory', detail: '画面：本厂指定产线设备近景 镜头功能：建立信任 口播：无' };
assert.equal(storyboardFactoryReferenceRequired(specificFactorySlot.detail), true);
assert.equal(matchMaterialsToStoryboardLocally([taggedFactoryClip], [specificFactorySlot], [], { allowSemanticMetadata: true })[specificFactorySlot.id],
  taggedFactoryClip.id, '没有工厂图片时，本地工厂视频仍可在匹配素材模式直接选用');
assert.equal(matchMaterialsToStoryboardLocally([untaggedFactoryClip], [factoryProofSlot], [], { allowSemanticMetadata: true })[factoryProofSlot.id], untaggedFactoryClip.id, '仅视觉主题命中也可匹配');
assert.deepEqual(
  matchMaterialsToStoryboardLocally([taggedFactoryClip], [factoryProofSlot], [], { requireSegmentEvidence: true }),
  {},
  '成片自动匹配不能用文件夹和标签代替可定位的画面片段证据',
);
assert.equal(assessMaterialMatch(factoryProofSlot, taggedFactoryClip, '9:16').score, 100, '两项语义都匹配为满分');
const inlineFactorySlot = { ...factoryProofSlot, detail: '画面：自动化灌装机正在向白色瓶口注液；中景，固定镜头 镜头功能：demonstration 口播：无' };
const fillingClip = { ...untaggedFactoryClip, folder: 'social', duration: 6, segments: [{
  id: 'filling', start: 0, end: 6, duration: 6, quality: 98, confidence: 0.98,
  subject: ['工人', '灌装设备'], action: '灌装设备向瓶中灌装', environment: '工厂',
  visualTopic: '产品灌装工序', expressionPurpose: '展示自动化生产环节', recommendedFunctions: [],
}] } as any;
assert.equal(assessMaterialMatch(inlineFactorySlot, fillingClip, '9:16').score, 100, '同一行分镜字段应提取镜头功能并匹配已标注的灌装素材');
assert.equal(matchMaterialsToStoryboardLocally([fillingClip], [inlineFactorySlot], [], { allowSemanticMetadata: true })[inlineFactorySlot.id], fillingClip.id);
assert.equal(
  matchMaterialsToStoryboardLocally([fillingClip], [inlineFactorySlot], [], { requireSegmentEvidence: true })[inlineFactorySlot.id],
  fillingClip.id,
  '工厂实拍按同一已分析片段里的主体和工序证据进入成片匹配',
);
const factoryStaffSlot = { ...factoryProofSlot, id: 'factory-staff', detail: '画面：两人穿白大褂，左侧低头操作，右侧持小瓶指认；近景特写 镜头功能：demonstration 口播：无' };
const singleWorkerClip = { ...fillingClip, id: 'single-worker', segments: [{
  ...fillingClip.segments[0], subject: ['工人'], action: '一名工人在工厂产线分拣产品',
  visualTopic: '工厂包装流水线作业', expressionPurpose: '展示生产流程与人工参与',
}] };
assert.equal(assessMaterialMatch(factoryStaffSlot, singleWorkerClip, '9:16').score, 100,
  '工厂人员工作场景不要求与参考镜头人数和动作相同');
assert.equal(matchMaterialsToStoryboardLocally([singleWorkerClip], [factoryStaffSlot], [], { allowSemanticMetadata: true })[factoryStaffSlot.id], singleWorkerClip.id);
assert.equal(assessMaterialMatch(factoryStaffSlot, { ...singleWorkerClip, segments: [{ ...singleWorkerClip.segments[0],
  subject: ['瓶罐'], action: '产品静态摆放', visualTopic: '产品陈列', environment: '展台' }] }, '9:16').score, 50,
  '产品静物不能仅因表达目的相同冒充工厂人员工作画面');
const displaySlot = { ...factoryProofSlot, id: 'product-display', detail: '画面：蓝黑系瓶罐整齐摆放在瓷砖台面，前方有绿植 镜头功能：value 口播：无' };
const pumpClip = { ...singleWorkerClip, segments: [{ ...singleWorkerClip.segments[0],
  subject: ['人', '泵头瓶'], action: '按压泵头向掌心滴液', visualTopic: '产品使用演示',
  expressionPurpose: '展示产品使用方式', environment: '室内' }] };
assert.equal(assessMaterialMatch(displaySlot, pumpClip, '9:16').score, 0,
  '产品陈列分镜不能把泵头使用画面认作同主题');
const fillingSlot = { ...factoryProofSlot, id: 'filling-line', detail: '画面：自动化灌装机向白色瓶口注液 镜头功能：demonstration 口播：无' };
assert.equal(assessMaterialMatch(fillingSlot, singleWorkerClip, '9:16').score, 50,
  '灌装主题不要求瓶子颜色，但必须看到灌装而非普通工人分拣');
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
assert.equal(assessMaterialMatch(factoryProofSlot, segmentedClip, '9:16').score, 100, '通用工厂实拍不应因表达目的标签缺失而被误判');
assert.equal(matchMaterialsToStoryboardLocally([segmentedClip], [factoryProofSlot], [], { allowSemanticMetadata: true })[factoryProofSlot.id], segmentedClip.id, '单项命中可匹配，但不能跨片段拼成满分');
assert.equal(matchMaterialsToStoryboardLocally([purposeOnlyClip], [factoryProofSlot], [], { allowSemanticMetadata: true })[factoryProofSlot.id], purposeOnlyClip.id, '仅表达目的命中也可匹配');
assert.deepEqual(matchMaterialsToStoryboardLocally([unrelatedClip], [factoryProofSlot], [], { allowSemanticMetadata: true }), {}, '两项均不命中仍不可匹配');
assert.equal(matchMaterialsToStoryboardLocally([untaggedFactoryClip, taggedFactoryClip], [factoryProofSlot], [], { allowSemanticMetadata: true })[factoryProofSlot.id], taggedFactoryClip.id, '双项命中优先于单项命中');
const reusedBest = matchMaterialsToStoryboardLocally([taggedFactoryClip, untaggedFactoryClip], [factoryProofSlot, { ...factoryProofSlot, id: 'factory-proof-2' }], [], { allowSemanticMetadata: true });
assert.equal(reusedBest['factory-proof-2'], untaggedFactoryClip.id, '相邻分镜有其他合格候选时避免连续复用同一素材');
const nonAdjacentReuse = matchMaterialsToStoryboardLocally([taggedFactoryClip, untaggedFactoryClip], [factoryProofSlot,
  { id: 'unrelated-middle', start: 3, end: 4, title: '不相关', detail: '画面：完全不同的内容 镜头功能：另一目的' } as any,
  { ...factoryProofSlot, id: 'factory-proof-3' }], [], { allowSemanticMetadata: true });
assert.equal(nonAdjacentReuse['factory-proof-3'], taggedFactoryClip.id, '非相邻镜头仍优先双项命中素材');
const distinctBest = matchMaterialsToStoryboardLocally([taggedFactoryClip, { ...taggedFactoryClip, id: 'another-factory' }], [factoryProofSlot, { ...factoryProofSlot, id: 'factory-proof-2' }], [], { allowSemanticMetadata: true });
assert.notEqual(distinctBest['factory-proof'], distinctBest['factory-proof-2'], '同等匹配质量时相邻分镜不连续复用同一素材');
assert.equal(assessMaterialMatch(factoryProofSlot, { ...segmentedClip, segments: [
  { ...segmentedClip.segments[0], recommendedFunctions: ['建立信任'] },
] }, '9:16').score, 100, '同一片段内两项均匹配才能自动匹配');
assert.equal(
  matchMaterialsToStoryboardLocally([segmentedClip], [factoryProofSlot], [], { requireSegmentEvidence: true })[factoryProofSlot.id],
  segmentedClip.id,
  '可定位的工厂片段只需画面主体/工序相符，表达目的用于排序而非硬拦截',
);
const exactBottleSlot = { ...factoryProofSlot, id: 'exact-bottle', detail: '画面：蓝银渐变玻璃瓶罐，透明磨砂质感，银色金属环装饰 镜头功能：hook 口播：无' };
const genericProductClip = { ...fillingClip, id: 'generic-product', segments: [{ ...fillingClip.segments[0],
  subject: ['护肤产品'], action: '多件护肤产品组合陈列', visualTopic: '产品展示', expressionPurpose: '开场吸引',
  environment: '展台', productVisible: true, productClarity: 'high', recommendedFunctions: ['hook'],
}] };
assert.equal(assessMaterialMatch(exactBottleSlot, genericProductClip, '9:16').level, 'review', '通用产品陈列不能冒充特定颜色、材质和瓶型');
assert.deepEqual(matchMaterialsToStoryboardLocally([genericProductClip], [exactBottleSlot], [], { requireSegmentEvidence: true }), {}, '产品外观证据不足时一键匹配必须留空');
const kickoff = { video: { videoUrl: '/api/overseas/videos/reference/media-url?token=old' } } as any;
assert.equal(isProductionEligibleClip({ ...fillingClip, id: 'reference', url: '/api/overseas/videos/reference/media-url?token=new' }, kickoff), false, '当前爆款原片不能被当作企业生产素材');
assert.equal(isProductionEligibleClip({ ...fillingClip, id: 'licensed', url: '/media/factory.mp4', usage: 'reference_only' }, null), false, '仅供分析素材不能进入成片');
assert.equal(isProductionEligibleClip({ ...fillingClip, id: 'owned', url: '/media/owned-factory.mp4', usage: 'editable' }, kickoff), true, '企业可编辑素材仍可参与匹配');
assert.equal(isAutomaticViralMaterialCandidate({ ...fillingClip, id: 'avatar-output', sourceType: 'digital_human', usage: 'editable' }, kickoff), false, '普通爆款 B-roll 一键匹配不能复用历史数字人视频');
assert.equal(isAutomaticViralMaterialCandidate({ ...fillingClip, id: 'owned-factory', sourceType: 'tenant_upload', usage: 'editable' }, kickoff), true, '企业上传的工厂实拍可以参与爆款 B-roll 匹配');
assert.equal(detectSourceSpeechLanguageCode('Are you too smart with 慧妆 foundation? Let us show you the factory.'), 'en');
const speechPlan = buildReferenceSpeechPlan({ referenceAnalysis: { narrationSourceStatus: 'asr_aligned', details: [
  { shotId: 'replication-a', time: '0-2s', shot: '工厂人物', camera: '', visual: '人物口播', speechLines: [{ lineId: 'line-1', referenceText: 'Original brand.', draftText: 'Enterprise brand.', sourceStartSeconds: 0.2, sourceEndSeconds: 2.4, narrationOwnerShotId: 'replication-a', visualShotIds: ['replication-a', 'replication-b'] }] },
  { shotId: 'replication-b', time: '2-4s', shot: '产品展示', camera: '', visual: '产品展示', speechLines: [{ lineId: 'line-1', referenceText: 'Original brand.', draftText: 'Enterprise brand.', sourceStartSeconds: 0.2, sourceEndSeconds: 2.4, narrationOwnerShotId: 'replication-a', visualShotIds: ['replication-a', 'replication-b'] }] },
] } } as any);
assert.equal(speechPlan.lines.length, 1, '跨镜口播只朗读一次');
assert.deepEqual(speechPlan.lines[0]?.visuals.map(item => item.label), ['人物口播', '产品展示'], '一条口播跨两个实际画面时两个分镜都必须呈现');
assert.equal((speechPlan.script.match(/口播：Enterprise brand\./g) || []).length, 1);

const multiProductReference = { referenceAnalysis: { narrationSourceStatus: 'asr_aligned', details: [
  { shotId: 'intro', time: '0-1s', subtitle: '', visual: '销售人物口播', speechLines: [{ lineId: 'products', referenceText: 'Try cream and oil.', sourceStartSeconds: 0, sourceEndSeconds: 3, narrationOwnerShotId: 'intro' }] },
  { shotId: 'cream-shot', time: '1-2s', subtitle: 'cream', visual: '产品瓶身近景', speechLines: [] },
  { shotId: 'oil-shot', time: '2-3s', subtitle: 'oil', visual: '产品滴管近景', speechLines: [] },
] } } as any;
assert.deepEqual(referenceProductSlots(multiProductReference).map(item => item.shotId), ['cream-shot', 'oil-shot'], '相邻短产品画面应分别成为可映射分镜');
const mappedSpeech = buildReferenceSpeechPlan(multiProductReference, [
  { shotId: 'cream-shot', sourceTerm: 'cream', productId: 'enterprise-cream', productLabel: 'Beauty Cream' },
  { shotId: 'oil-shot', sourceTerm: 'oil', productId: 'enterprise-oil', productLabel: 'Skin Oil' },
]);
assert.equal(mappedSpeech.error, undefined);
assert.equal(mappedSpeech.lines[0]?.source, 'Try cream and oil.', '原片口播必须保留');
assert.equal(mappedSpeech.lines[0]?.draft, 'Try Beauty Cream and Skin Oil.', '按原片出现顺序逐个替换产品词');
assert.match(mappedSpeech.script, /目标产品：Beauty Cream/);
assert.match(mappedSpeech.script, /目标产品：Skin Oil/);

const approvedSpeech = confirmReferenceSpeechEdits(mappedSpeech, [{ ...mappedSpeech.lines[0]!, draft: 'My approved narration.' }]);
assert.equal(approvedSpeech.lines[0]?.draft, 'My approved narration.');
assert.match(approvedSpeech.script, /口播：My approved narration\./);
assert.equal((approvedSpeech.script.match(/画面：/g) || []).length, 3, '确认口播不能丢失原片视觉切点');
assert.match(approvedSpeech.script, /目标产品：Skin Oil/, '确认后产品交接仍保留');
assert.equal(mappedSpeech.lines[0]?.draft, 'Try Beauty Cream and Skin Oil.', '保留自动生成版本以供重置');
assert.throws(() => confirmReferenceSpeechEdits(mappedSpeech, [{ ...mappedSpeech.lines[0]!, source: 'Changed source', draft: 'Edited' }]), /口播来源已变化/);

const deletionPlan = { script: '[0s-2s]\n画面：保留画面\n口播：Keep.\n\n[2s-4s]\n画面：删除画面\n口播：Drop.', lines: [
  { id: 'keep', source: 'Keep.', draft: 'Keep.', time: '0–2s', visuals: [{ time: '0–2s', label: '保留画面' }] },
  { id: 'drop', source: 'Drop.', draft: 'Drop.', time: '2–4s', visuals: [{ time: '2–4s', label: '删除画面' }] },
] };
const deletedSpeech = confirmReferenceSpeechEdits(deletionPlan, [deletionPlan.lines[0]!]);
assert.equal(deletedSpeech.lines.length, 1);
assert.ok(!deletedSpeech.script.includes('删除画面'));
assert.ok(!deletedSpeech.script.includes('Drop.'));
assert.match(deletedSpeech.script, /保留画面/);
assert.throws(() => confirmReferenceSpeechEdits(deletionPlan, []), /没有可确认/);

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

const montageLines = [{ lineId: 'montage-speech', referenceText: 'Cream, foundation, essence and oil.', draftText: 'Cream, foundation, essence and oil.', sourceStartSeconds: 5, sourceEndSeconds: 9, sourcePrecision: 'phrase' as const, narrationOwnerShotId: 'cut-0', visualShotIds: ['cut-0','cut-1','cut-2','cut-3'] }];
const montagePlan = buildReferenceSpeechPlan({referenceAnalysis:{details:[5,6,7,8].map((start,index)=>({shotId:`cut-${index}`,time:`${start}-${start+1}s`,shot:'Product close-up',camera:'fixed',visual:`Product ${index}`,speechLines:montageLines}))}});
assert.equal(montagePlan.lines.length,1);
assert.equal(montagePlan.lines[0].visuals.length,4);
assert.equal((montagePlan.script.match(/画面：/g)||[]).length,4);
assert.equal((montagePlan.script.match(/口播：Cream/g)||[]).length,1);
const montageEdit = confirmReferenceSpeechEdits(montagePlan,[{...montagePlan.lines[0],draft:'Our products.',excludedShotIds:['cut-1']}]);
assert.equal((montageEdit.script.match(/画面：/g)||[]).length,3);
assert.equal(montageEdit.lines.length,1);
assert.ok(montageEdit.script.includes('口播：Our products.'));
