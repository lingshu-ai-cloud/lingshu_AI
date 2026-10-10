import {INITIAL_CAPACITY_SCHEDULE_REQUIRED} from './weeklyInitialScheduleGate.js';
import {createWeeklyExecutionContinuationService} from './weeklyExecutionContinuations.js';
import {withExecutionPackageGate,assertExecutionPackageGate,executionPackageFrozen} from './weeklyExecutionGate.js';
import {applyFrozenWeeklySchedule,scheduleHash} from './weeklyScheduleSnapshots.js';
import type {WeeklyScheduledPackage} from '../../shared/contracts/socialWeeklyScheduleRevision.js';
import { applyPublicationDeadlines, publicationInstant } from "./publicationDeadlines.js";
import { reconcileWeeklyCancellation } from './weeklyCancellation.js';
import { createHash, randomUUID } from 'node:crypto';
import type { DataStore } from '../storage/datastore.js';
import {
  WEEKLY_EXECUTION_TASK_STATUSES,
  WEEKLY_OPERATING_WORKFLOW_KINDS,
  type SocialWeeklyPublicationTask,
  type VersionedSocialRef,
  type WeeklyBusinessContentDispatch,
  type WeeklyExecutionStatusSummary,
  type WeeklyExecutionTask,
  type WeeklyAgentChainContract,
  type WeeklyAgentChainProfile,
  type WeeklyAgentChainTaskCode,
  type WeeklyProductionStepKind,
  type WeeklyResponsibleActor,
  type WeeklyExecutionTaskStatus,
  type WeeklyOperatingPackage,
  type WeeklyOperatingWorkflow,
  type WeeklyOperatingWorkflowKind,
} from '../../shared/contracts/socialProgram.js';
import { SocialProgramError } from './service.js';
import { allocateWeeklyReferenceSources } from './weeklyReferenceSources.js';
import { createStarter198Repository } from '../starter198/repository.js';
import { socialJson } from '../starter198/socialContentValidation.js';
import { validateContentArtifact } from '../runtime/socialWeeklyResultValidation.js';
import { decideSocialContentArtifact } from '../starter198/socialContentOutputs.js';
import {
  acquireDurableOperationLease,
  releaseDurableOperationLease,
  type DurableOperationLease,
} from '../runtime/durableLease.js';

export const WEEKLY_EXECUTION_TASKS = 'social_weekly_execution_tasks';
export const SOCIAL_WEEKLY_EXECUTION_LEASE_SCOPE = 'social-weekly-execution';
const SOCIAL_WEEKLY_EXECUTION_MUTATION_SCOPE = 'social-weekly-execution-mutation';
const SOCIAL_WEEKLY_EXECUTION_PACKAGE_SCOPE = 'social-weekly-execution-package';

export type WeeklyExecutionTaskRow = {
  id: string;
  tenant_id: string;
  program_id: string;
  package_id: string;
  package_version: number;
  task_id: string;
  workflow_kind: WeeklyOperatingWorkflowKind;
  status: WeeklyExecutionTaskStatus;
  idempotency_key: string;
  next_attempt_at: string;
  payload: WeeklyExecutionTask;
  created_at: string;
  updated_at: string;
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const taskId = (key: string) => `wet_${hash(key).slice(0, 24)}`;
const moneyShare = (total: number | null, count: number): number | null => (
  total === null || count < 1 ? null : Math.round((total / count) * 100) / 100
);

function normalizeExecutionTask(task: WeeklyExecutionTask): WeeklyExecutionTask {
  if (task.schedule) return task;
  const legacy = task as WeeklyExecutionTask & { schedule?: WeeklyExecutionTask['schedule'] };
  const mapping: Record<WeeklyOperatingWorkflowKind, { stepKind: WeeklyProductionStepKind; responsibleActor: WeeklyResponsibleActor; duration: number }> = {
    readiness: { stepKind: 'business_outline', responsibleActor: 'business_agent', duration: 15 },
    discovery: { stepKind: 'benchmark_collection', responsibleActor: 'director_agent', duration: 60 },
    directing: { stepKind: 'director_analysis', responsibleActor: 'director_agent', duration: 45 },
    content: { stepKind: 'video_generation', responsibleActor: 'content_agent', duration: 180 },
    publishing: { stepKind: 'publishing', responsibleActor: 'publishing_agent', duration: 10 },
    engagement: { stepKind: 'performance_monitoring', responsibleActor: 'business_agent', duration: 60 },
    review: { stepKind: 'weekly_review', responsibleActor: 'business_agent', duration: 45 },
  };
  const value = mapping[task.workflowKind];
  const start = task.createdAt;
  return {
    ...legacy,
    schedule: {
      stepKind: value.stepKind,
      responsibleActor: value.responsibleActor,
      estimatedDurationMinutes: value.duration,
      estimatedStartAt: start,
      estimatedFinishAt: new Date(Date.parse(start) + value.duration * 60_000).toISOString(),
      actualStartedAt: null,
      actualFinishedAt: null,
    },
  };
}

function emptyCounts(): Record<WeeklyExecutionTaskStatus, number> {
  return Object.fromEntries(WEEKLY_EXECUTION_TASK_STATUSES.map(status => [status, 0])) as Record<WeeklyExecutionTaskStatus, number>;
}

function workflowStatus(tasks: WeeklyExecutionTask[]): WeeklyOperatingWorkflow['status'] {
  if (tasks.some(task => task.status === 'dead_letter' || task.status === 'blocked' || task.ownBlockingReasons.length)) return 'blocked';
  if (tasks.length && tasks.every(task => task.status === 'cancelled')) return 'cancelled';
  if (tasks.length && tasks.every(task => task.status === 'succeeded' || task.status === 'cancelled')) return 'completed';
  if (tasks.some(task => task.status === 'leased' || task.status === 'succeeded')) return 'in_progress';
  return 'planned';
}

export function summarizeWeeklyExecutionTasks(tasks: WeeklyExecutionTask[], refreshedAt = new Date().toISOString()): WeeklyExecutionStatusSummary {
  const byStatus = emptyCounts();
  for (const task of tasks) byStatus[task.status] += 1;
  const byWorkflow = Object.fromEntries(WEEKLY_OPERATING_WORKFLOW_KINDS.map(kind => [
    kind,
    workflowStatus(tasks.filter(task => task.workflowKind === kind)),
  ])) as WeeklyExecutionStatusSummary['byWorkflow'];
  return { total: tasks.length, byStatus, byWorkflow, refreshedAt };
}

export function projectWeeklyExecution(
  pkg: WeeklyOperatingPackage,
  tasks: WeeklyExecutionTask[],
  refreshedAt?: string,
): WeeklyOperatingPackage {
  const stableRefresh = refreshedAt ?? tasks.reduce(
    (latest, task) => task.updatedAt > latest ? task.updatedAt : latest,
    pkg.updatedAt,
  );
  const summary = summarizeWeeklyExecutionTasks(tasks, stableRefresh);
  const workflows = WEEKLY_OPERATING_WORKFLOW_KINDS.map(kind => {
    const matching = tasks.filter(task => task.workflowKind === kind);
    const existing = pkg.workflows.find(workflow => workflow.kind === kind);
    return {
      kind,
      status: summary.byWorkflow[kind],
      // Keep the seven stable summary references for R1/read-model compatibility;
      // executionTaskRefs is the explicit fan-out surface for workers.
      taskRefs: existing?.taskRefs ?? [],
      blockingReasons: [...new Set(matching.flatMap(task => [
        ...task.ownBlockingReasons,
        ...task.inheritedBlockingTaskIds.map(id => `upstream:${id}`),
        ...(task.status === 'dead_letter' && task.lastError ? [`dead_letter:${task.lastError.code}`] : []),
      ]))],
    };
  });
  return {
    ...pkg,
    workflows,
    executionTaskRefs: tasks.map(task => ({ type: 'weekly_execution_task', id: task.taskId, version: 1 })),
    executionSummary: summary,
  };
}

function authorityRefs(pkg: WeeklyOperatingPackage): VersionedSocialRef[] {
  return [
    pkg.enterpriseProfileRef,
    pkg.businessContentGoalRef ?? null,
    pkg.monthlyPlanRef,
    pkg.capacityPlanRef,
    pkg.automationPolicyRef,
  ].filter((ref): ref is VersionedSocialRef => Boolean(ref));
}

type TaskSeed = Pick<WeeklyExecutionTask,
  'workflowKind' | 'scope' | 'subjectId' | 'accountId' | 'publicationTaskId'
  | 'dependsOnTaskIds' | 'inputSnapshot' | 'budget' | 'ownBlockingReasons'> & {
    stepKind: WeeklyProductionStepKind;
    responsibleActor: WeeklyResponsibleActor;
    estimatedDurationMinutes: number;
    notBeforeAt?: number | null;
  };

const MAIN_CHAIN_BY_STEP: Record<WeeklyProductionStepKind, number> = {
  business_outline:1, benchmark_collection:2, benchmark_scoring:2, director_analysis:2,
  business_schedule:3, material_preparation:4, material_readiness:4, script:4, storyboard:4,
  asset_generation:5, video_generation:5, quality_check:5, rework:5, user_approval:5,
  publishing:6, customer_channel_readiness:7, customer_inquiry_handoff:7, performance_monitoring:8, weekly_review:8,
  template_extraction:8, template_performance_validation:8,
};

const SIDE_CHAIN_BY_STEP: Partial<Record<WeeklyProductionStepKind, number[]>> = {
  business_outline:[2], business_schedule:[8], material_preparation:[1], material_readiness:[2],
  quality_check:[3], rework:[3], publishing:[4], customer_channel_readiness:[2], customer_inquiry_handoff:[7], performance_monitoring:[5,7],
  template_extraction:[6], template_performance_validation:[9], weekly_review:[9],
};

function chainIdentity(pkg:WeeklyOperatingPackage,seed:TaskSeed):{
  chainProfile?:WeeklyAgentChainProfile;chainTaskCode?:WeeklyAgentChainTaskCode;
  chainSupportTaskCodes?:WeeklyAgentChainTaskCode[];chainContract?:WeeklyAgentChainContract;
}{
  const profile=pkg.referenceSourcePolicy?.profile;if(!profile)return {};
  const prefix=profile==='b2b_cold_start'?'Z':'H';
  const source=seed.inputSnapshot.referenceSource;
  const route=profile==='b2b_cold_start'?'external_cold_start':source==='owned'?'owned_history_iteration':source==='external'?'external_incremental_exploration':'mixed_history_and_external';
  const taskCode=`${prefix}-M${MAIN_CHAIN_BY_STEP[seed.stepKind]}` as WeeklyAgentChainTaskCode;
  const chainSupportTaskCodes=(SIDE_CHAIN_BY_STEP[seed.stepKind]??[]).map(index=>`${prefix}-S${index}` as WeeklyAgentChainTaskCode);
  const commonInputs=['frozen_weekly_package','verified_enterprise_facts','confirmed_schedule_scope'];
  const commonOutputs:[string,string]=[`verified_${seed.stepKind}_receipt`,`profile_route:${route}`];
  const requiredInputKinds=profile==='b2b_cold_start'
    ?[...commonInputs,'external_reference_evidence','first_week_baseline_gap']
    :[...commonInputs,'historical_account_baseline','confirmed_owned_external_quota',source==='owned'?'owned_video_metrics_and_tone':'external_reference_evidence'];
  const deliverableKinds=profile==='b2b_cold_start'
    ?[...commonOutputs,'cold_start_enterprise_expression']
    :[...commonOutputs,source==='owned'?'tone_preserving_iteration':'brand_adapted_exploration'];
  return {chainProfile:profile,chainTaskCode:taskCode,chainSupportTaskCodes,chainContract:{requiredInputKinds,deliverableKinds}};
}

function makeTask(tenantId: string, pkg: WeeklyOperatingPackage, seed: TaskSeed, createdAt: string, estimatedStartAt: string): WeeklyExecutionTask {
  const idempotencyKey = hash([
    tenantId, pkg.packageId, pkg.version, seed.workflowKind, seed.scope, seed.subjectId, seed.stepKind,
  ].join(':'));
  const duration = Math.max(1, Math.floor(seed.estimatedDurationMinutes));
  const estimatedFinishAt = new Date(Date.parse(estimatedStartAt) + duration * 60_000).toISOString();
  return {
    taskId: taskId(idempotencyKey),
    tenantId,
    programId: pkg.programId,
    packageId: pkg.packageId,
    packageVersion: pkg.version,
    workflowKind: seed.workflowKind,
    scope: seed.scope,
    subjectId: seed.subjectId,
    accountId: seed.accountId,
    publicationTaskId: seed.publicationTaskId,
    ...chainIdentity(pkg,seed),
    dependsOnTaskIds: seed.dependsOnTaskIds,
    upstreamVersionRefs: authorityRefs(pkg),
    inputSnapshot: structuredClone({ ...seed.inputSnapshot, referenceSourcePolicy: pkg.referenceSourcePolicy ?? null }),
    idempotencyKey,
    budget: seed.budget,
    schedule: {
      stepKind: seed.stepKind,
      responsibleActor: seed.responsibleActor,
      estimatedDurationMinutes: duration,
      estimatedStartAt,
      estimatedFinishAt,
      actualStartedAt: null,
      actualFinishedAt: null,
    },
    status: 'pending_activation',
    ownBlockingReasons: [...new Set([...seed.ownBlockingReasons,...((pkg.executionGraphVersion??1)>=2&&seed.publicationTaskId&&(seed.workflowKind==='content'||['script','storyboard'].includes(seed.stepKind))?[INITIAL_CAPACITY_SCHEDULE_REQUIRED]:[])])],
    inheritedBlockingTaskIds: [],
    attempt: 0,
    maxAttempts: 3,
    nextAttemptAt: null,
    lease: null,
    resultRefs: [],
    lastError: null,
    recoveredFromDeadLetterAt: null,
    cancelReason: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function publicationBlockers(item: SocialWeeklyPublicationTask): string[] {
  return [
    !item.businessProposition ? 'business_proposition_required' : null,
    !item.cta ? 'cta_required' : null,
    !item.factRefs.length ? 'fact_refs_required' : null,
    !item.metricTargets.length ? 'metric_targets_required' : null,
    !item.publishWindow ? 'publish_window_required' : null,
  ].filter((value): value is string => Boolean(value));
}

/** A repeated immutable request id is the only authority for treating material
 * as shared. Descriptions are deliberately ignored: similar prose does not
 * prove that the bytes, rights or review request are the same. Each consumer
 * keeps its executable binding task; the earliest consumer's preparation is
 * the single barrier that waits for every binding and gates every script. */
function applySharedMaterialPreparation(tasks:WeeklyExecutionTask[],publications:SocialWeeklyPublicationTask[]):void{
 const byRequest=new Map<string,SocialWeeklyPublicationTask[]>();
 for(const publication of publications)for(const requestId of publication.materialRequirement?.requestIds??[])byRequest.set(requestId,[...(byRequest.get(requestId)??[]),publication]);
 for(const [requestId,rawConsumers] of byRequest){const consumers=[...new Map(rawConsumers.map(p=>[p.publicationTaskId,p])).values()];if(consumers.length<2)continue;
  const ordered=consumers.sort((a,b)=>(publicationInstant(a.publishWindow)??Infinity)-(publicationInstant(b.publishWindow)??Infinity)||a.publicationTaskId.localeCompare(b.publicationTaskId));
  const preparationByPublication=new Map(ordered.map(publication=>{const rows=tasks.filter(task=>task.publicationTaskId===publication.publicationTaskId&&task.schedule.stepKind==='material_preparation');if(rows.length!==1)throw new SocialProgramError('weekly_shared_material_preparation_ambiguous',409,'共享素材缺少唯一可执行准备任务。');return[publication.publicationTaskId,rows[0]!] as const;}));
  const canonical=preparationByPublication.get(ordered[0]!.publicationTaskId)!;
  const preparationIds=[...preparationByPublication.values()].map(task=>task.taskId);
  canonical.dependsOnTaskIds=[...new Set([...canonical.dependsOnTaskIds,...preparationIds.filter(id=>id!==canonical.taskId)])];
  canonical.inputSnapshot={...canonical.inputSnapshot,sharedMaterialBarrier:{requestId,consumerPublicationTaskIds:ordered.map(p=>p.publicationTaskId),preparationTaskIds:preparationIds}};
  for(const publication of ordered){const scripts=tasks.filter(task=>task.publicationTaskId===publication.publicationTaskId&&task.schedule.stepKind==='script');if(scripts.length!==1)throw new SocialProgramError('weekly_shared_material_script_ambiguous',409,'共享素材消费者缺少唯一脚本任务。');scripts[0]!.dependsOnTaskIds=[...new Set([...scripts[0]!.dependsOnTaskIds,canonical.taskId])];}
 }
}

/** Convert the seven package summaries into independently durable units. */
export function planWeeklyExecutionTasks(
  tenantId: string,
  pkg: WeeklyOperatingPackage,
  createdAt = new Date().toISOString(),
): WeeklyExecutionTask[] {
  const tasks: WeeklyExecutionTask[] = [];
  const publications = pkg.socialContentPackage.publicationTasks;
  const publicationIds = new Set(publications.map(item => item.publicationTaskId));
  const globalBlockers = pkg.planningBlockers.filter(blocker => ![...publicationIds].some(id => blocker.includes(id)));
  const add = (seed: TaskSeed) => {
    const dependencyFinishes = seed.dependsOnTaskIds.map(id => tasks.find(item => item.taskId === id)?.schedule.estimatedFinishAt).filter((value): value is string => Boolean(value));
    // Preparation can belong to the preceding week; publication has its own release time.
    const estimatedStartAt = new Date(Math.max(Date.parse(createdAt), ...dependencyFinishes.map(value => Date.parse(value)), seed.notBeforeAt ?? 0)).toISOString();
    const item = makeTask(tenantId, pkg, seed, createdAt, estimatedStartAt);
    tasks.push(item);
    return item;
  };
  const noBudget = { category: 'none' as const, limitCny: null };
  const readiness = add({
    workflowKind: 'readiness', scope: 'package', subjectId: pkg.packageId,
    accountId: null, publicationTaskId: null, dependsOnTaskIds: [],
    inputSnapshot: { weekStart: pkg.weekStart, weekEnd: pkg.weekEnd, objective: pkg.objective },
    budget: noBudget, ownBlockingReasons: globalBlockers,
    stepKind: 'business_outline', responsibleActor: 'business_agent', estimatedDurationMinutes: 15,
  });

  const accountIds = [...new Set(publications.map(item => item.accountId))];
  const discovery = accountIds.filter(accountId=>publications.some(p=>p.accountId===accountId&&!p.inventoryReuseRef)).map(accountId => add({
    workflowKind: 'discovery', scope: 'account', subjectId: accountId,
    accountId, publicationTaskId: null, dependsOnTaskIds: [readiness.taskId],
    inputSnapshot: { accountId, weekStart: pkg.weekStart, objective: pkg.objective },
    budget: { category: 'discovery', limitCny: moneyShare(pkg.discoveryBudgetCny, accountIds.length) },
    ownBlockingReasons: [],
    stepKind: 'benchmark_collection', responsibleActor: 'director_agent', estimatedDurationMinutes: 60,
  }));

  const byMother = new Map<string, SocialWeeklyPublicationTask[]>();
  for (const item of publications.filter(p=>!p.inventoryReuseRef)) byMother.set(item.motherContentId, [...(byMother.get(item.motherContentId) ?? []), item]);
  const sourceAllocation = allocateWeeklyReferenceSources(publications.filter(p=>!p.inventoryReuseRef), pkg.referenceSourcePolicy);
  const productionBudget = moneyShare(pkg.socialContentPackage.weeklyBudgetCny, publications.filter(p=>!p.inventoryReuseRef).length);
  const directingByMother = new Map<string, WeeklyExecutionTask>();
  const scheduleByMother = new Map<string, WeeklyExecutionTask>();
  const storyboardByPublication = new Map<string, WeeklyExecutionTask>();
  for (const [motherContentId, items] of byMother) {
    const referenceSource=sourceAllocation.get(motherContentId);
    const scoring = add({
      workflowKind: 'directing', scope: 'content', subjectId: `${motherContentId}:benchmark-scoring`,
      accountId: null, publicationTaskId: null,
      dependsOnTaskIds: referenceSource === 'owned' ? [readiness.taskId] : discovery.filter(task => items.some(item => item.accountId === task.accountId)).map(task => task.taskId),
      inputSnapshot: { motherContentId, referenceSource, referenceWork: referenceSource === 'owned' ? 'owned_history_metrics_diagnosis' : 'external_benchmark_scoring', candidatePolicy: 'server_score_required' }, budget: noBudget,
      ownBlockingReasons: [], stepKind: 'benchmark_scoring', responsibleActor: 'director_agent', estimatedDurationMinutes: 20,
    });
    const directing = add({
      workflowKind: 'directing', scope: 'content', subjectId: motherContentId,
      accountId: null, publicationTaskId: null, dependsOnTaskIds: [scoring.taskId],
      inputSnapshot: { motherContentId, referenceSource, referenceWork: referenceSource === 'owned' ? 'owned_tone_inheritance' : 'external_structure_adaptation', variants: items }, budget: noBudget,
      ownBlockingReasons: [...new Set(items.flatMap(publicationBlockers))],
      stepKind: 'director_analysis', responsibleActor: 'director_agent', estimatedDurationMinutes: 45,
    });
    directingByMother.set(motherContentId, directing);
    scheduleByMother.set(motherContentId, add({
      workflowKind: 'directing', scope: 'content', subjectId: `${motherContentId}:business-schedule`,
      accountId: null, publicationTaskId: null, dependsOnTaskIds: [directing.taskId],
      inputSnapshot: { motherContentId, referenceSource, directorTaskId: directing.taskId, variants: items }, budget: noBudget,
      ownBlockingReasons: [], stepKind: 'business_schedule', responsibleActor: 'business_agent', estimatedDurationMinutes: 15,
    }));
    items.forEach(item => {
      const mode = item.adaptationOfPublicationTaskId === null ? 'original' : 'adaptation';
      const scope = mode === 'original' ? 'content' as const : 'adaptation' as const;
      const base = `${item.publicationTaskId}:${mode}`;
      const preparation = (pkg.executionGraphVersion??1)>=2 ? add({
        workflowKind:'content',scope,subjectId:`${base}:material-preparation`,accountId:item.accountId,publicationTaskId:item.publicationTaskId,
        dependsOnTaskIds:[scheduleByMother.get(motherContentId)!.taskId],
        inputSnapshot:{publicationTask:item,motherContentId,mode,referenceSource},budget:noBudget,ownBlockingReasons:[],
        stepKind:'material_preparation',responsibleActor:'content_agent',estimatedDurationMinutes:20,
      }):null;
      const script = add({
        workflowKind: 'directing', scope, subjectId: `${base}:script`, accountId: item.accountId, publicationTaskId: item.publicationTaskId,
        dependsOnTaskIds: [preparation?.taskId??scheduleByMother.get(motherContentId)!.taskId],
        inputSnapshot: { publicationTask: item, motherContentId, mode, referenceSource, source: 'director_analysis_and_enterprise_facts' },
        budget: { category: 'production', limitCny: productionBudget }, ownBlockingReasons: [],
        stepKind: 'script', responsibleActor: 'director_agent', estimatedDurationMinutes: 30,
      });
      const storyboard = add({
        workflowKind: 'directing', scope, subjectId: `${base}:storyboard`, accountId: item.accountId, publicationTaskId: item.publicationTaskId,
        dependsOnTaskIds: [script.taskId], inputSnapshot: { publicationTask: item, motherContentId, mode, referenceSource }, budget: noBudget, ownBlockingReasons: [],
        stepKind: 'storyboard', responsibleActor: 'director_agent', estimatedDurationMinutes: 35,
      });
      storyboardByPublication.set(item.publicationTaskId, storyboard);
    });

  }

  const approvalByPublication = new Map<string, WeeklyExecutionTask>();
  for (const [motherContentId, items] of byMother) {
    const referenceSource=sourceAllocation.get(motherContentId);
    const original = items.find(item => item.adaptationOfPublicationTaskId === null) ?? items[0]!;
    let originalQualityTask: WeeklyExecutionTask | null = null;
    for (const item of [original, ...items.filter(candidate => candidate.publicationTaskId !== original.publicationTaskId)]) {
      const mode = item.publicationTaskId === original.publicationTaskId ? 'original' : 'adaptation';
      const scope = mode === 'original' ? 'content' as const : 'adaptation' as const;
      const base = `${item.publicationTaskId}:${mode}`;
      const storyboard = storyboardByPublication.get(item.publicationTaskId)!;
      const material = add({
        workflowKind: 'content', scope, subjectId: `${base}:material-readiness`, accountId: item.accountId, publicationTaskId: item.publicationTaskId,
        dependsOnTaskIds: [scheduleByMother.get(motherContentId)!.taskId, storyboard.taskId, ...(mode === 'adaptation' && originalQualityTask ? [originalQualityTask.taskId] : [])],
        inputSnapshot: { publicationTask: item, motherContentId, mode, referenceSource, qualityTier: 'premium' },
        budget: noBudget, ownBlockingReasons: ['business_dispatch_required'],
        stepKind: 'material_readiness', responsibleActor: 'content_agent', estimatedDurationMinutes: 20,
      });
      const assets = add({
        workflowKind: 'content', scope, subjectId: `${base}:asset-generation`, accountId: item.accountId, publicationTaskId: item.publicationTaskId,
        dependsOnTaskIds: [material.taskId], inputSnapshot: { publicationTask: item, motherContentId, mode, referenceSource, generationPolicy: 'premium_max_available' },
        budget: { category: 'production', limitCny: productionBudget }, ownBlockingReasons: [],
        stepKind: 'asset_generation', responsibleActor: 'content_agent', estimatedDurationMinutes: 45,
      });
      const video = add({
        workflowKind: 'content', scope, subjectId: `${base}:video-generation`, accountId: item.accountId, publicationTaskId: item.publicationTaskId,
        dependsOnTaskIds: [assets.taskId], inputSnapshot: { publicationTask: item, motherContentId, mode, referenceSource, qualityTier: 'premium' },
        budget: { category: 'production', limitCny: productionBudget }, ownBlockingReasons: [],
        stepKind: 'video_generation', responsibleActor: 'content_agent', estimatedDurationMinutes: 90,
      });
      const quality = add({
        workflowKind: 'content', scope, subjectId: `${base}:quality-check`, accountId: item.accountId, publicationTaskId: item.publicationTaskId,
        dependsOnTaskIds: [video.taskId], inputSnapshot: { publicationTask: item, motherContentId, referenceSource, checks: ['facts', 'visual', 'audio', 'rights', 'platform'] }, budget: noBudget, ownBlockingReasons: [],
        stepKind: 'quality_check', responsibleActor: 'quality_agent', estimatedDurationMinutes: 25,
      });
      const approvalDependency = pkg.executionGraphVersion===3 ? quality : add({
        workflowKind: 'content', scope, subjectId: `${base}:rework`, accountId: item.accountId, publicationTaskId: item.publicationTaskId,
        dependsOnTaskIds: [quality.taskId], inputSnapshot: { publicationTask: item, motherContentId, referenceSource, conditional: true }, budget: { category: 'production', limitCny: productionBudget }, ownBlockingReasons: [],
        stepKind: 'rework', responsibleActor: 'content_agent', estimatedDurationMinutes: 30,
      });
      const approval = add({
        workflowKind: 'content', scope, subjectId: `${base}:user-approval`, accountId: item.accountId, publicationTaskId: item.publicationTaskId,
        dependsOnTaskIds: [approvalDependency.taskId], inputSnapshot: { publicationTask: item, motherContentId, referenceSource, decisionCard: 'content_approval' }, budget: noBudget, ownBlockingReasons: [],
        stepKind: 'user_approval', responsibleActor: 'user', estimatedDurationMinutes: 10,
      });
      if (mode === 'original') originalQualityTask = approvalDependency;
      approvalByPublication.set(item.publicationTaskId, approval);
    }
  }

  for(const item of publications.filter(p=>p.inventoryReuseRef)){
    const ref=item.inventoryReuseRef!;
    if(pkg.referenceSourcePolicy?.profile!=='b2b_established'||ref.type!=='weekly_inventory_binding'||ref.version!==1||!ref.id)throw new SocialProgramError('inventory_execution_ref_invalid',409,'库存任务必须绑定已确认的有基础周版本。');
    const approval=add({workflowKind:'content',scope:'content',subjectId:`${item.publicationTaskId}:inventory-user-approval`,accountId:item.accountId,publicationTaskId:item.publicationTaskId,dependsOnTaskIds:[readiness.taskId],inputSnapshot:{publicationTask:item,decisionCard:'content_approval',inventoryReuseRef:ref,countsAsNewMotherContent:false,startsProduction:false},budget:noBudget,ownBlockingReasons:[],stepKind:'user_approval',responsibleActor:'user',estimatedDurationMinutes:10});
    approvalByPublication.set(item.publicationTaskId,approval);
  }

  const publishing = publications.map(item => add({
    notBeforeAt: publicationInstant(item.publishWindow),
    workflowKind: 'publishing', scope: 'publication', subjectId: item.publicationTaskId,
    accountId: item.accountId, publicationTaskId: item.publicationTaskId,
    dependsOnTaskIds: [approvalByPublication.get(item.publicationTaskId)!.taskId],
    inputSnapshot: {
      publicationTask: item,
      referenceSource: sourceAllocation.get(item.motherContentId),
      authorization: pkg.socialContentPackage.authorization,
    },
    budget: noBudget, ownBlockingReasons: publicationBlockers(item),
    stepKind: 'publishing', responsibleActor: 'publishing_agent', estimatedDurationMinutes: 10,
  }));

  const customerChannels = ['whatsapp', 'messenger', 'instagram'] as const;
  const customerReadiness = new Map<string, WeeklyExecutionTask[]>();
  for (const item of publications) {
    const approval = approvalByPublication.get(item.publicationTaskId)!;
    const tasksForPublication = customerChannels.map(channel => add({
      workflowKind: 'engagement', scope: 'publication',
      subjectId: `${item.publicationTaskId}:customer:${channel}:readiness`,
      accountId: item.accountId, publicationTaskId: item.publicationTaskId,
      dependsOnTaskIds: [approval.taskId],
      inputSnapshot: { publicationTask: item, referenceSource: sourceAllocation.get(item.motherContentId), customerChannel: channel, publicationAccountId: item.accountId },
      budget: noBudget, ownBlockingReasons: [],
      stepKind: 'customer_channel_readiness', responsibleActor: 'customer_agent', estimatedDurationMinutes: 10,
    }));
    customerReadiness.set(item.publicationTaskId, tasksForPublication);
    const publish = publishing.find(task => task.publicationTaskId === item.publicationTaskId)!;
    publish.dependsOnTaskIds = [...publish.dependsOnTaskIds, ...tasksForPublication.map(task => task.taskId)];
    const readinessFinish = Math.max(...tasksForPublication.map(task => Date.parse(task.schedule.estimatedFinishAt)));
    const publishStart = Math.max(Date.parse(publish.schedule.estimatedStartAt), readinessFinish);
    publish.schedule.estimatedStartAt = new Date(publishStart).toISOString();
    publish.schedule.estimatedFinishAt = new Date(publishStart + publish.schedule.estimatedDurationMinutes * 60_000).toISOString();
  }

  const customerHandoffs = publications.flatMap(item => {
    const publish = publishing.find(task => task.publicationTaskId === item.publicationTaskId)!;
    return customerChannels.map(channel => {
      const readiness = customerReadiness.get(item.publicationTaskId)!.find(task => task.inputSnapshot.customerChannel === channel)!;
      return add({
        workflowKind: 'engagement', scope: 'publication',
        subjectId: `${item.publicationTaskId}:customer:${channel}:handoff`,
        accountId: item.accountId, publicationTaskId: item.publicationTaskId,
        dependsOnTaskIds: [publish.taskId, readiness.taskId],
        inputSnapshot: { publicationTask: item, referenceSource: sourceAllocation.get(item.motherContentId), customerChannel: channel, publicationAccountId: item.accountId },
        budget: noBudget, ownBlockingReasons: [],
        stepKind: 'customer_inquiry_handoff', responsibleActor: 'customer_agent', estimatedDurationMinutes: 30,
      });
    });
  });

  const engagement = accountIds.map(accountId => add({
    workflowKind: 'engagement', scope: 'account', subjectId: accountId,
    accountId, publicationTaskId: null,
    dependsOnTaskIds: [
      ...publishing.filter(item => item.accountId === accountId).map(item => item.taskId),
      ...customerHandoffs.filter(item => item.accountId === accountId).map(item => item.taskId),
    ],
    inputSnapshot: { accountId, weekStart: pkg.weekStart, weekEnd: pkg.weekEnd, profileWork: pkg.referenceSourcePolicy?.profile==='b2b_established'?'existing_customer_and_dual_source_attribution':'new_inquiry_and_first_baseline_attribution' },
    budget: noBudget, ownBlockingReasons: [],
    stepKind: 'performance_monitoring', responsibleActor: 'business_agent', estimatedDurationMinutes: 60,
  }));
  const review = add({
    workflowKind: 'review', scope: 'package', subjectId: pkg.packageId,
    accountId: null, publicationTaskId: null, dependsOnTaskIds: engagement.map(item => item.taskId),
    inputSnapshot: { objective: pkg.objective, successCriteria: pkg.successCriteria, profileWork: pkg.referenceSourcePolicy?.profile==='b2b_established'?'dual_source_performance_and_quota_review':'cold_start_baseline_and_profile_upgrade_review' },
    budget: noBudget, ownBlockingReasons: [],
    stepKind: 'weekly_review', responsibleActor: 'business_agent', estimatedDurationMinutes: 45,
  });
  for (const publication of publications.filter(p=>!p.inventoryReuseRef)) {
    const source = tasks.find(task => task.publicationTaskId === publication.publicationTaskId && task.schedule.stepKind === 'video_generation');
    if (!source) throw new SocialProgramError('content_template_source_task_missing', 409, '模板提炼缺少对应真实成片任务。');
    const extraction = add({
      workflowKind: 'directing', scope: 'content', subjectId: `${publication.publicationTaskId}:template-extraction`,
      accountId: publication.accountId, publicationTaskId: publication.publicationTaskId,
      dependsOnTaskIds: [source.taskId, review.taskId],
      inputSnapshot: { publicationTask: publication, referenceSource: sourceAllocation.get(publication.motherContentId), sourceTaskId: source.taskId, reviewTaskId: review.taskId },
      budget: noBudget, ownBlockingReasons: [],
      stepKind: 'template_extraction', responsibleActor: 'director_agent', estimatedDurationMinutes: 20,
    });
    add({
      workflowKind: 'review', scope: 'content', subjectId: `${publication.publicationTaskId}:template-performance-validation`,
      accountId: publication.accountId, publicationTaskId: publication.publicationTaskId,
      dependsOnTaskIds: [extraction.taskId],
      inputSnapshot: { publicationTask: publication, referenceSource: sourceAllocation.get(publication.motherContentId), sourceTaskId: source.taskId, reviewTaskId: review.taskId, extractionTaskId: extraction.taskId },
      budget: noBudget, ownBlockingReasons: [],
      stepKind: 'template_performance_validation', responsibleActor: 'business_agent', estimatedDurationMinutes: 15,
    });
  }
  // Legacy immutable graphs have no preparation stage; retain their original
  // dependencies until an explicit revision upgrades them to the current graph.
  if((pkg.executionGraphVersion??1)>=2)applySharedMaterialPreparation(tasks,publications);
  return applyPublicationDeadlines(tasks, publications);
}

function rowData(task: WeeklyExecutionTask): Record<string, unknown> {
  return {
    tenant_id: task.tenantId,
    program_id: task.programId,
    package_id: task.packageId,
    package_version: task.packageVersion,
    task_id: task.taskId,
    workflow_kind: task.workflowKind,
    status: task.status,
    idempotency_key: task.idempotencyKey,
    next_attempt_at: task.nextAttemptAt ?? '',
    payload: task,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

function durableLease(task: WeeklyExecutionTask): DurableOperationLease | null {
  return task.lease ? {
    id: task.lease.leaseId,
    tenantId: task.tenantId,
    scope: SOCIAL_WEEKLY_EXECUTION_LEASE_SCOPE,
    subjectId: task.taskId,
    token: task.lease.token,
    ownerId: task.lease.workerId,
    acquiredAt: task.lease.acquiredAt,
    expiresAt: task.lease.expiresAt,
  } : null;
}

export async function listWeeklyExecutionTasks(
  dataStore: DataStore,
  tenantId: string,
  programId: string,
  packageId: string,
  packageVersion: number,
): Promise<WeeklyExecutionTask[]> {
  const tasks:WeeklyExecutionTask[]=[],seen=new Set<string>();let total:number|undefined;
  for(let page=1;;page++){
    const result=await dataStore.list<WeeklyExecutionTaskRow>(WEEKLY_EXECUTION_TASKS,{where:{tenant_id:tenantId,program_id:programId,package_id:packageId,package_version:packageVersion},sort:'created_at,id',page,perPage:500});
    if(!Number.isSafeInteger(result.totalItems)||result.totalItems<0||!Number.isSafeInteger(result.totalPages)||total!==undefined&&total!==result.totalItems)throw new SocialProgramError('weekly_execution_task_pagination_invalid',409,'实际任务图分页发生变化，请重新读取。');total=result.totalItems;
    for(const row of result.items){if(seen.has(row.id))throw new SocialProgramError('weekly_execution_task_pagination_duplicate',409,'实际任务图分页重复。');seen.add(row.id);tasks.push(normalizeExecutionTask(row.payload));}
    if(page>=result.totalPages){if(tasks.length!==result.totalItems)throw new SocialProgramError('weekly_execution_task_pagination_truncated',409,'实际任务图分页不完整。');return tasks;}
    if(!result.items.length)throw new SocialProgramError('weekly_execution_task_pagination_truncated',409,'实际任务图分页不完整。');
  }
}

export async function materializeWeeklyExecutionTasks(
  dataStore: DataStore,
  tenantId: string,
  pkg: WeeklyOperatingPackage,
): Promise<WeeklyExecutionTask[]> {
  return withExecutionPackageGate(dataStore,{tenantId,programId:pkg.programId,packageId:pkg.packageId,packageVersion:pkg.version},async assert=>{
  if(await executionPackageFrozen(dataStore,{tenantId,programId:pkg.programId,packageId:pkg.packageId,packageVersion:pkg.version}))throw new SocialProgramError('weekly_execution_package_frozen',409,'原周版本已冻结，不能新增执行任务。');
  const planned = await applyFrozenWeeklySchedule(dataStore,tenantId,pkg,planWeeklyExecutionTasks(tenantId, pkg, pkg.createdAt));
  const existing = await listWeeklyExecutionTasks(dataStore, tenantId, pkg.programId, pkg.packageId, pkg.version);
  const stripContinuation=(t:WeeklyExecutionTask)=>{const inputSnapshot={...t.inputSnapshot};delete inputSnapshot.weeklyContinuationRef;return {...t,inputSnapshot,upstreamVersionRefs:t.upstreamVersionRefs.filter(ref=>ref.type!=='weekly_execution_continuation')};};
  const finishContinuations=async()=>{
    const service=createWeeklyExecutionContinuationService(dataStore);
    for(const plannedTask of planned.filter(t=>Boolean(t.inputSnapshot.weeklyContinuationPending))){
      const record=await service.ensureForTarget({tenantId,programId:pkg.programId,packageId:pkg.packageId,targetVersion:pkg.version,targetTaskId:plannedTask.taskId});
      if(!record)throw new SocialProgramError('weekly_execution_continuation_missing',409,'真实承接凭据缺失，未启动新生产。');
      const row=await getWeeklyExecutionTaskRow(dataStore,tenantId,plannedTask.taskId),actual=row.payload;
      const ref=actual.inputSnapshot.weeklyContinuationRef;
      const refs=actual.upstreamVersionRefs.filter(r=>r.type==='weekly_execution_continuation');
      if(ref||refs.length){if(scheduleHash(ref)!==scheduleHash(record.ref)||refs.length!==1||scheduleHash(refs[0])!==scheduleHash(record.ref))throw new SocialProgramError('weekly_execution_continuation_ref_changed',409,'承接引用与真实冻结凭据不一致。');continue;}
      await assert();await writeWeeklyExecutionTask(dataStore,row,{...actual,inputSnapshot:{...actual.inputSnapshot,weeklyContinuationRef:record.ref},upstreamVersionRefs:[...actual.upstreamVersionRefs,record.ref]});
    }
    return listWeeklyExecutionTasks(dataStore,tenantId,pkg.programId,pkg.packageId,pkg.version);
  };
  if (existing.length && ((pkg as WeeklyScheduledPackage).scheduleRevisionRef || (pkg as WeeklyOperatingPackage&{templateApplicationRef?:VersionedSocialRef}).templateApplicationRef)) {
    const expectedByKey=new Map(planned.map(t=>[t.idempotencyKey,t]));
    if(existing.length>planned.length||new Set(existing.map(t=>t.idempotencyKey)).size!==existing.length||existing.some(t=>{const expected=expectedByKey.get(t.idempotencyKey);return !expected||scheduleHash(stripContinuation(t))!==scheduleHash(expected);} ))throw new SocialProgramError('weekly_schedule_existing_task_mismatch',409,'冻结倒排已有任务不一致，不能覆盖已运行工作。');
    for(const task of planned.filter(t=>!existing.some(old=>old.idempotencyKey===t.idempotencyKey))){await assert();const row=await dataStore.create<WeeklyExecutionTaskRow>(WEEKLY_EXECUTION_TASKS,rowData(task));if(!row)throw new SocialProgramError('weekly_schedule_resume_storage_failed',503,'未完成的新草稿任务仍需恢复。');}
    return finishContinuations();
  }
  if (existing.length) {
    const expected = new Set(planned.map(item => item.idempotencyKey));
    if (existing.length !== planned.length || existing.some(item => !expected.has(item.idempotencyKey)||scheduleHash(item.dependsOnTaskIds)!==scheduleHash(planned.find(p=>p.idempotencyKey===item.idempotencyKey)!.dependsOnTaskIds))) {
      throw new SocialProgramError('weekly_execution_task_integrity_violation', 409, '周包执行任务集与当前版本不一致。');
    }
    return existing;
  }
  const created: WeeklyExecutionTaskRow[] = [];
  try {
    for (const task of planned) {
      await assert();const row = await dataStore.create<WeeklyExecutionTaskRow>(WEEKLY_EXECUTION_TASKS, rowData(task));
      if (!row) throw new Error('create returned null');
      created.push(row);
    }
  } catch {
    if(!(pkg as WeeklyOperatingPackage&{templateApplicationRef?:VersionedSocialRef}).templateApplicationRef)for (const row of created) await dataStore.delete(WEEKLY_EXECUTION_TASKS, row.id);
    throw new SocialProgramError('weekly_execution_task_storage_unavailable', 503, '周包执行任务暂时无法保存。');
  }
  return finishContinuations();
  });
}

async function taskRows(dataStore: DataStore, tenantId: string, taskIds: string[]): Promise<WeeklyExecutionTaskRow[]> {
  const rows: WeeklyExecutionTaskRow[] = [];
  for (const taskId of taskIds) {
    const result = await dataStore.list<WeeklyExecutionTaskRow>(WEEKLY_EXECUTION_TASKS, {
      where: { tenant_id: tenantId, task_id: taskId }, page: 1, perPage: 2,
    });
    if (result.items.length !== 1) throw new SocialProgramError('weekly_execution_task_not_found', 404, '周包执行任务不存在。');
    const row = result.items[0]!;
    rows.push({ ...row, payload: normalizeExecutionTask(row.payload) });
  }
  return rows;
}

export async function getWeeklyExecutionTaskRow(
  dataStore: DataStore,
  tenantId: string,
  taskId: string,
): Promise<WeeklyExecutionTaskRow> {
  return (await taskRows(dataStore, tenantId, [taskId]))[0]!;
}

/** Serialize state transitions across API processes and worker processes. */
export async function withWeeklyExecutionTaskMutation<T>(dataStore:DataStore,tenantId:string,taskId:string,operation:()=>Promise<T>,mode:'mutation'|'claim'|'settlement'|'cancellation'='mutation'):Promise<T>{
 const initial=await getWeeklyExecutionTaskRow(dataStore,tenantId,taskId);const scope={tenantId,programId:initial.payload.programId,packageId:initial.payload.packageId,packageVersion:initial.payload.packageVersion};
 return withExecutionPackageGate(dataStore,scope,async assert=>{
  const frozen=await executionPackageFrozen(dataStore,scope);if(frozen){const current=await getWeeklyExecutionTaskRow(dataStore,tenantId,taskId);if(mode!=='cancellation'&&(mode!=='settlement'||current.payload.status!=='leased'))throw new SocialProgramError('weekly_execution_package_frozen',409,'原周版本已冻结，不再接受新领取或状态编排。');}
  const lease=await acquireDurableOperationLease({dataStore,tenantId,scope:SOCIAL_WEEKLY_EXECUTION_MUTATION_SCOPE,subjectId:taskId,ownerId:`mutation-${randomUUID()}`,leaseDurationMs:30000});if(!lease)throw new SocialProgramError('weekly_execution_task_busy',409,'执行任务正在发生状态变更，请重试。');
  try{await assert();return await operation();}finally{await releaseDurableOperationLease({dataStore,lease});}
 });
}

export async function writeWeeklyExecutionTask(dataStore:DataStore,row:WeeklyExecutionTaskRow,task:WeeklyExecutionTask):Promise<void>{
 if(task.taskId!==row.payload.taskId||task.tenantId!==row.payload.tenantId||task.programId!==row.payload.programId||task.packageId!==row.payload.packageId||task.packageVersion!==row.payload.packageVersion||task.idempotencyKey!==row.payload.idempotencyKey)throw new SocialProgramError('weekly_execution_task_authority_mutation',409,'执行状态更新不能改变任务归属。');
 const scope={tenantId:task.tenantId,programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion};
 if(!await assertExecutionPackageGate(dataStore,scope))return withExecutionPackageGate(dataStore,scope,async assert=>{if(await executionPackageFrozen(dataStore,scope))throw new SocialProgramError('weekly_execution_package_frozen',409,'原周版本已冻结。');await assert();await writeWeeklyExecutionTask(dataStore,row,task);});
 if(!await dataStore.update(WEEKLY_EXECUTION_TASKS,row.id,rowData(task)))throw new SocialProgramError('weekly_execution_task_storage_unavailable',503,'周包执行任务暂时无法更新。');
}

function recompute(tasks: WeeklyExecutionTask[], now: string, activatePending: boolean): WeeklyExecutionTask[] {
  const byId = new Map(tasks.map(task => [task.taskId, task]));
  return tasks.map(task => {
    if (['succeeded', 'cancelled', 'dead_letter', 'leased'].includes(task.status)) return task;
    if (task.status === 'pending_activation' && !activatePending) return task;
    const inherited = task.dependsOnTaskIds.filter(id => byId.get(id)?.status !== 'succeeded');
    const status: WeeklyExecutionTaskStatus = task.ownBlockingReasons.length || inherited.length ? 'blocked' : 'queued';
    return { ...task, status, inheritedBlockingTaskIds: inherited, updatedAt: now };
  });
}

export async function recomputePackageExecution(
  dataStore: DataStore,
  tenantId: string,
  programId: string,
  packageId: string,
  packageVersion: number,
  now = new Date().toISOString(),
  activatePending = true,
): Promise<WeeklyExecutionTask[]> {
  return withExecutionPackageGate(dataStore,{tenantId,programId,packageId,packageVersion},async()=>{
  if(await executionPackageFrozen(dataStore,{tenantId,programId,packageId,packageVersion}))return listWeeklyExecutionTasks(dataStore,tenantId,programId,packageId,packageVersion);
  let lease: DurableOperationLease | null = null;
  for (let attempt = 0; attempt < 40 && !lease; attempt += 1) {
    lease = await acquireDurableOperationLease({
      dataStore,
      tenantId,
      scope: SOCIAL_WEEKLY_EXECUTION_PACKAGE_SCOPE,
      subjectId: `${packageId}:${packageVersion}`,
      ownerId: `aggregate-${randomUUID()}`,
      leaseDurationMs: 30_000,
    });
    if (!lease) await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (!lease) throw new SocialProgramError('weekly_execution_package_busy', 409, '周包执行状态正在聚合，请重试。');
  try {
    const current = await listWeeklyExecutionTasks(dataStore, tenantId, programId, packageId, packageVersion);
    let next = current;
    for (let pass = 0; pass < current.length; pass += 1) next = recompute(next, now, activatePending);
    const changed = next.filter((task, index) => JSON.stringify(task) !== JSON.stringify(current[index]));
    if (changed.length) {
      const rows = await taskRows(dataStore, tenantId, changed.map(task => task.taskId));
      for (let index = 0; index < changed.length; index += 1) await writeWeeklyExecutionTask(dataStore, rows[index]!, changed[index]!);
    }
    return next;
  } finally {
    await releaseDurableOperationLease({ dataStore, lease });
  }
  });
}

export async function activateWeeklyExecutionTasks(
  dataStore: DataStore,
  tenantId: string,
  pkg: WeeklyOperatingPackage,
  now = new Date().toISOString(),
): Promise<WeeklyExecutionTask[]> {
  return recomputePackageExecution(dataStore, tenantId, pkg.programId, pkg.packageId, pkg.version, now, true);
}

export async function applyBusinessDispatchToExecutionTasks(
  dataStore: DataStore,
  tenantId: string,
  programId: string,
  packageId: string,
  packageVersion: number,
  dispatch: WeeklyBusinessContentDispatch,
  now = new Date().toISOString(),
): Promise<WeeklyExecutionTask[]> {
  if (dispatch.issuedBy !== 'business_agent' || dispatch.assignedTo !== 'content_agent') {
    throw new SocialProgramError('business_dispatch_authority_required', 403, '内容任务只能由经营 Agent 派给内容 Agent。');
  }
  const tasks = await listWeeklyExecutionTasks(dataStore, tenantId, programId, packageId, packageVersion);
  const targets = tasks.filter(task => task.schedule.stepKind === 'material_readiness' && (!dispatch.coverage || dispatch.scheduleItems.some(item => item.publicationTaskId === task.publicationTaskId)));
  for (const target of targets) {
    await withWeeklyExecutionTaskMutation(dataStore, tenantId, target.taskId, async () => {
      const row = await getWeeklyExecutionTaskRow(dataStore, tenantId, target.taskId);
      const detailedScheduleItem = dispatch.scheduleItems.find(item => item.publicationTaskId === row.payload.publicationTaskId);
      if (!detailedScheduleItem) throw new SocialProgramError('business_dispatch_lineage_invalid', 409, '经营派单缺少对应的逐条内容排期。');
      const next: WeeklyExecutionTask = {
        ...row.payload,
        ownBlockingReasons: row.payload.ownBlockingReasons.filter(reason => reason !== 'business_dispatch_required'),
        upstreamVersionRefs: [...row.payload.upstreamVersionRefs, { type: 'business_content_dispatch', id: dispatch.dispatchId, version: 1 }],
        inputSnapshot: { ...row.payload.inputSnapshot, dispatchRef: { type: 'business_content_dispatch', id: dispatch.dispatchId, version: 1 }, detailedScheduleItem: structuredClone(detailedScheduleItem) },
        updatedAt: now,
      };
      await writeWeeklyExecutionTask(dataStore, row, next);
    });
  }
  return recomputePackageExecution(dataStore, tenantId, programId, packageId, packageVersion, now, true);
}

export async function cancelWeeklyExecutionTasks(
  dataStore: DataStore,
  tenantId: string,
  programId: string,
  packageId: string,
  packageVersion: number,
  reason: string,
  now = new Date().toISOString(),
): Promise<WeeklyExecutionTask[]> {
  const current = await listWeeklyExecutionTasks(dataStore, tenantId, programId, packageId, packageVersion);
  await reconcileWeeklyCancellation({
    dataStore, tenantId, programId, packageId, packageVersion, reason, now,
    cancelPending: async () => {
  for (const candidate of current.filter(task => !['succeeded', 'cancelled'].includes(task.status))) {
    await withWeeklyExecutionTaskMutation(dataStore, tenantId, candidate.taskId, async () => {
      const row = await getWeeklyExecutionTaskRow(dataStore, tenantId, candidate.taskId);
      if (['succeeded', 'cancelled'].includes(row.payload.status)) return;
      const priorLease = durableLease(row.payload);
      await writeWeeklyExecutionTask(dataStore, row, {
        ...row.payload, status: 'cancelled', cancelReason: reason, lease: null, updatedAt: now,
      });
      if (priorLease) await releaseDurableOperationLease({ dataStore, lease: priorLease });
    },'cancellation');
  }
    },
  });
  return listWeeklyExecutionTasks(dataStore, tenantId, programId, packageId, packageVersion);
}

export function createWeeklyExecutionTaskService(dataStore: DataStore) {
  async function mutate(tenantId: string, programId: string, packageId: string, taskId: string, action: (task: WeeklyExecutionTask, now: string) => WeeklyExecutionTask | Promise<WeeklyExecutionTask>) {
    return withWeeklyExecutionTaskMutation(dataStore, tenantId, taskId, async () => {
      const [row] = await taskRows(dataStore, tenantId, [taskId]);
      if (row.payload.programId !== programId || row.payload.packageId !== packageId) {
        throw new SocialProgramError('weekly_execution_task_not_found', 404, '周包执行任务不存在。');
      }
      const now = new Date().toISOString();
      const next = await action(row.payload, now);
      await writeWeeklyExecutionTask(dataStore, row, next);
      const priorLease = durableLease(row.payload);
      if (priorLease && !next.lease) await releaseDurableOperationLease({ dataStore, lease: priorLease });
      return recomputePackageExecution(dataStore, tenantId, next.programId, next.packageId, next.packageVersion, now, true);
    });
  }
  return {
    list: (tenantId: string, programId: string, packageId: string, packageVersion: number) => (
      listWeeklyExecutionTasks(dataStore, tenantId, programId, packageId, packageVersion)
    ),
    async block(tenantId: string, programId: string, packageId: string, taskId: string, reason: string) {
      const normalized = reason.trim();
      if (!normalized) throw new SocialProgramError('weekly_execution_block_reason_required', 400, '阻塞必须提供原因。');
      return mutate(tenantId, programId, packageId, taskId, (task, now) => {
        if (['succeeded', 'cancelled', 'dead_letter'].includes(task.status)) throw new SocialProgramError('weekly_execution_task_terminal', 409, '终态任务不能阻塞。');
        return { ...task, status: 'blocked', ownBlockingReasons: [...new Set([...task.ownBlockingReasons, normalized])], lease: null, updatedAt: now };
      });
    },
    async unblock(tenantId: string, programId: string, packageId: string, taskId: string, reason?: string) {
      return mutate(tenantId, programId, packageId, taskId, (task, now) => {
        if (['succeeded', 'cancelled', 'dead_letter'].includes(task.status)) throw new SocialProgramError('weekly_execution_task_terminal', 409, '终态任务不能解除阻塞。');
        return {
          ...task,
          ownBlockingReasons: task.ownBlockingReasons.filter(item => item===INITIAL_CAPACITY_SCHEDULE_REQUIRED || (reason ? item!==reason : false)),
          ...(reason && task.lastError?.code === reason ? { lastError: null } : {}),
          updatedAt: now,
        };
      });
    },
    async cancel(tenantId: string, programId: string, packageId: string, taskId: string, reason: string) {
      return mutate(tenantId, programId, packageId, taskId, (task, now) => {
        if (task.status === 'succeeded') throw new SocialProgramError('weekly_execution_task_terminal', 409, '已成功任务不能取消。');
        return { ...task, status: 'cancelled', cancelReason: reason.trim() || 'cancelled', lease: null, updatedAt: now };
      });
    },
    async recoverDeadLetter(tenantId: string, programId: string, packageId: string, taskId: string) {
      return mutate(tenantId, programId, packageId, taskId, (task, now) => {
        if (task.status !== 'dead_letter') throw new SocialProgramError('weekly_execution_task_not_dead_letter', 409, '只能恢复死信任务。');
        return {
          ...task, status: 'queued', maxAttempts: Math.max(task.maxAttempts, task.attempt + 1),
          nextAttemptAt: null, lease: null, recoveredFromDeadLetterAt: now, updatedAt: now,
        };
      });
    },
    async approve(tenantId: string, programId: string, packageId: string, taskId: string, userId: string) {
      return mutate(tenantId, programId, packageId, taskId, async (task, now) => {
        if (task.schedule.stepKind !== 'user_approval' || task.schedule.responsibleActor !== 'user') {
          throw new SocialProgramError('weekly_execution_task_not_user_approval', 409, '该节点不是用户审批节点。');
        }
        if (task.inheritedBlockingTaskIds.length) throw new SocialProgramError('weekly_execution_upstream_incomplete', 409, '上游生产步骤尚未完成。');
        if (['cancelled', 'dead_letter'].includes(task.status)) throw new SocialProgramError('weekly_execution_task_terminal', 409, '终态任务不能审批。');
        const { resolveWeeklyCreativeRepairApprovalEvidence } = await import('./weeklyCreativeRepairApprovalEvidence.js');
        const creativeRepair = await resolveWeeklyCreativeRepairApprovalEvidence(dataStore, task);
        if (creativeRepair && creativeRepair.caseItem.approvalTaskId !== task.taskId) {
          throw new SocialProgramError('weekly_creative_repair_approval_scope_changed', 409, '修订证据不属于当前审批任务。');
        }
        if (creativeRepair && task.ownBlockingReasons.length) throw new SocialProgramError('weekly_execution_upstream_incomplete', 409, '当前修订审批仍有未解除的阻断。');
        if (task.status === 'succeeded') {
          if (creativeRepair && (creativeRepair.artifact.status !== 'approved' || !task.resultRefs.some(ref =>
            ref.type === 'starter_social_content_artifact' && ref.id === creativeRepair.artifactRef.id && ref.version === creativeRepair.artifactRef.version))) {
            throw new SocialProgramError('weekly_creative_repair_approval_artifact_changed', 409, '已验收修订成片的身份或版本发生变化。');
          }
          return task;
        }
        const approvalDependencies = await taskRows(dataStore, tenantId, task.dependsOnTaskIds);
        if (approvalDependencies.length !== task.dependsOnTaskIds.length || approvalDependencies.some(row => row.payload.programId !== task.programId || row.payload.packageId !== task.packageId || row.payload.packageVersion !== task.packageVersion || row.payload.status !== 'succeeded')) {
          throw new SocialProgramError('weekly_execution_upstream_incomplete', 409, '本周真实前置任务尚未完成，不能验收。');
        }
        if (task.status === 'pending_activation') throw new SocialProgramError('weekly_execution_package_not_active', 409, '草案尚未启用，不能绕过前置任务验收。');
        if (task.inputSnapshot.inventoryReuseRef) {
          const actualDependencies = await taskRows(dataStore, tenantId, task.dependsOnTaskIds);
          if (actualDependencies.length !== task.dependsOnTaskIds.length || actualDependencies.some(row => row.payload.programId !== task.programId || row.payload.packageId !== task.packageId || row.payload.packageVersion !== task.packageVersion || row.payload.status !== 'succeeded')) {
            throw new SocialProgramError('weekly_execution_upstream_incomplete', 409, '本周真实前置任务尚未完成，不能验收库存。');
          }
          const { createInventoryUserApproval } = await import('../runtime/weeklyInventoryApprovalEvidence.js');
          const receipt = await createInventoryUserApproval(dataStore, task, userId, now);
          return { ...task, ...receipt, status: 'succeeded', schedule: { ...task.schedule, actualStartedAt: task.schedule.actualStartedAt ?? now, actualFinishedAt: now }, updatedAt: now };
        }
        const bindings = await dataStore.list<any>('starter_social_content_tasks', {
          where: { tenant_id: tenantId, create_idempotency_key: `weekly-production:${packageId}:${task.packageVersion}:${task.publicationTaskId}` }, page: 1, perPage: 2,
        });
        const binding = creativeRepair?.contentTask ?? bindings.items[0];
        if (bindings.totalItems !== 1 || !binding || binding.weekly_plan_id !== packageId) {
          throw new SocialProgramError('weekly_production_binding_required', 409, '尚未取得本条内容的真实生产身份，不能验收。');
        }
        const upstreamArtifactRefs = approvalDependencies.flatMap(row => row.payload.resultRefs)
          .filter(ref => ref.type === 'starter_social_content_artifact');
        const uniqueArtifactRefs = [...new Map(upstreamArtifactRefs.map(ref => [`${ref.id}:${ref.version}`, ref])).values()];
        if (!creativeRepair && uniqueArtifactRefs.length !== 1) {
          throw new SocialProgramError('weekly_production_approval_artifact_required', 409, '上游质检与返工任务没有唯一绑定同一条待验收成片。');
        }
        // A resolved revision has its own independent G4/G5 evidence. Preserve the
        // original quality task history and select the child only from sealed server records.
        const upstreamArtifactRef = creativeRepair?.artifactRef ?? uniqueArtifactRefs[0]!;
        const artifacts = await dataStore.list<any>('starter_social_content_artifacts', {
          where: { tenant_id: tenantId, task_id: binding.task_id, artifact_id: upstreamArtifactRef.id }, page: 1, perPage: 2,
        });
        const artifact = artifacts.totalItems === 1 ? { ...artifacts.items[0], content: socialJson(artifacts.items[0]?.content) } : null;
        if (artifact && Number(String(artifact.version).replace(/^v/, '')) !== upstreamArtifactRef.version) {
          throw new SocialProgramError('weekly_production_approval_artifact_changed', 409, '上游已核验成片版本发生变化，请重新完成对应质量任务。');
        }
        if (!artifact || !['review_required', 'approved'].includes(artifact.status)) {
          throw new SocialProgramError('weekly_production_artifact_not_reviewable', 409, '真实成片尚未就绪或质量检查未通过。');
        }
        await validateContentArtifact(dataStore, { ...task, workflowKind: 'content', schedule: { ...task.schedule, stepKind: 'quality_check' } }, {
          type: 'starter_social_content_artifact', id: artifact.artifact_id, version: Number(String(artifact.version).replace(/^v/, '')),
        });
        const accepted = await decideSocialContentArtifact({
          repository: createStarter198Repository(dataStore), tenantId, userId,
          taskId: binding.task_id, artifactId: artifact.artifact_id,
          idempotencyKey: `weekly-content-approval:${task.taskId}:${artifact.artifact_id}`,
          value: { decision: 'approved', expectedVersion: creativeRepair
            ? `${String(artifact.version).startsWith('v') ? 'v' : ''}${creativeRepair.audit.childArtifactRef.version}`
            : String(artifact.version), note: '用户在周工作台确认本条真实成片' },
          now: new Date(now),
        });
        return {
          ...task,
          status: 'succeeded',
          resultRefs: [
            { type: 'user_content_approval', id: `${task.taskId}:${userId}`, version: 1 },
            { type: 'starter_social_content_artifact', id: accepted.artifact.artifactId, version: Number(String(accepted.artifact.version).replace(/^v/, '')) },
          ],
          schedule: { ...task.schedule, actualStartedAt: task.schedule.actualStartedAt ?? now, actualFinishedAt: now },
          updatedAt: now,
        };
      });
    },
  };
}
