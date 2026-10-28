import { useEffect, useState } from 'react';
import { Alert, Button, Spin, Tag } from 'antd';
import type { SocialImageCreationTask } from '../../../shared/contracts/socialImageCreation';
import type { SocialImageExecutionReceipt } from '../../../shared/contracts/socialImageExecution';
import { socialImageApi } from '../../lib/socialImageApi';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import SocialImageWorkbench from './SocialImageWorkbench';
import ImageReplicationRunSummary from './ImageReplicationRunSummary';

const labels:Record<SocialImageExecutionReceipt['status'],string>={queued:'已入队，等待调度领取',running:'正在制作图文',retry_wait:'等待恢复',reconciling:'供应商回执待核对',blocked:'需要处理',paused:'已暂停',succeeded:'首版制作完成，等待审阅',cancelled:'已取消',dead_letter:'需要处理'};
const stages=[['asset_manifest','核验企业素材'],['adaptation','分析参考图与爆点'],['director_brief','图文策划'],['render_spec','编译制作方案'],['candidate_generation','生成图文首版'],['quality_check','成片质检'],['user_approval','等待用户验收'],['delivery','图文交付']] as const;
const issueLabels:Record<string,string>={
  social_image_budget_required:'本次任务尚未确认费用上限，付费制作没有启动。',
  social_image_paid_execution_disabled:'当前环境尚未开启图文付费制作。',
  social_image_planning_failed:'图文策划没有成功启动，任务和已完成的素材分析均已保留。',
  social_image_planning_outcome_requires_review:'策划服务回执尚未确认，系统不会重复发起付费请求。',
  social_image_quality_requires_review:'首版已生成，正在等待质量复核。',
};

/** Read-only polling survives refresh; only explicit confirmation submits the durable command. */
export default function ImageCreationTaskExecution({contentTaskId}:{contentTaskId:string}) {
  const [task,setTask]=useState<SocialImageCreationTask>();
  const [execution,setExecution]=useState<SocialImageExecutionReceipt|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[details,setDetails]=useState(false),[revision,setRevision]=useState(0);
  useEffect(()=>{
    let active=true,inFlight=false;const identity=productionNavigationIdentity();
    const read=async()=>{if(inFlight)return;inFlight=true;
      try{const result=await socialImageApi.getContentExecution(contentTaskId);
        if(result.task.productionRuntime?.binding?.contentTaskId!==contentTaskId)throw new Error('图片运行与当前内容任务不一致。');
        if(active&&identity===productionNavigationIdentity()){setTask(result.task);setExecution(result.execution);setError('');}}
      catch(cause){if(active&&identity===productionNavigationIdentity())setError(cause instanceof Error?cause.message:'图文进度读取失败');}
      finally{inFlight=false;}};
    void read();const timer=setInterval(()=>{if(document.visibilityState==='visible')void read();},3000);
    return()=>{active=false;clearInterval(timer);};
  },[contentTaskId,revision]);
  const submit=async()=>{if(!task||busy)return;const identity=productionNavigationIdentity();setBusy(true);setError('');
    try{const result=await socialImageApi.enqueueExecution(task);if(identity===productionNavigationIdentity()){setExecution(result.execution);setTask(result.task);}}
    catch(cause){if(identity===productionNavigationIdentity())setError(cause instanceof Error?cause.message:'任务入队失败');}
    finally{if(identity===productionNavigationIdentity())setBusy(false);}};
  const working=Boolean(execution&&['queued','running','retry_wait','reconciling'].includes(execution.status));
  const latestImage=task?.outputs.filter(output=>output.mediaUrl&&output.state!=='superseded').sort((a,b)=>b.version-a.version)[0]?.mediaUrl||'';
  const activeStage=stages.find(([id])=>task?.productionRuntime?.nodes.find(item=>item.nodeId===id)?.status==='running')
    ||stages.find(([id])=>!['completed','skipped'].includes(task?.productionRuntime?.nodes.find(item=>item.nodeId===id)?.status||''));
  const activeNode=activeStage?task?.productionRuntime?.nodes.find(item=>item.nodeId===activeStage[0]):undefined;
  const blocked=Boolean(execution&&['blocked','dead_letter','paused'].includes(execution.status));
  const issue=execution?.lastError?issueLabels[execution.lastError]||'当前步骤未能继续，系统已保留原任务和已完成结果。':'';
  const stageState=working?'正在进行':blocked?'尚未启动':execution?.status==='succeeded'?'等待确认':execution?.status==='cancelled'?'已取消':activeNode?.status==='completed'?'已完成':'等待中';
  const stageDescription=working?'系统正在自动处理，请稍候。':blocked?issue:execution?.status==='succeeded'?'首版已经生成，请审阅后决定是否采用。':'当前任务没有继续执行。';
  return <section aria-label="图文任务进度" aria-live="polite" className="space-y-4">
    <div><strong>图文制作进度</strong><p className="mt-2 text-sm">{task?.status==='approved'?'成片已采用并交付':execution?labels[execution.status]:'任务已保存，尚未提交执行调度'}</p></div>
    {error&&<Alert showIcon type="warning" title={error} action={<Button onClick={()=>setRevision(v=>v+1)}>重新读取</Button>}/>}
    {!task&&!error&&<Spin description="正在读取图片任务…"/>}
    {task&&<>
      {!execution&&<Button type="primary" loading={busy} onClick={()=>void submit()}>提交执行调度</Button>}
      {execution&&activeStage&&<div className="flex min-h-20 items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3" data-image-current-stage={activeStage[0]}>
        {working?<Spin size="small"/>:<span className={`h-2.5 w-2.5 shrink-0 rounded-full ${blocked?'bg-warning':'bg-success'}`} aria-hidden="true"/>}
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong>{activeStage[1]}</strong><Tag color={working?'processing':blocked?'warning':activeNode?.status==='completed'?'success':'default'}>{stageState}</Tag></div>
          <p className="mt-1 text-xs text-text-secondary">{stageDescription}</p></div>
      </div>}
      {!working&&latestImage&&<Button onClick={()=>setDetails(value=>!value)}>{details?'返回任务进度':'审阅图片与配文'}</Button>}
      {!working&&!details&&(execution?.status==='succeeded'||task.status==='approved')&&latestImage&&<ImageReplicationRunSummary task={task} busy={false} error="" notice=""
        imageUrl={latestImage} caption={task.imageTextContract.caption||''}/>}
      {details&&!working&&<SocialImageWorkbench key={task.id} compact initialTask={task} autoStart={false}
        creationPath={task.creationPath} contentTaskId={contentTaskId} entrySource="workspace" onShowCreations={()=>setDetails(false)}/>}
    </>}
  </section>;
}
