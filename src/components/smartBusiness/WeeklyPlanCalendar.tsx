import { ArrowUpRight, CalendarRange, ChevronDown, RefreshCcw } from "lucide-react";
import type { VideoCreationPlan } from "../../lib/videoCreationPlan";
import { SocialPlatformIcon } from "../SocialPlatformIcon";

type PublishingAccount = {
  accountId: string;
  accountLabel: string;
  platform: string;
};

type ProductOption = {
  id: string;
  name: string;
  materialIds: string[];
};

type Props = {
  startsAt: string;
  endsAt: string;
  plans: VideoCreationPlan[];
  masterPlans: VideoCreationPlan[];
  accounts: PublishingAccount[];
  products: ProductOption[];
  busy?: boolean;
  onChangeProduct: (masterIndex: number, productName: string) => void;
  onOpenReference: (plan: VideoCreationPlan) => void;
  onRefreshReferences?: () => void;
};

function safeDate(value: string | undefined, fallback = new Date()) {
  const parsed = value ? new Date(`${value}T00:00:00`) : fallback;
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function addDays(value: Date, count: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + count);
  return next;
}

function dayKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function familyKey(plan: VideoCreationPlan) {
  return plan.contentFamilyId || plan.contentId;
}

function referenceThumbnail(plan: VideoCreationPlan) {
  return plan.preproduction?.benchmark.thumbnailUrl || plan.planningEvidence?.referenceThumbnailUrl || "";
}

export default function WeeklyPlanCalendar({
  startsAt,
  endsAt,
  plans,
  masterPlans,
  accounts,
  products,
  busy,
  onChangeProduct,
  onOpenReference,
  onRefreshReferences,
}: Props) {
  const start = safeDate(startsAt);
  const end = safeDate(endsAt, addDays(start, 6));
  const dayCount = Math.max(7, Math.min(14, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1));
  const days = Array.from({ length: dayCount }, (_, index) => addDays(start, index));
  const mastersByFamily = new Map(masterPlans.map(plan => [familyKey(plan), plan]));
  const accountById = new Map(accounts.map(account => [account.accountId, account]));
  const missingReferences = masterPlans.filter(plan => !plan.referenceId).length;
  const selectedProducts = [...new Set(masterPlans.map(plan => plan.productName).filter(Boolean))];
  const plansByDay = new Map<string, VideoCreationPlan[]>();

  plans.forEach((plan, index) => {
    const fallback = days[index % days.length];
    const date = safeDate(plan.plannedPublishDate, fallback);
    const key = dayKey(date < start ? start : date > end ? end : date);
    plansByDay.set(key, [...(plansByDay.get(key) || []), plan]);
  });

  return <section aria-label="本周发布日历" className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><CalendarRange size={17}/></span>
        <div><h3 className="text-sm font-black text-slate-950">本周发布日历</h3><p className="mt-0.5 text-[10px] text-slate-500">{plans.length} 条内容 · 点击卡片查看对应爆款详情</p></div>
      </div>
      {missingReferences > 0 && onRefreshReferences && <button type="button" disabled={busy} onClick={onRefreshReferences} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 px-3 py-2 text-[10px] font-black text-violet-700 hover:bg-violet-50 disabled:opacity-40"><RefreshCcw size={11} className={busy ? "animate-spin" : ""}/>补齐 {missingReferences} 条爆款</button>}
    </header>

    <details className="group border-b border-slate-100 bg-slate-50/70">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-[10px]">
        <span className="min-w-0 truncate font-bold text-slate-600">制作产品：<strong className="text-slate-900">{selectedProducts.join("、") || "待选择"}</strong></span>
        <span className="inline-flex shrink-0 items-center gap-1 font-black text-emerald-700">调整母版产品 <ChevronDown size={12} className="transition group-open:rotate-180"/></span>
      </summary>
      <div className="grid gap-2 border-t border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-5">
        {masterPlans.map((plan, index) => <label key={familyKey(plan)} className="min-w-0 text-[9px] font-black text-slate-500">母版 {index + 1}<select value={plan.productName} disabled={busy} onChange={event => onChangeProduct(index, event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[10px] font-bold text-slate-800"><option value="">请选择产品</option>{products.map(product => <option key={product.id} value={product.name}>{product.name} · {product.materialIds.length} 项素材</option>)}</select></label>)}
      </div>
    </details>

    <div className="overflow-x-auto">
      <div className="grid min-w-[1120px] bg-slate-100" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(150px, 1fr))` }}>
        {days.map(day => {
          const key = dayKey(day);
          const dayPlans = plansByDay.get(key) || [];
          return <div key={key} className="min-w-0 border-r border-slate-200 bg-white last:border-r-0">
            <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-center"><p className="text-[9px] font-black text-slate-400">{day.toLocaleDateString("zh-CN", { weekday: "short" })}</p><p className="mt-0.5 text-[11px] font-black text-slate-800">{day.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</p><p className="mt-0.5 text-[8px] font-bold text-emerald-700">{dayPlans.length ? `${dayPlans.length} 条待发布` : "无发布"}</p></div>
            <div className="space-y-2 p-2">
              {dayPlans.map(plan => {
                const master = mastersByFamily.get(familyKey(plan)) || plan;
                const account = accountById.get(plan.matrix?.accountId || "") || accounts.find(item => item.platform === plan.platform);
                const thumbnail = referenceThumbnail(master);
                const canOpen = Boolean(master.referenceId || master.planningEvidence?.referenceSourceUrl || master.preproduction?.benchmark.sourceUrl);
                const title = plan.publication?.title || plan.theme;
                return <button key={plan.contentId} type="button" disabled={!canOpen} onClick={() => onOpenReference(master)} aria-label={canOpen ? `查看爆款详情：${title}` : `${title} 暂无爆款详情`} className="group/card w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition hover:border-emerald-300 hover:shadow-md disabled:cursor-default disabled:opacity-65">
                  <div className="relative aspect-[16/9] overflow-hidden bg-slate-900">{thumbnail?<img src={thumbnail} alt="爆款视频缩略图" className="h-full w-full object-cover"/>:<div className="flex h-full items-center justify-center text-[9px] font-bold text-white/45">等待爆款缩略图</div>}<span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/70 px-1.5 py-1 text-[7px] font-black text-white"><SocialPlatformIcon platform={plan.platform} size={10}/>{String(plan.platform).toUpperCase()}</span></div>
                  <div className="min-w-0 p-2"><p className="line-clamp-2 min-h-8 text-[10px] font-black leading-4 text-slate-900">{title}</p><p className="mt-1 truncate text-[8px] font-bold text-slate-400">{account?.accountLabel || "待绑定账号"}</p><div className="mt-1.5 flex min-w-0 items-center justify-between gap-2"><span className="truncate text-[8px] font-bold text-emerald-700">{master.productName || "待选择产品"}</span><span className="inline-flex shrink-0 items-center gap-0.5 text-[8px] font-black text-violet-700">{canOpen ? "查看爆款" : "待补爆款"}{canOpen&&<ArrowUpRight size={9}/>}</span></div></div>
                </button>;
              })}
            </div>
          </div>;
        })}
      </div>
    </div>
  </section>;
}
