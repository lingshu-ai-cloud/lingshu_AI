import type { ContentQueueItem, DigitalEmployeeOverview } from './digitalEmployees';
import type { LsCalendarEvent } from './calendarModel';
export function beijingDay(value: number | string = Date.now()): string {
  const time=typeof value==='number'?value:Date.parse(value);
  return Number.isFinite(time)?new Date(time+8*3600000).toISOString().slice(0,10):'';
}
export function shiftCalendarDay(day:string,days:number):string {
  return new Date(Date.parse(`${day}T00:00:00Z`)+days*86400000).toISOString().slice(0,10);
}
export function calendarWeek(day=beijingDay()):{start:string;end:string} {
  const weekday=new Date(`${day}T00:00:00Z`).getUTCDay();
  const start=shiftCalendarDay(day,-((weekday+6)%7));return {start,end:shiftCalendarDay(start,6)};
}
export function assistantScheduleProjection(data:DigitalEmployeeOverview,day:string) {
  if(!data.contentQueue||data.contentQueue.sourceStatus!=='available')throw Error(data.contentQueue?.sourceNote||'发布安排来源暂时不可用，请重试。');
  const week=calendarWeek(day),undated:ContentQueueItem[]=[],events:LsCalendarEvent[]=[];
  for(const item of data.contentQueue.items){
    const raw=item.contentPlan?.publishAt||'';
    const exact=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw)?`${raw}+08:00`:raw;
    const hasTime=/T\d{2}:\d{2}/.test(exact)&&Number.isFinite(Date.parse(exact));
    const date=hasTime?beijingDay(exact):(item.plannedPublishDate||exact).slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){undated.push(item);continue;}
    if(date<week.start||date>week.end)continue;
    const statusLabel=item.status==='completed'?'成片已完成，发布待核验':item.status==='blocked'?'待介入':item.status==='waiting_review'?'待验收':item.status==='producing'?'制作中':'待发布';
    events.push({id:item.id,title:item.title,start:hasTime?exact:date,timeZone:'Asia/Shanghai',allDay:!hasTime,editable:false,
      eventType:'publish',status:item.status==='blocked'?'needs_action':'planned',statusLabel,
      platform:item.platform,accountId:item.accountId,accountName:item.accountLabel,
      description:hasTime?statusLabel:`时刻待定 · ${statusLabel}`,data:item});
  }
  events.sort((left,right)=>left.start.localeCompare(right.start));
  return {week,events,undated};
}
