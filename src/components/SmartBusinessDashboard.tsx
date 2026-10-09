import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
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
  TrendingUp,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { digitalEmployeeApi, type ContentExecutionRuntimeJob, type ContentQueueItem, type DigitalEmployeeOverview, type DigitalEmployeeAgentRole, type NextRoundRecommendations, type WeeklyReviewSummary } from "../lib/digitalEmployees";
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
import NextRoundRecommendationsSection from "./NextRoundRecommendationsSection";
import AccountActivity from "./AccountActivity";

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

export function WeeklyCommandCenter({
  data,
  statusLabel,
  actions,
  notice,
  className = "",
}: {
  data: DigitalEmployeeOverview;
  statusLabel: string;
  actions?: ReactNode;
  notice?: ReactNode;
  className?: string;
}) {
  const display = buildSmartBusinessDisplayModel(data);
  const contentQueue = data.contentQueue?.items || [];
  const operatingContext = data.plan?.businessPackage?.operatingContext;
  const packagePlans = data.plan?.businessPackage?.tasks.find(task => task.templateId === "production")?.videoPlans || [];
  const directorPlan = data.plan?.businessPackage?.directorPlan;
  const weeklyQueue = contentQueue.filter(item => item.origin === "weekly_plan");
  const manualQueue = contentQueue.filter(item => item.origin === "manual");
  const plannedOutputCount = display.totals.versionCount;
  const plannedOriginalCount = display.totals.originalCount;
  const plannedPublishCount = display.totals.versionCount;
  const plannedDurationSeconds = display.totals.durationSeconds;
  const estimatedContentCost = weeklyQueue.reduce((sum, item) => sum + Number(item.estimatedCostCny || 0), 0)
    || packagePlans.reduce((sum, plan) => sum + Number(plan.estimatedCost || 0), 0);
  const settledContentCost = weeklyQueue.reduce((sum, item) => sum + Number(item.settledCostCny || 0), 0);
  const budgetMin = operatingContext?.budget.totalMinCny ?? packagePlans.reduce((sum, plan) => sum + Number(plan.estimatedCostRange?.minCny || 0), 0);
  const budgetMax = operatingContext?.budget.totalMaxCny ?? packagePlans.reduce((sum, plan) => sum + Number(plan.estimatedCostRange?.maxCny || 0), 0);
  const queuedBlockedCount = weeklyQueue.filter(item => item.status === "blocked").length;
  const preproductionBlockedCount = data.plan?.businessPackage?.detailGeneration?.blockedCount || 0;
  const weeklyStatusCounts = {
    queued: display.contents.filter(item => ["planned", "queued"].includes(item.status)).length,
    producing: display.contents.filter(item => item.status === "producing").length,
    review: display.totals.waitingReviewCount,
    blocked: Math.max(display.totals.blockedCount, queuedBlockedCount, preproductionBlockedCount),
    completed: display.totals.completedCount,
  };

  return <section className={`overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-sm ${className}`.trim()} aria-label="本周任务驾驶舱">
    <div className="flex flex-wrap items-start justify-between gap-5 bg-gradient-to-r from-emerald-950 via-emerald-900 to-teal-800 px-5 py-5 text-white sm:px-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-black">周经营计划{data.goal ? ` · ${data.goal.startsAt} 至 ${data.goal.endsAt}` : ""}</h2>
          <span className="rounded-full bg-emerald-300 px-2.5 py-1 text-[9px] font-black text-emerald-950">{statusLabel}</span>
        </div>
      </div>
      {actions && <div aria-label="智能经营控制" className="flex max-w-full flex-wrap items-center justify-end gap-2">{actions}</div>}
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
      <span className="text-[10px] font-bold text-slate-400 xl:ml-auto">本周发布版本 {display.totals.versionCount} 条 · 另有手动单项 {manualQueue.length} 条</span>
    </div>
    {notice && <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">{notice}</div>}
  </section>;
}

type DisplayMetricSource = "real" | "demo";

type UnifiedPlanContent = {
  id: string;
  contentId: string;
  familyId: string;
  title: string;
  productName: string;
  platform: Platform;
  accountId: string;
  accountLabel: string;
  plannedPublishDate: string;
  duration: number;
  productionRole: "master" | "platform_adaptation";
  status: ContentQueueItem["status"];
  queueItem: ContentQueueItem | null;
  metrics: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    interactions: number;
    engagementRate: number;
    source: DisplayMetricSource;
  };
};

type UnifiedAccountRow = {
  accountId: string;
  accountLabel: string;
  platform: Platform;
  positioning: string;
  plannedCount: number;
  budgetCny: number | null;
  source: "connected" | "plan";
};

type SmartBusinessDisplayModel = {
  revision: number;
  startsAt: string;
  endsAt: string;
  contents: UnifiedPlanContent[];
  masters: UnifiedPlanContent[];
  accounts: UnifiedAccountRow[];
  totals: {
    accountCount: number;
    originalCount: number;
    versionCount: number;
    durationSeconds: number;
    budgetMinCny: number;
    budgetMaxCny: number;
    budgetMidCny: number;
    completedCount: number;
    waitingReviewCount: number;
    blockedCount: number;
    views: number;
    interactions: number;
    publishedCount: number;
    engagementRate: number;
    performanceSource: DisplayMetricSource;
  };
  platforms: Array<{
    platform: Platform;
    plannedCount: number;
    views: number;
    interactions: number;
    engagementRate: number;
    source: DisplayMetricSource;
  }>;
};

const demoPerformanceBase: Record<Platform, { views: number; engagementRate: number }> = {
  youtube: { views: 2_600, engagementRate: 4.1 },
  tiktok: { views: 5_200, engagementRate: 6.8 },
  instagram: { views: 3_600, engagementRate: 5.5 },
  facebook: { views: 1_800, engagementRate: 3.4 },
};

function deterministicSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function demoMetrics(platform: Platform, identity: string) {
  const seed = deterministicSeed(identity);
  const base = demoPerformanceBase[platform];
  const views = Math.round(base.views * (0.78 + (seed % 47) / 100));
  const engagementRate = Math.round((base.engagementRate + ((seed >> 3) % 15) / 10) * 10) / 10;
  const interactions = Math.round(views * engagementRate / 100);
  const likes = Math.round(interactions * 0.72);
  const comments = Math.round(interactions * 0.13);
  const shares = Math.max(0, interactions - likes - comments);
  return { views, likes, comments, shares, interactions, engagementRate, source: "demo" as const };
}

function buildSmartBusinessDisplayModel(data: DigitalEmployeeOverview, selectedAccountId = ""): SmartBusinessDisplayModel {
  const operatingContext = data.plan?.businessPackage?.operatingContext;
  const packagePlans = data.plan?.businessPackage?.tasks.find(task => task.templateId === "production")?.videoPlans || [];
  const goalPlans = data.goal?.videoPlans || [];
  const sourcePlans = packagePlans.length ? packagePlans : goalPlans;
  const queue = data.contentQueue?.items || [];
  const deliveries = data.deliveries || [];
  const connectedIds = new Set((data.config?.publishingTargets || []).map(target => target.accountId));
  const operatingAccounts = operatingContext?.accounts || [];
  const accountById = new Map(operatingAccounts.map(account => [account.accountId, account]));
  const targetById = new Map((data.config?.publishingTargets || []).map(target => [target.accountId, target]));
  const queueByContentId = new Map(queue.filter(item => item.contentId).map(item => [item.contentId, item]));
  const claimedQueueIds = new Set<string>();

  const findQueueItem = (plan: VideoCreationPlan) => {
    const direct = plan.contentId ? queueByContentId.get(plan.contentId) : undefined;
    if (direct) {
      claimedQueueIds.add(direct.id);
      return direct;
    }
    const candidate = queue.find(item => !claimedQueueIds.has(item.id)
      && item.origin === "weekly_plan"
      && item.platform === plan.platform
      && (!plan.matrix?.accountId || item.accountId === plan.matrix.accountId)
      && (!plan.plannedPublishDate || item.plannedPublishDate === plan.plannedPublishDate));
    if (candidate) claimedQueueIds.add(candidate.id);
    return candidate;
  };

  const mappedContents = sourcePlans.map((plan, index): UnifiedPlanContent => {
    const queueItem = findQueueItem(plan) || null;
    const accountId = plan.matrix?.accountId || queueItem?.accountId || `plan-${plan.platform}`;
    const account = accountById.get(accountId);
    const target = targetById.get(accountId);
    const identity = plan.contentId || `${plan.platform}-${plan.plannedPublishDate}-${plan.theme}-${index}`;
    const actual = queueItem ? performanceForQueueItem(queueItem, deliveries) : null;
    const fallback = demoMetrics(plan.platform, identity);
    const hasActual = Boolean(actual?.hasPlatformData);
    const views = hasActual ? actual?.views || 0 : fallback.views;
    const likes = hasActual ? actual?.likes || 0 : fallback.likes;
    const comments = hasActual ? actual?.comments || 0 : fallback.comments;
    const shares = hasActual ? actual?.shares || 0 : fallback.shares;
    const interactions = hasActual ? actual?.interactions || 0 : fallback.interactions;
    const engagementRate = hasActual ? actual?.engagementRate || 0 : fallback.engagementRate;
    return {
      id: identity,
      contentId: plan.contentId || identity,
      familyId: plan.contentFamilyId || plan.masterContentId || plan.contentId || identity,
      title: plan.publication?.title || plan.theme || plan.planningEvidence?.referenceTitle || `本周视频 ${index + 1}`,
      productName: plan.productName || data.config?.focusProducts || "待绑定产品",
      platform: plan.platform,
      accountId,
      accountLabel: account?.accountLabel || target?.accountLabel || `${data.config?.companyName || "企业"} · ${platformLabels[plan.platform]}`,
      plannedPublishDate: plan.plannedPublishDate || data.goal?.endsAt || "",
      duration: Number(plan.duration || 0),
      productionRole: plan.productionRole === "platform_adaptation" ? "platform_adaptation" : "master",
      status: queueItem?.status || "planned",
      queueItem,
      metrics: { views, likes, comments, shares, interactions, engagementRate, source: hasActual ? "real" : "demo" },
    };
  });
  const contents = mappedContents.filter(item => !selectedAccountId || item.accountId === selectedAccountId);
  const masters = contents.filter(item => item.productionRole === "master");
  const groupedAccounts = new Map<string, UnifiedAccountRow>();
  for (const item of contents) {
    const operatingAccount = accountById.get(item.accountId);
    const current = groupedAccounts.get(item.accountId);
    if (current) current.plannedCount += 1;
    else groupedAccounts.set(item.accountId, {
      accountId: item.accountId,
      accountLabel: item.accountLabel,
      platform: item.platform,
      positioning: operatingAccount?.positioning || "本周计划经营账号",
      plannedCount: 1,
      budgetCny: operatingAccount?.budgetCny ?? null,
      source: connectedIds.has(item.accountId) ? "connected" : "plan",
    });
  }
  if (!contents.length) {
    for (const account of operatingAccounts.filter(item => !selectedAccountId || item.accountId === selectedAccountId)) {
      groupedAccounts.set(account.accountId, {
        accountId: account.accountId,
        accountLabel: account.accountLabel,
        platform: account.platform as Platform,
        positioning: account.positioning,
        plannedCount: account.contentCount,
        budgetCny: account.budgetCny,
        source: connectedIds.has(account.accountId) ? "connected" : "plan",
      });
    }
  }
  const accounts = [...groupedAccounts.values()];
  const planByContentId = new Map(sourcePlans.map(plan => [plan.contentId, plan]));
  const budgetMinCny = operatingContext?.budget.totalMinCny
    ?? masters.reduce((sum, item) => sum + Number(planByContentId.get(item.contentId)?.estimatedCostRange?.minCny || 0), 0);
  const budgetMaxCny = operatingContext?.budget.totalMaxCny
    ?? masters.reduce((sum, item) => sum + Number(planByContentId.get(item.contentId)?.estimatedCostRange?.maxCny || 0), 0);
  const fallbackBudget = operatingContext?.budget.totalCny
    ?? masters.reduce((sum, item) => sum + Number(planByContentId.get(item.contentId)?.estimatedCost || 0), 0);
  const normalizedMin = budgetMinCny || fallbackBudget;
  const normalizedMax = budgetMaxCny || fallbackBudget;
  const realAggregateViews = data.businessSnapshot?.social.views.value;
  const realAggregateInteractions = data.businessSnapshot
    ? [data.businessSnapshot.social.likes.value, data.businessSnapshot.social.comments.value, data.businessSnapshot.social.shares.value, data.businessSnapshot.social.saves.value]
      .filter((value): value is number => value !== null).reduce((sum, value) => sum + value, 0)
    : null;
  const actualPublishedCount = data.businessSnapshot?.content.publishedPosts.value;
  const useRealAggregate = realAggregateViews !== null && realAggregateViews !== undefined;
  const views = useRealAggregate ? realAggregateViews : contents.reduce((sum, item) => sum + item.metrics.views, 0);
  const interactions = useRealAggregate && realAggregateInteractions !== null
    ? realAggregateInteractions
    : contents.reduce((sum, item) => sum + item.metrics.interactions, 0);
  const publishedCount = actualPublishedCount !== null && actualPublishedCount !== undefined
    ? actualPublishedCount
    : contents.filter(item => item.status === "completed").length;
  const platforms = platformOptions.map(platform => {
    const rows = contents.filter(item => item.platform === platform);
    const platformSnapshot = data.businessSnapshot?.social.platformBreakdown.find(item => item.platform.toLowerCase() === platform);
    const hasReal = platformSnapshot?.views !== null && platformSnapshot?.views !== undefined;
    const platformViews = hasReal ? platformSnapshot?.views || 0 : rows.reduce((sum, item) => sum + item.metrics.views, 0);
    const platformInteractions = hasReal
      ? [platformSnapshot?.likes, platformSnapshot?.comments, platformSnapshot?.shares].filter((value): value is number => value !== null && value !== undefined).reduce((sum, value) => sum + value, 0)
      : rows.reduce((sum, item) => sum + item.metrics.interactions, 0);
    return {
      platform,
      plannedCount: rows.length,
      views: platformViews,
      interactions: platformInteractions,
      engagementRate: platformViews ? platformInteractions / platformViews * 100 : 0,
      source: hasReal ? "real" as const : "demo" as const,
    };
  });
  return {
    revision: data.plan?.businessPackage?.revision || data.goal?.version || 1,
    startsAt: operatingContext?.cycle.startsAt || data.goal?.startsAt || "",
    endsAt: operatingContext?.cycle.endsAt || data.goal?.endsAt || "",
    contents,
    masters,
    accounts,
    totals: {
      accountCount: accounts.length,
      originalCount: operatingContext?.outputs.originalCount ?? masters.length,
      versionCount: contents.length || operatingContext?.outputs.platformVersionCount || operatingContext?.outputs.count || 0,
      durationSeconds: operatingContext?.outputs.totalDurationSeconds ?? masters.reduce((sum, item) => sum + item.duration, 0),
      budgetMinCny: normalizedMin,
      budgetMaxCny: normalizedMax,
      budgetMidCny: fallbackBudget || (normalizedMin + normalizedMax) / 2,
      completedCount: contents.filter(item => item.status === "completed").length,
      waitingReviewCount: contents.filter(item => item.status === "waiting_review").length,
      blockedCount: contents.filter(item => item.status === "blocked").length,
      views,
      interactions,
      publishedCount,
      engagementRate: views ? interactions / views * 100 : 0,
      performanceSource: useRealAggregate ? "real" : "demo",
    },
    platforms,
  };
}

function PlanDataSourceBadge({ source }: { source: DisplayMetricSource }) {
  return <span className={`rounded-full px-2.5 py-1 text-[9px] font-black ${source === "real" ? "bg-emerald-100 text-emerald-800" : "bg-violet-100 text-violet-800"}`}>{source === "real" ? "真实回传" : "演示数据"}</span>;
}

function HomeView({ data, onRefresh, selectedAccountId = "" }: { data: DigitalEmployeeOverview; onRefresh?: () => void; selectedAccountId?: string }) {
  const [monitor, setMonitor] = useState<AgentCard | null>(null);
  const display = useMemo(() => buildSmartBusinessDisplayModel(data), [data]);
  const snapshot = data.businessSnapshot;
  const operatingContext = data.plan?.businessPackage?.operatingContext;
  const weeklyStatusCounts = {
    queued: display.contents.filter(item => ["planned", "queued"].includes(item.status)).length,
    producing: display.contents.filter(item => item.status === "producing").length,
    review: display.totals.waitingReviewCount,
    blocked: Math.max(display.totals.blockedCount, data.plan?.businessPackage?.detailGeneration?.blockedCount || 0),
    completed: display.totals.completedCount,
  };
  const cycleTasks = data.tasks || [];
  const cycleCompleted = cycleTasks.filter(item => ["succeeded", "skipped"].includes(item.status)).length;
  const cycleAttention = cycleTasks.filter(item => ["failed", "waiting_approval", "waiting_human", "handed_off"].includes(item.status)).length;
  const connectedTargets = data.config?.publishingTargets || [];
  const monitoredAccounts = display.accounts;
  const agentLiveState = Object.fromEntries(agentCards.map(item => {
    const status = data.agents.find(agent => roleAliases[item.role].includes(agent.role));
    const live = Boolean(status && runningStatuses.has(status.status)) || relatedTasks(data, item.role).some(task => runningStatuses.has(task.status));
    return [item.role, live];
  })) as Record<AgentCard["role"], boolean>;
  const activeAgentCount = agentCards.filter(item => agentLiveState[item.role]).length;
  const waitingCount = display.totals.waitingReviewCount;
  const completedCount = display.totals.completedCount;
  const cycleProgress = display.totals.versionCount ? Math.round((completedCount / display.totals.versionCount) * 100) : 0;
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
    count: display.platforms.find(item => item.platform === platform)?.plannedCount || 0,
  }));
  const pulse = [
    { label: "本周发布版本", value: display.totals.versionCount, color: "#2fd1c5" },
    { label: "已完成交付", value: completedCount, color: "#8b7cf6" },
    { label: "等待验收", value: waitingCount, color: "#ff8e72" },
    { label: "正在工作的 Agent", value: activeAgentCount, color: "#10244a" },
  ];
  const pulseMax = Math.max(1, ...pulse.map(item => item.value));
  const adSpend = snapshot?.ads?.spendByCurrency || [];
  const adSpendValue = adSpend.length === 1 ? `${adSpend[0].currency} ${adSpend[0].amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}` : adSpend.length > 1 ? `${adSpend.length} 种币种` : `¥${(operatingContext?.budget.paidMediaCny || 0).toFixed(0)}`;
  const inquiriesAvailable = snapshot?.content.inquiries.status === "available" && snapshot.content.inquiries.value !== null;
  const wonAvailable = snapshot?.customer.won.status === "available" && snapshot.customer.won.value !== null;
  const demoInquiryCount = Math.max(8, Math.round(display.totals.versionCount * 0.65));
  const demoWonCount = Math.max(1, Math.round(demoInquiryCount * 0.22));
  const metrics = [
    { label: "运营平台账号", value: `${display.totals.accountCount}`, note: `${display.accounts.filter(item => item.source === "connected").length} 个已连接 · ${display.totals.accountCount} 个纳入计划`, icon: Users, source: "plan" },
    { label: "获得询盘", value: metricValue(inquiriesAvailable ? snapshot?.content.inquiries.value : demoInquiryCount), note: inquiriesAvailable ? snapshot?.content.inquiries.note || "当前统计周期" : "缺少回传，当前为演示数据", icon: MessageSquareText, source: inquiriesAvailable ? "real" : "demo" },
    { label: "实际增长", value: metricValue(wonAvailable ? snapshot?.customer.won.value : demoWonCount), note: wonAvailable ? "按成交客户记录" : "缺少成交回传，当前为演示数据", icon: TrendingUp, source: wonAvailable ? "real" : "demo" },
    { label: "投流消耗", value: adSpendValue, note: adSpend.length ? snapshot?.ads?.note || "平台真实回传" : "当前周计划未配置付费投流", icon: CircleDollarSign, source: adSpend.length ? "real" : "plan" },
  ];

  return <>
    <section className="grid gap-3 rounded-3xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-emerald-50 p-4 shadow-sm sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-5" aria-label="本周成果与下一里程碑">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400 text-amber-950"><Trophy size={21}/></span>
      <div><p className="text-[10px] font-black uppercase tracking-[.16em] text-amber-700">本周成果</p><h3 className="mt-1 text-sm font-black text-slate-950">已完成 {completedCount} 条内容、{cycleCompleted} 个经营节点</h3><p className="mt-1 text-xs text-slate-600">下一里程碑：{nextMilestone}</p></div>
      <div className="min-w-32"><div className="flex items-center justify-between text-[10px] font-bold text-slate-500"><span>内容完成度</span><strong className="text-emerald-800">{cycleProgress}%</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-emerald-600 transition-[width]" style={{width:`${cycleProgress}%`}}/></div></div>
    </section>

    <section className="visual-card overflow-hidden p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">经营数据</p><h2 className="mt-2 text-2xl font-black text-slate-950">经营结果一眼看清</h2><p className="mt-1 text-sm text-slate-500">账号与内容数量统一取自当前周计划；缺失的结果指标使用演示数据，并在卡片中明确标记。</p></div>{onRefresh&&<button type="button" onClick={onRefresh} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800"><RefreshCcw size={14}/>刷新</button>}</div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ label, value, note, icon: Icon, source }, index)=><article key={label} className="relative overflow-hidden rounded-2xl border border-[#10244a]/10 bg-white/90 p-4 shadow-[0_4px_0_rgba(16,36,74,.04)]"><span aria-hidden="true" className={`absolute -right-5 -top-5 h-20 w-20 rounded-full ${index%2?'bg-[#8b7cf6]/10':'bg-[#2fd1c5]/12'}`}/><div className="relative flex items-center justify-between"><span className="text-xs font-bold text-slate-500">{label}</span><span className={`flex h-8 w-8 items-center justify-center rounded-xl border-2 border-[#10244a] ${index%2?'bg-[#dcd7ff]':'bg-[#baf2e8]'}`}><Icon size={15} className="text-[#10244a]" strokeWidth={2.5}/></span></div><p className={`relative mt-3 font-black tracking-tight text-[#10244a] ${index===3?'text-2xl':'text-3xl'}`}>{value}</p><div className="relative mt-1 flex min-w-0 items-center gap-2"><p className="min-w-0 flex-1 truncate text-[11px] text-slate-400">{note}</p>{source === "demo"&&<PlanDataSourceBadge source="demo"/>}</div><div aria-hidden="true" className="relative mt-4 flex h-5 items-end gap-1">{[0.35,0.58,0.46,0.78,0.68].map((height, barIndex)=><span key={barIndex} className={`w-2 rounded-t-sm ${index%2?'bg-[#8b7cf6]/35':'bg-[#2fd1c5]/40'}`} style={{height:`${height*100}%`}}/>)}</div></article>)}</div>
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
        {[{label:"计划经营账号",value:display.totals.accountCount,note:`其中 ${connectedTargets.length} 个已连接`},{label:"发布版本",value:display.totals.versionCount,note:`${display.totals.originalCount} 条原创母版`},{label:"需要处理",value:Math.max(cycleAttention,display.totals.blockedCount),note:Math.max(cycleAttention,display.totals.blockedCount)?"审批、异常或人工接管":"当前无阻塞"},{label:"本周预算",value:display.totals.budgetMaxCny?`¥${display.totals.budgetMinCny.toFixed(0)}–${display.totals.budgetMaxCny.toFixed(0)}`:"待核算",note:`${display.totals.versionCount} 个发布版本`}].map(item=><article key={item.label} className="rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3"><p className="text-[10px] font-bold text-slate-400">{item.label}</p><p className="mt-1 text-xl font-black text-slate-950">{item.value}</p><p className="mt-1 text-[10px] text-slate-500">{item.note}</p></article>)}
      </div>
      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100">
        {monitoredAccounts.slice(0, 8).map((account,index)=><div key={`${account.platform}-${account.accountId}`} className={`grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_120px_160px] sm:items-center ${index?"border-t border-slate-100":""}`}><div className="min-w-0"><p className="truncate text-xs font-black text-slate-800">{account.accountLabel}</p><p className="mt-0.5 truncate text-[10px] text-slate-500">{platformLabels[account.platform]} · {account.positioning} · {account.source === "connected" ? "已连接" : "计划账号"}</p></div><p className="text-[10px] font-bold text-slate-600">分配 {account.plannedCount} 个发布版本</p><p className="text-[10px] font-bold text-slate-600">{typeof account.budgetCny === "number" && account.budgetCny>0?`预算 ¥${account.budgetCny.toFixed(2)}`:"成本计入母版"}</p></div>)}
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
  { label: "编导结论与经营排期", owner: "编导 Agent → 经营 Agent", duration: "约 60 分钟", color: "bg-violet-100 text-violet-800 ring-violet-200" },
  { label: "内容制作", owner: "内容 Agent", duration: "约 5 小时", color: "bg-sky-100 text-sky-800 ring-sky-200" },
  { label: "质检与发布", owner: "内容 Agent · 质检能力 / 经营 Agent", duration: "约 35 分钟", color: "bg-emerald-100 text-emerald-800 ring-emerald-200" },
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
              <span title="编导 Agent 分析爆款并完成脚本、分镜；经营 Agent 根据结论制定详细选题和排期，预计约 60 分钟" className={`z-10 m-1.5 flex min-w-0 items-center rounded-lg px-2 text-[8px] font-black ring-1 ${matrixScheduleStages[0].color}`} style={{ gridColumn: `${directorStart + 1} / span 1`, gridRow: 1 }}>编导 → 经营 · 60m</span>
              <span title="内容 Agent：根据已确认脚本和分镜完成素材、配音、剪辑与渲染，预计约 5 小时" className={`z-10 m-1.5 flex min-w-0 items-center rounded-lg px-2 text-[8px] font-black ring-1 ${matrixScheduleStages[1].color}`} style={{ gridColumn: `${productionStart + 1} / span ${productionSpan}`, gridRow: 1 }}>内容制作 · 约 5h</span>
              <span title="内容 Agent · 质检能力完成质量检查，经营 Agent 确认发布，合计预计约 35 分钟" className={`z-10 m-1.5 flex min-w-0 items-center rounded-lg px-2 text-[8px] font-black ring-1 ${planBlocked ? "bg-amber-100 text-amber-800 ring-amber-200" : matrixScheduleStages[2].color}`} style={{ gridColumn: `${publishIndex + 1} / span 1`, gridRow: 1 }}>{planBlocked ? "补齐后质检" : "质检 / 发布"}</span>
            </div>
          </div>;
        })}{!scheduleRows.length&&<div className="px-6 py-16 text-center"><CalendarRange size={28} className="mx-auto text-slate-300"/><p className="mt-3 text-sm font-black text-slate-600">还没有账号内容排期</p><p className="mt-1 text-xs text-slate-400">先在本周计划中确认账号和内容数量，再生成具体制作任务。</p></div>}</div>
        <div className="flex flex-wrap items-center gap-3 bg-slate-50 px-5 py-3 text-[9px] font-bold text-slate-400"><span>排期规则：编导结论先完成，经营 Agent 再派发内容任务；卡点任务不会进入质检和发布。</span><span className="ml-auto">实际发布仍以发布日历、账号授权和最终验收为准。</span></div>
      </div>
    </div>
  </section>;
}

function MatrixView({ data, onRefresh, onNavigate, onGeneratePlan, selectedAccountId = "", onOpenContent, onOpenProductionProgress, onRetryTask }: {
  data: DigitalEmployeeOverview;
  onRefresh?: () => void;
  onNavigate?: (page: Page) => void;
  onGeneratePlan?: () => void;
  selectedAccountId?: string;
  onOpenContent?: (taskId?: string, socialContentTaskId?: string) => void;
  onOpenProductionProgress?: (taskId: string, contentItemId: string) => void;
  onRetryTask?: (taskId: string) => Promise<boolean>;
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
  const display = useMemo(() => buildSmartBusinessDisplayModel(data), [data]);
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
    const plannedAccount = saved?.operatingContext?.accounts.find(item => item.accountId === row.accountId);
    const planCount = productionPlans.filter(plan => plan.matrix?.accountId === row.accountId).length;
    return {
    ...row,
    cta: enterprisePrimaryCta || row.cta,
    connected: row.connected !== false && Boolean(target),
    weeklyCount: planCount || plannedAccount?.contentCount || row.weeklyCount,
    accountLabel: plannedAccount?.accountLabel || target?.accountLabel || `${platformLabels[row.platform]} · ${matrixRoleLabel[row.accountRole || "brand_combined"]}`,
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
  })), [config, enterprisePrimaryCta, productionPlans, profile.accounts, rows, saved?.operatingContext?.accounts]);
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
    <MatrixWorkSchedule taskItems={data.contentQueue?.items} onOpenTask={onOpenProductionProgress} startsAt={goal?.startsAt} endsAt={goal?.endsAt} accounts={accountRows} plans={productionPlans} selectedAccountId={selectedAccountId} onOpenPublishing={() => onNavigate?.("traffic")}/>
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">账号配置</p><h2 className="mt-1 text-2xl font-black text-slate-950">账号职责与连接状态</h2><p className="mt-1 text-sm text-slate-500">内容任务已统一放入上方工作排期；这里仅保留账号定位、承接能力和对标配置。</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => onNavigate?.("plugins")} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-700">管理连接账号</button>{editable&&<button type="button" disabled={saving} onClick={() => void synchronizePackage()} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-black text-emerald-800 disabled:opacity-50"><RefreshCcw size={14} className={saving ? "animate-spin" : ""}/>按矩阵同步周任务包</button>}{editable&&<button type="button" onClick={() => { setDraft(saved || null); setEditing(true); }} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-black text-white"><Pencil size={14}/>修改矩阵</button>}</div>
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
    <ContentGenerationProgress data={data} selectedAccountId={selectedAccountId} onOpenContent={onOpenContent} onOpenProductionProgress={onOpenProductionProgress} onRetryTask={onRetryTask}/>
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

type QueuePerformance = {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  interactions: number | null;
  engagementRate: number | null;
  hasPlatformData: boolean;
};

const DAY_MS = 86_400_000;

function shiftIsoDate(value: string, days: number) {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) ? new Date(time + days * DAY_MS).toISOString().slice(0, 10) : "";
}

function deliveryNumber(card: DeliveryResource, pattern: RegExp) {
  const value = card.metrics.find(metric => pattern.test(metric.label))?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function performanceForQueueItem(item: ContentQueueItem, deliveries: DeliveryResource[]): QueuePerformance {
  const ids = new Set([item.taskId, item.socialContentTaskId, item.contentId].filter(Boolean));
  const related = deliveries.filter(card => ids.has(card.taskId) || card.taskIds.some(id => ids.has(id)));
  const sum = (pattern: RegExp) => {
    const values = related.map(card => deliveryNumber(card, pattern)).filter((value): value is number => value !== null);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  const views = sum(/播放|浏览|观看|view/i) ?? sum(/曝光|reach/i);
  const likes = sum(/点赞|like/i);
  const comments = sum(/评论|comment/i);
  const shares = sum(/分享|share/i);
  const saves = sum(/收藏|save/i);
  const interactionValues = [likes, comments, shares, saves].filter((value): value is number => value !== null);
  const interactions = interactionValues.length ? interactionValues.reduce((total, value) => total + value, 0) : null;
  return {
    views, likes, comments, shares, saves, interactions,
    engagementRate: views && interactions !== null ? interactions / views * 100 : null,
    hasPlatformData: views !== null || interactions !== null,
  };
}

function ContentGenerationProgress({ data, selectedAccountId = "", onOpenContent, onOpenProductionProgress, onRetryTask }: {
  data: DigitalEmployeeOverview;
  selectedAccountId?: string;
  onOpenContent?: (taskId?: string, socialContentTaskId?: string) => void;
  onOpenProductionProgress?: (taskId: string, contentItemId: string) => void;
  onRetryTask?: (taskId: string) => Promise<boolean>;
}) {
  const items = (data.contentQueue?.items || []).filter(item => !selectedAccountId || item.accountId === selectedAccountId);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "waiting_review" | "blocked" | "completed">("all");
  const [page, setPage] = useState(1);
  const [retryingTaskId, setRetryingTaskId] = useState("");
  const filtered = items.filter(item => statusFilter === "all"
    || statusFilter === "active" && ["planned", "queued", "producing"].includes(item.status)
    || item.status === statusFilter);
  const pageSize = 6;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => setPage(1), [statusFilter, selectedAccountId]);
  useEffect(() => setPage(current => Math.min(current, totalPages)), [totalPages]);
  const statusLabel = { planned: "计划已生成", queued: "等待制作", producing: "制作中", waiting_review: "待验收", completed: "已完成", blocked: "制作受阻" } as const;
  const statusTone = { planned: "bg-slate-100 text-slate-700", queued: "bg-sky-50 text-sky-700", producing: "bg-blue-50 text-blue-700", waiting_review: "bg-amber-50 text-amber-700", completed: "bg-emerald-50 text-emerald-700", blocked: "bg-red-50 text-red-700" } as const;
  const retry = async (item: ContentQueueItem) => {
    if (!onRetryTask || !item.taskId || retryingTaskId) return;
    setRetryingTaskId(item.taskId);
    try {
      if (await onRetryTask(item.taskId)) showActionSuccess("任务已从失败节点重新生成", "已完成的素材和结果不会被覆盖。");
    } finally { setRetryingTaskId(""); }
  };
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="content-generation-progress-title">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">逐视频生产</p><h2 id="content-generation-progress-title" className="mt-1 text-xl font-black text-slate-950">每条视频生成进度</h2><p className="mt-1 text-xs text-slate-500">账号矩阵决定发布节奏；这里继续追踪每条视频当前节点、责任 Agent、预计时间和失败重试。</p></div><select aria-label="生成进度状态" value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black text-slate-700"><option value="all">全部状态</option><option value="active">制作中</option><option value="waiting_review">待验收</option><option value="blocked">异常任务</option><option value="completed">已完成</option></select></div>
    <div className="mt-4 grid gap-3 lg:grid-cols-2">{pageItems.map(item => { const currentStep = item.steps.find(step => step.state === "active") || item.steps.find(step => step.state !== "done") || item.steps.at(-1); return <article key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><SocialPlatformIcon platform={item.platform} size={15}/><span className="text-[9px] font-black text-emerald-700">{platformLabels[item.platform]}</span><span className={`rounded-full px-2 py-1 text-[8px] font-black ${statusTone[item.status]}`}>{statusLabel[item.status]}</span><span className="text-[9px] text-slate-400">{item.plannedPublishDate || "待排期"}</span></div><h3 className="mt-2 truncate text-sm font-black text-slate-950">{item.title}</h3><p className="mt-1 truncate text-[10px] text-slate-500">{item.accountLabel || "仅制作"} · {item.productName || "待绑定产品"}</p></div><strong className="shrink-0 text-sm text-slate-800">{item.progress}%</strong></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className={`h-full rounded-full ${item.status === "blocked" ? "bg-red-500" : item.status === "completed" ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${item.progress}%` }}/></div><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-[9px] font-bold text-slate-500">{currentStep ? `${currentStep.responsibleAgent} · ${currentStep.label} · ${productionDurationLabel(currentStep.estimatedMinutes)}` : "等待经营 Agent 派发"}</p><div className="flex gap-2">{item.status === "blocked" && onRetryTask && item.taskId&&<button type="button" disabled={retryingTaskId === item.taskId} onClick={()=>void retry(item)} className="rounded-lg bg-amber-400 px-2.5 py-1.5 text-[9px] font-black text-amber-950 disabled:opacity-40">{retryingTaskId === item.taskId ? "重试中…" : "重新生成"}</button>}{onOpenProductionProgress&&<button type="button" onClick={()=>onOpenProductionProgress(item.taskId,item.id)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[9px] font-black text-slate-700">查看完整进度</button>}<button type="button" onClick={()=>onOpenContent?.(item.taskId||undefined,item.socialContentTaskId||undefined)} className="rounded-lg bg-slate-950 px-2.5 py-1.5 text-[9px] font-black text-white">进入制作台</button></div></div>{item.reason&&<p className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-[9px] font-bold text-red-700">{item.reason}</p>}</article>;})}</div>
    {!filtered.length&&<div className="mt-4 rounded-2xl border border-dashed border-slate-200 px-5 py-12 text-center"><Clapperboard size={24} className="mx-auto text-slate-300"/><p className="mt-2 text-xs font-bold text-slate-500">当前筛选下没有视频任务</p></div>}
    {totalPages>1&&<nav aria-label="生成进度分页" className="mt-4 flex items-center justify-between"><p className="text-[9px] font-bold text-slate-400">第 {page}/{totalPages} 页 · {filtered.length} 条</p><div className="flex gap-2"><button type="button" disabled={page===1} onClick={()=>setPage(current=>Math.max(1,current-1))} className="rounded-lg border border-slate-200 px-3 py-1.5 text-[9px] font-black disabled:opacity-40">上一页</button><button type="button" disabled={page===totalPages} onClick={()=>setPage(current=>Math.min(totalPages,current+1))} className="rounded-lg border border-slate-200 px-3 py-1.5 text-[9px] font-black disabled:opacity-40">下一页</button></div></nav>}
  </section>;
}

function QueueView({ data, onRefresh, onNavigate, onGenerateDetails, selectedAccountId = "", onOpenContent, onOpenProductionProgress, onControlJob, onRetryTask }: { data: DigitalEmployeeOverview; onRefresh?: () => void; onNavigate?: (page: Page) => void; onGenerateDetails?: () => void; selectedAccountId?: string; onOpenContent?: (taskId?: string, socialContentTaskId?: string) => void; onOpenProductionProgress?: (taskId: string, contentItemId: string) => void; onControlJob?: (jobId: string, action: ExecutionControlAction) => Promise<boolean>; onRetryTask?: (taskId: string) => Promise<boolean> }) {
  const projection = data.contentQueue;
  const display = useMemo(() => buildSmartBusinessDisplayModel(data), [data]);
  const snapshot = data.businessSnapshot;
  const cycleStart = display.startsAt || snapshot?.range.startsAt || "";
  const cycleEnd = display.endsAt || snapshot?.range.endsAt || "";
  const [periodFilter, setPeriodFilter] = useState<"current" | "previous" | "30d" | "all">("current");
  const [platformFilter, setPlatformFilter] = useState<"all" | Platform>("all");
  const periodBounds = periodFilter === "current" ? { start: cycleStart, end: cycleEnd }
    : periodFilter === "previous" ? { start: shiftIsoDate(cycleStart, -7), end: shiftIsoDate(cycleStart, -1) }
      : periodFilter === "30d" ? { start: shiftIsoDate(cycleEnd || new Date().toISOString().slice(0, 10), -29), end: cycleEnd || new Date().toISOString().slice(0, 10) }
        : { start: "", end: "" };
  const filteredItems = display.contents.filter(item => {
    const periodMatch = !periodBounds.start || !periodBounds.end || !item.plannedPublishDate
      ? periodFilter === "all" || !item.plannedPublishDate || periodFilter === "current"
      : item.plannedPublishDate >= periodBounds.start && item.plannedPublishDate <= periodBounds.end;
    const platformMatch = platformFilter === "all" || item.platform === platformFilter;
    return periodMatch && platformMatch;
  }).sort((left, right) => right.plannedPublishDate.localeCompare(left.plannedPublishDate));
  const totalViews = display.totals.views;
  const totalInteractions = display.totals.interactions;
  const publishedVideos = display.totals.publishedCount;
  const averageViews = display.totals.versionCount ? Math.round(totalViews / display.totals.versionCount) : 0;
  const engagementRate = display.totals.engagementRate;
  const platformRows = display.platforms;
  const ranking = filteredItems
    .sort((left, right) => right.metrics.views + right.metrics.interactions * 10 - (left.metrics.views + left.metrics.interactions * 10))
    .slice(0, 8);
  const demoTrend = Array.from({ length: 7 }, (_, index) => ({
    date: cycleStart ? shiftIsoDate(cycleStart, index) : `D${index + 1}`,
    views: Math.round(totalViews * [0.08, 0.11, 0.13, 0.12, 0.16, 0.18, 0.22][index]),
  }));
  const trend = snapshot?.social.dailyTrend.length ? snapshot.social.dailyTrend.slice(-14) : demoTrend;
  const trendSource: DisplayMetricSource = snapshot?.social.dailyTrend.length ? "real" : "demo";
  const periodOptions = [
    { id: "current", label: "本周期" }, { id: "previous", label: "上周期" }, { id: "30d", label: "近 30 天" }, { id: "all", label: "全部" },
  ] as const;

  void onRefresh;
  void onNavigate;
  void onGenerateDetails;
  void onOpenContent;
  void onControlJob;
  void onRetryTask;
  return <div className="space-y-5">
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm" aria-labelledby="video-overview-title">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
        <div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">内容队列</p><h2 id="video-overview-title" className="mt-1 text-2xl font-black text-slate-950">视频内容数据概览</h2><p className="mt-1 text-sm text-slate-500">内容数量与当前周计划一致；平台尚未回传的数据使用演示指标，并明确标记。</p></div>
        <div className="flex items-center gap-2"><PlanDataSourceBadge source={display.totals.performanceSource}/><span className="rounded-full bg-slate-100 px-3 py-1.5 text-[10px] font-black text-slate-600">{cycleStart && cycleEnd ? `${cycleStart} 至 ${cycleEnd}` : "等待统计周期"}</span></div>
      </header>
      <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "视频播放量", value: totalViews.toLocaleString("zh-CN"), note: display.totals.performanceSource === "real" ? "已连接账号回传" : "本周 18 个版本演示预估" },
          { label: "互动总数", value: totalInteractions.toLocaleString("zh-CN"), note: `互动率 ${engagementRate.toFixed(2)}%` },
          { label: "已发布视频", value: `${publishedVideos} 条`, note: `本周计划 ${display.totals.versionCount} 条` },
          { label: "平均播放/版本", value: averageViews.toLocaleString("zh-CN"), note: display.totals.performanceSource === "real" ? "按回传内容计算" : "演示数据，不作为复盘结论" },
        ].map((metric, index) => <article key={metric.label} className="bg-white px-5 py-5"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-black text-slate-400">{metric.label}</p><span className={`h-2.5 w-2.5 rounded-full ${index === 0 ? "bg-blue-500" : index === 1 ? "bg-cyan-400" : index === 2 ? "bg-emerald-500" : "bg-violet-500"}`}/></div><p className="mt-3 text-2xl font-black text-slate-950">{metric.value}</p><p className="mt-1 text-[10px] text-slate-400">{metric.note}</p></article>)}
      </div>
      <div className="border-t border-slate-100 px-5 py-4 sm:px-6"><div className="flex h-16 items-end gap-1" aria-label="视频播放趋势">{trend.map(point => { const max = Math.max(...trend.map(item => item.views || 0), 1); return <span key={point.date} title={`${point.date} · 播放 ${point.views ?? "—"}`} className="min-w-2 flex-1 rounded-t bg-emerald-200 transition hover:bg-emerald-500" style={{ height: `${Math.max(8, (point.views || 0) / max * 100)}%` }}/>; })}</div><div className="mt-2 flex items-center justify-between gap-2"><p className="text-[10px] text-slate-400">最近 {trend.length} 个数据日 · 悬停查看播放量</p><PlanDataSourceBadge source={trendSource}/></div></div>
    </section>

    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="platform-performance-title">
      <div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">分平台数据</p><h2 id="platform-performance-title" className="mt-1 text-xl font-black text-slate-950">各平台的视频表现</h2><p className="mt-1 text-xs text-slate-500">点击平台卡片，下面的内容明细与热度榜会同步筛选。</p></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{platformRows.map(row => <button key={row.platform} type="button" aria-pressed={platformFilter === row.platform} onClick={() => setPlatformFilter(current => current === row.platform ? "all" : row.platform)} className={`rounded-2xl border p-4 text-left transition ${platformFilter === row.platform ? "border-emerald-500 bg-emerald-50 shadow-sm" : "border-slate-200 bg-white hover:border-emerald-200"}`}><div className="flex items-center justify-between"><span className="flex items-center gap-2 text-xs font-black text-slate-900"><SocialPlatformIcon platform={row.platform} size={17}/>{platformLabels[row.platform]}</span><span className="flex items-center gap-2"><span className="text-[9px] font-bold text-slate-400">计划 {row.plannedCount} 条</span><PlanDataSourceBadge source={row.source}/></span></div><p className="mt-4 text-xl font-black text-slate-950">{row.views.toLocaleString("zh-CN")}</p><div className="mt-1 flex items-center justify-between text-[10px] text-slate-400"><span>播放量</span><span>互动率 {row.engagementRate.toFixed(2)}%</span></div></button>)}</div>
    </section>

    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm" aria-labelledby="video-heat-ranking-title">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-100 bg-slate-950 px-5 py-5 text-white sm:px-6">
        <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400 text-amber-950"><Trophy size={18}/></span><div><p className="text-[9px] font-black uppercase tracking-[.16em] text-emerald-300">Video ranking</p><h2 id="video-heat-ranking-title" className="mt-1 text-base font-black">视频热度榜单</h2><p className="mt-1 text-[10px] text-slate-300">榜单严格对应本周 {display.totals.versionCount} 个发布版本；没有回传的条目展示演示指标。</p></div></div>
        <div className="flex flex-wrap items-center gap-2"><nav aria-label="榜单时间周期" className="flex flex-wrap gap-1.5">{periodOptions.map(option => <button key={option.id} type="button" aria-pressed={periodFilter === option.id} onClick={() => setPeriodFilter(option.id)} className={`rounded-full border px-3 py-1.5 text-[10px] font-black ${periodFilter === option.id ? "border-white bg-white text-slate-950" : "border-white/20 bg-white/5 text-slate-200"}`}>{option.label}</button>)}</nav>{platformFilter !== "all"&&<button type="button" onClick={() => setPlatformFilter("all")} className="rounded-full border border-emerald-300/40 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-black text-emerald-200">清除平台筛选</button>}</div>
      </header>
      <div className={`border-b px-5 py-3 text-[10px] sm:px-6 ${projection?.sourceStatus === "available" ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-violet-200 bg-violet-50 text-violet-800"}`}><strong>当前周计划已统一</strong><span className="ml-2">{display.totals.originalCount} 条母版裂变为 {display.totals.versionCount} 个平台版本；演示指标不会写入真实复盘。</span></div>
      {ranking.length ? <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">{ranking.map((entry, index) => <button key={entry.id} type="button" onClick={() => entry.queueItem ? onOpenProductionProgress?.(entry.queueItem.taskId, entry.queueItem.id) : onNavigate?.("socialInspiration")} className="grid min-w-0 grid-cols-[32px_minmax(0,1fr)] gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-emerald-300 hover:shadow-sm"><span className={`flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-black ${index < 3 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500"}`}>{index + 1}</span><div className="min-w-0"><div className="flex items-start justify-between gap-2"><p className="line-clamp-2 min-h-8 text-xs font-black leading-4 text-slate-900">{entry.title}</p><PlanDataSourceBadge source={entry.metrics.source}/></div><p className="mt-2 flex items-center gap-1 truncate text-[9px] text-slate-400"><SocialPlatformIcon platform={entry.platform} size={11}/>{entry.accountLabel}</p><div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3"><span className="inline-flex items-center gap-1 text-xs font-black text-slate-900"><Eye size={12}/>{entry.metrics.views.toLocaleString("zh-CN")}</span><span className="text-[9px] text-slate-400">互动 {entry.metrics.interactions}</span></div></div></button>)}</div> : <div className="px-5 py-14 text-center"><TrendingUp size={26} className="mx-auto text-slate-300"/><p className="mt-3 text-xs font-black text-slate-600">当前周计划还没有视频内容</p></div>}
    </section>

    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm" aria-labelledby="content-monitoring-title">
      <header className="border-b border-slate-100 px-5 py-5 sm:px-6"><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">账号数据与评论</p><h2 id="content-monitoring-title" className="mt-1 text-xl font-black text-slate-950">内容监控</h2><p className="mt-1 text-xs text-slate-500">原“内容监控”页已合并到这里，可继续查看真实账号数据、评论商机与回复处理。</p></header>
      <AccountActivity embedded/>
    </section>
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
  const contentPlan = item.contentPlan || {
    summary: `${item.route === "clone" ? "爆款结构复刻" : item.route === "material" ? "现有素材再创作" : "产品内容制作"} · ${item.languages.join(" / ").toUpperCase() || "语言待确认"} · ${item.outputSummary.formats[0] || "短视频"}`,
    source: "confirmed" as const,
    deliverBy: item.plannedPublishDate,
    publishAt: item.plannedPublishDate,
    estimatedMinutes: item.steps.reduce((sum, step) => sum + step.estimatedMinutes, 0),
  };
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

    <section aria-label="内容方案与交付时间" className="overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-emerald-100 bg-emerald-50/70 px-5 py-4 sm:px-6">
        <div><p className="text-[10px] font-black uppercase tracking-[.14em] text-emerald-700">Delivery promise</p><h3 className="mt-1 text-base font-black text-slate-950">内容方案与交付时间</h3></div>
        <span className={`rounded-full px-2.5 py-1 text-[9px] font-black ${contentPlan.source === "system_default" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{contentPlan.source === "system_default" ? "系统默认 · 可调整" : "已确认"}</span>
      </header>
      <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["内容方案", contentPlan.summary],
          ["预计制作工期", productionDurationLabel(contentPlan.estimatedMinutes)],
          ["交付与发布时间", contentPlan.deliverBy || contentPlan.publishAt || "待确认"],
          ["发布账号", item.accountLabel ? `${platformLabels[item.platform]} · ${item.accountLabel}` : "仅制作，不自动发布"],
        ].map(([label, value]) => <article key={label} className="min-w-0 bg-white px-5 py-4"><p className="text-[9px] font-bold text-slate-400">{label}</p><p className="mt-1 break-words text-xs font-black leading-5 text-slate-800">{value}</p></article>)}
      </div>
    </section>

    {item.preproduction&&<section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div><p className="text-[10px] font-black uppercase tracking-[.14em] text-violet-700">Pre-production</p><h3 className="mt-1 text-base font-black text-slate-950">开始制作前锁定的双预览</h3></div><TaskPreviewCards item={item} onNavigate={onNavigate}/></section>}

    {executionJob&&<section className={`rounded-2xl border px-4 py-4 ${executionJob.status === "blocked" || executionJob.status === "dead_letter" ? "border-red-200 bg-red-50" : executionJob.status === "reconciling" || executionJob.status === "retry_wait" ? "border-amber-200 bg-amber-50" : "border-blue-100 bg-blue-50"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[9px] font-black ${executionStatusTone[executionJob.status]}`}>{executionStatusLabel[executionJob.status]}</span><p className="text-xs font-black text-slate-900">后台执行状态</p></div><p className="mt-2 text-xs leading-5 text-slate-700">{executionJob.publicReason}</p><p className="mt-1 text-[10px] text-slate-500">{executionWaitingLabel(executionJob)}</p></div><div className="text-left sm:text-right"><p className="text-[9px] font-bold text-slate-400">自动尝试</p><p className="mt-1 text-sm font-black text-slate-800">{executionJob.attempt}/{executionJob.maxAttempts}</p></div></div></section>}

    {item.reason&&<section role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-4"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600"/><div><p className="text-xs font-black text-red-800">当前任务需要处理</p><p className="mt-1 text-xs leading-5 text-red-700">{item.reason}</p><p className="mt-1 text-[10px] text-red-600">已完成的制作结果会保留；上面的系统默认产品、账号和时间可以进入制作台调整。</p></div></section>}

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
  const display = useMemo(() => buildSmartBusinessDisplayModel(data), [data]);
  const selectedTarget = data.config?.publishingTargets.find(target => target.accountId === selectedAccountId);
  const [platform, setPlatform] = useState<Platform>(selectedTarget?.platform || display.accounts[0]?.platform || "youtube");
  const [performance, setPerformance] = useState<ConnectedSocialPerformance | null>(null);
  const [performanceBusy, setPerformanceBusy] = useState(true);
  const [performanceError, setPerformanceError] = useState("");
  const deliveries = data.deliveries || [];
  const review = data.review;
  const reviewSummary = review?.summary;
  const liveReview = data.liveReview;
  const reviewQueue = data.contentQueue?.items.filter(item => item.origin === "weekly_plan" && (!selectedAccountId || item.accountId === selectedAccountId)) || [];
  const settledReviewItems = reviewQueue.filter(item => item.settledCostCny !== null);
  const settledReviewCost = settledReviewItems.reduce((sum,item)=>sum+Number(item.settledCostCny||0),0);
  const performanceByAccount = Object.values((performance?.contents || []).reduce<Record<string,{ accountId:string; accountTitle:string; views:number; videos:number }>>((result,item)=>{
    if(item.metrics.views===null)return result;
    const row=result[item.accountId]||{accountId:item.accountId,accountTitle:item.accountTitle,views:0,videos:0};
    row.views+=item.metrics.views;row.videos+=1;result[item.accountId]=row;return result;
  },{})).sort((left,right)=>right.views-left.views);

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
    if (target) setPlatform(target.platform);
  }, [data.config?.publishingTargets, selectedAccountId]);

  const liveRanking = (performance?.contents || [])
    .filter(item => item.platform === platform && item.metrics.views !== null)
    .map(item => ({ id:item.id,title:item.title,subject:`${item.accountTitle} · 内容监控`,accountId:item.accountId,views:item.metrics.views || 0,likes:item.metrics.likes,comments:item.metrics.comments }))
    .sort((left,right)=>right.views-left.views);
  const planRanking = display.contents
    .filter(item => item.platform === platform)
    .map(item => ({ id:item.id,title:item.title,subject:`${item.accountLabel} · 本周计划`,accountId:item.accountId,views:item.metrics.views,likes:item.metrics.likes,comments:item.metrics.comments,source:item.metrics.source }))
    .sort((left,right)=>right.views-left.views);
  const fallbackRanking = deliveries
    .filter(card => deliveryPlatform(card) === platform && deliveryMetric(card, /播放|浏览|view/i) !== null)
    .map(card => ({id:card.id,title:card.title,subject:`${card.subject} · 经营交付记录`,accountId:"",views:deliveryMetric(card,/播放|浏览|view/i)||0,likes:null,comments:null,source:"real" as const}))
    .sort((left,right)=>right.views-left.views);
  const ranking = liveRanking.length
    ? liveRanking.map(item => ({ ...item, source: "real" as const }))
    : fallbackRanking.length ? fallbackRanking : planRanking;
  const reviewMetricSource: DisplayMetricSource = liveRanking.length || fallbackRanking.length ? "real" : "demo";
  const useDemoReview = review?.status !== "generated";
  const demoTotal = Math.max(1, display.totals.versionCount || 18);
  const demoCompleted = Math.min(demoTotal, Math.max(1, Math.round(demoTotal * 0.72)));
  const realIndustryTrends: NextRoundRecommendations["industryTrends"] = data.industryTrends || reviewSummary?.nextRoundRecommendations?.industryTrends || {
    status: "waiting", signals: [], systemActions: ["等待可追溯的社媒热点来源，不生成无来源行业结论"],
  };
  const demoTags = [...new Set(realIndustryTrends.signals.flatMap(signal => signal.tags))].slice(0, 6);
  const demoContent = display.contents[0];
  const demoRecommendations: NextRoundRecommendations = {
    contentInheritance: {
      status: "ready", sourceContentId: demoContent?.contentId || "demo", title: demoContent?.title || "本周首条产品视频", platform: demoContent?.platform || platform,
      hook: "演示：前三秒直接呈现买家问题与产品证据", framework: ["买家问题", "产品证据", "行动引导"], tags: demoTags, sourceUrl: "",
      reason: "演示复盘：该内容在示例数据中的播放与互动综合得分最高；真实回传后将自动替换。",
      paidBoost: { status: "not_enough_data", reason: "演示数据不能触发追加投放，需等待真实播放、互动或询盘回流。" },
      systemActions: ["把示例高表现结构带入下一轮候选", "真实数据回流后重新排序", "不自动消耗投放预算"],
    },
    tagAdaptation: {
      status: demoTags.length ? "baseline" : "waiting", publishedTags: demoTags.slice(0, 3), hotTags: demoTags, newTags: [], droppedTags: [], requiresConfirmation: false,
      systemActions: demoTags.length ? ["以真实采集视频的 Tag 建立观察基线", "下周期只比较新增与退出标签", "调整前仍需用户确认"] : ["等待真实热门 Tag 回流"],
    },
    industryTrends: realIndustryTrends,
  };
  const recommendationSummary: WeeklyReviewSummary = reviewSummary ? {
    ...reviewSummary,
    nextRoundRecommendations: reviewSummary.nextRoundRecommendations
      ? { ...reviewSummary.nextRoundRecommendations, industryTrends: realIndustryTrends.status === "available" ? realIndustryTrends : reviewSummary.nextRoundRecommendations.industryTrends }
      : demoRecommendations,
  } : {
    completionRate: demoCompleted / demoTotal * 100, automationRate: 78, approvalRate: 86, handoffRate: 75,
    completedTasks: demoCompleted, totalTasks: demoTotal, failedTasks: 1,
    highlights: ["演示数据，仅用于页面预览"], nextGoalSuggestion: "等待真实复盘后生成", knowledgeCandidates: [],
    nextRoundRecommendations: demoRecommendations,
  };

  return <div>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold tracking-[0.16em] text-emerald-700">数据复盘</p><h2 className="mt-1 text-2xl font-black text-slate-950">账号内容热度排行</h2><p className="mt-1 text-sm text-slate-500">复盘范围固定为当前周计划的 {display.totals.accountCount} 个账号和 {display.totals.versionCount} 个发布版本；缺失回传使用演示指标。</p></div><div className="flex items-center gap-2"><PlanDataSourceBadge source={reviewMetricSource}/><button type="button" disabled={performanceBusy} onClick={() => void refreshPerformance()} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-black text-emerald-800 disabled:opacity-50"><RefreshCcw size={14} className={performanceBusy?"animate-spin":""}/>同步账号数据</button></div></div>
    <div className="mt-5"><NextRoundRecommendationsSection summary={recommendationSummary} demo={useDemoReview} onOpen={(page) => onNavigate?.(page as Page)}/></div>
    <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black tracking-[.14em] text-slate-400">本周复盘</p><h3 className="mt-1 text-base font-black text-slate-950">计划完成与业务回流</h3></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${review?.status==='generated'?'bg-emerald-50 text-emerald-700':'bg-violet-50 text-violet-700'}`}>{review?.status==='generated'?'真实复盘已生成':'演示复盘'}</span></div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">{[
        {label:"完成率",value:useDemoReview?`${Math.round(recommendationSummary.completionRate)}%`:`${Math.round(reviewSummary?.completionRate || 0)}%`},
        {label:"已完成",value:useDemoReview?`${demoCompleted}/${demoTotal}`:`${reviewSummary?.completedTasks || 0}/${reviewSummary?.totalTasks || 0}`},
        {label:"阻塞项",value:useDemoReview?"1":liveReview?.blockedTasks.length??reviewSummary?.failedTasks??0},
        {label:"数据缺口",value:useDemoReview?"2":liveReview?.dataGaps.length??0},
        {label:"周计划内容",value:useDemoReview?`${demoCompleted}/${demoTotal}`:`${display.totals.completedCount}/${display.totals.versionCount}`},
        {label:"账号样本",value:performanceByAccount.length?`${performanceByAccount.reduce((sum,item)=>sum+item.videos,0)} 条`:`${display.totals.accountCount} 个`},
        {label:"已结算制作费",value:settledReviewItems.length?`¥${settledReviewCost.toFixed(2)}`:useDemoReview?`¥${Math.max(0, display.totals.budgetMidCny * .65).toFixed(2)} · 演示`:"待回传"},
      ].map(item=><div key={item.label} className="rounded-xl bg-slate-50 px-3 py-3"><p className="text-[9px] font-bold text-slate-400">{item.label}</p><p className="mt-1 text-lg font-black text-slate-900">{item.value}</p></div>)}</div>
      {liveReview?.dataGaps.length?<p className="mt-3 text-[10px] leading-5 text-amber-700">仍需补齐：{liveReview.dataGaps.slice(0,3).join("；")}。缺失位置暂用演示数据展示，正式复盘不会写入这些演示值。</p>:<p className="mt-3 text-[10px] text-slate-400">真实数据优先；紫色“演示数据”仅用于补齐页面预览，不会进入正式结算或下一轮决策。</p>}
    </section>
    {(Boolean(performanceError)||Boolean(performance?.unavailable.length))&&<div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800"><span>{performanceError||`${performance?.unavailable.length} 个账号暂时无法同步；已保留其他账号的真实数据。`}</span><button type="button" onClick={()=>onNavigate?.("accountManagement")} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[10px] font-black text-amber-900">检查账号授权 →</button></div>}
    <div className="mt-5 border-b border-slate-200"><div className="flex gap-3 overflow-x-auto">{platformOptions.map((item)=><button type="button" key={item} title={platformLabels[item]} aria-label={platformLabels[item]} onClick={()=>setPlatform(item)} aria-pressed={platform===item} className={`flex h-11 w-12 shrink-0 items-center justify-center border-b-2 pb-2 ${platform===item?'border-emerald-700':'border-transparent opacity-45 hover:opacity-75'}`}><SocialPlatformIcon platform={item} size={21}/></button>)}</div></div>
    {ranking.length || performanceBusy ? <section className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white">{ranking.map((card,index)=><article key={card.id} className={`grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-4 p-5 ${index?'border-t border-slate-100':''}`}><span className={`flex h-9 w-9 items-center justify-center rounded-xl text-sm font-black ${index===0?'bg-amber-100 text-amber-800':'bg-slate-100 text-slate-500'}`}>{index+1}</span><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-black text-slate-950">{card.title}</h3><PlanDataSourceBadge source={card.source}/></div><p className="mt-1 truncate text-xs text-slate-400">{card.subject}</p>{(card.likes!==null||card.comments!==null)&&<p className="mt-1 text-[10px] text-slate-400">点赞 {card.likes??"—"} · 评论 {card.comments??"—"}</p>}</div><div className="text-right"><p className="flex items-center gap-1 text-sm font-black text-slate-900"><Eye size={13}/>{card.views.toLocaleString("zh-CN")}</p><p className="mt-1 text-[10px] text-slate-400">播放量</p></div></article>)}{performanceBusy&&!ranking.length&&<div className="flex items-center justify-center gap-2 px-5 py-20 text-sm text-slate-400"><Loader2 size={17} className="animate-spin"/>正在同步账号内容数据</div>}</section> : null}
  </div>;
}

export default function SmartBusinessDashboard({ data, view, selectedAccountId, selectedContentItemId, onRefresh, onNavigate, onGeneratePlan, onGenerateDetails, onOpenContent, onOpenProductionProgress, onBackToQueue, onRetryTask, onControlJob }: { data: DigitalEmployeeOverview; view: SmartBusinessView; selectedAccountId?: string; selectedContentItemId?: string; onRefresh?: () => void; onNavigate?: (page: Page) => void; onGeneratePlan?: () => void; onGenerateDetails?: () => void; onOpenContent?: (taskId?: string, socialContentTaskId?: string) => void; onOpenProductionProgress?: (taskId: string, contentItemId: string) => void; onBackToQueue?: () => void; onRetryTask?: (taskId: string) => Promise<boolean>; onControlJob?: (jobId: string, action: ExecutionControlAction) => Promise<boolean> }) {
  if (view === "matrix") return <MatrixView data={data} selectedAccountId={selectedAccountId} onRefresh={onRefresh} onNavigate={onNavigate} onGeneratePlan={onGeneratePlan} onOpenContent={onOpenContent} onOpenProductionProgress={onOpenProductionProgress} onRetryTask={onRetryTask}/>;
  if (view === "queue") return <QueueView data={data} selectedAccountId={selectedAccountId} onRefresh={onRefresh} onNavigate={onNavigate} onGenerateDetails={onGenerateDetails} onOpenContent={onOpenContent} onOpenProductionProgress={onOpenProductionProgress} onControlJob={onControlJob} onRetryTask={onRetryTask}/>;
  if (view === "production") return <ProductionDetailView data={data} contentItemId={selectedContentItemId} onBack={onBackToQueue} onNavigate={onNavigate} onOpenContent={onOpenContent} onRetryTask={onRetryTask}/>;
  if (view === "review") return <ReviewView data={data} selectedAccountId={selectedAccountId} onNavigate={onNavigate}/>;
  return <HomeView data={data} selectedAccountId={selectedAccountId} onRefresh={onRefresh}/>;
}
