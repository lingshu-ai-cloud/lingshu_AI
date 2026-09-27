import assert from 'node:assert/strict';
import { createSocialAssetSupplyPlan } from '../../shared/socialContentAssetSupply.js';
import type { StoredSocialScriptBaseline } from './socialContentScriptBaseline.js';
import {
  alignSocialAssetSupplyPlanToBaseline,
  executeSocialAssetSupplyPlan,
  type SocialAssetSupplyProviderAdapter,
} from './socialContentAssetSupplyExecution.js';
import { assetSupplyPlanWithExecutionSelections } from './socialContentProductionExecution.js';
import { existingAssetSupplyAdapters } from './socialContentProductionSupport.js';

function baseline(scene: {
  sceneId: string;
  shotFunction: string;
  subject: string;
  action: string;
  voiceover: string;
}): StoredSocialScriptBaseline {
  return {
    schemaVersion: 'social-content-script-baseline.v1',
    version: 'baseline-1',
    source: 'knowledge_fallback',
    formulaReference: null,
    themeId: null,
    language: 'zh',
    lockedAt: '2026-09-28T00:00:00.000Z',
    createdBeforeMaterialAdaptation: true,
    scenes: [{
      sceneId: scene.sceneId,
      formulaNodeId: null,
      shotFunction: scene.shotFunction,
      subject: scene.subject,
      action: scene.action,
      voiceover: scene.voiceover,
      narration: scene.voiceover,
    }],
  };
}

// The candidate approved in the Content-Agent execution plan must become the
// only executable source and exact segment in the supply plan.
const reviewPlan = createSocialAssetSupplyPlan({
  creationMode: 'viral_replication',
  productionApproach: 'material_cut',
  planVersion: 'review-selection-1',
  inventory: { customerVideoIds: ['asset-a', 'asset-b'] },
  shots: [{ shotId: 'scene-hook', function: 'hook', requestedDescription: '产品开场' }],
});
const selectedPlan = assetSupplyPlanWithExecutionSelections(reviewPlan, {
  executionPlan: {
    scenes: [{
      sceneId: 'scene-hook',
      selectedSourceStrategy: 'customer_real_asset',
      fallbackSourceStrategy: null,
      recommendedCandidateIds: ['candidate-b-segment-2'],
      candidates: [{
        candidateId: 'candidate-b-segment-2',
        kind: 'asset',
        sourceRef: 'asset-b',
        sourceStrategy: 'customer_real_asset',
        materialSegments: [{
          segmentId: 'segment-2',
          startSeconds: 4.2,
          endSeconds: 7.1,
        }],
      }],
    }],
  },
} as any);
assert.equal(selectedPlan.shots[0]?.sourceStrategy, 'customer_real_asset');
assert.deepEqual(selectedPlan.shots[0]?.sourceRefs, ['asset-b']);
assert.deepEqual(selectedPlan.shots[0]?.selectedMaterialSegment, {
  sourceRef: 'asset-b', segmentId: 'segment-2', startSeconds: 4.2, endSeconds: 7.1,
});

const hookBaseline = baseline({
  sceneId: 'scene-hook', shotFunction: 'hook', subject: '产品', action: '开场展示', voiceover: '逐句冻结口播',
});
const alignedSelectedPlan = alignSocialAssetSupplyPlanToBaseline({ plan: selectedPlan, baseline: hookBaseline });
assert.equal(alignedSelectedPlan.shots[0]?.sourceStrategy, 'customer_real_asset');
assert.deepEqual(alignedSelectedPlan.shots[0]?.sourceRefs, ['asset-b']);
assert.deepEqual(alignedSelectedPlan.shots[0]?.selectedMaterialSegment, selectedPlan.shots[0]?.selectedMaterialSegment);

const supplied = await executeSocialAssetSupplyPlan({
  tenantId: 'tenant-1',
  taskId: 'task-1',
  outputDirectory: '/tmp',
  plan: selectedPlan,
  baseline: hookBaseline,
  availableAssets: [{
    id: 'asset-a', name: '未审核素材', type: 'video', sourceId: 'asset-a', url: '/tmp/a.mp4', duration: 8,
    visualObservations: ['其他画面'], segments: [{ id: 'segment-a', start: 0, end: 3 }],
  }, {
    id: 'asset-b', name: '审核选中素材', type: 'video', sourceId: 'asset-b', url: '/tmp/b.mp4', duration: 8,
    visualObservations: ['产品开场'], segments: [
      { id: 'segment-1', start: 0, end: 3 },
      { id: 'segment-2', start: 4.2, end: 7.1 },
    ],
  }],
  adapters: existingAssetSupplyAdapters(),
});
assert.deepEqual(supplied.assets.map(asset => asset.id), ['asset-b']);
assert.deepEqual(supplied.assets[0]?.segments.map(segment => segment.id), ['segment-2']);
assert.equal(supplied.execution.shots[0]?.sourceStrategy, 'customer_real_asset');
assert.equal(supplied.execution.shots[0]?.sourceRef, 'asset-b');

// Customer-case evidence must survive baseline alignment as the same real
// material; it must not be reclassified as a presenter or generated visual.
const casePlan = createSocialAssetSupplyPlan({
  creationMode: 'viral_replication',
  productionApproach: 'ai_enhanced',
  inventory: { customerCaseEvidenceAssetIds: ['case-video-1'] },
  shots: [{
    shotId: 'scene-case', function: 'proof', requestedDescription: '真实客户案例',
    truthSensitiveSubject: 'customer_case',
  }],
});
const alignedCasePlan = alignSocialAssetSupplyPlanToBaseline({
  plan: casePlan,
  baseline: baseline({
    sceneId: 'scene-case', shotFunction: '客户案例证明', subject: '真实客户案例',
    action: '展示合作过程', voiceover: '这是客户案例。',
  }),
});
assert.equal(alignedCasePlan.shots[0]?.sourceStrategy, 'customer_real_asset');
assert.deepEqual(alignedCasePlan.shots[0]?.sourceRefs, ['case-video-1']);
assert.equal(alignedCasePlan.shots[0]?.truthBoundary.subject, 'customer_case');

// A presenter shot with an explicit null fallback must remain unavailable when
// no digital-human adapter exists. Motion graphics must never be called.
const presenterLock = {
  socialAccountId: 'account-1', presenterProfileId: 'profile-1', presenterProfileVersion: '1',
  presenterAssetId: 'presenter-1', avatarId: 'avatar-1', voiceProfileId: 'voice-1',
  consentRef: 'consent-1', commercialRightsStatus: 'cleared' as const, status: 'published' as const,
  consistencyKey: 'account-1:profile-1:1',
};
const presenterPlan = createSocialAssetSupplyPlan({
  creationMode: 'material_processing',
  productionApproach: 'ai_enhanced',
  inventory: { presenterAssetIds: ['presenter-1'] },
  accountPresenterLock: presenterLock,
  shots: [{ shotId: 'scene-person', function: 'hook', requestedDescription: '人物将产品涂抹上脸' }],
});
assert.equal(presenterPlan.shots[0]?.sourceStrategy, 'authorized_digital_presenter');
assert.equal(presenterPlan.shots[0]?.fallbackSourceStrategy, null);
let motionGraphicsCalls = 0;
const motionGraphics: SocialAssetSupplyProviderAdapter = {
  adapterId: 'test-motion-graphics',
  sourceStrategies: ['motion_graphics'],
  async execute() {
    motionGraphicsCalls += 1;
    throw new Error('motion_graphics_must_not_run');
  },
};
await assert.rejects(() => executeSocialAssetSupplyPlan({
  tenantId: 'tenant-1',
  taskId: 'task-presenter',
  outputDirectory: '/tmp',
  plan: presenterPlan,
  baseline: baseline({
    sceneId: 'scene-person', shotFunction: 'hook', subject: '人物与产品',
    action: '将产品涂抹上脸', voiceover: '看清楚这个动作。',
  }),
  availableAssets: [],
  adapters: [motionGraphics],
}), /asset_supply_provider_exhausted:scene-person:authorized_digital_presenter:adapter_not_registered/);
assert.equal(motionGraphicsCalls, 0, '数字人缺少适配器时不得静默执行 motion graphics');

console.log('social content asset supply execution regression tests passed');
