import type { WeeklyExecutionTask, WeeklyProductionStepKind } from '../../../shared/contracts/socialProgram';
import type { AgentCalendarTask } from '../smartBusiness/AgentWeeklyCalendar';

/** Project persisted execution data; no inferred production tasks or completion. */
export function projectExecutionCalendar(tasks: WeeklyExecutionTask[], labels: Record<WeeklyProductionStepKind, string>, now = Date.now()): AgentCalendarTask[] {
  const bindingKey = (task: WeeklyExecutionTask) => JSON.stringify([task.tenantId, task.programId, task.packageId, task.packageVersion, task.publicationTaskId]);
  const bindings = new Map<string, Set<string>>();
  for (const task of tasks) {
    if (!task.publicationTaskId) continue;
    const id = task.productionProgress?.contentTaskId || task.resultRefs.find(ref => ['starter_social_content_task','starter_social_content_script_baseline'].includes(ref.type))?.id;
    if (!id) continue;
    const ids = bindings.get(bindingKey(task)) ?? new Set<string>();
    ids.add(id);
    bindings.set(bindingKey(task), ids);
  }
  return tasks.flatMap(task => {
    const finish = new Date(task.schedule.estimatedFinishAt);
    if (!Number.isFinite(finish.getTime())) return [];
    const actor = task.schedule.responsibleActor;
    const agent: AgentCalendarTask['agent'] = actor === 'director_agent' ? 'director' : actor === 'content_agent' || actor === 'quality_agent' ? 'content' : actor === 'user' ? 'human' : 'business';
    const status: AgentCalendarTask['status'] = task.status === 'succeeded' ? 'completed' : task.status === 'leased' ? 'active' : task.status === 'cancelled' ? 'cancelled' : task.status === 'dead_letter' ? 'failed' : task.status === 'blocked' ? 'blocked' : 'planned';
    const terminal = ['succeeded','cancelled'].includes(task.status);
    const latestStart = Date.parse(task.schedule.latestStartAt || '');
    const latestFinish = Date.parse(task.schedule.latestFinishAt || '');
    const currentRisks = terminal ? [] : Number.isFinite(latestFinish) && now > latestFinish
      ? ['已超过最晚完成时间，关联发布存在风险']
      : task.status !== 'leased' && Number.isFinite(latestStart) && now > latestStart ? ['已超过最晚开始时间，请重新评估关联发布'] : [];
    const planningRisks = (task.schedule.planningRisks ?? []).map(code => code === 'publication_deadline_at_risk' ? '预计完成时间晚于发布所需截止' : code === 'precise_publish_time_required' ? '缺少包含时区的具体发布时间' : code);
    const reason = [...task.ownBlockingReasons, ...task.inheritedBlockingTaskIds.map(id => `等待上游 ${id}`), ...planningRisks, ...currentRisks, ...(task.lastError ? [task.lastError.message] : [])].join('；');
    const boundIds = task.publicationTaskId ? bindings.get(bindingKey(task)) : undefined;
    return [{
      id: task.taskId,
      date: `${finish.getFullYear()}-${String(finish.getMonth()+1).padStart(2,'0')}-${String(finish.getDate()).padStart(2,'0')}`,
      time: `${String(finish.getHours()).padStart(2,'0')}:${String(finish.getMinutes()).padStart(2,'0')}`,
      agent, status, title: labels[task.schedule.stepKind],
      context: task.publicationTaskId ? `视频任务 ${task.publicationTaskId}` : task.accountId ? `账号 ${task.accountId}` : `周任务包 ${task.packageId}`,
      output: task.resultRefs.length ? task.resultRefs.map(ref => `${ref.type} · ${ref.id} · v${ref.version}`).join('；') : `待交付：${labels[task.schedule.stepKind]}`,
      minutes: task.schedule.estimatedDurationMinutes,
      dependsOn: task.dependsOnTaskIds,
      ...(task.schedule.stepKind === 'user_approval' ? {
        humanAction: 'approval' as const,
        availableForHuman: task.status === 'queued' && task.inheritedBlockingTaskIds.length === 0,
        dueAt: task.schedule.latestFinishAt ?? task.schedule.estimatedFinishAt,
        submission: task.status === 'succeeded' ? 'accepted' as const : 'missing' as const,
      } : {}),
      productionTaskId: boundIds?.size === 1 ? [...boundIds][0] : undefined,
      reason: reason || undefined,
    }];
  });
}
