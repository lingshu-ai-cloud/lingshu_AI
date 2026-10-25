import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Segmented, Table, Tag } from 'antd';
import type { SocialContentTaskSummary, SocialContentTaskPage } from '../../../shared/contracts/socialContentWorkflow';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import { AUTH_TOKEN_CHANGED_EVENT } from '../../lib/auth';
import { socialContentApi, SocialContentRequestError } from '../../lib/socialContentApi';
import { SOCIAL_CONTENT_TASK_REFRESH_EVENT } from '../../lib/socialContentTaskRefresh';
import { SOCIAL_CONTENT_NAVIGATION_EVENT, readSocialContentNavigationQueryTaskId, readSocialContentNavigationTaskId } from '../../lib/socialContentContext';
import { productionNavigationIdentity, stampProductionHistoryState } from '../../lib/productionNavigation';
import { creationTaskCalendar, creationTaskRows, type CreationTaskCategory, type CreationTaskRow, type CreationTaskProduct } from '../../lib/creationTaskWorkspace';
import { studioApi } from '../../lib/studioApi';
import CreationTaskCover from './CreationTaskCover';
import { LsCalendar } from '../ui/LsCalendar';
import CreationTaskDetailDrawer, { creationLocalTime } from './CreationTaskDetailDrawer';

const selectedTask = () => readSocialContentNavigationQueryTaskId('socialInspiration',window.location.search)
  || readSocialContentNavigationTaskId('socialInspiration',window.history.state);

export default function CreationTaskWorkspace({ data, onRefresh, embeddedCalendar = false }:{data:DigitalEmployeeOverview;onRefresh:()=>void;embeddedCalendar?:boolean}) {
  const [tasks,setTasks]=useState<SocialContentTaskSummary[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const [view,setView]=useState<'calendar'|'tasks'>(()=>!embeddedCalendar&&(selectedTask()||new URLSearchParams(window.location.search).get('view')==='tasks')?'tasks':'calendar');
  const [filter,setFilter]=useState<CreationTaskCategory|'all'>('all'),[taskId,setTaskId]=useState<string|null>(()=>embeddedCalendar?null:selectedTask()),[rowKey,setRowKey]=useState<string|null>(null);
  const [exact,setExact]=useState<SocialContentTaskSummary|null>(null),[identity,setIdentity]=useState(productionNavigationIdentity);
  const loadedIdentity=useRef(identity);
  const reading=useRef(false),readGeneration=useRef(0);
  const [products,setProducts]=useState<CreationTaskProduct[]>([]);
  const [unavailable,setUnavailable]=useState<NonNullable<SocialContentTaskPage['unavailableItems']>>([]);
  const refresh=()=>{setRevision(v=>v+1);onRefresh();};
  useEffect(()=>{
    const navigation=()=>{if(embeddedCalendar)return;const target=selectedTask();setTaskId(target);setRowKey(null);if(target){setView('tasks');setFilter('all');}};
    const reset=()=>{setTasks([]);setUnavailable([]);setProducts([]);setExact(null);setTaskId(null);setRowKey(null);setIdentity(productionNavigationIdentity());setRevision(v=>v+1);};
    const changed=()=>setRevision(v=>v+1);
    window.addEventListener(SOCIAL_CONTENT_NAVIGATION_EVENT,navigation);window.addEventListener('popstate',navigation);
    const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!reading.current)changed();},12000);
    const storage=(event:StorageEvent)=>{if(event.key===null||event.key==='overseas_token')reset();};
    window.addEventListener('storage',storage);window.addEventListener(AUTH_TOKEN_CHANGED_EVENT,reset);window.addEventListener(SOCIAL_CONTENT_TASK_REFRESH_EVENT,changed);
    return()=>{clearInterval(timer);window.removeEventListener('storage',storage);window.removeEventListener(SOCIAL_CONTENT_NAVIGATION_EVENT,navigation);window.removeEventListener('popstate',navigation);window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT,reset);window.removeEventListener(SOCIAL_CONTENT_TASK_REFRESH_EVENT,changed);};
  },[embeddedCalendar]);
  useEffect(()=>{let active=true;void studioApi.materialProducts().then(result=>{if(active&&identity===productionNavigationIdentity())setProducts(result.items);}).catch(()=>{if(active)setError('产品照片暂时未能读取，可点击刷新重试。');});return()=>{active=false;};},[identity,revision]);
  useEffect(()=>{
    let active=true;const generation=++readGeneration.current;reading.current=true;setLoading(true);setError('');
    const read=async()=>{
      // Fetch every page: filtering and calendar must cover the same complete set.
      const first=await socialContentApi.listTasks(1,100);let items=first.items,issues=first.unavailableItems||[];
      for(let page=2;page<=first.totalPages;page++){const next=await socialContentApi.listTasks(page,100);items=[...items,...next.items];issues=[...issues,...(next.unavailableItems||[])];}
      if(active&&identity===productionNavigationIdentity()){setTasks(items);setUnavailable(issues);loadedIdentity.current=identity;}
    };
    void read().catch(cause=>{if(active&&identity===productionNavigationIdentity()){console.warn('[creation-task-list-read]',cause instanceof SocialContentRequestError?cause.code:'invalid_response');setError(cause instanceof Error?cause.message:'创作任务读取失败');}}).finally(()=>{if(generation===readGeneration.current)reading.current=false;if(active)setLoading(false);});
    return()=>{active=false;};
  },[revision,identity]);
  useEffect(()=>{
    setExact(null);if(!taskId)return;
    const controller=new AbortController();let active=true;
    void socialContentApi.getTask(taskId,controller.signal).then(task=>{if(task.taskId!==taskId)throw Error('任务身份不一致');if(active&&identity===productionNavigationIdentity())setExact(task);}).catch(cause=>{if(active&&!controller.signal.aborted)setError(cause instanceof Error?cause.message:'任务读取失败');});
    return()=>{active=false;controller.abort();};
  },[taskId,identity]);
  const rows=useMemo(()=>creationTaskRows(loadedIdentity.current===identity?[...tasks,...(exact&&!tasks.some(t=>t.taskId===exact.taskId)?[exact]:[])]:[],(data.contentQueue?.items||[]).filter(item=>item.origin==='weekly_plan'||tasks.some(task=>task.taskId===item.socialContentTaskId)||item.socialContentTaskId===exact?.taskId),products,unavailable),[tasks,exact,data,identity,products,unavailable]);
  const events=useMemo(()=>creationTaskCalendar(rows),[rows]);
  const selected=rows.find(row=>taskId?row.taskId===taskId:row.key===rowKey)||null;
  const updateLocation=(next:'calendar'|'tasks',row?:CreationTaskRow)=>{
    if(embeddedCalendar)return;
    const url=new URL(window.location.href);url.searchParams.set('view',next);url.searchParams.delete('taskId');
    if(row?.taskId)url.searchParams.set('socialContentTaskId',row.taskId);else url.searchParams.delete('socialContentTaskId');
    const state={...window.history.state};delete state.socialContentTaskId;delete state.socialContentPage;
    const detail={...state.productionDetail};delete detail.socialContentTaskId;delete detail.socialContentPage;
    window.history.replaceState(stampProductionHistoryState({...state,productionDetail:{...detail,page:'socialInspiration',view:next,...(row?.taskId?{socialContentTaskId:row.taskId,socialContentPage:'socialInspiration'}:{})}}),'',url);
  };
  const open=(row:CreationTaskRow)=>{setTaskId(row.taskId||null);setRowKey(row.key);updateLocation(view,row);};
  const close=()=>{setTaskId(null);setRowKey(null);updateLocation(view);};
  return <section aria-label="内容创作工作区" className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
      {embeddedCalendar?<h3 className="text-sm font-semibold">内容发布排期</h3>:<Segmented<'calendar'|'tasks'> aria-label="内容创作视图" value={view} options={[{label:'发布日历',value:'calendar'},{label:'创作任务',value:'tasks'}]} onChange={value=>{setView(value);updateLocation(value,selected||undefined);}}/>}
      <div className="flex items-center gap-3"><Tag>{rows.length} 条任务</Tag><Button loading={loading} onClick={refresh}>刷新</Button></div>
    </header>
    {error&&<Alert className="m-4" type="warning" showIcon title={error}/>}
    {data.contentQueue?.sourceStatus!=='available'&&<Alert className="m-4" type="warning" title={data.contentQueue?.sourceNote||'周任务包暂时不可用，以下保留已读取的内容任务。'}/>}
    {view==='tasks'?<>
      <div className="px-5 py-4"><Segmented aria-label="创作任务状态筛选" value={filter} options={[{label:'全部',value:'all'},{label:'已完成',value:'completed'},{label:'创作中',value:'creating'},{label:'待确认',value:'confirmation'}]} onChange={setFilter}/></div>
      <Table<CreationTaskRow> rowKey="key" loading={loading} onRow={row=>({onClick:()=>open(row),style:{cursor:'pointer'}})} dataSource={rows.filter(row=>filter==='all'||row.category===filter)} size="middle" scroll={{x:960}} pagination={{defaultPageSize:20,showSizeChanger:true,showTotal:total=>`共 ${total} 条`}} columns={[
        {title:'视频封面',key:'cover',width:106,render:(_,row)=><button aria-label={`查看任务：${row.title}`} onClick={()=>open(row)} className="flex h-16 w-20 items-center justify-center overflow-hidden rounded-md bg-surface-2 text-text-muted"><CreationTaskCover key={row.cover} row={row}/></button>},
        {title:'创作任务',key:'title',width:280,render:(_,row)=><button className="text-left font-semibold text-text-primary hover:text-accent" onClick={()=>open(row)}>{row.title}</button>},
        {title:'状态',key:'status',width:110,render:(_,row)=><Tag color={row.category==='confirmation'?'warning':row.category==='completed'?'success':'processing'}>{row.statusLabel}</Tag>},
        {title:'产品',dataIndex:'product',width:180,render:value=>value||'待补充'},
        {title:'预计发布（北京时间）',key:'publish',width:200,render:(_,row)=>creationLocalTime(row.publishAt)},
        {title:'来源',dataIndex:'sourceLabel',width:110},
        {title:'创建时间',key:'created',width:180,render:(_,row)=>creationLocalTime(row.createdAt)},
      ]}/>
    </>:<>
      <LsCalendar label="发布日历" events={events} initialView="timeGridWeek" initialDate={data.goal?.startsAt?.slice(0,10)} timeZone="Asia/Shanghai" showAllEvents fixedHeight="auto" workspaceMode="expanded" onEventClick={event=>{const row=rows.find(item=>item.key===event.id);if(row)open(row);return true;}}/>
      {rows.length>events.length&&<p className="px-5 py-3 text-xs text-text-muted">{rows.length-events.length} 条任务尚未安排发布时间，可在创作任务中查看。</p>}
      {!rows.length&&!loading&&<Empty description="暂无创作任务"/>}
    </>}
    <CreationTaskDetailDrawer key={`${identity}:${selected?.key||''}`} row={selected} overview={data} onClose={close} onUpdated={refresh}/>
  </section>;
}

