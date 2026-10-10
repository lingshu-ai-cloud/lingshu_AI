import type { WeeklyExecutionTask, SocialWeeklyPublicationTask } from '../../shared/contracts/socialProgram.js';
import { SocialProgramError } from './service.js';

export function publicationInstant(window: string | null | undefined): number | null {
  if (!window || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(window)) return null;
  const [year, month, day] = window.slice(0,10).split('-').map(Number);
  const date = new Date(Date.UTC(year!, month!-1, day!));
  if (date.getUTCFullYear() !== year || date.getUTCMonth()+1 !== month || date.getUTCDate() !== day) return null;
  const clock = window.slice(11).match(/^(\d{2}):(\d{2})(?::(\d{2}))?/)!;
  if (Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3] ?? 0) > 59) return null;
  const instant = Date.parse(window);
  return Number.isFinite(instant) ? instant : null;
}

/** The downstream production brief must finish before publication, too. Unknown
 * publication instants remain unknown rather than falling back to week end. */
export function publicationPreparationDeadline(window: string | null | undefined): string | null {
  const instant = publicationInstant(window);
  return instant === null ? null : new Date(instant - 86_400_000).toISOString();
}

/** Attach latest feasible deadlines without disguising forward-plan capacity or elapsed time. */
export function applyPublicationDeadlines(tasks: WeeklyExecutionTask[], publications: SocialWeeklyPublicationTask[]): WeeklyExecutionTask[] {
  const latestFinish = new Map<string, number>();
  const byId = new Map(tasks.map(task => [task.taskId, task]));
  if (byId.size !== tasks.length) throw new SocialProgramError('weekly_execution_duplicate_task', 409, '执行排期存在重复任务身份。');
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (task: WeeklyExecutionTask) => {
    if (visited.has(task.taskId)) return;
    if (visiting.has(task.taskId)) throw new SocialProgramError('weekly_execution_dependency_cycle', 409, '执行排期存在循环依赖，无法计算前置截止。');
    visiting.add(task.taskId);
    for (const id of task.dependsOnTaskIds) {
      const parent = byId.get(id);
      if (!parent) throw new SocialProgramError('weekly_execution_dependency_missing', 409, '执行排期引用了不存在的前置任务。');
      visit(parent);
    }
    visiting.delete(task.taskId); visited.add(task.taskId);
  };
  tasks.forEach(visit);
  const invalid = new Set<string>();
  const setEarlier = (id: string, deadline: number) => latestFinish.set(id, Math.min(latestFinish.get(id) ?? Infinity, deadline));
  for (const publication of publications) {
    const publishing = tasks.find(task => task.publicationTaskId === publication.publicationTaskId && task.schedule.stepKind === 'publishing');
    if (!publishing) continue;
    const instant = publicationInstant(publication.publishWindow);
    // Date ranges and timestamps without a zone are not precise publish instants.
    if (instant === null) {
      // Every prerequisite needs a precise target before its deadline can be trusted.
      const pending = [publishing.taskId];
      while (pending.length) {
        const id = pending.pop()!;
        if (invalid.has(id)) continue;
        invalid.add(id);
        pending.push(...(byId.get(id)?.dependsOnTaskIds ?? []));
      }
      continue;
    }
    setEarlier(publishing.taskId, instant + publishing.schedule.estimatedDurationMinutes * 60_000);
    // Conservative rolling 24h lead guarantees readiness on the preceding local day.
    for (const parent of publishing.dependsOnTaskIds) setEarlier(parent, instant - 86_400_000);
  }
  // Iterate independently of input order; each predecessor must finish before successor starts.
  for (let pass = 0; pass < tasks.length; pass++) {
    let changed = false;
    for (const [id, finish] of [...latestFinish]) {
      const task = byId.get(id);
      if (!task || task.schedule.stepKind === 'publishing') continue;
      const start = finish - task.schedule.estimatedDurationMinutes * 60_000;
      for (const parent of task.dependsOnTaskIds) {
        if (start < (latestFinish.get(parent) ?? Infinity)) { setEarlier(parent, start); changed = true; }
      }
    }
    if (!changed) break;
  }
  return tasks.map(task => {
    const finish = latestFinish.get(task.taskId);
    const issues: string[] = [];
    if (invalid.has(task.taskId)) issues.push('precise_publish_time_required');
    if (finish !== undefined && Date.parse(task.schedule.estimatedFinishAt) > finish) issues.push('publication_deadline_at_risk');
    return { ...task, schedule: { ...task.schedule,
      latestFinishAt: finish === undefined ? null : new Date(finish).toISOString(),
      latestStartAt: finish === undefined ? null : new Date(finish - task.schedule.estimatedDurationMinutes * 60_000).toISOString(),
      planningRisks: issues,
    } };
  });
}
