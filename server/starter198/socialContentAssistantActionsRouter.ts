import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Starter198Repository } from './repository.js';
import type { Starter198OrchestratorQueuePort } from './runtimePorts.js';
import { socialContentAssistantAction, socialContentAssistantReceipt } from './socialContentAssistantActions.js';
import { decideSocialContentArtifact } from './socialContentOutputs.js';
import { readSocialTaskDetail, requireSocialTask } from './socialContentRecords.js';
import { socialContentReviewAdmissionAllowed } from './socialContentTestBypass.js';
import { createSocialContentTask, startSocialContentTask } from './socialContentTasks.js';
import {
  SocialContentWorkflowError,
  parseArtifactDecision,
  parseCreateSocialTask,
  requireIdempotencyKey,
  requireSocialId,
  socialJson,
  socialObject,
  socialText,
} from './socialContentValidation.js';

type Authorize = (req: Request, res: Response, level: 'read' | 'start') =>
  Promise<{ tenantId: string; userId: string }>;
type AsyncRoute = (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => void;
type WeeklyRepairCases = {
  handlesCreativeDecision: (tenantId: string, taskId: string, artifactId: string) => Promise<boolean>;
  createCreativeFromDecision: (value: {
    tenantId: string; actorUserId: string; taskId: string; artifactId: string;
    operationId: string; operationRequestHash: string; note: string;
  }) => Promise<unknown>;
};

function bodyWithinLimit(req: Request, maximum = 256 * 1_024): void {
  if (Buffer.byteLength(JSON.stringify(req.body ?? {}), 'utf8') > maximum) {
    throw new SocialContentWorkflowError('social_content_request_too_large', 413);
  }
}

export function createSocialContentAssistantActionsRouter(input: {
  repository: Starter198Repository;
  orchestratorQueue?: Starter198OrchestratorQueuePort;
  weeklyRepairCases: WeeklyRepairCases | null;
  authorize: Authorize;
  asyncRoute: AsyncRoute;
  now: () => Date;
}): Router {
  const router = Router({ mergeParams: true });
  const receipt = async (tenantId: string, task: Parameters<typeof socialContentAssistantReceipt>[0], blockedReason?: string) => {
    const row = await requireSocialTask({ repository: input.repository, tenantId, taskId: task.taskId });
    return socialContentAssistantReceipt(task, blockedReason, Boolean(socialObject(socialJson(row.brief))?._weeklyAuthority));
  };
  router.get('/assistant-actions', input.asyncRoute(async (req, res) => {
    const identity = await input.authorize(req, res, 'read');
    const taskId = socialText(req.query.taskId);
    if (!taskId) { res.json({ items: [] }); return; }
    const task = await readSocialTaskDetail({ repository: input.repository, tenantId: identity.tenantId,
      taskId: requireSocialId(taskId) });
    if (!task) throw new SocialContentWorkflowError('social_content_task_not_found', 404);
    const artifactId = socialText(req.query.artifactId);
    const candidates = task.artifacts.filter(item => item.status === 'review_required'
      && (!artifactId || item.artifactId === artifactId));
    const artifact = candidates.length === 1 ? candidates[0] : undefined;
    const revision = artifact && input.orchestratorQueue && ['asset_review', 'attention', 'paused'].includes(task.status)
      ? [{ id: `content:${task.taskId}:revise:${artifact.artifactId}`, label: `修改「${task.brief.title}」`,
        taskId: task.taskId, artifactId: artifact.artifactId, expectedVersion: artifact.version,
        status: task.status, operation: 'revise', href: socialContentAssistantReceipt(task).href }] : [];
    const action = socialContentAssistantAction(task, Boolean(input.orchestratorQueue));
    const review = task.agentWorkflow?.executionPlanReview;
    const admittedAction = action.operation === 'start' && review && !socialContentReviewAdmissionAllowed(review)
      ? { ...action, operation: 'open' as const, label: `处理「${task.brief.title}」生产条件`,
        disabledReason: '生产方案尚未满足执行条件。' } : action;
    res.json({ items: [admittedAction, ...revision] });
  }));
  router.post('/assistant-actions/:taskId/start', input.asyncRoute(async (req, res) => {
    const identity = await input.authorize(req, res, 'start');
    bodyWithinLimit(req);
    const source = socialObject(req.body);
    if (!source || Object.keys(source).some(key => key !== 'expectedVersion') || !socialText(source.expectedVersion)) {
      throw new SocialContentWorkflowError('social_content_start_invalid', 400);
    }
    const taskId = requireSocialId(req.params.taskId);
    const idempotencyKey = requireIdempotencyKey(req.headers['idempotency-key']);
    const current = await readSocialTaskDetail({ repository: input.repository, tenantId: identity.tenantId, taskId });
    if (!current) throw new SocialContentWorkflowError('social_content_task_not_found', 404);
    if (current.runId) { res.json({ task: current, receipt: await receipt(identity.tenantId, current) }); return; }
    if (!input.orchestratorQueue) throw new SocialContentWorkflowError('social_content_orchestrator_not_configured', 503);
    try {
      const task = await startSocialContentTask({ repository: input.repository, ...identity, taskId,
        expectedVersion: socialText(source.expectedVersion), idempotencyKey,
        orchestratorQueue: input.orchestratorQueue, now: input.now() });
      res.status(task.runId ? 202 : 200).json({ task, receipt: await receipt(identity.tenantId, task,
        task.runId ? undefined : 'social_content_task_waiting_for_input') });
    } catch (error) {
      const latest = await readSocialTaskDetail({ repository: input.repository, tenantId: identity.tenantId, taskId });
      if (error instanceof SocialContentWorkflowError && latest?.runId
        && ['social_content_task_version_conflict', 'social_content_task_not_startable'].includes(error.code)) {
        res.json({ task: latest, receipt: await receipt(identity.tenantId, latest) }); return;
      }
      throw error;
    }
  }));
  router.post('/assistant-actions/:taskId/revise', input.asyncRoute(async (req, res) => {
    const identity = await input.authorize(req, res, 'start');
    bodyWithinLimit(req);
    const source = socialObject(req.body);
    if (!source || Object.keys(source).some(key => !['artifactId', 'expectedVersion', 'note'].includes(key))
      || !socialText(source.note)) throw new SocialContentWorkflowError('social_content_revision_note_required', 400);
    const result = await decideSocialContentArtifact({ repository: input.repository, ...identity,
      orchestratorQueue: input.orchestratorQueue, taskId: requireSocialId(req.params.taskId),
      artifactId: requireSocialId(source.artifactId, 'social_artifact_id_invalid'),
      idempotencyKey: requireIdempotencyKey(req.headers['idempotency-key']),
      value: parseArtifactDecision({ expectedVersion: source.expectedVersion, note: source.note,
        decision: 'changes_requested' }),
      ...(input.weeklyRepairCases ? { weeklyRevisionBridge: {
        handles: ({ tenantId, taskId, artifactId }: { tenantId: string; taskId: string; artifactId: string }) =>
          input.weeklyRepairCases!.handlesCreativeDecision(tenantId, taskId, artifactId),
        persist: value => input.weeklyRepairCases!.createCreativeFromDecision(value),
      } } : {}), now: input.now() });
    const governed = input.weeklyRepairCases && await input.weeklyRepairCases.handlesCreativeDecision(
      identity.tenantId, result.task.taskId, result.artifact.artifactId);
    res.json({ ...result, receipt: { ...await receipt(identity.tenantId, result.task), operation: 'revision',
      ...(governed ? { started: false, blockedReason: 'weekly_revision_scope_confirmation_required' } : {}) } });
  }));
  router.post('/assistant-actions/create', input.asyncRoute(async (req, res) => {
    const identity = await input.authorize(req, res, 'start');
    bodyWithinLimit(req);
    const idempotencyKey = requireIdempotencyKey(req.headers['idempotency-key']);
    const parsed = parseCreateSocialTask(req.body);
    const mode = parsed.mode ?? 'instant';
    if (mode === 'weekly' && !parsed.dueAt) throw new SocialContentWorkflowError('social_content_due_at_required', 400);
    let current = await createSocialContentTask({ repository: input.repository, ...identity, idempotencyKey,
      value: { ...parsed, mode }, entry: 'assistant', now: input.now() });
    if (current.runId) { res.json({ task: current, receipt: await receipt(identity.tenantId, current) }); return; }
    let blockedReason: string | undefined;
    if (!input.orchestratorQueue) blockedReason = 'social_content_orchestrator_not_configured';
    else if (!current.readiness.complete) blockedReason = 'social_content_task_inputs_incomplete';
    else {
      try {
        current = await startSocialContentTask({ repository: input.repository, ...identity, taskId: current.taskId,
          expectedVersion: current.version, idempotencyKey: `assistant-start:${current.taskId}`,
          orchestratorQueue: input.orchestratorQueue, now: input.now() });
        if (!current.runId) blockedReason = 'social_content_task_waiting_for_input';
      } catch (error) {
        blockedReason = error instanceof SocialContentWorkflowError ? error.code : 'social_content_orchestrator_unavailable';
        current = (await readSocialTaskDetail({ repository: input.repository,
          tenantId: identity.tenantId, taskId: current.taskId }))!;
      }
    }
    res.status(current.runId ? 202 : 201).json({ task: current,
      receipt: await receipt(identity.tenantId, current, blockedReason) });
  }));
  return router;
}
