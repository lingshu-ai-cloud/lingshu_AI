import {useEffect,useRef,useState} from 'react';
import type {WeeklyContentNavigation} from '../../../shared/contracts/weeklyContentNavigation';
import {AUTH_TOKEN_CHANGED_EVENT,getToken} from '../../lib/auth';
import {loadWeeklyContentProductionView} from '../../lib/weeklyContentProductionView';
import {readWeeklyReferenceReviewNavigation} from '../../lib/weeklyReferenceReviewNavigationApi';
import WeeklyOwnedProductIdentityPanel from './WeeklyOwnedProductIdentityPanel';
import {weeklyContentReviewScope} from '../../lib/weeklyContentReviewScope';
import {SocialSceneG4ReviewPanel} from './SocialSceneG4ReviewPanel';
import {SocialDirectorG5ReviewPanel} from './SocialDirectorG5ReviewPanel';
import {WeeklyContentQualityRecoveryPanel} from './WeeklyContentQualityRecoveryPanel';
import SocialAgentWorkflowPanel from './SocialAgentWorkflowPanel';
import SocialArtifactPreviewDialog from './SocialArtifactPreviewDialog';

export default function WeeklyContentProductionView({target}:{target:WeeklyContentNavigation}) {
  const [view,setView]=useState<Awaited<ReturnType<typeof loadWeeklyContentProductionView>>|null>(null),[error,setError]=useState(''),[preview,setPreview]=useState(false);
  const [sessionToken,setSessionToken]=useState(getToken),[refreshVersion,setRefreshVersion]=useState(0);
  const mounted=useRef(false),epoch=useRef(0);
  useEffect(()=>{mounted.current=true;const changed=()=>{epoch.current++;setView(null);setPreview(false);setSessionToken(getToken());setRefreshVersion(v=>v+1);};window.addEventListener(AUTH_TOKEN_CHANGED_EVENT,changed);window.addEventListener('storage',changed);return()=>{mounted.current=false;epoch.current++;window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT,changed);window.removeEventListener('storage',changed);};},[]);
  const identity=JSON.stringify(target),current=useRef(identity);if(current.current!==identity){current.current=identity;epoch.current++;}
  useEffect(()=>{let disposed=false,timer:ReturnType<typeof setTimeout>|undefined;const token=getToken(),generation=epoch.current;setView(null);setError('');setPreview(false);const active=()=>mounted.current&&!disposed&&epoch.current===generation&&current.current===identity&&getToken()===token;async function refresh(){try{const next=await loadWeeklyContentProductionView(target);if(active()){setView(next);setError('');}}catch(e){if(active()){setView(null);setPreview(false);setError(e instanceof Error?e.message:String(e));}}finally{if(active())timer=setTimeout(refresh,15000);}}void refresh();return()=>{disposed=true;if(timer)clearTimeout(timer);};},[identity,sessionToken,refreshVersion]);
  const openReference=async(recordId:string)=>{const token=getToken(),selected=identity,generation=epoch.current;const active=()=>mounted.current&&epoch.current===generation&&current.current===selected&&getToken()===token;if(!active())return;setError('');try{const exactReferenceReview=await readWeeklyReferenceReviewNavigation(target.scope,recordId,target.contentTaskId);if(!active())return;window.dispatchEvent(new CustomEvent('lingshu:navigate',{detail:{page:'socialInspiration',exactReferenceReview}}));}catch(e){if(active())setError(e instanceof Error?e.message:String(e));}};
  let reviewScope:ReturnType<typeof weeklyContentReviewScope>=null,reviewError='';try{if(view)reviewScope=weeklyContentReviewScope(view);}catch(cause){reviewError=cause instanceof Error?cause.message:'原成片审核范围无法核验。';}
  return <section aria-label="周任务原生产记录" className="space-y-4 rounded-xl border p-5">
    <h2 className="text-lg font-bold">这条任务的生产记录</h2><p className="text-xs">任务 {target.contentTaskId} · {target.runId?`原运行 ${target.runId}`:'尚未启动生产'}</p>
    {error?<p role="alert">{error}</p>:!view?<p role="status">正在核验原生产绑定与成片…</p>:<>
      {view.historical&&<p>当前内容任务已有后续运行；此处展示原运行的成片与逐镜记录。</p>}
      {!view.artifact&&<><p role="status">{view.task.productionProgress?.activity||(!view.binding.runId?'等待补齐生产输入；尚未启动制作。':'等待原生产运行更新。')}</p>{view.task.productionProgress&&<p className="text-xs">最近更新：{view.task.productionProgress.updatedAt}</p>}<p className="text-xs">审核原参考后，需要重新确认并发布周排期；旧任务不会自动改用新版本。</p><SocialAgentWorkflowPanel task={view.task} expanded onReviewReference={recordId=>void openReference(recordId)}/></>}
      {!view.historical&&!view.artifact&&<WeeklyOwnedProductIdentityPanel scope={{tenantId:view.binding.scope.tenantId,programId:view.binding.scope.programId,packageId:view.binding.scope.packageId,packageVersion:view.binding.scope.packageVersion,publicationTaskId:view.binding.publicationTaskId,contentTaskId:view.binding.contentTaskId}} expectedRunId={view.binding.runId} onChanged={()=>setRefreshVersion(v=>v+1)}/>}
      {view.artifact&&<div><p>原成片 {view.artifact.artifactId} · {view.artifact.version} · {view.artifact.status}</p><button type="button" onClick={()=>setPreview(true)} className="btn-primary mt-2">预览这条成片</button></div>}
      {reviewError&&<p role="alert">{reviewError}</p>}
      {reviewScope&&<div className="space-y-4"><p>先完成原成片逐镜技术验收与编导整片审核，再明确继续原周质量任务；不会自动批准发布。</p><SocialSceneG4ReviewPanel task={view.task} initialArtifactId={reviewScope.artifactId} expectedTenantId={reviewScope.tenantId} onChanged={()=>setRefreshVersion(v=>v+1)}/><SocialDirectorG5ReviewPanel task={view.task} initialArtifactId={reviewScope.artifactId} expectedTenantId={reviewScope.tenantId} onChanged={()=>setRefreshVersion(v=>v+1)}/><WeeklyContentQualityRecoveryPanel scope={reviewScope} onChanged={()=>setRefreshVersion(v=>v+1)}/></div>}
      {view.scenes&&<ol className="space-y-2">{view.scenes.scenes.map(scene=><li key={scene.sceneId} className="rounded-lg border p-3 text-sm">分镜 {scene.sceneId} · 镜头 {scene.shotId} · {scene.status}<p className="text-xs">原技术凭据 {scene.technicalReceiptId}</p></li>)}</ol>}
      {view.binding.gaps.map(gap=><p key={gap} className="text-xs">待核验：{gap}</p>)}
      {preview&&view.artifact&&<SocialArtifactPreviewDialog artifact={view.artifact} onClose={()=>setPreview(false)}/>}
    </>}
  </section>;
}
