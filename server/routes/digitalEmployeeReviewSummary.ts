import type { BusinessSnapshot } from '../digitalEmployees/businessSnapshot.js';
import { jsonObject, type RunRecord, type TaskRecord } from './digitalEmployeeRecords.js';

export function availableTaskActions(task: TaskRecord): string[] {
  if (task.status === 'handed_off') return ['return_to_agent'];
  if (['succeeded', 'skipped', 'cancelled'].includes(task.status)) return ['replan'];
  const actions = ['retry', 'skip', 'manual_complete', 'handoff', 'replan'];
  if (task.task_key === 'viral_analysis') {
    return actions.filter(action => !['skip', 'manual_complete'].includes(action));
  }
  if (['platform_publish', 'followup_dispatch'].includes(task.task_key)) {
    return actions.filter(action => action !== 'manual_complete');
  }
  return actions;
}

export function runReviewSummary(run: RunRecord, tasks: TaskRecord[], businessSnapshot: BusinessSnapshot) {
  const statusCounts = tasks.reduce<Record<string, number>>((counts, task) => {
    counts[task.status] = (counts[task.status] || 0) + 1;
    return counts;
  }, {});
  const completedCount = Number(statusCounts.succeeded || 0);
  const byKey = new Map(tasks.map(task => [task.task_key, task]));
  const blockedTasks = tasks
    .map(task => {
      const waitingOn = jsonObject<string[]>(task.depends_on, []).filter(key => {
        const upstream = byKey.get(key);
        return !upstream || !['succeeded', 'skipped'].includes(upstream.status);
      });
      if (!['waiting_external', 'waiting_approval', 'waiting_human', 'handed_off', 'failed'].includes(task.status) && !(task.status === 'pending' && waitingOn.length)) return null;
      return {
        taskId: task.id,
        taskKey: task.task_key,
        title: task.title,
        status: task.status,
        reason: task.blocked_reason || (waitingOn.length ? `等待上游：${waitingOn.join('、')}` : '等待外部事实回写'),
        destination: task.destination || 'digitalEmployees',
        destinationView: task.destination_view || '',
        availableActions: availableTaskActions(task),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  return {
    runId: run.id,
    runStatus: run.status,
    isLive: !['succeeded', 'failed', 'cancelled'].includes(run.status),
    generatedAt: businessSnapshot.generatedAt,
    totalTasks: tasks.length,
    completedTasks: Number(statusCounts.succeeded || 0),
    skippedTasks: Number(statusCounts.skipped || 0),
    completionRate: tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0,
    statusCounts,
    blockedTasks,
    blockedReasons: [...new Set(blockedTasks.map(item => item.reason))],
    businessSnapshot,
    dataGaps: businessSnapshot.dataGaps,
    sourceStatus: 'real_business_aggregation',
  };
}


