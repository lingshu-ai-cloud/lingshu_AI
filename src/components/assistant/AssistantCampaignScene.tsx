import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Select, Upload } from 'antd';
import type { AssistantCreationPortal } from '../../../shared/contracts/assistantCreationPortal';
import { assistantScenePlanSchema } from '../../../shared/contracts/assistantScenePlan';
import { VIDEO_LANGUAGES } from '../../../shared/contracts/videoLanguages';
import { studioApi } from '../../lib/studioApi';
import { readScenePlan, submitScenePlan } from '../../lib/assistantScenePlanningApi';
import { useAssistantScenePortal } from './useAssistantScenePortal';
import AssistantReplicationScene from './AssistantReplicationScene';
import AssistantSceneDateInput from './AssistantSceneDateInput';
import AssistantTaskLinkCard from './AssistantTaskLinkCard';
import { productionPortalNavigation } from './AssistantProductionPortal';
import { useDefaultVideoPublishTime } from '../../lib/useDefaultVideoPublishTime';

type Draft = NonNullable<AssistantCreationPortal['campaignDraft']>;
const initial: Draft = {step:'assets',name:'',offer:'',sellingPoints:'',materials:[],languages:[],deliverBy:''};
/** Conversation steps collect business facts; all analysis/matching/submission uses existing creation services. */
export default function AssistantCampaignScene({portal}:{portal:AssistantCreationPortal}) {
  const {current,update,advance,navigate}=useAssistantScenePortal(portal);
  const draft=portal.campaignDraft||initial,plan=portal.scenePlan;
  const suggestedTime=useDefaultVideoPublishTime(draft.step==='facts'&&portal.plannedPublishAt===undefined&&Boolean(draft.deliverBy),draft.deliverBy);
  useEffect(()=>{if(suggestedTime&&portal.plannedPublishAt===undefined&&current())update({plannedPublishAt:suggestedTime});},[suggestedTime,portal.plannedPublishAt]);
  const [products,setProducts]=useState<Array<{id:string;name:string}>>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const lock=useRef(false);
  const [edits,setEdits]=useState(plan?.guided?.narration.lines||[]);
  const patch=(value:Partial<Draft>)=>update({campaignDraft:{...draft,...value}});
  useEffect(()=>{let active=true;void studioApi.materialProducts().then(value=>{if(active&&current())setProducts(value.items);}).catch(()=>{if(active&&current())setError('产品读取失败，请重新打开卡片。');});return()=>{active=false;};},[]);
  useEffect(()=>{setEdits(plan?.guided?.narration.lines||[]);},[plan?.guided?.fingerprint]);
  const perform=async(work:()=>Promise<void>)=>{if(lock.current||!current())return;lock.current=true;setBusy(true);setError('');try{await work();}catch(cause){if(current())setError(cause instanceof Error?cause.message:'操作失败，请重试。');}finally{lock.current=false;setBusy(false);}};
  const build=async()=>{
    if(!portal.selectedReferenceId)throw new Error('请先选择对标视频。');
    const scene=assistantScenePlanSchema.parse({kind:'campaign',groupId:portal.id,plannedPublishAt:new Date(`${portal.plannedPublishAt}+08:00`).toISOString(),deliverBy:new Date(`${draft.deliverBy}+08:00`).toISOString(),campaign:{name:draft.name,offer:draft.offer,sellingPoints:draft.sellingPoints,materialIds:draft.materials.map(row=>row.id)},narrationEdits:[],narrationConfirmed:false});
    let value=await readScenePlan({action:'guided_products',instruction:'依据用户已确认的活动信息和对标视频核验创作方案',selection:{referenceId:portal.selectedReferenceId,productIds:(portal.selectedProducts||[]).map(row=>row.id),shotIds:[],guided:{languages:draft.languages,customNodes:[],assignments:[],scene}}});
    if(!current())return;
    value=await readScenePlan({action:'guided_structure',instruction:'沿用用户确认的对标视频结构和原始口播',selection:{...value.selection,guided:{...value.selection.guided!,structureId:`reference:${portal.selectedReferenceId}`}}});
    if(!current())return;
    value=await readScenePlan({action:'guided_production',instruction:'按已有素材匹配说明性分镜，供用户核对口播',selection:{...value.selection,guided:{...value.selection.guided!,productionMode:'auto',presenterMode:portal.scenePresenterMode||'none'}}});
    if(current())advance({scenePlan:value,campaignDraft:{...draft,step:'narration'}},`已选对标视频：${value.referenceTitle}。`,`下面是对标视频的逐句口播，以及替换后的活动稿。请核对并修改。`);
  };
  const confirmNarration=async()=>{
    if(!plan?.selection.guided?.scene)throw new Error('方案已失效，请重新核验。');
    const value=await readScenePlan({action:'guided_review',instruction:'用户逐句编辑并确认口播，重新核验当前方案',selection:{...plan.selection,guided:{...plan.selection.guided,scene:{...plan.selection.guided.scene,narrationEdits:edits.map(row=>({lineId:row.lineId,text:row.text})),narrationConfirmed:true}}}});
    if(current())advance({scenePlan:value,campaignDraft:{...draft,step:'summary'}},`已确认活动口播：${edits.map(row=>row.text).join('；').slice(0,500)}`,`口播已记录。请核对分镜、素材匹配与执行依赖，然后确认创作。`);
  };
  const submit=async()=>{
    if(!plan)throw new Error('请重新核验方案。');
    update({submissionLocked:true});
    const receipt=await submitScenePlan(plan);
    if(current())update({createdTasks:[{itemId:'main',taskId:receipt.taskId,title:`${draft.name} · 活动内容`,executionState:receipt.executionState,startRequested:receipt.executionState==='running'||receipt.executionState==='queued'}]});
  };
  const receipt=portal.createdTasks?.[0];
  if(receipt)return <AssistantTaskLinkCard title={receipt.title} description={`活动内容 · ${{saved:'待调度',queued:'已入队',running:'执行中',blocked:'待介入'}[receipt.executionState||'saved']}`} onOpen={()=>navigate(productionPortalNavigation(receipt.taskId))}/>;
  return <section aria-label="为活动准备内容" className="mt-3 space-y-3" aria-busy={busy}>
    {error&&<Alert type="warning" title={error}/>}
    {draft.step==='assets'&&<>
      <p>请上传本次活动的视频，或先告诉我想讲的卖点。</p>
      <Upload accept="video/mp4,video/quicktime,video/webm" showUploadList={false} disabled={busy||draft.materials.length>=12} beforeUpload={file=>{void perform(async()=>{const result=await studioApi.uploadMaterialFile(file,{type:'video',sourceType:'upload'});if(!result.ok||!result.material)throw new Error(result.error||'上传失败');if(current())patch({materials:[...draft.materials,{id:result.material.id,name:result.material.name}]});});return false;}}><Button loading={busy}>上传活动视频</Button></Upload>
      {draft.materials.map(row=><p key={row.id} className="text-sm">{row.name}<Button type="link" disabled={busy} onClick={()=>patch({materials:draft.materials.filter(item=>item.id!==row.id)})}>移除</Button></p>)}
      <Input.TextArea aria-label="活动口播卖点" maxLength={1000} value={draft.sellingPoints} onChange={event=>patch({sellingPoints:event.target.value})} placeholder="本次活动希望传达哪些卖点？"/>
      <Button type="primary" disabled={busy||(!draft.materials.length&&!draft.sellingPoints.trim())} onClick={()=>advance({campaignDraft:{...draft,step:'facts'}},`活动素材：${draft.materials.map(row=>row.name).join('、')||'未上传'}；卖点：${draft.sellingPoints||'待从素材分析提取'}`, '这次活动叫什么？涉及哪些产品，优惠政策是什么？')}>确认素材与卖点</Button>
    </>}
    {draft.step==='facts'&&<>
      <p>这次活动叫什么？涉及哪些产品，优惠政策是什么？没有优惠也请明确说明。</p>
      <Input aria-label="活动名称" placeholder="活动名称" maxLength={120} value={draft.name} onChange={event=>patch({name:event.target.value})}/>
      <Select mode="multiple" showSearch optionFilterProp="label" aria-label="活动涉及产品" className="w-full" placeholder="选择产品" value={(portal.selectedProducts||[]).map(row=>row.id)} options={products.map(row=>({value:row.id,label:row.name}))} onChange={ids=>update({selectedProducts:products.filter(row=>ids.includes(row.id))})}/>
      <Input.TextArea aria-label="活动优惠政策" placeholder="优惠政策、适用条件，或明确填写无优惠" maxLength={500} value={draft.offer} onChange={event=>patch({offer:event.target.value})}/>
      <Select aria-label="活动出镜方式" className="w-full" value={portal.scenePresenterMode||'none'} options={[{value:'none',label:'素材画外音'},{value:'digital',label:'数字人出镜（需授权）'},{value:'shoot',label:'等待真人实拍'}]} onChange={scenePresenterMode=>update({scenePresenterMode})}/>
      <Select mode="multiple" aria-label="活动视频语言" className="w-full" placeholder="视频语言" value={draft.languages} options={Object.entries(VIDEO_LANGUAGES).map(([value,label])=>({value,label}))} onChange={languages=>patch({languages})}/>
      <label className="block text-xs">成片交付时间（北京时间）<AssistantSceneDateInput label="活动成片交付时间" value={draft.deliverBy} onChange={deliverBy=>patch({deliverBy})}/></label>
      <label className="block text-xs">预计发布时间（北京时间）<AssistantSceneDateInput label="活动预计发布时间" value={portal.plannedPublishAt||''} onChange={plannedPublishAt=>update({plannedPublishAt})}/></label>
      <p className="text-xs text-text-secondary">默认按 09:00、16:00、18:00 顺序排期，可修改。</p>
      <Button onClick={()=>patch({step:'assets'})}>修改素材与卖点</Button><Button type="primary" disabled={!draft.name.trim()||!draft.offer.trim()||!portal.selectedProducts?.length||!draft.languages.length||!draft.deliverBy||!portal.plannedPublishAt} onClick={()=>advance({campaignDraft:{...draft,step:'reference'}},`活动：${draft.name}；产品：${(portal.selectedProducts||[]).map(row=>row.name).join('、')}；优惠：${draft.offer}`, '活动信息已记录。请选择本次创作要对标的视频。')}>确认活动信息，选择对标视频</Button>
    </>}
    {draft.step==='reference'&&<><AssistantReplicationScene portal={portal} selectionOnly={{onChange:update,onConfirm:()=>void perform(build)}}/><Button disabled={busy} onClick={()=>patch({step:'facts'})}>修改活动信息</Button></>}
    {draft.step==='narration'&&<>
      <p>沿用「{plan?.guided?.narration.sourceTitle}」的口播结构，已按企业资料替换身份。请逐句核对活动名称、产品和优惠政策，可直接修改。</p>
      <p className="text-sm">{draft.name} · {draft.offer}</p><p className="text-sm">{draft.sellingPoints}</p>
      {edits.map((row,index)=><label key={row.lineId} className="block text-xs">第 {index+1} 句 · 原片：{row.sourceText}<Input.TextArea aria-label={`活动口播第${index+1}句`} value={row.text} maxLength={1500} onChange={event=>setEdits(values=>values.map(line=>line.lineId===row.lineId?{...line,text:event.target.value}:line))}/></label>)}
      {!edits.length&&<Alert type="warning" title="当前对标视频没有可复用的原始口播，请先补齐分析或更换对标。"/>}
      <Button disabled={busy} onClick={()=>patch({step:'reference'})}>更换对标视频</Button><Button type="primary" loading={busy} disabled={!edits.length||edits.some(row=>!row.text.trim())} onClick={()=>void perform(confirmNarration)}>确认口播，核对创作方案</Button>
    </>}
    {draft.step==='summary'&&<>
      <p>{draft.name} · {(portal.selectedProducts||[]).map(row=>row.name).join('、')}</p>
      <p className="whitespace-pre-wrap text-sm">{plan?.guided?.narration.text}</p>
      <p className="text-xs">确认后进入内容创作任务，按原队列完成素材匹配、配音、渲染和质检；在任务详情查看成片及待介入项。</p>
      {plan?.guided?.blockers.map((row,index)=><Alert key={`${row.code}:${index}`} type="warning" title={row.message}/>)}
      <Button disabled={busy||portal.submissionLocked} onClick={()=>patch({step:'narration'})}>修改口播</Button><Button loading={busy} type="primary" disabled={!!plan?.guided?.blockers.length} onClick={()=>void perform(submit)}>{portal.submissionLocked?'核验并重试原任务':'确认并开始创作'}</Button>
    </>}
  </section>;
}
