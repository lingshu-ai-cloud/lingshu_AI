import type {SocialAssetSupplyPlan} from '../../shared/contracts/socialContentReplication.js';
import {recordCurrentContentExecutionCheckpoint} from '../contentExecution/context.js';
import {socialRequestHash} from './socialContentValidation.js';
import {verifiedMissingLabelIdentity} from './socialContentMissingLabelIdentity.js';

/** Record what is known without inventing a label or treating a local check as a model analysis. */
export async function blockOnMissingBenchmarkLabels(input: {
  tenantId: string; taskId: string; runId: string; taskVersion: string;
  plan: SocialAssetSupplyPlan | null | undefined;
  sourceIdentity?: Omit<Parameters<typeof verifiedMissingLabelIdentity>[0], 'tenantId' | 'slotIds'>;
  analysisStatus?: 'unavailable' | 'completed_unresolved';
  record?: typeof recordCurrentContentExecutionCheckpoint;
}): Promise<void> {
  const plan = input.plan;
  if (plan?.materialRoutingPolicyVersion !== 'type-aware.v3') return;
  const pending = plan.shots.filter(shot => shot.materialRouting?.materialType === 'unknown'
    || shot.materialRouting?.pendingReason === 'material_label_unresolved')
    .map(shot => {
      if (shot.materialRouting?.materialType !== 'unknown' || !/^[\w:.-]{1,120}$/.test(shot.shotId))
        throw Error('benchmark_label_pending_invalid');
      return {shotId: shot.shotId, reason: 'material_label_unresolved' as const};
    });
  if (!pending.length) return;
  if (!input.tenantId || !input.taskId || !input.runId || !input.taskVersion
    || new Set(plan.shots.map(shot => shot.shotId)).size !== plan.shots.length)
    throw Error('benchmark_label_pending_identity_invalid');
  const sourceIdentity = input.sourceIdentity ? await verifiedMissingLabelIdentity({tenantId: input.tenantId,
    slotIds: pending.map(row => row.shotId), ...input.sourceIdentity}) : null;
  const evidence = {schemaVersion: 'social-benchmark-label-block.v1', tenantId: input.tenantId,
    taskId: input.taskId, runId: input.runId, taskVersion: input.taskVersion, planHash: socialRequestHash(plan),
    status: 'blocked', pending, analysisStatus: input.analysisStatus ?? 'unavailable', sourceIdentity};
  await (input.record ?? recordCurrentContentExecutionCheckpoint)({stage: 'social.benchmark_label_block', version: '1',
    inputHash: socialRequestHash(evidence), payload: evidence});
  throw Error(`user_input_required:benchmark_label_unresolved:${pending.map(row => row.shotId).join(',')}`);
}
