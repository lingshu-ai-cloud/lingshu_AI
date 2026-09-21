import type { MatrixAccountReview } from './weeklyMatrix';
import type { ContinuationPolicy } from './continuationPolicy';
import type { ReviewTodoBoard } from './reviewTodos';
import { type OperatingAssessment } from './operatingMaturity';
import type { WeeklyPackage } from "./weeklyPackage";
import { normalizeVideoPlan, type VideoCreationPlan } from './videoCreationPlan';
import { authHeader } from "./auth";
import type { DirectorDecision, DirectorDecisionReason } from './directorDecision';

export type AutonomyMode = "suggest" | "collaborate" | "managed" | "automatic";
export type DigitalEmployeeAgentRole = "orchestrator" | "business" | "director" | "content" | "customer";

export type PrimaryGoal = "awareness" | "leads" | "sales" | "reactivation";
export type PublishingPlatform = "facebook" | "instagram" | "tiktok" | "youtube";
export interface PublishingTarget {
  platform: PublishingPlatform;
  accountId: string;
  accountLabel: string;
  timezone?: string;
}

export type DigitalEmployeeWorkflow =
  | "scheduled_social"
  | "viral_clone"
  | "product_content"
  | "material_content"
  | "content_publish"
  | "customer_segmentation"
  | "batch_followup";

export type DataAvailability = "available" | "pending" | "unavailable";

export interface DigitalEmployeeConfig {
  continuationPolicy?: ContinuationPolicy;
  operatingMaturity?: "starting" | "growing" | "established";
  operatingAssessment?: OperatingAssessment;
  defaultParticipation?: "agent" | "team";
  videoDefaults?: Partial<VideoCreationPlan>;
  /** Languages generated autonomously for every content order. */
  videoLanguages?: string[];
  companyName: string;
  industry: string;
  primaryBusiness: string;
  targetMarkets: string;
  customerProfile: string;
  autonomyMode: AutonomyMode;
  approvalOwner: string;
  constraints: string[];
  team: string[];
  primaryGoal: PrimaryGoal;
  focusProducts: string;
  enabledWorkflows: DigitalEmployeeWorkflow[];
  socialCadence: string;
  followupCadence: string;
  reviewSchedule: string;
  publishingTargets: PublishingTarget[];
  /** Explicit opt-in for synthesizing missing visuals. Defaults to false. */
  allowGeneratedVisuals: boolean;
  allowRealPublishing: boolean;
  allowRealCustomerMessages: boolean;
  approvalPolicy: {
    contentPublish: boolean;
    batchFollowup: boolean;
    commercialCommitment: boolean;
  };
  agentApprovalPolicies: {
    business: { activatePlan: boolean; changeGoalScope: boolean };
    industry: { addUnverifiedSource: boolean; expandCollectionScope: boolean };
    content: { contentPublish: boolean; factualClaims: boolean };
    customer: { batchFollowup: boolean; commercialCommitment: boolean };
  };
}

export type BusinessLine = "full_funnel" | "content_growth" | "customer_conversion";
export type ContentPlatform = "all" | "facebook" | "instagram" | "tiktok" | "youtube";

export interface WeeklyGoal {
  videoPlans?: VideoCreationPlan[];
  id: string;
  businessLine: "full_funnel" | "content_growth" | "customer_conversion";
  contentPlatforms: Array<"facebook" | "instagram" | "tiktok" | "youtube">;
  title: string;
  objective: string;
  metric: string;
  baseline: number;
  target: number;
  unit: string;
  startsAt: string;
  endsAt: string;
  scope: string;
  constraints: string[];
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlanTask {
  key: string;
  title: string;
  description: string;
  agentRole: DigitalEmployeeAgentRole;
  kind: string;
  sequence: number;
  priority: string;
  requiresApproval: boolean;
  dependsOn: string[];
  expectedMinutes: number;
  businessDomain?:
    | "foundation"
    | "content"
    | "publishing"
    | "customer"
    | "review";
  capabilityKey?: string;
  destination?: BusinessDestination;
  destinationView?: "create" | "publish";
  statusSource?: string;
  executionMode?: "internal" | "observe" | "approval";
  externalEffect?: "none" | "draft" | "schedule" | "publish" | "send";
}

export interface WeeklyPlan {
  businessPackage?: WeeklyPackage;
  id: string;
  status: string;
  strategy: string;
  successCriteria: string[];
  estimatedCost: number;
  estimatedMinutes: number;
  qualityGates: string[];
  riskSummary: string;
  tasks: PlanTask[];
  /** The immutable operating rules captured when this plan was created. */
  configSnapshot?: DigitalEmployeeConfig;
}

/** Legacy snapshots remain authoritative; missing fields must not inherit new permissions. */
export function planConfigForDisplay(snapshot: DigitalEmployeeConfig | undefined, current: DigitalEmployeeConfig): DigitalEmployeeConfig {
  const source = snapshot || current;
  return {
    ...source,
    team: ["orchestrator", "business", "director", "content", "customer"],
    publishingTargets: Array.isArray(source.publishingTargets) ? source.publishingTargets : [],
    enabledWorkflows: Array.isArray(source.enabledWorkflows) ? source.enabledWorkflows : [],
    constraints: Array.isArray(source.constraints) ? source.constraints : [],
    allowRealPublishing: source.allowRealPublishing === true,
    allowRealCustomerMessages: source.allowRealCustomerMessages === true,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * A short, deterministic display identifier for a persisted config snapshot.
 * It is an audit aid, not a security hash or a fabricated database version.
 */
export function digitalEmployeeConfigFingerprint(
  config?: DigitalEmployeeConfig | null,
): string {
  if (!config) return "";
  const source = canonicalJson(config);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `CFG-${(hash >>> 0).toString(16).padStart(8, "0").slice(0, 6).toUpperCase()}`;
}

export interface WorkflowRun {
  id: string;
  goal_id: string;
  plan_id: string;
  status: string;
  current_controller: string;
  pause_reason: string;
  started_at: string;
  completed_at: string;
}

export interface WorkflowTask {
  id: string;
  run_id: string;
  task_key: string;
  title: string;
  description: string;
  agent_role: DigitalEmployeeAgentRole;
  kind: string;
  status: string;
  sequence: number;
  priority: string;
  requires_approval: boolean;
  depends_on: string[];
  output: Record<string, unknown>;
  blocked_reason: string;
  owner_id: string;
  updated_at: string;
  business_line?: "full_funnel" | "content_growth" | "customer_conversion";
  business_domain?: string;
  capability_key?: string;
  destination?: BusinessDestination;
  destination_view?: "create" | "publish";
  status_source?: string;
  execution_mode?: "internal" | "observe" | "approval";
  external_effect?: "none" | "draft" | "schedule" | "publish" | "send";
  business_refs?: Array<Record<string, unknown>>;
  task_version?: number;
  correction_version?: number;
}

export interface BusinessMetric {
  value: number | null;
  status: DataAvailability;
  source: string;
  note?: string;
}

export interface BusinessReadinessItem {
  key:
    | "enterprise"
    | "products"
    | "social_accounts"
    | "viral_library"
    | "content_projects"
    | "customers"
    | "automation";
  label: string;
  status: "ready" | "incomplete" | "empty";
  count: number | null;
  page: string;
  note: string;
}

export interface SnapshotTaskReference {
  id: string;
  title: string;
  status: string;
  taskId?: string;
  runId?: string;
  businessRef?: Record<string, unknown>;
  occurredAt?: string;
}

export interface BusinessSnapshot {
  generatedAt: string;
  range: { startsAt: string; endsAt: string; timeZone: string };
  readiness: BusinessReadinessItem[];
  content: {
    scheduledAutomations: BusinessMetric;
    collectedItems: BusinessMetric;
    exactAnalyses: BusinessMetric;
    contentProjects: BusinessMetric;
    completedWorks: BusinessMetric;
    production?: {
      status: DataAvailability;
      note: string;
      projects: Array<{ id: string; title: string; route: string; digitalPresenter: boolean; platform: string; completed: boolean; approved: boolean; blocked: boolean }>;
    };

    approvedWorks?: BusinessMetric;
    scheduledPosts: BusinessMetric;
    publishedPosts: BusinessMetric;
    failedPosts: BusinessMetric;
    inquiries: BusinessMetric;
    deals: BusinessMetric;
  };
  customer: {
    total: BusinessMetric;
    attributed: BusinessMetric;
    highIntent: BusinessMetric;
    aiAuto: BusinessMetric;
    draftReview: BusinessMetric;
    humanNeeded: BusinessMetric;
    quoted: BusinessMetric;
    won: BusinessMetric;
    segmentSnapshots: BusinessMetric;
    followupDrafts: BusinessMetric;
    outreachBatches: BusinessMetric;
    outreachSent: BusinessMetric;
    outreachFailed: BusinessMetric;
  };
  social: {
    accountCount: BusinessMetric;
    platformCount: BusinessMetric;
    views: BusinessMetric;
    reach: BusinessMetric;
    likes: BusinessMetric;
    comments: BusinessMetric;
    shares: BusinessMetric;
    saves: BusinessMetric;
    profileViews: BusinessMetric;
    platformBreakdown: Array<{ platform: string; accounts: number; views: number | null; likes: number | null; comments: number | null; shares: number | null; status: DataAvailability }>;
    dailyTrend: Array<{ date: string; views: number | null; interactions: number | null }>;
  };
  running?: SnapshotTaskReference[];
  needsDecision?: SnapshotTaskReference[];
  completedToday?: SnapshotTaskReference[];
  next24Hours: Array<{
    id: string;
    kind: "automation" | "publish" | "followup";
    title: string;
    scheduledAt: string;
    scheduleLabel: string;
    page: "scheduled" | "smartAssets" | "conversion";
    status: string;
    businessRef?: Record<string, unknown>;
  }>;
  attribution: {
    attributedCustomers: number;
    postsWithInquiries: number;
    status: DataAvailability;
  };
  dataGaps: string[];
}

export interface RunEvent {
  id: string;
  run_id: string;
  task_id: string;
  sequence: number;
  type: string;
  level: string;
  summary: string;
  payload: Record<string, unknown>;
  occurred_at: string;
}

export interface AgentUiAction {
  kind: "action_started" | "click" | "input" | "navigation" | "screenshot";
  label: string;
  page?: string;
  screenshotUrl?: string;
  x?: number;
  y?: number;
  viewportWidth?: number;
  viewportHeight?: number;
}

export function agentUiActionFromEvent(event: RunEvent): AgentUiAction | null {
  const raw = event.payload?.uiAction;
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const kind = String(item.kind || "");
  if (!["action_started", "click", "input", "navigation", "screenshot"].includes(kind)) return null;
  const numeric = (value: unknown) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  };
  return {
    kind: kind as AgentUiAction["kind"],
    label: String(item.label || event.summary || "未命名操作"),
    page: item.page ? String(item.page) : undefined,
    screenshotUrl: item.screenshotUrl ? String(item.screenshotUrl) : undefined,
    x: numeric(item.x),
    y: numeric(item.y),
    viewportWidth: numeric(item.viewportWidth),
    viewportHeight: numeric(item.viewportHeight),
  };
}

export function agentCursorPercent(action?: AgentUiAction | null): { left: number; top: number } | null {
  if (!action || action.x === undefined || action.y === undefined) return null;
  const width = action.viewportWidth && action.viewportWidth > 0 ? action.viewportWidth : 100;
  const height = action.viewportHeight && action.viewportHeight > 0 ? action.viewportHeight : 100;
  return {
    left: Math.max(2, Math.min(98, (action.x / width) * 100)),
    top: Math.max(4, Math.min(96, (action.y / height) * 100)),
  };
}

export interface ApprovalRequest {
  id: string;
  run_id: string;
  task_id: string;
  status: string;
  action_summary: string;
  risk_level: string;
  evidence: Array<Record<string, unknown>>;
  requested_by_agent: string;
  decided_by: string;
  decision_note: string;
  created_at: string;
  decided_at: string;
}

export interface HandoffSession {
  id: string;
  run_id: string;
  task_id: string;
  status: string;
  taken_by: string;
  snapshot: Record<string, unknown>;
  started_at: string;
  returned_at: string;
}

export interface AgentStatus {
  role: DigitalEmployeeAgentRole;
  status: string;
  currentTask: string;
  completed: number;
  total: number;
}

export interface WeeklyReview {
  id: string;
  status: string;
  summary: {
    matrixPerformance?: MatrixAccountReview[];
    completionRate: number;
    automationRate: number;
    approvalRate: number;
    handoffRate: number;
    completedTasks: number;
    totalTasks: number;
    failedTasks: number;
    highlights: string[];
    nextGoalSuggestion: string;
    knowledgeCandidates: string[];
  };
  created_at: string;
}

export interface LiveWeeklyReview {
  status?: string;
  runId?: string;
  runStatus?: string;
  isLive?: boolean;
  generatedAt?: string;
  totalTasks?: number;
  completedTasks?: number;
  skippedTasks?: number;
  completionRate?: number;
  statusCounts: Record<string, number>;
  blockedTasks: Array<{
    taskId?: string;
    taskKey?: string;
    title: string;
    status: string;
    reason?: string;
    blockedReason?: string;
    updatedAt?: string;
    destination?: BusinessDestination;
    destinationView?: 'create' | 'publish' | '';
    availableActions?: string[];
  }>;
  blockedReasons?: string[];
  businessSnapshot: BusinessSnapshot | null;
  dataGaps: string[];
  sourceStatus?: string;
  startedAt?: string;
  updatedAt?: string;
}

export interface DigitalEmployeeOverview {
  config: DigitalEmployeeConfig | null;
  goals: WeeklyGoal[];
  goal: WeeklyGoal | null;
  plan: WeeklyPlan | null;
  run: WorkflowRun | null;
  tasks: WorkflowTask[];
  deliveries?: import("./delivery").DeliveryResource[];
  deliveryNotice?: string;
  events: RunEvent[];
  approvals: ApprovalRequest[];
  handoffs: HandoffSession[];
  review: WeeklyReview | null;
  liveReview?: LiveWeeklyReview | null;
  agents: AgentStatus[];
  businessSnapshot: BusinessSnapshot | null;
}

export interface FollowupDispatchResponse {
  ok: true;
  worker: {
    mode: "scheduled" | "manual_only";
    running: boolean;
    intervalMs: number;
    maxAttempts: number;
  };
  result: {
    batchId: string;
    claimed: number;
    sent: number;
    partial: number;
    blocked: number;
    retryScheduled: number;
    failed: number;
    future: number;
    counts: Record<string, number>;
  };
  overview: DigitalEmployeeOverview;
}

export type BusinessDestination =
  | "enterprise"
  | "accountManagement"
  | "scheduled"
  | "socialInspiration"
  | "scriptLibrary"
  | "smartAssets"
  | "conversion"
  | "digitalEmployees";

export interface DigitalEmployeeBusinessRef {
  taskKey: string;
  businessDomain?: string;
  capabilityKey?: string;
  statusSource?: string;
  entityId?: string;
  [key: string]: unknown;
}

export interface DigitalEmployeeDeepLink {
  page: BusinessDestination;
  view?: "create" | "publish";
  studioPanel?: "projects";
  runId: string;
  taskId: string;
  businessRef: DigitalEmployeeBusinessRef;
}

export interface DigitalEmployeeReturnContext {
  deliveryId?: string;
  returnPage: "digitalEmployees";
  returnView: "live";
  runId: string;
  taskId: string;
  taskKey: string;
  openedPage: BusinessDestination;
  openedAt: string;
  prompt: string;
}

const taskDestinationByKey: Record<
  string,
  Pick<DigitalEmployeeDeepLink, "page" | "view">
> = {
  context_readiness: { page: "enterprise" },
  goal_decomposition: { page: "digitalEmployees" },
  scheduled_source_collection: { page: "scheduled" },
  viral_analysis: { page: "socialInspiration" },
  content_mode_routing: { page: "smartAssets", view: "create" },
  content_production: { page: "smartAssets", view: "create" },
  content_quality_gate: { page: "smartAssets", view: "create" },
  content_release_approval: { page: "smartAssets", view: "publish" },
  publishing_calendar: { page: "smartAssets", view: "publish" },
  platform_publish: { page: "smartAssets", view: "publish" },
  customer_attribution: { page: "conversion" },
  customer_segmentation: { page: "conversion" },
  followup_batch_draft: { page: "conversion" },
  followup_batch_approval: { page: "conversion" },
  followup_dispatch: { page: "conversion" },
  weekly_review: { page: "digitalEmployees" },
};

export function buildTaskDeepLink(
  task: WorkflowTask,
  planTask: PlanTask | undefined,
  runId: string,
): DigitalEmployeeDeepLink {
  const resources = Array.isArray(task.business_refs) ? task.business_refs : [];
  const studioProject = resources.find(
    (resource) => resource?.type === "studio_project" && String(resource.id || "").trim(),
  );
  const studioProjectId = studioProject ? String(studioProject.id).trim() : undefined;
  const mapped =
    taskDestinationByKey[task.task_key] ||
    (task.kind === "production"
      ? { page: "smartAssets" as const, view: "create" as const }
      : task.kind === "activation"
        ? { page: "scheduled" as const }
        : { page: "digitalEmployees" as const });
  const declaredDestination = task.destination || planTask?.destination;
  const page =
    declaredDestination &&
    [
      "enterprise",
      "accountManagement",
      "scheduled",
      "socialInspiration",
      "scriptLibrary",
      "smartAssets",
      "conversion",
      "digitalEmployees",
    ].includes(declaredDestination)
      ? declaredDestination
      : mapped.page;
  return {
    page,
    view:
      page === "smartAssets"
        ? (['content_release_approval', 'publishing_calendar', 'platform_publish'].includes(task.task_key)
          ? 'publish'
          : task.destination_view || planTask?.destinationView || mapped.view || "create")
        : undefined,
    studioPanel:
      page === "smartAssets" && ["content_production", "content_quality_gate"].includes(task.task_key)
        ? "projects"
        : undefined,
    runId,
    taskId: task.id,
    businessRef: {
      resources,
      taskKey: task.task_key,
      ...(studioProjectId ? { entityId: studioProjectId, deliveryId: `studio_project:${studioProjectId}` } : {}),
      businessDomain: task.business_domain || planTask?.businessDomain,
      capabilityKey:
        task.capability_key ||
        planTask?.capabilityKey ||
        String(task.output?.capability || ""),
      statusSource:
        task.status_source ||
        planTask?.statusSource ||
        String(task.output?.statusSource || ""),
      taskVersion: task.task_version,
      correctionVersion: task.correction_version,
    },
  };
}

export function dispatchDigitalEmployeeDeepLink(
  link: DigitalEmployeeDeepLink,
): void {
  if (typeof window === "undefined") return;
  // Keep the generic run/task fields for all business destinations, while also
  // naming Studio's attribution explicitly. This makes the handoff auditable
  // and prevents a browser-restored draft from silently replacing the task.
  const navigationDetail = {
    ...link,
    workflowRunId: link.runId,
    workflowTaskId: link.taskId,
  };
  try {
    window.sessionStorage.setItem(
      "digitalEmployee.businessDeepLink",
      JSON.stringify({ ...navigationDetail, issuedAt: Date.now() }),
    );
    if (link.runId || link.taskId) {
      const returnContext: DigitalEmployeeReturnContext = {
        returnPage: "digitalEmployees",
        returnView: "live",
        runId: link.runId,
        taskId: link.taskId,
        taskKey: link.businessRef.taskKey,
        ...(typeof link.businessRef.deliveryId === "string" ? { deliveryId: link.businessRef.deliveryId } : {}),
        openedPage: link.page,
        openedAt: new Date().toISOString(),
        prompt: "返回数字员工生产现场继续查看此任务",
      };
      window.sessionStorage.setItem(
        "digitalEmployee.returnContext",
        JSON.stringify(returnContext),
      );
    }
  } catch {
    /* optional context handoff */
  }
  window.dispatchEvent(new CustomEvent("lingshu:navigate", { detail: navigationDetail }));
}

export function consumeDigitalEmployeeReturnContext(): DigitalEmployeeReturnContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem("digitalEmployee.returnContext");
    if (!raw) return null;
    window.sessionStorage.removeItem("digitalEmployee.returnContext");
    const value = JSON.parse(raw) as Partial<DigitalEmployeeReturnContext>;
    if (
      value.returnPage !== "digitalEmployees" ||
      typeof value.taskId !== "string" ||
      typeof value.runId !== "string"
    )
      return null;
    return value as DigitalEmployeeReturnContext;
  } catch {
    return null;
  }
}

const BASE = "/api/overseas/digital-employees";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...authHeader(),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    message?: string;
    missing?: string[];
    effects?: Array<Record<string, unknown>>;
  };
  if (!response.ok) {
    const detail = body.missing?.length ? `：${body.missing.join("、")}` : "";
    const effectDetail = body.effects?.length
      ? `（检测到 ${body.effects.length} 条真实外部回执，未覆盖执行）`
      : "";
    const friendlyErrors: Record<string, string> = {
      active_goal_exists: "已有一轮目标正在执行，请先完成或取消当前运行",
      task_not_blocked: "当前任务不需要恢复操作",
      task_not_retryable: "当前任务不能重试，请先纠偏或人工处理",
      manual_completion_not_allowed:
        "该任务涉及真实对外动作，不能直接标记完成人工执行",
      skip_not_allowed: "该任务会影响后续真实业务动作，不能直接跳过",
      missing_required_resources: "启动前仍有必需业务资产未就绪",
    };
    throw new Error(
      `${body.message || friendlyErrors[body.error || ""] || body.error || "请求失败"}${detail}${effectDetail}`,
    );
  }
  return body;
}

export const digitalEmployeeApi = {
  publishingAccounts: () =>
    request<{ items: Array<PublishingTarget & { status: "connected" }> }>(
      "/publishing-accounts",
    ),
  overview: (goalId = "", range?: { startsAt: string; endsAt: string }) =>
    request<DigitalEmployeeOverview>(
      `/overview?${new URLSearchParams({ ...(goalId ? { goalId } : {}), ...(range || {}) }).toString()}`,
    ),
  completeOnboarding: (config: DigitalEmployeeConfig) =>
    request<DigitalEmployeeOverview>("/onboarding/complete", {
      method: "POST",
      body: JSON.stringify(config),
    }),
  reviewTodos: (week: string) => request<ReviewTodoBoard>(`/review-todos?week=${encodeURIComponent(week)}`),
  saveReviewTodos: (board: ReviewTodoBoard) => request<ReviewTodoBoard>('/review-todos', { method: 'PUT', body: JSON.stringify(board) }),
  dispatchReviewTodos: (week: string, revision: number) => request<ReviewTodoBoard>('/review-todos/dispatch', { method: 'POST', body: JSON.stringify({ week, revision }) }),
  createGoal: (
    goal: Omit<
      WeeklyGoal,
      "id" | "status" | "version" | "createdAt" | "updatedAt"
    >,
  ) =>
    request<DigitalEmployeeOverview>("/goals", {
      method: "POST",
      body: JSON.stringify(goal),
    }),
  recommendPackage: (goalId: string) => request<WeeklyPackage>(`/goals/${encodeURIComponent(goalId)}/package/recommend`, { method: "POST" }),
  savePackage: (goalId: string, pack: WeeklyPackage) => request<DigitalEmployeeOverview>(`/goals/${encodeURIComponent(goalId)}/package`, { method: "PUT", body: JSON.stringify(pack) }),
  linkTaskProject: (runId: string, taskId: string, projectId: string) => request<DigitalEmployeeOverview>(`/runs/${encodeURIComponent(runId)}/tasks/${encodeURIComponent(taskId)}/link-project`, { method: "POST", body: JSON.stringify({ projectId }) }),
  packageOptions: () => request<{ members: Array<{ id: string; name: string }>; projects: Array<{ id: string; title: string }>; customers: Array<{ id: string; name: string }> }>("/package-options"),
  approveGoal: (goalId: string, packageRevision?: number) =>
    request<DigitalEmployeeOverview>(
      `/goals/${encodeURIComponent(goalId)}/approve`,
      { method: "POST", body: JSON.stringify({ packageRevision }) },
    ),
  decideApproval: (
    approvalId: string,
    decision: "approved" | "rejected",
    note = "",
  ) =>
    request<DigitalEmployeeOverview>(
      `/approvals/${encodeURIComponent(approvalId)}/decide`,
      { method: "POST", body: JSON.stringify({ decision, note }) },
    ),
  handoffTask: (taskId: string) =>
    request<DigitalEmployeeOverview>(
      `/tasks/${encodeURIComponent(taskId)}/handoff`,
      { method: "POST" },
    ),
  returnTask: (taskId: string, note = "") =>
    request<DigitalEmployeeOverview>(
      `/tasks/${encodeURIComponent(taskId)}/return-to-agent`,
      { method: "POST", body: JSON.stringify({ note }) },
    ),
  pauseRun: (runId: string) =>
    request<DigitalEmployeeOverview>(
      `/runs/${encodeURIComponent(runId)}/pause`,
      { method: "POST", body: JSON.stringify({ reason: "人工暂停" }) },
    ),
  resumeRun: (runId: string) =>
    request<DigitalEmployeeOverview>(
      `/runs/${encodeURIComponent(runId)}/resume`,
      { method: "POST" },
    ),
  cancelRun: (runId: string) =>
    request<DigitalEmployeeOverview>(
      `/runs/${encodeURIComponent(runId)}/cancel`,
      { method: "POST" },
    ),
  reconcileRun: (runId: string) =>
    request<DigitalEmployeeOverview>(
      `/runs/${encodeURIComponent(runId)}/reconcile`,
      { method: "POST" },
    ),
  correctTask: (
    taskId: string,
    input: {
      instruction: string;
      scope: "one_off" | "rule_candidate";
      rerunDownstream: boolean;
    },
  ) =>
    request<DigitalEmployeeOverview>(
      `/tasks/${encodeURIComponent(taskId)}/corrections`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  directorDecision: (taskId: string, input: { contentId: string; decision: DirectorDecision; reason?: DirectorDecisionReason; applyToSimilar?: boolean }) =>
    request<DigitalEmployeeOverview>(`/tasks/${encodeURIComponent(taskId)}/director-decision`, { method: 'POST', body: JSON.stringify(input) }),
  retryTask: (taskId: string) =>
    request<DigitalEmployeeOverview>(
      `/tasks/${encodeURIComponent(taskId)}/retry`,
      { method: "POST" },
    ),
  skipTask: (taskId: string, note: string) =>
    request<DigitalEmployeeOverview>(
      `/tasks/${encodeURIComponent(taskId)}/skip`,
      { method: "POST", body: JSON.stringify({ note }) },
    ),
  completeTask: (
    taskId: string,
    note: string,
    output?: Record<string, unknown>,
  ) =>
    request<DigitalEmployeeOverview>(
      `/tasks/${encodeURIComponent(taskId)}/complete`,
      {
        method: "POST",
        body: JSON.stringify({ note, ...(output ? { output } : {}) }),
      },
    ),
  dispatchFollowupBatch: async (batchId: string) =>
    (
      await request<FollowupDispatchResponse>(
        `/followup-batches/${encodeURIComponent(batchId)}/dispatch`,
        { method: "POST" },
      )
    ).overview,
};

export async function streamRunEvents(
  runId: string,
  afterSequence: number,
  onEvent: (event: RunEvent) => void,
  signal: AbortSignal,
  onConnected?: () => void,
): Promise<void> {
  const response = await fetch(
    `${BASE}/runs/${encodeURIComponent(runId)}/stream?after=${afterSequence}`,
    {
      headers: { ...authHeader(), Accept: "text/event-stream" },
      signal,
    },
  );
  if (!response.ok || !response.body) throw new Error("实时生产现场连接失败");
  onConnected?.();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const seen = new Set<string>();
  const consumePacket = (packet: string) => {
    if (!packet.trim() || signal.aborted) return;
    const dataLines: string[] = [];
    let eventId = "";
    for (const line of packet.split(/\r\n|\n|\r/)) {
      if (!line || line.startsWith(":")) continue;
      const separator = line.indexOf(":");
      const field = separator < 0 ? line : line.slice(0, separator);
      const rawValue = separator < 0 ? "" : line.slice(separator + 1);
      const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
      if (field === "id") eventId = value;
      if (field === "data") dataLines.push(value);
    }
    if (!dataLines.length) return;
    try {
      const event = JSON.parse(dataLines.join("\n")) as RunEvent;
      const sequence = Number(event.sequence || 0);
      if (sequence && sequence <= afterSequence) return;
      const identity =
        eventId || event.id || (sequence ? `${runId}:${sequence}` : "");
      if (identity && seen.has(identity)) return;
      if (identity) seen.add(identity);
      onEvent(event);
    } catch {
      /* one malformed SSE packet must not poison later packets */
    }
  };
  const drain = (flush = false) => {
    while (buffer) {
      const boundary = buffer.match(/(?:\r\n|\n|\r){2}/);
      if (!boundary || boundary.index === undefined) break;
      consumePacket(buffer.slice(0, boundary.index));
      buffer = buffer.slice(boundary.index + boundary[0].length);
    }
    if (flush && buffer.trim()) {
      consumePacket(buffer);
      buffer = "";
    }
  };
  const abortReader = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abortReader, { once: true });
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      buffer += decoder.decode(value, { stream: true });
      drain();
    }
    if (!signal.aborted) {
      buffer += decoder.decode();
      drain(true);
    }
  } finally {
    signal.removeEventListener("abort", abortReader);
    reader.releaseLock();
  }
}
