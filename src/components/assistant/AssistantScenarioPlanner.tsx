import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Select, Spin } from 'antd';
import type { AssistantCreationPortal } from '../../../shared/contracts/assistantCreationPortal';
import { studioApi } from '../../lib/studioApi';
import { socialContentApi } from '../../lib/socialContentApi';
import { scenarioTaskInputs } from '../../lib/assistantScenarioIntake';
import { resumeSceneTaskBatch } from '../../lib/assistantSceneTaskBatch';
import { useAssistantScenePortal } from './useAssistantScenePortal';
import AssistantTaskLinkCard from './AssistantTaskLinkCard';
import { productionPortalNavigation } from './AssistantProductionPortal';
import { useAssistantStore } from '../../stores/assistantStore';
import AssistantSceneDateInput from './AssistantSceneDateInput';
import { useDefaultVideoPublishTime } from '../../lib/useDefaultVideoPublishTime';

const DIRECTIONS=[
  {label:'场景引入',value:'提出一个真实使用场景，衔接所选产品的已确认用途，结尾邀请用户咨询产品资料。'},
  {label:'问题解答',value:'提出一个与产品有关的问题，依据企业资料说明解决思路，结尾邀请用户提出具体需求。'},
  {label:'过程展示',value:'展示所选产品的真实使用或生产过程，结尾邀请用户了解产品或合作信息。'},
];
/** Existing ordinary task form; hook and campaign now use the verified guided route. */
export default function AssistantScenarioPlanner({portal}:{portal:AssistantCreationPortal}) {
  const {current,update,navigate}=useAssistantScenePortal(portal);
  const suggestedTime=useDefaultVideoPublishTime(portal.sceneStep==='brief'&&portal.plannedPublishAt===undefined);
  useEffect(()=>{if(suggestedTime&&portal.plannedPublishAt===undefined&&current())update({plannedPublishAt:suggestedTime});},[suggestedTime,portal.plannedPublishAt]);
  const [products,setProducts]=useState<Array<{id:string;name:string}>>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false),lock=useRef(false);
  useEffect(()=>{let active=true;setLoading(true);void studioApi.materialProducts().then(result=>{if(active&&current())setProducts(result.items);}).catch(()=>{if(active&&current())setError('产品读取失败，请重试。');}).finally(()=>{if(active&&current())setLoading(false);});return()=>{active=false;};},[revision]);
  const selected=portal.selectedProducts||[],receipts=portal.createdTasks||[];
  const patchReceipt=(receipt:NonNullable<AssistantCreationPortal['createdTasks']>[number])=>{
    if(!current())return;
    const latest=useAssistantStore.getState().threads.business.messages.find(m=>m.creationPortal?.id===portal.id)?.creationPortal;
    update({createdTasks:[...(latest?.createdTasks||[]).filter(row=>row.itemId!==receipt.itemId),receipt]});
  };
  const submit=async()=>{
    if(lock.current||!current())return;lock.current=true;setBusy(true);setError('');
    try {
      const rows=scenarioTaskInputs(portal);update({submissionLocked:true});
      await resumeSceneTaskBatch({groupId:portal.id,rows,receipts,current,onReceipt:patchReceipt,create:socialContentApi.createTask,
        start:async(taskId:string)=>{const task=await socialContentApi.getTask(taskId);return socialContentApi.startAssistantAction(taskId,task.version,`assistant-start:${taskId}:${task.version}`);}});
    }catch(cause){if(current())setError(cause instanceof Error?cause.message:'确认结果待核验，请重试原请求。');}
    finally{lock.current=false;setBusy(false);}
  };
  if(portal.submissionLocked)return <section aria-label="场景任务确认结果" className="mt-3 space-y-3">
    {receipts.map(receipt=><AssistantTaskLinkCard key={receipt.itemId} title={receipt.title} description={`内容任务 · ${{saved:'待调度',queued:'已入队',running:'执行中',blocked:'待介入'}[receipt.executionState||'saved']}`} onOpen={()=>navigate(productionPortalNavigation(receipt.taskId))}/>)}
    {error&&<Alert type="warning" title={error}/>}
    {(!receipts.length||error||receipts.some(receipt=>!receipt.startRequested))&&<div className="flex justify-end"><Button loading={busy} onClick={()=>void submit()}>重试未完成项</Button></div>}
  </section>;
  if(portal.sceneStep==='summary')return <section aria-label="场景任务总确认" className="mt-3 space-y-3">
    <p className="text-sm font-semibold">内容创作任务</p><p className="text-sm">产品：{selected.map(p=>p.name).join('、')}</p>
    <p className="text-sm">{portal.direction}</p><p className="text-xs">预计 {portal.plannedPublishAt?.replace('T',' ')} 发布（北京时间）</p>
    {error&&<Alert type="warning" title={error}/>}
    <div className="flex justify-end gap-2"><Button disabled={busy} onClick={()=>update({sceneStep:'brief'})}>修改信息</Button><Button type="primary" loading={busy} onClick={()=>void submit()}>确认本条创作任务</Button></div>
  </section>;
  return <section aria-label={portal.title} className="mt-3 space-y-3">
    <p className="text-sm">这次准备推广哪些产品？可选择一款或多款。</p>
    {loading&&<Spin size="small"/>}
    <Select mode="multiple" showSearch optionFilterProp="label" className="w-full" aria-label="场景推广产品" maxTagCount="responsive" placeholder="搜索并选择产品" loading={loading}
      value={selected.map(p=>p.id)} options={products.map(p=>({value:p.id,label:p.name}))} onChange={ids=>update({selectedProducts:ids.flatMap(id=>products.filter(p=>p.id===id))})}/>
    <p className="text-xs text-text-secondary">确认这条内容的创作方向，也可以选择下方建议。具体产品事实由已有企业资料提供。</p>
    <Select className="w-full" aria-label="内容方向建议" placeholder="选择内容方向" options={DIRECTIONS} value={DIRECTIONS.find(item=>item.value===portal.direction)?.value} onChange={direction=>update({direction})}/>
    <Input.TextArea aria-label="内容方向" maxLength={1000} placeholder="核心内容与行动号召" value={portal.direction||''} onChange={e=>update({direction:e.target.value})}/>
    <label className="block text-xs">预计发布时间（北京时间）<AssistantSceneDateInput label="内容发布时间" value={portal.plannedPublishAt||''} onChange={plannedPublishAt=>update({plannedPublishAt})}/></label>
    <p className="text-xs text-text-secondary">默认按 09:00、16:00、18:00 顺序排期，可修改。</p>
    {error&&<Alert type="warning" title={error} action={<Button onClick={()=>{setError('');setRevision(v=>v+1);}}>重试</Button>}/>}
    <div className="flex justify-end"><Button type="primary" disabled={loading} onClick={()=>{try{scenarioTaskInputs(portal);setError('');update({sceneStep:'summary'});}catch(cause){setError(cause instanceof Error?cause.message:'信息待完善');}}}>确认信息</Button></div>
  </section>;
}
