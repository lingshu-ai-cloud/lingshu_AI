import type { AgentCalendarTask } from "./smartBusiness/AgentWeeklyCalendar";
import { Alert, Button, Drawer, Empty, Modal, Segmented, Select, Statistic, Table, Tabs, Tag, Timeline } from "antd";
import LsDataChart from "./ui/LsDataChart";
import { LsGradientProgress } from "./ui/LsExperiencePrimitives";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  CalendarRange,
  CheckCircle2,
  CircleDollarSign,
  Clapperboard,
  Eye,
  LayoutGrid,
  Loader2,
  MessageSquareText,
  Megaphone,
  Pencil,
  RefreshCcw,
  Send,
  TrendingUp,
  Trophy,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { digitalEmployeeApi, type ContentExecutionRuntimeJob, type ContentQueueItem, type DigitalEmployeeOverview, type DigitalEmployeeAgentRole, type NextRoundRecommendations, type PlanTask, type WeeklyReviewSummary } from "../lib/digitalEmployees";
import type { DeliveryResource } from "../lib/delivery";
import type { Page } from "../pageRegistry";
import { SocialPlatformIcon } from "./SocialPlatformIcon";
import { showActionSuccess } from "../lib/actionFeedback";
import AgentRoleIcon from "./ui/AgentRoleIcon";
import WeeklyMatrixEditor from "./WeeklyMatrixEditor";
import type { WeeklyPackage } from "../lib/weeklyPackage";
import { defaultMatrixPlan, fillMatrixVideos } from "../lib/weeklyMatrix";
import { VIDEO_PRESENTATIONS, type VideoCreationPlan, type VideoPreproductionPreview } from "../lib/videoCreationPlan";
import { MATERIAL_TYPE_LABELS, SHOT_ROLE_LABELS } from "../../shared/benchmarkAnalysis";import { SOCIAL_PLATFORM_EXECUTION_RULES, socialOperatingProfile } from "../../shared/contracts/socialOperatingProfile";
import { MASTER_VIDEO_COST_MAX_CNY, MASTER_VIDEO_COST_MIN_CNY, MASTER_VIDEO_COST_POINT_CNY } from "../../shared/contracts/contentCostModel";
import { loadConnectedSocialPerformance, type ConnectedSocialPerformance } from "../lib/socialPerformance";
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
import { applySmartBusinessShowcaseData, isSmartBusinessOverviewPreviewEnabled, isSmartBusinessShowcaseEnabled, isSmartBusinessWeeklyPlanPreviewEnabled, smartBusinessShowcaseAds, smartBusinessShowcaseNextRoundRecommendations, smartBusinessShowcaseWeeklyVideos, SMART_BUSINESS_SHOWCASE_WEEKLY_TOTALS } from "../dev/smartBusinessShowcaseData";
import { TaskPreviewCards } from "./smartBusiness/TaskPreviewCards";
import { buildSmartBusinessDisplayModel, engagingContentTitle, inspirationReferenceNavigationDetail, platformLabels, platformOptions, weeklyVideoBudget, type DisplayMetricSource, type Platform, type SmartBusinessDisplayModel, type UnifiedPlanContent } from './smartBusiness/smartBusinessDisplayModel';
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

const runningStatuses = new Set(["running", "active", "planning", "waiting_external"]);


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

  return <Drawer open title={`${agentCard.name} · 生产实况`} onClose={onClose} size={560}>
    <p className="mb-5 text-sm text-text-secondary">{currentTask}</p>
    <div className="grid grid-cols-2 gap-5 border-y border-border py-5">
      <Statistic title="当前进度" value={completed} suffix={`/ ${total}`}/>
      <Statistic title="已完成交付" value={completed} suffix="项"/>
    </div>
    <p className="mt-3 text-xs text-text-muted">用户积分统一在“套餐与积分”中展示；供应商成本仅用于后台成本优化。</p>
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

export { WeeklyCommandCenter, WeeklyPlanDetailsDrawer } from './smartBusiness/WeeklyPlanPresentation';
export function BusinessInterpretation({ data, onViewReview }: { data: DigitalEmployeeOverview; onViewReview: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const display = buildSmartBusinessDisplayModel(data);
  const weeklyItems = (data.contentQueue?.items || []).filter(item => item.origin === 'weekly_plan');
  const packageBudget = weeklyVideoBudget(data);
  const useShowcaseBudget = (isSmartBusinessShowcaseEnabled() || isSmartBusinessWeeklyPlanPreviewEnabled()) && display.contents.length === SMART_BUSINESS_SHOWCASE_WEEKLY_TOTALS.plannedVideoCount;
  const estimatedCost = useShowcaseBudget ? display.totals.budgetMidCny : Math.max(
    weeklyItems.reduce((sum, item) => sum + Number(item.estimatedCostCny || 0), 0),
    packageBudget.estimated,
  );
  const settledCost = weeklyItems.reduce((sum, item) => sum + Number(item.settledCostCny || 0), 0);
  const summary = data.review?.status === 'generated' ? data.review.summary : null;
  return <section aria-label="经营解读" className="col-span-full mx-5 mb-5 mt-2 rounded-xl bg-neutral-50 px-5 py-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3"><h2 className="flex items-center gap-2 text-base font-semibold text-text-primary"><TrendingUp size={18}/>经营解读</h2><span className="text-xs text-text-muted">{summary ? '基于本周经营复盘' : '基于当前周计划与执行记录'}</span></div>
      <div className="flex items-center gap-2"><Button type="text" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{expanded ? '收起' : '展开'}</Button></div>
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


function PlanDataSourceBadge({ source }: { source: DisplayMetricSource }) {
  return <Tag color={source === "real" ? "success" : "default"}>{source === "real" ? "真实回传" : "参考估算"}</Tag>;
}

function HomeView({ data, onNavigate, selectedAccountId = "", overviewRangeBusy = false, onOverviewRangeChange }: { data: DigitalEmployeeOverview; onNavigate?: (page: Page) => void; selectedAccountId?: string; overviewRangeBusy?: boolean; onOverviewRangeChange?: (range: BusinessHealthOverviewRange) => void }) {
  const useOverviewPreview = isSmartBusinessOverviewPreviewEnabled();
  const overviewData = useOverviewPreview ? applySmartBusinessShowcaseData(data, true) : data;
  const previewRecommendations = smartBusinessShowcaseNextRoundRecommendations(overviewData, useOverviewPreview || isSmartBusinessShowcaseEnabled());
  return <div className="space-y-6">
    <BusinessHealthOverview detailsOnly data={overviewData} selectedAccountId={selectedAccountId} overviewRangeBusy={overviewRangeBusy} onOverviewRangeChange={onOverviewRangeChange} onNavigate={onNavigate}/>
    <NextRoundRecommendationsSection summary={overviewData.review?.status === "generated" ? overviewData.review.summary : undefined} recommendations={previewRecommendations || undefined} industryTrends={previewRecommendations?.industryTrends || overviewData.industryTrends} onOpen={page => onNavigate?.(page as Page)}/>
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
  return <DigitalEmployeeWorkspace data={data} calendarTasks={calendarTasks} calendarDemo={calendarDemo} onRefresh={onRefresh} onOpenContent={onOpenContent} onOpenAgentSettings={onOpenAgentSettings} publishingCalendar={<WeeklyPublishingCalendar data={data} onRefresh={onRefresh}/>}/>;
}


const DAY_MS = 86_400_000;

function shiftIsoDate(value: string, days: number) {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) ? new Date(time + days * DAY_MS).toISOString().slice(0, 10) : "";
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
