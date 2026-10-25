import { z } from 'zod';
import type { SocialContentTaskSummary, SocialContentTaskPage } from '../../shared/contracts/socialContentWorkflow';
import { projectContentProductionTaskCard } from '../../shared/contracts/assistantContentTaskCard';
import type { ContentQueueItem } from './digitalEmployees';
import type { LsCalendarEvent } from './calendarModel';

const intakeSchema = z.object({
  source: z.enum(['assistant_replication_confirmation', 'assistant_scene_confirmation']),
  channel: z.literal('workspace_form').optional(),
  plannedPublishAt: z.string().optional(), referenceId: z.string().optional(),
  products: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
});
export function creationTaskIntake(task: SocialContentTaskSummary) {
  try { const parsed = intakeSchema.safeParse(JSON.parse(task.brief.specialRequirements || '{}')); return parsed.success ? parsed.data : null; }
  catch { return null; }
}
export type CreationTaskCategory = 'completed' | 'creating' | 'confirmation';
export interface CreationTaskProduct {id:string;name:string;imageUrls?:string[]}
export interface CreationTaskRow {
  key: string; taskId?: string; contentId?: string; title: string; cover: string;
  category: CreationTaskCategory; statusLabel: string; sourceLabel: string;
  product: string; publishAt: string; createdAt: string; updatedAt: string;
  summary?: SocialContentTaskSummary; weekly?: ContentQueueItem;
  productImages?: string[];
  readError?: string;
}
/** An exact task detail read must never fall back to a different weekly progress source. */
export function creationTaskDetailSource(row:CreationTaskRow|null,task:{taskId:string}|null):'task'|'weekly'|'unavailable' {
  if(!row||row.readError)return 'unavailable';
  if(row.taskId)return task?.taskId===row.taskId?'task':'unavailable';
  return row.contentId?'weekly':'unavailable';
}
export function creationTaskState(task: SocialContentTaskSummary): Pick<CreationTaskRow, 'category' | 'statusLabel'> {
  if (task.status === 'cancelled' || task.status === 'cancelling') return {category:'creating',statusLabel:'已取消'};
  if (['delivered','reviewed','awaiting_publish','awaiting_metrics'].includes(task.status)) return {category:'completed',statusLabel:'已完成'};
  if (task.executionAdmission?.state === 'blocked') return {category:'confirmation',statusLabel:'待介入'};
  if (!task.runId && task.executionAdmission?.state === 'preparing') return {category:'creating',statusLabel:'准备中'};
  if (!task.runId && task.executionAdmission?.state === 'queued') return {category:'creating',statusLabel:'已入队'};
  // Confirmation of the intake is not a production run or a failed preflight.
  if (!task.runId && creationTaskIntake(task)) return {category:'creating',statusLabel:'待调度'};
  const card = projectContentProductionTaskCard(task);
  if (['needs_input','needs_approval','paused','failed'].includes(card.overallState) || card.blockingItems.length) return {category:'confirmation',statusLabel:'待确认'};
  if (card.overallState === 'completed') return {category:'completed',statusLabel:'已完成'};
  return {category:'creating',statusLabel:task.runId ? '创作中' : '待调度'};
}
export function creationTaskRows(tasks: SocialContentTaskSummary[], weekly: ContentQueueItem[],products:CreationTaskProduct[]=[],unavailable:NonNullable<SocialContentTaskPage['unavailableItems']>=[]): CreationTaskRow[] {
  const rows = new Map<string, CreationTaskRow>();
  for (const item of weekly) {
    const taskId = item.socialContentTaskId || undefined, key = taskId ? `task:${taskId}` : `weekly:${item.contentId || item.id}`;
    rows.set(key, {key,taskId,contentId:item.contentId,title:item.title,
      cover:'',
      category:['blocked','waiting_review'].includes(item.status)?'confirmation':item.status==='completed'?'completed':'creating',
      statusLabel:['blocked','waiting_review'].includes(item.status)?'待确认':item.status==='completed'?'已完成':item.status==='producing'?'创作中':'待调度',
      sourceLabel:item.origin==='weekly_plan'?'周任务包':'手动创建',product:item.productName,
      publishAt:item.contentPlan?.publishAt || item.plannedPublishDate || '',createdAt:item.updatedAt,updatedAt:item.updatedAt,weekly:item});
  }
  for (const task of tasks) {
    const key = `task:${task.taskId}`, old = rows.get(key), intake = creationTaskIntake(task);
    const state = creationTaskState(task);
    rows.set(key, {...old,key,taskId:task.taskId,title:task.brief.title,cover:task.preview?.coverUrl || '',
      ...state,sourceLabel:task.mode==='weekly'||task.contentOrder?.entry==='weekly_package'||old?.weekly?.origin==='weekly_plan'?'周任务包':intake?.channel==='workspace_form'?'手动创建':intake?'对话创建':old?.sourceLabel||'手动创建',
      product:intake?.products?.map(p=>p.name).join('、') || task.brief.productRef || old?.product || '',
      publishAt:intake?.plannedPublishAt || old?.publishAt || '',createdAt:task.createdAt,updatedAt:task.updatedAt,summary:task});
  }
  for(const item of unavailable){const key=`task:${item.taskId}`;if(!rows.has(key))rows.set(key,{key,taskId:item.taskId,title:item.title,cover:'',category:'confirmation',statusLabel:'待确认',sourceLabel:'历史任务',product:'',publishAt:'',createdAt:item.createdAt||'',updatedAt:item.createdAt||'',readError:item.errorCode});}
  return [...rows.values()].map(row=>{
    const intake=row.summary?creationTaskIntake(row.summary):null;
    const ids=intake?.products?.map(p=>p.id)||(row.summary?.brief.productId?[row.summary.brief.productId]:[]);
    const legacy=row.summary?.brief.productRef||row.weekly?.productName||'';
    const selected=ids.length?ids.flatMap(id=>products.filter(product=>product.id===id)):products.filter(product=>product.name===legacy||product.id===legacy||`product:${product.id}`===legacy);
    const images=[...new Set(selected.flatMap(product=>product.imageUrls||[]))];
    return {...row,productImages:images,cover:row.cover||images[0]||''};
  }).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.key.localeCompare(b.key));
}
export function creationTaskCalendar(rows: CreationTaskRow[]): LsCalendarEvent[] {
  return rows.flatMap(row=>{
    const raw=row.publishAt;
    if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw) || !Number.isFinite(Date.parse(raw))) return [];
    const allDay=raw.length===10;
    const start=!allDay&&!/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)?`${raw}+08:00`:raw;
    return [{id:row.key,title:row.title,start,allDay,timeZone:'Asia/Shanghai',editable:false,eventType:'publish' as const,
      status:row.category==='confirmation'?'needs_action' as const:'planned' as const,
      statusLabel:row.category==='completed'?'成片已完成，发布待核验':row.statusLabel,
      thumbnailUrl:row.cover,description:allDay?'时刻待定':row.product,data:row}];
  });
}
