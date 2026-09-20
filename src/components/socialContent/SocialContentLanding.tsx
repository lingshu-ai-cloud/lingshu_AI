import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  PenLine,
  PlayCircle,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { SocialContentThemeId } from '../../../shared/contracts/socialContentWorkflow';
import SocialThemeCards from './SocialThemeCards';

const VALUE_POINTS = [
  { icon: Clock3, title: '3 步发起任务', detail: '选择主题并补齐必要信息' },
  { icon: ShieldCheck, title: '基于真实资料', detail: '企业事实与素材分开核验' },
  { icon: CheckCircle2, title: '先验收再交付', detail: '成品可预览、确认或退回' },
] as const;

export default function SocialContentLanding({ onStart }: { onStart: (themeId: SocialContentThemeId | '') => void }) {
  return (
    <>
      <header className="overflow-hidden rounded-xl border border-border bg-white">
        <div className="grid gap-6 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:px-7">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-black tracking-[0.08em] text-accent"><Sparkles size={14} aria-hidden="true" />内容制作</div>
            <h1 className="mt-3 text-2xl font-black tracking-tight text-text-primary sm:text-[28px]">这次想让客户看到什么？</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">先选一个内容主题。系统会带你补齐对象与素材，再生成一条可验收、可交付的社媒内容。</p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => onStart('product_value')} className="inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-black text-white shadow-[0_6px_16px_rgba(17,127,81,0.18)] transition hover:bg-accent-dim"><PlayCircle size={16} />从产品卖点开始</button>
              <button type="button" onClick={() => onStart('')} className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-white px-4 text-sm font-bold text-text-secondary transition hover:border-border-bright hover:bg-surface-2"><PenLine size={15} />自定义主题</button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
            {VALUE_POINTS.map(item => <div key={item.title} className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/55 px-3 py-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-accent shadow-sm"><item.icon size={15} /></span><div className="min-w-0"><p className="text-xs font-black text-text-primary">{item.title}</p><p className="mt-0.5 truncate text-[10px] text-text-muted">{item.detail}</p></div></div>)}
          </div>
        </div>
      </header>

      <section aria-labelledby="social-theme-launcher-title" className="rounded-xl border border-border bg-white p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-[10px] font-black uppercase tracking-[0.12em] text-text-muted">选择入口</p><h2 id="social-theme-launcher-title" className="mt-1 text-lg font-black text-text-primary">按客户最关心的内容开始</h2></div>
          <div className="flex items-center gap-2 text-[11px] font-bold text-text-muted"><span>选主题</span><ArrowRight size={12} /><span>补资料</span><ArrowRight size={12} /><span>确认生成</span></div>
        </div>
        <SocialThemeCards onSelect={onStart} />
      </section>
    </>
  );
}
