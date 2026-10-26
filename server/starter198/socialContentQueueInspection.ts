import { socialContentQueueProjection } from './socialContentQueueProjection.js';
import type { SocialContentTaskDetail } from '../../shared/contracts/socialContentWorkflow.js';
import type { SocialContentQueueInspection } from '../../shared/contracts/socialContentQueue.js';
import type { ContentExecutionJob } from '../contentExecution/durableQueue.js';
import { socialContentEmbeddedRuntimeRegistrations } from './socialContentAgentWorkflowContext.js';
import { presenterProductionRoute } from '../../shared/contracts/presenterProductionRoute.js';

const REJECTION_MESSAGES: Record<string, string> = {
  rights_evidence_missing: '候选素材缺少授权凭据',
  commercial_use_not_allowed: '候选素材尚未确认可商用',
  commercial_use_evidence_missing: '候选素材缺少商用授权凭据',
  derivative_use_not_allowed: '候选素材尚未确认可剪辑改编',
  edit_boundary_unverified: '候选片段的可剪辑边界尚未核验',
  human_review_required: '候选片段需要人工复核',
  source_revision_mismatch: '候选素材版本已变化，需要重新分析',
};
type InspectTask = Pick<SocialContentTaskDetail, 'taskId' | 'version' | 'runId' | 'status' | 'brief' | 'readiness' | 'assetSupplyPlan' | 'agentWorkflow'>;

/** Explains existing gates without approving assets, writing jobs or calling a provider. */
export function inspectSocialContentQueue(input: {
  tenantId: string;
  task: InspectTask;
  localPreview: boolean;
  queueConfigured: boolean;
  executionIssue?: { code: string; message: string };
  job?: ContentExecutionJob | null;
  capabilityRuntime?: ReturnType<typeof socialContentEmbeddedRuntimeRegistrations>;
}): SocialContentQueueInspection {
  const { task, job } = input;
  const execution = job ? socialContentQueueProjection(job) : null;
  if (job && (job.tenantId !== input.tenantId || job.taskId !== task.taskId || job.runId !== task.runId))
    throw Error('social_content_queue_identity_mismatch');
  const issues = new Map<string, SocialContentQueueInspection['issues'][number]>();
  const notes = new Map<string, SocialContentQueueInspection['issues'][number]>();
  const add = (code: string, message: string, sceneId?: string, assetId?: string, target = issues) => {
    const issue = target.get(code) ?? { code, message, sceneIds: [], assetIds: [] };
    if (sceneId && !issue.sceneIds.includes(sceneId)) issue.sceneIds.push(sceneId);
    if (assetId && !issue.assetIds.includes(assetId)) issue.assetIds.push(assetId);
    target.set(code, issue);
  };
  if (input.localPreview) add('single_content_local_preview', '当前为本地预览，只保存任务；需接入执行环境后才能开始真实制作');
  if (input.executionIssue) add(input.executionIssue.code, input.executionIssue.message);
  if (!input.queueConfigured) add('social_content_orchestrator_not_configured', '当前服务尚未连接制作队列');
  if (!task.readiness.complete) add('social_content_task_inputs_incomplete', `任务输入尚未齐全：${task.readiness.missing.join('、')}`);
  const review = task.agentWorkflow?.executionPlanReview;
  if (!task.runId && !review?.approved) add('social_content_execution_director_review_required', '制作方案尚未通过审核，请处理下方分镜问题后重新检查');
  const supplies = new Map(task.assetSupplyPlan?.shots.map(shot => [shot.shotId, shot]));
  const scenes = (task.agentWorkflow?.executionPlan.scenes ?? []).map(scene => {
    const shot = supplies.get(scene.sceneId), routing = shot?.materialRouting;
    const reasons: string[] = [];
    if (!scene.recommendedCandidateIds.length) {
      reasons.push('没有可执行的推荐候选');
      if (routing?.policy === 'local_only' && routing.localMatch.state === 'missing') {
        add('social_content_scene_material_required', '没有符合这些镜头画面用途的可用视频；需补充对应素材或调整镜头方案', scene.sceneId);
        for (const rejection of routing.localMatch.rejections ?? []) {
          for (const code of rejection.reasons) {
            add(code, REJECTION_MESSAGES[code] ?? '候选片段未通过当前镜头的匹配检查', scene.sceneId, rejection.assetId, notes);
          }
        }
      }
      const registrations = input.capabilityRuntime ?? socialContentEmbeddedRuntimeRegistrations({
        tenantId: input.tenantId, wholeFilmBudget: Boolean(routing), productVideoProvider: routing?.generation?.videoProvider,
      });
      if (routing?.policy === 'authorized_presenter') {
        if (!shot?.digitalHumanPlan?.presenterAssetIds.length)
          add('social_content_presenter_asset_required', '本镜头尚未绑定企业可用数字人', scene.sceneId);
        if (!registrations.some(item => item.strategy === 'authorized_digital_presenter' && item.environmentReady))
          add('social_content_presenter_runtime_unavailable', '数字人生成服务尚未就绪；已有的人物授权无需重复办理', scene.sceneId);
      }
      if (routing?.generation && !registrations.some(item => item.strategy === 'aigc_product_scene_replication' && item.environmentReady))
        add('social_content_product_generation_unavailable', '本镜头需要的产品场景生成服务尚未就绪', scene.sceneId);
    }
    const sceneReview = review?.sceneResults.find(item => item.sceneId === scene.sceneId);
    for (const failure of sceneReview?.failedCriteria ?? []) if (!reasons.includes(failure)) reasons.push(failure);
    return { sceneId: scene.sceneId, materialType: routing?.materialType ?? 'general', ...(routing?.policy==='illustrative_video'?{illustrative:true}:{}), recommendedCandidates: scene.recommendedCandidateIds.length, reasons };
  });
  // A run or job is evidence of dispatch, not proof of successful production.
  // Never offer another original start while an existing run needs recovery.
  if (task.runId && !job) add('social_content_execution_job_pending', '已有运行，但暂未取得持久队列记录；请查看原任务派发回执，不要重复启动');
  if (job && ['blocked', 'dead_letter', 'paused', 'cancelled'].includes(job.status))
    add('social_content_execution_job_requires_attention', '原队列任务已暂停或需要处理，请在原任务中继续或修复');
  if (execution?.reason && execution.failureCode) add('content_execution_' + execution.failureCode, execution.reason);
  if (job?.lastError?.includes('presenter_speech_route_unavailable')) {
    const route = presenterProductionRoute({ sourceStrategy: 'authorized_digital_presenter', method: 'talking_head' });
    add('presenter_speech_route_unavailable', `${route.message}这是口型验收能力问题，已有 HeyGen 人物授权无需重复办理。`);
  }
  if (job?.lastError?.includes('whole_film_budget_preflight:')) {
    if (job.lastError.includes('provider_usage_bound_missing'))
      add('production_provider_billing_bound_missing', '供应商计费用量上界尚未接通，整片正式报价无法完成；任务保留在原队列，尚未提交付费制作。预算授权无需重复确认。');
    else if (job.lastError.includes('tariff'))
      add('production_provider_tariff_missing', '供应商正式计价凭据尚未齐全，整片报价未完成；请补齐服务端计价配置后继续原任务。');
  }
  return { taskId: task.taskId, version: task.version, runId: task.runId,
    ...(review?.budgetPreflight?{budgetPreflight:structuredClone(review.budgetPreflight)}:{}),
    canRequestStart: !task.runId && issues.size === 0 && !['completed', 'delivered', 'published', 'producing'].includes(task.status),
    runtime: { mode: input.localPreview ? 'preview' : 'execution', queueConfigured: input.queueConfigured },
    job: execution,
    ...(execution?.recovery ? { recovery: execution.recovery } : {}),
    issues: [...issues.values()], candidateNotes: [...notes.values()], scenes };
}
