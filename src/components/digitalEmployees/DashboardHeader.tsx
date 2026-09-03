import { Check, Settings2, Sparkles } from 'lucide-react';
import type { DigitalEmployeeConfig, StreamConnectionPhase } from '../../lib/digitalEmployees';
import { autonomyLabel, connectionPresentation } from './presentation';

export const DIGITAL_EMPLOYEE_STAGES = ['首次配置', '周目标', 'Agent 计划', '任务执行与现场', '审批接管', '周复盘'] as const;

export function DashboardHeader({
  config,
  stage,
  workItemCount,
  streamPhase,
  onEditConfig,
}: {
  config: DigitalEmployeeConfig | null;
  stage: number;
  workItemCount: number;
  streamPhase?: StreamConnectionPhase;
  onEditConfig: () => void;
}) {
  const connection = streamPhase ? connectionPresentation(streamPhase) : null;
  return <header className="rounded-3xl bg-slate-950 px-6 py-6 text-white shadow-xl shadow-slate-200/70">
    <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-300"><Sparkles size={15} /> LingShu Digital Workforce</div>
        <h1 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">数字员工经营驾驶舱</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">你负责目标与例外，数字员工负责计划、编排、状态、审批引用和复盘；正式内容与账号数据仍由原业务模块管理。</p>
      </div>
      {config && <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">{config.companyName}</span>
        <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-emerald-200">{autonomyLabel[config.autonomyMode]}模式</span>
        {connection && <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 ${connection.tone}`}><span className={`h-1.5 w-1.5 rounded-full ${connection.dot}`} />{connection.label}</span>}
        <a href="#digital-stage-5" className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-amber-100">待我处理 {workItemCount}</a>
        <button type="button" onClick={onEditConfig} className="rounded-full border border-white/15 px-3 py-1.5 text-slate-200 hover:bg-white/10"><Settings2 size={13} className="mr-1 inline" />配置</button>
      </div>}
    </div>
    <nav aria-label="数字员工六阶段闭环" className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-6">
      {DIGITAL_EMPLOYEE_STAGES.map((label, index) => {
        const number = index + 1;
        const done = number < stage;
        const active = number === stage;
        return <a aria-current={active ? 'step' : undefined} href={`#digital-stage-${number}`} key={label} className={`rounded-xl border px-3 py-2 transition hover:border-emerald-300/60 ${active ? 'border-emerald-400 bg-emerald-400/15' : done ? 'border-white/15 bg-white/10' : 'border-white/10 bg-white/[0.04]'}`}>
          <div className="flex items-center gap-2"><span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black ${done ? 'bg-emerald-400 text-slate-950' : active ? 'bg-white text-slate-950' : 'bg-white/10 text-slate-400'}`}>{done ? <Check size={12} /> : number}</span><span className={`text-[11px] font-semibold ${active || done ? 'text-white' : 'text-slate-500'}`}>{label}</span></div>
        </a>;
      })}
    </nav>
  </header>;
}
