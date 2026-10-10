import { getScrollBehavior } from "../lib/usePrefersReducedMotion";
import { PAGE_REGISTRY } from "../pageRegistry";
import InitialPreparationStatusPanel from './InitialPreparationStatusPanel';
import InitialOperatingPlanDialog from './InitialOperatingPlanDialog';
import { initialOperatingPlanFingerprint, recommendFocusProducts, initialPlanVideoPlans, initialPlanMatrixRows, type InitialOperatingPlan } from '../lib/initialOperatingPlan';
import EnterprisePresenters from "./enterprise/EnterprisePresenters";
import ManagedPublishingGrantEditor from './ManagedPublishingGrantEditor';
import { Alert, Button, Modal, Tabs } from 'antd';
import { managedPublishingGrantErrors } from '../../shared/contracts/managedPublishingGrant';
import KnowledgeIntakePanel from "./enterprise/KnowledgeIntakePanel";
import { normalizeContinuationPolicy, recommendedContinuationPolicy } from '../lib/continuationPolicy';
import WeeklyReviewPanel from "./WeeklyReviewPanel";
import { agentExecutionSummary } from '../lib/agentExecutionSummary';
import { taskNeedsAttention, taskWaitLabels, type TaskWaitState } from '../lib/taskExecutionState';
import OperatingAssessmentEditor from './OperatingAssessmentEditor';
import { maturityLabels, maturityProfiles, assessMaturity, gapLabels } from '../lib/operatingMaturity';
import ProductionProgressPanel from './ProductionProgressPanel';
import { consumeBusinessPageContext, saveBusinessPageContext } from '../lib/businessPageNavigation';
import WeeklyPackagePanel from "./WeeklyPackagePanel";
import { nodeDeepLink } from './WeeklyExecutionNodes';
import { agentRuleFields } from '../lib/agentRuleFields';
import VideoPlanEditor from './VideoPlanEditor';
import { videoPlanErrors } from '../lib/videoCreationPlan';
import {
  buildPresetMatrixVideoPlans,
  WEEKLY_TASK_PACKAGE_PRESETS,
  weeklyTaskPackagePreset,
  type WeeklyTaskPackagePresetId,
} from '../lib/weeklyTaskPackagePresets';
import { defaultMatrixPlan } from '../lib/weeklyMatrix';
import DeliveryBoard from "./DeliveryBoard";
import ProductionTaskScene from "./ProductionTaskScene";
import AgentDecisionCard, { type AgentDecisionKind } from "./AgentDecisionCard";
import SmartBusinessDashboard, { WeeklyCommandCenter } from "./SmartBusinessDashboard";
import SmartOperationsAccountRail, { type SmartOperationsAccount } from "./SmartOperationsAccountRail";
import WeeklyPlanCalendar from "./smartBusiness/WeeklyPlanCalendar";
import PlanHistoryDialog from "./PlanHistoryDialog";
import SocialContentStageOnboarding from "./socialContent/SocialContentStageOnboarding";
import { LsBrandAction, LsFlowDialog } from "./ui/LsExperiencePrimitives";
import {
  saveSocialContentStage,
  socialContentStageProfile,
  type SocialContentStageId,
} from "../lib/socialContentStage";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  BrainCircuit,
  CalendarRange,
  Check,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileSpreadsheet,
  FileCheck2,
  Hand,
  History,
  Eye,
  Heart,
  Layers3,
  Loader2,
  MonitorPlay,
  MessageSquare,
  MousePointer2,
  Pause,
  Play,
  Radio,
  RefreshCcw,
  RotateCcw,
  Search,
  Send,
  Share2,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { authHeader } from "../lib/auth";
import { showActionSuccess } from "../lib/actionFeedback";
import { socialDiscoveryApi } from "../lib/socialDiscoveryApi";
import type { SocialCrawlStrategy } from '../../shared/contracts/socialContentWorkflow';
import EnterpriseProductMultiSelect, { splitSelectedProducts } from './EnterpriseProductMultiSelect';
// EnterpriseProductMultiSelect owns the searchable listbox contract: aria-multiselectable="true" · 搜索企业知识库产品或型号.
import { heuristicProductMapping, mapRowToProduct, parseWorkbook, prepareSheet } from "../lib/productImport";
import {
  buildTaskDeepLink,
  agentCursorPercent,
  agentUiActionFromEvent,
  consumeDigitalEmployeeReturnContext,
  digitalEmployeeApi,
  dispatchDigitalEmployeeDeepLink,
  streamRunEvents,
  type AgentUiAction,
  type BusinessDestination,
  type BusinessSnapshot,
  type BusinessMetric,
  type BusinessReadinessItem,
  type DataAvailability,
  type DigitalEmployeeConfig,
  type DigitalEmployeeDeepLink,
  type DigitalEmployeeOverview,
  type DigitalEmployeeWorkflow,
  type PlanTask,
  type PublishingTarget,
  type RunEvent,
  type WeeklyGoal,
  type WorkflowTask,
} from "../lib/digitalEmployees";

const EMPTY_CONFIG: DigitalEmployeeConfig = {
  smartOperationsEnabled: true,
  companyName: "",
  industry: "",
  primaryBusiness: "",
  targetMarkets: "",
  customerProfile: "",
  operatingMaturity: "starting",
  socialOperatingProfile: "starter_four_platform",
  defaultParticipation: "agent",
  autonomyMode: "managed",
  approvalOwner: "",
  constraints: [
    "禁止未经确认的价格、交期和效果承诺",
    "所有真实对外发布必须人工审批",
  ],
  team: ["orchestrator", "business", "director", "content", "customer"],
  primaryGoal: "leads",
  focusProducts: "",
  enabledWorkflows: [
    "scheduled_social",
    "viral_clone",
    "content_publish",
    "customer_segmentation",
    "batch_followup",
  ],
  socialCadence: "YouTube、TikTok、Instagram、Facebook；公开行业关键词与已确认对标账号；近 7 天；每天 09:00；每次最多 20 条；按链接与标题去重 30 天；每周生成 5 条发布草稿，发布前人工审批",
  continuationPolicy: recommendedContinuationPolicy,
  followupCadence: "每周五 09:00 生成分层跟进草稿；17:00 前审批；仅在客户当地工作日 09:00–18:00 发送；同一客户 7 天最多 1 次",
  reviewSchedule: "周五 17:30（北京时间）；数据截止 17:00；通知审批负责人；仅生成复盘和下周任务草稿",
  publishingTargets: [],
  allowGeneratedVisuals: false,
  allowRealPublishing: false,
  allowRealCustomerMessages: false,
  approvalPolicy: {
    contentPublish: true,
    batchFollowup: true,
    commercialCommitment: true,
  },
  agentApprovalPolicies: {
    business: { activatePlan: true, changeGoalScope: true },
    industry: { addUnverifiedSource: true, expandCollectionScope: true },
    content: { contentPublish: true, factualClaims: true },
    customer: { batchFollowup: true, commercialCommitment: true },
  },
};

const workflowOptions: Array<{
  id: DigitalEmployeeWorkflow;
  label: string;
  detail: string;
  dependency?: string;
}> = [
  {
    id: "scheduled_social",
    label: "定时社媒采集",
    detail: "关键词、平台与对标账号",
  },
  {
    id: "viral_clone",
    label: "爆款裂变",
    detail: "从爆款证据和精确分析进入创作",
  },
  {
    id: "content_publish",
    label: "内容发布",
    detail: "审批后进入发布日历",
    dependency: "依赖社媒视频制作",
  },
  {
    id: "customer_segmentation",
    label: "客户分层",
    detail: "生成可审计客群快照",
  },
  {
    id: "batch_followup",
    label: "批量跟进",
    detail: "逐客草稿与整批审批",
    dependency: "依赖客户分层",
  },
];

const workflowLabel: Record<DigitalEmployeeWorkflow, string> = {
  ...Object.fromEntries(workflowOptions.map((option) => [option.id, option.label])),
  // Kept only for rendering historic saved configurations.
  product_content: "历史：使用产品生成",
  material_content: "历史：使用素材生成",
} as Record<DigitalEmployeeWorkflow, string>;
const contentCreationWorkflows: DigitalEmployeeWorkflow[] = [
  "viral_clone",
];
const legacyFreeCreationWorkflows: DigitalEmployeeWorkflow[] = ["product_content", "material_content"];

function synchronizeThemeContentWorkflows(
  workflows: DigitalEmployeeWorkflow[],
): DigitalEmployeeWorkflow[] {
  const hadLegacyContent = workflows.some(item => legacyFreeCreationWorkflows.includes(item));
  const cleaned = workflows.filter(item => !legacyFreeCreationWorkflows.includes(item));
  return hadLegacyContent && !cleaned.includes("viral_clone") ? [...cleaned, "viral_clone"] : cleaned;
}

const agentRoleGroups: Array<{
  id: "orchestrator" | "business" | "director" | "content" | "customer";
  label: string;
  responsibility: string;
  outputs: string;
  workflows: DigitalEmployeeWorkflow[];
}> = [
  { id: "orchestrator", label: "灵小枢 · 统筹 Agent", responsibility: "读取企业上下文、拆解本周目标，协调四个专业 Agent 并跟踪任务状态", outputs: "执行上下文、周目标、任务编排与异常提醒", workflows: [] },
  { id: "business", label: "经营 Agent", responsibility: "负责发布审批、发布日历、平台回执和周度经营复盘", outputs: "发布计划、真实回执、经营结果与复盘报告", workflows: ["content_publish"] },
  { id: "director", label: "编导 Agent", responsibility: "逐镜分析爆款参考，重点拆解前三秒钩子，锁定可复刻的脚本、口播、字幕、分镜、音乐节奏和验收规则", outputs: "参考视频分析、逐镜复刻脚本、素材映射、替代方案与验收规则", workflows: ["scheduled_social", "viral_clone"] },
  { id: "content", label: "内容 Agent", responsibility: "执行已锁定的导演方案，按镜头选择真实素材、数字人、授权素材和生成模型，完成配音、字幕、剪辑、混音、封面和技术质检", outputs: "可播放成片、字幕与音轨、封面、平台版本和质检报告", workflows: [] },
  { id: "customer", label: "客服 Agent", responsibility: "承接真实询盘、完成客户分层，并按客户上下文生成跟进草稿", outputs: "客户标签、回复草稿、跟进批次、转人工提醒", workflows: ["customer_segmentation", "batch_followup"] },
];

const destinationLabel: Record<BusinessDestination, string> = {
  enterprise: "企业资料",
  accountManagement: "社媒账号",
  plugins: "集成中心",
  scheduled: "定时任务",
  socialInspiration: "爆款灵感",
  scriptLibrary: "话术库",
  smartAssets: "内容工作台",
  conversion: "客户工作台",
  digitalEmployees: "数字员工驾驶舱",
};

const capabilityLabel: Record<string, string> = {
  "enterprise.readiness": "核对企业知识库与授权资产",
  "workflow.plan": "拆解并锁定周计划",
  "scheduler.social_collection": "建立社媒采集调度",
  "inspiration.exact_analysis": "筛选有完整证据的爆款",
  "studio.mode_routing": "确认创作主题与待拍素材",
  "studio.production": "执行脚本、素材与成片生产",
  "studio.quality_gate": "校验内容质量与事实",
  "publishing.delivery": "等待平台真实发布回执",
  "customer.segment_snapshot": "冻结可审计客户分层",
  "customer.followup_delivery": "按安全规则执行跟进",
  "review.weekly_business": "生成经营复盘与改进草案",
  "foundation.context_readiness": "核对企业经营资料",
  "planning.goal_decomposition": "拆解周目标",
  "social.collection": "采集社媒内容",
  "social.viral_analysis": "分析爆款证据",
  "content.routing": "匹配主题与待拍素材",
  "content.production": "生成内容作品",
  "content.quality_gate": "内容质检",
  "publishing.approval": "发布审批",
  "publishing.calendar": "发布排期",
  "publishing.platform": "平台发布",
  "customer.attribution": "客户来源归因",
  "customer.segmentation": "客户分层",
  "customer.followup_drafts": "逐客生成跟进草稿",
  "customer.followup_approval": "整批跟进审批",
  "customer.followup_dispatch": "按逐客条件发送",
  "review.weekly": "生成本周复盘",
};

const statusSourceLabel: Record<string, string> = {
  "enterprise/profile + platform accounts": "企业知识库与已授权账号",
  weekly_plans: "已保存并锁定的周计划",
  "scheduled_tasks + crawl_jobs": "定时任务及其采集运行记录",
  "trend_videos.aiAnalysis": "爆款库精确分析记录",
  "weekly_plan.scope": "当期计划锁定的业务范围",
  "studio_projects + render jobs": "内容项目与成片任务状态",
  "studio project quality state": "内容项目质量门状态",
  approval_requests: "服务端审批单",
  "posts.stats.status=scheduled": "发布日历排期记录",
  "posts.platform_post_id + publishResults": "平台帖子编号与发布回执",
  "whatsapp_customers.sourcePostId": "WhatsApp 客户来源归因",
  "customer_segments + members": "客户分层快照与成员记录",
  "followup_batches + followup_batch_items": "跟进批次与逐客草稿",
  "approval_requests + followup_batches": "审批单与获批跟进批次",
  "followup_batch_items.status + provider receipt": "逐客发送状态与渠道回执",
  "weekly_reviews + business snapshot": "复盘记录与经营业务快照",
};

const technicalKeyLabel: Record<string, string> = {
  capability: "业务能力",
  statusSource: "结果核验来源",
  successMetric: "成功指标",
  themes: "内容主题",
  constraints: "行动边界",
  businessRefs: "关联业务记录",
  messagesSent: "取得发送回执的客户",
  bulkWorkerStatus: "发送执行方式",
  messagingAuthorization: "真实消息发送授权",
  dispatchPreflight: "真实发送预检",
  blockers: "发送阻断原因",
  reason: "原因",
  source: "来源",
  target: "目标",
  baseline: "基线",
  output: "产出",
  evidence: "证据",
  itemCount: "记录数量",
  id: "记录编号",
  type: "记录类型",
};

const technicalValueLabel: Record<string, string> = {
  internal: "数字员工内部执行",
  observe: "等待真实业务状态回写",
  approval: "等待人工审批",
  none: "无外部影响",
  draft: "只生成草稿",
  schedule: "登记真实排期",
  publish: "真实对外发布",
  send: "真实对客发送",
  scheduled: "定时执行",
  manual_or_scheduled: "人工触发或定时执行",
  manual_only: "仅人工触发",
  true: "是",
  false: "否",
  approved_content_packages: "获批内容包",
  published_posts: "真实发布内容",
  qualified_inquiries: "高意向询盘",
  won_customers: "成交客户",
  reactivated_customers: "唤醒客户",
};

const eventTypeLabel: Record<string, string> = {
  run_started: "运行已启动",
  task_started: "任务已开始",
  task_completed: "任务已完成",
  task_failed: "任务执行失败",
  task_waiting_external: "等待业务结果",
  approval_requested: "已请求人工审批",
  approval_decided: "审批已处理",
  task_corrected: "纠偏已登记",
  task_retried: "任务已重试",
  task_skipped: "任务已跳过",
  task_manually_completed: "人工结果已登记",
  run_paused: "运行已暂停",
  run_resumed: "运行已恢复",
  run_completed: "运行已完成",
  handoff_started: "人工已接管",
  handoff_returned: "任务已交还",
  "workflow.started": "运行已启动",
  "workflow.paused": "运行已暂停",
  "workflow.resumed": "运行已恢复",
  "workflow.cancelled": "运行已取消",
  "workflow.completed": "运行已完成",
  "workflow.reconciled": "业务状态已同步",
  "plan.generated": "计划已生成",
  "task.started": "任务已开始",
  "task.reconciled": "任务状态已同步",
  "task.waiting_external": "等待业务结果",
  "task.execution_failed": "执行服务异常",
  "task.no_data": "暂无符合条件的数据",
  "task.not_required": "本轮无需执行",
  "task.completed": "任务已完成",
  "task.retry": "任务已重试",
  "task.skip": "任务已跳过",
  "task.manual_complete": "人工结果已登记",
  "task.replan": "任务已重新规划",
  "approval.requested": "已请求人工审批",
  "approval.preflight_blocked": "审批前检查未通过",
  "approval.decided": "审批已处理",
  "business.resource.created": "业务记录已创建",
  "business.resource.first_run": "首次执行已完成",
  "business.resource.first_run_failed": "首次执行未成功",
  "customer.segment.created": "客户分层已保存",
  "followup.batch.created": "跟进批次已保存",
  "review.generated": "本周复盘已生成",
  "handoff.started": "人工已接管",
  "handoff.returned": "任务已交还",
  "agent.ui.action_started": "Agent 开始页面操作",
  "agent.ui.navigation": "Agent 已导航",
  "agent.ui.click": "Agent 已点击",
  "agent.ui.input": "Agent 已输入",
  "agent.ui.screenshot": "Agent 已上报现场截图",
};

function humanizeValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "是" : "否";
  const raw = String(value ?? "—");
  const known =
    technicalValueLabel[raw] || capabilityLabel[raw] || statusLabel[raw];
  if (known) return known;
  if (/^[a-z][a-z0-9_.]*$/.test(raw) && /[_.]/.test(raw))
    return "业务系统记录";
  return raw;
}

function isoDay(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

const EMPTY_GOAL = {
  businessLine: "full_funnel" as BusinessLine,
  contentPlatforms: ["facebook", "instagram", "tiktok", "youtube"] as Array<Exclude<ContentPlatform, "all">>,
  title: "本周内容增长目标",
  objective: "形成一组面向目标市场、证据充分且可进入审批的内容执行包",
  metric: "approved_content_packages",
  baseline: 0,
  target: 5,
  unit: "项",
  startsAt: isoDay(0),
  endsAt: isoDay(6),
  scope: "",
  // Compatibility field only. The current product does not support paid-media spend.
  constraints: ["对外发布必须审批"],
};

const statusLabel: Record<string, string> = {
  draft: "待确认",
  active: "运行中",
  paused: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
  planning: "规划中",
  running: "执行中",
  waiting_external: "等待业务回写",
  waiting_approval: "待审批",
  waiting_human: "人工接管",
  succeeded: "已完成",
  failed: "失败",
  pending: "待执行",
  handed_off: "已接管",
  approved: "已批准",
  rejected: "已驳回",
  idle: "空闲",
};

const statusTone: Record<string, string> = {
  succeeded: "border-emerald-200 bg-emerald-50 text-emerald-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  running: "border-blue-200 bg-blue-50 text-blue-700",
  active: "border-blue-200 bg-blue-50 text-blue-700",
  planning: "border-blue-200 bg-blue-50 text-blue-700",
  waiting_external: "border-sky-200 bg-sky-50 text-sky-700",
  waiting_approval: "border-amber-200 bg-amber-50 text-amber-700",
  waiting_human: "border-violet-200 bg-violet-50 text-violet-700",
  handed_off: "border-violet-200 bg-violet-50 text-violet-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
  cancelled: "border-slate-200 bg-slate-100 text-slate-600",
  paused: "border-slate-200 bg-slate-100 text-slate-600",
};

const agentLabel: Record<string, string> = {
  orchestrator: "灵小枢 · 统筹 Agent",
  business: "经营 Agent",
  planner: "灵小枢 · 统筹 Agent",
  knowledge: "灵小枢 · 统筹 Agent",
  review: "经营 Agent",
  director: "编导 Agent",
  industry: "编导 Agent",
  channel: "编导 Agent",
  content: "内容 Agent",
  risk: "内容 Agent",
  publishing: "经营 Agent",
  customer: "客服 Agent",
};

const autonomyLabel: Record<string, string> = {
  suggest: "建议",
  collaborate: "协作",
  managed: "托管",
  automatic: "全自动",
};

function Badge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone[status] || "border-slate-200 bg-white text-slate-600"}`}
    >
      {label || statusLabel[status] || "状态待确认"}
    </span>
  );
}

function Field({
  label,
  children,
  wide = false,
  required = false,
  error = "",
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
  required?: boolean;
  error?: string;
}) {
  return (
    <label className={wide ? "md:col-span-2" : ""}>
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </span>
      {children}
      {error && (
        <span className="mt-1 block text-[10px] font-semibold text-red-600">
          {error}
        </span>
      )}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

const publishingPlatforms = ["youtube", "tiktok", "instagram", "facebook"] as const;

function primaryEnterpriseLanguage(value: unknown): string {
  const first = String(value || "").split(/[,，、;/]/).map((item) => item.trim()).find(Boolean);
  return first || "英语";
}

function platformCountsFromCadence(cadence: string, fallback: number): Record<(typeof publishingPlatforms)[number], number> {
  const perPlatform = Math.max(0, Math.ceil(fallback / publishingPlatforms.length));
  return Object.fromEntries(publishingPlatforms.map((platform) => {
    const matched = cadence.match(new RegExp(`${platform}=(\\d+)`, "i"));
    return [platform, matched ? Number(matched[1]) : perPlatform];
  })) as Record<(typeof publishingPlatforms)[number], number>;
}


function completeConfig(initial: DigitalEmployeeConfig): DigitalEmployeeConfig {
  return {
    ...EMPTY_CONFIG,
    ...initial,
    approvalOwner: initial.approvalOwner?.trim() || "企业管理员",
    team: ["orchestrator", "business", "director", "content", "customer"],
    enabledWorkflows: initial.enabledWorkflows?.length
      ? initial.enabledWorkflows
      : EMPTY_CONFIG.enabledWorkflows,
    approvalPolicy: {
      ...EMPTY_CONFIG.approvalPolicy,
      ...(initial.approvalPolicy || {}),
    },
    agentApprovalPolicies: {
      business: { ...EMPTY_CONFIG.agentApprovalPolicies.business, ...(initial.agentApprovalPolicies?.business || {}) },
      industry: { ...EMPTY_CONFIG.agentApprovalPolicies.industry, ...(initial.agentApprovalPolicies?.industry || {}) },
      content: { ...EMPTY_CONFIG.agentApprovalPolicies.content, ...(initial.agentApprovalPolicies?.content || {}) },
      customer: { ...EMPTY_CONFIG.agentApprovalPolicies.customer, ...(initial.agentApprovalPolicies?.customer || {}) },
    },
    publishingTargets: initial.publishingTargets || [],
    continuationPolicy: initial.continuationPolicy || recommendedContinuationPolicy,
  };
}

function configErrors(form: DigitalEmployeeConfig): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, label] of [
    ["companyName", "企业名称"],
    ["industry", "行业"],
    ["targetMarkets", "目标市场"],
    ["customerProfile", "核心客户"],
    ["approvalOwner", "审批负责人"],
  ] as const) {
    if (!String(form[key] || "").trim()) errors[key] = `请填写${label}`;
  }
  if (!form.enabledWorkflows.length)
    errors.enabledWorkflows = "至少启用一条工作流";
  if (
    form.enabledWorkflows.includes("content_publish") &&
    !form.enabledWorkflows.some((item) =>
      contentCreationWorkflows.includes(item),
    )
  )
    errors.enabledWorkflows = "内容发布前请先启用社媒视频制作";
  if (
    form.enabledWorkflows.some((item) =>
      ["scheduled_social", "content_publish"].includes(item),
    ) &&
    !form.socialCadence.trim()
  )
    errors.socialCadence = "请明确内容采集与发布节奏";
  if (
    form.enabledWorkflows.includes("batch_followup") &&
    !form.followupCadence.trim()
  )
    errors.followupCadence = "请明确客户跟进节奏";
  if (
    form.enabledWorkflows.includes("content_publish") &&
    !form.approvalPolicy.contentPublish
  )
    errors.contentPublish = "真实发布必须保留人工审批";
  if (
    form.enabledWorkflows.includes("batch_followup") &&
    !form.approvalPolicy.batchFollowup
  )
    errors.batchFollowup = "整批客户跟进必须保留人工审批";
  const grantErrors = managedPublishingGrantErrors(form.managedPublishingGrant, form);
  if (grantErrors.length) errors.managedPublishingGrant = grantErrors.join('；');
  return errors;
}

const applicationGuideSteps = [
  { index: 1, label: "企业与品牌" },
  { index: 2, label: "产品表" },
  { index: 3, label: "社媒经营阶段" },
  { index: 4, label: "人物与声音" },
] as const;

function OnboardingStepVisual({ step }: { step: 1 | 2 | 3 | 4 }) {
  const visuals = {
    1: { icon: Settings2, label: "企业与品牌关系图", nodes: ["企业主体", "品牌名称"] },
    2: { icon: FileSpreadsheet, label: "产品资料入库流程图", nodes: ["产品表", "企业知识库"] },
    3: { icon: TrendingUp, label: "社媒经营阶段选择图", nodes: ["起步验证", "增长进阶", "品牌增长"] },
    4: { icon: Users, label: "人物与声音配置图", nodes: ["出镜人物", "声音资产"] },
  } as const;
  const visual = visuals[step];
  const Icon = visual.icon;
  return (
    <div role="img" aria-label={visual.label} className="flex min-h-48 flex-col justify-center rounded-lg border border-border bg-surface-2 p-5">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-accent-glow text-accent">
        <Icon size={22} />
      </span>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {visual.nodes.map((node, index) => (
          <div key={node} className="contents">
            {index > 0 && <ArrowRight size={14} className="text-text-muted" aria-hidden="true" />}
            <span className="rounded-md border border-border bg-white px-3 py-2 text-xs font-semibold text-text-primary">{node}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OnboardingGuideFrame({
  step,
  title,
  children,
  busy = false,
  dismissible = false,
  onClose,
  onBack,
  onSkip,
  skipLabel = "跳过",
  primaryLabel,
  primaryId,
  primaryDisabled = false,
  onPrimary,
}: {
  step: 1 | 2 | 3 | 4;
  title: string;
  children: ReactNode;
  busy?: boolean;
  dismissible?: boolean;
  onClose?: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  primaryLabel: string;
  primaryId?: string;
  primaryDisabled?: boolean;
  onPrimary: () => void;
}) {
  return (
    <LsFlowDialog
      open
      title="新手引导"
      width={880}
      centered
      current={step - 1}
      steps={applicationGuideSteps.map((item) => ({
        title: item.label,
        status: item.index < step ? "finish" : item.index === step ? "process" : "wait",
      }))}
      closable={dismissible && !busy}
      keyboard={dismissible && !busy}
      maskClosable={false}
      onCancel={() => dismissible && !busy && onClose?.()}
      styles={{ body: { maxHeight: "min(68vh, 680px)", overflowY: "auto" } }}
      footer={[
        onBack ? <Button key="back" disabled={busy} onClick={onBack}>返回上一步</Button> : null,
        onSkip ? <Button key="skip" type="text" disabled={busy} onClick={onSkip}>{skipLabel}</Button> : null,
        <LsBrandAction key="primary" id={primaryId} loading={busy} disabled={primaryDisabled} onClick={onPrimary}>{primaryLabel}</LsBrandAction>,
      ].filter(Boolean)}
    >
      <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)] md:items-start">
        <OnboardingStepVisual step={step} />
        <section aria-labelledby={`onboarding-step-${step}-title`}>
          <p className="ls-type-body-small font-semibold text-accent">第 {step} 步，共 4 步</p>
          <h2 id={`onboarding-step-${step}-title`} className="ls-type-title-large mt-2 text-text-primary">{title}</h2>
          <div className="mt-5">{children}</div>
        </section>
      </div>
    </LsFlowDialog>
  );
}

function OnboardingPanel({
  initial,
  readiness,
  busy,
  mode = "first",
  activeRun = false,
  restartFromBeginning = false,
  dismissible = false,
  allowInitialPlan = true,
  onClose,
  onSave,
  onOpenReadiness,
  onNavigate,
}: {
  initial: DigitalEmployeeConfig;
  readiness: BusinessReadinessItem[];
  busy: boolean;
  mode?: "first" | "rules";
  activeRun?: boolean;
  restartFromBeginning?: boolean;
  dismissible?: boolean;
  allowInitialPlan?: boolean;
  onClose?: () => void;
  onSave: (config: DigitalEmployeeConfig & { minimalOnboarding?: true; brandName?: string; initialPlan?: InitialOperatingPlan }) => void | boolean | Promise<void | boolean>;
  onOpenReadiness: (item: BusinessReadinessItem) => void;
  onNavigate?: (page: BusinessDestination) => void;
}) {
  const restoredRules = useMemo(() => agentRuleFields(initial), [initial.socialCadence, initial.followupCadence, initial.reviewSchedule]);
  const [form, setForm] = useState(() => completeConfig(initial));
  const [dependencyNotice, setDependencyNotice] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [settingsEditorOpen, setSettingsEditorOpen] = useState(false);
  const [collectionPlatforms, setCollectionPlatforms] = useState(restoredRules.collectionPlatforms);
  const [collectionSources, setCollectionSources] = useState(restoredRules.collectionSources);
  const [collectionKeywords, setCollectionKeywords] = useState(restoredRules.collectionKeywords);
  const [collectionLanguage, setCollectionLanguage] = useState(restoredRules.collectionLanguage || "英语");
  const [collectionLookback, setCollectionLookback] = useState(restoredRules.collectionLookback);
  const [collectionLimit, setCollectionLimit] = useState(restoredRules.collectionLimit);
  const [collectionTime, setCollectionTime] = useState(restoredRules.collectionTime);
  const [approvedDiscoveryScope, setApprovedDiscoveryScope] = useState<SocialCrawlStrategy | null>(null);
  const [discoveryScopeNotice, setDiscoveryScopeNotice] = useState("");
  const [publishCount, setPublishCount] = useState(restoredRules.publishCount);
  const [selectedPublishPlatforms, setSelectedPublishPlatforms] = useState<Array<PublishingTarget["platform"]>>(() => {
    const savedPlatforms = [...new Set(initial.publishingTargets.map((target) => target.platform))];
    return savedPlatforms.length ? savedPlatforms : publishingPlatforms.slice();
  });
  const [platformPublishCounts, setPlatformPublishCounts] = useState(() => platformCountsFromCadence(initial.socialCadence, restoredRules.publishCount));
  const [connectedPublishingAccounts, setConnectedPublishingAccounts] = useState<PublishingTarget[]>([]);
  const [publishingAccountsLoading, setPublishingAccountsLoading] = useState(true);
  const [publishingAccountsError, setPublishingAccountsError] = useState("");
  const [followupGenerateAt, setFollowupGenerateAt] = useState(restoredRules.followupGenerateAt);
  const [followupApproveBy, setFollowupApproveBy] = useState(restoredRules.followupApproveBy);
  const [followupWindow, setFollowupWindow] = useState(restoredRules.followupWindow);
  const [followupFrequency, setFollowupFrequency] = useState(restoredRules.followupFrequency);
  const [reviewTimezone, setReviewTimezone] = useState(restoredRules.reviewTimezone);
  const [reviewCutoff, setReviewCutoff] = useState(restoredRules.reviewCutoff);
  const [recommendationApplied, setRecommendationApplied] = useState(false);
  const [profileLoading, setProfileLoading] = useState(mode === "first");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileConfirmed, setProfileConfirmed] = useState(mode !== "first");
  const [productConfirmed, setProductConfirmed] = useState(mode !== "first");
  const [brandName, setBrandName] = useState("");
  const [knowledgeProducts, setKnowledgeProducts] = useState<Array<Record<string, any>>>([]);
  const [productsLoading, setProductsLoading] = useState(mode === "first");
  const [activeRuleAgent, setActiveRuleAgent] = useState<"business" | "director" | "content" | "customer">("business");
  const [productSaving, setProductSaving] = useState(false);
  const [productError, setProductError] = useState("");
  const [productImporting, setProductImporting] = useState(false);
  const [productImportMessage, setProductImportMessage] = useState("");
  const [contentStage, setContentStage] = useState<SocialContentStageId>();
  const [stageConfirmed, setStageConfirmed] = useState(mode !== "first");
  const [stageSaving, setStageSaving] = useState(false);
  const [stageError, setStageError] = useState("");
  const [recommendedPlanOpen, setRecommendedPlanOpen] = useState(false);
  const recommendedPlanTriggerId = "onboarding-generate-recommended-plan";
  const [recommendedProducts, setRecommendedProducts] = useState<string[]>([]);
  const themeContentEnabled = form.enabledWorkflows.some((item) =>
    contentCreationWorkflows.includes(item),
  );
  const visibleEnabledWorkflowCount =
    form.enabledWorkflows.filter(
      (item) => !contentCreationWorkflows.includes(item),
    ).length + (themeContentEnabled ? 1 : 0);
  const displayedReadiness = useMemo(() => {
    const override = (item: BusinessReadinessItem): BusinessReadinessItem => {
      if (item.key === "enterprise" && profileConfirmed) {
        return {
          ...item,
          status: "ready",
          note: "企业档案已保存到企业知识库，可用于任务上下文",
        };
      }
      if (item.key === "products" && knowledgeProducts.length > 0) {
        return {
          ...item,
          status: "ready",
          count: knowledgeProducts.length,
          note: `企业知识库已有 ${knowledgeProducts.length} 个真实产品，可用于产品生成与逐客推荐`,
        };
      }
      return item;
    };
    const next = readiness.map(override);
    if (profileConfirmed && !next.some((item) => item.key === "enterprise")) {
      next.unshift({ key: "enterprise", label: "企业资料", status: "ready", count: null, page: "enterprise", note: "企业档案已保存到企业知识库，可用于任务上下文" });
    }
    if (knowledgeProducts.length > 0 && !next.some((item) => item.key === "products")) {
      next.push({ key: "products", label: "产品资料", status: "ready", count: knowledgeProducts.length, page: "enterprise", note: `企业知识库已有 ${knowledgeProducts.length} 个真实产品，可用于产品生成与逐客推荐` });
    }
    return next;
  }, [knowledgeProducts.length, profileConfirmed, readiness]);
  useEffect(() => setForm(completeConfig(initial)), [initial]);
  useEffect(() => {
    let active = true;
    void socialDiscoveryApi.getScope().then(({ scope }) => {
      if (!active) return;
      setApprovedDiscoveryScope(scope.approval?.status === 'approved' ? scope : null);
      setDiscoveryScopeNotice(scope.approval?.status === 'approved' ? '' : '尚无已批准的编导采集范围');
    }).catch(() => { if (active) setDiscoveryScopeNotice('暂时无法读取当前编导采集范围'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    setCollectionPlatforms(restoredRules.collectionPlatforms);
    setCollectionSources(restoredRules.collectionSources);
    setCollectionKeywords(restoredRules.collectionKeywords);
    setCollectionLanguage(restoredRules.collectionLanguage || "英语");
    setCollectionLookback(restoredRules.collectionLookback);
    setCollectionLimit(restoredRules.collectionLimit);
    setCollectionTime(restoredRules.collectionTime);
    setPublishCount(restoredRules.publishCount);
    setPlatformPublishCounts(platformCountsFromCadence(initial.socialCadence, restoredRules.publishCount));
    setFollowupGenerateAt(restoredRules.followupGenerateAt);
    setFollowupApproveBy(restoredRules.followupApproveBy);
    setFollowupWindow(restoredRules.followupWindow);
    setFollowupFrequency(restoredRules.followupFrequency);
    setReviewTimezone(restoredRules.reviewTimezone);
    setReviewCutoff(restoredRules.reviewCutoff);
  }, [initial.socialCadence, restoredRules]);
  const set = <K extends keyof DigitalEmployeeConfig>(
    key: K,
    value: DigitalEmployeeConfig[K],
  ) => setForm((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    let cancelled = false;
    setPublishingAccountsLoading(true);
    digitalEmployeeApi.publishingAccounts()
      .then(result => {
        if (cancelled) return;
        setConnectedPublishingAccounts(result.items);
        if (!initial.publishingTargets.length && result.items.length) {
          setForm((current) => ({ ...current, publishingTargets: result.items }));
        }
        setPublishingAccountsError("");
      })
      .catch(error => {
        if (!cancelled) setPublishingAccountsError(error instanceof Error ? error.message : "发布账号读取失败");
      })
      .finally(() => { if (!cancelled) setPublishingAccountsLoading(false); });
    return () => { cancelled = true; };
  }, [initial.publishingTargets.length]);
  useEffect(() => {
    let cancelled = false;
    if (mode === "first") setProfileLoading(true);
    fetch("/api/overseas/enterprise/profile", { headers: authHeader() })
      .then(async (response) => {
        if (!response.ok) throw new Error("企业知识库读取失败");
        return response.json() as Promise<Record<string, any>>;
      })
      .then((profile) => {
        if (cancelled) return;
        const loadedProfile = {
          companyName: String(profile.company?.name || ""),
          brandName: String(profile.brand?.name || ""),
        };
        setForm((current) => ({
          ...current,
          companyName: loadedProfile.companyName || current.companyName,
        }));
        setBrandName(loadedProfile.brandName);
        const loadedProducts = Array.isArray(profile.products?.items) ? profile.products.items : [];
        setKnowledgeProducts(loadedProducts);
        const savedFocusProducts = String(profile.strategy?.focusProducts || "").split(/[、，,]/).map((item: string) => item.trim()).filter(Boolean);
        setRecommendedProducts(savedFocusProducts.length ? savedFocusProducts : recommendFocusProducts(loadedProducts));
        const loadedStage = socialContentStageProfile(profile.socialStrategy?.contentStage);
        if (loadedStage) {
          setContentStage(loadedStage.id);
          if (!restartFromBeginning) setStageConfirmed(true);
        }
        setCollectionLanguage(primaryEnterpriseLanguage(profile.company?.primaryLanguages));
        // Progress is persisted with the tenant profile so a refresh, HMR remount,
        // or a late overview response cannot throw the user back to step one.
        // Only promote local progress here; never regress a step from a stale GET.
        if (!restartFromBeginning && profile.digitalEmployeeOnboarding?.profileConfirmedAt
          && loadedProfile.companyName && loadedProfile.brandName) setProfileConfirmed(true);
        if (!restartFromBeginning && profile.digitalEmployeeOnboarding?.productSelectionConfirmedAt
          && loadedProducts.length) setProductConfirmed(true);
        if (mode === "first") setProductsLoading(false);
        setProfileError("");
      })
      .catch((error) => {
        if (!cancelled && mode === "first") setProfileError(error instanceof Error ? error.message : "企业知识库读取失败");
      })
      .finally(() => {
        if (!cancelled) { setProfileLoading(false); setProductsLoading(false); }
      });
    return () => { cancelled = true; };
  }, [mode, restartFromBeginning]);
  const selectedPublishingTargets = form.publishingTargets.filter((target) => selectedPublishPlatforms.includes(target.platform));
  const publishingConfigured = selectedPublishPlatforms.length > 0 && selectedPublishingTargets.length > 0;
  const validationForm = publishingConfigured ? { ...form, publishingTargets: selectedPublishingTargets } : {
    ...form,
    enabledWorkflows: form.enabledWorkflows.filter((workflow) => workflow !== "content_publish"),
    publishingTargets: [],
    allowRealPublishing: false,
  };
  const errors = configErrors(validationForm);
  const errorLabels: Record<string, string> = {
    companyName: "企业名称",
    industry: "所属行业",
    primaryBusiness: "主要业务",
    targetMarkets: "目标市场",
    customerProfile: "核心客户",
    focusProducts: "本期重点产品",
    approvalOwner: "审批负责人",
    enabledWorkflows: "至少一项执行能力",
    socialCadence: "内容采集与发布节奏",
    followupCadence: "客户跟进节奏",
    contentPublish: "内容发布设置",
    batchFollowup: "客户跟进设置",
    publishingTargets: "发布平台与账号",
  };
  const missingConfigLabels = Object.keys(errors).map((key) => errorLabels[key] || key);
  const goToFirstMissingConfig = () => {
    const firstKey = Object.keys(errors)[0];
    if (!firstKey) return;
    const profileKeys = ["companyName", "industry", "primaryBusiness", "targetMarkets", "customerProfile"];
    if (profileKeys.includes(firstKey)) {
      setProfileConfirmed(false);
      setSubmitted(false);
      window.setTimeout(() => document.getElementById("onboarding-enterprise-profile")?.scrollIntoView({ behavior: getScrollBehavior(), block: "start" }), 50);
      return;
    }
    if (firstKey === "focusProducts") {
      setSubmitted(false);
      window.setTimeout(() => document.getElementById("onboarding-focus-products")?.scrollIntoView({ behavior: getScrollBehavior(), block: "start" }), 50);
      return;
    }
    const targetAgent = ["contentPublish", "publishingTargets", "managedPublishingGrant", "approvalOwner"].includes(firstKey) ? "business" : ["batchFollowup", "followupCadence"].includes(firstKey) ? "customer" : firstKey === "socialCadence" ? "director" : "business";
    setActiveRuleAgent(targetAgent);
    window.setTimeout(() => {
      const selector = firstKey === "approvalOwner" ? 'input[placeholder="姓名或岗位"]' : `[aria-invalid="true"]`;
      const target = document.querySelector<HTMLElement>(selector);
      target?.scrollIntoView({ behavior: getScrollBehavior(), block: "center" });
      target?.focus();
    }, 50);
  };
  const toggleWorkflow = (workflow: DigitalEmployeeWorkflow) => {
    const current = form.enabledWorkflows;
    if (current.includes(workflow)) {
      const dependents =
        workflow === "customer_segmentation" &&
        current.includes("batch_followup")
          ? (["batch_followup"] as DigitalEmployeeWorkflow[])
          : contentCreationWorkflows.includes(workflow) &&
              current.includes("content_publish") &&
              current.filter(
                (item) =>
                  contentCreationWorkflows.includes(item) && item !== workflow,
              ).length === 0
            ? (["content_publish"] as DigitalEmployeeWorkflow[])
            : [];
      set(
        "enabledWorkflows",
        current.filter(
          (item) => item !== workflow && !dependents.includes(item),
        ),
      );
      setDependencyNotice(
        dependents.length
          ? `已同步关闭：${dependents.map((item) => workflowLabel[item]).join("、")}，因为它依赖当前工作流。`
          : "",
      );
      return;
    }
    const additions: DigitalEmployeeWorkflow[] = [workflow];
    if (
      workflow === "batch_followup" &&
      !current.includes("customer_segmentation")
    )
      additions.unshift("customer_segmentation");
    if (workflow === "content_publish")
      additions.unshift(
        ...contentCreationWorkflows.filter((item) => !current.includes(item)),
      );
    set("enabledWorkflows", [...new Set([...current, ...additions])]);
    setDependencyNotice(
      workflow === "content_publish" && additions.length > 1
        ? "已同时启用前置能力：社媒视频制作。"
        : additions.length > 1
        ? `已同时启用前置工作流：${additions
            .slice(0, -1)
            .map((item) => workflowLabel[item])
            .join("、")}。`
        : "",
    );
  };
  const toggleThemeContentCreation = () => {
    const current = form.enabledWorkflows;
    if (themeContentEnabled) {
      const closesPublishing = current.includes("content_publish");
      set(
        "enabledWorkflows",
        current.filter(
          (item) =>
            !contentCreationWorkflows.includes(item) &&
            item !== "content_publish",
        ),
      );
      setDependencyNotice(
        closesPublishing
          ? "已同步关闭内容发布，因为它依赖社媒视频制作。"
          : "",
      );
      return;
    }
    set(
      "enabledWorkflows",
      synchronizeThemeContentWorkflows([
        ...current,
        ...contentCreationWorkflows,
      ]),
    );
    setDependencyNotice("已启用爆款复刻；缺少全片精确分析时会退回编导 Agent 补齐，不会转入自由创作。");
  };
  const missingRecommendationFields = [
    ["企业名称", form.companyName], ["行业", form.industry], ["主要业务", form.primaryBusiness],
    ["目标市场", form.targetMarkets], ["核心客户", form.customerProfile],
    ...(knowledgeProducts.length ? [["本期重点产品", form.focusProducts]] : []),
  ].filter(([, value]) => !String(value || "").trim()).map(([label]) => label);
  const canGenerateRecommendation = missingRecommendationFields.length === 0;
  const applyAiRecommendation = () => {
    if (!canGenerateRecommendation) return;
    const subject = form.focusProducts || form.primaryBusiness || form.industry || "企业重点产品";
    if (!form.targetMarkets.trim()) set("targetMarkets", "美国（优先），并根据真实询盘来源扩展到北美其他市场");
    if (!form.customerProfile.trim()) set("customerProfile", `当地经销商、采购负责人和渠道负责人；关注 ${subject} 的适配性、交付与售后`);
    setCollectionKeywords(`${subject}、买家痛点、应用场景、选型对比、行业趋势`);
    setRecommendationApplied(true);
  };
  const profileMissingFields = [
    ["企业名称", form.companyName],
    ["品牌名称", brandName],
  ] as const;
  const missingProfileFields = profileMissingFields.filter(([, value]) => !value.trim()).map(([label]) => label);
  const saveEnterpriseProfile = async () => {
    if (missingProfileFields.length || profileSaving) return;
    setProfileSaving(true);
    setProfileError("");
    try {
      const response = await fetch("/api/overseas/enterprise/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-enterprise-save-source": "diagnosis", ...authHeader() },
        body: JSON.stringify({
          company: { name: form.companyName },
          brand: { name: brandName },
          digitalEmployeeOnboarding: { profileConfirmedAt: new Date().toISOString() },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "企业档案保存失败");
      setProfileConfirmed(true);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "企业档案保存失败");
    } finally {
      setProfileSaving(false);
    }
  };
  const productName = (product: Record<string, any>) => String(product.name || product.title || product.productName || "").trim();
  const importProductFile = async (file: File | null) => {
    if (!file || productImporting) return;
    setProductImporting(true); setProductImportMessage(""); setProductError("");
    try {
      const sheets = await parseWorkbook(file);
      const selectedSheet = sheets.slice().sort((a, b) => b.rowCount - a.rowCount)[0];
      if (!selectedSheet) throw new Error("文件中没有可读取的表格");
      const prepared = prepareSheet(selectedSheet);
      const mapping = heuristicProductMapping(prepared.headers);
      const decoded = prepared.dataRows
        .map((row) => mapRowToProduct(row, mapping))
        .filter((item) => item.name || item.sku)
        .map((item, index) => ({
          id: `import-${Date.now()}-${index}`,
          ...item,
          name: item.name || item.sku || `导入产品 ${index + 1}`,
          priceRange: item.retailPrice || item.tagPrice || "",
          images: item.imageUrl ? [{ name: item.imageUrl.split("/").pop() || "产品图片", type: "image/url", size: 0, updatedAt: new Date().toISOString(), url: item.imageUrl }] : [],
          videos: [], documents: [], source: "product_file_import",
        }));
      if (!decoded.length) throw new Error("未识别到有效产品，请确认表格包含“产品名称”或“SKU/货号”列");
      const next = [...knowledgeProducts];
      for (const product of decoded) {
        const sku = String((product as Record<string, unknown>).sku || "").trim();
        const name = productName(product);
        const existingIndex = next.findIndex((item) => sku ? String(item.sku || "").trim() === sku : productName(item) === name);
        if (existingIndex >= 0) {
          const existing = next[existingIndex];
          next[existingIndex] = {
            ...existing,
            ...product,
            id: String(existing.id || existing.productId || product.id),
          };
        }
        else next.push(product);
      }
      const response = await fetch("/api/overseas/enterprise/profile", { method: "PATCH", headers: { "Content-Type": "application/json", "x-enterprise-save-source": "diagnosis", ...authHeader() }, body: JSON.stringify({ products: { items: next } }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "产品资料写入企业知识库失败");
      setKnowledgeProducts(next);
      setRecommendedProducts(recommendFocusProducts(next));
      setProductImportMessage(`已从“${file.name}”识别并写入 ${decoded.length} 个产品，可以直接确认产品表。`);
    } catch (error) { setProductError(error instanceof Error ? error.message : "产品文件解析失败"); }
    finally { setProductImporting(false); }
  };
  const confirmProductTable = async () => {
    if (!knowledgeProducts.length || productSaving) return;
    setProductSaving(true); setProductError("");
    try {
      const response = await fetch("/api/overseas/enterprise/profile", { method: "PATCH", headers: { "Content-Type": "application/json", "x-enterprise-save-source": "diagnosis", ...authHeader() }, body: JSON.stringify({ digitalEmployeeOnboarding: { productSelectionConfirmedAt: new Date().toISOString(), continuedWithoutProducts: false } }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "产品表确认失败");
      setProductConfirmed(true);
    } catch (error) { setProductError(error instanceof Error ? error.message : "产品表确认失败"); }
    finally { setProductSaving(false); }
  };
  const confirmSocialStage = async (stageId: SocialContentStageId) => {
    if (stageSaving) return;
    setStageSaving(true);
    setStageError("");
    try {
      const savedStage = await saveSocialContentStage(stageId);
      if (!savedStage.synced) throw new Error("社媒经营阶段保存失败，请稍后重试");
      setContentStage(savedStage.profile.id);
      setStageConfirmed(true);
    } catch (error) {
      setStageError(error instanceof Error ? error.message : "社媒经营阶段保存失败，请稍后重试");
    } finally {
      setStageSaving(false);
    }
  };
  const completeMinimalOnboarding = async (plan?: InitialOperatingPlan) => {
    if (stageSaving || !stageConfirmed || !contentStage) return;
    setStageSaving(true);
    setStageError("");
    try {
      let confirmedStage = contentStage;
      if (plan && plan.stage !== contentStage) {
        const savedStage = await saveSocialContentStage(plan.stage);
        if (!savedStage.synced) throw new Error("社媒经营阶段保存失败，请稍后重试");
        confirmedStage = savedStage.profile.id;
        setContentStage(confirmedStage);
      }
      const completed = await onSave(plan ? {
        ...form,
        companyName: form.companyName.trim(),
        focusProducts: plan.products.join("、"),
        targetMarkets: plan.market,
        videoLanguages: [plan.language],
        allowGeneratedVisuals: true,
        operatingMaturity: confirmedStage === "b2b_launch" ? "starting" : "growing",
        minimalOnboarding: true,
        brandName: brandName.trim(),
        initialPlan: { ...plan, stage: confirmedStage },
      } : {
        ...form,
        companyName: form.companyName.trim(),
        focusProducts: "",
        minimalOnboarding: true,
        brandName: brandName.trim(),
      });
      if (completed === false) throw new Error("新手引导暂未完成，请稍后重试");
    } catch (error) {
      setStageError(error instanceof Error ? error.message : "新手引导暂未完成，请稍后重试");
    } finally {
      setStageSaving(false);
    }
  };
  const openRecommendedPlan = async () => {
    if (!allowInitialPlan) {
      await completeMinimalOnboarding();
      return;
    }
    setStageError("");
    setRecommendedPlanOpen(true);
  };
  const closeRecommendedPlan = () => {
    setRecommendedPlanOpen(false);
    window.requestAnimationFrame(() => {
      document.getElementById(recommendedPlanTriggerId)?.focus();
    });
  };
  const submit = () => {
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    const contentWorkflows = synchronizeThemeContentWorkflows(
      form.enabledWorkflows,
    );
    const enabledWorkflows = publishingConfigured
      ? [...new Set([...contentWorkflows, "content_publish" as DigitalEmployeeWorkflow])]
      : contentWorkflows.filter((workflow) => workflow !== "content_publish");
    const publishingTargets = selectedPublishingTargets;
    const platformCounts = selectedPublishPlatforms.map((platform) => `${platform}=${platformPublishCounts[platform]}`).join(",");
    const completed = {
      ...form,
      publishingTargets,
      enabledWorkflows,
      allowRealPublishing: publishingConfigured && form.allowRealPublishing,
      team: ["planner", "knowledge", "risk", "review", ...(enabledWorkflows.some((item) => contentCreationWorkflows.includes(item)) ? ["content"] : []), ...(enabledWorkflows.some((item) => ["customer_segmentation", "batch_followup"].includes(item)) ? ["customer"] : [])],
      socialCadence: `${collectionPlatforms}；${collectionSources}；关键词：${collectionKeywords || form.focusProducts || form.primaryBusiness}；关键词语言：${collectionLanguage}；近 ${collectionLookback} 天；${collectionTime}；每次最多 ${collectionLimit} 条；按链接与标题去重 30 天；每周生成 ${publishCount} 条发布草稿；发布平台：${selectedPublishPlatforms.join("、")}；各平台条数：${platformCounts}；账号范围：${publishingTargets.map(target => `${target.platform}/${target.accountLabel}`).join("、") || "未确认"}；发布节奏按视频矩阵执行`,
      followupCadence: [followupGenerateAt, followupApproveBy, followupWindow, followupFrequency].every((value, index) => value === [restoredRules.followupGenerateAt, restoredRules.followupApproveBy, restoredRules.followupWindow, restoredRules.followupFrequency][index]) ? initial.followupCadence : `${followupGenerateAt}生成分层跟进草稿；${followupApproveBy}审批；${followupWindow}发送；${followupFrequency}`,
      reviewSchedule: reviewTimezone === restoredRules.reviewTimezone && reviewCutoff === restoredRules.reviewCutoff ? initial.reviewSchedule : `周五 17:30（${reviewTimezone}）；数据截止 ${reviewCutoff}；通知审批负责人；仅生成复盘和下周任务草稿`,
    };
    setSettingsEditorOpen(false);
    onSave(completed);
  };
  const confirmRecommendedSettings = () => {
    if (Object.keys(errors).length) {
      setSubmitted(true);
      setSettingsEditorOpen(true);
      return;
    }
    submit();
  };
  if (mode === "first" && recommendedPlanOpen && contentStage) return (
    <InitialOperatingPlanDialog
      config={form}
      initial={{
        stage: contentStage,
        products: recommendedProducts.length ? recommendedProducts : recommendFocusProducts(knowledgeProducts),
        market: form.targetMarkets && !form.targetMarkets.includes("待") ? form.targetMarkets : "北美",
        language: collectionLanguage || "英语",
        platforms: connectedPublishingAccounts.length ? [...new Set(connectedPublishingAccounts.map(account => account.platform))] : ["youtube", "tiktok"],
        accountIds: Object.fromEntries(connectedPublishingAccounts.map(account => [account.platform, account.accountId])),
        count: 5,
        budgetCapCny: 500,
        deliveryDate: isoDay(6),
      }}
      busy={stageSaving || busy}
      error={stageError}
      onBack={closeRecommendedPlan}
      onConfirm={plan => void completeMinimalOnboarding(plan)}
    />
  );
  if (mode === "first" && !profileConfirmed) return (
    <OnboardingGuideFrame
      step={1}
      title="填写企业与品牌"
      busy={profileSaving || busy}
      dismissible={dismissible}
      onClose={onClose}
      onSkip={dismissible ? onClose : undefined}
      skipLabel="稍后继续"
      primaryLabel="保存企业档案"
      primaryDisabled={Boolean(missingProfileFields.length)}
      onPrimary={() => void saveEnterpriseProfile()}
    >
      <section id="onboarding-enterprise-profile" className="scroll-mt-24 rounded-lg border border-slate-200 bg-white p-5">
        {profileLoading ? <div role="status" className="flex items-center gap-2 rounded-lg bg-slate-50 p-5 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />正在读取企业知识库已有档案…</div> : <>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="企业名称" required><input className={inputClass} value={form.companyName} onChange={e=>set("companyName",e.target.value)} placeholder="例如：灵枢科技" /></Field>
            <Field label="品牌名称" required><input className={inputClass} value={brandName} onChange={e=>setBrandName(e.target.value)} placeholder="例如：Aurelia" /></Field>
          </div>
          {profileError && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-xs text-red-700">{profileError}</p>}
          <p role="status" className="mt-5 text-xs text-amber-700">{missingProfileFields.length ? `还需填写：${missingProfileFields.join("、")}` : "企业基础资料已完整，可以保存。"}</p>
        </>}
      </section>
    </OnboardingGuideFrame>
  );
  if (mode === "first" && profileConfirmed && !productConfirmed) return (
    <OnboardingGuideFrame
      step={2}
      title="导入或确认产品表"
      busy={productSaving || productImporting || busy}
      dismissible={dismissible}
      onClose={onClose}
      onBack={() => setProfileConfirmed(false)}
      primaryLabel="确认产品表，下一步"
      primaryDisabled={!knowledgeProducts.length}
      onPrimary={() => void confirmProductTable()}
    >
    <section id="onboarding-focus-products" className="scroll-mt-24 rounded-lg border border-slate-200 bg-white p-6">
      {productsLoading ? <div role="status" className="mt-6 flex items-center gap-2 rounded-lg bg-slate-50 p-5 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />正在读取企业知识库产品…</div> : <>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold text-slate-900">企业知识库产品表</p><label className={`inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 ${productImporting?"cursor-wait opacity-60":"cursor-pointer hover:bg-slate-50"}`}>{productImporting?<Loader2 size={14} className="animate-spin"/>:<FileSpreadsheet size={14}/>}上传产品表<input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={productImporting} onChange={e=>{void importProductFile(e.currentTarget.files?.[0]??null);e.currentTarget.value="";}} /></label></div>
        <p className="mt-2 text-[11px] text-slate-500">支持 Excel（.xlsx/.xls）和 CSV。系统自动识别产品名称、SKU、规格、价格、MOQ、材质、图片链接和卖点，并直接写入企业知识库。</p>
        {productImportMessage&&<p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">{productImportMessage}</p>}
        {!knowledgeProducts.length ? <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-8 text-center"><p className="font-bold text-slate-800">企业知识库尚未录入产品</p><p className="mt-2 text-xs text-slate-500">请上传产品表后继续。</p></div> : <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">{knowledgeProducts.map((product,index)=>{const name=productName(product);const details=[product.category,product.sku || product.attributes?.model].filter(Boolean).join(" · ");return <div key={String(product.id||`${name}-${index}`)} className="rounded-lg border border-slate-200 p-4 text-left"><div className="flex items-start justify-between gap-2"><p className="font-bold text-slate-900">{name}</p><CheckCircle2 size={17} className="shrink-0 text-emerald-600" /></div><p className="mt-1 text-xs text-slate-500">{details||"暂无型号与类别"}</p><p className="mt-3 line-clamp-2 text-[11px] leading-relaxed text-slate-500">{product.description||product.highlights||"详细资料可稍后在企业中心完善"}</p></div>})}</div>}
        {productError&&<p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-xs text-red-700">{productError}</p>}
        <p role="status" className="mt-5 text-xs text-text-muted">{knowledgeProducts.length?`产品表已有 ${knowledgeProducts.length} 个产品，可以继续。`:"导入至少一个产品后即可继续。"}</p>
      </>}
    </section>
    </OnboardingGuideFrame>
  );
  if (mode === "first" && profileConfirmed && productConfirmed && !stageConfirmed) return (
    <OnboardingGuideFrame
      step={3}
      title="选择社媒经营阶段"
      busy={stageSaving || busy}
      dismissible={dismissible}
      onClose={onClose}
      onBack={() => setProductConfirmed(false)}
      primaryLabel="确认阶段，下一步"
      primaryDisabled={!contentStage}
      onPrimary={() => contentStage && void confirmSocialStage(contentStage)}
    >
      <SocialContentStageOnboarding
        embedded
        hideHeader
        hideActions
        eyebrow="第三步 · 社媒经营阶段"
        initialValue={contentStage}
        busy={stageSaving || busy}
        error={stageError}
        onChange={setContentStage}
        onConfirm={(stageId) => void confirmSocialStage(stageId)}
      />
    </OnboardingGuideFrame>
  );
  if (mode === "first" && profileConfirmed && productConfirmed && stageConfirmed) return (
    <OnboardingGuideFrame
      step={4}
      title="选择出镜人物和声音（可选）"
      busy={stageSaving || busy}
      dismissible={dismissible}
      onClose={onClose}
      onBack={() => setStageConfirmed(false)}
      onSkip={() => void completeMinimalOnboarding()}
      skipLabel="稍后设置人物与声音"
      primaryLabel={allowInitialPlan ? "生成推荐计划" : "完成引导并保存"}
      primaryId={allowInitialPlan ? recommendedPlanTriggerId : undefined}
      onPrimary={() => void openRecommendedPlan()}
    >
      <section className="rounded-lg border border-slate-200 bg-white p-5" aria-label="初始配置人物授权与声音">
        <EnterprisePresenters initialConfiguration onInitialSelection={() => { if (allowInitialPlan) void openRecommendedPlan(); }} />
        {stageError && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">{stageError}</p>}
      </section>
    </OnboardingGuideFrame>
  );
  return (
    <>
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-lg bg-emerald-50 p-3 text-emerald-700"><Settings2 size={22} /></div>
            <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Agent 设置</p><h2 className="mt-1 text-xl font-bold text-slate-950">系统已准备一套安全默认方案</h2><p className="mt-1 text-sm text-slate-500">无需逐项填写。确认后即可使用；以后随时可以打开修改。</p></div>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-semibold text-emerald-700">推荐设置已就绪</span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {agentRoleGroups.filter(agent => agent.id !== "orchestrator").map(agent => {
            const Icon = agent.id === "business" ? BarChart3 : agent.id === "director" ? Search : agent.id === "content" ? Sparkles : MessageSquare;
            const detail = agent.id === "business" ? "统筹发布、数据与复盘" : agent.id === "director" ? "采集灵感并完成编导方案" : agent.id === "content" ? "按方案制作并检查成片" : "整理客户并生成跟进草稿";
            return <div key={agent.id} className="rounded-lg border border-slate-200 bg-slate-50/70 p-4"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-emerald-700"><Icon size={17} /></span><p className="mt-3 text-sm font-semibold text-slate-900">{agent.label}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{detail}</p></div>;
          })}
        </div>
        {activeRun && <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800">当前运行继续沿用已批准计划；本次保存从下一轮生效。</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button htmlType="button" onClick={() => setSettingsEditorOpen(true)} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">查看并修改设置</Button>
          <Button type="primary" htmlType="button" disabled={busy} onClick={confirmRecommendedSettings} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold">{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}确认并保存设置</Button>
        </div>
      </section>
      {settingsEditorOpen && <section aria-label="Agent 设置" className="rounded-lg border border-border bg-white p-5">
      <Button htmlType="button" aria-label="关闭 Agent 设置" disabled={busy} onClick={() => setSettingsEditorOpen(false)} className="!h-auto min-h-9 !whitespace-normal sticky top-0 z-10 float-right rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"><X size={18} /></Button>
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-emerald-50 p-3 text-emerald-700">
          <Settings2 size={22} />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
            运行规则
          </p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">设置数字员工的运行方式</h2>
          <p className="mt-1 text-sm text-slate-500">
            {activeRun
              ? "当前运行继续沿用已批准计划；这里保存的配置从下一轮计划生效。"
              : "这里只保留四个 Agent 各自需要由用户决定的设置。"}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1.5 sm:grid-cols-4">
        {([
          { id: "business" as const, label: "经营 Agent", icon: BarChart3 },
          { id: "director" as const, label: "编导 Agent", icon: Search },
          { id: "content" as const, label: "内容 Agent", icon: Sparkles },
          { id: "customer" as const, label: "客服 Agent", icon: MessageSquare },
        ]).map((agent)=>{const active=activeRuleAgent===agent.id;const Icon=agent.icon;return <Button key={agent.id} htmlType="button" aria-pressed={active} onClick={()=>setActiveRuleAgent(agent.id)} className={`!h-auto min-h-9 !whitespace-normal flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-center transition ${active?"bg-slate-950 text-white":"bg-white text-slate-600 hover:bg-slate-100"}`}><Icon size={15}/><span className="text-xs font-semibold">{agent.label}</span></Button>})}
      </div>
      <div className="mt-4 grid gap-4">
        {activeRuleAgent === "director" && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div><p className="text-sm font-bold text-emerald-950">AI 推荐经营需求</p><p className="mt-1 text-xs text-emerald-700">根据行业、业务、重点产品和目标市场生成给编导的采集建议；实际搜索范围以已批准的灵感范围为准。</p></div>
          <div className="text-right"><Button htmlType="button" disabled={!canGenerateRecommendation} onClick={applyAiRecommendation} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold"><Sparkles size={14} />{recommendationApplied ? "已生成，可继续调整" : "填入基础关键词"}</Button>{!canGenerateRecommendation&&<p role="status" className="mt-1 text-[10px] text-amber-700">请先补齐：{missingRecommendationFields.join("、")}</p>}</div>
        </div>}
        {activeRuleAgent === "director" && <section className="rounded-lg border border-slate-200 p-4">
          <p className="text-sm font-bold text-slate-900">编导采集需求与导演规则</p>
          <p className="mt-1 text-xs text-slate-500">这里记录经营 Agent 对编导的目标和建议。保存后不会直接覆盖正在执行的采集范围；编导采集以灵感大屏已批准的范围为准。</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs font-semibold text-emerald-900">{approvedDiscoveryScope ? `当前生效：编导采集范围 v${approvedDiscoveryScope.approval?.scopeVersion ?? approvedDiscoveryScope.version} · ${approvedDiscoveryScope.discoveryBrief.lookbackDays} 天 · 滚动 7 天目标 ${approvedDiscoveryScope.discoveryBrief.resultLimit} 条` : discoveryScopeNotice || '正在读取当前编导采集范围…'}</p>
            <Button htmlType="button" onClick={() => onNavigate?.('socialInspiration')} disabled={!onNavigate} className="!h-auto min-h-9 !whitespace-normal rounded-lg px-3 py-2 text-xs font-bold">到灵感大屏确认或调整</Button>
          </div>
          <div className="mt-4 space-y-4">
            <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">1 · 建议采集范围</p><div className="space-y-3"><Field label="建议平台"><input className={inputClass} value={collectionPlatforms} onChange={e=>setCollectionPlatforms(e.target.value)} /></Field><Field label="建议来源"><input className={inputClass} value={collectionSources} onChange={e=>setCollectionSources(e.target.value)} /></Field><Field label="建议关键词"><input className={inputClass} value={collectionKeywords} onChange={e=>setCollectionKeywords(e.target.value)} placeholder="仅作为经营需求，实际词在灵感大屏确认" /></Field></div></div>
            <div><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">2 · 建议执行节奏</p><div className="grid gap-3 md:grid-cols-3"><Field label="建议采集时间"><input className={inputClass} value={collectionTime} onChange={e=>setCollectionTime(e.target.value)} /></Field><Field label="建议回看天数"><input className={inputClass} type="number" min={1} value={collectionLookback} onChange={e=>setCollectionLookback(Number(e.target.value))} /></Field><Field label="建议单次上限"><input className={inputClass} type="number" min={1} value={collectionLimit} onChange={e=>setCollectionLimit(Number(e.target.value))} /></Field></div></div>
          </div>
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">经营建议：近 {collectionLookback} 天 · 单次最多 {collectionLimit} 条。编导确认后才会成为采集参数。</p>
        </section>}
        {activeRuleAgent === "content" && <section className="rounded-lg border border-slate-200 p-4">
          <p className="text-sm font-bold text-slate-900">输出内容语言</p>
          <p className="mt-1 text-xs text-slate-500">内容 Agent 只按这里确认的语言交付内容。</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="主语言"><select className={inputClass} value={form.videoDefaults?.language || 'en'} onChange={event => { const language=event.target.value; set('videoDefaults', { ...form.videoDefaults, language }); set('videoLanguages', [language, ...(form.videoLanguages || []).filter(item=>item!==language)]); }}><option value="en">英语</option><option value="zh">中文</option><option value="es">西班牙语</option><option value="fr">法语</option><option value="de">德语</option></select></Field>
            <div><p className="text-xs font-semibold text-slate-600">需要输出的语言</p><div className="mt-2 flex flex-wrap gap-2">{[{code:'en',label:'英语'},{code:'zh',label:'中文'},{code:'es',label:'西班牙语'},{code:'fr',label:'法语'},{code:'de',label:'德语'}].map(item=>{const selected=(form.videoLanguages || [form.videoDefaults?.language || 'en']).includes(item.code);const primary=(form.videoDefaults?.language || 'en')===item.code;return <label key={item.code} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${selected?'border-blue-300 bg-blue-50':'border-slate-200 bg-white'}`}><input type="checkbox" checked={selected} disabled={primary} onChange={()=>set('videoLanguages',selected?(form.videoLanguages || []).filter(code=>code!==item.code):[...(form.videoLanguages || [form.videoDefaults?.language || 'en']),item.code])}/>{item.label}{primary?' · 主语言':''}</label>})}</div></div>
          </div>
        </section>}
        {activeRuleAgent === "business" && <section className="rounded-lg border border-slate-200 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-bold text-slate-900">周草稿、发布平台与具体账号</p><p className="mt-1 text-xs text-slate-500">默认向所有已连接账号和平台发布，具体节奏沿用视频矩阵。</p></div><div className="flex flex-wrap items-center gap-3"><Button htmlType="button" onClick={()=>{setSelectedPublishPlatforms([]);set("publishingTargets",[]);set("allowRealPublishing",false);}} className="!h-auto min-h-9 !whitespace-normal text-xs font-bold text-slate-600 hover:text-slate-950">本周暂不发布，仅生成内容</Button><Button htmlType="button" onClick={()=>onOpenReadiness({key:"social_accounts",label:"社媒账号",status:"empty",count:connectedPublishingAccounts.length,page:"accountManagement",note:"管理发布账号"})} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-1 text-xs font-bold text-blue-700">管理账号 <ExternalLink size={12}/></Button></div></div>
          <div className="mt-4"><Field label="每周生成的草稿条数"><input className={inputClass} type="number" min={0} value={publishCount} onChange={event=>setPublishCount(Number(event.target.value))} /><p className="mt-1 text-[10px] text-slate-500">当前值从旧站发布条数恢复，用户可以直接修改。</p></Field></div>
          <div className="mt-4 space-y-3">{publishingPlatforms.map(platform => { const selected=selectedPublishPlatforms.includes(platform); const accounts=connectedPublishingAccounts.filter(account=>account.platform===platform); return <div key={platform} className={`rounded-lg border p-3 ${selected?'border-violet-200 bg-violet-50/35':'border-slate-200 bg-slate-50'}`}><div className="flex flex-wrap items-center gap-3"><label className="flex min-w-36 items-center gap-2 text-xs font-semibold text-slate-900"><input type="checkbox" checked={selected} onChange={event=>setSelectedPublishPlatforms(current=>event.target.checked?[...new Set([...current,platform])]:current.filter(item=>item!==platform))}/>{contentPlatformLabel[platform]}</label><label className="ml-auto flex items-center gap-2 text-[11px] font-bold text-slate-600">每周发布<input type="number" min={0} disabled={!selected} value={platformPublishCounts[platform]} onChange={event=>setPlatformPublishCounts(current=>({...current,[platform]:Number(event.target.value)}))} className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-xs" />条</label></div><div className="mt-2 flex flex-wrap gap-2">{publishingAccountsLoading?<span className="text-[10px] text-slate-400">正在读取账号…</span>:accounts.length?accounts.map(account=>{const checked=form.publishingTargets.some(target=>target.accountId===account.accountId);return <label key={account.accountId} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-bold ${checked&&selected?'border-violet-200 bg-white text-violet-800':'border-slate-200 bg-white text-slate-400'}`}><input type="checkbox" disabled={!selected} checked={checked&&selected} onChange={()=>set('publishingTargets',checked?form.publishingTargets.filter(target=>target.accountId!==account.accountId):[...form.publishingTargets,account])}/>{account.accountLabel}</label>}):<span className="text-[10px] text-amber-700">尚未连接该平台账号</span>}</div></div>; })}</div>
          {publishingAccountsError&&<p className="mt-3 text-[10px] text-red-600">{publishingAccountsError}</p>}
          <label className="mt-4 flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3"><input type="checkbox" className="mt-0.5" checked={form.allowRealPublishing} onChange={event=>set("allowRealPublishing",event.target.checked)}/><span><span className="block text-xs font-semibold text-slate-900">审批通过后允许真实发布</span><span className="mt-0.5 block text-[10px] leading-5 text-slate-500">关闭时只生成发布草稿和排期，不会发送到社媒平台。</span></span></label>
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">已选平台 {selectedPublishPlatforms.length} 个；发布时按各平台条数和所选账号进入视频矩阵排期。</p>
        </section>}
        {activeRuleAgent === "customer" && <details className="rounded-lg border border-emerald-100 bg-emerald-50/45 p-4">
          <summary className="cursor-pointer text-sm font-bold text-emerald-950">客服知识与接待信息（按需展开）</summary>
          <p className="mt-2 text-xs text-emerald-800">企业和产品资料全系统共用；这里只补充客服专用的接待规则和通知方式。</p>
          <div className="mt-4"><KnowledgeIntakePanel /></div>
        </details>}
        {activeRuleAgent === "customer" && <div className="md:col-span-2 rounded-lg border border-slate-200 p-4"><p className="text-sm font-bold text-slate-900">客户跟进规则</p><div className="mt-3 grid gap-3 md:grid-cols-2"><Field label="草稿生成时间"><input className={inputClass} value={followupGenerateAt} onChange={e=>setFollowupGenerateAt(e.target.value)} /></Field><Field label="审批截止"><input className={inputClass} value={followupApproveBy} onChange={e=>setFollowupApproveBy(e.target.value)} /></Field><Field label="允许发送时段"><input className={inputClass} value={followupWindow} onChange={e=>setFollowupWindow(e.target.value)} /></Field><Field label="客户触达频控"><input className={inputClass} value={followupFrequency} onChange={e=>setFollowupFrequency(e.target.value)} /></Field></div><label className="mt-3 flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3"><input type="checkbox" className="mt-0.5" checked={form.allowRealCustomerMessages} onChange={e=>set("allowRealCustomerMessages",e.target.checked)}/><span><span className="block text-xs font-semibold text-slate-900">审批通过后允许真实发送客服消息</span><span className="mt-0.5 block text-[10px] text-slate-500">未开启时只生成和审批草稿，不调用真实消息渠道；商业承诺仍需逐条人工审批。</span></span></label><p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">先生成逐客草稿并等待审批，仅在客户当地工作时间发送。</p></div>}
      </div>
      <div className="mt-4 flex flex-col items-end gap-2">
        {submitted && Object.keys(errors).length > 0 && (
          <div role="alert" className="flex flex-wrap items-center justify-end gap-2 text-xs font-semibold text-red-600"><span>还需填写：{missingConfigLabels.join("、")}。</span><Button htmlType="button" onClick={goToFirstMissingConfig} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-bold text-red-700">去补齐</Button></div>
        )}
        <Button type="primary"
          htmlType="button"
          disabled={busy || (submitted && Object.keys(errors).length > 0)}
          onClick={submit}
          className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold transition"
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <ArrowRight size={16} />
          )}{" "}
          {mode === "first"
            ? "保存配置，进入周目标"
            : activeRun
              ? "保存为后续运行规则"
              : "保存运行规则"}
        </Button>
      </div>
    </section>}
    </>
  );
}

type GoalDraft = Omit<
  WeeklyGoal,
  "id" | "status" | "version" | "createdAt" | "updatedAt"
>;

function GoalPanel({
  config,
  busy,
  onSave,
  businessLine,
  contentPlatform,
  onOpenSettings,
}: {
  config: DigitalEmployeeConfig;
  busy: boolean;
  onSave: (goal: GoalDraft) => void;
  businessLine: BusinessLine;
  contentPlatform: ContentPlatform;
  onOpenSettings?: () => void;
}) {
  const configuredPlatforms = config.enabledWorkflows.includes("content_publish") && config.publishingTargets.length ? [...new Set(config.publishingTargets.map(target => target.platform))] : (["youtube", "tiktok", "instagram", "facebook"] as const).slice();
  const initialPlatforms = contentPlatform !== "all" && configuredPlatforms.includes(contentPlatform)
    ? [contentPlatform]
    : config.enabledWorkflows.includes("content_publish") ? configuredPlatforms : [configuredPlatforms[0]];
  const initialPresetId: WeeklyTaskPackagePresetId = config.operatingMaturity === 'starting' ? 'b2b_starting' : 'b2b_growing';
  const initialPreset = weeklyTaskPackagePreset(initialPresetId);
  const presetPlatforms = (presetId: WeeklyTaskPackagePresetId) => {
    const preset = weeklyTaskPackagePreset(presetId);
    const available = preset.platforms.filter(platform => configuredPlatforms.includes(platform));
    return available.length ? available : initialPlatforms;
  };
  const initialPresetPlatforms = presetPlatforms(initialPresetId);
  const initialProduct = config.focusProducts.split(/[、，,；;\n]/).map(item => item.trim()).filter(Boolean)[0] || '';
  const buildPlans = (preset: ReturnType<typeof weeklyTaskPackagePreset>, platforms: Array<Exclude<ContentPlatform, "all">>, focus = '') => buildPresetMatrixVideoPlans({
    preset,
    productName: initialProduct,
    focus,
    defaults: config.videoDefaults,
    platforms,
    matrixRows: defaultMatrixPlan(config, platforms, focus.trim() ? `${preset.objective}；本周重点：${focus.trim()}` : preset.objective),
  });
  const targetFor = (preset: ReturnType<typeof weeklyTaskPackagePreset>, videoCount: number) =>
    ['approved_content_packages', 'published_posts'].includes(preset.metric) ? videoCount : preset.weeklyOutput;
  const initialVideoPlans = businessLine === 'customer_conversion' ? [] : buildPlans(initialPreset, initialPresetPlatforms);
  const [selectedPresetId, setSelectedPresetId] = useState<WeeklyTaskPackagePresetId>(initialPresetId);
  const [weeklyFocus, setWeeklyFocus] = useState('');
  const [goalEditorOpen, setGoalEditorOpen] = useState(false);
  const [form, setForm] = useState<GoalDraft>(() => ({
    ...EMPTY_GOAL,
    businessLine,
    videoPlans: initialVideoPlans,
    contentPlatforms: businessLine === 'customer_conversion' ? initialPlatforms : initialPresetPlatforms,
    title: businessLine === "customer_conversion" ? "本周客户转化目标" : `${initialPreset.label}周任务包`,
    objective: businessLine === "customer_conversion" ? "提升高意向客户的报价、跟进与成交转化" : initialPreset.objective,
    metric: businessLine === 'customer_conversion' ? 'qualified_inquiries' : initialPreset.metric,
    target: businessLine === 'customer_conversion' ? 1 : targetFor(initialPreset, initialVideoPlans.length),
    unit: businessLine === 'customer_conversion' ? '位' : '条',
    scope: config.targetMarkets,
  }));
  const [submitted, setSubmitted] = useState(false);
  const estimatedPlanCost = (form.videoPlans || []).reduce((sum, plan) => sum + Number(plan.estimatedCost || 0), 0);
  const set = <K extends keyof GoalDraft>(key: K, value: GoalDraft[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const errors = {
    title: form.title.trim() ? "" : "请填写目标名称",
    objective: form.objective.trim() ? "" : "请填写本周重点结果",
    scope: form.scope.trim() ? "" : "请明确业务范围",
    target: form.target > form.baseline ? "" : "目标值必须大于基线",
    dates: form.endsAt >= form.startsAt ? "" : "结束日期不能早于开始日期",
    contentPlatforms: businessLine !== "customer_conversion" && !form.contentPlatforms.length ? "请至少选择一个内容制作平台" : "",
    product: businessLine !== 'customer_conversion' && !initialProduct ? '请先在 Agent 设置中选择重点产品' : '',
  };
  const hasErrors = Object.values(errors).some(Boolean) || (form.videoPlans || []).some(plan => videoPlanErrors(plan).length > 0 || !form.contentPlatforms.includes(plan.platform));
  const goalErrorLabels: Record<keyof typeof errors, string> = {
    title: '目标名称', objective: '本周重点结果', scope: '业务范围（目标市场）', target: '目标值', dates: '目标周期', contentPlatforms: '内容制作平台', product: '重点产品',
  };
  const missingGoalFields = (Object.entries(errors) as Array<[keyof typeof errors, string]>).filter(([, error]) => Boolean(error)).map(([key, error]) => `${goalErrorLabels[key]}：${error}`);
  const videoPlanIssues = (form.videoPlans || []).flatMap((plan, index) => videoPlanErrors(plan).map(error => `第 ${index + 1} 条：${error}`));
  const platformPlanCounts = form.contentPlatforms.map(platform => ({ platform, count: (form.videoPlans || []).filter(plan => plan.platform === platform).length }));
  const submit = () => {
    setSubmitted(true);
    if (hasErrors) {
      setGoalEditorOpen(true);
      return;
    }
    setGoalEditorOpen(false);
    onSave(form);
  };
  const choosePreset = (presetId: WeeklyTaskPackagePresetId) => {
    const preset = weeklyTaskPackagePreset(presetId);
    const platforms = presetPlatforms(presetId);
    setSelectedPresetId(presetId);
    setForm(current => {
      const videoPlans = buildPlans(preset, platforms, weeklyFocus);
      return {
        ...current,
        title: `${preset.label}周任务包`,
        objective: preset.objective,
        metric: preset.metric,
        target: targetFor(preset, videoPlans.length),
        unit: '条',
        contentPlatforms: platforms,
        videoPlans,
      };
    });
  };
  const updateWeeklyFocus = (value: string) => {
    setWeeklyFocus(value);
    const preset = weeklyTaskPackagePreset(selectedPresetId);
    setForm(current => {
      const videoPlans = buildPlans(preset, current.contentPlatforms, value);
      return {
        ...current,
        objective: value.trim() ? `${preset.objective}；本周重点：${value.trim()}` : preset.objective,
        target: targetFor(preset, videoPlans.length),
        videoPlans,
      };
    });
  };
  const updateContentPlatforms = (platform: Exclude<ContentPlatform, "all">) => {
    setForm(current => {
      const selected = current.contentPlatforms.includes(platform);
      const contentPlatforms = selected ? current.contentPlatforms.filter(item => item !== platform) : [...current.contentPlatforms, platform];
      const videoPlans = contentPlatforms.length ? buildPlans(weeklyTaskPackagePreset(selectedPresetId), contentPlatforms, weeklyFocus) : [];
      const target = ['approved_content_packages', 'published_posts'].includes(current.metric) ? videoPlans.length : current.target;
      return { ...current, contentPlatforms, videoPlans, target };
    });
  };
  return (
    <>
      <section className="rounded-lg border border-border bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><div className="rounded-lg bg-emerald-50 p-3 text-emerald-700"><Target size={22} /></div><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">本周任务确认</p><h2 className="mt-1 text-lg font-semibold text-slate-950">灵小枢已生成本周默认方案</h2><p className="mt-1 text-xs leading-5 text-slate-500">产量由账号矩阵的逐平台周配额相加，确认后不会再从其他口径扩出不同数量。</p></div></div><span className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${hasErrors ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{hasErrors ? `需补 ${missingGoalFields.length + videoPlanIssues.length} 项` : '可直接确认'}</span></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg bg-slate-50 p-4"><p className="text-[10px] font-bold text-slate-400">任务方案</p><p className="mt-1 text-sm font-semibold text-slate-900">{businessLine === 'customer_conversion' ? '客户转化任务' : weeklyTaskPackagePreset(selectedPresetId).label}</p></div>
          <div className="rounded-lg bg-slate-50 p-4"><p className="text-[10px] font-bold text-slate-400">本周实际视频任务</p><p className="mt-1 text-sm font-semibold text-slate-900">{form.videoPlans?.length || 0} 条</p><p className="mt-1 text-[9px] text-slate-400">等于下方各平台任务数之和</p></div>
          <div className="rounded-lg bg-slate-50 p-4"><p className="text-[10px] font-bold text-slate-400">平台分配</p><p className="mt-1 text-sm font-semibold text-slate-900">{platformPlanCounts.map(item => `${contentPlatformLabel[item.platform]} ${item.count}`).join(' · ') || '待确认'}</p><p className="mt-1 text-[9px] text-slate-400">覆盖 {platformPlanCounts.filter(item => item.count > 0).length}/{form.contentPlatforms.length} 个目标平台</p></div>
          <div className="rounded-lg bg-slate-50 p-4"><p className="text-[10px] font-bold text-slate-400">业务范围</p><p className="mt-1 truncate text-sm font-semibold text-slate-900">{form.scope || '按企业默认市场'}</p></div>
          <div className="rounded-lg bg-slate-50 p-4"><p className="text-[10px] font-bold text-slate-400">预计成本</p><p className="mt-1 text-sm font-semibold text-slate-900">{estimatedPlanCost > 0 ? `¥${estimatedPlanCost.toFixed(2)}` : '待真实核算'}</p><p className="mt-1 text-[9px] text-slate-400">实际以服务费用回执为准</p></div>
        </div>
        <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/55 px-4 py-3"><p className="text-xs font-semibold text-emerald-950">本周重点结果</p><p className="mt-1 text-xs leading-5 text-emerald-800">{form.objective}</p></div>
        {businessLine !== 'customer_conversion' && Boolean(form.videoPlans?.length) && <section aria-label="社媒视频矩阵" className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-sm font-semibold text-slate-900">社媒视频矩阵</p><p className="mt-1 text-xs text-slate-500">已按平台拆成 {form.videoPlans?.length || 0} 条视频任务，确认前仍可逐条调整。</p></div>
            <Button htmlType="button" onClick={() => setGoalEditorOpen(true)} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-emerald-300">编辑完整矩阵</Button>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {form.videoPlans?.slice(0, 8).map((plan, index) => <div key={`${plan.platform}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700">{contentPlatformLabel[plan.platform]}</span><span className="text-[10px] font-semibold text-slate-400">{plan.duration} 秒 · {plan.language}</span></div>
              <p className="mt-2 truncate text-xs font-semibold text-slate-900">{plan.productName || '待选择产品'}</p>
              <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">{plan.theme || '待补充视频主题'}</p>
            </div>)}
          </div>
          {(form.videoPlans?.length || 0) > 8 && <p className="mt-3 text-[10px] font-bold text-slate-500">当前先展示 8 条，另有 {(form.videoPlans?.length || 0) - 8} 条可在“编辑完整矩阵”中查看。</p>}
        </section>}
        {submitted && hasErrors && <div role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"><p className="font-semibold">暂时不能确认，具体缺少：</p><ul className="mt-2 list-disc space-y-1 pl-4">{[...missingGoalFields, ...videoPlanIssues.slice(0, 3)].map(item => <li key={item}>{item}</li>)}</ul>{errors.product && onOpenSettings && <Button htmlType="button" onClick={onOpenSettings} className="!h-auto min-h-9 !whitespace-normal mt-3 rounded-lg bg-amber-900 px-3 py-2 text-[11px] font-semibold text-white">去 Agent 设置选择重点产品</Button>}</div>}
        <div className="mt-5 flex flex-wrap justify-end gap-2"><Button htmlType="button" onClick={() => setGoalEditorOpen(true)} className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">调整本周设置</Button><Button type="primary" htmlType="button" disabled={busy} onClick={submit} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold">{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}确认周计划</Button></div>
      </section>
      {goalEditorOpen && <section aria-label="调整本周设置" className="rounded-lg border border-border bg-white p-4 sm:p-5">
      <Button htmlType="button" aria-label="关闭本周设置" disabled={busy} onClick={() => setGoalEditorOpen(false)} className="!h-auto min-h-9 !whitespace-normal sticky top-0 z-10 float-right rounded-lg border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50"><X size={18} /></Button>
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-emerald-50 p-3 text-emerald-700">
          <Target size={22} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            选一个周任务包，告诉灵小枢本周重点
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            灵小枢会把内容方向、平台节奏和 Agent 分工整理成可确认计划；你只需补充本周重点。
          </p>
        </div>
      </div>
      {submitted && hasErrors && <div role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"><p className="font-semibold">请先补齐以下信息：</p><ul className="mt-2 list-disc space-y-1 pl-4">{[...missingGoalFields, ...videoPlanIssues.slice(0, 3)].map(item => <li key={item}>{item}</li>)}</ul>{errors.product && onOpenSettings && <Button htmlType="button" onClick={onOpenSettings} className="!h-auto min-h-9 !whitespace-normal mt-3 rounded-lg bg-amber-900 px-3 py-2 text-[11px] font-semibold text-white">去 Agent 设置选择重点产品</Button>}</div>}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {businessLine !== 'customer_conversion' && <>
          <details className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3">
            <summary className="cursor-pointer text-xs font-semibold text-slate-700">更换周任务方案（当前：{weeklyTaskPackagePreset(selectedPresetId).label}）</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {WEEKLY_TASK_PACKAGE_PRESETS.map(preset => {
                const selected = selectedPresetId === preset.id;
                return <Button key={preset.id} htmlType="button" aria-pressed={selected} onClick={() => choosePreset(preset.id)} className={`!h-auto min-h-9 !whitespace-normal rounded-lg border p-3 text-left transition ${selected ? 'border-emerald-500 bg-emerald-50 shadow-[0_0_0_1px_rgba(16,185,129,0.15)]' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <span className="flex items-start justify-between gap-2"><strong className="text-sm text-slate-950">{preset.label}</strong>{selected && <CheckCircle2 size={16} className="shrink-0 text-emerald-700" />}</span>
                  <span className="mt-1.5 block text-[11px] leading-5 text-slate-500">{preset.description}</span>
                  <span className="mt-3 block text-[10px] font-bold text-emerald-700">主平台：{contentPlatformLabel[preset.primaryPlatform]} · {preset.weeklyOutput} 个选题方向</span>
                </Button>;
              })}
            </div>
          </details>
          <label className="md:col-span-2 text-xs font-semibold text-slate-700">本周最想解决什么？
            <input className={`${inputClass} mt-2`} value={weeklyFocus} onChange={event => updateWeeklyFocus(event.target.value)} placeholder="例如：验证东南亚采购商最关心的选型问题" />
          </label>
          {submitted && errors.product && <p role="alert" className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{errors.product}</p>}
          <details className="md:col-span-2 rounded-lg border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-xs">
            <summary className="cursor-pointer font-semibold text-emerald-950">查看执行安排</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div><p className="font-semibold text-emerald-950">发布节奏</p><p className="mt-1 leading-5 text-emerald-800">{weeklyTaskPackagePreset(selectedPresetId).frequency}</p></div>
            <div><p className="font-semibold text-emerald-950">账号安排</p><p className="mt-1 leading-5 text-emerald-800">{weeklyTaskPackagePreset(selectedPresetId).accountRoles}</p></div>
            <div><p className="font-semibold text-emerald-950">由谁完成</p><p className="mt-1 leading-5 text-emerald-800">灵小枢安排各数字员工完成，并在需要你决定时提醒。</p></div>
            </div>
          </details>
        </>}
        {businessLine !== "customer_conversion" && <div className="md:col-span-2 rounded-lg border border-blue-100 bg-blue-50/50 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-semibold text-slate-900">确认本期制作平台</p><p className="mt-1 text-xs text-slate-500">选择平台会立即重算该平台账号的周配额和实际内容任务数。</p></div><span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold text-blue-700">{!config.enabledWorkflows.includes("content_publish")?"仅制作内容，不发布":config.allowRealPublishing?"获批后允许真实发布":"获批后停在人工待发布"}</span></div><div className="mt-3 flex flex-wrap gap-2">{configuredPlatforms.map(platform=>{const selected=form.contentPlatforms.includes(platform);const accounts=config.publishingTargets.filter(target=>target.platform===platform);const count=(form.videoPlans||[]).filter(plan=>plan.platform===platform).length;return <Button key={platform} htmlType="button" aria-pressed={selected} onClick={()=>updateContentPlatforms(platform)} className={`!h-auto min-h-9 !whitespace-normal rounded-lg border px-3 py-2 text-left ${selected?"border-blue-400 bg-white text-blue-800":"border-slate-200 bg-slate-50 text-slate-500"}`}><span className="block text-xs font-semibold">{contentPlatformLabel[platform]}{selected?` · ${count} 条`:''}</span><span className="mt-0.5 block text-[9px]">{accounts.map(account=>account.accountLabel).join("、")||"待连接账号"}</span></Button>})}</div>{submitted&&errors.contentPlatforms&&<p className="mt-2 text-[10px] font-semibold text-red-600">{errors.contentPlatforms}</p>}</div>}
        {businessLine !== 'customer_conversion' && <details className="md:col-span-2 rounded-lg border border-slate-200 bg-white px-4 py-3"><summary className="cursor-pointer text-xs font-semibold text-slate-700">查看并调整具体视频计划（可选）</summary><div className="mt-4"><VideoPlanEditor plans={form.videoPlans || []} config={config} platforms={form.contentPlatforms} themeWorkflow onChange={videoPlans => setForm(current => ({ ...current, videoPlans, target: ['approved_content_packages', 'published_posts'].includes(current.metric) ? videoPlans.length : current.target }))} /></div></details>}
        <details className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">系统生成的目标设置（需要时可修改）</summary>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field
          label="目标名称"
          error={submitted ? errors.title : ""}
          wide
        >
          <input
            className={inputClass}
            value={form.title}
            onChange={(event) => set("title", event.target.value)}
          />
        </Field>
        <Field
          label="本周重点结果"
          error={submitted ? errors.objective : ""}
          wide
        >
          <textarea
            className={`${inputClass} min-h-20 resize-y`}
            value={form.objective}
            onChange={(event) => set("objective", event.target.value)}
          />
        </Field>
        <Field label="衡量指标">
          <select
            className={inputClass}
            value={form.metric}
            onChange={(event) => setForm(current => ({ ...current, metric: event.target.value, target: ['approved_content_packages', 'published_posts'].includes(event.target.value) ? (current.videoPlans?.length || 0) : current.target }))}
          >
            <option value="approved_content_packages">获批内容包</option>
            <option value="published_posts">真实发布内容</option>
            <option value="qualified_inquiries">高意向询盘</option>
            <option value="won_customers">成交客户</option>
            <option value="reactivated_customers">唤醒客户</option>
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="基线">
            <input
              className={inputClass}
              type="number"
              value={form.baseline}
              onChange={(event) => set("baseline", Number(event.target.value))}
            />
          </Field>
          <Field label="目标" error={submitted ? errors.target : ""}>
            <input
              className={inputClass}
              type="number"
              value={form.target}
              onChange={(event) => set("target", Number(event.target.value))}
            />
          </Field>
          <Field label="单位">
            <input
              className={inputClass}
              value={form.unit}
              onChange={(event) => set("unit", event.target.value)}
            />
          </Field>
        </div>
        <Field label="开始日期">
          <input
            className={inputClass}
            type="date"
            value={form.startsAt}
            onChange={(event) => set("startsAt", event.target.value)}
          />
        </Field>
        <Field label="结束日期" error={submitted ? errors.dates : ""}>
          <input
            className={inputClass}
            type="date"
            value={form.endsAt}
            onChange={(event) => set("endsAt", event.target.value)}
          />
        </Field>
        <Field
          label="业务范围"
          error={submitted ? errors.scope : ""}
          wide
        >
          <input
            className={inputClass}
            value={form.scope}
            onChange={(event) => set("scope", event.target.value)}
          />
        </Field>
        <Field label="本周特殊限制">
          <input
            className={inputClass}
            value={form.constraints.join("；")}
            onChange={(event) =>
              set(
                "constraints",
                event.target.value
                  .split(/[；;\n]/)
                  .map((item) => item.trim())
                  .filter(Boolean),
              )
            }
          />
        </Field>
          </div>
        </details>
      </div>
      <div className="mt-6 flex justify-end">
        <Button type="primary"
          htmlType="button"
          disabled={busy || (submitted && hasErrors)}
          onClick={submit}
          className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold transition"
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Check size={16} />
          )}{" "}
          保存设置并确认周计划
        </Button>
      </div>
    </section>}
    </>
  );
}

function TaskIcon({ status }: { status: string }) {
  if (status === "succeeded")
    return <CheckCircle2 size={18} className="text-emerald-600" />;
  if (status === "running")
    return <Loader2 size={18} className="animate-spin text-blue-600" />;
  if (status === "waiting_external")
    return <Clock3 size={18} className="text-sky-600" />;
  if (status === "waiting_approval")
    return <ShieldCheck size={18} className="text-amber-600" />;
  if (status === "handed_off")
    return <Hand size={18} className="text-violet-600" />;
  if (status === "failed")
    return <XCircle size={18} className="text-red-600" />;
  return <Circle size={18} className="text-slate-300" />;
}

function outputSummary(task: WorkflowTask): string {
  if (task.output.dataStatus === "not_required") return String(task.output.summary || "本轮无需执行");
  if (task.output.dataStatus === "no_data") return "暂无符合条件的客户，本轮继续其他任务；未计为已完成或已发送。";
  if (task.task_key === "context_readiness")
    return `已确认企业、行业、目标市场和 ${Array.isArray(task.output.constraints) ? task.output.constraints.length : 0} 条行动边界`;
  if (task.task_key === "goal_decomposition")
    return `已绑定指标 ${humanizeValue(task.output.successMetric || "待确认")}，形成 4 个检查点`;
  if (task.task_key === "content_execution_pack")
    return `已形成 ${Array.isArray(task.output.themes) ? task.output.themes.length : 0} 个内容主题与渠道建议`;
  if (task.task_key === "schedule_activation")
    return "执行清单已登记；未模拟真实渠道发布结果";
  if (task.status === "waiting_approval") return task.blocked_reason;
  return task.status === "succeeded"
    ? "结果已持久化并写入事件流"
    : task.blocked_reason || "";
}

function EventTimeline({
  events,
  activeTaskId,
  actionEventId,
  actionLabel,
  onAction,
}: {
  events: RunEvent[];
  activeTaskId?: string;
  actionEventId?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="space-y-4">
      {events.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
          目标批准后，这里会展示服务端真实运行事件。
        </p>
      )}
      {[...events].reverse().map((event) => (
        <div
          key={event.id}
          className={`relative flex gap-3 rounded-lg p-2 pl-2 transition ${activeTaskId && event.task_id === activeTaskId ? "bg-blue-50 ring-1 ring-blue-100" : ""}`}
        >
          <div
            className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${event.level === "success" ? "bg-emerald-500" : event.level === "warning" ? "bg-amber-500" : event.level === "error" ? "bg-red-500" : "bg-blue-500"}`}
          />
          <div className="min-w-0 flex-1 border-b border-slate-100 pb-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-slate-800">
                {event.summary}
              </p>
              <span className="shrink-0 text-[10px] text-slate-400">
                {event.occurred_at
                  ? new Date(event.occurred_at).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : ""}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              第 {event.sequence} 条 ·{" "}
              {eventTypeLabel[event.type] || "工作状态已更新"}
            </p>
            {event.id === actionEventId && actionLabel && onAction && <Button
              htmlType="button"
              onClick={onAction}
              className="!h-auto min-h-9 !whitespace-normal mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
            >
              {actionLabel} <ArrowRight size={13} />
            </Button>}
          </div>
        </div>
      ))}
    </div>
  );
}

type WorkspaceView = "today" | "matrix" | "overview" | "live" | "review" | "rules";
type BusinessLine = "full_funnel" | "content_growth" | "customer_conversion";
type ContentPlatform = "all" | "facebook" | "instagram" | "tiktok" | "youtube";

const businessLineLabel: Record<BusinessLine, string> = {
  full_funnel: "全链路经营",
  content_growth: "内容增长",
  customer_conversion: "客户转化",
};

const contentPlatformLabel: Record<ContentPlatform, string> = {
  all: "全部平台",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
};

function taskBusinessLine(task: WorkflowTask): BusinessLine {
  if (task.business_line) return task.business_line;
  const domain = String(task.business_domain || "").toLowerCase();
  if (domain === "customer") return "customer_conversion";
  if (["content", "publishing", "social", "industry"].includes(domain)) return "content_growth";
  return "full_funnel";
}

const workspaceViews: Array<{
  id: WorkspaceView;
  label: string;
  caption: string;
}> = [
  { id: "today", label: "今天要做", caption: "优先事项与本周进度" },
  { id: "live", label: "任务执行", caption: "计划确认、进度与审批" },
  { id: "overview", label: "生产与交付", caption: "作品产出、审核与发布" },
  { id: "review", label: "复盘", caption: "周期结果与改进" },
];

function BusinessLineNav({ value, platform, onChange, onPlatformChange }: { value: BusinessLine; platform: ContentPlatform; onChange: (value: BusinessLine) => void; onPlatformChange: (value: ContentPlatform) => void }) {
  const lines: Array<[BusinessLine, string, string]> = [
    ["full_funnel", "全链路经营", "曝光到成交"],
    ["content_growth", "内容增长", "情报到获客"],
    ["customer_conversion", "客户转化", "询盘到成交"],
  ];
  const platforms: Array<[ContentPlatform, string]> = [["all","全部平台"],["facebook","Facebook"],["instagram","Instagram"],["tiktok","TikTok"],["youtube","YouTube"]];
  return <section aria-label="经营视角切换" className="border-b border-slate-200 bg-transparent">
    <div className="flex flex-wrap items-center gap-5">
      <span className="flex items-center gap-1.5 py-3 text-[10px] font-bold text-slate-400"><Layers3 size={13}/>经营视角</span>
      {lines.map(([id,label,caption])=><Button key={id} htmlType="button" title={caption} aria-pressed={value===id} onClick={()=>onChange(id)} className={`!h-auto min-h-9 !whitespace-normal border-b-2 px-1 py-3 text-[11px] font-semibold transition-colors ${value===id?"border-accent text-text-primary":"border-transparent text-slate-500 hover:text-slate-900"}`}>{label}</Button>)}
    </div>
    {value==="content_growth"&&<div className="flex flex-wrap items-center gap-4 border-t border-slate-100 py-2"><span className="text-[10px] font-bold text-slate-400">平台</span>{platforms.map(([id,label])=><Button key={id} htmlType="button" aria-pressed={platform===id} onClick={()=>onPlatformChange(id)} className={`!h-auto min-h-9 !whitespace-normal border-b px-0.5 py-1 text-[10px] font-semibold ${platform===id?"border-accent text-accent":"border-transparent text-slate-500 hover:text-slate-900"}`}>{label}</Button>)}</div>}
  </section>;
}

function TodayNextAction({
  data,
  onCreateGoal,
  onReviewPlan,
  onOpenExecution,
  onOpenReview,
}: {
  data: DigitalEmployeeOverview;
  onCreateGoal: () => void;
  onReviewPlan: () => void;
  onOpenExecution: (taskId?: string) => void;
  onOpenReview: () => void;
}) {
  const blockedTask = data.tasks.find(
    (task) => taskNeedsAttention(task),
  );
  const pendingApprovals = data.approvals.filter((item) => item.status === "pending");
  const pendingApproval = pendingApprovals[0];
  const approvalTask = data.tasks.find((task) => task.id === pendingApproval?.task_id);
  const activeTask = data.tasks.find((task) =>
    ["running", "waiting_external", "waiting_approval", "handed_off"].includes(task.status),
  );
  const terminal = Boolean(
    data.run && ["succeeded", "failed", "cancelled"].includes(data.run.status),
  );
  const execution = agentExecutionSummary(data);
  const next = !data.goal
    ? {

        title: "先定一个本周目标",
        detail: "只需要明确要达成的结果，系统会再帮你拆成可审核的计划。",
        label: "制定本周目标",
        action: onCreateGoal,

      }
    : data.goal.status === "draft"
      ? {

          title: data.plan ? "经营任务包已选定，等待执行" : "本周计划正在生成",
          detail: data.plan
            ? `已编排 ${(data.plan.businessPackage?.tasks.length ?? data.plan.tasks.length)} 项任务，进入任务包后点击「执行任务」即可确认启动。`
            : "系统正在整理可以审核的任务计划。",
          label: "查看任务包并执行",
          action: onReviewPlan,

        }
      : blockedTask
        ? {

            title: `${blockedTask.title} 需要处理`,
            detail: blockedTask.blocked_reason || "进入任务执行查看原因，并选择下一步。",
            label: "处理问题",
            action: () => onOpenExecution(blockedTask.id),

          }
        : pendingApproval && approvalTask
          ? {

              title: approvalTask.title,
              detail: pendingApproval.action_summary || "这项操作需要你确认后才能继续。",
              label: "去审核",
              action: () => onOpenExecution(approvalTask.id),

            }
          : terminal
            ? {

                title: "看看这轮经营带来了什么结果",
                detail: "复盘会区分真实结果、等待回流的数据和仍需补齐的信息。",
                label: "查看复盘",
                action: onOpenReview,

              }
            : {

                title: execution.label,
                detail: execution.detail,
                label: "查看任务执行",
                action: () => onOpenExecution(activeTask?.id),

              };
  return (
    <div className="mt-3 flex flex-col gap-4 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="min-w-0 sm:max-w-2xl">
        <h2 className="text-xl font-bold leading-snug tracking-tight text-slate-950 md:text-2xl">{next.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">{next.detail}</p>
      </div>
      <Button type="primary"
        htmlType="button"
        onClick={next.action}
        className="!h-auto min-h-9 !whitespace-normal inline-flex shrink-0 items-center justify-center gap-2 self-start whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 sm:self-auto"
      >
        {next.label} <ArrowRight size={14} />
      </Button>
    </div>
  );
}

function TodayFocusPanel({ data, onOpenExecution, onReviewPlan }: {
  data: DigitalEmployeeOverview;
  onOpenExecution: (taskId?: string) => void;
  onReviewPlan: () => void;
}) {
  const blockedTask = data.tasks.find(
    (task) => taskNeedsAttention(task),
  );
  const pendingApprovals = data.approvals.filter((item) => item.status === "pending");
  const completed = data.tasks.filter((task) => task.status === "succeeded").length;
  const progress = data.tasks.length
    ? Math.round((completed / data.tasks.length) * 100)
    : 0;
  const isDraft = data.goal?.status === "draft";
  const attentionItems = [
    isDraft && data.plan ? {
      title: "本周计划待确认",
      detail: `已编排 ${(data.plan.businessPackage?.tasks.length ?? data.plan.tasks.length)} 项任务，查看计划并确认后启动。`,
      action: onReviewPlan,
      tone: "bg-slate-50 text-slate-800",
    } : null,
    ...pendingApprovals.map((approval) => {
      const task = data.tasks.find((item) => item.id === approval.task_id);
      return task
        ? {
            title: task.title,
            detail: "等待你的审核",
            action: () => onOpenExecution(task.id),
            tone: "bg-amber-50 text-amber-800",
          }
        : null;
    }),
    blockedTask && !pendingApprovals.some((approval) => approval.task_id === blockedTask.id)
      ? {
          title: blockedTask.title,
          detail: blockedTask.blocked_reason || "需要选择下一步",
          action: () => onOpenExecution(blockedTask.id),
          tone: "bg-red-50 text-red-800",
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const visibleAttentionItems = attentionItems.slice(0, 3);

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-950">本周进度</h2>
            <p className="mt-1 text-xs text-slate-500">
              {data.goal
                ? `${data.goal.title} · ${data.goal.startsAt} 至 ${data.goal.endsAt}`
                : "还没有开始本周目标"}
            </p>
          </div>
          {data.run && (
            <Button
              htmlType="button"
              onClick={() => onOpenExecution()}
              className="!h-auto min-h-9 !whitespace-normal text-xs font-bold text-slate-600 hover:text-slate-950"
            >
              查看任务执行 →
            </Button>
          )}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-[11px] font-bold text-slate-500">计划状态</p>
            <p className="mt-2 text-lg font-semibold text-slate-950">
              {isDraft
                ? data.plan ? "待确认" : "计划生成中"
                : data.run
                  ? statusLabel[data.run.status] || data.run.status
                  : "尚未制定"}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-[11px] font-bold text-slate-500">{isDraft ? "计划任务" : "已完成任务"}</p>
            <p className="mt-2 text-lg font-semibold text-slate-950">
              {isDraft ? (data.plan ? `${(data.plan.businessPackage?.tasks.length ?? data.plan.tasks.length)} 项` : "生成中") : `${completed} / ${data.tasks.length}`}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-4">
            <p className="text-[11px] font-bold text-slate-500">{isDraft ? "执行状态" : "当前完成度"}</p>
            <p className="mt-2 text-lg font-semibold text-slate-950">{isDraft ? "尚未启动" : data.tasks.length ? `${progress}%` : "—"}</p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-950">需要你处理</h2>
            <p className="mt-1 text-xs text-slate-500">只显示会阻塞计划或需要你确认的事项。</p>
          </div>
          {attentionItems.length > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">{attentionItems.length} 项</span>}
        </div>
        {attentionItems.length ? (
          <div className="mt-4 space-y-2">
            {visibleAttentionItems.map((item) => (
              <Button
                key={item.title}
                htmlType="button"
                onClick={item.action}
                className={`!h-auto min-h-9 !whitespace-normal flex w-full items-center justify-between gap-4 rounded-lg px-4 py-3 text-left ${item.tone}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{item.title}</span>
                  <span className="mt-1 block truncate text-xs opacity-70">{item.detail}</span>
                </span>
                <ChevronRight size={17} className="shrink-0" />
              </Button>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-lg bg-emerald-50 px-4 py-5 text-sm font-semibold text-emerald-800">
            暂时没有需要你处理的事项。
          </div>
        )}
      </section>
    </div>
  );
}

const businessLoopStages: Array<{
  title: string;
  caption: string;
  page: BusinessDestination;
  steps: string[];
  tone: string;
}> = [
  {
    title: "自动触发",
    caption: "计划与业务事件",
    page: "scheduled",
    steps: ["社媒定时任务", "热点 / 客户事件"],
    tone: "border-sky-200 bg-sky-50 text-sky-800",
  },
  {
    title: "内容生产",
    caption: "双入口，一键托管",
    page: "socialInspiration",
    steps: ["选择素材加工 / 爆款裂变", "编导逐镜分析", "内容 Agent 自动供给画面"],
    tone: "border-blue-200 bg-blue-50 text-blue-800",
  },
  {
    title: "发布获客",
    caption: "回写账号与内容",
    page: "smartAssets",
    steps: ["人工审批", "内容发布", "互动回流"],
    tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  {
    title: "客户经营",
    caption: "复用客服工作台",
    page: "conversion",
    steps: ["客户分层", "批量跟进", "回复 / 转人工"],
    tone: "border-violet-200 bg-violet-50 text-violet-800",
  },
  {
    title: "数据复盘",
    caption: "驱动下一轮计划",
    page: "digitalEmployees",
    steps: ["内容表现", "客户转化", "生成下周任务"],
    tone: "border-amber-200 bg-amber-50 text-amber-800",
  },
];

type OpenBusinessLink = (
  page: BusinessDestination,
  view?: "create" | "publish",
  businessRef?: Record<string, unknown>,
) => void;

function BusinessLoopMap({ onOpen }: { onOpen: OpenBusinessLink }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-white">
            <Layers3 size={18} />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
              经营任务闭环
            </p>
            <h2 className="mt-1 font-semibold text-slate-950">
              数字员工任务流转图
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              任务发生在原有内容和客户工作台，结果回写后自动进入下一轮。
            </p>
          </div>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-bold text-emerald-700">
          触发 → 执行 → 回写 → 复盘
        </span>
      </div>
      <div className="mt-5 grid gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-stretch">
        {businessLoopStages.map((stage, index) => (
          <div key={stage.title} className="contents">
            <Button
              htmlType="button"
              onClick={() =>
                onOpen(
                  stage.page,
                  stage.page === "smartAssets" ? "publish" : undefined,
                  { source: "business_loop", stage: stage.title },
                )
              }
              className={`!h-auto min-h-9 !whitespace-normal rounded-lg border p-3.5 text-left transition ${stage.tone}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">
                    {index + 1}. {stage.title}
                  </p>
                  <p className="mt-0.5 text-[10px] opacity-70">
                    {stage.caption}
                  </p>
                </div>
                <ExternalLink size={13} className="mt-0.5 opacity-50" />
              </div>
              <div className="mt-3 space-y-1.5">
                {stage.steps.map((step) => (
                  <p
                    key={step}
                    className="rounded-lg bg-white/75 px-2.5 py-1.5 text-[10px] font-bold"
                  >
                    {step}
                  </p>
                ))}
              </div>
            </Button>
            {index < businessLoopStages.length - 1 && (
              <div className="hidden items-center justify-center text-slate-300 lg:flex">
                <ChevronRight size={18} />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-[10px] font-semibold text-slate-400">
        <RotateCcw size={12} />
        复盘建议生成下一周定时任务
      </div>
    </section>
  );
}

function DetailValue({ value }: { value: unknown }) {
  if (Array.isArray(value))
    return (
      <div className="mt-1 space-y-1">
        {value.slice(0, 5).map((item, index) => (
          <div
            key={index}
            className="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-600"
          >
            {item && typeof item === "object"
              ? Object.entries(item as Record<string, unknown>)
                  .filter(([, nested]) => nested !== undefined && nested !== "")
                  .map(
                    ([key, nested]) =>
                      `${technicalKeyLabel[key] || "业务信息"}：${humanizeValue(nested)}`,
                  )
                  .join(" · ")
              : humanizeValue(item)}
          </div>
        ))}
      </div>
    );
  if (value && typeof value === "object")
    return (
      <div className="mt-1 space-y-1">
        {Object.entries(value as Record<string, unknown>).map(([key, item]) => (
          <p key={key} className="text-[11px] leading-relaxed text-slate-600">
            <span className="text-slate-400">
              {technicalKeyLabel[key] || "业务信息"}：
            </span>
            {humanizeValue(item)}
          </p>
        ))}
      </div>
    );
  return (
    <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
      {humanizeValue(value)}
    </p>
  );
}

function CorrectionPanel({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (input: {
    instruction: string;
    scope: "one_off" | "rule_candidate";
    rerunDownstream: boolean;
  }) => Promise<boolean>;
}) {
  const [instruction, setInstruction] = useState("");
  const [scope, setScope] = useState<"one_off" | "rule_candidate">("one_off");
  const [rerunDownstream, setRerunDownstream] = useState(true);
  const [feedback, setFeedback] = useState("");
  const submit = async () => {
    if (!instruction.trim()) return;
    setFeedback("");
    const saved = await onSubmit({
      instruction: instruction.trim(),
      scope,
      rerunDownstream,
    });
    if (saved) {
      setInstruction("");
      setFeedback(
        scope === "rule_candidate"
          ? "长期规则候选已登记；审核通过前不会改变自动化规则。"
          : `本次纠偏已登记${rerunDownstream ? "，下游将按新版本重算。" : "。"}`,
      );
    } else {
      setFeedback("纠偏尚未登记，请根据上方错误提示调整后重试。");
    }
  };
  return (
    <div className="mt-5 rounded-lg border border-violet-200 bg-violet-50/60 p-4">
      <div className="flex items-center gap-2 text-violet-800">
        <RotateCcw size={15} />
        <p className="text-xs font-semibold">纠偏当前任务</p>
      </div>
      <textarea
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        className="mt-3 min-h-20 w-full resize-y rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-violet-400"
        placeholder="说明哪里不对，以及希望 Agent 如何调整。"
      />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          htmlType="button"
          onClick={() => setScope("one_off")}
          className={`!h-auto min-h-9 !whitespace-normal rounded-lg border px-3 py-2 text-left ${scope === "one_off" ? "border-violet-400 bg-white text-violet-800 ring-1 ring-violet-100" : "border-violet-100 text-slate-500"}`}
        >
          <span className="block text-xs font-bold">仅本次</span>
          <span className="mt-0.5 block text-[10px]">只修正当前运行</span>
        </Button>
        <Button
          htmlType="button"
          onClick={() => setScope("rule_candidate")}
          className={`!h-auto min-h-9 !whitespace-normal rounded-lg border px-3 py-2 text-left ${scope === "rule_candidate" ? "border-violet-400 bg-white text-violet-800 ring-1 ring-violet-100" : "border-violet-100 text-slate-500"}`}
        >
          <span className="block text-xs font-bold">长期规则候选</span>
          <span className="mt-0.5 block text-[10px]">
            先进入候选，不直接改规则
          </span>
        </Button>
      </div>
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-[11px] text-slate-600">
        <input
          type="checkbox"
          checked={rerunDownstream}
          onChange={(event) => setRerunDownstream(event.target.checked)}
          className="mt-0.5 accent-violet-600"
        />
        <span>
          <strong className="text-slate-800">重跑下游任务</strong>
          <br />
          从此节点之后重新计算，不重复已经确认的外部动作。
        </span>
      </label>
      <Button
        htmlType="button"
        disabled={busy || !instruction.trim()}
        onClick={() => void submit()}
        className="!h-auto min-h-9 !whitespace-normal mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-700 px-3 py-2.5 text-xs font-bold text-white hover:bg-violet-800 disabled:opacity-50"
      >
        {busy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <RotateCcw size={14} />
        )}{" "}
        提交纠偏
      </Button>
      {feedback && (
        <p
          role="status"
          className={`mt-2 rounded-lg px-3 py-2 text-[11px] font-semibold ${feedback.startsWith("纠偏尚未") ? "bg-red-50 text-red-700" : "bg-white text-violet-700"}`}
        >
          {feedback}
        </p>
      )}
    </div>
  );
}

function taskBusinessAction(link: DigitalEmployeeDeepLink): string {
  if (link.page === "enterprise") return "补齐企业资料";
  if (link.page === "accountManagement") return "核对社媒账号";
  if (link.page === "scheduled") return "查看定时任务";
  if (link.page === "socialInspiration") return "查看爆款证据";
  if (link.page === "scriptLibrary") return "打开跟进话术";
  if (link.page === "smartAssets" && link.view === "publish")
    return "核对发布清单";
  if (link.page === "smartAssets" && link.businessRef.taskKey === 'content_quality_gate')
    return "查看成片并处理";
  if (link.page === "smartAssets") return "继续内容制作";
  if (link.page === "conversion")
    return link.businessRef.taskKey === "customer_segmentation"
      ? "查看分层客群"
      : link.businessRef.taskKey.includes("followup")
        ? "查看逐客跟进批次"
        : "查看客户承接";
  return "查看关联工作";
}

function BlockedTaskActions({
  task,
  busy,
  onRetry,
  onSkip,
  onComplete,
}: {
  task: WorkflowTask;
  busy: boolean;
  onRetry: () => Promise<boolean>;
  onSkip: (note: string) => Promise<boolean>;
  onComplete: (note: string) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"skip" | "complete" | "">("");
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState("");
  const manualCompletionAllowed =
    !["publish", "send"].includes(task.external_effect || "none") &&
    !["platform_publish", "followup_dispatch"].includes(task.task_key);
  const retry = async () => {
    setFeedback("");
    setFeedback(
      (await onRetry())
        ? "已提交重试，生产现场会在收到新事件后更新。"
        : "重试没有提交成功，请查看页面上方提示。",
    );
  };
  const confirm = async () => {
    if (!mode || !note.trim()) return;
    setFeedback("");
    const saved =
      mode === "skip"
        ? await onSkip(note.trim())
        : await onComplete(note.trim());
    if (saved) {
      setFeedback(
        mode === "skip"
          ? "跳过决定已审计记录，下游会按新状态继续。"
          : "人工完成结果已审计记录，等待下游继续。",
      );
      setMode("");
      setNote("");
    } else setFeedback("操作没有生效，请查看页面上方提示。");
  };
  return (
    <div className="mt-4 rounded-lg border border-red-200 bg-red-50/70 p-4">
      <div className="flex items-center gap-2 text-red-800">
        <AlertTriangle size={15} />
        <p className="text-xs font-semibold">任务受阻，需要处理</p>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-red-700">
        {task.blocked_reason ||
          "真实业务状态未能推进，请选择恢复方式。所有操作都会写入审计记录。"}
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button
          htmlType="button"
          disabled={busy}
          onClick={() => void retry()}
          className="!h-auto min-h-9 !whitespace-normal rounded-lg bg-red-700 px-2 py-2.5 text-[11px] font-bold text-white disabled:opacity-50"
        >
          重试任务
        </Button>
        <Button
          htmlType="button"
          disabled={busy}
          onClick={() =>
            setMode((current) => (current === "skip" ? "" : "skip"))
          }
          className={`!h-auto min-h-9 !whitespace-normal rounded-lg border px-2 py-2.5 text-[11px] font-bold ${mode === "skip" ? "border-amber-400 bg-amber-50 text-amber-800" : "border-red-200 bg-white text-red-700"}`}
        >
          跳过并继续
        </Button>
        <Button
          htmlType="button"
          disabled={busy || !manualCompletionAllowed}
          onClick={() =>
            setMode((current) => (current === "complete" ? "" : "complete"))
          }
          title={
            manualCompletionAllowed
              ? "登记人工完成结果"
              : "真实发布或发送必须取得渠道回执，不能手工标记完成"
          }
          className={`!h-auto min-h-9 !whitespace-normal rounded-lg border px-2 py-2.5 text-[11px] font-bold ${mode === "complete" ? "border-violet-400 bg-violet-50 text-violet-800" : "border-red-200 bg-white text-red-700"}`}
        >
          登记人工完成
        </Button>
      </div>
      {!manualCompletionAllowed && (
        <p className="mt-2 text-[10px] font-semibold text-red-700">
          此节点涉及真实发布或发送，人工完成入口已锁定；请补充真实渠道回执或纠偏重试。
        </p>
      )}
      {mode && (
        <div className="mt-3 rounded-lg border border-red-100 bg-white p-3">
          <p className="text-[10px] font-bold text-slate-600">
            {mode === "skip"
              ? "说明为什么可以跳过（必填）"
              : "说明人工完成了什么、依据是什么（必填）"}
          </p>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="mt-2 min-h-16 w-full resize-y rounded-lg border border-slate-200 px-2.5 py-2 text-xs"
            placeholder="这段说明会进入任务审计记录"
          />
          <Button
            htmlType="button"
            disabled={busy || !note.trim()}
            onClick={() => void confirm()}
            className="!h-auto min-h-9 !whitespace-normal mt-2 w-full rounded-lg bg-slate-950 px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50"
          >
            确认{mode === "skip" ? "跳过" : "登记人工完成"}
          </Button>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
            涉及真实发布或发送的任务不能仅凭页面操作伪造完成，服务端会再次校验。
          </p>
        </div>
      )}
      {feedback && (
        <p
          role="status"
          className="mt-2 text-[11px] font-semibold text-slate-700"
        >
          {feedback}
        </p>
      )}
    </div>
  );
}

function ProductionScene({
  task,
  planTask,
  runId,
  events,
  correcting,
  controlling,
  readOnly = false,
  onOpenTask,
  onCorrect,
  onRetry,
  onSkip,
  onComplete,
  deepLink,
}: {
  task?: WorkflowTask;
  planTask?: PlanTask;
  runId: string;
  events: RunEvent[];
  correcting: boolean;
  controlling: boolean;
  readOnly?: boolean;
  onOpenTask: (link: DigitalEmployeeDeepLink) => void;
  onCorrect: (input: {
    instruction: string;
    scope: "one_off" | "rule_candidate";
    rerunDownstream: boolean;
  }) => Promise<boolean>;
  onRetry: () => Promise<boolean>;
  onSkip: (note: string) => Promise<boolean>;
  onComplete: (note: string) => Promise<boolean>;
  deepLink?: DigitalEmployeeDeepLink;
}) {
  const taskEvents = task
    ? events.filter((event) => event.task_id === task.id)
    : events;
  const link = deepLink || (task ? buildTaskDeepLink(task, planTask, runId) : null);
  const isQualityReview = task?.task_key === 'content_quality_gate' && taskNeedsAttention(task);
  const actionEventId = isQualityReview
    ? [...taskEvents].reverse().find(event => !agentUiActionFromEvent(event))?.id
    : undefined;
  const evidence: Array<[string, unknown]> = task
    ? (
        [
          [
            "业务能力",
            capabilityLabel[
              String(
                task.capability_key ||
                  planTask?.capabilityKey ||
                  task.output?.capability ||
                  "",
              )
            ] || "按本任务调用现有业务能力",
          ],
          [
            "真实状态来源",
            task.status_source ||
            planTask?.statusSource ||
            task.output?.statusSource
              ? "对应业务工作台的持久化记录与渠道回执"
              : "等待业务系统返回核验来源",
          ],
          [
            "执行模式",
            humanizeValue(task.execution_mode || planTask?.executionMode),
          ],
          [
            "外部影响",
            humanizeValue(task.external_effect || planTask?.externalEffect),
          ],
          [
            "任务 / 纠偏版本",
            `${task.task_version || 1} / ${task.correction_version || 0}`,
          ],
          [
            "前置任务",
            task.depends_on?.length
              ? `${task.depends_on.length} 个节点已经建立依赖`
              : "无",
          ],
        ] as Array<[string, unknown]>
      ).filter((item) => item[1] !== undefined && item[1] !== "")
    : [];
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-white">
            <Radio size={18} />
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full border-2 border-white bg-emerald-400" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-slate-950">Agent 实时生产现场</h2>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                LIVE
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              任务步骤、执行依据、中间产物与真实业务去向同步外显
            </p>
          </div>
        </div>
        {task && <Badge status={task.status} label={task.output.dataStatus === "no_data" ? "暂无数据" : task.output.dataStatus === "not_required" ? "本轮无需执行" : task.status === "waiting_external" && task.output.waitState ? taskWaitLabels[(task.output.waitState as TaskWaitState).kind] : undefined} />}
      </div>
      {!task ? (
        <div className="px-5 py-10 text-center text-sm text-slate-400">
          选择左侧任务，查看它的完整生产过程。
        </div>
      ) : (
        <div className="grid min-h-[390px] lg:grid-cols-[minmax(0,0.9fr)_minmax(300px,1.1fr)]">
          <div className="border-b border-slate-100 p-5 lg:border-b-0 lg:border-r">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
              当前工作台
            </p>
            <div className="mt-3 flex items-start gap-3">
              <TaskIcon status={task.status} />
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {task.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  {task.description}
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-400">执行角色</p>
                <p className="mt-1 font-bold text-slate-700">
                  {agentLabel[task.agent_role] || "业务 Agent"}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-slate-400">业务节点</p>
                <p className="mt-1 font-bold text-slate-700">
                  {task.kind === "production"
                    ? "内容制作"
                    : task.kind === "activation"
                      ? "内容发布"
                      : task.kind === "approval"
                        ? "人工审批"
                        : "经营任务"}
                </p>
              </div>
            </div>
            {!isQualityReview && <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50/60 p-4">
              <div className="flex items-center gap-2 text-blue-800">
                <BrainCircuit size={15} />
                <p className="text-xs font-semibold">执行依据</p>
              </div>
              {evidence.length ? (
                <dl className="mt-3 space-y-2">
                  {evidence.map(([label, value]) => (
                    <div
                      key={label}
                      className="grid grid-cols-[88px_1fr] gap-2 text-[11px]"
                    >
                      <dt className="text-slate-400">{label}</dt>
                      <dd className="font-semibold text-slate-700">
                        {humanizeValue(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-2 text-[11px] text-slate-500">
                  该任务尚未返回能力映射或事实来源，不能据此宣称业务动作已完成。
                </p>
              )}
            </div>}
            {!isQualityReview && <div className="mt-5">
              <p className="text-xs font-bold text-slate-700">中间产物</p>
              {Object.keys(task.output || {}).length ? (
                <div className="mt-2 space-y-2">
                  {Object.entries(task.output)
                    .slice(0, 6)
                    .map(([key, value], index) => (
                      <div
                        key={key}
                        className="rounded-lg border border-slate-100 p-3"
                      >
                        <p className="text-[10px] font-semibold text-slate-400">
                          {technicalKeyLabel[key] || `业务产出 ${index + 1}`}
                        </p>
                        <DetailValue value={value} />
                      </div>
                    ))}
                </div>
              ) : (
                <div className="mt-2 rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-[11px] text-slate-400">
                  Agent 产出会在执行过程中持续写入
                </div>
              )}
            </div>}
            {isQualityReview && <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-semibold text-amber-900">需要你观看成片并做判断</p>
              <p className="mt-2 text-xs leading-5 text-amber-800">{task.blocked_reason || '请确认当前成片是否可以进入发布；如果不通过，可直接修改配乐、配音、分镜素材、字幕、封面或导出规格。'}</p>
            </div>}
            {link && (
              <div className="mt-4">
                <Button
                  htmlType="button"
                  onClick={() => onOpenTask(link)}
                  className="!h-auto min-h-9 !whitespace-normal inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-950 px-3 py-3 text-xs font-bold text-white hover:bg-slate-800"
                >
                  {taskBusinessAction(link)} <ExternalLink size={12} />
                </Button>
                <p className="mt-1.5 text-center text-[10px] text-slate-400">
                  已保留本次运行与任务位置；完成业务操作后返回“数字员工”即可继续。
                </p>
              </div>
            )}
            {!readOnly &&
              taskNeedsAttention(task) && !isQualityReview && (
                <BlockedTaskActions
                  key={task.id}
                  task={task}
                  busy={controlling}
                  onRetry={onRetry}
                  onSkip={onSkip}
                  onComplete={onComplete}
                />
              )}
            {!isQualityReview && (!readOnly ? (
              <CorrectionPanel
                key={task.id}
                busy={correcting}
                onSubmit={onCorrect}
              />
            ) : (
              <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                正在查看历史运行；可查看业务证据，但不会对历史任务执行纠偏或恢复操作。
              </p>
            ))}
          </div>
          <div className="max-h-[620px] overflow-y-auto p-5">
            {!isQualityReview && <AgentOperationFeed task={task} events={taskEvents} />}
            <div className="mb-4 flex items-center justify-between">
              <p className="mt-5 text-xs font-bold text-slate-700">现场事件</p>
              <span className="text-[10px] text-slate-400">
                {taskEvents.length} 条已持久化
              </span>
            </div>
            <EventTimeline
              events={taskEvents}
              activeTaskId={task.id}
              actionEventId={actionEventId}
              actionLabel={isQualityReview ? '查看成片并处理' : undefined}
              onAction={isQualityReview && link ? () => onOpenTask(link) : undefined}
            />
          </div>
        </div>
      )}
    </section>
  );
}

const availabilityLabel: Record<DataAvailability, string> = {
  available: "已取得",
  pending: "等待回流",
  unavailable: "暂不可用",
};
const availabilityTone: Record<DataAvailability, string> = {
  available: "border-emerald-200 bg-emerald-50 text-emerald-700",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  unavailable: "border-slate-200 bg-slate-100 text-slate-500",
};

function AvailabilityBadge({ status }: { status: DataAvailability }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${availabilityTone[status]}`}
    >
      {availabilityLabel[status]}
    </span>
  );
}

function BusinessMetricCard({
  label,
  metric,
}: {
  label: string;
  metric?: BusinessMetric;
}) {
  const status = metric?.status || "unavailable";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-slate-500">{label}</p>
        <AvailabilityBadge status={status} />
      </div>
      <p
        className={`mt-2 text-2xl font-semibold ${status === "available" ? "text-slate-950" : "text-slate-400"}`}
      >
        {status === "available" &&
        metric?.value !== null &&
        metric?.value !== undefined
          ? metric.value.toLocaleString()
          : status === "pending"
            ? "待回流"
            : "—"}
      </p>
      <p
        className="mt-1 truncate text-[10px] text-slate-400"
        title={metric?.source}
      >
        {metric?.note ||
          (metric?.source ? `来源：${metric.source}` : "尚未接入真实数据源")}
      </p>
    </div>
  );
}

function LegacyTodaySnapshotPanel({
  data,
  onOpen,
}: {
  data: DigitalEmployeeOverview;
  onOpen: OpenBusinessLink;
}) {
  const snapshot = data.businessSnapshot;
  const running =
    snapshot?.running ||
    data.tasks
      .filter((task) => ["running", "planning"].includes(task.status))
      .map((task) => ({
        id: task.id,
        taskId: task.id,
        runId: task.run_id,
        title: task.title,
        status: task.status,
      }));
  const needsDecision = snapshot?.needsDecision || [
    ...data.approvals
      .filter((item) => item.status === "pending")
      .map((item) => ({
        id: item.id,
        taskId: item.task_id,
        runId: item.run_id,
        title: item.action_summary || "待审批动作",
        status: "waiting_approval",
      })),
    ...data.handoffs
      .filter((item) => item.status === "active")
      .map((item) => ({
        id: item.id,
        taskId: item.task_id,
        runId: item.run_id,
        title: "人工接管中的任务",
        status: "handed_off",
      })),
  ];
  const today = new Date().toLocaleDateString("en-CA");
  const completedToday =
    snapshot?.completedToday ||
    data.tasks
      .filter(
        (task) =>
          task.status === "succeeded" &&
          task.updated_at &&
          new Date(task.updated_at).toLocaleDateString("en-CA") === today,
      )
      .map((task) => ({
        id: task.id,
        taskId: task.id,
        runId: task.run_id,
        title: task.title,
        status: task.status,
        occurredAt: task.updated_at,
      }));
  const cards = [
    {
      label: "运行中",
      value: data.run ? running.length : null,
      status: data.run ? "available" : "pending",
      icon: <Activity size={17} className="text-blue-600" />,
    },
    {
      label: "需要我决定",
      value: data.config ? needsDecision.length : null,
      status: data.config ? "available" : "pending",
      icon: <ShieldCheck size={17} className="text-amber-600" />,
    },
    {
      label: "今日完成",
      value: data.run ? completedToday.length : null,
      status: data.run ? "available" : "pending",
      icon: <CheckCircle2 size={17} className="text-emerald-600" />,
    },
    {
      label: "未来 24 小时",
      value: snapshot ? snapshot.next24Hours.length : null,
      status: snapshot ? "available" : "pending",
      icon: <Clock3 size={17} className="text-violet-600" />,
    },
  ] as const;
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity size={19} className="text-emerald-600" />
            <h2 className="font-semibold text-slate-950">今日经营快照</h2>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            只展示持久化工作流和真实业务快照；没有数据时明确等待，不补零。
          </p>
        </div>
        <span className="text-[10px] text-slate-400">
          {snapshot?.generatedAt
            ? `更新于 ${new Date(snapshot.generatedAt).toLocaleString("zh-CN")}`
            : "业务快照等待接入"}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-slate-100 bg-slate-50/70 p-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">
                {card.label}
              </span>
              {card.icon}
            </div>
            <p className="mt-2 text-2xl font-semibold text-slate-950">
              {card.value === null ? "待接入" : card.value}
            </p>
            <p className="mt-1 text-[10px] text-slate-400">
              {card.status === "available" ? "来自本次快照" : "等待真实记录"}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-100 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-700">接下来 24 小时</p>
            <span className="text-[10px] text-slate-400">
              {snapshot ? `${snapshot.next24Hours.length} 项` : "待接入"}
            </span>
          </div>
          {snapshot?.next24Hours.length ? (
            <div className="mt-3 space-y-2">
              {snapshot.next24Hours.slice(0, 5).map((item) => (
                <Button
                  htmlType="button"
                  key={`${item.kind}-${item.id}`}
                  onClick={() =>
                    onOpen(
                      item.page,
                      item.page === "smartAssets" ? "publish" : undefined,
                      {
                        ...(item.businessRef || {}),
                        entityId: item.id,
                        kind: item.kind,
                      },
                    )
                  }
                  className="!h-auto min-h-9 !whitespace-normal flex w-full items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5 text-left hover:bg-slate-100"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-slate-800">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-slate-400">
                      {item.scheduleLabel}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] font-semibold text-slate-500">
                    {new Date(item.scheduledAt).toLocaleString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </Button>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
              {snapshot ? "未来 24 小时没有已登记动作" : "排期快照尚未返回"}
            </p>
          )}
        </div>
        <div className="rounded-lg border border-slate-100 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-700">数据缺口</p>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${snapshot?.dataGaps.length ? "bg-amber-50 text-amber-700" : snapshot ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
            >
              {snapshot ? `${snapshot.dataGaps.length} 项` : "待接入"}
            </span>
          </div>
          {snapshot ? (
            snapshot.dataGaps.length ? (
              <ul className="mt-3 space-y-2">
                {snapshot.dataGaps.map((gap) => (
                  <li
                    key={gap}
                    className="flex gap-2 rounded-lg bg-amber-50/60 px-3 py-2.5 text-[11px] text-amber-900"
                  >
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    {gap}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-5 text-center text-xs text-emerald-700">
                本次快照没有发现数据缺口
              </p>
            )
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
              快照缺失，不能判定为零缺口
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

type OverviewPeriod = "week" | "lastWeek" | "month" | "lastMonth";

function overviewRange(period: OverviewPeriod) {
  const now = new Date();
  const end = new Date(now);
  const start = new Date(now);
  const weekday = (now.getDay() + 6) % 7;
  if (period === "week" || period === "lastWeek") {
    start.setDate(now.getDate() - weekday - (period === "lastWeek" ? 7 : 0));
    end.setDate(start.getDate() + 6);
    if (period === "week") end.setTime(now.getTime());
  } else {
    const offset = period === "lastMonth" ? -1 : 0;
    start.setFullYear(now.getFullYear(), now.getMonth() + offset, 1);
    end.setFullYear(now.getFullYear(), now.getMonth() + offset + 1, 0);
    if (period === "month") end.setTime(now.getTime());
  }
  const date = (value: Date) => value.toLocaleDateString("en-CA");
  return { startsAt: date(start), endsAt: date(end) };
}

function metricText(metric?: BusinessMetric, suffix = "") {
  if (!metric || metric.status !== "available" || metric.value === null) return "待接入";
  return `${metric.value.toLocaleString("zh-CN")}${suffix}`;
}

function DataMetricCard({ label, metric, icon, note }: { label: string; metric?: BusinessMetric; icon?: ReactNode; note?: string }) {
  const available = metric?.status === "available" && metric.value !== null;
  return <div className="digital-metric p-3.5" title={note || metric?.note || metric?.source}>
    <div className="flex items-center justify-between gap-2"><p className="text-[11px] font-bold text-slate-500">{label}</p><span className="text-slate-400">{icon}</span></div>
    <p className={`mt-2 text-xl font-semibold ${available ? "text-slate-950" : "text-slate-400"}`}>{available ? metricText(metric) : "—"}</p>
    {!available && <p className="mt-1 truncate text-[11px] text-slate-400">{metric?.note || "等待数据源回流"}</p>}
  </div>;
}

function ConversionFunnelChart({ stages, onConnect }: { stages: Array<[string, BusinessMetric | undefined]>; onConnect: () => void }) {
  const measured = (metric?: BusinessMetric) => metric?.status === "available" && metric.value !== null && Number.isFinite(metric.value);
  const availableCount = stages.filter(([, metric]) => measured(metric)).length;
  const maxValue = Math.max(1, ...stages.map(([, metric]) => measured(metric) ? Math.max(0, Number(metric!.value)) : 0));
  return (
    <div className="mt-5">
      {availableCount < stages.length && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-slate-50 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-emerald-700"><BarChart3 size={18}/></span>
            <div><p className="text-sm font-semibold text-slate-800">{availableCount === 0 ? "连接数据，开始追踪获客表现" : `${availableCount} / ${stages.length} 个阶段已有数据`}</p><p className="mt-1 text-xs leading-5 text-slate-500">连接社媒账号，并在客户管理中完善询盘、报价与成交记录。</p></div>
          </div>
          <Button htmlType="button" onClick={onConnect} className="!h-auto min-h-9 !whitespace-normal inline-flex shrink-0 items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">连接社媒账号<ArrowRight size={14}/></Button>
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_80px_80px] gap-3 border-b border-slate-100 pb-3 text-xs text-slate-500 sm:grid-cols-[150px_minmax(0,1fr)_100px_100px]">
        <span>转化阶段</span><span className="hidden sm:block">阶段数量分布</span><span className="text-right">数量</span><span className="text-right">较上一阶段</span>
      </div>
      <ol className="divide-y divide-slate-100">
        {stages.map(([label, metric], index) => {
          const available = measured(metric);
          const value = available ? Math.max(0, Number(metric!.value)) : 0;
          const previous = stages[index - 1]?.[1];
          const previousValue = measured(previous) ? Number(previous!.value) : 0;
          const rate = available && previousValue > 0 ? `${((value / previousValue) * 100).toFixed(1)}%` : "—";
          return <li key={label} className="grid grid-cols-[minmax(0,1fr)_80px_80px] items-center gap-3 py-3 sm:grid-cols-[150px_minmax(0,1fr)_100px_100px]">
            <div className="flex min-w-0 items-center gap-2.5"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-medium tabular-nums text-slate-500">{String(index + 1).padStart(2, "0")}</span><span className="text-xs font-medium text-slate-700 sm:text-sm">{label}</span></div>
            <div className="hidden sm:block" aria-hidden="true">{available ? <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${value / maxValue * 100}%` }}/></div> : <div className="border-t border-dashed border-slate-200"/>}</div>
            <span className={`text-right text-sm font-semibold tabular-nums ${available ? "text-slate-900" : "text-slate-400"}`} title={metric?.note}>{available ? value.toLocaleString("zh-CN") : "—"}</span>
            <span className="text-right text-xs tabular-nums text-slate-500">{rate}</span>
          </li>;
        })}
      </ol>
      <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-400">{availableCount === 0 ? "尚无可用数据，接入后显示真实数量与阶段比例。" : "条形按实际数量等比例展示；阶段比例为相邻数量之比，不代表同一批客户的归因转化率。"} “—” 表示数据缺失或比例暂不可计算。</p>
    </div>
  );
}

const readinessDestination: Record<
  BusinessReadinessItem["key"],
  { page: BusinessDestination; view?: "create" | "publish" }
> = {
  enterprise: { page: "enterprise" },
  products: { page: "enterprise" },
  social_accounts: { page: "accountManagement" },
  viral_library: { page: "socialInspiration" },
  content_projects: { page: "smartAssets", view: "create" },
  customers: { page: "conversion" },
  automation: { page: "scheduled" },
};

function requiredReadinessKeys(
  config: DigitalEmployeeConfig,
): BusinessReadinessItem["key"][] {
  const required = new Set<BusinessReadinessItem["key"]>(["enterprise"]);
  if (config.enabledWorkflows.includes("content_publish"))
    required.add("social_accounts");
  if (
    config.enabledWorkflows.includes("content_publish") &&
    !config.enabledWorkflows.some((item) =>
      contentCreationWorkflows.includes(item),
    )
  )
    required.add("content_projects");
  // Product, material, inspiration and customer data may legitimately be
  // empty for a new tenant. Their individual workflow branches pause with a
  // concrete knowledge gap instead of blocking the entire weekly goal.
  return [...required];
}

function ResourcePreflightPanel({
  config,
  readiness,
  onOpen,
}: {
  config: DigitalEmployeeConfig;
  readiness: BusinessReadinessItem[];
  onOpen: (item: BusinessReadinessItem) => void;
}) {
  const required = requiredReadinessKeys(config);
  const known = new Map(readiness.map((item) => [item.key, item]));
  const blockers = required
    .map((key) => known.get(key))
    .filter((item): item is BusinessReadinessItem =>
      Boolean(item && item.status !== "ready"),
    );
  const snapshotMissing =
    readiness.length === 0 || required.some((key) => !known.has(key));
  const ready = !snapshotMissing && blockers.length === 0;
  return (
    <section
      className={`rounded-lg border p-5 ${ready ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/70"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {ready ? (
            <CheckCircle2 size={20} className="mt-0.5 text-emerald-700" />
          ) : (
            <AlertTriangle size={20} className="mt-0.5 text-amber-700" />
          )}
          <div>
            <h2 className="text-sm font-semibold text-slate-950">
              启动前业务资产预检
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              {ready
                ? "本计划依赖的企业、产品、账号和客户资产均已取得真实记录。"
                : snapshotMissing
                  ? "资产快照尚未完整返回；在确认前请先刷新或补齐业务资料。"
                  : `还有 ${blockers.length} 项必需资产未就绪，暂不能批准运行。`}
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-[10px] font-bold ${ready ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
        >
          {ready ? "可以启动" : "启动受阻"}
        </span>
      </div>
      {blockers.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {blockers.map((item) => (
            <Button
              key={item.key}
              htmlType="button"
              onClick={() => onOpen(item)}
              className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-bold text-amber-800"
            >
              补齐{item.label} <ExternalLink size={11} />
            </Button>
          ))}
        </div>
      )}
    </section>
  );
}

function NextActionBanner({
  data,
  activeTask,
  onGoal,
  onPlan,
  onLive,
  onReview,
}: {
  data: DigitalEmployeeOverview;
  activeTask?: WorkflowTask;
  onGoal: () => void;
  onPlan: () => void;
  onLive: () => void;
  onReview: () => void;
}) {
  const blocked = data.tasks.find(
    (task) => taskNeedsAttention(task),
  );
  const pendingApproval = data.approvals.some(
    (item) => item.status === "pending",
  );
  const terminalRun = Boolean(
    data.run && ["succeeded", "failed", "cancelled"].includes(data.run.status),
  );
  const state = !data.goal
    ? {
        eyebrow: "下一步",
        title: "先确认本周经营目标",
        detail: "只需确定结果、指标和边界，数字员工会拆解执行节点。",
        label: "制定本周目标",
        action: onGoal,
        tone: "bg-text-primary",
      }
    : data.goal.status === "draft"
      ? {
          eyebrow: "需要确认",
          title: data.plan ? "核对计划和业务资产后启动" : "计划草案正在生成",
          detail: data.plan
            ? `计划包含 ${(data.plan.businessPackage?.tasks.length ?? data.plan.tasks.length)} 个真实业务节点，批准前不会运行。`
            : "等待服务端返回可预览的任务计划。",
          label: "查看批准项",
          action: onPlan,
          tone: "bg-text-primary",
        }
      : blocked
        ? {
            eyebrow: "需要处理",
            title: `${blocked.title} 已受阻`,
            detail:
              blocked.blocked_reason || "选择重试、跳过、人工完成或纠偏。",
            label: "处理阻塞任务",
            action: onLive,
            tone: "bg-red",
          }
        : pendingApproval
          ? {
              eyebrow: "需要决定",
              title: "生产现场有一项操作等待审批",
              detail: "先核对执行依据和真实外部影响，再批准或驳回。",
              label: "前往审批",
              action: onLive,
              tone: "bg-amber",
            }
          : terminalRun
            ? {
                eyebrow: "本轮已收束",
                title: "查看业务结果与本周复盘",
                detail: "结果按已取得、等待回流、暂不可用分别呈现。",
                label: "查看本周复盘",
                action: onReview,
                tone: "bg-green",
              }
            : {
                eyebrow: "正在执行",
                title: activeTask
                  ? `当前：${activeTask.title}`
                  : "数字员工正在推进本周计划",
                detail: "进入生产现场观看真实事件、业务回写并随时纠偏。",
                label: "观看生产现场",
                action: onLive,
                tone: "bg-text-primary",
              };
  return (
    <section
      className={`rounded-lg border border-white/10 ${state.tone} p-5 text-white`}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/65">
            {state.eyebrow}
          </p>
          <h2 className="mt-1 text-lg font-semibold">{state.title}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-white/75">
            {state.detail}
          </p>
        </div>
        <Button
          htmlType="button"
          disabled={data.goal?.status === "draft" && !data.plan}
          onClick={state.action}
          className="!h-auto min-h-9 !whitespace-normal inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-xs font-semibold text-slate-900 disabled:opacity-50"
        >
          {state.label} <ArrowRight size={14} />
        </Button>
      </div>
    </section>
  );
}

function DraftPlanPreview({
  plan,
  onOpen,
}: {
  plan: DigitalEmployeeOverview["plan"];
  onOpen: OpenBusinessLink;
}) {
  if (!plan) return null;
  return (
    <section className="rounded-lg border border-blue-200 bg-white p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
          <Layers3 size={18} />
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">
            批准前预览
          </p>
          <h2 className="mt-1 font-semibold text-slate-950">
            本周任务计划
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            查看任务安排、执行去向和审批要求，确认后启动。
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {plan.tasks.map((task) => (
          <Button
            key={task.key}
            htmlType="button"
            onClick={() =>
              task.destination &&
              onOpen(task.destination, task.destinationView, {
                taskKey: task.key,
                capabilityKey: task.capabilityKey,
                statusSource: task.statusSource,
                preview: true,
              })
            }
            className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 p-3 text-left hover:border-blue-300"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-slate-800">
                  {task.sequence}. {task.title}
                </p>
                <p className="mt-1 text-[10px] text-slate-500">
                  {capabilityLabel[task.capabilityKey || ""] ||
                    "业务能力待核对"}{" "}
                  ·{" "}
                  {task.destination
                    ? destinationLabel[task.destination]
                    : "数字员工驾驶舱"}
                </p>
              </div>
              {task.requiresApproval && (
                <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                  需审批
                </span>
              )}
            </div>
            <p className="mt-2 text-[10px] text-slate-400">
              结果核验：
              {task.statusSource
                ? statusSourceLabel[task.statusSource] || "对应业务工作台的持久化记录"
                : "等待业务系统接入"}
            </p>
          </Button>
        ))}
      </div>
    </section>
  );
}

function BatchFollowupTruthPanel({
  data,
  onOpen,
  onDispatch,
  busy,
}: {
  data: DigitalEmployeeOverview;
  onOpen: OpenBusinessLink;
  onDispatch?: (batchId: string) => void;
  busy?: boolean;
}) {
  const byKey = (key: string) =>
    data.tasks.find((task) => task.task_key === key);
  const draft = byKey("followup_batch_draft");
  const approval = byKey("followup_batch_approval");
  const dispatch = byKey("followup_dispatch");
  const workerStatus = String(
    dispatch?.output?.bulkWorkerStatus || "manual_or_scheduled",
  );
  const workerScheduled = workerStatus === "scheduled";
  const messagingAuthorization =
    dispatch?.output?.messagingAuthorization &&
    typeof dispatch.output.messagingAuthorization === "object"
      ? (dispatch.output.messagingAuthorization as Record<string, unknown>)
      : {};
  const manualSendAllowed =
    messagingAuthorization.manualFollowupSendAllowed === true;
  const dispatchBlockedReason = String(dispatch?.blocked_reason || "").trim();
  const refs = [
    ...(draft?.business_refs || []),
    ...(Array.isArray(draft?.output?.businessRefs)
      ? (draft.output.businessRefs as Array<Record<string, unknown>>)
      : []),
  ];
  const batchId = String(
    refs.find((ref) => ref.type === "followup_batch")?.id || "",
  );
  const steps: Array<{
    title: string;
    detail: string;
    status: DataAvailability;
  }> = [
    {
      title: "1. 逐客生成草稿",
      detail: draft
        ? statusLabel[draft.status] || "状态待确认"
        : "等待创建真实客群与逐客草稿",
      status: draft?.status === "succeeded" ? "available" : "pending",
    },
    {
      title: "2. 整批人工批准",
      detail: approval
        ? statusLabel[approval.status] || "状态待确认"
        : "草稿完成后才能进入整批批准",
      status: approval?.status === "succeeded" ? "available" : "pending",
    },
    {
      title: dispatch?.output?.messagesSent
        ? "3. 真实发送回执"
        : "3. 真实发送预检",
      detail: dispatch?.output?.messagesSent
        ? `已有 ${String(dispatch.output.messagesSent)} 位客户取得真实发送回执`
        : dispatchBlockedReason
          ? dispatchBlockedReason
          : workerScheduled
          ? "发送执行服务（Worker）已启用定时扫描，将按逐客时区发送并回写渠道回执"
          : "发送执行服务当前为手动触发模式，发送前仍会执行授权与安全复核",
      status: dispatch?.status === "succeeded" ? "available" : "pending",
    },
  ];
  return (
    <section className="insight-note rounded-lg border border-insight/20 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-text-primary">
            <MessageSquare size={18} />
            <h2 className="font-semibold">批量跟进执行边界</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            批准的是逐客草稿批次，不等于消息已经发出。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            htmlType="button"
            onClick={() =>
              onOpen("conversion", undefined, {
                capabilityKey: "customer.followup_drafts",
                stage: "batch_followup",
              })
            }
            className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-accent-dim"
          >
            进入客户工作台 <ExternalLink size={12} />
          </Button>
          {onDispatch &&
            batchId &&
            approval?.status === "succeeded" &&
            dispatch?.status !== "succeeded" && (
              <Button
                htmlType="button"
                disabled={!manualSendAllowed || busy}
                onClick={() => onDispatch(batchId)}
                title={
                  manualSendAllowed
                    ? "发送当前已到期且通过预检的客户"
                    : dispatchBlockedReason || "租户真实发送授权或 Messenger 渠道尚未就绪"
                }
                className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-1.5 rounded-lg bg-violet-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Send size={12} />
                )}
                {manualSendAllowed ? "发送已到期客户" : "真实发送未就绪"}
              </Button>
            )}
        </div>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {steps.map((step) => (
          <div
            key={step.title}
            className="rounded-lg border border-white bg-white/80 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-800">{step.title}</p>
              <AvailabilityBadge status={step.status} />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              {step.detail}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function AgentOperationFeed({ task, events }: { task?: WorkflowTask; events: RunEvent[] }) {
  const actions = events.map(agentUiActionFromEvent).filter((item): item is AgentUiAction => Boolean(item));
  const latestScreenshot = [...actions].reverse().find((item) => item.kind === "screenshot" && item.screenshotUrl);
  const cursorAction = [...actions].reverse().find((item) => agentCursorPercent(item));
  const cursor = agentCursorPercent(cursorAction);
  const viewportAction = [...actions].reverse().find((item) => item.viewportWidth && item.viewportHeight);
  const viewportRatio = viewportAction?.viewportWidth && viewportAction.viewportHeight ? Math.max(0.75, Math.min(2.4, viewportAction.viewportWidth / viewportAction.viewportHeight)) : 16 / 9;
  return <section className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950 text-white"><div className="flex items-center justify-between border-b border-slate-800 px-4 py-3"><div className="flex items-center gap-2"><MonitorPlay size={15} className="text-emerald-400"/><p className="text-xs font-semibold">Agent 操作现场</p></div><span className="rounded-full bg-slate-800 px-2 py-1 text-[9px] font-bold text-slate-300">真实事件流</span></div>{latestScreenshot ? <div className="relative bg-black" style={{aspectRatio:viewportRatio}}><img src={latestScreenshot.screenshotUrl} alt="Agent Worker 上报的操作截图" className="absolute inset-0 h-full w-full object-contain"/>{cursor && <div className="pointer-events-none absolute z-10 transition-all duration-300" style={{left:`${cursor.left}%`,top:`${cursor.top}%`}}><MousePointer2 size={22} className="fill-white text-slate-950 drop-shadow"/>{cursorAction?.kind === "click" && <i className="absolute -left-2 -top-2 h-8 w-8 animate-ping rounded-full border-2 border-emerald-400"/>}</div>}<div className="absolute bottom-3 left-3 rounded-lg bg-black/70 px-2 py-1 text-[9px]">{latestScreenshot.label}</div></div> : actions.length ? <div className="relative p-4">{cursor && <div className="pointer-events-none absolute z-10 transition-all duration-300" style={{left:`${cursor.left}%`,top:`${cursor.top}%`}}><MousePointer2 size={20} className="fill-white text-slate-950 drop-shadow"/></div>}<div className="space-y-2">{actions.slice(-6).map((action,index)=><div key={`${action.kind}-${index}`} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2"><MousePointer2 size={13} className="text-emerald-400"/><div><p className="text-[10px] font-bold text-slate-200">{action.label}</p><p className="text-[9px] text-slate-500">{action.kind}{action.page ? ` · ${action.page}` : ""}</p></div></div>)}</div></div> : <div className="px-5 py-10 text-center"><MonitorPlay size={24} className="mx-auto text-slate-600"/><p className="mt-3 text-xs font-semibold text-slate-300">现场画面流尚未接入</p><p className="mx-auto mt-2 max-w-md text-[10px] leading-5 text-slate-500">当前只展示真实任务状态、产物和事件。Agent Worker 上报带坐标的 navigation、click、input、screenshot 后，这里才会移动真实鼠标，不生成假鼠标动画。</p>{task && <p className="mt-3 text-[9px] text-slate-600">当前任务：{task.title}</p>}</div>}</section>;
}

const ONBOARDING_CONFETTI_COLORS = ['#117f51', '#65c99c', '#f4b860', '#e76f51', '#6c8ae4', '#f2d45c'];

function OnboardingWelcome({ onClose }: { onClose: () => void }) {
  return <Modal open title="准备工作已经完成" onCancel={onClose} width={480} footer={<Button type="primary" onClick={onClose}>开始使用灵枢</Button>}>
    <p className="py-4 text-sm leading-7 text-text-secondary">企业资料、产品表和社媒经营阶段都已保存。接下来可制定周计划，查看四位数字员工的执行进度与交付结果。</p>
  </Modal>;
}

export default function DigitalEmployeePage({
  onNavigate,
  onOpenMonitor,
  onViewResults,
}: {
  onNavigate?: (page: BusinessDestination) => void;
  onOpenMonitor?: () => void;
  onViewResults?: () => void;
}) {
  const [data, setData] = useState<DigitalEmployeeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [newGoal, setNewGoal] = useState(false);
  const [approvalNote, setApprovalNote] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedContentItemId, setSelectedContentItemId] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [deliveryFocus, setDeliveryFocus] = useState<{ id: string; request: number }>();
  const [viewGoalId, setViewGoalId] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("today");
  const [businessLine, setBusinessLine] = useState<BusinessLine>("full_funnel");
  const [contentPlatform, setContentPlatform] = useState<ContentPlatform>("all");
  const [navigationNotice, setNavigationNotice] = useState("");
  const [applicationGuideOpen, setApplicationGuideOpen] = useState(false);
  const [onboardingWelcomeOpen, setOnboardingWelcomeOpen] = useState(false);
  const [weeklyPlanOpen, setWeeklyPlanOpen] = useState(false);
  const [planHistoryOpen, setPlanHistoryOpen] = useState(false);
  const [planningOptions, setPlanningOptions] = useState<Awaited<ReturnType<typeof digitalEmployeeApi.planningOptions>> | null>(null);
  const goalPanelRef = useRef<HTMLDivElement>(null);
  const overviewRequestVersionRef = useRef(0);
  const [productionPeriod, setProductionPeriod] = useState<OverviewPeriod>("week");
  const productionRangeLoadingRef = useRef(false);
  const productionRangeRef = useRef<ReturnType<typeof overviewRange> | undefined>(undefined);
  const presentedData = data;
  const initialLoadRef = useRef<Promise<DigitalEmployeeOverview | undefined> | null>(null);

  useEffect(() => {
    const openGuide = () => setApplicationGuideOpen(true);
    window.addEventListener('lingshu:open-digital-employee-guide', openGuide);
    try {
      if (sessionStorage.getItem('lingshu:open-digital-employee-guide') === 'true') {
        sessionStorage.removeItem('lingshu:open-digital-employee-guide');
        openGuide();
      }
    } catch { /* storage can be unavailable */ }
    return () => window.removeEventListener('lingshu:open-digital-employee-guide', openGuide);
  }, []);

  useEffect(() => {
    if (!weeklyPlanOpen || !data?.goal) return;
    let active = true;
    void digitalEmployeeApi.planningOptions()
      .then(options => { if (active) setPlanningOptions(options); })
      .catch(() => { if (active) setPlanningOptions(null); });
    return () => { active = false; };
  }, [weeklyPlanOpen, data?.goal?.id]);

  const load = async (goalId = viewGoalId) => {
    const requestVersion = ++overviewRequestVersionRef.current;
    try {
      const next = await digitalEmployeeApi.overview(goalId, productionRangeRef.current);
      if (requestVersion !== overviewRequestVersionRef.current) return;
      setData(next);
      if (next.goal?.businessLine) {
        setBusinessLine(next.goal.businessLine);
        setContentPlatform(
          next.goal.businessLine === "content_growth" && next.goal.contentPlatforms.length === 1
            ? next.goal.contentPlatforms[0]
            : "all",
        );
      }
      setError("");
      return next;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const businessScope = consumeBusinessPageContext("production");
    const returnContext = consumeDigitalEmployeeReturnContext();
    const restoring = initialLoadRef.current !== null;
    // Activity reconnects effects on return; reuse the initial request and UI state.
    if (!initialLoadRef.current) initialLoadRef.current = load();
    let active = true;
    void initialLoadRef.current.then(next => {
      if (!active) return;
      if (businessScope) {
        setWorkspaceView("overview");
        setBusinessLine(businessScope === "traffic" ? "content_growth" : "customer_conversion");
        setContentPlatform("all");
      }
      if (restoring || !returnContext || !next?.tasks.some(task => task.id === returnContext.taskId && task.run_id === returnContext.runId)) return;
      setWorkspaceView(returnContext.deliveryId ? "overview" : "live");
      setSelectedTaskId(returnContext.taskId);
      if (returnContext.deliveryId) setDeliveryFocus({ id: returnContext.deliveryId, request: Date.now() });
      setNavigationNotice(returnContext.deliveryId ? "已回到生产与交付，原交付记录已恢复。" : "已回到原任务的生产现场，运行与任务位置已恢复。");
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const run = data?.run;
    if (
      !data?.config ||
      viewGoalId ||
      !run ||
      ["succeeded", "failed", "cancelled"].includes(run.status)
    )
      return;
    const controller = new AbortController();
    const after = Math.max(
      0,
      ...(data?.events || []).map((event) => Number(event.sequence) || 0),
    );
    void streamRunEvents(
      run.id,
      after,
      (event) => {
        setData((current) =>
          current
            ? {
                ...current,
                events: current.events.some((item) => item.id === event.id)
                  ? current.events
                  : [...current.events, event],
              }
            : current,
        );
        if (productionRangeLoadingRef.current) return;
        const requestVersion = ++overviewRequestVersionRef.current;
        void digitalEmployeeApi
          .overview(undefined, productionRangeRef.current)
          .then((next) => {
            if (requestVersion === overviewRequestVersionRef.current) setData(next);
          })
          .catch(() => {});
      },
      controller.signal,
    ).catch((streamError) => {
      if (!controller.signal.aborted)
        setError(
          streamError instanceof Error ? streamError.message : "实时连接失败",
        );
    });
    return () => controller.abort();
  }, [Boolean(data?.config), data?.run?.id, data?.run?.status, viewGoalId]);

  useEffect(() => {
    const run = data?.run;
    if (
      !data?.config ||
      workspaceView !== "live" ||
      viewGoalId ||
      !run ||
      ["succeeded", "failed", "cancelled", "paused"].includes(run.status)
    )
      return;
    const reconcile = () => {
      if (document.visibilityState !== "visible") return;
      const requestVersion = ++overviewRequestVersionRef.current;
      void digitalEmployeeApi
        .reconcileRun(run.id)
        .then((next) => {
          if (requestVersion === overviewRequestVersionRef.current) setData(next);
        })
        .catch(() => {
          /* SSE remains the primary live channel */
        });
    };
    const timer = window.setInterval(reconcile, 25_000);
    return () => window.clearInterval(timer);
  }, [data?.run?.id, data?.run?.status, viewGoalId, workspaceView]);

  const act = async (
    key: string,
    action: () => Promise<DigitalEmployeeOverview>,
    throwOnError = false,
  ): Promise<DigitalEmployeeOverview | null> => {
    setBusy(key);
    setError("");
    try {
      const next = await action();
      // A completed mutation is authoritative and invalidates any older overview
      // refresh that may still be in flight.
      overviewRequestVersionRef.current += 1;
      setData(next);
      return next;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "操作失败");
      if (throwOnError) throw actionError;
      return null;
    } finally {
      setBusy("");
    }
  };

  const goal = data?.goal;
  const pendingApproval = data?.approvals.find(item => item.status === "pending" && item.task_id === selectedTaskId) || data?.approvals.find(
    (item) => item.status === "pending",
  );
  const approvalTask = data?.tasks.find(
    (item) => item.id === pendingApproval?.task_id,
  );
  const pendingPublishingPackage = pendingApproval?.evidence.find(
    item => item.type === "publishing_approval_package",
  );
  const approvalDecisionKind: AgentDecisionKind = approvalTask?.task_key === "followup_batch_approval"
    ? "customer_outreach"
    : ["content_release_approval", "publishing_calendar", "platform_publish"].includes(approvalTask?.task_key || "")
      ? "publish_confirmation"
      : "content_approval";
  const approvalOutputCount = pendingPublishingPackage && Array.isArray(pendingPublishingPackage.items)
    ? pendingPublishingPackage.items.length
    : (data?.deliveries || []).filter(card => approvalTask && card.taskIds.includes(approvalTask.id)).length;
  const approvalBudget = data?.plan?.businessPackage?.operatingContext?.budget.totalCny;
  const activeHandoff = data?.handoffs.find((item) => item.status === "active");
  const activeHandoffTask = data?.tasks.find(
    (item) => item.id === activeHandoff?.task_id,
  );
  const visibleTasks = (data?.tasks || []).filter(
    (task) => businessLine === "full_funnel" || taskBusinessLine(task) === businessLine,
  );
  const activeTask = visibleTasks.find((task) =>
    [
      "running",
      "waiting_external",
      "waiting_approval",
      "handed_off",
      "failed",
    ].includes(task.status),
  );
  const selectedTask =
    visibleTasks.find((task) => task.id === selectedTaskId) ||
    activeTask ||
    visibleTasks.find((task) => task.status === "succeeded") ||
    visibleTasks[0];
  const selectedPlanTask = selectedTask
    ? data?.plan?.tasks.find(item => item.key === selectedTask.task_key)
    : undefined;
  const selectedTaskSource = selectedTask
    ? selectedTask.status_source || selectedPlanTask?.statusSource || String(selectedTask.output?.statusSource || "") || (selectedTask.business_refs?.length ? `${selectedTask.business_refs.length} 条业务记录` : "周计划任务包")
    : "等待任务";
  const selectedTaskResult = selectedTask ? outputSummary(selectedTask) || "结果生成后会持久化到对应业务页面" : "等待任务";
  const nextRuntimeTask = selectedTask
    ? [...visibleTasks].sort((left, right) => left.sequence - right.sequence).find(item => item.sequence > selectedTask.sequence)
    : undefined;
  const selectedTaskNext = selectedTask?.status === "waiting_approval"
    ? "完成当前决策后继续执行"
    : ["failed", "waiting_human", "handed_off"].includes(selectedTask?.status || "")
      ? "处理阻塞、重试或交还 Agent"
      : nextRuntimeTask
        ? `下一节点：${nextRuntimeTask.title}`
        : "前往对应业务页面查看最终结果";
  const terminal = Boolean(
    data?.run && ["succeeded", "failed", "cancelled"].includes(data.run.status),
  );
  const activeRun = Boolean(data?.run && !terminal);
  const canCreateNextGoal = Boolean(
    goal &&
      (["completed", "cancelled"].includes(goal.status) || terminal) &&
      (!data?.run || terminal),
  );
  const operatingState = !data?.config
      ? "首次配置中"
      : data.review?.status === "generated"
        ? "本周期待复盘"
        : "常态经营中";
  const cycleLabel = goal
      ? `${goal.startsAt} 至 ${goal.endsAt}`
      : "尚未制定周期目标";
  const readiness = data?.businessSnapshot?.readiness || [];
  const requiredReadiness = data?.config
    ? requiredReadinessKeys(data.config)
    : [];
  const readinessMap = new Map(readiness.map((item) => [item.key, item]));
  const firstMissingReadiness = requiredReadiness
    .map((key) => readinessMap.get(key))
    .find((item): item is BusinessReadinessItem => Boolean(item && item.status !== "ready"));
  const approvalBlocked = Boolean(
    data?.config &&
      (readiness.length === 0 ||
        requiredReadiness.some(
          (key) => readinessMap.get(key)?.status !== "ready",
        )),
  );

  useEffect(() => {
    if (activeRun && newGoal) setNewGoal(false);
  }, [activeRun, newGoal]);

  const changeOverviewPeriod = (period: OverviewPeriod) => {
    const version = ++overviewRequestVersionRef.current;
    const nextRange = overviewRange(period);
    productionRangeLoadingRef.current = true;
    setBusy("overview-range");
    setError("");
    void digitalEmployeeApi.overview(viewGoalId, nextRange)
      .then(next => {
        if (version !== overviewRequestVersionRef.current) return;
        productionRangeRef.current = nextRange;
        setProductionPeriod(period);
        setData(next);
      })
      .catch(rangeError => {
        if (version === overviewRequestVersionRef.current) setError(rangeError instanceof Error ? rangeError.message : "经营数据加载失败");
      })
      .finally(() => {
        productionRangeLoadingRef.current = false;
        setBusy("");
      });
  };

  const scrollTo = (target: React.RefObject<HTMLDivElement | null>) => {
    window.setTimeout(
      () =>
        target.current?.scrollIntoView({ behavior: getScrollBehavior(), block: "start" }),
      50,
    );
  };

  const openBusiness: OpenBusinessLink = (page, view, businessRef = {}) => {
    const planTask = data?.plan?.tasks?.find(
      (item) =>
        item.destination === page && (!view || item.destinationView === view),
    );
    const task = data?.tasks.find((item) => item.task_key === planTask?.key);
    const base = task
      ? buildTaskDeepLink(task, planTask, data?.run?.id || task.run_id)
      : null;
    const link: DigitalEmployeeDeepLink = base
      ? {
          ...base,
          page,
          view,
          businessRef: { ...base.businessRef, ...businessRef },
        }
      : {
          page,
          view,
          runId: data?.run?.id || "",
          taskId: "",
          businessRef: {
            taskKey: planTask?.key || String(businessRef.taskKey || ""),
            businessDomain: planTask?.businessDomain,
            capabilityKey: planTask?.capabilityKey,
            statusSource: planTask?.statusSource,
            ...businessRef,
          },
        };
    if (typeof window !== "undefined") dispatchDigitalEmployeeDeepLink(link);
    else onNavigate?.(page);
  };

  const openReadiness = (item: BusinessReadinessItem) => {
    const target = readinessDestination[item.key];
    openBusiness(target.page, target.view, {
      taskKey: "context_readiness",
      readinessKey: item.key,
      readinessStatus: item.status,
    });
  };

  const saveConfig = async (config: DigitalEmployeeConfig & { minimalOnboarding?: true; brandName?: string; initialPlan?: InitialOperatingPlan }) => {
    const firstLogin = !data?.config;
    const createInitialPlan = Boolean(config.initialPlan && firstLogin && !data?.goal && !activeRun);
    setBusy(createInitialPlan ? "initial-plan" : "config");
    setError("");
    overviewRequestVersionRef.current += 1;
    try {
      const next = await digitalEmployeeApi.completeOnboarding(config);
      if (createInitialPlan && config.initialPlan) {
        const plan = config.initialPlan;
        const planFingerprint = initialOperatingPlanFingerprint(plan);
        const fingerprintConstraint = `首次计划校验：${planFingerprint}`;
        if (!next.config) throw new Error("新手引导配置尚未保存，无法创建首次计划");
        if (next.goal) {
          if (!next.goal.constraints.includes(fingerprintConstraint)) {
            throw new Error("已存在另一版首次计划，不能用当前修改覆盖。请恢复原计划后重试，或在经营页面新建计划。");
          }
          const existingPreparation = await digitalEmployeeApi.initialPreparation(next.goal.id);
          if (existingPreparation.preparation) {
            const resumed = await digitalEmployeeApi.overview(next.goal.id);
            overviewRequestVersionRef.current += 1;
            setData(resumed);
            setWorkspaceView("today");
            setNewGoal(false);
            setWeeklyPlanOpen(true);
            setOnboardingWelcomeOpen(false);
            return true;
          }
        }
        const videoPlans = initialPlanVideoPlans(plan, next.config);
        const created = next.goal ? next : await digitalEmployeeApi.createGoal({
            ...EMPTY_GOAL,
            businessLine: "content_growth",
            title: "首次推荐经营计划",
            objective: `为 ${plan.products.join("、")} 制作 ${plan.count} 条面向 ${plan.market} 的视频`,
            contentPlatforms: plan.platforms,
            target: plan.count,
            unit: "条",
            scope: plan.market,
            endsAt: plan.deliveryDate,
            constraints: [`制作预算上限：${plan.budgetCapCny} 元`, "真实发布前绑定账号并取得授权", fingerprintConstraint],
            videoPlans,
          });
        if (!created.goal) throw new Error("推荐计划创建失败");
        const draftPackage = created.plan?.businessPackage;
        if (!draftPackage?.directorPlan) throw new Error("推荐计划缺少可执行任务包或编导预算");
        const saved = await digitalEmployeeApi.savePackage(created.goal.id, {
          ...draftPackage,
          matrixPlan: initialPlanMatrixRows(plan, next.config),
          tasks: draftPackage.tasks.map(task => task.templateId === "production" ? { ...task, videoPlans } : task),
          directorPlan: {
            ...draftPackage.directorPlan,
            originalTarget: plan.count,
            platformVersionTarget: plan.count * plan.platforms.length,
            publishTarget: plan.count * plan.platforms.length,
            productionBudget: plan.budgetCapCny,
            productionBudgetMax: plan.budgetCapCny,
            productionBudgetMin: Math.min(draftPackage.directorPlan.productionBudgetMin || 0, plan.budgetCapCny),
          },
        });
        const savedRevision = saved.plan?.businessPackage?.revision;
        if (!savedRevision) throw new Error("已确认计划版本未保存");
        const initialRequestId = `initial-${created.goal.id.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 80)}`;
        await digitalEmployeeApi.startInitialPreparation(created.goal.id, savedRevision, plan, initialRequestId);
        const refreshed = await digitalEmployeeApi.overview(created.goal.id);
        overviewRequestVersionRef.current += 1;
        setData(refreshed);
        setWorkspaceView("today");
        setNewGoal(false);
        setWeeklyPlanOpen(true);
        setOnboardingWelcomeOpen(false);
        return true;
      }
      overviewRequestVersionRef.current += 1;
      setData(next);
      if (firstLogin) {
        setWorkspaceView("today");
        setNewGoal(!next.goal);
        setOnboardingWelcomeOpen(true);
        window.setTimeout(() => window.dispatchEvent(new CustomEvent('lingshu-assistant-say', {
          detail: { message: '欢迎加入灵枢！准备工作已经完成，接下来我会陪你和四位数字员工一起开始经营。', durationMs: 10_000 },
        })), 350);
        scrollTo(goalPanelRef);
      } else {
        showActionSuccess("设置已保存", "新的经营设置会从下一轮计划开始生效。");
      }
      return true;
    } catch (configError) {
      setError(configError instanceof Error ? configError.message : createInitialPlan ? "推荐计划制作准备失败" : "设置保存失败");
      return false;
    } finally {
      setBusy("");
    }
  };

  const saveGoal = async (goalInput: GoalDraft) => {
    const next = await act("goal", () =>
      digitalEmployeeApi.createGoal(goalInput),
    );
    if (next) {
      setNewGoal(false);
      setWorkspaceView("live");
      showActionSuccess("周任务已生成 👏", "四位数字员工会按确认后的计划开始推进。");
    }
  };

  const createWeeklyOutline = async (goalInput: GoalDraft) => {
    setBusy("confirm-weekly-plan");
    setError("");
    try {
      const created = await digitalEmployeeApi.createGoal(goalInput);
      if (!created.goal) throw new Error("周计划未能创建，请重试。");
      overviewRequestVersionRef.current += 1;
      setData(created);
      setNewGoal(false);
      setWeeklyPlanOpen(true);
      showActionSuccess("周目标已生成", "请核对账号产量、爆款参考并为每条视频选择产品。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "周目标生成失败");
      await load();
    } finally {
      setBusy("");
    }
  };

  const generateCurrentPlanDetails = async () => {
    if (!goal || busy) return;
    const next = await act("generate-plan-details", () => digitalEmployeeApi.generatePackageDetails(goal.id));
    if (!next) return;
    const detail = next.plan?.businessPackage?.detailGeneration;
    if (detail?.status === 'ready') showActionSuccess("任务详情已生成", detail.blockedCount
      ? `${detail.readyCount} 条母版可以开始；${detail.blockedCount} 条只在缺少动态产品/工厂视频等对应镜头处等待，不影响其他内容。`
      : "爆款参考、素材组合和编导分镜已经保存，刷新页面也不会丢失。");
    else showActionSuccess("制作准备已完成", `有 ${detail?.blockedCount || 0} 条任务需要先补素材、授权或预算。`);
  };

  const updateWeeklyPlanProduct = async (index: number, productName: string) => {
    const pack = data?.plan?.businessPackage;
    const product = planningOptions?.products.find(item => item.name === productName || item.id === productName);
    if (!goal || !pack || !product || busy) return;
    const sourcePlans = pack.tasks.find(task => task.templateId === "production")?.videoPlans || [];
    const selectedMaster = sourcePlans.filter(plan => plan.productionRole !== "platform_adaptation")[index];
    if (!selectedMaster) return;
    const selectedFamily = selectedMaster.contentFamilyId || selectedMaster.contentId;
    const nextPack = {
      ...pack,
      tasks: pack.tasks.map(task => task.templateId !== "production" ? task : {
        ...task,
        videoPlans: (task.videoPlans || []).map(plan => {
          if ((plan.contentFamilyId || plan.contentId) !== selectedFamily) return plan;
          const subject = plan.buyerProblem || plan.theme || "产品价值说明";
          return {
            ...plan,
            productId: product.id,
            productName: product.name,
            materialIds: [...product.materialIds],
            publication: {
              title: `${product.name}｜${subject}`.slice(0, 80),
              caption: `${subject}。本条视频将结合 ${product.name} 的真实产品素材与爆款结构完成制作。`,
              tags: Array.from(new Set([
                product.name.replace(/\s+/g, ""),
                contentPlatformLabel[plan.platform],
                "产品视频",
              ])),
              status: "planned" as const,
              generatedBy: "business_agent" as const,
            },
          };
        }),
      }),
    };
    const next = await act(`select-product:${index}`, () => digitalEmployeeApi.savePackage(goal.id, nextPack));
    if (next) showActionSuccess("产品已绑定", `${product.name} 的产品素材已同步到第 ${index + 1} 条母版及其平台版本。`);
  };

  const refreshWeeklyViralPlan = async () => {
    if (!goal || busy) return;
    setBusy("refresh-weekly-viral-plan");
    setError("");
    try {
      const proposal = await digitalEmployeeApi.recommendPackage(goal.id);
      const next = await digitalEmployeeApi.savePackage(goal.id, proposal);
      overviewRequestVersionRef.current += 1;
      setData(next);
      showActionSuccess("爆款计划已重新匹配", "系统已按本周账号产量重新选择爆款、自动绑定默认产品，并同步更新账号、预计成本和发布标题。爆款供给不足的任务会明确标记，补齐后即可确认。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "爆款计划重新匹配失败");
    } finally {
      setBusy("");
    }
  };

  const confirmWeeklyPlan = async () => {
    if (!goal || !data?.plan?.businessPackage || approvalBlocked || busy) return;
    const plans = data.plan.businessPackage.tasks.find(task => task.templateId === "production")?.videoPlans || [];
    const masters = plans.filter(plan => plan.productionRole !== "platform_adaptation");
    const missingProducts = masters.filter(plan => !plan.productName).length;
    const missingReferences = masters.filter(plan => !plan.referenceId).length;
    if (missingProducts || missingReferences) {
      setError([missingProducts ? `${missingProducts} 条原创母版未选择产品` : "", missingReferences ? `爆款库还缺 ${missingReferences} 条母版所需的可执行参考` : ""].filter(Boolean).join("；"));
      return;
    }
    setBusy("confirm-weekly-plan");
    setError("");
    try {
      let prepared = data;
      const currentPlans = prepared.plan?.businessPackage?.tasks.find(task => task.templateId === "production")?.videoPlans || [];
      const currentMasters = currentPlans.filter(plan => plan.productionRole !== "platform_adaptation");
      const ready = prepared.plan?.businessPackage?.detailGeneration?.status === "ready"
        && currentMasters.some(plan => plan.preproduction?.readiness.canStart);
      if (!ready) {
        prepared = await digitalEmployeeApi.generatePackageDetails(goal.id);
        overviewRequestVersionRef.current += 1;
        setData(prepared);
      }
      const detail = prepared.plan?.businessPackage?.detailGeneration;
      const preparedPlans = prepared.plan?.businessPackage?.tasks.find(task => task.templateId === "production")?.videoPlans || [];
      const preparedMasters = preparedPlans.filter(plan => plan.productionRole !== "platform_adaptation");
      if (detail?.status !== "ready" || !preparedMasters.some(plan => plan.preproduction?.readiness.canStart)) {
        throw new Error(`当前没有可开工内容：${detail?.blockers.slice(0, 3).join("；") || "请为至少一条母版补齐对应素材、授权或产品资料"}`);
      }
      const next = await digitalEmployeeApi.approveGoal(goal.id, prepared.plan?.businessPackage?.revision);
      overviewRequestVersionRef.current += 1;
      setData(next);
      setWorkspaceView("matrix");
      setSelectedTaskId(next.tasks.find(task => ["running", "waiting_external", "waiting_approval"].includes(task.status))?.id || next.tasks[0]?.id || "");
      showActionSuccess("本周任务已启动", detail.blockedCount
        ? `${detail.readyCount} 条母版开始生产，${detail.blockedCount} 条仅在各自缺失镜头处等待补素材。`
        : "经营 Agent 已把编导结论、内容制作、发布文案与复盘节点排入 To Do List。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "周任务启动失败");
    } finally {
      setBusy("");
    }
  };

  const approveCurrentGoal = async () => {
    if (!goal || approvalBlocked) return;
    const next = await act("approve-goal", () =>
      digitalEmployeeApi.approveGoal(goal.id, data?.plan?.businessPackage?.revision),
    );
    if (next) {
      setWorkspaceView("matrix");
      setWeeklyPlanOpen(false);
      setSelectedTaskId(
        next.tasks.find((task) =>
          ["running", "waiting_external", "waiting_approval"].includes(
            task.status,
          ),
        )?.id ||
          next.tasks[0]?.id ||
          "",
      );
    }
  };

  const goLive = (taskId?: string, deliveryId?: string) => {
    setDeliveryFocus(deliveryId ? { id: deliveryId, request: Date.now() } : undefined);
    if (taskId) setSelectedTaskId(taskId);
    else if (
      data?.tasks.find(
        (task) => taskNeedsAttention(task),
      )
    )
      setSelectedTaskId(
        data.tasks.find(
          (task) => taskNeedsAttention(task),
        )!.id,
      );
    setWorkspaceView(deliveryId ? "overview" : "live");
  };

  const openGoal = async (goalId: string) => {
    setViewGoalId(goalId);
    setSelectedTaskId("");
    setShowHistory(false);
    await load(goalId);
  };
  const returnToLatest = async () => {
    setViewGoalId("");
    setSelectedTaskId("");
    await load("");
  };

  if (loading)
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <Loader2 size={24} className="animate-spin text-accent" />
      </div>
    );

  if (data?.config) {
    const activeConfig = data.config;
    const dashboardView = workspaceView === "matrix"
      ? "matrix"
      : workspaceView === "overview"
        ? "queue"
        : workspaceView === "live"
          ? selectedContentItemId ? "production" : "queue"
          : workspaceView === "review" ? "review" : "home";
    const views: Array<{ id: "today" | "matrix" | "overview" | "review"; label: string; caption: string }> = [
      { id: "today", label: "经营总览", caption: "业绩与 Agent 实况" },
      { id: "matrix", label: "账号矩阵", caption: "职责、策略与连接" },
      { id: "overview", label: "内容队列", caption: "视频数据、平台与热度" },
      { id: "review", label: "数据复盘", caption: "热度排行与下周待办" },
    ];
    const currentVideoPlans = data.plan?.businessPackage?.tasks.find(task => task.templateId === "production")?.videoPlans || goal?.videoPlans || [];
    const currentMasterPlans = currentVideoPlans.filter(plan => plan.productionRole !== "platform_adaptation");
    const missingReferenceMasters = currentMasterPlans.filter(plan => !plan.referenceId);
    const missingProductMasters = currentMasterPlans.filter(plan => !plan.productName);
    const detailGeneration = data.plan?.businessPackage?.detailGeneration;
    const planDetailsReady = detailGeneration?.status === 'ready'
      && currentMasterPlans.some(plan => plan.preproduction?.readiness.canStart);
    const currentMatrix = data.plan?.businessPackage?.matrixPlan || [];
    const plannedAccountTaskCounts = currentVideoPlans.reduce<Record<string, number>>((counts, plan) => {
      const accountId = plan.matrix?.accountId;
      if (accountId) counts[accountId] = (counts[accountId] || 0) + 1;
      return counts;
    }, {});
    const queuedAccountTaskCounts = (data.contentQueue?.items || []).reduce<Record<string, number>>((counts, item) => {
      if (item.accountId) counts[item.accountId] = (counts[item.accountId] || 0) + 1;
      return counts;
    }, {});
    const accountTaskCounts = Object.keys({ ...plannedAccountTaskCounts, ...queuedAccountTaskCounts }).reduce<Record<string, number>>((counts, accountId) => {
      counts[accountId] = Math.max(plannedAccountTaskCounts[accountId] || 0, queuedAccountTaskCounts[accountId] || 0);
      return counts;
    }, {});
    const matrixPlatforms = goal?.contentPlatforms?.length
      ? goal.contentPlatforms
      : data.config.publishingTargets.length
        ? [...new Set(data.config.publishingTargets.map(target => target.platform))]
        : (["youtube", "tiktok", "instagram", "facebook"] as const).slice();
    const accountMatrixForRail = currentMatrix.length
      ? currentMatrix
      : defaultMatrixPlan(data.config, [...matrixPlatforms], goal?.objective || "验证本周内容方向并获得有效询盘");
    const matrixRoleLabels: Record<string, string> = {
      brand_capability: "品牌能力号",
      buyer_advisor: "买家顾问号",
      brand_combined: "品牌综合账号",
    };
    const publishingTargets = data.config.publishingTargets;
    const smartOperationsAccounts: SmartOperationsAccount[] = accountMatrixForRail.map(row => {
      const connected = publishingTargets.find(target => target.accountId === row.accountId && target.platform === row.platform);
      return {
        platform: row.platform,
        accountId: row.accountId,
        accountLabel: connected?.accountLabel || `${contentPlatformLabel[row.platform]} · ${matrixRoleLabels[row.accountRole || "brand_combined"]}`,
        connected: Boolean(connected),
      };
    });
    const operatingContext = data.plan?.businessPackage?.operatingContext;
    const currentEstimatedCost = operatingContext?.budget.totalCny || currentVideoPlans.reduce((sum, plan) => sum + Number(plan.estimatedCost || 0), 0) || Number(data.plan?.estimatedCost || 0);
    const currentCostMin = operatingContext?.budget.totalMinCny ?? currentVideoPlans.reduce((sum, plan) => sum + Number(plan.estimatedCostRange?.minCny || 0), 0);
    const currentCostMax = operatingContext?.budget.totalMaxCny ?? currentVideoPlans.reduce((sum, plan) => sum + Number(plan.estimatedCostRange?.maxCny || 0), 0);
    const plannedDurationSeconds = operatingContext?.outputs.totalDurationSeconds || currentMasterPlans.reduce((sum, plan) => sum + Number(plan.duration || 0), 0);
    const assignmentCounts = (data.plan?.tasks || []).reduce<Record<string, number>>((counts, task) => ({ ...counts, [task.agentRole]: (counts[task.agentRole] || 0) + 1 }), {});
    const currentPlanStatusLabel = viewGoalId
      ? "历史计划"
      : goal?.status === "draft"
        ? "待确认"
        : activeRun
          ? "执行中"
          : terminal || goal?.status === "completed"
            ? "已完成"
            : "已确认";
    const startWeeklyWork = () => {
      if (viewGoalId) {
        void returnToLatest();
        return;
      }
      if (activeRun) {
        setWorkspaceView("overview");
        return;
      }
      if (canCreateNextGoal) {
        setNewGoal(true);
        setWeeklyPlanOpen(true);
        return;
      }
      setNewGoal(false);
      setWeeklyPlanOpen(true);
    };
    const controlWeeklyWork = async () => {
      if (viewGoalId) {
        await returnToLatest();
        return;
      }
      if (activeRun && data.run) {
        if (data.run.status === "paused") await act("resume", () => digitalEmployeeApi.resumeRun(data.run!.id));
        else await act("pause", () => digitalEmployeeApi.pauseRun(data.run!.id));
        return;
      }
      startWeeklyWork();
    };
    const weeklyControlLabel = viewGoalId
      ? "返回当前周计划"
      : activeRun
        ? data.run?.status === "paused" ? "继续周任务" : "暂停周任务"
        : canCreateNextGoal ? "开始下一周任务" : "开始周任务";
    const openContentProduction = (taskId?: string, socialContentTaskId?: string) => {
      if (socialContentTaskId) {
        window.dispatchEvent(new CustomEvent("lingshu:navigate", { detail: {
          page: "smartAssets", view: "create", directStudio: true,
          socialContentTaskId, socialContentPage: "smartAssets",
        } }));
        return;
      }
      const task = data.tasks.find(item => item.id === taskId)
        || data.tasks.find(item => item.task_key === "content_production")
        || data.tasks.find(item => item.task_key === "content_quality_gate");
      if (!task) {
        onNavigate?.("smartAssets");
        return;
      }
      const planTask = data.plan?.tasks.find(item => item.key === task.task_key);
      dispatchDigitalEmployeeDeepLink(buildTaskDeepLink(task, planTask, data.run?.id || task.run_id));
    };
    const openProductionProgress = (taskId: string, contentItemId: string) => {
      if (taskId) setSelectedTaskId(taskId);
      setSelectedContentItemId(contentItemId);
      setWorkspaceView("live");
      window.setTimeout(() => document.querySelector('[data-testid="production-task-scene"]')?.scrollIntoView({ behavior: getScrollBehavior(), block: "start" }), 50);
    };
    const weeklyPlanControls = <>
      <Button onClick={()=>{ setNewGoal(false); setWeeklyPlanOpen(true); }} icon={<CalendarRange size={15}/>}>查看本周计划</Button>
      <Button onClick={()=>setWorkspaceView("rules")} icon={<Settings2 size={15}/>}>Agent 设置</Button>
      <Button onClick={()=>setPlanHistoryOpen(true)} icon={<History size={15}/>}>历史计划</Button>
      <Button type="primary" loading={Boolean(busy)} onClick={()=>void controlWeeklyWork()} icon={activeRun && data.run?.status !== "paused" ? <Pause size={15}/> : <Play size={15}/>}>{weeklyControlLabel}</Button>
    </>;
    return (
      <>
      {!weeklyPlanOpen && <div className="h-full overflow-y-auto bg-white">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8">
          <h1 className="sr-only">{PAGE_REGISTRY.digitalEmployees.canonicalTitle}</h1>
          <div aria-label="当前周计划">
            {goal ? <WeeklyCommandCenter
              data={data}
              statusLabel={currentPlanStatusLabel}
              actions={weeklyPlanControls}
              notice={!activeRun && !viewGoalId && (approvalBlocked || missingReferenceMasters.length > 0 || missingProductMasters.length > 0 || detailGeneration?.status === "blocked")
                ? <p className="mr-auto text-[10px] font-bold text-amber-700">{approvalBlocked ? `开始前需补齐：${firstMissingReadiness?.label || "经营基础信息"}` : missingReferenceMasters.length ? `爆款库还缺 ${missingReferenceMasters.length} 条母版所需的已分析视频` : missingProductMasters.length ? `还有 ${missingProductMasters.length} 条原创母版未绑定产品` : `开始前需处理 ${detailGeneration?.blockedCount || 0} 条母版任务卡点`}</p>
                : undefined}
            /> : <section className="overflow-hidden rounded-lg border border-border bg-white"><div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4"><div><p className="text-xs font-semibold text-accent">周经营计划</p><p className="mt-1 text-sm font-bold text-slate-800">本周还没有可执行计划</p><p className="mt-1 text-xs text-slate-500">点击“开始周任务”确定平台、账号、视频产量和预算，再选择产品并确认工作排期。</p></div><div aria-label="智能经营控制" className="flex max-w-full flex-wrap items-center justify-end gap-2">{weeklyPlanControls}</div></div></section>}
          </div>
          <Tabs className="mt-6" aria-label="智能经营视图" activeKey={workspaceView === "live" ? "overview" : workspaceView} onChange={key => {setWorkspaceView(key as WorkspaceView); if(key !== "overview") setSelectedContentItemId("");}} items={views.map(view => ({key: view.id, label: view.label}))}/>
          {error && <Alert className="mt-5" type="error" showIcon title={error} closable onClose={()=>setError("")}/>}
          <div className="grid grid-cols-1 gap-4 py-6">
            {workspaceView === "matrix" && <SmartOperationsAccountRail targets={smartOperationsAccounts} selectedAccountId={selectedAccountId} taskCounts={accountTaskCounts} onSelect={setSelectedAccountId} onManage={() => onNavigate?.('plugins')}/>}
            <main className="min-w-0">
            {workspaceView === "rules"
              ? <OnboardingPanel initial={data.config} readiness={data.businessSnapshot?.readiness || []} busy={Boolean(busy)} mode="rules" activeRun={activeRun} onOpenReadiness={openReadiness} onSave={(config) => void saveConfig(config)} />
              : <SmartBusinessDashboard data={data} view={dashboardView} selectedAccountId={selectedAccountId} selectedContentItemId={selectedContentItemId} onRefresh={() => void load()} onGenerateDetails={() => void generateCurrentPlanDetails()} onOpenContent={openContentProduction} onOpenProductionProgress={openProductionProgress} onBackToQueue={()=>{setSelectedContentItemId("");setWorkspaceView("overview");}} onRetryTask={async taskId => Boolean(await act(`retry:${taskId}`, () => digitalEmployeeApi.retryTask(taskId)))} onControlJob={async (jobId, action) => Boolean(await act(`execution:${jobId}:${action}`, () => digitalEmployeeApi.controlExecutionJob(jobId, action)))} onGeneratePlan={() => { if (!goal || canCreateNextGoal) setNewGoal(true); setWeeklyPlanOpen(true); }} onNavigate={page => {
                  if (page === "socialPlanning") {
                    if (!goal || canCreateNextGoal) setNewGoal(true);
                    setWeeklyPlanOpen(true);
                    return;
                  }
                  if (["enterprise", "accountManagement", "plugins", "scheduled", "socialInspiration", "scriptLibrary", "smartAssets", "conversion", "digitalEmployees"].includes(page)) onNavigate?.(page as BusinessDestination);
                }} />}
            </main>
          </div>
        </div>
      </div>}
      {applicationGuideOpen && (
        <OnboardingPanel
          initial={data.config}
          readiness={data.businessSnapshot?.readiness || []}
          busy={Boolean(busy)}
          allowInitialPlan={false}
          restartFromBeginning
          dismissible
          onClose={() => setApplicationGuideOpen(false)}
          onOpenReadiness={openReadiness}
          onSave={async config => {
            const saved = await saveConfig(config);
            if (saved) setApplicationGuideOpen(false);
            return saved;
          }}
        />
      )}
      {weeklyPlanOpen && <div className="h-full overflow-y-auto bg-white">
        <section aria-label={goal && !newGoal ? "本周计划详情" : "周计划生成"} className="mx-auto w-full max-w-[1440px] p-4 sm:p-6">
          <header className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
            <h1 className="text-[28px] font-semibold">{goal && !newGoal ? activeRun ? "数字员工工作排期" : "确认本周视频计划" : "制定本周目标"}</h1>
            <Button disabled={Boolean(busy)} onClick={() => setWeeklyPlanOpen(false)} icon={<ChevronLeft size={15}/>}>返回智能经营</Button>
          </header>
          {error && (
            <Alert className="mb-4" type="error" showIcon title={error}/>
          )}
          <div className="py-5">
            {goal && !newGoal && <InitialPreparationStatusPanel goalId={goal.id} onRunning={() => void load(goal.id)} />}
            {(!goal || newGoal) && !activeRun ? <GoalPanel config={data.config} busy={Boolean(busy)} businessLine={businessLine} contentPlatform={contentPlatform} onOpenSettings={()=>{setWeeklyPlanOpen(false);setWorkspaceView("rules");}} onSave={goalInput => void createWeeklyOutline(goalInput)}/>
              : goal ? <div className="space-y-4">
                <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 px-4 py-3">
                  <div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-semibold text-slate-950">{goal.title}</h3><span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-semibold ${activeRun?"bg-emerald-50 text-emerald-700":"bg-amber-50 text-amber-700"}`}>{activeRun?"执行中":"待确认"}</span></div><p className="mt-1 text-[10px] text-slate-500">{goal.startsAt} 至 {goal.endsAt}</p></div>
                  <div className="grid grid-cols-4 gap-4 text-right"><div><p className="text-[9px] font-bold text-slate-400">发布内容</p><p className="mt-0.5 text-sm font-semibold text-slate-900">{currentVideoPlans.length} 条</p></div><div><p className="text-[9px] font-bold text-slate-400">原创母版</p><p className="mt-0.5 text-sm font-semibold text-slate-900">{currentMasterPlans.length} 条</p></div><div><p className="text-[9px] font-bold text-slate-400">母版时长</p><p className="mt-0.5 text-sm font-semibold text-slate-900">{plannedDurationSeconds>0?`${plannedDurationSeconds} 秒`:"待确认"}</p></div><div><p className="text-[9px] font-bold text-slate-400">预计成本</p><p className="mt-0.5 text-sm font-semibold text-slate-900">{currentCostMax>0?`¥${currentCostMin.toFixed(0)}–${currentCostMax.toFixed(0)}`:currentEstimatedCost>0?`约 ¥${currentEstimatedCost.toFixed(0)}`:"待核算"}</p></div></div>
                </section>
                <WeeklyPlanCalendar
                  startsAt={goal.startsAt}
                  endsAt={goal.endsAt}
                  plans={currentVideoPlans}
                  masterPlans={currentMasterPlans}
                  accounts={activeConfig.publishingTargets}
                  products={planningOptions?.products || []}
                  busy={Boolean(busy) || activeRun}
                  onChangeProduct={(index, productName) => void updateWeeklyPlanProduct(index, productName)}
                  onRefreshReferences={missingReferenceMasters.length ? () => void refreshWeeklyViralPlan() : undefined}
                  onOpenReference={plan => {
                    const referenceId = plan.referenceId || plan.preproduction?.benchmark.referenceId || "";
                    const sourceUrl = plan.preproduction?.benchmark.sourceUrl || plan.planningEvidence?.referenceSourceUrl || "";
                    const title = plan.planningEvidence?.referenceTitle || plan.theme;
                    if (!referenceId && !sourceUrl) return;
                    setWeeklyPlanOpen(false);
                    window.dispatchEvent(new CustomEvent("lingshu:navigate", { detail: {
                      page: "socialInspiration",
                      view: "inspiration",
                      businessRef: { referenceId },
                      inspirationReference: {
                        referenceId,
                        sourceUrl,
                        title,
                        platform: plan.platform,
                        thumbnailUrl: plan.preproduction?.benchmark.thumbnailUrl || plan.planningEvidence?.referenceThumbnailUrl || "",
                        duration: plan.duration,
                        benchmarkAnalysis: plan.benchmarkAnalysis,
                      },
                    } }));
                  }}
                />
                {!activeRun && <div className="flex flex-wrap items-center justify-between gap-4"><p className={`text-xs ${approvalBlocked||missingProductMasters.length||missingReferenceMasters.length?'font-bold text-amber-700':'text-slate-500'}`}>{approvalBlocked?`开始前需补齐：${firstMissingReadiness?.label||'企业资料或社媒账号'}`:missingReferenceMasters.length?`爆款库还缺 ${missingReferenceMasters.length} 条母版所需的已分析视频`:missingProductMasters.length?`还有 ${missingProductMasters.length} 条原创母版未选择产品`:'确认后系统只生产 5 条母版，并生成各平台标题、文案、Tag 与轻适配版本。'}</p><Button type="primary" htmlType="button" disabled={Boolean(busy)||approvalBlocked||Boolean(missingProductMasters.length)||Boolean(missingReferenceMasters.length)} onClick={()=>void confirmWeeklyPlan()} className="!h-auto min-h-9 !whitespace-normal shrink-0 rounded-lg px-5 py-2.5 text-sm font-semibold">{busy==='confirm-weekly-plan'?<span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin"/>正在编排并启动…</span>:"确认周计划并开始工作"}</Button></div>}
                {activeRun&&<section aria-label="Agent To Do List" className="overflow-hidden rounded-lg border border-slate-200"><div className="border-b border-slate-100 bg-slate-950 px-5 py-4 text-white"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">Agent 工作清单</p><h3 className="mt-1 text-lg font-semibold">数字员工工作排期</h3><p className="mt-1 text-[10px] text-slate-300">每一步都标明负责 Agent、预计用时、输出和下一节点。</p></div><div className="divide-y divide-slate-100">{(data.plan?.tasks||[]).map((task,index)=>{const runtime=data.tasks.find(item=>item.task_key===task.key);return <article key={task.key} className="grid gap-3 px-5 py-4 sm:grid-cols-[40px_150px_minmax(0,1fr)_100px]"><span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${runtime?.status==='succeeded'?'bg-emerald-100 text-emerald-700':runtime?.status==='running'?'bg-blue-100 text-blue-700':'bg-slate-100 text-slate-500'}`}>{index+1}</span><div><p className="text-xs font-semibold text-slate-900">{agentLabel[task.agentRole]||task.agentRole}</p><p className="mt-1 text-[10px] text-slate-500">预计 {task.expectedMinutes} 分钟</p></div><div><p className="text-sm font-semibold text-slate-950">{task.title}</p><p className="mt-1 text-[10px] leading-5 text-slate-500">{task.description}</p><p className="mt-1 text-[10px] font-bold text-emerald-700">结果：{runtime?outputSummary(runtime)||'完成后自动保存到对应业务页面':task.statusSource||'完成后持久化'} · 下一步：{data.plan?.tasks[index+1]?.title||'进入周复盘'}</p></div><span className={`h-fit rounded-full border px-2 py-1 text-center text-[9px] font-semibold ${statusTone[runtime?.status||'']||'border-slate-200 bg-slate-50 text-slate-500'}`}>{runtime?.status==='running'?'进行中':runtime?.status==='succeeded'?'已完成':runtime?.status==='failed'?'需处理':'待执行'}</span></article>})}</div></section>}
                {activeRun&&<div className="flex justify-end"><Button htmlType="button" onClick={()=>{setWeeklyPlanOpen(false);setWorkspaceView("matrix");}} className="!h-auto min-h-9 !whitespace-normal rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white">查看账号排期甘特图</Button></div>}
              </div> : null}
          </div>
        </section>
      </div>}
      {planHistoryOpen&&<PlanHistoryDialog goals={data.goals} onClose={()=>setPlanHistoryOpen(false)}/>}
      {onboardingWelcomeOpen && <OnboardingWelcome onClose={()=>setOnboardingWelcomeOpen(false)} />}
      </>
    );
  }

  return (
    <div className="workspace-canvas digital-employee-page">
      <div className="workspace-frame">
        <header className="workspace-header">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <h1 className="workspace-title mt-2">
              数字员工正在等待调遣
            </h1>
            {data?.config && (
              <div className="flex flex-wrap items-stretch gap-2 text-xs text-text-secondary">
                <div className="min-w-52 rounded-lg border border-accent/25 bg-accent-glow px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-accent">当前工作模式</p>
                  <p className="mt-1 font-semibold text-text-primary">{autonomyLabel[data.config.autonomyMode]}模式 · {operatingState}</p>
                  <p className="mt-0.5 text-[10px] text-text-muted">{cycleLabel}</p>
                </div>
                <Button
                  htmlType="button"
                  onClick={() => setWorkspaceView("rules")}
                  className={`!h-auto min-h-9 !whitespace-normal inline-flex min-h-12 items-center gap-1.5 rounded-lg border px-4 py-2 font-bold transition ${workspaceView === "rules" ? "border-accent bg-accent text-white" : "border-accent bg-accent text-white hover:brightness-95"}`}
                >
                  <Settings2 size={13} /> Agent 设置
                </Button>
                <Button
                  htmlType="button"
                  onClick={() => {
                    setWorkspaceView("today");
                    setShowHistory((value) => !value);
                  }}
                  className="!h-auto min-h-9 !whitespace-normal inline-flex min-h-12 items-center gap-1.5 rounded-lg border border-accent/35 bg-white px-4 py-2 font-bold text-accent transition hover:border-accent hover:bg-accent-glow"
                >
                  <History size={13} /> 历史记录
                </Button>
              </div>
            )}
          </div>
          {!data?.config && <div className="mt-5 inline-flex items-center gap-2 border-l-2 border-accent bg-surface-2 px-3 py-2 text-xs font-semibold text-accent"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] text-text-primary">1</span>{operatingState}</div>}
        </header>

        {data?.config && <nav
          aria-label="数字员工工作视图"
          className="workspace-tabs mt-2"
        >
          {workspaceViews.map((view) => {
            const pendingCount = data.approvals.filter((item) => item.status === "pending").length;
            const caption = view.id === "live" && pendingCount ? `${pendingCount} 项待处理 · 任务与纠偏` : view.id === "review" && !data.review ? "数据积累中" : view.caption;
            return <Button
              key={view.id}
              htmlType="button"
              onClick={() => setWorkspaceView(view.id)}
              aria-current={workspaceView === view.id ? "page" : undefined}
              className="!h-auto min-h-9 !whitespace-normal workspace-tab min-w-[150px] px-1 py-2"
            >
              <span className="block text-xs font-semibold">{view.label}</span>
              <span
                className="mt-0.5 block text-[10px] text-slate-400"
              >
                {caption}
              </span>
            </Button>;
          })}
        </nav>}
        {data?.config && workspaceView === "overview" && <BusinessLineNav value={businessLine} platform={contentPlatform} onChange={setBusinessLine} onPlatformChange={setContentPlatform}/>}
        {navigationNotice && (
          <div
            role="status"
            className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-800"
          >
            <span className="flex items-center gap-2">
              <ChevronLeft size={15} />
              {navigationNotice}
            </span>
            <Button className="!h-auto min-h-9 !whitespace-normal"
              htmlType="button"
              onClick={() => setNavigationNotice("")}
              aria-label="关闭返回提示"
            >
              <XCircle size={16} />
            </Button>
          </div>
        )}
        {error && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span className="flex items-center gap-2">
              <AlertTriangle size={16} />
              {error}
            </span>
            <Button className="!h-auto min-h-9 !whitespace-normal" onClick={() => setError("")}>
              <XCircle size={17} />
            </Button>
          </div>
        )}

        {!data?.config && (
          <OnboardingPanel
            initial={EMPTY_CONFIG}
            readiness={data?.businessSnapshot?.readiness || []}
            busy={Boolean(busy)}
            onOpenReadiness={openReadiness}
            onNavigate={(page) => openBusiness(page)}
            onSave={saveConfig}
          />
        )}

        {data?.config && workspaceView === "today" && (
          <div className="mt-5 space-y-5">
            {viewGoalId && (
              <section className="rounded-lg border border-violet-200 bg-violet-50 p-5">
                <p className="text-sm font-semibold text-violet-900">
                  正在只读查看历史运行
                </p>
                <p className="mt-1 text-xs text-violet-700">
                  可以查看业务证据和复盘，但不会在历史目标上启动、审批或控制任务。
                </p>
              </section>
            )}
            {(!newGoal || Boolean(goal)) && <TodayFocusPanel
              data={presentedData || data}
              onOpenExecution={goLive}
              onReviewPlan={() => goLive()}
            />}
            {showHistory && (
              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <History size={18} className="text-violet-600" />
                    <div>
                      <h2 className="text-sm font-semibold text-slate-950">
                        历史工作
                      </h2>
                      <p className="text-[11px] text-slate-400">
                        历史运行只读，不会自动推进任务状态
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={() => setShowHistory(false)}
                    className="!h-auto min-h-9 !whitespace-normal rounded-lg p-2 text-slate-400 hover:bg-slate-50"
                  >
                    <XCircle size={17} />
                  </Button>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                  {data.goals.map((historyGoal, index) => (
                    <Button
                      key={historyGoal.id}
                      htmlType="button"
                      onClick={() => void openGoal(historyGoal.id)}
                      className={`!h-auto min-h-9 !whitespace-normal rounded-lg border p-4 text-left transition hover:border-violet-300 ${data.goal?.id === historyGoal.id ? "border-violet-300 bg-violet-50/50" : "border-slate-200"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-bold text-slate-400">
                            {index === 0
                              ? "最近一轮"
                              : `历史第 ${index + 1} 轮`}
                          </p>
                          <p className="mt-1 text-sm font-bold text-slate-900">
                            {historyGoal.title}
                          </p>
                        </div>
                        <Badge status={historyGoal.status} />
                      </div>
                      <p className="mt-3 text-[11px] text-slate-500">
                        {historyGoal.startsAt} 至 {historyGoal.endsAt}
                      </p>
                    </Button>
                  ))}
                </div>
              </section>
            )}
            {viewGoalId && (
              <Button
                htmlType="button"
                onClick={() => void returnToLatest()}
                className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-1.5 text-xs font-bold text-slate-600"
              >
                <ChevronLeft size={14} />
                返回最近一轮工作
              </Button>
            )}
            {!viewGoalId && newGoal && !activeRun && (
              <div ref={goalPanelRef} className="scroll-mt-24">
                <GoalPanel
                  config={data.config}
                  busy={Boolean(busy)}
                  businessLine={businessLine}
                  contentPlatform={contentPlatform}
                  onOpenSettings={() => setWorkspaceView("rules")}
                  onSave={(goalInput) => void saveGoal(goalInput)}
                />
              </div>
            )}
            {!viewGoalId && goal && goal.status !== "draft" && (
              <div className="flex flex-col items-end gap-2">
                {canCreateNextGoal ? (
                  <Button
                    onClick={() => {
                      setNewGoal(true);
                      scrollTo(goalPanelRef);
                    }}
                    className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-xs font-bold text-white"
                  >
                    <Target size={14} />
                    制定下一周目标
                  </Button>
                ) : (
                  <p className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-500">
                    本轮目标仍在执行；完成或取消当前运行后才能制定下一周目标。
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {data?.config && workspaceView === "overview" && (
          <div className="mt-5">
            <ProductionProgressPanel
              deliveryBoard={data.plan && data.run && (
                <DeliveryBoard
                  onAccepted={() => { void load(); }}
                  tasks={data.run ? visibleTasks : []}
                  deliveries={data.deliveries}
                  focus={deliveryFocus}
                  notice={data.deliveryNotice}
                  goalTitle={data.goal?.title || "当前经营目标"}
                  events={data.events}
                  onSelectTask={(taskId) => {
                    setSelectedTaskId(taskId);
                    setWorkspaceView("live");
                  }}
                  onOpenTask={dispatchDigitalEmployeeDeepLink}
                  onOpenMonitor={onOpenMonitor}
                />
              )}
              period={productionPeriod}
              data={presentedData || data}
              onOpenPublishing={() => openBusiness("smartAssets", "publish")}
              onViewResults={() => {
                saveBusinessPageContext("home", businessLine === "customer_conversion" ? "crm" : "traffic");
                onViewResults?.();
              }}
              businessLine={businessLine}
              contentPlatform={contentPlatform}
              onManageGoal={() => {
                if (goal) { setWorkspaceView("live"); return; }
                setWorkspaceView("today");
                setNewGoal(true);
                scrollTo(goalPanelRef);
              }}
              rangeBusy={busy === "overview-range"}
              onPeriodChange={changeOverviewPeriod}
            />
          </div>
        )}

        {data?.config && workspaceView === "live" && (
          <div className="mt-5 space-y-5">
            {viewGoalId && <p className="rounded-lg bg-violet-50 p-4 text-xs text-violet-800">正在只读查看历史计划与执行情况。</p>}
            {data.plan?.businessPackage && !data.run && <WeeklyPackagePanel
              data={data} readOnly={Boolean(viewGoalId)} busy={Boolean(busy)} onOpen={openBusiness}
              onOpenNode={link => {
                if (link.page !== "digitalEmployees") { dispatchDigitalEmployeeDeepLink(link); return; }
                if (link.businessRef.taskKey === "weekly_review") { setWorkspaceView("review"); return; }
                if (link.taskId) {
                  setSelectedTaskId(link.taskId);
                  window.setTimeout(() => document.getElementById("task-production-scene")?.scrollIntoView({ behavior: getScrollBehavior(), block: "start" }), 50);
                } else {
                  document.getElementById("weekly-plan-preview")?.scrollIntoView({ behavior: getScrollBehavior(), block: "start" });
                }
              }}
              onLinkProject={async (taskId, projectId) => { if (!await act("link-project", () => digitalEmployeeApi.linkTaskProject(data.run!.id, taskId, projectId), true)) throw new Error("关联失败，请重试。"); }}
              onTask={taskId => { setSelectedTaskId(taskId); window.setTimeout(() => document.getElementById("task-production-scene")?.scrollIntoView({ behavior: getScrollBehavior(), block: "start" }), 50); }}
              onSave={async pack => { const result = await act("save-package", () => digitalEmployeeApi.savePackage(goal!.id, pack), true); if (!result) throw new Error("经营包未保存，请检查页面提示后重试。"); return true; }}
              onApprove={async revision => { const result = await act("approve-goal", () => digitalEmployeeApi.approveGoal(goal!.id, revision), true); if (!result) throw new Error("未能启动，请检查账号、资料和授权范围后重试。"); }}
            />}
            {!data.run && data.plan && <section id="weekly-plan-preview" className="scroll-mt-6 rounded-lg border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-bold">本周目标与执行计划</h2>
              <p className="mt-3 font-semibold">{goal?.title}</p>
              <p className="mt-2 text-sm text-slate-600">{goal?.objective}</p>
              <p className="mt-2 text-sm text-slate-600">{data.plan.strategy}</p>
              <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-slate-600">{(data.plan.successCriteria || []).map(item => <li key={item}>{item}</li>)}</ul>
            </section>}
            {!data.run && !data.plan && (
              <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-blue-200 bg-blue-50/50 px-5 py-4">
                <div><p className="text-sm font-bold text-blue-900">{goal ? "计划正在生成" : "还没有本周计划"}</p><p className="mt-1 text-xs text-blue-700">{goal ? "计划生成后，可在这里查看任务安排并确认启动。" : "先制定本周目标，系统会生成可确认的任务计划。"}</p></div>
                {!goal && !viewGoalId && <Button
                  onClick={() => { setWorkspaceView("today"); setNewGoal(true); scrollTo(goalPanelRef); }}
                  className="!h-auto min-h-9 !whitespace-normal rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white"
                >制定本周目标</Button>}
              </section>
            )}
            {data.plan && data.run && (
              <>
              <section className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="mb-3 flex items-center justify-between gap-3 px-1"><div><h2 className="text-sm font-bold text-slate-950">本轮 Agent</h2><p className="mt-1 text-[11px] text-slate-500">按执行顺序排列，点击查看对应生产进度</p></div><Button onClick={() => void load()} title="刷新生产现场" className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 bg-white p-2 text-slate-500"><RefreshCcw size={15} /></Button></div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {[...visibleTasks].sort((left, right) => left.sequence - right.sequence).map((item, index) => <Button key={item.id} htmlType="button" aria-pressed={selectedTask?.id === item.id} onClick={() => setSelectedTaskId(item.id)} className={`!h-auto min-h-9 !whitespace-normal flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left ${selectedTask?.id === item.id ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}><span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-slate-500">{index + 1}</span><span><span className="block text-xs font-bold text-slate-800">{agentLabel[item.agent_role] || "业务 Agent"}</span><span className="block max-w-44 truncate text-[10px] text-slate-400">{item.title}</span></span><Badge status={item.status} /></Button>)}
                </div>
              </section>
              <div className="grid gap-5">
                <div className="space-y-5">
                  <div id="task-production-scene" className="relative scroll-mt-6">
                    {selectedTask ? <div className="space-y-3">
                      <section className="rounded-lg border border-slate-200 bg-white p-4" aria-label="数字员工任务轨迹"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold tracking-[.14em] text-emerald-700">任务轨迹</p><h3 className="mt-1 text-sm font-semibold text-slate-950">{selectedTask.title}</h3></div><Button htmlType="button" onClick={() => dispatchDigitalEmployeeDeepLink(buildTaskDeepLink(selectedTask, selectedPlanTask, data.run!.id))} className="!h-auto min-h-9 !whitespace-normal inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-[10px] font-semibold text-white">下钻业务页面 <ArrowRight size={12}/></Button></div><dl className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{[{label:"当前节点",value:humanizeValue(selectedTask.status)},{label:"来源",value:selectedTaskSource},{label:"结果",value:selectedTaskResult},{label:"下一步",value:selectedTaskNext}].map(item=><div key={item.label} className="rounded-lg bg-slate-50 px-3 py-3"><dt className="text-[9px] font-bold text-slate-400">{item.label}</dt><dd className="mt-1 line-clamp-2 text-[11px] font-bold leading-5 text-slate-800">{item.value}</dd></div>)}</dl></section>
                      <ProductionTaskScene runId={data.run.id} taskId={selectedTask.id} embedded />
                    </div> : <div className="rounded-lg border border-dashed border-slate-200 bg-white p-12 text-center text-sm text-slate-400">请选择上方 Agent 查看生产进度</div>}
                  </div>
                </div>
                <aside className="space-y-5">
                  {!viewGoalId && pendingApproval && approvalTask && (
                    <section id="delivery-approval" className="scroll-mt-6">
                      <AgentDecisionCard
                        kind={approvalDecisionKind}
                        title={approvalTask.title}
                        summary={pendingApproval.action_summary}
                        cost={approvalBudget !== undefined ? `本周预算 ¥${approvalBudget.toFixed(2)}` : "等待预算分配"}
                        outputs={{
                          count: approvalOutputCount,
                          format: approvalDecisionKind === "customer_outreach" ? "逐客消息" : approvalDecisionKind === "publish_confirmation" ? "平台发布" : "内容成品",
                          duration: data.plan?.businessPackage?.operatingContext?.outputs.totalDurationSeconds
                            ? `${data.plan.businessPackage.operatingContext.outputs.totalDurationSeconds} 秒`
                            : undefined,
                        }}
                        facts={[{ label: "计划版本", value: data.plan?.businessPackage ? `v${data.plan.businessPackage.revision}` : "当前任务" }, { label: "授权", value: data.plan?.businessPackage?.operatingContext?.authorization.mode === "bounded" ? "本周范围授权" : "逐次确认" }]}
                        note={approvalNote}
                        onNoteChange={setApprovalNote}
                        primary={{ label: "批准并继续", disabled: Boolean(busy), onClick: () => void act("approve", () => digitalEmployeeApi.decideApproval(pendingApproval.id, "approved", approvalNote)) }}
                        secondary={{ label: "退回修改", disabled: Boolean(busy), onClick: () => void act("reject", () => digitalEmployeeApi.decideApproval(pendingApproval.id, "rejected", approvalNote)) }}
                        tertiary={{ label: "人工完整接管", disabled: Boolean(busy), onClick: () => void act("handoff", () => digitalEmployeeApi.handoffTask(approvalTask.id)) }}
                      >
                      {approvalTask.task_key === "followup_batch_approval" && <div className="mt-3 max-h-80 space-y-2 overflow-auto rounded-lg border border-amber-200 bg-white p-3"><p className="text-xs font-bold text-amber-900">本次审批覆盖整个批次，请核对以下逐客草稿</p>{(data.deliveries || []).filter(card => card.kind === "客服草稿" && card.taskIds.includes(approvalTask.id)).map(card => <details key={card.id} className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-bold text-slate-800">{card.subject} · {card.stage}</summary><p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-600">{card.artifacts.find(artifact => artifact.id === "draft")?.text || "草稿尚未就绪"}</p>{card.reason && <p className="mt-2 text-xs text-amber-700">{card.reason}</p>}</details>)}</div>}
                      {pendingPublishingPackage && Array.isArray(pendingPublishingPackage.items) && <div className="mt-3 max-h-72 space-y-2 overflow-auto rounded-lg border border-amber-200 bg-white p-2">{(pendingPublishingPackage.items as Array<Record<string, unknown>>).map((item,index)=><div key={`${String(item.sourceProjectId)}-${String(item.platform)}-${index}`} className="rounded-lg bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-900">{String(item.title||`发布项 ${index+1}`)}</p><span className="rounded-md bg-blue-50 px-2 py-1 text-[9px] font-bold text-blue-700">{contentPlatformLabel[String(item.platform) as ContentPlatform]||String(item.platform)}</span></div><dl className="mt-2 grid gap-1 text-[10px] text-slate-600"><div><dt className="inline font-bold">账号：</dt><dd className="inline">{Array.isArray(item.accountLabels)?item.accountLabels.map(String).join("、"):"未绑定"}</dd></div><div><dt className="inline font-bold">文案：</dt><dd className="inline line-clamp-2">{String(item.description||"暂无文案")}</dd></div><div><dt className="inline font-bold">成片：</dt><dd className="inline break-all">{String(item.videoPath||"缺失")}</dd></div><div><dt className="inline font-bold">时间：</dt><dd className="inline">{String(item.scheduledAt||"")}</dd></div></dl></div>)}</div>}
                      </AgentDecisionCard>
                    </section>
                  )}
                  {!viewGoalId && activeHandoff && activeHandoffTask && (
                    <section className="rounded-lg border border-violet-200 bg-violet-50 p-5">
                      <div className="flex items-center gap-2 text-violet-800">
                        <Hand size={19} />
                        <h2 className="font-bold">人工接管中</h2>
                      </div>
                      <p className="mt-3 text-sm font-bold">
                        {activeHandoffTask.title}
                      </p>
                      <Button
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void act("return", () =>
                            digitalEmployeeApi.returnTask(
                              activeHandoffTask.id,
                              "人工核对完成，保持原审批边界继续",
                            ),
                          )
                        }
                        className="!h-auto min-h-9 !whitespace-normal mt-4 w-full rounded-lg bg-violet-700 px-3 py-2.5 text-xs font-bold text-white"
                      >
                        交还数字员工
                      </Button>
                    </section>
                  )}
                  {data.run && !terminal && !viewGoalId && (
                    <section className="rounded-lg border border-slate-200 bg-white p-5">
                      <div className="flex items-center gap-2">
                        <Clock3 size={18} />
                        <h2 className="font-bold">运行控制</h2>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        {data.run.status === "paused" ? (
                          <Button
                            onClick={() =>
                              void act("resume", () =>
                                digitalEmployeeApi.resumeRun(data.run!.id),
                              )
                            }
                            className="!h-auto min-h-9 !whitespace-normal rounded-lg bg-blue-700 px-3 py-2.5 text-xs font-bold text-white"
                          >
                            恢复
                          </Button>
                        ) : (
                          <Button
                            onClick={() =>
                              void act("pause", () =>
                                digitalEmployeeApi.pauseRun(data.run!.id),
                              )
                            }
                            className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-bold"
                          >
                            暂停
                          </Button>
                        )}
                        <Button
                          onClick={() =>
                            void act("cancel", () =>
                              digitalEmployeeApi.cancelRun(data.run!.id),
                            )
                          }
                          className="!h-auto min-h-9 !whitespace-normal rounded-lg border border-red-200 px-3 py-2.5 text-xs font-bold text-red-700"
                        >
                          取消
                        </Button>
                      </div>
                    </section>
                  )}
                </aside>
              </div>
              </>
            )}
            {data.run && businessLine === "customer_conversion" && <BatchFollowupTruthPanel
              data={data}
              onOpen={openBusiness}
              busy={busy === "dispatch-followup"}
              onDispatch={
                viewGoalId
                  ? undefined
                  : (batchId) =>
                      void act("dispatch-followup", () =>
                        digitalEmployeeApi.dispatchFollowupBatch(batchId),
                      )
              }
            />}
          </div>
        )}

        {data?.config && workspaceView === "review" && (
          <div className="mt-5">
            <WeeklyReviewPanel
              data={presentedData || data}
              onGoLive={goLive}
              onOpen={openBusiness}
              onHistory={() => { setShowHistory(true); setWorkspaceView("today"); }}
              onGoal={goalId => { setViewGoalId(""); setWorkspaceView("live"); void load(goalId); }}
              period={productionPeriod}
              onPeriodChange={changeOverviewPeriod}
              rangeBusy={busy === "overview-range"}
            />
          </div>
        )}

        {data?.config && workspaceView === "rules" && (
          <div className="mt-5 space-y-5">
            <OnboardingPanel
              initial={data.config}
              readiness={data.businessSnapshot?.readiness || []}
              busy={Boolean(busy)}
              mode="rules"
              activeRun={activeRun}
              onOpenReadiness={openReadiness}
              onNavigate={(page) => openBusiness(page)}
              onSave={(config) => void saveConfig(config)}
            />
            <section className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <ShieldCheck size={19} className="text-amber-600" />
                <h2 className="font-semibold text-slate-950">规则生效说明</h2>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-800">仅本次纠偏</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    只影响当前运行，可选择重跑下游。
                  </p>
                </div>
                <div className="rounded-lg bg-violet-50 p-4">
                  <p className="text-xs font-bold text-violet-800">
                    长期规则候选
                  </p>
                  <p className="mt-1 text-[11px] text-violet-700">
                    先记录候选，审核通过前不会改变自动化规则。
                  </p>
                </div>
                <div className="rounded-lg bg-amber-50 p-4">
                  <p className="text-xs font-bold text-amber-800">
                    外部动作红线
                  </p>
                  <p className="mt-1 text-[11px] text-amber-700">
                    发布、整批跟进和商业承诺按上方审批策略执行。
                  </p>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
