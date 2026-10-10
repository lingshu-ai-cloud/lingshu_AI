import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { DataStore } from '../storage/datastore.js';
import type { AgentStatus } from '../../src/lib/digitalEmployees.js';
import { directorAnalysisReferenceIds, liveDirectorAnalysisTasks, projectDirectorAnalysisStatus } from './liveDirectorAnalyses.js';

const updatedAt = '2026-10-10T07:00:00.000Z';
function row(id: string, analysis: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id, tenantId: 'tenant-a', title: `素材 ${id}`, status: 'pending', updatedAt, aiAnalysis: JSON.stringify(analysis), ...extra };
}
function durable(id: string, stage: string) {
  return {
    analysisRunId: `analysis-${id}`, requestedAnalysisMode: 'exact', analysisQueueKind: 'stored_video',
    analysisQueueState: stage === 'analyzing' ? 'running' : stage,
    analysisStage: stage, analysisQueuedAt: updatedAt,
    ...(stage === 'analyzing' ? { analysisWorkerStartedAt: updatedAt } : {}),
  };
}
function reader(rows: ReturnType<typeof row>[]) {
  return {
    list: async <T>(collection: string, query?: { where?: Record<string, unknown> }) => {
      assert.equal(collection, 'trend_videos');
      assert.equal(query?.where?.tenantId, 'tenant-a');
      // Deliberately include mismatched rows to exercise the second isolation check.
      return { items: rows as T[], totalItems: rows.length, totalPages: 1, page: 1, perPage: 500 };
    },
    getById: async () => { throw Error('projection must not execute work'); },
    create: async () => { throw Error('projection must not create work'); },
    update: async () => { throw Error('projection must not update work'); },
    delete: async () => { throw Error('projection must not delete work'); },
  } satisfies DataStore;
}

test('only durable analysis is shown; queued work is not running and terminal states stay truthful', async () => {
  const tasks = await liveDirectorAnalysisTasks(reader([
    row('legacy', { requestedAnalysisMode: 'exact', analysisRunId: 'legacy-run', geminiStatus: 'analyzing', analysisStartedAt: updatedAt }),
    row('bare-pending', {}),
    row('queued', durable('queued', 'queued')),
    row('running', { ...durable('running', 'analyzing'), analysisMeasuredPercent: 43 }),
    row('failed', { ...durable('failed', 'failed'), analysisError: '后台分析超时，可重试', analysisRetryable: true }),
    row('paused', durable('paused', 'paused')),
    row('cancelled', durable('cancelled', 'cancelled')),
    row('completed', { ...durable('completed', 'completed'), analysisCompletedAt: updatedAt }),
    row('other-tenant', durable('other', 'analyzing'), { tenantId: 'tenant-b' }),
  ]), 'tenant-a');
  assert.deepEqual(tasks.map(task => [task.output.recordId, task.status]), [
    ['queued', 'pending'], ['running', 'running'], ['failed', 'failed'], ['paused', 'paused'],
  ]);
  assert.equal(tasks[0]?.output.analysisProgress.percent, null);
  assert.equal(tasks[1]?.output.analysisProgress.percent, 43);
  assert.match(tasks[2]!.blocked_reason, /超时/);
  assert.equal(tasks[2]?.output.analysisProgress.retryable, true);
  assert.ok(tasks.every(task => task.execution_mode === 'observe' && task.output.readOnly));
  assert.ok(tasks.every(task => task.run_id.startsWith('analysis-')));
});

test('explicit goal/run scope excludes unrelated and independently owned analyses', async () => {
  const rows = [
    row('unbound', durable('unbound', 'queued')),
    row('reference', durable('reference', 'analyzing')),
    row('own-goal', durable('own-goal', 'analyzing'), { workflowGoalId: 'goal-a' }),
    row('own-run', durable('own-run', 'analyzing'), { workflowGoalId: 'goal-a', workflowRunId: 'workflow-a' }),
    row('other-goal', durable('other-goal', 'analyzing'), { workflowGoalId: 'goal-b' }),
    row('other-run', durable('other-run', 'analyzing'), { workflowGoalId: 'goal-a', workflowRunId: 'workflow-b' }),
  ];
  const scoped = await liveDirectorAnalysisTasks(reader(rows), 'tenant-a', { goalId: 'goal-a', runId: 'workflow-a', referenceVideoIds: ['reference', 'other-goal', 'other-run'] });
  assert.deepEqual(scoped.map(task => task.output.recordId), ['reference', 'own-goal', 'own-run']);
  const defaultOverview = await liveDirectorAnalysisTasks(reader(rows), 'tenant-a', { goalId: 'goal-a', runId: 'workflow-a', includeUnscoped: true });
  assert.deepEqual(defaultOverview.map(task => task.output.recordId), ['unbound', 'reference', 'own-goal', 'own-run']);
  assert.deepEqual(await liveDirectorAnalysisTasks(reader(rows), 'tenant-a', {}), []);
});

test('status projection preserves current workflow work and does not invent analysis progress', async () => {
  const agents: AgentStatus[] = [
    { role: 'director', status: 'idle', currentTask: '', completed: 1, total: 2 },
    { role: 'content', status: 'running', currentTask: '制作成片', completed: 0, total: 1 },
  ];
  const queued = await liveDirectorAnalysisTasks(reader([row('queue', durable('queue', 'queued'))]), 'tenant-a');
  const projected = projectDirectorAnalysisStatus(agents, queued);
  assert.equal(projected[0]?.status, 'pending');
  assert.match(projected[0]!.currentTask, /等待后台工作槽/);
  assert.equal(projected[0]?.completed, 1);
  assert.equal(projected[0]?.total, 3);
  assert.equal(projected[1], agents[1]);
  assert.equal(agents[0]?.status, 'idle', 'input workflow summary must not be mutated');
  for (const stage of ['failed', 'paused']) {
    const tasks = await liveDirectorAnalysisTasks(reader([row(stage, durable(stage, stage))]), 'tenant-a');
    assert.equal(projectDirectorAnalysisStatus(agents, tasks)[0]?.status, stage);
  }
  const busy = [{ ...agents[0]!, status: 'waiting_approval', currentTask: '当前计划待审批' }];
  assert.deepEqual(projectDirectorAnalysisStatus(busy, queued), busy);
});

test('reference scope comes only from plan references and typed workflow bindings', () => {
  assert.deepEqual(directorAnalysisReferenceIds({ businessPackage: { tasks: [{ videoPlans: [{ referenceId: 'video-1' }] }] } }, [
    { business_refs: [{ type: 'trend_video', id: 'video-2' }, { type: 'studio_project', id: 'project-1' }] },
  ]), ['video-1', 'video-2']);
  assert.deepEqual(directorAnalysisReferenceIds({}, [
    { business_refs: { productSku: 'legacy-seed' } as never },
  ]), [], 'legacy non-array bindings cannot crash the overview');
});

test('overview projects analysis only into agent status, never executable workflow tasks', () => {
  const source = readFileSync(new URL('../routes/digitalEmployees.ts', import.meta.url), 'utf8');
  const overview = source.slice(source.indexOf('async function buildOverview('), source.indexOf('type ApprovalPreflight'));
  assert.match(overview, /projectDirectorAnalysisStatus\(publicAgentStatuses\(\[\]\), directorAnalyses\)/);
  assert.match(overview, /projectDirectorAnalysisStatus\(publicAgentStatuses\(normalizedTasks\), directorAnalyses\)/);
  assert.match(overview, /goalId: goal\.id, runId, includeUnscoped: !requestedGoalId/);
  assert.doesNotMatch(overview, /tasks:\s*(?:directorAnalyses|\[[^\]]*directorAnalyses)/);
});
