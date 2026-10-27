import { useEffect, useState } from 'react';
import { Alert, Button, Select, Spin } from 'antd';
import type { AssistantCreationPortal } from '../../../shared/contracts/assistantCreationPortal';
import type { SocialContentTaskSummary } from '../../../shared/contracts/socialContentWorkflow';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { digitalEmployeeApi } from '../../lib/digitalEmployeeApi';
import { socialContentApi } from '../../lib/socialContentApi';
import { openContentGenerationQueue } from '../../lib/contentGenerationQueue';
import { beijingDay, calendarWeek, shiftCalendarDay } from '../../lib/assistantScheduleProjection';
import { creationTaskCalendar, creationTaskRows, type CreationTaskRow } from '../../lib/creationTaskWorkspace';
import { useAssistantScenePortal } from './useAssistantScenePortal';
import { productionPortalNavigation } from './AssistantProductionPortal';
import { ASSISTANT_HOME_PROMPT_EVENT } from './useAssistantHomeAnchor';
import AssistantScheduleChange from './AssistantScheduleChange';

/** Same task/calendar projection as the content creation portal, with authenticated complete pagination. */
export default function AssistantScheduleScene({portal}:{portal:AssistantCreationPortal}) {
  const {current,update,navigate}=useAssistantScenePortal(portal);
  const [data,setData]=useState<DigitalEmployeeOverview|null>(null),[tasks,setTasks]=useState<SocialContentTaskSummary[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const [platformFilter,setPlatformFilter]=useState(''),[accountFilter,setAccountFilter]=useState('');
  const date=portal.calendarDate||beijingDay(),goalId=portal.calendarGoalId||'';
  useEffect(()=>{
    let active=true;setLoading(true);setError('');
    const read=async()=>{
      const [overview,first]=await Promise.all([digitalEmployeeApi.overview(goalId),socialContentApi.listTasks(1,100)]);
      let all=first.items;
      for(let page=2;page<=first.totalPages;page++) { const next=await socialContentApi.listTasks(page,100);all=[...all,...next.items]; }
      if(active&&current()){setData(overview);setTasks(all);}
    };
    void read().catch(cause=>{if(active&&current())setError(cause instanceof Error?cause.message:'日历读取失败，请重试。');}).finally(()=>{if(active&&current())setLoading(false);});
    return()=>{active=false;};
  },[goalId,revision]);
  const week=calendarWeek(date);
  const rows=data?creationTaskRows(tasks,data.contentQueue?.sourceStatus==='available'?data.contentQueue.items:[]):[];
  const platformOf=(row:CreationTaskRow)=>row.weekly?.platform||row.summary?.brief.platforms?.[0]||'';
  const accountOf=(row:CreationTaskRow)=>row.weekly?.accountId||row.summary?.brief.targetAccountRef?.id||'';
  const platforms=[...new Set(rows.map(platformOf).filter(Boolean))].sort();
  const accounts=[...new Set(rows.map(accountOf).filter(Boolean))].sort();
  const visibleRows=rows.filter(row=>(!platformFilter||platformOf(row)===platformFilter)&&(!accountFilter||accountOf(row)===accountFilter));
  const allEvents=creationTaskCalendar(visibleRows);
  const events=allEvents.filter(event=>{const day=beijingDay(event.start.length===10?`${event.start}T00:00:00+08:00`:event.start);return day>=week.start&&day<=week.end;});
  const undated=visibleRows.filter(row=>!row.publishAt||!allEvents.some(event=>event.id===row.key));
  const openTask=(row:CreationTaskRow)=>{if(row.taskId)navigate(productionPortalNavigation(row.taskId));};
  return <section aria-label="本周发布日历查询" className="mt-3 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{week.start} 至 {week.end}（北京时间）</strong>
      <div className="flex gap-1"><Button disabled={loading} onClick={()=>update({calendarDate:shiftCalendarDay(date,-7)})}>上一周</Button><Button disabled={loading} onClick={()=>update({calendarDate:shiftCalendarDay(date,7)})}>下一周</Button></div></div>
    {!!data?.goals.length&&<Select aria-label="经营周期" className="w-full" value={goalId||data.goal?.id} options={data.goals.map(goal=>({value:goal.id,label:`${goal.title} · ${goal.startsAt.slice(0,10)} 至 ${goal.endsAt.slice(0,10)}`}))} onChange={calendarGoalId=>update({calendarGoalId})}/>}
    {!!rows.length&&<div className="grid gap-2 sm:grid-cols-2"><Select aria-label="筛选发布平台" allowClear placeholder="全部平台" value={platformFilter||undefined} options={platforms.map(value=>({value,label:value}))} onChange={value=>setPlatformFilter(value||'')}/>
      <Select aria-label="筛选发布账号" allowClear placeholder="全部账号" value={accountFilter||undefined} options={accounts.map(value=>({value,label:rows.find(row=>accountOf(row)===value)?.weekly?.accountLabel||value}))} onChange={value=>setAccountFilter(value||'')}/></div>}
    {loading&&<Spin size="small"/>}
    {error&&<Alert type="warning" title={error} action={<Button onClick={()=>setRevision(v=>v+1)}>重试查询</Button>}/>}
    {data?.contentQueue?.sourceStatus!=='available'&&data?.contentQueue&&<Alert type="warning" title={data.contentQueue.sourceNote||'周任务包暂时不可用，已读取的独立内容任务仍可查看。'}/>}
    {!loading&&data&&<>
      {events.length?events.map(event=>{
        const row=event.data as CreationTaskRow;
        return <div key={event.id} className="flex items-center justify-between gap-2 border-b border-border py-2">
          <div className="min-w-0"><p className="text-xs text-text-secondary">{event.allDay?`${event.start} · 时刻待定`:new Date(event.start).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</p>
            <p className="truncate text-sm">{event.title}</p><p className="text-xs text-text-secondary">{platformOf(row)||'平台待确认'} · {row.weekly?.accountLabel||accountOf(row)||'账号待确认'} · {event.statusLabel}</p></div>
          <div className="flex shrink-0 gap-2"><AssistantScheduleChange row={row} rows={rows} goal={data.goal} onChanged={()=>setRevision(v=>v+1)}/><Button disabled={!row.taskId} onClick={()=>openTask(row)}>查看详情</Button></div>
        </div>;
      }):<p className="text-sm text-text-secondary">这一周暂无已排定的发布内容。</p>}
      {!!undated.length&&<div><p className="text-sm font-semibold">发布时间待定 · {undated.length} 条</p>{undated.map(row=><div key={row.key} className="flex items-center justify-between py-1"><span className="truncate text-xs">{row.title}</span><Button disabled={!row.taskId} onClick={()=>openTask(row)}>查看详情</Button></div>)}</div>}
      <p className="text-xs text-text-secondary">这里展示计划发布时间。成片完成、实际发布及平台回执分别以原任务详情和发布记录为准。</p>
      <div className="flex justify-end gap-2">{!events.length&&<Button onClick={()=>{if(current())window.dispatchEvent(new CustomEvent(ASSISTANT_HOME_PROMPT_EVENT,{detail:{prompt:'我想为一次活动准备内容，请帮我确认活动素材、产品优惠、对标视频和口播。',mode:'replace'}}));}}>安排本周内容</Button>}
        <Button onClick={()=>openContentGenerationQueue({view:'calendar'})}>打开内容生成队列</Button><Button onClick={()=>setRevision(v=>v+1)}>刷新</Button></div>
    </>}
  </section>;
}
