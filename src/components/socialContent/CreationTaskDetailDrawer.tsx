import { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Drawer, Empty, Skeleton, Tag, Timeline } from 'antd';
import type { SocialContentTaskDetail } from '../../../shared/contracts/socialContentWorkflow';
import { projectContentProductionTaskCard } from '../../../shared/contracts/assistantContentTaskCard';
import type { DigitalEmployeeOverview } from '../../lib/digitalEmployees';
import type { CreationTaskRow } from '../../lib/creationTaskWorkspace';
import { creationTaskState, creationTaskDetailSource } from '../../lib/creationTaskWorkspace';
import { socialContentApi } from '../../lib/socialContentApi';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import { contentShotProgress } from '../../lib/contentProductionExperience';
import { creationProductionNodes } from '../../lib/creationProductionNodes';
import WeeklyContentProgressPanel from '../smartBusiness/WeeklyContentProgressPanel';
import { SocialDirectorG5ReviewPanel } from './SocialDirectorG5ReviewPanel';
import { SocialSceneG4ReviewPanel } from './SocialSceneG4ReviewPanel';
import { PresenterFirstFrameReviewPanel } from './PresenterFirstFrameReviewPanel';
import CreationTaskArtifacts from './CreationTaskArtifacts';
import ImageCreationTaskExecution from './ImageCreationTaskExecution';

export const creationLocalTime = (value: string) => value.length===10 ? `${value} · 时刻待定`
  : Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '待安排';

export default function CreationTaskDetailDrawer({ row, overview, onClose, onUpdated, onRecover }:{
  row:CreationTaskRow|null;overview:DigitalEmployeeOverview;onClose:()=>void;onUpdated:()=>void;onRecover?:()=>void;
}) {
  const [loadedTask,setTask]=useState<SocialContentTaskDetail|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0);
  const task=loadedTask?.taskId===row?.taskId?loadedTask:null;
  useEffect(()=>{setTask(null);},[row?.key]);
  useEffect(()=>{
    setError('');
    if(!row?.taskId||row.readError)return;
    const taskId=row.taskId,controller=new AbortController(),identity=productionNavigationIdentity();let active=true,inFlight=false;
    const read=async()=>{
      if(inFlight)return;inFlight=true;setLoading(true);
      try{const result=await socialContentApi.getTask(taskId,controller.signal);if(result.taskId!==taskId)throw Error('任务详情与当前选择不一致。');if(active&&identity===productionNavigationIdentity()){setTask(result);setError('');}}
      catch(cause){if(active&&!controller.signal.aborted&&identity===productionNavigationIdentity())setError(cause instanceof Error?cause.message:'任务详情读取失败');}
      finally{inFlight=false;if(active)setLoading(false);}
    };
    void read();const timer=setInterval(()=>{if(document.visibilityState==='visible')void read();},5000);
    return()=>{active=false;controller.abort();clearInterval(timer);};
  },[row?.key,revision]);
  const refresh=()=>{setRevision(v=>v+1);onUpdated();};
  const state=task?creationTaskState(task):row;
  const card=task?.runId?projectContentProductionTaskCard(task):null;
  const nodes=task?creationProductionNodes(task):[];
  const shots=task?.runId?contentShotProgress(task):[];
  const detailSource=creationTaskDetailSource(row,task);
  return <Drawer title="创作任务详情" open={Boolean(row)} onClose={onClose} size={500} styles={{wrapper:{maxWidth:'100vw'}}} extra={<Button loading={loading} onClick={refresh}>刷新进展</Button>}>
    {row&&<div className="space-y-5">
      <div><h2 className="text-lg font-semibold text-text-primary">{task?.brief.title||row.title}</h2><Tag className="mt-2" color={state?.category==='confirmation'?'warning':state?.category==='completed'?'success':'processing'}>{state?.statusLabel}</Tag></div>
      <Descriptions column={1} size="small" items={[
        {key:'source',label:'创建来源',children:row.sourceLabel},{key:'product',label:'产品',children:row.product||'待补充'},
        {key:'date',label:'预计发布（北京时间）',children:creationLocalTime(row.publishAt)},
      ]}/>
      {error&&<Alert showIcon type="warning" title={task?'最新进展暂未更新':'任务详情暂时无法读取'} description={task?'以下保留上次成功读取的进度。':'请重试查询，当前无法判断最新执行状态。'} action={<Button onClick={refresh}>重试查询</Button>}/>}
      {row.readError&&<Alert type="warning" showIcon title="历史任务资料需要核对" description="缺少可核验的制作记录，不能恢复原制作进展。可补充产品、创作方向与预计发布时间，另建一条计划；原记录继续保留。" action={onRecover && <Button onClick={onRecover}>补充资料，新建计划</Button>}/>}
      {loading&&!task&&row.taskId?<Skeleton active/>:task?<>
        {card&&state?.category==='confirmation'&&<Alert type="warning" showIcon title="待确认项" description={<ul className="space-y-2">{card.blockingItems.length?card.blockingItems.map(item=><li key={item.key}>{item.value}</li>):<li>{card.currentNode.userFacingSummary}</li>}</ul>}/>}
        {task.brief.formats.includes('social_image') ? <ImageCreationTaskExecution contentTaskId={task.taskId}/> : <section aria-label="执行节点进度"><h3 className="mb-4 text-base font-semibold">制作进度</h3>
          <Timeline mode="start" titleSpan={0} items={nodes.map(node=>({content:<><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{node.label}</p><Tag color={node.state==='complete'?'success':node.state==='failed'||node.state==='blocked'?'warning':node.state==='active'?'processing':'default'}>{node.state==='complete'?'已完成':node.state==='active'?'进行中':node.state==='failed'||node.state==='blocked'?'待介入':'待执行'}</Tag></div><p className="mt-1 text-xs text-text-secondary">{node.owner} · {node.result}</p></>,color:node.state==='complete'?'green':node.state==='failed'||node.state==='blocked'?'red':node.state==='active'?'blue':'gray'}))}/>
        </section>}
        {shots.length>0&&<section aria-label="逐镜制作结果"><h3 className="mb-3 font-semibold">逐镜进度</h3><ol className="divide-y divide-border">{shots.map(shot=><li key={shot.sceneId} className="space-y-1 py-3"><p className="text-sm font-semibold">镜头 {shot.order} · {shot.detail}</p><p className="text-xs text-text-secondary">{shot.speech}</p>{shot.previewUrl&&shot.previewMediaType==='video'&&<video controls preload="none" src={shot.previewUrl} aria-label={`镜头 ${shot.order} 预览`} className="max-h-60 w-full"/>}{shot.previewUrl&&shot.previewMediaType==='image'&&<img src={shot.previewUrl} alt={`镜头 ${shot.order}`} className="max-h-60 w-full object-contain"/>}</li>)}</ol></section>}
        {task.runId&&<><PresenterFirstFrameReviewPanel taskId={task.taskId} runId={task.runId}/>{task.artifacts.some(a=>a.kind==='short_video'&&a.origin==='agent')&&<><SocialSceneG4ReviewPanel task={task} onChanged={refresh}/><SocialDirectorG5ReviewPanel task={task} onChanged={refresh}/></>}</>}
        {task.artifacts.length>0&&<CreationTaskArtifacts task={task} onChanged={refresh}/>}
      </>:detailSource==='weekly'?<WeeklyContentProgressPanel data={overview} contentId={row.contentId!} onRefresh={onUpdated}/>:!row.readError&&!error?<Empty description="暂未取得制作回执"/>:null}
    </div>}
  </Drawer>;
}
