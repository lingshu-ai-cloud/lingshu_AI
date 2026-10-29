import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Spin, Tag } from 'antd';
import type { SocialImageCreationTask } from '../../../shared/contracts/socialImageCreation';
import type { SocialImageExecutionReceipt } from '../../../shared/contracts/socialImageExecution';
import { recoverImageReferenceAnalysis } from '../../lib/imageReferenceAnalysisRecovery';
import { reanalyzeCollectedImageReference } from '../../lib/imageReplicationReferences';
import { socialImageApi } from '../../lib/socialImageApi';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import SocialImageWorkbench from './SocialImageWorkbench';
import ImageReplicationRunSummary from './ImageReplicationRunSummary';
import { imageProductionEstimate } from '../../lib/imageProductionEstimate';
import { ASSISTANT_IMAGE_REVISION_EVENT } from '../../lib/assistantImageRevision';

const stages=[['asset_manifest','核验企业素材'],['adaptation','分析参考图与爆点'],['director_brief','图文策划'],['render_spec','编译制作方案'],['candidate_generation','生成图文首版'],['quality_check','成片质检'],['user_approval','等待用户验收'],['delivery','图文交付']] as const;
const issueLabels:Record<string,string>={
  image_post_analysis_unknown:'图片分析服务暂时不可用，原任务已保留；请核对分析记录后继续。',
  image_post_analysis_network_blocked:'本地预览未能连接图片分析服务，尚未取得识别结果。原任务已保留，请修复服务连接后重新分析。',
  image_post_analysis_model_unavailable:'图片识别服务的模型暂不可用，尚未生成分析结果。原任务已保留，需修复模型配置后继续。',
  image_post_analysis_result_persistence_failed:'识别结果尚未成功保存，暂不继续制作。请核对原分析记录，避免重复分析。',
  image_post_analysis_attempt_persistence_failed:'图片分析请求未能保存，本次尚未提交识别；请检查本地存储后继续。',
  image_post_analysis_source_changed:'参考图在分析期间发生变化，旧结果未被采用；请重新核对当前图片。',
  social_image_reference_product_confirmation_required:'参考图尚未完成产品识别核验，请先完成参考图片分析后继续。',
  social_image_reference_analysis_required:'这条参考图记录尚未完成图片分析。请在灵感集市完成原图分析，再继续原任务；无需重新创建。',
  social_image_reference_analysis_outdated:'参考图的旧版分析缺少产品识别证据，请在灵感集市重新分析原图后继续。',
  social_image_reference_analysis_in_progress:'参考图正在分析，完成后可继续原任务。',
  social_image_reference_analysis_reconciliation_required:'上次图片分析未返回可确认的结果，暂时还不能判断是否包含产品。原复刻任务已保留，需先恢复分析服务。',
  social_image_reference_analysis_failed:'参考图分析失败，请在灵感集市查看失败原因；原任务已保留。',
  social_image_reference_product_uncertain:'参考图缺少可靠的产品识别证据，请先完成或更新原图分析后继续。',
  social_image_reference_product_shoot_required:'参考图中未发现产品，请拍摄并上传包含产品的图片后继续。',
  social_image_reference_bytes_unreadable:'参考图暂时无法使用，请重新选择。',
  social_image_paid_execution_disabled:'当前环境尚未开启图文付费制作。',
  social_image_planning_failed:'图文策划未完成，请联系管理员核查任务回执。已完成的素材分析仍然保留。',
  social_image_provider_credentials_missing:'图片生成服务尚未配置，请联系管理员完成配置；策划和已完成的结果仍然保留。',
  social_image_planning_outcome_requires_review:'策划服务回执尚未确认，系统不会重复发起付费请求。',
  social_image_repair_quality_requires_review:'修复后的图片需要再次质检，请先核对上一次质检回执；原任务与图片已保留。',
  social_image_quality_requires_review:'首版已生成，质量检查尚未通过，请核对下方图片与检查结果。',
  social_image_product_cutout_required:'当前产品缺少已核验的透明抠图，请先在产品素材库补齐；系统不会用带背景原图继续制作。',
  social_image_required_asset_unreadable:'企业产品图片暂时无法读取，请检查素材存储连接；图片恢复后可继续原任务。',
  social_image_product_cutout_unreadable:'已找到透明抠图，但暂时无法读取文件。请检查素材存储连接后在原任务中继续，不需重新上传。',
  social_image_product_cutout_ambiguous:'当前产品有多份可用透明抠图，请确认唯一版本后再制作。',
  social_image_product_cutout_invalid:'透明抠图的像素或素材校验未通过，请检查产品素材后再制作。',
  social_image_product_asset_processing:'产品素材此前尚未就绪。如已在素材库看到透明图，请点击“继续生成”，系统会重新核验原任务。',
  social_image_product_analysis_failed:'产品透明图已备好，但素材分析失败。请先检查素材库中的分析状态，修复分析服务后重新分析，再在原任务中继续生成。',
};

/** Read-only polling survives refresh; only explicit confirmation submits the durable command. */
export default function ImageCreationTaskExecution({contentTaskId}:{contentTaskId:string}) {
  const [task,setTask]=useState<SocialImageCreationTask>();
  const {modal}=App.useApp();
  const identityRef=useRef(productionNavigationIdentity());
  const [execution,setExecution]=useState<SocialImageExecutionReceipt|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[details,setDetails]=useState(false),[revision,setRevision]=useState(0);
  const [readError,setReadError]=useState('');
  const [analysisMessage,setAnalysisMessage]=useState('');
  const analysisRecoveryLock=useRef(false);
  const recoveryMounted=useRef(true);
  useEffect(()=>{recoveryMounted.current=true;return()=>{recoveryMounted.current=false;};},[]);
  const [now,setNow]=useState(Date.now);
  const [durationHistorySeconds,setDurationHistorySeconds]=useState<number[]>([]);
  useEffect(()=>{if(execution?.status!=='running')return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),15_000);return()=>clearInterval(timer);},[execution?.status]);
  useEffect(()=>{
    let active=true,inFlight=false;const identity=productionNavigationIdentity();
    const read=async()=>{if(inFlight)return;inFlight=true;
      try{const result=await socialImageApi.getContentExecution(contentTaskId);
        if(result.task.productionRuntime?.binding?.contentTaskId!==contentTaskId)throw new Error('图片运行与当前内容任务不一致。');
        if(active&&identity===productionNavigationIdentity()){setTask(previous=>previous&&previous.id===result.task.id&&previous.version>result.task.version?previous:result.task);setExecution(result.execution);setDurationHistorySeconds(result.durationHistorySeconds);setReadError('');}}
      catch(cause){if(active&&identity===productionNavigationIdentity())setReadError(cause instanceof Error?cause.message:'图文进度读取失败');}
      finally{inFlight=false;}};
    void read();const timer=setInterval(()=>{if(document.visibilityState==='visible')void read();},3000);
    return()=>{active=false;clearInterval(timer);};
  },[contentTaskId,revision]);
  const reread=async()=>{
    if(analysisRecoveryLock.current||busy)return;
    analysisRecoveryLock.current=true;const identity=productionNavigationIdentity();
    const isCurrent=()=>recoveryMounted.current&&identity===productionNavigationIdentity();
    setBusy(true);setError('');setReadError('');setAnalysisMessage('正在读取原任务与参考图分析状态…');
    try {
      const result=await recoverImageReferenceAnalysis(contentTaskId,{
        read:socialImageApi.getContentExecution,
        confirm:current=>socialImageApi.confirmReferenceProduct(current,'auto'),
        analyze:reanalyzeCollectedImageReference,
        enqueue:socialImageApi.enqueueExecution,isCurrent,
        onProgress:message=>{if(isCurrent())setAnalysisMessage(message);},
      });
      if(isCurrent()) {setTask(result.task);setExecution(result.execution);setRevision(value=>value+1);
        setAnalysisMessage(result.analyzed?'参考图分析已回填灵感集市，当前复刻任务已恢复。':'已核验并读取当前任务状态。');}
    } catch(cause) {
      if(isCurrent()){const code=(cause as {payload?:{code?:string}})?.payload?.code;
        const message=code&&issueLabels[code]?issueLabels[code]:code==='image_post_queue_requires_reconciliation'||code==='image_post_analysis_attempt_requires_reconciliation'
          ?'原图分析尚未结束或未返回结果，原复刻任务已保留。'
          :code==='image_post_analysis_provider_result_unknown'?'图片分析服务未返回可确认的结果，暂时还不能判断是否包含产品。原复刻任务已保留。'
          :code==='image_reference_recovery_scope_changed'?'任务或参考图已变化，本次没有继续制作。请重新读取当前任务。'
          :code==='image_reference_recovery_source_missing'?'未找到这张参考图对应的灵感集市记录，无法回填分析；原任务已保留。'
          :cause instanceof Error?cause.message:'图片分析未完成，原任务已保留。';
        setAnalysisMessage('');setError(message);}
    } finally {analysisRecoveryLock.current=false;if(isCurrent())setBusy(false);}
  };
  const retry=async()=>{if(!task||!execution||busy)return;const identity=productionNavigationIdentity();setBusy(true);setError('');
    try{const result=await socialImageApi.retryExecution(task);if(identity===productionNavigationIdentity()){setExecution(result.execution);setTask(result.task);}}
    catch(cause){if(identity===productionNavigationIdentity())setError(cause instanceof Error?cause.message:'原任务恢复失败');}
    finally{if(identity===productionNavigationIdentity())setBusy(false);}};
  const queued=execution?.status==='queued';
  const working=Boolean(execution&&['running','retry_wait','reconciling'].includes(execution.status));
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
    'social_image_required_asset_unreadable',
    'social_image_product_cutout_required','social_image_product_cutout_unreadable','social_image_product_cutout_ambiguous',
    'social_image_product_cutout_invalid','social_image_product_asset_processing','social_image_product_analysis_failed'].includes(execution.lastError||''));
  const issue=execution?.lastError?issueLabels[execution.lastError]||'当前步骤未能继续，系统已保留原任务和已完成结果。':'';
  const currentPlanId=task?.productionRuntime?.nodes.find(node=>node.nodeId==='execution_plan'&&node.status==='completed')?.outputRef?.id;
  const currentPlan=task?.productionRuntime?.nodeOutputs.find(node=>node.id===currentPlanId&&node.nodeId==='execution_plan'&&node.status==='completed');
  const styleFallback=Array.isArray((currentPlan?.value as {fallbackRoutes?:unknown})?.fallbackRoutes)&&(currentPlan?.value as {fallbackRoutes:string[]}).fallbackRoutes.includes('reference_style_unverified_ad_fallback');
  const stageState=queued?'等待接单':working?'正在进行':blocked?(candidate?'需要复核':'尚未启动'):execution?.status==='succeeded'?'等待确认':execution?.status==='cancelled'?'已取消':activeNode?.status==='completed'?'已完成':'等待中';
  const stageDescription=queued?'已进入创作队列，等待制作服务接单。':working?'系统正在自动处理，请稍候。':blocked?issue:execution?.status==='succeeded'?'首版已经生成，请审阅后决定是否采用。':'当前任务没有继续执行。';
  if(adopted)return <section aria-label="图文交付操作" className="flex flex-wrap gap-2">
    {(error||readError)&&<Alert showIcon type="warning" title={error||readError}/>}
    <Button href={deliveryUrl||undefined} download target="_blank" disabled={!deliveryUrl}>下载成片</Button>
    <Button type="primary" onClick={()=>{if(identityRef.current!==productionNavigationIdentity())return;window.dispatchEvent(new CustomEvent('lingshu:navigate',{detail:{page:'smartAssets',view:'publish',socialContentTaskId:contentTaskId,socialContentPage:'smartAssets',navigationIdentity:identityRef.current}}));}}>去发布</Button>
  </section>;
  return <section aria-label="图文任务进度" aria-live="polite" className="space-y-4" data-image-task-id={task?.id} data-image-content-task-id={contentTaskId}>
    {(error||readError)&&<Alert showIcon type="warning" title={error||readError} action={<Button loading={busy} disabled={busy} onClick={()=>void reread()}>重新读取</Button>}/>}
    {analysisMessage&&<Alert showIcon type="info" title={analysisMessage}/>}
    {task?.referenceProductCheck?.decision==='present'&&<p className="text-sm text-text-secondary">参考图已识别：包含产品。</p>}
    {styleFallback&&<Alert showIcon type="info" title="原参考记录缺少可核验的风格标签，系统已按广告式产品图制作。"/>}
    {!task&&!error&&!readError&&<Spin description="正在读取图片任务…"/>}
    {task&&<>
      {!execution&&<Button type="primary" loading={busy} onClick={()=>void reread()}>继续生成</Button>}
      {execution&&activeStage&&<div className="flex min-h-20 items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3" data-image-current-stage={activeStage[0]}>
        {working?<Spin size="small"/>:<span className={`h-2.5 w-2.5 shrink-0 rounded-full ${blocked?'bg-warning':queued?'bg-text-muted':'bg-success'}`} aria-hidden="true"/>}
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong>{activeStage[1]}</strong><Tag color={working?'processing':blocked?'warning':activeNode?.status==='completed'?'success':'default'}>{stageState}</Tag></div>
          <p className="mt-1 text-xs text-text-secondary">{stageDescription}</p>
          {imageProductionEstimate(task,execution,now,durationHistorySeconds)&&<p className="mt-1 text-xs text-text-secondary">{imageProductionEstimate(task,execution,now,durationHistorySeconds)}</p>}
          {canRetryPlanning&&<Button className="mt-3" type="primary" size="small" loading={busy} onClick={()=>void retry()}>继续生成</Button>}</div>
      </div>}
      {!working&&latestImage&&!candidate&&<Button onClick={()=>setDetails(value=>!value)}>{details?'返回任务进度':'审阅图片与配文'}</Button>}
      {!working&&!details&&candidate&&<ImageReplicationRunSummary task={task} busy={false} error="" notice=""
        imageUrl={latestImage} caption={task.imageTextContract.caption||''}/>}
      {!working&&candidate?.qualityChecks.filter(check=>check.severity==='hard'&&check.verdict==='fail').map(check=><Alert key={check.key} showIcon type="warning" title={check.note}/>)}
      {!working&&!details&&candidate&&<><p className="text-sm text-text-secondary">需要调整？可以在下方输入框描述图片修改意见。</p><Button type="primary" loading={busy} disabled={!canAccept} onClick={accept}>确认并采用</Button></>}
      {details&&!working&&<SocialImageWorkbench key={task.id} compact initialTask={task} autoStart={false}
        creationPath={task.creationPath} contentTaskId={contentTaskId} entrySource="workspace" onShowCreations={()=>setDetails(false)}/>}
    </>}
  </section>;
}
