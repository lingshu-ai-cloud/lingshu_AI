import DeliveryBoard from "./DeliveryBoard";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  BrainCircuit,
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
  Plus,
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
import { heuristicProductMapping, mapRowToProduct, parseWorkbook, prepareSheet } from "../lib/productImport";
import {
  buildTaskDeepLink,
  agentCursorPercent,
  agentUiActionFromEvent,
  consumeDigitalEmployeeReturnContext,
  digitalEmployeeConfigFingerprint,
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
  companyName: "",
  industry: "",
  primaryBusiness: "",
  targetMarkets: "",
  customerProfile: "",
  autonomyMode: "managed",
  approvalOwner: "",
  constraints: [
    "禁止未经确认的价格、交期和效果承诺",
    "所有真实对外发布必须人工审批",
  ],
  team: ["planner", "knowledge", "content", "risk", "customer", "review"],
  primaryGoal: "leads",
  focusProducts: "",
  enabledWorkflows: [
    "scheduled_social",
    "viral_clone",
    "product_content",
    "content_publish",
    "customer_segmentation",
    "batch_followup",
  ],
  socialCadence: "YouTube、TikTok、Instagram、Facebook；公开行业关键词与已确认对标账号；近 7 天；每天 09:00；每次最多 20 条；按链接与标题去重 30 天；每周生成 5 条发布草稿，发布前人工审批",
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
  { id: "product_content", label: "使用产品生成", detail: "引用重点产品事实" },
  { id: "material_content", label: "使用素材生成", detail: "复用企业已有素材" },
  {
    id: "content_publish",
    label: "内容发布",
    detail: "审批后进入发布日历",
    dependency: "依赖至少一种内容生成方式",
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

const workflowLabel = Object.fromEntries(
  workflowOptions.map((option) => [option.id, option.label]),
) as Record<DigitalEmployeeWorkflow, string>;
const contentCreationWorkflows: DigitalEmployeeWorkflow[] = [
  "viral_clone",
  "product_content",
  "material_content",
];

const agentRoleGroups: Array<{
  id: "business" | "industry" | "content" | "customer";
  label: string;
  responsibility: string;
  outputs: string;
  workflows: DigitalEmployeeWorkflow[];
}> = [
  { id: "business", label: "经营 Agent", responsibility: "拆解经营目标、协调其他 Agent、汇总业务结果并完成周复盘", outputs: "周目标、执行计划、风险提醒、复盘报告", workflows: [] },
  { id: "industry", label: "行业 Agent", responsibility: "跟踪目标市场、行业趋势、关键词和对标账号的公开内容", outputs: "行业情报、采集结果、趋势与选题依据", workflows: ["scheduled_social"] },
  { id: "content", label: "内容 Agent", responsibility: "基于真实产品、企业素材和爆款证据生成内容，并进入审批发布流程", outputs: "脚本、素材方案、成片草稿、发布排期", workflows: ["viral_clone", "product_content", "material_content", "content_publish"] },
  { id: "customer", label: "客服 Agent", responsibility: "承接真实询盘、完成客户分层，并按客户上下文生成跟进草稿", outputs: "客户标签、回复草稿、跟进批次、转人工提醒", workflows: ["customer_segmentation", "batch_followup"] },
];

const agentApprovalOptions = [
  { role: "business", label: "经营 Agent", tone: "violet", items: [
    { key: "activatePlan", label: "启动或调整经营计划", detail: "目标、指标、周期发生变化时必须审批" },
    { key: "changeGoalScope", label: "扩大经营范围", detail: "新增市场、产品或客户范围时必须审批" },
  ] },
  { role: "industry", label: "行业 Agent", tone: "blue", items: [
    { key: "addUnverifiedSource", label: "采用未验证信息源", detail: "新增来源必须先确认可信度与合规性" },
    { key: "expandCollectionScope", label: "扩大采集范围", detail: "新增平台、账号、关键词或采集规模时必须审批" },
  ] },
  { role: "content", label: "内容 Agent", tone: "emerald", items: [
    { key: "contentPublish", label: "真实平台发布", detail: "作品完成不等于已发布，发布前必须审批", locked: true },
    { key: "factualClaims", label: "新增事实与效果宣称", detail: "知识库没有证据的参数、认证和效果必须审批" },
  ] },
  { role: "customer", label: "客服 Agent", tone: "amber", items: [
    { key: "batchFollowup", label: "整批客户跟进", detail: "先逐客生成草稿，再由负责人整批批准", locked: true },
    { key: "commercialCommitment", label: "商业承诺", detail: "价格、折扣、交期、付款和售后必须逐条审批", locked: true },
  ] },
] as const;

const destinationLabel: Record<BusinessDestination, string> = {
  enterprise: "企业资料",
  accountManagement: "社媒账号",
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
  "studio.mode_routing": "选择内容生产路径",
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
  "content.routing": "选择内容生成方式",
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
  business: "经营 Agent",
  planner: "经营 Agent",
  knowledge: "经营 Agent",
  review: "经营 Agent",
  industry: "行业 Agent",
  channel: "行业 Agent",
  content: "内容 Agent",
  risk: "内容 Agent",
  publishing: "内容 Agent",
  customer: "客服 Agent",
};

const autonomyLabel: Record<string, string> = {
  suggest: "建议",
  collaborate: "协同",
  managed: "托管",
  automatic: "自动",
};

function Badge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone[status] || "border-slate-200 bg-white text-slate-600"}`}
    >
      {statusLabel[status] || "状态待确认"}
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
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

type EnterpriseProductOption = {
  id: string;
  value: string;
  meta: string;
};

const splitSelectedProducts = (value: string) =>
  [...new Set(value.split(/[、,，;；\n]/).map((item) => item.trim()).filter(Boolean))];

function EnterpriseProductMultiSelect({
  value,
  onChange,
  required,
  onOpenKnowledge,
}: {
  value: string;
  onChange: (value: string) => void;
  required: boolean;
  onOpenKnowledge: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<EnterpriseProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => splitSelectedProducts(value), [value]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/overseas/enterprise/profile", {
      headers: authHeader(),
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`企业知识库读取失败（${response.status}）`);
        return response.json() as Promise<{
          products?: {
            categories?: string;
            items?: Array<{ id?: string; sku?: string; name?: string; category?: string; attributes?: Record<string, unknown> }>;
          };
        }>;
      })
      .then((profile) => {
        if (cancelled) return;
        const items = Array.isArray(profile.products?.items) ? profile.products.items : [];
        const next = items
          .map((item, index) => {
            const name = String(item.name || "").trim();
            const sku = String(item.sku || item.attributes?.model || "").trim();
            const category = String(item.category || "").trim();
            return name
              ? { id: String(item.id || item.sku || `${name}-${index}`), value: name, meta: [sku, category].filter(Boolean).join(" · ") }
              : null;
          })
          .filter((item): item is EnterpriseProductOption => Boolean(item));
        setOptions(next);
        setLoadError("");
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "企业知识库读取失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const toggle = (product: string) => {
    const next = selected.includes(product)
      ? selected.filter((item) => item !== product)
      : [...selected, product];
    onChange(next.join("、"));
  };
  const filtered = options.filter((option) =>
    `${option.value} ${option.meta}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`${inputClass} flex min-h-[46px] items-center justify-between gap-3 text-left`}
      >
        <span className={selected.length ? "flex min-w-0 flex-1 flex-wrap gap-1.5" : "text-slate-400"}>
          {selected.length
            ? selected.map((product) => (
              <span key={product} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
                <span className="truncate">{product}</span>
                <span
                  role="button"
                  aria-label={`移除${product}`}
                  tabIndex={0}
                  onClick={(event) => { event.stopPropagation(); toggle(product); }}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); toggle(product); } }}
                  className="rounded p-0.5 hover:bg-emerald-100"
                ><X size={11} /></span>
              </span>
            ))
            : loading ? "正在读取企业知识库产品…" : required ? "从企业知识库选择重点产品（可多选）" : "选择重点产品（可多选）"}
        </span>
        <ChevronDown size={16} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2">
            <Search size={14} className="text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs outline-none" placeholder="搜索企业知识库产品或型号" />
          </label>
          <div role="listbox" aria-label="企业知识库产品" aria-multiselectable="true" className="mt-2 max-h-60 overflow-y-auto">
            {loading && <p className="px-3 py-5 text-center text-xs text-slate-400">正在读取产品…</p>}
            {!loading && loadError && <p className="px-3 py-3 text-xs text-red-600">{loadError}</p>}
            {!loading && !loadError && filtered.map((option) => {
              const checked = selected.includes(option.value);
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggle(option.value)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${checked ? "bg-emerald-50" : "hover:bg-slate-50"}`}
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300"}`}>{checked && <Check size={11} />}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-slate-800">{option.value}</span>{option.meta && <span className="mt-0.5 block truncate text-[10px] text-slate-400">{option.meta}</span>}</span>
                </button>
              );
            })}
            {!loading && !loadError && !filtered.length && <div className="px-3 py-4 text-center"><p className="text-xs text-slate-500">{options.length ? "没有匹配的产品" : "企业知识库暂未录入产品"}</p><button type="button" onClick={onOpenKnowledge} className="mt-2 text-xs font-bold text-emerald-700">去企业知识库添加产品</button></div>}
          </div>
          {!!selected.length && <div className="mt-2 flex items-center justify-between border-t border-slate-100 px-2 pt-2"><span className="text-[10px] text-slate-400">已选择 {selected.length} 项</span><button type="button" onClick={() => onChange("")} className="text-[10px] font-bold text-slate-600">清空</button></div>}
        </div>
      )}
    </div>
  );
}

function completeConfig(initial: DigitalEmployeeConfig): DigitalEmployeeConfig {
  return {
    ...EMPTY_CONFIG,
    ...initial,
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
  };
}

function configErrors(form: DigitalEmployeeConfig): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, label] of [
    ["companyName", "企业名称"],
    ["industry", "行业"],
    ["primaryBusiness", "主要业务"],
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
    errors.enabledWorkflows = "内容发布前至少启用一种内容生成方式";
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
    form.enabledWorkflows.includes("content_publish") &&
    !form.publishingTargets.length
  )
    errors.publishingTargets = "请至少选择一个已连接的发布账号";
  if (
    form.enabledWorkflows.includes("batch_followup") &&
    !form.approvalPolicy.batchFollowup
  )
    errors.batchFollowup = "整批客户跟进必须保留人工审批";
  return errors;
}

function OnboardingPanel({
  initial,
  readiness,
  busy,
  mode = "first",
  activeRun = false,
  onSave,
  onOpenReadiness,
}: {
  initial: DigitalEmployeeConfig;
  readiness: BusinessReadinessItem[];
  busy: boolean;
  mode?: "first" | "rules";
  activeRun?: boolean;
  onSave: (config: DigitalEmployeeConfig) => void;
  onOpenReadiness: (item: BusinessReadinessItem) => void;
}) {
  const [form, setForm] = useState(() => completeConfig(initial));
  const [dependencyNotice, setDependencyNotice] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [collectionPlatforms, setCollectionPlatforms] = useState("YouTube、TikTok、Instagram、Facebook");
  const [collectionSources, setCollectionSources] = useState("公开行业关键词、已确认的对标账号");
  const [collectionKeywords, setCollectionKeywords] = useState("");
  const [collectionLookback, setCollectionLookback] = useState(7);
  const [collectionLimit, setCollectionLimit] = useState(20);
  const [collectionTime, setCollectionTime] = useState("每天 09:00");
  const [publishCount, setPublishCount] = useState(5);
  const [connectedPublishingAccounts, setConnectedPublishingAccounts] = useState<PublishingTarget[]>([]);
  const [publishingAccountsLoading, setPublishingAccountsLoading] = useState(true);
  const [publishingAccountsError, setPublishingAccountsError] = useState("");
  const [followupGenerateAt, setFollowupGenerateAt] = useState("每周五 09:00");
  const [followupApproveBy, setFollowupApproveBy] = useState("周五 17:00 前");
  const [followupWindow, setFollowupWindow] = useState("客户当地工作日 09:00–18:00");
  const [followupFrequency, setFollowupFrequency] = useState("同一客户 7 天最多 1 次");
  const [reviewTimezone, setReviewTimezone] = useState("Asia/Shanghai（北京时间）");
  const [reviewCutoff, setReviewCutoff] = useState("周五 17:00");
  const [recommendationApplied, setRecommendationApplied] = useState(false);
  const [profileLoading, setProfileLoading] = useState(mode === "first");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileConfirmed, setProfileConfirmed] = useState(mode !== "first");
  const [knowledgeProducts, setKnowledgeProducts] = useState<Array<Record<string, any>>>([]);
  const [productsLoading, setProductsLoading] = useState(mode === "first");
  const [productStepSaved, setProductStepSaved] = useState(false);
  const [activeRuleAgent, setActiveRuleAgent] = useState<"business" | "industry" | "content" | "customer">("business");
  const activeAgentDefinition = agentRoleGroups.find((agent) => agent.id === activeRuleAgent)!;
  const [productSaving, setProductSaving] = useState(false);
  const [productError, setProductError] = useState("");
  const [quickProductOpen, setQuickProductOpen] = useState(false);
  const [quickProduct, setQuickProduct] = useState({ name: "", category: "", description: "", targetCustomer: "", highlights: "" });
  const [recommendedProducts, setRecommendedProducts] = useState<string[]>([]);
  const [productImporting, setProductImporting] = useState(false);
  const [productImportMessage, setProductImportMessage] = useState("");
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
        setPublishingAccountsError("");
      })
      .catch(error => {
        if (!cancelled) setPublishingAccountsError(error instanceof Error ? error.message : "发布账号读取失败");
      })
      .finally(() => { if (!cancelled) setPublishingAccountsLoading(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (mode !== "first") return;
    let cancelled = false;
    setProfileLoading(true);
    fetch("/api/overseas/enterprise/profile", { headers: authHeader() })
      .then(async (response) => {
        if (!response.ok) throw new Error("企业知识库读取失败");
        return response.json() as Promise<Record<string, any>>;
      })
      .then((profile) => {
        if (cancelled) return;
        const loadedProfile = {
          companyName: String(profile.company?.name || ""),
          industry: String(profile.company?.industry || ""),
          primaryBusiness: String(profile.company?.description || ""),
          targetMarkets: String(profile.company?.mainMarkets || ""),
          customerProfile: String(profile.customers?.targetProfiles || ""),
        };
        setForm((current) => ({
          ...current,
          companyName: loadedProfile.companyName || current.companyName,
          industry: loadedProfile.industry || current.industry,
          primaryBusiness: loadedProfile.primaryBusiness || current.primaryBusiness,
          targetMarkets: loadedProfile.targetMarkets || current.targetMarkets,
          customerProfile: loadedProfile.customerProfile || current.customerProfile,
          focusProducts: String(profile.strategy?.focusProducts || current.focusProducts),
        }));
        setKnowledgeProducts(Array.isArray(profile.products?.items) ? profile.products.items : []);
        // Progress is persisted with the tenant profile so a refresh, HMR remount,
        // or a late overview response cannot throw the user back to step one.
        // Only promote local progress here; never regress a step from a stale GET.
        if (profile.digitalEmployeeOnboarding?.profileConfirmedAt) setProfileConfirmed(true);
        if (profile.digitalEmployeeOnboarding?.productSelectionConfirmedAt) setProductStepSaved(true);
        setProductsLoading(false);
        setProfileError("");
      })
      .catch((error) => {
        if (!cancelled) setProfileError(error instanceof Error ? error.message : "企业知识库读取失败");
      })
      .finally(() => {
        if (!cancelled) { setProfileLoading(false); setProductsLoading(false); }
      });
    return () => { cancelled = true; };
  }, [mode]);
  const errors = configErrors(form);
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
    contentPublish: "内容发布审批红线",
    batchFollowup: "批量跟进审批红线",
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
      window.setTimeout(() => document.getElementById("onboarding-enterprise-profile")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      return;
    }
    if (firstKey === "focusProducts") {
      setProductStepSaved(false);
      setSubmitted(false);
      window.setTimeout(() => document.getElementById("onboarding-focus-products")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      return;
    }
    const targetAgent = ["contentPublish", "publishingTargets"].includes(firstKey) ? "content" : ["batchFollowup", "followupCadence"].includes(firstKey) ? "customer" : firstKey === "socialCadence" ? "industry" : "business";
    setActiveRuleAgent(targetAgent);
    window.setTimeout(() => {
      const selector = firstKey === "approvalOwner" ? 'input[placeholder="姓名或岗位"]' : `[aria-invalid="true"]`;
      const target = document.querySelector<HTMLElement>(selector);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
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
    if (
      workflow === "content_publish" &&
      !current.some((item) => contentCreationWorkflows.includes(item))
    )
      additions.unshift("product_content");
    set("enabledWorkflows", [...new Set([...current, ...additions])]);
    setDependencyNotice(
      additions.length > 1
        ? `已同时启用前置工作流：${additions
            .slice(0, -1)
            .map((item) => workflowLabel[item])
            .join("、")}。`
        : "",
    );
  };
  const setAgentApproval = (role: keyof DigitalEmployeeConfig["agentApprovalPolicies"], key: string, value: boolean) => {
    setForm((current) => {
      const agentApprovalPolicies = { ...current.agentApprovalPolicies, [role]: { ...current.agentApprovalPolicies[role], [key]: value } };
      const approvalPolicy = { ...current.approvalPolicy };
      if (role === "content" && key === "contentPublish") approvalPolicy.contentPublish = value;
      if (role === "customer" && key === "batchFollowup") approvalPolicy.batchFollowup = value;
      if (role === "customer" && key === "commercialCommitment") approvalPolicy.commercialCommitment = value;
      return { ...current, agentApprovalPolicies, approvalPolicy };
    });
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
    ["行业", form.industry],
    ["主要业务", form.primaryBusiness],
    ["目标市场", form.targetMarkets],
    ["核心客户", form.customerProfile],
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
          company: { name: form.companyName, industry: form.industry, description: form.primaryBusiness, mainMarkets: form.targetMarkets },
          strategy: { focusMarkets: form.targetMarkets },
          customers: { targetProfiles: form.customerProfile },
          digitalEmployeeOnboarding: { profileConfirmedAt: new Date().toISOString() },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "企业档案保存失败");
      setProfileConfirmed(true);
      // Knowledge-base focus products may be prefilled, but the user must still
      // explicitly review and confirm them during a new onboarding run.
      setProductStepSaved(false);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "企业档案保存失败");
    } finally {
      setProfileSaving(false);
    }
  };
  const productName = (product: Record<string, any>) => String(product.name || product.title || product.productName || "").trim();
  const selectedProductNames = splitSelectedProducts(form.focusProducts);
  const toggleFocusProduct = (name: string) => {
    const next = selectedProductNames.includes(name) ? selectedProductNames.filter((item) => item !== name) : [...selectedProductNames, name];
    set("focusProducts", next.join("、"));
    setProductStepSaved(false);
  };
  const recommendProducts = () => {
    const scored = knowledgeProducts
      .map((product) => ({ product, score: [product.description, product.highlights, product.targetCustomer, product.images?.length, product.sku, product.category].filter(Boolean).length }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(3, knowledgeProducts.length));
    const names = scored.map(({ product }) => productName(product)).filter(Boolean);
    setRecommendedProducts(names);
    set("focusProducts", names.join("、"));
    setProductStepSaved(false);
  };
  const addQuickProduct = async () => {
    if (!quickProduct.name.trim() || !quickProduct.category.trim() || productSaving) return;
    setProductSaving(true); setProductError("");
    try {
      const product = { id: `product-${Date.now()}`, name: quickProduct.name.trim(), category: quickProduct.category.trim(), description: quickProduct.description.trim(), targetCustomer: quickProduct.targetCustomer.trim(), highlights: quickProduct.highlights.trim(), source: "digital_employee_onboarding" };
      const items = [...knowledgeProducts, product];
      const response = await fetch("/api/overseas/enterprise/profile", { method: "PATCH", headers: { "Content-Type": "application/json", "x-enterprise-save-source": "diagnosis", ...authHeader() }, body: JSON.stringify({ products: { items } }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "产品保存失败");
      setKnowledgeProducts(items); set("focusProducts", [...selectedProductNames, product.name].join("、")); setQuickProduct({ name: "", category: "", description: "", targetCustomer: "", highlights: "" }); setQuickProductOpen(false);
    } catch (error) { setProductError(error instanceof Error ? error.message : "产品保存失败"); }
    finally { setProductSaving(false); }
  };
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
        if (existingIndex >= 0) next[existingIndex] = { ...next[existingIndex], ...product };
        else next.push(product);
      }
      const response = await fetch("/api/overseas/enterprise/profile", { method: "PATCH", headers: { "Content-Type": "application/json", "x-enterprise-save-source": "diagnosis", ...authHeader() }, body: JSON.stringify({ products: { items: next } }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "产品资料写入企业知识库失败");
      setKnowledgeProducts(next);
      setProductImportMessage(`已从“${file.name}”识别并写入 ${decoded.length} 个产品；现在可以生成 AI 推荐。`);
    } catch (error) { setProductError(error instanceof Error ? error.message : "产品文件解析失败"); }
    finally { setProductImporting(false); }
  };
  const saveFocusProducts = async () => {
    if (!selectedProductNames.length || productSaving) return;
    setProductSaving(true); setProductError("");
    try {
      const response = await fetch("/api/overseas/enterprise/profile", { method: "PATCH", headers: { "Content-Type": "application/json", "x-enterprise-save-source": "diagnosis", ...authHeader() }, body: JSON.stringify({ strategy: { focusProducts: form.focusProducts }, digitalEmployeeOnboarding: { productSelectionConfirmedAt: new Date().toISOString(), continuedWithoutProducts: false } }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "重点产品保存失败");
      setProductStepSaved(true);
    } catch (error) { setProductError(error instanceof Error ? error.message : "重点产品保存失败"); }
    finally { setProductSaving(false); }
  };
  const continueWithoutProducts = async () => {
    if (productSaving) return;
    setProductSaving(true); setProductError("");
    try {
      const response = await fetch("/api/overseas/enterprise/profile", { method: "PATCH", headers: { "Content-Type": "application/json", "x-enterprise-save-source": "diagnosis", ...authHeader() }, body: JSON.stringify({ strategy: { focusProducts: "" }, digitalEmployeeOnboarding: { productSelectionConfirmedAt: new Date().toISOString(), continuedWithoutProducts: true } }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "无产品状态保存失败");
      set("focusProducts", "");
      setProductStepSaved(true);
    } catch (error) { setProductError(error instanceof Error ? error.message : "无产品状态保存失败"); }
    finally { setProductSaving(false); }
  };
  const submit = () => {
    setSubmitted(true);
    if (Object.keys(errors).length) return;
    const completed = {
      ...form,
      team: ["planner", "knowledge", "risk", "review", ...(form.enabledWorkflows.some((item) => contentCreationWorkflows.includes(item)) ? ["content"] : []), ...(form.enabledWorkflows.some((item) => ["customer_segmentation", "batch_followup"].includes(item)) ? ["customer"] : [])],
      socialCadence: `${collectionPlatforms}；${collectionSources}；关键词：${collectionKeywords || form.focusProducts || form.primaryBusiness}；近 ${collectionLookback} 天；${collectionTime}；每次最多 ${collectionLimit} 条；按链接与标题去重 30 天；每周生成 ${publishCount} 条发布草稿；账号范围：${form.publishingTargets.map(target => `${target.platform}/${target.accountLabel}`).join("、") || "未确认"}；发布前人工审批`,
      followupCadence: `${followupGenerateAt}生成分层跟进草稿；${followupApproveBy}审批；${followupWindow}发送；${followupFrequency}`,
      reviewSchedule: `周五 17:30（${reviewTimezone}）；数据截止 ${reviewCutoff}；通知审批负责人；仅生成复盘和下周任务草稿`,
    };
    onSave(completed);
  };
  if (mode === "first" && !profileConfirmed) return (
    <section id="onboarding-enterprise-profile" className="scroll-mt-24 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3"><div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700"><Settings2 size={22} /></div><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">第一步 · 建立企业档案</p><h2 className="mt-1 text-xl font-bold text-slate-950">告诉数字员工，你是谁、卖什么、卖给谁</h2><p className="mt-1 text-sm text-slate-500">这里只建档一次。保存后同步到企业知识库，后续统一在企业知识库维护，经营驾驶舱直接读取。</p></div></div>
        <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-[10px] font-bold text-slate-500">企业知识库 · 唯一数据源</span>
      </div>
      {profileLoading ? <div role="status" className="mt-6 flex items-center gap-2 rounded-2xl bg-slate-50 p-5 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />正在读取企业知识库已有档案…</div> : <>
        <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs leading-relaxed text-blue-800">如果企业知识库已有资料，系统会自动带入；你在这里修改并保存后，两处会保持一致，不需要重复填写。</div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label="企业名称" required><input className={inputClass} value={form.companyName} onChange={e=>set("companyName",e.target.value)} placeholder="例如：灵枢科技" /></Field>
          <Field label="所属行业" required><input className={inputClass} value={form.industry} onChange={e=>set("industry",e.target.value)} placeholder="例如：智能制造" /></Field>
          <Field label="主要业务" required wide><textarea className={`${inputClass} min-h-24 resize-y`} value={form.primaryBusiness} onChange={e=>set("primaryBusiness",e.target.value)} placeholder="主要产品、服务和核心能力；不需要在这里填写详细产品参数" /></Field>
          <Field label="目标市场" required><input className={inputClass} value={form.targetMarkets} onChange={e=>set("targetMarkets",e.target.value)} placeholder="国家或地区，例如：美国、德国" /></Field>
          <Field label="核心客户" required><input className={inputClass} value={form.customerProfile} onChange={e=>set("customerProfile",e.target.value)} placeholder="客户类型、决策角色和主要需求" /></Field>
        </div>
        <div className="mt-5 rounded-2xl border border-slate-200 p-4"><p className="text-xs font-bold text-slate-800">保存后写入企业知识库</p><div className="mt-2 grid gap-2 text-[11px] text-slate-500 sm:grid-cols-3"><span>企业档案：名称、行业、业务介绍</span><span>市场档案：目标国家与地区</span><span>客户档案：核心客户画像</span></div></div>
        {profileError && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-xs text-red-700">{profileError}</p>}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-xs text-amber-700">{missingProfileFields.length ? `还需填写：${missingProfileFields.join("、")}` : "企业基础资料已完整，可以保存。"}</p><button type="button" disabled={Boolean(missingProfileFields.length) || profileSaving} onClick={()=>void saveEnterpriseProfile()} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">{profileSaving ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}保存企业档案</button></div>
      </>}
    </section>
  );
  if (mode === "first" && profileConfirmed && !productStepSaved) return (
    <section id="onboarding-focus-products" className="scroll-mt-24 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><div className="rounded-2xl bg-blue-50 p-3 text-blue-700"><Target size={22} /></div><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">第二步 · 确认重点产品</p><h2 className="mt-1 text-xl font-bold text-slate-950">本阶段希望数字员工重点经营什么</h2><p className="mt-1 text-sm text-slate-500">产品资料来自企业知识库；这里只选择本期重点，不重复维护详细参数。</p></div></div><span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-bold text-emerald-700">第一步企业档案已完成</span></div>
      {productsLoading ? <div role="status" className="mt-6 flex items-center gap-2 rounded-2xl bg-slate-50 p-5 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />正在读取企业知识库产品…</div> : <>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-bold text-slate-900">企业知识库产品</p><p className="mt-1 text-xs text-slate-500">可以多选；AI 推荐只会从真实产品中选择，不会虚构产品。</p></div><div className="flex flex-wrap gap-2"><label className={`inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700 ${productImporting?"cursor-wait opacity-60":"cursor-pointer hover:bg-slate-50"}`}>{productImporting?<Loader2 size={14} className="animate-spin"/>:<FileSpreadsheet size={14}/>}上传产品资料<input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={productImporting} onChange={e=>{void importProductFile(e.currentTarget.files?.[0]??null);e.currentTarget.value="";}} /></label><button type="button" onClick={()=>setQuickProductOpen(value=>!value)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700"><Plus size={14} />{quickProductOpen ? "收起快速添加" : "快速添加产品"}</button><button type="button" disabled={!knowledgeProducts.length||productImporting} onClick={recommendProducts} className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"><Sparkles size={14} />AI 推荐重点产品</button></div></div>
        <p className="mt-2 text-[11px] text-slate-500">支持 Excel（.xlsx/.xls）和 CSV。系统自动识别产品名称、SKU、规格、价格、MOQ、材质、图片链接和卖点，并直接写入企业知识库。</p>
        {productImportMessage&&<p role="status" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">{productImportMessage}</p>}
        {quickProductOpen && <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-4"><p className="text-sm font-bold text-slate-900">快速添加到企业知识库</p><p className="mt-1 text-xs text-slate-500">只填写建档所需的最少信息，详细参数以后在企业知识库完善。</p><div className="mt-3 grid gap-3 md:grid-cols-2"><Field label="产品名称" required><input className={inputClass} value={quickProduct.name} onChange={e=>setQuickProduct({...quickProduct,name:e.target.value})} /></Field><Field label="产品类别" required><input className={inputClass} value={quickProduct.category} onChange={e=>setQuickProduct({...quickProduct,category:e.target.value})} /></Field><Field label="一句话用途"><input className={inputClass} value={quickProduct.description} onChange={e=>setQuickProduct({...quickProduct,description:e.target.value})} /></Field><Field label="目标客户"><input className={inputClass} value={quickProduct.targetCustomer} onChange={e=>setQuickProduct({...quickProduct,targetCustomer:e.target.value})} /></Field><Field label="核心特点" wide><input className={inputClass} value={quickProduct.highlights} onChange={e=>setQuickProduct({...quickProduct,highlights:e.target.value})} /></Field></div><div className="mt-3 flex justify-end"><button type="button" disabled={!quickProduct.name.trim() || !quickProduct.category.trim() || productSaving} onClick={()=>void addQuickProduct()} className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-bold text-white disabled:bg-slate-300">添加并选中</button></div></div>}
        {!knowledgeProducts.length ? <div className="mt-4 rounded-2xl border border-dashed border-slate-300 p-8 text-center"><p className="font-bold text-slate-800">企业知识库尚未录入产品</p><p className="mt-2 text-xs text-slate-500">可以上传或快速建档；也可以先继续配置。系统不会虚构产品，产品内容分支会停在资料缺口，行业采集与入站客服仍可运行。</p></div> : <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">{knowledgeProducts.map((product,index)=>{const name=productName(product);const selected=selectedProductNames.includes(name);const recommended=recommendedProducts.includes(name);const details=[product.category,product.sku || product.attributes?.model].filter(Boolean).join(" · ");return <button key={String(product.id||`${name}-${index}`)} type="button" aria-pressed={selected} onClick={()=>toggleFocusProduct(name)} className={`rounded-2xl border p-4 text-left transition ${selected?"border-blue-400 bg-blue-50 ring-1 ring-blue-100":"border-slate-200 hover:border-slate-300"}`}><div className="flex items-start justify-between gap-2"><p className="font-bold text-slate-900">{name}</p>{selected&&<CheckCircle2 size={17} className="shrink-0 text-blue-700" />}</div><p className="mt-1 text-xs text-slate-500">{details||"暂无型号与类别"}</p><p className="mt-3 line-clamp-2 text-[11px] leading-relaxed text-slate-500">{product.description||product.highlights||"详细资料待在企业知识库补充"}</p>{recommended&&<p className="mt-3 rounded-lg bg-white px-2 py-1.5 text-[10px] text-blue-700">推荐理由：资料相对完整，并与 {form.targetMarkets}、{form.customerProfile} 匹配，建议优先验证。</p>}</button>})}</div>}
        {productError&&<p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-xs text-red-700">{productError}</p>}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-xs text-slate-500">{selectedProductNames.length?`已选择 ${selectedProductNames.length} 项：${selectedProductNames.join("、")}`:knowledgeProducts.length?"请选择本期重点产品，或确认本期暂不指定":"当前没有产品，可先继续；系统会保留清晰的资料缺口"}</p><div className="flex flex-wrap gap-2"><button type="button" disabled={productSaving} onClick={()=>void continueWithoutProducts()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 disabled:opacity-50"><ArrowRight size={14}/>本期暂无产品，先继续</button><button type="button" disabled={!selectedProductNames.length||productSaving} onClick={()=>void saveFocusProducts()} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">{productSaving?<Loader2 size={16} className="animate-spin"/>:<ArrowRight size={16}/>}确认重点产品</button></div></div>
      </>}
    </section>
  );
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
          <Settings2 size={22} />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
            {mode === "first" ? "第三步 · 配置本期经营规则" : "运行规则"}
          </p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">
            {mode === "first"
              ? "决定数字员工怎么运行、哪里必须停下来等人确认"
              : "维护后续运行的默认规则"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {activeRun
              ? "当前运行继续沿用已批准计划；这里保存的配置从下一轮计划生效，当前任务请在生产现场纠偏。"
              : mode === "first" ? "企业档案和本期产品状态已经确认；这里只设置执行节奏、工作流和审批红线。" : "确认经营目标、重点产品、工作流节奏和审批红线。数字员工只在已就绪的业务资产上执行。"}
          </p>
        </div>
      </div>
      <><div className="mt-4 grid gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1.5 sm:grid-cols-4">{agentRoleGroups.map((agent)=>{const active=activeRuleAgent===agent.id;const Icon=agent.id==="business"?BrainCircuit:agent.id==="industry"?Search:agent.id==="content"?Sparkles:MessageSquare;return <button key={agent.id} type="button" aria-pressed={active} onClick={()=>setActiveRuleAgent(agent.id)} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left transition ${active?"bg-slate-950 text-white shadow-sm":"bg-white text-slate-600 hover:bg-slate-100"}`}><Icon size={15}/><span><span className="block text-xs font-black">{agent.label}</span><span className={`block text-[9px] ${active?"text-slate-300":"text-slate-400"}`}>{agent.id==="business"?"目标与总控":agent.id==="industry"?"采集与情报":agent.id==="content"?"创作与发布":"客户与跟进"}</span></span></button>})}</div><div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3"><div><p className="text-sm font-black text-slate-900">{activeAgentDefinition.label}</p><p className="mt-0.5 text-[11px] text-slate-500">{activeAgentDefinition.responsibility}</p></div><p className="text-[10px] text-slate-400">主要产出：{activeAgentDefinition.outputs}</p></div></>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className={`${activeRuleAgent !== "industry" ? "hidden " : ""}md:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4`}>
          <div><p className="text-sm font-bold text-emerald-950">AI 推荐执行范围</p><p className="mt-1 text-xs text-emerald-700">根据行业、业务、重点产品和目标市场生成采集关键词与客户画像；推荐值仍需人工确认。</p></div>
          <div className="text-right"><button type="button" disabled={!canGenerateRecommendation} onClick={applyAiRecommendation} className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"><Sparkles size={14} />{recommendationApplied ? "已生成，可继续调整" : "生成 AI 推荐"}</button>{!canGenerateRecommendation&&<p role="status" className="mt-1 text-[10px] text-amber-700">请先补齐：{missingRecommendationFields.join("、")}</p>}</div>
        </div>
        {mode === "first" && activeRuleAgent === "business" && <div className="md:col-span-2 grid gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-xs md:grid-cols-3"><div><p className="font-bold text-blue-950">经营目标</p><p className="mt-1 text-blue-700">{form.primaryGoal === "awareness" ? "品牌曝光" : form.primaryGoal === "sales" ? "推进成交" : form.primaryGoal === "reactivation" ? "老客唤醒" : "获取询盘"}</p></div><div><div className="flex items-center justify-between gap-2"><p className="font-bold text-blue-950">重点产品</p><button type="button" onClick={()=>setProductStepSaved(false)} className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-[10px] font-bold text-blue-700 hover:bg-blue-50">重新选择</button></div><p className="mt-1 text-blue-700">{form.focusProducts || "本期暂未指定；相关内容分支等待产品资料"}</p></div><div><p className="font-bold text-blue-950">目标市场与客户</p><p className="mt-1 text-blue-700">{form.targetMarkets} · {form.customerProfile}</p></div></div>}
        {mode === "first" && activeRuleAgent === "business" && <Field label="接入目标"><select className={inputClass} value={form.primaryGoal} onChange={event=>set("primaryGoal",event.target.value as DigitalEmployeeConfig["primaryGoal"])}><option value="awareness">品牌曝光</option><option value="leads">获取询盘</option><option value="sales">推进成交</option><option value="reactivation">老客唤醒</option></select></Field>}
        {activeRuleAgent === "business" && <>
        <Field label="自主等级">
          <select
            className={inputClass}
            value={form.autonomyMode}
            onChange={(event) =>
              set(
                "autonomyMode",
                event.target.value as DigitalEmployeeConfig["autonomyMode"],
              )
            }
          >
            <option value="suggest">建议：只分析，不执行写操作</option>
            <option value="collaborate">协同：生成草稿，对外动作确认</option>
            <option value="managed">托管：低风险自动，关键节点审批</option>
            <option value="automatic">自动：在授权边界内持续运行</option>
          </select>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">建议：仅分析｜协同：可生成草稿｜托管：可自动采集与生成，发布、发送、报价仍审批｜自动：仅在下方边界内运行，商业承诺仍审批。</p>
        </Field>
        <Field
          label="审批负责人"
          required
          error={submitted ? errors.approvalOwner : ""}
        >
          <input
            className={inputClass}
            value={form.approvalOwner}
            onChange={(event) => set("approvalOwner", event.target.value)}
            placeholder="姓名或岗位"
          />
          <p className="mt-1 text-[10px] text-slate-500">请填写组织与权限中的真实成员；该负责人审批发布、批量跟进和商业承诺。</p>
        </Field>
        </>}
        {activeRuleAgent === "industry" && <div className="md:col-span-2 rounded-2xl border border-slate-200 p-4"><p className="text-sm font-bold text-slate-900">行业采集规则</p><p className="mt-1 text-xs text-slate-500">只采集公开内容，不包含广告投流。</p><div className="mt-3 grid gap-3 md:grid-cols-2"><Field label="采集平台"><input className={inputClass} value={collectionPlatforms} onChange={e=>setCollectionPlatforms(e.target.value)} /></Field><Field label="来源类型"><input className={inputClass} value={collectionSources} onChange={e=>setCollectionSources(e.target.value)} /></Field><Field label="AI 推荐关键词"><input className={inputClass} value={collectionKeywords} onChange={e=>setCollectionKeywords(e.target.value)} placeholder="点击上方生成 AI 推荐" /></Field><Field label="采集时间"><input className={inputClass} value={collectionTime} onChange={e=>setCollectionTime(e.target.value)} /></Field><Field label="回看天数"><input className={inputClass} type="number" min={1} value={collectionLookback} onChange={e=>setCollectionLookback(Number(e.target.value))} /></Field><Field label="每次最多采集（条）"><input className={inputClass} type="number" min={1} value={collectionLimit} onChange={e=>setCollectionLimit(Number(e.target.value))} /></Field></div><p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">采集近 {collectionLookback} 天公开内容，每次最多 {collectionLimit} 条，按链接与标题去重 30 天。</p></div>}
        {activeRuleAgent === "content" && <div className="md:col-span-2 rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-bold text-slate-900">内容生产与发布</p><p className="mt-1 text-xs text-slate-500">只生成自然内容，不包含广告投流；账号必须在制定目标前确认。</p></div><button type="button" onClick={()=>onOpenReadiness({key:"social_accounts",label:"社媒账号",status:"empty",count:connectedPublishingAccounts.length,page:"accountManagement",note:"管理发布授权"})} className="inline-flex items-center gap-1 text-xs font-bold text-blue-700">管理账号 <ExternalLink size={12}/></button></div><div className="mt-3 grid gap-3 md:grid-cols-2"><Field label="每周生成草稿（条）"><input className={inputClass} type="number" min={0} value={publishCount} onChange={e=>setPublishCount(Number(e.target.value))} /></Field><div><p className="text-xs font-bold text-slate-700">发布平台与具体账号 <span className="text-red-500">*</span></p><div className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-2">{publishingAccountsLoading?<p className="px-2 py-3 text-xs text-slate-400">正在读取已连接账号…</p>:connectedPublishingAccounts.length?connectedPublishingAccounts.map(account=>{const checked=form.publishingTargets.some(target=>target.platform===account.platform&&target.accountId===account.accountId);return <label key={`${account.platform}:${account.accountId}`} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 ${checked?"border-blue-300 bg-blue-50":"border-slate-200 bg-white"}`}><input type="checkbox" checked={checked} onChange={()=>set("publishingTargets",checked?form.publishingTargets.filter(target=>target.accountId!==account.accountId):[...form.publishingTargets,account])}/><span className="text-xs font-bold text-slate-800">{contentPlatformLabel[account.platform]} · {account.accountLabel}</span></label>}):<div className="px-2 py-3"><p className="text-xs text-amber-700">尚无可用账号。连接平台后可启用自动或人工待发布链路；系统不会生成虚假账号。</p>{form.enabledWorkflows.includes("content_publish")&&<button type="button" onClick={()=>toggleWorkflow("content_publish")} className="mt-2 rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-[10px] font-bold text-amber-800">本周暂不发布，仅生成内容</button>}</div>}</div>{publishingAccountsError&&<p className="mt-1 text-[10px] text-red-600">{publishingAccountsError}</p>}{submitted&&errors.publishingTargets&&<p className="mt-1 text-[10px] font-semibold text-red-600">{errors.publishingTargets}</p>}</div></div><label className="mt-3 flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3"><input type="checkbox" className="mt-0.5" checked={form.allowGeneratedVisuals} onChange={e=>set("allowGeneratedVisuals",e.target.checked)}/><span><span className="block text-xs font-black text-slate-900">素材不足时允许生成 AI 画面</span><span className="mt-0.5 block text-[10px] text-slate-500">默认关闭。只有知识库存在产品外观锚点时才可补充产品镜头；没有外观依据时仅可生成抽象说明或流程图，禁止虚构产品外观、参数与效果。</span></span></label><label className="mt-3 flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3"><input type="checkbox" className="mt-0.5" checked={form.allowRealPublishing} onChange={e=>set("allowRealPublishing",e.target.checked)}/><span><span className="block text-xs font-black text-slate-900">审批通过后允许真实发布</span><span className="mt-0.5 block text-[10px] text-slate-500">开启：当前版本获批后自动写入日历并由发布 Worker 执行；关闭：审批后停在人工待发布，绝不调用平台接口。</span></span></label><p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">每周生成 {publishCount} 条内容草稿；无论是否允许真实发布，每条内容都必须先展示账号、文案、成片与时间并获得审批。</p></div>}
        {activeRuleAgent === "customer" && <div className="md:col-span-2 rounded-2xl border border-slate-200 p-4"><p className="text-sm font-bold text-slate-900">客户跟进规则</p><div className="mt-3 grid gap-3 md:grid-cols-2"><Field label="草稿生成时间"><input className={inputClass} value={followupGenerateAt} onChange={e=>setFollowupGenerateAt(e.target.value)} /></Field><Field label="审批截止"><input className={inputClass} value={followupApproveBy} onChange={e=>setFollowupApproveBy(e.target.value)} /></Field><Field label="允许发送时段"><input className={inputClass} value={followupWindow} onChange={e=>setFollowupWindow(e.target.value)} /></Field><Field label="客户触达频控"><input className={inputClass} value={followupFrequency} onChange={e=>setFollowupFrequency(e.target.value)} /></Field></div><label className="mt-3 flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3"><input type="checkbox" className="mt-0.5" checked={form.allowRealCustomerMessages} onChange={e=>set("allowRealCustomerMessages",e.target.checked)}/><span><span className="block text-xs font-black text-slate-900">审批通过后允许真实发送客服消息</span><span className="mt-0.5 block text-[10px] text-slate-500">未开启时只生成和审批草稿，不调用真实消息渠道；商业承诺仍需逐条人工审批。</span></span></label><p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">先生成逐客草稿并等待审批，仅在客户当地工作时间发送。</p></div>}
        {activeRuleAgent === "business" && <><Field label="复盘时区"><input className={inputClass} value={reviewTimezone} onChange={e=>setReviewTimezone(e.target.value)} /></Field><Field label="数据截止时间"><input className={inputClass} value={reviewCutoff} onChange={e=>setReviewCutoff(e.target.value)} /></Field>
        <Field label="行动边界（每行一条）" wide>
          <textarea
            className={`${inputClass} min-h-24 resize-y`}
            value={form.constraints.join("\n")}
            onChange={(event) =>
              set(
                "constraints",
                event.target.value
                  .split("\n")
                  .map((item) => item.trim())
                  .filter(Boolean),
              )
            }
          />
        </Field>
        </>}
      </div>
      {activeRuleAgent !== "business" && <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <div className="flex items-center justify-between gap-3"><p className="text-xs font-bold text-slate-800">启用能力</p><span className="text-[10px] font-semibold text-emerald-700">已启用 {form.enabledWorkflows.length} 项</span></div>
        {dependencyNotice && (
          <p
            role="status"
            className="mt-2 rounded-xl bg-blue-50 px-3 py-2 text-[11px] text-blue-700"
          >
            {dependencyNotice}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {agentRoleGroups.filter((agent) => agent.id === activeRuleAgent).map((agent) => {
            return agent.workflows.map(id=>{const option=workflowOptions.find(item=>item.id===id)!;const checked=form.enabledWorkflows.includes(id);return <button key={id} type="button" aria-pressed={checked} onClick={()=>toggleWorkflow(id)} className={`inline-flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${checked?"border-emerald-300 bg-white":"border-slate-200 bg-white/70"}`}><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked?"border-emerald-600 bg-emerald-600 text-white":"border-slate-300 bg-white"}`}>{checked&&<Check size={13}/>}</span><span className="min-w-0 flex-1"><span className="block text-xs font-bold text-slate-800">{option.label}</span><span className="block truncate text-[9px] text-slate-400">{option.detail}</span></span><span className={`text-[9px] font-bold ${checked?"text-emerald-700":"text-slate-400"}`}>{checked?"已启用":"未启用"}</span></button>});
          })}
        </div>
        {submitted && errors.enabledWorkflows && (
          <p className="mt-2 text-[10px] font-semibold text-red-600">
            {errors.enabledWorkflows}
          </p>
        )}
      </div>}
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
        <div className="flex items-center gap-2 text-amber-900">
          <ShieldCheck size={17} />
          <div><p className="text-sm font-black">分 Agent 审批红线</p><p className="mt-0.5 text-[10px] text-amber-700">每个 Agent 只受自己职责范围内的红线约束；标记“强制”的高风险规则不能关闭。</p></div>
        </div>
        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          {agentApprovalOptions.filter((group) => group.role === activeRuleAgent).map((group) => <section key={group.role} className="rounded-xl border border-amber-100 bg-white p-3"><div className="flex items-center justify-between"><p className="text-xs font-black text-slate-900">{group.label}</p><span className="text-[9px] font-bold text-slate-400">独立审批策略</span></div><div className="mt-2 space-y-1.5">{group.items.map((item) => {const checked=Boolean((form.agentApprovalPolicies[group.role] as Record<string, boolean>)[item.key]);return <label key={item.key} className={`flex items-start gap-2 rounded-lg border p-2.5 ${checked?"border-amber-200 bg-amber-50/50":"border-slate-200 bg-slate-50"}`}><input type="checkbox" className="mt-0.5 accent-amber-600" checked={checked} disabled={"locked" in item&&item.locked} onChange={event=>setAgentApproval(group.role,item.key,event.target.checked)} /><span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-xs font-bold text-slate-800">{item.label}{"locked" in item&&item.locked&&<span className="rounded-full bg-red-50 px-2 py-0.5 text-[9px] text-red-600">强制</span>}</span><span className="mt-0.5 block text-[10px] leading-relaxed text-slate-500">{item.detail}</span></span></label>})}</div></section>)}
        </div>
        {submitted && (errors.contentPublish || errors.batchFollowup) && (
          <p className="mt-2 text-[10px] font-semibold text-red-600">
            {errors.contentPublish || errors.batchFollowup}
          </p>
        )}
      </div>
      <div className={`${activeRuleAgent !== "business" ? "hidden " : ""}mt-4`}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold text-slate-700">业务资产就绪度</p>
          <span className="text-[10px] text-slate-400">本页保存状态 + 最近业务快照</span>
        </div>
        {displayedReadiness.length ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {displayedReadiness.map((item) => (
              <button
                type="button"
                onClick={() => onOpenReadiness(item)}
                key={item.key}
                className={`rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${item.status === "ready" ? "border-emerald-100 bg-emerald-50/60" : item.status === "incomplete" ? "border-amber-100 bg-amber-50/60" : "border-slate-200 bg-slate-50"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-800">
                    {item.label}
                  </p>
                  <span
                    className={`text-[10px] font-bold ${item.status === "ready" ? "text-emerald-700" : item.status === "incomplete" ? "text-amber-700" : "text-slate-400"}`}
                  >
                    {item.status === "ready"
                      ? "已就绪"
                      : item.status === "incomplete"
                        ? "待补齐"
                        : "暂无数据"}
                  </span>
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
                  {item.note}
                </p>
                <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-slate-600">
                  {item.status === "ready" ? "查看资产" : "现在补齐"}{" "}
                  <ExternalLink size={10} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-2 rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-xs text-slate-400">
            资产快照尚未返回，保存配置不会把缺失项视为已就绪。
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-col items-end gap-2">
        {submitted && Object.keys(errors).length > 0 && (
          <div role="alert" className="flex flex-wrap items-center justify-end gap-2 text-xs font-semibold text-red-600"><span>还需填写：{missingConfigLabels.join("、")}。</span><button type="button" onClick={goToFirstMissingConfig} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-bold text-red-700">去补齐</button></div>
        )}
        <button
          type="button"
          disabled={busy || (submitted && Object.keys(errors).length > 0)}
          onClick={submit}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50"
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
        </button>
      </div>
    </section>
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
}: {
  config: DigitalEmployeeConfig;
  busy: boolean;
  onSave: (goal: GoalDraft) => void;
  businessLine: BusinessLine;
  contentPlatform: ContentPlatform;
}) {
  const configuredPlatforms = [...new Set(config.publishingTargets.map(target => target.platform))];
  const initialPlatforms = contentPlatform !== "all" && configuredPlatforms.includes(contentPlatform)
    ? [contentPlatform]
    : configuredPlatforms;
  const [form, setForm] = useState<GoalDraft>(() => ({
    ...EMPTY_GOAL,
    businessLine,
    contentPlatforms: initialPlatforms,
    title: businessLine === "customer_conversion" ? "本周客户转化目标" : businessLine === "content_growth" ? "本周内容增长目标" : "本周全链路经营目标",
    objective: businessLine === "customer_conversion" ? "提升高意向客户的报价、跟进与成交转化" : businessLine === "content_growth" ? `以${contentPlatformLabel[contentPlatform]}为范围，完成内容采集、生产、发布与获客` : "打通从内容曝光、询盘承接到成交的本周经营闭环",
    scope: config.targetMarkets,
  }));
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof GoalDraft>(key: K, value: GoalDraft[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const errors = {
    title: form.title.trim() ? "" : "请填写目标名称",
    objective: form.objective.trim() ? "" : "请填写本周重点结果",
    scope: form.scope.trim() ? "" : "请明确业务范围",
    target: form.target > form.baseline ? "" : "目标值必须大于基线",
    dates: form.endsAt >= form.startsAt ? "" : "结束日期不能早于开始日期",
    contentPlatforms: businessLine !== "customer_conversion" && config.enabledWorkflows.includes("content_publish") && !form.contentPlatforms.length ? "请至少确认一个已绑定账号的平台" : "",
  };
  const hasErrors = Object.values(errors).some(Boolean);
  const submit = () => {
    setSubmitted(true);
    if (!hasErrors) onSave(form);
  };
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
          <Target size={22} />
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">
            本周目标
          </p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">
            确认结果，Agent 负责拆解日常执行
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            目标批准后，计划 Agent 自动生成任务图并执行到首个人工审批点。
          </p>
          <div className="mt-2 flex flex-wrap gap-2"><span className="rounded-lg bg-slate-950 px-2.5 py-1 text-[10px] font-bold text-white">业务主线 · {businessLineLabel[businessLine]}</span>{businessLine === "content_growth" && <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700">平台范围 · {contentPlatformLabel[contentPlatform]}</span>}</div>
        </div>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {businessLine !== "customer_conversion" && config.enabledWorkflows.includes("content_publish") && <div className="md:col-span-2 rounded-2xl border border-blue-100 bg-blue-50/50 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-sm font-black text-slate-900">确认本期发布平台与账号</p><p className="mt-1 text-xs text-slate-500">只可选择 Agent 设置中已经确认、当前仍保持连接的账号平台。</p></div><span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold text-blue-700">{config.allowRealPublishing?"获批后允许真实发布":"获批后停在人工待发布"}</span></div><div className="mt-3 flex flex-wrap gap-2">{configuredPlatforms.map(platform=>{const selected=form.contentPlatforms.includes(platform);const accounts=config.publishingTargets.filter(target=>target.platform===platform);return <button key={platform} type="button" aria-pressed={selected} onClick={()=>set("contentPlatforms",selected?form.contentPlatforms.filter(item=>item!==platform):[...form.contentPlatforms,platform])} className={`rounded-xl border px-3 py-2 text-left ${selected?"border-blue-400 bg-white text-blue-800":"border-slate-200 bg-slate-50 text-slate-500"}`}><span className="block text-xs font-black">{contentPlatformLabel[platform]}</span><span className="mt-0.5 block text-[9px]">{accounts.map(account=>account.accountLabel).join("、")}</span></button>})}</div>{submitted&&errors.contentPlatforms&&<p className="mt-2 text-[10px] font-semibold text-red-600">{errors.contentPlatforms}</p>}</div>}
        <Field
          label="目标名称"
          required
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
          required
          error={submitted ? errors.objective : ""}
          wide
        >
          <textarea
            className={`${inputClass} min-h-20 resize-y`}
            value={form.objective}
            onChange={(event) => set("objective", event.target.value)}
          />
        </Field>
        <Field label="衡量指标" required>
          <select
            className={inputClass}
            value={form.metric}
            onChange={(event) => set("metric", event.target.value)}
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
          required
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
      <div className="mt-6 flex justify-end">
        <button
          type="button"
          disabled={busy || (submitted && hasErrors)}
          onClick={submit}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-800 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Check size={16} />
          )}{" "}
          保存目标草案
        </button>
      </div>
    </section>
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
}: {
  events: RunEvent[];
  activeTaskId?: string;
}) {
  return (
    <div className="space-y-4">
      {events.length === 0 && (
        <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
          目标批准后，这里会展示服务端真实运行事件。
        </p>
      )}
      {[...events].reverse().map((event) => (
        <div
          key={event.id}
          className={`relative flex gap-3 rounded-xl p-2 pl-2 transition ${activeTaskId && event.task_id === activeTaskId ? "bg-blue-50 ring-1 ring-blue-100" : ""}`}
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
          </div>
        </div>
      ))}
    </div>
  );
}

type WorkspaceView = "today" | "live" | "review" | "rules";
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
  { id: "today", label: "经营总览", caption: "关键数据与结论" },
  { id: "live", label: "执行中心", caption: "任务、审批与纠偏" },
  { id: "review", label: "经营复盘", caption: "周期结果与改进" },
];

function OperatingContextBar({
  data,
}: {
  data: DigitalEmployeeOverview;
}) {
  const planConfig = data.plan?.configSnapshot;
  const currentFingerprint = digitalEmployeeConfigFingerprint(data.config);
  const planFingerprint = digitalEmployeeConfigFingerprint(planConfig);
  const settingsChanged = Boolean(
    data.run && planFingerprint && currentFingerprint !== planFingerprint,
  );
  const snapshotTime = data.businessSnapshot?.generatedAt;
  return (
    <section
      aria-label="当前经营上下文"
      className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-[10px] shadow-sm"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-black text-slate-900">
          {data.goal?.title || "尚未制定本期目标"}
        </p>
      </div>
      <span className="rounded-full bg-slate-100 px-2.5 py-1 font-bold text-slate-600">
        {data.goal ? `${data.goal.startsAt}—${data.goal.endsAt}` : "等待目标"}
      </span>
      <span className={`rounded-full px-2.5 py-1 font-bold ${data.run ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
        {data.run ? statusLabel[data.run.status] || data.run.status : "尚未启动"}
      </span>
      <span className="text-slate-400">
        更新 {snapshotTime ? new Date(snapshotTime).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "待回流"}
      </span>
      {settingsChanged && (
        <span className="rounded-full bg-amber-50 px-2.5 py-1 font-bold text-amber-700">
          当前设置已变更，本轮仍按锁定快照执行
        </span>
      )}
    </section>
  );
}

function BusinessLineNav({ value, platform, onChange, onPlatformChange }: { value: BusinessLine; platform: ContentPlatform; onChange: (value: BusinessLine) => void; onPlatformChange: (value: ContentPlatform) => void }) {
  const lines: Array<[BusinessLine, string, string]> = [
    ["full_funnel", "全链路经营", "曝光到成交"],
    ["content_growth", "内容增长", "情报到获客"],
    ["customer_conversion", "客户转化", "询盘到成交"],
  ];
  const platforms: Array<[ContentPlatform, string]> = [["all","全部平台"],["facebook","Facebook"],["instagram","Instagram"],["tiktok","TikTok"],["youtube","YouTube"]];
  return <section aria-label="经营视角切换" className="mt-3 rounded-xl border border-slate-200 bg-white p-2">
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="flex items-center gap-1.5 px-2 text-[10px] font-black text-slate-400"><Layers3 size={13}/>经营视角</span>
      {lines.map(([id,label,caption])=><button key={id} type="button" title={caption} aria-pressed={value===id} onClick={()=>onChange(id)} className={`rounded-xl px-3 py-2 text-[11px] font-black transition ${value===id?"bg-slate-950 text-white shadow-sm":"text-slate-500 hover:bg-slate-100 hover:text-slate-900"}`}>{label}</button>)}
    </div>
    {value==="content_growth"&&<div className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-1.5"><span className="px-2 text-[9px] font-bold text-slate-400">平台</span>{platforms.map(([id,label])=><button key={id} type="button" aria-pressed={platform===id} onClick={()=>onPlatformChange(id)} className={`rounded-lg px-2.5 py-1.5 text-[9px] font-bold ${platform===id?"bg-blue-700 text-white":"bg-blue-50 text-blue-700 hover:bg-blue-100"}`}>{label}</button>)}</div>}
  </section>;
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
    caption: "复用现有内容栈",
    page: "socialInspiration",
    steps: ["使用爆款", "爆款裂变", "产品生成"],
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
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
            <Layers3 size={18} />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
              经营任务闭环
            </p>
            <h2 className="mt-1 font-black text-slate-950">
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
            <button
              type="button"
              onClick={() =>
                onOpen(
                  stage.page,
                  stage.page === "smartAssets" ? "publish" : undefined,
                  { source: "business_loop", stage: stage.title },
                )
              }
              className={`rounded-2xl border p-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${stage.tone}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-black">
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
            </button>
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
    <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
      <div className="flex items-center gap-2 text-violet-800">
        <RotateCcw size={15} />
        <p className="text-xs font-black">纠偏当前任务</p>
      </div>
      <textarea
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        className="mt-3 min-h-20 w-full resize-y rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-violet-400"
        placeholder="说明哪里不对，以及希望 Agent 如何调整。"
      />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setScope("one_off")}
          className={`rounded-xl border px-3 py-2 text-left ${scope === "one_off" ? "border-violet-400 bg-white text-violet-800 ring-1 ring-violet-100" : "border-violet-100 text-slate-500"}`}
        >
          <span className="block text-xs font-bold">仅本次</span>
          <span className="mt-0.5 block text-[10px]">只修正当前运行</span>
        </button>
        <button
          type="button"
          onClick={() => setScope("rule_candidate")}
          className={`rounded-xl border px-3 py-2 text-left ${scope === "rule_candidate" ? "border-violet-400 bg-white text-violet-800 ring-1 ring-violet-100" : "border-violet-100 text-slate-500"}`}
        >
          <span className="block text-xs font-bold">长期规则候选</span>
          <span className="mt-0.5 block text-[10px]">
            先进入候选，不直接改规则
          </span>
        </button>
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
      <button
        type="button"
        disabled={busy || !instruction.trim()}
        onClick={() => void submit()}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-700 px-3 py-2.5 text-xs font-bold text-white hover:bg-violet-800 disabled:opacity-50"
      >
        {busy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <RotateCcw size={14} />
        )}{" "}
        提交纠偏
      </button>
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
    <div className="mt-4 rounded-2xl border border-red-200 bg-red-50/70 p-4">
      <div className="flex items-center gap-2 text-red-800">
        <AlertTriangle size={15} />
        <p className="text-xs font-black">任务受阻，需要处理</p>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-red-700">
        {task.blocked_reason ||
          "真实业务状态未能推进，请选择恢复方式。所有操作都会写入审计记录。"}
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void retry()}
          className="rounded-xl bg-red-700 px-2 py-2.5 text-[11px] font-bold text-white disabled:opacity-50"
        >
          重试任务
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            setMode((current) => (current === "skip" ? "" : "skip"))
          }
          className={`rounded-xl border px-2 py-2.5 text-[11px] font-bold ${mode === "skip" ? "border-amber-400 bg-amber-50 text-amber-800" : "border-red-200 bg-white text-red-700"}`}
        >
          跳过并继续
        </button>
        <button
          type="button"
          disabled={busy || !manualCompletionAllowed}
          onClick={() =>
            setMode((current) => (current === "complete" ? "" : "complete"))
          }
          title={
            manualCompletionAllowed
              ? "登记人工完成结果"
              : "真实发布或发送必须取得渠道回执，不能手工标记完成"
          }
          className={`rounded-xl border px-2 py-2.5 text-[11px] font-bold ${mode === "complete" ? "border-violet-400 bg-violet-50 text-violet-800" : "border-red-200 bg-white text-red-700"}`}
        >
          登记人工完成
        </button>
      </div>
      {!manualCompletionAllowed && (
        <p className="mt-2 text-[10px] font-semibold text-red-700">
          此节点涉及真实发布或发送，人工完成入口已锁定；请补充真实渠道回执或纠偏重试。
        </p>
      )}
      {mode && (
        <div className="mt-3 rounded-xl border border-red-100 bg-white p-3">
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
          <button
            type="button"
            disabled={busy || !note.trim()}
            onClick={() => void confirm()}
            className="mt-2 w-full rounded-lg bg-slate-950 px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50"
          >
            确认{mode === "skip" ? "跳过" : "登记人工完成"}
          </button>
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
}) {
  const taskEvents = task
    ? events.filter((event) => event.task_id === task.id)
    : events;
  const link = task ? buildTaskDeepLink(task, planTask, runId) : null;
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
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white">
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
        {task && <Badge status={task.status} />}
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
                <p className="text-sm font-black text-slate-900">
                  {task.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  {task.description}
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-slate-400">执行角色</p>
                <p className="mt-1 font-bold text-slate-700">
                  {agentLabel[task.agent_role] || "业务 Agent"}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
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
            <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
              <div className="flex items-center gap-2 text-blue-800">
                <BrainCircuit size={15} />
                <p className="text-xs font-black">执行依据</p>
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
            </div>
            <div className="mt-5">
              <p className="text-xs font-bold text-slate-700">中间产物</p>
              {Object.keys(task.output || {}).length ? (
                <div className="mt-2 space-y-2">
                  {Object.entries(task.output)
                    .slice(0, 6)
                    .map(([key, value], index) => (
                      <div
                        key={key}
                        className="rounded-xl border border-slate-100 p-3"
                      >
                        <p className="text-[10px] font-semibold text-slate-400">
                          {technicalKeyLabel[key] || `业务产出 ${index + 1}`}
                        </p>
                        <DetailValue value={value} />
                      </div>
                    ))}
                </div>
              ) : (
                <div className="mt-2 rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-[11px] text-slate-400">
                  Agent 产出会在执行过程中持续写入
                </div>
              )}
            </div>
            {link && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => onOpenTask(link)}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-950 px-3 py-3 text-xs font-bold text-white hover:bg-slate-800"
                >
                  {taskBusinessAction(link)} <ExternalLink size={12} />
                </button>
                <p className="mt-1.5 text-center text-[10px] text-slate-400">
                  已保留本次运行与任务位置；完成业务操作后返回“数字员工”即可继续。
                </p>
              </div>
            )}
            {!readOnly &&
              (task.status === "failed" ||
                (Boolean(task.blocked_reason) &&
                  ["waiting_external", "waiting_human", "pending"].includes(
                    task.status,
                  ))) && (
                <BlockedTaskActions
                  key={task.id}
                  task={task}
                  busy={controlling}
                  onRetry={onRetry}
                  onSkip={onSkip}
                  onComplete={onComplete}
                />
              )}
            {!readOnly ? (
              <CorrectionPanel
                key={task.id}
                busy={correcting}
                onSubmit={onCorrect}
              />
            ) : (
              <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                正在查看历史运行；可查看业务证据，但不会对历史任务执行纠偏或恢复操作。
              </p>
            )}
          </div>
          <div className="max-h-[620px] overflow-y-auto p-5">
            <AgentOperationFeed task={task} events={taskEvents} />
            <div className="mb-4 flex items-center justify-between">
              <p className="mt-5 text-xs font-bold text-slate-700">现场事件</p>
              <span className="text-[10px] text-slate-400">
                {taskEvents.length} 条已持久化
              </span>
            </div>
            <EventTimeline events={taskEvents} activeTaskId={task.id} />
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
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-slate-500">{label}</p>
        <AvailabilityBadge status={status} />
      </div>
      <p
        className={`mt-2 text-2xl font-black ${status === "available" ? "text-slate-950" : "text-slate-400"}`}
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
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity size={19} className="text-emerald-600" />
            <h2 className="font-black text-slate-950">今日经营快照</h2>
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
            className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">
                {card.label}
              </span>
              {card.icon}
            </div>
            <p className="mt-2 text-2xl font-black text-slate-950">
              {card.value === null ? "待接入" : card.value}
            </p>
            <p className="mt-1 text-[10px] text-slate-400">
              {card.status === "available" ? "来自本次快照" : "等待真实记录"}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-700">接下来 24 小时</p>
            <span className="text-[10px] text-slate-400">
              {snapshot ? `${snapshot.next24Hours.length} 项` : "待接入"}
            </span>
          </div>
          {snapshot?.next24Hours.length ? (
            <div className="mt-3 space-y-2">
              {snapshot.next24Hours.slice(0, 5).map((item) => (
                <button
                  type="button"
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
                  className="flex w-full items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 text-left hover:bg-slate-100"
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
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
              {snapshot ? "未来 24 小时没有已登记动作" : "排期快照尚未返回"}
            </p>
          )}
        </div>
        <div className="rounded-2xl border border-slate-100 p-4">
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
                    className="flex gap-2 rounded-xl bg-amber-50/60 px-3 py-2.5 text-[11px] text-amber-900"
                  >
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    {gap}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-5 text-center text-xs text-emerald-700">
                本次快照没有发现数据缺口
              </p>
            )
          ) : (
            <p className="mt-3 rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-400">
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
  return <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5" title={note || metric?.note || metric?.source}>
    <div className="flex items-center justify-between gap-2"><p className="text-[11px] font-bold text-slate-500">{label}</p><span className="text-slate-400">{icon}</span></div>
    <p className={`mt-2 text-xl font-black ${available ? "text-slate-950" : "text-slate-400"}`}>{available ? metricText(metric) : "—"}</p>
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
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-emerald-700"><BarChart3 size={18}/></span>
            <div><p className="text-sm font-semibold text-slate-800">{availableCount === 0 ? "连接数据，开始追踪获客表现" : `${availableCount} / ${stages.length} 个阶段已有数据`}</p><p className="mt-1 text-xs leading-5 text-slate-500">连接社媒账号，并在客户管理中完善询盘、报价与成交记录。</p></div>
          </div>
          <button type="button" onClick={onConnect} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">连接社媒账号<ArrowRight size={14}/></button>
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

function TodaySnapshotPanel({ data, onPeriodChange, onManageGoal, onConnect, businessLine, contentPlatform, rangeBusy = false }: { data: DigitalEmployeeOverview; onPeriodChange: (period: OverviewPeriod) => void; onManageGoal: () => void; onConnect: () => void; businessLine: BusinessLine; contentPlatform: ContentPlatform; rangeBusy?: boolean }) {
  const [period, setPeriod] = useState<OverviewPeriod>("week");
  const snapshot = data.businessSnapshot;
  const social = snapshot?.social;
  const dataGaps = (snapshot?.dataGaps || []).filter((gap) => {
    const customerGap = /客户|WhatsApp|询盘|报价|成交|跟进|客群|批次|触达/.test(gap);
    const contentGap = /社媒|账号|发布|内容|平台|爆款|视频|素材|作品|选题/.test(gap);
    if (businessLine === "content_growth") return contentGap && !customerGap;
    if (businessLine === "customer_conversion") return customerGap;
    return true;
  });
  const platformData = contentPlatform === "all" ? undefined : social?.platformBreakdown.find(item => item.platform === contentPlatform);
  const displaySocial = contentPlatform !== "all" && social ? {
    ...social,
    accountCount: { value: platformData?.accounts ?? null, status: platformData ? "available" : "unavailable", source: `social_accounts.${contentPlatform}`, note: platformData ? "真实授权账号" : "该平台尚未连接账号" } as BusinessMetric,
    platformCount: { value: platformData ? 1 : null, status: platformData ? "available" : "unavailable", source: `social_accounts.${contentPlatform}`, note: platformData ? "真实授权平台" : "该平台尚未连接" } as BusinessMetric,
    views: { value: platformData?.views ?? null, status: platformData?.views == null ? "unavailable" : "available", source: `social_metric_snapshots.${contentPlatform}.views` } as BusinessMetric,
    likes: { value: platformData?.likes ?? null, status: platformData?.likes == null ? "unavailable" : "available", source: `social_metric_snapshots.${contentPlatform}.likes` } as BusinessMetric,
    comments: { value: platformData?.comments ?? null, status: platformData?.comments == null ? "unavailable" : "available", source: `social_metric_snapshots.${contentPlatform}.comments` } as BusinessMetric,
    shares: { value: platformData?.shares ?? null, status: platformData?.shares == null ? "unavailable" : "available", source: `social_metric_snapshots.${contentPlatform}.shares` } as BusinessMetric,
    reach: { value: null, status: "unavailable", source: `social_metric_snapshots.${contentPlatform}.reach`, note: "该平台触达数据尚未回流" } as BusinessMetric,
    saves: { value: null, status: "unavailable", source: `social_metric_snapshots.${contentPlatform}.saves`, note: "该平台收藏数据尚未回流" } as BusinessMetric,
    profileViews: { value: null, status: "unavailable", source: `social_metric_snapshots.${contentPlatform}.profile_views`, note: "该平台主页访问尚未回流" } as BusinessMetric,
    platformBreakdown: platformData ? [platformData] : [],
  } : social;
  const goalMetric: Record<string, BusinessMetric | undefined> = {
    approved_content_packages: snapshot?.content.completedWorks,
    published_content: snapshot?.content.publishedPosts,
    qualified_inquiries: snapshot?.customer.highIntent,
    won_customers: snapshot?.customer.won,
    reactivated_customers: snapshot?.customer.outreachSent,
  };
  const currentGoalMetric = data.goal ? goalMetric[data.goal.metric] : undefined;
  const goalValue = currentGoalMetric?.status === "available" ? currentGoalMetric.value : null;
  const goalProgress = data.goal && goalValue !== null ? Math.min(100, Math.round(((goalValue - data.goal.baseline) / Math.max(1, data.goal.target - data.goal.baseline)) * 100)) : null;
  const funnel = [
    ["内容曝光", displaySocial?.views], ["内容互动", !displaySocial || [displaySocial.likes, displaySocial.comments, displaySocial.shares, displaySocial.saves].every(item => item.status !== "available") ? undefined : { value: [displaySocial?.likes, displaySocial?.comments, displaySocial?.shares, displaySocial?.saves].reduce((sum, item) => sum + (item?.status === "available" ? Number(item.value || 0) : 0), 0), status: "available", source: "social interactions" } as BusinessMetric],
    ["主页访问", displaySocial?.profileViews], ["内容询盘", snapshot?.content.inquiries], ["高意向客户", snapshot?.customer.highIntent], ["已报价", snapshot?.customer.quoted], ["已成交", snapshot?.customer.won],
  ] as Array<[string, BusinessMetric | undefined]>;
  const customerStages: Array<{ label: string; metric?: BusinessMetric }> = [
    { label: "全部", metric: snapshot?.customer.total },
    { label: "高意向", metric: snapshot?.customer.highIntent },
    { label: "已报价", metric: snapshot?.customer.quoted },
    { label: "已成交", metric: snapshot?.customer.won },
  ];
  const insights: Array<{ tone: string; title: string; detail: string }> = [];
  if (!snapshot) insights.push({ tone: "slate", title: "经营数据正在汇总", detail: "业务快照返回后生成本周期重点结论。" });
  else {
    if (businessLine !== "customer_conversion" && displaySocial?.views.status === "available") insights.push({ tone: "blue", title: `${contentPlatformLabel[contentPlatform]}本周期获得 ${metricText(displaySocial.views)} 次内容曝光`, detail: `${metricText(snapshot.content.publishedPosts)} 条内容已取得真实发布回执。` });
    if (businessLine !== "content_growth" && snapshot.customer.highIntent.status === "available") insights.push({ tone: "emerald", title: `${metricText(snapshot.customer.highIntent)} 个高意向客户`, detail: `其中 ${metricText(snapshot.customer.quoted)} 个已报价，${metricText(snapshot.customer.won)} 个已成交。` });
    if (dataGaps.length) insights.push({ tone: "amber", title: `${dataGaps.length} 项数据缺口影响完整归因`, detail: dataGaps[0] });
    if (!insights.length) insights.push({ tone: "slate", title: "真实经营数据仍在积累", detail: "连接业务渠道并产生回执后，经营 Agent 将在这里给出重点结论。" });
  }
  const platformColors = ["#2563eb", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899"];
  const platformTotal = displaySocial?.platformBreakdown.reduce((sum, item) => sum + (item.views ?? item.accounts), 0) || 0;
  let donutCursor = 0;
  const donutStops = displaySocial?.platformBreakdown.map((item, index) => { const start = donutCursor; donutCursor += platformTotal ? ((item.views ?? item.accounts) / platformTotal) * 100 : 0; return `${platformColors[index % platformColors.length]} ${start}% ${donutCursor}%`; }).join(", ");
  return <div className="space-y-4">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><BarChart3 size={19} className="text-emerald-600"/><h2 className="font-black text-slate-950">经营数据总览</h2></div><p className="mt-1 text-[11px] text-slate-400">默认按本周经营周期汇总；所有数值均来自业务记录或平台真实回执。</p></div><div role="group" aria-label="经营数据周期" className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">{([['week','本周'],['lastWeek','上周'],['month','本月'],['lastMonth','上月']] as Array<[OverviewPeriod,string]>).map(([id,label])=><button key={id} type="button" aria-pressed={period===id} disabled={rangeBusy} onClick={()=>{setPeriod(id);onPeriodChange(id);}} className={`rounded-lg px-3 py-1.5 text-[11px] font-bold ${period===id?"bg-white text-slate-950 shadow-sm":"text-slate-500"}`}>{label}</button>)}</div></div>
      {data.goal ? <div className="mt-4 grid gap-3 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center"><div className="min-w-0"><p className="truncate text-xs font-black text-slate-900">本周目标 · {data.goal.title}</p><p className="mt-0.5 text-xs text-slate-500">目标 {data.goal.target}{data.goal.unit}</p></div><p className="text-sm font-black text-blue-950">实际 {goalValue === null ? "待回流" : `${goalValue}${data.goal.unit}`}</p><span className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-blue-700">{goalProgress === null ? "进度待回流" : `完成 ${goalProgress}%`}</span></div> : <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3"><p className="text-xs font-black text-slate-800">尚未设置本周目标</p><button type="button" onClick={onManageGoal} className="shrink-0 rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white">制定目标</button></div>}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {businessLine === "customer_conversion" ? <><DataMetricCard label="客户总量" metric={snapshot?.customer.total} icon={<Users size={15}/>}/><DataMetricCard label="高意向客户" metric={snapshot?.customer.highIntent}/><DataMetricCard label="已报价" metric={snapshot?.customer.quoted}/><DataMetricCard label="已成交" metric={snapshot?.customer.won}/></> : <><DataMetricCard label="内容曝光" metric={displaySocial?.views} icon={<Eye size={15}/>}/><DataMetricCard label="发布内容" metric={snapshot?.content.publishedPosts}/><DataMetricCard label="内容询盘" metric={snapshot?.content.inquiries}/>{businessLine === "content_growth" ? <DataMetricCard label="主页访问" metric={displaySocial?.profileViews}/> : <DataMetricCard label="已成交" metric={snapshot?.customer.won}/>}</>}
      </div>
      <div className="mt-4"><div className="flex items-center justify-between"><h3 className="text-sm font-black text-slate-900">实际经营重点结论</h3><span className="text-xs text-slate-400">经营 Agent · 仅基于可用数据</span></div><div className={`mt-2 grid gap-2 ${insights.length > 2 ? "lg:grid-cols-3" : insights.length > 1 ? "lg:grid-cols-2" : ""}`}>{insights.slice(0,3).map((item,index)=><div key={index} className={`rounded-xl border px-4 py-3 ${item.tone==='amber'?"border-amber-100 bg-amber-50":item.tone==='emerald'?"border-emerald-100 bg-emerald-50":item.tone==='blue'?"border-blue-100 bg-blue-50":"border-slate-100 bg-slate-50"}`}><p className="text-xs font-black text-slate-900">{item.title}</p><p className="mt-1 text-xs leading-4 text-slate-500">{item.detail}</p></div>)}</div></div>
    </section>

    {businessLine !== "customer_conversion" && <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-black text-slate-950">流量转化漏斗</h2><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{businessLine === "content_growth" ? `${contentPlatformLabel[contentPlatform]} 内容链路` : "核心经营链路"}</span></div><ConversionFunnelChart stages={businessLine === "content_growth" ? funnel.slice(0, 4) : funnel} onConnect={onConnect}/></section>}

    <section className={`grid gap-4 ${businessLine === "full_funnel" ? "xl:grid-cols-2" : ""}`}>
      {businessLine !== "customer_conversion" && <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><h2 className="text-sm font-black text-slate-950">内容经营 · {contentPlatformLabel[contentPlatform]}</h2><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><DataMetricCard label="发布内容" metric={snapshot?.content.publishedPosts}/><DataMetricCard label="内容曝光" metric={displaySocial?.views} icon={<Eye size={14}/>}/><DataMetricCard label="点赞" metric={displaySocial?.likes} icon={<Heart size={14}/>}/><DataMetricCard label="评论" metric={displaySocial?.comments} icon={<MessageSquare size={14}/>}/><DataMetricCard label="分享" metric={displaySocial?.shares} icon={<Share2 size={14}/>}/><DataMetricCard label="主页访问" metric={displaySocial?.profileViews}/><DataMetricCard label="已接平台" metric={displaySocial?.platformCount}/><DataMetricCard label="已接账号" metric={displaySocial?.accountCount}/></div><div className="mt-3 grid gap-3 sm:grid-cols-[150px_1fr]"><div className="flex items-center justify-center rounded-xl bg-white p-3"><div className="relative h-24 w-24 rounded-full" style={{background:donutStops?`conic-gradient(${donutStops})`:"#e2e8f0"}}><div className="absolute inset-5 flex items-center justify-center rounded-full bg-white text-center"><span className="text-[11px] font-bold text-slate-500">平台贡献</span></div></div></div><div className="space-y-2 rounded-xl bg-white p-3">{displaySocial?.platformBreakdown.length?displaySocial.platformBreakdown.map((item,index)=><div key={item.platform} className="flex items-center justify-between text-[11px]"><span className="flex items-center gap-2 font-bold text-slate-700"><i className="h-2 w-2 rounded-full" style={{background:platformColors[index%platformColors.length]}}/>{contentPlatformLabel[item.platform as ContentPlatform] || item.platform}</span><span className="text-slate-500">{item.views===null?`${item.accounts} 个账号`:`${item.views.toLocaleString()} 曝光`}</span></div>):<p className="py-8 text-center text-xs text-slate-400">尚未连接社媒账号</p>}</div></div></div>}
      {businessLine !== "content_growth" && <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><h2 className="text-sm font-black text-slate-950">客户转化</h2><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><DataMetricCard label="客户总量" metric={snapshot?.customer.total}/><DataMetricCard label="内容归因客户" metric={snapshot?.customer.attributed}/><DataMetricCard label="高意向客户" metric={snapshot?.customer.highIntent}/><DataMetricCard label="已报价" metric={snapshot?.customer.quoted}/><DataMetricCard label="已成交" metric={snapshot?.customer.won}/><DataMetricCard label="跟进草稿" metric={snapshot?.customer.followupDrafts}/><DataMetricCard label="真实发送" metric={snapshot?.customer.outreachSent}/><DataMetricCard label="发送失败" metric={snapshot?.customer.outreachFailed}/></div><div className="mt-3 rounded-xl bg-white p-4"><p className="text-xs font-black text-slate-800">客户阶段转化</p><div className="mt-3 flex items-end gap-2">{customerStages.map(({label,metric})=>{const max=Math.max(1,Number(snapshot?.customer.total.value||0));return <div key={label} className="flex-1 text-center"><div className="mx-auto flex min-h-8 items-end justify-center rounded-t-lg bg-emerald-100" style={{height:`${metric?.status==='available'?Math.max(32,Number(metric.value||0)/max*100):32}px`}}><span className="pb-1 text-xs font-black text-emerald-800">{metricText(metric)}</span></div><p className="mt-1 text-[11px] text-slate-500">{label}</p></div>})}</div></div></div>}
    </section>
    {dataGaps.length?<section className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2"><AlertTriangle size={15} className="text-amber-700"/><p className="text-xs font-black text-amber-900">数据完整度提醒</p></div><div className="mt-2 flex flex-wrap gap-2">{dataGaps.map(item=><span key={item} className="rounded-lg bg-white px-3 py-2 text-xs text-amber-800">{item}</span>)}</div></section>:null}
  </div>;
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
      className={`rounded-3xl border p-5 ${ready ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/70"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {ready ? (
            <CheckCircle2 size={20} className="mt-0.5 text-emerald-700" />
          ) : (
            <AlertTriangle size={20} className="mt-0.5 text-amber-700" />
          )}
          <div>
            <h2 className="text-sm font-black text-slate-950">
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
            <button
              key={item.key}
              type="button"
              onClick={() => onOpen(item)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs font-bold text-amber-800"
            >
              补齐{item.label} <ExternalLink size={11} />
            </button>
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
    (task) => task.status === "failed" || Boolean(task.blocked_reason),
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
        tone: "from-blue-700 to-indigo-700",
      }
    : data.goal.status === "draft"
      ? {
          eyebrow: "需要确认",
          title: data.plan ? "核对计划和业务资产后启动" : "计划草案正在生成",
          detail: data.plan
            ? `计划包含 ${data.plan.tasks.length} 个真实业务节点，批准前不会运行。`
            : "等待服务端返回可预览的任务计划。",
          label: "查看批准项",
          action: onPlan,
          tone: "from-blue-700 to-indigo-700",
        }
      : blocked
        ? {
            eyebrow: "需要处理",
            title: `${blocked.title} 已受阻`,
            detail:
              blocked.blocked_reason || "选择重试、跳过、人工完成或纠偏。",
            label: "处理阻塞任务",
            action: onLive,
            tone: "from-red-700 to-rose-700",
          }
        : pendingApproval
          ? {
              eyebrow: "需要决定",
              title: "生产现场有一项操作等待审批",
              detail: "先核对执行依据和真实外部影响，再批准或驳回。",
              label: "前往审批",
              action: onLive,
              tone: "from-amber-600 to-orange-600",
            }
          : terminalRun
            ? {
                eyebrow: "本轮已收束",
                title: "查看业务结果与本周复盘",
                detail: "结果按已取得、等待回流、暂不可用分别呈现。",
                label: "查看本周复盘",
                action: onReview,
                tone: "from-emerald-700 to-teal-700",
              }
            : {
                eyebrow: "正在执行",
                title: activeTask
                  ? `当前：${activeTask.title}`
                  : "数字员工正在推进本周计划",
                detail: "进入生产现场观看真实事件、业务回写并随时纠偏。",
                label: "观看生产现场",
                action: onLive,
                tone: "from-slate-900 to-slate-700",
              };
  return (
    <section
      className={`rounded-3xl bg-gradient-to-r ${state.tone} p-5 text-white shadow-lg`}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/65">
            {state.eyebrow}
          </p>
          <h2 className="mt-1 text-lg font-black">{state.title}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-white/75">
            {state.detail}
          </p>
        </div>
        <button
          type="button"
          disabled={data.goal?.status === "draft" && !data.plan}
          onClick={state.action}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-black text-slate-900 shadow-sm disabled:opacity-50"
        >
          {state.label} <ArrowRight size={14} />
        </button>
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
    <section className="rounded-3xl border border-blue-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
          <Layers3 size={18} />
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">
            批准前预览
          </p>
          <h2 className="mt-1 font-black text-slate-950">
            这周将调用的真实业务能力
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            先核对能力、去向与审批边界，批准后才创建运行。
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {plan.tasks.map((task) => (
          <button
            key={task.key}
            type="button"
            onClick={() =>
              task.destination &&
              onOpen(task.destination, task.destinationView, {
                taskKey: task.key,
                capabilityKey: task.capabilityKey,
                statusSource: task.statusSource,
                preview: true,
              })
            }
            className="rounded-2xl border border-slate-200 p-3 text-left hover:border-blue-300"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-black text-slate-800">
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
          </button>
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
    <section className="rounded-3xl border border-violet-200 bg-gradient-to-r from-violet-50/80 to-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-violet-800">
            <MessageSquare size={18} />
            <h2 className="font-black">批量跟进执行边界</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            批准的是逐客草稿批次，不等于消息已经发出。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              onOpen("conversion", undefined, {
                capabilityKey: "customer.followup_drafts",
                stage: "batch_followup",
              })
            }
            className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-bold text-violet-700"
          >
            进入客户工作台 <ExternalLink size={12} />
          </button>
          {onDispatch &&
            batchId &&
            approval?.status === "succeeded" &&
            dispatch?.status !== "succeeded" && (
              <button
                type="button"
                disabled={!manualSendAllowed || busy}
                onClick={() => onDispatch(batchId)}
                title={
                  manualSendAllowed
                    ? "发送当前已到期且通过预检的客户"
                    : dispatchBlockedReason || "租户真实发送授权或 WhatsApp 渠道尚未就绪"
                }
                className="inline-flex items-center gap-1.5 rounded-xl bg-violet-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Send size={12} />
                )}
                {manualSendAllowed ? "发送已到期客户" : "真实发送未就绪"}
              </button>
            )}
        </div>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {steps.map((step) => (
          <div
            key={step.title}
            className="rounded-2xl border border-white bg-white/80 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-black text-slate-800">{step.title}</p>
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
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 text-white"><div className="flex items-center justify-between border-b border-slate-800 px-4 py-3"><div className="flex items-center gap-2"><MonitorPlay size={15} className="text-emerald-400"/><p className="text-xs font-black">Agent 操作现场</p></div><span className="rounded-full bg-slate-800 px-2 py-1 text-[9px] font-bold text-slate-300">真实事件流</span></div>{latestScreenshot ? <div className="relative bg-black" style={{aspectRatio:viewportRatio}}><img src={latestScreenshot.screenshotUrl} alt="Agent Worker 上报的操作截图" className="absolute inset-0 h-full w-full object-contain"/>{cursor && <div className="pointer-events-none absolute z-10 transition-all duration-300" style={{left:`${cursor.left}%`,top:`${cursor.top}%`}}><MousePointer2 size={22} className="fill-white text-slate-950 drop-shadow"/>{cursorAction?.kind === "click" && <i className="absolute -left-2 -top-2 h-8 w-8 animate-ping rounded-full border-2 border-emerald-400"/>}</div>}<div className="absolute bottom-3 left-3 rounded-lg bg-black/70 px-2 py-1 text-[9px]">{latestScreenshot.label}</div></div> : actions.length ? <div className="relative p-4">{cursor && <div className="pointer-events-none absolute z-10 transition-all duration-300" style={{left:`${cursor.left}%`,top:`${cursor.top}%`}}><MousePointer2 size={20} className="fill-white text-slate-950 drop-shadow"/></div>}<div className="space-y-2">{actions.slice(-6).map((action,index)=><div key={`${action.kind}-${index}`} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2"><MousePointer2 size={13} className="text-emerald-400"/><div><p className="text-[10px] font-bold text-slate-200">{action.label}</p><p className="text-[9px] text-slate-500">{action.kind}{action.page ? ` · ${action.page}` : ""}</p></div></div>)}</div></div> : <div className="px-5 py-10 text-center"><MonitorPlay size={24} className="mx-auto text-slate-600"/><p className="mt-3 text-xs font-black text-slate-300">现场画面流尚未接入</p><p className="mx-auto mt-2 max-w-md text-[10px] leading-5 text-slate-500">当前只展示真实任务状态、产物和事件。Agent Worker 上报带坐标的 navigation、click、input、screenshot 后，这里才会移动真实鼠标，不生成假鼠标动画。</p>{task && <p className="mt-3 text-[9px] text-slate-600">当前任务：{task.title}</p>}</div>}</section>;
}

function WeeklyReviewPanel({
  data,
  onGoLive,
  onOpenRules,
  businessLine,
  contentPlatform,
}: {
  data: DigitalEmployeeOverview;
  onGoLive: (taskId?: string, deliveryId?: string) => void;
  onOpenRules: () => void;
  businessLine: BusinessLine;
  contentPlatform: ContentPlatform;
}) {
  const generatedReview =
    data.review?.status === "generated" ? data.review : null;
  const liveReview = generatedReview ? null : data.liveReview;
  const snapshot = liveReview?.businessSnapshot || data.businessSnapshot;
  const lineTasks = data.tasks.filter(
    (task) => businessLine === "full_funnel" || taskBusinessLine(task) === businessLine,
  );
  const platformData = contentPlatform === "all"
    ? undefined
    : snapshot?.social.platformBreakdown.find((item) => item.platform === contentPlatform);
  const platformMetric = (key: "views" | "likes" | "comments" | "shares"): BusinessMetric | undefined => {
    if (contentPlatform === "all") return snapshot?.social[key];
    const value = platformData?.[key] ?? null;
    return { value, status: value === null ? "unavailable" : "available", source: `social_metric_snapshots.${contentPlatform}.${key}`, note: value === null ? "该平台指标尚未回流" : "已授权平台真实回执" };
  };
  const fullFunnelMetrics = [
    ["真实发布", snapshot?.content.publishedPosts],
    ["内容询盘", snapshot?.content.inquiries],
    ["内容成交", snapshot?.content.deals],
    ["高意向客户", snapshot?.customer.highIntent],
    ["已报价客户", snapshot?.customer.quoted],
    ["已成交客户", snapshot?.customer.won],
    ["跟进已发送", snapshot?.customer.outreachSent],
    ["跟进失败", snapshot?.customer.outreachFailed],
  ] as Array<[string, BusinessMetric | undefined]>;
  const contentMetrics = [
    ["真实发布", snapshot?.content.publishedPosts],
    ["内容曝光", platformMetric("views")],
    ["点赞", platformMetric("likes")],
    ["评论", platformMetric("comments")],
    ["分享", platformMetric("shares")],
    ["完成作品", snapshot?.content.completedWorks],
    ["内容询盘", snapshot?.content.inquiries],
    ["内容成交", snapshot?.content.deals],
  ] as Array<[string, BusinessMetric | undefined]>;
  const customerMetrics = [
    ["客户总量", snapshot?.customer.total],
    ["内容归因客户", snapshot?.customer.attributed],
    ["高意向客户", snapshot?.customer.highIntent],
    ["已报价客户", snapshot?.customer.quoted],
    ["已成交客户", snapshot?.customer.won],
    ["跟进草稿", snapshot?.customer.followupDrafts],
    ["跟进已发送", snapshot?.customer.outreachSent],
    ["跟进失败", snapshot?.customer.outreachFailed],
  ] as Array<[string, BusinessMetric | undefined]>;
  const metrics = businessLine === "content_growth" ? contentMetrics : businessLine === "customer_conversion" ? customerMetrics : fullFunnelMetrics;
  const counts =
    (businessLine === "full_funnel" ? liveReview?.statusCounts : undefined) ||
    lineTasks.reduce<Record<string, number>>(
      (acc, task) => ({ ...acc, [task.status]: (acc[task.status] || 0) + 1 }),
      {},
    );
  const blocked: Array<{
    taskId?: string;
    taskKey?: string;
    title: string;
    status: string;
    reason?: string;
    blockedReason?: string;
    updatedAt?: string;
  }> = liveReview
    ? liveReview.blockedTasks.filter((item) => businessLine === "full_funnel" || lineTasks.some((task) => task.id === item.taskId || task.task_key === item.taskKey))
    : lineTasks
      .filter(
        (task) => task.status === "failed" || Boolean(task.blocked_reason),
      )
      .map((task) => ({
        taskId: task.id,
        taskKey: task.task_key,
        title: task.title,
        status: task.status,
        reason: task.blocked_reason,
        updatedAt: task.updated_at,
      }));
  const completedCount = counts.succeeded || counts.completed || 0;
  const activeCount =
    (counts.running || 0) +
    (counts.waiting_external || 0) +
    (counts.waiting_approval || 0) +
    (counts.handed_off || 0);
  const numeric = (metric?: BusinessMetric) => metric?.status === "available" && metric.value !== null ? Number(metric.value) : null;
  const views = numeric(snapshot?.social.views);
  const inquiries = numeric(snapshot?.content.inquiries);
  const highIntent = numeric(snapshot?.customer.highIntent);
  const quoted = numeric(snapshot?.customer.quoted);
  const won = numeric(snapshot?.customer.won);
  const conversionStages = [
    { label: "曝光 → 询盘", from: views, to: inquiries },
    { label: "询盘 → 高意向", from: inquiries, to: highIntent },
    { label: "高意向 → 报价", from: highIntent, to: quoted },
    { label: "报价 → 成交", from: quoted, to: won },
  ].map((item) => ({ ...item, rate: item.from && item.to !== null ? item.to / item.from : null }));
  const measuredStages = conversionStages.filter((item): item is typeof item & { rate: number } => item.rate !== null);
  const bottleneck = measuredStages.length ? [...measuredStages].sort((left, right) => left.rate - right.rate)[0] : null;
  const bestPlatform = snapshot?.social.platformBreakdown
    .filter((item) => item.views !== null)
    .sort((left, right) => Number(right.views) - Number(left.views))[0];
  const headline = businessLine === "content_growth"
    ? views !== null ? `内容曝光已形成规模，下一步要把 ${views.toLocaleString()} 次曝光转成更多有效询盘` : "内容增长数据尚未完整回流"
    : businessLine === "customer_conversion"
      ? highIntent !== null ? `${highIntent} 个高意向客户中已有 ${quoted ?? "—"} 个报价，成交承接是本周重点` : "客户转化数据尚未完整回流"
      : won !== null ? `本周已形成 ${won} 个成交，${bottleneck ? `${bottleneck.label} 是当前最弱环节` : "完整转化链路仍待回流"}` : "经营链路数据尚未完整回流";
  const conclusionCards = [
    {
      label: "本周结果",
      value: businessLine === "content_growth" ? `${snapshot?.content.publishedPosts.value ?? "—"} 条发布 · ${views?.toLocaleString() ?? "—"} 曝光` : businessLine === "customer_conversion" ? `${won ?? "—"} 个成交 · ${quoted ?? "—"} 个报价` : `${views?.toLocaleString() ?? "—"} 曝光 · ${won ?? "—"} 成交`,
      detail: data.goal ? "已与本周目标对照；只采用已回流指标" : "只采用已回流业务数据",
      tone: "emerald",
    },
    {
      label: "核心瓶颈",
      value: bottleneck ? bottleneck.label : "数据不足",
      detail: bottleneck ? `本周转化率 ${(bottleneck.rate * 100).toFixed(bottleneck.rate < 0.01 ? 2 : 1)}%` : "补齐相邻阶段数据后自动判断",
      tone: "amber",
    },
    {
      label: "增长机会",
      value: bestPlatform ? `${contentPlatformLabel[bestPlatform.platform as ContentPlatform] || bestPlatform.platform} 表现领先` : "平台数据不足",
      detail: bestPlatform && bestPlatform.views !== null ? `${bestPlatform.views.toLocaleString()} 次曝光，可继续验证选题与询盘效率` : "等待平台回执",
      tone: "blue",
    },
  ];
  const nextActions = businessLine === "content_growth" ? [
    { owner: "内容 Agent", action: bestPlatform ? `复用 ${contentPlatformLabel[bestPlatform.platform as ContentPlatform]} 的高效选题结构，生成 3 组 A/B 草稿` : "先取得至少一个已授权平台的真实发布与曝光回执，再生成平台 A/B 草稿", outcome: bestPlatform ? "提升曝光到询盘效率" : "建立可量化的内容基线", approval: "发布前审批" },
    { owner: "行业 Agent", action: "缩小泛行业采集范围，增加采购场景与买家痛点关键词", outcome: "提高有效选题占比", approval: "范围扩大时审批" },
    { owner: "经营 Agent", action: "按平台核对内容询盘归因，淘汰只有曝光没有询盘的主题", outcome: "聚焦可转化内容", approval: "无需新增对外动作" },
  ] : businessLine === "customer_conversion" ? [
    { owner: "客服 Agent", action: "优先处理已报价未成交客户，按阻塞原因生成逐客跟进草稿", outcome: "提高报价到成交率", approval: "发送前审批" },
    { owner: "客服 Agent", action: "补齐高意向客户的预算、采购时间和决策角色", outcome: "减少无效报价", approval: "不自动承诺价格" },
    { owner: "经营 Agent", action: "复盘成交客户的来源内容与跟进节奏", outcome: "形成可复用转化路径", approval: "沉淀前确认" },
  ] : [
    { owner: "经营 Agent", action: `优先修复“${bottleneck?.label || "数据回流"}”环节，并建立下周单独目标`, outcome: "改善全链路最弱转化率", approval: "目标变更需审批" },
    { owner: "内容 Agent", action: bestPlatform ? `围绕 ${contentPlatformLabel[bestPlatform.platform as ContentPlatform]} 复制高效内容结构` : "先连接发布账号并取得真实曝光与询盘回执，不在无数据时指定领先平台", outcome: bestPlatform ? "扩大有效流量入口" : "建立平台效果基线", approval: "发布前审批" },
    { owner: "客服 Agent", action: "对高意向与已报价客户分别生成跟进策略", outcome: "推动询盘进入成交", approval: "发送与商业承诺审批" },
  ];
  return (
    <div className="space-y-5">
      {data.deliveries && <section className="rounded-3xl border border-slate-200 bg-white p-5">
        <h2 className="font-black text-slate-950">交付结果与经营效果</h2>
        <p className="mt-1 text-xs text-slate-500">按实际交付对象查看结果；未回流的经营指标显示为待回收。</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {data.deliveries.filter(card => card.column === "done" && card.taskIds.some(id => lineTasks.some(task => task.id === id))).slice(0, 8).map(card => <button key={card.id} type="button" onClick={() => onGoLive(card.taskId, card.id)} className="rounded-xl border border-slate-100 p-3 text-left hover:bg-slate-50"><p className="text-xs font-bold text-slate-800">{card.title}</p><p className="mt-1 text-[11px] text-slate-500">{card.subject} · {card.effect || "业务结果已交付"}</p><p className="mt-2 text-[11px] text-slate-600">{card.metrics.map(metric => `${metric.label}：${metric.value === null ? "待回收" : metric.value}`).join(" · ") || "查看交付记录"}</p></button>)}
        </div>
        {!data.deliveries.some(card => card.column === "done" && card.taskIds.some(id => lineTasks.some(task => task.id === id))) && <p className="mt-3 text-xs text-slate-400">当前范围尚无已交付结果。</p>}
      </section>}

      <section className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-[10px] font-black text-emerald-300"><TrendingUp size={14}/>经营 Agent 结论</div>
            <h2 className="mt-3 text-xl font-black leading-snug">{headline}</h2>
          </div>
          <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-[10px] font-bold text-slate-300">基于本周回执</span>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {conclusionCards.map((item) => <div key={item.label} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4"><p className={`text-[10px] font-black ${item.tone === "amber" ? "text-amber-300" : item.tone === "blue" ? "text-blue-300" : "text-emerald-300"}`}>{item.label}</p><p className="mt-2 text-sm font-black text-white">{item.value}</p><p className="mt-1 text-[10px] leading-4 text-slate-400">{item.detail}</p></div>)}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50/60 p-5">
          <p className="text-[10px] font-black text-emerald-700">已被数据支持的判断</p>
          <h2 className="mt-2 text-sm font-black text-slate-950">经营归因</h2>
          <ul className="mt-3 space-y-2 text-[11px] leading-5 text-slate-600">
            <li>• {bottleneck ? `${bottleneck.label} 转化率最低，是当前最优先的量化瓶颈。` : "相邻阶段数据不足，暂不能判断主瓶颈。"}</li>
            <li>• {bestPlatform && bestPlatform.views !== null ? `${contentPlatformLabel[bestPlatform.platform as ContentPlatform]} 曝光最高，但仍需结合询盘归因判断真实质量。` : "平台表现尚无完整回执。"}</li>
            <li>• 已成交、报价与高意向数量只作为结果证据，不直接推断内容或话术是唯一原因。</li>
          </ul>
        </div>
        <div className="rounded-3xl border border-amber-200 bg-amber-50/60 p-5">
          <p className="text-[10px] font-black text-amber-700">下一轮必须验证</p>
          <h2 className="mt-2 text-sm font-black text-slate-950">尚未证明的原因</h2>
          <ul className="mt-3 space-y-2 text-[11px] leading-5 text-slate-600">
            <li>• 选题、发布时间、素材形式分别贡献了多少转化。</li>
            <li>• 客户未报价或未成交是预算、时机、产品匹配还是跟进策略导致。</li>
            <li>• {snapshot?.dataGaps.length ? `当前仍有 ${snapshot.dataGaps.length} 项数据缺口需要补齐。` : "通过下周 A/B 任务继续验证，而不是直接写入长期规则。"}</li>
          </ul>
        </div>
      </section>

      <section className="rounded-3xl border border-blue-200 bg-blue-50/50 p-5">
        <div className="flex items-center gap-2"><Target size={18} className="text-blue-700"/><h2 className="font-black text-slate-950">下周优先动作</h2></div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {nextActions.map((item, index) => <div key={item.action} className="rounded-2xl border border-blue-100 bg-white p-4"><div className="flex items-center justify-between gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-700 text-[9px] font-black text-white">P{index + 1}</span><span className="text-[9px] font-bold text-violet-700">{item.owner}</span></div><p className="mt-3 text-xs font-black leading-5 text-slate-900">{item.action}</p><p className="mt-2 text-[10px] text-slate-500">预期：{item.outcome}</p><p className="mt-1 text-[9px] text-amber-700">边界：{item.approval}</p></div>)}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FileCheck2 size={20} className="text-emerald-700" />
              <h2 className="font-black text-slate-950">结论依据 · {businessLineLabel[businessLine]}</h2>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              每项按“已取得 / 等待回流 / 暂不可用”（available / pending /
              unavailable）呈现；缺失不会显示为 0。
              {businessLine === "content_growth" ? ` 当前平台：${contentPlatformLabel[contentPlatform]}。` : ""}
            </p>
          </div>
          <span className="text-[10px] text-slate-400">
            {snapshot
              ? `${new Date(snapshot.range.startsAt).toLocaleDateString("zh-CN")}—${new Date(snapshot.range.endsAt).toLocaleDateString("zh-CN")}`
              : "周快照待接入"}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {metrics.map(([label, metric]) => (
            <BusinessMetricCard key={label} label={label} metric={metric} />
          ))}
        </div>
      </section>
      {generatedReview ? (
        <section className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-blue-50 p-6 shadow-sm">
          <div className="flex items-center gap-2 text-emerald-800">
            <FileCheck2 size={21} />
            <h2 className="text-lg font-black">工作流复盘已生成</h2>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            这是任务运行质量，不替代上方业务结果。
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["目标闭环", generatedReview.summary.completionRate],
              ["自动完成率", generatedReview.summary.automationRate],
              ["审批率", generatedReview.summary.approvalRate],
              ["接管率", generatedReview.summary.handoffRate],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-2xl border border-white bg-white/80 p-4"
              >
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 text-2xl font-black text-slate-950">
                  {value}%
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl bg-white/80 p-4">
              <p className="text-xs font-bold text-slate-700">关键成果</p>
              <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
                {generatedReview.summary.highlights.map((item) => (
                  <li key={item} className="flex gap-2">
                    <CheckCircle2
                      size={14}
                      className="mt-0.5 shrink-0 text-emerald-600"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl bg-white/80 p-4">
              <p className="text-xs font-bold text-slate-700">下一周建议</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                {generatedReview.summary.nextGoalSuggestion}
              </p>
            </div>
          </div>
        </section>
      ) : liveReview || data.run ? (
        <section className="rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-violet-50 p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-blue-800">
                <Activity size={19} />
                <h2 className="font-black">本轮仍在运行：阶段性复盘</h2>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                这是当前时点的生产状态，只有运行结束并生成复盘后才会形成最终结论。
              </p>
            </div>
            <button
              type="button"
              onClick={() => onGoLive(blocked[0]?.taskId)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-3 py-2 text-xs font-bold text-white"
            >
              前往生产现场 <ArrowRight size={12} />
            </button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl bg-white/85 p-4">
              <p className="text-[10px] font-bold text-slate-400">开始</p>
              <p className="mt-1 text-xs font-black text-slate-800">
                {data.run?.started_at
                  ? new Date(data.run.started_at).toLocaleString("zh-CN")
                  : liveReview?.startedAt
                    ? new Date(liveReview.startedAt).toLocaleString("zh-CN")
                    : "时间待回写"}
              </p>
            </div>
            <div className="rounded-2xl border border-blue-100 bg-white p-4">
              <p className="text-[10px] font-bold text-blue-600">当前时点</p>
              <p className="mt-1 text-xs font-black text-slate-800">
                已完成 {completedCount} 项 · 推进中 {activeCount} 项
              </p>
            </div>
            <div className="rounded-2xl bg-white/85 p-4">
              <p className="text-[10px] font-bold text-slate-400">计划收束</p>
              <p className="mt-1 text-xs font-black text-slate-800">
                {data.goal?.endsAt
                  ? new Date(data.goal.endsAt).toLocaleDateString("zh-CN")
                  : "以本轮目标为准"}
              </p>
            </div>
          </div>
          {blocked.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-red-100 bg-red-50/70 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-black text-red-800">
                  当前阻塞 {blocked.length} 项
                </p>
                <span className="text-[10px] text-red-600">
                  需要处理后才会继续
                </span>
              </div>
              <div className="mt-2 space-y-2">
                {blocked.map((item) => (
                  <button
                    key={item.taskId || item.taskKey || item.title}
                    type="button"
                    onClick={() => onGoLive(item.taskId)}
                    className="flex w-full items-start justify-between gap-3 rounded-xl bg-white px-3 py-2.5 text-left"
                  >
                    <span>
                      <span className="block text-xs font-bold text-slate-800">
                        {item.title}
                      </span>
                      <span className="mt-0.5 block text-[10px] text-red-700">
                        {item.reason ||
                          item.blockedReason ||
                          "等待人工选择恢复方式"}
                      </span>
                    </span>
                    <ArrowRight
                      size={13}
                      className="mt-0.5 shrink-0 text-red-500"
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700">
              当前未发现阻塞任务，业务数据仍会随真实回执继续更新。
            </p>
          )}
          {(liveReview?.dataGaps || []).length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold text-slate-700">阶段性数据缺口</p>
              <ul className="mt-2 space-y-1.5">
                {liveReview?.dataGaps.map((gap) => (
                  <li key={gap} className="text-[11px] text-slate-600">
                    • {gap}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : (
        <section className="rounded-3xl border border-dashed border-amber-200 bg-amber-50/50 px-5 py-10 text-center">
          <Clock3 size={22} className="mx-auto text-amber-600" />
          <p className="mt-2 text-sm font-bold text-amber-900">
            工作流复盘等待生成
          </p>
          <p className="mt-1 text-xs text-amber-700">
            当前没有复盘记录，因此不展示 0% 或推算值。
          </p>
        </section>
      )}
      <section className="rounded-3xl border border-violet-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2"><Layers3 size={19} className="text-violet-700"/><h2 className="font-black text-slate-950">方法论沉淀 · {businessLineLabel[businessLine]}</h2></div>
            <p className="mt-1 text-xs text-slate-500">从本周真实结果中提取候选经验；不会自动改写 Agent 长期规则。</p>
          </div>
          <button type="button" onClick={onOpenRules} className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700">进入 Agent 设置确认</button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {businessLine === "content_growth" ? [
            `${contentPlatformLabel[contentPlatform]} 的选题与格式表现结论`,
            "从曝光、互动到询盘的内容转化规律",
            "可复用的采集关键词、发布节奏和内容模板",
          ] : businessLine === "customer_conversion" ? [
            "高意向客户的共性标签与识别信号",
            "报价与跟进节奏对成交的影响",
            "需要固化的话术、转人工条件与审批边界",
          ] : [
            "流量到成交的最主要漏损点",
            "内容、客服与经营 Agent 的协同效率",
            "下周目标、资源和审批规则的调整候选",
          ].map((item, index) => <div key={item} className="rounded-2xl bg-violet-50/70 p-4"><p className="text-[10px] font-black text-violet-600">候选 {index + 1}</p><p className="mt-2 text-xs font-bold leading-relaxed text-slate-700">{item}</p><p className="mt-2 text-[9px] text-slate-400">待真实数据支撑并人工确认</p></div>)}
        </div>
      </section>
    </div>
  );
}

export default function DigitalEmployeePage({
  onNavigate,
  onOpenMonitor,
}: {
  onNavigate?: (page: BusinessDestination) => void;
  onOpenMonitor?: () => void;
}) {
  const [data, setData] = useState<DigitalEmployeeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [newGoal, setNewGoal] = useState(false);
  const [approvalNote, setApprovalNote] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [deliveryFocus, setDeliveryFocus] = useState<{ id: string; request: number }>();
  const [viewGoalId, setViewGoalId] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("today");
  const [businessLine, setBusinessLine] = useState<BusinessLine>("full_funnel");
  const [contentPlatform, setContentPlatform] = useState<ContentPlatform>("all");
  const [navigationNotice, setNavigationNotice] = useState("");
  const goalPanelRef = useRef<HTMLDivElement>(null);
  const approvalPanelRef = useRef<HTMLDivElement>(null);
  const overviewRequestVersionRef = useRef(0);
  const presentedData = data;

  const load = async (goalId = viewGoalId) => {
    const requestVersion = ++overviewRequestVersionRef.current;
    try {
      const next = await digitalEmployeeApi.overview(goalId);
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
    const returnContext = consumeDigitalEmployeeReturnContext();
    void load().then(next => {
      if (!returnContext || !next?.tasks.some(task => task.id === returnContext.taskId && task.run_id === returnContext.runId)) return;
      setWorkspaceView("live");
      setSelectedTaskId(returnContext.taskId);
      if (returnContext.deliveryId) setDeliveryFocus({ id: returnContext.deliveryId, request: Date.now() });
      setNavigationNotice("已回到原任务的生产现场，运行与任务位置已恢复。");
    });
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
        const requestVersion = ++overviewRequestVersionRef.current;
        void digitalEmployeeApi
          .overview()
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
  const selectedPlanTask = data?.plan?.tasks.find(
    (task) => task.key === selectedTask?.task_key,
  );
  const agentCards = useMemo(() => data?.agents || [], [data?.agents]);
  const terminal = Boolean(
    data?.run && ["succeeded", "failed", "cancelled"].includes(data.run.status),
  );
  const activeRun = Boolean(data?.run && !terminal);
  const canCreateNextGoal = Boolean(
    goal &&
      ["completed", "cancelled"].includes(goal.status) &&
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

  const scrollTo = (target: React.RefObject<HTMLDivElement | null>) => {
    window.setTimeout(
      () =>
        target.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      50,
    );
  };

  const openBusiness: OpenBusinessLink = (page, view, businessRef = {}) => {
    const planTask = data?.plan?.tasks.find(
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

  const saveConfig = async (config: DigitalEmployeeConfig) => {
    const firstLogin = !data?.config;
    const next = await act("config", () =>
      digitalEmployeeApi.completeOnboarding(config),
    );
    if (next && firstLogin) {
      setWorkspaceView("today");
      setNewGoal(!next.goal);
      scrollTo(goalPanelRef);
    }
  };

  const saveGoal = async (goalInput: GoalDraft) => {
    const next = await act("goal", () =>
      digitalEmployeeApi.createGoal(goalInput),
    );
    if (next) {
      setNewGoal(false);
      window.setTimeout(
        () =>
          approvalPanelRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        80,
      );
    }
  };

  const approveCurrentGoal = async () => {
    if (!goal || approvalBlocked) return;
    const next = await act("approve-goal", () =>
      digitalEmployeeApi.approveGoal(goal.id),
    );
    if (next) {
      setWorkspaceView("live");
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
        (task) => task.status === "failed" || Boolean(task.blocked_reason),
      )
    )
      setSelectedTaskId(
        data.tasks.find(
          (task) => task.status === "failed" || Boolean(task.blocked_reason),
        )!.id,
      );
    setWorkspaceView("live");
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
      <div className="flex h-full items-center justify-center bg-slate-50">
        <Loader2 size={24} className="animate-spin text-emerald-600" />
      </div>
    );

  return (
    <div className="h-full overflow-y-auto bg-[#f5f7fb]">
      <div className="mx-auto max-w-[1500px] px-5 pb-8 pt-6 lg:px-8">
        <header className="rounded-3xl bg-slate-950 px-6 py-6 text-white shadow-xl shadow-slate-200/70">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
                <Sparkles size={15} /> LingShu Digital Workforce
              </div>
              <h1 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">
                数字员工经营驾驶舱
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
                从内容生产到客户承接，每个状态都来自服务端任务、业务快照或真实渠道回执。
              </p>
            </div>
            {data?.config && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">
                  {data.config.companyName}
                </span>
                <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-emerald-200">
                  {autonomyLabel[data.config.autonomyMode]}模式
                </span>
                <span className="rounded-full border border-blue-300/30 bg-blue-300/10 px-3 py-1.5 text-blue-100">
                  {operatingState} · {cycleLabel}
                </span>
                <button
                  onClick={() => setWorkspaceView("rules")}
                  className={`rounded-full border px-3 py-1.5 ${workspaceView === "rules" ? "border-emerald-300 bg-emerald-300/15 text-emerald-100" : "border-white/15 text-slate-200 hover:bg-white/10"}`}
                >
                  <Settings2 size={13} className="mr-1 inline" />
                  调整 Agent 边界
                </button>
                <button
                  onClick={() => {
                    setWorkspaceView("today");
                    setShowHistory((value) => !value);
                  }}
                  className="rounded-full border border-white/15 px-3 py-1.5 text-slate-200 hover:bg-white/10"
                >
                  <History size={13} className="mr-1 inline" />
                  历史记录
                </button>
              </div>
            )}
          </div>
          {!data?.config && <div className="mt-5 inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-100"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] text-slate-950">1</span>{operatingState}</div>}
        </header>

        {data?.config && <nav
          aria-label="数字员工工作视图"
          className="mt-4 grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-white p-1.5"
        >
          {workspaceViews.map((view) => {
            const pendingCount = data.approvals.filter((item) => item.status === "pending").length;
            const caption = view.id === "live" && pendingCount ? `${pendingCount} 项待处理 · 任务与纠偏` : view.id === "review" && !data.review ? "数据积累中" : view.caption;
            return <button
              key={view.id}
              type="button"
              onClick={() => setWorkspaceView(view.id)}
              aria-current={workspaceView === view.id ? "page" : undefined}
              className={`rounded-xl px-3 py-2.5 text-left transition ${workspaceView === view.id ? "bg-slate-950 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
            >
              <span className="block text-xs font-black">{view.label}</span>
              <span
                className={`mt-0.5 block text-[10px] ${workspaceView === view.id ? "text-slate-300" : "text-slate-400"}`}
              >
                {caption}
              </span>
            </button>;
          })}
        </nav>}
        {data?.config && workspaceView !== "rules" && <><OperatingContextBar data={presentedData || data}/><BusinessLineNav value={businessLine} platform={contentPlatform} onChange={setBusinessLine} onPlatformChange={setContentPlatform}/></>}
        {navigationNotice && (
          <div
            role="status"
            className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-800"
          >
            <span className="flex items-center gap-2">
              <ChevronLeft size={15} />
              {navigationNotice}
            </span>
            <button
              type="button"
              onClick={() => setNavigationNotice("")}
              aria-label="关闭返回提示"
            >
              <XCircle size={16} />
            </button>
          </div>
        )}
        {error && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span className="flex items-center gap-2">
              <AlertTriangle size={16} />
              {error}
            </span>
            <button onClick={() => setError("")}>
              <XCircle size={17} />
            </button>
          </div>
        )}

        {!data?.config && (
          <div className="mt-5">
            <OnboardingPanel
              initial={EMPTY_CONFIG}
              readiness={data?.businessSnapshot?.readiness || []}
              busy={Boolean(busy)}
              onOpenReadiness={openReadiness}
              onSave={(config) => void saveConfig(config)}
            />
          </div>
        )}

        {data?.config && workspaceView === "today" && (
          <div className="mt-5 space-y-5">
            {viewGoalId && (
              <section className="rounded-3xl border border-violet-200 bg-violet-50 p-5">
                <p className="text-sm font-black text-violet-900">
                  正在只读查看历史运行
                </p>
                <p className="mt-1 text-xs text-violet-700">
                  可以查看业务证据和复盘，但不会在历史目标上启动、审批或控制任务。
                </p>
              </section>
            )}
            {(!newGoal || Boolean(goal)) && <TodaySnapshotPanel
              data={presentedData || data}
              onConnect={() => openBusiness("accountManagement")}
              businessLine={businessLine}
              contentPlatform={contentPlatform}
              onManageGoal={() => {
                if (activeRun) { setWorkspaceView("live"); return; }
                setNewGoal(true);
                scrollTo(goalPanelRef);
              }}
              rangeBusy={busy === "overview-range"}
              onPeriodChange={(period) => {
                setBusy("overview-range");
                setError("");
                void digitalEmployeeApi.overview(viewGoalId, overviewRange(period))
                  .then(setData)
                  .catch((rangeError) => setError(rangeError instanceof Error ? rangeError.message : "经营数据加载失败"))
                  .finally(() => setBusy(""));
              }}
            />}
            {showHistory && (
              <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                  <div className="flex items-center gap-2">
                    <History size={18} className="text-violet-600" />
                    <div>
                      <h2 className="text-sm font-black text-slate-950">
                        历史工作
                      </h2>
                      <p className="text-[11px] text-slate-400">
                        历史运行只读，不会自动推进任务状态
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowHistory(false)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-50"
                  >
                    <XCircle size={17} />
                  </button>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                  {data.goals.map((historyGoal, index) => (
                    <button
                      key={historyGoal.id}
                      type="button"
                      onClick={() => void openGoal(historyGoal.id)}
                      className={`rounded-2xl border p-4 text-left transition hover:border-violet-300 ${data.goal?.id === historyGoal.id ? "border-violet-300 bg-violet-50/50" : "border-slate-200"}`}
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
                    </button>
                  ))}
                </div>
              </section>
            )}
            {viewGoalId && (
              <button
                type="button"
                onClick={() => void returnToLatest()}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600"
              >
                <ChevronLeft size={14} />
                返回最近一轮工作
              </button>
            )}
            {!viewGoalId && newGoal && !activeRun && (
              <div ref={goalPanelRef} className="scroll-mt-24">
                <GoalPanel
                  config={data.config}
                  busy={Boolean(busy)}
                  businessLine={businessLine}
                  contentPlatform={contentPlatform}
                  onSave={(goalInput) => void saveGoal(goalInput)}
                />
              </div>
            )}
            {!viewGoalId && goal?.status === "draft" && data.plan && (
              <DraftPlanPreview plan={data.plan} onOpen={openBusiness} />
            )}
            {!viewGoalId && goal?.status === "draft" && (
              <section ref={approvalPanelRef} className="scroll-mt-24 rounded-3xl border border-blue-200 bg-gradient-to-r from-blue-50 to-white p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-[10px] font-black text-blue-700">本周计划待启动</p>
                    <h2 className="mt-1 font-black text-slate-950">{data.plan ? `${data.plan.tasks.length} 个任务已编排` : "计划正在生成"}</h2>
                    <p className="mt-1 text-xs text-slate-600">{approvalBlocked ? firstMissingReadiness?.note || "仍有必需业务资产未就绪" : "业务资产已就绪；批准后进入执行中心。"}</p>
                  </div>
                  {approvalBlocked && firstMissingReadiness ? <button type="button" onClick={() => openReadiness(firstMissingReadiness)} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-3 text-xs font-bold text-blue-700">补齐{firstMissingReadiness.label}<ArrowRight size={14}/></button> : <button disabled={Boolean(busy) || !data.plan} onClick={() => void approveCurrentGoal()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{busy === "approve-goal" ? <Loader2 size={16} className="animate-spin"/> : <Play size={16}/>}批准并启动</button>}
                </div>
              </section>
            )}
            {!viewGoalId && goal && goal.status !== "draft" && (
              <div className="flex flex-col items-end gap-2">
                {canCreateNextGoal ? (
                  <button
                    onClick={() => {
                      setNewGoal(true);
                      scrollTo(goalPanelRef);
                    }}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-xs font-bold text-white"
                  >
                    <Target size={14} />
                    制定下一周目标
                  </button>
                ) : (
                  <p className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-500">
                    本轮目标仍在执行；完成或取消当前运行后才能制定下一周目标。
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {data?.config && workspaceView === "live" && (
          <div className="mt-5 space-y-5">
            {data.plan && (
              <DeliveryBoard
                tasks={data.run ? visibleTasks : []}
                deliveries={data.deliveries}
                focus={deliveryFocus}
                notice={data.deliveryNotice}
                goalTitle={data.goal?.title || "当前经营目标"}
                events={data.events}
                onSelectTask={setSelectedTaskId}
                onOpenTask={dispatchDigitalEmployeeDeepLink}
                onOpenMonitor={onOpenMonitor}
              />
            )}
            {!data.run && (
              <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-blue-200 bg-blue-50/50 px-5 py-4">
                <div className="flex items-center gap-3"><Radio size={20} className="shrink-0 text-blue-600" /><div><p className="text-sm font-bold text-blue-900">生产现场尚未启动</p><p className="mt-0.5 text-xs text-blue-700">批准计划后，这里会展示业务任务的真实进展与交付结果。</p></div></div>
                <button
                  onClick={() => setWorkspaceView("today")}
                  className="rounded-xl bg-blue-700 px-4 py-2 text-xs font-bold text-white"
                >
                  返回计划预览
                </button>
              </section>
            )}
            {data.plan && data.run && (
              <>
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
                <div className="space-y-5">
                  <div id="task-production-scene" className="relative scroll-mt-6">
                    <button
                      onClick={() => void load()}
                      title="刷新生产现场"
                      className="absolute right-5 top-5 z-10 rounded-lg border border-slate-200 bg-white p-2 text-slate-500 shadow-sm"
                    >
                      <RefreshCcw size={15} />
                    </button>
                    <ProductionScene
                      task={selectedTask}
                      planTask={selectedPlanTask}
                      runId={data.run.id}
                      events={data.events}
                      readOnly={Boolean(viewGoalId)}
                      correcting={busy === `correct-${selectedTask?.id}`}
                      controlling={Boolean(
                        selectedTask &&
                          [
                            `retry-${selectedTask.id}`,
                            `skip-${selectedTask.id}`,
                            `complete-${selectedTask.id}`,
                          ].includes(busy),
                      )}
                      onOpenTask={dispatchDigitalEmployeeDeepLink}
                      onCorrect={async (input) =>
                        Boolean(
                          selectedTask &&
                            (await act(`correct-${selectedTask.id}`, () =>
                              digitalEmployeeApi.correctTask(
                                selectedTask.id,
                                input,
                              ),
                            )),
                        )
                      }
                      onRetry={async () =>
                        Boolean(
                          selectedTask &&
                            (await act(`retry-${selectedTask.id}`, () =>
                              digitalEmployeeApi.retryTask(selectedTask.id),
                            )),
                        )
                      }
                      onSkip={async (note) =>
                        Boolean(
                          selectedTask &&
                            (await act(`skip-${selectedTask.id}`, () =>
                              digitalEmployeeApi.skipTask(
                                selectedTask.id,
                                note,
                              ),
                            )),
                        )
                      }
                      onComplete={async (note) =>
                        Boolean(
                          selectedTask &&
                            (await act(`complete-${selectedTask.id}`, () =>
                              digitalEmployeeApi.completeTask(
                                selectedTask.id,
                                note,
                              ),
                            )),
                        )
                      }
                    />
                  </div>
                </div>
                <aside className="space-y-5">
                  <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2">
                      <Users size={19} className="text-blue-600" />
                      <h2 className="font-bold text-slate-950">数字员工团队</h2>
                    </div>
                    <div className="mt-4 space-y-3">
                      {agentCards.map((agent) => (
                        <div
                          key={agent.role}
                          className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-3"
                        >
                          <Bot size={17} />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-slate-800">
                              {agentLabel[agent.role] || "业务 Agent"}
                            </p>
                            <p className="truncate text-[10px] text-slate-400">
                              {agent.currentTask ||
                                `${agent.completed}/${agent.total} 个任务完成`}
                            </p>
                          </div>
                          <Badge status={agent.status} />
                        </div>
                      ))}
                    </div>
                  </section>
                  {!viewGoalId && pendingApproval && approvalTask && (
                    <section id="delivery-approval" className="scroll-mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5">
                      <div className="flex items-center gap-2 text-amber-800">
                        <ShieldCheck size={19} />
                        <h2 className="font-bold">待我审批</h2>
                      </div>
                      <p className="mt-3 text-sm font-bold text-slate-900">
                        {approvalTask.title}
                      </p>
                      <p className="mt-2 text-xs text-slate-600">
                        {pendingApproval.action_summary}
                      </p>
                      {approvalTask.task_key === "followup_batch_approval" && <div className="mt-3 max-h-80 space-y-2 overflow-auto rounded-xl border border-amber-200 bg-white p-3"><p className="text-xs font-bold text-amber-900">本次审批覆盖整个批次，请核对以下逐客草稿</p>{(data.deliveries || []).filter(card => card.kind === "客服草稿" && card.taskIds.includes(approvalTask.id)).map(card => <details key={card.id} className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-bold text-slate-800">{card.subject} · {card.stage}</summary><p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-600">{card.artifacts.find(artifact => artifact.id === "draft")?.text || "草稿尚未就绪"}</p>{card.reason && <p className="mt-2 text-xs text-amber-700">{card.reason}</p>}</details>)}</div>}
                      {pendingPublishingPackage && Array.isArray(pendingPublishingPackage.items) && <div className="mt-3 max-h-72 space-y-2 overflow-auto rounded-xl border border-amber-200 bg-white p-2">{(pendingPublishingPackage.items as Array<Record<string, unknown>>).map((item,index)=><div key={`${String(item.sourceProjectId)}-${String(item.platform)}-${index}`} className="rounded-lg bg-slate-50 p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-black text-slate-900">{String(item.title||`发布项 ${index+1}`)}</p><span className="rounded-md bg-blue-50 px-2 py-1 text-[9px] font-bold text-blue-700">{contentPlatformLabel[String(item.platform) as ContentPlatform]||String(item.platform)}</span></div><dl className="mt-2 grid gap-1 text-[10px] text-slate-600"><div><dt className="inline font-bold">账号：</dt><dd className="inline">{Array.isArray(item.accountLabels)?item.accountLabels.map(String).join("、"):"未绑定"}</dd></div><div><dt className="inline font-bold">文案：</dt><dd className="inline line-clamp-2">{String(item.description||"暂无文案")}</dd></div><div><dt className="inline font-bold">成片：</dt><dd className="inline break-all">{String(item.videoPath||"缺失")}</dd></div><div><dt className="inline font-bold">时间：</dt><dd className="inline">{String(item.scheduledAt||"")}</dd></div></dl></div>)}</div>}
                      <textarea
                        value={approvalNote}
                        onChange={(event) =>
                          setApprovalNote(event.target.value)
                        }
                        className="mt-3 min-h-20 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs"
                        placeholder="审批意见（可选）"
                      />
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void act("approve", () =>
                              digitalEmployeeApi.decideApproval(
                                pendingApproval.id,
                                "approved",
                                approvalNote,
                              ),
                            )
                          }
                          className="rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white"
                        >
                          批准并继续
                        </button>
                        <button
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void act("reject", () =>
                              digitalEmployeeApi.decideApproval(
                                pendingApproval.id,
                                "rejected",
                                approvalNote,
                              ),
                            )
                          }
                          className="rounded-xl border border-red-200 bg-white px-3 py-2.5 text-xs font-bold text-red-700"
                        >
                          驳回
                        </button>
                      </div>
                      <button
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void act("handoff", () =>
                            digitalEmployeeApi.handoffTask(approvalTask.id),
                          )
                        }
                        className="mt-2 w-full rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-xs font-bold text-violet-700"
                      >
                        人工完整接管
                      </button>
                    </section>
                  )}
                  {!viewGoalId && activeHandoff && activeHandoffTask && (
                    <section className="rounded-3xl border border-violet-200 bg-violet-50 p-5">
                      <div className="flex items-center gap-2 text-violet-800">
                        <Hand size={19} />
                        <h2 className="font-bold">人工接管中</h2>
                      </div>
                      <p className="mt-3 text-sm font-bold">
                        {activeHandoffTask.title}
                      </p>
                      <button
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void act("return", () =>
                            digitalEmployeeApi.returnTask(
                              activeHandoffTask.id,
                              "人工核对完成，保持原审批边界继续",
                            ),
                          )
                        }
                        className="mt-4 w-full rounded-xl bg-violet-700 px-3 py-2.5 text-xs font-bold text-white"
                      >
                        交还数字员工
                      </button>
                    </section>
                  )}
                  {data.run && !terminal && !viewGoalId && (
                    <section className="rounded-3xl border border-slate-200 bg-white p-5">
                      <div className="flex items-center gap-2">
                        <Clock3 size={18} />
                        <h2 className="font-bold">运行控制</h2>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        {data.run.status === "paused" ? (
                          <button
                            onClick={() =>
                              void act("resume", () =>
                                digitalEmployeeApi.resumeRun(data.run!.id),
                              )
                            }
                            className="rounded-xl bg-blue-700 px-3 py-2.5 text-xs font-bold text-white"
                          >
                            恢复
                          </button>
                        ) : (
                          <button
                            onClick={() =>
                              void act("pause", () =>
                                digitalEmployeeApi.pauseRun(data.run!.id),
                              )
                            }
                            className="rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold"
                          >
                            暂停
                          </button>
                        )}
                        <button
                          onClick={() =>
                            void act("cancel", () =>
                              digitalEmployeeApi.cancelRun(data.run!.id),
                            )
                          }
                          className="rounded-xl border border-red-200 px-3 py-2.5 text-xs font-bold text-red-700"
                        >
                          取消
                        </button>
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
              onGoLive={(taskId) => goLive(taskId)}
              onOpenRules={() => setWorkspaceView("rules")}
              businessLine={businessLine}
              contentPlatform={contentPlatform}
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
              onSave={(config) => void saveConfig(config)}
            />
            <section className="rounded-3xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <ShieldCheck size={19} className="text-amber-600" />
                <h2 className="font-black text-slate-950">规则生效说明</h2>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-800">仅本次纠偏</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    只影响当前运行，可选择重跑下游。
                  </p>
                </div>
                <div className="rounded-2xl bg-violet-50 p-4">
                  <p className="text-xs font-bold text-violet-800">
                    长期规则候选
                  </p>
                  <p className="mt-1 text-[11px] text-violet-700">
                    先记录候选，审核通过前不会改变自动化规则。
                  </p>
                </div>
                <div className="rounded-2xl bg-amber-50 p-4">
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
