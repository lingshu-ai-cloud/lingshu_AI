import {restoreLocalCustomerPatch} from '../../hooks/localCustomerProfile';
import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Drawer,Input,Space,Tag} from 'antd';
import {localCustomerPreviewEnabled} from '../../lib/localCustomerSimulation';
import {authHeader} from '../../lib/auth';
import type {CustomerProfile} from '../../types/customer';
import type {CustomerChannelSendRequest} from '../../../shared/contracts/customerChannelSendRequest';
const statusLabel:Record<string,string>={draft:'待审核',pending:'待审批',approved:'已批准',rejected:'已退回',superseded:'已失效'};
const generationNotice=(result:{status:string;generationSource:string})=>result.generationSource==='provider_generated'&&result.status==='waiting_human'?'真实 AI 草稿已生成，原流程要求人工接管并审批。':result.status==='succeeded'&&result.generationSource==='provider_generated'?'已取得真实 AI 草稿，请人工核对。':'原流程返回了待核对或降级结果，不能记为真实生成验收通过。';
const errorLabel:Record<string,string>={preview_send_body_changed:'回复与已批准正文不同，请重新配置并审批。',preview_approved_batch_required:'请先批准当前版本，再发送。',preview_approval_changed:'审批版本已变化，请读取当前批次后再审批。',preview_session_not_found:'当前登录身份无法访问这个模拟会话。',not_found:'本地模拟服务未开启，请检查当前预览服务。'};
export interface Snapshot {
 simulation:true;sessionId:string;customer:{timeline:CustomerProfile['timeline'];lastActiveAt?:number;lastActive?:string}|null;pendingDraft:string;replyRequestId:string;
 batch:{version:number;status:string;content_hash:string}|null;items:Array<{content_hash:string;draft_body:string;status:string}>;
 approval:{status:string;subject_version:number;content_hash:string}|null;
 manual:{active:boolean;item:{version:number}|null}|null;send:CustomerChannelSendRequest|null;transportCalls:number;generationCalls:number;
 template:{body:string};translation?:string;profile?:Partial<CustomerProfile>;
}
export function localCustomerSimulationPatch(customer:CustomerProfile,s:Pick<Snapshot,'profile'|'customer'|'pendingDraft'|'send'|'items'|'batch'|'sessionId'>):CustomerProfile {
 const item=s.items[0];
 return restoreLocalCustomerPatch(customer,{
  ...s.profile,
  ...(s.customer?{timeline:s.customer.timeline,source:'messenger',language:'英语',stage:'inquiry',lastActiveAt:s.customer.lastActiveAt,lastActive:s.customer.lastActive}:{}),
  pendingDraft:s.send?.status==='accepted'?undefined:(s.batch?.status==='approved'?item?.draft_body:s.pendingDraft)||undefined,
  localSimulation:{sessionId:s.sessionId,itemHash:item?.content_hash,approvedBody:s.batch?.status==='approved'?item?.draft_body:undefined},
 });
}
async function call(path:string,body:unknown):Promise<Snapshot>{
 const authorization=authHeader().Authorization;
 const response=await fetch(`/api/overseas/customer-simulation/${path}`,{method:'POST',headers:{...authHeader(),'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json();if(authorization!==authHeader().Authorization)throw Error('登录已变化，请重新打开模拟会话。');
 if(!response.ok)throw Error(errorLabel[data.error]||'本地模拟操作失败，请恢复原会话后重试。');return data;
}
export default function LocalCustomerSimulation({customer,onPatch}:{customer:CustomerProfile;onPatch:(patch:Partial<CustomerProfile>)=>void}){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [buyer,setBuyer]=useState('Hello, please send product information.'),[draft,setDraft]=useState(''),[translation,setTranslation]=useState('');
 const [fault,setFault]=useState(false),[recovered,setRecovered]=useState('');
 const live=useRef(true),patch=useRef(onPatch),currentCustomer=useRef(customer);patch.current=onPatch;currentCustomer.current=customer;
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const apply=(s:Snapshot)=>{if(!live.current)return;setSnapshot(s);setDraft(s.pendingDraft);const next=localCustomerSimulationPatch(currentCustomer.current,s);currentCustomer.current=next;patch.current(next);};
 const run=async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await fn();}catch(e){if(live.current)setError(e instanceof Error?e.message:'本地操作失败');}finally{if(live.current)setBusy(false);}};
 const start=async()=>apply(await call('sessions',{customerId:customer.id}));
 const act=async(action:string,body:Record<string,unknown>={})=>{if(!snapshot)throw Error('请先开启本地模拟');const next=await call(`sessions/${snapshot.sessionId}/actions`,{action,...body});apply(next);return next;};
 useEffect(()=>{void run(start);},[customer.id]);
 const generate=async()=>{
  if(!snapshot)return;const requestId=crypto.randomUUID(),authorization=authHeader().Authorization;
  const response=await fetch(`/api/overseas/customer-simulation/sessions/${snapshot.sessionId}/draft`,{method:'POST',headers:{...authHeader(),'Content-Type':'application/json'},body:JSON.stringify({requestId})});
  const result=await response.json();if(authorization!==authHeader().Authorization||!live.current)return;if(!response.ok)throw Error(result.error||'草稿生成失败');
  await act('read');setRecovered(generationNotice(result));
 };
 const recoverDraft=async()=>{
  if(!snapshot?.replyRequestId)return;const response=await fetch(`/api/overseas/customer-simulation/sessions/${snapshot.sessionId}/draft/${snapshot.replyRequestId}`,{headers:authHeader()});
  const result=await response.json();if(!response.ok)throw Error(result.error||'原草稿读取失败');if(!live.current)return;setDraft(result.translatedDraft||result.draft);setRecovered('原草稿已读取；没有重新生成。'+generationNotice(result));
 };
 return <Space orientation="vertical" className="w-full">
  <Alert type="info" showIcon title="本地受控模拟 · 无真实渠道授权" description="复用原入站、草稿请求、人工接管、模板配置、审批及发送账本。草稿与翻译调用现有真实 AI；客户收发及回执仍由本地适配器模拟，不调用真实渠道。"/>
  {error&&<Alert role="alert" type="error" showIcon title={error}/>}
  <Space wrap><Button disabled={busy} onClick={()=>void run(start)}>恢复本地模拟</Button><Tag>{snapshot?.manual?.active?'人工接管中':'未接管'}</Tag><Tag>批次：{statusLabel[snapshot?.batch?.status||'']||'待准备'}</Tag><Tag>审批：{statusLabel[snapshot?.approval?.status||'']||'待提交'}</Tag></Space>
  <label className="text-sm text-text-primary">模拟客户输入<Input.TextArea aria-label="模拟客户输入" value={buyer} onChange={e=>setBuyer(e.target.value)} rows={2}/></label>
  <Button disabled={busy||!snapshot||!buyer.trim()} onClick={()=>void run(async()=>{await act('inbound',{text:buyer,eventId:crypto.randomUUID()});setRecovered('客户消息已通过原入站处理并持久保存。');})}>接收模拟消息</Button>
  <Space wrap><Button disabled={busy||!snapshot?.customer} onClick={()=>void run(generate)}>生成真实 AI 草稿</Button><Button disabled={busy||!snapshot?.replyRequestId} onClick={()=>void run(recoverDraft)}>读取原草稿</Button></Space>
  <label className="text-sm text-text-primary">回复草稿<Input.TextArea aria-label="本地模拟回复草稿" value={draft} onChange={e=>{setDraft(e.target.value);setTranslation('');}} rows={3}/></label>
  <Space wrap><Button disabled={busy||!draft.trim()} onClick={()=>void run(async()=>{await act('save-draft',{text:draft});setRecovered('草稿已持久保存，刷新后可恢复。');})}>保存模拟草稿</Button><Button disabled={busy||!draft.trim()} onClick={()=>void run(async()=>{const next=await act('translate',{text:draft});setTranslation(next.translation||'');})}>真实 AI 翻译</Button></Space>
  {translation&&<Alert type="success" title="AI 译文" description={translation}/>}
  <Space wrap><Button disabled={busy||!snapshot?.customer} onClick={()=>void run(async()=>{await act('hold');})}>人工接管十分钟</Button><Button disabled={busy||!snapshot?.manual?.active} onClick={()=>void run(async()=>{await act('release');})}>释放原接管</Button></Space>
  <Space wrap><Button disabled={busy||!snapshot?.pendingDraft||!!snapshot.send} onClick={()=>void run(async()=>{await act('prepare-template');})}>配置原模板并提交审批</Button><Button disabled={busy||snapshot?.approval?.status!=='pending'} onClick={()=>void run(async()=>{await act('approve',{version:snapshot!.approval!.subject_version,contentHash:snapshot!.approval!.content_hash});})}>批准当前模板批次</Button><Button disabled={busy||snapshot?.approval?.status!=='pending'} onClick={()=>void run(async()=>{await act('reject',{version:snapshot!.approval!.subject_version,contentHash:snapshot!.approval!.content_hash});})}>退回当前模板批次</Button></Space>
  {snapshot?.items[0]&&<Alert type="info" title="冻结模板正文" description={snapshot.items[0].draft_body}/>}
  <Space wrap><Button aria-pressed={fault} disabled={busy||!!snapshot?.send} onClick={()=>setFault(v=>!v)}>{fault?'已开启：下次会话记录写入失败':'模拟一次会话记录写入失败'}</Button><Button disabled={busy||snapshot?.batch?.status!=='approved'} onClick={()=>void run(async()=>{await act(fault?'send-history-failure':'send',{contentHash:snapshot!.items[0].content_hash});})}>发送已批准内容（本地）</Button><Button disabled={busy||!snapshot?.send} onClick={()=>void run(async()=>{await act('recover');setRecovered('已读取原发送账本并修复会话记录，没有重复传输。');})}>恢复原发送记录</Button><Button disabled={busy||snapshot?.send?.status!=='accepted'||snapshot.send.historyWritebackPending} onClick={()=>void run(async()=>{await act('receipt');})}>接收模拟送达回执</Button></Space>
  {snapshot?.send&&<Alert type={snapshot.send.historyWritebackPending?'warning':'success'} title={snapshot.send.historyWritebackPending?'传输已接受，会话记录写入待恢复':snapshot.send.deliveryStatus==='delivered'?'模拟回执：已送达':'模拟传输已接受'} description={`本地传输次数 ${snapshot.transportCalls}；生成次数 ${snapshot.generationCalls}。读取或恢复不会再次传输。`}/>}
  {recovered&&<p role="status" className="text-xs text-text-secondary">{recovered}</p>}
 </Space>;
}

export function LocalCustomerSimulationLauncher({customer,onPatch}:{customer:CustomerProfile;onPatch?:(patch:Partial<CustomerProfile>)=>void}){
 const [open,setOpen]=useState(false);
 // Explicit local QA switch: the ordinary conversation surface has no simulator entry.
 if(!customer.isMock||!localCustomerPreviewEnabled()||!onPatch||new URLSearchParams(window.location.search).get('customerSimulation')!=='1')return null;
 return <><Button onClick={()=>setOpen(true)}>本地模拟链路</Button><Drawer title="本地模拟链路" open={open} onClose={()=>setOpen(false)} size="large" destroyOnHidden><LocalCustomerSimulation key={customer.id} customer={customer} onPatch={onPatch}/></Drawer></>;
}
