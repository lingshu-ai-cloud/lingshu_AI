import type { AgentCalendarTask } from "./smartBusiness/AgentWeeklyCalendar";
import { Alert, Button, Drawer, Empty, Segmented, Select, Statistic, Table, Tabs, Tag, Timeline } from "antd";
import LsDataChart from "./ui/LsDataChart";
import { LsGradientProgress } from "./ui/LsExperiencePrimitives";
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
  { role: "business", name: "经营 Agent", description: "安排周计划与发布节奏", tint: "from-blue-50 to-white" },
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

  return <Drawer open title={`${agentCard.name} · 生产实况`} onClose={onClose} size={560}>
    <p className="mb-5 text-sm text-text-secondary">{currentTask}</p>
    <div className="grid grid-cols-2 gap-5 border-y border-border py-5">
      <Statistic title="当前进度" value={completed} suffix={`/ ${total}`}/>
      <Statistic title="过去已核算消耗" value={usageLoading && !hasActualSpend ? "读取中…" : hasActualSpend ? actualSpend : "暂无核算"} precision={2} prefix={hasActualSpend ? "¥" : undefined}/>
    </div>
    <p className="mt-3 text-xs text-text-muted">{settledUsage ? `${settledUsage.source} · ${settledUsage.count} 条 · ${dateLabel(settledUsage.updatedAt || undefined)}` : fallbackReceiptCount ? `${fallbackReceiptCount} 条真实费用记录` : "仅在服务返回真实结算后计入"}</p>
    <LsGradientProgress className="my-5" percent={total ? Math.round(completed / total * 100) : 0} status={active ? "active" : "normal"}/>
    <Timeline items={(events.length ? events : tasks.slice().sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))).map(item => ({
      title: dateLabel("summary" in item ? item.occurred_at : item.updated_at),
      content: <div><p className="font-medium">{"summary" in item ? item.summary : item.title}</p><p className="mt-1 text-xs text-text-secondary">{"summary" in item ? item.level : item.status}</p></div>,
    }))}/>
    {!events.length && !tasks.length && <Empty description="还没有可展示的生产记录"/>}
  </Drawer>;
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

function WeeklyRangeVisual({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  const format = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, Math.max(0, month - 1), day));
    const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getUTCDay()] || "";
    return { month: String(month).padStart(2, "0"), day: String(day).padStart(2, "0"), weekday };
  };
  const start = format(startsAt);
  const end = format(endsAt);
  return <div aria-label={`本周排期 ${startsAt} 至 ${endsAt}`} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700">
    <CalendarRange size={14} aria-hidden="true"/>
    <span>{start.weekday} {start.month}/{start.day}</span>
    <span className="text-violet-500" aria-hidden="true">→</span>
    <span>{end.weekday} {end.month}/{end.day}</span>
  </div>;
}

export function WeeklyCommandCenter({
  data,
  statusLabel,
  actions,
  className = "",
}: {
  data: DigitalEmployeeOverview;
  statusLabel: string;
  actions?: ReactNode;
  className?: string;
}) {
  const display = buildSmartBusinessDisplayModel(data);
  const contentQueue = data.contentQueue?.items || [];
  const operatingContext = data.plan?.businessPackage?.operatingContext;
  const packagePlans = data.plan?.businessPackage?.tasks.find(task => task.templateId === "production")?.videoPlans || [];
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

  return <section className={`overflow-hidden rounded-lg border border-border bg-white ${className}`.trim()} aria-label="本周任务驾驶舱">
    <div className="flex flex-wrap items-start justify-between gap-5 border-b border-border px-5 py-5 text-text-primary sm:px-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">周经营计划</h2>
          <Tag color={statusLabel === "执行中" ? "processing" : statusLabel === "待确认" ? "warning" : "default"}>{statusLabel}</Tag>
          {data.goal && (
            <WeeklyRangeVisual startsAt={data.goal.startsAt} endsAt={data.goal.endsAt} />
          )}
        </div>
      </div>
      {actions && <div aria-label="智能经营控制" className="flex max-w-full flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
    <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-6">
      {[
        { label: "原创母版", value: `${plannedOriginalCount} 条`, color: "var(--color-accent)", note: "每条匹配一条不同爆款并只生产一次" },
        { label: "平台版本", value: `${plannedOutputCount} 条`, color: "var(--color-visual-lavender)", note: `${plannedPublishCount} 个发布任务 · ${operatingContext?.accounts.length || 0} 个账号` },
        { label: "母版总时长", value: plannedDurationSeconds > 0 ? `${plannedDurationSeconds} 秒` : "待确认", color: "#0891b2", note: operatingContext?.outputs.formats.join(" / ") || "短视频" },
        { label: "本周成本范围", value: budgetMax > 0 ? `¥${budgetMin.toFixed(0)}–${budgetMax.toFixed(0)}` : "待核算", color: "var(--color-visual-pink)", note: operatingContext ? `中位估算 ¥${operatingContext.budget.totalCny.toFixed(2)} · 平台轻适配已包含` : "按每条母版 ¥10–15 估算" },
        { label: "预计制作成本", value: estimatedContentCost > 0 ? `¥${estimatedContentCost.toFixed(2)}` : "待核算", color: "var(--color-text-primary)", note: manualQueue.length ? `另有 ${manualQueue.length} 条手动单项` : "只统计原创母版，不重复计算适配版" },
        { label: "已结算成本", value: settledContentCost > 0 ? `¥${settledContentCost.toFixed(2)}` : "暂无结算", color: "var(--color-text-primary)", note: "仅统计供应商对账回执" },
      ].map(item => <article key={item.label} className="bg-white px-4 py-4"><Statistic title={item.label} value={item.value} valueStyle={{ color: item.color }}/><p className="mt-2 text-xs text-text-secondary">{item.note}</p></article>)}
    </div>
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-4">
      {[
        ["排队中", weeklyStatusCounts.queued, "bg-sky-50 text-sky-700"],
        ["制作中", weeklyStatusCounts.producing, "bg-blue-50 text-blue-700"],
        ["待验收", weeklyStatusCounts.review, "bg-amber-50 text-amber-700"],
        ["需要处理", weeklyStatusCounts.blocked, "bg-red-50 text-red-700"],
        ["已完成", weeklyStatusCounts.completed, "bg-emerald-50 text-emerald-700"],
      ].map(([label, value, tone]) => <span key={String(label)} className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${tone}`}>{label} {value}</span>)}
      <span className="text-[10px] font-bold text-slate-400 xl:ml-auto">本周发布版本 {display.totals.versionCount} 条 · 另有手动单项 {manualQueue.length} 条</span>
    </div>
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
    startsAt: operatingContext?.cycle?.startsAt || data.goal?.startsAt || "",
    endsAt: operatingContext?.cycle?.endsAt || data.goal?.endsAt || "",
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
  return <Tag color={source === "real" ? "success" : "default"}>{source === "real" ? "真实回传" : "演示数据"}</Tag>;
}

function HomeView({ data, onRefresh, selectedAccountId = "" }: { data: DigitalEmployeeOverview; onRefresh?: () => void; selectedAccountId?: string }) {
  const [monitor, setMonitor] = useState<AgentCard | null>(null);
  const display = useMemo(() => buildSmartBusinessDisplayModel(data), [data]);
  const snapshot = data.businessSnapshot;
  const days = [...new Set(display.contents.map(item => item.plannedPublishDate).filter(Boolean))].sort();
  const adSpend = snapshot?.ads?.spendByCurrency || [];
  const inquiriesAvailable = snapshot?.content.inquiries.status === "available" && snapshot.content.inquiries.value !== null;
  const wonAvailable = snapshot?.customer.won.status === "available" && snapshot.customer.won.value !== null;
  const demoInquiryCount = Math.max(8, Math.round(display.totals.versionCount * 0.65));
  const metrics = [
    { label: "运营平台账号", value: display.totals.accountCount, note: `${display.accounts.filter(item => item.source === "connected").length} 个已连接`, demo: false },
    { label: "获得询盘", value: metricValue(inquiriesAvailable ? snapshot?.content.inquiries.value : demoInquiryCount), note: snapshot?.content.inquiries.note || "等待询盘回传", demo: !inquiriesAvailable },
    { label: "成交客户", value: metricValue(wonAvailable ? snapshot?.customer.won.value : Math.max(1, Math.round(demoInquiryCount * 0.22))), note: "按成交客户记录", demo: !wonAvailable },
    { label: "投流消耗", value: adSpend.length === 1 ? `${adSpend[0].currency} ${adSpend[0].amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}` : adSpend.length > 1 ? `${adSpend.length} 种币种` : "—", note: snapshot?.ads?.note || "等待平台费用回执", demo: false },
  ];
  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4"><h2 className="text-xl font-semibold text-text-primary">经营总览</h2>{onRefresh && <Button icon={<RefreshCcw size={15}/>} onClick={onRefresh}>刷新</Button>}</header>
    <div className="grid divide-y divide-border rounded-lg border border-border bg-white sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4">{metrics.map(item => <div key={item.label} className="border-border p-5 sm:border-r last:border-r-0"><Statistic title={<span>{item.label} {item.demo && <Tag>演示数据</Tag>}</span>} value={item.value}/><p className="mt-2 text-xs text-text-secondary">{item.note}</p></div>)}</div>
    <LsDataChart title="本周计划与完成" description="单位：个发布版本；按计划发布日期归组，完成数为当前已完成状态，不代表该日实际完成量。" kind="line" labels={days} series={[
      { label: "计划版本", values: days.map(day => display.contents.filter(item => item.plannedPublishDate === day).length) },
      { label: "已完成版本", values: days.map(day => display.contents.filter(item => item.plannedPublishDate === day && item.status === "completed").length) },
    ]} unit="条"/>
    <section className="rounded-lg border border-border bg-white p-5"><h2 className="mb-4 text-lg font-semibold">Agent 工作轨道</h2><div className="divide-y divide-border">{agentCards.map(agent => {
      const status = data.agents.find(item => roleAliases[agent.role].includes(item.role)); const tasks = relatedTasks(data, agent.role);
      const latestTask = [...tasks].sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0];
      const live = Boolean(status && runningStatuses.has(status.status)) || tasks.some(task => runningStatuses.has(task.status));
      const taskIds = new Set(tasks.map(item => item.id));
      const latestEvent = [...data.events].filter(item => taskIds.has(item.task_id) || agent.role === "business" && item.type.startsWith("business.")).sort((a, b) => b.sequence - a.sequence)[0];
      const source = latestTask?.business_refs?.length ? `${latestTask.business_refs.length} 条业务记录` : data.plan?.businessPackage ? `本周计划 v${data.plan.businessPackage.revision || 1}` : "等待计划";
      const result = latestEvent?.summary || (status?.completed ? `已完成 ${status.completed}/${status.total} 个节点` : "尚无新结果");
      const next = latestTask?.status === "waiting_approval" ? "等待你确认后继续" : ["failed", "waiting_human"].includes(latestTask?.status || "") ? "处理卡点或从当前节点重试" : live ? "完成当前节点并写回业务页面" : "等待下一项任务";
      return <article key={agent.role} className="grid items-center gap-4 py-4 sm:grid-cols-[150px_minmax(0,1fr)_140px_auto]">
        <div><h3 className="font-semibold">{agent.name}</h3><p className="mt-1 text-xs text-text-secondary">{agent.description}</p></div>
        <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs"><dt className="text-text-secondary">当前节点</dt><dd className="font-medium">{status?.currentTask || latestTask?.title || "等待下一项任务"}</dd><dt className="text-text-secondary">来源</dt><dd>{source}</dd><dt className="text-text-secondary">结果</dt><dd>{result}</dd><dt className="text-text-secondary">下一步</dt><dd>{next}</dd></dl>
        <div><Tag color={live ? "processing" : "default"}>{live ? "执行中" : "未开始"}</Tag><LsGradientProgress percent={status?.total ? Math.round(status.completed / status.total * 100) : 0} size="small" format={() => `${status?.completed || 0}/${status?.total || 0}`}/></div>
        <Button aria-label={`查看${agent.name}详情`} onClick={() => setMonitor(agent)}>查看记录</Button>
      </article>;
    })}</div></section>
    {monitor && <AgentMonitor data={data} agent={monitor} onClose={() => setMonitor(null)}/>}
  </div>;
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


function MatrixView({ calendarTasks, calendarDemo, data, onRefresh, onNavigate, onGeneratePlan, selectedAccountId = "", onOpenContent, onOpenProductionProgress, onRetryTask }: {
  calendarTasks?: AgentCalendarTask[];
  calendarDemo?: boolean;
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
  const weeklyTargetCount = selectedAccounts.reduce((sum, row) => sum + row.weeklyCount, 0);
  const weeklyCompletedCount = display.contents.filter(item => (!selectedAccountId || item.accountId === selectedAccountId) && item.status === "completed").length;
  const weeklyCompletionPercent = weeklyTargetCount ? Math.min(100, Math.round(weeklyCompletedCount / weeklyTargetCount * 100)) : 0;
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
    <MatrixWorkSchedule calendarTasks={calendarTasks} calendarDemo={calendarDemo} taskItems={data.contentQueue?.items} onOpenTask={onOpenProductionProgress} startsAt={goal?.startsAt} endsAt={goal?.endsAt} accounts={accountRows} plans={productionPlans} selectedAccountId={selectedAccountId} onOpenPublishing={() => onNavigate?.("traffic")}/>
    <section aria-label="本周账号更新完成度" className="flex items-center justify-between gap-5 rounded-lg border border-border bg-white px-5 py-4">
      <div><h2 className="text-sm font-semibold text-text-primary">本周账号更新完成度</h2><p className="mt-1 text-xs text-text-secondary">{weeklyCompletedCount}/{weeklyTargetCount} 个平台发布版本已完成</p></div>
      <strong className="shrink-0 bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-4xl font-semibold tracking-tight text-transparent">{weeklyCompletionPercent}%</strong>
    </section>
    <LsDataChart title="账号表现趋势" description="单位：次；需要按账号、日期记录的平台指标快照。当前回执为累计值，不推算为每日增长；请在数据复盘同步账号。" kind="line" labels={[]} series={[{ label: "每日播放量", values: [] }]}/>
    <section className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold tracking-[0.16em] text-blue-600">账号配置</p><h2 className="mt-1 text-2xl font-semibold text-slate-950">账号职责与连接状态</h2></div>
        <div className="flex flex-wrap gap-2"><Button htmlType="button" onClick={() => onNavigate?.("plugins")} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700">管理连接账号</Button>{editable&&<Button htmlType="button" disabled={saving} onClick={() => void synchronizePackage()} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs font-semibold text-blue-700 disabled:opacity-50"><RefreshCcw size={14} className={saving ? "animate-spin" : ""}/>按矩阵同步周任务包</Button>}{editable&&<Button htmlType="button" onClick={() => { setDraft(saved || null); setEditing(true); }} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-xs font-semibold text-zinc-700"><Pencil size={14}/>修改矩阵</Button>}</div>
      </div>
      {message&&<p role="status" className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800">{message}</p>}
      {!rows.length&&<p className="mt-5 rounded-lg border border-dashed border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">还没有已连接账号，当前展示可直接配置的默认账号矩阵。</p>}
      <Table className="mt-5" rowKey="accountId" dataSource={selectedAccounts} pagination={{ pageSize: 6, showSizeChanger: false }} columns={[
        { title: "账号", key: "account", render: (_, row) => <div className="flex items-center gap-2"><SocialPlatformIcon platform={row.platform} size={18}/><div><p className="font-medium">{row.accountLabel}</p><p className="text-xs text-text-secondary">{matrixRoleLabel[row.accountRole || "brand_combined"]}</p></div></div> },
        { title: "连接状态", key: "connected", render: (_, row) => <Tag color={row.connected ? "success" : "warning"}>{row.connected ? "已连接" : "待连接"}</Tag> },
        { title: "周更目标", dataIndex: "weeklyCount", align: "right", sorter: (left, right) => left.weeklyCount - right.weeklyCount },
        { title: "内容方向", dataIndex: "contentDirection", responsive: ["lg"] },
      ]} expandable={{ expandedRowRender: row => {
        const benchmarks = benchmarkAccounts.filter(item => item.platform === row.platform);
        const matchedMessenger = row.platform === "facebook" && connectionStatus.messengerPages.some(page => page.status === "connected" && page.messengerSubscribed && (!row.connected || page.id === row.accountId || page.providerAccountId === row.accountId || page.title === row.accountLabel));
        const checklist = [
          { label: "WhatsApp", value: connectionStatus.loaded ? connectionStatus.whatsapp ? "已挂载" : "未挂载" : "读取中", done: connectionStatus.whatsapp },
          { label: "Messenger", value: row.platform === "facebook" ? connectionStatus.loaded ? matchedMessenger ? "已挂载" : "未挂载" : "读取中" : "不适用", done: matchedMessenger, neutral: row.platform !== "facebook" },
          { label: "企业默认 CTA", value: enterprisePrimaryCta ? "已继承" : "待在企业中心配置", done: Boolean(enterprisePrimaryCta) },
          { label: "对标账号", value: benchmarks.length ? `${benchmarks.length} 个` : "待配置", done: benchmarks.length > 0 },
        ];
        return <article key={row.accountId} className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50/60">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-white p-4"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white"><SocialPlatformIcon platform={row.platform} size={20}/></span><div><p className="text-sm font-semibold text-slate-950">{row.accountLabel}</p><p className="mt-0.5 text-[10px] font-medium text-zinc-500">{platformLabels[row.platform]} · {matrixRoleLabel[row.accountRole || "brand_combined"]} · {row.connected ? "已连接" : "待连接"}</p></div></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-700">本周 {row.weeklyCount} 条</span></div>
          <div className="bg-white p-4"><p className="text-[10px] font-semibold tracking-[0.12em] text-slate-400">账号详情</p><dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2"><div><dt className="font-bold text-slate-400">目标受众</dt><dd className="mt-1 font-semibold leading-5 text-slate-700">{row.audience}</dd></div><div><dt className="font-bold text-slate-400">主推产品</dt><dd className="mt-1 font-semibold leading-5 text-slate-700">{row.productName}</dd></div><div><dt className="font-bold text-slate-400">内容方向</dt><dd className="mt-1 font-semibold leading-5 text-slate-700">{row.contentDirection}</dd></div><div><dt className="font-bold text-slate-400">内容栏目</dt><dd className="mt-1 font-semibold leading-5 text-slate-700">{row.formats?.length ? row.formats.map(format => contentFormatLabels[format] || format).join(" · ") : "待配置"}</dd></div></dl>
              <div className="mt-4"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold tracking-[0.12em] text-slate-400">账号连接与对标完成项</p><span className="text-[10px] font-bold text-emerald-700">{checklist.filter(item => item.done || item.neutral).length}/{checklist.length}</span></div><div className="mt-2 grid gap-2 sm:grid-cols-2">{checklist.map(item => <div key={item.label} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"><span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600">{item.done ? <CheckCircle2 size={13} className="text-emerald-600"/> : <span className={`h-3 w-3 rounded-full border ${item.neutral ? "border-slate-300 bg-slate-100" : "border-amber-400 bg-amber-50"}`}/>} {item.label}</span><span className={`text-[9px] font-semibold ${item.done ? "text-emerald-700" : item.neutral ? "text-slate-400" : "text-amber-700"}`}>{item.value}</span></div>)}</div></div>
              <div className="mt-4"><div className="flex items-center justify-between gap-3"><p className="text-[10px] font-semibold tracking-[0.12em] text-slate-400">对标账号</p><Button htmlType="button" onClick={() => onNavigate?.("socialInspiration")} className="!h-auto min-h-9 !whitespace-normal text-[10px] font-semibold text-blue-600">管理对标账号 →</Button></div>{benchmarks.length ? <div className="mt-2 flex flex-wrap gap-2">{benchmarks.map(item => <span key={item.id} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold text-slate-700">{item.accountName || item.handle || "未命名账号"}</span>)}</div> : <p className="mt-2 text-[11px] text-slate-400">该平台尚未配置对标账号。</p>}</div>
          </div>
        </article>;
      } }}/>
      {!saved&&<div className="mt-5 flex justify-end"><Button type="primary" htmlType="button" onClick={onGeneratePlan} className="ls-brand-action !h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white"><CalendarRange size={14}/>生成周计划并应用矩阵</Button></div>}
      {saved&&!saved.matrixPlan?.length&&defaultRows.length>0&&editable&&<div className="mt-5 flex justify-end"><Button htmlType="button" disabled={saving} onClick={() => void save({ ...saved, matrixPlan: defaultRows })} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"><LayoutGrid size={14}/>应用默认矩阵</Button></div>}
    </section>
    <ContentGenerationProgress data={data} selectedAccountId={selectedAccountId} onOpenContent={onOpenContent} onOpenProductionProgress={onOpenProductionProgress} onRetryTask={onRetryTask}/>
    {editing && draft && config && goal && <Drawer open title="修改账号、内容方向与排期" size={880} onClose={() => !saving && setEditing(false)} mask={{ closable: false }} footer={<div className="flex justify-end gap-2"><Button disabled={saving} onClick={() => setEditing(false)}>取消</Button><Button type="primary" loading={saving} onClick={() => void save(draft)}>保存并更新内容清单</Button></div>}>
      <WeeklyMatrixEditor pack={draft} config={config} platforms={goal.contentPlatforms} startsAt={goal.startsAt} dueAt={goal.endsAt} projects={projects} onChange={setDraft} onNavigate={page => onNavigate?.(page)}/>
    </Drawer>}
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
      { label: "素材组合预览", note: "生成后展示每个镜头将使用的素材，以及缺素材或待拍卡点。", tone: "border-blue-100 bg-blue-50/40" },
    ].map((card, index) => <article key={card.label} className={`rounded-lg border border-dashed p-4 ${card.tone}`}><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-slate-900">{card.label}</p><span className="rounded-full bg-white px-2 py-1 text-[9px] font-semibold text-slate-500">步骤 2 生成</span></div><p className="mt-2 text-[10px] leading-5 text-slate-500">{card.note}</p>{index === 0&&onGenerateDetails&&<Button htmlType="button" onClick={onGenerateDetails} className="!h-auto min-h-9 !whitespace-normal mt-3 rounded-lg bg-slate-950 px-3 py-2 text-[10px] font-semibold text-white">生成两项详细预览</Button>}</article>)}
  </div>;
  const benchmark = preview.benchmark;
  const materials = preview.materials;
  const blocked = !preview.readiness.canStart;
  const effectLabel = preview.confidence.effectLevel === "medium" ? "中" : preview.confidence.effectLevel === "low" ? "低" : "数据不足";
  return <div className="mt-4 grid gap-3 lg:grid-cols-2">
    <article className="overflow-hidden rounded-lg border border-violet-100 bg-violet-50/45">
      <div className="grid min-h-36 grid-cols-[112px_minmax(0,1fr)]">
        <div className="relative flex items-center justify-center overflow-hidden bg-slate-900">{benchmark.thumbnailUrl?<img src={benchmark.thumbnailUrl} alt="爆款参考缩略图" className="h-full w-full object-cover"/>:<Clapperboard size={26} className="text-white/35"/>}<span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-1 text-[8px] font-semibold text-white">爆款视频预览</span></div>
        <div className="min-w-0 p-4"><div className="flex items-center justify-between gap-2"><span className={`rounded-full px-2 py-1 text-[8px] font-semibold ${benchmark.status==='ready'?'bg-violet-100 text-violet-700':'bg-slate-100 text-slate-500'}`}>{benchmark.status==='ready'?'真实参考已绑定':benchmark.status==='not_applicable'?'产品原创':'缺少参考'}</span><span className="text-[9px] font-bold text-slate-400">效果置信度：{effectLabel}</span></div><h4 className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-slate-900">{benchmark.title||item.title}</h4><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-600">{benchmark.hook||"当前没有可核验的爆款参考，不生成虚构预览。"}</p><p className="mt-2 truncate text-[9px] text-violet-700">{[benchmark.account,benchmark.views&&`播放 ${benchmark.views}`].filter(Boolean).join(" · ")||"以编导分镜结构为准"}</p></div>
      </div>
      {benchmark.shotSummary.length>0&&<div className="border-t border-violet-100 px-4 py-3"><p className="line-clamp-2 text-[9px] leading-4 text-slate-600">{benchmark.shotSummary.slice(0,3).join(" · ")}</p></div>}
      <Button htmlType="button" onClick={()=>openTaskPreviewPage(item,"benchmark",onNavigate)} className="!h-auto min-h-9 !whitespace-normal flex w-full items-center justify-between border-t border-violet-100 bg-white/70 px-4 py-2.5 text-[10px] font-semibold text-violet-700"><span>{benchmark.status==='ready'?"打开对应爆款分析":"打开爆款灵感库"}</span><span>→</span></Button>
    </article>
    <article className={`overflow-hidden rounded-lg border ${materials.status==='ready'?'border-zinc-200 bg-white':'border-amber-200 bg-amber-50/55'}`}>
      <div className="p-4"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-900">素材组合预览</p><span className={`rounded-full px-2 py-1 text-[8px] font-semibold ${materials.status==='ready'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-800'}`}>{materials.status==='ready'?`${materials.items.length} 项已锁定`:"任务不能开始"}</span></div>
        {Boolean(materials.storyboard?.length)&&<div className="mt-3"><p className="mb-2 text-[9px] font-semibold text-slate-500">按爆款结构连接的成片首帧</p><div className="flex items-stretch gap-1 overflow-x-auto pb-1">{materials.storyboard!.map((step,index)=>{const matched=materials.items.find(material=>material.id===step.materialId);const previewUrl=step.materialPreviewUrl||step.referenceFirstFrameUrl;return <div key={`${step.materialType}-${step.shotIds.join('-')}`} className="flex shrink-0 items-center gap-1"><div className={`w-24 overflow-hidden rounded-lg border bg-white ${step.status==='ready'?'border-emerald-200':'border-amber-200'}`}><div className="flex aspect-video items-center justify-center overflow-hidden bg-slate-100">{previewUrl?(matched?.type==='video'&&step.materialPreviewUrl?<video src={`${previewUrl}#t=0.1`} muted preload="metadata" className="h-full w-full object-cover"/>:<img src={previewUrl} alt={`${step.materialLabel}首帧`} className="h-full w-full object-cover"/>):<span className="text-[8px] font-semibold text-amber-700">待补素材</span>}</div><div className="px-2 py-1.5"><p className="truncate text-[8px] font-semibold text-slate-700">{step.materialLabel}</p><p className="mt-0.5 truncate text-[7px] text-slate-400">{step.shotIds.length} 镜 · {step.status==='ready'?'已匹配':'待匹配'}</p></div></div>{index<materials.storyboard!.length-1&&<span className="text-xs font-semibold text-emerald-500">→</span>}</div>})}</div></div>}
        {!materials.storyboard?.length&&<div className="mt-3 grid grid-cols-3 gap-2">{materials.items.slice(0,3).map(material=><div key={material.id} className="min-w-0"><div className={`flex aspect-video items-center justify-center overflow-hidden rounded-lg border ${material.status==='ready'?'border-emerald-100 bg-white':'border-amber-200 bg-amber-100'}`}>{material.previewUrl?(material.type==='video'?<video src={`${material.previewUrl}#t=0.1`} muted preload="metadata" className="h-full w-full object-cover"/>:<img src={material.previewUrl} alt="" className="h-full w-full object-cover"/>):material.status==='pending_shoot'?<span className="text-[9px] font-semibold text-amber-700">待拍</span>:<LayoutGrid size={16} className="text-slate-300"/>}</div><p className="mt-1 truncate text-[8px] font-bold text-slate-600">{material.name}</p></div>)}{!materials.items.length&&<div className="col-span-3 flex min-h-16 items-center justify-center rounded-lg border border-dashed border-amber-200 bg-white/70 text-[10px] font-bold text-amber-700">还没有可用素材</div>}</div>}
        {blocked?<div role="alert" className="mt-3 rounded-lg bg-white/80 px-3 py-2 text-[9px] font-bold leading-4 text-amber-800">{preview.readiness.blockers.slice(0,3).join("；")}</div>:<p className="mt-3 text-[9px] leading-4 text-emerald-700">素材、授权和预算检查已通过，可以进入制作。</p>}
      </div>
      <Button htmlType="button" onClick={()=>openTaskPreviewPage(item,"materials",onNavigate)} className={`!h-auto min-h-9 !whitespace-normal flex w-full items-center justify-between border-t bg-white/70 px-4 py-2.5 text-[10px] font-semibold ${materials.status==='ready'?'border-emerald-100 text-emerald-700':'border-amber-200 text-amber-800'}`}><span>{materials.pendingShootTaskIds.length?"打开对应待拍任务":materials.status==='ready'?"打开对应素材":"去补齐素材与授权"}</span><span>→</span></Button>
    </article>
    <div className="lg:col-span-2 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-slate-50 px-4 py-2.5 text-[9px] font-bold text-slate-500"><span>按时完成率：{preview.confidence.onTimeRate===null?"暂无历史样本":`${preview.confidence.onTimeRate}%`}</span><span>内容效果置信度：{effectLabel}</span><span>说明：匹配度不是爆款成功率，发布前不展示虚构概率。</span></div>
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
  return <section className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6" aria-labelledby="content-generation-progress-title">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold tracking-[0.16em] text-blue-600">逐视频生产</p><h2 id="content-generation-progress-title" className="mt-1 text-xl font-semibold text-slate-950">每条视频生成进度</h2></div><Select aria-label="生成进度状态" value={statusFilter} onChange={value => setStatusFilter(value)} className="min-w-36" options={[{ value: "all", label: "全部状态" }, { value: "active", label: "制作中" }, { value: "waiting_review", label: "待验收" }, { value: "blocked", label: "异常任务" }, { value: "completed", label: "已完成" }]}/></div>
    <div className="mt-4 grid gap-3 lg:grid-cols-2">{pageItems.map(item => { const currentStep = item.steps.find(step => step.state === "active") || item.steps.find(step => step.state !== "done") || item.steps.at(-1); return <article key={item.id} className="rounded-lg border border-slate-200 bg-slate-50/50 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><SocialPlatformIcon platform={item.platform} size={15}/><span className="text-[9px] font-semibold text-zinc-500">{platformLabels[item.platform]}</span><span className={`rounded-full px-2 py-1 text-[8px] font-semibold ${statusTone[item.status]}`}>{statusLabel[item.status]}</span><span className="text-[9px] text-slate-400">{item.plannedPublishDate || "待排期"}</span></div><h3 className="mt-2 truncate text-sm font-semibold text-slate-950">{item.title}</h3><p className="mt-1 truncate text-[10px] text-slate-500">{item.accountLabel || "仅制作"} · {item.productName || "待绑定产品"}</p></div><strong className="shrink-0 text-sm text-slate-800">{item.progress}%</strong></div><LsGradientProgress className="mt-3" percent={item.progress} showInfo={false} size="small" status={item.status === "blocked" ? "exception" : item.status === "completed" ? "success" : "active"}/><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-[9px] font-bold text-slate-500">{currentStep ? `${currentStep.responsibleAgent} · ${currentStep.label} · ${productionDurationLabel(currentStep.estimatedMinutes)}` : "等待经营 Agent 派发"}</p><div className="flex gap-2">{item.status === "blocked" && onRetryTask && item.taskId&&<Button htmlType="button" disabled={retryingTaskId === item.taskId} onClick={()=>void retry(item)} className="!h-auto min-h-9 !whitespace-normal rounded-lg bg-amber-400 px-2.5 py-1.5 text-[9px] font-semibold text-amber-950 disabled:opacity-40">{retryingTaskId === item.taskId ? "重试中…" : "重新生成"}</Button>}{onOpenProductionProgress&&<Button htmlType="button" onClick={()=>onOpenProductionProgress(item.taskId,item.id)} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[9px] font-semibold text-slate-700">查看完整进度</Button>}<Button htmlType="button" onClick={()=>onOpenContent?.(item.taskId||undefined,item.socialContentTaskId||undefined)} className="!h-auto min-h-9 !whitespace-normal rounded-lg bg-slate-950 px-2.5 py-1.5 text-[9px] font-semibold text-white">进入制作台</Button></div></div>{item.reason&&<p className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-[9px] font-bold text-red-700">{item.reason}</p>}</article>;})}</div>
    {!filtered.length&&<div className="mt-4 rounded-lg border border-dashed border-slate-200 px-5 py-12 text-center"><Clapperboard size={24} className="mx-auto text-slate-300"/><p className="mt-2 text-xs font-bold text-slate-500">当前筛选下没有视频任务</p></div>}
    {totalPages>1&&<nav aria-label="生成进度分页" className="mt-4 flex items-center justify-between"><p className="text-[9px] font-bold text-slate-400">第 {page}/{totalPages} 页 · {filtered.length} 条</p><div className="flex gap-2"><Button htmlType="button" disabled={page===1} onClick={()=>setPage(current=>Math.max(1,current-1))} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 px-3 py-1.5 text-[9px] font-semibold disabled:opacity-40">上一页</Button><Button htmlType="button" disabled={page===totalPages} onClick={()=>setPage(current=>Math.min(totalPages,current+1))} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 px-3 py-1.5 text-[9px] font-semibold disabled:opacity-40">下一页</Button></div></nav>}
  </section>;
}

function QueueView({ data, onRefresh, onNavigate, onGenerateDetails, selectedAccountId = "", onOpenContent, onOpenProductionProgress, onControlJob, onRetryTask }: { data: DigitalEmployeeOverview; onRefresh?: () => void; onNavigate?: (page: Page) => void; onGenerateDetails?: () => void; selectedAccountId?: string; onOpenContent?: (taskId?: string, socialContentTaskId?: string) => void; onOpenProductionProgress?: (taskId: string, contentItemId: string) => void; onControlJob?: (jobId: string, action: ExecutionControlAction) => Promise<boolean>; onRetryTask?: (taskId: string) => Promise<boolean> }) {
  const display = useMemo(() => buildSmartBusinessDisplayModel(data), [data]);
  const [periodFilter, setPeriodFilter] = useState<"current" | "previous" | "30d" | "all">("current");
  const [platformFilter, setPlatformFilter] = useState<"all" | Platform>("all");
  const cycleStart = display.startsAt || data.businessSnapshot?.range.startsAt || "";
  const cycleEnd = display.endsAt || data.businessSnapshot?.range.endsAt || "";
  const start = periodFilter === "previous" ? shiftIsoDate(cycleStart, -7) : periodFilter === "30d" ? shiftIsoDate(cycleEnd, -29) : periodFilter === "all" ? "" : cycleStart;
  const end = periodFilter === "previous" ? shiftIsoDate(cycleStart, -1) : periodFilter === "all" ? "" : cycleEnd;
  const filteredItems = display.contents.filter(item => (platformFilter === "all" || item.platform === platformFilter) && (!start || !end || !item.plannedPublishDate || item.plannedPublishDate >= start && item.plannedPublishDate <= end));
  const runtimeItems = (data.contentQueue?.items || []).filter(item => (!selectedAccountId || item.accountId === selectedAccountId) && (platformFilter === "all" || item.platform === platformFilter) && (!start || !end || !item.plannedPublishDate || item.plannedPublishDate >= start && item.plannedPublishDate <= end));
  const states = [
    { label: "排队中", keys: ["planned", "queued"] }, { label: "制作中", keys: ["producing"] },
    { label: "待验收", keys: ["waiting_review"] }, { label: "需要处理", keys: ["blocked"] }, { label: "已完成", keys: ["completed"] },
  ];
  const stageDurations = new Map<string, number[]>();
  for (const item of runtimeItems) for (const step of item.steps) {
    if (!step.actualStartedAt || !step.actualFinishedAt) continue;
    const duration = (Date.parse(step.actualFinishedAt) - Date.parse(step.actualStartedAt)) / 60000;
    if (Number.isFinite(duration) && duration >= 0) stageDurations.set(step.label, [...(stageDurations.get(step.label) || []), duration]);
  }
  const durations = [...stageDurations].slice(0, 10);
  const reasonCounts = new Map<string, number>();
  for (const item of runtimeItems.filter(item => item.status === "blocked" && item.reason)) reasonCounts.set(item.reason, (reasonCounts.get(item.reason) || 0) + 1);
  const reasons = [...reasonCounts].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const statusLabels: Record<ContentQueueItem["status"], string> = { planned: "未开始", queued: "排队中", producing: "制作中", waiting_review: "待验收", completed: "已完成", blocked: "需要处理" };
  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-4"><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">内容队列</h2>{cycleStart && cycleEnd && <Tag>{cycleStart} — {cycleEnd}</Tag>}<Tag>{display.totals.originalCount} 条母版</Tag><Tag>{display.totals.versionCount} 个平台版本</Tag></div>{onRefresh && <Button onClick={onRefresh} icon={<RefreshCcw size={15}/>}>刷新</Button>}</header>
    <div className="grid rounded-lg border border-border bg-white sm:grid-cols-2 xl:grid-cols-4">{[
      { label: "视频播放量", value: metricValue(display.totals.views), demo: display.totals.performanceSource === "demo" },
      { label: "互动总数", value: metricValue(display.totals.interactions), demo: display.totals.performanceSource === "demo" },
      { label: "已发布视频", value: display.totals.publishedCount, demo: false },
      { label: "本周发布版本", value: display.totals.versionCount, demo: false },
    ].map(metric => <div key={metric.label} className="border-border p-5 sm:border-r last:border-0"><Statistic title={<span>{metric.label} {metric.demo && <Tag>演示数据</Tag>}</span>} value={metric.value}/></div>)}</div>
    <div className="flex flex-wrap items-center gap-3">
      <Segmented aria-label="内容时间周期" value={periodFilter} onChange={value => setPeriodFilter(value as typeof periodFilter)} options={[{ value: "current", label: "本周期" }, { value: "previous", label: "上周期" }, { value: "30d", label: "近 30 天" }, { value: "all", label: "全部" }]}/>
      <Select aria-label="内容平台" value={platformFilter} onChange={setPlatformFilter} className="min-w-40" options={[{ value: "all", label: "全部平台" }, ...platformOptions.map(platform => ({ value: platform, label: platformLabels[platform] }))]}/>
      <span className="text-xs text-text-secondary">{filteredItems.length} 条计划内容</span>
    </div>
    <LsDataChart title="各阶段任务量" description="单位：条；所选范围内的计划版本，未生成执行任务的内容计为未开始。" kind="bar" stacked labels={filteredItems.length ? ["内容状态"] : []} series={states.map(state => ({ label: state.label, values: filteredItems.length ? [filteredItems.filter(item => state.keys.includes(item.status)).length] : [] }))} unit="条" height={220}/>
    <div className="grid gap-5 xl:grid-cols-2">
      <LsDataChart title="平均制作工期" description="单位：分钟；仅统计同时存在真实开始与完成时间的节点，不使用预计用时补齐。" kind="bar" horizontal labels={durations.map(([label]) => label)} series={[{ label: "平均实际工期", values: durations.map(([, values]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10) }]} unit="分钟" height={240}/>
      <LsDataChart title="当前失败原因" description="单位：条；来自受阻任务的原因记录，最多展示前 10 项。" kind="bar" horizontal labels={reasons.map(([reason]) => reason)} series={[{ label: "受阻任务", values: reasons.map(([, count]) => count) }]} unit="条" height={240}/>
    </div>
    <section className="rounded-lg border border-border bg-white p-5"><h2 className="mb-4 text-lg font-semibold">内容明细与热度</h2>
      <Table<UnifiedPlanContent> rowKey="id" dataSource={filteredItems} pagination={{ pageSize: 8, showSizeChanger: false, showTotal: total => `共 ${total} 条` }} columns={[
        { title: "内容", key: "title", render: (_, item) => <div><Button type="link" className="!h-auto !whitespace-normal !p-0 !text-left" onClick={() => item.queueItem ? onOpenProductionProgress?.(item.queueItem.taskId, item.queueItem.id) : onNavigate?.("socialInspiration")}>{item.title}</Button><p className="mt-1 flex items-center gap-1 text-xs text-text-secondary"><SocialPlatformIcon platform={item.platform} size={14}/>{item.accountLabel}</p><p className="mt-1 text-xs text-text-secondary sm:hidden">{statusLabels[item.status]} · {item.plannedPublishDate || "待排期"}</p></div> },
        { title: "状态", dataIndex: "status", responsive: ["sm"], render: (status: ContentQueueItem["status"]) => <Tag color={status === "blocked" ? "error" : status === "completed" ? "success" : status === "waiting_review" ? "warning" : "default"}>{statusLabels[status]}</Tag> },
        { title: "发布日期", dataIndex: "plannedPublishDate", responsive: ["lg"], sorter: (a, b) => a.plannedPublishDate.localeCompare(b.plannedPublishDate) },
        { title: "播放量", key: "views", align: "right", sorter: (a, b) => a.metrics.views - b.metrics.views, render: (_, item) => <div>{metricValue(item.metrics.views)}<div className="mt-1"><PlanDataSourceBadge source={item.metrics.source}/></div></div> },
        { title: "互动", key: "interactions", align: "right", responsive: ["md"], sorter: (a, b) => a.metrics.interactions - b.metrics.interactions, render: (_, item) => metricValue(item.metrics.interactions) },
      ]}/>
    </section>
    <ContentGenerationProgress data={data} selectedAccountId={selectedAccountId} onOpenContent={onOpenContent} onOpenProductionProgress={onOpenProductionProgress} onRetryTask={onRetryTask}/>
    <section className="rounded-lg border border-border bg-white"><header className="border-b border-border p-5"><h2 className="text-lg font-semibold">内容监控</h2></header><AccountActivity embedded/></section>
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
  if (!item) return <section className="rounded-lg border border-slate-200 bg-white p-8 text-center">
    <Clapperboard size={30} className="mx-auto text-slate-300"/>
    <h2 className="mt-3 text-base font-semibold text-slate-900">没有找到这条内容的制作记录</h2>
    <p className="mt-1 text-xs text-slate-500">任务可能尚未进入制作队列，或当前计划已经更新。</p>
    <Button htmlType="button" onClick={onBack} className="!h-auto min-h-9 !whitespace-normal mt-5 rounded-lg bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white">返回内容队列</Button>
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
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 bg-white px-5 py-5 text-zinc-900 sm:px-6">
        <div className="min-w-0"><Button htmlType="button" onClick={onBack} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600"><ArrowLeft size={12}/>返回内容队列</Button><div className="mt-3 flex flex-wrap items-center gap-2"><span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[9px] font-semibold">{item.origin === "weekly_plan" ? "周计划任务" : "手动单项"}</span><span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[9px] font-semibold">{platformLabels[item.platform]}</span><span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${item.status === "blocked" ? "bg-red-500 text-white" : item.status === "completed" ? "bg-emerald-400 text-emerald-950" : "bg-sky-400 text-sky-950"}`}>{statusLabel[item.status]}</span></div><h2 className="mt-3 text-xl font-semibold">{item.title}</h2><p className="mt-1 text-xs text-zinc-500">{item.productName || "待绑定产品"} · {item.accountLabel || "仅制作"} · {item.languages.join(" / ").toUpperCase() || "语言待确认"}</p></div>
        <div className="flex flex-wrap gap-2">{item.status === "blocked"&&item.taskId&&onRetryTask&&<Button htmlType="button" disabled={retrying} onClick={() => void retryCurrentTask()} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 text-xs font-semibold text-amber-950 disabled:opacity-50">{retrying&&<Loader2 size={13} className="animate-spin"/>}从当前节点重试</Button>}<Button htmlType="button" onClick={() => onOpenContent?.(item.taskId || undefined, item.socialContentTaskId || undefined)} className="!h-auto min-h-9 !whitespace-normal rounded-lg bg-white px-4 py-2.5 text-xs font-semibold text-slate-950">进入制作台</Button>{item.referenceId&&onNavigate&&<Button htmlType="button" onClick={() => onNavigate("socialInspiration")} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-xs font-semibold text-blue-600">核对参考视频</Button>}</div>
      </header>
      <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-6">
        {[
          ["当前节点", currentProductionStep?.label || item.stage],
          ["当前责任人", currentProductionStep?.responsibleAgent || "待分配"],
          ["整体进度", `${item.progress}%`],
          ["剩余预计时间", remainingProductionMinutes ? productionDurationLabel(remainingProductionMinutes) : "已完成"],
          ["预计输出", `${item.outputSummary.count} 条 · ${item.outputSummary.durationSeconds ? `约 ${item.outputSummary.durationSeconds} 秒` : "时长待确认"}`],
          ["本条成本", item.settledCostCny !== null ? `已结算 ¥${item.settledCostCny.toFixed(2)}` : item.estimatedCostCny !== null ? `预计 ¥${item.estimatedCostCny.toFixed(2)}` : "待核算"],
        ].map(([label,value]) => <div key={label} className="bg-white px-4 py-4"><p className="text-[9px] font-bold text-slate-400">{label}</p><p className="mt-1 text-xs font-semibold leading-5 text-slate-800">{value}</p></div>)}
      </div>
    </section>

    <section aria-label="内容方案与交付时间" className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-blue-100 bg-blue-50/40 px-5 py-4 sm:px-6">
        <div><p className="text-xs text-text-secondary">交付安排</p><h3 className="mt-1 text-base font-semibold text-slate-950">内容方案与交付时间</h3></div>
        <span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${contentPlan.source === "system_default" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{contentPlan.source === "system_default" ? "系统默认 · 可调整" : "已确认"}</span>
      </header>
      <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["内容方案", contentPlan.summary],
          ["预计制作工期", productionDurationLabel(contentPlan.estimatedMinutes)],
          ["交付与发布时间", contentPlan.deliverBy || contentPlan.publishAt || "待确认"],
          ["发布账号", item.accountLabel ? `${platformLabels[item.platform]} · ${item.accountLabel}` : "仅制作，不自动发布"],
        ].map(([label, value]) => <article key={label} className="min-w-0 bg-white px-5 py-4"><p className="text-[9px] font-bold text-slate-400">{label}</p><p className="mt-1 break-words text-xs font-semibold leading-5 text-slate-800">{value}</p></article>)}
      </div>
    </section>

    {item.preproduction&&<section className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6"><div><p className="text-xs text-text-secondary">制作准备</p><h3 className="mt-1 text-base font-semibold text-slate-950">开始制作前锁定的双预览</h3></div><TaskPreviewCards item={item} onNavigate={onNavigate}/></section>}

    {executionJob&&<section className={`rounded-lg border px-4 py-4 ${executionJob.status === "blocked" || executionJob.status === "dead_letter" ? "border-red-200 bg-red-50" : executionJob.status === "reconciling" || executionJob.status === "retry_wait" ? "border-amber-200 bg-amber-50" : "border-blue-100 bg-blue-50"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${executionStatusTone[executionJob.status]}`}>{executionStatusLabel[executionJob.status]}</span><p className="text-xs font-semibold text-slate-900">后台执行状态</p></div><p className="mt-2 text-xs leading-5 text-slate-700">{executionJob.publicReason}</p><p className="mt-1 text-[10px] text-slate-500">{executionWaitingLabel(executionJob)}</p></div><div className="text-left sm:text-right"><p className="text-[9px] font-bold text-slate-400">自动尝试</p><p className="mt-1 text-sm font-semibold text-slate-800">{executionJob.attempt}/{executionJob.maxAttempts}</p></div></div></section>}

    {item.reason&&<section role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-4"><AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600"/><div><p className="text-xs font-semibold text-red-800">当前任务需要处理</p><p className="mt-1 text-xs leading-5 text-red-700">{item.reason}</p><p className="mt-1 text-[10px] text-red-600">已完成的制作结果会保留；上面的系统默认产品、账号和时间可以进入制作台调整。</p></div></section>}

    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-blue-600">制作节点</p><h3 className="mt-1 text-base font-semibold text-slate-950">制作节点</h3></div><strong className="text-sm text-slate-800">{item.progress}%</strong></div>
        <ol className="mt-5">{item.steps.map((step, index) => <li key={step.key} className="relative flex gap-4 pb-5 last:pb-0"><div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white"><span className={`h-3 w-3 rounded-full border-2 ${step.state === "done" ? "border-emerald-600 bg-emerald-500" : step.state === "active" ? "border-blue-600 bg-blue-500 motion-safe:animate-pulse" : "border-slate-300 bg-white"}`}/></div>{index < item.steps.length - 1&&<span className={`absolute left-[11px] top-5 h-full w-0.5 ${step.state === "done" ? "bg-emerald-300" : "bg-slate-200"}`}/>}<div className="min-w-0 flex-1 rounded-lg bg-slate-50 px-3 py-3"><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-slate-800">{index + 1}. {step.label}</p><span className={`text-[9px] font-semibold ${step.state === "done" ? "text-emerald-700" : step.state === "active" ? "text-blue-700" : "text-slate-400"}`}>{step.state === "done" ? "已完成" : step.state === "active" ? "进行中" : "等待"}</span></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-500"><span>负责：<strong className="text-slate-700">{step.responsibleAgent}</strong></span><span>预计：<strong className="text-slate-700">{productionDurationLabel(step.estimatedMinutes)}</strong></span>{step.actualStartedAt&&<span>实际开始：{dateLabel(step.actualStartedAt)}</span>}{step.actualFinishedAt&&<span>实际完成：{dateLabel(step.actualFinishedAt)}</span>}</div>{step.state === "active"&&<p className="mt-2 text-[10px] text-slate-500">系统会持续保存本节点结果，离开页面不会中断后台任务。</p>}</div></li>)}</ol>
      </div>
      <aside className="space-y-4">
        {item.confidence&&<section className="rounded-lg border border-sky-100 bg-sky-50/55 p-5"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-sky-700">数据依据</p><h3 className="mt-2 text-sm font-semibold text-slate-950">成功把握与数据充分度</h3><p className="mt-2 text-[10px] leading-5 text-slate-600">{item.confidence.note}</p><div className="mt-3 space-y-2">{([["制作把握",item.confidence.production],["发布把握",item.confidence.publishing],["经营把握",item.confidence.business]] as const).map(([label,dimension])=><details key={label} className="rounded-lg border border-white bg-white/80 px-3 py-2"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-slate-800"><span>{label}</span><span className={`rounded-full px-2 py-1 text-[9px] ${confidenceTone[dimension.level]}`}>{dimension.label}</span></summary><div className="mt-2 border-t border-slate-100 pt-2 text-[10px] leading-5 text-slate-600">{dimension.evidence.length?<p><strong>已有依据：</strong>{dimension.evidence.join("；")}</p>:<p>当前没有足够真实依据。</p>}{dimension.gaps.length?<p className="mt-1 text-amber-700"><strong>仍缺：</strong>{dimension.gaps.join("；")}</p>:null}</div></details>)}</div></section>}
        <section className="rounded-lg border border-zinc-200 bg-white p-5"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-violet-600">计划依据</p><h3 className="mt-2 text-sm font-semibold text-slate-950">{item.referenceTitle || "按产品与账号策略生成"}</h3>{item.benchmarkAccount&&<p className="mt-2 text-xs font-bold text-slate-700">对标账号：{item.benchmarkAccount}</p>}{item.referenceViews&&<p className="mt-1 text-xs text-slate-600">参考播放：{item.referenceViews}</p>}{item.matchScore!==null&&<p className="mt-1 text-xs text-slate-600">内容匹配度：{item.matchScore}（不是成功率）</p>}<p className="mt-3 text-[10px] leading-5 text-slate-600">{item.planningFactors.length ? item.planningFactors.join(" · ") : "当前没有可核验的参考视频，未生成虚构对标信息。"}</p></section>
        <section className="rounded-lg border border-slate-200 bg-white p-5"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">业务血缘</p><dl className="mt-3 space-y-2 text-xs">{[["经营目标",item.lineage.objective||"单项内容交付"],["发布账号",item.lineage.accountLabel||"仅制作"],["计划版本",item.lineage.planId?`v${item.lineage.planVersion||1}`:"手动单项"],["授权方式",item.lineage.authorizationMode==="bounded"?"范围授权":item.lineage.authorizationMode==="each"?"逐次确认":"手动任务"]].map(([label,value])=><div key={label} className="grid grid-cols-[72px_1fr] gap-2"><dt className="text-slate-400">{label}</dt><dd className="font-bold leading-5 text-slate-700">{value}</dd></div>)}</dl></section>
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
  const ranking: Array<{ id: string; title: string; subject: string; accountId: string; views: number; likes: number | null; comments: number | null; source: DisplayMetricSource }> = liveRanking.length
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
      thumbnailUrl: demoContent?.queueItem?.preproduction?.benchmark.thumbnailUrl || "",
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

  const dailyTrend = data.businessSnapshot?.social.dailyTrend || [];
  const chartRanking = ranking.some(item => item.source === "real") ? ranking.filter(item => item.source === "real") : ranking;
  const costResults = reviewQueue.flatMap(item => {
    const metrics = performanceForQueueItem(item, deliveries);
    return item.settledCostCny !== null && metrics.views !== null ? [{ title: item.title, cost: item.settledCostCny, views: metrics.views }] : [];
  });
  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-4"><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold">数据复盘</h2><Tag>{display.totals.accountCount} 个账号</Tag><Tag>{display.totals.versionCount} 个发布版本</Tag><Tag>同步 {dateLabel(performance?.loadedAt)}</Tag></div><Button loading={performanceBusy} icon={<RefreshCcw size={15}/>} onClick={() => void refreshPerformance()}>同步账号数据</Button></header>
    <section className="rounded-lg border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-5 py-3"><h3 className="font-semibold">计划完成与业务回流</h3><Tag color={useDemoReview ? "default" : "success"}>{useDemoReview ? "演示复盘" : "真实复盘"}</Tag></div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4">{[
        { label: "完成率", value: useDemoReview ? `${Math.round(recommendationSummary.completionRate)}%` : `${Math.round(reviewSummary?.completionRate || 0)}%`, demo: useDemoReview },
        { label: "周计划内容", value: `${display.totals.completedCount}/${display.totals.versionCount}`, demo: false },
        { label: "阻塞项", value: liveReview?.blockedTasks.length ?? reviewSummary?.failedTasks ?? "—", demo: false },
        { label: "已结算制作费", value: settledReviewItems.length ? `¥${settledReviewCost.toFixed(2)}` : "待回传", demo: false },
      ].map(item => <div key={item.label} className="border-border p-5 sm:border-r last:border-r-0"><Statistic title={<span>{item.label} {item.demo && <Tag>演示数据</Tag>}</span>} value={item.value}/></div>)}</div>
    </section>
    {(performanceError || performance?.unavailable.length) ? <Alert type="warning" showIcon title={performanceError || `${performance?.unavailable.length} 个账号暂时无法同步；已保留其他账号的真实数据。`} action={<Button onClick={() => onNavigate?.("accountManagement")}>检查账号授权</Button>}/> : null}
    {liveReview?.dataGaps.length ? <Alert type="info" showIcon title="数据尚未完整" description={liveReview.dataGaps.slice(0, 3).join("；")}/> : null}
    <LsDataChart title="播放与互动趋势" description={`单位：次；${data.businessSnapshot?.range.startsAt || "待同步"} 至 ${data.businessSnapshot?.range.endsAt || "待同步"}，按平台每日快照。没有日级回传时不推算趋势。`} kind="line" labels={dailyTrend.map(item => item.date)} series={[
      { label: "播放量", values: dailyTrend.map(item => item.views) },
      { label: "互动量", values: dailyTrend.map(item => item.interactions) },
    ]} unit="次"/>
    <LsDataChart title="询盘趋势" description="单位：条；当前快照只提供周期询盘汇总，待接入日级询盘来源后展示趋势。" kind="line" labels={[]} series={[{ label: "每日询盘", values: [] }]} unit="条" height={220}/>
    <Tabs aria-label="复盘平台" activeKey={platform} onChange={value => setPlatform(value as Platform)} items={platformOptions.map(item => ({ key: item, label: <span className="inline-flex items-center gap-2"><SocialPlatformIcon platform={item} size={17}/>{platformLabels[item]}</span> }))}/>
    <div className="grid gap-5 xl:grid-cols-2">
      <LsDataChart title="高播放内容 Top 10" description={`${platformLabels[platform]} · 单位：次；按已回传累计播放量排序。演示值仅用于预览，不进入正式决策。`} kind="bar" horizontal labels={chartRanking.slice(0, 10).map(item => item.title)} series={[{ label: "播放量", values: chartRanking.slice(0, 10).map(item => item.views) }]} demo={chartRanking.length > 0 && chartRanking.every(item => item.source === "demo")} loading={performanceBusy && !chartRanking.length} unit="次"/>
      <LsDataChart title="制作成本与播放结果" description="横轴：已结算制作费（元）；纵轴：真实累计播放（次）。仅展示同时存在费用回执与平台回传的内容，不使用演示费用。" kind="scatter" labels={costResults.map(item => item.title)} xValues={costResults.map(item => item.cost)} xUnit="元" series={[{ label: "已结算内容", values: costResults.map(item => item.views) }]} unit="次"/>
    </div>
    <section className="rounded-lg border border-border bg-white p-5"><h3 className="mb-4 text-lg font-semibold">账号内容表现明细</h3><Table rowKey="id" dataSource={ranking} loading={performanceBusy && !ranking.length} pagination={{ pageSize: 8, showSizeChanger: false }} columns={[
      { title: "内容", key: "content", render: (_, item) => <div><p className="font-medium">{item.title}</p><p className="mt-1 text-xs text-text-secondary">{item.subject}</p><PlanDataSourceBadge source={item.source}/></div> },
      { title: "播放量", dataIndex: "views", align: "right", sorter: (a, b) => a.views - b.views, defaultSortOrder: "descend", render: value => metricValue(value) },
      { title: "点赞", dataIndex: "likes", align: "right", responsive: ["md"], sorter: (a, b) => (a.likes ?? -1) - (b.likes ?? -1), render: value => metricValue(value) },
      { title: "评论", dataIndex: "comments", align: "right", responsive: ["md"], sorter: (a, b) => (a.comments ?? -1) - (b.comments ?? -1), render: value => metricValue(value) },
    ]}/></section>
    <NextRoundRecommendationsSection summary={recommendationSummary} demo={useDemoReview} onOpen={(page) => onNavigate?.(page as Page)}/>
  </div>;
}

export default function SmartBusinessDashboard({ calendarTasks, calendarDemo, data, view, selectedAccountId, selectedContentItemId, onRefresh, onNavigate, onGeneratePlan, onGenerateDetails, onOpenContent, onOpenProductionProgress, onBackToQueue, onRetryTask, onControlJob }: { calendarTasks?: AgentCalendarTask[]; calendarDemo?: boolean; data: DigitalEmployeeOverview; view: SmartBusinessView; selectedAccountId?: string; selectedContentItemId?: string; onRefresh?: () => void; onNavigate?: (page: Page) => void; onGeneratePlan?: () => void; onGenerateDetails?: () => void; onOpenContent?: (taskId?: string, socialContentTaskId?: string) => void; onOpenProductionProgress?: (taskId: string, contentItemId: string) => void; onBackToQueue?: () => void; onRetryTask?: (taskId: string) => Promise<boolean>; onControlJob?: (jobId: string, action: ExecutionControlAction) => Promise<boolean> }) {
  if (view === "matrix") return <MatrixView calendarTasks={calendarTasks} calendarDemo={calendarDemo} data={data} selectedAccountId={selectedAccountId} onRefresh={onRefresh} onNavigate={onNavigate} onGeneratePlan={onGeneratePlan} onOpenContent={onOpenContent} onOpenProductionProgress={onOpenProductionProgress} onRetryTask={onRetryTask}/>;
  if (view === "queue") return <QueueView data={data} selectedAccountId={selectedAccountId} onRefresh={onRefresh} onNavigate={onNavigate} onGenerateDetails={onGenerateDetails} onOpenContent={onOpenContent} onOpenProductionProgress={onOpenProductionProgress} onControlJob={onControlJob} onRetryTask={onRetryTask}/>;
  if (view === "production") return <ProductionDetailView data={data} contentItemId={selectedContentItemId} onBack={onBackToQueue} onNavigate={onNavigate} onOpenContent={onOpenContent} onRetryTask={onRetryTask}/>;
  if (view === "review") return <ReviewView data={data} selectedAccountId={selectedAccountId} onNavigate={onNavigate}/>;
  return <HomeView data={data} selectedAccountId={selectedAccountId} onRefresh={onRefresh}/>;
}
