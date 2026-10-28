import {readInitialMaterialRecoveryDetail} from './socialContentInitialMaterialRecoveryDetail.js';
import {initialMaterialPlanHash} from './socialContentInitialMaterialPlanIdentity.js';
import { z } from 'zod';
import type { Starter198Repository } from './repository.js';
import { readSocialTaskDetail, requireSocialTask } from './socialContentRecords.js';
import { SocialContentWorkflowError, socialRequestHash, socialText } from './socialContentValidation.js';
import { readContentExecutionJob, controlContentExecutionJob } from '../contentExecution/durableQueue.js';
import { amendCanonicalUnsubmittedVoiceRoute } from './socialContentVoiceRouteControl.js';
import { MATERIAL_RECOVERY_STAGE, materialRecoveryScopeHash, validateMeasuredMaterialRecovery, type MaterialRecoverySelections } from './socialContentMaterialRecovery.js';
import {validateInitialShootPresenter} from './socialContentInitialShootTask.js';

const recoveryIdentity = z.object({
  jobId: z.string().trim().min(1).max(200),
  runId: z.string().trim().min(1).max(200),
  expectedVersion: z.string().trim().min(1).max(200),
});
export const executionRecoveryInput = z.union([recoveryIdentity.extend({
  action: z.literal('retry_failed_native_voice').optional(),
  failedOperationId: z.string().regex(/^paid-plan:[a-f0-9]{64}$/),
}).strict(), recoveryIdentity.extend({ action: z.literal('resume_existing_execution') }).strict(),
recoveryIdentity.extend({ action: z.literal('resume_material_supply'), slotId: z.string().trim().min(1).max(200),
  materialId: z.string().trim().min(1).max(200) }).strict(),
recoveryIdentity.extend({action:z.literal('resume_presenter_supply'),slotId:z.string().trim().min(1).max(200),
  shootingTaskId:z.string().trim().min(1).max(200),presenterAssetId:z.string().trim().min(1).max(200)}).strict()]);
type RecoveryCommand = z.infer<typeof executionRecoveryInput>;
type RecoveryPorts = {
  amend?: typeof amendCanonicalUnsubmittedVoiceRoute;
  control?: typeof controlContentExecutionJob;
};

/** Recover the original order, never create a new content task or accept a
 * caller supplied price/person/credit limit. The domain control re-verifies
 * the failed supplier receipt while holding the original control lease. */
export async function recoverSocialContentExecution(input: {
  repository: Starter198Repository; tenantId: string; userId: string;
  taskId: string; command: RecoveryCommand; idempotencyKey: string;
}, ports: RecoveryPorts = {}) {
  const store = input.repository.dataStore;
  if (!store) throw new SocialContentWorkflowError('content_execution_storage_unavailable', 503);
  const task = await requireSocialTask(input);
  const command = executionRecoveryInput.parse(input.command);
  if (socialText(task.version) !== command.expectedVersion || task.run_id !== command.runId)
    throw new SocialContentWorkflowError('content_execution_recovery_task_changed', 409);
  const job = await readContentExecutionJob(store, input.tenantId, input.taskId, command.runId);
  if (!job || job.id !== command.jobId)
    throw new SocialContentWorkflowError('content_execution_recovery_job_changed', 409);
  if (command.action === 'resume_material_supply'||command.action==='resume_presenter_supply') {
    const resumed = await (ports.control || controlContentExecutionJob)({ dataStore: store,
      tenantId: input.tenantId, jobId: job.id, action: job.status === 'paused' ? 'resume' : 'retry',
      beforeApply: async () => {
        const currentTask = await requireSocialTask(input);
        if (socialText(currentTask.version) !== command.expectedVersion || currentTask.run_id !== command.runId)
          throw new SocialContentWorkflowError('content_execution_recovery_task_changed', 409);
        const current = await readContentExecutionJob(store, input.tenantId, input.taskId, command.runId);
        if (!current || current.id !== command.jobId) throw new SocialContentWorkflowError('content_execution_recovery_job_changed', 409);
        const scopeHash = materialRecoveryScopeHash(input.tenantId, input.taskId, command.runId);
        const old = current.checkpoints[MATERIAL_RECOVERY_STAGE];
        const oldPayload = old?.payload as MaterialRecoverySelections | undefined;
        if (old && (old.version !== '1' || old.inputHash !== scopeHash || oldPayload?.tenantId !== input.tenantId
          || oldPayload.taskId !== input.taskId || oldPayload.runId !== command.runId || !oldPayload.selections))
          throw new SocialContentWorkflowError('content_execution_material_recovery_binding_changed', 409);
        if (['queued', 'running', 'retry_wait', 'reconciling'].includes(current.status)) {
          const prior=oldPayload?.selections[command.slotId];
          if (command.action==='resume_material_supply'&&prior?.materialId === command.materialId
           ||command.action==='resume_presenter_supply'&&prior?.presenterAssetId===command.presenterAssetId
            &&prior.shootingTaskId===command.shootingTaskId)return;
          throw new SocialContentWorkflowError('content_execution_material_recovery_binding_changed', 409);
        }
        if (!['blocked', 'paused'].includes(current.status) || current.workerId || current.leaseExpiresAt
          || ['submitting', 'accepted', 'unknown'].includes(current.providerState)
          || current.providerReceipts.some(receipt => ['submitting', 'accepted', 'unknown'].includes(receipt.state)))
          throw new SocialContentWorkflowError('content_execution_recovery_original_receipt_required', 409);
        const detail=command.action==='resume_presenter_supply'||!current.checkpoints['social.measured_local_materials']
          &&Boolean(current.checkpoints['social.initial_material_block'])?await readInitialMaterialRecoveryDetail({...input,job:current}):null;
        let verified:MaterialRecoverySelections['selections'][string];
        if(command.action==='resume_presenter_supply'){
          const checkpoint=current.checkpoints['social.initial_material_block'],evidence=checkpoint?.payload as Record<string,unknown>|undefined;
          const pending=Array.isArray(evidence?.pending)?evidence.pending.filter((row:any)=>row?.shotId===command.slotId&&row.reason==='awaiting_shoot'):[];
          const plan=detail?.assetSupplyPlan,planHash=plan?initialMaterialPlanHash(plan):'';
          if(!checkpoint||checkpoint.version!=='1'||checkpoint.inputHash!==socialRequestHash(evidence)||evidence?.tenantId!==input.tenantId
           ||evidence.taskId!==input.taskId||evidence.runId!==command.runId||typeof evidence.taskVersion!=='string'||!evidence.taskVersion
           ||evidence.planHash!==planHash||pending.length!==1)throw new SocialContentWorkflowError('content_execution_material_recovery_slot_not_pending',409);
          const presenter=await validateInitialShootPresenter({store,tenantId:input.tenantId,taskId:input.taskId,
           runId:command.runId,taskVersion:String((pending[0] as Record<string,unknown>).shootingTaskVersion??evidence.taskVersion),shotId:command.slotId,planHash,
           shootingTaskId:command.shootingTaskId,presenterAssetId:command.presenterAssetId});
          verified={originalPlanHash:planHash,phase:'initial_presenter',...presenter};
        }else verified=await validateMeasuredMaterialRecovery({ repository: input.repository, tenantId: input.tenantId,
          taskId: input.taskId, runId: command.runId, job: current, slotId: command.slotId, materialId: command.materialId,
          currentPlan: detail?.assetSupplyPlan });
        const payload: MaterialRecoverySelections = {tenantId: input.tenantId, taskId: input.taskId, runId: command.runId,
          selections: {...oldPayload?.selections, [command.slotId]: command.action==='resume_material_supply'
            ?{materialId: command.materialId, ...verified}:verified}};
        if (!await store.update('content_execution_jobs', current.id, {checkpoints: {...current.checkpoints,
          [MATERIAL_RECOVERY_STAGE]: {version: '1', inputHash: scopeHash, payload, updatedAt: new Date().toISOString()}}}))
          throw new SocialContentWorkflowError('content_execution_material_recovery_binding_failed', 503);
      } });
    return { taskId: input.taskId, runId: command.runId, jobId: resumed.id, status: resumed.status,
      operationId: null, amendmentHash: null, attempt: 0 };
  }
  if (command.action === 'resume_existing_execution') {
    const active = job.checkpoints['social.voice_route_amendment']?.payload as
      { newIntent?: { operationId?: string }; recordHash?: string; retry?: { attempt?: number } } | undefined;
    if (['queued', 'running', 'retry_wait', 'reconciling'].includes(job.status))
      return { taskId: input.taskId, runId: command.runId, jobId: job.id,
        status: job.status, operationId: active?.newIntent?.operationId ?? null,
        amendmentHash: active?.recordHash ?? null, attempt: active?.retry?.attempt ?? 0 };
    const providerWork=job.providerReceipts.some(receipt=>['submitting','accepted','unknown'].includes(receipt.state));
    if (!['blocked', 'paused'].includes(job.status) || job.workerId || job.leaseExpiresAt
      || !providerWork && (!job.providerReceipts.some(receipt => receipt.state === 'completed')
        || job.providerReceipts.some(receipt => !['completed', 'failed'].includes(receipt.state))
        || ['submitting', 'accepted', 'unknown'].includes(job.providerState)
        || job.providerReceipts.some(receipt => receipt.requestId === active?.newIntent?.operationId && receipt.state === 'failed')))
      throw new SocialContentWorkflowError('content_execution_recovery_original_receipt_required', 409);
    const resumed = await (ports.control || controlContentExecutionJob)({ dataStore: store,
      tenantId: input.tenantId, jobId: job.id, action: job.status === 'paused' ? 'resume' : 'retry' });
    return { taskId: input.taskId, runId: command.runId, jobId: resumed.id,
      status: resumed.status, operationId: active?.newIntent?.operationId ?? null,
      amendmentHash: active?.recordHash ?? null, attempt: active?.retry?.attempt ?? 0 };
  }
  const authorizationRef = 'content-execution-recovery:' + socialRequestHash({
    tenantId: input.tenantId, userId: input.userId, taskId: input.taskId,
    command, idempotencyKey: input.idempotencyKey,
  });
  const amendment = await (ports.amend || amendCanonicalUnsubmittedVoiceRoute)({
    store, tenantId: input.tenantId, taskId: input.taskId, runId: command.runId,
    jobId: command.jobId, authorizationRef, mode: 'native_video', retryFailed: true,
    expectedFailedOperationId: command.failedOperationId,
  });
  const resumed = await (ports.control || controlContentExecutionJob)({
    dataStore: store, tenantId: input.tenantId, jobId: command.jobId, action: 'retry',
  });
  return { taskId: input.taskId, runId: command.runId, jobId: resumed.id,
    status: resumed.status, operationId: amendment.newIntent.operationId,
    amendmentHash: amendment.recordHash, attempt: amendment.retry?.attempt ?? 0 };
}
