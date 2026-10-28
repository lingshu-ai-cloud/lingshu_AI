import {initialMaterialPlanHash} from './socialContentInitialMaterialPlanIdentity.js';
import type {SocialAssetSupplyPlan} from '../../shared/contracts/socialContentReplication.js';
import {recordCurrentContentExecutionCheckpoint} from '../contentExecution/context.js';
import {socialRequestHash} from './socialContentValidation.js';

/** Evidence before voice synthesis. Durations here are reference estimates,
 * never the measured timeline or an authorization to consume paid services. */
export async function blockOnInitialMaterialSupply(input: {
  tenantId: string; taskId: string; runId: string; taskVersion: string;
  plan: SocialAssetSupplyPlan | null | undefined;
  /** Stable reviewed plan identity. A recovered local binding changes the
   * effective plan only for this run and must not create a new task identity. */
  originalPlanHash?: string;
  shootingTaskIds?: Record<string,string>;
  shootingTaskVersions?:Record<string,string>;
  referenceScenes?: Array<{sceneId: string; duration: {startSeconds: number; endSeconds: number}}>;
  record?: typeof recordCurrentContentExecutionCheckpoint;
}): Promise<void> {
  const plan = input.plan;
  if (plan?.materialRoutingPolicyVersion !== 'type-aware.v3') return;
  const pending = plan.shots.flatMap(shot => {
    const route = shot.materialRouting;
    if (route?.pendingReason !== 'awaiting_shoot' && route?.pendingReason !== 'awaiting_theme_material') return [];
    if (!shot.shotId || (route.pendingReason === 'awaiting_shoot' && route.materialType !== 'talking_head')
      || (route.pendingReason === 'awaiting_theme_material' && !['factory', 'product', 'consumer_demo', 'general'].includes(route.materialType))) {
      throw Error('initial_material_pending_invalid');
    }
    const scenes = input.referenceScenes?.filter(scene => scene.sceneId === shot.shotId) ?? [];
    const estimate = scenes.length === 1 ? scenes[0]!.duration.endSeconds - scenes[0]!.duration.startSeconds : undefined;
    const shootingTaskId=route.pendingReason==='awaiting_shoot'?input.shootingTaskIds?.[shot.shotId]:undefined;
    if(route.pendingReason==='awaiting_shoot'&&!shootingTaskId)throw Error('initial_material_shoot_task_missing');
    return [{shotId: shot.shotId, materialType: route.materialType, reason: route.pendingReason,
      ...(shootingTaskId?{shootingTaskId,...(input.shootingTaskVersions?.[shot.shotId]?{shootingTaskVersion:input.shootingTaskVersions[shot.shotId]}:{})}:{}),
      ...(typeof estimate === 'number' && Number.isFinite(estimate) && estimate > 0 ? {referenceDurationSeconds: estimate} : {})}];
  });
  if (!pending.length) return;
  if (!input.tenantId || !input.taskId || !input.runId || !input.taskVersion
    || new Set(plan.shots.map(shot => shot.shotId)).size !== plan.shots.length) throw Error('initial_material_pending_identity_invalid');
  const planHash = input.originalPlanHash ?? initialMaterialPlanHash(plan);
  if (!/^[a-f0-9]{64}$/.test(planHash)) throw Error('initial_material_pending_identity_invalid');
  const evidence = {schemaVersion: 'social-initial-material-block.v1', tenantId: input.tenantId,
    taskId: input.taskId, runId: input.runId, taskVersion: input.taskVersion,
    planHash, status: 'blocked', pending};
  await (input.record ?? recordCurrentContentExecutionCheckpoint)({stage: 'social.initial_material_block', version: '1',
    inputHash: socialRequestHash(evidence), payload: evidence});
  throw Error(`user_input_required:initial_material_supply:${pending.map(row => row.shotId).join(',')}`);
}
