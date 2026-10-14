import type { AgentCalendarTask } from "./smartBusiness/AgentWeeklyCalendar";
import { Alert, Button, Drawer, Empty, Radio, Segmented, Select, Statistic, Table, Tabs, Tag, Timeline } from "antd";
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
import { MASTER_VIDEO_COST_MAX_CNY, MASTER_VIDEO_COST_MIN_CNY, MASTER_VIDEO_COST_POINT_CNY } from "../../shared/contracts/contentCostModel";
import { loadConnectedSocialPerformance, type ConnectedSocialPerformance } from "../lib/socialPerformance";
import { starterWorkspaceApi, type StarterAgentRole } from "../lib/starterWorkspace";
import { authHeader } from "../lib/auth";
import ProductionTaskScene from "./ProductionTaskScene";
import DigitalEmployeeWorkspace from "./smartBusiness/DigitalEmployeeWorkspace";
import NextRoundRecommendationsSection from "./NextRoundRecommendationsSection";
import BusinessHealthOverview, { type BusinessHealthOverviewRange } from "./smartBusiness/BusinessHealthOverview";
import BusinessDataReview from "./smartBusiness/BusinessDataReview";
import { LsCalendar, calendarDayKey, type LsCalendarEvent } from "./ui/LsCalendar";
import { calendarWeekday, thumbnailUrlWithSourceFallback } from "../lib/calendarModel";
import WeeklyContentProgressPanel from "./smartBusiness/WeeklyContentProgressPanel";
import WeeklyProductionStudioEntry from "./smartBusiness/WeeklyProductionStudioEntry";
import { projectWeeklyGoalCalendar } from "./smartBusiness/weeklyGoalCalendar";
import { isSmartBusinessShowcaseEnabled, SMART_BUSINESS_SHOWCASE_WEEKLY_TOTALS } from "../dev/smartBusinessShowcaseData";

export type SmartBusinessView = "home" | "matrix" | "production" | "review";

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

const DEFAULT_VIDEO_COST_CNY = {
  min: MASTER_VIDEO_COST_MIN_CNY,
  point: MASTER_VIDEO_COST_POINT_CNY,
  max: MASTER_VIDEO_COST_MAX_CNY,
} as const;

function weeklyVideoBudget(data: DigitalEmployeeOverview) {
  const pack = data.plan?.businessPackage;
  const plans = pack?.tasks.find(task => task.templateId === "production")?.videoPlans || [];
  const everyPlanIsProduction = Boolean(plans.length && pack?.directorPlan?.originalTarget === plans.length);
  const estimated = plans.reduce((sum, plan) => sum + Math.max(
    Number(plan.estimatedCost || 0),
    everyPlanIsProduction ? DEFAULT_VIDEO_COST_CNY.point : 0,
  ), 0);
  const min = plans.reduce((sum, plan) => sum + Math.max(
    Number(plan.estimatedCostRange?.minCny || 0),
    everyPlanIsProduction ? DEFAULT_VIDEO_COST_CNY.min : 0,
  ), 0);
  const max = plans.reduce((sum, plan) => sum + Math.max(
    Number(plan.estimatedCostRange?.maxCny || 0),
    everyPlanIsProduction ? DEFAULT_VIDEO_COST_CNY.max : 0,
  ), 0);
  return { plans, estimated, min, max };
}

function metricValue(value: number | null | undefined, suffix = "") {
  return value === null || value === undefined ? "—" : `${value.toLocaleString("zh-CN")}${suffix}`;
}

function dateLabel(value?: string) {
  if (!value) return "等待更新时间";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function productionDurationLabel(minutes: number | null | undefined) {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) return "工期待核验";
  if (minutes < 60) return `约 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `约 ${hours} 小时${rest ? ` ${rest} 分钟` : ""}`;
}

const contentTitleEmojis = ["✨", "🧴", "🏭", "🔬", "💡", "📦"];

function engagingContentTitle(value: string, index: number) {
  const title = value.trim();
  if (!title) return `${contentTitleEmojis[index % contentTitleEmojis.length]} 本周内容 ${index + 1}`;
  return /\p{Extended_Pictographic}/u.test(title) ? title : `${contentTitleEmojis[index % contentTitleEmojis.length]} ${title}`;
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
    const iso = value.slice(0, 10);
    const date = new Date(`${iso}T00:00:00+08:00`);
    if (Number.isNaN(date.getTime())) return null;
    return {
      iso,
      label: date.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", weekday: "short" }),
    };
  };
  const start = format(startsAt);
  const end = format(endsAt);
  if (!start || !end) return null;
  return <div aria-label={`本周排期 ${startsAt} 至 ${endsAt}`} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700">
    <CalendarRange size={14} aria-hidden="true"/>
    <time dateTime={start.iso}>{start.label}</time>
    <span className="text-violet-500" aria-hidden="true">→</span>
    <time dateTime={end.iso}>{end.label}</time>
  </div>;
}

type WeeklyInspirationReference = {
  referenceId: string;
  sourceUrl: string;
  title: string;
  platform: Platform;
  thumbnailUrl: string;
  duration: number;
  benchmarkAnalysis?: VideoCreationPlan["benchmarkAnalysis"];
};

function videoPlanFamilyKey(plan: VideoCreationPlan) {
  return plan.contentFamilyId || plan.masterContentId || plan.contentId || "";
}

/** Resolve an adapted publication back to its frozen original before reading reference identity. */
function referencePlanForPublication(plans: VideoCreationPlan[], plan: VideoCreationPlan) {
  const explicitMaster = plan.masterContentId
    ? plans.find(candidate => candidate.contentId === plan.masterContentId)
    : undefined;
  if (explicitMaster) return explicitMaster;
  const familyKey = videoPlanFamilyKey(plan);
  if (!familyKey) return plan;
  return plans.find(candidate => videoPlanFamilyKey(candidate) === familyKey && candidate.productionRole === "master")
    || plans.find(candidate => videoPlanFamilyKey(candidate) === familyKey)
    || plan;
}

/** Only persisted plan evidence may establish the exact inspiration destination. */
function inspirationReferenceForPlan(plan: VideoCreationPlan): WeeklyInspirationReference | null {
  const referenceId = String(plan.referenceId || plan.preproduction?.benchmark.referenceId || "").trim();
  const sourceUrl = String(plan.preproduction?.benchmark.sourceUrl || plan.planningEvidence?.referenceSourceUrl || "").trim();
  if (!referenceId && !sourceUrl) return null;
  return {
    referenceId,
    sourceUrl,
    title: String(plan.planningEvidence?.referenceTitle || plan.preproduction?.benchmark.title || plan.theme || "").trim(),
    platform: plan.platform,
    thumbnailUrl: String(plan.preproduction?.benchmark.thumbnailUrl || plan.planningEvidence?.referenceThumbnailUrl || "").trim(),
    duration: Math.max(0, Number(plan.duration || 0)),
    benchmarkAnalysis: plan.benchmarkAnalysis,
  };
}

function inspirationReferenceNavigationDetail(reference: WeeklyInspirationReference, contentItemId?: string) {
  return {
    page: "socialInspiration" as const,
    view: "inspiration" as const,
    businessRef: { referenceId: reference.referenceId },
    inspirationReference: reference,
    ...(contentItemId ? { contentItemId } : {}),
  };
}

export function WeeklyCommandCenter({
  data,
  statusLabel,
  actions,
  feedback,
  notice,
  className = "",
}: {
  data: DigitalEmployeeOverview;
  statusLabel: string;
  actions?: ReactNode;
  feedback?: ReactNode;
  notice?: ReactNode;
  className?: string;
}) {
  const display = buildSmartBusinessDisplayModel(data);
  const contentQueue = data.contentQueue?.items || [];
  const operatingContext = data.plan?.businessPackage?.operatingContext;
  const packageBudget = weeklyVideoBudget(data);
  const weeklyQueue = contentQueue.filter(item => item.origin === "weekly_plan");
  const plannedOutputCount = display.totals.versionCount;
  const plannedDurationSeconds = display.totals.durationSeconds;
  const estimatedContentCost = Math.max(
    weeklyQueue.reduce((sum, item) => sum + Number(item.estimatedCostCny || 0), 0),
    packageBudget.estimated,
  );
  const settledContentCost = weeklyQueue.reduce((sum, item) => sum + Number(item.settledCostCny || 0), 0);
  const budgetMin = Math.max(operatingContext?.budget.totalMinCny || 0, packageBudget.min);
  const budgetMax = Math.max(operatingContext?.budget.totalMaxCny || 0, packageBudget.max);

  return <section className={`flex flex-col overflow-hidden bg-white ${className}`.trim()} aria-label="本周任务驾驶舱">
    <div className="flex flex-wrap items-start justify-between gap-3 px-6 pb-4 pt-5 text-text-primary xl:min-h-[112px]">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">周经营计划</h2>
          <Tag color={statusLabel === "执行中"
            ? "processing"
            : statusLabel === "执行失败"
              ? "error"
              : statusLabel === "已完成"
                ? "success"
                : ["待确认", "准备中", "待处理", "等待外部服务", "已暂停"].includes(statusLabel)
                  ? "warning"
                  : "default"}>{statusLabel}</Tag>
          {data.goal && (
            <WeeklyRangeVisual startsAt={data.goal.startsAt} endsAt={data.goal.endsAt} />
          )}
        </div>
      </div>
      {actions && <div aria-label="智能经营控制" className="flex max-w-full flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
    {feedback && <div aria-label="周任务操作反馈" className="border-b border-border bg-white px-4 py-2.5">{feedback}</div>}
    <div className="grid auto-rows-[112px] gap-x-6 gap-y-6 bg-white px-6 pb-6 pt-3 sm:grid-cols-3">
      {[
        { label: "待验收成片", value: `${display.totals.waitingReviewCount} 条`, color: "var(--color-accent)" },
        { label: "本周计划视频", value: `${plannedOutputCount} 条`, color: "var(--color-visual-lavender)" },
        { label: "本周视频总时长", value: plannedDurationSeconds > 0 ? `${plannedDurationSeconds} 秒` : "待确认", color: "var(--color-visual-teal)" },
        { label: "本周成本范围", value: budgetMax > 0 ? `¥${budgetMin.toFixed(0)}–${budgetMax.toFixed(0)}` : "待核算", color: "var(--color-visual-pink)" },
        { label: "预计制作成本", value: estimatedContentCost > 0 ? `¥${estimatedContentCost.toFixed(2)}` : "待核算", color: "var(--color-text-primary)" },
        { label: "已结算成本", value: settledContentCost > 0 ? `¥${settledContentCost.toFixed(2)}` : "暂无结算", color: "var(--color-text-primary)" },
      ].map(item => <article key={item.label} className="min-w-0 bg-white"><Statistic title={item.label} value={item.value} styles={{ title: { fontSize: 16, lineHeight: "24px", fontWeight: 400, color: "var(--color-text-secondary)", marginBottom: 12 }, content: { color: "var(--color-text-primary)", fontSize: 28, fontWeight: 600, lineHeight: "36px" } }}/></article>)}
    </div>
    {notice && <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">{notice}</div>}
  </section>;
}

export function WeeklyPlanDetailsDrawer({
  data,
  open,
  onClose,
  onBudgetModeChange,
}: {
  data: DigitalEmployeeOverview;
  open: boolean;
  onClose: () => void;
  onBudgetModeChange?: (mode: "protected" | "economy") => Promise<void>;
}) {
  const display = buildSmartBusinessDisplayModel(data);
  const director = data.plan?.businessPackage?.directorPlan;
  const savedBudgetMode = director?.productionBudgetMode === "economy" ? "economy" : "protected";
  const [budgetMode, setBudgetMode] = useState<"protected" | "economy">(savedBudgetMode);
  const [budgetBusy, setBudgetBusy] = useState(false);
  useEffect(() => setBudgetMode(savedBudgetMode), [savedBudgetMode, open]);
  const budgetMin = Number(director?.productionBudgetMin || 0);
  const budgetMax = Number(director?.productionBudgetMax || 0);
  const masterPlans = data.plan?.businessPackage?.tasks.find(task => task.templateId === "production")?.videoPlans?.filter(item => item.productionRole !== "platform_adaptation") || [];
  const reliableBudgetReady = masterPlans.length > 0 && masterPlans.every(item => item.route !== "clone"
    || item.estimatedCostRange?.basis === "verified_storyboard_provider_envelope");
  const canEditBudget = Boolean(onBudgetModeChange && data.goal?.status === "draft" && !data.run && reliableBudgetReady);
  const saveBudgetMode = async () => {
    if (!onBudgetModeChange || budgetMode === savedBudgetMode) return;
    setBudgetBusy(true);
    try { await onBudgetModeChange(budgetMode); }
    finally { setBudgetBusy(false); }
  };
  const weeklyReferences = [...new Map(display.masters.flatMap(item => {
    const reference = item.inspirationReference;
    if (!reference) return [];
    const identity = reference.referenceId || reference.sourceUrl || reference.title;
    return [[identity, { item, reference }] as const];
  })).values()];
  const missingReferenceCount = display.masters.filter(item => !item.inspirationReference).length;
  const formatPublishTime = (item: UnifiedPlanContent) => {
    const parsed = item.plannedPublishAt ? new Date(item.plannedPublishAt) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }
    return item.plannedPublishDate || '待排期';
  };

  return <Drawer open={open} title="本周计划" size={720} onClose={onClose} destroyOnHidden>
    <div className="space-y-6" aria-label="详细周计划">
      <section>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-text-primary">{data.goal?.title || '本周经营计划'}</h2>
            {data.goal?.objective && <p className="mt-2 text-sm leading-6 text-text-secondary">{data.goal.objective}</p>}
          </div>
          {data.goal && <WeeklyRangeVisual startsAt={data.goal.startsAt} endsAt={data.goal.endsAt}/>}
        </div>
        <dl className="mt-5 grid gap-4 border-y border-border py-4 sm:grid-cols-3">
          <div><dt className="text-xs text-text-muted">计划内容</dt><dd className="mt-1 text-base font-semibold text-text-primary">{display.totals.versionCount} 条</dd></div>
          <div><dt className="text-xs text-text-muted">视频总时长</dt><dd className="mt-1 text-base font-semibold text-text-primary">{display.totals.durationSeconds > 0 ? `${display.totals.durationSeconds} 秒` : '待确认'}</dd></div>
          <div><dt className="text-xs text-text-muted">目标平台</dt><dd className="mt-1 text-base font-semibold text-text-primary">{display.platforms.filter(item => item.plannedCount > 0).map(item => platformLabels[item.platform]).join('、') || '待确认'}</dd></div>
        </dl>
      </section>

      <section aria-label="开工预算方案" className="border-t border-border pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-text-primary">开工预算方案</h3>
            <p className="mt-1 text-xs leading-5 text-text-secondary">费用按已确认分镜、480p 供应商价格和首帧调用次数预估；开始生产即授权所选上限，执行中不再逐镜询问预算。</p>
          </div>
          {reliableBudgetReady && <Tag color={savedBudgetMode === "economy" ? "warning" : "success"}>{savedBudgetMode === "economy" ? "精简预算" : "完整保障"}</Tag>}
        </div>
        {!reliableBudgetReady ? <Alert className="mt-3" type="warning" showIcon title="可靠预算尚未生成" description="请先完成周计划详情准备；系统不会在预算未知时启动生产。" /> : <>
          <Radio.Group className="mt-3 block w-full" value={budgetMode} disabled={!canEditBudget || budgetBusy} onChange={event => setBudgetMode(event.target.value)}>
            <div className="divide-y divide-border border-y border-border">
              <label className="flex cursor-pointer items-start gap-3 py-3">
                <Radio value="protected" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-text-primary">完整保障（推荐） · 上限 ¥{budgetMax.toFixed(2)}</span><span className="mt-1 block text-xs leading-5 text-text-secondary">覆盖全部分镜的一次生成，并预留每镜一次付费重做；确认后按该上限连续生产。</span></span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 py-3">
                <Radio value="economy" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-text-primary">精简预算 · 上限 ¥{budgetMin.toFixed(2)}</span><span className="mt-1 block text-xs leading-5 text-text-secondary">固定 480p、每镜一次生成，不预留付费重做；质检不通过时需重新确认追加预算。</span></span>
              </label>
            </div>
          </Radio.Group>
          {canEditBudget && budgetMode !== savedBudgetMode && <div className="mt-3 flex justify-end"><Button type="primary" loading={budgetBusy} onClick={() => void saveBudgetMode()}>应用预算方案</Button></div>}
          {!canEditBudget && <p className="mt-3 text-xs text-text-muted">{data.run ? "生产已开始，本次预算授权已冻结。" : "历史计划仅供查看，不能修改预算。"}</p>}
        </>}
      </section>

      <section aria-label="周计划内容与排期">
        <h3 className="text-base font-semibold text-text-primary">内容与发布时间</h3>
        <div className="mt-3 divide-y divide-border border-y border-border">
          {display.contents.map(item => <article key={item.id} className="flex min-w-0 items-start gap-3 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2" aria-hidden="true"><SocialPlatformIcon platform={item.platform} size={18}/></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-text-primary">{item.title}</p>
              <p className="mt-1 text-xs text-text-secondary">{item.productName} · {platformLabels[item.platform]} · {formatPublishTime(item)}</p>
            </div>
          </article>)}
          {display.contents.length === 0 && <p className="py-4 text-sm text-text-secondary">计划内容正在生成，完成后会在这里显示。</p>}
        </div>
      </section>

      <section aria-label="本周计划爆款依据" className="border-t border-border pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h3 className="text-base font-semibold text-text-primary">计划依据 · 爆款参考</h3><p className="mt-1 text-xs text-text-secondary">这里记录本周选题实际绑定的爆款视频；点击可回到爆款库查看原素材与分析。</p></div>
          <Tag color={missingReferenceCount > 0 ? 'warning' : 'success'}>{weeklyReferences.length} 条已绑定{missingReferenceCount > 0 ? ` · ${missingReferenceCount} 条待补` : ''}</Tag>
        </div>
        {weeklyReferences.length > 0 ? <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {weeklyReferences.map(({ item, reference }) => <button
            key={reference.referenceId || reference.sourceUrl || reference.title}
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("lingshu:navigate", { detail: inspirationReferenceNavigationDetail(reference, item.contentId) }))}
            className="group overflow-hidden rounded-lg border border-border bg-white text-left transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="relative flex aspect-video w-full items-center justify-center overflow-hidden bg-surface-2">
              {reference.thumbnailUrl ? <img
                src={thumbnailUrlWithSourceFallback(reference.thumbnailUrl, reference.sourceUrl)}
                alt={`${reference.title || item.title} 视频缩略图`}
                className="h-full w-full object-cover transition-transform duration-200 motion-safe:group-hover:scale-[1.02]"
              /> : <SocialPlatformIcon platform={reference.platform} size={32}/>}
              <span className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 shadow-sm" aria-hidden="true"><SocialPlatformIcon platform={reference.platform} size={16}/></span>
              <span className="absolute bottom-2 right-2 rounded-full bg-black/65 px-2 py-1 text-[10px] font-semibold text-white">查看原视频</span>
            </span>
            <span className="flex min-w-0 items-center gap-3 px-3 py-3">
              <span className="min-w-0 flex-1"><span className="block line-clamp-2 text-sm font-semibold text-text-primary">{reference.title || item.title}</span><span className="mt-1 block truncate text-xs text-text-secondary">用于：{item.productName} · {platformLabels[item.platform]}</span></span>
              <Eye size={16} className="shrink-0 text-accent" aria-hidden="true"/>
            </span>
          </button>)}
        </div> : <p className="mt-3 text-sm text-text-secondary">当前计划尚未绑定可核验的爆款参考；系统不会用虚构素材填充。</p>}
      </section>
    </div>
  </Drawer>;
}

export function BusinessInterpretation({ data, onViewReview }: { data: DigitalEmployeeOverview; onViewReview: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const display = buildSmartBusinessDisplayModel(data);
  const weeklyItems = (data.contentQueue?.items || []).filter(item => item.origin === 'weekly_plan');
  const packageBudget = weeklyVideoBudget(data);
  const estimatedCost = Math.max(
    weeklyItems.reduce((sum, item) => sum + Number(item.estimatedCostCny || 0), 0),
    packageBudget.estimated,
  );
  const settledCost = weeklyItems.reduce((sum, item) => sum + Number(item.settledCostCny || 0), 0);
  const summary = data.review?.status === 'generated' ? data.review.summary : null;
  return <section aria-label="经营解读" className="col-span-full mx-5 mb-5 mt-2 rounded-xl bg-neutral-50 px-5 py-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3"><h2 className="flex items-center gap-2 text-base font-semibold text-text-primary"><TrendingUp size={18}/>经营解读</h2><span className="text-xs text-text-muted">{summary ? '基于本周经营复盘' : '基于当前周计划与执行记录'}</span></div>
      <div className="flex items-center gap-2"><Button type="link" onClick={onViewReview}>查看复盘</Button><Button type="text" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{expanded ? '收起' : '展开'}</Button></div>
    </header>
    {expanded && <div className="mt-3 space-y-2 text-sm leading-7 text-text-primary">
      <p><strong>当前进展：</strong>{data.goal ? `本周计划制作 ${display.totals.versionCount} 条视频，共 ${display.totals.durationSeconds} 秒；已完成 ${display.totals.completedCount} 条，待验收 ${display.totals.waitingReviewCount} 条。` : '尚未建立周经营计划，请先确定本周的视频产量与预算。'}</p>
      <ul className="list-disc space-y-1 pl-5">
        <li><strong>成本：</strong>{estimatedCost > 0 ? `已排期内容预计制作成本 ¥${estimatedCost.toFixed(2)}。` : '制作成本尚未核算。'}{settledCost > 0 ? `已结算 ¥${settledCost.toFixed(2)}。` : '当前暂无已结算成本。'}</li>
        <li><strong>执行：</strong>{display.totals.blockedCount > 0 ? `${display.totals.blockedCount} 条内容待处理，建议先进入制作工作台补齐条件。` : display.totals.waitingReviewCount > 0 ? '有成片等待验收，建议优先确认后续发布。' : '按周排期推进制作，并在成片生成后完成验收与发布确认。'}</li>
        {summary?.highlights.slice(0, 3).map((highlight, index) => <li key={index}>{highlight}</li>)}
        {summary?.nextGoalSuggestion && <li><strong>建议：</strong>{summary.nextGoalSuggestion}</li>}
      </ul>
      {!summary && <p className="text-xs text-text-muted">本周复盘尚未生成；暂不提供涨跌趋势或经营效果判断。</p>}
    </div>}
  </section>;
}

type DisplayMetricSource = "real" | "demo";

type UnifiedPlanContent = {
  id: string;
  contentId: string;
  familyId: string;
  title: string;
  caption: string;
  tags: string[];
  productName: string;
  thumbnailUrl: string;
  platform: Platform;
  accountId: string;
  accountLabel: string;
  plannedPublishDate: string;
  plannedPublishAt: string;
  duration: number;
  inspirationReference: WeeklyInspirationReference | null;
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

function contentThumbnailUrl(plan: VideoCreationPlan, queueItem: ContentQueueItem | null) {
  const previews = [queueItem?.preproduction, plan.preproduction];
  for (const preview of previews) {
    const storyboardFrame = preview?.materials.storyboard?.find(item => item.status === "ready" && item.materialPreviewUrl)?.materialPreviewUrl;
    if (storyboardFrame) return storyboardFrame;
    const readyMaterial = preview?.materials.items.find(item => item.type === "image" && item.status === "ready" && item.previewUrl)?.previewUrl;
    if (readyMaterial) return readyMaterial;
  }
  const thumbnailUrl = queueItem?.preproduction?.benchmark.thumbnailUrl
    || plan.preproduction?.benchmark.thumbnailUrl
    || plan.planningEvidence?.referenceThumbnailUrl
    || "";
  const sourceUrl = queueItem?.preproduction?.benchmark.sourceUrl
    || plan.preproduction?.benchmark.sourceUrl
    || plan.planningEvidence?.referenceSourceUrl
    || "";
  return thumbnailUrlWithSourceFallback(thumbnailUrl, sourceUrl);
}

function buildSmartBusinessDisplayModel(data: DigitalEmployeeOverview, selectedAccountId = ""): SmartBusinessDisplayModel {
  const showcaseTotals = isSmartBusinessShowcaseEnabled() ? SMART_BUSINESS_SHOWCASE_WEEKLY_TOTALS : null;
  // Older model responses sometimes persisted a structured title or its accidental
  // string coercion. Only named text fields are displayable; never stringify facts.
  const displayText = (value: unknown, depth = 0): string => {
    if (typeof value === "string") {
      const normalized = value.trim();
      return /\[object\s+[^\]]+\]|^(?:undefined|null|NaN)$/i.test(normalized) ? "" : normalized;
    }
    if (!value || typeof value !== "object" || Array.isArray(value) || depth >= 3) return "";
    const record = value as Record<string, unknown>;
    for (const key of ["title", "text", "headline", "name", "label", "zh-CN", "zh", "en"]) {
      const candidate = displayText(record[key], depth + 1);
      if (candidate) return candidate;
    }
    return "";
  };
  const operatingContext = data.plan?.businessPackage?.operatingContext;
  const packagePlans = data.plan?.businessPackage?.tasks.find(task => task.templateId === "production")?.videoPlans || [];
  const goalPlans = data.goal?.videoPlans || [];
  const sourcePlans = packagePlans.length ? packagePlans : goalPlans;
  const runMatches = Boolean(data.run && data.run.goal_id === data.goal?.id && data.run.plan_id === data.plan?.id);
  const queue = (data.contentQueue?.items || []).filter(item => item.origin === "weekly_plan"
    && Boolean(data.goal?.id && data.plan?.id)
    && item.lineage.goalId === data.goal!.id && item.lineage.planId === data.plan!.id
    && (item.taskId ? runMatches && data.tasks.some(task => task.id === item.taskId && task.run_id === data.run!.id)
      : !item.projectIds.length && (!data.run || runMatches)));
  const deliveries = data.deliveries || [];
  const connectedIds = new Set((data.config?.publishingTargets || []).map(target => target.accountId));
  const operatingAccounts = operatingContext?.accounts || [];
  const accountById = new Map(operatingAccounts.map(account => [account.accountId, account]));
  const targetById = new Map((data.config?.publishingTargets || []).map(target => [target.accountId, target]));
  const claimedQueueIds = new Set<string>();

  const findQueueItem = (plan: VideoCreationPlan) => {
    if (plan.contentId) {
      const direct = queue.filter(item => item.contentId === plan.contentId);
      if (direct.length === 1) {
        claimedQueueIds.add(direct[0]!.id);
        return direct[0];
      }
      // A stable content ID must not borrow another date/account's production.
      return undefined;
    }
    const candidates = queue.filter(item => !claimedQueueIds.has(item.id)
      && !item.contentId
      && item.platform === plan.platform
      && (!plan.matrix?.accountId || item.accountId === plan.matrix.accountId)
      && (!plan.plannedPublishDate || item.plannedPublishDate === plan.plannedPublishDate));
    const candidate = candidates.length === 1 ? candidates[0] : undefined;
    if (candidate) claimedQueueIds.add(candidate.id);
    return candidate;
  };
  const sharedProductionItem = (plan: VideoCreationPlan) => {
    if (plan.productionRole !== "platform_adaptation") return undefined;
    const masters = sourcePlans.filter(candidate => candidate.productionRole === "master"
      && (plan.masterContentId ? candidate.contentId === plan.masterContentId
        : Boolean(plan.contentFamilyId && candidate.contentFamilyId === plan.contentFamilyId))
      && (!plan.contentFamilyId || candidate.contentFamilyId === plan.contentFamilyId)
      && (!plan.productId || candidate.productId === plan.productId));
    if (masters.length !== 1 || !masters[0]!.contentId) return undefined;
    const candidates = queue.filter(item => item.contentId === masters[0]!.contentId);
    return candidates.length === 1 ? candidates[0] : undefined;
  };

  const plannedContents = sourcePlans.map((plan, index): UnifiedPlanContent => {
    const directQueueItem = findQueueItem(plan) || null;
    const queueItem = directQueueItem || sharedProductionItem(plan) || null;
    const referencePlan = referencePlanForPublication(sourcePlans, plan);
    const accountId = plan.matrix?.accountId || directQueueItem?.accountId || `plan-${plan.platform}`;
    const account = accountById.get(accountId);
    const target = targetById.get(accountId);
    const productName = displayText(plan.productName) || displayText(directQueueItem?.productName) || displayText(data.config?.focusProducts) || "待绑定产品";
    const referenceTitle = displayText(plan.planningEvidence?.referenceTitle) || displayText(plan.preproduction?.benchmark.title)
      || displayText(referencePlan.planningEvidence?.referenceTitle) || displayText(referencePlan.preproduction?.benchmark.title);
    const factualFallback = [productName === "待绑定产品" ? "" : productName, referenceTitle].filter(Boolean).join("｜");
    const title = displayText(plan.publication?.title) || displayText(plan.theme) || factualFallback || `本周视频 ${index + 1}`;
    const identity = plan.contentId || `${plan.platform}-${plan.plannedPublishDate}-${title}-${index}`;
    // Sharing production never copies the master's platform performance/publication.
    const actual = directQueueItem ? performanceForQueueItem(directQueueItem, deliveries) : null;
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
      title: engagingContentTitle(title, index),
      caption: displayText(plan.publication?.caption),
      tags: plan.publication?.tags || [],
      productName,
      thumbnailUrl: contentThumbnailUrl(plan, queueItem),
      platform: plan.platform,
      accountId,
      accountLabel: account?.accountLabel || target?.accountLabel || `${data.config?.companyName || "企业"} · ${platformLabels[plan.platform]}`,
      plannedPublishDate: plan.plannedPublishDate || data.goal?.endsAt || "",
      plannedPublishAt: plan.plannedPublishAt || (plan.plannedPublishDate ? `${plan.plannedPublishDate}T18:00:00+08:00` : ""),
      duration: Number(plan.duration || 0),
      inspirationReference: inspirationReferenceForPlan(referencePlan),
      productionRole: plan.productionRole === "platform_adaptation" ? "platform_adaptation" : "master",
      status: queueItem?.status || "planned",
      queueItem,
      metrics: { views, likes, comments, shares, interactions, engagementRate, source: hasActual ? "real" : "demo" },
    };
  });
  const manualContents = (data.contentQueue?.items || []).filter(item => item.origin === 'manual' && Boolean(item.socialContentTaskId)).map((item, index): UnifiedPlanContent => {
    const actual = performanceForQueueItem(item, deliveries);
    const fallback = demoMetrics(item.platform, item.contentId || item.id);
    const hasActual = Boolean(actual?.hasPlatformData);
    return {
      id: item.id,
      contentId: item.contentId,
      familyId: item.contentId,
      title: item.title,
      caption: '',
      tags: [],
      productName: item.productName,
      thumbnailUrl: '',
      platform: item.platform,
      accountId: item.accountId || `manual-${item.platform}`,
      accountLabel: item.accountLabel || `${data.config?.companyName || '企业'} · ${platformLabels[item.platform]}`,
      plannedPublishDate: item.plannedPublishDate || data.goal?.endsAt || '',
      plannedPublishAt: item.plannedPublishDate ? `${item.plannedPublishDate}T18:00:00+08:00` : '',
      duration: item.outputSummary.durationSeconds || 0,
      inspirationReference: null,
      productionRole: 'master',
      status: item.status,
      queueItem: item,
      metrics: {
        views: hasActual ? actual?.views || 0 : fallback.views,
        likes: hasActual ? actual?.likes || 0 : fallback.likes,
        comments: hasActual ? actual?.comments || 0 : fallback.comments,
        shares: hasActual ? actual?.shares || 0 : fallback.shares,
        interactions: hasActual ? actual?.interactions || 0 : fallback.interactions,
        engagementRate: hasActual ? actual?.engagementRate || 0 : fallback.engagementRate,
        source: hasActual ? 'real' : 'demo',
      },
    };
  });
  // Until weekly orders have real task bindings, show the tenant's actual content
  // executions instead of five generated placeholders that all appear unstarted.
  const mappedContents = queue.length ? plannedContents : manualContents.length ? manualContents : plannedContents;
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
    : contents.filter(item => item.status === "completed" && item.queueItem?.contentId === item.contentId).length;
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
      versionCount: showcaseTotals?.plannedVideoCount
        ?? (contents.length
          || operatingContext?.outputs.platformVersionCount
          || operatingContext?.outputs.count
          || 0),
      durationSeconds: contents.reduce((sum, item) => sum + item.duration, 0)
        || operatingContext?.outputs.totalDurationSeconds
        || 0,
      budgetMinCny: normalizedMin,
      budgetMaxCny: normalizedMax,
      budgetMidCny: fallbackBudget || (normalizedMin + normalizedMax) / 2,
      completedCount: contents.filter(item => item.status === "completed").length,
      waitingReviewCount: showcaseTotals?.waitingReviewCount
        ?? contents.filter(item => item.status === "waiting_review").length,
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
  return <Tag color={source === "real" ? "success" : "default"}>{source === "real" ? "真实回传" : "参考估算"}</Tag>;
}

function HomeView({ data, onNavigate, selectedAccountId = "", overviewRangeBusy = false, onOverviewRangeChange }: { data: DigitalEmployeeOverview; onNavigate?: (page: Page) => void; selectedAccountId?: string; overviewRangeBusy?: boolean; onOverviewRangeChange?: (range: BusinessHealthOverviewRange) => void }) {
  return <div className="space-y-6">
    <BusinessHealthOverview detailsOnly data={data} selectedAccountId={selectedAccountId} overviewRangeBusy={overviewRangeBusy} onOverviewRangeChange={onOverviewRangeChange} onNavigate={onNavigate}/>
    <NextRoundRecommendationsSection summary={data.review?.status === "generated" ? data.review.summary : undefined} industryTrends={data.industryTrends} onOpen={page => onNavigate?.(page as Page)}/>
  </div>;
}

function WeeklyPublishingCalendar({ data, onRefresh }: { data: DigitalEmployeeOverview; onRefresh?: () => void }) {
  const display = buildSmartBusinessDisplayModel(data);
  const calendarStatus: Record<ContentQueueItem["status"], LsCalendarEvent["status"]> = {
    planned: "planned",
    queued: "queued",
    producing: "working",
    waiting_review: "needs_action",
    completed: "done",
    blocked: "needs_action",
  };
  const calendarStatusLabel: Record<ContentQueueItem["status"], string> = {
    planned: "已计划",
    queued: "待制作",
    producing: "制作中",
    waiting_review: "待验收",
    completed: "已完成",
    blocked: "需要处理",
  };
  const calendarEvents: LsCalendarEvent[] = display.contents.map((item): LsCalendarEvent => ({
    id: `weekly-publish-${item.id}`,
    title: item.title,
    start: item.plannedPublishAt || (item.plannedPublishDate ? `${item.plannedPublishDate}T18:00:00+08:00` : `${display.startsAt}T18:00:00+08:00`),
    timeZone: "Asia/Shanghai",
    allDay: false,
    editable: Boolean(data.goal?.id && item.contentId && item.plannedPublishDate),
    status: calendarStatus[item.status],
    statusLabel: calendarStatusLabel[item.status],
    eventType: "publish",
    platform: item.platform,
    accountId: item.accountId,
    accountName: item.accountLabel,
    thumbnailUrl: item.thumbnailUrl,
    identity: { kind: "platform", platform: item.platform },
    sourceId: item.inspirationReference?.referenceId || item.contentId,
    description: `${item.productName} · ${item.caption || "发布文案待完善"}`,
    data: item,
  })).filter(event => Boolean(event.start));

  return <section aria-label="发布日历" className="overflow-hidden rounded-lg border border-border bg-white">
    <div className="border-b border-border px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="ls-type-title-large text-text-primary">发布日历</h3>
        <Tag>{calendarEvents.length} 项发布</Tag>
      </div>
    </div>
    <LsCalendar events={calendarEvents} label="本周发布日历" initialDate={display.startsAt ? calendarDayKey(display.startsAt) : undefined} date={display.startsAt ? calendarDayKey(display.startsAt) : undefined} initialView="timeGridWeek" showAllEvents fixedHeight="auto" workspaceMode="expanded" firstDay={display.startsAt ? calendarWeekday(display.startsAt) : 1} onMoveEvent={async (event, scheduledAt) => {
      const item = event.data as UnifiedPlanContent;
      if (!data.goal?.id || !item.contentId) throw new Error("当前内容缺少可调整的排期标识");
      await digitalEmployeeApi.reschedulePublication(data.goal.id, item.contentId, scheduledAt);
      onRefresh?.();
    }} detailsTitle="内容制作进度" detailsMedia="compact" renderDetails={(event, closeDetails) => {
      const item = event.data as UnifiedPlanContent;
      return <WeeklyContentProgressPanel key={item.contentId} data={data} contentId={item.contentId} onRefresh={onRefresh}
        onOpenWorkbench={closeDetails}
        onOpenReference={item.inspirationReference ? () => {
          closeDetails();
          window.dispatchEvent(new CustomEvent("lingshu:navigate", { detail: inspirationReferenceNavigationDetail(item.inspirationReference!, item.contentId) }));
        } : undefined}/>;
    }}/>
  </section>;
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


function MatrixView({ calendarTasks, calendarDemo, data, onRefresh, onOpenContent, onOpenAgentSettings }: { calendarTasks?: AgentCalendarTask[]; calendarDemo?: boolean; data: DigitalEmployeeOverview; onRefresh?: () => void; onNavigate?: (page: Page) => void; onGeneratePlan?: () => void; selectedAccountId?: string; onOpenContent?: (taskId?: string, socialContentTaskId?: string, projectId?: string) => void; onOpenAgentSettings?: () => void; onOpenProductionProgress?: (taskId: string, contentItemId: string, projectId?: string) => void; onRetryTask?: (taskId: string) => Promise<boolean> }) {
  const effectiveCalendarTasks = calendarTasks ?? (data.run ? projectWeeklyGoalCalendar(data) : undefined);
  return <DigitalEmployeeWorkspace data={data} calendarTasks={effectiveCalendarTasks} calendarDemo={calendarDemo} onRefresh={onRefresh} onOpenContent={onOpenContent} onOpenAgentSettings={onOpenAgentSettings} publishingCalendar={<WeeklyPublishingCalendar data={data} onRefresh={onRefresh}/>}/>;
}

function openTaskPreviewPage(item: ContentQueueItem, target: "benchmark" | "materials", onNavigate?: (page: Page) => void) {
  const pendingShoot = item.preproduction?.materials.pendingShootTaskIds[0];
  const benchmarkReference: WeeklyInspirationReference = {
    referenceId: String(item.preproduction?.benchmark.referenceId || item.referenceId || "").trim(),
    sourceUrl: String(item.preproduction?.benchmark.sourceUrl || "").trim(),
    title: String(item.preproduction?.benchmark.title || item.referenceTitle || item.title || "").trim(),
    platform: item.platform,
    thumbnailUrl: String(item.preproduction?.benchmark.thumbnailUrl || "").trim(),
    duration: Math.max(0, Number(item.outputSummary.durationSeconds || 0)),
  };
  const detail = target === "benchmark"
    ? inspirationReferenceNavigationDetail(benchmarkReference, item.id)
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

type AccountContentPerformanceRow = {
  id: string;
  title: string;
  subject: string;
  accountId: string;
  platform: Platform | null;
  productName: string;
  tags: string[];
  views: number;
  likes: number | null;
  comments: number | null;
  source: DisplayMetricSource;
};

function AccountContentPerformanceDetail({ data, display, selectedAccountId, platform, startsAt, endsAt, onNavigate }: {
  data: DigitalEmployeeOverview;
  display: SmartBusinessDisplayModel;
  selectedAccountId?: string;
  platform: "all" | Platform;
  startsAt: string;
  endsAt: string;
  onNavigate?: (page: Page) => void;
}) {
  const [performance, setPerformance] = useState<ConnectedSocialPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try { setPerformance(await loadConnectedSocialPerformance()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "账号内容数据读取失败"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const matchesPlatform = (value: Platform | null) => platform === "all" || value === platform;
  const matchesDate = (value: string) => {
    const date = value.slice(0, 10);
    return !startsAt || !endsAt || !date || date >= startsAt && date <= endsAt;
  };
  const liveRows: AccountContentPerformanceRow[] = (performance?.contents || [])
    .filter(item => (!selectedAccountId || item.accountId === selectedAccountId) && matchesPlatform(item.platform) && matchesDate(item.publishedAt) && item.metrics.views !== null)
    .map((item, index) => ({
      id: item.id,
      title: engagingContentTitle(item.title, index),
      subject: `${item.accountTitle} · 真实账号回传`,
      accountId: item.accountId,
      platform: item.platform,
      productName: "",
      tags: [],
      views: item.metrics.views || 0,
      likes: item.metrics.likes,
      comments: item.metrics.comments,
      source: "real",
    }));
  const deliveryRows: AccountContentPerformanceRow[] = selectedAccountId ? [] : (data.deliveries || [])
    .filter(card => matchesPlatform(deliveryPlatform(card)) && deliveryMetric(card, /播放|浏览|view/i) !== null)
    .map(card => ({
      id: card.id,
      title: card.title,
      subject: `${card.subject} · 经营交付记录`,
      accountId: "",
      platform: deliveryPlatform(card),
      productName: "",
      tags: [],
      views: deliveryMetric(card, /播放|浏览|view/i) || 0,
      likes: null,
      comments: null,
      source: "real",
    }));
  const plannedRows: AccountContentPerformanceRow[] = display.contents
    .filter(item => (!selectedAccountId || item.accountId === selectedAccountId) && matchesPlatform(item.platform) && matchesDate(item.plannedPublishDate))
    .map(item => ({
      id: item.id,
      title: item.title,
      subject: `${item.accountLabel} · 本周计划`,
      accountId: item.accountId,
      platform: item.platform,
      productName: item.productName,
      tags: item.tags,
      views: item.metrics.views,
      likes: item.metrics.likes,
      comments: item.metrics.comments,
      source: item.metrics.source,
    }));
  const rows = (liveRows.length ? liveRows : deliveryRows.length ? deliveryRows : plannedRows)
    .sort((left, right) => right.views - left.views);
  const unavailableCount = performance?.unavailable.length || 0;

  return <section aria-labelledby="account-content-performance-title" className="overflow-hidden rounded-lg border border-border bg-white">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
      <div className="flex flex-wrap items-center gap-2"><h2 id="account-content-performance-title" className="text-lg font-semibold">账号内容表现明细</h2><Tag>{platform === "all" ? "全部平台" : platformLabels[platform]}</Tag><Tag>同步 {dateLabel(performance?.loadedAt)}</Tag></div>
      <Button loading={loading} icon={<RefreshCcw size={15}/>} onClick={() => void refresh()}>同步账号表现</Button>
    </header>
    {(error || unavailableCount > 0) && <div className="px-5 pt-5"><Alert type="warning" showIcon title={error || `${unavailableCount} 个账号暂时无法同步；已保留其他账号的真实数据。`} action={<Button onClick={() => onNavigate?.("accountManagement")}>检查账号授权</Button>}/></div>}
    <div className="p-5"><Table<AccountContentPerformanceRow> rowKey="id" dataSource={rows} loading={loading && !rows.length} pagination={{ pageSize: 8, showSizeChanger: false, showTotal: total => `共 ${total} 条` }} columns={[
      { title: "内容", key: "content", render: (_, item) => <div><p className="font-medium">{item.title}</p>{item.productName && <p className="mt-1 text-xs text-text-secondary">产品：{item.productName}</p>}{item.tags.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{item.tags.slice(0, 6).map(tag => <span key={tag} className="text-xs font-medium text-accent">#{tag}</span>)}</div>}<p className="mt-1 flex items-center gap-1 text-xs text-text-secondary">{item.platform && <SocialPlatformIcon platform={item.platform} size={14}/>}<span>{item.platform ? `${platformLabels[item.platform]} · ` : ""}{item.subject}</span></p><div className="mt-1"><PlanDataSourceBadge source={item.source}/></div></div> },
      { title: "播放量", dataIndex: "views", align: "right", sorter: (a, b) => a.views - b.views, defaultSortOrder: "descend", render: value => metricValue(value) },
      { title: "点赞", dataIndex: "likes", align: "right", responsive: ["md"], sorter: (a, b) => (a.likes ?? -1) - (b.likes ?? -1), render: value => metricValue(value) },
      { title: "评论", dataIndex: "comments", align: "right", responsive: ["md"], sorter: (a, b) => (a.comments ?? -1) - (b.comments ?? -1), render: value => metricValue(value) },
    ]}/></div>
  </section>;
}

function ContentGenerationProgress({ data, selectedAccountId = "", onOpenContent, onOpenProductionProgress, onRetryTask }: {
  data: DigitalEmployeeOverview;
  selectedAccountId?: string;
  onOpenContent?: (taskId?: string, socialContentTaskId?: string, projectId?: string) => void;
  onOpenProductionProgress?: (taskId: string, contentItemId: string, projectId?: string) => void;
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
    <div className="mt-4 grid gap-3 lg:grid-cols-2">{pageItems.map(item => { const currentStep = item.steps.find(step => step.state === "active") || item.steps.find(step => step.state !== "done") || item.steps.at(-1); return <article key={item.id} className="rounded-lg border border-slate-200 bg-slate-50/50 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><SocialPlatformIcon platform={item.platform} size={15}/><span className="text-[9px] font-semibold text-zinc-500">{platformLabels[item.platform]}</span><span className={`rounded-full px-2 py-1 text-[8px] font-semibold ${statusTone[item.status]}`}>{statusLabel[item.status]}</span><span className="text-[9px] text-slate-400">{item.plannedPublishDate || "待排期"}</span></div><h3 className="mt-2 truncate text-sm font-semibold text-slate-950">{item.title}</h3><p className="mt-1 truncate text-[10px] text-slate-500">{item.accountLabel || "仅制作"} · {item.productName || "待绑定产品"}</p></div><strong className="shrink-0 text-sm text-slate-800">{item.progress}%</strong></div><LsGradientProgress className="mt-3" percent={item.progress} showInfo={false} size="small" status={item.status === "blocked" ? "exception" : item.status === "completed" ? "success" : "active"}/><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-[9px] font-bold text-slate-500">{currentStep ? `${currentStep.responsibleAgent} · ${currentStep.label} · ${productionDurationLabel(currentStep.estimatedMinutes)}` : "等待经营 Agent 派发"}</p><div className="flex gap-2">{item.status === "blocked" && onRetryTask && item.taskId&&<Button htmlType="button" disabled={retryingTaskId === item.taskId} onClick={()=>void retry(item)} className="!h-auto min-h-9 !whitespace-normal rounded-lg bg-amber-400 px-2.5 py-1.5 text-[9px] font-semibold text-amber-950 disabled:opacity-40">{retryingTaskId === item.taskId ? "重试中…" : "重新生成"}</Button>}{onOpenProductionProgress&&<Button htmlType="button" onClick={()=>onOpenProductionProgress(item.taskId,item.id,item.projectIds[0])} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[9px] font-semibold text-slate-700">{item.origin === "weekly_plan" ? "进入内容制作" : "查看完整进度"}</Button>}<Button htmlType="button" onClick={()=>onOpenContent?.(item.taskId||undefined,item.socialContentTaskId||undefined,item.projectIds[0])} className="!h-auto min-h-9 !whitespace-normal rounded-lg bg-slate-950 px-2.5 py-1.5 text-[9px] font-semibold text-white">进入制作台</Button></div></div>{item.reason&&<p className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-[9px] font-bold text-red-700">{item.reason}</p>}</article>;})}</div>
    {!filtered.length&&<div className="mt-4 rounded-lg border border-dashed border-slate-200 px-5 py-12 text-center"><Clapperboard size={24} className="mx-auto text-slate-300"/><p className="mt-2 text-xs font-bold text-slate-500">当前筛选下没有视频任务</p></div>}
    {totalPages>1&&<nav aria-label="生成进度分页" className="mt-4 flex items-center justify-between"><p className="text-[9px] font-bold text-slate-400">第 {page}/{totalPages} 页 · {filtered.length} 条</p><div className="flex gap-2"><Button htmlType="button" disabled={page===1} onClick={()=>setPage(current=>Math.max(1,current-1))} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 px-3 py-1.5 text-[9px] font-semibold disabled:opacity-40">上一页</Button><Button htmlType="button" disabled={page===totalPages} onClick={()=>setPage(current=>Math.min(totalPages,current+1))} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 px-3 py-1.5 text-[9px] font-semibold disabled:opacity-40">下一页</Button></div></nav>}
  </section>;
}


function ProductionDetailView({ data, contentItemId, onBack, onNavigate, onOpenContent, onRetryTask, onRefresh }: {
  data: DigitalEmployeeOverview;
  contentItemId?: string;
  onBack?: () => void;
  onNavigate?: (page: Page) => void;
  onOpenContent?: (taskId?: string, socialContentTaskId?: string, projectId?: string) => void;
  onRetryTask?: (taskId: string) => Promise<boolean>;
  onRefresh?: () => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const directItems = data.contentQueue?.items.filter(candidate => candidate.id === contentItemId) || [];
  const taskItems = data.contentQueue?.items.filter(candidate => candidate.taskId && candidate.taskId === contentItemId) || [];
  // A shared weekly task must never silently select the first sibling content.
  const item = directItems.length === 1 ? directItems[0] : !directItems.length && taskItems.length === 1 ? taskItems[0] : null;
  if (!item) return <section className="rounded-lg border border-slate-200 bg-white p-8 text-center">
    <Clapperboard size={30} className="mx-auto text-slate-300"/>
    <h2 className="mt-3 text-base font-semibold text-slate-900">没有找到这条内容的制作记录</h2>
    <p className="mt-1 text-xs text-slate-500">任务可能尚未进入制作队列，或当前计划已经更新。</p>
    <Button htmlType="button" onClick={onBack} className="!h-auto min-h-9 !whitespace-normal mt-5 rounded-lg bg-slate-950 px-4 py-2.5 text-xs font-semibold text-white">返回数据复盘</Button>
  </section>;

  if (item.origin === "weekly_plan") {
    return <WeeklyProductionStudioEntry key={`${data.goal?.id}:${data.plan?.id}:${data.run?.id}:${item.id}`} data={data} contentId={item.contentId} autoOpen onOpened={onBack} onUnavailable={onBack} />;
  }

  const statusLabel: Record<ContentQueueItem["status"], string> = {
    planned: "计划已生成", queued: "等待制作", producing: "制作中", waiting_review: "等待验收", completed: "已完成", blocked: "制作受阻",
  };
  const executionJob = data.executionRuntime?.jobs.find(job => job.taskId === item.socialContentTaskId)
    || data.executionRuntime?.jobs.find(job => job.taskId === item.taskId)
    || null;
  const currentProductionStep = item.steps.find(step => step.state === "active") || item.steps.at(-1);
  const remainingSteps = item.steps.filter(step => step.state !== "done");
  const remainingProductionMinutes = remainingSteps.every(step => typeof step.estimatedMinutes === "number" && Number.isFinite(step.estimatedMinutes) && step.estimatedMinutes >= 0) ? remainingSteps.reduce((sum, step) => sum + step.estimatedMinutes, 0) : null;
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
        <div className="min-w-0"><Button htmlType="button" onClick={onBack} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600"><ArrowLeft size={12}/>返回数据复盘</Button><div className="mt-3 flex flex-wrap items-center gap-2"><span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[9px] font-semibold">视频任务</span><span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[9px] font-semibold">{platformLabels[item.platform]}</span><span className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${item.status === "blocked" ? "bg-red-500 text-white" : item.status === "completed" ? "bg-emerald-400 text-emerald-950" : "bg-sky-400 text-sky-950"}`}>{statusLabel[item.status]}</span></div><h2 className="mt-3 text-xl font-semibold">{item.title}</h2><p className="mt-1 text-xs text-zinc-500">{item.productName || "待绑定产品"} · {item.accountLabel || "仅制作"} · {item.languages.join(" / ").toUpperCase() || "语言待确认"}</p></div>
        <div className="flex flex-wrap gap-2">{item.status === "blocked"&&item.taskId&&onRetryTask&&<Button htmlType="button" disabled={retrying} onClick={() => void retryCurrentTask()} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 text-xs font-semibold text-amber-950 disabled:opacity-50">{retrying&&<Loader2 size={13} className="animate-spin"/>}从当前节点重试</Button>}<Button htmlType="button" onClick={() => onOpenContent?.(item.taskId || undefined, item.socialContentTaskId || undefined, item.projectIds[0])} className="!h-auto min-h-9 !whitespace-normal rounded-lg bg-white px-4 py-2.5 text-xs font-semibold text-slate-950">进入制作台</Button>{item.referenceId&&onNavigate&&<Button htmlType="button" onClick={() => onNavigate("socialInspiration")} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-xs font-semibold text-blue-600">核对参考视频</Button>}</div>
      </header>
      <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-6">
        {[
          ["当前节点", currentProductionStep?.label || item.stage],
          ["当前责任人", currentProductionStep?.responsibleAgent || "待分配"],
          ["整体进度", `${item.progress}%`],
          ["剩余预计时间", item.status === "completed" && !remainingSteps.length ? "已完成" : !remainingSteps.length ? "工期待核验" : productionDurationLabel(remainingProductionMinutes)],
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
        <section className="rounded-lg border border-slate-200 bg-white p-5"><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-slate-400">业务血缘</p><dl className="mt-3 space-y-2 text-xs">{[["经营目标",item.lineage.objective||"内容交付"],["发布账号",item.lineage.accountLabel||"仅制作"],["计划版本",item.lineage.planId?`v${item.lineage.planVersion||1}`:"未关联周计划"],["授权方式",item.lineage.authorizationMode==="bounded"?"范围授权":item.lineage.authorizationMode==="each"?"逐次确认":"单次任务授权"]].map(([label,value])=><div key={label} className="grid grid-cols-[72px_1fr] gap-2"><dt className="text-slate-400">{label}</dt><dd className="font-bold leading-5 text-slate-700">{value}</dd></div>)}</dl></section>
      </aside>
    </section>

    {data.run&&item.taskId&&<ProductionTaskScene runId={data.run.id} taskId={item.taskId} embedded/>}
  </div>;
}


export default function SmartBusinessDashboard({ calendarTasks, calendarDemo, data, view, selectedAccountId, selectedContentItemId, overviewRangeBusy, onOverviewRangeChange, onRefresh, onNavigate, onGeneratePlan, onGenerateDetails, onOpenContent, onOpenAgentSettings, onOpenProductionProgress, onBackToQueue, onRetryTask, onControlJob }: { calendarTasks?: AgentCalendarTask[]; calendarDemo?: boolean; data: DigitalEmployeeOverview; view: SmartBusinessView; selectedAccountId?: string; selectedContentItemId?: string; overviewRangeBusy?: boolean; onOverviewRangeChange?: (range: BusinessHealthOverviewRange) => void; onRefresh?: () => void; onNavigate?: (page: Page) => void; onGeneratePlan?: () => void; onGenerateDetails?: () => void; onOpenContent?: (taskId?: string, socialContentTaskId?: string, projectId?: string) => void; onOpenAgentSettings?: () => void; onOpenProductionProgress?: (taskId: string, contentItemId: string, projectId?: string) => void; onBackToQueue?: () => void; onRetryTask?: (taskId: string) => Promise<boolean>; onControlJob?: (jobId: string, action: ExecutionControlAction) => Promise<boolean> }) {
  if (view === "matrix") return <MatrixView calendarTasks={calendarTasks} calendarDemo={calendarDemo} data={data} selectedAccountId={selectedAccountId} onRefresh={onRefresh} onNavigate={onNavigate} onGeneratePlan={onGeneratePlan} onOpenContent={onOpenContent} onOpenAgentSettings={onOpenAgentSettings} onOpenProductionProgress={onOpenProductionProgress} onRetryTask={onRetryTask}/>;
  if (view === "production") return <ProductionDetailView data={data} contentItemId={selectedContentItemId} onBack={onBackToQueue} onNavigate={onNavigate} onOpenContent={onOpenContent} onRetryTask={onRetryTask} onRefresh={onRefresh}/>;
  if (view === "review") return <BusinessDataReview data={data} selectedAccountId={selectedAccountId} onNavigate={onNavigate} onOpenContent={onOpenContent} onOpenProductionProgress={onOpenProductionProgress}/>;
  return <HomeView data={data} selectedAccountId={selectedAccountId} overviewRangeBusy={overviewRangeBusy} onOverviewRangeChange={onOverviewRangeChange} onNavigate={onNavigate}/>;
}
