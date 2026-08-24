import { useEffect, useState } from 'react';
import { Activity, ArrowRight, Clock3, FileCheck2, MessageSquareText, RefreshCw, Users } from 'lucide-react';
import { authHeader } from '../lib/auth';

interface PilotMetrics {
  status: 'collecting' | 'awaiting_real_pilot';
  generatedAt: string;
  sample: { events: number; customers: number };
  draft: { generated: number; adopted: number; edited: number; adoptionRate: number; editRate: number };
  evidence: { acquired: number; acquiredWithin3Turns: number };
  lifecycle: { advanced: number; rolledBack: number };
  handoff: { requested: number; viewed: number; accepted: number; medianViewMinutes: number | null; medianAcceptMinutes: number | null };
  funnel: { quotationsSent: number; won: number; lost: number; onHold: number };
  quality: { complaints: number; repeatedQuestions: number; humanCorrections: number };
  editReasons: string[];
  interpretation: string;
}

export default function SalesPilotPage() {
  const [metrics, setMetrics] = useState<PilotMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { const response = await fetch('/api/overseas/sales-operations/pilot', { headers: authHeader() }); if (response.ok) setMetrics(await response.json()); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  return <main className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70"><div className="mx-auto max-w-6xl px-6 py-6">
    <div className="flex items-start justify-between gap-5"><div><div className="flex items-center gap-2 text-violet-700"><Activity size={18}/><span className="text-xs font-bold">P5 真实验证</span></div><h1 className="mt-2 text-xl font-black text-slate-950">小规模试点看板</h1><p className="mt-1 text-sm text-slate-500">观察草稿采用、人工修改、证据获取、接管时效和交易结果；模拟客户事件不会写入这里。</p></div><button type="button" onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700"><RefreshCw size={14} className={loading ? 'animate-spin' : ''}/>刷新</button></div>
    {metrics && <>
      <section className={`mt-6 rounded-2xl border p-5 ${metrics.status === 'collecting' ? 'border-violet-200 bg-violet-50' : 'border-slate-200 bg-white'}`}><div className="flex items-center gap-3"><span className={`h-3 w-3 rounded-full ${metrics.status === 'collecting' ? 'animate-pulse bg-violet-500' : 'bg-slate-300'}`}/><div><p className="text-sm font-black text-slate-900">{metrics.status === 'collecting' ? '正在采集真实试点事件' : '等待真实客户试点'}</p><p className="mt-1 text-xs text-slate-500">当前样本：{metrics.sample.customers} 位真实客户 · {metrics.sample.events} 个事件</p></div></div></section>
      <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric icon={<MessageSquareText size={16}/>} label="草稿采用率" value={`${metrics.draft.adoptionRate}%`} sub={`${metrics.draft.adopted}/${metrics.draft.generated} 条`}/>
        <Metric icon={<FileCheck2 size={16}/>} label="人工修改率" value={`${metrics.draft.editRate}%`} sub={`${metrics.draft.edited} 次修改`}/>
        <Metric icon={<Clock3 size={16}/>} label="接管中位时间" value={metrics.handoff.medianAcceptMinutes === null ? '—' : `${metrics.handoff.medianAcceptMinutes} 分钟`} sub={`${metrics.handoff.viewed} 已读 · ${metrics.handoff.accepted}/${metrics.handoff.requested} 已接管`}/>
        <Metric icon={<Users size={16}/>} label="三轮内获证据" value={String(metrics.evidence.acquiredWithin3Turns)} sub={`共获取 ${metrics.evidence.acquired} 项`}/>
      </section>
      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-sm font-black text-slate-950">交易漏斗观察</h2><div className="mt-5 flex items-center justify-between gap-2 text-center"><Funnel label="报价已发送" value={metrics.funnel.quotationsSent}/><ArrowRight size={14} className="text-slate-300"/><Funnel label="赢单" value={metrics.funnel.won}/><Funnel label="输单" value={metrics.funnel.lost}/><Funnel label="暂缓" value={metrics.funnel.onHold}/></div><div className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-600">阶段推进 {metrics.lifecycle.advanced} 次 · 回退 {metrics.lifecycle.rolledBack} 次</div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-sm font-black text-slate-950">质量反馈</h2><div className="mt-4 grid grid-cols-3 gap-2"><Funnel label="客户投诉" value={metrics.quality.complaints}/><Funnel label="重复追问" value={metrics.quality.repeatedQuestions}/><Funnel label="人工纠错" value={metrics.quality.humanCorrections}/></div><div className="mt-4 border-t border-slate-100 pt-3"><p className="text-[11px] font-bold text-slate-500">最近修改原因</p><div className="mt-2 flex flex-wrap gap-1.5">{metrics.editReasons.length ? metrics.editReasons.slice(-8).map((reason, index) => <span key={`${reason}-${index}`} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-600">{reason}</span>) : <span className="text-[11px] text-slate-400">尚无真实修改反馈</span>}</div></div></div>
      </section>
      <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4"><p className="text-xs font-black text-amber-800">指标解释边界</p><p className="mt-1 text-[11px] leading-5 text-amber-700">{metrics.interpretation}</p></section>
      {metrics.status === 'awaiting_real_pilot' && <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-sm font-black text-slate-950">开始试点前</h2><div className="mt-4 grid gap-3 md:grid-cols-3"><Step n="1" title="选取低风险客户" body="先从少量真实询盘、建议模式和明确人工负责人开始。"/><Step n="2" title="统一修改原因" body="使用事实纠正、推进调整、语气修改和风险接管等标准原因。"/><Step n="3" title="每周审查" body="联合销售复核失败对话，不用公开语料替代真实产品验证。"/></div></section>}
    </>}
  </div></main>;
}

function Metric({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) { return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-slate-500">{icon}<span className="text-[11px] font-bold">{label}</span></div><p className="mt-3 text-2xl font-black text-slate-950">{value}</p><p className="mt-1 text-[10px] text-slate-400">{sub}</p></div>; }
function Funnel({ label, value }: { label: string; value: number }) { return <div className="min-w-0 flex-1 rounded-xl bg-slate-50 px-2 py-3"><p className="text-xl font-black text-slate-900">{value}</p><p className="mt-1 text-[10px] text-slate-500">{label}</p></div>; }
function Step({ n, title, body }: { n: string; title: string; body: string }) { return <div className="rounded-xl bg-slate-50 p-4"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-950 text-[10px] font-black text-white">{n}</span><p className="mt-3 text-xs font-black text-slate-800">{title}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{body}</p></div>; }
