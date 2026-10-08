import { ArrowRight, ArrowUpRight, Hash, Radar, RefreshCw, ShieldCheck } from 'lucide-react';
import type { BusinessDestination, WeeklyReviewSummary } from '../lib/digitalEmployees';
import { buildNextRoundRecommendationCards, type NextRoundRecommendationKind } from '../lib/nextRoundRecommendations';

const icons: Record<NextRoundRecommendationKind, typeof RefreshCw> = {
  inherit: RefreshCw,
  tags: Hash,
  trends: Radar,
};

const statusTone = {
  ready: 'bg-[#eaf7f0] text-[#087c55]',
  watch: 'bg-[#eef5ff] text-[#315f9d]',
  waiting: 'bg-surface-2 text-text-secondary',
};

export default function NextRoundRecommendationsSection({
  summary,
  onOpen,
  demo = false,
}: {
  summary?: WeeklyReviewSummary;
  onOpen: (page: BusinessDestination, view?: 'create' | 'publish') => void;
  demo?: boolean;
}) {
  const cards = buildNextRoundRecommendationCards(summary);
  return <section aria-label="下一轮建议" className="overflow-hidden rounded-xl border border-border bg-white">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-[linear-gradient(120deg,#f3fbf6_0%,#f7fbff_100%)] px-5 py-5 sm:px-6">
      <div><p className="text-xs font-semibold tracking-[0.16em] text-accent">NEXT ROUND</p><h2 className="mt-2 text-xl font-bold text-text-primary">下一轮建议</h2></div>
      {demo && <span className="rounded-full bg-violet-50 px-3 py-1.5 text-[11px] font-semibold text-violet-700">演示复盘 · 不写入经营决策</span>}
    </div>

    <div className="divide-y divide-border">
      {cards.map(card => {
        const Icon = icons[card.kind];
        return <article key={card.kind} className="grid min-w-0 gap-5 bg-white p-5 sm:p-6 lg:grid-cols-[220px_minmax(0,1fr)_300px] lg:items-start">
          <div className="min-w-0">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent"><Icon size={19}/></span>
              <div className="min-w-0"><p className="text-[11px] font-semibold tracking-[0.14em] text-text-muted">{card.index}</p><h3 className="mt-0.5 text-base font-bold text-text-primary">{card.title}</h3></div>
            </div>
            <span className={`mt-4 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone[card.status]}`}>{card.statusLabel}</span>
            <button type="button" onClick={() => onOpen(card.kind === 'inherit' ? 'smartAssets' : 'socialInspiration', card.kind === 'inherit' ? 'create' : undefined)} className="mt-5 inline-flex items-center gap-2 text-xs font-semibold text-accent hover:text-accent-dim">
              {card.kind === 'inherit' ? '进入内容制作' : card.kind === 'tags' ? '查看 Tag 与采集范围' : '查看灵感中心'}<ArrowRight size={14}/>
            </button>
          </div>

          <div className="min-w-0">
            <p className="text-sm font-medium leading-6 text-text-primary">{card.conclusion}</p>

            {card.evidence.length ? <div className="mt-4 space-y-2 border-l-2 border-[#d7e7de] pl-3">
              {card.evidence.slice(0, 4).map((item, index) => <p key={`${card.kind}-evidence-${index}`} className="text-xs leading-5 text-text-secondary">{item}</p>)}
            </div> : <p className="mt-4 text-xs leading-5 text-text-muted">真实数据回流后，这里会显示判断依据。</p>}

            {card.links.length ? <div className="mt-4 grid gap-2 xl:grid-cols-2">
              {card.links.map(link => <a key={link.url} href={link.url} target="_blank" rel="noreferrer noopener" className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5 text-xs font-medium text-text-primary hover:border-border-bright hover:text-accent">
                <span className="min-w-0 truncate">{link.label}</span><span className="flex shrink-0 items-center gap-1 text-text-muted">{link.meta || '查看来源'}<ArrowUpRight size={13}/></span>
              </a>)}
            </div> : null}
          </div>

          <div className="rounded-md bg-surface-2 p-3.5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-text-primary"><ShieldCheck size={13} className="text-accent"/>系统如何使用</p>
            <ul className="mt-2 space-y-1.5 text-[11px] leading-5 text-text-secondary">
              {card.systemActions.slice(0, 3).map((action, index) => <li key={`${card.kind}-action-${index}`} className="flex gap-2"><span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-accent"/>{action}</li>)}
            </ul>
            <p className="mt-3 border-t border-border pt-3 text-[10px] leading-5 text-text-muted">产品事实、采集范围和投放预算不会被静默修改。</p>
          </div>
        </article>;
      })}
    </div>
  </section>;
}
