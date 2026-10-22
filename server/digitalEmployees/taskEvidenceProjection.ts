import { contentProjectExplicitWorkflowScope, managedContentProjectBelongsToWorkflowScope } from './contentProjectLineage.js';
import { hasParseableExactVideoAnalysis } from './viralAnalysisCoverage.js';
import { jsonObject, type PlanRecord, type RunRecord, type StoredRecord, type TaskRecord } from '../routes/digitalEmployeeRecords.js';

export type TaskExecutionMetadata = {
  businessDomain: string;
  capabilityKey: string;
  destination: string;
  destinationView: string;
  statusSource: string;
  executionMode: 'internal' | 'observe' | 'draft_executor' | 'approval';
  externalEffect: string;
  automaticExecutionAllowed: boolean;
  policySource: string;
};

export function taskExecutionMetadata(task: TaskRecord, plan: PlanRecord | null): TaskExecutionMetadata {
  const planBody = plan ? jsonObject<Record<string, unknown>>(plan.plan, {}) : {};
  const planTasks = Array.isArray(planBody.tasks) ? planBody.tasks as Array<Record<string, unknown>> : [];
  const planned = planTasks.find(item => String(item.key || '') === task.task_key) || {};
  const inferredMode: TaskExecutionMetadata['executionMode'] = task.kind === 'approval' ? 'approval' : 'internal';
  const candidateMode = String(task.execution_mode || planned.executionMode || inferredMode);
  return {
    businessDomain: String(task.business_domain || planned.businessDomain || ''),
    capabilityKey: String(task.capability_key || planned.capabilityKey || ''),
    destination: String(task.destination || planned.destination || 'digitalEmployees'),
    destinationView: String(task.destination_view || planned.destinationView || ''),
    statusSource: String(task.status_source || planned.statusSource || ''),
    executionMode: ['internal', 'observe', 'draft_executor', 'approval'].includes(candidateMode) ? candidateMode as TaskExecutionMetadata['executionMode'] : inferredMode,
    externalEffect: String(task.external_effect || planned.externalEffect || 'none'),
    automaticExecutionAllowed: typeof task.automatic_execution_allowed === 'boolean'
      ? task.automatic_execution_allowed
      : planned.automaticExecutionAllowed !== false,
    policySource: String(task.policy_source || planned.policySource || 'legacy_default'),
  };
}

export function hasSucceededApprovalAncestor(task: TaskRecord, tasks: TaskRecord[]): boolean {
  const byKey = new Map(tasks.map(item => [item.task_key, item]));
  const pending = [...jsonObject<string[]>(task.depends_on, [])];
  const visited = new Set<string>();
  while (pending.length) {
    const key = pending.pop()!;
    if (visited.has(key)) continue;
    visited.add(key);
    const ancestor = byKey.get(key);
    if (!ancestor) continue;
    if (ancestor.kind === 'approval' && ancestor.status === 'succeeded') return true;
    pending.push(...jsonObject<string[]>(ancestor.depends_on, []));
  }
  return false;
}

export function destinationLabel(destination: string): string {
  return ({
    enterprise: '企业资料',
    scheduled: '定时任务',
    socialInspiration: '灵感中心',
    scriptLibrary: '脚本库',
    smartAssets: '内容创作',
    conversion: '客户经营',
    digitalEmployees: '数字员工',
  } as Record<string, string>)[destination] || '对应业务工作台';
}

export function taskScope(task: TaskRecord, tasks: TaskRecord[]): { taskIds: Set<string>; refIds: Set<string> } {
  const independent = Boolean(jsonObject<Record<string, unknown>>(task.output, {}).assistantIndependent);
  tasks = tasks.filter(item => independent ? item.id === task.id : !jsonObject<Record<string, unknown>>(item.output, {}).assistantIndependent);
  const taskIds = new Set([task.id]);
  const keys = new Set([task.task_key]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of tasks) {
      if (!keys.has(candidate.task_key) && !taskIds.has(candidate.id)) continue;
      for (const dependency of jsonObject<string[]>(candidate.depends_on, [])) {
        const dependencyTask = tasks.find(item => item.id === dependency || item.task_key === dependency);
        if (dependencyTask && !taskIds.has(dependencyTask.id)) { taskIds.add(dependencyTask.id); changed = true; }
        if (dependencyTask && !keys.has(dependencyTask.task_key)) { keys.add(dependencyTask.task_key); changed = true; }
      }
    }
  }
  for (const candidate of tasks.filter(item => keys.has(item.task_key))) taskIds.add(candidate.id);
  const refIds = new Set<string>();
  for (const candidate of tasks.filter(item => taskIds.has(item.id))) {
    for (const ref of jsonObject<Array<Record<string, unknown>>>(candidate.business_refs, [])) {
      for (const value of [ref.id, ref.recordId, ref.entityId, ref.taskId]) {
        const id = String(value || '').trim();
        if (id) refIds.add(id);
      }
    }
  }
  return { taskIds, refIds };
}

export function contentProjectTaskScope(task: TaskRecord, tasks: TaskRecord[]): { taskIds: Set<string>; refIds: Set<string> } {
  tasks = tasks.filter(item => !jsonObject<Record<string, unknown>>(item.output, {}).assistantIndependent || item.id === task.id);
  const scope = taskScope(task, tasks);
  const taskIds = task.task_key === 'content_production'
    ? new Set([task.id])
    : new Set(tasks.filter(item => item.task_key === 'content_production').map(item => item.id));
  return { ...scope, taskIds };
}

export function scopedValues(record: StoredRecord, keys: string[]): string[] {
  const containers = [
    record,
    jsonObject<Record<string, unknown>>(record.config, {}),
    jsonObject<Record<string, unknown>>(record.metadata, {}),
    jsonObject<Record<string, unknown>>(record.stats, {}),
    jsonObject<Record<string, unknown>>(record.spec, {}),
    jsonObject<Record<string, unknown>>(record.business_ref, {}),
  ];
  return [...new Set(containers.flatMap(container => keys.map(key => String(container[key] || '').trim()).filter(Boolean)))];
}

export function recordBelongsToTask(record: StoredRecord, run: RunRecord, scope: { taskIds: Set<string>; refIds: Set<string> }): boolean {
  const explicitContentScope = contentProjectExplicitWorkflowScope(record, run.id, scope.taskIds);
  if (explicitContentScope !== null) return explicitContentScope;
  const managedContentScope = managedContentProjectBelongsToWorkflowScope(record, run.id, scope.taskIds);
  if (managedContentScope !== null) return managedContentScope;
  const recordIds = [record.id, record.task_id, record.taskId, record.entity_id].map(value => String(value || '').trim()).filter(Boolean);
  if (recordIds.some(id => scope.refIds.has(id))) return true;
  const runIds = scopedValues(record, ['workflowRunId', 'workflow_run_id', 'runId', 'run_id', 'digitalEmployeeRunId']);
  const taskIds = scopedValues(record, ['workflowTaskId', 'workflow_task_id', 'taskId', 'task_id', 'digitalEmployeeTaskId']);
  if (!runIds.includes(run.id)) return false;
  return taskIds.some(id => scope.taskIds.has(id));
}

export function scopedProof(metricKey: string, source: string, records: StoredRecord[], refs: Array<Record<string, unknown>>, tenantValue: number | null) {
  return {
    ready: records.length > 0,
    proof: {
      metricKey,
      value: records.length,
      status: records.length ? 'available' : 'pending',
      source,
      scope: 'workflow_run_and_task',
      tenantSnapshotValue: tenantValue,
    },
    businessRefs: refs,
  };
}

export function exactVideoAnalysis(record: StoredRecord): boolean {
  return hasParseableExactVideoAnalysis(record);
}

export function studioProjectCompleted(record: StoredRecord): boolean {
  const spec = jsonObject<Record<string, unknown>>(record.spec, {});
  const automation = jsonObject<Record<string, unknown>>(spec.automation, {});
  if (automation.managedBy === 'digital_employee') {
    return record.status === 'ready_for_approval' && automation.stage === 'completed' && jsonObject<Record<string, unknown>>(automation.quality, {}).passed === true;
  }
  return ['completed', 'published'].includes(String(record.status || spec.status || ''));
}

export function studioProjectRendered(record: StoredRecord): boolean {
  const spec = jsonObject<Record<string, unknown>>(record.spec, {});
  const automation = jsonObject<Record<string, unknown>>(spec.automation, {});
  if (automation.managedBy !== 'digital_employee') return studioProjectCompleted(record);
  const outputPath = String(automation.renderOutputPath || spec.renderOutputPath || '').trim();
  return Boolean(outputPath && automation.stage === 'completed' && jsonObject<Record<string, unknown>>(automation.quality, {}).passed === true);
}
