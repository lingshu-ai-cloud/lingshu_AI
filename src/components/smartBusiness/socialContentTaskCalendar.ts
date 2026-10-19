import type { SocialContentTaskSummary } from '../../../shared/contracts/socialContentWorkflow';
import type { AgentCalendarTask } from './AgentWeeklyCalendar';
import {businessDate} from '../../../shared/naturalWeek';

const completedStatuses = new Set(['delivered', 'awaiting_publish', 'awaiting_metrics', 'reviewed']);
const activeStatuses = new Set(['plan_review', 'producing', 'asset_review', 'packaging']);
const blockedStatuses = new Set(['needs_input', 'attention', 'paused']);

/** Package-owned work is projected from its execution graph, never relabelled
 * as an independent card in another program/package revision. Unbound work
 * remains visible even when the old digital-employee run differs. */
export function standaloneCalendarContentTasks(tasks:SocialContentTaskSummary[],scope:{programId?:string;packageContentTaskIds:ReadonlySet<string>}):SocialContentTaskSummary[]{
  return tasks.filter(task=>{
    if(scope.packageContentTaskIds.has(task.taskId))return false;
    const programId=task.brief.programRef?.id;
    if(!programId)return true;
    if(programId!==scope.programId)return false;
    return !task.weeklyPlanId;
  });
}

function calendarStatus(task: SocialContentTaskSummary): AgentCalendarTask['status'] {
  if (completedStatuses.has(task.status)) return task.artifactCount > 0 ? 'completed' : 'blocked';
  if (activeStatuses.has(task.status)) return 'active';
  if (blockedStatuses.has(task.status)) return 'blocked';
  return 'planned';
}

function instant(value: string | null | undefined, fallback: string) {
  const parsed = new Date(value || fallback);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(fallback);
}

function point(value: Date) {
  const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(value);
  return {
    date: businessDate(value),
    time: clock,
  };
}

/**
 * Projects persisted content tasks into customer-facing deliverables. It deliberately
 * keeps Business/Director/Content work as internal nodes instead of inventing one
 * calendar card per scene or per implementation step.
 */
export function projectSocialContentTaskCalendar(tasks: SocialContentTaskSummary[]): AgentCalendarTask[] {
  return tasks.map(task => {
    const created = instant(task.createdAt, task.updatedAt);
    const updated = instant(task.updatedAt, task.createdAt);
    const finish = instant(task.brief.dueAt, task.updatedAt);
    const createdPoint = point(created);
    const updatedPoint = point(updated);
    const finishPoint = point(finish);
    const status = calendarStatus(task);
    const directorReady = Boolean(task.directorPlan);
    const productionReady = task.artifactCount > 0;
    const qualityPassed = task.approvedArtifactCount > 0;
    const needs = task.readiness.missing;
    const reason = [task.status==='paused'?'任务已暂停':null,completedStatuses.has(task.status)&&!task.artifactCount?'交付状态尚无产物记录，请核验原任务':null,...needs].filter(Boolean).join('；') || undefined;
    const referenceVideoId = task.scriptBaseline?.referenceVideoId || '';
    const previewThumbnailUrl = referenceVideoId ? `/api/overseas/videos/${encodeURIComponent(referenceVideoId)}/thumbnail` : undefined;
    const previewVideoUrl = referenceVideoId ? `/api/overseas/videos/${encodeURIComponent(referenceVideoId)}/media-url` : undefined;
    const directorReason = !directorReady && task.scriptBaseline
      ? ['参考分析与脚本基线已完成，但编导交接尚未冻结', '请进入内容制作确认人物/素材、口播、替换范围与镜头要求', ...needs].filter(Boolean).join('；')
      : reason;
    const nodes: AgentCalendarTask[] = [
      {
        id: `${task.taskId}:business`, date: createdPoint.date, time: createdPoint.time,
        agent: 'business', executionStep: 'business_schedule', title: '经营任务与交付目标', output: task.brief.objective,
        context: `真实内容任务 ${task.taskId}`, minutes: null, status: 'completed',
        productionTaskId: task.taskId, videoTaskId: task.taskId, videoTitle: task.brief.title, targetDurationSeconds: task.brief.targetDurationSeconds, productionApproach: task.brief.productionApproach, timeSemantics: 'finish',
      },
      {
        id: `${task.taskId}:director`, date: updatedPoint.date, time: updatedPoint.time,
        agent: 'director', executionStep: 'storyboard', title: '脚本、分镜与复刻指令',
        output: task.directorPlan?.scriptSummary || (directorReady ? '编导指令已写入当前内容任务' : '等待编导 Agent 生成并锁定制作指令'),
        context: task.directorPlan ? `编导计划 v${task.directorPlan.version} · ${task.directorPlan.sceneCount} 个分镜` : '编导计划尚未生成', minutes: null,
        status: directorReady ? 'completed' : status === 'blocked' ? 'blocked' : 'planned',
        reason: directorReady ? undefined : directorReason, productionTaskId: task.taskId, videoTaskId: task.taskId, videoTitle: task.brief.title, targetDurationSeconds: task.brief.targetDurationSeconds, productionApproach: task.brief.productionApproach, previewThumbnailUrl, previewVideoUrl, timeSemantics: 'finish',
      },
      {
        id: `${task.taskId}:content`, date: updatedPoint.date, time: updatedPoint.time,
        agent: 'content', executionStep: 'video_generation', title: '镜头制作、字幕、配乐与渲染',
        output: productionReady ? `已生成 ${task.artifactCount} 项真实产物` : '等待内容 Agent 生成真实成片',
        context: task.directorPlan ? `${task.directorPlan.sceneCount} 个真实分镜` : '制作方案尚未生成',
        minutes: null, status: productionReady ? 'completed' : status,
        reason: productionReady ? undefined : directorReady ? reason : '等待编导成稿完成并通过交接后启动生产', productionTaskId: task.taskId, videoTaskId: task.taskId, videoTitle: task.brief.title, targetDurationSeconds: task.brief.targetDurationSeconds, productionApproach: task.brief.productionApproach, previewThumbnailUrl, previewVideoUrl, timeSemantics: 'finish',
      },
      {
        id: `${task.taskId}:quality`, date: updatedPoint.date, time: updatedPoint.time,
        agent: 'director', executionStep: 'quality_check', title: '技术质检与创意复刻审核',
        output: qualityPassed ? `${task.approvedArtifactCount} 项真实产物已审核通过` : productionReady ? '真实成片等待审核通过' : '等待成片后执行真实审核',
        context: productionReady ? `核验当前任务的 ${task.artifactCount} 项真实产物` : '尚无生产结果',
        minutes: null, status: qualityPassed ? 'completed' : productionReady ? 'active' : 'planned',
        reason: qualityPassed ? undefined : productionReady ? reason : '等待候选成片生成后执行技术质检与创意复刻审核', productionTaskId: task.taskId, videoTaskId: task.taskId, videoTitle: task.brief.title, targetDurationSeconds: task.brief.targetDurationSeconds, productionApproach: task.brief.productionApproach, previewThumbnailUrl, previewVideoUrl, timeSemantics: 'finish',
      },
    ];
    return {
      id: `social-content:${task.taskId}`,
      deliverableGroup: `social-content:${task.taskId}`,
      date: finishPoint.date,
      time: finishPoint.time,
      dueAt: task.brief.dueAt || undefined,
      agent: 'content',
      title: task.brief.title || '完成视频成片',
      output: productionReady ? `已回收 ${task.artifactCount} 项产物 · ${task.approvedArtifactCount} 项审核通过` : '等待生产任务回收交付物',
      context: [task.brief.productRef, task.brief.platforms.join(' / '), task.brief.languages.join(' / ')].filter(Boolean).join(' · ') || task.brief.objective,
      minutes: null,
      status,
      reason,
      chain: task.weeklyPlanId ? `周计划 ${task.weeklyPlanId}` : '真实单条视频任务',
      productionTaskId: task.taskId,
      videoTaskId: task.taskId,
      videoTitle: task.brief.title,
      targetDurationSeconds: task.brief.targetDurationSeconds,
      productionApproach: task.brief.productionApproach,
      previewThumbnailUrl,
      previewVideoUrl,
      internalNodes: nodes,
      timeSemantics: 'finish',
    };
  });
}
