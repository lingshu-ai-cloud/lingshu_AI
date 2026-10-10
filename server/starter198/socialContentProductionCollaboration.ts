import type { SocialContentAgentWorkflow } from '../../shared/contracts/socialContentAgentContract.js';
import type { SocialDirectorContentHandoff } from './socialContentDirectorPlan.js';

function directorSceneForFinal(workflow: SocialContentAgentWorkflow, finalSceneId: string) {
  const direct = workflow.directorBrief.scenes.find(scene => scene.sceneId === finalSceneId);
  if (direct) return direct;
  const ordinal = /^scene-(\d+)$/.exec(finalSceneId)?.[1];
  return ordinal
    ? workflow.directorBrief.scenes.find(scene => scene.order === Number(ordinal)) ?? null
    : null;
}

export function socialProductionExecutionSceneForFinal(
  workflow: SocialContentAgentWorkflow,
  finalSceneId: string,
) {
  const directorScene = directorSceneForFinal(workflow, finalSceneId);
  if (!directorScene) return null;
  return workflow.executionPlan.scenes.find(scene => scene.sceneId === directorScene.sceneId) ?? null;
}

export function socialProductionCollaborationFailures(
  workflow: SocialContentAgentWorkflow,
  handoff: SocialDirectorContentHandoff,
): string[] {
  const reviewById = new Map(workflow.executionPlanReview.sceneResults.map(scene => [scene.sceneId, scene]));
  const finalSceneIds = handoff.scenes.map(scene => scene.sceneId);
  const uniqueFinalSceneIds = new Set(finalSceneIds);
  return [
    ...(workflow.executionPlanReview.approved ? [] : ['内容执行方案未通过编导审核']),
    ...(handoff.scenes.length > 0 ? [] : ['成片没有可验收的镜头']),
    ...(uniqueFinalSceneIds.size === finalSceneIds.length ? [] : ['最终成片包含重复镜头身份']),
    ...(handoff.scenes.every(scene => Boolean(directorSceneForFinal(workflow, scene.sceneId))) ? [] : ['最终镜头未全部来自 DirectorBrief']),
    ...(handoff.scenes.every(scene => Boolean(socialProductionExecutionSceneForFinal(workflow, scene.sceneId))) ? [] : ['最终镜头未全部来自 ContentExecutionPlan']),
    ...(handoff.scenes.every(scene => {
      const execution = socialProductionExecutionSceneForFinal(workflow, scene.sceneId);
      return execution && reviewById.get(execution.sceneId)?.approved === true;
    })
      ? [] : ['最终逐镜链路未全部经过编导审核']),
    ...(handoff.scenes.every(scene => (directorSceneForFinal(workflow, scene.sceneId)?.acceptanceCriteria.length ?? 0) > 0)
      ? [] : ['存在没有可观察验收条件的分镜']),
  ];
}

export function socialProductionCollaborationTrace(
  workflow: SocialContentAgentWorkflow,
  handoff: SocialDirectorContentHandoff,
) {
  return {
    ...(handoff.collaboration ?? {}),
    finalExecutionLock: {
      directorPlanId: handoff.directorPlanId,
      version: handoff.planVersion,
      lineageHash: handoff.lineageHash,
      handoffHash: handoff.handoffHash,
    },
    sceneLineage: handoff.scenes.map((scene, index) => {
      const directorScene = directorSceneForFinal(workflow, scene.sceneId);
      const executionScene = socialProductionExecutionSceneForFinal(workflow, scene.sceneId);
      return {
        order: index + 1,
        finalSceneId: scene.sceneId,
        directorSceneId: directorScene?.sceneId ?? null,
        executionSceneId: executionScene?.sceneId ?? null,
        reviewApproved: workflow.executionPlanReview.sceneResults
          .find(item => item.sceneId === executionScene?.sceneId)?.approved === true,
        assetId: scene.source.assetId,
        clipId: scene.source.clipId,
      };
    }),
  };
}
