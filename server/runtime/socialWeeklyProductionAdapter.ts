import { withWeeklyProductionAdmissionGuard } from '../socialPrograms/weeklyCancellation.js';
import type { DataStore } from '../storage/datastore.js';
import type { WeeklyExecutionTask, VersionedSocialRef, WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';
import type { SocialContentTaskDetail, CreateSocialContentTaskInput } from '../../shared/contracts/socialContentWorkflow.js';
import { createStarter198Repository, STARTER_COLLECTIONS, type Starter198Repository } from '../starter198/repository.js';
import { createSocialContentTask, startSocialContentTask } from '../starter198/socialContentTasks.js';
import { readSocialTaskDetail } from '../starter198/socialContentRecords.js';
import { createStarter198OrchestratorQueue } from '../starter198/orchestratorQueue.js';
import { bindWeeklyProductionAuthority, persistWeeklyProductionResultAuthority } from './socialWeeklyProductionAuthority.js';
import { socialJson, socialObject } from '../starter198/socialContentValidation.js';
import { readContentExecutionJob } from '../contentExecution/durableQueue.js';
import { createSocialOperatingRepository } from '../socialOperating/repository.js';
import { createWeeklyPlanningAuthority } from '../socialPrograms/planningAuthority.js';
import { PACKAGES, type PackageRow } from '../socialPrograms/weeklyOperatingPackageSupport.js';
import type { SocialWeeklyExecutionAdapter, WeeklyExecutionAdapterResult } from './socialWeeklyExecutionAdapter.js';
import { weeklyScriptEvidence } from './socialWeeklyScriptEvidence.js';

export const WEEKLY_PRODUCTION_STEPS = ['material_readiness', 'script', 'storyboard', 'asset_generation', 'video_generation', 'quality_check', 'rework'] as const;
export function weeklyProductionBindingKey(task: Pick<WeeklyExecutionTask, 'packageId' | 'packageVersion' | 'publicationTaskId'>): string {
  return `weekly-production:${task.packageId}:${task.packageVersion}:${task.publicationTaskId}`;
}

/** The creation receipt is the durable binding; recovery never guesses by title or account. */
export async function findWeeklyProductionTask(dataStore: DataStore, task: WeeklyExecutionTask): Promise<SocialContentTaskDetail | null> {
  const repository = createStarter198Repository(dataStore);
  const rows = await repository.list(STARTER_COLLECTIONS.socialContentTasks, task.tenantId, {
    where: { create_idempotency_key: weeklyProductionBindingKey(task) }, perPage: 2,
  });
  if (rows.totalItems > 1) throw new Error('weekly_production_binding_ambiguous');
  const taskId = rows.items[0]?.task_id;
  return typeof taskId === 'string' ? readSocialTaskDetail({ repository, tenantId: task.tenantId, taskId }) : null;
}

export interface WeeklyProductionPorts {
  repository?: Starter198Repository;
  create?: typeof createSocialContentTask;
  start?: typeof startSocialContentTask;
  read?: typeof readSocialTaskDetail;
  bindAuthority?: typeof bindWeeklyProductionAuthority;
  persistResultAuthority?: typeof persistWeeklyProductionResultAuthority;
  orchestratorQueue?: Parameters<typeof startSocialContentTask>[0]['orchestratorQueue'];
}
const blocked = (code: string, message: string): WeeklyExecutionAdapterResult => ({ status: 'blocked', code, message });
const pending = (code: string, message: string): Extract<WeeklyExecutionAdapterResult, { status: 'pending' }> => ({ status: 'pending', code, message, retryDelayMs: 15_000 });
function version(value: string): number | null {
  const parsed = Number(value.replace(/^v/, ''));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
function success(ref: VersionedSocialRef): WeeklyExecutionAdapterResult { return { status: 'succeeded', resultRefs: [ref] }; }

/** Admission uses the same guarded starter command and durable provider queue as the content workbench. */
export function createSocialWeeklyProductionAdapter(dataStore: DataStore, ports: WeeklyProductionPorts = {}): SocialWeeklyExecutionAdapter {
  const repository = ports.repository ?? createStarter198Repository(dataStore);
  const create = ports.create ?? createSocialContentTask;
  const start = ports.start ?? startSocialContentTask;
  const read = ports.read ?? readSocialTaskDetail;
  const orchestratorQueue = ports.orchestratorQueue ?? createStarter198OrchestratorQueue({ repository, dataStore });
  return { async execute(task: WeeklyExecutionTask): Promise<WeeklyExecutionAdapterResult> {
    try {
      return await withWeeklyProductionAdmissionGuard({ dataStore, tenantId: task.tenantId, packageId: task.packageId, packageVersion: task.packageVersion, action: async (assertAdmission) => {
    if (!task.publicationTaskId || !WEEKLY_PRODUCTION_STEPS.includes(task.schedule.stepKind as typeof WEEKLY_PRODUCTION_STEPS[number])) {
      return blocked('weekly_production_step_unsupported', '该排期节点没有内容生产执行器。');
    }
    const rows = await dataStore.list<PackageRow>(PACKAGES, { where: {
      tenant_id: task.tenantId, program_id: task.programId, package_id: task.packageId, version: task.packageVersion,
    }, perPage: 2 });
    if (rows.items.length !== 1) return blocked('weekly_package_required', '缺少唯一的冻结周任务包。');
    const pkg = rows.items[0]!.payload;
    const planning = await createWeeklyPlanningAuthority(dataStore).get(task.tenantId, task.programId, task.packageId, task.packageVersion).catch(() => null);
    pkg.agentPlanning = planning ?? undefined;
    const dispatch = planning?.dispatch;
    const item = dispatch?.scheduleItems.find(item => item.publicationTaskId === task.publicationTaskId);
    const publication = pkg.socialContentPackage.publicationTasks.find(item => item.publicationTaskId === task.publicationTaskId);
    if (!['draft', 'active'].includes(pkg.status) || planning?.status !== 'dispatched' || !planning.userConfirmation?.confirmedBy
      || !dispatch || dispatch.packageId !== pkg.packageId || dispatch.packageVersion !== pkg.version || !item || !publication) {
      return blocked('business_dispatch_required', '内容生产需要用户确认后正式派单的冻结排期。');
    }
    if (publication.accountId !== task.accountId || item.accountId !== publication.accountId) return blocked('weekly_production_account_mismatch', '排期账号身份不一致。');
    if (!publication.businessProposition || !publication.cta || !publication.factRefs.length || !item.topic) {
      return blocked('weekly_production_inputs_required', '经营主张、事实凭据、行动指引及排期主题必须完整。');
    }
    if (pkg.socialContentPackage.perItemBudgetCny === null || pkg.socialContentPackage.perItemBudgetCny < 0) {
      return blocked('weekly_production_budget_required', '生产预算尚未明确，不能开始供应商生成。');
    }
    const binding = weeklyProductionBindingKey(task);
    const existing = await repository.list(STARTER_COLLECTIONS.socialContentTasks, task.tenantId, { where: { create_idempotency_key: binding }, perPage: 2 });
    if (existing.totalItems > 1) return blocked('weekly_production_binding_ambiguous', '内容生产任务绑定不唯一。');
    let detail: SocialContentTaskDetail | null = existing.items[0]
      ? await read({ repository, tenantId: task.tenantId, taskId: String(existing.items[0].task_id) }) : null;
    let scriptEvidence: VersionedSocialRef | null = null;
    try {
      if (!detail) {
        const goalRef = pkg.businessContentGoalRef;
        const goal = goalRef ? await createSocialOperatingRepository(dataStore).getGoal(task.tenantId, task.programId, goalRef.id, goalRef.version) : null;
        const programRows = await dataStore.list<any>('social_programs', { where: { tenant_id: task.tenantId, program_id: task.programId }, perPage: 2 });
        const accountRows = await dataStore.list<any>('social_owned_accounts', { where: { tenant_id: task.tenantId, program_id: task.programId, account_id: publication.accountId }, perPage: 2 });
        if (!goal || goal.status !== 'ready' || programRows.totalItems !== 1 || accountRows.totalItems !== 1) return blocked('weekly_production_authority_required', '经营目标、计划身份或账号身份缺少有效依据。');
        const value: CreateSocialContentTaskInput = {
          title: item.topic, objective: goal.objective, productRef: goal.products[0], audience: goal.audiences[0], markets: goal.markets, customTopic: item.topic,
          callToAction: publication.cta, platforms: [publication.platform], languages: goal.languages,
          formats: ['short_video'], requestedOutputCount: 1, dueAt: publication.publishWindow,
          weeklyPlanId: pkg.packageId, mode: 'weekly', managementMode: 'one_click_managed', productionApproach: 'ai_enhanced', productionMode: 'social_ready',
          weeklyBudgetCny: pkg.socialContentPackage.weeklyBudgetCny,
          perItemBudgetCny: pkg.socialContentPackage.perItemBudgetCny,
          programRef: { objectType: 'social_program', id: task.programId, version: String(programRows.items[0].payload.version) },
          targetAccountRef: { objectType: 'owned_social_account', id: publication.accountId, version: String(accountRows.items[0].payload.version) },
          specialRequirements: [item.topic, ...item.materialRequirements, `事实凭据：${publication.factRefs.map(ref => `${ref.type}:${ref.id}@${ref.version}`).join('，')}`].join('\n'),
        };
        await assertAdmission();
        detail = await create({ repository, tenantId: task.tenantId, userId: planning.userConfirmation.confirmedBy, idempotencyKey: binding, value });
      }
      const boundRows = await repository.list(STARTER_COLLECTIONS.socialContentTasks, task.tenantId, { where: { task_id: detail.taskId }, perPage: 2 });
      const boundRow = boundRows.items[0];
      if (!boundRow || boundRows.totalItems !== 1) return blocked('weekly_production_binding_missing', '内容任务身份无法核对。');
      if (task.schedule.stepKind === 'script') scriptEvidence = weeklyScriptEvidence(boundRow, (item.benchmarkVideoRefs ?? []).map(ref => ref.id));
      const brief = socialObject(socialJson(boundRow.brief))!;
      let authority = brief._weeklyAuthority as Awaited<ReturnType<typeof bindWeeklyProductionAuthority>> | undefined;
      if (!authority) {
        authority = await (ports.bindAuthority ?? bindWeeklyProductionAuthority)({ dataStore, repository, tenantId: task.tenantId, pkg, publication, detail });
        await repository.update(STARTER_COLLECTIONS.socialContentTasks, task.tenantId, boundRow.id, { brief: { ...brief, _weeklyAuthority: authority } });
        detail = (await read({ repository, tenantId: task.tenantId, taskId: detail.taskId }))!;
      }
      await (ports.persistResultAuthority ?? persistWeeklyProductionResultAuthority)({ repository, tenantId: task.tenantId, authority, detail });
      const unmetMaterials = new Set([
        ...(detail.materialReadiness?.blockingRequirementIds ?? []),
        ...(detail.materialRequirements ?? []).filter(requirement => requirement.required && requirement.status !== 'satisfied').map(requirement => requirement.requirementId),
      ]);
      if (unmetMaterials.size || detail.materialReadiness?.complete === false) {
        return { status: 'blocked', code: 'weekly_required_materials_missing', message: `必需素材尚未核验通过：${[...unmetMaterials].join('、') || '素材核验未完成'}。请在原内容任务补交并核验后继续；不能默认以生成素材替代。`,
          progress: { contentTaskId: detail.taskId, runId: detail.runId, step: 'material_readiness', activity: '等待必需素材补交与核验', updatedAt: new Date().toISOString() } };
      }
      // Never restart an existing run after a provider timeout. Its durable job owns receipt reconciliation.
      if (!detail.runId && ['draft', 'needs_input', 'plan_review'].includes(detail.status)) {
        if (!detail.readiness.complete) return { status: 'blocked', code: 'weekly_production_inputs_required', message: `内容输入待补全：${detail.readiness.missing.join('、')}`,
          progress: { contentTaskId: detail.taskId, runId: null, step: 'material_readiness', activity: '等待内容输入补齐', updatedAt: new Date().toISOString() } };
        await assertAdmission();
        detail = await start({ repository, orchestratorQueue, tenantId: task.tenantId,
          userId: planning.userConfirmation.confirmedBy, taskId: detail.taskId,
          expectedVersion: detail.version, idempotencyKey: `${binding}:start` });
      }
    } catch (error) {
      const code = error instanceof Error && /^weekly_/.test(error.message) ? error.message : error && typeof error === 'object' && 'code' in error ? String(error.code) : 'weekly_production_admission_failed';
      return blocked(code, error instanceof Error ? error.message : '内容生产准入失败。');
    }
    if (!detail.runId) return blocked('weekly_production_confirmation_required', '内容任务已保留，等待既有生产准入确认。');
    const job = await readContentExecutionJob(dataStore, task.tenantId, detail.taskId, detail.runId);
    if (['draft', 'needs_input', 'plan_review'].includes(detail.status) && !job) return blocked('weekly_production_confirmation_required', '运行身份已保留，但尚未完成生产准入确认。');
    if (job && ['blocked', 'paused', 'cancelled', 'dead_letter'].includes(job.status)) return blocked(job.retryClass || `content_execution_${job.status}`, job.lastError || '后台生产需要处理后才能继续。');
    const progress = detail.productionProgress ? { contentTaskId: detail.taskId, runId: detail.runId, step: detail.productionProgress.step, activity: detail.productionProgress.activity, updatedAt: detail.productionProgress.updatedAt } : undefined;
    if (task.schedule.stepKind === 'script' && scriptEvidence) return success(scriptEvidence);
    if (job?.status === 'reconciling') return { ...pending('provider_reconciliation', '供应商结果未知，沿用原生产身份对账，不能重新付费提交。'), progress };
    if (task.schedule.stepKind === 'material_readiness' && detail.readiness.complete) {
      const v = version(detail.version);
      return v ? success({ type: 'starter_social_content_task', id: detail.taskId, version: v }) : blocked('weekly_production_version_invalid', '内容任务版本无效。');
    }
    const artifact = [...detail.artifacts].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)).find(artifact => artifact.kind === 'short_video' && artifact.origin === 'agent'
      && artifact.resourceRef && artifact.status !== 'changes_requested' && artifact.status !== 'superseded'
      && artifact.content?.render && (artifact.content.render as Record<string, unknown>).completed === true);
    if (artifact) {
      const content = artifact.content! as Record<string, any>;
      const step = task.schedule.stepKind;
      const evidence = step === 'script' ? content.scriptBaseline?.scenes?.length > 0 && content.scriptBaseline.scenes.every((scene: any) => String(scene.script || scene.voiceover || '').trim())
        : step === 'storyboard' ? content.directorPlan?.sceneCount > 0
        : step === 'asset_generation' ? content.render?.selectedAssetIds?.length > 0
        : step === 'video_generation' ? content.render?.completed === true
        : content.productionResult?.technicalReview?.approved === true && content.productionResult?.creativeReview?.approved === true;
      if (!evidence) return blocked('weekly_production_quality_review_required', '产物已保留，但该生产节点缺少通过验收的真实证据。');
      const v = version(artifact.version);
      return v ? success({ type: 'starter_social_content_artifact', id: artifact.artifactId, version: v }) : blocked('weekly_production_version_invalid', '内容产物版本无效。');
    }
    if (['attention', 'needs_input', 'paused'].includes(detail.status)) return blocked('weekly_production_user_action_required', detail.productionProgress?.activity || '生产已暂停，需处理输入、凭据、余额或质检问题。');
    return { ...pending('weekly_production_in_progress', detail.productionProgress?.activity || '后台生产进行中，正在等待真实产物或供应商回执对账。'), progress };
      } });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'weekly_production_admission_failed';
      if (code === 'weekly_cancellation_busy') return pending(code, '撤回或生产准入正在处理，等待安全恢复。');
      return blocked(code, error instanceof Error ? error.message : '该周版本不能继续生产。');
    }
  } };
}
