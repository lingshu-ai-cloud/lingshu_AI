import assert from 'node:assert/strict';
import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow.js';
import {
  contentAchievementSummary,
  contentPreflightItems,
  contentProductionExceptions,
  contentProgressNodes,
  contentShotProgress,
} from './contentProductionExperience.js';

const task = {
  taskId: 'task-1',
  status: 'producing',
  version: '1',
  runId: 'run-1',
  createdAt: '2026-10-03T01:00:00.000Z',
  updatedAt: '2026-10-03T01:05:00.000Z',
  brief: { title: '新品演示', platforms: ['tiktok'], targetAccountRef: null },
  readiness: { complete: true, missing: [] },
  directorPlan: { status: 'ready', sceneCount: 2, createdAt: '2026-10-03T01:01:00.000Z' },
  artifacts: [],
  productionProgress: { step: '内容制作', activity: '正在制作镜头', estimatedRemainingSeconds: 420, updatedAt: '2026-10-03T01:05:00.000Z' },
  agentWorkflow: {
    stage: 'producing',
    directorBrief: {
      accountRefs: [],
      totalDurationSeconds: 16,
      scenes: [
        { sceneId: 'scene-1', purpose: 'hook', targetVisual: '产品开场', duration: { startSeconds: 0, endSeconds: 6, targetSeconds: 6 } },
        { sceneId: 'scene-2', purpose: 'proof', targetVisual: '质检证明', duration: { startSeconds: 6, endSeconds: 16, targetSeconds: 10 } },
      ],
    },
    executionPlan: {
      estimatedTotalCostCny: 28,
      budgetLimitCny: 20,
      estimatedTotalSeconds: 600,
      scenes: [
        { sceneId: 'scene-1', selectedSourceStrategy: 'customer_real_asset', feasibility: 'full_fidelity', feasibilityReason: '', estimatedCostCny: 0, estimatedSeconds: 30 },
        { sceneId: 'scene-2', selectedSourceStrategy: 'aigc_product_scene_replication', feasibility: 'blocked_for_facts_or_rights', feasibilityReason: '缺少真实质检画面', estimatedCostCny: 28, estimatedSeconds: 120 },
      ],
    },
    executionPlanReview: {
      reasonCodes: ['material_insufficient', 'budget_exceeded'],
      sceneResults: [
        { sceneId: 'scene-1', approved: true, reasonCodes: [], failedCriteria: [], requiredRevision: [] },
        { sceneId: 'scene-2', approved: false, reasonCodes: ['material_insufficient'], failedCriteria: ['缺少质检证据'], requiredRevision: ['补充质检素材'] },
      ],
    },
    productionResult: null,
  },
} as unknown as SocialContentTaskDetail;

const nodes = contentProgressNodes(task);
assert.equal(nodes.length, 7);
assert.equal(nodes[0]?.state, 'complete');
assert.equal(nodes[3]?.state, 'active');

const preflight = contentPreflightItems(task);
assert.equal(preflight.find(item => item.id === 'materials')?.state, 'blocked');
assert.match(preflight.find(item => item.id === 'materials')?.value || '', /1 镜已有/);
assert.equal(preflight.find(item => item.id === 'account')?.state, 'warning');
assert.equal(preflight.find(item => item.id === 'budget')?.state, 'blocked');
assert.match(preflight.find(item => item.id === 'time')?.value || '', /分钟/);

const shots = contentShotProgress(task);
assert.equal(shots.length, 2);
assert.equal(shots[0]?.state, 'producing');
assert.equal(shots[0]?.sourceLabel, '使用已授权的真实素材');

const exceptions = contentProductionExceptions(task);
assert.equal(exceptions.some(item => item.kind === 'missing_material'), true);
assert.equal(exceptions.find(item => item.kind === 'missing_material')?.affectedSceneIds[0], 'scene-2');

const completed = {
  ...task,
  status: 'asset_review',
  artifacts: [{ artifactId: 'a1', status: 'review_required', kind: 'video' }],
  agentWorkflow: {
    ...task.agentWorkflow!,
    stage: 'asset_review',
    productionResult: {
      sceneResults: [{ sceneId: 'scene-1' }, { sceneId: 'scene-2' }],
      technicalReview: { approved: true },
      creativeReview: { approved: true },
    },
  },
} as unknown as SocialContentTaskDetail;
const achievement = contentAchievementSummary(completed);
assert.equal(achievement.visible, true);
assert.equal(achievement.completedScenes, 2);
assert.equal(achievement.artifactCount, 1);

console.log('content production experience tests passed');

const waitingForAssets = {
 ...task,
 directorPlan: null,
 productionProgress: {step:'等待素材与资产排期',activity:'原运行已保存分镜意图',estimatedRemainingSeconds:null,waitingForScheduledAssets:true,updatedAt:task.updatedAt},
 agentWorkflow:{...task.agentWorkflow!,stage:'producing',productionResult:null,replicationEvaluation:null},
} as unknown as SocialContentTaskDetail;
const waitingNodes=contentProgressNodes(waitingForAssets);
assert.equal(waitingNodes.find(node=>node.id==='script')!.state,'complete');
assert.match(waitingNodes.find(node=>node.id==='script')!.result,/已保存/);
assert.equal(waitingNodes.find(node=>node.id==='shots')!.state,'blocked');
assert.match(waitingNodes.find(node=>node.id==='shots')!.result,/继续原作业/);
assert.equal(waitingNodes.some(node=>node.state==='active'||node.state==='failed'),false);
assert.equal(waitingNodes.find(node=>node.id==='edit')!.state,'pending');
assert.equal(contentAchievementSummary(waitingForAssets).visible,false);
