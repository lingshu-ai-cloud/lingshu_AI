import { useEffect, useRef, useState } from 'react';
import { weeklyCustomerRunApi, type WeeklyCustomerRunCandidate } from '../../lib/weeklyCustomerRunApi';
export default function WeeklyCustomerRunBinding({ programId, packageId, packageVersion, profile, onBound }: {
  programId:string;packageId:string;packageVersion:number;profile:'b2b_cold_start'|'b2b_established';onBound?:()=>void;
}) {
  const identity=JSON.stringify([programId,packageId,packageVersion]);
  const activeIdentity=useRef(identity);activeIdentity.current=identity;
  const [snapshot,setSnapshot]=useState<{identity:string;items:WeeklyCustomerRunCandidate[];boundRunId:string|null}|null>(null);
  const [selected,setSelected]=useState<{identity:string;runId:string}|null>(null);
  const [revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false);const [error,setError]=useState<{identity:string;message:string}|null>(null);
  useEffect(()=>{let active=true;setSelected(null);setError(null);setBusy(false);
    void weeklyCustomerRunApi.candidates(programId,packageId,packageVersion).then(result=>{if(active)setSnapshot({identity,...result});}).catch(error=>{if(active)setError({identity,message:error instanceof Error?error.message:'运行读取失败'});});
    return()=>{active=false;};
  },[identity,programId,packageId,packageVersion,revision]);
  useEffect(()=>{const refresh=()=>setRevision(value=>value+1);window.addEventListener('lingshu:agent-business-refresh',refresh);return()=>window.removeEventListener('lingshu:agent-business-refresh',refresh);},[]);
  const result=snapshot?.identity===identity?snapshot:null;const runId=selected?.identity===identity?selected.runId:'';
  const chosen=result?.items.find(item=>item.runId===runId);const message=error?.identity===identity?error.message:null;
  const bind=async()=>{if(!chosen||chosen.bindingConflict||result?.boundRunId)return;setBusy(true);setError(null);
    try {const bound=await weeklyCustomerRunApi.bind(programId,packageId,packageVersion,chosen.runId);if(activeIdentity.current!==identity)return;setSnapshot(current=>current?.identity===identity?{...current,boundRunId:bound.item.run_id}:current);window.dispatchEvent(new Event('lingshu:agent-business-refresh'));onBound?.();}
    catch(error){if(activeIdentity.current===identity)setError({identity,message:error instanceof Error?error.message:'绑定失败'});}finally{if(activeIdentity.current===identity)setBusy(false);}
  };
  return <section className="mx-5 my-4 space-y-3 rounded-lg border border-orange-200 bg-white p-4">
    <div className="flex items-center justify-between gap-3"><h4 className="text-sm font-bold text-slate-900">绑定本周客服生产运行</h4><button type="button" disabled={busy} onClick={()=>setRevision(value=>value+1)} className="text-xs font-bold text-orange-700 disabled:opacity-40">刷新真实运行</button></div>
    <p className="text-xs leading-5 text-slate-600">{profile==='b2b_cold_start'?'零基础用户应选择本周真实新询盘客群；没有新询盘时保留无数据。':'有基础用户应分别核对老客跟进和本周新询盘的范围及历史上下文。'} 当前运行尚无可核验的项目来源分类，请核对客群后明确选择。</p>
    {message&&<p role="alert" className="text-xs text-rose-700">{message}</p>}
    {result?.boundRunId?<p className="text-xs text-orange-800">已绑定真实运行：{result.items.find(item=>item.runId===result.boundRunId)?.title||result.boundRunId} · 周包 v{packageVersion}</p>:<>
      <select aria-label="选择真实客服生产运行" value={runId} disabled={!result||busy} onChange={event=>setSelected({identity,runId:event.target.value})} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"><option value="">{result?'请选择具体运行':'正在读取真实运行…'}</option>{result?.items.map(item=><option key={item.runId} value={item.runId} disabled={item.bindingConflict}>{item.title} · {item.runId} · {item.status}{item.bindingConflict?' · 已关联其他周包':''}</option>)}</select>
      {result&&result.items.length===0&&<p className="text-xs text-slate-600">本周没有可绑定的客服生产运行。请先在客服经营目标中建立对应运行。</p>}
      {chosen&&<p className="text-xs text-slate-600">经营窗口：{chosen.startsAt} — {chosen.endsAt} · 客服阶段 {chosen.customerTaskKeys.length} 项</p>}
      <button type="button" disabled={!chosen||chosen.bindingConflict||busy} onClick={()=>void bind()} className="rounded-lg bg-orange-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">{busy?'正在绑定…':'绑定所选真实运行'}</button>
    </>}
  </section>;
}
