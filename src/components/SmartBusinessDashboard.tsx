import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CalendarPlus,
  CheckCircle2,
  CircleDollarSign,
  Clapperboard,
  Eye,
  Loader2,
  MessageSquareText,
  RefreshCcw,
  Sparkles,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { digitalEmployeeApi, type DigitalEmployeeOverview, type DigitalEmployeeAgentRole } from "../lib/digitalEmployees";
import { nextReviewWeek, type ReviewTodo, type ReviewTodoBoard } from "../lib/reviewTodos";
import type { DeliveryResource } from "../lib/delivery";
import SocialAccountStrategies from "./socialProgram/SocialAccountStrategies";
import type { Page } from "../pageRegistry";

export type SmartBusinessView = "home" | "matrix" | "queue" | "review";

type AgentCard = {
  role: Exclude<DigitalEmployeeAgentRole, "orchestrator">;
  name: string;
  description: string;
  tint: string;
};

const agentCards: AgentCard[] = [
  { role: "business", name: "经营 Agent", description: "安排周计划与发布节奏", tint: "from-emerald-50 to-white" },
  { role: "director", name: "编导 Agent", description: "采集灵感并验收选题", tint: "from-violet-50 to-white" },
  { role: "content", name: "内容 Agent", description: "生产视频与多语言内容", tint: "from-sky-50 to-white" },
  { role: "customer", name: "客服 Agent", description: "整理询盘并准备跟进", tint: "from-amber-50 to-white" },
];

const roleAliases: Record<AgentCard["role"], DigitalEmployeeAgentRole[]> = {
  business: ["business", "orchestrator"],
  director: ["director"],
  content: ["content"],
  customer: ["customer"],
};

const platformOptions = ["youtube", "tiktok", "instagram", "facebook"] as const;
type Platform = (typeof platformOptions)[number];
const platformLabels: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
};

const runningStatuses = new Set(["running", "active", "planning", "waiting_external"]);

function metricValue(value: number | null | undefined, suffix = "") {
  return value === null || value === undefined ? "—" : `${value.toLocaleString("zh-CN")}${suffix}`;
}

function dateLabel(value?: string) {
  if (!value) return "等待更新时间";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function deliveryMetric(card: DeliveryResource, pattern: RegExp) {
  return card.metrics.find((metric) => pattern.test(metric.label))?.value ?? null;
}

function deliveryPlatform(card: DeliveryResource): Platform | null {
  const ref = (card.link?.businessRef || {}) as Record<string, unknown>;
  const candidates = [ref.platform, ref.channel, ref.socialPlatform, card.subject, card.title]
    .map((value) => String(value || "").toLowerCase());
  return platformOptions.find((platform) => candidates.some((value) => value.includes(platform))) || null;
}

function relatedTasks(data: DigitalEmployeeOverview, role: AgentCard["role"]) {
  const aliases = roleAliases[role];
  return data.tasks.filter((task) => aliases.includes(task.agent_role));
}

function AgentMonitor({ data, agent: agentCard, onClose }: { data: DigitalEmployeeOverview; agent: AgentCard; onClose: () => void }) {
  const tasks = relatedTasks(data, agentCard.role);
  const taskIds = new Set(tasks.map((task) => task.id));
  const agentStatus = data.agents.find((item) => roleAliases[agentCard.role].includes(item.role));
  const events = data.events
    .filter((event) => taskIds.has(event.task_id))
    .sort((left, right) => right.sequence - left.sequence)
    .slice(0, 10);

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/35 p-4" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-label={`${agentCard.name} 生产实况`} className="max-h-[86dvh] w-full max-w-2xl overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div><p className="text-xs font-bold tracking-[0.18em] text-emerald-700">AGENT LIVE</p><h2 className="mt-1 text-xl font-black text-slate-950">{agentCard.name} · 生产实况</h2><p className="mt-1 text-sm text-slate-500">{agentStatus?.currentTask || "当前没有运行中的任务"}</p></div>
          <button type="button" aria-label="关闭生产实况" onClick={onClose} className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><X size={18}/></button>
        </header>
        <div className="overflow-y-auto px-6 py-5">
          <div className="rounded-2xl bg-slate-950 p-4 text-white">
            <div className="flex items-center justify-between gap-4 text-xs"><span>当前进度</span><strong>{agentStatus?.completed || 0} / {agentStatus?.total || 0}</strong></div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${agentStatus?.total ? Math.min(100, agentStatus.completed / agentStatus.total * 100) : 0}%` }}/></div>
          </div>
          <div className="mt-6 space-y-0">
            {(events.length ? events : tasks.slice().sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))).map((item, index) => {
              const event = "summary" in item;
              const title = event ? item.summary : item.title;
              const time = event ? item.occurred_at : item.updated_at;
              const status = event ? item.level : item.status;
              return <div key={item.id} className="relative flex gap-4 pb-5"><div className="relative z-10 mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 border-emerald-600 bg-white"/>{index < (events.length ? events.length : tasks.length) - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-slate-200"/>}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="truncate text-sm font-bold text-slate-900">{title}</p><span className="text-[10px] text-slate-400">{dateLabel(time)}</span></div><p className="mt-1 text-xs text-slate-500">{status || "已记录"}</p></div></div>;
            })}
            {!events.length && !tasks.length && <div className="py-10 text-center text-sm text-slate-400">还没有可展示的生产记录</div>}
          </div>
        </div>
      </section>
    </div>
  );
}

function HomeView({ data, onRefresh }: { data: DigitalEmployeeOverview; onRefresh?: () => void }) {
  const [monitor, setMonitor] = useState<AgentCard | null>(null);
  const snapshot = data.businessSnapshot;
  const metrics = [
    { label: "运营平台账号", value: metricValue(snapshot?.social.accountCount.value), note: snapshot?.social.accountCount.note || "已接入账号", icon: Users },
    { label: "获得询盘", value: metricValue(snapshot?.content.inquiries.value), note: snapshot?.content.inquiries.note || "当前统计周期", icon: MessageSquareText },
    { label: "实际增长", value: metricValue(snapshot?.customer.won.value), note: "按成交客户记录", icon: TrendingUp },
    { label: "投流消耗", value: "—", note: "投流消耗数据未接入", icon: CircleDollarSign },
  ];

  return <>
    <section className="rounded-3xl border border-emerald-100 bg-gradient-to-br from-[#f3fbf7] via-white to-[#fbf8f2] p-5 shadow-[0_18px_50px_rgba(31,73,59,.06)] sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">过去业绩</p><h2 className="mt-2 text-2xl font-black text-slate-950">经营结果一眼看清</h2><p className="mt-1 text-sm text-slate-500">仅展示业务系统已经回传的真实数据。</p></div>{onRefresh&&<button type="button" onClick={onRefresh} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800"><RefreshCcw size={14}/>刷新</button>}</div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ label, value, note, icon: Icon })=><article key={label} className="rounded-2xl border border-white bg-white/80 p-4 shadow-sm"><div className="flex items-center justify-between"><span className="text-xs font-bold text-slate-500">{label}</span><Icon size={16} className="text-emerald-700"/></div><p className="mt-3 text-3xl font-black tracking-tight text-slate-950">{value}</p><p className="mt-1 truncate text-[11px] text-slate-400">{note}</p></article>)}</div>
    </section>

    <section className="mt-6">
      <div><p className="text-xs font-bold tracking-[0.16em] text-slate-400">数字员工</p><h2 className="mt-1 text-xl font-black text-slate-950">我的 4 个 Agent 现在在做什么</h2></div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{agentCards.map((item)=>{const status=data.agents.find(agent=>roleAliases[item.role].includes(agent.role));const tasks=relatedTasks(data,item.role);const live=Boolean(status&&runningStatuses.has(status.status))||tasks.some(task=>runningStatuses.has(task.status));return <button type="button" key={item.role} onClick={()=>setMonitor(item)} className={`group relative min-h-52 overflow-hidden rounded-3xl border p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg ${live?'border-emerald-300':'border-slate-200'} bg-gradient-to-br ${item.tint}`}>
        {live&&<span className="absolute right-4 top-4 h-11 w-11 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent"/>}
        <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${live?'bg-emerald-700 text-white':'bg-white text-slate-500'} shadow-sm`}><Bot size={20}/></span>
        <h3 className="mt-7 text-lg font-black text-slate-950">{item.name}</h3><p className="mt-1 text-xs text-slate-500">{item.description}</p>
        <div className="mt-5 flex items-center justify-between gap-2"><span className={`text-xs font-bold ${live?'text-emerald-700':'text-slate-400'}`}>{live?'运行中':'静默'}</span><span className="text-[10px] text-slate-400">{status?.completed||0}/{status?.total||0}</span></div>
        <p className="mt-2 truncate text-[11px] text-slate-500">{status?.currentTask||tasks[0]?.title||"等待下一项任务"}</p>
      </button>})}</div>
    </section>
    {monitor&&<AgentMonitor data={data} agent={monitor} onClose={()=>setMonitor(null)}/>} 
  </>;
}

function QueueView({ data }: { data: DigitalEmployeeOverview }) {
  const deliveries = data.deliveries || [];
  const costs = deliveries.map((card) => deliveryMetric(card, /成本|费用|花费|消耗/)).filter((value): value is number => value !== null);
  const average = costs.length ? costs.reduce((total, value) => total + value, 0) / costs.length : null;
  const recent = costs.slice(0, Math.max(1, Math.ceil(costs.length / 2)));
  const older = costs.slice(recent.length);
  const recentAverage = recent.length ? recent.reduce((total, value) => total + value, 0) / recent.length : null;
  const olderAverage = older.length ? older.reduce((total, value) => total + value, 0) / older.length : null;
  const trend = recentAverage !== null && olderAverage !== null ? recentAverage - olderAverage : null;

  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
    <section><div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">内容队列</p><h2 className="mt-1 text-2xl font-black text-slate-950">已经生成的视频和内容</h2><p className="mt-1 text-sm text-slate-500">按最近更新时间排列，生成中与待验收项目都保留在队列里。</p></div>
      <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white">{deliveries.map((card,index)=>{const cost=deliveryMetric(card,/成本|费用|花费|消耗/);const progress=card.steps.length?Math.round(card.steps.filter(step=>step.state==='done').length/card.steps.length*100):card.column==='done'?100:null;return <article key={card.id} className={`grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_120px_120px] md:items-center ${index?'border-t border-slate-100':''}`}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${card.column==='done'?'bg-emerald-50 text-emerald-700':card.column==='active'?'bg-blue-50 text-blue-700':'bg-amber-50 text-amber-700'}`}>{card.stage||card.column}</span><span className="text-[10px] text-slate-400">{dateLabel(card.updatedAt)}</span></div><h3 className="mt-2 truncate text-sm font-black text-slate-950">{card.title}</h3><p className="mt-1 truncate text-xs text-slate-500">{card.subject}{card.reason?` · ${card.reason}`:''}</p></div><div><p className="text-[10px] font-bold text-slate-400">生成进度</p><p className="mt-1 text-sm font-black text-slate-800">{progress===null?'处理中':`${progress}%`}</p></div><div className="md:text-right"><p className="text-[10px] font-bold text-slate-400">本条成本</p><p className="mt-1 text-sm font-black text-slate-950">{cost===null?'成本待核算':`¥${cost.toFixed(2)}`}</p></div></article>})}{!deliveries.length&&<div className="px-5 py-20 text-center"><Clapperboard size={28} className="mx-auto text-slate-300"/><p className="mt-3 text-sm font-bold text-slate-600">还没有内容进入生产队列</p><p className="mt-1 text-xs text-slate-400">完成一次内容制作后，进度和验收项目会显示在这里。</p></div>}</div>
    </section>
    <aside className="h-fit rounded-3xl border border-violet-100 bg-violet-50/60 p-5"><Sparkles size={20} className="text-violet-700"/><h3 className="mt-4 text-base font-black text-slate-950">成本建议</h3>{average===null?<><p className="mt-3 text-sm font-bold text-slate-700">积累更多内容后再判断</p><p className="mt-2 text-xs leading-6 text-slate-500">有新的内容成本后，这里会更新趋势并给出预算建议。</p></>:<><p className="mt-3 text-3xl font-black text-violet-950">¥{average.toFixed(2)}</p><p className="mt-1 text-xs text-slate-500">过去内容平均成本</p><p className="mt-4 text-sm font-bold text-slate-800">{trend===null?'暂缺企业成本基线':trend>0?'近期成本正在上升':'近期成本正在下降'}</p><p className="mt-2 text-xs leading-6 text-slate-500">{trend===null?'继续积累至少两个周期的数据，再决定提高预算或调整生成策略。':trend>0?'建议先优化内容生成策略，再考虑追加预算。':'当前策略有成本优势，可把预算优先给高热内容。'}</p></>}</aside>
  </div>;
}

function ReviewView({ data }: { data: DigitalEmployeeOverview }) {
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [board, setBoard] = useState<ReviewTodoBoard | null>(null);
  const [todoBusy, setTodoBusy] = useState(false);
  const [todoMessage, setTodoMessage] = useState("");
  const week = nextReviewWeek();
  const deliveries = data.deliveries || [];
  const ranking = useMemo(() => deliveries
    .filter((card) => deliveryPlatform(card) === platform && deliveryMetric(card, /播放|浏览|view/i) !== null)
    .sort((left, right) => (deliveryMetric(right, /播放|浏览|view/i) || 0) - (deliveryMetric(left, /播放|浏览|view/i) || 0)), [deliveries, platform]);
  const top = ranking[0];

  useEffect(() => {
    let active = true;
    setTodoBusy(true);
    digitalEmployeeApi.reviewTodos(week).then((next) => active&&setBoard(next)).catch((error: Error) => active&&setTodoMessage(error.message)).finally(()=>active&&setTodoBusy(false));
    return () => { active=false; };
  }, [week]);

  const addTopToTodo = async () => {
    if (!board || !top) return;
    const sourceId = `heat:${platform}:${top.id}`;
    if (board.items.some((item)=>item.sourceIds.includes(sourceId))) { setTodoMessage("这条建议已经在下周待办里了"); return; }
    const item: ReviewTodo = {
      id: crypto.randomUUID(), sourceIds:[sourceId], sourceTitle:`${platformLabels[platform]} 热度排行`, title:`批量复刻《${top.title}》`, kind:"video",
      requirements:`保留《${top.title}》的高表现钩子和节奏，结合下周主推产品制作同结构变体。`, acceptance:"成片结构与原高热内容可对照，产品卖点和事实信息已核验。", materials:"优先使用已授权产品素材与高表现首镜素材。", reference:`${platformLabels[platform]} 播放量：${deliveryMetric(top,/播放|浏览|view/i)?.toLocaleString("zh-CN") || 0}`,
      quantity:3, videoIndexes:[], status:"pending", reason:"",
    };
    setTodoBusy(true); setTodoMessage("");
    try { const saved=await digitalEmployeeApi.saveReviewTodos({...board,sourceGoalId:board.sourceGoalId||data.goal?.id||"",items:[...board.items,item]});setBoard(saved);setTodoMessage("已加入下周待办"); }
    catch (error) { setTodoMessage(error instanceof Error?error.message:"保存失败"); }
    finally { setTodoBusy(false); }
  };

  return <div>
    <div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">数据复盘</p><h2 className="mt-1 text-2xl font-black text-slate-950">内容热度排行</h2><p className="mt-1 text-sm text-slate-500">这里看内容层面的播放量排行；单条视频的完整数据仍在发布渠道页查看。</p></div>
    <div className="mt-5 flex gap-5 overflow-x-auto border-b border-slate-200">{platformOptions.map((item)=><button type="button" key={item} onClick={()=>setPlatform(item)} aria-pressed={platform===item} className={`shrink-0 border-b-2 pb-3 text-xs font-black ${platform===item?'border-emerald-700 text-emerald-800':'border-transparent text-slate-400'}`}>{platformLabels[item]}</button>)}</div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white">{ranking.map((card,index)=>{const views=deliveryMetric(card,/播放|浏览|view/i)||0;return <article key={card.id} className={`grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-4 p-5 ${index?'border-t border-slate-100':''}`}><span className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm font-black ${index===0?'bg-amber-100 text-amber-800':'bg-slate-100 text-slate-500'}`}>{index+1}</span><div className="min-w-0"><h3 className="truncate text-sm font-black text-slate-950">{card.title}</h3><p className="mt-1 truncate text-xs text-slate-400">{card.subject}</p></div><div className="text-right"><p className="flex items-center gap-1 text-sm font-black text-slate-900"><Eye size={13}/>{views.toLocaleString("zh-CN")}</p><p className="mt-1 text-[10px] text-slate-400">播放量</p></div></article>})}{!ranking.length&&<div className="px-5 py-20 text-center"><Eye size={28} className="mx-auto text-slate-300"/><p className="mt-3 text-sm font-bold text-slate-600">{platformLabels[platform]} 暂无内容播放量</p><p className="mt-1 text-xs text-slate-400">平台数据回传后会自动按播放量排序。</p></div>}</section>
      <aside className="space-y-4"><section className="rounded-3xl border border-emerald-100 bg-emerald-50/55 p-5"><Sparkles size={20} className="text-emerald-700"/><h3 className="mt-4 text-base font-black text-slate-950">Agent 制作建议</h3><p className="mt-3 text-sm font-bold leading-6 text-slate-800">{top?`批量复刻《${top.title}》的开头钩子与叙事节奏。`:"等待平台播放量回传后生成建议。"}</p><p className="mt-2 text-xs leading-6 text-slate-500">{top?"保留高表现结构，替换为下周主推产品与已核验卖点；建议先制作 3 条变体。":"当前没有足够数据，不生成未经证实的复刻建议。"}</p><button type="button" disabled={!top||!board||todoBusy} onClick={()=>void addTopToTodo()} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40">{todoBusy?<Loader2 size={14} className="animate-spin"/>:<CalendarPlus size={14}/>}纳入下周待办</button>{todoMessage&&<p role="status" className="mt-2 text-center text-[10px] text-emerald-800">{todoMessage}</p>}</section>
        <section className="rounded-3xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><h3 className="text-sm font-black text-slate-950">下周待办</h3><span className="text-[10px] text-slate-400">{week} 起</span></div><div className="mt-4 space-y-3">{board?.items.slice(0,5).map((item)=><div key={item.id} className="flex items-start gap-3"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-700"/><div className="min-w-0"><p className="truncate text-xs font-bold text-slate-800">{item.title}</p><p className="mt-0.5 text-[10px] text-slate-400">{item.quantity>1?`${item.quantity} 条 · `:""}{item.status==='assigned'?'已分配':'待分配'}</p></div></div>)}{board&&!board.items.length&&<p className="py-3 text-xs text-slate-400">暂无待办，可从上方建议直接加入。</p>}{!board&&<p className="py-3 text-xs text-slate-400">正在读取待办…</p>}</div></section></aside>
    </div>
  </div>;
}

export default function SmartBusinessDashboard({ data, view, onRefresh, onNavigate }: { data: DigitalEmployeeOverview; view: SmartBusinessView; onRefresh?: () => void; onNavigate?: (page: Page) => void }) {
  if (view === "matrix") return <SocialAccountStrategies embedded onNavigate={onNavigate || (() => undefined)}/>;
  if (view === "queue") return <QueueView data={data}/>;
  if (view === "review") return <ReviewView data={data}/>;
  return <HomeView data={data} onRefresh={onRefresh}/>;
}
