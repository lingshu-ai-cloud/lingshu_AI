import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
import { SOCIAL_PLATFORM_EXECUTION_RULES, socialOperatingProfile } from "../../shared/contracts/socialOperatingProfile";
import { loadConnectedSocialPerformance, type ConnectedSocialPerformance } from "../lib/socialPerformance";
import { starterWorkspaceApi, type StarterAgentRole } from "../lib/starterWorkspace";
import { authHeader } from "../lib/auth";

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

function PixelAgentScene({ role, active, compact = false }: { role: AgentCard["role"]; active: boolean; compact?: boolean }) {
  const labels: Record<AgentCard["role"], string> = {
    business: "经营控制台正在调度任务",
    director: "编导实验室正在分析样本",
    content: "内容工坊正在拍摄与渲染",
    customer: "客服工作站正在整理询盘",
  };
  return <div className={`pixel-agent-scene pixel-agent-scene--${role} ${active ? "is-running" : "is-idle"} ${compact ? "is-compact" : ""}`} role="img" aria-label={labels[role]}>
    <span className="pixel-stars" aria-hidden="true"/>
    <span className="pixel-floor" aria-hidden="true"/>
    {role === "business" && <><span className="pixel-console"/><span className="pixel-chart pixel-chart--one"/><span className="pixel-chart pixel-chart--two"/><span className="pixel-signal"/></>}
    {role === "director" && <><span className="pixel-lab-table"/><span className="pixel-flask pixel-flask--one"/><span className="pixel-flask pixel-flask--two"/><span className="pixel-bubble pixel-bubble--one"/><span className="pixel-bubble pixel-bubble--two"/></>}
    {role === "content" && <><span className="pixel-camera"><i/></span><span className="pixel-tripod"/><span className="pixel-clap"><i/></span><span className="pixel-record-light"/></>}
    {role === "customer" && <><span className="pixel-terminal"><i/></span><span className="pixel-message pixel-message--one"/><span className="pixel-message pixel-message--two"/><span className="pixel-keyboard"/></>}
    <span className="pixel-worker"><i className="pixel-worker-head"/><i className="pixel-worker-body"/><i className="pixel-worker-arm"/></span>
    {!compact && <span className="pixel-scene-caption">{active ? labels[role] : "等待下一项真实任务"}</span>}
  </div>;
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
    .filter((event) => taskIds.has(event.task_id) || (agentCard.role === "business" && event.type.startsWith("business.")))
    .sort((left, right) => right.sequence - left.sequence)
    .slice(0, 10);
  const completed = agentStatus?.completed || 0;
  const total = agentStatus?.total || 0;
  const currentTask = agentStatus?.currentTask || "当前没有运行中的任务";
  const active = Boolean(agentStatus && runningStatuses.has(agentStatus.status)) || tasks.some(task => runningStatuses.has(task.status));

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
          <div><p className="text-xs font-bold tracking-[0.18em] text-emerald-700">AGENT LIVE</p><h2 className="mt-1 text-xl font-black text-slate-950">{agentCard.name} · 生产实况</h2><p className="mt-1 text-sm text-slate-500">{currentTask}</p></div>
          <button type="button" aria-label="关闭生产实况" onClick={onClose} className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><X size={18}/></button>
        </header>
        <div className="ui-modal-body px-6 py-5">
          <PixelAgentScene role={agentCard.role} active={active}/>
          <div className="rounded-2xl bg-slate-950 p-4 text-white">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><p className="text-[10px] font-bold text-slate-400">当前进度</p><p className="mt-1 text-xl font-black">{completed} / {total}</p></div>
              <div><p className="text-[10px] font-bold text-slate-400">过去已核算消耗</p><p className="mt-1 text-xl font-black">{usageLoading && !hasActualSpend ? "读取中…" : hasActualSpend ? `¥${actualSpend.toFixed(2)}` : "暂无核算"}</p><p className="mt-1 text-[10px] text-slate-400">{settledUsage ? `${settledUsage.source} · ${settledUsage.count} 条${settledUsage.updatedAt ? ` · ${dateLabel(settledUsage.updatedAt)}` : ""}` : fallbackReceiptCount ? `${fallbackReceiptCount} 条真实费用记录` : "仅在服务返回真实结算后计入"}</p></div>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${total ? Math.min(100, completed / total * 100) : 0}%` }}/></div>
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
  const contentQueue = data.contentQueue?.items || [];
  const agentLiveState = Object.fromEntries(agentCards.map(item => {
    const status = data.agents.find(agent => roleAliases[item.role].includes(agent.role));
    const live = Boolean(status && runningStatuses.has(status.status)) || relatedTasks(data, item.role).some(task => runningStatuses.has(task.status));
    return [item.role, live];
  })) as Record<AgentCard["role"], boolean>;
  const activeAgentCount = agentCards.filter(item => agentLiveState[item.role]).length;
  const waitingCount = contentQueue.filter(item => item.status === "waiting_review").length;
  const completedCount = contentQueue.filter(item => item.status === "completed").length;
  const platformCoverage = platformOptions.map(platform => ({
    platform,
    count: contentQueue.filter(item => item.platform === platform).length,
  }));
  const pulse = [
    { label: "已进入内容队列", value: contentQueue.length, color: "#2fd1c5" },
    { label: "已完成交付", value: completedCount, color: "#8b7cf6" },
    { label: "等待验收", value: waitingCount, color: "#ff8e72" },
    { label: "正在工作的 Agent", value: activeAgentCount, color: "#10244a" },
  ];
  const pulseMax = Math.max(1, ...pulse.map(item => item.value));
  const adSpend = snapshot?.ads?.spendByCurrency || [];
  const adSpendValue = adSpend.length === 1 ? `${adSpend[0].currency} ${adSpend[0].amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}` : adSpend.length > 1 ? `${adSpend.length} 种币种` : "—";
  const metrics = [
    { label: "运营平台账号", value: metricValue(snapshot?.social.accountCount.value), note: snapshot?.social.accountCount.note || "已接入账号", icon: Users },
    { label: "获得询盘", value: metricValue(snapshot?.content.inquiries.value), note: snapshot?.content.inquiries.note || "当前统计周期", icon: MessageSquareText },
    { label: "实际增长", value: metricValue(snapshot?.customer.won.value), note: "按成交客户记录", icon: TrendingUp },
    { label: "投流消耗", value: adSpendValue, note: snapshot?.ads?.note || "本周期尚无已同步投放指标", icon: CircleDollarSign },
  ];

  return <>
    <section className="visual-card overflow-hidden p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">过去业绩</p><h2 className="mt-2 text-2xl font-black text-slate-950">经营结果一眼看清</h2><p className="mt-1 text-sm text-slate-500">仅展示业务系统已经回传的真实数据；缺失数据明确标记，不再用本地模拟值覆盖。</p></div>{onRefresh&&<button type="button" onClick={onRefresh} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800"><RefreshCcw size={14}/>刷新</button>}</div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ label, value, note, icon: Icon }, index)=><article key={label} className="relative overflow-hidden rounded-2xl border border-[#10244a]/10 bg-white/90 p-4 shadow-[0_4px_0_rgba(16,36,74,.04)]"><span aria-hidden="true" className={`absolute -right-5 -top-5 h-20 w-20 rounded-full ${index%2?'bg-[#8b7cf6]/10':'bg-[#2fd1c5]/12'}`}/><div className="relative flex items-center justify-between"><span className="text-xs font-bold text-slate-500">{label}</span><span className={`flex h-8 w-8 items-center justify-center rounded-xl border-2 border-[#10244a] ${index%2?'bg-[#dcd7ff]':'bg-[#baf2e8]'}`}><Icon size={15} className="text-[#10244a]" strokeWidth={2.5}/></span></div><p className={`relative mt-3 font-black tracking-tight text-[#10244a] ${index===3?'text-2xl':'text-3xl'}`}>{value}</p><p className="relative mt-1 truncate text-[11px] text-slate-400">{note}</p><div aria-hidden="true" className="relative mt-4 flex h-5 items-end gap-1">{[0.35,0.58,0.46,0.78,0.68].map((height, barIndex)=><span key={barIndex} className={`w-2 rounded-t-sm ${index%2?'bg-[#8b7cf6]/35':'bg-[#2fd1c5]/40'}`} style={{height:`${height*100}%`}}/>)}</div></article>)}</div>
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
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{agentCards.map((item)=>{const status=data.agents.find(agent=>roleAliases[item.role].includes(agent.role));const tasks=relatedTasks(data,item.role);const live=Boolean(status&&runningStatuses.has(status.status))||tasks.some(task=>runningStatuses.has(task.status));return <button type="button" key={item.role} aria-label={`查看${item.name}详情`} onClick={()=>setMonitor(item)} className={`agent-live-card ${live?'agent-live-card--running':''} group relative min-h-52 cursor-pointer overflow-hidden rounded-3xl border p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${live?'border-emerald-300':'border-slate-200'} bg-gradient-to-br ${item.tint}`} style={{"--agent-accent":live?'#10b981':'#94a3b8'} as CSSProperties}>
        <div className="absolute right-3 top-3 w-[92px]"><PixelAgentScene role={item.role} active={live} compact/></div>
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

const matrixSystemLayers = [
  {
    label: '账号矩阵',
    headline: '谁来建立信任',
    detail: '品牌官方号 1 个、区域/垂类号 2 个、销售个人 IP 3–5 个、工厂实拍号 1 个。',
    rule: '同一产品用不同账号角色表达，账号定位不混用。',
  },
  {
    label: '内容矩阵',
    headline: '每个账号持续讲什么',
    detail: '每个账号固定 3–5 个内容栏目；70% 延续有效表达、20% 增加信任内容、10% 做新方向测试。',
    rule: '标题前三词放核心关键词，描述前两行先写痛点。',
  },
  {
    label: '运营矩阵',
    headline: '怎样稳定运转',
    detail: '冷启动 2–3 周、爬升 5–6 周、约 2 个月争取破圈，2–3 个月形成稳定复盘周期。',
    rule: '按平台、账号、栏目和周排期进入统一内容队列。',
  },
  {
    label: '获客矩阵',
    headline: '流量如何变成询盘',
    detail: '每条内容配置唯一询盘钩子，统一承接到网站、WhatsApp、邮箱、目录或表单。',
    rule: '评论/私信 → 资格判断 → 销售跟进 → 结果回收。',
  },
] as const;

const matrixCalendarPhases = [
  { label: "冷启动", detail: "定位 · 测试", start: 1, span: 3, color: "bg-cyan-300 text-slate-950" },
  { label: "爬升", detail: "复用 · 放大", start: 4, span: 4, color: "bg-emerald-300 text-slate-950" },
  { label: "破圈", detail: "冲刺 · 验证", start: 8, span: 2, color: "bg-amber-300 text-slate-950" },
  { label: "稳定复盘", detail: "迭代 · 沉淀", start: 10, span: 3, color: "bg-violet-300 text-slate-950" },
] as const;

const contentFormatLabels: Record<string, string> = {
  native_short_video: "原生短视频",
  reel: "Reels",
  buyer_article: "采购说明",
  carousel: "轮播图",
  short: "Shorts",
};

type MatrixBenchmarkAccount = {
  id: string;
  platform: string;
  accountName: string;
  handle?: string;
  accountUrl?: string;
};

type MatrixMessengerPage = {
  id: string;
  providerAccountId?: string;
  title?: string;
  status?: string;
  messengerSubscribed?: boolean;
};

type MatrixEnterpriseProfile = {
  socialStrategy?: {
    enabledRoutes?: string[];
    routeStrategies?: Record<string, { primaryCta?: string }>;
  };
};

function matrixDate(value: string | undefined, fallback = new Date()) {
  const date = value ? new Date(`${value}T00:00:00`) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function addMatrixDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function MatrixContentCalendar({ startsAt, plans, onOpenPublishing }: {
  startsAt?: string;
  plans: Array<{ plannedPublishDate?: string; platform: string }>;
  onOpenPublishing?: () => void;
}) {
  const anchor = matrixDate(startsAt);
  const today = dateKey(new Date());
  const weeks = Array.from({ length: 12 }, (_, index) => {
    const start = addMatrixDays(anchor, index * 7);
    const end = addMatrixDays(start, 6);
    const startKey = dateKey(start);
    const endKey = dateKey(end);
    return {
      index,
      start,
      end,
      current: today >= startKey && today <= endKey,
      plans: plans.filter(plan => Boolean(plan.plannedPublishDate) && plan.plannedPublishDate! >= startKey && plan.plannedPublishDate! <= endKey),
    };
  });
  const lastDay = weeks[11]?.end || anchor;
  return <section className="overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-sm" aria-label="12 周内容运营日历">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
      <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><CalendarRange size={19}/></span><div><p className="text-[10px] font-black tracking-[0.16em] text-emerald-700">内容运营日历</p><h2 className="mt-1 text-xl font-black text-slate-950">12 周从冷启动到稳定复盘</h2><p className="mt-1 text-xs text-slate-500">每周按照选题 → 制作 → 发布 → 复盘推进，已编排内容会落到对应周。</p></div></div>
      <div className="flex items-center gap-2"><span className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[10px] font-black text-emerald-800">{anchor.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} — {lastDay.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</span>{onOpenPublishing&&<button type="button" onClick={onOpenPublishing} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black text-slate-700 hover:border-emerald-200 hover:text-emerald-700">打开发布日历 →</button>}</div>
    </div>
    <div className="overflow-x-auto px-5 py-5 sm:px-6">
      <div className="min-w-[920px]">
        <div className="grid grid-cols-12 gap-2">{weeks.map(week => <div key={week.index} className={`rounded-xl border px-2 py-2.5 ${week.current ? "border-emerald-500 bg-emerald-50 shadow-sm" : "border-slate-100 bg-slate-50/70"}`}><div className="flex items-center justify-between"><span className={`text-[9px] font-black ${week.current ? "text-emerald-700" : "text-slate-400"}`}>W{week.index + 1}</span>{week.current&&<span className="h-1.5 w-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse"/>}</div><p className="mt-1 text-[10px] font-black text-slate-700">{week.start.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</p><p className="mt-1 text-[8px] text-slate-400">{week.plans.length ? `${week.plans.length} 条已排期` : "等待排期"}</p></div>)}</div>
        <div className="mt-3 grid grid-cols-12 gap-2">{matrixCalendarPhases.map(phase => <div key={phase.label} className={`rounded-xl px-3 py-3 ${phase.color}`} style={{ gridColumn: `${phase.start} / span ${phase.span}` }}><p className="text-[11px] font-black">{phase.label}</p><p className="mt-0.5 text-[9px] opacity-70">{phase.detail}</p></div>)}</div>
        <div className="mt-3 grid grid-cols-12 gap-2">{weeks.map(week => <div key={week.index} className="grid grid-cols-4 gap-1" aria-label={`第 ${week.index + 1} 周工作流`}>{["选题", "制作", "发布", "复盘"].map((step, stepIndex) => <span key={step} title={step} className={`h-1.5 rounded-full ${stepIndex === 0 ? "bg-emerald-500" : stepIndex === 1 ? "bg-sky-400" : stepIndex === 2 ? "bg-violet-400" : "bg-amber-400"}`}/>)}</div>)}</div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-4 text-[9px] font-bold text-slate-500"><span>运营阶段</span>{matrixCalendarPhases.map(phase => <span key={phase.label} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded ${phase.color.split(" ")[0]}`}/>{phase.label}</span>)}<span className="ml-auto text-slate-400">日历只展示计划；实际发布仍需账号连接、质量验收与授权。</span></div>
      </div>
    </div>
  </section>;
}

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
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>("tiktok");
  const [benchmarkAccounts, setBenchmarkAccounts] = useState<MatrixBenchmarkAccount[]>([]);
  const [enterprisePrimaryCta, setEnterprisePrimaryCta] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<{
    loaded: boolean;
    whatsapp: boolean;
    messengerPages: MatrixMessengerPage[];
  }>({ loaded: false, whatsapp: false, messengerPages: [] });
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
  const productionPlans = saved?.tasks.find(task => task.templateId === "production")?.videoPlans || [];
  const accountRows = useMemo(() => rows.length ? rows.map(row => {
    const target = config?.publishingTargets.find(item => item.accountId === row.accountId && item.platform === row.platform);
    return {
    ...row,
    cta: enterprisePrimaryCta || row.cta,
    connected: row.connected !== false && Boolean(target),
    accountLabel: target?.accountLabel || `${platformLabels[row.platform]} · ${matrixRoleLabel[row.accountRole || "brand_combined"]}`,
  };}) : profile.accounts.map((row, index) => ({
    accountId: `default-${row.platform}-${row.accountRole}-${index}`,
    accountRole: row.accountRole,
    formats: row.formats,
    platform: row.platform,
    audience: config?.customerProfile || "待补充目标受众",
    productName: config?.focusProducts || "待选择主推产品",
    language: config?.videoDefaults?.language || "en",
    objective: row.purpose,
    contentDirection: row.purpose,
    cta: enterprisePrimaryCta || SOCIAL_PLATFORM_EXECUTION_RULES[row.platform].ctaRule,
    weeklyCount: row.weeklyVideoCount,
    sourceProjectIds: [] as string[],
    connected: false,
    accountLabel: `${platformLabels[row.platform]} · ${matrixRoleLabel[row.accountRole]}`,
  })), [config, enterprisePrimaryCta, profile.accounts, rows]);
  const visiblePlatforms = useMemo(() => platformOptions.filter(platform => accountRows.some(row => row.platform === platform)), [accountRows]);
  const selectedAccounts = accountRows.filter(row => row.platform === selectedPlatform);

  useEffect(() => {
    if (visiblePlatforms.length && !visiblePlatforms.includes(selectedPlatform)) setSelectedPlatform(visiblePlatforms[0]);
  }, [selectedPlatform, visiblePlatforms]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const [benchmarkResult, whatsappResult, messengerResult, enterpriseResult] = await Promise.allSettled([
        fetch("/api/overseas/competitor-accounts", { headers: authHeader() }),
        fetch("/api/oauth/whatsapp/config", { headers: authHeader() }),
        fetch("/api/overseas/social/accounts?platform=facebook", { headers: authHeader() }),
        fetch("/api/overseas/enterprise/profile", { headers: authHeader() }),
      ]);
      if (!active) return;
      let accounts: MatrixBenchmarkAccount[] = [];
      let whatsapp = false;
      let messengerPages: MatrixMessengerPage[] = [];
      let primaryCta = "";
      if (benchmarkResult.status === "fulfilled" && benchmarkResult.value.ok) {
        const body = await benchmarkResult.value.json().catch(() => ({})) as { items?: MatrixBenchmarkAccount[] };
        accounts = Array.isArray(body.items) ? body.items : [];
      }
      if (whatsappResult.status === "fulfilled" && whatsappResult.value.ok) {
        const body = await whatsappResult.value.json().catch(() => ({})) as { connected?: boolean };
        whatsapp = body.connected === true;
      }
      if (messengerResult.status === "fulfilled" && messengerResult.value.ok) {
        const body = await messengerResult.value.json().catch(() => ({})) as { items?: MatrixMessengerPage[] };
        messengerPages = Array.isArray(body.items) ? body.items : [];
      }
      if (enterpriseResult.status === "fulfilled" && enterpriseResult.value.ok) {
        const body = await enterpriseResult.value.json().catch(() => ({})) as MatrixEnterpriseProfile;
        const routes = body.socialStrategy?.enabledRoutes || [];
        const strategies = body.socialStrategy?.routeStrategies || {};
        primaryCta = routes.map(route => strategies[route]?.primaryCta?.trim() || "").find(Boolean)
          || Object.values(strategies).map(strategy => strategy?.primaryCta?.trim() || "").find(Boolean)
          || "";
      }
      if (active) {
        setBenchmarkAccounts(accounts);
        setEnterprisePrimaryCta(primaryCta);
        setConnectionStatus({ loaded: true, whatsapp, messengerPages });
      }
    })();
    return () => { active = false; };
  }, []);

  const applyRows = (pack: WeeklyPackage, matrixRows = pack.matrixPlan || []) => {
    if (!config || !goal) return pack;
    const effectiveRows = matrixRows.map(row => ({ ...row, cta: enterprisePrimaryCta || row.cta }));
    const filled = fillMatrixVideos({
      ...pack,
      matrixPlan: effectiveRows,
      authorization: {
        ...pack.authorization,
        accountIds: effectiveRows.filter(row => row.connected !== false && config.publishingTargets.some(target => target.accountId === row.accountId && target.platform === row.platform)).map(row => row.accountId),
        maxPublishItems: Math.max(1, effectiveRows.reduce((sum, row) => sum + row.weeklyCount, 0)),
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

  const synchronizePackage = async () => {
    if (!goal) return;
    setSaving(true); setMessage("");
    try {
      const recommended = await digitalEmployeeApi.recommendPackage(goal.id);
      await digitalEmployeeApi.savePackage(goal.id, recommended);
      setMessage("周任务包已按视频矩阵、周频次、对标账号与爆款匹配结果重新编排。");
      onRefresh?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "周任务包同步失败");
    } finally { setSaving(false); }
  };

  return <div className="space-y-5">
    <section className="overflow-hidden rounded-3xl border border-emerald-200 bg-[#102d25] text-white shadow-sm">
      <div className="border-b border-white/10 px-5 py-5 sm:px-6">
        <p className="text-[10px] font-black tracking-[0.14em] text-emerald-300">多平台社媒矩阵 · 经营蓝图</p>
        <h2 className="mt-1 text-2xl font-black">从账号、内容、运营到获客的完整系统</h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-emerald-50/70">经营 Agent 负责目标、平台、账号数量与预算；编导 Agent 固化账号表达宪法；内容 Agent 再按栏目、素材和质量标准生产。</p>
      </div>
      <div className="grid gap-px bg-white/10 sm:grid-cols-2 xl:grid-cols-4">
        {matrixSystemLayers.map((layer, index) => <article key={layer.label} className={`bg-[#102d25] p-5 xl:col-span-2 ${layer.label === "运营矩阵" || layer.label === "获客矩阵" ? "sm:col-span-2" : ""}`}>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-400/15 text-xs font-black text-emerald-300">0{index + 1}</span>
          <p className="mt-4 text-[10px] font-black text-emerald-300">{layer.label}</p>
          <h3 className="mt-1 text-base font-black">{layer.headline}</h3>
          <p className="mt-2 text-xs leading-5 text-emerald-50/70">{layer.detail}</p>
          <p className="mt-3 rounded-lg bg-white/5 px-3 py-2 text-[10px] leading-4 text-emerald-100/75">规则：{layer.rule}</p>
        </article>)}
      </div>
      <div className="grid gap-px border-t border-white/10 bg-white/10 lg:grid-cols-[1.1fr_1.2fr]">
        <div className="bg-[#173d31] px-5 py-4"><p className="text-[9px] font-black text-emerald-300">平台优先级</p><p className="mt-1 text-xs font-bold leading-5 text-white">LinkedIn：B2B 主阵地 · Facebook：定向广告与行业群组 · YouTube：长效信任 · TikTok / Instagram：触达与测试</p></div>
        <div className="bg-[#173d31] px-5 py-4"><p className="text-[9px] font-black text-emerald-300">线索闭环</p><p className="mt-1 text-xs font-bold leading-5 text-white">评论 “Quote” / 私信 → 官网、WhatsApp、邮箱或目录 → 客服 Agent 分级 → 销售跟进 → 周复盘</p></div>
      </div>
    </section>
    <MatrixContentCalendar startsAt={goal?.startsAt} plans={productionPlans} onOpenPublishing={() => onNavigate?.("traffic")}/>
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">账号矩阵</p><h2 className="mt-1 text-2xl font-black text-slate-950">本周账号职责与内容配置</h2><p className="mt-1 text-sm text-slate-500">按已确认的经营阶段、已连接账号和平台规则生成；修改后会同步更新内容队列。</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => onNavigate?.("accountManagement")} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700">管理连接账号</button>{editable&&<button type="button" disabled={saving} onClick={() => void synchronizePackage()} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-black text-emerald-800 disabled:opacity-50"><RefreshCcw size={14} className={saving ? "animate-spin" : ""}/>按矩阵同步周任务包</button>}{editable&&<button type="button" onClick={() => { setDraft(saved || null); setEditing(true); }} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white"><Pencil size={14}/>修改矩阵</button>}</div>
      </div>
      {message&&<p role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">{message}</p>}
      {!rows.length&&<p className="mt-5 rounded-xl border border-dashed border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">还没有已连接账号，当前展示可直接配置的默认账号矩阵。</p>}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="按平台查看账号">
        {visiblePlatforms.map(platform => {
          const count = accountRows.filter(row => row.platform === platform).length;
          const selected = selectedPlatform === platform;
          return <button key={platform} type="button" aria-pressed={selected} onClick={() => setSelectedPlatform(platform)} className={`rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${selected ? "border-emerald-500 bg-emerald-50 shadow-sm" : "border-slate-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/40"}`}>
            <div className="flex items-center justify-between gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${selected ? "bg-white" : "bg-slate-50"}`}><SocialPlatformIcon platform={platform} size={21}/></span><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${selected ? "bg-emerald-700 text-white" : "bg-slate-100 text-slate-500"}`}>{count} 个账号</span></div>
            <p className="mt-3 text-sm font-black text-slate-950">{platformLabels[platform]}</p><p className="mt-1 text-[10px] text-slate-500">点击查看账号详情与内容</p>
          </button>;
        })}
      </div>
      <div className="mt-4 space-y-4">{selectedAccounts.map(row => {
        const plans = productionPlans.filter(plan => plan.matrix?.accountId === row.accountId);
        const benchmarks = benchmarkAccounts.filter(item => item.platform === row.platform);
        const matchedMessenger = row.platform === "facebook" && connectionStatus.messengerPages.some(page => page.status === "connected" && page.messengerSubscribed && (!row.connected || page.id === row.accountId || page.providerAccountId === row.accountId || page.title === row.accountLabel));
        const checklist = [
          { label: "WhatsApp", value: connectionStatus.loaded ? connectionStatus.whatsapp ? "已挂载" : "未挂载" : "读取中", done: connectionStatus.whatsapp },
          { label: "Messenger", value: row.platform === "facebook" ? connectionStatus.loaded ? matchedMessenger ? "已挂载" : "未挂载" : "读取中" : "不适用", done: matchedMessenger, neutral: row.platform !== "facebook" },
          { label: "企业默认 CTA", value: enterprisePrimaryCta ? "已继承" : "待在企业中心配置", done: Boolean(enterprisePrimaryCta) },
          { label: "对标账号", value: benchmarks.length ? `${benchmarks.length} 个` : "待配置", done: benchmarks.length > 0 },
        ];
        return <article key={row.accountId} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/60">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-white p-4"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white"><SocialPlatformIcon platform={row.platform} size={20}/></span><div><p className="text-sm font-black text-slate-950">{row.accountLabel}</p><p className="mt-0.5 text-[10px] font-bold text-emerald-700">{platformLabels[row.platform]} · {matrixRoleLabel[row.accountRole || "brand_combined"]} · {row.connected ? "已连接" : "待连接"}</p></div></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-700">本周 {row.weeklyCount} 条</span></div>
          <div className="grid gap-px bg-slate-200 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            <div className="bg-white p-4"><p className="text-[10px] font-black tracking-[0.12em] text-slate-400">账号详情</p><dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2"><div><dt className="font-bold text-slate-400">目标受众</dt><dd className="mt-1 font-semibold leading-5 text-slate-700">{row.audience}</dd></div><div><dt className="font-bold text-slate-400">主推产品</dt><dd className="mt-1 font-semibold leading-5 text-slate-700">{row.productName}</dd></div><div><dt className="font-bold text-slate-400">内容方向</dt><dd className="mt-1 font-semibold leading-5 text-slate-700">{row.contentDirection}</dd></div><div><dt className="font-bold text-slate-400">内容栏目</dt><dd className="mt-1 font-semibold leading-5 text-slate-700">{row.formats?.length ? row.formats.map(format => contentFormatLabels[format] || format).join(" · ") : "待配置"}</dd></div></dl>
              <div className="mt-4"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-black tracking-[0.12em] text-slate-400">账号连接与对标完成项</p><span className="text-[10px] font-bold text-emerald-700">{checklist.filter(item => item.done || item.neutral).length}/{checklist.length}</span></div><div className="mt-2 grid gap-2 sm:grid-cols-2">{checklist.map(item => <div key={item.label} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"><span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600">{item.done ? <CheckCircle2 size={13} className="text-emerald-600"/> : <span className={`h-3 w-3 rounded-full border ${item.neutral ? "border-slate-300 bg-slate-100" : "border-amber-400 bg-amber-50"}`}/>} {item.label}</span><span className={`text-[9px] font-black ${item.done ? "text-emerald-700" : item.neutral ? "text-slate-400" : "text-amber-700"}`}>{item.value}</span></div>)}</div></div>
              <div className="mt-4"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-black tracking-[0.12em] text-slate-400">对标账号</p><button type="button" onClick={() => onNavigate?.("socialInspiration")} className="text-[10px] font-black text-emerald-700">管理对标账号 →</button></div>{benchmarks.length ? <div className="mt-2 flex flex-wrap gap-2">{benchmarks.map(item => <span key={item.id} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold text-slate-700">{item.accountName || item.handle || "未命名账号"}</span>)}</div> : <p className="mt-2 text-[11px] text-slate-400">该平台尚未配置对标账号。</p>}</div>
            </div>
            <div className="bg-white p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black tracking-[0.12em] text-slate-400">账号内容</p><p className="mt-1 text-xs font-black text-slate-900">{plans.length ? `${plans.length} 条已进入本周清单` : `${row.weeklyCount} 个待编排内容位`}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-black text-slate-600">{platformLabels[row.platform]}</span></div>
              <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-[9px] font-bold leading-4 text-emerald-800">编排顺序：账号周频次 → 对标账号与爆款匹配 → 买家问题 → 产品事实证据 → 发布日期</p>
              <div className="mt-3 space-y-2">{plans.length ? plans.map((plan, index) => { const evidence = plan.planningEvidence; return <div key={plan.contentId || index} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3"><div className="flex flex-wrap items-center gap-1.5"><span className="rounded-full bg-white px-2 py-1 text-[8px] font-black text-emerald-700">{plan.route === "clone" ? "爆款复刻" : plan.route === "material" ? "素材生成" : "产品生成"}</span><span className="text-[9px] font-bold text-slate-400">{plan.plannedPublishDate || "待排期"}</span>{evidence?.matchScore ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-[8px] font-black text-emerald-800">匹配 {evidence.matchScore}</span> : null}<span className="ml-auto shrink-0 text-[9px] font-bold text-emerald-700">{plan.directorStatus === "approved" ? "已通过" : plan.directorStatus === "in_production" ? "制作中" : "待编导"}</span></div><p className="mt-2 text-[11px] font-black leading-5 text-slate-800">{plan.theme || `内容 ${index + 1}`}</p><p className="mt-1 text-[10px] leading-4 text-slate-600"><strong>买家问题：</strong>{plan.buyerProblem || row.contentDirection}</p><p className="mt-1 text-[10px] leading-4 text-slate-500"><strong>证据：</strong>{plan.evidenceRequirement || "使用企业资料与素材库中的可核验画面"}</p>{(evidence?.benchmarkAccount || evidence?.referenceTitle)&&<p className="mt-1 truncate text-[9px] text-violet-700">参考：{[evidence.benchmarkAccount, evidence.referenceTitle].filter(Boolean).join(" · ")}</p>}</div>; }) : Array.from({ length: Math.min(row.weeklyCount, 5) }, (_, index) => <div key={index} className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-slate-200 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-[11px] font-bold text-slate-700">内容位 {index + 1} · {row.contentDirection}</p><p className="mt-0.5 text-[9px] text-slate-400">点击“按矩阵同步周任务包”生成具体买家问题、匹配参考与排期</p></div><span className="shrink-0 text-[9px] font-bold text-amber-700">待同步</span></div>)}</div>{!plans.length && row.weeklyCount > 5 && <p className="mt-2 text-[10px] text-slate-400">另有 {row.weeklyCount - 5} 个内容位，将在周计划中继续展开。</p>}
            </div>
          </div>
        </article>;
      })}</div>
      {!saved&&<div className="mt-5 flex justify-end"><button type="button" onClick={onGeneratePlan} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-black text-white"><CalendarRange size={14}/>生成周计划并应用矩阵</button></div>}
      {saved&&!saved.matrixPlan?.length&&defaultRows.length>0&&editable&&<div className="mt-5 flex justify-end"><button type="button" disabled={saving} onClick={() => void save({ ...saved, matrixPlan: defaultRows })} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50"><LayoutGrid size={14}/>应用默认矩阵</button></div>}
    </section>
    {editing&&draft&&config&&goal&&<div className="fixed inset-0 z-[190] flex justify-end bg-slate-950/35" onMouseDown={() => !saving&&setEditing(false)}><section role="dialog" aria-modal="true" aria-label="修改账号矩阵" className="h-full w-full max-w-[1180px] overflow-y-auto bg-white p-5 shadow-2xl sm:p-7" onMouseDown={event => event.stopPropagation()}><header className="mb-5 flex items-start justify-between gap-4 border-b border-slate-100 pb-4"><div><p className="text-xs font-bold text-emerald-700">本周账号矩阵</p><h2 className="mt-1 text-xl font-black text-slate-950">修改账号、内容方向与排期</h2></div><button type="button" aria-label="关闭修改矩阵" onClick={() => !saving&&setEditing(false)} className="rounded-full border border-slate-200 p-2 text-slate-500"><X size={18}/></button></header><WeeklyMatrixEditor pack={draft} config={config} platforms={goal.contentPlatforms} startsAt={goal.startsAt} dueAt={goal.endsAt} projects={projects} onChange={setDraft} onNavigate={page => onNavigate?.(page)}/><div className="sticky bottom-0 mt-6 flex justify-end border-t border-slate-100 bg-white py-4"><button type="button" disabled={saving} onClick={() => void save(draft)} className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{saving?"保存中…":"保存并更新内容清单"}</button></div></section></div>}
  </div>;
}

function QueueView({ data, onOpenContent }: { data: DigitalEmployeeOverview; onOpenContent?: (taskId?: string) => void }) {
  const projection = data.contentQueue;
  const items = projection?.items || [];
  const pageSize = 6;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const pageItems = items.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => setPage(current => Math.min(current, totalPages)), [totalPages]);
  const costs = items.map(item => item.settledCostCny).filter((value): value is number => value !== null);
  const average = costs.length ? costs.reduce((total, value) => total + value, 0) / costs.length : null;
  const recent = costs.slice(0, Math.max(1, Math.ceil(costs.length / 2)));
  const older = costs.slice(recent.length);
  const recentAverage = recent.length ? recent.reduce((total, value) => total + value, 0) / recent.length : null;
  const olderAverage = older.length ? older.reduce((total, value) => total + value, 0) / older.length : null;
  const trend = recentAverage !== null && olderAverage !== null ? recentAverage - olderAverage : null;
  const completed = items.filter(item => item.status === "completed").length;
  const producing = items.filter(item => item.status === "producing").length;
  const waiting = items.filter(item => item.status === "waiting_review").length;
  const statusLabel = { planned: "计划已生成", queued: "等待制作", producing: "制作中", waiting_review: "待验收", completed: "已完成", blocked: "制作受阻" } as const;
  const statusTone = { planned: "bg-slate-100 text-slate-700", queued: "bg-sky-50 text-sky-700", producing: "bg-blue-50 text-blue-700", waiting_review: "bg-amber-50 text-amber-700", completed: "bg-emerald-50 text-emerald-700", blocked: "bg-red-50 text-red-700" } as const;
  const routeLabel = { clone: "爆款复刻", product: "产品生成", material: "素材生成" } as const;

  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
    <section><div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">内容队列</p><h2 className="mt-1 text-2xl font-black text-slate-950">计划、制作、验收与成本在同一条链路</h2><p className="mt-1 text-sm text-slate-500">经营 Agent 按账号矩阵数量、对标账号内容、爆款精确分析与产品证据生成计划；确认后逐条创建制作项目。</p></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-4">{[["计划总数",items.length],["制作中",producing],["待验收",waiting],["已完成",completed]].map(([label,value])=><div key={String(label)} className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><p className="text-[10px] font-bold text-slate-400">{label}</p><p className="mt-1 text-xl font-black text-slate-950">{value}</p></div>)}</div>
      <div className={`mt-4 rounded-xl border px-4 py-3 text-xs ${projection?.sourceStatus === 'available' ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}><strong>{projection?.sourceStatus === 'available' ? '真实链路已连接' : '队列等待数据'}</strong><span className="ml-2">{projection?.sourceNote || "当前没有可读取的内容计划"}</span></div>
      <section className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white">
        {pageItems.map((item,index)=><article key={item.id} className={`p-5 ${index?'border-t border-slate-100':''}`}>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px_180px] lg:items-center">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><SocialPlatformIcon platform={item.platform} size={16}/><span className="text-[10px] font-black text-emerald-700">{platformLabels[item.platform]}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-600">{routeLabel[item.route]}</span><span className={`rounded-full px-2 py-1 text-[9px] font-black ${statusTone[item.status]}`}>{statusLabel[item.status]}</span><span className="text-[10px] text-slate-400">{item.plannedPublishDate || "待排期"}</span></div><h3 className="mt-2 text-sm font-black text-slate-950">{item.title}</h3><p className="mt-1 text-xs text-slate-500">{item.productName || "待绑定产品"} · {item.accountLabel || data.config?.publishingTargets.find(target=>target.accountId===item.accountId)?.accountLabel || "仅制作"}{item.languages.length?` · ${item.languages.join(" / ").toUpperCase()}`:""}</p>{item.reason&&<p className="mt-2 text-[10px] font-bold text-red-600">{item.reason}</p>}</div>
            <div><div className="flex items-center justify-between text-[10px]"><span className="font-bold text-slate-400">{item.stage}</span><strong className="text-slate-800">{item.progress}%</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${item.status==='blocked'?'bg-red-500':item.status==='completed'?'bg-emerald-500':'bg-blue-500'}`} style={{width:`${item.progress}%`}}/></div><div className="mt-2 flex gap-1">{item.steps.map(step=><span key={step.label} title={`${step.label}：${step.state}`} className={`h-1.5 flex-1 rounded-full ${step.state==='done'?'bg-emerald-500':step.state==='active'?'bg-blue-500 motion-safe:animate-pulse':'bg-slate-200'}`}/>)}</div></div>
            <div className="flex items-center justify-between gap-3 lg:justify-end"><div className="lg:text-right"><p className="text-[10px] font-bold text-slate-400">本条真实成本</p><p className="mt-1 text-sm font-black text-slate-950">{item.settledCostCny!==null?`¥${item.settledCostCny.toFixed(2)}`:item.costStatus==='awaiting_settlement'?"供应商待结算":item.estimatedCostCny!==null?`预计 ¥${item.estimatedCostCny.toFixed(2)}`:"暂无结算回执"}</p></div><button type="button" onClick={() => onOpenContent?.(item.taskId || undefined)} className="shrink-0 rounded-lg bg-slate-950 px-3 py-2 text-[10px] font-black text-white hover:bg-slate-800">进入制作台 →</button></div>
          </div>
          <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/45 px-4 py-3"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-black text-emerald-800">计划依据</span>{item.matchScore!==null&&<span className="rounded-full bg-white px-2 py-1 text-[9px] font-black text-emerald-700">匹配度 {item.matchScore}</span>}{item.benchmarkAccount&&<span className="rounded-full bg-white px-2 py-1 text-[9px] font-bold text-slate-700">对标账号：{item.benchmarkAccount}</span>}{item.referenceTitle&&<span className="max-w-full truncate rounded-full bg-white px-2 py-1 text-[9px] font-bold text-slate-700">参考：{item.referenceTitle}</span>}</div><p className="mt-2 text-[10px] leading-5 text-slate-600">{item.planningFactors.length?item.planningFactors.join(" · "):"依据账号矩阵、产品资料与平台规则生成；当前没有可用的爆款精确分析。"}</p></div>
        </article>)}
        {!items.length&&<div className="px-5 py-16 text-center"><Clapperboard size={28} className="mx-auto text-slate-300"/><p className="mt-3 text-sm font-bold text-slate-600">还没有内容进入生产队列</p><p className="mt-1 text-xs text-slate-400">生成并确认周计划后，经营 Agent 会冻结每条订单并依次调度制作。</p></div>}
        {totalPages > 1 && <nav aria-label="内容队列分页" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4"><p className="text-[10px] font-bold text-slate-400">第 {page} / {totalPages} 页 · 共 {items.length} 条</p><div className="flex items-center gap-1.5"><button type="button" disabled={page === 1} onClick={() => setPage(current => Math.max(1, current - 1))} className="rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-black text-slate-600 disabled:cursor-not-allowed disabled:opacity-40">上一页</button>{Array.from({ length: totalPages }, (_, index) => index + 1).map(value => <button key={value} type="button" aria-current={value === page ? "page" : undefined} onClick={() => setPage(value)} className={`h-8 w-8 rounded-lg text-[10px] font-black ${value === page ? "bg-emerald-700 text-white" : "border border-slate-200 text-slate-600 hover:border-emerald-200 hover:text-emerald-700"}`}>{value}</button>)}<button type="button" disabled={page === totalPages} onClick={() => setPage(current => Math.min(totalPages, current + 1))} className="rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-black text-slate-600 disabled:cursor-not-allowed disabled:opacity-40">下一页</button></div></nav>}
      </section>
    </section>
    <aside className="h-fit rounded-3xl border border-violet-100 bg-violet-50/60 p-5"><Sparkles size={20} className="text-violet-700"/><h3 className="mt-4 text-base font-black text-slate-950">成本建议</h3>{average===null?<><p className="mt-3 text-sm font-bold text-slate-700">等待真实供应商结算</p><p className="mt-2 text-xs leading-6 text-slate-500">这里只统计与具体制作项目绑定、且已经对账的供应商费用；预计金额不会冒充实际花费。</p></>:<><p className="mt-3 text-3xl font-black text-violet-950">¥{average.toFixed(2)}</p><p className="mt-1 text-xs text-slate-500">已结算内容平均成本</p><p className="mt-4 text-sm font-bold text-slate-800">{trend===null?'暂缺企业成本基线':trend>0?'近期成本正在上升':'近期成本正在下降'}</p><p className="mt-2 text-xs leading-6 text-slate-500">{trend===null?'继续积累至少两个结算周期，再决定提高预算或调整生成策略。':trend>0?'建议先优化内容生成策略，再考虑追加预算。':'当前策略有成本优势，可把预算优先给高匹配内容。'}</p></>}</aside>
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
