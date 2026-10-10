import {calendarClock,calendarDateTime,frozenCalendarClock} from './calendarTime';
import {isTemplateCalendarStep} from './templateCalendarNavigation';
import {executionCalendarPresentation,type ExecutionCalendarPresentationOptions} from './weeklyExecutionCalendarPresentation';
import {isPlanningCalendarStep} from './planningCalendarNavigation';
import type { WeeklyExecutionTask, WeeklyProductionStepKind } from '../../../shared/contracts/socialProgram';
import type { AgentCalendarTask } from '../smartBusiness/AgentWeeklyCalendar';

/** Project persisted execution data; no inferred production tasks or completion. */
export function projectExecutionCalendar(tasks: WeeklyExecutionTask[], labels: Record<WeeklyProductionStepKind, string>, now = Date.now(),options:ExecutionCalendarPresentationOptions={}): AgentCalendarTask[] {
  const bindingKey = (task: WeeklyExecutionTask) => JSON.stringify([task.tenantId, task.programId, task.packageId, task.packageVersion, task.publicationTaskId]);
  const bindings = new Map<string, Set<string>>();
  for (const task of tasks) {
    if (!task.publicationTaskId) continue;
    const id = (task.continuationObservation?.status === 'ready' ? task.continuationObservation.contentTaskId : undefined) || task.productionProgress?.contentTaskId || task.resultRefs.find(ref => ['starter_social_content_task','starter_social_content_script_baseline','starter_social_content_director_plan','starter_social_content_material_demand','starter_social_owned_product_identity_demand','starter_social_material_preparation'].includes(ref.type))?.id;
    if (!id) continue;
    const ids = bindings.get(bindingKey(task)) ?? new Set<string>();
    ids.add(id);
    bindings.set(bindingKey(task), ids);
  }
  const affectedPublications = (source: WeeklyExecutionTask): string[] => {
    const affected = new Set([source.taskId]);
    let changed = true;
    while (changed) { changed = false; for (const downstream of tasks) {
      if (!affected.has(downstream.taskId) && downstream.dependsOnTaskIds.some(id => affected.has(id)) && downstream.tenantId === source.tenantId && downstream.programId === source.programId && downstream.packageId === source.packageId && downstream.packageVersion === source.packageVersion) { affected.add(downstream.taskId); changed = true; }
    } }
    return [...new Set(tasks.filter(candidate => affected.has(candidate.taskId) && candidate.publicationTaskId && candidate.tenantId === source.tenantId && candidate.programId === source.programId && candidate.packageId === source.packageId && candidate.packageVersion === source.packageVersion).map(candidate => candidate.publicationTaskId!))];
  };
  return tasks.flatMap(task => {
    const finish = new Date(task.schedule.estimatedFinishAt);
    if (!Number.isFinite(finish.getTime())) return [];
    const frozenPublication = task.inputSnapshot?.publicationTask as {publishWindow?:string|null} | undefined;
    const scopedPackage = options.pkg?.programId===task.programId && options.pkg?.packageId===task.packageId && options.pkg?.version===task.packageVersion ? options.pkg : undefined;
    const publication = frozenPublication?.publishWindow ?? scopedPackage?.socialContentPackage.publicationTasks.find(item=>item.publicationTaskId===task.publicationTaskId)?.publishWindow;
    const frozenFields = [task.schedule,task.inputSnapshot,task.inputSnapshot?.publicationTask,scopedPackage].filter(Boolean) as Array<{timeZone?:unknown;timezone?:unknown}>;
    const clock = frozenCalendarClock(frozenFields.flatMap(value=>[value.timeZone,value.timezone]),publication ?? task.schedule.estimatedFinishAt,publication?'publication_offset':'schedule_offset');
    const planned = calendarDateTime(task.schedule.estimatedFinishAt,clock);
    const presentation=executionCalendarPresentation(task,labels[task.schedule.stepKind]||'阶段交付',options);
    const actor = task.schedule.responsibleActor;
    const agent: AgentCalendarTask['agent'] = actor === 'director_agent' ? 'director' : actor === 'content_agent' || actor === 'quality_agent' ? 'content' : actor === 'user' ? 'human' : 'business';
    const status: AgentCalendarTask['status'] = task.status === 'succeeded' ? 'completed' : task.status === 'leased' ? 'active' : task.status === 'cancelled' ? 'cancelled' : task.status === 'dead_letter' ? 'failed' : task.status === 'blocked' ? 'blocked' : 'planned';
    const terminal = ['succeeded','cancelled'].includes(task.status);
    const latestStart = Date.parse(task.schedule.latestStartAt || '');
    const latestFinish = Date.parse(task.schedule.latestFinishAt || '');
    const continued = task.continuationObservation?.status === 'ready' ? task.continuationObservation : undefined;
    const actualFinishedAt = continued ? continued.sourceActualFinishedAt : task.schedule.actualFinishedAt;
    const deliveryDeadlineAt = continued ? continued.sourceLatestFinishAt : task.schedule.latestFinishAt;
    const deliveryDeadline = Date.parse(deliveryDeadlineAt || '');
    const currentRisks = terminal ? [] : Number.isFinite(latestFinish) && now > latestFinish
      ? ['已超过最晚完成时间，关联发布存在风险']
      : task.status !== 'leased' && Number.isFinite(latestStart) && now > latestStart ? ['已超过最晚开始时间，请重新评估关联发布'] : [];
    const planningRisks = (task.schedule.planningRisks ?? []).map(code => code === 'publication_deadline_at_risk' ? '预计完成时间晚于发布所需截止' : code === 'precise_publish_time_required' ? '缺少包含时区的具体发布时间' : code);
    const reason = [...task.ownBlockingReasons, ...task.inheritedBlockingTaskIds.map(id => `等待上游 ${id}`), ...planningRisks, ...currentRisks, ...(task.lastError ? [task.lastError.message] : [])].join('；');
    const boundIds = task.publicationTaskId ? bindings.get(bindingKey(task)) : undefined;
    return [{
      id: task.taskId,
      date: planned.date,
      time: planned.time,
      calendarClock: clock,
      deadlineRecovery: task.deadlineRecovery,
      deadlineTracked: true,
      dueAt: task.schedule.latestFinishAt ?? task.schedule.estimatedFinishAt,
      actualFinishedAt: actualFinishedAt ?? undefined,
      ...(continued ? { sourceDeadlineAt: deliveryDeadlineAt ?? undefined, sourceVersion: continued.sourceVersion } : {}),
      deliveryTiming: task.status === 'succeeded' ? (Number.isFinite(Date.parse(actualFinishedAt || '')) && Number.isFinite(deliveryDeadline) ? Date.parse(actualFinishedAt!) <= deliveryDeadline ? 'on_time' : 'late' : 'unknown') : undefined,
      affectedPublicationIds: affectedPublications(task),
      agent, status, title: presentation.title,chain:presentation.chain,
      context: presentation.context,
      output: `${presentation.topic?`${presentation.topic} · `:''}${task.resultRefs.length ? task.continuationObservation?.status === 'ready' ? `已核验承接原 v${task.continuationObservation.sourceVersion} 任务交付：${labels[task.schedule.stepKind]}` : task.resultRefs.map(ref => `${ref.type} · ${ref.id} · v${ref.version}`).join('；') : `待交付：${labels[task.schedule.stepKind]}`}`, 
      minutes: task.schedule.estimatedDurationMinutes,
      dependsOn: task.dependsOnTaskIds,
      ...(task.schedule.stepKind === 'user_approval' ? {
        humanAction: 'approval' as const,
        availableForHuman: task.status === 'queued' && task.inheritedBlockingTaskIds.length === 0,
        deadlineRecovery: task.deadlineRecovery,
      deadlineTracked: true,
      dueAt: task.schedule.latestFinishAt ?? task.schedule.estimatedFinishAt,
        submission: task.status === 'succeeded' ? 'accepted' as const : 'missing' as const,
      } : {}),
      ...(['performance_monitoring','weekly_review'].includes(task.schedule.stepKind)&&task.tenantId&&task.programId&&task.packageId&&Number.isSafeInteger(task.packageVersion)&&task.packageVersion>0?{reviewTarget:{tenantId:task.tenantId,programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion,taskId:task.taskId,stepKind:task.schedule.stepKind as 'performance_monitoring'|'weekly_review'}}:{}),
      ...(isTemplateCalendarStep(task.schedule.stepKind)?{templateTarget:{tenantId:task.tenantId,programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion,taskId:task.taskId,stepKind:task.schedule.stepKind}}:{}),
      ...(isPlanningCalendarStep(task.schedule.stepKind)&&task.tenantId&&task.programId&&task.packageId&&Number.isSafeInteger(task.packageVersion)&&task.packageVersion>0?{planningTarget:{tenantId:task.tenantId,programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion,taskId:task.taskId,stepKind:task.schedule.stepKind}}:{}),
      ...((task.inputSnapshot?.publicationTask as {inventoryReuseRef?:{type:string;id:string;version:number}})?.inventoryReuseRef?.type==='weekly_inventory_binding'?{inventoryTarget:{tenantId:task.tenantId,programId:task.programId,packageId:task.packageId,packageVersion:task.packageVersion,bindingId:(task.inputSnapshot.publicationTask as {inventoryReuseRef:{id:string}}).inventoryReuseRef.id,publicationTaskId:task.publicationTaskId!,taskId:task.taskId}}:{}),
      productionTaskId: (isTemplateCalendarStep(task.schedule.stepKind)||isPlanningCalendarStep(task.schedule.stepKind)||['performance_monitoring','weekly_review'].includes(task.schedule.stepKind)) ? undefined : boundIds?.size === 1 ? [...boundIds][0] : undefined,
      reason: reason || undefined,
    }];
  });
}
