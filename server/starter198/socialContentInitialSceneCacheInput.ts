import type { SocialContentAgentWorkflow } from '../../shared/contracts/socialContentAgentContract.js';
import type { SocialAssetSupplyPlan } from '../../shared/contracts/socialContentWorkflow.js';
import type { SocialReferenceVideoAnalysis } from '../../shared/contracts/socialContentReplication.js';
import type { PresenterMotherExecutionResult } from './presenterMotherSegmentExecution.js';
import type { SocialAssetSupplyExecution } from './socialContentAssetSupplyExecution.js';
import type { SocialDirectorContentHandoff } from './socialContentDirectorPlan.js';
import type { InitialSceneQualityReport, persistInitialSocialSceneCache } from './socialContentInitialSceneCache.js';
import type { SocialProductionAsset } from './socialContentProductionPlan.js';
import { socialProductionExecutionSceneForFinal } from './socialContentProductionCollaboration.js';
import { buildSocialProductionHandoff, type SocialVariantDifference } from './socialContentProductionHandoff.js';
import type { StoredSocialScriptBaseline } from './socialContentScriptBaseline.js';
import { socialRequestHash } from './socialContentValidation.js';

export type InitialSocialSceneCacheInput = Omit<
  Parameters<typeof persistInitialSocialSceneCache>[0],
  'repository' | 'artifactId'
>;

export interface BuildInitialSocialSceneCacheInput {
  tenantId: string;
  taskId: string;
  runId: string;
  productionResultId: string;
  workflow: SocialContentAgentWorkflow;
  referenceAnalysis: SocialReferenceVideoAnalysis | null;
  plan: SocialAssetSupplyPlan;
  baseline: StoredSocialScriptBaseline;
  execution: SocialAssetSupplyExecution;
  assets: SocialProductionAsset[];
  contentHandoff: Pick<SocialDirectorContentHandoff, 'scenes'>;
  manifest: Record<string, unknown>;
  voicePath: string;
  bgmUrl: string | null;
  report: InitialSceneQualityReport;
  coverSha256: string;
  renderSha256: string;
  captionCues: unknown;
  adaptedScript: unknown;
  timeline: unknown[];
  presenterMotherExecution?: PresenterMotherExecutionResult;
  measuredVoiceProof?: import('./socialContentSceneReworkMeasuredVoice.js').SceneReworkMeasuredVoiceProof;
}

function initialVariant(input: BuildInitialSocialSceneCacheInput): SocialVariantDifference {
  const surface = (value: unknown) => ({ baseline: null, current: socialRequestHash(value) });
  return {
    variantId: input.productionResultId,
    baselineVariantId: null,
    changedSceneIds: [],
    dimensions: [],
    hypothesis: '按已锁定编导执行方案建立首次成片基线，尚无对照变体和提升结论。',
    unchangedConstraints: ['已锁定事实', '逐镜真实供给', '来源和权利边界'],
    surfaceHashes: {
      firstThreeSeconds: surface(input.timeline[0]),
      caption: surface(input.captionCues),
      cover: surface(input.coverSha256),
      cta: surface(input.contentHandoff.scenes.at(-1)),
      copy: surface(input.adaptedScript),
      render: surface(input.renderSha256),
    },
  };
}

/**
 * Converts the finalized render contract into the existing scene-cache input.
 * Reference and authored productions share one cache and rework path; only the
 * immutable source lineage of the production handoff differs.
 */
export function buildInitialSocialSceneCacheInput(
  input: BuildInitialSocialSceneCacheInput,
): InitialSocialSceneCacheInput {
  const common = {
    taskId: input.taskId,
    version: input.workflow.executionPlan.version,
    directorBrief: input.workflow.directorBrief,
    executionPlan: input.workflow.executionPlan,
    executionPlanReview: input.workflow.executionPlanReview,
    adHocBusinessContext: input.workflow.adHocBusinessContext,
    variantDifference: initialVariant(input),
  };
  const handoff = input.referenceAnalysis
    ? buildSocialProductionHandoff({ ...common, sourceAnalysis: input.referenceAnalysis })
    : buildSocialProductionHandoff({ ...common, sourceKind: 'original_scene', sourceAnalysis: null });
  const productionSceneIds = input.contentHandoff.scenes.map(scene => {
    const executionScene = socialProductionExecutionSceneForFinal(input.workflow, scene.sceneId);
    if (!executionScene) throw Error(`scene_cache_execution_scene_missing:${scene.sceneId}`);
    return executionScene.sceneId;
  });
  return {
    tenantId: input.tenantId,
    taskId: input.taskId,
    runId: input.runId,
    handoff,
    plan: input.plan,
    baseline: input.baseline,
    execution: input.execution,
    assets: input.assets,
    productionSceneIds,
    manifest: input.manifest,
    voicePath: input.voicePath,
    bgmUrl: input.bgmUrl,
    report: input.report,
    ...(input.presenterMotherExecution ? { presenterMotherExecution: input.presenterMotherExecution } : {}),
    ...(input.measuredVoiceProof ? { measuredVoiceProof: input.measuredVoiceProof } : {}),
  };
}
