import assert from 'node:assert/strict';
import { freezeSocialScriptBaseline, parseStoredSocialScriptBaseline } from './socialContentScriptBaseline.js';
import { buildSocialTaskReferencePackage, normalizeReferenceTimelineBoundaries, referencePreparationForRecord } from './socialContentScriptSources.js';
import { reviewShotMaterialRefs } from '../lib/referenceShotReview.js';
import { buildReferenceShotProductionRouting } from '../../shared/referenceShotProductionRouting.js';
import { createSocialAssetSupplyPlan } from '../../shared/socialContentAssetSupply.js';
import { buildSocialAgentWorkflow } from './socialContentAgentWorkflow.js';

const source = {
  sourceId: 'source-reference-1',
  sourceRef: 'https://example.com/reference-1',
  sourceVersion: 'analysis-v1',
  createdAt: '2026-09-27T00:00:00.000Z',
};

const record = {
  id: 'reference-record-1',
  title: 'OldCo OldBrand OldProduct 参考视频',
  sourceUrl: source.sourceRef,
  duration: 8,
  aiAnalysis: JSON.stringify({
    analysisMode: 'exact',
    analysisQuality: 'video',
    gemini: {
      theme: '产品使用',
      identityEntities: [
        { type: 'company', text: 'OldCo' },
        { type: 'brand', text: 'OldBrand' },
        { type: 'product', text: 'OldProduct' },
      ],
      scriptDetails15s: [
        {
          time: '0-3',
          purpose: '前三秒产品使用钩子',
          visual: '模特在浴室把 OldProduct 涂在脸上',
          environment: '浴室',
          interaction: '人物把产品涂在脸上',
          productUsage: '涂在脸上',
          shot: '近景特写',
          camera: '固定镜头',
          composition: '中心构图',
          dialogue: 'OldCo 的 OldBrand OldProduct，先看质地……  再看上脸。',
          onScreenText: 'OldBrand OldProduct｜真实上脸',
          confidence: 0.97,
        },
        {
          time: '3-6',
          purpose: '产品信息',
          visual: 'OldProduct 产品瓶特写',
          shot: '极近特写',
          camera: '缓慢推进',
          dialogue: '防水 10 米，结论以正式资料为准。',
          onScreenText: '防水 10 米',
          confidence: 0.94,
        },
        {
          time: '6-8',
          purpose: '产品收束',
          visual: '新产品静置在桌面',
          shot: '近景',
          camera: '固定镜头',
          confidence: 0.92,
        },
      ],
    },
  }),
};

const resolved = buildSocialTaskReferencePackage({
  record,
  source,
  themeId: 'product_value',
  verifiedContext: {
    enterpriseName: '新企业',
    brandName: '新品牌',
    productName: '新产品',
    facts: [{ key: 'material', label: '材质', value: '玻璃' }],
    source: 'enterprise_product',
    confidence: 1,
  },
});

assert.ok(resolved);
const independentRolePayload = JSON.parse(record.aiAnalysis);
independentRolePayload.contentSha256='current-source';
const independentFirstShot = independentRolePayload.gemini.scriptDetails15s[0];
independentFirstShot.criticalShot={classification:'non_critical',model:'actual-controlled-critical-model',provenance:'independent-controlled-test'};
independentFirstShot.needsReview = true;
independentFirstShot.confidence = .55;
independentFirstShot.materialEvidence = { extractionStatus: 'ready', sourceVideoRef: '/api/source/media',
  clipRef: '/api/source/clip', firstFrameRef: '/api/source/frame', firstFrameSeconds: 0 };
independentFirstShot.observedPresenterRole = 'unknown';
independentFirstShot.personContinuityId = '';
independentFirstShot.presenterContinuityEvidence = { time: '0-3', personPresence: 'person',
  observedPresenterRole: 'sales_presenter', personContinuityId: 'person_1', confidence: .95,
  evidence: ['实际0.1和2.8秒帧中的人物'], frameSeconds: [.1, 2.8], model: 'qwen3-vl-flash',
  provenance: 'qwen_vl:source_frames', sourceSha256: 'current-source' };
independentFirstShot.referenceProductionRouting = buildReferenceShotProductionRouting({ sourceSha256: 'current-source',
  shots: [{ shotId: 'shot-1', time: '0-3', criticalShot: { classification: 'non_critical' },
    presenterContinuityEvidence: independentFirstShot.presenterContinuityEvidence }] }).shots[0].productionRouting;
const independentResolved = buildSocialTaskReferencePackage({ record: { ...record, aiAnalysis: JSON.stringify(independentRolePayload) },
  source, themeId: 'product_value', verifiedContext: { productName: '新产品', facts: [], source: 'enterprise_product', confidence: 1 } });
assert.ok(independentResolved);
assert.equal(independentResolved.referenceVideoAnalysis.shots[0].observedPresenterRole, 'sales_presenter', 'old speech review must not erase verified independent identity');
assert.equal(independentResolved.referenceVideoAnalysis.shots[0].personContinuityId, 'person_1');
assert.equal(independentResolved.referenceVideoAnalysis.shots[0].referenceProductionRouting?.route, 'reference_frame_presenter');
assert.equal(independentResolved.referenceVideoAnalysis.shots[0].presenterContinuityEvidence?.sourceSha256, 'current-source');
assert.equal(independentResolved.replicationScript.shots[0].materialPlan.sourceStrategy, 'authorized_digital_presenter');
assert.equal(independentResolved.replicationScript.shots[0].materialPlan.referenceProductionRouting?.tier, 'standard');
const publicHook = resolved.referenceVideoAnalysis.shots[0]!;
assert.equal(publicHook.spokenText, 'OldCo 的 OldBrand OldProduct，先看质地……  再看上脸。');
assert.equal(publicHook.spokenTextTiming?.precision, 'none', '原模型台词没有真实 ASR 时间证据');
assert.deepEqual(publicHook.spokenLines, [], '长镜头中的多句原话不能凭镜头范围伪造句级时间码');
assert.equal(publicHook.captionText, 'OldBrand OldProduct｜真实上脸');
assert.equal(publicHook.visualContract?.precision, 'hook_high');
assert.equal(publicHook.visualContract?.interaction.kind, 'apply_product_to_face');

const hook = resolved.replicationScript.shots[0]!;
assert.equal(hook.referenceSpokenText, null, '无原声 ASR 时不能把模型 dialogue 当原片逐句口播');
assert.equal(hook.spokenText, null);
assert.equal(resolved.replicationScript.narrationSourceStatus, 'missing_source_asr');
assert.equal(hook.captionText, '新品牌 新产品｜真实上脸');
assert.deepEqual(hook.voiceoverReplacement, {
  mode: 'identity_only',
  replacedEntityTypes: ['company', 'brand', 'product'],
});
assert.equal(hook.startSeconds, 0);
assert.equal(hook.endSeconds, 3);
assert.equal(resolved.replicationScript.shots[1]?.spokenText, null);
assert.equal(resolved.referenceVideoAnalysis.hookAnalysis?.capabilitySignature?.requiresPersonProductContact, true);
assert.equal(resolved.referenceVideoAnalysis.hookAnalysis?.productionAdmission?.route, 'material_edit');
assert.equal(resolved.referenceVideoAnalysis.hookAnalysis?.productionAdmission?.status, 'fallback_only');
assert.equal(resolved.referenceVideoAnalysis.hookAnalysis?.productionAdmission?.executable, true,
  '复杂动作只能执行素材化功能替代，不能表示原动作已可生成');
assert.deepEqual(resolved.referenceVideoAnalysis.hookAnalysis?.productionAdmission?.unsupportedRequirements,
  ['person_product_interaction_control', 'face_contact_control']);
assert.deepEqual(resolved.referenceVideoAnalysis.hookAnalysis?.productionAdmission?.fallbackRoutes, [],
  '用户实拍只能主动选择，不能成为复杂镜头的自动兜底');
assert.equal(resolved.referenceVideoAnalysis.hookAnalysis?.sourceStrategy, 'motion_graphics',
  '产品上脸不得继续路由为可完成产品接触的数字人');
assert.equal(resolved.replicationScript.shots[0]?.materialPlan.sourceStrategy, 'motion_graphics');
assert.equal(resolved.replicationScript.hookOptions.every(option => option.spokenLine === null), true,
  '无原声 ASR 时三个钩子方案均不得编造口播');

function packageWithFirstShot(firstShot: Record<string, unknown>) {
  const analysis = JSON.parse(record.aiAnalysis);
  analysis.gemini.scriptDetails15s[0] = firstShot;
  return buildSocialTaskReferencePackage({
    record: { ...record, aiAnalysis: JSON.stringify(analysis) },
    source,
    themeId: 'product_value',
    verifiedContext: {
      enterpriseName: '新企业', brandName: '新品牌', productName: '新产品',
      facts: [], source: 'enterprise_product', confidence: 1,
    },
  });
}

const simplePresenter = packageWithFirstShot({
  time: '0-3', purpose: '前三秒口播钩子', visual: '主播对镜口播', interaction: '人物对镜说话',
  productUsage: 'none', shot: '人物近景', camera: '固定镜头', dialogue: '先看三个选择要点。', confidence: 0.96,
});
assert.equal(simplePresenter?.referenceVideoAnalysis.hookAnalysis?.productionAdmission?.status, 'admitted');
assert.equal(simplePresenter?.referenceVideoAnalysis.hookAnalysis?.productionAdmission?.route, 'digital_human');
assert.deepEqual(simplePresenter?.referenceVideoAnalysis.hookAnalysis?.productionAdmission?.fallbackRoutes, ['material_edit']);
assert.equal(simplePresenter?.referenceVideoAnalysis.hookAnalysis?.sourceStrategy, 'authorized_digital_presenter',
  '简单数字人口播必须保持原有可执行路线');

const simpleMaterial = packageWithFirstShot({
  time: '0-3', purpose: '前三秒环境钩子', visual: '办公室墙面和自然光空镜', interaction: 'none',
  productUsage: 'none', environment: '办公室', shot: '环境中景', camera: '固定镜头', confidence: 0.95,
});
assert.equal(simpleMaterial?.referenceVideoAnalysis.hookAnalysis?.productionAdmission?.status, 'admitted');
assert.equal(simpleMaterial?.referenceVideoAnalysis.hookAnalysis?.productionAdmission?.route, 'material_edit');
assert.equal(simpleMaterial?.referenceVideoAnalysis.hookAnalysis?.sourceStrategy, 'customer_real_asset',
  '单纯素材镜头必须保持素材剪辑路线');

const factoryInteraction = packageWithFirstShot({
  time: '0-3', purpose: '前三秒工厂钩子', visual: '工人在工厂操作灌装设备',
  interaction: '人物操作生产线设备', productUsage: 'none', environment: '工厂产线',
  shot: '人物中景', camera: '固定镜头', confidence: 0.95,
});
assert.equal(factoryInteraction?.referenceVideoAnalysis.hookAnalysis?.capabilitySignature?.requiresEnvironmentInteraction, true);
assert.equal(factoryInteraction?.referenceVideoAnalysis.hookAnalysis?.productionAdmission?.status, 'fallback_only');
assert.equal(factoryInteraction?.referenceVideoAnalysis.hookAnalysis?.productionAdmission?.route, 'material_edit');
assert.ok(factoryInteraction?.referenceVideoAnalysis.hookAnalysis?.productionAdmission?.unsupportedRequirements
  .includes('environment_interaction_control'));
assert.notEqual(factoryInteraction?.referenceVideoAnalysis.hookAnalysis?.sourceStrategy, 'authorized_digital_presenter',
  '工厂设备交互不得路由为数字人可完成镜头');

const timedAnalysis = JSON.parse(record.aiAnalysis);
timedAnalysis.gemini.audioTranscript = { segments: [
  { start: 0.1, end: 1.4, text: 'OldCo 的 OldBrand OldProduct，先看质地……', timingPrecision: 'phrase', provenance: 'qwen3-asr-flash-filetrans' },
  { start: 1.5, end: 2.8, text: '再看上脸。', timingPrecision: 'phrase', provenance: 'qwen3-asr-flash-filetrans' },
] };
const timedResolved = buildSocialTaskReferencePackage({
  record: { ...record, aiAnalysis: JSON.stringify(timedAnalysis) }, source, themeId: 'product_value',
  verifiedContext: { productName: '新产品', facts: [], source: 'enterprise_product', confidence: 1 },
});
assert.equal(timedResolved?.referenceVideoAnalysis.shots[0]?.spokenTextTiming?.precision, 'phrase');
assert.deepEqual(timedResolved?.referenceVideoAnalysis.shots[0]?.spokenLines?.map(line => [line.startSeconds, line.endSeconds]), [[0.1, 1.4], [1.5, 2.8]],
  '同一长镜头的两句原声必须独立保留真实时间码');
assert.deepEqual(timedResolved?.replicationScript.shots[0]?.speechLines?.map(line => [line.referenceText, line.sourcePrecision]),
  [['OldCo 的 OldBrand OldProduct，先看质地……', 'phrase'], ['再看上脸。', 'phrase']],
  '新稿必须保留每句原文和源时间精度');

const coarseAnalysis = JSON.parse(record.aiAnalysis);
coarseAnalysis.gemini.audioTranscript = { segments: [
  { start: 0, end: 3, text: 'OldCo 的 OldBrand OldProduct，先看质地。再看上脸。', provenance: 'source_asr' },
] };
const coarseResolved = buildSocialTaskReferencePackage({
  record: { ...record, aiAnalysis: JSON.stringify(coarseAnalysis) }, source, themeId: 'product_value',
  verifiedContext: { enterpriseName: '新企业', brandName: '新品牌', productName: '新产品', facts: [], source: 'enterprise_product', confidence: 1 },
});
assert.ok(coarseResolved);
const coarseScriptLines = coarseResolved.replicationScript.shots[0]?.speechLines ?? [];
assert.equal(coarseScriptLines.length, 2, '粗 ASR 应拆为两句并交付内容草稿');
assert.deepEqual(coarseScriptLines.map(line => [line.sourceStartSeconds, line.sourceEndSeconds, line.sourcePrecision]),
  [[0, 2.61, 'coarse'], [2.61, 3, 'coarse']]);
assert.equal(coarseScriptLines[0]?.referenceText, 'OldCo 的 OldBrand OldProduct，先看质地。');
assert.equal(coarseScriptLines[0]?.draftText, '新企业 的 新品牌 新产品，先看质地。');
assert.deepEqual(coarseScriptLines[0]?.replacedEntityTypes, ['company', 'brand', 'product']);
assert.equal(coarseResolved.replicationScript.shots[0]?.spokenText, coarseScriptLines.map(line => line.draftText).join(' '));
const switchedProduct = buildSocialTaskReferencePackage({
  record: { ...record, aiAnalysis: JSON.stringify(coarseAnalysis) }, source, themeId: 'product_value',
  verifiedContext: { productName: '另一企业产品', facts: [], source: 'enterprise_product', confidence: 1 },
});
assert.ok(switchedProduct);
assert.deepEqual(switchedProduct.replicationScript.narrationLines?.map(line => line.referenceText),
  coarseResolved.replicationScript.narrationLines?.map(line => line.referenceText),
  '改选企业产品必须保留原片逐句口播');
assert.equal(switchedProduct.replicationScript.narrationLines?.[0]?.draftText,
  'OldCo 的 OldBrand 另一企业产品，先看质地。',
  '改选产品只替换原片中已识别的产品名，不改写其它句子');

const mislabeledPainPoint = buildSocialTaskReferencePackage({
  record: { ...record, title: 'reference-from-s02', aiAnalysis: JSON.stringify({
    analysisMode: 'exact', analysisQuality: 'video',
    gemini: {
      identityEntities: [
        { type: 'product', text: 'fake white shade', evidence: 'subtitle', confidence: 0.95 },
        { type: 'product', text: 'Three core perks', evidence: 'subtitle', confidence: 0.95 },
      ],
      audioTranscript: { segments: [
        { start: 0, end: 3, text: 'And fake white shade returns piling up non stop.', provenance: 'source_asr' },
        { start: 3, end: 6, text: 'Three core perks, twelve age long wear.', provenance: 'source_asr' },
      ] },
      scriptDetails15s: [
        { time: '0-3', purpose: '痛点', visual: '客户描述粉底色差', dialogue: 'And fake white shade returns piling up non stop.' },
        { time: '3-6', purpose: '卖点', visual: '展示产品卖点', dialogue: 'Three core perks, twelve age long wear.' },
      ],
    },
  }) },
  source, themeId: 'product_value',
  verifiedContext: { productName: 'GUIANFA云朵泡沫卸妆蜜', facts: [], source: 'enterprise_product', confidence: 1 },
});
assert.deepEqual(mislabeledPainPoint?.replicationScript.narrationLines?.map(line => line.draftText), [
  'And fake white shade returns piling up non stop.',
  'Three core perks, twelve age long wear.',
], '模型误标为 product 的痛点和功能标题不得替换为企业产品名');
assert.deepEqual(mislabeledPainPoint?.replicationScript.narrationLines?.map(line => line.replacedEntityTypes),
  [[], []]);
const coarseBaseline = freezeSocialScriptBaseline({
  brief: { languages: ['zh'], productRef: '新产品', callToAction: null } as never,
  theme: { themeId: 'product_value' } as never,
  replicationScript: coarseResolved.replicationScript,
  inspiration: coarseResolved.match,
  verifiedContext: { productName: '新产品', facts: [], source: 'enterprise_product', confidence: 1 },
  lockedAt: '2026-09-27T00:01:00.000Z',
});
assert.deepEqual(parseStoredSocialScriptBaseline(JSON.stringify(coarseBaseline))?.scenes[0]?.speechLines,
  coarseScriptLines, '冻结草稿和读回后均须保留口播原句、新稿、粗时间码与替换记录');

const crossCutAnalysis = JSON.parse(record.aiAnalysis);
crossCutAnalysis.gemini.audioTranscript = { segments: [
  { start: 2.5, end: 3.5, text: 'OldProduct 跨镜继续。', provenance: 'source_asr' },
  { start: 3.6, end: 4.5, text: '下一句。', provenance: 'source_asr' },
] };
const crossCutResolved = buildSocialTaskReferencePackage({
  record: { ...record, aiAnalysis: JSON.stringify(crossCutAnalysis) }, source, themeId: 'product_value',
  verifiedContext: { productName: '新产品', facts: [], source: 'enterprise_product', confidence: 1 },
});
assert.ok(crossCutResolved);
assert.equal(crossCutResolved.replicationScript.narrationLines?.length, 2);
const spanningLine = crossCutResolved.replicationScript.narrationLines?.[0];
assert.deepEqual(spanningLine?.visualShotIds,
  [crossCutResolved.replicationScript.shots[0]?.shotId, crossCutResolved.replicationScript.shots[1]?.shotId],
  '口播跨实际画面切点时，两镜引用同一句');
assert.equal(spanningLine?.narrationOwnerShotId, crossCutResolved.replicationScript.shots[0]?.shotId);
assert.equal(crossCutResolved.replicationScript.shots[0]?.spokenText, '新产品 跨镜继续。');
assert.equal(crossCutResolved.replicationScript.shots[1]?.spokenText, '下一句。',
  '跨镜口播只在第一镜拥有音频，不因第二镜引用而重复播报');

const detailedRows = Array.from({ length: 14 }, (_, index) => ({
  time: index === 0 ? '0-1' : index === 1 ? '1-3' : `${index + 1}-${index + 2}`,
  purpose: index === 1 ? '开场钩子：人物伸手靠近镜头' : '产品信息',
  visual: index === 1 ? '人物近景伸手靠近镜头' : `第 ${index + 1} 镜产品画面`,
  personContinuityId: index < 3 ? 'person_1' : '',
  observedPresenterRole: index < 3 ? 'sales_presenter' : 'none',
  startState: index === 1 ? '人物站在镜头后方' : '',
  action: index === 1 ? '手掌快速伸向镜头' : '',
  endState: index === 1 ? '手掌占据画面中心' : '',
  materialEvidence: {
    sourceVideoRef: '/api/overseas/videos/reference-record-1/media',
    clipRef: `/api/overseas/videos/reference-record-1/shot/${index + 1}/clip`,
    firstFrameRef: `/api/overseas/videos/reference-record-1/shot/${index + 1}/first-frame`,
    firstFrameSeconds: (index === 0 ? 0 : index === 1 ? 1 : index + 1) + 0.04,
    extractionStatus: 'ready',
  },
}));
const longRecord = { ...record, duration: 15, aiAnalysis: JSON.stringify({
  analysisMode: 'exact', analysisQuality: 'video', gemini: { scriptDetails15s: detailedRows.map(row => ({ ...row, needsReview: true })) },
}) };
const longResolved = buildSocialTaskReferencePackage({
  record: longRecord, source, themeId: 'product_value',
  verifiedContext: { productName: '新产品', facts: [], source: 'enterprise_product', confidence: 1 },
});
assert.equal(longResolved?.referenceVideoAnalysis.shots.length, 14, '全片分镜不得截断为前 12 镜');
assert.equal(longResolved?.referenceVideoAnalysis.shots[0]?.materialEvidence?.extractionStatus, 'ready',
  '已抽取原片与首帧的自动分镜不因模型 needsReview 标记而强制人工核查');
const longBaseline = freezeSocialScriptBaseline({
  brief: { languages: ['zh'], productRef: '新产品', callToAction: null } as never,
  theme: { themeId: 'product_value' } as never,
  replicationScript: longResolved?.replicationScript,
  inspiration: longResolved?.match,
  verifiedContext: { productName: '新产品', facts: [], source: 'enterprise_product', confidence: 1 },
  lockedAt: '2026-09-27T00:01:00.000Z',
});
assert.equal(longBaseline.scenes.length, 14, '内容草稿必须覆盖所有参考分镜，不可截断前 12 镜');
assert.equal(parseStoredSocialScriptBaseline(JSON.stringify(longBaseline))?.scenes.length, 14,
  '超过 12 镜的草稿写入后必须可读取，避免复刻任务返回 503');
assert.equal(longResolved?.referenceVideoAnalysis.coverage?.fullTimelineCovered, true);
assert.equal(longResolved?.referenceVideoAnalysis.hookAnalysis?.referencePoints[0], 'reference-shot-1', '前三秒钩子只属于第一个开场分镜');
assert.equal(longResolved?.referenceVideoAnalysis.shots[0]?.purpose, 'hook');
assert.equal(longResolved?.referenceVideoAnalysis.shots[1]?.purpose, 'd_to_c', '后续吸睛镜头应归为 D to C');
assert.equal(longResolved?.referenceVideoAnalysis.shots[1]?.personContinuityId, null, '旧模型人物标签没有独立原片证据，不能成为已核验的跨镜身份');
assert.equal(longResolved?.referenceVideoAnalysis.shots[1]?.referenceProductionRouting?.state,'awaiting_automatic_analysis');
assert.equal(longResolved?.referenceVideoAnalysis.shots[1]?.observedPresenterRole, 'unknown', '需复核的角色证据不能自动路由至人物生成');
assert.equal(longResolved?.replicationScript.shots[1]?.purpose, 'd_to_c', 'D to C 分类须传入内容 Agent 交接物');
assert.equal(longResolved?.referenceVideoAnalysis.shots[1]?.semanticLabel?.intent, '开场钩子：人物伸手靠近镜头');
assert.equal(longResolved?.referenceVideoAnalysis.shots[1]?.action?.path, '手掌快速伸向镜头');
assert.equal(longResolved?.referenceVideoAnalysis.shots[1]?.materialEvidence?.firstFrameRef, '/api/overseas/videos/reference-record-1/shot/2/first-frame');
assert.equal(longResolved?.referenceVideoAnalysis.shots[1]?.presenterMeasurements?.sourceFirstFrameRef, '/api/overseas/videos/reference-record-1/shot/2/first-frame');
assert.equal(longResolved?.referenceVideoAnalysis.shots[1]?.presenterMeasurements?.visibleSpeechSeconds, null, 'ASR cannot prove visible speech');
assert.equal(longResolved?.referenceVideoAnalysis.shots[1]?.presenterMeasurements?.decisionConfidence, 0, 'model confidence cannot become routing confidence');

const noObservedHookRecord = { ...longRecord, id: 'reference-without-observed-hook', aiAnalysis: JSON.stringify({
  analysisMode: 'exact', analysisQuality: 'video',
  gemini: { scriptDetails15s: detailedRows.map(row => ({ ...row, purpose: '产品信息', visual: '产品画面' })) },
}) };
const defaultFirstHook = buildSocialTaskReferencePackage({
  record: noObservedHookRecord, source, themeId: 'product_value',
  verifiedContext: { productName: '新产品', facts: [], source: 'enterprise_product', confidence: 1 },
});
assert.equal(defaultFirstHook?.referenceVideoAnalysis.hookAnalysis?.referencePoints[0], 'reference-shot-1',
  '未识别到更具体的钩子时选择第一段非闪帧开场素材，不要求至少两秒');

const temporalSourceSha = 'd'.repeat(64);
const temporalPresenterRecord = { ...record, id: 'reference-temporal-presenter', duration: 5, aiAnalysis: JSON.stringify({
  analysisMode: 'exact', analysisQuality: 'video', analysisRunId: 'dense-presenter-run', contentSha256: temporalSourceSha,
  presenterDenseSampling: { intervalSeconds: .5, ranges: [{ startSeconds: 0, endSeconds: 4 }] },
  gemini: { audioTranscript: { segments: [{ start: 0, end: 4, text: '这是唯一一次播放的完整口播。', timingPrecision: 'phrase', provenance: 'verified-asr' }] },
    scriptDetails15s: [{ time: '0-4s', materialType: 'talking_head', narrativeRole: 'hook', purpose: '真人口播钩子',
      visual: '销售人物先拿取并展示产品，放下后稳定站播', shot: '中景', camera: '跟拍后固定', motionClass: '走播',
      observedPresenterRole: 'sales_presenter', personContinuityId: 'sales-1', confidence: .99,
      criticalShot: { classification: 'non_critical' },
      presenterContinuityEvidence: { time: '0-4s', personPresence: 'person', observedPresenterRole: 'sales_presenter',
        personContinuityId: 'sales-1', confidence: .99, evidence: ['高密抽帧中的同一销售人物'], frameSeconds: [.1, 3.9],
        model: 'controlled-vl', provenance: 'source-frame-observation', sourceSha256: temporalSourceSha },
      beats: [{ time: '0-1s', action: '人物拿起产品并向前走动' }, { time: '1-2s', action: '人物手持产品对镜展示' },
        { time: '2-3s', action: '人物放下产品' }, { time: '3-4s', action: '人物站立保持稳定，固定镜头' }],
      materialEvidence: { sourceVideoRef: '/api/overseas/videos/reference-temporal-presenter/media',
        clipRef: '/media/tenants/tenant/reference-evidence/reference-temporal-presenter/shot.mp4',
        firstFrameRef: '/media/tenants/tenant/reference-evidence/reference-temporal-presenter/frame.jpg',
        firstFrameSeconds: .04, extractionStatus: 'ready' } },
    { time: '4-5s', materialType: 'product', narrativeRole: 'proof', purpose: '产品特写',
      visual: '产品静置特写', shot: '近景', camera: '固定镜头', confidence: .99,
      criticalShot: { classification: 'non_critical' },
      materialEvidence: { sourceVideoRef: '/api/overseas/videos/reference-temporal-presenter/media',
        clipRef: '/media/tenants/tenant/reference-evidence/reference-temporal-presenter/product-shot.mp4',
        firstFrameRef: '/media/tenants/tenant/reference-evidence/reference-temporal-presenter/product-frame.jpg',
        firstFrameSeconds: 4.04, extractionStatus: 'ready' } }] },
}) };
const temporalPresenter = buildSocialTaskReferencePackage({ record: temporalPresenterRecord, source, themeId: 'product_value',
  verifiedContext: { productName: '新产品', facts: [], source: 'enterprise_product', confidence: 1 } });
assert.ok(temporalPresenter);
assert.equal(temporalPresenter.replicationScript.shots.length, 2,
  '只有文本 beats 和 clipRef#t 伪帧时不得把旧参考镜头拆成已证明的动态/稳定两镜');
const temporalPresenterChildren = temporalPresenter.replicationScript.shots.filter(shot => shot.referenceShotId === 'reference-shot-1');
assert.deepEqual(temporalPresenterChildren.map(shot => [shot.startSeconds, shot.endSeconds]), [[0, 4]]);
assert.equal(temporalPresenter.replicationScript.narrationLines?.[0]?.narrationOwnerShotId,
  temporalPresenterChildren[0]!.shotId);
assert.deepEqual(temporalPresenter.replicationScript.narrationLines?.[0]?.visualShotIds,
  temporalPresenterChildren.map(shot => shot.shotId));
assert.equal(temporalPresenterChildren.filter(shot => shot.spokenText).length, 1,
  '跨动态/稳定切点的同一句口播只能由一个子镜拥有');
const temporalSupply = createSocialAssetSupplyPlan({
  creationMode: 'viral_replication', productionApproach: 'ai_enhanced', materialRoutingPolicyVersion: 'type-aware.v2',
  confirmedFactRefs: [], presenterSelectionConfirmed: true,
  inventory: { presenterAssetIds: ['presenter-enterprise-1'], referenceVideoIds: [source.sourceId] },
  accountPresenterLock: { socialAccountId: 'account-1', presenterProfileId: 'profile-1', presenterProfileVersion: '1',
    presenterAssetId: 'presenter-enterprise-1', avatarId: 'avatar-1', voiceProfileId: 'voice-1', consentRef: 'consent-1',
    commercialRightsStatus: 'cleared', status: 'published', consistencyKey: 'account-1:profile-1:1' },
  referenceShots: temporalPresenter.referenceVideoAnalysis.shots,
  shots: temporalPresenter.replicationScript.shots.map(shot => ({
    shotId: shot.shotId, function: shot.purpose,
    referenceShotId: shot.referenceShotId, plannedDurationSeconds: shot.endSeconds - shot.startSeconds,
    requestedDescription: shot.visualInstruction,
  })),
});
const temporalSupplyChildren = temporalSupply.shots.filter(shot => temporalPresenterChildren.some(child => child.shotId === shot.shotId));
assert.equal(temporalSupplyChildren.length, 1, '素材计划不得接收由文本伪造的真人子镜');
const temporalWorkflow = buildSocialAgentWorkflow({
  taskId: 'task-temporal-presenter', taskVersion: '1', taskStatus: 'plan_review', mode: 'instant', weeklyPlanId: null,
  brief: { title: '真人时序复刻', objective: '验证动态转稳定链路', productRef: '新产品', audience: '采购商', markets: ['US'],
    languages: ['zh'], platforms: ['tiktok'], formats: ['short_video'], aspectRatio: '9:16', cadence: null,
    requestedOutputCount: 1, weeklyBudgetCny: 100, perItemBudgetCny: 20, retryReserveCny: 10,
    planningMode: 'auto_adjust', shootingWindowMinutes: 0, specialRequirements: null, dueAt: null,
    brandNotes: null, restrictions: [], callToAction: null, creationMode: 'viral_replication', assetAvailability: 'ready',
    managementMode: 'one_click_managed', productionMode: 'social_ready', materialRoutingPolicyVersion: 'type-aware.v2' },
  sources: [], factSourceRefs: [], assetSupplyPlan: temporalSupply,
  referenceAnalysis: temporalPresenter.referenceVideoAnalysis, replicationScript: temporalPresenter.replicationScript,
  referenceReviewHandoff: { productionExecutionAllowed: true, versionHash: 'temporal-reference-v1' },
  enterprisePresenterAssetRef: 'presenter-enterprise-1',
});
assert.deepEqual(temporalWorkflow.executionPlan.scenes.map(scene => scene.sceneId),
  temporalPresenter.replicationScript.shots.map(shot => shot.shotId),
  '未获逐帧视觉证据时，执行计划不得凭文本临时切镜');

const temporalFactory = structuredClone(temporalPresenterRecord);
const temporalFactoryAnalysis = JSON.parse(String(temporalFactory.aiAnalysis));
temporalFactoryAnalysis.gemini.scriptDetails15s[0].materialType = 'factory';
temporalFactory.aiAnalysis = JSON.stringify(temporalFactoryAnalysis);
const unaffectedFactory = buildSocialTaskReferencePackage({ record: temporalFactory, source, themeId: 'supplier_capability',
  verifiedContext: { productName: '新产品', facts: [], source: 'enterprise_product', confidence: 1 } });
assert.equal(unaffectedFactory?.replicationScript.shots.length, 2, '非真人素材不得进入真人高密拆镜');

const flashLeadRecord = { ...record, id: 'reference-with-cover-flash', duration: 6, aiAnalysis: JSON.stringify({
  analysisMode: 'exact', analysisQuality: 'video', gemini: { scriptDetails15s: [
    { time: '0-0.1', purpose: '产品封面闪帧', visual: '手持瓶子' },
    { time: '0.1-3.47', purpose: '开场提问', visual: '人物伸手靠近镜头' },
    { time: '3.47-6', purpose: '痛点画面', visual: '面部特写' },
  ] },
}) };
const flashLead = buildSocialTaskReferencePackage({
  record: flashLeadRecord, source, themeId: 'product_value',
  verifiedContext: { productName: '新产品', facts: [], source: 'enterprise_product', confidence: 1 },
});
assert.equal(flashLead?.referenceVideoAnalysis.hookAnalysis?.referencePoints[0], 'reference-shot-1',
  '0.1 秒封面被排除后，第一段完整素材应成为钩子');
assert.equal(flashLead?.referenceVideoAnalysis.shots[0]?.startSeconds, 0.1);
assert.equal(flashLead?.referenceVideoAnalysis.shots[0]?.endSeconds, 3.47);

const overlappingIdentityRecord = {
  ...record,
  id: 'reference-record-overlap',
  title: '华研科技 华研精华参考视频',
  aiAnalysis: JSON.stringify({
    analysisMode: 'exact', analysisQuality: 'video',
    gemini: {
      audioTranscript: { segments: [
        { start: 0, end: 3, text: '华研科技的华研精华，现在就看。', provenance: 'source_asr' },
        { start: 3, end: 6, text: '记住华研精华。', provenance: 'source_asr' },
      ] },
      identityEntities: [
        { type: 'company', text: '华研科技', evidence: '口播', confidence: 1 },
        { type: 'brand', text: '华研', evidence: '字幕', confidence: 1 },
        { type: 'product', text: '华研精华', evidence: '口播', confidence: 1 },
      ],
      scriptDetails15s: [
        { time: '0-3', purpose: '开场', visual: '华研精华瓶特写', dialogue: '华研科技的华研精华，现在就看。', onScreenText: '华研精华', confidence: 1 },
        { time: '3-6', purpose: '收束', visual: '产品静置', dialogue: '记住华研精华。', confidence: 1 },
      ],
    },
  }),
};
const overlapResolved = buildSocialTaskReferencePackage({
  record: overlappingIdentityRecord,
  source: { ...source, sourceId: 'source-overlap' },
  themeId: 'product_value',
  verifiedContext: {
    enterpriseName: '新企业', brandName: '新品牌', productName: '新产品',
    facts: [], source: 'enterprise_product', confidence: 1,
  },
});
assert.equal(overlapResolved?.replicationScript.shots[0]?.spokenText, '新企业的新产品，现在就看。',
  '中文重叠专名必须全局按最长原词优先替换');

const reviewedAnalysis = JSON.parse(record.aiAnalysis);
reviewedAnalysis.analysisRunId = 'run-reviewed-1';
reviewedAnalysis.contentSha256 = 'video-sha-reviewed-1';
const reviewedBase = { ...record, aiAnalysis: JSON.stringify(reviewedAnalysis) };
const reviewedShots = [
  { shotId: 'shot-1', start: 0, end: 1, content: '真人靠近镜头', purpose: '动作截流', sourceShotIds: ['shot-1'] },
  { shotId: 'shot-2', start: 1, end: 3, content: '真人站立口播', purpose: '提出问题', sourceShotIds: ['shot-1'] },
  { shotId: 'shot-3', start: 3, end: 8, content: '产品瓶与质地', purpose: '介绍产品', sourceShotIds: ['shot-2', 'shot-3'] },
].map(shot => ({ ...shot, reviewStatus: 'confirmed', labels: ['已确认'], mixedScene: false,
  evidenceRefs: reviewShotMaterialRefs(reviewedBase, shot) }));
const review = { referenceRecordId: record.id, sourceAnalysisRunId: 'run-reviewed-1', reviewComplete: true,
  version: 'review-version-1', sections: Array.from({ length: 6 }, (_, index) => ({ sectionId: `S${index + 1}`, confirmed: true })),
  shots: reviewedShots, selectedHookShotId: 'shot-1' };
const speech = { analysisRunId: 'run-reviewed-1', sourceSha256: 'video-sha-reviewed-1',
  coverageConfirmed: true, reviewerId: 'director-1', verifiedAt: '2026-09-28T00:00:00Z',
  lines: [
    { text: '第一句跨两个镜头。', start: 0.5, end: 1.5, visibility: 'on_camera' },
    { text: '第二句共用镜头。', start: 1.6, end: 2.4, visibility: 'on_camera' },
  ] };
const reviewedRecord = { ...reviewedBase, referenceShotReview: JSON.stringify(review), referenceVerifiedSpeech: JSON.stringify(speech) };
assert.deepEqual(referencePreparationForRecord({ ...reviewedBase, aiAnalysis: JSON.stringify({ ...reviewedAnalysis, geminiStatus: 'analyzed' }) }),
  { status: 'pending', reason: null },
  '精确分析可产出机器分镜与粗 ASR 后，不能强制人工复核');
assert.deepEqual(referencePreparationForRecord({ ...reviewedBase, aiAnalysis: JSON.stringify({
  ...reviewedAnalysis, geminiStatus: 'waiting_for_video', requestedAnalysisMode: 'exact',
  analysisError: 'unsafe_public_video_source',
}) }), { status: 'pending', reason: null },
  '本地链接错误重试产生的旧错误不能盖过现存精确视频证据');
assert.deepEqual(referencePreparationForRecord({ ...reviewedRecord, aiAnalysis: JSON.stringify({ ...reviewedAnalysis, geminiStatus: 'analyzed' }) }),
  { status: 'pending', reason: null }, '编导复核和逐句校时完成后不再提示复核');
const reviewedPackage = buildSocialTaskReferencePackage({ record: reviewedRecord, source, themeId: 'product_value',
  verifiedContext: { productName: '新产品', facts: [], source: 'enterprise_product', confidence: 1 } });
assert.ok(reviewedPackage, '已确认且同版本的分镜和逐句口播应进入内容任务');
assert.deepEqual(reviewedPackage.referenceVideoAnalysis.shots.map(shot => [shot.startSeconds, shot.endSeconds]), [[0, 1], [1, 3], [3, 8]]);
assert.equal(reviewedPackage.referenceVideoAnalysis.shots[0]?.materialEvidence?.extractionStatus, 'ready');
assert.deepEqual(reviewedPackage.referenceVideoAnalysis.shots.slice(0, 2).map(shot => shot.spokenLines?.map(line => line.text)),
  [['第一句跨两个镜头。'], ['第一句跨两个镜头。', '第二句共用镜头。']],
  '一句跨多镜复用 cue，两句同镜复用物理镜头');
assert.equal(reviewedPackage.referenceVideoAnalysis.shots[1]?.spokenTextTiming?.precision, 'phrase');
assert.equal(reviewedPackage.referenceVideoAnalysis.shots[1]?.materialEvidence?.clipRef, reviewedShots[1]?.evidenceRefs[0]);
assert.notEqual(reviewedPackage.referenceVideoAnalysis.version, resolved.referenceVideoAnalysis.version);
const discardedFlash = { shotId: 'shot-flash', start: 8, end: 8.1, content: '无效闪帧', purpose: '排除',
  sourceShotIds: ['shot-3'], reviewStatus: 'discarded', labels: [], mixedScene: false, evidenceRefs: [] };
const withDiscardedFlash = buildSocialTaskReferencePackage({
  record: { ...reviewedRecord, referenceShotReview: JSON.stringify({ ...review, shots: [...reviewedShots, discardedFlash] }) },
  source, themeId: 'product_value',
  verifiedContext: { productName: '新产品', facts: [], source: 'enterprise_product', confidence: 1 },
});
assert.ok(withDiscardedFlash, '审计记录中的已丢弃闪帧不应阻断已确认分镜的交接');
assert.deepEqual(withDiscardedFlash.referenceVideoAnalysis.shots.map(shot => shot.shotId),
  reviewedPackage.referenceVideoAnalysis.shots.map(shot => shot.shotId), '已丢弃闪帧不能重新进入制作镜头');
for (const changed of [
  { referenceShotReview: JSON.stringify({ ...review, sourceAnalysisRunId: 'stale-run' }) },
  { referenceVerifiedSpeech: JSON.stringify({ ...speech, sourceSha256: 'stale-video' }) },
  { referenceVerifiedSpeech: JSON.stringify({ ...speech, coverageConfirmed: false }) },
  { referenceShotReview: JSON.stringify({ ...review, shots: reviewedShots.map((shot, index) => index ? shot : { ...shot, evidenceRefs: [] }) }) },
]) assert.equal(buildSocialTaskReferencePackage({ record: { ...reviewedRecord, ...changed }, source, themeId: 'product_value',
  verifiedContext: { productName: '新产品', facts: [], source: 'enterprise_product', confidence: 1 } }), null,
  '未确认、旧版本或缺证据的复核不能退回粗分析并标为 ready');
const pendingReviewPackage = buildSocialTaskReferencePackage({
  record: { ...reviewedRecord, referenceShotReview: JSON.stringify({ ...review, reviewComplete: false }) },
  source, themeId: 'product_value',
  verifiedContext: { productName: '新产品', facts: [], source: 'enterprise_product', confidence: 1 },
});
assert.ok(pendingReviewPackage, '未完成的人工复核不能阻止数字员工使用已有精确视频分析和粗 ASR 起稿');
assert.deepEqual(pendingReviewPackage.referenceVideoAnalysis.shots.map(shot => [shot.startSeconds, shot.endSeconds]),
  [[0, 3], [3, 6], [6, 8]], '未完成复核不能伪装成已确认镜头，须回到原始机器分析');

const baseline = freezeSocialScriptBaseline({
  brief: {
    languages: ['zh'],
    productRef: '新产品',
    callToAction: null,
  } as never,
  theme: { themeId: 'product_value' } as never,
  replicationScript: resolved.replicationScript,
  inspiration: resolved.match,
  verifiedContext: {
    productName: '新产品', facts: [], source: 'enterprise_product', confidence: 1,
  },
  lockedAt: '2026-09-27T00:01:00.000Z',
});
assert.equal(baseline.scenes[0]?.referenceSpokenText, hook.referenceSpokenText);
assert.deepEqual(baseline.scenes[0]?.voiceoverReplacement, hook.voiceoverReplacement);
assert.equal(baseline.scenes[0]?.voiceover, '', '无原声 ASR 的兼容基线不得补写口播');
assert.equal(baseline.scenes[2]?.voiceover, '', 'silent reference shots must stay silent');
const parsed = parseStoredSocialScriptBaseline(JSON.stringify(baseline));
assert.equal(parsed?.scenes[0]?.referenceSpokenText, hook.referenceSpokenText);
assert.deepEqual(parsed?.scenes[0]?.voiceoverReplacement, hook.voiceoverReplacement);
assert.equal(parsed?.scenes[2]?.voiceover, '');

console.log('social content script source tests passed');

const multiIndependentPayload=structuredClone(independentRolePayload);
for(const [index,shot] of multiIndependentPayload.gemini.scriptDetails15s.entries()){
 const match=String(shot.time).match(/([0-9.]+)-([0-9.]+)/);assert.ok(match);const start=Number(match[1]),end=Number(match[2]);
 shot.criticalShot={classification:'non_critical',model:'controlled-critical',provenance:'independent-source'};
 shot.presenterContinuityEvidence={time:shot.time,personPresence:'person',observedPresenterRole:index===0?'sales_presenter':'presenter_action',personContinuityId:'person_1',confidence:.95,evidence:['连续原片帧'],frameSeconds:[start+.1,end-.1],model:'controlled-vl',provenance:'source-frame-observation',sourceSha256:'current-source'};
}
const resolveRouting=(payload:typeof multiIndependentPayload)=>buildSocialTaskReferencePackage({record:{...record,aiAnalysis:JSON.stringify(payload)},source,themeId:'product_value',verifiedContext:{productName:'新产品',facts:[],source:'enterprise_product',confidence:1}});
const samePerson=resolveRouting(multiIndependentPayload);assert.ok(samePerson);const group=samePerson.referenceVideoAnalysis.shots[0]!.referenceProductionRouting!.identityLock;assert.ok(group);assert.deepEqual(group.samePersonShotIds,samePerson.referenceVideoAnalysis.shots.map(shot=>shot.shotId));
const staleSource=structuredClone(multiIndependentPayload);staleSource.contentSha256='changed-current-source';assert.equal(resolveRouting(staleSource)?.referenceVideoAnalysis.shots[0]?.referenceProductionRouting?.state,'awaiting_automatic_analysis','cached ready route cannot override changed original SHA');
const retimed=structuredClone(multiIndependentPayload);retimed.gemini.scriptDetails15s[0].time='0-2.9';assert.equal(resolveRouting(retimed)?.referenceVideoAnalysis.shots[0]?.referenceProductionRouting?.state,'awaiting_automatic_analysis','cached ready route cannot override retained shot timing');
const missingIndependent=structuredClone(multiIndependentPayload);delete missingIndependent.gemini.scriptDetails15s[0].presenterContinuityEvidence;assert.equal(resolveRouting(missingIndependent)?.referenceVideoAnalysis.shots[0]?.referenceProductionRouting?.state,'awaiting_automatic_analysis','a ready version marker is not independent evidence');
const retainedIdentityAnalysis=structuredClone(reviewedAnalysis);
for(const [index,shot] of retainedIdentityAnalysis.gemini.scriptDetails15s.entries()){
 const match=String(shot.time).match(/([0-9.]+)-([0-9.]+)/);assert.ok(match);const start=Number(match[1]),end=Number(match[2]);
 shot.criticalShot={classification:'non_critical'};
 shot.presenterContinuityEvidence={time:shot.time,personPresence:'person',observedPresenterRole:index===0?'sales_presenter':'presenter_action',personContinuityId:'retained-person',confidence:.95,evidence:['原窗连续帧'],frameSeconds:[start+.1,end-.1],model:'controlled-vl',provenance:'source-frame-observation',sourceSha256:reviewedAnalysis.contentSha256};
 shot.referenceProductionRouting=buildReferenceShotProductionRouting({sourceSha256:reviewedAnalysis.contentSha256,shots:[{shotId:`shot-${index+1}`,time:shot.time,criticalShot:shot.criticalShot,presenterContinuityEvidence:shot.presenterContinuityEvidence}]}).shots[0].productionRouting;
}
const retainedPackage=buildSocialTaskReferencePackage({record:{...reviewedRecord,aiAnalysis:JSON.stringify(retainedIdentityAnalysis)},source,themeId:'product_value',verifiedContext:{productName:'新产品',facts:[],source:'enterprise_product',confidence:1}});assert.ok(retainedPackage);
assert.ok(retainedPackage.referenceVideoAnalysis.shots.every(shot=>shot.referenceProductionRouting?.state==='awaiting_automatic_analysis'),'human retime and merge must re-evaluate actual retained ranges instead of copying original ready summaries');
assert.ok(retainedPackage.referenceVideoAnalysis.shots.every(shot=>!shot.referenceProductionRouting?.identityLock),'old-window person groups cannot bind new retained cuts');

// The entry point must preserve a complete source timeline even when a legacy
// brief supplies a shorter duration and a ten-yuan production budget.
const fidelityRows = Array.from({length: 37}, (_, index) => ({
  ...detailedRows[index % detailedRows.length],
  time: `${index * 38 / 37}-${(index + 1) * 38 / 37}`,
}));
const fidelityRecord = {...longRecord, duration: 38, aiAnalysis: JSON.stringify({
  analysisMode: 'exact', analysisQuality: 'video', gemini: {scriptDetails15s: fidelityRows},
})};
for (const referenceMode of [undefined, 'single_source_fidelity'] as const) {
  const fidelityPackage = buildSocialTaskReferencePackage({
    record: fidelityRecord, source, themeId: 'product_value',
    verifiedContext: {productName: '新产品', facts: [], source: 'enterprise_product', confidence: 1},
    planning: {referenceMode, targetDurationSeconds: 18, budgetCny: 10},
  });
  assert.ok(fidelityPackage);
  assert.equal(fidelityPackage.replicationScript.shots.length, 37);
  assert.equal(fidelityPackage.replicationScript.shots.at(-1)?.endSeconds, 38);
  assert.deepEqual(fidelityPackage.replicationScript.shots.map(shot => [shot.referenceShotId, shot.startSeconds, shot.endSeconds]),
    fidelityPackage.referenceVideoAnalysis.shots.map(shot => [shot.shotId, shot.startSeconds, shot.endSeconds]));
  assert.ok(fidelityPackage.replicationScript.shots.every(shot => shot.scriptOrigin !== 'budget_semantic_revision'));
}

// Real 38-second reference regression: the analyzer emitted 41 sampled rows,
// including four transition samples shorter than a production slot. The
// retained 37-slot timeline must use the physical scene cuts and remain whole.
const v12Bounds = [
  [0,.4],[.4,4.9],[4.9,5.3],[5.3,5.7],[5.83,6.6],[6.6,6.9],[6.9,7.4],[7.4,8],[8.2,8.9],
  [8.9,9.9],[9.9,11],[11,12.7],[12.7,14.3],[14.3,15],[15,15.67],[15.67,16.9],[16.9,17.9],
  [17.9,18.3],[18.3,18.8],[18.8,19.13],[19.13,19.7],[19.7,19.97],[19.97,20.9],[20.9,22.1],
  [22.23,23.7],[23.7,24.27],[24.27,24.9],[24.9,25.63],[25.63,26.6],[26.6,28.7],[28.7,29.2],
  [29.2,30.9],[30.9,32],[32,33.8],[33.8,34.3],[34.3,37.1],[37.23,38],
] as const;
const v12HardCuts = [4.83,5.83,6.63,6.9,7.47,8,8.9,14.3,18.3,19.13,19.97,22.23,24.27,24.93,25.63,29.2,31.9,34.3,37.23];
const normalizedV12 = normalizeReferenceTimelineBoundaries(
  v12Bounds.map(([startSeconds,endSeconds],index)=>({detail:{shotId:`shot-${index+1}`},timing:{startSeconds,endSeconds,durationSeconds:endSeconds-startSeconds}})),
  [...v12Bounds.map(([startSeconds,endSeconds])=>({startSeconds,endSeconds})),
    {startSeconds:5.7,endSeconds:5.83},{startSeconds:8,endSeconds:8.2},{startSeconds:22.1,endSeconds:22.23},{startSeconds:37.1,endSeconds:37.23}],
  v12HardCuts,
);
assert.equal(normalizedV12.length,37);
assert.deepEqual(normalizedV12.slice(3,5).map(row=>[row.timing.startSeconds,row.timing.endSeconds]),[[5.3,5.83],[5.83,6.6]]);
assert.deepEqual(normalizedV12.slice(7,9).map(row=>[row.timing.startSeconds,row.timing.endSeconds]),[[7.4,8],[8,8.9]]);
assert.deepEqual(normalizedV12.slice(23,25).map(row=>[row.timing.startSeconds,row.timing.endSeconds]),[[20.9,22.23],[22.23,23.7]]);
assert.deepEqual(normalizedV12.slice(35,37).map(row=>[row.timing.startSeconds,row.timing.endSeconds]),[[34.3,37.23],[37.23,38]]);
assert.equal(normalizedV12[0]!.timing.startSeconds,0);
assert.equal(normalizedV12.at(-1)!.timing.endSeconds,38);
assert.ok(normalizedV12.slice(1).every((row,index)=>row.timing.startSeconds===normalizedV12[index]!.timing.endSeconds));
