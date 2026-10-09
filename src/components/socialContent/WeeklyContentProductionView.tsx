import {useEffect,useRef,useState} from 'react';
import type {WeeklyContentNavigation} from '../../../shared/contracts/weeklyContentNavigation';
import {AUTH_TOKEN_CHANGED_EVENT,getToken} from '../../lib/auth';
import {loadWeeklyContentProductionView} from '../../lib/weeklyContentProductionView';
import {readWeeklyReferenceReviewNavigation} from '../../lib/weeklyReferenceReviewNavigationApi';
import SocialAgentWorkflowPanel from './SocialAgentWorkflowPanel';
import SocialArtifactPreviewDialog from './SocialArtifactPreviewDialog';

export default function WeeklyContentProductionView({target}:{target:WeeklyContentNavigation}) {
  const [view,setView]=useState<Awaited<ReturnType<typeof loadWeeklyContentProductionView>>|null>(null),[error,setError]=useState(''),[preview,setPreview]=useState(false);
  const [sessionToken,setSessionToken]=useState(getToken);
  useEffect(()=>{const changed=()=>{setView(null);setPreview(false);setSessionToken(getToken());};window.addEventListener(AUTH_TOKEN_CHANGED_EVENT,changed);window.addEventListener('storage',changed);return()=>{window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT,changed);window.removeEventListener('storage',changed);};},[]);
  const identity=JSON.stringify(target),current=useRef(identity);current.current=identity;
  useEffect(()=>{let disposed=false,timer:ReturnType<typeof setTimeout>|undefined;const token=getToken();setView(null);setError('');setPreview(false);const active=()=>!disposed&&current.current===identity&&getToken()===token;async function refresh(){try{const next=await loadWeeklyContentProductionView(target);if(active()){setView(next);setError('');}}catch(e){if(active()){setView(null);setPreview(false);setError(e instanceof Error?e.message:String(e));}}finally{if(active())timer=setTimeout(refresh,15000);}}void refresh();return()=>{disposed=true;if(timer)clearTimeout(timer);};},[identity,sessionToken]);
  const openReference=async(recordId:string)=>{const token=getToken(),selected=identity;setError('');try{const exactReferenceReview=await readWeeklyReferenceReviewNavigation(target.scope,recordId,target.contentTaskId);if(current.current!==selected||getToken()!==token)return;window.dispatchEvent(new CustomEvent('lingshu:navigate',{detail:{page:'socialInspiration',exactReferenceReview}}));}catch(e){if(current.current===selected&&getToken()===token)setError(e instanceof Error?e.message:String(e));}};
  return <section aria-label="周任务原生产记录" className="space-y-4 rounded-xl border p-5">
    <h2 className="text-lg font-bold">这条任务的生产记录</h2><p className="text-xs">任务 {target.contentTaskId} · {target.runId?`原运行 ${target.runId}`:'尚未启动生产'}</p>
    {error?<p role="alert">{error}</p>:!view?<p role="status">正在核验原生产绑定与成片…</p>:<>
      {view.historical&&<p>当前内容任务已有后续运行；此处展示原运行的成片与逐镜记录。</p>}
      {!view.artifact&&<><p role="status">{view.task.productionProgress?.activity||(!view.binding.runId?'等待补齐生产输入；尚未启动制作。':'等待原生产运行更新。')}</p>{view.task.productionProgress&&<p className="text-xs">最近更新：{view.task.productionProgress.updatedAt}</p>}<p className="text-xs">审核原参考后，需要重新确认并发布周排期；旧任务不会自动改用新版本。</p><SocialAgentWorkflowPanel task={view.task} expanded onReviewReference={recordId=>void openReference(recordId)}/></>}
      {view.artifact&&<div><p>原成片 {view.artifact.artifactId} · {view.artifact.version} · {view.artifact.status}</p><button type="button" onClick={()=>setPreview(true)} className="btn-primary mt-2">预览这条成片</button></div>}
      {view.scenes&&<ol className="space-y-2">{view.scenes.scenes.map(scene=><li key={scene.sceneId} className="rounded-lg border p-3 text-sm">分镜 {scene.sceneId} · 镜头 {scene.shotId} · {scene.status}<p className="text-xs">原技术凭据 {scene.technicalReceiptId}</p></li>)}</ol>}
      {view.binding.gaps.map(gap=><p key={gap} className="text-xs">待核验：{gap}</p>)}
      {preview&&view.artifact&&<SocialArtifactPreviewDialog artifact={view.artifact} onClose={()=>setPreview(false)}/>}
    </>}
  </section>;
}
