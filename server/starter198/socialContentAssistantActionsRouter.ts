import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Starter198Repository } from './repository.js';
import type { Starter198OrchestratorQueuePort } from './runtimePorts.js';
import { socialContentAssistantAction, socialContentAssistantReceipt } from './socialContentAssistantActions.js';
import { decideSocialContentArtifact } from './socialContentOutputs.js';
import { readSocialTaskDetail, requireSocialTask } from './socialContentRecords.js';
import { socialContentExecutionAccepted, socialContentExecutionPortal } from './socialContentExecutionPortal.js';
import { createAndStartSocialAssistantTask, recordAssistantStartFailure } from './socialContentAssistantStart.js';
import { socialContentReviewAdmissionAllowed } from './socialContentTestBypass.js';
import { startSocialContentTask } from './socialContentTasks.js';
import {
  SocialContentWorkflowError,
  parseArtifactDecision,
  parseCreateSocialTask,
  parseSocialSource,
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
    return { ...socialContentAssistantReceipt(task, blockedReason, Boolean(socialObject(socialJson(row.brief))?._weeklyAuthority)),
      queued: socialContentExecutionAccepted(row) };
  };
  router.get('/tasks/:taskId/execution-portal', input.asyncRoute(async (req, res) => {
    const identity = await input.authorize(req, res, 'read');
    const target = { repository: input.repository, tenantId: identity.tenantId, taskId: requireSocialId(req.params.taskId) };
    const task = await readSocialTaskDetail(target);
    if (!task) throw new SocialContentWorkflowError('social_content_task_not_found', 404);
    res.json({ item: socialContentExecutionPortal(await requireSocialTask(target), task) });
  }));
  router.get('/tasks/:taskId/replication-context', input.asyncRoute(async (req, res) => {
    const identity = await input.authorize(req, res, 'read');
    const target = { repository: input.repository, tenantId: identity.tenantId, taskId: requireSocialId(req.params.taskId) };
    const task = await readSocialTaskDetail(target);
    if (!task || task.brief.creationMode !== 'viral_replication') throw new SocialContentWorkflowError('social_content_task_not_found', 404);
    const row = await requireSocialTask(target);
    const authority = socialObject(socialObject(socialJson(row.brief))?._weeklyAuthority);
    const pkg = socialObject(authority?.weeklyPackage), publication = socialObject(authority?.publicationTask);
    res.json({ task, weekly: pkg && publication ? {
      packageId: socialText(pkg.packageId), version: Number(pkg.version),
      weekStart: socialText(pkg.weekStart), weekEnd: socialText(pkg.weekEnd),
      publicationTaskId: socialText(publication.publicationTaskId),
      accountId: socialText(publication.accountId),
      plannedPublishAt: socialText(publication.publishWindow),
    } : null });
  }));
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
    if (current.runId || current.executionAdmission?.state === 'queued') { res.json({ task: current, receipt: await receipt(identity.tenantId, current) }); return; }
    try {
      if (!input.orchestratorQueue) throw new SocialContentWorkflowError('social_content_orchestrator_not_configured', 503);
      const task = await startSocialContentTask({ repository: input.repository, ...identity, taskId,
        expectedVersion: socialText(source.expectedVersion), idempotencyKey,
        orchestratorQueue: input.orchestratorQueue, now: input.now() });
      res.status(task.runId || task.executionAdmission?.state === 'queued' ? 202 : 200).json({ task, receipt: await receipt(identity.tenantId, task,
        task.executionAdmission?.state === 'queued' || task.runId ? undefined : 'social_content_task_waiting_for_input') });
    } catch (error) {
      const latest = await readSocialTaskDetail({ repository: input.repository, tenantId: identity.tenantId, taskId });
      if (error instanceof SocialContentWorkflowError && latest?.runId
        && ['social_content_task_version_conflict', 'social_content_task_not_startable'].includes(error.code)) {
        res.json({ task: latest, receipt: await receipt(identity.tenantId, latest) }); return;
      }
      await recordAssistantStartFailure({ repository: input.repository, ...identity, taskId, error, now: input.now() });
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
    const body = socialObject(req.body);
    const { initialSource: sourceValue, ...taskValue } = body ?? {};
    const initialSource = sourceValue === undefined ? undefined : parseSocialSource(sourceValue);
    const parsed = parseCreateSocialTask(taskValue);
    const { task: current, blockedReason } = await createAndStartSocialAssistantTask({
      repository: input.repository, orchestratorQueue: input.orchestratorQueue, ...identity,
      idempotencyKey, value: parsed, initialSource, now: input.now(),
    });
    res.status(current.runId || current.executionAdmission?.state === 'queued' ? 202 : 201).json({ task: current,
      receipt: await receipt(identity.tenantId, current, blockedReason) });
  }));
  return router;
}
