import { useRef, useState } from 'react';
import { Alert, Button } from 'antd';
import type { SocialContentArtifact, SocialContentTaskDetail } from '../../../shared/contracts/socialContentWorkflow';
import { socialContentApi } from '../../lib/socialContentApi';
import { socialArtifactGenerationDisclosure } from '../../lib/socialArtifactGeneration';
import { productionNavigationIdentity } from '../../lib/productionNavigation';
import { ArtifactPanel } from './SocialTaskOverview';
import { ArtifactChangesDialog, ArtifactBatchChangesDialog } from './SocialTaskActionDialogs';

export default function CreationTaskArtifacts({task,onChanged}:{task:SocialContentTaskDetail;onChanged:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[change,setChange]=useState<SocialContentArtifact|null>(null),[batch,setBatch]=useState(false);
  const lock=useRef(false),identity=useRef(productionNavigationIdentity());
  const operationKey=async(scope:string,input:unknown)=>{
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([scope,task.taskId,input])));
    if(identity.current!==productionNavigationIdentity())throw Error('登录身份已变化，请重新打开该任务。');
    return `creation-detail:${Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('')}`;
  };
  const mutate=async(action:()=>Promise<unknown>)=>{
    if(lock.current||identity.current!==productionNavigationIdentity())return;
    lock.current=true;setBusy(true);setError('');
    try{await action();if(identity.current===productionNavigationIdentity()){setChange(null);setBatch(false);onChanged();}}
    catch(cause){if(identity.current===productionNavigationIdentity())setError(cause instanceof Error?cause.message:'操作结果待核验，请刷新后重试。');}
    finally{lock.current=false;setBusy(false);}
  };
  const decide=(artifact:SocialContentArtifact,decision:'approved'|'changes_requested',note:string|null=null)=>mutate(async()=>{
    const input={expectedVersion:artifact.version,decision,note};
    await socialContentApi.decideArtifact(task.taskId,artifact.artifactId,input,await operationKey(`artifact:${artifact.artifactId}`,input));
  });
  const decideBatch=(decision:'approved'|'changes_requested',note:string|null=null)=>mutate(async()=>{
    const artifacts=task.artifacts.filter(a=>a.status==='review_required'&&(decision!=='approved'||socialArtifactGenerationDisclosure(a).approvalAllowed)).map(a=>({artifactId:a.artifactId,expectedVersion:a.version}));
    if(!artifacts.length)throw Error('当前没有可验收的成品。');
    const input={artifacts,decision,note};await socialContentApi.decideArtifactBatch(task.taskId,input,await operationKey('batch',input));
  });
  return <div className="space-y-3">
    {error&&<Alert type="warning" title={error}/>}
    <ArtifactPanel task={task} busy={busy} onArtifactDecision={(artifact,decision)=>decision==='changes_requested'?setChange(artifact):void decide(artifact,decision)} onBatchDecision={decision=>decision==='changes_requested'?setBatch(true):void decideBatch(decision)} onCreateDeliveryPackage={()=>void mutate(async()=>{const artifactIds=task.artifacts.filter(a=>a.status==='approved').map(a=>a.artifactId).sort();const input={expectedTaskVersion:task.version,artifactIds};await socialContentApi.createDeliveryPackage(task.taskId,input,await operationKey('delivery',input));})}/>
    {task.deliveryPackages.filter(p=>p.downloadHref&&(p.status==='ready'||p.status==='confirmed')).map(p=><Button key={p.packageId} loading={busy} onClick={()=>void mutate(()=>socialContentApi.downloadPackage(p.downloadHref!))}>下载交付包</Button>)}
    {change&&<ArtifactChangesDialog artifact={change} busy={busy} onClose={()=>{if(!busy)setChange(null);}} onSubmit={note=>decide(change,'changes_requested',note)}/>}
    {batch&&<ArtifactBatchChangesDialog count={task.artifacts.filter(a=>a.status==='review_required').length} busy={busy} onClose={()=>{if(!busy)setBatch(false);}} onSubmit={note=>decideBatch('changes_requested',note)}/>}
  </div>;
}
