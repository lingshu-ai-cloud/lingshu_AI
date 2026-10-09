import {useEffect,useRef,useState} from 'react';
import type {WeeklyContentNavigation} from '../../../shared/contracts/weeklyContentNavigation';
import {getToken} from '../../lib/auth';
import {loadWeeklyContentProductionView} from '../../lib/weeklyContentProductionView';
import SocialAgentWorkflowPanel from './SocialAgentWorkflowPanel';
import SocialArtifactPreviewDialog from './SocialArtifactPreviewDialog';

export default function WeeklyContentProductionView({target}:{target:WeeklyContentNavigation}) {
  const [view,setView]=useState<Awaited<ReturnType<typeof loadWeeklyContentProductionView>>|null>(null),[error,setError]=useState(''),[preview,setPreview]=useState(false);
  const identity=JSON.stringify(target),current=useRef(identity);current.current=identity;
  useEffect(()=>{let disposed=false,timer:ReturnType<typeof setTimeout>|undefined;const token=getToken();setView(null);setError('');setPreview(false);const active=()=>!disposed&&current.current===identity&&getToken()===token;async function refresh(){try{const next=await loadWeeklyContentProductionView(target);if(active()){setView(next);setError('');}}catch(e){if(active()){setView(null);setPreview(false);setError(e instanceof Error?e.message:String(e));}}finally{if(active())timer=setTimeout(refresh,15000);}}void refresh();return()=>{disposed=true;if(timer)clearTimeout(timer);};},[identity]);
  return <section aria-label="周任务原生产记录" className="space-y-4 rounded-xl border p-5">
    <h2 className="text-lg font-bold">这条任务的生产记录</h2><p className="text-xs">任务 {target.contentTaskId} · 原运行 {target.runId}</p>
    {error?<p role="alert">{error}</p>:!view?<p role="status">正在核验原生产绑定与成片…</p>:<>
      {view.historical?<p>当前内容任务已有后续运行；此处展示原运行的成片与逐镜记录。</p>:<SocialAgentWorkflowPanel task={view.task}/>}
      {view.artifact&&<div><p>原成片 {view.artifact.artifactId} · {view.artifact.version} · {view.artifact.status}</p><button type="button" onClick={()=>setPreview(true)} className="btn-primary mt-2">预览这条成片</button></div>}
      {view.scenes&&<ol className="space-y-2">{view.scenes.scenes.map(scene=><li key={scene.sceneId} className="rounded-lg border p-3 text-sm">分镜 {scene.sceneId} · 镜头 {scene.shotId} · {scene.status}<p className="text-xs">原技术凭据 {scene.technicalReceiptId}</p></li>)}</ol>}
      {view.binding.gaps.map(gap=><p key={gap} className="text-xs">待核验：{gap}</p>)}
      {preview&&view.artifact&&<SocialArtifactPreviewDialog artifact={view.artifact} onClose={()=>setPreview(false)}/>}
    </>}
  </section>;
}
