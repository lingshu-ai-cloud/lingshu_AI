import {assertWeeklyProductionCoverage} from './weeklyProductionCoverageAdmission.js';
import {readWeeklyTemplateStructure} from '../socialPrograms/weeklyTemplateStructure.js';
import { checkWeeklyMaterialClassification, checkWeeklyHumanRequirementBindings } from './socialWeeklyMaterialClassificationAdmission.js';
import { withWeeklyProductionAdmissionGuard } from '../socialPrograms/weeklyCancellation.js';
import type { DataStore } from '../storage/datastore.js';
import type { WeeklyExecutionTask, VersionedSocialRef, WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';
import type { SocialContentTaskDetail, CreateSocialContentTaskInput } from '../../shared/contracts/socialContentWorkflow.js';
import { createStarter198Repository, STARTER_COLLECTIONS, type Starter198Repository } from '../starter198/repository.js';
import { addSocialTaskSource, createSocialContentTask, startSocialContentTask } from '../starter198/socialContentTasks.js';
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
import { createWeeklyRequiredMaterialAdmission, type WeeklyRequiredMaterialAdmissionInput, type WeeklyRequiredMaterialAdmission } from '../socialPrograms/weeklyRequiredMaterialAdmission.js';
import { socialContentSourceOptions, type SocialContentSourceOptionsPort } from '../starter198/socialContentSourceOptions.js';
import { getOwnedCloudMaterialRecord } from '../lib/cloudMaterials.js';
import { buildNoSharedMaterialDemand, verifiedNoSharedMaterialDemand } from './socialWeeklyMaterialDemand.js';
import { createHash } from 'node:crypto';
import { weeklyStoryboardEvidence } from './socialWeeklyStoryboardEvidence.js';

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
  addSource?:typeof addSocialTaskSource;
  sourceOptions?:SocialContentSourceOptionsPort;
  materialRecord?:typeof getOwnedCloudMaterialRecord;
  materialAdmission?:(input:WeeklyRequiredMaterialAdmissionInput)=>Promise<WeeklyRequiredMaterialAdmission>;
  bindAuthority?: typeof bindWeeklyProductionAuthority;
  persistResultAuthority?: typeof persistWeeklyProductionResultAuthority;
  orchestratorQueue?: Parameters<typeof startSocialContentTask>[0]['orchestratorQueue'];
}
/** Explicit customer evidence promises cannot be replaced by an automatic visual plan. */
export function requiresFrozenHumanMaterialContract(requirements: string[]): boolean {
  return requirements.some(requirement => /不可替代|真人|客户实证|必须.{0,24}(?:实拍|真实客户|工厂证据|产品实证)|(?:实拍|客户证据).{0,12}(?:必须|必需)/.test(requirement));
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
  const materialAdmission=ports.materialAdmission??createWeeklyRequiredMaterialAdmission(dataStore);
  const sourceOptions=ports.sourceOptions??socialContentSourceOptions;
  const addSource=ports.addSource??addSocialTaskSource;
  const orchestratorQueue = ports.orchestratorQueue ?? createStarter198OrchestratorQueue({ repository, dataStore });
  return { async execute(task: WeeklyExecutionTask): Promise<WeeklyExecutionAdapterResult> {
    if(task.inputSnapshot?.weeklyContinuationPending||task.inputSnapshot?.weeklyContinuationRef)return blocked('weekly_execution_continuation_observation_required','该任务承接已有真实运行，只能由承接适配器观察及结算，禁止新启动生产。');
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
    try{assertWeeklyProductionCoverage(pkg,planning,task.publicationTaskId!);}catch(error){return blocked(error instanceof Error&&'code' in error?String(error.code):'weekly_production_coverage_invalid','实际确认、派单范围或来源配额不一致，未开始生产。');}
    if (publication.accountId !== task.accountId || item.accountId !== publication.accountId) return blocked('weekly_production_account_mismatch', '排期账号身份不一致。');
    if (!publication.businessProposition || !publication.cta || !publication.factRefs.length || !item.topic) {
      return blocked('weekly_production_inputs_required', '经营主张、事实凭据、行动指引及排期主题必须完整。');
    }
    if (pkg.socialContentPackage.perItemBudgetCny === null || pkg.socialContentPackage.perItemBudgetCny < 0) {
      return blocked('weekly_production_budget_required', '生产预算尚未明确，不能开始供应商生成。');
    }
    const classification = await checkWeeklyMaterialClassification({store:dataStore,tenantId:task.tenantId,programId:task.programId,packageId:pkg.packageId,packageVersion:pkg.version,item,analysis:planning.directorAnalyses?.find(analysis=>analysis.analysisId===item.directorAnalysisRef?.id)});
    if(!classification.ready)return blocked(classification.code,'真实素材需求尚未明确分类或其来源版本与冻结排期不一致；请修订分析和排期后再生产。');
    if(publication.contentTemplateBindingRef){try{const structure=await readWeeklyTemplateStructure(dataStore,{tenantId:task.tenantId,programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion,publicationTaskId:task.publicationTaskId!},publication.contentTemplateBindingRef);if(!item.contentTemplateStructure||JSON.stringify(item.contentTemplateStructure)!==JSON.stringify(structure))return blocked('content_template_dispatch_mismatch','实际模板结构与冻结编导派单不一致，未进入生产。');}catch{return blocked('content_template_admission_failed','确认模板缺少实际来源或下一周绑定证据，未进入生产。');}}
    const binding = weeklyProductionBindingKey(task);
    const existing = await repository.list(STARTER_COLLECTIONS.socialContentTasks, task.tenantId, { where: { create_idempotency_key: binding }, perPage: 2 });
    if (existing.totalItems > 1) return blocked('weekly_production_binding_ambiguous', '内容生产任务绑定不唯一。');
    let detail: SocialContentTaskDetail | null = existing.items[0]
      ? await read({ repository, tenantId: task.tenantId, taskId: String(existing.items[0].task_id) }) : null;
    let scriptEvidence: VersionedSocialRef | null = null;
    let storyboardEvidence: VersionedSocialRef | null = null;
    let automaticMaterialEvidence:VersionedSocialRef|null=null;
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
      if (task.schedule.stepKind === 'storyboard') storyboardEvidence = weeklyStoryboardEvidence(boundRow, (item.benchmarkVideoRefs ?? []).map(ref => ref.id));
      if(publication.contentTemplateBindingRef){const baseline=socialObject(socialJson(boundRow.script_baseline));if(JSON.stringify(baseline?.contentTemplateStructure)!==JSON.stringify(item.contentTemplateStructure)){scriptEvidence=null;storyboardEvidence=null;}}
      const brief = socialObject(socialJson(boundRow.brief))!;
      let authority = brief._weeklyAuthority as Awaited<ReturnType<typeof bindWeeklyProductionAuthority>> | undefined;
      if (!authority) {
        authority = await (ports.bindAuthority ?? bindWeeklyProductionAuthority)({ dataStore, repository, tenantId: task.tenantId, pkg, publication, detail });
        await repository.update(STARTER_COLLECTIONS.socialContentTasks, task.tenantId, boundRow.id, { brief: { ...brief, _weeklyAuthority: authority } });
        detail = (await read({ repository, tenantId: task.tenantId, taskId: detail.taskId }))!;
      }
      await (ports.persistResultAuthority ?? persistWeeklyProductionResultAuthority)({ repository, tenantId: task.tenantId, authority, detail });
      if ((classification.contract.items.some(item=>item.classification==='human_irreplaceable') || requiresFrozenHumanMaterialContract(item.materialRequirements ?? [])) && !publication.materialRequirement) {
        return {
          status: 'blocked', code: 'weekly_required_material_contract_missing',
          message: '冻结排期承诺了不可替代的真人或客户实证素材，但尚未绑定真实素材任务。请显式绑定并核验，或由经营修订该承诺；自动计划不能代替。',
          progress: { contentTaskId: detail.taskId, runId: detail.runId, step: 'material_readiness', activity: '等待不可替代素材需求冻结与核验', updatedAt: new Date().toISOString() },
        };
      }
      if(!publication.materialRequirement) {
        const demandScope={taskId:detail.taskId,programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion,publicationTaskId:task.publicationTaskId,accountId:publication.accountId,factRefs:publication.factRefs};
        let demand=verifiedNoSharedMaterialDemand(boundRow,demandScope);
        if(!demand&&!detail.runId) {
          demand=buildNoSharedMaterialDemand(boundRow,detail,demandScope);
          if(demand) {
            await assertAdmission();
            const latest=await repository.list(STARTER_COLLECTIONS.socialContentTasks,task.tenantId,{where:{task_id:detail.taskId},perPage:2});
            if(latest.totalItems!==1||latest.items[0].run_id)return blocked('weekly_material_demand_changed','素材计划冻结期间内容运行状态已变化。');
            const currentBrief=socialObject(socialJson(latest.items[0].brief))??{};
            await repository.update(STARTER_COLLECTIONS.socialContentTasks,task.tenantId,latest.items[0].id,{brief:{...currentBrief,_weeklyMaterialDemand:demand}});
            const persisted=await repository.list(STARTER_COLLECTIONS.socialContentTasks,task.tenantId,{where:{task_id:detail.taskId},perPage:2});
            demand=persisted.totalItems===1?verifiedNoSharedMaterialDemand(persisted.items[0],demandScope):null;
            if(!demand)return blocked('weekly_material_demand_storage_failed','自动素材需求计划尚未持久冻结。');
          }
        }
        if(demand)automaticMaterialEvidence={type:'starter_social_content_material_demand',id:detail.taskId,version:demand.version};
      }
      let requiredMaterialAdmission:WeeklyRequiredMaterialAdmission|null=null;
      if(publication.materialRequirement) {
        const materialRows:any[]=[];
        for(let page=1;;page++) {
          const batch=await dataStore.list<any>('social_weekly_execution_tasks',{where:{tenant_id:task.tenantId,program_id:task.programId,package_id:task.packageId,package_version:task.packageVersion},sort:'id',page,perPage:500});
          materialRows.push(...batch.items);
          if(page>=batch.totalPages)break;
          if(!batch.items.length)return blocked('weekly_material_consumer_lookup_incomplete','素材消费者任务列表需完整读取后才能核验。');
        }
        const matching=materialRows.filter(row=>{const payload=socialObject(socialJson(row.payload));return payload?.publicationTaskId===task.publicationTaskId&&socialObject(payload.schedule)?.stepKind==='material_readiness';});
        if(matching.length!==1)return blocked('weekly_material_consumer_required','缺少唯一的真实素材核验消费者。');
        const consumer=socialObject(socialJson(matching[0].payload))!;
        if(['cancelled','dead_letter'].includes(String(consumer.status)))return blocked('weekly_material_consumer_inactive','素材核验消费者已取消或失败，需明确恢复。');
        if(consumer.tenantId!==task.tenantId||consumer.programId!==task.programId||consumer.packageId!==task.packageId||consumer.packageVersion!==task.packageVersion||consumer.taskId!==matching[0].task_id)return blocked('weekly_material_consumer_identity_invalid','素材消费者身份与冻结视频版本不一致。');
        const mappingGap=await checkWeeklyHumanRequirementBindings({store:dataStore,tenantId:task.tenantId,programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion,consumerTaskId:String(consumer.taskId),publication,contract:classification.contract});
        if(mappingGap)return blocked(mappingGap,'不可替代素材必须逐需求明确绑定，并由本视频消费者核验对应镜头。');
        requiredMaterialAdmission=await materialAdmission({tenantId:task.tenantId,programId:task.programId,consumerTaskId:String(consumer.taskId),requirement:publication.materialRequirement});
        if(requiredMaterialAdmission.status!=='ready'||!requiredMaterialAdmission.materials.length)return {status:'blocked',code:'weekly_required_materials_missing',message:`冻结必需素材未就绪：${requiredMaterialAdmission.gaps.map(gap=>`${gap.requestId??'合同'}:${gap.code}`).join('、')}`,progress:{contentTaskId:detail.taskId,runId:detail.runId,step:'material_readiness',activity:'等待共享素材提交与逐视频核验',updatedAt:new Date().toISOString()}};
        for(const material of requiredMaterialAdmission.materials) {
          const sourceRef=`socialmaterial:${Buffer.from(`pb-${material.recordId}`,'utf8').toString('base64url')}`;
          const option=await sourceOptions.resolve({tenantId:task.tenantId,kind:'material',sourceRef});
          const raw=await (ports.materialRecord??getOwnedCloudMaterialRecord)(material.recordId,task.tenantId);
          if(!option||option.kind!=='material'||option.sourceRef!==sourceRef||!option.sourceVersion||!raw||raw.id!==material.recordId||String(raw.tenantId||raw.tenant_id)!==task.tenantId||String(raw.scope||'own')==='shared'||String(raw.sha256||'')!==material.sha256)return blocked('weekly_material_source_revision_invalid','生产素材选项或实际字节版本与审核凭据不一致。');
          const attached=(detail.sources??[]).filter(source=>source.kind==='material'&&source.sourceRef===sourceRef&&source.status==='active');
          if(attached.length>1||attached.some(source=>source.sourceVersion!==option.sourceVersion))return blocked('weekly_material_source_version_conflict','现有生产素材版本与当前已核验版本冲突，请显式修订。');
          if(attached.length)continue;
          if(detail.runId)return blocked('weekly_running_material_binding_change_required','生产已运行，但缺少被冻结素材绑定；不能运行中编辑输入或重新付费执行。');
          await assertAdmission();
          const sourceKey=createHash('sha256').update(JSON.stringify([binding,material.recordId,option.sourceVersion])).digest('hex');
          const added=await addSource({repository,tenantId:task.tenantId,userId:planning.userConfirmation.confirmedBy,taskId:detail.taskId,idempotencyKey:`weekly-material:${sourceKey}`,sourceOptions,value:{kind:'material',sourceRef,sourceVersion:option.sourceVersion,label:option.label,purpose:'冻结周排期必需素材；逐视频事实、权利与镜头已核验'}});
          detail=added.task;
          if(!(detail.sources??[]).some(source=>source.kind==='material'&&source.sourceRef===sourceRef&&source.sourceVersion===option.sourceVersion&&source.status==='active'))return blocked('weekly_material_source_binding_missing','真实素材来源绑定尚未持久保存。');
        }
      }
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
    if (task.schedule.stepKind === 'storyboard' && storyboardEvidence) return success(storyboardEvidence);
    if (task.schedule.stepKind === 'script' || task.schedule.stepKind === 'storyboard') {
      if (['attention', 'needs_input', 'paused'].includes(detail.status)) return blocked('weekly_production_user_action_required', detail.productionProgress?.activity || '生产已暂停，需先处理真实输入或执行异常。');
      return { ...pending('weekly_locked_handoff_pending', '等待对应冻结参考的锁定脚本或分镜交接凭证。'), progress };
    }
    if (job?.status === 'reconciling') return { ...pending('provider_reconciliation', '供应商结果未知，沿用原生产身份对账，不能重新付费提交。'), progress };
    if(task.schedule.stepKind==='material_readiness'&&automaticMaterialEvidence)return success(automaticMaterialEvidence);
    if (task.schedule.stepKind === 'material_readiness' && !publication.materialRequirement) return blocked('weekly_material_contract_required','旧版任务没有冻结素材合同，不能以通用输入完整作为素材已核验凭据。');
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
      const evidence = step === 'asset_generation' ? content.render?.selectedAssetIds?.length > 0
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
