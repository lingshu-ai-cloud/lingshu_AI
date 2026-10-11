import type { SocialAssetSupplyPlan, SocialReplicationScriptVersion } from '../../shared/contracts/socialContentWorkflow.js';
import { socialJson, socialObject, socialRequestHash, socialText, SocialContentWorkflowError } from './socialContentValidation.js';

/** Read-only projection of the server-frozen revision; ordinary plans are unchanged.
 * The old script remains visible until normal start installs the exact new draft.
 * This carries supply contracts, never supplier completion or human approval. */
export function applySocialContentRevisionSupply(input: {
  tenantId: string; taskId: string; brief: unknown; script: SocialReplicationScriptVersion | null; plan: SocialAssetSupplyPlan;
}): SocialAssetSupplyPlan {
  const marker = socialObject(socialObject(socialJson(input.brief))?._productionRevision);
  if (!marker) return input.plan;
  const { planHash, preparedBy: _actor, preparedAt: _time, ...immutable } = marker;
  if (marker.schemaVersion !== 'social-production-revision.v1' || marker.tenantId !== input.tenantId || marker.taskId !== input.taskId
    || !/^[a-f0-9]{64}$/.test(socialText(planHash)) || socialRequestHash(immutable) !== planHash)
    throw new SocialContentWorkflowError('social_revision_plan_corrupt', 409);
  const expected = socialObject(socialObject(marker.resolved)?.replicationScript) as unknown as SocialReplicationScriptVersion | null;
  if (!expected || !Array.isArray(expected.shots) || expected.shots.length !== 8) throw new SocialContentWorkflowError('social_revision_plan_corrupt', 409);
  if (!input.script || input.script.version !== expected.version) return input.plan;
  if (socialRequestHash({ ...input.script, status: 'draft' }) !== socialRequestHash({ ...expected, status: 'draft' }))
    throw new SocialContentWorkflowError('social_revision_script_changed', 409);
  if (input.plan.shots.length !== 8) throw new SocialContentWorkflowError('social_revision_scene_projection_changed', 409);
  return { ...input.plan, shots: input.plan.shots.map(projected => {
    const source = expected.shots.find(shot => shot.shotId === projected.shotId);
    if (!source || source.scriptOrigin !== 'independent_revision' || !source.materialPlan || source.materialPlan.shotId !== source.shotId)
      throw new SocialContentWorkflowError('social_revision_scene_projection_changed', 409);
    return { ...projected, ...structuredClone(source.materialPlan), shotId: source.shotId };
  }) };
}
