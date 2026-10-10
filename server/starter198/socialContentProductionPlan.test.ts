import assert from 'node:assert/strict';
import { buildMaterialScriptAnalysis } from '../../shared/materialScriptAnalysis.js';
import { normalizeSceneVisualContract } from '../../shared/sceneVisualContract.js';
import type { StoredSocialScriptBaseline } from './socialContentScriptBaseline.js';
import {
  buildPlannedTimeline,
  buildSocialProductionPlan,
  type SocialProductionAsset,
} from './socialContentProductionPlan.js';

const baseline: StoredSocialScriptBaseline = {
  schemaVersion: 'social-content-script-baseline.v1',
  version: 'frozen-voiceover-v1',
  source: 'formula',
  formulaReference: { formulaId: 'test-formula', version: '1' },
  themeId: 'product_value',
  language: 'zh',
  lockedAt: '2026-09-27T00:00:00.000Z',
  createdBeforeMaterialAdaptation: true,
  scenes: [
    { sceneId: 'scene-use', formulaNodeId: 'use', shotFunction: '演示', subject: '人物使用精华',
      action: '人物在浴室打开并挤出精华', script: '旧脚本字段', voiceover: '打开瓶盖，挤出精华。',
      narration: '不得用于匹配的旧 narration' },
    { sceneId: 'scene-product', formulaNodeId: 'product', shotFunction: '产品展示', subject: '精华包装',
      action: '旋转展示包装标签', voiceover: '旋转展示包装标签。', narration: '另一个旧 narration' },
  ],
};

const expectedUse = normalizeSceneVisualContract({
  subjects: ['人物', '精华产品'], interaction: '人物打开并使用精华产品', environment: '浴室',
  productUsage: { description: '挤出精华', productRef: 'serum-a' },
  product: { policy: 'locked', requestedProductRef: 'serum-a', source: 'user_explicit' },
  action: { path: '打开瓶盖并挤出精华' }, precision: 'hook_high',
});
const expectedProduct = normalizeSceneVisualContract({
  subjects: ['精华产品'], interaction: '产品旋转展示', environment: '摄影棚',
  productUsage: { description: '产品展示', productRef: 'serum-a' },
  product: { policy: 'locked', requestedProductRef: 'serum-a', source: 'user_explicit' },
  action: { path: '旋转展示包装标签' },
});
(baseline.scenes[0] as typeof baseline.scenes[number] & { visualContract: unknown }).visualContract = expectedUse;
(baseline.scenes[1] as typeof baseline.scenes[number] & { visualContract: unknown }).visualContract = expectedProduct;

function asset(input: {
  id: string;
  observedFacts: string;
  subject: string[];
  action: string;
  interaction: string;
  environment: string;
  productRef: string;
  cleanStart?: number;
  cleanEnd?: number;
}): SocialProductionAsset {
  const segment = {
    id: `${input.id}-segment`, start: 0, end: 3.2, confidence: 0.96, needsReview: false,
    observedFacts: [input.observedFacts], subject: input.subject, action: input.action,
    interaction: input.interaction, environment: input.environment,
    productUsage: { description: input.action, productRef: input.productRef },
    productRef: input.productRef,
    boundaryConfidence: 0.92, cleanEntry: true, cleanExit: true,
    cleanStart: input.cleanStart ?? 0.2, cleanEnd: input.cleanEnd ?? 3,
  };
  return {
    id: input.id, name: input.id, type: 'video', sourceId: `${input.id}-source`,
    url: `/tmp/${input.id}.mp4`, duration: 3.2, visualObservations: [input.observedFacts],
    segments: [segment], selectionOrigin: 'tenant_library',
    scriptAnalysis: buildMaterialScriptAnalysis({
      materialId: input.id, name: input.id, sourceRevision: 'revision-1', duration: 3.2,
      segments: [segment], productRef: input.productRef, productPolicy: 'preferred',
      analyzedAt: '2026-09-27T00:00:00.000Z',
    }),
  };
}

const voiceoverMatch = asset({
  id: 'voiceover-primary', observedFacts: '打开瓶盖，挤出精华，动作完整清晰',
  subject: ['精华产品'], action: '打开瓶盖并挤出精华', interaction: '产品开盖',
  environment: '摄影棚', productRef: 'serum-a', cleanStart: 0.25, cleanEnd: 2.95,
});
const visualOnlyMatch = asset({
  id: 'visual-secondary', observedFacts: '人物在浴室护理',
  subject: ['人物', '精华产品'], action: '人物在浴室护理', interaction: '人物使用产品',
  environment: '浴室', productRef: 'serum-a',
});
const wrongLockedProduct = asset({
  id: 'wrong-locked-product', observedFacts: '旋转展示包装标签',
  subject: ['精华产品'], action: '旋转展示包装标签', interaction: '产品旋转展示',
  environment: '摄影棚', productRef: 'serum-b',
});
const correctProduct = asset({
  id: 'correct-product', observedFacts: '包装标签清晰可见，产品缓慢旋转',
  subject: ['精华产品'], action: '产品缓慢旋转并展示标签', interaction: '产品旋转展示',
  environment: '摄影棚', productRef: 'serum-a', cleanStart: 0.4, cleanEnd: 3.1,
});

const plan = buildSocialProductionPlan({
  baseline,
  assets: [visualOnlyMatch, wrongLockedProduct, correctProduct, voiceoverMatch],
});
assert.equal(plan.ok, true, plan.message);
assert.equal(plan.scenes[0]?.clip.assetId, 'voiceover-primary',
  '冻结口播逐句匹配必须先于 SceneVisualContract 相似度排序');
assert.equal(plan.scenes[0]?.matchBasis?.voiceover, '打开瓶盖，挤出精华。');
assert.equal(plan.scenes[1]?.clip.assetId, 'correct-product',
  'locked 产品不允许选择口播更相似但产品不兼容的片段');
assert.ok((plan.scenes[1]?.matchBasis?.productCompatibilityScore ?? 0) > 0);
for (const scene of plan.scenes) {
  assert.deepEqual(scene.matchBasis?.lockedSourceRange, {
    evidenceShotId: scene.clip.evidenceShotId,
    startSeconds: scene.clip.start,
    endSeconds: scene.clip.end,
  }, '内容 Agent 必须锁定最终选中素材的真实裁切时间段');
}
assert.deepEqual(plan.scenes[0]?.matchBasis?.lockedSourceRange, {
  evidenceShotId: 'voiceover-primary:voiceover-primary-segment',
  startSeconds: 0.25,
  endSeconds: 2.95,
});
const timeline = buildPlannedTimeline({
  plan,
  assets: [visualOnlyMatch, wrongLockedProduct, correctProduct, voiceoverMatch],
  duration: plan.maxDuration,
});
assert.equal(timeline[0]?.trimStart, plan.scenes[0]?.matchBasis?.lockedSourceRange.startSeconds);
assert.ok((timeline[0]?.trimEnd ?? Infinity) <= (plan.scenes[0]?.matchBasis?.lockedSourceRange.endSeconds ?? 0));
const driftedPlan = structuredClone(plan);
driftedPlan.scenes[0]!.clip.start += 0.1;
assert.throws(() => buildPlannedTimeline({
  plan: driftedPlan,
  assets: [visualOnlyMatch, wrongLockedProduct, correctProduct, voiceoverMatch],
  duration: driftedPlan.maxDuration,
}), /production_plan_locked_source_range_mismatch/);

const sameBytes = 'a'.repeat(64);
const routedDuplicateVisuals: SocialProductionAsset[] = baseline.scenes.map((scene, index) => ({
  id: `scene-owned-${index}`, name: `场景 ${index + 1}`, type: 'video',
  sourceId: `scene-source-${index}`, url: `/tmp/scene-${index}.mp4`, localPath: `/tmp/scene-${index}.mp4`,
  contentHash: sameBytes, duration: 2.8, visualObservations: ['同一合法画面可由多个冻结场景复用'],
  segments: [], selectionOrigin: 'system_graphic',
}));
const routedDuplicatePlan = buildSocialProductionPlan({
  baseline, assets: routedDuplicateVisuals,
  routedSceneAssets: baseline.scenes.map((scene, index) => ({ sceneId: scene.sceneId, assetId: `scene-owned-${index}` })),
});
assert.equal(routedDuplicatePlan.ok, true, routedDuplicatePlan.message);
assert.equal(routedDuplicatePlan.scenes.length, baseline.scenes.length,
  '逐镜路由必须保留内容哈希相同但场景身份不同的合法视频');

console.log('social content production plan matching tests passed');
