import { authHeader } from './auth';

export type AutonomyMode = 'suggest' | 'collaborate' | 'managed' | 'automatic';
export type ApprovalDecision = 'approved' | 'approved_with_changes' | 'rejected';
export type PublishingReconciliationAction = 'confirm_published' | 'confirm_not_published_retry' | 'void';
export type PublishingReconciliationOutcome = 'published' | 'not_published';
export type WorkItemType = 'approval' | 'failure' | 'information' | 'handoff' | 'timeout' | string;
export type WorkItemStatus = 'pending' | 'processed' | 'taken_over' | 'expired' | string;
export type StreamConnectionPhase = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface DigitalEmployeeConfig {
  companyName: string;
  industry: string;
  primaryBusiness: string;
  targetMarkets: string;
  customerProfile: string;
  autonomyMode: AutonomyMode;
  weeklyBudget: number;
  approvalOwner: string;
  constraints: string[];
  team: string[];
}

export interface WeeklyGoal {
  id: string;
  title: string;
  objective: string;
  metric: string;
  baseline: number;
  target: number;
  unit: string;
  startsAt: string;
  endsAt: string;
  scope: string;
  budgetLimit: number;
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
  agentRole: string;
  kind: string;
  sequence: number;
  priority: string;
  requiresApproval: boolean;
  dependsOn: string[];
  expectedMinutes: number;
}

export interface WeeklyPlan {
  id: string;
  status: string;
  strategy: string;
  successCriteria: string[];
  estimatedCost: number;
  estimatedMinutes: number;
  qualityGates: string[];
  riskSummary: string;
  tasks: PlanTask[];
  version?: number;
}

export interface ExecutionContract {
  id: string;
  version: number;
  status: string;
  payloadHash: string;
  readiness: 'blocked' | 'ready_with_assumptions' | 'ready';
  compiledAt: string;
  confirmedAt: string;
  intent: { outcome: string; priority: string; focusProducts: string[]; audience: string; market: string };
  measurement: { metric: string; definition: string; baseline: number; target: number; unit: string; window: { startsAt: string; endsAt: string }; source: string; missing: boolean };
  facts: Array<{ key: string; summary: string; source: string; sourceVersion: string }>;
  resources: { productCount: number; connectedAccounts: Array<{ id: string; platform: string }>; historicalPosts: number; metricSnapshots: number; studioAvailable: boolean };
  policy: { autonomyMode: string; realPublishRequiresApproval: true; approvalOwner: string; budgetLimit: number; constraints: string[]; stopConditions: string[] };
  budgetAllocation: Array<{ category: string; limit: number }>;
  qualityGates: string[];
  completionCriteria: string[];
  assumptions: string[];
  gaps: Array<{ code: string; severity: 'blocking' | 'warning'; title: string; resolution: string; source: string }>;
}

export interface WorkflowRun {
  id: string;
  goal_id: string;
  plan_id: string;
  status: string;
  current_controller: string;
  pause_reason: string;
  budget_limit: number;
  budget_spent: number;
  started_at: string;
  completed_at: string;
  actual_cost?: number;
}

export interface WorkflowTask {
  id: string;
  run_id: string;
  task_key: string;
  title: string;
  description: string;
  agent_role: string;
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
  started_at?: string;
  completed_at?: string;
  attempt?: number;
  max_attempts?: number;
  error_code?: string;
  error_detail?: string;
  idempotency_key?: string;
  actual_cost?: number;
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

export interface ApprovalActionSnapshot {
  actionType?: string;
  mode?: string;
  parameters?: Record<string, unknown>;
  contentVersion?: string;
  materialVersions?: Array<{ id?: string; version?: string } | string>;
  targetAccounts?: Array<{ id: string; platform?: string; name?: string }>;
  scheduledAt?: string;
  estimatedCost?: number;
  reversible?: boolean;
  reversibility?: string;
  expiresAt?: string;
  nextStep?: string;
  contentSnapshot?: Record<string, unknown>;
  contentPayloadHash?: string;
  artifact?: Record<string, unknown>;
}

export interface ApprovalRequest {
  id: string;
  goal_id: string;
  run_id: string;
  task_id: string;
  status: string;
  action_summary: string;
  risk_level: string;
  evidence: Array<Record<string, unknown>>;
  requested_by_agent: string;
  owner_id: string;
  decided_by: string;
  decision_note: string;
  action_version: number;
  payload_hash: string;
  action_payload?: Record<string, unknown>;
  action_type?: string;
  action_parameters?: Record<string, unknown>;
  content_version?: string;
  material_versions?: Array<{ id?: string; version?: string } | string>;
  target_accounts?: Array<{ id: string; platform?: string; name?: string }>;
  target_account_ids?: string[];
  target_account?: { id: string; platform?: string; label?: string; name?: string };
  scheduled_at?: string;
  estimated_cost?: number;
  reversible?: boolean;
  reversibility?: string;
  expires_at?: string;
  next_step?: string;
  action_snapshot?: ApprovalActionSnapshot;
  proposed_changes?: Record<string, unknown>;
  changes?: Record<string, unknown>;
  diff?: Record<string, unknown> | Array<{ path: string; before: unknown; after: unknown }>;
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

export interface ManualHandoffResult {
  note: string;
  result: Record<string, unknown>;
  references: string[];
  externalActionsPerformed: boolean;
  outcome: 'continue' | 'completed';
}

export interface PublishingReconciliationReceipt {
  accountId: string;
  outcome: PublishingReconciliationOutcome;
  platformPostId: string;
  verifiedAt: string;
  evidence: string;
}

export interface PublishingReconciliationReceiptDraft {
  accountId: string;
  outcome: PublishingReconciliationOutcome | '';
  platformPostId: string;
  verifiedAt: string;
  evidence: string;
}

export interface PublishingReconciliationDecision {
  action: PublishingReconciliationAction;
  expectedRevision: number;
  note: string;
  receipts: PublishingReconciliationReceipt[];
}

export interface PublishingReconciliationDraft {
  action: PublishingReconciliationAction | '';
  expectedRevision: number;
  note: string;
  targetAccountIds: string[];
  allowedDecisions: PublishingReconciliationAction[];
  receipts: PublishingReconciliationReceiptDraft[];
}

export interface AgentStatus {
  role: string;
  status: string;
  currentTask: string;
  completed: number;
  total: number;
}

export interface BusinessGoalResult {
  status?: 'achieved' | 'not_achieved' | 'observing' | 'insufficient_data' | string;
  metric?: string;
  definition?: string;
  baseline?: number;
  target?: number;
  current?: number;
  unit?: string;
  progressRate?: number;
  observationWindow?: { startsAt?: string; endsAt?: string };
  source?: string;
  sourceStatus?: 'available' | 'partial' | 'missing' | string;
  missingReason?: string;
}

export interface WeeklyReviewSummary {
  /** Legacy completionRate is workflow completion, never business-goal attainment. */
  completionRate?: number;
  workflowCompletionRate?: number;
  automationRate?: number;
  approvalRate?: number;
  handoffRate?: number;
  completedTasks?: number;
  totalTasks?: number;
  failedTasks?: number;
  highlights?: string[];
  insights?: string[];
  nextGoalSuggestion?: string;
  knowledgeCandidates?: string[];
  businessGoal?: BusinessGoalResult;
  workflow?: {
    status: 'completed' | 'completed_with_failures' | 'completed_with_skips' | string;
    completionRate: number;
    completedTasks: number;
    totalTasks: number;
    failedTasks: number;
    skippedTasks: number;
    approvalCount: number;
    handoffCount: number;
    actualCost: number;
  };
  businessOutcome?: {
    status: 'achieved' | 'not_achieved' | 'in_progress' | 'awaiting_measurement' | 'unsupported_metric' | string;
    metric: string;
    baseline: number;
    target: number;
    observedValue: number | null;
    measuredIncrement: number | null;
    progressPercent: number | null;
    source: string;
    dataQuality: 'verified' | 'partial' | 'unavailable' | string;
    window: { startsAt: string; endsAt: string; evaluatedAt?: string };
    evidence?: Record<string, unknown>;
    explanation: string;
  };
  publishing?: { scheduled: number; published: number; dryRuns: number; failed: number; postIds: string[] };
  generatedAt?: string;
  operatingResults?: Array<{ label: string; value?: number | string; unit?: string; source?: string; missing?: boolean }>;
  costs?: { actual?: number; budget?: number; currency?: string; source?: string; missing?: boolean };
  issueHotspots?: string[];
  nextWeekRecommendations?: string[];
  trend?: Array<{ week: string; workflowCompletionRate?: number; businessProgressRate?: number; actualCost?: number }>;
  planComparison?: Array<{ version: number; label?: string; adopted?: boolean; result?: string }>;
}

export interface WeeklyReview {
  id: string;
  status: string;
  summary: WeeklyReviewSummary;
  created_at: string;
}

export interface WorkItem {
  id: string;
  type: WorkItemType;
  status: WorkItemStatus;
  sourceStatus?: string;
  runId: string;
  taskId: string;
  ownerId: string;
  agent: string;
  risk: string;
  goalId: string;
  dueAt: string;
  createdAt?: string;
  updatedAt?: string;
  title?: string;
  summary?: string;
  source?: string;
  sourceRecord?: Record<string, unknown>;
  sourceTask?: WorkflowTask;
  approval?: ApprovalRequest;
  errorCode?: string;
  attempt?: number;
  maxAttempts?: number;
  postId?: string;
  expectedRevision?: number;
  targetAccountIds?: string[];
  allowedDecisions?: PublishingReconciliationAction[];
  blindRetryAllowed?: boolean;
}

export interface WorkItemFilters {
  status?: string;
  type?: string;
  agent?: string;
  owner?: string;
  goalId?: string;
  risk?: string;
}

export interface DigitalEmployeeOverview {
  config: DigitalEmployeeConfig | null;
  goals: WeeklyGoal[];
  goal: WeeklyGoal | null;
  contract: ExecutionContract | null;
  plan: WeeklyPlan | null;
  run: WorkflowRun | null;
  tasks: WorkflowTask[];
  events: RunEvent[];
  approvals: ApprovalRequest[];
  handoffs: HandoffSession[];
  workItems?: WorkItem[];
  review: WeeklyReview | null;
  agents: AgentStatus[];
}

export interface StreamConnectionStatus {
  phase: StreamConnectionPhase;
  attempt: number;
  retryInMs?: number;
  lastEventAt?: string;
}

const BASE = '/api/overseas/digital-employees';

const ERROR_MESSAGE: Record<string, string> = {
  approval_stale: '审批动作已更新，请重新核对最新版本。',
  approval_already_decided: '该审批已被处理，页面将刷新最新结果。',
  approval_concurrent_decision: '其他负责人刚刚处理了该审批，请查看最新结果。',
  approval_expired: '审批已过期，必须重新生成动作版本。',
  approval_snapshot_stale: '审批快照完整性校验失败，不能继续执行。',
  approval_context_state_changed: '运行状态已变化，该审批不再可执行。',
  approval_precondition_required: '审批缺少动作版本或 Payload Hash，不能安全处理。',
  approval_changes_required: '修改后批准必须提交非空修改内容。',
  approval_changes_unsupported: '涉及内容或素材的修改必须回到原业务模块重新生成审批。',
  approval_cost_invalid: '修改后费用无效或超出本次运行剩余预算。',
  work_item_transfer_conflict: '待办负责人已变化，请刷新后重试。',
  work_item_owner_required: '只有当前负责人或管理员可以处理该待办。',
  work_item_not_transferable: '该待办状态已变化，现在不能转交。',
  transfer_owner_required: '请填写新负责人用户 ID。',
  transfer_owner_invalid: '新负责人必须是本企业的有效用户。',
  task_retry_exhausted: '任务已达到最大重试次数，请选择跳过或重新规划。',
  task_action_state_invalid: '任务状态已变化，当前操作不再适用。',
  task_action_note_required: '跳过或重新规划时必须填写处理说明。',
  handoff_owner_required: '只有当前接管人或管理员可以提交人工结果。',
  handoff_outcome_invalid: '人工结果缺少有效的后续处理方式。',
  handoff_external_actions_flag_required: '必须明确记录人工期间是否执行过外部动作。',
  handoff_result_invalid: '请提交结构化的人工处理结果。',
  handoff_references_invalid: '人工结果引用无效，请使用原模块记录 ID、深链或附件引用。',
  external_action_reconciliation_required: '人工已执行外部动作，不能直接交还 Agent 重跑；请完成对账后提交人工完成结果。',
  handoff_note_required: '请填写人工处理与交还说明。',
  handoff_completed_result_required: '提交人工完成时，必须填写完成结果。',
  handoff_external_action_reference_required: '人工执行了外部动作，必须填写可追溯的正式记录、回执或附件引用。',
  publishing_reconciliation_not_found: '该发布对账待办不存在或已被删除。',
  publishing_reconciliation_not_pending: '该发布对账已被处理，页面将刷新最新状态。',
  publishing_reconciliation_revision_conflict: '对账记录刚刚被其他管理员更新，本次未提交；请重新核对最新回执。',
  reconciliation_action_invalid: '请选择当前待办允许的对账结论。',
  reconciliation_note_required: '请填写至少 3 个字的对账说明。',
  reconciliation_target_accounts_missing: '对账待办缺少目标账号，不能安全处理。',
  expected_revision_required: '对账版本缺失，请刷新页面后重试。',
  account_receipts_required: '请为每个目标账号填写对账回执。',
  account_receipts_do_not_match_targets: '账号回执与本次发布目标不匹配。',
  account_receipt_outcome_invalid: '请明确选择每个账号是“已发布”还是“未发布”。',
  account_receipt_evidence_required: '每个账号都必须填写核验时间和可追溯证据。',
  platform_post_id_required: '确认已发布的账号必须填写平台帖子 ID。',
  account_receipts_incomplete: '账号回执不完整，不能提交对账。',
  published_confirmation_requires_published_receipts: '确认发布成功需要所有目标账号均有“已发布”回执。',
  blind_retry_forbidden: '禁止盲目重试：只有所有目标账号均核验为“未发布”才能恢复重试。',
  publishing_retry_not_authorized: '当前运行或审批授权已变化，不允许恢复发布重试。',
  publishing_run_context_missing: '发布运行上下文已不存在，不允许恢复重试。',
  publishing_run_paused: '数字员工运行已暂停，不允许恢复发布重试。',
  publishing_run_cancelled: '数字员工运行已取消，不允许恢复发布重试。',
  publishing_run_failed: '数字员工运行已失败，不允许恢复发布重试。',
  publishing_approval_context_missing: '原始发布审批上下文缺失，不允许恢复重试。',
  publishing_approval_not_live: '原始发布审批已失效，不允许恢复重试。',
  publishing_approval_snapshot_changed: '原始发布审批快照已变化，不允许恢复重试。',
  publishing_governance_binding_missing: '发布授权绑定缺失，不允许恢复重试。',
  publishing_governance_binding_changed: '发布授权绑定已变化，不允许恢复重试。',
  support_access_read_only: '支持会话为只读模式，不能执行此操作。',
};

export function buildPublishingReconciliationPayload(
  draft: PublishingReconciliationDraft,
): { ok: true; value: PublishingReconciliationDecision } | { ok: false; error: string } {
  if (!draft.action || !draft.allowedDecisions.includes(draft.action)) return { ok: false, error: '请明确选择当前允许的对账结论。' };
  if (!Number.isInteger(draft.expectedRevision) || draft.expectedRevision < 0) return { ok: false, error: '对账版本缺失，请刷新待办。' };
  const note = draft.note.trim().slice(0, 2_000);
  if (note.length < 3) return { ok: false, error: '请填写至少 3 个字的对账说明。' };
  const targetAccountIds = Array.from(new Set(draft.targetAccountIds.map(value => value.trim()).filter(Boolean)));
  if (!targetAccountIds.length) return { ok: false, error: '待办缺少目标账号，请暂停处理并检查发布记录。' };
  const receipts: PublishingReconciliationReceipt[] = [];
  const seen = new Set<string>();
  for (const raw of draft.receipts) {
    const accountId = raw.accountId.trim();
    if (!targetAccountIds.includes(accountId) || seen.has(accountId)) return { ok: false, error: '账号回执与本次发布目标不匹配。' };
    if (raw.outcome !== 'published' && raw.outcome !== 'not_published') return { ok: false, error: `请选择账号 ${accountId} 的核验结果。` };
    const verifiedAtMs = Date.parse(raw.verifiedAt);
    const evidence = raw.evidence.trim().slice(0, 2_000);
    if (!Number.isFinite(verifiedAtMs) || evidence.length < 3) return { ok: false, error: `请填写账号 ${accountId} 的核验时间和可追溯证据。` };
    const platformPostId = raw.platformPostId.trim().slice(0, 500);
    if (raw.outcome === 'published' && !platformPostId) return { ok: false, error: `账号 ${accountId} 已发布，必须填写平台帖子 ID。` };
    seen.add(accountId);
    receipts.push({ accountId, outcome: raw.outcome, platformPostId, verifiedAt: new Date(verifiedAtMs).toISOString(), evidence });
  }
  if (seen.size !== targetAccountIds.length) return { ok: false, error: '请完整填写每个目标账号的回执。' };
  if (draft.action === 'confirm_published' && receipts.some(receipt => receipt.outcome !== 'published')) return { ok: false, error: '确认发布成功需要所有账号均核验为“已发布”。' };
  if (draft.action === 'confirm_not_published_retry' && receipts.some(receipt => receipt.outcome !== 'not_published')) return { ok: false, error: '禁止盲目重试：所有账号都必须有“未发布”回执。' };
  return { ok: true, value: { action: draft.action, expectedRevision: draft.expectedRevision, note, receipts } };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...authHeader(),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string; message?: string; missing?: string[] };
  if (!response.ok) {
    const detail = body.missing?.length ? `：${body.missing.join('、')}` : '';
    throw new Error(`${body.message || (body.error ? ERROR_MESSAGE[body.error] || body.error : '请求失败')}${detail}`);
  }
  return body;
}

function queryString(filters: WorkItemFilters = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  const value = params.toString();
  return value ? `?${value}` : '';
}

export const digitalEmployeeApi = {
  overview: () => request<DigitalEmployeeOverview>('/overview'),
  workItems: (filters?: WorkItemFilters) => request<{ items: WorkItem[]; total: number }>(`/work-items${queryString(filters)}`),
  completeOnboarding: (config: DigitalEmployeeConfig) => request<DigitalEmployeeOverview>('/onboarding/complete', { method: 'POST', body: JSON.stringify(config) }),
  createGoal: (goal: Omit<WeeklyGoal, 'id' | 'status' | 'version' | 'createdAt' | 'updatedAt'>) => request<DigitalEmployeeOverview>('/goals', { method: 'POST', body: JSON.stringify(goal) }),
  approveGoal: (goalId: string) => request<DigitalEmployeeOverview>(`/goals/${encodeURIComponent(goalId)}/approve`, { method: 'POST' }),
  recompileContract: (goalId: string) => request<DigitalEmployeeOverview>(`/goals/${encodeURIComponent(goalId)}/contract/recompile`, { method: 'POST' }),
  confirmContract: (goalId: string, payloadHash: string) => request<DigitalEmployeeOverview>(`/goals/${encodeURIComponent(goalId)}/contract/confirm`, { method: 'POST', body: JSON.stringify({ payloadHash }) }),
  decideApproval: (
    approvalId: string,
    decision: ApprovalDecision,
    note = '',
    options: { changes?: Record<string, unknown>; expectedPayloadHash?: string; expectedActionVersion?: number } = {},
  ) => request<DigitalEmployeeOverview>(`/approvals/${encodeURIComponent(approvalId)}/decide`, {
    method: 'POST',
    body: JSON.stringify({ decision, note, ...options }),
  }),
  handoffTask: (taskId: string) => request<DigitalEmployeeOverview>(`/tasks/${encodeURIComponent(taskId)}/handoff`, { method: 'POST' }),
  returnTask: (taskId: string, input: ManualHandoffResult) => request<DigitalEmployeeOverview>(`/tasks/${encodeURIComponent(taskId)}/return-to-agent`, { method: 'POST', body: JSON.stringify(input) }),
  transferWorkItem: async (workItemId: string, ownerId: string, note = '') => {
    await request<{ ok: true }>(`/work-items/${encodeURIComponent(workItemId)}/transfer`, { method: 'POST', body: JSON.stringify({ ownerId, note }) });
    return request<DigitalEmployeeOverview>('/overview');
  },
  actOnTask: (taskId: string, action: 'retry' | 'skip' | 'replan', note = '') => request<DigitalEmployeeOverview>(`/tasks/${encodeURIComponent(taskId)}/actions`, { method: 'POST', body: JSON.stringify({ action, note }) }),
  decidePublishingReconciliation: (postId: string, decision: PublishingReconciliationDecision) => request<{ post: Record<string, unknown>; decision: PublishingReconciliationAction }>(`/publishing-reconciliations/${encodeURIComponent(postId)}/decide`, { method: 'POST', body: JSON.stringify(decision) }),
  pauseRun: (runId: string) => request<DigitalEmployeeOverview>(`/runs/${encodeURIComponent(runId)}/pause`, { method: 'POST', body: JSON.stringify({ reason: '人工暂停' }) }),
  resumeRun: (runId: string) => request<DigitalEmployeeOverview>(`/runs/${encodeURIComponent(runId)}/resume`, { method: 'POST' }),
  cancelRun: (runId: string) => request<DigitalEmployeeOverview>(`/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' }),
};

export function parseSseBuffer(input: string): { packets: string[]; remainder: string } {
  const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const packets = normalized.split('\n\n');
  return { packets: packets.slice(0, -1), remainder: packets.at(-1) || '' };
}

export function parseSsePacket(packet: string): RunEvent | null {
  const data = packet
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (!data) return null;
  try {
    const value = JSON.parse(data) as RunEvent;
    return value && typeof value.id === 'string' && Number.isFinite(Number(value.sequence)) ? value : null;
  } catch {
    return null;
  }
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const timer = globalThis.setTimeout(resolve, delayMs);
    signal.addEventListener('abort', () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

/** Streams persisted events and compensates every reconnect from the last sequence. */
export async function streamRunEvents(
  runId: string,
  afterSequence: number,
  onEvent: (event: RunEvent) => void,
  signal: AbortSignal,
  onStatus?: (status: StreamConnectionStatus) => void,
): Promise<void> {
  let cursor = Math.max(0, afterSequence);
  let retry = 500;
  let attempt = 0;
  let lastEventAt = '';
  const emit = (event: RunEvent) => {
    cursor = Math.max(cursor, Number(event.sequence) || 0);
    lastEventAt = event.occurred_at || new Date().toISOString();
    onEvent(event);
  };

  onStatus?.({ phase: 'connecting', attempt: 0 });
  while (!signal.aborted) {
    try {
      const compensation = await request<{ events: RunEvent[] }>(`/runs/${encodeURIComponent(runId)}/events?after=${cursor}`, { signal });
      for (const event of [...compensation.events].sort((a, b) => Number(a.sequence) - Number(b.sequence))) emit(event);
      const response = await fetch(`${BASE}/runs/${encodeURIComponent(runId)}/stream?after=${cursor}`, {
        headers: { ...authHeader(), Accept: 'text/event-stream' }, cache: 'no-store', signal,
      });
      if (!response.ok || !response.body) throw new Error('sse_unavailable');
      attempt = 0;
      retry = 500;
      onStatus?.({ phase: 'connected', attempt, lastEventAt });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) throw new Error('sse_closed');
        const parsed = parseSseBuffer(buffer + decoder.decode(value, { stream: true }));
        buffer = parsed.remainder;
        for (const packet of parsed.packets) {
          const event = parseSsePacket(packet);
          if (event && Number(event.sequence) > cursor) emit(event);
        }
      }
    } catch {
      if (signal.aborted) return;
      attempt += 1;
      const phase: StreamConnectionPhase = attempt >= 4 ? 'offline' : 'reconnecting';
      onStatus?.({ phase, attempt, retryInMs: retry, lastEventAt });
      try { await abortableDelay(retry, signal); } catch { return; }
      retry = Math.min(15_000, Math.round(retry * 2));
    }
  }
}
