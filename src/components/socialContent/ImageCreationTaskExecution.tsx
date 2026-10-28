import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Spin, Tag } from 'antd';
import type { SocialImageCreationTask } from '../../../shared/contracts/socialImageCreation';
import type { SocialImageExecutionReceipt } from '../../../shared/contracts/socialImageExecution';
import { socialImageApi } from '../../lib/socialImageApi';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import SocialImageWorkbench from './SocialImageWorkbench';
import ImageReplicationRunSummary from './ImageReplicationRunSummary';
import { imageProductionEstimate } from '../../lib/imageProductionEstimate';
import { ASSISTANT_IMAGE_REVISION_EVENT } from '../../lib/assistantImageRevision';

const labels:Record<SocialImageExecutionReceipt['status'],string>={queued:'已入队，等待调度领取',running:'正在制作图文',retry_wait:'等待恢复',reconciling:'供应商回执待核对',blocked:'需要处理',paused:'已暂停',succeeded:'首版制作完成，等待审阅',cancelled:'已取消',dead_letter:'需要处理'};
const stages=[['asset_manifest','核验企业素材'],['adaptation','分析参考图与爆点'],['director_brief','图文策划'],['render_spec','编译制作方案'],['candidate_generation','生成图文首版'],['quality_check','成片质检'],['user_approval','等待用户验收'],['delivery','图文交付']] as const;
const issueLabels:Record<string,string>={
  social_image_reference_product_confirmation_required:'暂时无法判断图片中是否有产品，请重新确认参考图片。',
  social_image_reference_product_shoot_required:'参考图中未发现产品，请拍摄并上传包含产品的图片后继续。',
  social_image_reference_bytes_unreadable:'参考图暂时无法使用，请重新选择。',
  social_image_paid_execution_disabled:'当前环境尚未开启图文付费制作。',
  social_image_planning_failed:'图文策划未完成，请联系管理员核查任务回执。已完成的素材分析仍然保留。',
  social_image_provider_credentials_missing:'图片生成服务尚未配置，请联系管理员完成配置；策划和已完成的结果仍然保留。',
  social_image_planning_outcome_requires_review:'策划服务回执尚未确认，系统不会重复发起付费请求。',
  social_image_repair_quality_requires_review:'修复后的图片需要再次质检，请先核对上一次质检回执；原任务与图片已保留。',
  social_image_quality_requires_review:'首版已生成，正在等待质量复核。',
  social_image_product_cutout_required:'当前产品缺少已核验的透明抠图，请先在产品素材库补齐；系统不会用带背景原图继续制作。',
  social_image_product_cutout_ambiguous:'当前产品有多份可用透明抠图，请确认唯一版本后再制作。',
  social_image_product_cutout_invalid:'透明抠图的像素或素材校验未通过，请检查产品素材后再制作。',
};

/** Read-only polling survives refresh; only explicit confirmation submits the durable command. */
export default function ImageCreationTaskExecution({contentTaskId}:{contentTaskId:string}) {
  const [task,setTask]=useState<SocialImageCreationTask>();
  const {modal}=App.useApp();
  const identityRef=useRef(productionNavigationIdentity());
  const [execution,setExecution]=useState<SocialImageExecutionReceipt|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[details,setDetails]=useState(false),[revision,setRevision]=useState(0);
  const [readError,setReadError]=useState('');
  const [now,setNow]=useState(Date.now);
  useEffect(()=>{if(execution?.status!=='running')return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),15_000);return()=>clearInterval(timer);},[execution?.status]);
  useEffect(()=>{
    let active=true,inFlight=false;const identity=productionNavigationIdentity();
    const read=async()=>{if(inFlight)return;inFlight=true;
      try{const result=await socialImageApi.getContentExecution(contentTaskId);
        if(result.task.productionRuntime?.binding?.contentTaskId!==contentTaskId)throw new Error('图片运行与当前内容任务不一致。');
        if(active&&identity===productionNavigationIdentity()){setTask(previous=>previous&&previous.id===result.task.id&&previous.version>result.task.version?previous:result.task);setExecution(result.execution);setReadError('');}}
      catch(cause){if(active&&identity===productionNavigationIdentity())setReadError(cause instanceof Error?cause.message:'图文进度读取失败');}
      finally{inFlight=false;}};
    void read();const timer=setInterval(()=>{if(document.visibilityState==='visible')void read();},3000);
    return()=>{active=false;clearInterval(timer);};
  },[contentTaskId,revision]);
  const submit=async()=>{if(!task||busy)return;const identity=productionNavigationIdentity();setBusy(true);setError('');
    try{const result=await socialImageApi.enqueueExecution(task);if(identity===productionNavigationIdentity()){setExecution(result.execution);setTask(result.task);}}
    catch(cause){if(identity===productionNavigationIdentity())setError(cause instanceof Error?cause.message:'任务入队失败');}
    finally{if(identity===productionNavigationIdentity())setBusy(false);}};
  const retry=async()=>{if(!task||!execution||busy)return;const identity=productionNavigationIdentity();setBusy(true);setError('');
    try{const result=await socialImageApi.retryExecution(task);if(identity===productionNavigationIdentity()){setExecution(result.execution);setTask(result.task);}}
    catch(cause){if(identity===productionNavigationIdentity())setError(cause instanceof Error?cause.message:'原任务恢复失败');}
    finally{if(identity===productionNavigationIdentity())setBusy(false);}};
  const working=Boolean(execution&&['queued','running','retry_wait','reconciling'].includes(execution.status));
  const latestImage=task?.outputs.filter(output=>output.mediaUrl&&output.state!=='superseded').sort((a,b)=>b.version-a.version)[0]?.mediaUrl||'';
  const candidate=task?.outputs.filter(output=>output.role==='single'&&output.mediaUrl&&output.state!=='superseded').sort((a,b)=>b.version-a.version)[0];
  const adopted=Boolean(task?.status==='approved'&&task.approvedArtifact);
  const deliveryUrl=task?.approvedArtifact?.mediaUrl||task?.outputs.find(output=>output.id===task?.approvedArtifact?.candidateId&&output.contentHash===task.approvedArtifact?.contentHash)?.mediaUrl||'';
  const canAccept=Boolean(task?.schemaVersion==='social-image-creation.v3'&&candidate?.contentHash&&!task.fieldsToConfirm.length
    &&['file_decode','pixel_dimensions'].every(key=>candidate.qualityChecks.some(check=>check.key===key&&check.verdict==='pass'&&check.checker==='deterministic')));
  const accept=()=>{if(!task||!candidate||!canAccept||busy||identityRef.current!==productionNavigationIdentity())return;const identity=identityRef.current;
    modal.confirm({title:'确认并采用这张图片？',content:'请核对图片中的产品、文字与帖子配文。确认后生成交付物，不会自动发布。',okText:'确认采用',cancelText:'继续查看',
      onOk:async()=>{if(identity!==productionNavigationIdentity())return;setBusy(true);setError('');try{const result=await socialImageApi.acceptHumanQuality(task,candidate);if(identity===productionNavigationIdentity())setTask(result.task);}
        catch(cause){if(identity===productionNavigationIdentity())setError(cause instanceof Error?cause.message:'确认失败，请重新读取任务');}finally{if(identity===productionNavigationIdentity())setBusy(false);}}});};
  useEffect(()=>{
    const handler=(event:Event)=>{const request=event as CustomEvent<{taskId?:string;instruction?:string}>;
      const instruction=String(request.detail?.instruction||'').trim();
      if(!task||task.id!==request.detail?.taskId||task.status==='approved'||!candidate||!instruction||busy||execution?.status==='running'||identityRef.current!==productionNavigationIdentity())return;
      request.preventDefault();const identity=identityRef.current;
      if(task.outputs.some(output=>output.qualityPreflight&&['claimed','outcome_unknown'].includes(output.qualityPreflight.status))){modal.info({title:'修改暂不能继续',content:'上一版质量检查的结果尚待核对，系统不会重复提交。'});return;}
      if(!task.layerGraph){modal.info({title:'修改意见已收到',content:'当前版本暂不支持在对话中直接生成修改版；原图与修改意见仍保留在会话中。'});return;}
      modal.confirm({title:'确认修改这张图片？',content:'系统会按意见调整图层并重新检查，检查可能调用付费服务。原版本会保留。',okText:'确认修改',cancelText:'暂不修改',
        onOk:async()=>{if(identity!==productionNavigationIdentity())return;setBusy(true);setError('');try{
          const repaired=await socialImageApi.repairLayered(task,instruction);if(identity!==productionNavigationIdentity())return;setTask(repaired.task);
          const rendered=await socialImageApi.renderLayered(repaired.task);if(identity!==productionNavigationIdentity())return;setTask(rendered.task);
          const checked=await socialImageApi.runPreflight(rendered.task);if(identity===productionNavigationIdentity())setTask(checked.task);
        }catch(cause){if(identity===productionNavigationIdentity())setError(cause instanceof Error?cause.message:'修改未完成，请查看原任务状态');}
        finally{if(identity===productionNavigationIdentity())setBusy(false);}}});
    };
    window.addEventListener(ASSISTANT_IMAGE_REVISION_EVENT,handler);return()=>window.removeEventListener(ASSISTANT_IMAGE_REVISION_EVENT,handler);
  },[task,candidate,busy,execution?.status,modal]);
  const activeStage=stages.find(([id])=>task?.productionRuntime?.nodes.find(item=>item.nodeId===id)?.status==='running')
    ||stages.find(([id])=>!['completed','skipped'].includes(task?.productionRuntime?.nodes.find(item=>item.nodeId===id)?.status||''));
  const activeNode=activeStage?task?.productionRuntime?.nodes.find(item=>item.nodeId===activeStage[0]):undefined;
  const blocked=Boolean(execution&&['blocked','dead_letter','paused'].includes(execution.status));
  const canRetryPlanning=Boolean(blocked&&execution&&['social_image_planning_failed',
    'social_image_product_cutout_required','social_image_product_cutout_ambiguous',
    'social_image_product_cutout_invalid'].includes(execution.lastError||''));
  const issue=execution?.lastError?issueLabels[execution.lastError]||'当前步骤未能继续，系统已保留原任务和已完成结果。':'';
  const currentPlanId=task?.productionRuntime?.nodes.find(node=>node.nodeId==='execution_plan'&&node.status==='completed')?.outputRef?.id;
  const currentPlan=task?.productionRuntime?.nodeOutputs.find(node=>node.id===currentPlanId&&node.nodeId==='execution_plan'&&node.status==='completed');
  const styleFallback=Array.isArray((currentPlan?.value as {fallbackRoutes?:unknown})?.fallbackRoutes)&&(currentPlan?.value as {fallbackRoutes:string[]}).fallbackRoutes.includes('reference_style_unverified_ad_fallback');
  const stageState=working?'正在进行':blocked?'尚未启动':execution?.status==='succeeded'?'等待确认':execution?.status==='cancelled'?'已取消':activeNode?.status==='completed'?'已完成':'等待中';
  const stageDescription=working?'系统正在自动处理，请稍候。':blocked?issue:execution?.status==='succeeded'?'首版已经生成，请审阅后决定是否采用。':'当前任务没有继续执行。';
  if(adopted)return <section aria-label="图文交付操作" className="flex flex-wrap gap-2">
    {(error||readError)&&<Alert showIcon type="warning" title={error||readError}/>}
    <Button href={deliveryUrl||undefined} download target="_blank" disabled={!deliveryUrl}>下载成片</Button>
    <Button type="primary" onClick={()=>{if(identityRef.current!==productionNavigationIdentity())return;window.dispatchEvent(new CustomEvent('lingshu:navigate',{detail:{page:'smartAssets',view:'publish',socialContentTaskId:contentTaskId,socialContentPage:'smartAssets',navigationIdentity:identityRef.current}}));}}>去发布</Button>
  </section>;
  return <section aria-label="图文任务进度" aria-live="polite" className="space-y-4">
    <div><strong>图文制作进度</strong><p className="mt-2 text-sm">{task?.status==='approved'?'成片已采用并交付':execution?labels[execution.status]:'任务已保存，尚未提交执行调度'}</p></div>
    {(error||readError)&&<Alert showIcon type="warning" title={error||readError} action={<Button onClick={()=>{setError('');setRevision(v=>v+1);}}>重新读取</Button>}/>}
    {styleFallback&&<Alert showIcon type="info" title="原参考记录缺少可核验的风格标签，系统已按广告式产品图制作。"/>}
    {!task&&!error&&!readError&&<Spin description="正在读取图片任务…"/>}
    {task&&<>
      {!execution&&<Button type="primary" loading={busy} onClick={()=>void submit()}>提交执行调度</Button>}
      {execution&&activeStage&&<div className="flex min-h-20 items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3" data-image-current-stage={activeStage[0]}>
        {working?<Spin size="small"/>:<span className={`h-2.5 w-2.5 shrink-0 rounded-full ${blocked?'bg-warning':'bg-success'}`} aria-hidden="true"/>}
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong>{activeStage[1]}</strong><Tag color={working?'processing':blocked?'warning':activeNode?.status==='completed'?'success':'default'}>{stageState}</Tag></div>
          <p className="mt-1 text-xs text-text-secondary">{stageDescription}</p>
          {imageProductionEstimate(task,execution,now)&&<p className="mt-1 text-xs text-text-secondary">{imageProductionEstimate(task,execution,now)}</p>}
          {canRetryPlanning&&<Button className="mt-3" type="primary" size="small" loading={busy} onClick={()=>void retry()}>继续生成</Button>}</div>
      </div>}
      {!working&&latestImage&&!candidate&&<Button onClick={()=>setDetails(value=>!value)}>{details?'返回任务进度':'审阅图片与配文'}</Button>}
      {!working&&!details&&candidate&&<ImageReplicationRunSummary task={task} busy={false} error="" notice=""
        imageUrl={latestImage} caption={task.imageTextContract.caption||''}/>}
      {!working&&!details&&candidate&&<><p className="text-sm text-text-secondary">需要调整？可以在下方输入框描述图片修改意见。</p><Button type="primary" loading={busy} disabled={!canAccept} onClick={accept}>确认并采用</Button></>}
      {details&&!working&&<SocialImageWorkbench key={task.id} compact initialTask={task} autoStart={false}
        creationPath={task.creationPath} contentTaskId={contentTaskId} entrySource="workspace" onShowCreations={()=>setDetails(false)}/>}
    </>}
  </section>;
}
