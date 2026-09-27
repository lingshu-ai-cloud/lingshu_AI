import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildSocialShootingPlanArtifactContent,
  SOCIAL_SHOOTING_PLAN_SCHEMA,
} from './socialContentProductionExecution.js';

const detail: any = {
  taskId: 'task-shooting-plan',
  version: '4',
  brief: {
    title: '精华爆款复刻', productRef: null, platforms: ['douyin'], languages: ['zh'],
  },
  referenceVideoAnalysis: { analysisId: 'analysis-1' },
  agentWorkflow: {
    directorBrief: {
      directorBriefId: 'director-1', totalDurationSeconds: 9,
      referenceAnalysis: { analysisId: 'analysis-1' },
      contentRequirements: {
        product: { required: true, productRef: 'serum-a', confidence: 0.8, reason: '素材自动选定' },
      },
      scenes: [{
        sceneId: 'scene-hook', order: 1, purpose: 'hook', targetVisual: '人物将精华涂抹上脸',
        duration: { startSeconds: 0, endSeconds: 3, targetSeconds: 3 },
        audioLayers: { voiceover: '前三秒锁定的逐字口播', captionIntent: '核心卖点' },
        action: { startState: '手持精华', path: '按压并涂抹', endState: '展示面部' },
        shotLanguage: { shotSize: '近景', cameraAngle: '平视', movement: '轻推', composition: '面部和手部清晰' },
        spaceAndContinuity: ['产品外观一致'], requiredEvidence: [], acceptanceCriteria: ['产品接触位置准确'],
        truthBoundary: { subject: 'product_effect' }, productSceneReplication: null,
      }],
    },
  },
};

const content: any = buildSocialShootingPlanArtifactContent(detail);
assert.equal(content.workflowSchema, SOCIAL_SHOOTING_PLAN_SCHEMA);
assert.equal(content.contentType, 'shooting_plan');
assert.equal(content.productionMode, 'non_rendering_checklist');
assert.equal(content.providerCallsRequired, false);
assert.equal(content.product.productRef, 'serum-a');
assert.equal(content.hook.precision, 'hook_high');
assert.equal(content.scenes[0].voiceover, '前三秒锁定的逐字口播');
assert.equal(content.scenes[0].action.path, '按压并涂抹');
assert.equal(content.scenes[0].hookPrecision, true);

const source = fs.readFileSync(new URL('./socialContentProductionExecution.ts', import.meta.url), 'utf8');
const earlyBranch = source.indexOf("if (productionApproach === 'shooting_plan')");
const renderWorkspace = source.indexOf('await withSocialContentRenderWorkspace(');
assert.ok(earlyBranch >= 0 && renderWorkspace >= 0 && earlyBranch < renderWorkspace,
  'shooting_plan must return before opening a render workspace');
assert.match(source, /kind: 'shooting_plan'[\s\S]*?finishShootingPlanExecution[\s\S]*?return;/);
const shootingPlanFinalizer = source.slice(
  source.indexOf('async function finishShootingPlanExecution'),
  source.indexOf('export async function runSocialContentAutoProduction'),
);
assert.doesNotMatch(shootingPlanFinalizer, /finishExecution\(/,
  'shooting plans must not enter the video delivery/publishing finalizer');
assert.match(shootingPlanFinalizer, /stage: 'review_ready'[\s\S]*?status: 'completed'/);

console.log('social content shooting-plan execution tests passed');
