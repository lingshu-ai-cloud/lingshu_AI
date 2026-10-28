import { socialContentAssistantReceipt } from './socialContentAssistantActions.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { creationSelectionSchema } from '../../shared/contracts/contentCreationDialogue.js';
import { contentCreationTurn, CreationDialogueError, type CreationEvidencePorts } from '../assistantContext/contentCreationDialogue.js';
import { creationEvidencePorts } from '../lib/socialContentLegacyPorts.js';
import { createSocialContentTask, addSocialTaskSource, startSocialContentTask } from './socialContentTasks.js';
import { productionTaskInput, parseSocialSource, requireIdempotencyKey, SocialContentWorkflowError } from './socialContentValidation.js';
import { isContentProductionPlatform } from '../../shared/contracts/contentProductionPlatforms.js';
import type { Starter198Repository } from './repository.js';
import type { Starter198OrchestratorQueuePort } from './runtimePorts.js';
import { validateHeyGenPresenterRecord } from '../lib/presenterAssetTrust.js';
import { confirmSocialReplicationScript, readSocialReplicationScriptReviewContext } from './socialContentReplicationScriptReview.js';

const submissionSchema = z.object({ selection: creationSelectionSchema, fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Authorize = (req: Request, res: Response, level: 'start') => Promise<{ tenantId: string; userId: string }>;
type AsyncRoute = (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => void;
export function guidedReferenceSource(reference: Record<string, unknown> | null, narration: { sourceReferenceId: string; sourceTitle: string }) {
  return parseSocialSource({ kind: 'reference_link', sourceRef: reference?.sourceUrl,
    cachedReferenceRecordId: narration.sourceReferenceId, label: narration.sourceTitle.slice(0, 160), purpose: '用户确认的自由创作结构和原口播来源' });
}
export function createGuidedCreationRouter(input: { repository: Starter198Repository; authorize: Authorize; asyncRoute: AsyncRoute; now: () => Date; orchestratorQueue?: Starter198OrchestratorQueuePort;
  evidence?: CreationEvidencePorts; localPreview?: () => boolean; localPaidGeneration?: () => boolean }) {
  const router = Router();
  router.post('/guided-creation/submit', input.asyncRoute(async (req, res) => {
    const identity = await input.authorize(req, res, 'start');
    const parsed = submissionSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.selection.guided) throw new SocialContentWorkflowError('guided_creation_input_invalid', 400);
    const evidence = input.evidence || creationEvidencePorts;
    const plan = await contentCreationTurn(identity.tenantId, { action: 'guided_review', selection: parsed.data.selection, instruction: '最终生成前重新核验当前方案' }, evidence);
    if (plan.guided?.fingerprint !== parsed.data.fingerprint) { res.status(409).json({ code: 'creation_evidence_stale', message: '方案证据已变化，请重新核验后确认。' }); return; }
    if (plan.guided.blockers.length) { res.status(422).json({ code: 'creation_dependencies_missing', message: '仍有真实素材或授权依赖待补齐。', blockers: plan.guided.blockers }); return; }
    // Ad-hoc local servers stay non-paying. Only the supervised application
    // supplies the separate machine-local execution flag at process startup.
    const localPreview = (input.localPreview || (() => process.env.LINGSHU_LOCAL_PREVIEW === '1'))();
    const localPaidGeneration = (input.localPaidGeneration || (() => process.env.LINGSHU_LOCAL_PAID_GENERATION_ENABLED === '1'))();
    if (localPreview && !localPaidGeneration) { res.status(409).json({ code: 'creation_local_preview_no_paid_generation', message: '方案已核验。本地验收不调用付费生成，尚未创建生产任务。' }); return; }
    if (!input.orchestratorQueue) throw new SocialContentWorkflowError('social_content_orchestrator_not_configured', 503);
    const key = requireIdempotencyKey(req.headers['idempotency-key']);
    const guide = plan.selection.guided!;
    const products = plan.products.filter(row => plan.selection.productIds.includes(row.id));
    const digital = guide.presenterMode === 'digital';
    const presenter = digital ? (await evidence.presenters(identity.tenantId)).find(row => validateHeyGenPresenterRecord(row).ok) : undefined;
    if (digital && !presenter) throw new CreationDialogueError('creation_presenter_required', 422, '人物及音色授权已变化，请重新核验。');
    const reference = await evidence.reference(identity.tenantId, plan.guided.narration.sourceReferenceId);
    const referencePlatform = typeof reference?.platform === 'string' ? reference.platform.trim() : '';
    if (!referencePlatform) throw new CreationDialogueError('creation_platform_required', 422, '当前参考尚未记录来源平台，请补齐来源信息。');
    const platform = isContentProductionPlatform(referencePlatform) ? referencePlatform : 'facebook';
    const source = guidedReferenceSource(reference, plan.guided.narration);
    const scene = guide.scene;
    const value = productionTaskInput({ title: `${scene?.campaign?.name || products.map(row => row.name).join('、')} · ${scene?.kind === 'campaign' ? '活动内容' : '自由创作'}`.slice(0, 120), objective: scene?.campaign ? `为${scene.campaign.name}制作视频；优惠政策：${scene.campaign.offer}；卖点：${scene.campaign.sellingPoints}`.slice(0,1000) : scene?.hook?.direction || '面向海外B2B买家，使用企业已核验产品、工厂、资质、服务信息与询盘CTA制作视频。', productId: products[0]?.id,
      productRef: products[0]?.name, platforms: [platform], languages: guide.languages, targetDurationSeconds: Math.round(plan.guided.nodes.reduce((sum, node) => sum + node.duration, 0) * 1000) / 1000, mode: 'instant', themeId: 'supplier_capability',
      creationMode: 'viral_replication', managementMode: guide.productionMode === 'manual' ? 'advanced' : 'one_click_managed',
      productionApproach: digital || guide.assignments.some(row => row.intent === 'generate') ? 'ai_enhanced' : 'material_cut',
      assetAvailability: 'limited', productionMode: 'social_ready', referenceMode: 'multi_source_hybrid',
      ...(presenter ? { requestedPresenterAssetId: presenter.id, presenterAssetId: presenter.id } : {}),
      restrictions: ['不虚构工厂、资质、案例或服务承诺', '参考片仅作结构与口播来源，不冒充企业实拍'],
      ...(scene ? { dueAt: scene.deliverBy } : {}),
      specialRequirements: scene ? JSON.stringify({ source: 'assistant_scene_confirmation', scenario: scene.kind, groupId: scene.groupId, itemId: 'main', plannedPublishAt: scene.plannedPublishAt, products: products.map(row => ({id:row.id,name:row.name})) }) : '用户已确认自由创作结构。字幕默认开启，口播复用对应结构来源并按知识库替换身份。',
    });
    let task = await createSocialContentTask({ repository: input.repository, ...identity, idempotencyKey: `${key}:create`, value: { ...value, creationDialoguePlan: plan }, entry: 'assistant', now: input.now() });
    if (!task.runId) {
      const result = await addSocialTaskSource({ repository: input.repository, ...identity, taskId: task.taskId, idempotencyKey: `${key}:reference`, value: source, now: input.now() });
      let current = result.task;
      if (guide.productionMode === 'manual') {
        const context = await readSocialReplicationScriptReviewContext({ repository: input.repository, tenantId: identity.tenantId, taskId: task.taskId });
        if (context.status === 'review_required') current = await confirmSocialReplicationScript({ repository: input.repository, ...identity, taskId: task.taskId, idempotencyKey: `${key}:confirm`, now: input.now(), value: {
          expectedVersion: context.expectedVersion, analysisId: context.analysisId, analysisHash: context.analysisHash, scriptHash: context.scriptHash,
          sceneDecisions: context.scenes.map(scene => ({ shotId: scene.shotId, conclusion: 'approved', evidence: [`用户确认自由创作方案 ${plan.guided!.fingerprint}`] })), reviewEvidence: [`同一最终确认：${plan.guided.fingerprint}`],
        } });
      }
      task = await startSocialContentTask({ repository: input.repository, ...identity, taskId: task.taskId, expectedVersion: current.version, idempotencyKey: `${key}:start`, orchestratorQueue: input.orchestratorQueue, now: input.now() });
    }
    res.status(task.runId ? 202 : 200).json({ taskId: task.taskId, runId: task.runId || null, status: task.status, started: socialContentAssistantReceipt(task).started, receipt: { ...socialContentAssistantReceipt(task), queued: task.executionAdmission?.state === 'queued', ...(!task.runId && task.executionAdmission?.state !== 'queued' ? {blockedReason:'social_content_task_waiting_for_input'} : {}) } });
  }));
  return router;
}
