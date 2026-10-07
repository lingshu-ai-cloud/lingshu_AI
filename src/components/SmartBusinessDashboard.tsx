import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
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
  Trophy,
  Users,
  X,
} from "lucide-react";
import { digitalEmployeeApi, type ContentExecutionRuntimeJob, type ContentQueueItem, type DigitalEmployeeOverview, type DigitalEmployeeAgentRole } from "../lib/digitalEmployees";
import { nextReviewWeek, type ReviewTodo, type ReviewTodoBoard } from "../lib/reviewTodos";
import type { DeliveryResource } from "../lib/delivery";
import type { Page } from "../pageRegistry";
import { SocialPlatformIcon } from "./SocialPlatformIcon";
import { showActionSuccess } from "../lib/actionFeedback";
import AgentRoleIcon from "./ui/AgentRoleIcon";
import WeeklyMatrixEditor from "./WeeklyMatrixEditor";
import type { WeeklyPackage } from "../lib/weeklyPackage";
import { defaultMatrixPlan, fillMatrixVideos } from "../lib/weeklyMatrix";
import type { VideoCreationPlan } from "../lib/videoCreationPlan";
import { SOCIAL_PLATFORM_EXECUTION_RULES, socialOperatingProfile } from "../../shared/contracts/socialOperatingProfile";
import { loadConnectedSocialPerformance, type ConnectedSocialPerformance } from "../lib/socialPerformance";
import { starterWorkspaceApi, type StarterAgentRole } from "../lib/starterWorkspace";
import { authHeader } from "../lib/auth";
import ProductionTaskScene from "./ProductionTaskScene";
import MatrixWorkSchedule from "./smartBusiness/MatrixWorkSchedule";

export type SmartBusinessView = "home" | "matrix" | "queue" | "production" | "review";

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

function productionDurationLabel(minutes: number) {
  if (minutes < 60) return `约 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `约 ${hours} 小时${rest ? ` ${rest} 分钟` : ""}`;
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

const executionStatusLabel: Record<ContentExecutionRuntimeJob["status"], string> = {
  queued: "排队中",
  running: "制作中",
  retry_wait: "等待重试",
  reconciling: "供应商对账",
  blocked: "需要处理",
  paused: "已暂停",
  succeeded: "已完成",
  cancelled: "已取消",
  dead_letter: "恢复已停止",
};

const executionStatusTone: Record<ContentExecutionRuntimeJob["status"], string> = {
  queued: "bg-sky-50 text-sky-700",
  running: "bg-blue-50 text-blue-700",
  retry_wait: "bg-amber-50 text-amber-700",
  reconciling: "bg-violet-50 text-violet-700",
  blocked: "bg-red-50 text-red-700",
  paused: "bg-amber-50 text-amber-800",
  succeeded: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-slate-100 text-slate-500",
  dead_letter: "bg-red-100 text-red-800",
};

const confidenceTone = {
  high: "bg-emerald-50 text-emerald-700",
  medium: "bg-sky-50 text-sky-700",
  low: "bg-amber-50 text-amber-700",
  insufficient: "bg-slate-100 text-slate-500",
} as const;

function executionWaitingLabel(job: ContentExecutionRuntimeJob) {
  if (job.status === "retry_wait" && job.nextAttemptAt) return `预计 ${dateLabel(job.nextAttemptAt)} 自动重试`;
  if (job.status === "reconciling" && job.nextAttemptAt) return `预计 ${dateLabel(job.nextAttemptAt)} 再次对账`;
  if (job.queuePosition !== null) {
    const reason = job.waitingOn === "tenant" ? "客户并发已满"
      : job.waitingOn === "account" ? "账号并发已满"
        : job.waitingOn === "task_type" ? "同类任务并发已满"
          : "等待后台工作槽";
    return `本客户队列第 ${job.queuePosition} 位 · ${reason}`;
  }
  return job.publicReason;
}

type ExecutionControlAction = "pause" | "cancel" | "resume" | "retry";

function ExecutionRuntimePanel({ data, onRefresh, onControlJob, compact = false }: { data: DigitalEmployeeOverview; onRefresh?: () => void; onControlJob?: (jobId: string, action: ExecutionControlAction) => Promise<boolean>; compact?: boolean }) {
  const runtime = data.executionRuntime;
  const [controlling, setControlling] = useState("");
  const [controlError, setControlError] = useState("");
  if (!runtime) return null;
  const activeJobs = runtime.jobs.filter(job => ["running", "queued", "retry_wait", "reconciling", "blocked", "paused", "cancelled", "dead_letter"].includes(job.status));
  const visibleJobs = [...activeJobs].sort((left, right) => {
    const priority = (status: ContentExecutionRuntimeJob["status"]) => status === "blocked" || status === "dead_letter" ? 0 : status === "paused" ? 1 : status === "reconciling" ? 2 : status === "retry_wait" ? 3 : status === "running" ? 4 : status === "queued" ? 5 : 6;
    return priority(left.status) - priority(right.status) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  }).slice(0, compact ? 4 : 6);
  const accountLabel = (accountId: string) => data.config?.publishingTargets.find(target => target.accountId === accountId)?.accountLabel || (accountId === "_unassigned" ? "未指定账号" : accountId);
  const controlsFor = (job: ContentExecutionRuntimeJob): Array<{ action: ExecutionControlAction; label: string; tone?: string }> => {
    if (["blocked", "dead_letter"].includes(job.status)) return [{ action: "retry", label: "重新生成", tone: "bg-amber-400 text-amber-950" }, { action: "cancel", label: "取消" }];
    if (["paused", "cancelled"].includes(job.status)) return [{ action: "resume", label: job.status === "cancelled" ? "恢复为新一轮" : "继续任务", tone: "bg-emerald-700 text-white" }];
    if (["queued", "running", "retry_wait", "reconciling"].includes(job.status)) return [{ action: "pause", label: "暂停" }, { action: "cancel", label: "取消" }];
    return [];
  };
  const control = async (job: ContentExecutionRuntimeJob, action: ExecutionControlAction) => {
    if (!onControlJob || controlling) return;
    if (action === "cancel" && !window.confirm("取消后会停止后续节点；已经提交给供应商的当前步骤可能仍需完成对账。确定取消吗？")) return;
    setControlling(`${job.id}:${action}`);
    setControlError("");
    try {
      const ok = await onControlJob(job.id, action);
      if (ok) showActionSuccess(action === "pause" ? "任务已暂停" : action === "cancel" ? "任务已取消" : action === "resume" ? "任务已恢复" : "任务已重新排队", "进度与已完成结果均已保留。");
    } catch (error) {
      setControlError(error instanceof Error ? error.message : "任务操作失败，请重试");
    } finally {
      setControlling("");
    }
  };

  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="execution-runtime-title">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-[10px] font-black uppercase tracking-[.16em] text-violet-700">Background operations</p><h2 id="execution-runtime-title" className="mt-1 text-lg font-black text-slate-950">后台并发与异常中心</h2><p className="mt-1 text-xs leading-5 text-slate-500">系统按客户、账号和任务类型公平调度；网页关闭后任务仍由后台队列继续执行。</p></div>
      <div className="flex items-center gap-2"><span className={`rounded-full px-3 py-1.5 text-[10px] font-black ${runtime.sourceStatus === "available" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{runtime.sourceStatus === "available" ? "正式任务库已连接" : "任务状态暂不可用"}</span>{onRefresh&&<button type="button" onClick={onRefresh} aria-label="刷新后台任务状态" className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><RefreshCcw size={14}/></button>}</div>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {[
        { label: "本客户并行", value: `${runtime.capacity.tenant.active}/${runtime.capacity.tenant.max}`, note: "防止单个客户挤占全部资源" },
        { label: "单账号上限", value: runtime.capacity.accountDefaultMaxRunning, note: "同账号默认同时运行" },
        { label: "后台工作槽", value: runtime.capacity.workerMaxRunning, note: "单个后台进程上限" },
        { label: "自动恢复中", value: runtime.counts.retry_wait + runtime.counts.reconciling, note: `重试 ${runtime.counts.retry_wait} · 对账 ${runtime.counts.reconciling}` },
        { label: "需要处理", value: runtime.counts.blocked + runtime.counts.dead_letter + runtime.counts.paused, note: `阻断 ${runtime.counts.blocked + runtime.counts.dead_letter} · 暂停 ${runtime.counts.paused}` },
      ].map(item => <article key={item.label} className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3"><p className="text-[9px] font-bold text-slate-400">{item.label}</p><p className="mt-1 text-xl font-black text-slate-950">{item.value}</p><p className="mt-1 text-[9px] leading-4 text-slate-500">{item.note}</p></article>)}
    </div>
    <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100">
      {visibleJobs.map((job,index) => <article key={job.id} className={`grid gap-2 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_130px_minmax(170px,auto)] lg:items-center ${index ? "border-t border-slate-100" : ""}`}>
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-[9px] font-black ${executionStatusTone[job.status]}`}>{executionStatusLabel[job.status]}</span><span className="truncate text-xs font-black text-slate-800">{accountLabel(job.accountId)}</span></div><p className="mt-1 truncate text-[10px] text-slate-500">{job.publicReason}</p></div>
        <div><p className="text-[9px] font-bold text-slate-400">尝试次数</p><p className="mt-1 text-[10px] font-black text-slate-700">{job.attempt}/{job.maxAttempts}{job.retryClass === "provider_reconciliation" ? " · 对账优先" : ""}</p></div>
        <div className="lg:text-right"><p className="text-[9px] font-bold text-slate-400">当前调度</p><p className="mt-1 text-[10px] font-black leading-4 text-slate-700">{executionWaitingLabel(job)}</p>{onControlJob&&controlsFor(job).length>0&&<div className="mt-2 flex flex-wrap gap-1.5 lg:justify-end">{controlsFor(job).map(item=><button key={item.action} type="button" disabled={Boolean(controlling)} onClick={()=>void control(job,item.action)} className={`rounded-lg border border-slate-200 px-2 py-1 text-[9px] font-black disabled:opacity-40 ${item.tone||"bg-white text-slate-600"}`}>{controlling===`${job.id}:${item.action}`?<Loader2 size={10} className="animate-spin"/>:item.label}</button>)}</div>}</div>
      </article>)}
      {!visibleJobs.length&&<p className="px-4 py-8 text-center text-xs text-slate-400">后台队列当前没有正在执行或等待处理的任务；内容卡片上的缺素材等问题可能尚未进入制作队列。</p>}
    </div>
    {controlError&&<p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[10px] font-bold text-red-700">{controlError}</p>}
    {!compact&&<p className="mt-3 text-[10px] leading-5 text-slate-500">网络超时会自动分级重试；余额不足、内容拒绝和缺素材会停止并等待处理；供应商已经受理的任务先对账，不会盲目重复提交。</p>}
  </section>;
}

export function WeeklyCommandCenter({
  data,
  statusLabel,
  eyebrow = "当前周计划",
  primaryAction,
  actions,
  className = "",
}: {
  data: DigitalEmployeeOverview;
  statusLabel: string;
  eyebrow?: string;
  primaryAction?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const contentQueue = data.contentQueue?.items || [];
  const operatingContext = data.plan?.businessPackage?.operatingContext;
  const packagePlans = data.plan?.businessPackage?.tasks.find(task => task.templateId === "production")?.videoPlans || [];
  const directorPlan = data.plan?.businessPackage?.directorPlan;
  const weeklyQueue = contentQueue.filter(item => item.origin === "weekly_plan");
  const manualQueue = contentQueue.filter(item => item.origin === "manual");
  const plannedOutputCount = operatingContext?.outputs.count ?? packagePlans.length;
  const plannedOriginalCount = operatingContext?.outputs.originalCount
    ?? packagePlans.filter(plan => plan.productionRole !== "platform_adaptation").length;
  const plannedPublishCount = operatingContext?.outputs.publishCount ?? plannedOutputCount;
  const plannedDurationSeconds = operatingContext?.outputs.totalDurationSeconds
    ?? packagePlans.reduce((sum, plan) => sum + Number(plan.duration || 0), 0);
  const estimatedContentCost = weeklyQueue.reduce((sum, item) => sum + Number(item.estimatedCostCny || 0), 0)
    || packagePlans.reduce((sum, plan) => sum + Number(plan.estimatedCost || 0), 0);
  const settledContentCost = weeklyQueue.reduce((sum, item) => sum + Number(item.settledCostCny || 0), 0);
  const budgetMin = operatingContext?.budget.totalMinCny ?? packagePlans.reduce((sum, plan) => sum + Number(plan.estimatedCostRange?.minCny || 0), 0);
  const budgetMax = operatingContext?.budget.totalMaxCny ?? packagePlans.reduce((sum, plan) => sum + Number(plan.estimatedCostRange?.maxCny || 0), 0);
  const queuedBlockedCount = weeklyQueue.filter(item => item.status === "blocked").length;
  const preproductionBlockedCount = data.plan?.businessPackage?.detailGeneration?.blockedCount || 0;
  const weeklyStatusCounts = {
    queued: weeklyQueue.filter(item => ["planned", "queued"].includes(item.status)).length,
    producing: weeklyQueue.filter(item => item.status === "producing").length,
    review: weeklyQueue.filter(item => item.status === "waiting_review").length,
    blocked: Math.max(queuedBlockedCount, preproductionBlockedCount),
    completed: weeklyQueue.filter(item => item.status === "completed").length,
  };

  return <section className={`overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-sm ${className}`.trim()} aria-label="本周任务驾驶舱">
    <div className="flex flex-wrap items-start justify-between gap-5 bg-gradient-to-r from-emerald-950 via-emerald-900 to-teal-800 px-5 py-5 text-white sm:px-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-200">Weekly command center</p>
          <span className="rounded-full bg-white/12 px-2.5 py-1 text-[9px] font-black text-emerald-50">{eyebrow}</span>
          <span className="rounded-full bg-emerald-300 px-2.5 py-1 text-[9px] font-black text-emerald-950">{statusLabel}</span>
        </div>
        <h2 className="mt-2 text-xl font-black">{data.goal?.title || "本周任务驾驶舱"}</h2>
        <p className="mt-1 max-w-3xl text-xs leading-5 text-emerald-100/80">{data.goal?.objective || "周计划产量与手动单项分开统计；成本只采用计划估算和真实结算。"}</p>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
        <div className="text-left sm:text-right"><p className="text-[10px] font-bold text-emerald-200">计划版本</p><p className="mt-1 text-sm font-black">{data.plan?.businessPackage ? `v${data.plan.businessPackage.revision || 1}` : "等待周计划"}</p><p className="mt-1 text-[10px] text-emerald-100/70">{data.goal ? `${data.goal.startsAt} 至 ${data.goal.endsAt}` : "尚未开始经营周期"}</p></div>
        {primaryAction}
      </div>
    </div>
    <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-6">
      {[
        { label: "原创母版", value: `${plannedOriginalCount} 条`, note: "每条匹配一条不同爆款并只生产一次" },
        { label: "平台版本", value: `${plannedOutputCount} 条`, note: `${plannedPublishCount} 个发布任务 · ${operatingContext?.accounts.length || 0} 个账号` },
        { label: "母版总时长", value: plannedDurationSeconds > 0 ? `${plannedDurationSeconds} 秒` : "待确认", note: operatingContext?.outputs.formats.join(" / ") || "短视频" },
        { label: "本周成本范围", value: budgetMax > 0 ? `¥${budgetMin.toFixed(0)}–${budgetMax.toFixed(0)}` : "待核算", note: operatingContext ? `中位估算 ¥${operatingContext.budget.totalCny.toFixed(2)} · 平台轻适配已包含` : "按每条母版 ¥10–15 估算" },
        { label: "预计制作成本", value: estimatedContentCost > 0 ? `¥${estimatedContentCost.toFixed(2)}` : "待核算", note: manualQueue.length ? `另有 ${manualQueue.length} 条手动单项` : "只统计原创母版，不重复计算适配版" },
        { label: "已结算成本", value: settledContentCost > 0 ? `¥${settledContentCost.toFixed(2)}` : "暂无结算", note: "仅统计供应商对账回执" },
      ].map(item => <article key={item.label} className="bg-white px-4 py-4"><p className="text-[9px] font-bold text-slate-400">{item.label}</p><p className="mt-1 text-lg font-black text-slate-950">{item.value}</p><p className="mt-1 truncate text-[9px] text-slate-500" title={item.note}>{item.note}</p></article>)}
    </div>
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-4">
      {[
        ["排队中", weeklyStatusCounts.queued, "bg-sky-50 text-sky-700"],
        ["制作中", weeklyStatusCounts.producing, "bg-blue-50 text-blue-700"],
        ["待验收", weeklyStatusCounts.review, "bg-amber-50 text-amber-700"],
        ["需要处理", weeklyStatusCounts.blocked, "bg-red-50 text-red-700"],
        ["已完成", weeklyStatusCounts.completed, "bg-emerald-50 text-emerald-700"],
      ].map(([label, value, tone]) => <span key={String(label)} className={`rounded-full px-3 py-1.5 text-[10px] font-black ${tone}`}>{label} {value}</span>)}
      <span className="text-[10px] font-bold text-slate-400 xl:ml-auto">统一队列共 {contentQueue.length} 条，其中周计划 {weeklyQueue.length} 条</span>
    </div>
    {actions && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">{actions}</div>}
  </section>;
}

function HomeView({ data, onRefresh, selectedAccountId = "" }: { data: DigitalEmployeeOverview; onRefresh?: () => void; selectedAccountId?: string }) {
  const [monitor, setMonitor] = useState<AgentCard | null>(null);
  const snapshot = data.businessSnapshot;
  const contentQueue = (data.contentQueue?.items || []).filter(item => !selectedAccountId || item.accountId === selectedAccountId);
  const operatingContext = data.plan?.businessPackage?.operatingContext;
  const weeklyQueue = contentQueue.filter(item => item.origin === "weekly_plan");
  const weeklyStatusCounts = {
    queued: weeklyQueue.filter(item => ["planned", "queued"].includes(item.status)).length,
    producing: weeklyQueue.filter(item => item.status === "producing").length,
    review: weeklyQueue.filter(item => item.status === "waiting_review").length,
    blocked: Math.max(
      weeklyQueue.filter(item => item.status === "blocked").length,
      data.plan?.businessPackage?.detailGeneration?.blockedCount || 0,
    ),
    completed: weeklyQueue.filter(item => item.status === "completed").length,
  };
  const cycleTasks = data.tasks || [];
  const cycleCompleted = cycleTasks.filter(item => ["succeeded", "skipped"].includes(item.status)).length;
  const cycleAttention = cycleTasks.filter(item => ["failed", "waiting_approval", "waiting_human", "handed_off"].includes(item.status)).length;
  const connectedTargets = data.config?.publishingTargets || [];
  const monitoredAccounts = (operatingContext?.accounts || connectedTargets.map(target => ({
    accountId: target.accountId,
    accountLabel: target.accountLabel,
    platform: target.platform,
    positioning: "已授权经营账号",
    contentCount: contentQueue.filter(item => item.accountId === target.accountId).length,
    budgetCny: 0,
    allocationBasis: "content_load" as const,
  }))).filter(account => !selectedAccountId || account.accountId === selectedAccountId);
  const agentLiveState = Object.fromEntries(agentCards.map(item => {
    const status = data.agents.find(agent => roleAliases[item.role].includes(agent.role));
    const live = Boolean(status && runningStatuses.has(status.status)) || relatedTasks(data, item.role).some(task => runningStatuses.has(task.status));
    return [item.role, live];
  })) as Record<AgentCard["role"], boolean>;
  const activeAgentCount = agentCards.filter(item => agentLiveState[item.role]).length;
  const waitingCount = contentQueue.filter(item => item.status === "waiting_review").length;
  const completedCount = contentQueue.filter(item => item.status === "completed").length;
  const cycleProgress = contentQueue.length ? Math.round((completedCount / contentQueue.length) * 100) : 0;
  const nextMilestone = weeklyStatusCounts.blocked > 0
    ? `先处理 ${weeklyStatusCounts.blocked} 条卡点任务`
    : weeklyStatusCounts.review > 0
      ? `验收 ${weeklyStatusCounts.review} 条内容即可继续发布`
      : weeklyStatusCounts.producing > 0
        ? `${weeklyStatusCounts.producing} 条内容正在制作，完成后进入验收`
        : completedCount > 0
          ? "本轮内容已完成，等待数据回流生成复盘"
          : "确认周计划后开始第一条内容";
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
    <section className="grid gap-3 rounded-3xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-emerald-50 p-4 shadow-sm sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-5" aria-label="本周成果与下一里程碑">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400 text-amber-950"><Trophy size={21}/></span>
      <div><p className="text-[10px] font-black uppercase tracking-[.16em] text-amber-700">本周成果</p><h3 className="mt-1 text-sm font-black text-slate-950">已完成 {completedCount} 条内容、{cycleCompleted} 个经营节点</h3><p className="mt-1 text-xs text-slate-600">下一里程碑：{nextMilestone}</p></div>
      <div className="min-w-32"><div className="flex items-center justify-between text-[10px] font-bold text-slate-500"><span>内容完成度</span><strong className="text-emerald-800">{cycleProgress}%</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-emerald-600 transition-[width]" style={{width:`${cycleProgress}%`}}/></div></div>
    </section>

    <div className="mt-6"><ExecutionRuntimePanel data={data} onRefresh={onRefresh}/></div>

    <section className="visual-card overflow-hidden p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">过去业绩</p><h2 className="mt-2 text-2xl font-black text-slate-950">经营结果一眼看清</h2><p className="mt-1 text-sm text-slate-500">仅展示业务系统已经回传的真实数据；缺失数据明确标记，不再用本地模拟值覆盖。</p></div>{onRefresh&&<button type="button" onClick={onRefresh} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800"><RefreshCcw size={14}/>刷新</button>}</div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ label, value, note, icon: Icon }, index)=><article key={label} className="relative overflow-hidden rounded-2xl border border-[#10244a]/10 bg-white/90 p-4 shadow-[0_4px_0_rgba(16,36,74,.04)]"><span aria-hidden="true" className={`absolute -right-5 -top-5 h-20 w-20 rounded-full ${index%2?'bg-[#8b7cf6]/10':'bg-[#2fd1c5]/12'}`}/><div className="relative flex items-center justify-between"><span className="text-xs font-bold text-slate-500">{label}</span><span className={`flex h-8 w-8 items-center justify-center rounded-xl border-2 border-[#10244a] ${index%2?'bg-[#dcd7ff]':'bg-[#baf2e8]'}`}><Icon size={15} className="text-[#10244a]" strokeWidth={2.5}/></span></div><p className={`relative mt-3 font-black tracking-tight text-[#10244a] ${index===3?'text-2xl':'text-3xl'}`}>{value}</p><p className="relative mt-1 truncate text-[11px] text-slate-400">{note}</p><div aria-hidden="true" className="relative mt-4 flex h-5 items-end gap-1">{[0.35,0.58,0.46,0.78,0.68].map((height, barIndex)=><span key={barIndex} className={`w-2 rounded-t-sm ${index%2?'bg-[#8b7cf6]/35':'bg-[#2fd1c5]/40'}`} style={{height:`${height*100}%`}}/>)}</div></article>)}</div>
      <div className="mt-4">
        <article className="rounded-2xl border border-[#10244a]/10 bg-white/82 p-5">
          <div className="flex items-center justify-between gap-4"><div><p className="visual-kicker">经营脉冲</p><h3 className="mt-1 text-base font-black text-[#10244a]">内容与执行状态</h3></div><span className="text-[10px] font-bold text-slate-400">实时业务记录</span></div>
          <div className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">{pulse.map(item => <div key={item.label}><div className="flex items-center justify-between text-[11px]"><span className="font-bold text-slate-600">{item.label}</span><strong className="text-[#10244a]">{item.value}</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{background:item.color,width:`${item.value === 0 ? 0 : Math.max(12,item.value/pulseMax*100)}%`}}/></div></div>)}</div>
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4"><span className="mr-1 text-[10px] font-bold text-slate-400">内容覆盖</span>{platformCoverage.map(item => <span key={item.platform} title={`${platformLabels[item.platform]} ${item.count} 条`} className={`inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-xl border px-2 ${item.count?'border-[#10244a]/15 bg-white':'border-slate-200 bg-slate-50 opacity-45'}`}><SocialPlatformIcon platform={item.platform} size={16}/><span className="text-[10px] font-black text-[#10244a]">{item.count}</span></span>)}</div>
        </article>
      </div>
    </section>

    <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">本周期监控</p><h2 className="mt-1 text-xl font-black text-slate-950">真实账号、周任务与经营周期联动</h2><p className="mt-1 text-xs text-slate-500">账号授权、计划分工、预算与任务进度使用同一轮经营数据。</p></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-[10px] font-black text-slate-600">{data.goal ? `${data.goal.startsAt} 至 ${data.goal.endsAt}` : "等待经营周期"}</span></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[{label:"已授权账号",value:connectedTargets.length,note:connectedTargets.length?"真实发布目标":"等待账号授权"},{label:"周期任务",value:cycleTasks.length,note:`${cycleCompleted} 项已完成`},{label:"需要处理",value:cycleAttention,note:cycleAttention?"审批、异常或人工接管":"当前无阻塞"},{label:"本周预算",value:operatingContext?`¥${operatingContext.budget.totalCny.toLocaleString("zh-CN")}`:"—",note:operatingContext?`${operatingContext.outputs.count} 条计划产出`:"等待周计划"}].map(item=><article key={item.label} className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3"><p className="text-[10px] font-bold text-slate-400">{item.label}</p><p className="mt-1 text-xl font-black text-slate-950">{item.value}</p><p className="mt-1 text-[10px] text-slate-500">{item.note}</p></article>)}
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100">
        {monitoredAccounts.slice(0, 8).map((account,index)=><div key={`${account.platform}-${account.accountId}`} className={`grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_120px_160px] sm:items-center ${index?"border-t border-slate-100":""}`}><div className="min-w-0"><p className="truncate text-xs font-black text-slate-800">{account.accountLabel}</p><p className="mt-0.5 truncate text-[10px] text-slate-500">{platformLabels[account.platform as Platform] || account.platform} · {account.positioning}</p></div><p className="text-[10px] font-bold text-slate-600">分配 {account.contentCount} 条内容</p><p className="text-[10px] font-bold text-slate-600">{typeof account.budgetCny === "number" && account.budgetCny>0?`预算 ¥${account.budgetCny.toFixed(2)} · ${account.allocationBasis === "estimated_cost" ? "按预计成本" : "按内容负载"}`:"预算随任务核算"}</p></div>)}
        {!monitoredAccounts.length&&<p className="px-4 py-8 text-center text-xs text-slate-400">还没有已授权并纳入本周期的经营账号。</p>}
      </div>
    </section>

    <section className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-black text-slate-950">我的 4 个 Agent 现在在做什么</h2><p className="mt-1 text-xs text-slate-500">每张卡直接说明当前节点、依据、已经得到的结果和下一步；点击可下钻到完整生产记录。</p></div><span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-black text-emerald-800">{activeAgentCount ? `${activeAgentCount}/4 运行中` : '等待下一项任务'}</span></div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{agentCards.map((item)=>{const status=data.agents.find(agent=>roleAliases[item.role].includes(agent.role));const tasks=relatedTasks(data,item.role);const latestTask=[...tasks].sort((left,right)=>Date.parse(right.updated_at)-Date.parse(left.updated_at))[0];const taskIds=new Set(tasks.map(task=>task.id));const latestEvent=[...data.events].filter(event=>taskIds.has(event.task_id)||(item.role==='business'&&event.type.startsWith('business.'))).sort((left,right)=>right.sequence-left.sequence)[0];const live=Boolean(status&&runningStatuses.has(status.status))||tasks.some(task=>runningStatuses.has(task.status));const source=latestTask?.business_refs?.length?`${latestTask.business_refs.length} 条业务记录`:data.plan?.businessPackage?`本周计划 v${data.plan.businessPackage.revision||1}`:'等待计划';const result=latestEvent?.summary||(status?.completed?`已完成 ${status.completed}/${status.total} 个节点`:'尚无新结果');const next=latestTask?.status==='waiting_approval'?'等待你确认后继续':latestTask?.status==='failed'||latestTask?.status==='waiting_human'?'处理卡点或从当前节点重试':live?'完成当前节点并写回业务页面':'等待下一项任务';return <button type="button" key={item.role} aria-label={`查看${item.name}详情`} onClick={()=>setMonitor(item)} className={`agent-live-card ${live?'agent-live-card--running':''} group relative min-h-72 cursor-pointer overflow-hidden rounded-3xl border p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${live?'border-emerald-300':'border-slate-200'} bg-gradient-to-br ${item.tint}`} style={{"--agent-accent":live?'#10b981':'#94a3b8'} as CSSProperties}>
        <div className="absolute right-3 top-3 w-[92px]"><PixelAgentScene role={item.role} active={live} compact/></div>
        <AgentRoleIcon role={item.role} active={live} size="md" label={item.name}/>
        <h3 className="mt-7 text-lg font-black text-slate-950">{item.name}</h3><p className="mt-1 text-xs text-slate-500">{item.description}</p>
        <div className="mt-5 flex items-center justify-between gap-2"><span className={`text-xs font-bold ${live?'text-emerald-700':'text-slate-400'}`}>{live?'运行中':'静默'}</span><span className="text-[10px] text-slate-400">{status?.completed||0}/{status?.total||0}</span></div>
        <dl className="mt-3 space-y-2 border-t border-slate-200/70 pt-3 text-[10px]"><div className="grid grid-cols-[48px_minmax(0,1fr)] gap-2"><dt className="font-bold text-slate-400">当前节点</dt><dd className="line-clamp-2 font-black leading-4 text-slate-700">{status?.currentTask||latestTask?.title||"等待下一项任务"}</dd></div><div className="grid grid-cols-[48px_minmax(0,1fr)] gap-2"><dt className="font-bold text-slate-400">来源</dt><dd className="truncate font-bold text-slate-600">{source}</dd></div><div className="grid grid-cols-[48px_minmax(0,1fr)] gap-2"><dt className="font-bold text-slate-400">结果</dt><dd className="line-clamp-2 font-bold leading-4 text-slate-600">{result}</dd></div><div className="grid grid-cols-[48px_minmax(0,1fr)] gap-2"><dt className="font-bold text-slate-400">下一步</dt><dd className="line-clamp-2 font-bold leading-4 text-emerald-700">{next}</dd></div></dl>
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

export type MatrixScheduleAccount = {
  accountId: string;
  accountLabel: string;
  platform: Platform;
  weeklyCount: number;
  contentDirection: string;
  connected?: boolean;
};

const matrixScheduleStages = [
  { label: "编导分析", owner: "编导 Agent", duration: "约 45 分钟", color: "bg-violet-100 text-violet-800 ring-violet-200" },
  { label: "内容制作", owner: "内容 Agent", duration: "约 5 小时", color: "bg-sky-100 text-sky-800 ring-sky-200" },
  { label: "质检与发布", owner: "质检 / 经营 Agent", duration: "约 35 分钟", color: "bg-emerald-100 text-emerald-800 ring-emerald-200" },
] as const;

function LegacyMatrixWorkSchedule({ startsAt, endsAt, accounts, plans, selectedAccountId, onOpenPublishing }: {
  startsAt?: string;
  endsAt?: string;
  accounts: MatrixScheduleAccount[];
  plans: VideoCreationPlan[];
  selectedAccountId?: string;
  onOpenPublishing?: () => void;
}) {
  const goalStart = matrixDate(startsAt);
  const goalEnd = matrixDate(endsAt, addMatrixDays(goalStart, 6));
  const anchor = addMatrixDays(goalStart, -3);
  const visibleEnd = addMatrixDays(goalEnd, 2);
  const dayCount = Math.max(7, Math.min(14, Math.round((visibleEnd.getTime() - anchor.getTime()) / 86_400_000) + 1));
  const days = Array.from({ length: dayCount }, (_, index) => addMatrixDays(anchor, index));
  const today = dateKey(new Date());
  const visibleAccounts = selectedAccountId ? accounts.filter(account => account.accountId === selectedAccountId) : accounts;
  const scheduleRows = visibleAccounts.flatMap(account => {
    const accountPlans = plans.filter(plan => plan.matrix?.accountId === account.accountId);
    const rowCount = Math.max(accountPlans.length, account.weeklyCount);
    return Array.from({ length: rowCount }, (_, index) => ({ account, plan: accountPlans[index], index }));
  });
  const plannedCount = scheduleRows.filter(row => Boolean(row.plan)).length;
  const blockedCount = scheduleRows.filter(row => row.plan?.preproduction && !row.plan.preproduction.readiness.canStart).length;
  return <section className="overflow-hidden rounded-3xl border border-emerald-100 bg-white shadow-sm" aria-label="数字员工工作排期">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
      <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><CalendarRange size={19}/></span><div><p className="text-[10px] font-black tracking-[0.16em] text-emerald-700">账号内容日历 · 甘特排期</p><h2 className="mt-1 text-xl font-black text-slate-950">数字员工工作排期</h2><p className="mt-1 text-xs text-slate-500">每条内容按账号落到日期轴，并明确编导、制作、质检和发布的负责人及预计耗时。</p></div></div>
      <div className="flex flex-wrap items-center gap-2"><span className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[10px] font-black text-emerald-800">{goalStart.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} — {goalEnd.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</span>{onOpenPublishing&&<button type="button" onClick={onOpenPublishing} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black text-slate-700 hover:border-emerald-200 hover:text-emerald-700">打开发布日历 →</button>}</div>
    </div>
    <div className="grid gap-px border-b border-slate-100 bg-slate-100 sm:grid-cols-3">
      <div className="bg-white px-5 py-3"><p className="text-[9px] font-bold text-slate-400">排期账号</p><p className="mt-1 text-sm font-black text-slate-900">{visibleAccounts.length} 个</p></div>
      <div className="bg-white px-5 py-3"><p className="text-[9px] font-bold text-slate-400">内容任务</p><p className="mt-1 text-sm font-black text-slate-900">{plannedCount}/{scheduleRows.length} 条已编排</p></div>
      <div className="bg-white px-5 py-3"><p className="text-[9px] font-bold text-slate-400">当前卡点</p><p className={`mt-1 text-sm font-black ${blockedCount ? "text-amber-700" : "text-emerald-700"}`}>{blockedCount ? `${blockedCount} 条待补素材或授权` : "无生产卡点"}</p></div>
    </div>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 bg-slate-50/70 px-5 py-3 text-[9px] font-bold text-slate-500 sm:px-6">{matrixScheduleStages.map(stage => <span key={stage.label} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-sm ring-1 ${stage.color}`}/><strong className="text-slate-700">{stage.label}</strong> · {stage.owner} · {stage.duration}</span>)}</div>
    <div className="overflow-x-auto">
      <div style={{ minWidth: `${260 + days.length * 108}px` }}>
        <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: `260px repeat(${days.length}, minmax(108px, 1fr))` }}><div className="sticky left-0 z-20 border-r border-slate-200 bg-slate-50 px-5 py-3 text-[10px] font-black text-slate-500">账号与内容任务</div>{days.map(day => { const key = dateKey(day); const inGoal = key >= dateKey(goalStart) && key <= dateKey(goalEnd); return <div key={key} className={`border-r border-slate-100 px-2 py-2.5 text-center ${key === today ? "bg-emerald-50" : inGoal ? "bg-white" : "bg-slate-50"}`}><p className={`text-[9px] font-black ${key === today ? "text-emerald-700" : "text-slate-400"}`}>{day.toLocaleDateString("zh-CN", { weekday: "short" })}</p><p className="mt-1 text-[10px] font-black text-slate-700">{day.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</p>{key === today&&<span className="mt-1 inline-block rounded-full bg-emerald-600 px-1.5 py-0.5 text-[7px] font-black text-white">今天</span>}</div>;})}</div>
        <div>{scheduleRows.map(({ account, plan, index }, rowIndex) => {
          const fallbackPublishDate = addMatrixDays(goalStart, Math.min(6, index));
          const publishDate = matrixDate(plan?.plannedPublishDate, fallbackPublishDate);
          const publishIndex = Math.max(0, Math.min(days.length - 1, Math.round((publishDate.getTime() - anchor.getTime()) / 86_400_000)));
          const directorStart = Math.max(0, publishIndex - 3);
          const productionStart = Math.max(directorStart + 1, publishIndex - 2);
          const productionSpan = Math.max(1, publishIndex - productionStart);
          const planBlocked = Boolean(plan?.preproduction && !plan.preproduction.readiness.canStart);
          const statusLabel = !plan ? "待同步" : planBlocked ? "有卡点" : plan.directorStatus === "approved" ? "已通过" : plan.directorStatus === "in_production" ? "制作中" : "待编导";
          return <div key={`${account.accountId}-${plan?.contentId || index}`} className={`grid border-b border-slate-100 ${rowIndex % 2 ? "bg-slate-50/30" : "bg-white"}`} style={{ gridTemplateColumns: `260px minmax(${days.length * 108}px, 1fr)` }}>
            <div className={`sticky left-0 z-20 border-r border-slate-200 px-4 py-3 ${rowIndex % 2 ? "bg-[#fbfcfb]" : "bg-white"}`}><div className="flex items-start gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-white"><SocialPlatformIcon platform={account.platform} size={16}/></span><div className="min-w-0"><p className="truncate text-[9px] font-bold text-slate-400">{account.accountLabel}</p><p className="mt-0.5 line-clamp-2 text-[10px] font-black leading-4 text-slate-800">{plan?.theme || `内容位 ${index + 1} · ${account.contentDirection}`}</p><div className="mt-1 flex items-center gap-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[8px] font-black ${planBlocked ? "bg-amber-100 text-amber-700" : plan ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{statusLabel}</span><span className="text-[8px] font-bold text-slate-400">{plan?.plannedPublishDate || dateKey(publishDate)} 发布</span></div></div></div></div>
            <div className="grid min-h-[72px]" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(108px, 1fr))` }}>
              {days.map((day, dayIndex) => <span key={dateKey(day)} className={`border-r border-slate-100 ${dateKey(day) === today ? "bg-emerald-50/45" : ""}`} style={{ gridColumn: dayIndex + 1, gridRow: 1 }}/>) }
              <span title="编导 Agent：分析对标账号、爆款结构和选题，预计约 45 分钟" className={`z-10 m-1.5 flex min-w-0 items-center rounded-lg px-2 text-[8px] font-black ring-1 ${matrixScheduleStages[0].color}`} style={{ gridColumn: `${directorStart + 1} / span 1`, gridRow: 1 }}>编导 · 45m</span>
              <span title="内容 Agent：完成脚本、分镜、素材、配音、剪辑与渲染，预计约 5 小时" className={`z-10 m-1.5 flex min-w-0 items-center rounded-lg px-2 text-[8px] font-black ring-1 ${matrixScheduleStages[1].color}`} style={{ gridColumn: `${productionStart + 1} / span ${productionSpan}`, gridRow: 1 }}>内容制作 · 约 5h</span>
              <span title="质检 Agent 完成质量检查，经营 Agent 确认发布，合计预计约 35 分钟" className={`z-10 m-1.5 flex min-w-0 items-center rounded-lg px-2 text-[8px] font-black ring-1 ${planBlocked ? "bg-amber-100 text-amber-800 ring-amber-200" : matrixScheduleStages[2].color}`} style={{ gridColumn: `${publishIndex + 1} / span 1`, gridRow: 1 }}>{planBlocked ? "补齐后质检" : "质检 / 发布"}</span>
            </div>
          </div>;
        })}{!scheduleRows.length&&<div className="px-6 py-16 text-center"><CalendarRange size={28} className="mx-auto text-slate-300"/><p className="mt-3 text-sm font-black text-slate-600">还没有账号内容排期</p><p className="mt-1 text-xs text-slate-400">先在本周计划中确认账号和内容数量，再生成具体制作任务。</p></div>}</div>
        <div className="flex flex-wrap items-center gap-3 bg-slate-50 px-5 py-3 text-[9px] font-bold text-slate-400"><span>排期规则：编导结论先完成，经营 Agent 再派发内容任务；卡点任务不会进入质检和发布。</span><span className="ml-auto">实际发布仍以发布日历、账号授权和最终验收为准。</span></div>
      </div>
    </div>
  </section>;
}

function MatrixView({ data, onRefresh, onNavigate, onGeneratePlan, selectedAccountId = "" }: {
  data: DigitalEmployeeOverview;
  onRefresh?: () => void;
  onNavigate?: (page: Page) => void;
  onGeneratePlan?: () => void;
  selectedAccountId?: string;
}) {
  const saved = data.plan?.businessPackage;
  const config = data.config;
  const goal = data.goal;
  const [draft, setDraft] = useState<WeeklyPackage | null>(saved || null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([]);
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
  const selectedAccounts = accountRows.filter(row => !selectedAccountId || row.accountId === selectedAccountId);
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
    const originalTarget = Math.min(contentCount, socialOperatingProfile(config.socialOperatingProfile).weeklyTargets.baseVideoOriginals);
    return filled.directorPlan ? {
      ...filled,
      directorPlan: { ...filled.directorPlan, originalTarget, platformVersionTarget: contentCount, publishTarget: contentCount },
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
    <MatrixWorkSchedule startsAt={goal?.startsAt} endsAt={goal?.endsAt} accounts={accountRows} plans={productionPlans} selectedAccountId={selectedAccountId} onOpenPublishing={() => onNavigate?.("traffic")}/>
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">账号配置</p><h2 className="mt-1 text-2xl font-black text-slate-950">账号职责与连接状态</h2><p className="mt-1 text-sm text-slate-500">内容任务已统一放入上方工作排期；这里仅保留账号定位、承接能力和对标配置。</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => onNavigate?.("accountManagement")} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700">管理连接账号</button>{editable&&<button type="button" disabled={saving} onClick={() => void synchronizePackage()} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-black text-emerald-800 disabled:opacity-50"><RefreshCcw size={14} className={saving ? "animate-spin" : ""}/>按矩阵同步周任务包</button>}{editable&&<button type="button" onClick={() => { setDraft(saved || null); setEditing(true); }} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white"><Pencil size={14}/>修改矩阵</button>}</div>
      </div>
      {message&&<p role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">{message}</p>}
      {!rows.length&&<p className="mt-5 rounded-xl border border-dashed border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">还没有已连接账号，当前展示可直接配置的默认账号矩阵。</p>}
      <div className="mt-5 grid gap-4 xl:grid-cols-2">{selectedAccounts.map(row => {
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
          <div className="bg-white p-4"><p className="text-[10px] font-black tracking-[0.12em] text-slate-400">账号详情</p><dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2"><div><dt className="font-bold text-slate-400">目标受众</dt><dd className="mt-1 font-semibold leading-5 text-slate-700">{row.audience}</dd></div><div><dt className="font-bold text-slate-400">主推产品</dt><dd className="mt-1 font-semibold leading-5 text-slate-700">{row.productName}</dd></div><div><dt className="font-bold text-slate-400">内容方向</dt><dd className="mt-1 font-semibold leading-5 text-slate-700">{row.contentDirection}</dd></div><div><dt className="font-bold text-slate-400">内容栏目</dt><dd className="mt-1 font-semibold leading-5 text-slate-700">{row.formats?.length ? row.formats.map(format => contentFormatLabels[format] || format).join(" · ") : "待配置"}</dd></div></dl>
              <div className="mt-4"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-black tracking-[0.12em] text-slate-400">账号连接与对标完成项</p><span className="text-[10px] font-bold text-emerald-700">{checklist.filter(item => item.done || item.neutral).length}/{checklist.length}</span></div><div className="mt-2 grid gap-2 sm:grid-cols-2">{checklist.map(item => <div key={item.label} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"><span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600">{item.done ? <CheckCircle2 size={13} className="text-emerald-600"/> : <span className={`h-3 w-3 rounded-full border ${item.neutral ? "border-slate-300 bg-slate-100" : "border-amber-400 bg-amber-50"}`}/>} {item.label}</span><span className={`text-[9px] font-black ${item.done ? "text-emerald-700" : item.neutral ? "text-slate-400" : "text-amber-700"}`}>{item.value}</span></div>)}</div></div>
              <div className="mt-4"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-black tracking-[0.12em] text-slate-400">对标账号</p><button type="button" onClick={() => onNavigate?.("socialInspiration")} className="text-[10px] font-black text-emerald-700">管理对标账号 →</button></div>{benchmarks.length ? <div className="mt-2 flex flex-wrap gap-2">{benchmarks.map(item => <span key={item.id} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold text-slate-700">{item.accountName || item.handle || "未命名账号"}</span>)}</div> : <p className="mt-2 text-[11px] text-slate-400">该平台尚未配置对标账号。</p>}</div>
          </div>
        </article>;
      })}</div>
      {!saved&&<div className="mt-5 flex justify-end"><button type="button" onClick={onGeneratePlan} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-black text-white"><CalendarRange size={14}/>生成周计划并应用矩阵</button></div>}
      {saved&&!saved.matrixPlan?.length&&defaultRows.length>0&&editable&&<div className="mt-5 flex justify-end"><button type="button" disabled={saving} onClick={() => void save({ ...saved, matrixPlan: defaultRows })} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-black text-white disabled:opacity-50"><LayoutGrid size={14}/>应用默认矩阵</button></div>}
    </section>
    {editing&&draft&&config&&goal&&<div className="fixed inset-0 z-[190] flex justify-end bg-slate-950/35" onMouseDown={() => !saving&&setEditing(false)}><section role="dialog" aria-modal="true" aria-label="修改账号矩阵" className="h-full w-full max-w-[1180px] overflow-y-auto bg-white p-5 shadow-2xl sm:p-7" onMouseDown={event => event.stopPropagation()}><header className="mb-5 flex items-start justify-between gap-4 border-b border-slate-100 pb-4"><div><p className="text-xs font-bold text-emerald-700">本周账号矩阵</p><h2 className="mt-1 text-xl font-black text-slate-950">修改账号、内容方向与排期</h2></div><button type="button" aria-label="关闭修改矩阵" onClick={() => !saving&&setEditing(false)} className="rounded-full border border-slate-200 p-2 text-slate-500"><X size={18}/></button></header><WeeklyMatrixEditor pack={draft} config={config} platforms={goal.contentPlatforms} startsAt={goal.startsAt} dueAt={goal.endsAt} projects={projects} onChange={setDraft} onNavigate={page => onNavigate?.(page)}/><div className="sticky bottom-0 mt-6 flex justify-end border-t border-slate-100 bg-white py-4"><button type="button" disabled={saving} onClick={() => void save(draft)} className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{saving?"保存中…":"保存并更新内容清单"}</button></div></section></div>}
  </div>;
}

function openTaskPreviewPage(item: ContentQueueItem, target: "benchmark" | "materials", onNavigate?: (page: Page) => void) {
  const pendingShoot = item.preproduction?.materials.pendingShootTaskIds[0];
  const detail = target === "benchmark"
    ? { page: "socialInspiration", view: "inspiration", referenceId: item.preproduction?.benchmark.referenceId || item.referenceId, contentItemId: item.id }
    : pendingShoot
      ? { page: "socialInspiration", view: "shooting", shootingTaskId: pendingShoot, contentItemId: item.id }
      : { page: "enterprise", view: "products", productName: item.productName, materialIds: item.preproduction?.materials.items.map(material => material.id) || [], contentItemId: item.id };
  if (typeof window === "undefined") {
    onNavigate?.(detail.page as Page);
    return;
  }
  window.dispatchEvent(new CustomEvent("lingshu:navigate", { detail }));
}

function TaskPreviewCards({ item, onNavigate, onGenerateDetails }: {
  item: ContentQueueItem;
  onNavigate?: (page: Page) => void;
  onGenerateDetails?: () => void;
}) {
  const preview = item.preproduction;
  if (!preview) return <div className="mt-4 grid gap-3 lg:grid-cols-2">
    {[
      { label: "爆款视频预览", note: "生成后展示真实参考、开头钩子和分镜结构。", tone: "border-violet-200 bg-violet-50/45" },
      { label: "素材组合预览", note: "生成后展示每个镜头将使用的素材，以及缺素材或待拍卡点。", tone: "border-emerald-200 bg-emerald-50/45" },
    ].map((card, index) => <article key={card.label} className={`rounded-2xl border border-dashed p-4 ${card.tone}`}><div className="flex items-center justify-between gap-3"><p className="text-xs font-black text-slate-900">{card.label}</p><span className="rounded-full bg-white px-2 py-1 text-[9px] font-black text-slate-500">步骤 2 生成</span></div><p className="mt-2 text-[10px] leading-5 text-slate-500">{card.note}</p>{index === 0&&onGenerateDetails&&<button type="button" onClick={onGenerateDetails} className="mt-3 rounded-lg bg-slate-950 px-3 py-2 text-[10px] font-black text-white">生成两项详细预览</button>}</article>)}
  </div>;
  const benchmark = preview.benchmark;
  const materials = preview.materials;
  const blocked = !preview.readiness.canStart;
  const effectLabel = preview.confidence.effectLevel === "medium" ? "中" : preview.confidence.effectLevel === "low" ? "低" : "数据不足";
  return <div className="mt-4 grid gap-3 lg:grid-cols-2">
    <article className="overflow-hidden rounded-2xl border border-violet-100 bg-violet-50/45">
      <div className="grid min-h-36 grid-cols-[112px_minmax(0,1fr)]">
        <div className="relative flex items-center justify-center overflow-hidden bg-slate-900">{benchmark.thumbnailUrl?<img src={benchmark.thumbnailUrl} alt="爆款参考缩略图" className="h-full w-full object-cover"/>:<Clapperboard size={26} className="text-white/35"/>}<span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-1 text-[8px] font-black text-white">爆款视频预览</span></div>
        <div className="min-w-0 p-4"><div className="flex items-center justify-between gap-2"><span className={`rounded-full px-2 py-1 text-[8px] font-black ${benchmark.status==='ready'?'bg-violet-100 text-violet-700':'bg-slate-100 text-slate-500'}`}>{benchmark.status==='ready'?'真实参考已绑定':benchmark.status==='not_applicable'?'产品原创':'缺少参考'}</span><span className="text-[9px] font-bold text-slate-400">效果置信度：{effectLabel}</span></div><h4 className="mt-2 line-clamp-2 text-xs font-black leading-5 text-slate-900">{benchmark.title||item.title}</h4><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-600">{benchmark.hook||"当前没有可核验的爆款参考，不生成虚构预览。"}</p><p className="mt-2 truncate text-[9px] text-violet-700">{[benchmark.account,benchmark.views&&`播放 ${benchmark.views}`].filter(Boolean).join(" · ")||"以编导分镜结构为准"}</p></div>
      </div>
      {benchmark.shotSummary.length>0&&<div className="border-t border-violet-100 px-4 py-3"><p className="line-clamp-2 text-[9px] leading-4 text-slate-600">{benchmark.shotSummary.slice(0,3).join(" · ")}</p></div>}
      <button type="button" onClick={()=>openTaskPreviewPage(item,"benchmark",onNavigate)} className="flex w-full items-center justify-between border-t border-violet-100 bg-white/70 px-4 py-2.5 text-[10px] font-black text-violet-700"><span>{benchmark.status==='ready'?"打开对应爆款分析":"打开爆款灵感库"}</span><span>→</span></button>
    </article>
    <article className={`overflow-hidden rounded-2xl border ${materials.status==='ready'?'border-emerald-100 bg-emerald-50/45':'border-amber-200 bg-amber-50/55'}`}>
      <div className="p-4"><div className="flex items-center justify-between gap-2"><p className="text-xs font-black text-slate-900">素材组合预览</p><span className={`rounded-full px-2 py-1 text-[8px] font-black ${materials.status==='ready'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-800'}`}>{materials.status==='ready'?`${materials.items.length} 项已锁定`:"任务不能开始"}</span></div>
        {Boolean(materials.storyboard?.length)&&<div className="mt-3"><p className="mb-2 text-[9px] font-black text-slate-500">按爆款结构连接的成片首帧</p><div className="flex items-stretch gap-1 overflow-x-auto pb-1">{materials.storyboard!.map((step,index)=>{const matched=materials.items.find(material=>material.id===step.materialId);const previewUrl=step.materialPreviewUrl||step.referenceFirstFrameUrl;return <div key={`${step.materialType}-${step.shotIds.join('-')}`} className="flex shrink-0 items-center gap-1"><div className={`w-24 overflow-hidden rounded-xl border bg-white ${step.status==='ready'?'border-emerald-200':'border-amber-200'}`}><div className="flex aspect-video items-center justify-center overflow-hidden bg-slate-100">{previewUrl?(matched?.type==='video'&&step.materialPreviewUrl?<video src={`${previewUrl}#t=0.1`} muted preload="metadata" className="h-full w-full object-cover"/>:<img src={previewUrl} alt={`${step.materialLabel}首帧`} className="h-full w-full object-cover"/>):<span className="text-[8px] font-black text-amber-700">待补素材</span>}</div><div className="px-2 py-1.5"><p className="truncate text-[8px] font-black text-slate-700">{step.materialLabel}</p><p className="mt-0.5 truncate text-[7px] text-slate-400">{step.shotIds.length} 镜 · {step.status==='ready'?'已匹配':'待匹配'}</p></div></div>{index<materials.storyboard!.length-1&&<span className="text-xs font-black text-emerald-500">→</span>}</div>})}</div></div>}
        {!materials.storyboard?.length&&<div className="mt-3 grid grid-cols-3 gap-2">{materials.items.slice(0,3).map(material=><div key={material.id} className="min-w-0"><div className={`flex aspect-video items-center justify-center overflow-hidden rounded-lg border ${material.status==='ready'?'border-emerald-100 bg-white':'border-amber-200 bg-amber-100'}`}>{material.previewUrl?(material.type==='video'?<video src={`${material.previewUrl}#t=0.1`} muted preload="metadata" className="h-full w-full object-cover"/>:<img src={material.previewUrl} alt="" className="h-full w-full object-cover"/>):material.status==='pending_shoot'?<span className="text-[9px] font-black text-amber-700">待拍</span>:<LayoutGrid size={16} className="text-slate-300"/>}</div><p className="mt-1 truncate text-[8px] font-bold text-slate-600">{material.name}</p></div>)}{!materials.items.length&&<div className="col-span-3 flex min-h-16 items-center justify-center rounded-xl border border-dashed border-amber-200 bg-white/70 text-[10px] font-bold text-amber-700">还没有可用素材</div>}</div>}
        {blocked?<div role="alert" className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-[9px] font-bold leading-4 text-amber-800">{preview.readiness.blockers.slice(0,3).join("；")}</div>:<p className="mt-3 text-[9px] leading-4 text-emerald-700">素材、授权和预算检查已通过，可以进入制作。</p>}
      </div>
      <button type="button" onClick={()=>openTaskPreviewPage(item,"materials",onNavigate)} className={`flex w-full items-center justify-between border-t bg-white/70 px-4 py-2.5 text-[10px] font-black ${materials.status==='ready'?'border-emerald-100 text-emerald-700':'border-amber-200 text-amber-800'}`}><span>{materials.pendingShootTaskIds.length?"打开对应待拍任务":materials.status==='ready'?"打开对应素材":"去补齐素材与授权"}</span><span>→</span></button>
    </article>
    <div className="lg:col-span-2 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-slate-50 px-4 py-2.5 text-[9px] font-bold text-slate-500"><span>按时完成率：{preview.confidence.onTimeRate===null?"暂无历史样本":`${preview.confidence.onTimeRate}%`}</span><span>内容效果置信度：{effectLabel}</span><span>说明：匹配度不是爆款成功率，发布前不展示虚构概率。</span></div>
  </div>;
}

function QueueView({ data, onRefresh, onNavigate, onGenerateDetails, selectedAccountId = "", onOpenContent, onOpenProductionProgress, onControlJob, onRetryTask }: { data: DigitalEmployeeOverview; onRefresh?: () => void; onNavigate?: (page: Page) => void; onGenerateDetails?: () => void; selectedAccountId?: string; onOpenContent?: (taskId?: string, socialContentTaskId?: string) => void; onOpenProductionProgress?: (taskId: string, contentItemId: string) => void; onControlJob?: (jobId: string, action: ExecutionControlAction) => Promise<boolean>; onRetryTask?: (taskId: string) => Promise<boolean> }) {
  const projection = data.contentQueue;
  const items = (projection?.items || []).filter(item => !selectedAccountId || item.accountId === selectedAccountId);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "waiting_review" | "blocked" | "completed">("all");
  const [retryingTaskId, setRetryingTaskId] = useState("");
  const filteredItems = items.filter(item => statusFilter === "all"
    || statusFilter === "active" && ["planned", "queued", "producing"].includes(item.status)
    || item.status === statusFilter);
  const pageSize = 6;
  const [page, setPage] = useState(1);
  const retryBlockedTask = async (item: ContentQueueItem) => {
    if (!onRetryTask || !item.taskId || retryingTaskId) return;
    setRetryingTaskId(item.taskId);
    try {
      if (await onRetryTask(item.taskId)) showActionSuccess("任务已从失败节点重新生成", "已完成的素材和结果不会被覆盖。");
    } finally {
      setRetryingTaskId("");
    }
  };
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const pageItems = filteredItems.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => setPage(current => Math.min(current, totalPages)), [totalPages]);
  useEffect(() => setPage(1), [statusFilter]);
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
    <section><div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">内容队列</p><h2 className="mt-1 text-2xl font-black text-slate-950">计划、制作、验收与成本在同一条链路</h2><p className="mt-1 text-sm text-slate-500">{selectedAccountId?`当前只看：${data.config?.publishingTargets.find(target=>target.accountId===selectedAccountId)?.accountLabel||selectedAccountId}`:"经营 Agent 按账号矩阵分配内容；每条任务独立展示参考、素材、成本与卡点。"}</p></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-4">{[["计划总数",items.length],["制作中",producing],["待验收",waiting],["已完成",completed]].map(([label,value])=><div key={String(label)} className="rounded-2xl border border-slate-200 bg-white px-4 py-3"><p className="text-[10px] font-bold text-slate-400">{label}</p><p className="mt-1 text-xl font-black text-slate-950">{value}</p></div>)}</div>
      <nav aria-label="筛选内容任务状态" className="mt-4 flex flex-wrap gap-2">{([
        { id:"all",label:"全部",count:items.length },
        { id:"active",label:"排队/制作",count:items.filter(item=>["planned","queued","producing"].includes(item.status)).length },
        { id:"waiting_review",label:"待验收",count:waiting },
        { id:"blocked",label:"异常任务",count:items.filter(item=>item.status==="blocked").length },
        { id:"completed",label:"已完成",count:completed },
      ] as const).map(filter=><button key={filter.id} type="button" aria-pressed={statusFilter===filter.id} onClick={()=>setStatusFilter(filter.id)} className={`rounded-full border px-3 py-1.5 text-[10px] font-black ${statusFilter===filter.id?"border-slate-950 bg-slate-950 text-white":"border-slate-200 bg-white text-slate-600 hover:border-emerald-300"}`}>{filter.label} {filter.count}</button>)}</nav>
      <div className={`mt-4 rounded-xl border px-4 py-3 text-xs ${projection?.sourceStatus === 'available' ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}><strong>{projection?.sourceStatus === 'available' ? '真实链路已连接' : '队列等待数据'}</strong><span className="ml-2">{projection?.sourceNote || "当前没有可读取的内容计划"}</span></div>
      <div className="mt-4"><ExecutionRuntimePanel data={data} onRefresh={onRefresh} onControlJob={onControlJob} compact/></div>
      <section className="mt-4 space-y-3">
        {pageItems.map((item)=><article key={item.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px_180px] lg:items-center">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><SocialPlatformIcon platform={item.platform} size={16}/><span className="text-[10px] font-black text-emerald-700">{platformLabels[item.platform]}</span><span className={`rounded-full px-2 py-1 text-[9px] font-black ${item.origin==='manual'?'bg-violet-50 text-violet-700':'bg-emerald-50 text-emerald-700'}`}>{item.origin==='manual'?'手动单项':'周计划任务'}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-600">{routeLabel[item.route]}</span><span className={`rounded-full px-2 py-1 text-[9px] font-black ${statusTone[item.status]}`}>{statusLabel[item.status]}</span><span className="text-[10px] text-slate-400">{item.plannedPublishDate || "待排期"}</span></div><h3 className="mt-2 text-sm font-black text-slate-950">{item.title}</h3><p className="mt-1 text-xs text-slate-500">{item.productName || "待绑定产品"} · {item.accountLabel || data.config?.publishingTargets.find(target=>target.accountId===item.accountId)?.accountLabel || "仅制作"}{item.languages.length?` · ${item.languages.join(" / ").toUpperCase()}`:""}</p><p className="mt-1 text-[10px] font-bold text-slate-500">预计输出 {item.outputSummary.count} 条 · {item.outputSummary.formats.join(" / ") || "待确认形式"}{item.outputSummary.durationSeconds!==null?` · 每条约 ${item.outputSummary.durationSeconds} 秒`:" · 时长待编导确认"}</p>{item.confidence&&item.status!=="blocked"&&<div className="mt-2 flex flex-wrap gap-1.5">{([["制作把握",item.confidence.production],["发布把握",item.confidence.publishing],["经营把握",item.confidence.business]] as const).map(([label,dimension])=><span key={label} title={[...dimension.evidence,...dimension.gaps].join("；")} className={`rounded-full px-2 py-1 text-[9px] font-black ${confidenceTone[dimension.level]}`}>{label}：{dimension.label}</span>)}</div>}{item.status==="blocked"&&<span className="mt-2 inline-flex rounded-full bg-amber-100 px-2 py-1 text-[9px] font-black text-amber-800">制作把握：待补齐素材后评估</span>}{item.reason&&<p className="mt-2 text-[10px] font-bold text-red-600">{item.reason}</p>}</div>
            <div><div className="flex items-center justify-between text-[10px]"><span className="font-bold text-slate-400">{item.stage}</span><strong className="text-slate-800">{item.progress}%</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${item.status==='blocked'?'bg-red-500':item.status==='completed'?'bg-emerald-500':'bg-blue-500'}`} style={{width:`${item.progress}%`}}/></div><div className="mt-2 flex gap-1">{item.steps.map(step=><span key={step.key} title={`${step.label}：${step.state} · ${step.responsibleAgent} · ${productionDurationLabel(step.estimatedMinutes)}`} className={`h-1.5 flex-1 rounded-full ${step.state==='done'?'bg-emerald-500':step.state==='active'?'bg-blue-500 motion-safe:animate-pulse':'bg-slate-200'}`}/>)}</div>{item.steps.find(step=>step.state==="active")&&<p className="mt-2 truncate text-[9px] font-bold text-slate-500">当前：{item.steps.find(step=>step.state==="active")?.label} · {item.steps.find(step=>step.state==="active")?.responsibleAgent} · {productionDurationLabel(item.steps.find(step=>step.state==="active")?.estimatedMinutes||0)}</p>}</div>
            <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end"><div className="lg:text-right"><p className="text-[10px] font-bold text-slate-400">本条成本</p><p className="mt-1 text-sm font-black text-slate-950">{item.settledCostCny!==null?`¥${item.settledCostCny.toFixed(2)}`:item.costStatus==='awaiting_settlement'?"供应商待结算":item.estimatedCostCny!==null?`预算 ¥${item.estimatedCostCny.toFixed(2)}`:"暂无预算/结算"}</p><p className="mt-1 text-[9px] text-slate-400">{item.settledCostCny!==null?"真实供应商结算":item.estimatedCostCny!==null?"计划预计，不等于实付":"尚无可核算数据"}</p></div>{item.status==="blocked"&&onRetryTask&&item.taskId&&<button type="button" disabled={retryingTaskId===item.taskId} onClick={()=>void retryBlockedTask(item)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-2 text-[10px] font-black text-amber-950 disabled:opacity-40">{retryingTaskId===item.taskId&&<Loader2 size={11} className="animate-spin"/>}重新生成</button>}{onOpenProductionProgress && <button type="button" onClick={() => onOpenProductionProgress(item.taskId, item.id)} className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-black text-slate-700 hover:border-emerald-300">查看制作进度 →</button>}<button type="button" onClick={() => onOpenContent?.(item.taskId || undefined, item.socialContentTaskId || undefined)} className="shrink-0 rounded-lg bg-slate-950 px-3 py-2 text-[10px] font-black text-white hover:bg-slate-800">进入制作台 →</button></div>
          </div>
          <TaskPreviewCards item={item} onNavigate={onNavigate} onGenerateDetails={item.origin==='weekly_plan'?onGenerateDetails:undefined}/>
          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.75fr)]"><div className="rounded-2xl border border-emerald-100 bg-emerald-50/45 px-4 py-3"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-black text-emerald-800">计划依据</span>{item.matchScore!==null&&<span className="rounded-full bg-white px-2 py-1 text-[9px] font-black text-emerald-700">匹配度 {item.matchScore}</span>}{item.benchmarkAccount&&<span className="rounded-full bg-white px-2 py-1 text-[9px] font-bold text-slate-700">对标账号：{item.benchmarkAccount}</span>}{item.referenceTitle&&<span className="max-w-full truncate rounded-full bg-white px-2 py-1 text-[9px] font-bold text-slate-700">参考：{item.referenceTitle}</span>}{item.referenceViews&&<span className="rounded-full bg-white px-2 py-1 text-[9px] font-bold text-violet-700">参考播放 {item.referenceViews}</span>}{item.referenceId&&onNavigate&&<button type="button" onClick={() => onNavigate("socialInspiration")} className="rounded-full border border-emerald-200 bg-white px-2 py-1 text-[9px] font-black text-emerald-800">核对参考 →</button>}</div><p className="mt-2 text-[10px] leading-5 text-slate-600">{item.planningFactors.length?item.planningFactors.join(" · "):"依据账号矩阵、产品资料与平台规则生成；当前没有可用的爆款精确分析。"}</p></div><div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"><p className="text-[10px] font-black text-slate-700">业务血缘</p><dl className="mt-2 grid grid-cols-[68px_1fr] gap-x-2 gap-y-1 text-[10px]"><dt className="text-slate-400">目标</dt><dd className="truncate font-bold text-slate-700">{item.lineage.objective || "单项内容交付"}</dd><dt className="text-slate-400">账号</dt><dd className="truncate font-bold text-slate-700">{item.lineage.accountLabel || "仅制作"}</dd><dt className="text-slate-400">预算</dt><dd className="font-bold text-slate-700">{item.lineage.budgetCny!==null?`¥${item.lineage.budgetCny.toFixed(2)}`:"未单独分配"}</dd><dt className="text-slate-400">计划版本</dt><dd className="font-bold text-slate-700">{item.lineage.planId?`${item.lineage.planId} · v${item.lineage.planVersion || "1"}`:"手动单项任务"}</dd></dl></div></div>
        </article>)}
        {!filteredItems.length&&<div className="rounded-3xl border border-slate-200 bg-white px-5 py-16 text-center"><Clapperboard size={28} className="mx-auto text-slate-300"/><p className="mt-3 text-sm font-bold text-slate-600">{items.length?"当前筛选下没有任务":"还没有内容进入生产队列"}</p><p className="mt-1 text-xs text-slate-400">{items.length?"切换其他状态查看任务，异常任务会保留已完成结果。":"生成任务总纲后，内容会先以预览卡进入这里；确认前不会启动制作。"}</p></div>}
        {totalPages > 1 && <nav aria-label="内容队列分页" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4"><p className="text-[10px] font-bold text-slate-400">第 {page} / {totalPages} 页 · 共 {filteredItems.length} 条</p><div className="flex items-center gap-1.5"><button type="button" disabled={page === 1} onClick={() => setPage(current => Math.max(1, current - 1))} className="rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-black text-slate-600 disabled:cursor-not-allowed disabled:opacity-40">上一页</button>{Array.from({ length: totalPages }, (_, index) => index + 1).map(value => <button key={value} type="button" aria-current={value === page ? "page" : undefined} onClick={() => setPage(value)} className={`h-8 w-8 rounded-lg text-[10px] font-black ${value === page ? "bg-emerald-700 text-white" : "border border-slate-200 text-slate-600 hover:border-emerald-200 hover:text-emerald-700"}`}>{value}</button>)}<button type="button" disabled={page === totalPages} onClick={() => setPage(current => Math.min(totalPages, current + 1))} className="rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-black text-slate-600 disabled:cursor-not-allowed disabled:opacity-40">下一页</button></div></nav>}
      </section>
    </section>
    <aside className="h-fit rounded-3xl border border-violet-100 bg-violet-50/60 p-5"><Sparkles size={20} className="text-violet-700"/><h3 className="mt-4 text-base font-black text-slate-950">成本建议</h3>{average===null?<><p className="mt-3 text-sm font-bold text-slate-700">等待真实供应商结算</p><p className="mt-2 text-xs leading-6 text-slate-500">这里只统计与具体制作项目绑定、且已经对账的供应商费用；预计金额不会冒充实际花费。</p></>:<><p className="mt-3 text-3xl font-black text-violet-950">¥{average.toFixed(2)}</p><p className="mt-1 text-xs text-slate-500">已结算内容平均成本</p><p className="mt-4 text-sm font-bold text-slate-800">{trend===null?'暂缺企业成本基线':trend>0?'近期成本正在上升':'近期成本正在下降'}</p><p className="mt-2 text-xs leading-6 text-slate-500">{trend===null?'继续积累至少两个结算周期，再决定提高预算或调整生成策略。':trend>0?'建议先优化内容生成策略，再考虑追加预算。':'当前策略有成本优势，可把预算优先给高匹配内容。'}</p></>}</aside>
  </div>;
}

function ProductionDetailView({ data, contentItemId, onBack, onNavigate, onOpenContent, onRetryTask }: {
  data: DigitalEmployeeOverview;
  contentItemId?: string;
  onBack?: () => void;
  onNavigate?: (page: Page) => void;
  onOpenContent?: (taskId?: string, socialContentTaskId?: string) => void;
  onRetryTask?: (taskId: string) => Promise<boolean>;
}) {
  const [retrying, setRetrying] = useState(false);
  const item = data.contentQueue?.items.find(candidate => candidate.id === contentItemId)
    || data.contentQueue?.items.find(candidate => candidate.taskId && candidate.taskId === contentItemId)
    || null;
  if (!item) return <section className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
    <Clapperboard size={30} className="mx-auto text-slate-300"/>
    <h2 className="mt-3 text-base font-black text-slate-900">没有找到这条内容的制作记录</h2>
    <p className="mt-1 text-xs text-slate-500">任务可能尚未进入制作队列，或当前计划已经更新。</p>
    <button type="button" onClick={onBack} className="mt-5 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white">返回内容队列</button>
  </section>;

  const statusLabel: Record<ContentQueueItem["status"], string> = {
    planned: "计划已生成", queued: "等待制作", producing: "制作中", waiting_review: "等待验收", completed: "已完成", blocked: "制作受阻",
  };
  const executionJob = data.executionRuntime?.jobs.find(job => job.taskId === item.socialContentTaskId)
    || data.executionRuntime?.jobs.find(job => job.taskId === item.taskId)
    || null;
  const currentProductionStep = item.steps.find(step => step.state === "active") || item.steps.at(-1);
  const remainingProductionMinutes = item.steps.filter(step => step.state !== "done").reduce((sum, step) => sum + step.estimatedMinutes, 0);
  const retryCurrentTask = async () => {
    if (!item.taskId || !onRetryTask || retrying) return;
    setRetrying(true);
    try { await onRetryTask(item.taskId); }
    finally { setRetrying(false); }
  };
  return <div className="space-y-5">
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-slate-950 to-emerald-950 px-5 py-5 text-white sm:px-6">
        <div className="min-w-0"><button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-200"><ArrowLeft size={12}/>返回内容队列</button><div className="mt-3 flex flex-wrap items-center gap-2"><span className="rounded-full bg-white/10 px-2.5 py-1 text-[9px] font-black">{item.origin === "weekly_plan" ? "周计划任务" : "手动单项"}</span><span className="rounded-full bg-white/10 px-2.5 py-1 text-[9px] font-black">{platformLabels[item.platform]}</span><span className={`rounded-full px-2.5 py-1 text-[9px] font-black ${item.status === "blocked" ? "bg-red-500 text-white" : item.status === "completed" ? "bg-emerald-400 text-emerald-950" : "bg-sky-400 text-sky-950"}`}>{statusLabel[item.status]}</span></div><h2 className="mt-3 text-xl font-black">{item.title}</h2><p className="mt-1 text-xs text-slate-300">{item.productName || "待绑定产品"} · {item.accountLabel || "仅制作"} · {item.languages.join(" / ").toUpperCase() || "语言待确认"}</p></div>
        <div className="flex flex-wrap gap-2">{item.status === "blocked"&&item.taskId&&onRetryTask&&<button type="button" disabled={retrying} onClick={() => void retryCurrentTask()} className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-black text-amber-950 disabled:opacity-50">{retrying&&<Loader2 size={13} className="animate-spin"/>}从当前节点重试</button>}<button type="button" onClick={() => onOpenContent?.(item.taskId || undefined, item.socialContentTaskId || undefined)} className="rounded-xl bg-white px-4 py-2.5 text-xs font-black text-slate-950">进入制作台</button>{item.referenceId&&onNavigate&&<button type="button" onClick={() => onNavigate("socialInspiration")} className="rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-xs font-black text-white">核对参考视频</button>}</div>
      </header>
      <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-6">
        {[
          ["当前节点", currentProductionStep?.label || item.stage],
          ["当前责任人", currentProductionStep?.responsibleAgent || "待分配"],
          ["整体进度", `${item.progress}%`],
          ["剩余预计时间", remainingProductionMinutes ? productionDurationLabel(remainingProductionMinutes) : "已完成"],
          ["预计输出", `${item.outputSummary.count} 条 · ${item.outputSummary.durationSeconds ? `约 ${item.outputSummary.durationSeconds} 秒` : "时长待确认"}`],
          ["本条成本", item.settledCostCny !== null ? `已结算 ¥${item.settledCostCny.toFixed(2)}` : item.estimatedCostCny !== null ? `预计 ¥${item.estimatedCostCny.toFixed(2)}` : "待核算"],
        ].map(([label,value]) => <div key={label} className="bg-white px-4 py-4"><p className="text-[9px] font-bold text-slate-400">{label}</p><p className="mt-1 text-xs font-black leading-5 text-slate-800">{value}</p></div>)}
      </div>
    </section>

    {item.preproduction&&<section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-violet-700">Pre-production</p><h3 className="mt-1 text-base font-black text-slate-950">开始制作前锁定的双预览</h3></div><TaskPreviewCards item={item} onNavigate={onNavigate}/></section>}

    {executionJob&&<section className={`rounded-2xl border px-4 py-4 ${executionJob.status === "blocked" || executionJob.status === "dead_letter" ? "border-red-200 bg-red-50" : executionJob.status === "reconciling" || executionJob.status === "retry_wait" ? "border-amber-200 bg-amber-50" : "border-blue-100 bg-blue-50"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[9px] font-black ${executionStatusTone[executionJob.status]}`}>{executionStatusLabel[executionJob.status]}</span><p className="text-xs font-black text-slate-900">后台执行状态</p></div><p className="mt-2 text-xs leading-5 text-slate-700">{executionJob.publicReason}</p><p className="mt-1 text-[10px] text-slate-500">{executionWaitingLabel(executionJob)}</p></div><div className="text-left sm:text-right"><p className="text-[9px] font-bold text-slate-400">自动尝试</p><p className="mt-1 text-sm font-black text-slate-800">{executionJob.attempt}/{executionJob.maxAttempts}</p></div></div></section>}

    {item.reason&&<section role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-4"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600"/><div><p className="text-xs font-black text-red-800">当前任务需要处理</p><p className="mt-1 text-xs leading-5 text-red-700">{item.reason}</p><p className="mt-1 text-[10px] text-red-600">已完成的制作结果会保留；请进入制作台查看对应素材或质量要求。</p></div></section>}

    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.16em] text-emerald-700">Production timeline</p><h3 className="mt-1 text-base font-black text-slate-950">制作节点</h3></div><strong className="text-sm text-slate-800">{item.progress}%</strong></div>
        <ol className="mt-5">{item.steps.map((step, index) => <li key={step.key} className="relative flex gap-4 pb-5 last:pb-0"><div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white"><span className={`h-3 w-3 rounded-full border-2 ${step.state === "done" ? "border-emerald-600 bg-emerald-500" : step.state === "active" ? "border-blue-600 bg-blue-500 motion-safe:animate-pulse" : "border-slate-300 bg-white"}`}/></div>{index < item.steps.length - 1&&<span className={`absolute left-[11px] top-5 h-full w-0.5 ${step.state === "done" ? "bg-emerald-300" : "bg-slate-200"}`}/>}<div className="min-w-0 flex-1 rounded-xl bg-slate-50 px-3 py-3"><div className="flex items-center justify-between gap-3"><p className="text-xs font-black text-slate-800">{index + 1}. {step.label}</p><span className={`text-[9px] font-black ${step.state === "done" ? "text-emerald-700" : step.state === "active" ? "text-blue-700" : "text-slate-400"}`}>{step.state === "done" ? "已完成" : step.state === "active" ? "进行中" : "等待"}</span></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500"><span>负责：<strong className="text-slate-700">{step.responsibleAgent}</strong></span><span>预计：<strong className="text-slate-700">{productionDurationLabel(step.estimatedMinutes)}</strong></span>{step.actualStartedAt&&<span>实际开始：{dateLabel(step.actualStartedAt)}</span>}{step.actualFinishedAt&&<span>实际完成：{dateLabel(step.actualFinishedAt)}</span>}</div>{step.state === "active"&&<p className="mt-2 text-[10px] text-slate-500">系统会持续保存本节点结果，离开页面不会中断后台任务。</p>}</div></li>)}</ol>
      </div>
      <aside className="space-y-4">
        {item.confidence&&<section className="rounded-3xl border border-sky-100 bg-sky-50/55 p-5"><p className="text-[10px] font-black uppercase tracking-[.14em] text-sky-700">Confidence evidence</p><h3 className="mt-2 text-sm font-black text-slate-950">成功把握与数据充分度</h3><p className="mt-2 text-[10px] leading-5 text-slate-600">{item.confidence.note}</p><div className="mt-3 space-y-2">{([["制作把握",item.confidence.production],["发布把握",item.confidence.publishing],["经营把握",item.confidence.business]] as const).map(([label,dimension])=><details key={label} className="rounded-xl border border-white bg-white/80 px-3 py-2"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-black text-slate-800"><span>{label}</span><span className={`rounded-full px-2 py-1 text-[9px] ${confidenceTone[dimension.level]}`}>{dimension.label}</span></summary><div className="mt-2 border-t border-slate-100 pt-2 text-[10px] leading-5 text-slate-600">{dimension.evidence.length?<p><strong>已有依据：</strong>{dimension.evidence.join("；")}</p>:<p>当前没有足够真实依据。</p>}{dimension.gaps.length?<p className="mt-1 text-amber-700"><strong>仍缺：</strong>{dimension.gaps.join("；")}</p>:null}</div></details>)}</div></section>}
        <section className="rounded-3xl border border-emerald-100 bg-emerald-50/60 p-5"><p className="text-[10px] font-black uppercase tracking-[.14em] text-emerald-700">计划依据</p><h3 className="mt-2 text-sm font-black text-slate-950">{item.referenceTitle || "按产品与账号策略生成"}</h3>{item.benchmarkAccount&&<p className="mt-2 text-xs font-bold text-slate-700">对标账号：{item.benchmarkAccount}</p>}{item.referenceViews&&<p className="mt-1 text-xs text-slate-600">参考播放：{item.referenceViews}</p>}{item.matchScore!==null&&<p className="mt-1 text-xs text-slate-600">内容匹配度：{item.matchScore}（不是成功率）</p>}<p className="mt-3 text-[10px] leading-5 text-slate-600">{item.planningFactors.length ? item.planningFactors.join(" · ") : "当前没有可核验的参考视频，未生成虚构对标信息。"}</p></section>
        <section className="rounded-3xl border border-slate-200 bg-white p-5"><p className="text-[10px] font-black uppercase tracking-[.14em] text-slate-400">业务血缘</p><dl className="mt-3 space-y-2 text-xs">{[["经营目标",item.lineage.objective||"单项内容交付"],["发布账号",item.lineage.accountLabel||"仅制作"],["计划版本",item.lineage.planId?`v${item.lineage.planVersion||1}`:"手动单项"],["授权方式",item.lineage.authorizationMode==="bounded"?"范围授权":item.lineage.authorizationMode==="each"?"逐次确认":"手动任务"]].map(([label,value])=><div key={label} className="grid grid-cols-[72px_1fr] gap-2"><dt className="text-slate-400">{label}</dt><dd className="font-bold leading-5 text-slate-700">{value}</dd></div>)}</dl></section>
      </aside>
    </section>

    {data.run&&item.taskId&&<ProductionTaskScene runId={data.run.id} taskId={item.taskId} embedded/>}
  </div>;
}

function ReviewView({ data, selectedAccountId = "", onNavigate }: { data: DigitalEmployeeOverview; selectedAccountId?: string; onNavigate?: (page: Page) => void }) {
  const selectedTarget = data.config?.publishingTargets.find(target => target.accountId === selectedAccountId);
  const [platform, setPlatform] = useState<Platform>(selectedTarget?.platform || "youtube");
  const [accountId, setAccountId] = useState(selectedAccountId || "all");
  const [performance, setPerformance] = useState<ConnectedSocialPerformance | null>(null);
  const [performanceBusy, setPerformanceBusy] = useState(true);
  const [performanceError, setPerformanceError] = useState("");
  const [board, setBoard] = useState<ReviewTodoBoard | null>(null);
  const [todoBusy, setTodoBusy] = useState(false);
  const [todoMessage, setTodoMessage] = useState("");
  const week = nextReviewWeek();
  const deliveries = data.deliveries || [];
  const review = data.review;
  const reviewSummary = review?.summary;
  const liveReview = data.liveReview;
  const nextRoundSuggestion = reviewSummary?.nextGoalSuggestion || "等待本周任务完成并回传账号数据后，Agent 会生成下一轮目标与预算建议。";
  const reviewQueue = data.contentQueue?.items.filter(item => item.origin === "weekly_plan" && (!selectedAccountId || item.accountId === selectedAccountId)) || [];
  const completedReviewItems = reviewQueue.filter(item => item.status === "completed");
  const settledReviewItems = reviewQueue.filter(item => item.settledCostCny !== null);
  const settledReviewCost = settledReviewItems.reduce((sum,item)=>sum+Number(item.settledCostCny||0),0);
  const performanceByAccount = Object.values((performance?.contents || []).reduce<Record<string,{ accountId:string; accountTitle:string; views:number; videos:number }>>((result,item)=>{
    if(item.metrics.views===null)return result;
    const row=result[item.accountId]||{accountId:item.accountId,accountTitle:item.accountTitle,views:0,videos:0};
    row.views+=item.metrics.views;row.videos+=1;result[item.accountId]=row;return result;
  },{})).sort((left,right)=>right.views-left.views);
  const leadingAccount = performanceByAccount[0];
  const allocationSuggestion = leadingAccount
    ? `下一轮可优先给“${leadingAccount.accountTitle}”增加 1 个测试内容位，再用同类内容的真实表现决定是否继续扩量。`
    : "账号真实表现数据不足，下一轮先保持当前分配，不自动追加账号预算。";

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
  useEffect(() => {
    const target = data.config?.publishingTargets.find(item => item.accountId === selectedAccountId);
    if (target) { setPlatform(target.platform); setAccountId(target.accountId); }
    else if (!selectedAccountId) setAccountId("all");
  }, [data.config?.publishingTargets, selectedAccountId]);
  useEffect(() => {
    const target = data.config?.publishingTargets.find(item => item.accountId === selectedAccountId);
    if (!target || target.platform !== platform) setAccountId("all");
  }, [data.config?.publishingTargets, platform, selectedAccountId]);
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
    <section className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,.7fr)]">
      <div className="rounded-3xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black tracking-[.14em] text-slate-400">本周复盘</p><h3 className="mt-1 text-base font-black text-slate-950">计划完成与业务回流</h3></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${review?.status==='generated'?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-600'}`}>{review?.status==='generated'?'复盘已生成':'等待完整数据'}</span></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{[{label:"完成率",value:reviewSummary?`${Math.round(reviewSummary.completionRate)}%`:liveReview?.completionRate!==undefined?`${Math.round(liveReview.completionRate)}%`:"—"},{label:"已完成",value:reviewSummary?`${reviewSummary.completedTasks}/${reviewSummary.totalTasks}`:liveReview?.totalTasks!==undefined?`${liveReview.completedTasks||0}/${liveReview.totalTasks}`:"—"},{label:"阻塞项",value:liveReview?.blockedTasks.length??reviewSummary?.failedTasks??"—"},{label:"数据缺口",value:liveReview?.dataGaps.length??"—"}].map(item=><div key={item.label} className="rounded-xl bg-slate-50 px-3 py-3"><p className="text-[9px] font-bold text-slate-400">{item.label}</p><p className="mt-1 text-lg font-black text-slate-900">{item.value}</p></div>)}</div>{liveReview?.dataGaps.length?<p className="mt-3 text-[10px] leading-5 text-amber-700">仍需补齐：{liveReview.dataGaps.slice(0,3).join("；")}</p>:<p className="mt-3 text-[10px] text-slate-400">复盘只采用工作流结果与已连接账号回传，不用模拟指标补齐。</p>}</div>
      <div className="rounded-3xl border border-violet-100 bg-violet-50/65 p-5"><p className="text-[10px] font-black tracking-[.14em] text-violet-700">下一轮建议</p><h3 className="mt-2 text-base font-black text-slate-950">目标、账号与预算怎样调整</h3><p className="mt-3 text-sm font-bold leading-6 text-slate-800">{nextRoundSuggestion}</p><p className="mt-2 text-xs font-bold leading-5 text-violet-900">{allocationSuggestion}</p><div className="mt-3 grid grid-cols-3 gap-2">{[{label:"周计划完成",value:`${completedReviewItems.length}/${reviewQueue.length}`},{label:"真实账号样本",value:`${performanceByAccount.reduce((sum,item)=>sum+item.videos,0)} 条`},{label:"已结算制作费",value:settledReviewItems.length?`¥${settledReviewCost.toFixed(2)}`:"待回传"}].map(item=><div key={item.label} className="rounded-xl bg-white/75 px-2 py-2.5"><p className="text-[8px] font-bold text-slate-400">{item.label}</p><p className="mt-1 text-[11px] font-black text-slate-800">{item.value}</p></div>)}</div><p className="mt-2 text-[10px] leading-5 text-slate-500">建议仅引用本周完成记录、真实账号回传与供应商结算；确认后才形成新计划版本，不会直接改写当前周期。</p></div>
    </section>
    {(performanceError||performance?.unavailable.length)&&<div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800"><span>{performanceError||`${performance?.unavailable.length} 个账号暂时无法同步；已保留其他账号的真实数据。`}</span><button type="button" onClick={()=>onNavigate?.("accountManagement")} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[10px] font-black text-amber-900">检查账号授权 →</button></div>}
    <div className="mt-5 flex flex-wrap items-end justify-between gap-3 border-b border-slate-200"><div className="flex gap-3 overflow-x-auto">{platformOptions.map((item)=><button type="button" key={item} title={platformLabels[item]} aria-label={platformLabels[item]} onClick={()=>setPlatform(item)} aria-pressed={platform===item} className={`flex h-11 w-12 shrink-0 items-center justify-center border-b-2 pb-2 ${platform===item?'border-emerald-700':'border-transparent opacity-45 hover:opacity-75'}`}><SocialPlatformIcon platform={item} size={21}/></button>)}</div><select aria-label="复盘账号" value={accountId} onChange={event=>setAccountId(event.target.value)} className="mb-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700"><option value="all">全部账号</option>{connectedAccounts.map(account=><option key={account.id} value={account.id}>{account.title}</option>)}</select></div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white">{ranking.map((card,index)=><article key={card.id} className={`grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-4 p-5 ${index?'border-t border-slate-100':''}`}><span className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm font-black ${index===0?'bg-amber-100 text-amber-800':'bg-slate-100 text-slate-500'}`}>{index+1}</span><div className="min-w-0"><h3 className="truncate text-sm font-black text-slate-950">{card.title}</h3><p className="mt-1 truncate text-xs text-slate-400">{card.subject}</p>{(card.likes!==null||card.comments!==null)&&<p className="mt-1 text-[10px] text-slate-400">点赞 {card.likes??"—"} · 评论 {card.comments??"—"}</p>}</div><div className="text-right"><p className="flex items-center gap-1 text-sm font-black text-slate-900"><Eye size={13}/>{card.views.toLocaleString("zh-CN")}</p><p className="mt-1 text-[10px] text-slate-400">播放量</p></div></article>)}{performanceBusy&&!ranking.length?<div className="flex items-center justify-center gap-2 px-5 py-20 text-sm text-slate-400"><Loader2 size={17} className="animate-spin"/>正在同步账号内容数据</div>:!ranking.length&&<div className="px-5 py-20 text-center"><Eye size={28} className="mx-auto text-slate-300"/><p className="mt-3 text-sm font-bold text-slate-600">{platformLabels[platform]} 暂无内容播放量</p><p className="mt-1 text-xs text-slate-400">请确认账号授权包含内容读取权限，然后点击“同步账号数据”。</p></div>}</section>
      <aside className="space-y-4"><section className="rounded-3xl border border-emerald-100 bg-emerald-50/55 p-5"><Sparkles size={20} className="text-emerald-700"/><h3 className="mt-4 text-base font-black text-slate-950">Agent 制作建议</h3><p className="mt-3 text-sm font-bold leading-6 text-slate-800">{top?`批量复刻《${top.title}》的开头钩子与叙事节奏。`:"等待平台播放量回传后生成建议。"}</p><p className="mt-2 text-xs leading-6 text-slate-500">{top?"保留高表现结构，替换为下周主推产品与已核验卖点；建议先制作 3 条变体。":"当前没有足够数据，不生成未经证实的复刻建议。"}</p><button type="button" disabled={!top||!board||todoBusy} onClick={()=>void addTopToTodo()} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40">{todoBusy?<Loader2 size={14} className="animate-spin"/>:<CalendarPlus size={14}/>}纳入下周待办</button>{todoMessage&&<p role="status" className="mt-2 text-center text-[10px] text-emerald-800">{todoMessage}</p>}</section>
        <section className="rounded-3xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between"><h3 className="text-sm font-black text-slate-950">下周待办</h3><span className="text-[10px] text-slate-400">{week} 起</span></div><div className="mt-4 space-y-3">{board?.items.slice(0,5).map((item)=><div key={item.id} className="flex items-start gap-3"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-700"/><div className="min-w-0"><p className="truncate text-xs font-bold text-slate-800">{item.title}</p><p className="mt-0.5 text-[10px] text-slate-400">{item.quantity>1?`${item.quantity} 条 · `:""}{item.status==='assigned'?'已分配':'待分配'}</p></div></div>)}{board&&!board.items.length&&<p className="py-3 text-xs text-slate-400">暂无待办，可从上方建议直接加入。</p>}{!board&&<p className="py-3 text-xs text-slate-400">正在读取待办…</p>}</div></section></aside>
    </div>
  </div>;
}

export default function SmartBusinessDashboard({ data, view, selectedAccountId, selectedContentItemId, onRefresh, onNavigate, onGeneratePlan, onGenerateDetails, onOpenContent, onOpenProductionProgress, onBackToQueue, onRetryTask, onControlJob }: { data: DigitalEmployeeOverview; view: SmartBusinessView; selectedAccountId?: string; selectedContentItemId?: string; onRefresh?: () => void; onNavigate?: (page: Page) => void; onGeneratePlan?: () => void; onGenerateDetails?: () => void; onOpenContent?: (taskId?: string, socialContentTaskId?: string) => void; onOpenProductionProgress?: (taskId: string, contentItemId: string) => void; onBackToQueue?: () => void; onRetryTask?: (taskId: string) => Promise<boolean>; onControlJob?: (jobId: string, action: ExecutionControlAction) => Promise<boolean> }) {
  if (view === "matrix") return <MatrixView data={data} selectedAccountId={selectedAccountId} onRefresh={onRefresh} onNavigate={onNavigate} onGeneratePlan={onGeneratePlan}/>;
  if (view === "queue") return <QueueView data={data} selectedAccountId={selectedAccountId} onRefresh={onRefresh} onNavigate={onNavigate} onGenerateDetails={onGenerateDetails} onOpenContent={onOpenContent} onOpenProductionProgress={onOpenProductionProgress} onControlJob={onControlJob} onRetryTask={onRetryTask}/>;
  if (view === "production") return <ProductionDetailView data={data} contentItemId={selectedContentItemId} onBack={onBackToQueue} onNavigate={onNavigate} onOpenContent={onOpenContent} onRetryTask={onRetryTask}/>;
  if (view === "review") return <ReviewView data={data} selectedAccountId={selectedAccountId} onNavigate={onNavigate}/>;
  return <HomeView data={data} selectedAccountId={selectedAccountId} onRefresh={onRefresh}/>;
}
