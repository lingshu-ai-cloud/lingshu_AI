import type { DataStore } from '../storage/datastore.js';
import type { AgentStatus, WorkflowTask } from '../../src/lib/digitalEmployees.js';
import { buildVideoAnalysisProgress, type VideoAnalysisProgress } from '../lib/videoAnalysisProgress.js';

type TrendVideoRecord = {
  id: string;
  tenantId?: string;
  title?: string;
  status?: string;
  aiAnalysis?: unknown;
  updatedAt?: string;
  updated?: string;
  workflowGoalId?: string;
  goalId?: string;
  workflowRunId?: string;
};

export type DirectorAnalysisScope = {
  goalId?: string;
  runId?: string;
  referenceVideoIds?: string[];
  /** Only the default tenant overview includes independent inspiration work. */
  includeUnscoped?: boolean;
};

export type LiveDirectorAnalysisTask = WorkflowTask & {
  agent_role: 'director';
  status: 'pending' | 'running' | 'failed' | 'paused';
  output: { source: 'trend_videos'; recordId: string; analysisProgress: VideoAnalysisProgress; readOnly: true };
};

function object(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return object(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function inScope(record: TrendVideoRecord, analysis: Record<string, unknown>, scope: DirectorAnalysisScope): boolean {
  const goalId = text(record.workflowGoalId || record.goalId || analysis.workflowGoalId || analysis.goalId);
  const runId = text(record.workflowRunId || analysis.workflowRunId);
  // A reference reused by another plan never overrides an explicit owner.
  if (goalId && goalId !== scope.goalId) return false;
  if (runId && runId !== scope.runId) return false;
  return Boolean(goalId || runId || scope.referenceVideoIds?.includes(record.id) || scope.includeUnscoped);
}

/** Read-only projection. These are NOT workflow task records or action targets. */
export async function liveDirectorAnalysisTasks(dataStore: DataStore, tenantId: string, scope: DirectorAnalysisScope = { includeUnscoped: true }): Promise<LiveDirectorAnalysisTask[]> {
  if (!tenantId.trim()) return [];
  const result = await dataStore.list<TrendVideoRecord>('trend_videos', {
    where: { tenantId }, sort: '-updatedAt', page: 1, perPage: 500,
  });
  return result.items.flatMap(record => {
    if (record.tenantId !== tenantId) return [];
    const analysis = object(record.aiAnalysis);
    if (!inScope(record, analysis, scope)) return [];
    const progress = buildVideoAnalysisProgress({
      analysis, recordStatus: record.status, recordUpdatedAt: record.updatedAt || record.updated,
      failureMessage: analysis.analysisError || analysis.videoLevelFailureStatus,
    });
    if (!progress.runId || !progress.backendAccepted) return [];
    if (['completed', 'cancelled', 'metadata'].includes(progress.stage)) return [];
    const status: LiveDirectorAnalysisTask['status'] = progress.stage === 'failed' ? 'failed'
      : progress.stage === 'paused' ? 'paused'
        : progress.stage === 'queued' || !progress.workerStarted ? 'pending' : 'running';
    return [{
      id: `trend-analysis:${record.id}:${progress.runId}`,
      run_id: progress.runId,
      task_key: 'viral_analysis',
      title: `${progress.stageLabel}：${text(record.title).slice(0, 160) || '新入库灵感'}`,
      description: progress.currentStep,
      agent_role: 'director', kind: 'analysis', status, sequence: 0, priority: 'high',
      requires_approval: false, depends_on: [],
      output: { source: 'trend_videos', recordId: record.id, analysisProgress: progress, readOnly: true },
      blocked_reason: status === 'failed' || status === 'paused' ? progress.currentStep : '',
      owner_id: '', updated_at: progress.updatedAt || '', business_domain: 'content',
      capability_key: 'viral_analysis', destination: 'socialInspiration', destination_view: 'create',
      status_source: 'trend_video_analysis', execution_mode: 'observe', external_effect: 'none',
      business_refs: [{ type: 'trend_video', id: record.id }],
    } satisfies LiveDirectorAnalysisTask];
  });
}

/** Preserve active workflow work; use inspiration status when the Agent is idle. */
export function projectDirectorAnalysisStatus(agents: AgentStatus[], analyses: LiveDirectorAnalysisTask[]): AgentStatus[] {
  if (!analyses.length) return agents;
  const priority = { running: 0, failed: 1, paused: 2, pending: 3 };
  const current = [...analyses].sort((a, b) => priority[a.status] - priority[b.status] || b.updated_at.localeCompare(a.updated_at))[0]!;
  return agents.map(agent => {
    if (agent.role !== 'director' || !['idle', 'completed'].includes(agent.status)) return agent;
    return { ...agent, status: current.status, currentTask: current.title, total: agent.total + analyses.length };
  });
}

export function directorAnalysisReferenceIds(planBody: Record<string, unknown>, tasks: Array<Pick<WorkflowTask, 'business_refs'>>): string[] {
  const pack = object(planBody.businessPackage);
  const planTasks = Array.isArray(pack.tasks) ? pack.tasks.map(object) : [];
  const planIds = planTasks.flatMap(task => Array.isArray(task.videoPlans) ? task.videoPlans.map(value => text(object(value).referenceId)) : []);
  const taskIds = tasks.flatMap(task => (Array.isArray(task.business_refs) ? task.business_refs : [])
    .filter(ref => ref && typeof ref === 'object' && ref.type === 'trend_video')
    .map(ref => text(ref.id)));
  return [...new Set([...planIds, ...taskIds].filter(Boolean))];
}
