import {useEffect,useRef,useState} from 'react';
import {authApi,getToken,type EmployeeAccount} from '../../lib/auth';
import {weeklyCustomerSendRecoveryApi,type WeeklyCustomerSendRecoveryScope} from '../../lib/weeklyCustomerSendRecoveryApi';
import type {WeeklyCustomerSendRecovery,WeeklyCustomerSendRecoverySource} from '../../../shared/contracts/weeklyCustomerSendRecovery';

export const customerSendRecoveryPanelId=(s:WeeklyCustomerSendRecoveryScope)=>`customer-send-recovery:${encodeURIComponent(s.tenantId)}:${encodeURIComponent(s.programId)}:${encodeURIComponent(s.packageId)}:${s.packageVersion}`;
export const customerSendRecoveryRequestId=(s:WeeklyCustomerSendRecoveryScope,id:string)=>`${customerSendRecoveryPanelId(s)}:${encodeURIComponent(id)}`;
export const scopePanelId=customerSendRecoveryPanelId;
export const requestPanelId=customerSendRecoveryRequestId;
export const validRecoveryDeadline=(value:string)=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
export const recoverySourceKey=(s:Pick<WeeklyCustomerSendRecoverySource,'runId'|'itemId'>)=>JSON.stringify([s.runId,s.itemId]);
export function recoveryInScope(s:WeeklyCustomerSendRecoveryScope,r:WeeklyCustomerSendRecovery){return r.tenantId===s.tenantId&&r.programId===s.programId&&r.packageId===s.packageId&&r.packageVersion===s.packageVersion&&r.channel==='whatsapp';}
export function verifiedRecoveryProof(item:WeeklyCustomerSendRecovery){const p=item.resolvedProof;return item.status==='resolved'&&!!p&&p.taskId===item.taskId&&p.runId===item.runId&&p.receiptIds.length>0&&new Set(p.receiptIds).size===p.receiptIds.length&&p.receiptIds.every(id=>typeof id==='string'&&!!id.trim())&&/^[a-f0-9]{64}$/.test(p.evidenceHash)&&validRecoveryDeadline(p.verifiedAt);}
export function signedRecoveryComplete(r:{item:WeeklyCustomerSendRecovery;recoveredTaskId:string;runAdvanced:false;messagesSent:0},s:WeeklyCustomerSendRecoveryScope,previous:WeeklyCustomerSendRecovery){return recoveryInScope(s,r.item)&&r.item.id===previous.id&&r.item.runId===previous.runId&&r.item.itemId===previous.itemId&&verifiedRecoveryProof(r.item)&&!!r.item.resolvedAt&&r.item.version>=previous.version&&r.recoveredTaskId===previous.taskId&&r.runAdvanced===false&&r.messagesSent===0;}

export default function WeeklyCustomerSendRecoveryPanel({tenantId,programId,packageId,packageVersion,onChanged}:{tenantId:string;programId:string;packageId:string;packageVersion:number;onChanged?:(items:WeeklyCustomerSendRecovery[])=>void}){
 const scope={tenantId,programId,packageId,packageVersion};
 const [token,setToken]=useState(()=>getToken());
 const identity=JSON.stringify([tenantId,programId,packageId,packageVersion,token]);
 const current=useRef(identity);current.current=identity;
 const generation=useRef(0),mutation=useRef(false);
 const [snapshot,setSnapshot]=useState<{identity:string;items:WeeklyCustomerSendRecovery[];sources:WeeklyCustomerSendRecoverySource[];employees:EmployeeAccount[]}|null>(null);
 const [source,setSource]=useState(''),[owner,setOwner]=useState(''),[deadline,setDeadline]=useState(''),[reason,setReason]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[unknown,setUnknown]=useState(false);
 const fresh=(captured:string,credential:string|null)=>current.current===captured&&getToken()===credential;
 useEffect(()=>{const sync=()=>setToken(getToken());const timer=window.setInterval(sync,1000);window.addEventListener('storage',sync);return()=>{window.clearInterval(timer);window.removeEventListener('storage',sync);};},[]);
 async function read(){const captured=identity,credential=getToken(),epoch=++generation.current;setBusy(true);setError('');try{
  if(!credential||credential!==token)throw Error('登录身份已改变，请重新读取。');
  const [items,sources,employees]=await Promise.all([weeklyCustomerSendRecoveryApi.list(scope),weeklyCustomerSendRecoveryApi.sources(scope),authApi.employees()]);
  if(!fresh(captured,credential)||generation.current!==epoch)return;
  if(items.some(r=>!recoveryInScope(scope,r))||new Set(items.map(r=>r.id)).size!==items.length||sources.some(r=>r.channel!=='whatsapp'||!r.runId||!r.itemId)||new Set(sources.map(recoverySourceKey)).size!==sources.length||new Set(employees.map(e=>e.id)).size!==employees.length)throw Error('真实来源或负责人身份不唯一，请核验。');
  setSnapshot({identity:captured,items,sources,employees});onChanged?.(items);
 }catch(e){if(fresh(captured,credential)&&generation.current===epoch){setSnapshot(null);setError(e instanceof Error?e.message:'读取失败');}}finally{if(fresh(captured,credential)&&generation.current===epoch)setBusy(false);}}
 useEffect(()=>{generation.current++;mutation.current=false;setSnapshot(null);setSource('');setOwner('');setDeadline('');setReason('');setError('');setUnknown(false);setBusy(false);if(token)void read();return()=>{generation.current++;};},[identity]);
 const data=snapshot?.identity===identity?snapshot:null;
 const selected=data?.sources.filter(s=>recoverySourceKey(s)===source);
 const selectedSource=selected?.length===1?selected[0]:undefined;
 const ownerValid=data?.employees.filter(e=>e.id===owner).length===1;
 async function write(item?:WeeklyCustomerSendRecovery){if(mutation.current||busy||unknown||!data)return;const captured=identity,credential=getToken();if(!fresh(captured,token)){setToken(credential);return;}
  if(!item&&(!selectedSource?.canCreate||!ownerValid||!validRecoveryDeadline(deadline)||!reason.trim()))return;
  mutation.current=true;generation.current++;setBusy(true);setError('');try{
   const result=item?await weeklyCustomerSendRecoveryApi.resolve(scope,item.id,item.version):await weeklyCustomerSendRecoveryApi.create(scope,{runId:selectedSource!.runId,itemId:selectedSource!.itemId,ownerUserId:owner,deadlineAt:deadline,reason:reason.trim()});
   if(!fresh(captured,credential))return;
   const actual=item?('item'in result?result.item:null):('id'in result?result:null);
   if(!actual||!recoveryInScope(scope,actual)||(item&&(!('item'in result)||!signedRecoveryComplete(result,scope,item)))||(!item&&(actual.runId!==selectedSource!.runId||actual.itemId!==selectedSource!.itemId||actual.ownerUserId!==owner||actual.deadlineAt!==deadline)))throw Error('后端核验回执与原请求不一致。');
   const items=[...data.items.filter(r=>r.id!==actual.id),actual];setSnapshot({...data,items});onChanged?.(items);
  }catch(e){if(fresh(captured,credential)){setUnknown(true);setError(e instanceof Error?e.message:'提交结果未知');}}
  finally{if(fresh(captured,credential)){mutation.current=false;setBusy(false);}}
 }
 return <section id={customerSendRecoveryPanelId(scope)} tabIndex={-1} data-recovery-tenant={tenantId} data-recovery-program={programId} data-recovery-package={packageId} data-recovery-version={packageVersion} data-tenant={tenantId} data-program={programId} data-package={packageId} data-version={packageVersion} className="scroll-mt-6 rounded-xl border p-4">
  <h3 className="font-bold">WhatsApp 原发送异常 · 人工补救</h3><p className="mt-2 text-xs">读取当前周包真实发送来源。核验仅检查后端签名发送凭据，不发送消息、不推进运行。</p>
  <button type="button" disabled={busy} onClick={()=>void read()} className="my-2 underline disabled:opacity-40">{busy?'正在核验…':'刷新真实来源与处理记录'}</button>
  {error&&<p role="alert" className="text-sm text-red-800">{error}</p>}{unknown&&<p role="alert" className="text-red-800">写入结果未知，已停止重复提交。请刷新并核对原处理记录；未核实前不能重提。</p>}
  {data&&!data.sources.length&&<p role="status" className="text-red-800">当前周包没有可核验的发送异常来源；请检查原客服运行及批准批次，尚不能创建处理对象。</p>}
  {data&&<div className="my-3 grid gap-2"><select aria-label="真实发送异常来源" disabled={busy||unknown} value={source} onChange={e=>setSource(e.target.value)}><option value="">明确选择原运行与发送项</option>{data.sources.map(s=><option key={recoverySourceKey(s)} value={recoverySourceKey(s)}>{s.runId} · {s.itemId} · {s.recipientMasked} · {s.status}{s.canCreate?'':' · 不可创建'}</option>)}</select>
   {selectedSource&&<p className="text-xs text-red-800">WhatsApp · 批次 {selectedSource.batchId} v{selectedSource.batchVersion} · {selectedSource.reason}</p>}
   <select aria-label="真实处理负责人" disabled={busy||unknown} value={owner} onChange={e=>setOwner(e.target.value)}><option value="">明确选择真实负责人</option>{data.employees.map(e=><option key={e.id} value={e.id}>{e.name||e.email} · {e.role}</option>)}</select>
   {!data.employees.length&&<p className="text-red-800">当前身份未读取到真实员工，不能指定负责人。</p>}
   <input aria-label="明确处理截止含时区" disabled={busy||unknown} value={deadline} onChange={e=>setDeadline(e.target.value)} placeholder="2026-10-10T18:00:00+08:00"/><input aria-label="真实异常处理说明" disabled={busy||unknown} value={reason} onChange={e=>setReason(e.target.value)} placeholder="填写实际处理原因"/>
   <button type="button" disabled={busy||unknown||!selectedSource?.canCreate||!ownerValid||!validRecoveryDeadline(deadline)||!reason.trim()} onClick={()=>void write()} className="underline disabled:opacity-40">明确创建此发送项的人工补救任务</button></div>}
  {data?.items.map(item=><article key={item.id} id={customerSendRecoveryRequestId(scope,item.id)} tabIndex={-1} data-tenant={item.tenantId} data-program={item.programId} data-package={item.packageId} data-version={item.packageVersion} data-recovery={item.id} data-id={item.id} data-run={item.runId} data-task={item.taskId} data-item={item.itemId} data-channel={item.channel} className={`my-3 rounded-lg border p-3 ${item.status==='resolved'?'border-emerald-300':'border-red-300 bg-red-50 text-red-900'}`}><strong>{item.status==='resolved'?(verifiedRecoveryProof(item)?'后端签名凭据与原任务已核验':'已记录解决 · 恢复凭据待核验'):'未解除发送受阻'} · WhatsApp</strong><p className="text-xs">负责人：{data.employees.find(e=>e.id===item.ownerUserId)?.name||item.ownerUserId} · 明确截止 {item.deadlineAt}</p><p className="text-xs">原运行 {item.runId} · 项 {item.itemId} · {item.recipientMasked} · {item.reason}</p>{item.status==='resolved'?<p className="text-xs">后端记录时间 {item.resolvedAt}；最近核验 {item.resolvedProof?.verifiedAt||'待核验'} · 凭据 {item.resolvedProof?.receiptIds.join('、')||'缺失'}</p>:<button type="button" disabled={busy||unknown} onClick={()=>void write(item)} className="mt-2 underline disabled:opacity-40">仅核验后端签名发送凭据（不发消息）</button>}</article>)}
 </section>;
}
