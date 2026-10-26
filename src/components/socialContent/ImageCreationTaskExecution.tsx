import { useEffect, useState } from 'react';
import { Alert, Button, Spin, Tag, Timeline } from 'antd';
import type { SocialImageCreationTask } from '../../../shared/contracts/socialImageCreation';
import type { SocialImageExecutionReceipt } from '../../../shared/contracts/socialImageExecution';
import { socialImageApi } from '../../lib/socialImageApi';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import SocialImageWorkbench from './SocialImageWorkbench';

const labels:Record<SocialImageExecutionReceipt['status'],string>={queued:'已入队，等待调度领取',running:'正在制作图文',retry_wait:'等待恢复',reconciling:'供应商回执待核对',blocked:'需要处理',paused:'已暂停',succeeded:'首版制作完成，等待审阅',cancelled:'已取消',dead_letter:'需要处理'};
const issues:Record<string,string>={social_image_paid_execution_disabled:'真实模型执行尚未启用，已有制作进度已保留。',social_image_required_asset_rights_unverified:'企业产品图片缺少可核验授权，请补充后继续。',social_image_reference_ratio_unsupported:'参考图画幅与交付画幅不匹配，请选择同画幅参考图或重新确认画幅。',social_image_reference_structure_unsupported:'参考图的版式证据不足，请换一张主体和文字区域更清晰的参考图。',social_image_planner_result_requires_review:'图文策划需要确认，请查看图片与配文。',social_image_quality_requires_review:'成片质量检查存在待确认项，请查看图片与配文。',social_image_paid_outcome_unresolved:'生成结果需要核对，系统不会重复提交付费请求。',social_image_confirmed_inputs_changed:'创作要求发生变化，请重新确认当前任务。'};
const stages=[['asset_manifest','核验企业素材'],['adaptation','分析参考图与爆点'],['director_brief','图文策划'],['render_spec','编译制作方案'],['candidate_generation','生成图文首版'],['quality_check','成片质检'],['user_approval','用户验收'],['delivery','图文交付']];

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
  return <section aria-label="图文任务进度" aria-live="polite" className="space-y-4">
    <div><strong>图文制作进度</strong><p className="mt-2 text-sm">{execution?labels[execution.status]:'任务已保存，尚未提交执行调度'}</p>
      {execution&&<p className="mt-1 break-all text-xs text-text-secondary">调度回执：{execution.jobId}</p>}</div>
    {error&&<Alert showIcon type="warning" title={error} action={<Button onClick={()=>setRevision(v=>v+1)}>重新读取</Button>}/>}
    {execution?.lastError&&<Alert showIcon type="warning" title="这一步需要处理" description={issues[execution.lastError] || execution.lastError}/>}
    {!task&&!error&&<Spin description="正在读取图片任务…"/>}
    {task&&<>
      {!execution&&<Button type="primary" loading={busy} onClick={()=>void submit()}>提交执行调度</Button>}
      <Timeline items={[{content:<><strong>执行调度</strong><p className="text-xs text-text-secondary">{execution?execution.attempt>0?'调度已领取原任务':labels[execution.status]:'尚无入队回执'}</p></>,color:execution?.attempt?'green':execution?'blue':'gray'},
        ...stages.map(([id,label])=>{const node=task.productionRuntime?.nodes.find(item=>item.nodeId===id);const firstPending=stages.find(([key])=>!['completed','skipped'].includes(task.productionRuntime?.nodes.find(item=>item.nodeId===key)?.status||''))?.[0];
          const status=execution?.status==='blocked'&&id===firstPending?'blocked':node?.status;
          const text=status==='completed'?'已完成':status==='running'?'进行中':['blocked','failed','stale','outcome_unknown','needs_review'].includes(status||'')?'待处理':'待执行';
          return {content:<div className="flex flex-wrap items-center justify-between gap-2"><span>{label}</span><Tag color={status==='completed'?'success':status==='running'?'processing':text==='待处理'?'warning':'default'}>{text}</Tag></div>,color:status==='completed'?'green':status==='running'?'blue':'gray'};})]}/>
      {!working&&<Button onClick={()=>setDetails(value=>!value)}>{details?'收起图片与配文':'查看图片与配文'}</Button>}
      {details&&!working&&<SocialImageWorkbench key={`${task.id}:${task.version}`} compact initialTask={task} autoStart={false}
        creationPath={task.creationPath} contentTaskId={contentTaskId} entrySource="workspace" onShowCreations={()=>setDetails(false)}/>}
    </>}
  </section>;
}
