import type { AddSocialTaskSourceInput, CreateSocialContentTaskInput, SocialContentTaskDetail, SocialContentTaskSummary } from '../../shared/contracts/socialContentWorkflow.js';
import { STARTER_COLLECTIONS, type Starter198Repository, type StarterRecord } from './repository.js';
import { withSocialContentSubjectLease, assertSocialContentSubjectLease } from './socialContentMutation.js';
import { socialContentExecutionAccepted } from './socialContentExecutionPortal.js';
import type { Starter198OrchestratorQueuePort } from './runtimePorts.js';
import { SocialContentWorkflowError, socialJson, socialObject, socialText } from './socialContentValidation.js';

/** Project existing start/recovery evidence, never infer admission from the status label. */
export function socialAssistantAdmission(record: StarterRecord): Pick<SocialContentTaskSummary, 'executionAdmission'> {
  if (socialContentExecutionAccepted(record)) return { executionAdmission: {
    state: 'queued', queueItemId: socialText(record.orchestrator_item_id),
  } };
  const intent = socialObject(socialObject(socialJson(record.brief))?._managedStart);
  if (socialText(record.run_id) || !intent) return {};
  if (intent.status === 'queued') return { executionAdmission: { state: 'preparing', reason: socialText(intent.reason) } };
  if (intent.status === 'blocked') return { executionAdmission: { state: 'blocked', reason: socialText(intent.reason) } };
  return {};
}

/** Retain a failed start on the same task, using the existing managed-start intervention state. */
export async function recordAssistantStartFailure(input: {
  repository: Starter198Repository; tenantId: string; userId: string; taskId: string; error: unknown; now: Date;
}): Promise<void> {
  const reason = socialText(socialObject(input.error)?.code) || 'social_content_orchestrator_unavailable';
  if (['social_content_task_version_conflict', 'social_content_subject_busy', 'social_content_operation_in_progress',
    'social_content_idempotency_conflict'].includes(reason)) return;
  const { requireSocialTask } = await import('./socialContentRecords.js');
  await withSocialContentSubjectLease({ ...input, subjectId: input.taskId, action: async () => {
    const row = await requireSocialTask(input);
    // An uncertain dispatch is recovered by the existing outbox. Never label it a failed paid run.
    if (socialText(row.run_id) || socialContentExecutionAccepted(row)
      || socialObject(socialObject(socialJson(row.content_order))?.dispatch)
      || ['cancelled', 'cancelling'].includes(socialText(row.status))) return;
    const brief = socialObject(socialJson(row.brief)) || {};
    await assertSocialContentSubjectLease({ ...input, subjectId: input.taskId });
    await input.repository.update(STARTER_COLLECTIONS.socialContentTasks, input.tenantId, row.id, {
      status: 'attention', version: String(Number(row.version) + 1),
      brief: { ...brief, _managedStart: { status: 'blocked', reason, userId: input.userId, attempts: 0,
        requestId: `assistant-start:${input.taskId}`, requestedAt: input.now.toISOString(), nextAttemptAt: input.now.toISOString() } },
      updated_by: input.userId, updated_at: input.now.toISOString(),
    });
  } });
}

/** Compose existing commands; all admission, system review, outbox and queue rules stay in their owners. */
export async function createAndStartSocialAssistantTask(input: {
  repository: Starter198Repository; orchestratorQueue?: Starter198OrchestratorQueuePort;
  tenantId: string; userId: string; idempotencyKey: string; value: CreateSocialContentTaskInput;
  initialSource?: AddSocialTaskSourceInput; now: Date;
}): Promise<{ task: SocialContentTaskDetail; blockedReason?: string }> {
  const { createSocialContentTask, addSocialTaskSource, startSocialContentTask } = await import('./socialContentTasks.js');
  const { readSocialTaskDetail } = await import('./socialContentRecords.js');
  const mode = input.value.mode ?? 'instant';
  if (mode === 'weekly' && !input.value.dueAt) throw new SocialContentWorkflowError('social_content_due_at_required', 400);
  let task = await createSocialContentTask({ ...input, value: { ...input.value, mode }, entry: 'assistant' });
  if (task.runId || task.executionAdmission?.state === 'queued') return { task };
  try {
    if (!input.orchestratorQueue) throw new SocialContentWorkflowError('social_content_orchestrator_not_configured', 503);
    if (input.initialSource) task = (await addSocialTaskSource({ ...input, taskId: task.taskId,
      value: input.initialSource, idempotencyKey: `assistant-source:${task.taskId}` })).task;
    task = await startSocialContentTask({ ...input, taskId: task.taskId, expectedVersion: task.version,
      idempotencyKey: `assistant-start:${task.taskId}:${task.version}`, orchestratorQueue: input.orchestratorQueue });
    return { task, ...(!task.runId && task.executionAdmission?.state !== 'queued'
      ? { blockedReason: 'social_content_task_waiting_for_input' } : {}) };
  } catch (error) {
    const blockedReason = socialText(socialObject(error)?.code) || 'social_content_orchestrator_unavailable';
    await recordAssistantStartFailure({ ...input, taskId: task.taskId, error });
    task = (await readSocialTaskDetail({ ...input, taskId: task.taskId }))!;
    return { task, blockedReason };
  }
}
