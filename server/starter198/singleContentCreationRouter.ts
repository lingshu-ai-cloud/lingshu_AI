import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { contentPreferencesSchema, singleContentSelectionSchema } from '../../shared/contracts/singleContentCreation.js';
import { creationEvidencePorts } from '../lib/socialContentLegacyPorts.js';
import type { CreationEvidencePorts } from '../assistantContext/contentCreationDialogue.js';
import { STARTER_COLLECTIONS, type Starter198Repository } from './repository.js';
import type { Starter198OrchestratorQueuePort } from './runtimePorts.js';
import { addSocialTaskSource, createSocialContentTask, startSocialContentTask } from './socialContentTasks.js';
import { readSocialTaskDetail } from './socialContentRecords.js';
import { socialContentAssistantReceipt } from './socialContentAssistantActions.js';
import { parseCreateSocialTask, parseSocialSource, requireIdempotencyKey, SocialContentWorkflowError, socialJson, socialObject, socialText, socialRequestHash } from './socialContentValidation.js';
import { prepareSingleContent, readSingleContentContext, referenceDurationSeconds, singleContentReferenceSourceRef } from './singleContentPreparation.js';
import type { SocialContentSourceOptionsPort } from './socialContentSourceOptions.js';
import { saveContentPreferences } from './singleContentPreferences.js';
import { inspectSocialContentQueue } from './socialContentQueueInspection.js';
import { readContentExecutionJob } from '../contentExecution/durableQueue.js';
import { requireSocialId } from './socialContentValidation.js';
import { executionRecoveryInput, recoverSocialContentExecution } from './socialContentExecutionRecovery.js';

const preferencesInput = z.object({ preferences: contentPreferencesSchema, expectedVersion: z.string().regex(/^[a-f0-9]{64}$/), defaultPresenterId: z.string().trim().max(200).optional() }).strict();
const createInput = z.object({ selection: singleContentSelectionSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Authorize = (req: Request, res: Response, level: 'read' | 'write' | 'start') => Promise<{ tenantId: string; userId: string }>;
type AsyncRoute = (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => void;

async function startAdmissionVersion(repository: Starter198Repository, tenantId: string, taskId: string,
  idempotencyKey: string, currentVersion: string) {
  const operations = await repository.list(STARTER_COLLECTIONS.socialContentOperations, tenantId,
    { where: { idempotency_key: idempotencyKey }, perPage: 2 });
  if (operations.totalItems > 1 || operations.items.length > 1)
    throw new SocialContentWorkflowError('social_content_operation_integrity_violation', 503);
  const operation = operations.items[0];
  if (!operation) return currentVersion;
  if (operation.operation !== 'start_social_content_task' || operation.target_id !== taskId)
    throw new SocialContentWorkflowError('social_content_idempotency_conflict', 409);
  const expectedVersion = socialText(socialObject(socialJson(operation.result))?.expectedVersion);
  if (!expectedVersion) throw new SocialContentWorkflowError('social_content_operation_integrity_violation', 503);
  return expectedVersion;
}

/** New UI entry, same task mutation / source / dispatch services as the workspace. */
export function createSingleContentCreationRouter(input: { repository: Starter198Repository;
  orchestratorQueue?: Starter198OrchestratorQueuePort; authorize: Authorize; asyncRoute: AsyncRoute;
  now: () => Date; sourceOptions?: SocialContentSourceOptionsPort; evidence?: CreationEvidencePorts; localPreview?: () => boolean;
  recoverExecution?: typeof recoverSocialContentExecution;
}) {
  const router = Router();
  const store = () => {
    if (!input.repository.dataStore) throw new SocialContentWorkflowError('content_preferences_storage_unavailable', 503);
    return input.repository.dataStore;
  };
  const context = (tenantId: string) => readSingleContentContext({ store: store(), tenantId, evidence: input.evidence || creationEvidencePorts });
  const runtime = () => ({ now: input.now(), executionAvailable: Boolean(input.orchestratorQueue),
    localPreview: input.localPreview?.() ?? process.env.LINGSHU_LOCAL_PREVIEW === '1' });
  router.post('/tasks/:taskId/recover-execution', input.asyncRoute(async (req, res) => {
    const identity = await input.authorize(req, res, 'start');
    const parsed = executionRecoveryInput.safeParse(req.body);
    if (!parsed.success) throw new SocialContentWorkflowError('content_execution_recovery_input_invalid', 400);
    const idempotencyKey = requireIdempotencyKey(req.headers['idempotency-key']);
    const current = runtime();
    if (current.localPreview || !current.executionAvailable)
      throw new SocialContentWorkflowError('content_execution_recovery_runtime_unavailable', 409);
    try {
      res.json(await (input.recoverExecution || recoverSocialContentExecution)({
        repository: input.repository, ...identity, taskId: requireSocialId(req.params.taskId),
        command: parsed.data, idempotencyKey,
      }));
    } catch (error) {
      if (error instanceof Error && /^(voice_route_|native_voice_|content_execution_|social_task_budget_)/.test(error.message)
        && !(error instanceof SocialContentWorkflowError))
        throw new SocialContentWorkflowError(error.message, 409);
      throw error;
    }
  }));
  router.get('/tasks/:taskId/queue-inspection', input.asyncRoute(async (req, res) => {
    const identity = await input.authorize(req, res, 'read');
    const task = await readSocialTaskDetail({ repository: input.repository, tenantId: identity.tenantId, taskId: requireSocialId(req.params.taskId) });
    if (!task) throw new SocialContentWorkflowError('social_content_task_not_found', 404);
    const job = task.runId ? await readContentExecutionJob(store(), identity.tenantId, task.taskId, task.runId) : null;
    const current = runtime();
    res.json(inspectSocialContentQueue({ tenantId: identity.tenantId, task, job,
      localPreview: current.localPreview, queueConfigured: current.executionAvailable }));
  }));
  router.get('/single-creation/options', input.asyncRoute(async (req, res) => {
    const identity = await input.authorize(req, res, 'read');
    res.json((await context(identity.tenantId)).options);
  }));
  router.post('/single-creation/preferences', input.asyncRoute(async (req, res) => {
    const identity = await input.authorize(req, res, 'write');
    const parsed = preferencesInput.safeParse(req.body);
    if (!parsed.success) throw new SocialContentWorkflowError('content_preferences_input_invalid', 400);
    await saveContentPreferences(store(), identity.tenantId, parsed.data);
    res.json((await context(identity.tenantId)).options);
  }));
  router.post('/single-creation/prepare', input.asyncRoute(async (req, res) => {
    const identity = await input.authorize(req, res, 'start');
    const parsed = singleContentSelectionSchema.safeParse(req.body);
    if (!parsed.success) throw new SocialContentWorkflowError('single_content_selection_invalid', 400);
    res.json(prepareSingleContent(await context(identity.tenantId), parsed.data, runtime()));
  }));
  router.post('/single-creation/create', input.asyncRoute(async (req, res) => {
    const identity = await input.authorize(req, res, 'start');
    const parsed = createInput.safeParse(req.body);
    if (!parsed.success) throw new SocialContentWorkflowError('single_content_selection_invalid', 400);
    const key = requireIdempotencyKey(req.headers['idempotency-key']);
    const { selection } = parsed.data;
    const currentRuntime = runtime();
    const requestHash = socialRequestHash(selection);
    const languages = selection.preferences.languages;
    const taskIds = languages.map(language => `socialtask_${socialRequestHash({ tenantId: identity.tenantId,
      key: languages.length === 1 ? key : `${key}:language:${language}` }).slice(0, 24)}`);
    const existingTasks = await Promise.all(taskIds.map(taskId => readSocialTaskDetail({ repository: input.repository, tenantId: identity.tenantId, taskId })));
    if (existingTasks.some(task => task && task.brief.singleCreationRequestHash !== requestHash)) throw new SocialContentWorkflowError('single_content_request_key_reused', 409);
    if (existingTasks.every(task => task?.runId && task.sources.some(source => source.kind === 'knowledge' && source.status === 'active') && (!selection.referenceId || task.sources.some(source => source.kind === 'reference_link' && source.status === 'active')))) {
      const variants = existingTasks.map(task => ({ task: task!, receipt: socialContentAssistantReceipt(task!, task!.runId ? undefined : currentRuntime.localPreview ? 'single_content_local_preview' : 'single_content_saved_pending') }));
      res.status(200).json({ ...variants[0], variants }); return;
    }
    const ctx = await context(identity.tenantId);
    const preparation = prepareSingleContent(ctx, selection, currentRuntime);
    if (preparation.fingerprint !== parsed.data.fingerprint) {
      res.status(409).json({ code: 'single_content_evidence_changed', message: '企业设置或素材已变化，请重新检查。' }); return;
    }
    if (!preparation.canCreate) { res.status(422).json({ code: 'single_content_not_ready', message: '请先处理待确认事项。', preparation }); return; }
    const product = ctx.products.find(row => row.id === selection.productId)!;
    const preferences = selection.preferences;
    const variants = [];
    for (const [index, language] of languages.entries()) {
      const taskId = taskIds[index]!;
      const operationKey = languages.length === 1 ? key : `${key}:language:${language}`;
      const value = parseCreateSocialTask({ title: `${product.name} · ${selection.objective}${languages.length > 1 ? ` · ${language}` : ''}`.slice(0, 120),
        objective: selection.objective, productId: product.id, productRef: product.name,
        audience: preferences.audience, markets: [preferences.market], languages: [language],
        platforms: [preferences.platform], formats: ['短视频'], aspectRatio: preferences.aspectRatio,
        targetDurationSeconds: referenceDurationSeconds(ctx.references.find(row => row.id === selection.referenceId)), dueAt: selection.dueAt, requestedOutputCount: 1,
        mode: 'instant', themeId: 'product_value', callToAction: preferences.callToAction,
        creationMode: selection.referenceId ? 'viral_replication' : 'material_processing',
        managementMode: 'one_click_managed', productionMode: 'social_ready',
        productionApproach: preferences.materialPolicy,
        presenterPolicy: selection.usePresenter ? 'selected' : 'none',
        ...(selection.usePresenter ? {
          presenterAssetId: selection.presenterId,
          requestedPresenterAssetId: selection.presenterId,
          // The preparation gate only offers tenant-owned, currently authorized
          // HeyGen presenters. Freeze the matching execution/review policy with
          // the task so initial planning and later recovery consume one contract.
          presenterSpeechReviewPolicy: 'heygen_native_human_review' as const,
        } : {}),
        restrictions: ['不虚构产品功效、工厂、资质或采购承诺', '参考仅用于结构借鉴，不冒充企业实拍'],
        specialRequirements: '按本次确认要求自动策划与制作，字幕、配乐和剪辑沿用系统方案；预计交付时间为任务目标，未通过质检不得标记正式交付。',
      });
      const knowledgeSource = parseSocialSource({ kind: 'knowledge', sourceRef: 'socialknowledge:enterprise-profile', label: '企业知识库', purpose: '本次确认产品、品牌及企业事实来源' });
      const reference = selection.referenceId ? ctx.references.find(row => row.id === selection.referenceId)! : null;
      const referenceSource = reference ? parseSocialSource({ kind: 'reference_link', sourceRef: singleContentReferenceSourceRef(reference), cachedReferenceRecordId: selection.referenceId, label: socialText(reference.title).slice(0, 160) || '对标参考', purpose: '本次选择的结构参考' }) : null;
      let task = existingTasks[index] || await createSocialContentTask({ repository: input.repository, ...identity, taskId, value: { ...value, singleCreationRequestHash: requestHash },
        idempotencyKey: `${operationKey}:create`, entry: 'workspace', now: input.now() });
      if (!task.runId) {
        task = (await addSocialTaskSource({ repository: input.repository, ...identity, taskId: task.taskId,
          sourceOptions: input.sourceOptions, value: knowledgeSource, idempotencyKey: `${operationKey}:knowledge`, now: input.now() })).task;
        if (referenceSource) {
          task = (await addSocialTaskSource({ repository: input.repository, ...identity, taskId: task.taskId,
            value: referenceSource,
            idempotencyKey: `${operationKey}:reference`, now: input.now() })).task;
        }
      }
      let blockedReason: string | undefined;
      if (!task.runId) {
        if (currentRuntime.localPreview) blockedReason = 'single_content_local_preview';
        else if (!input.orchestratorQueue) blockedReason = 'social_content_orchestrator_not_configured';
        else {
          const startKey = `${operationKey}:start`;
          try { task = await startSocialContentTask({ repository: input.repository, ...identity, taskId: task.taskId,
            expectedVersion: await startAdmissionVersion(input.repository, identity.tenantId, task.taskId, startKey, task.version),
            idempotencyKey: startKey, orchestratorQueue: input.orchestratorQueue, now: input.now() }); }
          catch (error) {
            blockedReason = error instanceof SocialContentWorkflowError ? error.code : 'social_content_start_unavailable';
            task = (await readSocialTaskDetail({ repository: input.repository, tenantId: identity.tenantId, taskId: task.taskId }))!;
          }
        }
      }
      variants.push({ task, receipt: socialContentAssistantReceipt(task, blockedReason) });
    }
    res.status(variants.some(value => value.task.runId) ? 202 : 201).json({ ...variants[0], variants });
  }));
  return router;
}
