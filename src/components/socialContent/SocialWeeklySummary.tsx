import { AlertCircle, Boxes, CheckCircle2, CircleDollarSign, ClipboardList, PencilLine } from 'lucide-react';
import type { SocialContentTaskDetail } from '../../../shared/contracts/socialContentWorkflow';
import { buildSocialContentWeeklyPlan } from '../../lib/socialContentWeeklyPlan';

export default function SocialWeeklySummary({ task, onEdit }: { task: SocialContentTaskDetail; onEdit: () => void }) {
  const plan = buildSocialContentWeeklyPlan(task);
  const cards = [
    { label: '本周准备做什么', value: `${plan.targetCount} 项内容`, detail: task.brief.productRef || task.brief.objective, icon: ClipboardList },
    { label: '已经完成多少', value: `${plan.completedCount} / ${plan.targetCount}`, detail: plan.reviewCount > 0 ? `${plan.reviewCount} 项待验收` : '按当前批次统计', icon: CheckCircle2 },
    { label: '需要我做什么', value: plan.needUserAction, detail: plan.managedSupplyActive ? '没有素材时由系统自动补齐' : '其余工作自动推进', icon: AlertCircle },
    { label: '本周预算', value: plan.budgetLabel, detail: task.brief.weeklyBudgetCny == null ? '可在本周设置中补充' : '实际成本以生产记录为准', icon: CircleDollarSign },
  ];
  return (
    <section className="rounded-2xl border border-border bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-[11px] font-bold text-text-muted">本周交付</p><h3 className="mt-1 text-base font-black text-text-primary">内容生产总览</h3></div>
        <button type="button" onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-bold text-text-secondary hover:bg-surface-2"><PencilLine size={13} />调整本周设置</button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(card => <article key={card.label} className="rounded-xl bg-surface-2 p-3.5"><card.icon size={16} className="text-emerald-700" /><p className="mt-3 text-[10px] font-bold text-text-muted">{card.label}</p><strong className="mt-1 block text-sm text-text-primary">{card.value}</strong><p className="mt-1 truncate text-[10px] text-text-muted">{card.detail}</p></article>)}
      </div>
      <div className="mt-4 rounded-xl border border-border p-4">
        <div className="flex items-center gap-2"><Boxes size={15} className="text-emerald-700" /><p className="text-xs font-black text-text-primary">本周生产安排</p></div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {plan.productionLanes.map(lane => <div key={lane.label} className="rounded-lg bg-surface-2 px-3 py-2.5"><p className="text-[11px] font-bold text-text-primary">{lane.label}</p><p className="mt-1 text-[10px] text-text-muted">{lane.status}</p></div>)}
        </div>
        {plan.managedSupplyActive && <div className="mt-3 w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-left text-xs font-bold text-emerald-900">零素材托管 · {plan.assetSupplyLabel}</div>}
      </div>
    </section>
  );
}
