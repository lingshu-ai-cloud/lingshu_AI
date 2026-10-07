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
  type WeeklyProductionStepKind,
  type WeeklyResponsibleActor,
  type WeeklyExecutionTaskStatus,
  type WeeklyOperatingPackage,
  type WeeklyOperatingWorkflow,
  type WeeklyOperatingWorkflowKind,
} from '../../shared/contracts/socialProgram.js';
import { SocialProgramError } from './service.js';
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
    discovery: { stepKind: 'benchmark_collection', responsibleActor: 'business_agent', duration: 60 },
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
      actualStartedAt: task.status === 'leased' || task.status === 'succeeded' ? task.updatedAt : null,
      actualFinishedAt: task.status === 'succeeded' ? task.updatedAt : null,
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
  };

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
    dependsOnTaskIds: seed.dependsOnTaskIds,
    upstreamVersionRefs: authorityRefs(pkg),
    inputSnapshot: structuredClone(seed.inputSnapshot),
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
    ownBlockingReasons: [...new Set(seed.ownBlockingReasons)],
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
    const baseStart = new Date(`${pkg.weekStart}T00:00:00.000Z`).toISOString();
    const estimatedStartAt = [...dependencyFinishes, createdAt, baseStart].sort().at(-1)!;
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
  const discovery = accountIds.map(accountId => add({
    workflowKind: 'discovery', scope: 'account', subjectId: accountId,
    accountId, publicationTaskId: null, dependsOnTaskIds: [readiness.taskId],
    inputSnapshot: { accountId, weekStart: pkg.weekStart, objective: pkg.objective },
    budget: { category: 'discovery', limitCny: moneyShare(pkg.discoveryBudgetCny, accountIds.length) },
    ownBlockingReasons: [],
    stepKind: 'benchmark_collection', responsibleActor: 'business_agent', estimatedDurationMinutes: 60,
  }));

  const byMother = new Map<string, SocialWeeklyPublicationTask[]>();
  for (const item of publications) byMother.set(item.motherContentId, [...(byMother.get(item.motherContentId) ?? []), item]);
  const directingByMother = new Map<string, WeeklyExecutionTask>();
  const scheduleByMother = new Map<string, WeeklyExecutionTask>();
  for (const [motherContentId, items] of byMother) {
    const scoring = add({
      workflowKind: 'directing', scope: 'content', subjectId: `${motherContentId}:benchmark-scoring`,
      accountId: null, publicationTaskId: null, dependsOnTaskIds: discovery.map(item => item.taskId),
      inputSnapshot: { motherContentId, candidatePolicy: 'server_score_required' }, budget: noBudget,
      ownBlockingReasons: [], stepKind: 'benchmark_scoring', responsibleActor: 'director_agent', estimatedDurationMinutes: 20,
    });
    const directing = add({
      workflowKind: 'directing', scope: 'content', subjectId: motherContentId,
      accountId: null, publicationTaskId: null, dependsOnTaskIds: [scoring.taskId],
      inputSnapshot: { motherContentId, variants: items }, budget: noBudget,
      ownBlockingReasons: [...new Set(items.flatMap(publicationBlockers))],
      stepKind: 'director_analysis', responsibleActor: 'director_agent', estimatedDurationMinutes: 45,
    });
    directingByMother.set(motherContentId, directing);
    scheduleByMother.set(motherContentId, add({
      workflowKind: 'directing', scope: 'content', subjectId: `${motherContentId}:business-schedule`,
      accountId: null, publicationTaskId: null, dependsOnTaskIds: [directing.taskId],
      inputSnapshot: { motherContentId, directorTaskId: directing.taskId, variants: items }, budget: noBudget,
      ownBlockingReasons: [], stepKind: 'business_schedule', responsibleActor: 'business_agent', estimatedDurationMinutes: 15,
    }));
  }

  const productionBudget = moneyShare(pkg.socialContentPackage.weeklyBudgetCny, publications.length);
  const approvalByPublication = new Map<string, WeeklyExecutionTask>();
  for (const [motherContentId, items] of byMother) {
    const original = items.find(item => item.adaptationOfPublicationTaskId === null) ?? items[0]!;
    let originalQualityTask: WeeklyExecutionTask | null = null;
    for (const item of [original, ...items.filter(candidate => candidate.publicationTaskId !== original.publicationTaskId)]) {
      const mode = item.publicationTaskId === original.publicationTaskId ? 'original' : 'adaptation';
      const scope = mode === 'original' ? 'content' as const : 'adaptation' as const;
      const base = `${item.publicationTaskId}:${mode}`;
      const material = add({
        workflowKind: 'content', scope, subjectId: `${base}:material-readiness`, accountId: item.accountId, publicationTaskId: item.publicationTaskId,
        dependsOnTaskIds: [scheduleByMother.get(motherContentId)!.taskId, ...(mode === 'adaptation' && originalQualityTask ? [originalQualityTask.taskId] : [])],
        inputSnapshot: { publicationTask: item, motherContentId, mode, qualityTier: 'premium' },
        budget: noBudget, ownBlockingReasons: ['business_dispatch_required'],
        stepKind: 'material_readiness', responsibleActor: 'content_agent', estimatedDurationMinutes: 20,
      });
      const script = add({
        workflowKind: 'content', scope, subjectId: `${base}:script`, accountId: item.accountId, publicationTaskId: item.publicationTaskId,
        dependsOnTaskIds: [material.taskId], inputSnapshot: { publicationTask: item, motherContentId, mode },
        budget: { category: 'production', limitCny: productionBudget }, ownBlockingReasons: [],
        stepKind: 'script', responsibleActor: 'content_agent', estimatedDurationMinutes: 30,
      });
      const storyboard = add({
        workflowKind: 'content', scope, subjectId: `${base}:storyboard`, accountId: item.accountId, publicationTaskId: item.publicationTaskId,
        dependsOnTaskIds: [script.taskId], inputSnapshot: { publicationTask: item, motherContentId, mode }, budget: noBudget, ownBlockingReasons: [],
        stepKind: 'storyboard', responsibleActor: 'content_agent', estimatedDurationMinutes: 35,
      });
      const assets = add({
        workflowKind: 'content', scope, subjectId: `${base}:asset-generation`, accountId: item.accountId, publicationTaskId: item.publicationTaskId,
        dependsOnTaskIds: [storyboard.taskId], inputSnapshot: { publicationTask: item, motherContentId, mode, generationPolicy: 'premium_max_available' },
        budget: { category: 'production', limitCny: productionBudget }, ownBlockingReasons: [],
        stepKind: 'asset_generation', responsibleActor: 'content_agent', estimatedDurationMinutes: 45,
      });
      const video = add({
        workflowKind: 'content', scope, subjectId: `${base}:video-generation`, accountId: item.accountId, publicationTaskId: item.publicationTaskId,
        dependsOnTaskIds: [assets.taskId], inputSnapshot: { publicationTask: item, motherContentId, mode, qualityTier: 'premium' },
        budget: { category: 'production', limitCny: productionBudget }, ownBlockingReasons: [],
        stepKind: 'video_generation', responsibleActor: 'content_agent', estimatedDurationMinutes: 90,
      });
      const quality = add({
        workflowKind: 'content', scope, subjectId: `${base}:quality-check`, accountId: item.accountId, publicationTaskId: item.publicationTaskId,
        dependsOnTaskIds: [video.taskId], inputSnapshot: { publicationTask: item, checks: ['facts', 'visual', 'audio', 'rights', 'platform'] }, budget: noBudget, ownBlockingReasons: [],
        stepKind: 'quality_check', responsibleActor: 'quality_agent', estimatedDurationMinutes: 25,
      });
      const rework = add({
        workflowKind: 'content', scope, subjectId: `${base}:rework`, accountId: item.accountId, publicationTaskId: item.publicationTaskId,
        dependsOnTaskIds: [quality.taskId], inputSnapshot: { publicationTask: item, conditional: true }, budget: { category: 'production', limitCny: productionBudget }, ownBlockingReasons: [],
        stepKind: 'rework', responsibleActor: 'content_agent', estimatedDurationMinutes: 30,
      });
      const approval = add({
        workflowKind: 'content', scope, subjectId: `${base}:user-approval`, accountId: item.accountId, publicationTaskId: item.publicationTaskId,
        dependsOnTaskIds: [rework.taskId], inputSnapshot: { publicationTask: item, decisionCard: 'content_approval' }, budget: noBudget, ownBlockingReasons: [],
        stepKind: 'user_approval', responsibleActor: 'user', estimatedDurationMinutes: 10,
      });
      if (mode === 'original') originalQualityTask = rework;
      approvalByPublication.set(item.publicationTaskId, approval);
    }
  }

  const publishing = publications.map(item => add({
    workflowKind: 'publishing', scope: 'publication', subjectId: item.publicationTaskId,
    accountId: item.accountId, publicationTaskId: item.publicationTaskId,
    dependsOnTaskIds: [approvalByPublication.get(item.publicationTaskId)!.taskId],
    inputSnapshot: {
      publicationTask: item,
      authorization: pkg.socialContentPackage.authorization,
    },
    budget: noBudget, ownBlockingReasons: publicationBlockers(item),
    stepKind: 'publishing', responsibleActor: 'publishing_agent', estimatedDurationMinutes: 10,
  }));

  const engagement = accountIds.map(accountId => add({
    workflowKind: 'engagement', scope: 'account', subjectId: accountId,
    accountId, publicationTaskId: null,
    dependsOnTaskIds: publishing.filter(item => item.accountId === accountId).map(item => item.taskId),
    inputSnapshot: { accountId, weekStart: pkg.weekStart, weekEnd: pkg.weekEnd },
    budget: noBudget, ownBlockingReasons: [],
    stepKind: 'performance_monitoring', responsibleActor: 'business_agent', estimatedDurationMinutes: 60,
  }));
  add({
    workflowKind: 'review', scope: 'package', subjectId: pkg.packageId,
    accountId: null, publicationTaskId: null, dependsOnTaskIds: engagement.map(item => item.taskId),
    inputSnapshot: { objective: pkg.objective, successCriteria: pkg.successCriteria },
    budget: noBudget, ownBlockingReasons: [],
    stepKind: 'weekly_review', responsibleActor: 'business_agent', estimatedDurationMinutes: 45,
  });
  return tasks;
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
  const result = await dataStore.list<WeeklyExecutionTaskRow>(WEEKLY_EXECUTION_TASKS, {
    where: { tenant_id: tenantId, program_id: programId, package_id: packageId, package_version: packageVersion },
    sort: 'created_at', page: 1, perPage: 500,
  });
  return result.items.map(row => normalizeExecutionTask(row.payload));
}

export async function materializeWeeklyExecutionTasks(
  dataStore: DataStore,
  tenantId: string,
  pkg: WeeklyOperatingPackage,
): Promise<WeeklyExecutionTask[]> {
  const planned = planWeeklyExecutionTasks(tenantId, pkg, pkg.createdAt);
  const existing = await listWeeklyExecutionTasks(dataStore, tenantId, pkg.programId, pkg.packageId, pkg.version);
  if (existing.length) {
    const expected = new Set(planned.map(item => item.idempotencyKey));
    if (existing.length !== planned.length || existing.some(item => !expected.has(item.idempotencyKey))) {
      throw new SocialProgramError('weekly_execution_task_integrity_violation', 409, '周包执行任务集与当前版本不一致。');
    }
    return existing;
  }
  const created: WeeklyExecutionTaskRow[] = [];
  try {
    for (const task of planned) {
      const row = await dataStore.create<WeeklyExecutionTaskRow>(WEEKLY_EXECUTION_TASKS, rowData(task));
      if (!row) throw new Error('create returned null');
      created.push(row);
    }
  } catch {
    for (const row of created) await dataStore.delete(WEEKLY_EXECUTION_TASKS, row.id);
    throw new SocialProgramError('weekly_execution_task_storage_unavailable', 503, '周包执行任务暂时无法保存。');
  }
  return planned;
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
export async function withWeeklyExecutionTaskMutation<T>(
  dataStore: DataStore,
  tenantId: string,
  taskId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lease = await acquireDurableOperationLease({
    dataStore,
    tenantId,
    scope: SOCIAL_WEEKLY_EXECUTION_MUTATION_SCOPE,
    subjectId: taskId,
    ownerId: `mutation-${randomUUID()}`,
    leaseDurationMs: 30_000,
  });
  if (!lease) throw new SocialProgramError('weekly_execution_task_busy', 409, '执行任务正在发生状态变更，请重试。');
  try {
    return await operation();
  } finally {
    await releaseDurableOperationLease({ dataStore, lease });
  }
}

export async function writeWeeklyExecutionTask(dataStore: DataStore, row: WeeklyExecutionTaskRow, task: WeeklyExecutionTask): Promise<void> {
  if (!await dataStore.update(WEEKLY_EXECUTION_TASKS, row.id, rowData(task))) {
    throw new SocialProgramError('weekly_execution_task_storage_unavailable', 503, '周包执行任务暂时无法更新。');
  }
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
  const targets = tasks.filter(task => task.schedule.stepKind === 'material_readiness');
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
  for (const candidate of current.filter(task => !['succeeded', 'cancelled'].includes(task.status))) {
    await withWeeklyExecutionTaskMutation(dataStore, tenantId, candidate.taskId, async () => {
      const row = await getWeeklyExecutionTaskRow(dataStore, tenantId, candidate.taskId);
      if (['succeeded', 'cancelled'].includes(row.payload.status)) return;
      const priorLease = durableLease(row.payload);
      await writeWeeklyExecutionTask(dataStore, row, {
        ...row.payload, status: 'cancelled', cancelReason: reason, lease: null, updatedAt: now,
      });
      if (priorLease) await releaseDurableOperationLease({ dataStore, lease: priorLease });
    });
  }
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
          ownBlockingReasons: reason ? task.ownBlockingReasons.filter(item => item !== reason) : [],
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
        if (task.status === 'succeeded') return task;
        const bindings = await dataStore.list<any>('starter_social_content_tasks', {
          where: { tenant_id: tenantId, create_idempotency_key: `weekly-production:${packageId}:${task.packageVersion}:${task.publicationTaskId}` }, page: 1, perPage: 2,
        });
        const binding = bindings.items[0];
        if (bindings.totalItems !== 1 || !binding || binding.weekly_plan_id !== packageId) {
          throw new SocialProgramError('weekly_production_binding_required', 409, '尚未取得本条内容的真实生产身份，不能验收。');
        }
        const artifacts = await dataStore.list<any>('starter_social_content_artifacts', {
          where: { tenant_id: tenantId, task_id: binding.task_id }, sort: '-created_at', page: 1, perPage: 100,
        });
        const artifactsWithVideo = artifacts.items.map(item => ({ ...item, content: socialJson(item.content) })).filter(item => item.content?.productionResult?.productionResultId && item.content?.mediaStorage?.video?.fileId);
        const artifact = artifactsWithVideo[0];
        if (!artifact || !['review_required', 'approved'].includes(artifact.status)
          || artifact.content.productionResult.technicalReview?.approved !== true
          || artifact.content.productionResult.creativeReview?.approved !== true) {
          throw new SocialProgramError('weekly_production_artifact_not_reviewable', 409, '真实成片尚未就绪或质量检查未通过。');
        }
        await validateContentArtifact(dataStore, { ...task, workflowKind: 'content', schedule: { ...task.schedule, stepKind: 'quality_check' } }, {
          type: 'starter_social_content_artifact', id: artifact.artifact_id, version: Number(String(artifact.version).replace(/^v/, '')),
        });
        const accepted = await decideSocialContentArtifact({
          repository: createStarter198Repository(dataStore), tenantId, userId,
          taskId: binding.task_id, artifactId: artifact.artifact_id,
          idempotencyKey: `weekly-content-approval:${task.taskId}:${artifact.artifact_id}`,
          value: { decision: 'approved', expectedVersion: String(artifact.version), note: '用户在周工作台确认本条真实成片' },
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
