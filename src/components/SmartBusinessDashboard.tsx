import { useEffect, useMemo, useState } from "react";
import {
  CalendarPlus,
  CalendarRange,
  CheckCircle2,
  CircleDollarSign,
  Clapperboard,
  Eye,
  LayoutGrid,
  Loader2,
  MessageSquareText,
  Pencil,
  RefreshCcw,
  Sparkles,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { digitalEmployeeApi, type DigitalEmployeeOverview, type DigitalEmployeeAgentRole } from "../lib/digitalEmployees";
import { nextReviewWeek, type ReviewTodo, type ReviewTodoBoard } from "../lib/reviewTodos";
import type { DeliveryResource } from "../lib/delivery";
import type { Page } from "../pageRegistry";
import { SocialPlatformIcon } from "./SocialPlatformIcon";
import { showActionSuccess } from "../lib/actionFeedback";
import AgentRoleIcon from "./ui/AgentRoleIcon";
import WeeklyMatrixEditor from "./WeeklyMatrixEditor";
import type { WeeklyPackage } from "../lib/weeklyPackage";
import { defaultMatrixPlan, fillMatrixVideos } from "../lib/weeklyMatrix";
import { socialOperatingProfile } from "../../shared/contracts/socialOperatingProfile";
import { loadConnectedSocialPerformance, type ConnectedSocialPerformance } from "../lib/socialPerformance";
import { starterWorkspaceApi, type StarterAgentRole } from "../lib/starterWorkspace";

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

const starterUsageRole: Record<AgentCard["role"], StarterAgentRole> = {
  business: "traffic",
  director: "orchestrator",
  content: "content",
  customer: "sales",
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
  const [settledUsage, setSettledUsage] = useState<{ value: number; updatedAt: string | null; count: number; source: string } | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const tasks = relatedTasks(data, agentCard.role);
  const taskIds = new Set(tasks.map((task) => task.id));
  const agentStatus = data.agents.find((item) => roleAliases[agentCard.role].includes(item.role));
  const costReceipts = (data.deliveries || [])
    .filter(card => card.taskIds.some(taskId => taskIds.has(taskId)))
    .map(card => deliveryMetric(card, /成本|费用|花费|消耗/))
    .filter((value): value is number => value !== null);
  const directorCosts = (data.plan?.businessPackage?.directorPlan?.progress || [])
    .filter(item => item.owner === agentCard.role || (agentCard.role === "business" && item.owner === "team"))
    .map(item => item.actualCost)
    .filter(value => value > 0);
  const fallbackActualSpend = [...costReceipts, ...directorCosts].reduce((sum, value) => sum + value, 0);
  const fallbackReceiptCount = costReceipts.length + directorCosts.length;
  const actualSpend = settledUsage?.value ?? fallbackActualSpend;
  const hasActualSpend = Boolean(settledUsage) || fallbackReceiptCount > 0;
  const events = data.events
    .filter((event) => taskIds.has(event.task_id))
    .sort((left, right) => right.sequence - left.sequence)
    .slice(0, 10);

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setUsageLoading(true);
    setSettledUsage(null);
    void (async () => {
      try {
        const accountUsage = await digitalEmployeeApi.agentUsageCosts();
        const usage = accountUsage.roles[agentCard.role];
        if (active && usage) {
          setSettledUsage({ value: usage.settledCny, updatedAt: usage.updatedAt, count: usage.entryCount, source: usage.source });
          setUsageLoading(false);
          return;
        }
      } catch { /* Fall through to the Starter ledger when the shared account-cost route is unavailable. */ }
      try {
        const workspace = await starterWorkspaceApi.get({ force: true });
        if (!active) return;
        const usage = workspace.agents.find(item => item.role === starterUsageRole[agentCard.role]);
        if (usage?.costCny.settlementStatus === "settled" && usage.costCny.settled !== null) {
          setSettledUsage({ value: usage.costCny.settled, updatedAt: usage.costCny.updatedAt, count: 1, source: "账号真实结算账本" });
        }
      } catch { /* Persisted delivery receipts below remain the final truthful fallback. */ }
      finally { if (active) setUsageLoading(false); }
    })();
    return () => { active = false; };
  }, [agentCard.role]);

  return (
    <div className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/35 p-4" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-label={`${agentCard.name} 生产实况`} className="ui-modal-frame ui-modal-frame--compact" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div><p className="text-xs font-bold tracking-[0.18em] text-emerald-700">AGENT LIVE</p><h2 className="mt-1 text-xl font-black text-slate-950">{agentCard.name} · 生产实况</h2><p className="mt-1 text-sm text-slate-500">{agentStatus?.currentTask || "当前没有运行中的任务"}</p></div>
          <button type="button" aria-label="关闭生产实况" onClick={onClose} className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><X size={18}/></button>
        </header>
        <div className="ui-modal-body px-6 py-5">
          <div className="rounded-2xl bg-slate-950 p-4 text-white">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><p className="text-[10px] font-bold text-slate-400">当前进度</p><p className="mt-1 text-xl font-black">{agentStatus?.completed || 0} / {agentStatus?.total || 0}</p></div>
              <div><p className="text-[10px] font-bold text-slate-400">过去已核算消耗</p><p className="mt-1 text-xl font-black">{usageLoading && !hasActualSpend ? "读取中…" : hasActualSpend ? `¥${actualSpend.toFixed(2)}` : "暂无核算"}</p><p className="mt-1 text-[10px] text-slate-400">{settledUsage ? `${settledUsage.source} · ${settledUsage.count} 条${settledUsage.updatedAt ? ` · ${dateLabel(settledUsage.updatedAt)}` : ""}` : fallbackReceiptCount ? `${fallbackReceiptCount} 条真实费用记录` : "仅在服务返回真实结算后计入"}</p></div>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${agentStatus?.total ? Math.min(100, agentStatus.completed / agentStatus.total * 100) : 0}%` }}/></div>
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
  const deliveries = data.deliveries || [];
  const agentLiveState = Object.fromEntries(agentCards.map(item => {
    const status = data.agents.find(agent => roleAliases[item.role].includes(agent.role));
    const live = Boolean(status && runningStatuses.has(status.status)) || relatedTasks(data, item.role).some(task => runningStatuses.has(task.status));
    return [item.role, live];
  })) as Record<AgentCard["role"], boolean>;
  const activeAgentCount = agentCards.filter(item => agentLiveState[item.role]).length;
  const waitingCount = deliveries.filter(card => /验收|确认|review/i.test(card.stage || "")).length;
  const completedCount = deliveries.filter(card => card.column === "done").length;
  const platformCoverage = platformOptions.map(platform => ({
    platform,
    count: deliveries.filter(card => deliveryPlatform(card) === platform).length,
  }));
  const pulse = [
    { label: "已进入内容队列", value: deliveries.length, color: "#2fd1c5" },
    { label: "已完成交付", value: completedCount, color: "#8b7cf6" },
    { label: "等待验收", value: waitingCount, color: "#ff8e72" },
    { label: "正在工作的 Agent", value: activeAgentCount, color: "#10244a" },
  ];
  const pulseMax = Math.max(1, ...pulse.map(item => item.value));
  const metrics = [
    { label: "运营平台账号", value: metricValue(snapshot?.social.accountCount.value), note: snapshot?.social.accountCount.note || "已接入账号", icon: Users },
    { label: "获得询盘", value: metricValue(snapshot?.content.inquiries.value), note: snapshot?.content.inquiries.note || "当前统计周期", icon: MessageSquareText },
    { label: "实际增长", value: metricValue(snapshot?.customer.won.value), note: "按成交客户记录", icon: TrendingUp },
    { label: "投流消耗", value: "—", note: "投流消耗数据未接入", icon: CircleDollarSign },
  ];

  return <>
    <section className="visual-card overflow-hidden p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">过去业绩</p><h2 className="mt-2 text-2xl font-black text-slate-950">经营结果一眼看清</h2><p className="mt-1 text-sm text-slate-500">仅展示业务系统已经回传的真实数据。</p></div>{onRefresh&&<button type="button" onClick={onRefresh} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800"><RefreshCcw size={14}/>刷新</button>}</div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ label, value, note, icon: Icon }, index)=><article key={label} className="relative overflow-hidden rounded-2xl border border-[#10244a]/10 bg-white/90 p-4 shadow-[0_4px_0_rgba(16,36,74,.04)]"><span aria-hidden="true" className={`absolute -right-5 -top-5 h-20 w-20 rounded-full ${index%2?'bg-[#8b7cf6]/10':'bg-[#2fd1c5]/12'}`}/><div className="relative flex items-center justify-between"><span className="text-xs font-bold text-slate-500">{label}</span><span className={`flex h-8 w-8 items-center justify-center rounded-xl border-2 border-[#10244a] ${index%2?'bg-[#dcd7ff]':'bg-[#baf2e8]'}`}><Icon size={15} className="text-[#10244a]" strokeWidth={2.5}/></span></div><p className="relative mt-3 text-3xl font-black tracking-tight text-[#10244a]">{value}</p><p className="relative mt-1 truncate text-[11px] text-slate-400">{note}</p><div aria-hidden="true" className="relative mt-4 flex h-5 items-end gap-1">{[0.35,0.58,0.46,0.78,0.68].map((height, barIndex)=><span key={barIndex} className={`w-2 rounded-t-sm ${index%2?'bg-[#8b7cf6]/35':'bg-[#2fd1c5]/40'}`} style={{height:`${height*100}%`}}/>)}</div></article>)}</div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,.65fr)]">
        <article className="rounded-2xl border border-[#10244a]/10 bg-white/82 p-5">
          <div className="flex items-center justify-between gap-4"><div><p className="visual-kicker">经营脉冲</p><h3 className="mt-1 text-base font-black text-[#10244a]">内容与执行状态</h3></div><span className="text-[10px] font-bold text-slate-400">实时业务记录</span></div>
          <div className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">{pulse.map(item => <div key={item.label}><div className="flex items-center justify-between text-[11px]"><span className="font-bold text-slate-600">{item.label}</span><strong className="text-[#10244a]">{item.value}</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{background:item.color,width:`${item.value === 0 ? 0 : Math.max(12,item.value/pulseMax*100)}%`}}/></div></div>)}</div>
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4"><span className="mr-1 text-[10px] font-bold text-slate-400">内容覆盖</span>{platformCoverage.map(item => <span key={item.platform} title={`${platformLabels[item.platform]} ${item.count} 条`} className={`inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-xl border px-2 ${item.count?'border-[#10244a]/15 bg-white':'border-slate-200 bg-slate-50 opacity-45'}`}><SocialPlatformIcon platform={item.platform} size={16}/><span className="text-[10px] font-black text-[#10244a]">{item.count}</span></span>)}</div>
        </article>
        <article className="relative overflow-hidden rounded-2xl border border-[#10244a]/10 bg-gradient-to-br from-[#f4f1ff] to-[#e9fbf7] p-5">
          <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.16em] text-[#6558cf]">Agent 协同</p><p className="mt-1 text-sm font-black text-[#10244a]">数字员工协作状态</p></div><span className="rounded-full border border-[#10244a]/10 bg-white/80 px-2.5 py-1 text-[10px] font-black text-[#10244a]">{activeAgentCount}/4 运行中</span></div>
          <div className="relative mt-7 grid grid-cols-4 gap-3" aria-label="四位数字员工协作状态">
            <span aria-hidden="true" className="absolute left-[11%] right-[11%] top-6 h-px bg-[#9AAEA4]/55"/>
            {agentCards.map(item => <div key={item.role} className="relative z-10 flex min-w-0 flex-col items-center gap-2 text-center">
              <AgentRoleIcon role={item.role} active={agentLiveState[item.role]} size="lg" label={item.name}/>
              <span className="max-w-full truncate text-[9px] font-bold text-[#53695F]">{item.name.replace(' Agent', '')}</span>
            </div>)}
          </div>
          <div className="mt-6 flex items-center gap-2 rounded-xl border border-white/80 bg-white/65 px-3 py-2.5"><span className={`h-2 w-2 rounded-full ${activeAgentCount ? 'bg-[#117F51] motion-safe:animate-pulse' : 'bg-[#9AAEA4]'}`}/><p className="text-[11px] font-bold text-[#10244a]">{activeAgentCount ? `${activeAgentCount} 位正在协作处理任务` : '等待下一项任务'}</p></div>
        </article>
      </div>
    </section>

    <section className="mt-6">
      <div><p className="text-xs font-bold tracking-[0.16em] text-slate-400">数字员工</p><h2 className="mt-1 text-xl font-black text-slate-950">我的 4 个 Agent 现在在做什么</h2></div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{agentCards.map((item)=>{const status=data.agents.find(agent=>roleAliases[item.role].includes(agent.role));const tasks=relatedTasks(data,item.role);const live=Boolean(status&&runningStatuses.has(status.status))||tasks.some(task=>runningStatuses.has(task.status));return <button type="button" key={item.role} onClick={()=>setMonitor(item)} className={`group relative min-h-52 overflow-hidden rounded-3xl border p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg ${live?'border-emerald-300':'border-slate-200'} bg-gradient-to-br ${item.tint}`}>
        {live&&<span className="absolute right-4 top-4 h-11 w-11 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent"/>}
        <AgentRoleIcon role={item.role} active={live} size="md" label={item.name}/>
        <h3 className="mt-7 text-lg font-black text-slate-950">{item.name}</h3><p className="mt-1 text-xs text-slate-500">{item.description}</p>
        <div className="mt-5 flex items-center justify-between gap-2"><span className={`text-xs font-bold ${live?'text-emerald-700':'text-slate-400'}`}>{live?'运行中':'静默'}</span><span className="text-[10px] text-slate-400">{status?.completed||0}/{status?.total||0}</span></div>
        <p className="mt-2 truncate text-[11px] text-slate-500">{status?.currentTask||tasks[0]?.title||"等待下一项任务"}</p>
      </button>})}</div>
    </section>
    {monitor&&<AgentMonitor data={data} agent={monitor} onClose={()=>setMonitor(null)}/>} 
  </>;
}

const matrixRoleLabel: Record<string, string> = {
  brand_capability: "品牌能力号",
  buyer_advisor: "买家顾问号",
  brand_combined: "品牌综合账号",
};

function MatrixView({ data, onRefresh, onNavigate, onGeneratePlan }: {
  data: DigitalEmployeeOverview;
  onRefresh?: () => void;
  onNavigate?: (page: Page) => void;
  onGeneratePlan?: () => void;
}) {
  const saved = data.plan?.businessPackage;
  const config = data.config;
  const goal = data.goal;
  const [draft, setDraft] = useState<WeeklyPackage | null>(saved || null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([]);
  useEffect(() => { if (!editing) setDraft(saved || null); }, [saved, editing]);
  useEffect(() => {
    if (!editing) return;
    digitalEmployeeApi.packageOptions().then(options => setProjects(options.projects)).catch(() => setProjects([]));
  }, [editing]);

  const defaultRows = useMemo(() => config ? defaultMatrixPlan(
    config,
    goal?.contentPlatforms || [...new Set(config.publishingTargets.map(item => item.platform))],
    goal?.objective || "验证本周内容方向并获得有效询盘",
  ) : [], [config, goal?.contentPlatforms, goal?.objective]);
  const rows = saved?.matrixPlan?.length ? saved.matrixPlan : defaultRows;
  const profile = socialOperatingProfile(config?.socialOperatingProfile);
  const editable = Boolean(saved && goal && !data.run && goal.status === "draft");

  const applyRows = (pack: WeeklyPackage, matrixRows = pack.matrixPlan || []) => {
    if (!config || !goal) return pack;
    const filled = fillMatrixVideos({
      ...pack,
      matrixPlan: matrixRows,
      authorization: {
        ...pack.authorization,
        accountIds: matrixRows.map(row => row.accountId),
        maxPublishItems: Math.max(1, matrixRows.reduce((sum, row) => sum + row.weeklyCount, 0)),
      },
    }, config.videoDefaults || {}, goal.endsAt);
    const contentCount = filled.tasks.find(task => task.templateId === "production")?.videoPlans?.length || 0;
    return filled.directorPlan ? {
      ...filled,
      directorPlan: { ...filled.directorPlan, originalTarget: contentCount, platformVersionTarget: contentCount, publishTarget: contentCount },
    } : filled;
  };

  const save = async (next: WeeklyPackage) => {
    if (!goal) return;
    setSaving(true); setMessage("");
    try {
      await digitalEmployeeApi.savePackage(goal.id, applyRows(next));
      setEditing(false);
      setMessage("账号矩阵已更新，并同步到本周内容清单。");
      onRefresh?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "账号矩阵保存失败");
    } finally { setSaving(false); }
  };

  return <div className="space-y-5">
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">账号矩阵</p><h2 className="mt-1 text-2xl font-black text-slate-950">本周账号职责与内容配置</h2><p className="mt-1 text-sm text-slate-500">按已确认的经营阶段、已连接账号和平台规则生成；修改后会同步更新内容队列。</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => onNavigate?.("accountManagement")} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700">管理连接账号</button>{editable&&<button type="button" onClick={() => { setDraft(saved || null); setEditing(true); }} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white"><Pencil size={14}/>修改矩阵</button>}</div>
      </div>
      {message&&<p role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">{message}</p>}
      {rows.length > 0 ? <div className="mt-5 grid gap-3 lg:grid-cols-2">{rows.map(row => {
        const account = config?.publishingTargets.find(item => item.accountId === row.accountId);
        const planned = saved?.tasks.find(task => task.templateId === "production")?.videoPlans?.filter(plan => plan.matrix?.accountId === row.accountId).length || 0;
        return <article key={row.accountId} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white"><SocialPlatformIcon platform={row.platform} size={20}/></span><div><p className="text-sm font-black text-slate-950">{account?.accountLabel || row.accountId}</p><p className="mt-0.5 text-[10px] font-bold text-emerald-700">{platformLabels[row.platform]} · {matrixRoleLabel[row.accountRole || "brand_combined"]}</p></div></div><span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-slate-700">本周 {row.weeklyCount} 条</span></div>
          <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2"><div><dt className="font-bold text-slate-400">目标受众</dt><dd className="mt-1 line-clamp-2 font-semibold text-slate-700">{row.audience}</dd></div><div><dt className="font-bold text-slate-400">主推产品</dt><dd className="mt-1 line-clamp-2 font-semibold text-slate-700">{row.productName}</dd></div><div><dt className="font-bold text-slate-400">内容方向</dt><dd className="mt-1 line-clamp-2 font-semibold text-slate-700">{row.contentDirection}</dd></div><div><dt className="font-bold text-slate-400">内容清单</dt><dd className="mt-1 font-semibold text-slate-700">已配置 {planned || row.weeklyCount} 条</dd></div></dl>
        </article>;
      })}</div> : <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6">
        <p className="text-sm font-black text-slate-800">还没有已连接账号，先展示确定性的默认矩阵</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{profile.accounts.map((row, index) => <div key={`${row.platform}-${row.accountRole}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex items-center gap-2"><SocialPlatformIcon platform={row.platform} size={17}/><strong className="text-xs text-slate-800">{platformLabels[row.platform]} · {matrixRoleLabel[row.accountRole]}</strong></div><p className="mt-2 text-[11px] leading-5 text-slate-500">每周 {row.weeklyVideoCount} 条 · {row.purpose}</p><span className="mt-2 inline-block text-[10px] font-bold text-amber-700">待连接账号</span></div>)}</div>
      </div>}
      {!saved&&<div className="mt-5 flex justify-end"><button type="button" onClick={onGeneratePlan} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-black text-white"><CalendarRange size={14}/>生成周计划并应用矩阵</button></div>}
      {saved&&!saved.matrixPlan?.length&&defaultRows.length>0&&editable&&<div className="mt-5 flex justify-end"><button type="button" disabled={saving} onClick={() => void save({ ...saved, matrixPlan: defaultRows })} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50"><LayoutGrid size={14}/>应用默认矩阵</button></div>}
    </section>
    {editing&&draft&&config&&goal&&<div className="fixed inset-0 z-[190] flex justify-end bg-slate-950/35" onMouseDown={() => !saving&&setEditing(false)}><section role="dialog" aria-modal="true" aria-label="修改账号矩阵" className="h-full w-full max-w-[1180px] overflow-y-auto bg-white p-5 shadow-2xl sm:p-7" onMouseDown={event => event.stopPropagation()}><header className="mb-5 flex items-start justify-between gap-4 border-b border-slate-100 pb-4"><div><p className="text-xs font-bold text-emerald-700">本周账号矩阵</p><h2 className="mt-1 text-xl font-black text-slate-950">修改账号、内容方向与排期</h2></div><button type="button" aria-label="关闭修改矩阵" onClick={() => !saving&&setEditing(false)} className="rounded-full border border-slate-200 p-2 text-slate-500"><X size={18}/></button></header><WeeklyMatrixEditor pack={draft} config={config} platforms={goal.contentPlatforms} startsAt={goal.startsAt} dueAt={goal.endsAt} projects={projects} onChange={setDraft} onNavigate={page => onNavigate?.(page)}/><div className="sticky bottom-0 mt-6 flex justify-end border-t border-slate-100 bg-white py-4"><button type="button" disabled={saving} onClick={() => void save(draft)} className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{saving?"保存中…":"保存并更新内容清单"}</button></div></section></div>}
  </div>;
}

function QueueView({ data, onOpenContent }: { data: DigitalEmployeeOverview; onOpenContent?: (taskId?: string) => void }) {
  const deliveries = data.deliveries || [];
  const planned = data.plan?.businessPackage?.tasks.find(task => task.templateId === "production")?.videoPlans || data.goal?.videoPlans || [];
  const accountLabel = (accountId?: string) => data.config?.publishingTargets.find(item => item.accountId === accountId)?.accountLabel || (accountId ? "已配置账号" : "仅制作");
  const costs = deliveries.map((card) => deliveryMetric(card, /成本|费用|花费|消耗/)).filter((value): value is number => value !== null);
  const average = costs.length ? costs.reduce((total, value) => total + value, 0) / costs.length : null;
  const recent = costs.slice(0, Math.max(1, Math.ceil(costs.length / 2)));
  const older = costs.slice(recent.length);
  const recentAverage = recent.length ? recent.reduce((total, value) => total + value, 0) / recent.length : null;
  const olderAverage = older.length ? older.reduce((total, value) => total + value, 0) / older.length : null;
  const trend = recentAverage !== null && olderAverage !== null ? recentAverage - olderAverage : null;

  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
    <section><div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">内容队列</p><h2 className="mt-1 text-2xl font-black text-slate-950">本周内容清单与生产进度</h2><p className="mt-1 text-sm text-slate-500">清单来自已确认的账号矩阵与对标视频；生成后自动进入下方进度队列。</p></div>
      <section className="mt-5 overflow-hidden rounded-3xl border border-emerald-100 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50/50 px-5 py-4"><div><h3 className="text-sm font-black text-slate-950">本周待生成内容</h3><p className="mt-1 text-xs text-slate-500">{planned.length ? `共 ${planned.length} 条，按账号职责、买家问题与平台要求生成。` : "生成周计划后，这里会出现确定的内容清单。"}</p></div><span className="rounded-full bg-white px-3 py-1.5 text-[10px] font-black text-emerald-800">{planned.length} 条</span></div>
        {planned.map((plan,index)=><article key={plan.contentId || `${plan.platform}-${index}`} className={`grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_150px_160px] md:items-center ${index?'border-t border-slate-100':''}`}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><SocialPlatformIcon platform={plan.platform} size={16}/><span className="text-[10px] font-black text-emerald-700">{platformLabels[plan.platform]}</span><span className="text-[10px] text-slate-400">{plan.plannedPublishDate || "待排期"}</span></div><h3 className="mt-2 truncate text-sm font-black text-slate-950">{plan.buyerProblem || plan.theme || `内容 ${index+1}`}</h3><p className="mt-1 truncate text-xs text-slate-500">{plan.productName} · {plan.referenceId ? `对标视频 ${plan.referenceId}` : "依据产品资料与账号策略"}</p></div><div><p className="text-[10px] font-bold text-slate-400">目标账号</p><p className="mt-1 truncate text-xs font-black text-slate-800">{accountLabel(plan.matrix?.accountId)}</p></div><div className="flex items-center justify-between gap-3 md:justify-end"><div className="md:text-right"><p className="text-[10px] font-bold text-slate-400">预计成本</p><p className="mt-1 text-xs font-black text-slate-950">{plan.estimatedCost?`¥${plan.estimatedCost.toFixed(2)}`:"待真实核算"}</p></div><button type="button" onClick={() => onOpenContent?.()} className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-black text-emerald-800 hover:bg-emerald-100">查看制作进度 →</button></div></article>)}
        {!planned.length&&<div className="px-5 py-12 text-center text-sm text-slate-400">尚未生成本周内容清单</div>}
      </section>
      <div className="mb-3 mt-7"><h3 className="text-sm font-black text-slate-950">已进入生产</h3><p className="mt-1 text-xs text-slate-500">按最近更新时间排列，生成中与待验收项目都保留在队列里。</p></div>
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">{deliveries.map((card,index)=>{const cost=deliveryMetric(card,/成本|费用|花费|消耗/);const progress=card.steps.length?Math.round(card.steps.filter(step=>step.state==='done').length/card.steps.length*100):card.column==='done'?100:null;return <article key={card.id} className={`grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_120px_190px] md:items-center ${index?'border-t border-slate-100':''}`}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${card.column==='done'?'bg-emerald-50 text-emerald-700':card.column==='active'?'bg-blue-50 text-blue-700':'bg-amber-50 text-amber-700'}`}>{card.stage||card.column}</span><span className="text-[10px] text-slate-400">{dateLabel(card.updatedAt)}</span></div><h3 className="mt-2 truncate text-sm font-black text-slate-950">{card.title}</h3><p className="mt-1 truncate text-xs text-slate-500">{card.subject}{card.reason?` · ${card.reason}`:''}</p></div><div><p className="text-[10px] font-bold text-slate-400">生成进度</p><p className="mt-1 text-sm font-black text-slate-800">{progress===null?'处理中':`${progress}%`}</p></div><div className="flex items-center justify-between gap-3 md:justify-end"><div className="md:text-right"><p className="text-[10px] font-bold text-slate-400">本条成本</p><p className="mt-1 text-sm font-black text-slate-950">{cost===null?'成本待核算':`¥${cost.toFixed(2)}`}</p></div><button type="button" onClick={() => onOpenContent?.(card.taskId)} className="shrink-0 rounded-lg bg-slate-950 px-3 py-2 text-[10px] font-black text-white hover:bg-slate-800">进入制作台 →</button></div></article>})}{!deliveries.length&&<div className="px-5 py-16 text-center"><Clapperboard size={28} className="mx-auto text-slate-300"/><p className="mt-3 text-sm font-bold text-slate-600">还没有内容进入生产队列</p><p className="mt-1 text-xs text-slate-400">确认周计划后，Agent 会按上方清单开始推进。</p></div>}</div>
    </section>
    <aside className="h-fit rounded-3xl border border-violet-100 bg-violet-50/60 p-5"><Sparkles size={20} className="text-violet-700"/><h3 className="mt-4 text-base font-black text-slate-950">成本建议</h3>{average===null?<><p className="mt-3 text-sm font-bold text-slate-700">积累更多内容后再判断</p><p className="mt-2 text-xs leading-6 text-slate-500">有新的内容成本后，这里会更新趋势并给出预算建议。</p></>:<><p className="mt-3 text-3xl font-black text-violet-950">¥{average.toFixed(2)}</p><p className="mt-1 text-xs text-slate-500">过去内容平均成本</p><p className="mt-4 text-sm font-bold text-slate-800">{trend===null?'暂缺企业成本基线':trend>0?'近期成本正在上升':'近期成本正在下降'}</p><p className="mt-2 text-xs leading-6 text-slate-500">{trend===null?'继续积累至少两个周期的数据，再决定提高预算或调整生成策略。':trend>0?'建议先优化内容生成策略，再考虑追加预算。':'当前策略有成本优势，可把预算优先给高热内容。'}</p></>}</aside>
  </div>;
}

function ReviewView({ data }: { data: DigitalEmployeeOverview }) {
  const [platform, setPlatform] = useState<Platform>("youtube");
  const [accountId, setAccountId] = useState("all");
  const [performance, setPerformance] = useState<ConnectedSocialPerformance | null>(null);
  const [performanceBusy, setPerformanceBusy] = useState(true);
  const [performanceError, setPerformanceError] = useState("");
  const [board, setBoard] = useState<ReviewTodoBoard | null>(null);
  const [todoBusy, setTodoBusy] = useState(false);
  const [todoMessage, setTodoMessage] = useState("");
  const week = nextReviewWeek();
  const deliveries = data.deliveries || [];

  const refreshPerformance = async () => {
    setPerformanceBusy(true); setPerformanceError("");
    try {
      const next = await loadConnectedSocialPerformance();
      setPerformance(next);
      if (!next.accounts.some(item => item.platform === platform)) {
        const first = platformOptions.find(item => next.accounts.some(account => account.platform === item));
        if (first) setPlatform(first);
      }
    } catch (error) { setPerformanceError(error instanceof Error ? error.message : "账号内容数据读取失败"); }
    finally { setPerformanceBusy(false); }
  };

  useEffect(() => { void refreshPerformance(); }, []);
  useEffect(() => { setAccountId("all"); }, [platform]);
  useEffect(() => {
    let active = true;
    setTodoBusy(true);
    digitalEmployeeApi.reviewTodos(week).then((next) => active&&setBoard(next)).catch((error: Error) => active&&setTodoMessage(error.message)).finally(()=>active&&setTodoBusy(false));
    return () => { active=false; };
  }, [week]);

  const connectedAccounts = (performance?.accounts || []).filter(item => item.platform === platform);
  const liveRanking = (performance?.contents || [])
    .filter(item => item.platform === platform && (accountId === "all" || item.accountId === accountId) && item.metrics.views !== null)
    .map(item => ({ id:item.id,title:item.title,subject:`${item.accountTitle} · 内容监控`,accountId:item.accountId,views:item.metrics.views || 0,likes:item.metrics.likes,comments:item.metrics.comments }))
    .sort((left,right)=>right.views-left.views);
  const fallbackRanking = deliveries
    .filter(card => deliveryPlatform(card) === platform && deliveryMetric(card, /播放|浏览|view/i) !== null)
    .map(card => ({id:card.id,title:card.title,subject:`${card.subject} · 经营交付记录`,accountId:"",views:deliveryMetric(card,/播放|浏览|view/i)||0,likes:null,comments:null}))
    .sort((left,right)=>right.views-left.views);
  const ranking = liveRanking.length ? liveRanking : fallbackRanking;
  const top = ranking[0];

  const addTopToTodo = async () => {
    if (!board || !top) return;
    const sourceId = `heat:${platform}:${top.id}`;
    if (board.items.some((item)=>item.sourceIds.includes(sourceId))) { setTodoMessage("这条建议已经在下周待办里了"); return; }
    const item: ReviewTodo = {
      id: crypto.randomUUID(), sourceIds:[sourceId], sourceTitle:`${platformLabels[platform]} 热度排行`, title:`批量复刻《${top.title}》`, kind:"video",
      requirements:`保留《${top.title}》的高表现钩子和节奏，结合下周主推产品制作同结构变体。`, acceptance:"成片结构与原高热内容可对照，产品卖点和事实信息已核验。", materials:"优先使用已授权产品素材与高表现首镜素材。", reference:`${platformLabels[platform]} 播放量：${top.views.toLocaleString("zh-CN")}`,
      quantity:3, videoIndexes:[], status:"pending", reason:"",
    };
    setTodoBusy(true); setTodoMessage("");
    try { const saved=await digitalEmployeeApi.saveReviewTodos({...board,sourceGoalId:board.sourceGoalId||data.goal?.id||"",items:[...board.items,item]});setBoard(saved);setTodoMessage("已加入下周待办");showActionSuccess("已加入下周待办 👏", "Agent 会在下周计划中继续推进这条内容建议。"); }
    catch (error) { setTodoMessage(error instanceof Error?error.message:"保存失败"); }
    finally { setTodoBusy(false); }
  };

  return <div>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">数据复盘</p><h2 className="mt-1 text-2xl font-black text-slate-950">账号内容热度排行</h2><p className="mt-1 text-sm text-slate-500">直接读取“内容监控”同一批已授权账号与视频数据，不再依赖经营交付卡片推断。</p></div><button type="button" disabled={performanceBusy} onClick={() => void refreshPerformance()} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-black text-emerald-800 disabled:opacity-50"><RefreshCcw size={14} className={performanceBusy?"animate-spin":""}/>同步账号数据</button></div>
    {(performanceError||performance?.unavailable.length)&&<div role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">{performanceError||`${performance?.unavailable.length} 个账号暂时无法同步；已保留其他账号的真实数据。`}</div>}
    <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200"><div className="flex gap-3 overflow-x-auto">{platformOptions.map((item)=><button type="button" key={item} title={platformLabels[item]} aria-label={platformLabels[item]} onClick={()=>setPlatform(item)} aria-pressed={platform===item} className={`flex h-11 w-12 shrink-0 items-center justify-center border-b-2 pb-2 ${platform===item?'border-emerald-700':'border-transparent opacity-45 hover:opacity-75'}`}><SocialPlatformIcon platform={item} size={21}/></button>)}</div><select aria-label="复盘账号" value={accountId} onChange={event=>setAccountId(event.target.value)} className="mb-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"><option value="all">全部账号</option>{connectedAccounts.map(account=><option key={account.id} value={account.id}>{account.title}</option>)}</select></div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white">{ranking.map((card,index)=><article key={card.id} className={`grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-4 p-5 ${index?'border-t border-slate-100':''}`}><span className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm font-black ${index===0?'bg-amber-100 text-amber-800':'bg-slate-100 text-slate-500'}`}>{index+1}</span><div className="min-w-0"><h3 className="truncate text-sm font-black text-slate-950">{card.title}</h3><p className="mt-1 truncate text-xs text-slate-400">{card.subject}</p>{(card.likes!==null||card.comments!==null)&&<p className="mt-1 text-[10px] text-slate-400">点赞 {card.likes??"—"} · 评论 {card.comments??"—"}</p>}</div><div className="text-right"><p className="flex items-center gap-1 text-sm font-black text-slate-900"><Eye size={13}/>{card.views.toLocaleString("zh-CN")}</p><p className="mt-1 text-[10px] text-slate-400">播放量</p></div></article>)}{performanceBusy&&!ranking.length?<div className="flex items-center justify-center gap-2 px-5 py-20 text-sm text-slate-400"><Loader2 size={17} className="animate-spin"/>正在同步账号内容数据</div>:!ranking.length&&<div className="px-5 py-20 text-center"><Eye size={28} className="mx-auto text-slate-300"/><p className="mt-3 text-sm font-bold text-slate-600">{platformLabels[platform]} 暂无内容播放量</p><p className="mt-1 text-xs text-slate-400">请确认账号授权包含内容读取权限，然后点击“同步账号数据”。</p></div>}</section>
      <aside className="space-y-4"><section className="rounded-3xl border border-emerald-100 bg-emerald-50/55 p-5"><Sparkles size={20} className="text-emerald-700"/><h3 className="mt-4 text-base font-black text-slate-950">Agent 制作建议</h3><p className="mt-3 text-sm font-bold leading-6 text-slate-800">{top?`批量复刻《${top.title}》的开头钩子与叙事节奏。`:"等待平台播放量回传后生成建议。"}</p><p className="mt-2 text-xs leading-6 text-slate-500">{top?"保留高表现结构，替换为下周主推产品与已核验卖点；建议先制作 3 条变体。":"当前没有足够数据，不生成未经证实的复刻建议。"}</p><button type="button" disabled={!top||!board||todoBusy} onClick={()=>void addTopToTodo()} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40">{todoBusy?<Loader2 size={14} className="animate-spin"/>:<CalendarPlus size={14}/>}纳入下周待办</button>{todoMessage&&<p role="status" className="mt-2 text-center text-[10px] text-emerald-800">{todoMessage}</p>}</section>
        <section className="rounded-3xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><h3 className="text-sm font-black text-slate-950">下周待办</h3><span className="text-[10px] text-slate-400">{week} 起</span></div><div className="mt-4 space-y-3">{board?.items.slice(0,5).map((item)=><div key={item.id} className="flex items-start gap-3"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-700"/><div className="min-w-0"><p className="truncate text-xs font-bold text-slate-800">{item.title}</p><p className="mt-0.5 text-[10px] text-slate-400">{item.quantity>1?`${item.quantity} 条 · `:""}{item.status==='assigned'?'已分配':'待分配'}</p></div></div>)}{board&&!board.items.length&&<p className="py-3 text-xs text-slate-400">暂无待办，可从上方建议直接加入。</p>}{!board&&<p className="py-3 text-xs text-slate-400">正在读取待办…</p>}</div></section></aside>
    </div>
  </div>;
}

export default function SmartBusinessDashboard({ data, view, onRefresh, onNavigate, onGeneratePlan, onOpenContent }: { data: DigitalEmployeeOverview; view: SmartBusinessView; onRefresh?: () => void; onNavigate?: (page: Page) => void; onGeneratePlan?: () => void; onOpenContent?: (taskId?: string) => void }) {
  if (view === "matrix") return <MatrixView data={data} onRefresh={onRefresh} onNavigate={onNavigate} onGeneratePlan={onGeneratePlan}/>;
  if (view === "queue") return <QueueView data={data} onOpenContent={onOpenContent}/>;
  if (view === "review") return <ReviewView data={data}/>;
  return <HomeView data={data} onRefresh={onRefresh}/>;
}
