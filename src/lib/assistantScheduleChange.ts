import type { CreationTaskRow } from './creationTaskWorkspace';
import { creationTaskIntake } from './creationTaskWorkspace';
import { beijingDay } from './assistantScheduleProjection';
import { calendarInstant } from './calendarModel';

export type AssistantScheduleTarget = {kind:'weekly';goalId:string;contentId:string}|{kind:'task';taskId:string;expectedVersion:string;specialRequirements:string};
const editable = new Set(['draft','needs_input','plan_review','paused','attention']);

/** The calendar changes only the owner of the displayed schedule, never a detached copy. */
export function assistantScheduleTarget(row:CreationTaskRow,goalId:string):AssistantScheduleTarget|null {
  if(row.weekly?.origin==='weekly_plan')return goalId&&row.contentId?{kind:'weekly',goalId,contentId:row.contentId}:null;
  const task=row.summary,intake=task&&creationTaskIntake(task);
  if(!task||!intake||task.runId||task.publicationCount||!editable.has(task.status))return null;
  const specialRequirements=task.brief.specialRequirements||'';
  const original=JSON.parse(specialRequirements||'{}') as Record<string,unknown>;
  if(!original||Array.isArray(original)||typeof original!=='object'||typeof original.plannedPublishAt!=='string')return null;
  return {kind:'task',taskId:task.taskId,expectedVersion:task.version,specialRequirements};
}

export function assistantSchedulePreview(row:CreationTaskRow,localTime:string,rows:CreationTaskRow[],cycle?:{startsAt:string;endsAt:string}) {
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localTime))throw Error('请选择完整的北京时间。');
  const instant=calendarInstant(localTime,'Asia/Shanghai').toISOString(),day=beijingDay(instant);
  if(Date.parse(instant)<=Date.now())throw Error('发布时间必须晚于当前时间。');
  if(row.weekly?.origin==='weekly_plan'&&cycle&&(day<cycle.startsAt.slice(0,10)||day>cycle.endsAt.slice(0,10)))throw Error(`周任务发布时间必须在 ${cycle.startsAt.slice(0,10)} 至 ${cycle.endsAt.slice(0,10)}。`);
  const deliverBy=row.weekly?.contentPlan?.deliverBy||row.summary?.brief.dueAt||'';
  if(deliverBy&&Number.isFinite(Date.parse(deliverBy))&&Date.parse(instant)<Date.parse(deliverBy))throw Error('新发布时间早于原定成片交付时间，请先调整交付安排。');
  const sameAccount=rows.filter(other=>other.key!==row.key&&other.weekly?.accountId&&other.weekly.accountId===row.weekly?.accountId&&other.publishAt&&beijingDay(other.publishAt.length===10?`${other.publishAt}T00:00:00+08:00`:other.publishAt)===day);
  return {instant,day,deliverBy,sameAccount};
}

export function assistantTaskScheduleChanges(target:Extract<AssistantScheduleTarget,{kind:'task'}>,instant:string) {
  const original=JSON.parse(target.specialRequirements) as Record<string,unknown>;
  return {expectedVersion:target.expectedVersion,changes:{specialRequirements:JSON.stringify({...original,plannedPublishAt:instant})}};
}
