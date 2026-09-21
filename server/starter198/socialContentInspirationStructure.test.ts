import assert from 'node:assert/strict';
import { SOCIAL_SCRIPT_BASELINE_SCHEMA, type StoredSocialScriptBaseline } from './socialContentScriptBaseline.js';
import { buildSocialProductionPlan } from './socialContentProductionPlan.js';
import { matchSocialInspirationScript } from './socialContentScriptSources.js';

const verifiedContext = {
  productName: '已确认产品', facts: [], source: 'enterprise_product' as const, confidence: 1,
};

function exactRecord(id: string, details: Array<Record<string, unknown>>) {
  return {
    id,
    title: '某品牌创始人亲自讲解',
    tags: ['产品', '细节'],
    aiAnalysis: JSON.stringify({
      analysisMode: 'exact',
      analysisQuality: 'video',
      gemini: { theme: '产品卖点', scriptDetails15s: details },
    }),
  };
}

const detailReference = matchSocialInspirationScript({
  themeId: 'product_value',
  verifiedContext,
  records: [exactRecord('detail-reference', [
    {
      time: '00:00-00:02.50', purpose: '品牌产品细节开场', visual: '张女士拿着 ACME 精华瓶，镜头拍摄瓶身纹理',
      shot: '极近特写', camera: '固定镜头', transitionToNext: '硬切', dialogue: 'ACME 是全网第一',
      onScreenText: 'ACME 立刻年轻十岁', confidence: 0.93,
    },
    {
      time: '00:02.50-00:06.50', purpose: '展示质地细节', visual: '手部涂抹膏体质地',
      shot: '近景', camera: '缓慢推进', transitionToNext: '淡出', dialogue: '原片专属台词', confidence: 0.91,
    },
  ])],
});

const factoryReference = matchSocialInspirationScript({
  themeId: 'product_value',
  verifiedContext,
  records: [exactRecord('factory-reference', [
    {
      time: '0-2.5', purpose: '工厂生产现场', visual: '自动灌装产线与机器设备',
      shot: '全景', camera: '横向平移', transitionToNext: '动作匹配', confidence: 0.93,
    },
    {
      time: '2.5-6.5', purpose: '质检证据', visual: '检测仪器与质检记录',
      shot: '中景', camera: '跟随镜头', transitionToNext: '自然衔接', confidence: 0.91,
    },
  ])],
});

assert.ok(detailReference);
assert.ok(factoryReference);
assert.equal(detailReference.nodes.length, factoryReference.nodes.length, 'fixtures intentionally have the same node count');
assert.notDeepEqual(
  detailReference.nodes.map(node => ({ function: node.shotFunction, subject: node.subject, action: node.action })),
  factoryReference.nodes.map(node => ({ function: node.shotFunction, subject: node.subject, action: node.action })),
  'same-count exact analyses must preserve their different safe shot structures',
);
assert.deepEqual(detailReference.nodes[0]?.referenceStructure.sourceTiming, {
  startSeconds: 0, endSeconds: 2.5, durationSeconds: 2.5,
});
assert.equal(detailReference.nodes[0]?.referenceStructure.shotScale, '极近特写');
assert.equal(detailReference.nodes[1]?.referenceStructure.cameraMovement, '推进镜头');
assert.equal(factoryReference.nodes[0]?.referenceStructure.cameraMovement, '横向摇移');
assert.equal(factoryReference.nodes[1]?.shotFunction, '证据呈现');
assert.equal(detailReference.title, '已分析灵感结构');
const safePayload = JSON.stringify([detailReference, factoryReference]);
for (const forbidden of ['ACME', '张女士', '全网第一', '立刻年轻十岁', '原片专属台词']) {
  assert.doesNotMatch(safePayload, new RegExp(forbidden), `reference output must remove ${forbidden}`);
}

const baseline: StoredSocialScriptBaseline = {
  schemaVersion: SOCIAL_SCRIPT_BASELINE_SCHEMA,
  version: '1',
  source: 'inspiration_script',
  formulaReference: null,
  themeId: 'product_value',
  language: 'zh',
  lockedAt: '2026-09-21T00:00:00.000Z',
  createdBeforeMaterialAdaptation: true,
  scenes: [
    {
      sceneId: 'scene-1', formulaNodeId: null, inspirationNodeId: 'inspiration-1',
      shotFunction: '产品画面展示', subject: '素材中的产品实物', action: '全景 · 固定镜头',
      script: '展示产品实物', voiceover: '展示已确认产品。', caption: '展示已确认产品。', narration: '展示已确认产品。',
    },
    {
      sceneId: 'scene-2', formulaNodeId: null, inspirationNodeId: 'inspiration-2',
      shotFunction: '细节展示', subject: '素材中可见的产品细节', action: '近景特写 · 推进镜头',
      script: '展示产品细节', voiceover: '只呈现可见细节。', caption: '只呈现可见细节。', narration: '只呈现可见细节。',
    },
  ],
};

const sourceAsset = {
  id: 'one-upload', name: '用户原始素材', type: 'video' as const, sourceId: 'source-one', url: '/media/source.mp4',
  duration: 28, visualObservations: ['素材中的产品实物和素材中可见的产品细节'],
};
const oneAnalyzedScene = {
  ...sourceAsset,
  segments: [{
    id: 'analysis-scene-one', start: 0, end: 14, confidence: 0.94, needsReview: false,
    observedFacts: '素材中的产品实物和素材中可见的产品细节',
  }],
};
const before = structuredClone(oneAnalyzedScene);
const rejected = buildSocialProductionPlan({ baseline, assets: [oneAnalyzedScene] });
assert.equal(rejected.ok, false);
assert.equal(rejected.reasonCode, 'insufficient_visual_coverage');
assert.match(rejected.notes.join(' '), /同一片段的切窗不会增加镜头数/);
assert.deepEqual(oneAnalyzedScene, before, 'quality gating must not mutate or delete user material');

const twoAnalyzedScenes = {
  ...sourceAsset,
  segments: [
    { id: 'analysis-scene-one', start: 0, end: 14, confidence: 0.94, needsReview: false, observedFacts: '素材中的产品实物 产品画面展示' },
    { id: 'analysis-scene-two', start: 14, end: 28, confidence: 0.92, needsReview: false, observedFacts: '素材中可见的产品细节 细节展示' },
  ],
};
const accepted = buildSocialProductionPlan({ baseline, assets: [twoAnalyzedScenes] });
assert.equal(accepted.ok, true, accepted.message);
assert.equal(accepted.scenes.length, 2);
assert.equal(new Set(accepted.scenes.map(scene => scene.clip.evidenceShotId)).size, 2,
  'each selected production scene must come from a distinct analyzed scene boundary');

console.log('Social inspiration structure and independent-shot quality tests passed');
