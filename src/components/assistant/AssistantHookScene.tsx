import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Select } from 'antd';
import type { AssistantCreationPortal } from '../../../shared/contracts/assistantCreationPortal';
import { assistantScenePlanSchema } from '../../../shared/contracts/assistantScenePlan';
import { VIDEO_LANGUAGES } from '../../../shared/contracts/videoLanguages';
import { studioApi } from '../../lib/studioApi';
import { readScenePlan, submitScenePlan } from '../../lib/assistantScenePlanningApi';
import { useAssistantScenePortal } from './useAssistantScenePortal';
import AssistantHookPicker from './AssistantHookPicker';
import AssistantReplicationScene from './AssistantReplicationScene';
import AssistantSceneDateInput from './AssistantSceneDateInput';
import AssistantTaskLinkCard from './AssistantTaskLinkCard';
import { productionPortalNavigation } from './AssistantProductionPortal';

export default function AssistantHookScene({portal}:{portal:AssistantCreationPortal}) {
  const {current,update,advance,navigate}=useAssistantScenePortal(portal);
  const [products,setProducts]=useState<Array<{id:string;name:string}>>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[edits,setEdits]=useState(portal.scenePlan?.guided?.narration.lines||[]);
  const lock=useRef(false),plan=portal.scenePlan;
  useEffect(()=>{let active=true;void studioApi.materialProducts().then(value=>{if(active&&current())setProducts(value.items);}).catch(()=>{if(active&&current())setError('产品读取失败，请重试。');});return()=>{active=false;};},[]);
  useEffect(()=>setEdits(plan?.guided?.narration.lines||[]),[plan?.guided?.fingerprint]);
  const perform=async(work:()=>Promise<void>)=>{if(lock.current||!current())return;lock.current=true;setBusy(true);setError('');try{await work();}catch(cause){if(current())setError(cause instanceof Error?cause.message:'操作失败，请重试。');}finally{lock.current=false;setBusy(false);}};
  const read=async()=>{
    if(!portal.hook||!portal.selectedReferenceId)throw new Error('请先确认开场片段和对标视频。');
    const scene=assistantScenePlanSchema.parse({kind:'hook_first',groupId:portal.id,plannedPublishAt:new Date(`${portal.plannedPublishAt}+08:00`).toISOString(),deliverBy:new Date(`${portal.plannedDeliveryAt}+08:00`).toISOString(),hook:{materialId:portal.hook.materialId,startSeconds:portal.hook.startSeconds,endSeconds:portal.hook.endSeconds,usage:portal.hook.usage,direction:portal.direction},narrationEdits:[],narrationConfirmed:false});
    let value=await readScenePlan({action:'guided_products',instruction:'核验选定开场、产品和参考视频',selection:{referenceId:portal.selectedReferenceId,productIds:(portal.selectedProducts||[]).map(row=>row.id),shotIds:[],guided:{languages:portal.videoLanguages||[],customNodes:[],assignments:[],scene}}});
    if(!current())return;
    value=await readScenePlan({action:'guided_structure',instruction:'以选定开场和原视频逐镜结构为准',selection:{...value.selection,guided:{...value.selection.guided!,structureId:`reference:${portal.selectedReferenceId}`}}});
    if(!current())return;
    value=await readScenePlan({action:'guided_production',instruction:'核验开场片段及各分镜素材匹配',selection:{...value.selection,guided:{...value.selection.guided!,productionMode:'auto',presenterMode:portal.scenePresenterMode||'none'}}});
    if(current())advance({scenePlan:value,sceneStep:'summary',hookReferenceStep:false},`已选对标视频：${value.referenceTitle}。`,'请核对开场片段和逐句口播，然后确认创作。');
  };
  const confirm=async()=>{
    if(!plan?.selection.guided?.scene)throw new Error('方案已失效，请重新核验。');
    const value=await readScenePlan({action:'guided_review',instruction:'用户确认口播和选定开场后复核方案',selection:{...plan.selection,guided:{...plan.selection.guided,scene:{...plan.selection.guided.scene,narrationEdits:edits.map(row=>({lineId:row.lineId,text:row.text})),narrationConfirmed:true}}}});
    if(current())advance({scenePlan:value,hookNarrationConfirmed:true},`已确认口播：${edits.map(row=>row.text).join('；').slice(0,500)}`,'口播已记录。请核对分镜、素材与执行依赖。');
  };
  const submit=async()=>{if(!plan)throw new Error('请先核验方案。');update({submissionLocked:true});const result=await submitScenePlan(plan);if(current())update({createdTasks:[{itemId:'hook',taskId:result.taskId,title:'开场创作任务',executionState:result.executionState,startRequested:result.executionState==='queued'||result.executionState==='running'}]});};
  const receipt=portal.createdTasks?.[0];
  if(receipt)return <AssistantTaskLinkCard title={receipt.title} description={`开场创作 · ${{saved:'待调度',queued:'已入队',running:'执行中',blocked:'待介入'}[receipt.executionState||'saved']}`} onOpen={()=>navigate(productionPortalNavigation(receipt.taskId))}/>;
  return <section aria-label="选定一个开场" className="mt-3 space-y-3" aria-busy={busy}>
    {error&&<Alert type="warning" title={error}/>}
    {portal.sceneStep==='source'&&<AssistantHookPicker portal={portal} update={patch=>{if(patch.hook&&patch.sceneStep==='brief')advance(patch,`选定开场：${patch.hook.name}，${patch.hook.startSeconds}–${patch.hook.endSeconds} 秒。`,'开场已选。请确认产品、内容方向与时间安排。');else update(patch);}} current={current}/>}
    {portal.sceneStep==='brief'&&<>
      <p>开场已选。请确认要带入的产品、衔接内容和交付安排。</p>
      <Select mode="multiple" showSearch optionFilterProp="label" aria-label="开场推广产品" className="w-full" placeholder="选择产品" value={(portal.selectedProducts||[]).map(row=>row.id)} options={products.map(row=>({value:row.id,label:row.name}))} onChange={ids=>update({selectedProducts:products.filter(row=>ids.includes(row.id))})}/>
      <Input.TextArea aria-label="开场衔接方向" placeholder="开场之后向客户讲什么？" maxLength={1000} value={portal.direction||''} onChange={event=>update({direction:event.target.value})}/>
      <Select aria-label="开场出镜方式" className="w-full" value={portal.scenePresenterMode||'none'} options={[{value:'none',label:'素材画外音'},{value:'digital',label:'数字人出镜（需授权）'},{value:'shoot',label:'等待真人实拍'}]} onChange={scenePresenterMode=>update({scenePresenterMode})}/>
      <Select mode="multiple" aria-label="开场视频语言" className="w-full" placeholder="视频语言" value={portal.videoLanguages||[]} options={Object.entries(VIDEO_LANGUAGES).map(([value,label])=>({value,label}))} onChange={videoLanguages=>update({videoLanguages})}/>
      <label className="block text-xs">成片交付时间（北京时间）<AssistantSceneDateInput label="开场成片交付时间" value={portal.plannedDeliveryAt||''} onChange={plannedDeliveryAt=>update({plannedDeliveryAt})}/></label>
      <label className="block text-xs">预计发布时间（北京时间）<AssistantSceneDateInput label="开场预计发布时间" value={portal.plannedPublishAt||''} onChange={plannedPublishAt=>update({plannedPublishAt})}/></label>
      <Button onClick={()=>update({sceneStep:'source'})}>更换开场</Button><Button type="primary" disabled={!portal.selectedProducts?.length||!portal.direction?.trim()||!portal.videoLanguages?.length||!portal.plannedDeliveryAt||!portal.plannedPublishAt} onClick={()=>advance({sceneStep:'summary',hookReferenceStep:true},`产品：${(portal.selectedProducts||[]).map(row=>row.name).join('、')}；方向：${portal.direction}`,'方向已记录。请选择用于口播和结构借鉴的对标视频。')}>确认方向，选择参考视频</Button>
    </>}
    {portal.sceneStep==='summary'&&portal.hookReferenceStep&&<>{portal.hook?.usage==='reference_only'&&<Alert type="info" title="仅作参考的开场，请选择它对应的同源对标视频；原画面不会进入企业成片。"/>}<AssistantReplicationScene portal={portal} selectionOnly={{onChange:update,onConfirm:()=>void perform(read)}}/><Button disabled={busy} onClick={()=>update({sceneStep:'brief'})}>修改方向</Button></>}
    {portal.sceneStep==='summary'&&!portal.hookReferenceStep&&<>
      <p>开场：{portal.hook?.name} · {portal.hook?.startSeconds}–{portal.hook?.endSeconds} 秒</p>
      <p className="text-sm">{portal.direction}</p>
      {edits.map((row,index)=><label key={row.lineId} className="block text-xs">第 {index+1} 句 · 原片：{row.sourceText}<Input.TextArea aria-label={`开场口播第${index+1}句`} maxLength={1500} value={row.text} onChange={event=>setEdits(values=>values.map(line=>line.lineId===row.lineId?{...line,text:event.target.value}:line))}/></label>)}
      {!portal.hookNarrationConfirmed&&<Button type="primary" loading={busy} disabled={!edits.length||edits.some(row=>!row.text.trim())} onClick={()=>void perform(confirm)}>确认口播和开场</Button>}
      {plan?.guided?.blockers.map((row,index)=><Alert key={`${row.code}:${index}`} type="warning" title={row.message}/>)}
      <Button disabled={busy} onClick={()=>update({sceneStep:'source',hookReferenceStep:false,hookNarrationConfirmed:false,scenePlan:undefined})}>更换开场</Button><Button disabled={busy} onClick={()=>update({hookReferenceStep:true,hookNarrationConfirmed:false,scenePlan:undefined})}>更换参考视频</Button>
      {portal.hookNarrationConfirmed&&<Button type="primary" loading={busy} disabled={!!plan?.guided?.blockers.length} onClick={()=>void perform(submit)}>确认本条创作任务</Button>}
    </>}
  </section>;
}
