import { useEffect, useState } from 'react';
import { Alert, Button, Drawer, Select, Spin } from 'antd';
import type { AssistantCreationPortal } from '../../../shared/contracts/assistantCreationPortal';
import type { ContentQueueItem, DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { digitalEmployeeApi } from '../../lib/digitalEmployeeApi';
import { assistantScheduleProjection, beijingDay, shiftCalendarDay } from '../../lib/assistantScheduleProjection';
import { useAssistantScenePortal } from './useAssistantScenePortal';
import { LsCalendar } from '../ui/LsCalendar';
import { productionPortalNavigation } from './AssistantProductionPortal';
import { ASSISTANT_HOME_PROMPT_EVENT } from './useAssistantHomeAnchor';
export default function AssistantScheduleScene({portal}:{portal:AssistantCreationPortal}) {
  const {current,update,navigate}=useAssistantScenePortal(portal);
  const [data,setData]=useState<DigitalEmployeeOverview|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0),[open,setOpen]=useState(false);
  const date=portal.calendarDate||beijingDay(),goalId=portal.calendarGoalId||'';
  useEffect(()=>{
    let active=true;setLoading(true);setError('');setData(null);
    void digitalEmployeeApi.overview(goalId).then(result=>{if(active&&current()){assistantScheduleProjection(result,date);setData(result);}})
      .catch(cause=>{if(active&&current())setError(cause instanceof Error?cause.message:'日历读取失败');}).finally(()=>{if(active&&current())setLoading(false);});
    return()=>{active=false;};
  },[goalId,revision]);
  const projection=data?assistantScheduleProjection(data,date):null;
  const openTask=(item:ContentQueueItem)=>{if(item.socialContentTaskId)navigate(productionPortalNavigation(item.socialContentTaskId));};
  return <section aria-label="本周发布日历查询" className="mt-3 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{projection?`${projection.week.start} 至 ${projection.week.end}`:'本周发布日历'}（北京时间）</strong>
      <div className="flex gap-1"><Button disabled={loading} onClick={()=>update({calendarDate:shiftCalendarDay(date,-7)})}>上一周</Button><Button disabled={loading} onClick={()=>update({calendarDate:shiftCalendarDay(date,7)})}>下一周</Button></div></div>
    {!!data?.goals.length&&<Select aria-label="经营周期" className="w-full" value={goalId||data.goal?.id} options={data.goals.map(goal=>({value:goal.id,label:`${goal.title} · ${goal.startsAt.slice(0,10)} 至 ${goal.endsAt.slice(0,10)}`}))} onChange={calendarGoalId=>update({calendarGoalId})}/>}
    {loading&&<Spin size="small"/>}
    {error&&<Alert type="warning" title={error} action={<Button onClick={()=>setRevision(v=>v+1)}>重试查询</Button>}/>}
    {projection&&!loading&&<>
      {projection.events.length?projection.events.map(event=>{
        const item=event.data as ContentQueueItem;
        return <div key={event.id} className="flex items-center justify-between gap-2 border-b border-border py-2">
          <div className="min-w-0"><p className="text-xs text-text-secondary">{event.allDay?`${event.start} · 时刻待定`:new Date(event.start).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</p>
            <p className="truncate text-sm">{event.title}</p><p className="text-xs text-text-secondary">{event.platform} · {event.accountName||'账号待确认'} · {event.statusLabel}</p></div>
          <Button disabled={!item.socialContentTaskId} onClick={()=>openTask(item)}>查看详情</Button>
        </div>;
      }):<p className="text-sm text-text-secondary">这一周暂无已排定的发布内容。</p>}
      {!!projection.undated.length&&<div><p className="text-sm font-semibold">发布时间待定 · {projection.undated.length} 条</p>{projection.undated.map(item=><div key={item.id} className="flex items-center justify-between py-1"><span className="truncate text-xs">{item.title}</span><Button disabled={!item.socialContentTaskId} onClick={()=>openTask(item)}>查看详情</Button></div>)}</div>}
      <p className="text-xs text-text-secondary">当前显示内容任务的计划安排；成片完成不代表已发布，实际发布结果以平台回执为准。</p>
      <div className="flex justify-end gap-2">{!projection.events.length&&<Button onClick={()=>{if(current())window.dispatchEvent(new CustomEvent(ASSISTANT_HOME_PROMPT_EVENT,{detail:{prompt:'我想为一次活动准备内容，请帮我确认主题、产品和发布节奏，并安排进周任务包。',mode:'replace'}}));}}>安排本周内容</Button>}<Button onClick={()=>setOpen(true)}>查看完整日历</Button><Button onClick={()=>setRevision(v=>v+1)}>刷新</Button></div>
    </>}
    <Drawer title="发布日历（只读）" open={open} onClose={()=>setOpen(false)} size="large">
      {projection&&<LsCalendar label="完整发布日历" events={projection.events} date={projection.week.start} initialView="dayGridWeek" firstDay={1} timeZone="Asia/Shanghai" dateOnly showAllEvents detailsTitle="发布安排"
        onDatesSet={info=>{const next=info.startStr.slice(0,10);if(next!==projection.week.start)update({calendarDate:next});}}
        renderDetails={event=><div className="space-y-3"><p>{event.title}</p><p>{event.description}</p><Button disabled={!(event.data as ContentQueueItem).socialContentTaskId} onClick={()=>openTask(event.data as ContentQueueItem)}>打开本条内容任务</Button></div>}/>}
    </Drawer>
  </section>;
}
