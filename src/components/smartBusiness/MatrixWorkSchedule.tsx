import {projectAccountBindingCalendar} from './accountBindingCalendar';
import AgentWeeklyCalendar, { type AgentCalendarTask } from "./AgentWeeklyCalendar";
import ConnectedAgentCalendar from './ConnectedAgentCalendar';
import { useState } from "react";
import type { ContentQueueItem } from "../../lib/digitalEmployees";
import { AlertTriangle, CalendarRange, Clapperboard } from "lucide-react";
import type { VideoCreationPlan } from "../../lib/videoCreationPlan";
import { SocialPlatformIcon } from "../SocialPlatformIcon";
import type { MatrixScheduleAccount } from "../SmartBusinessDashboard";

type Props = {
  calendarTasks?: AgentCalendarTask[];
  calendarDemo?: boolean;
  taskItems?: ContentQueueItem[];
  onOpenTask?: (taskId: string, contentItemId: string) => void;
  startsAt?: string;
  endsAt?: string;
  accounts: MatrixScheduleAccount[];
  plans: VideoCreationPlan[];
  selectedAccountId?: string;
  onOpenPublishing?: () => void;
};

const materialLabels = {
  talking_head: "真人口播",
  factory: "工厂生产",
  product: "产品展示",
  consumer_demo: "使用与效果",
  unknown: "待判断",
} as const;

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

function shortDate(value: Date) {
  return value.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function spreadAccountDate(start: Date, end: Date, slotIndex: number, accountTotal: number) {
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const total = Math.max(1, accountTotal);
  const index = Math.max(0, Math.min(total - 1, slotIndex));
  const offset = total === 1
    ? Math.floor((days - 1) / 2)
    : Math.round(index * (days - 1) / (total - 1));
  return addDays(start, offset);
}

function previewFrames(plan?: VideoCreationPlan) {
  const matched = (plan?.preproduction?.materials.storyboard || []).map(step => ({
    url: step.materialPreviewUrl || step.referenceFirstFrameUrl,
    label: step.materialLabel || materialLabels[step.materialType],
    status: step.status,
  }));
  if (matched.some(item => item.url)) return matched.slice(0, 5);
  const analysis = plan?.benchmarkAnalysis;
  return (analysis?.structure || []).slice(0, 5).map(step => {
    const shot = step.shotIds.map(id => analysis?.shots.find(item => item.shotId === id)).find(Boolean);
    return { url: shot?.firstFrameRef || "", label: materialLabels[step.materialType], status: "ready" as const };
  });
}

function planBlockers(plan?: VideoCreationPlan) {
  if (!plan) return ["等待生成内容计划"];
  return [
    ...(!plan.productName ? ["未绑定产品"] : []),
    ...(!plan.referenceId ? ["缺少已完成精确分析的爆款参考"] : []),
    ...(plan.preproduction && !plan.preproduction.readiness.canStart
      ? plan.preproduction.readiness.blockers
      : []),
  ];
}

export function productionQueueItemForPlan(plan: VideoCreationPlan | undefined, items: ContentQueueItem[]): ContentQueueItem | null {
  if (!plan?.contentId) return null;
  const matches = items.filter(item => item.contentId === plan.contentId && (!plan.matrix?.accountId || item.accountId === plan.matrix.accountId));
  return matches.length === 1 ? matches[0]! : null;
}

export default function MatrixWorkSchedule({ calendarTasks, calendarDemo = false, taskItems = [], onOpenTask, startsAt, endsAt, accounts, plans, selectedAccountId, onOpenPublishing }: Props) {
  const [view, setView] = useState<"calendar" | "board">(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("scheduleView") === "board" ? "board" : "calendar");
  const visibleTasks = taskItems.filter(item => !selectedAccountId || item.accountId === selectedAccountId);
  const goalStart = safeDate(startsAt);
  const goalEnd = safeDate(endsAt, addDays(goalStart, 6));
  const anchor = goalStart;
  const dayCount = Math.max(7, Math.min(14, Math.round((goalEnd.getTime() - goalStart.getTime()) / 86_400_000) + 1));
  const days = Array.from({ length: dayCount }, (_, index) => addDays(anchor, index));
  const today = dayKey(new Date());
  const visibleAccounts = selectedAccountId ? accounts.filter(account => account.accountId === selectedAccountId) : accounts;
  const rows = visibleAccounts.flatMap(account => {
    const accountPlans = plans.filter(plan => plan.matrix?.accountId === account.accountId);
    const accountTotal = Math.max(accountPlans.length, account.weeklyCount);
    return Array.from({ length: accountTotal }, (_, index) => ({ account, plan: accountPlans[index], index, accountTotal }));
  });
  const plannedCount = rows.filter(row => Boolean(row.plan)).length;
  const originalCount = plans.filter(plan => plan.productionRole !== "platform_adaptation").length;
  const blockedFamilies = new Set(rows
    .filter(row => Boolean(row.plan) && planBlockers(row.plan).length > 0)
    .map(row => row.plan?.contentFamilyId || row.plan?.contentId)
    .filter(Boolean));
  const blockedCount = blockedFamilies.size;
  const dayLoads = new Map<string, { tasks: number; accounts: Set<string> }>();
  rows.forEach(({ account, plan, index, accountTotal }) => {
    const fallback = spreadAccountDate(goalStart, goalEnd, index, accountTotal);
    const key = dayKey(safeDate(plan?.plannedPublishDate, fallback));
    const current = dayLoads.get(key) || { tasks: 0, accounts: new Set<string>() };
    current.tasks += 1;
    current.accounts.add(account.accountId);
    dayLoads.set(key, current);
  });

  return <section className="overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-sm" aria-label="数字员工工作排期">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><CalendarRange size={19}/></span>
        <div><p className="text-[10px] font-black tracking-[0.16em] text-emerald-700">AGENT WORK CALENDAR</p><h2 className="mt-1 text-xl font-black text-slate-950">数字员工工作排期</h2><p className="mt-1 text-xs text-slate-500">{view === 'board' ? '按周一到周日查看当天交付；每张任务卡标明主负责 Agent，点击查看任务详情。' : '每条视频就是一条日历任务；悬停卡片查看内容、素材、成本、卡点和 Agent 用时。'}</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-2"><span className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[10px] font-black text-emerald-800">{goalStart.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} — {goalEnd.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</span>{onOpenPublishing&&<button type="button" onClick={onOpenPublishing} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black text-slate-700 hover:border-emerald-200 hover:text-emerald-700">打开发布日历 →</button>}</div>
    </header>
    <div className="grid gap-px border-b border-slate-100 bg-slate-100 sm:grid-cols-4">
      <div className="bg-white px-5 py-3"><p className="text-[9px] font-bold text-slate-400">经营账号</p><p className="mt-1 text-sm font-black text-slate-900">{visibleAccounts.length} 个</p></div>
      <div className="bg-white px-5 py-3"><p className="text-[9px] font-bold text-slate-400">原创母版</p><p className="mt-1 text-sm font-black text-slate-900">{originalCount} 条</p></div>
      <div className="bg-white px-5 py-3"><p className="text-[9px] font-bold text-slate-400">发布版本</p><p className="mt-1 text-sm font-black text-slate-900">{plannedCount}/{rows.length} 条已编排</p></div>
      <div className="bg-white px-5 py-3"><p className="text-[9px] font-bold text-slate-400">母版卡点</p><p className={`mt-1 text-sm font-black ${blockedCount ? "text-amber-700" : "text-emerald-700"}`}>{blockedCount ? `${blockedCount} 个母版待处理` : "无生产卡点"}</p></div>
    </div>
    <div className="flex gap-2 border-b border-slate-100 px-5 py-3" role="tablist" aria-label="发布排期视图">
      {([['calendar', '发布日历'], ['board', 'Agent 任务看板']] as const).map(([id, label]) => <button key={id} type="button" role="tab" id={`schedule-tab-${id}`} aria-selected={view === id} aria-controls={`schedule-panel-${id}`} onClick={() => setView(id)} className={`rounded-xl px-4 py-2 text-xs font-black ${view === id ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-emerald-50'}`}>{label}</button>)}
    </div>
    {view === "board" ? <div id="schedule-panel-board" role="tabpanel" aria-labelledby="schedule-tab-board">{calendarTasks !== undefined || calendarDemo ? <AgentWeeklyCalendar startsAt={startsAt} demo={calendarDemo} tasks={calendarTasks ?? []}/> : <ConnectedAgentCalendar accountBindingTasks={projectAccountBindingCalendar(taskItems,accounts.map(account=>({...account,connected:account.connected===true})))}/>}</div> : <div id="schedule-panel-calendar" role="tabpanel" aria-labelledby="schedule-tab-calendar" className="overflow-x-auto">
      <div style={{ minWidth: `${days.length * 112}px` }}>
        <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(112px, 1fr))` }}>
          {days.map(day => { const key = dayKey(day); const inGoal = key >= dayKey(goalStart) && key <= dayKey(goalEnd); const load = dayLoads.get(key); return <div key={key} className={`border-r border-slate-100 px-2 py-2.5 text-center ${key === today ? "bg-emerald-50" : inGoal ? "bg-white" : "bg-slate-50"}`}><p className={`text-[9px] font-black ${key === today ? "text-emerald-700" : "text-slate-400"}`}>{day.toLocaleDateString("zh-CN", { weekday: "short" })}</p><p className="mt-1 text-[10px] font-black text-slate-700">{day.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</p>{load?<p className="mt-1 rounded-full bg-sky-50 px-1.5 py-0.5 text-[7px] font-black text-sky-700">{load.accounts.size} 账号并行 · {load.tasks} 条</p>:<p className="mt-1 text-[7px] font-bold text-slate-300">无发布</p>}{key === today&&<span className="mt-1 inline-block rounded-full bg-emerald-600 px-1.5 py-0.5 text-[7px] font-black text-white">今天</span>}</div>; })}
        </div>
        <div>{rows.map(({ account, plan, index, accountTotal }, rowIndex) => {
          const fallbackPublish = spreadAccountDate(goalStart, goalEnd, index, accountTotal);
          const publishDate = safeDate(plan?.plannedPublishDate, fallbackPublish);
          const publishIndex = Math.max(0, Math.min(days.length - 1, Math.round((publishDate.getTime() - anchor.getTime()) / 86_400_000)));
          const startIndex = Math.max(0, publishIndex - 3);
          const span = Math.max(1, publishIndex - startIndex + 1);
          const cardSpan = Math.min(days.length, Math.max(4, span));
          const cardStartIndex = Math.max(0, Math.min(startIndex, days.length - cardSpan));
          const blockers = planBlockers(plan);
          const blocked = Boolean(plan && blockers.length > 0);
          const frames = previewFrames(plan);
          const fallbackThumbnail = plan?.planningEvidence?.referenceThumbnailUrl || plan?.preproduction?.benchmark.thumbnailUrl || "";
          const master = plan?.productionRole !== "platform_adaptation";
          const productionDuration = master ? "约 6 小时 20 分" : "约 1 小时 15 分";
          const productionStart = addDays(anchor, startIndex);
          const schedulePeriod = span === 1 ? `${shortDate(publishDate)} 当日` : `${shortDate(productionStart)}–${shortDate(publishDate)} · ${span} 天`;
          const productionItem = productionQueueItemForPlan(plan, taskItems);
          const openProduction = productionItem && onOpenTask ? () => onOpenTask(productionItem.taskId, productionItem.id) : null;
          return <div key={`${account.accountId}-${plan?.contentId || index}`} className={`relative grid min-h-[150px] border-b border-slate-100 ${rowIndex % 2 ? "bg-slate-50/35" : "bg-white"}`} style={{ gridTemplateColumns: `repeat(${days.length}, minmax(112px, 1fr))` }}>
            {days.map((day, dayIndex) => <span key={dayKey(day)} className={`border-r border-slate-100 ${dayKey(day) === today ? "bg-emerald-50/45" : ""}`} style={{ gridColumn: dayIndex + 1, gridRow: 1 }}/>) }
            <article tabIndex={0} role={openProduction ? "button" : undefined} onClick={openProduction || undefined} onKeyDown={openProduction ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openProduction(); } } : undefined} aria-label={`${account.accountLabel} 第 ${index + 1} 条视频排期${openProduction ? '，进入生产实况' : ''}`} className={`group relative z-10 m-2 min-w-0 max-w-full overflow-visible rounded-2xl border bg-white shadow-sm outline-none transition hover:z-30 hover:border-emerald-300 hover:shadow-lg focus:z-30 focus:border-emerald-300 focus:shadow-lg ${openProduction ? 'cursor-pointer' : ''} ${blocked ? "border-amber-300" : plan ? "border-slate-200" : "border-dashed border-slate-300"}`} style={{ gridColumn: `${cardStartIndex + 1} / span ${cardSpan}`, gridRow: 1 }}>
              {plan ? <>
                <div className="flex min-w-0 items-stretch overflow-hidden rounded-2xl">
                  <div className="relative w-[88px] shrink-0 overflow-hidden bg-slate-900">{frames[0]?.url?<img src={frames[0].url} alt="内容结构首帧" className="h-full min-h-[132px] w-full object-cover"/>:fallbackThumbnail?<img src={fallbackThumbnail} alt="爆款视频预览" className="h-full min-h-[132px] w-full object-cover"/>:<div className="flex h-full min-h-[132px] items-center justify-center"><Clapperboard size={20} className="text-white/40"/></div>}<span className="absolute left-1.5 top-1.5 flex items-center rounded-full bg-black/65 px-1.5 py-0.5 text-[7px] font-black text-white"><SocialPlatformIcon platform={account.platform} size={10}/></span></div>
                  <div className="min-w-0 flex-1 overflow-hidden p-2.5">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1 overflow-hidden" aria-label="素材结构预览">{frames.slice(0,4).map((frame, frameIndex) => <div key={`${frame.label}-${frameIndex}`} className="flex min-w-0 shrink items-center gap-1">{frameIndex>0&&<span className="shrink-0 text-[8px] text-emerald-400">→</span>}<span className={`relative h-8 min-w-0 flex-1 overflow-hidden rounded-md border sm:w-11 sm:flex-none ${frame.status === "ready" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>{frame.url?<img src={frame.url} alt={`${frame.label}首帧`} className="h-full w-full object-cover"/>:<span className="flex h-full items-center justify-center px-1 text-center text-[6px] font-black text-slate-500">{frame.label}</span>}<span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-[5px] font-black text-white">{frame.label}</span></span></div>)}</div>
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[7px] font-black ${blocked ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>{blocked ? "有卡点" : "可执行"}</span>
                    </div>
                    <h3 className="mt-2 truncate text-[9px] font-black text-slate-900" title={plan.publication?.title || plan.theme}>{plan.publication?.title || plan.theme}</h3>
                    <dl className="mt-2 grid min-w-0 grid-cols-2 gap-x-2 gap-y-1.5 text-[7px] leading-tight">
                      <div className="min-w-0"><dt className="font-bold text-slate-400">制作时长</dt><dd className="mt-0.5 truncate font-black text-slate-700">{productionDuration}</dd></div>
                      <div className="min-w-0"><dt className="font-bold text-slate-400">工期</dt><dd className="mt-0.5 truncate font-black text-slate-700">{schedulePeriod}</dd></div>
                      <div className="min-w-0"><dt className="font-bold text-slate-400">发布时间</dt><dd className="mt-0.5 truncate font-black text-slate-700">{plan.plannedPublishDate || dayKey(publishDate)}</dd></div>
                      <div className="min-w-0"><dt className="font-bold text-slate-400">发布账号</dt><dd className="mt-0.5 truncate font-black text-slate-700" title={account.accountLabel}>{account.accountLabel}</dd></div>
                    </dl>
                  </div>
                </div>
                <div className="max-h-0 min-w-0 overflow-hidden border-t border-transparent px-3 text-[9px] opacity-0 transition-all duration-200 group-hover:max-h-72 group-hover:border-slate-100 group-hover:py-3 group-hover:opacity-100 group-focus:max-h-72 group-focus:border-slate-100 group-focus:py-3 group-focus:opacity-100">
                  <div className="mb-2 grid min-w-0 grid-cols-3 gap-1 text-[7px] font-black"><span className="min-w-0 truncate rounded bg-violet-50 px-1.5 py-1 text-violet-700">{master ? "编导 45m" : "沿用母版"}</span><span className="min-w-0 truncate rounded bg-sky-50 px-1.5 py-1 text-sky-700">{master ? "内容制作 约5h" : "平台轻适配 约40m"}</span><span className={`min-w-0 truncate rounded px-1.5 py-1 ${blocked ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>质检发布 35m</span></div>
                  <p className={`font-black ${openProduction ? 'text-emerald-700' : 'text-slate-400'}`}>{openProduction ? '点击进入实际生产画面 →' : '生产任务尚未建立'}</p>
                  <dl className="grid min-w-0 gap-x-4 gap-y-1.5 sm:grid-cols-2"><div className="min-w-0"><dt className="font-bold text-slate-400">任务类型</dt><dd className="mt-0.5 truncate font-black text-slate-800">{master ? "原创母版" : "跨平台轻适配"}</dd></div><div className="min-w-0"><dt className="font-bold text-slate-400">发布日期</dt><dd className="mt-0.5 truncate font-black text-slate-800">{plan.plannedPublishDate || dayKey(publishDate)}</dd></div><div className="min-w-0"><dt className="font-bold text-slate-400">爆款参考</dt><dd className="mt-0.5 line-clamp-2 break-words font-semibold text-slate-700">{plan.planningEvidence?.referenceTitle || "等待精确分析"}</dd></div><div className="min-w-0"><dt className="font-bold text-slate-400">预计成本</dt><dd className="mt-0.5 break-words font-black text-slate-800">{master ? `¥${plan.estimatedCostRange?.minCny || 10}–${plan.estimatedCostRange?.maxCny || 15}` : "已包含在母版成本"}</dd></div><div className="min-w-0"><dt className="font-bold text-slate-400">产品</dt><dd className="mt-0.5 truncate font-black text-slate-800" title={plan.productName || "系统尚未选中产品"}>{plan.productName || "系统尚未选中产品"}</dd></div><div className="min-w-0"><dt className="font-bold text-slate-400">内容家族</dt><dd className="mt-0.5 truncate font-black text-slate-800" title={plan.contentFamilyId || plan.contentId}>{plan.contentFamilyId || plan.contentId}</dd></div></dl>
                  {blocked&&<p className="mt-2 flex items-start gap-1 rounded-lg bg-amber-50 px-2 py-1.5 font-bold leading-4 text-amber-800"><AlertTriangle size={11} className="mt-0.5 shrink-0"/>{blockers.slice(0, 2).join("；")}</p>}
                  <p className="mt-2 text-[8px] font-bold text-slate-400">编导 Agent 分析爆款、生成脚本与分镜 → 经营 Agent 制定详细选题与排期 → 内容 Agent 执行 → 内容 Agent · 质检能力验收 → 经营 Agent 发布</p>
                </div>
              </> : <div className="flex min-h-[96px] items-center justify-center px-4 text-center"><div><p className="text-[9px] font-black text-slate-500">{account.accountLabel} · 内容位 {index + 1}</p><p className="mt-1 text-[8px] text-slate-400">周目标已分配，等待可执行爆款参考</p></div></div>}
            </article>
          </div>;
        })}{!rows.length&&<div className="px-6 py-16 text-center"><CalendarRange size={28} className="mx-auto text-slate-300"/><p className="mt-3 text-sm font-black text-slate-600">还没有账号内容排期</p><p className="mt-1 text-xs text-slate-400">先制定周目标，系统会为每个平台账号生成视频任务卡。</p></div>}</div>
      </div>
    </div>
    }
    <footer className="flex flex-wrap items-center gap-3 bg-slate-50 px-5 py-3 text-[9px] font-bold text-slate-400"><span>{view === 'board' ? '排期规则：先准备必要素材，成片至少提前一天完成；发布须满足验收、审批与账号授权。' : '排期规则：每个账号独立均匀铺满本周；同一天允许多个账号并行制作与发布。'}</span><span className="ml-auto">{view === 'board' ? '任务按上游交付衔接；上传逾期会标红并提示受影响任务。' : '窄工期卡片会扩展到可读宽度；准确工期与发布时间以卡内字段为准。'}</span></footer>
  </section>;
}
