import { Router, type Response } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { store } from '../storage/index.js';
import { executeSocialLoopTask } from '../digitalEmployees/socialLoopAdapter.js';
import { compileExecutionContract, type ExecutionContract } from '../digitalEmployees/executionContract.js';
import {
  buildOutboundActionProposal,
  proposalIntegrityHash,
  type OutboundActionProposal,
} from '../digitalEmployees/outboundActionService.js';
import {
  ReliableKernelError,
  WorkerAdmissionController,
  assertRunTransition,
  assertTaskTransition,
  compareAndSetRecord,
  canRetryTask,
  createRecordIfAbsent,
  errorInfo,
  eventPageForCursor,
  evaluateExecutionGates,
  isAvailable,
  isNextEventSequence,
  isLeaseExpired,
  liveAiGovernanceAllowsExecution,
  normalizeEventCursor,
  retryDelayMs,
  repairRecordSet,
  runWithHeartbeat,
  stableHash,
  taskExecutionTimeoutMs,
  validateApprovalPrecondition,
  validateLiveGovernanceSnapshot,
  workerIdentity,
} from '../digitalEmployees/reliableKernel.js';
import { buildEvidenceBackedReview, type EvidenceBackedReview } from '../digitalEmployees/reviewService.js';
import { hasMeaningfulHandoffResult, normalizeHandoffReferences } from '../digitalEmployees/handoffReturnPolicy.js';
import { requestOrganizationRoleStrict, type OrganizationRole } from './auth.js';
import { readTenantEnterpriseProfile } from './enterprise.js';
import { markWorkerStopped, recordWorkerHeartbeat, registerWorkerHeartbeat } from '../ops/health.js';
import type { PostRecord } from '../publishing/waLink.js';
import {
  fenceDigitalEmployeePostsForRun,
  normalizeReconciliationDecision,
  reconciliationPatchForDecision,
  releaseHeldDigitalEmployeePostsForRun,
  validateReconciliationRetryAuthorization,
} from '../publishing/scheduledPublisher.js';
import {
  buildWeeklyPlan,
  normalizeDigitalEmployeeConfig,
  normalizeWeeklyGoal,
  validateDigitalEmployeeConfig,
  validateWeeklyGoal,
  canPerformDigitalEmployeeAction,
  parseApprovalDecision,
  type DigitalEmployeeConfig,
  type WeeklyGoalInput,
  type WorkflowTaskStatus,
} from '../digitalEmployees/domain.js';
import { verifyDigitalEmployeeRenderedVideo } from '../studio/digitalEmployeeRenderService.js';
import { listAllRecords, nextFairPage } from '../storage/pagination.js';
import { reconciliationOperationBlock } from '../publishing/publishOperationFence.js';
import { releasePostContentFences } from '../publishing/publishContentFence.js';
import { publicPublishTracking } from '../publishing/publicPublication.js';
import {
  publicWorkflowApproval,
  publicWorkflowEvent,
  publicWorkflowHandoff,
  publicWorkflowReview,
  publicWorkflowRun,
  publicWorkflowTask,
  publicWorkflowValue,
} from '../digitalEmployees/publicWorkflow.js';

export const digitalEmployeesRouter = Router();
digitalEmployeesRouter.use(requireAuth);
digitalEmployeesRouter.use((req, res, next) => {
  const identity = res.locals as AuthLocals;
  if (identity.supportAccess && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.status(403).json({ error: 'support_access_read_only' });
    return;
  }
  next();
});
digitalEmployeesRouter.use(async (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
  const identity = res.locals as AuthLocals & { digitalEmployeeRole?: OrganizationRole };
  const role = await requestOrganizationRoleStrict(req.headers.authorization, identity.userId);
  if (!role) { res.status(403).json({ error: 'organization_role_unverified' }); return; }
  if (role === 'customer_service') { res.status(403).json({ error: 'digital_employee_read_only_role' }); return; }
  identity.digitalEmployeeRole = role;
  next();
});

type DigitalEmployeeLocals = AuthLocals & { digitalEmployeeRole?: OrganizationRole };
const ADMIN_ROLES = new Set<OrganizationRole>(['super_admin', 'admin']);
function roleAllowed(res: Response, allowed: readonly OrganizationRole[]): boolean {
  const role = (res.locals as DigitalEmployeeLocals).digitalEmployeeRole;
  if (role && allowed.includes(role)) return true;
  res.status(403).json({ error: 'digital_employee_action_forbidden', allowedRoles: allowed });
  return false;
}
function adminOrOwner(res: Response, userId: string, ownerId: string): boolean {
  const role = (res.locals as DigitalEmployeeLocals).digitalEmployeeRole;
  return Boolean(role && (ADMIN_ROLES.has(role) || userId === ownerId));
}

type StoredRecord = { id: string; [key: string]: unknown };
type ConfigRecord = StoredRecord & { tenant_id: string; config: unknown; status: string };
type GoalRecord = StoredRecord & {
  tenant_id: string;
  title: string;
  objective: string;
  metric: string;
  baseline: number;
  target: number;
  unit: string;
  starts_at: string;
  ends_at: string;
  scope: unknown;
  budget_limit: number;
  constraints: unknown;
  owner_id: string;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
};
type PlanRecord = StoredRecord & { tenant_id: string; goal_id: string; status: string; plan: unknown; created_at: string };
type ContractRecord = StoredRecord & { tenant_id: string; goal_id: string; goal_version: number; version: number; status: string; payload_hash: string; source_fingerprint: string; contract: unknown; confirmed_by: string; compiled_at: string; confirmed_at: string; invalidated_at: string };
type RunRecord = StoredRecord & {
  tenant_id: string;
  goal_id: string;
  plan_id: string;
  status: string;
  current_controller: string;
  pause_reason: string;
  budget_limit: number;
  budget_spent: number;
  started_at: string;
  completed_at: string;
  available_at: string;
  lease_owner: string;
  lease_expires_at: string;
  execution_snapshot: unknown;
  revision?: number;
  error_code?: string;
  error_detail?: string;
};
type TaskRecord = StoredRecord & {
  tenant_id: string;
  goal_id: string;
  plan_id: string;
  run_id: string;
  task_key: string;
  title: string;
  description: string;
  agent_role: string;
  kind: string;
  status: WorkflowTaskStatus;
  sequence: number;
  priority: string;
  requires_approval: boolean;
  depends_on: unknown;
  output: unknown;
  blocked_reason: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  attempt?: number;
  max_attempts?: number;
  available_at?: string;
  lease_owner?: string;
  lease_expires_at?: string;
  started_at?: string;
  completed_at?: string;
  error_code?: string;
  error_detail?: string;
  idempotency_key?: string;
  actual_cost?: number;
  expected_cost?: number;
  revision?: number;
};
type EventRecord = StoredRecord & {
  tenant_id: string;
  run_id: string;
  task_id: string;
  sequence: number;
  type: string;
  level: string;
  summary: string;
  payload: unknown;
  occurred_at: string;
};
type ApprovalRecord = StoredRecord & {
  tenant_id: string;
  goal_id: string;
  run_id: string;
  task_id: string;
  status: string;
  action_summary: string;
  risk_level: string;
  evidence: unknown;
  requested_by_agent: string;
  decided_by: string;
  decision_note: string;
  owner_id: string;
  action_version: number;
  payload_hash: string;
  approved_payload_hash?: string;
  action_type?: string;
  action_payload?: unknown;
  target_account?: unknown;
  scheduled_at?: string;
  estimated_cost?: number;
  reversibility?: string;
  expires_at?: string;
  next_step?: string;
  changes?: unknown;
  diff?: unknown;
  revision?: number;
  created_at: string;
  decided_at: string;
};
type HandoffRecord = StoredRecord & {
  tenant_id: string;
  run_id: string;
  task_id: string;
  status: string;
  taken_by: string;
  snapshot: unknown;
  started_at: string;
  returned_at: string;
  revision?: number;
  transfer_note?: string;
};
type HandoffReturnRequest = {
  submittedBy: string;
  submittedAt: string;
  note: string;
  result: Record<string, unknown>;
  references: Array<Record<string, unknown>>;
  externalActionsPerformed: boolean;
  outcome: 'continue' | 'completed';
  taskStatus: WorkflowTaskStatus;
  runStatus: string;
};
type WorkItemRecord = {
  id: string;
  type: string;
  status: string;
  runId: string;
  taskId: string;
  ownerId: string;
  agent: string;
  risk: string;
  goalId: string;
  dueAt: string;
  [key: string]: unknown;
};

const COLLECTION = {
  config: 'digital_employee_configs',
  goals: 'weekly_goals',
  plans: 'weekly_plans',
  runs: 'workflow_runs',
  tasks: 'workflow_tasks',
  events: 'run_events',
  approvals: 'approval_requests',
  handoffs: 'handoff_sessions',
  reviews: 'weekly_reviews',
  outbox: 'digital_employee_outbox',
  contracts: 'execution_contracts',
} as const;

const streamClients = new Map<string, Set<Response>>();
const streamCursors = new WeakMap<Response, number>();

function jsonObject<T>(value: unknown, fallback: T): T {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return value as T;
}

function publicConfig(record: ConfigRecord | null): DigitalEmployeeConfig | null {
  return record ? normalizeDigitalEmployeeConfig(jsonObject(record.config, {})) : null;
}

function publicGoal(record: GoalRecord): WeeklyGoalInput & { id: string; status: string; version: number; createdAt: string; updatedAt: string } {
  return {
    id: record.id,
    title: String(record.title || ''),
    objective: String(record.objective || ''),
    metric: String(record.metric || ''),
    baseline: Number(record.baseline || 0),
    target: Number(record.target || 0),
    unit: String(record.unit || ''),
    startsAt: String(record.starts_at || ''),
    endsAt: String(record.ends_at || ''),
    scope: String(jsonObject(record.scope, record.scope || '')),
    budgetLimit: Number(record.budget_limit || 0),
    constraints: jsonObject<string[]>(record.constraints, []),
    status: String(record.status || 'draft'),
    version: Number(record.version || 1),
    createdAt: String(record.created_at || ''),
    updatedAt: String(record.updated_at || ''),
  };
}

async function first<T extends StoredRecord>(collection: string, where: Record<string, string | number | boolean>, sort = '-created_at'): Promise<T | null> {
  const result = await store.list<T>(collection, { where, sort, page: 1, perPage: 1 });
  return result.items[0] ?? null;
}

async function allPublishingReconciliations(tenantId: string, maximum = 25_000): Promise<PostRecord[]> {
  const items: PostRecord[] = [];
  let page = 1;
  while (true) {
    const result = await store.list<PostRecord>('posts', {
      where: { tenant_id: tenantId, reconciliation_required: true },
      sort: '-updated',
      page,
      perPage: 500,
    });
    if (result.totalItems > maximum || items.length + result.items.length > maximum) {
      throw new ReliableKernelError(
        'publishing_reconciliation_backlog_limit_exceeded',
        `待对账发布记录超过 ${maximum} 条，必须先处理积压，不能静默截断旧记录`,
      );
    }
    items.push(...result.items);
    if (page >= result.totalPages || !result.items.length) return items;
    page += 1;
  }
}

async function tenantRecord<T extends StoredRecord & { tenant_id: string }>(collection: string, id: string, tenantId: string): Promise<T | null> {
  const record = await store.getById<T>(collection, id);
  return record?.tenant_id === tenantId ? record : null;
}

async function requiredCreate<T extends StoredRecord>(collection: string, payload: Record<string, unknown>): Promise<T> {
  const record = await store.create<T>(collection, payload);
  if (!record) throw new Error(`${collection}_storage_unavailable`);
  return record;
}

async function appendAudit(input: {
  tenantId: string;
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const audit = await store.create('audit_logs', {
    tenantId: input.tenantId,
    actorUserId: input.userId,
    actorEmail: '',
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata || {},
    createdAt: new Date().toISOString(),
  });
  if (!audit) throw new ReliableKernelError('audit_log_persistence_failed');
}

async function transitionRun(run: RunRecord, nextStatus: string, patch: Record<string, unknown> = {}): Promise<RunRecord> {
  assertRunTransition(run.status, nextStatus);
  const result = await compareAndSetRecord<RunRecord>({
    store,
    collection: COLLECTION.runs,
    id: run.id,
    expected: { status: run.status, ...(run.revision === undefined ? {} : { revision: Number(run.revision || 0) }) },
    patch: { ...patch, status: nextStatus, revision: Number(run.revision || 0) + 1 },
  });
  if (!result.ok) throw new ReliableKernelError('run_state_conflict');
  Object.assign(run, result.record);
  return result.record;
}

async function transitionTask(task: TaskRecord, nextStatus: WorkflowTaskStatus, patch: Record<string, unknown> = {}): Promise<TaskRecord> {
  assertTaskTransition(task.status, nextStatus);
  const result = await compareAndSetRecord<TaskRecord>({
    store,
    collection: COLLECTION.tasks,
    id: task.id,
    expected: { status: task.status, ...(task.revision === undefined ? {} : { revision: Number(task.revision || 0) }) },
    patch: { ...patch, status: nextStatus, revision: Number(task.revision || 0) + 1 },
  });
  if (!result.ok) throw new ReliableKernelError('task_state_conflict');
  Object.assign(task, result.record);
  return result.record;
}

function goalInput(record: GoalRecord): WeeklyGoalInput {
  const publicRecord = publicGoal(record);
  const { id: _id, status: _status, version: _version, createdAt: _created, updatedAt: _updated, ...goal } = publicRecord;
  return goal;
}

function sendEvent(response: Response, event: EventRecord): void {
  const cursor = streamCursors.get(response) || 0;
  if (!isNextEventSequence(cursor, event.sequence)) return;
  const publicEvent = publicWorkflowEvent({
    ...event,
    payload: jsonObject<Record<string, unknown>>(event.payload, {}),
  });
  response.write(`id: ${event.sequence}\n`);
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(publicEvent)}\n\n`);
  streamCursors.set(response, Number(event.sequence));
}

async function appendEvent(input: {
  tenantId: string;
  runId: string;
  taskId?: string;
  type: string;
  level?: 'info' | 'warning' | 'error' | 'success';
  summary: string;
  payload?: Record<string, unknown>;
}): Promise<EventRecord> {
  let event: EventRecord | null = null;
  for (let attempt = 0; attempt < 32 && !event; attempt += 1) {
    const latest = await store.list<EventRecord>(COLLECTION.events, {
      where: { tenant_id: input.tenantId, run_id: input.runId }, sort: '-sequence', page: 1, perPage: 1,
    });
    const sequence = Number(latest.items[0]?.sequence || 0) + 1;
    const result = await createRecordIfAbsent<EventRecord>({
      store, collection: COLLECTION.events,
      uniqueWhere: { tenant_id: input.tenantId, run_id: input.runId, sequence },
      data: {
        tenant_id: input.tenantId, run_id: input.runId, task_id: input.taskId || '', sequence,
        type: input.type, level: input.level || 'info', summary: input.summary,
        payload: input.payload || {}, occurred_at: new Date().toISOString(),
      },
    });
    if (result.created) event = result.record;
  }
  if (!event) throw new Error('run_event_sequence_conflict');
  await createRecordIfAbsent({
    store, collection: COLLECTION.outbox, uniqueWhere: { tenant_id: input.tenantId, event_id: event.id },
    data: {
      tenant_id: input.tenantId, run_id: input.runId, event_id: event.id, sequence: event.sequence,
      topic: 'digital_employee.run_event', payload: event, status: 'pending', attempt: 0,
      available_at: new Date().toISOString(), lease_owner: '', lease_expires_at: '', error_detail: '',
      created_at: new Date().toISOString(), delivered_at: '',
    },
  });
  const clients = streamClients.get(input.runId) || [];
  for (const client of clients) sendEvent(client, event);
  return event;
}

async function configForTenant(tenantId: string): Promise<ConfigRecord | null> {
  return first<ConfigRecord>(COLLECTION.config, { tenant_id: tenantId }, '-updated_at');
}

async function liveExecutionContractGate(run: RunRecord): Promise<{ ok: true } | { ok: false; code: string; detail: string }> {
  const snapshot = jsonObject<{ executionContract?: ExecutionContract }>(run.execution_snapshot, {});
  const expectedGovernance = snapshot.executionContract?.dataGovernance;
  if (!expectedGovernance?.sourceVersion) return { ok: false, code: 'execution_contract_governance_snapshot_missing', detail: '运行快照缺少数据治理版本，请重新确认执行契约' };
  const profile = await readTenantEnterpriseProfile(run.tenant_id);
  const allowed = await liveAiGovernanceAllowsExecution(async () => profile.dataGovernance);
  const liveSourceVersion = String(profile.dataGovernance?.lastSavedAt || 'unknown').trim() || 'unknown';
  const validation = validateLiveGovernanceSnapshot(expectedGovernance, { aiAccessEnabled: allowed, sourceVersion: liveSourceVersion });
  if (!validation.ok) return { ok: false, code: validation.code, detail: validation.code === 'ai_data_access_disabled' ? '企业已实时撤销 AI 数据访问授权' : validation.code === 'execution_contract_source_changed' ? '企业正式事实版本已变化，请重新编译并确认执行契约' : '运行快照缺少数据治理版本，请重新确认执行契约' };
  return { ok: true };
}

async function isTenantUser(userId: string, tenantId: string): Promise<boolean> {
  if (!userId) return false;
  const user = await store.getById<StoredRecord>('users', userId);
  return Boolean(user && String(user.tenantId || user.tenant_id || '') === tenantId);
}

async function buildOverview(tenantId: string) {
  const [configRecord, goalResult] = await Promise.all([
    configForTenant(tenantId),
    store.list<GoalRecord>(COLLECTION.goals, { where: { tenant_id: tenantId }, sort: '-created_at', page: 1, perPage: 20 }),
  ]);
  const goal = goalResult.items[0] ?? null;
  if (!goal) {
    return { config: publicConfig(configRecord), goals: [], goal: null, contract: null, plan: null, run: null, tasks: [], events: [], approvals: [], handoffs: [], review: null, agents: [] };
  }
  const [contract, plan, run] = await Promise.all([
    first<ContractRecord>(COLLECTION.contracts, { tenant_id: tenantId, goal_id: goal.id }, '-version'),
    first<PlanRecord>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goal.id }),
    first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: goal.id }, '-started_at'),
  ]);
  const runId = run?.id || '';
  const [tasks, events, approvals, handoffs, review] = runId ? await Promise.all([
    store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: runId }, sort: 'sequence', perPage: 100 }),
    store.list<EventRecord>(COLLECTION.events, { where: { tenant_id: tenantId, run_id: runId }, sort: 'sequence', perPage: 500 }),
    store.list<ApprovalRecord>(COLLECTION.approvals, { where: { tenant_id: tenantId, run_id: runId }, sort: '-created_at', perPage: 100 }),
    store.list<HandoffRecord>(COLLECTION.handoffs, { where: { tenant_id: tenantId, run_id: runId }, sort: '-started_at', perPage: 100 }),
    first<StoredRecord & { tenant_id: string; run_id: string; summary: unknown; status: string; created_at: string }>(COLLECTION.reviews, { tenant_id: tenantId, run_id: runId }),
  ]) : [null, null, null, null, null] as const;
  const taskItems = tasks?.items || [];
  const agents = [...new Set(taskItems.map(task => task.agent_role))].map(role => {
    const agentTasks = taskItems.filter(task => task.agent_role === role);
    const active = agentTasks.find(task => ['running', 'waiting_approval', 'handed_off'].includes(task.status));
    return {
      role,
      status: active?.status || (agentTasks.every(task => task.status === 'succeeded') ? 'completed' : 'idle'),
      currentTask: active?.title || '',
      completed: agentTasks.filter(task => task.status === 'succeeded').length,
      total: agentTasks.length,
    };
  });
  return {
    config: publicConfig(configRecord),
    goals: goalResult.items.map(publicGoal),
    goal: publicGoal(goal),
    contract: contract ? publicWorkflowValue({
      id: contract.id,
      version: contract.version,
      status: contract.status,
      confirmedAt: contract.confirmed_at,
      ...jsonObject<Record<string, unknown>>(contract.contract, {}),
    }) : null,
    plan: plan ? publicWorkflowValue({
      id: plan.id,
      status: plan.status,
      ...jsonObject<Record<string, unknown>>(plan.plan, {}),
    }) : null,
    run: publicWorkflowRun(run),
    tasks: taskItems.map(task => publicWorkflowTask({
      ...task,
      depends_on: jsonObject(task.depends_on, []),
      output: jsonObject(task.output, {}),
    })),
    events: events?.items.map(event => publicWorkflowEvent({
      ...event,
      payload: jsonObject(event.payload, {}),
    })) || [],
    approvals: approvals?.items.map(approval => publicWorkflowApproval({
      ...approval,
      action_payload: jsonObject(approval.action_payload, {}),
      evidence: jsonObject(approval.evidence, []),
      target_account: jsonObject(approval.target_account, {}),
      changes: jsonObject(approval.changes, {}),
      diff: jsonObject(approval.diff, {}),
    })) || [],
    handoffs: handoffs?.items.map(handoff => publicWorkflowHandoff({
      ...handoff,
      snapshot: jsonObject(handoff.snapshot, {}),
    })) || [],
    review: publicWorkflowReview(review ? { ...review, summary: jsonObject(review.summary, {}) } : null),
    agents,
  };
}

async function createApproval(tenantId: string, goal: GoalRecord, run: RunRecord, task: TaskRecord): Promise<ApprovalRecord> {
  const priorTasks = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: tenantId, run_id: run.id }, sort: 'sequence', perPage: 100 });
  const contentTask = priorTasks.items.find(item => item.task_key === 'content_execution_pack' && item.status === 'succeeded');
  if (!contentTask) throw new ReliableKernelError('approval_artifact_missing', '审批所需的 Studio 草稿尚未生成');
  const snapshot = jsonObject<{ executionContract?: ExecutionContract; config?: DigitalEmployeeConfig }>(run.execution_snapshot, {});
  if (!snapshot.executionContract) throw new ReliableKernelError('execution_contract_missing');
  const proposal = buildOutboundActionProposal({
    tenantId,
    runId: run.id,
    taskId: task.id,
    goalTitle: goal.title,
    contract: snapshot.executionContract,
    draft: jsonObject<Record<string, unknown>>(contentTask.output, {}),
  });
  const payloadHash = proposalIntegrityHash(proposal);
  if (payloadHash !== proposal.payloadHash) throw new ReliableKernelError('action_proposal_hash_invalid');
  const evidence = priorTasks.items
    .filter(item => item.status === 'succeeded')
    .map(item => ({ taskId: item.id, title: item.title, artifactReferences: jsonObject<Record<string, unknown>>(item.output, {}) }));
  const created = await createRecordIfAbsent<ApprovalRecord>({
    store,
    collection: COLLECTION.approvals,
    uniqueWhere: { tenant_id: tenantId, task_id: task.id, action_version: proposal.version },
    data: {
    tenant_id: tenantId,
    goal_id: goal.id,
    run_id: run.id,
    task_id: task.id,
    status: 'pending',
    action_summary: proposal.mode === 'real'
      ? '批准指定 Studio 产出按指定账号和时间创建排期；发布由现有 Worker 执行。'
      : '批准对指定 Studio 产出执行安全 dry-run；不会模拟真实发布成功。',
    action_type: proposal.actionType,
    action_payload: proposal,
    risk_level: proposal.risk,
    evidence,
    requested_by_agent: task.agent_role,
    owner_id: snapshot.config?.approvalOwner || goal.owner_id,
    action_version: proposal.version,
    payload_hash: payloadHash,
    approved_payload_hash: '',
    target_account: proposal.targetAccount,
    scheduled_at: proposal.scheduledAt,
    estimated_cost: proposal.estimatedCost,
    reversibility: proposal.reversibility,
    expires_at: proposal.expiresAt,
    next_step: proposal.nextStep,
    decided_by: '',
    decision_note: '',
    created_at: new Date().toISOString(),
    decided_at: '',
    revision: 0,
  },
  });
  return created.record;
}

async function completeReview(tenantId: string, goal: GoalRecord, run: RunRecord): Promise<EvidenceBackedReview> {
  const existing = await first<StoredRecord & { tenant_id: string }>(COLLECTION.reviews, { tenant_id: tenantId, run_id: run.id, status: 'generated' }, '-version');
  if (existing) return jsonObject<EvidenceBackedReview>(existing.summary, {} as EvidenceBackedReview);
  const previous = await first<StoredRecord & { tenant_id: string }>(COLLECTION.reviews, { tenant_id: tenantId, run_id: run.id }, '-version');
  const version = Number(previous?.version || 0) + 1;
  const summary = await buildEvidenceBackedReview({ tenantId, runId: run.id, goal: goalInput(goal) });
  await createRecordIfAbsent<StoredRecord>({
    store,
    collection: COLLECTION.reviews,
    uniqueWhere: { tenant_id: tenantId, run_id: run.id, version },
    data: { tenant_id: tenantId, goal_id: goal.id, run_id: run.id, version, status: 'generated', summary, created_at: new Date().toISOString() },
  });
  return summary;
}

const HANDOFF_SAGA_STALE_MS = Math.max(5_000, Number(process.env.DIGITAL_EMPLOYEE_HANDOFF_SAGA_STALE_MS || 15_000));

function returnRequestFromSnapshot(handoff: HandoffRecord): HandoffReturnRequest | null {
  const snapshot = jsonObject<Record<string, unknown>>(handoff.snapshot, {});
  const request = jsonObject<Partial<HandoffReturnRequest>>(snapshot.returnRequest, {});
  if (snapshot.returnState !== 'committing'
    || !request.submittedBy
    || !request.submittedAt
    || !['continue', 'completed'].includes(String(request.outcome))
    || !request.taskStatus
    || !request.runStatus
    || !request.result
    || !Array.isArray(request.references)
    || typeof request.externalActionsPerformed !== 'boolean') return null;
  return request as HandoffReturnRequest;
}

async function persistHandoffReturnSideEffects(input: {
  tenantId: string;
  run: RunRecord;
  task: TaskRecord;
  handoff: HandoffRecord;
  request: HandoffReturnRequest;
}): Promise<void> {
  const { tenantId, run, task, handoff, request } = input;
  if (request.outcome === 'completed') {
    const pendingApproval = await first<ApprovalRecord>(COLLECTION.approvals, { tenant_id: tenantId, task_id: task.id, status: 'pending' }, '-created_at');
    if (pendingApproval) {
      await compareAndSetRecord({
        store, collection: COLLECTION.approvals, id: pendingApproval.id,
        expected: { status: 'pending', payload_hash: pendingApproval.payload_hash },
        patch: { status: 'invalidated', decision_note: '任务由人工接管完成', decided_by: request.submittedBy, decided_at: request.submittedAt, revision: Number(pendingApproval.revision || 0) + 1 },
      });
    }
  }
  if (!request.externalActionsPerformed) return;
  const evidenceHash = stableHash({
    handoffId: handoff.id,
    submittedBy: request.submittedBy,
    submittedAt: request.submittedAt,
    result: request.result,
    references: request.references,
    outcome: request.outcome,
  });
  const idempotencyKey = `${run.id}:${task.id}:handoff:${handoff.id}:human:v1`;
  await createRecordIfAbsent({
    store,
    collection: 'outbound_action_ledger',
    uniqueWhere: { tenant_id: tenantId, idempotency_key: idempotencyKey },
    data: {
      tenant_id: tenantId,
      run_id: run.id,
      task_id: task.id,
      approval_id: `handoff:${handoff.id}`,
      action_type: 'human_external_action',
      action_version: 1,
      status: 'human_completed',
      idempotency_key: idempotencyKey,
      approved_payload_hash: evidenceHash,
      payload: request,
      external_record_id: String(request.references[0]?.id || '').slice(0, 300),
      reason: request.note,
      created_at: request.submittedAt,
      updated_at: request.submittedAt,
    },
  });
}

/** Finish a return saga that was interrupted after its durable handoff reservation. */
async function recoverCommittingHandoffReturn(run: RunRecord): Promise<boolean> {
  const sessions = await store.list<HandoffRecord>(COLLECTION.handoffs, {
    where: { tenant_id: run.tenant_id, run_id: run.id, status: 'active' }, sort: '-started_at', perPage: 20,
  });
  const handoff = sessions.items.find(item => returnRequestFromSnapshot(item));
  if (!handoff) return false;
  const request = returnRequestFromSnapshot(handoff)!;
  const requestedAt = Date.parse(request.submittedAt);
  if (Number.isFinite(requestedAt) && Date.now() - requestedAt < HANDOFF_SAGA_STALE_MS) return false;
  const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, handoff.task_id, run.tenant_id);
  if (!task) throw new ReliableKernelError('handoff_return_task_missing');
  let runChanged = false;
  if (run.status === 'waiting_human') {
    await transitionRun(run, request.runStatus, { current_controller: 'agent', pause_reason: '', available_at: new Date().toISOString(), lease_owner: '', lease_expires_at: '' });
    runChanged = true;
  } else if (run.status !== request.runStatus) {
    return false;
  }
  try {
    if (task.status === 'handed_off') {
      await transitionTask(task, request.taskStatus, {
        owner_id: request.outcome === 'completed' ? request.submittedBy : '',
        blocked_reason: request.taskStatus === 'waiting_approval' ? '等待负责人审批' : '',
        output: request.outcome === 'completed'
          ? { ...jsonObject<Record<string, unknown>>(task.output, {}), humanResult: request }
          : jsonObject<Record<string, unknown>>(task.output, {}),
        available_at: request.submittedAt,
        completed_at: request.outcome === 'completed' ? request.submittedAt : '',
        lease_owner: '', lease_expires_at: '', updated_at: new Date().toISOString(),
      });
    } else if (task.status !== request.taskStatus) {
      throw new ReliableKernelError('handoff_return_task_state_conflict');
    }
  } catch (error) {
    if (runChanged && ['running', 'waiting_approval'].includes(run.status)) {
      await transitionRun(run, 'waiting_human', { current_controller: handoff.taken_by, pause_reason: '人工返还恢复等待重试', lease_owner: '', lease_expires_at: '' }).catch(() => undefined);
    }
    throw error;
  }
  await persistHandoffReturnSideEffects({ tenantId: run.tenant_id, run, task, handoff, request });
  const snapshot = jsonObject<Record<string, unknown>>(handoff.snapshot, {});
  const returned = await compareAndSetRecord<HandoffRecord>({
    store, collection: COLLECTION.handoffs, id: handoff.id,
    expected: { status: 'active', ...(handoff.revision === undefined ? {} : { revision: Number(handoff.revision || 0) }) },
    patch: { status: 'returned', returned_at: new Date().toISOString(), snapshot: { ...snapshot, returnState: 'completed' }, revision: Number(handoff.revision || 0) + 1 },
  });
  if (!returned.ok) throw new ReliableKernelError('handoff_return_recovery_conflict');
  await appendEvent({ tenantId: run.tenant_id, runId: run.id, taskId: task.id, type: 'handoff.return_recovered', level: 'warning', summary: '已恢复进程中断前提交的人工返还结果', payload: { handoffId: handoff.id, outcome: request.outcome, externalActionsPerformed: request.externalActionsPerformed } });
  await appendAudit({ tenantId: run.tenant_id, userId: 'system:digital-worker', action: 'handoff.return_recovered', targetType: 'handoff_session', targetId: handoff.id, metadata: { runId: run.id, taskId: task.id } });
  return true;
}

const RUN_LEASE_MS = Math.max(5_000, Number(process.env.DIGITAL_EMPLOYEE_RUN_LEASE_MS || 45_000));
const TASK_LEASE_MS = Math.max(5_000, Number(process.env.DIGITAL_EMPLOYEE_TASK_LEASE_MS || 30_000));
const TASK_TIMEOUT_MS = Math.max(5_000, Number(process.env.DIGITAL_EMPLOYEE_TASK_TIMEOUT_MS || 120_000));
const RENDER_TASK_TIMEOUT_MS = Math.max(10 * 60_000, Number(process.env.DIGITAL_EMPLOYEE_RENDER_TASK_TIMEOUT_MS || 10 * 60_000));
const WORKER_ID = workerIdentity();

function taskPayload(task: { key: string; title: string; description: string; agentRole: string; kind: string; sequence: number; priority: string; requiresApproval: boolean; dependsOn: string[]; expectedMinutes?: number }, input: {
  tenantId: string; goalId: string; planId: string; runId: string; now: string; expectedCost: number;
}): Record<string, unknown> {
  return {
    tenant_id: input.tenantId, goal_id: input.goalId, plan_id: input.planId, run_id: input.runId,
    task_key: task.key, title: task.title, description: task.description, agent_role: task.agentRole,
    kind: task.kind, status: 'pending', sequence: task.sequence, priority: task.priority,
    requires_approval: task.requiresApproval, depends_on: task.dependsOn, output: {}, blocked_reason: '', owner_id: '',
    created_at: input.now, updated_at: input.now, attempt: 0, max_attempts: 3, available_at: input.now,
    lease_owner: '', lease_expires_at: '', started_at: '', completed_at: '', error_code: '', error_detail: '',
    idempotency_key: `${input.runId}:${task.key}:v1`, actual_cost: 0, expected_cost: input.expectedCost, revision: 0,
  };
}

/** Repair a run whose start request persisted only a subset of its tasks. */
async function repairIncompleteRun(run: RunRecord): Promise<TaskRecord[]> {
  const snapshot = jsonObject<{ plan?: { tasks?: Array<Record<string, unknown>>; estimatedCost?: number } }>(run.execution_snapshot, {});
  const plannedTasks = Array.isArray(snapshot.plan?.tasks) ? snapshot.plan!.tasks! : [];
  if (!plannedTasks.length) throw new ReliableKernelError('run_plan_snapshot_missing');
  const expectedCost = Math.max(0, Number(snapshot.plan?.estimatedCost || 0)) / plannedTasks.length;
  const now = new Date().toISOString();
  const byKey = new Map(plannedTasks.map(raw => [String(raw.key || ''), raw]));
  if (byKey.has('')) throw new ReliableKernelError('run_plan_task_key_missing');
  await repairRecordSet([...byKey.keys()], async key => {
    const raw = byKey.get(key)!;
    await createRecordIfAbsent<TaskRecord>({
      store,
      collection: COLLECTION.tasks,
      uniqueWhere: { tenant_id: run.tenant_id, run_id: run.id, task_key: key },
      data: taskPayload({
        key, title: String(raw.title || key), description: String(raw.description || ''),
        agentRole: String(raw.agentRole || ''), kind: String(raw.kind || ''), sequence: Number(raw.sequence || 0),
        priority: String(raw.priority || 'medium'), requiresApproval: Boolean(raw.requiresApproval),
        dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn.map(String) : [], expectedMinutes: Number(raw.expectedMinutes || 0),
      }, { tenantId: run.tenant_id, goalId: run.goal_id, planId: run.plan_id, runId: run.id, now, expectedCost }),
    });
  });
  const result = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: run.tenant_id, run_id: run.id }, sort: 'sequence', perPage: 100 });
  if (result.items.length !== plannedTasks.length) throw new ReliableKernelError('run_task_repair_incomplete', '任务恢复后数量仍不完整', true);
  return result.items;
}

async function recalculateRunCost(run: RunRecord): Promise<void> {
  const tasks = await store.list<TaskRecord>(COLLECTION.tasks, { where: { tenant_id: run.tenant_id, run_id: run.id }, perPage: 100 });
  const actualCost = Math.round(tasks.items.reduce((sum, task) => sum + Math.max(0, Number(task.actual_cost || 0)), 0) * 100) / 100;
  const result = await compareAndSetRecord<RunRecord>({
    store, collection: COLLECTION.runs, id: run.id,
    expected: { lease_owner: WORKER_ID, status: 'running' },
    patch: { budget_spent: actualCost },
  });
  if (!result.ok) throw new ReliableKernelError('run_lease_lost', '无法写入实际费用', true);
  run.budget_spent = actualCost;
}

async function reconcileApprovalDecision(input: {
  tenantId: string; approval: ApprovalRecord; task: TaskRecord; run: RunRecord; goal: GoalRecord;
}): Promise<void> {
  const { approval, task, run, goal, tenantId } = input;
  if (approval.status === 'pending') return;
  const now = approval.decided_at || new Date().toISOString();
  if (approval.status === 'rejected') {
    if (task.status === 'waiting_approval') {
      await transitionTask(task, 'failed', { blocked_reason: approval.decision_note || '审批驳回', error_code: 'approval_rejected', error_detail: approval.decision_note || '', completed_at: now, lease_owner: '', lease_expires_at: '', updated_at: now });
    }
    if (['waiting_approval', 'running'].includes(run.status)) {
      await transitionRun(run, 'failed', { current_controller: 'human', pause_reason: approval.decision_note || '审批驳回', error_code: 'approval_rejected', error_detail: approval.decision_note || '', completed_at: now, lease_owner: '', lease_expires_at: '' });
    }
    if (goal.status === 'active') {
      const changed = await compareAndSetRecord<GoalRecord>({ store, collection: COLLECTION.goals, id: goal.id, expected: { status: 'active', version: goal.version }, patch: { status: 'paused', updated_at: now } });
      if (changed.ok) Object.assign(goal, changed.record);
    }
    await completeReview(tenantId, goal, run);
    return;
  }
  if (!['approved', 'approved_with_changes'].includes(approval.status)) return;
  if (task.status === 'waiting_approval') {
    await transitionTask(task, 'succeeded', {
      output: { decision: approval.status, note: approval.decision_note, changes: jsonObject(approval.changes, {}), diff: jsonObject(approval.diff, {}), approvedAt: now, approvedPayloadHash: approval.approved_payload_hash || approval.payload_hash },
      blocked_reason: '', completed_at: now, error_code: '', error_detail: '', updated_at: now,
    });
  }
  if (run.status === 'waiting_approval') {
    await transitionRun(run, 'running', { current_controller: 'agent', pause_reason: '', available_at: now, lease_owner: '', lease_expires_at: '' });
  }
}

async function recoverRunState(run: RunRecord, goal: GoalRecord, tasks: TaskRecord[]): Promise<void> {
  for (const task of tasks) {
    if (task.status === 'running' && isLeaseExpired(task.lease_expires_at)) {
      const attempt = Number(task.attempt || 0);
      const maxAttempts = Math.max(1, Number(task.max_attempts || 3));
      if (attempt >= maxAttempts) {
        await transitionTask(task, 'failed', { error_code: 'worker_lease_expired', error_detail: '任务租约过期且已耗尽重试次数', blocked_reason: 'Worker 中断后恢复失败', completed_at: new Date().toISOString(), lease_owner: '', lease_expires_at: '', updated_at: new Date().toISOString() });
      } else {
        const availableAt = new Date(Date.now() + retryDelayMs(attempt)).toISOString();
        await transitionTask(task, 'pending', { error_code: 'worker_lease_expired', error_detail: '检测到进程中断，任务已安全进入重试队列', blocked_reason: '', available_at: availableAt, lease_owner: '', lease_expires_at: '', updated_at: new Date().toISOString() });
        await appendEvent({ tenantId: run.tenant_id, runId: run.id, taskId: task.id, type: 'task.recovered', level: 'warning', summary: `${task.title} 在 Worker 重启后恢复并等待重试`, payload: { attempt, availableAt } });
      }
    }
    if (task.status === 'waiting_approval') {
      const approval = await first<ApprovalRecord>(COLLECTION.approvals, { tenant_id: run.tenant_id, task_id: task.id }, '-created_at');
      if (approval?.status === 'pending' && approval.expires_at && Date.parse(approval.expires_at) <= Date.now()) {
        const expired = await compareAndSetRecord<ApprovalRecord>({ store, collection: COLLECTION.approvals, id: approval.id, expected: { status: 'pending', action_version: approval.action_version, payload_hash: approval.payload_hash }, patch: { status: 'expired', decision_note: '审批已超过有效期', decided_at: new Date().toISOString(), revision: Number(approval.revision || 0) + 1 } });
        if (expired.ok) await transitionTask(task, 'failed', { error_code: 'approval_expired', error_detail: '审批已超过有效期', blocked_reason: '审批已过期', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      } else if (approval && approval.status !== 'pending') await reconcileApprovalDecision({ tenantId: run.tenant_id, approval, task, run, goal });
    }
  }
  // A process can stop after the approval task was reconciled but before the
  // run was released. Reconcile from the durable decision even when the task
  // is already terminal, otherwise the run would remain waiting forever.
  if (run.status === 'waiting_approval') {
    const approvals = await store.list<ApprovalRecord>(COLLECTION.approvals, {
      where: { tenant_id: run.tenant_id, run_id: run.id }, sort: '-decided_at', perPage: 100,
    });
    const decided = approvals.items.find(item => ['approved', 'approved_with_changes', 'rejected'].includes(item.status));
    const task = decided ? tasks.find(item => item.id === decided.task_id) : undefined;
    if (decided && task) await reconcileApprovalDecision({ tenantId: run.tenant_id, approval: decided, task, run, goal });
  }
}

async function failRun(input: { run: RunRecord; goal: GoalRecord; task?: TaskRecord; code: string; detail: string }): Promise<void> {
  const now = new Date().toISOString();
  const pendingApprovals = await store.list<ApprovalRecord>(COLLECTION.approvals, { where: { tenant_id: input.run.tenant_id, run_id: input.run.id, status: 'pending' }, perPage: 100 });
  await Promise.all(pendingApprovals.items.map(approval => compareAndSetRecord<ApprovalRecord>({
    store, collection: COLLECTION.approvals, id: approval.id,
    expected: { status: 'pending', payload_hash: approval.payload_hash },
    patch: { status: 'invalidated', decision_note: input.detail, decided_at: now, revision: Number(approval.revision || 0) + 1 },
  })));
  if (input.task && !['failed', 'cancelled', 'succeeded'].includes(input.task.status)) {
    await transitionTask(input.task, 'failed', { error_code: input.code, error_detail: input.detail, blocked_reason: input.detail, completed_at: now, lease_owner: '', lease_expires_at: '', updated_at: now });
  }
  if (!['failed', 'cancelled', 'succeeded'].includes(input.run.status)) {
    await transitionRun(input.run, 'failed', { error_code: input.code, error_detail: input.detail, pause_reason: input.detail, completed_at: now, current_controller: 'agent', lease_owner: '', lease_expires_at: '' });
  }
  if (input.goal.status === 'active') {
    const changed = await compareAndSetRecord<GoalRecord>({ store, collection: COLLECTION.goals, id: input.goal.id, expected: { status: 'active', version: input.goal.version }, patch: { status: 'paused', updated_at: now } });
    if (changed.ok) Object.assign(input.goal, changed.record);
  }
  await completeReview(input.run.tenant_id, input.goal, input.run);
  await appendEvent({ tenantId: input.run.tenant_id, runId: input.run.id, taskId: input.task?.id, type: 'workflow.failed', level: 'error', summary: '工作流执行失败；已生成包含失败证据的复盘', payload: { errorCode: input.code } });
  await appendAudit({ tenantId: input.run.tenant_id, userId: 'system:digital-worker', action: 'workflow.failed', targetType: 'workflow_run', targetId: input.run.id, metadata: { errorCode: input.code, taskId: input.task?.id || '' } });
}

async function claimRun(run: RunRecord): Promise<boolean> {
  if (!['planning', 'running'].includes(run.status) || !isAvailable(run.available_at)) return false;
  if (run.lease_owner && run.lease_owner !== WORKER_ID && !isLeaseExpired(run.lease_expires_at)) return false;
  if (run.status === 'planning') assertRunTransition('planning', 'running');
  const result = await compareAndSetRecord<RunRecord>({
    store, collection: COLLECTION.runs, id: run.id,
    expected: {
      status: run.status,
      lease_owner: run.lease_owner || '',
      ...(run.revision === undefined ? {} : { revision: Number(run.revision || 0) }),
    },
    patch: {
      status: 'running', current_controller: 'agent', pause_reason: '', lease_owner: WORKER_ID,
      lease_expires_at: new Date(Date.now() + RUN_LEASE_MS).toISOString(), revision: Number(run.revision || 0) + 1,
    },
  });
  if (!result.ok) return false;
  Object.assign(run, result.record);
  return true;
}

export async function advanceRun(tenantId: string, runId: string): Promise<void> {
  let run = await tenantRecord<RunRecord>(COLLECTION.runs, runId, tenantId);
  if (!run || ['paused', 'cancelled', 'failed', 'succeeded'].includes(run.status)) return;
  await recoverCommittingHandoffReturn(run);
  run = await tenantRecord<RunRecord>(COLLECTION.runs, runId, tenantId) || run;
  if (run.status === 'waiting_human') return;
  const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, tenantId);
  const config = publicConfig(await configForTenant(tenantId));
  if (!goal || !config) {
    if (goal) await failRun({ run, goal, code: 'run_context_missing', detail: '运行所需目标或数字员工配置不存在' });
    return;
  }

  let tasks = await repairIncompleteRun(run);
  const initialLiveGate = await liveExecutionContractGate(run);
  if (!initialLiveGate.ok) {
    await failRun({ run, goal, task: tasks.find(task => !['succeeded', 'skipped', 'failed', 'cancelled'].includes(task.status)), code: initialLiveGate.code, detail: initialLiveGate.detail });
    return;
  }
  await recoverRunState(run, goal, tasks);
  const recoveredFailure = tasks.find(task => task.status === 'failed');
  if (recoveredFailure && !['failed', 'cancelled', 'succeeded'].includes(run.status)) {
    await failRun({ run, goal, task: recoveredFailure, code: recoveredFailure.error_code || 'task_failed', detail: recoveredFailure.error_detail || recoveredFailure.blocked_reason || '任务失败' });
    return;
  }
  run = await tenantRecord<RunRecord>(COLLECTION.runs, run.id, tenantId) || run;
  if (run.status === 'waiting_approval') return;
  if (!await claimRun(run)) return;
  tasks = await repairIncompleteRun(run);
  await recalculateRunCost(run);
  const runSnapshot = jsonObject<{ executionContract?: ExecutionContract }>(run.execution_snapshot, {});

  for (const task of tasks) {
    if (['succeeded', 'skipped'].includes(task.status)) continue;
    if (task.status === 'running' && !isLeaseExpired(task.lease_expires_at)) return;
    if (['failed', 'cancelled', 'handed_off', 'waiting_approval'].includes(task.status)) return;
    if (!isAvailable(task.available_at)) return;
    if (Number(task.attempt || 0) >= Math.max(1, Number(task.max_attempts || 3))) {
      await failRun({ run, goal, task, code: 'task_attempts_exhausted', detail: '任务已达到最大尝试次数' });
      return;
    }
    const liveGate = await liveExecutionContractGate(run);
    if (!liveGate.ok) {
      await failRun({ run, goal, task, code: liveGate.code, detail: liveGate.detail });
      return;
    }
    const gate = evaluateExecutionGates({ run, task, tasks });
    if (!gate.allowed) {
      if (gate.code === 'dependency_pending') return;
      await failRun({ run, goal, task, code: gate.code || 'execution_gate_failed', detail: gate.detail || '执行门禁未通过' });
      return;
    }
    if (gate.needsApproval) {
      const approval = await createApproval(tenantId, goal, run, task);
      await transitionTask(task, 'waiting_approval', { blocked_reason: '等待负责人精确审批', lease_owner: '', lease_expires_at: '', updated_at: new Date().toISOString() });
      await transitionRun(run, 'waiting_approval', { current_controller: 'human', lease_owner: '', lease_expires_at: '' });
      await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'approval.requested', level: 'warning', summary: `${task.title}：已进入人工精确审批`, payload: { approvalId: approval.id, actionVersion: approval.action_version, payloadHash: approval.payload_hash, expiresAt: approval.expires_at, riskLevel: approval.risk_level } });
      await appendAudit({ tenantId, userId: 'system:digital-worker', action: 'approval.requested', targetType: 'approval_request', targetId: approval.id, metadata: { runId: run.id, taskId: task.id, payloadHash: approval.payload_hash } });
      return;
    }

    const now = new Date().toISOString();
    const attempt = Number(task.attempt || 0) + 1;
    const claimed = await compareAndSetRecord<TaskRecord>({
      store, collection: COLLECTION.tasks, id: task.id,
      expected: { status: 'pending', lease_owner: task.lease_owner || '', ...(task.revision === undefined ? {} : { revision: Number(task.revision || 0) }) },
      patch: { status: 'running', attempt, lease_owner: WORKER_ID, lease_expires_at: new Date(Date.now() + TASK_LEASE_MS).toISOString(), started_at: task.started_at || now, updated_at: now, revision: Number(task.revision || 0) + 1 },
    });
    if (!claimed.ok) return;
    Object.assign(task, claimed.record);
    await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'task.started', summary: `${task.agent_role} Agent 开始：${task.title}`, payload: { attempt, maxAttempts: Number(task.max_attempts || 3) } });
    await appendAudit({ tenantId, userId: 'system:digital-worker', action: 'task.started', targetType: 'workflow_task', targetId: task.id, metadata: { runId: run.id, attempt } });

    try {
      const output = await runWithHeartbeat({
        heartbeatMs: Math.max(1_000, Math.floor(TASK_LEASE_MS / 3)),
        timeoutMs: taskExecutionTimeoutMs(task.task_key, TASK_TIMEOUT_MS, RENDER_TASK_TIMEOUT_MS),
        heartbeat: async () => {
          const expiresAt = new Date(Date.now() + TASK_LEASE_MS).toISOString();
          const [taskLease, runLease] = await Promise.all([
            compareAndSetRecord<TaskRecord>({ store, collection: COLLECTION.tasks, id: task.id, expected: { status: 'running', lease_owner: WORKER_ID }, patch: { lease_expires_at: expiresAt, updated_at: new Date().toISOString() } }),
            compareAndSetRecord<RunRecord>({ store, collection: COLLECTION.runs, id: run.id, expected: { status: 'running', lease_owner: WORKER_ID }, patch: { lease_expires_at: new Date(Date.now() + RUN_LEASE_MS).toISOString() } }),
          ]);
          recordWorkerHeartbeat('digital-employee-runner', { state: 'executing', runId: run.id, taskId: task.id, attempt });
          return taskLease.ok && runLease.ok;
        },
        work: signal => executeSocialLoopTask({ tenantId, userId: goal.owner_id, runId: run.id, taskId: task.id, taskKey: task.task_key, goal: goalInput(goal), config, contract: runSnapshot.executionContract, signal }),
      });
      const actualCost = Math.max(0, Number(output.actualCost || output.actual_cost || 0));
      const cumulativeTaskCost = Math.round((Math.max(0, Number(task.actual_cost || 0)) + actualCost) * 100) / 100;
      if (Number(run.budget_spent || 0) + actualCost > Number(run.budget_limit || 0)) {
        throw new ReliableKernelError('budget_exceeded', '实际费用将超过本周预算');
      }
      const completedAt = new Date().toISOString();
      const completed = await compareAndSetRecord<TaskRecord>({
        store, collection: COLLECTION.tasks, id: task.id,
        expected: { status: 'running', lease_owner: WORKER_ID, ...(task.revision === undefined ? {} : { revision: Number(task.revision || 0) }) },
        patch: { status: 'succeeded', output, blocked_reason: '', completed_at: completedAt, lease_owner: '', lease_expires_at: '', actual_cost: cumulativeTaskCost, error_code: '', error_detail: '', updated_at: completedAt, revision: Number(task.revision || 0) + 1 },
      });
      if (!completed.ok) throw new ReliableKernelError('task_lease_lost', '完成任务时租约已失效', true);
      Object.assign(task, completed.record);
      await recalculateRunCost(run);
      await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'task.completed', level: 'success', summary: `${task.title} 已完成`, payload: { output, actualCost } });
      await appendAudit({ tenantId, userId: 'system:digital-worker', action: 'task.completed', targetType: 'workflow_task', targetId: task.id, metadata: { runId: run.id, attempt, actualCost } });
    } catch (error) {
      const info = errorInfo(error);
      const current = await tenantRecord<TaskRecord>(COLLECTION.tasks, task.id, tenantId);
      if (!current || current.status !== 'running' || current.lease_owner !== WORKER_ID) return;
      const incurredCost = Math.max(0, Number((error as { actualCost?: unknown })?.actualCost || 0));
      if (incurredCost) {
        const cumulativeCost = Math.round((Math.max(0, Number(current.actual_cost || 0)) + incurredCost) * 100) / 100;
        const costSaved = await compareAndSetRecord<TaskRecord>({ store, collection: COLLECTION.tasks, id: current.id, expected: { status: 'running', lease_owner: WORKER_ID }, patch: { actual_cost: cumulativeCost } });
        if (costSaved.ok) Object.assign(current, costSaved.record);
      }
      const maxAttempts = Math.max(1, Number(current.max_attempts || 3));
      if (canRetryTask(attempt, maxAttempts, info.retryable)) {
        const availableAt = new Date(Date.now() + retryDelayMs(attempt)).toISOString();
        await transitionTask(current, 'pending', { error_code: info.code, error_detail: info.detail, blocked_reason: '', available_at: availableAt, lease_owner: '', lease_expires_at: '', updated_at: new Date().toISOString() });
        await recalculateRunCost(run);
        await compareAndSetRecord<RunRecord>({ store, collection: COLLECTION.runs, id: run.id, expected: { status: 'running', lease_owner: WORKER_ID }, patch: { available_at: availableAt, lease_owner: '', lease_expires_at: '', error_code: info.code, error_detail: info.detail } });
        await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'task.retry_scheduled', level: 'warning', summary: `${task.title} 执行失败，已安排有限重试`, payload: { attempt, maxAttempts, availableAt, errorCode: info.code } });
        return;
      }
      if (incurredCost) await recalculateRunCost(run);
      await failRun({ run, goal, task: current, code: info.code, detail: info.detail });
      return;
    }
  }

  const review = await completeReview(tenantId, goal, run);
  const completedAt = new Date().toISOString();
  await transitionRun(run, 'succeeded', { current_controller: 'agent', completed_at: completedAt, lease_owner: '', lease_expires_at: '', error_code: '', error_detail: '' });
  if (review.businessOutcome.status === 'achieved' && goal.status === 'active') {
    const changed = await compareAndSetRecord<GoalRecord>({ store, collection: COLLECTION.goals, id: goal.id, expected: { status: 'active', version: goal.version }, patch: { status: 'completed', updated_at: completedAt } });
    if (changed.ok) Object.assign(goal, changed.record);
  }
  await appendEvent({ tenantId, runId: run.id, type: 'workflow.completed', level: 'success', summary: review.businessOutcome.status === 'achieved' ? '工作流已完成，正式数据证明经营目标达成' : '工作流已完成，经营目标仍等待正式数据验证', payload: { businessOutcomeStatus: review.businessOutcome.status } });
  await appendAudit({ tenantId, userId: 'system:digital-worker', action: 'workflow.completed', targetType: 'workflow_run', targetId: run.id, metadata: { businessOutcomeStatus: review.businessOutcome.status } });
}

let workerBusy = false;
const workerStatusPages = new Map<string, number>();
const workerAdmission = new WorkerAdmissionController();
let workerTimer: NodeJS.Timeout | undefined;
let unregisterWorkerHeartbeat: (() => void) | undefined;
const workerDrainWaiters = new Set<() => void>();
export async function runDigitalEmployeeWorkerOnce(): Promise<void> {
  if (workerBusy || !workerAdmission.accepting()) return;
  workerBusy = true;
  try {
    let scanned = 0;
    for (const status of ['planning', 'running', 'waiting_approval', 'waiting_human']) {
      const requestedPage = workerStatusPages.get(status) || 1;
      const runs = await store.list<RunRecord>(COLLECTION.runs, { where: { status }, sort: 'id', page: requestedPage, perPage: 100 });
      workerStatusPages.set(status, nextFairPage(requestedPage, runs.totalPages));
      for (const run of runs.items) {
        if (isAvailable(run.available_at) || status === 'waiting_approval') { scanned += 1; await advanceRun(run.tenant_id, run.id); }
      }
    }
    recordWorkerHeartbeat('digital-employee-runner', { state: 'running', scanned });
  } catch (error) {
    recordWorkerHeartbeat('digital-employee-runner', { state: 'error', error: String((error as Error)?.message || error).slice(0, 500) });
    throw error;
  } finally {
    workerBusy = false;
    for (const resolve of workerDrainWaiters) resolve();
    workerDrainWaiters.clear();
  }
}

export async function stopDigitalEmployeeWorker(timeoutMs = 30_000): Promise<void> {
  workerAdmission.stop();
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = undefined;
  if (workerBusy) await new Promise<void>(resolve => {
    let timeout: NodeJS.Timeout;
    const done = () => { clearTimeout(timeout); resolve(); };
    timeout = setTimeout(() => { workerDrainWaiters.delete(done); resolve(); }, Math.max(1, timeoutMs));
    timeout.unref?.();
    workerDrainWaiters.add(done);
  });
  markWorkerStopped('digital-employee-runner', { state: 'stopped' });
  unregisterWorkerHeartbeat?.();
  unregisterWorkerHeartbeat = undefined;
}

export function digitalEmployeeWorkerAcceptingWork(): boolean { return workerAdmission.accepting(); }

export function startDigitalEmployeeWorker(): void {
  if (workerTimer || process.env.NODE_ENV === 'test' || process.env.DISABLE_DIGITAL_EMPLOYEE_WORKER === 'true') return;
  workerAdmission.start();
  unregisterWorkerHeartbeat = registerWorkerHeartbeat('digital-employee-runner', { staleAfterMs: 30_000, critical: true });
  recordWorkerHeartbeat('digital-employee-runner', { state: 'starting' });
  const cycle = () => { void runDigitalEmployeeWorkerOnce().catch(() => undefined); };
  cycle();
  workerTimer = setInterval(cycle, 1_000);
  workerTimer.unref();
}

digitalEmployeesRouter.get('/overview', async (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  res.json(await buildOverview(tenantId));
});

digitalEmployeesRouter.get('/artifacts/:projectId/video', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const project = await store.getById<{ id: string; tenant_id?: string; spec?: unknown }>('studio_projects', req.params.projectId);
  if (!project || String(project.tenant_id || '') !== tenantId) {
    res.status(404).json({ error: 'artifact_not_found' });
    return;
  }
  const spec = jsonObject<Record<string, unknown>>(project.spec, {});
  const metadata = jsonObject<Record<string, unknown>>(spec.digitalEmployee, {});
  const videoPath = String(metadata.videoPath || '');
  const videoSha256 = String(metadata.videoSha256 || '').toLowerCase();
  if (!await verifyDigitalEmployeeRenderedVideo({ tenantId, videoPath, videoSha256 })) {
    res.status(409).json({ error: 'artifact_integrity_check_failed' });
    return;
  }
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', 'inline');
  res.type('video/mp4');
  res.sendFile(videoPath, error => {
    if (error && !res.headersSent) res.status(500).json({ error: 'artifact_stream_failed' });
  });
});

digitalEmployeesRouter.get('/work-items', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const [approvals, handoffs, tasks, events, publishingReconciliations, allPublishingPosts] = await Promise.all([
    listAllRecords<ApprovalRecord>({ store, collection: COLLECTION.approvals, query: { where: { tenant_id: tenantId }, sort: '-created_at' } }).then(items => ({ items })),
    listAllRecords<HandoffRecord>({ store, collection: COLLECTION.handoffs, query: { where: { tenant_id: tenantId }, sort: '-started_at' } }).then(items => ({ items })),
    listAllRecords<TaskRecord>({ store, collection: COLLECTION.tasks, query: { where: { tenant_id: tenantId }, sort: '-updated_at' } }).then(items => ({ items })),
    store.list<EventRecord>(COLLECTION.events, { where: { tenant_id: tenantId }, sort: '-occurred_at', perPage: 500 }),
    allPublishingReconciliations(tenantId),
    listAllRecords<PostRecord>({ store, collection: 'posts', query: { where: { tenant_id: tenantId }, sort: '-updated' } }),
  ]);
  const nowMs = Date.now();
  const taskById = new Map(tasks.items.map(item => [item.id, item]));
  const taskSnapshot = (item: TaskRecord | undefined) => item ? publicWorkflowTask({
    ...item,
    depends_on: jsonObject<string[]>(item.depends_on, []),
    output: jsonObject<Record<string, unknown>>(item.output, {}),
  }) : null;
  const approvalTaskIds = new Set(approvals.items.map(item => item.task_id));
  const activeHandoffTaskIds = new Set(handoffs.items.filter(item => item.status === 'active').map(item => item.task_id));
  const timeoutTaskIds = new Set(tasks.items
    .filter(item => item.status === 'failed' && /timeout|lease_expired/i.test(`${item.error_code || ''} ${item.error_detail || ''}`))
    .map(item => item.id));
  const taskItems: WorkItemRecord[] = tasks.items.filter(item => item.status === 'failed').map(item => ({
    id: item.id,
    type: timeoutTaskIds.has(item.id) ? 'timeout' : 'failure',
    status: 'pending',
    sourceStatus: item.status,
    source: 'workflow_task',
    sourceRecord: taskSnapshot(item),
    runId: item.run_id,
    taskId: item.id,
    ownerId: item.owner_id,
    agent: item.agent_role,
    risk: 'high',
    goalId: item.goal_id,
    dueAt: '',
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    title: item.title,
    summary: item.error_detail || item.blocked_reason || '任务失败，等待人工处理',
    errorCode: item.error_code || '',
    attempt: Number(item.attempt || 0),
    maxAttempts: Number(item.max_attempts || 0),
  }));
  const informationTaskIds = new Set<string>();
  const informationTasks: WorkItemRecord[] = tasks.items.filter(item => {
    const waitingWithoutApproval = item.status === 'waiting_approval' && !approvalTaskIds.has(item.id);
    const handoffWithoutSession = item.status === 'handed_off' && !activeHandoffTaskIds.has(item.id);
    const coveredByDedicatedItem = item.status === 'waiting_approval' && approvalTaskIds.has(item.id)
      || item.status === 'handed_off' && activeHandoffTaskIds.has(item.id);
    const explicitlyBlocked = Boolean(item.blocked_reason)
      && !coveredByDedicatedItem
      && ['pending', 'running', 'waiting_approval', 'handed_off'].includes(item.status);
    const included = waitingWithoutApproval || handoffWithoutSession || explicitlyBlocked;
    if (included) informationTaskIds.add(item.id);
    return included;
  }).map(item => ({
    id: `task-info:${item.id}`,
    type: 'information',
    status: 'pending',
    sourceStatus: item.status,
    source: 'workflow_task',
    sourceRecord: taskSnapshot(item),
    runId: item.run_id,
    taskId: item.id,
    ownerId: item.owner_id,
    agent: item.agent_role,
    risk: 'medium',
    goalId: item.goal_id,
    dueAt: '',
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    title: item.title,
    summary: item.blocked_reason || (item.status === 'waiting_approval' ? '任务正在等待审批记录修复' : '任务正在等待人工信息或状态修复'),
  }));
  const eventItems: WorkItemRecord[] = events.items.flatMap(event => {
    const payload = jsonObject<Record<string, unknown>>(event.payload, {});
    const publicEvent = publicWorkflowEvent({ ...event, payload });
    const publicPayload = publicEvent.payload as Record<string, unknown>;
    const sourceText = `${event.type} ${event.summary} ${String(payload.errorCode || '')}`;
    const timeout = /timeout|lease_expired/i.test(sourceText);
    const information = /information|required|blocked|awaiting_input/i.test(sourceText);
    if ((!timeout && !information) || timeoutTaskIds.has(event.task_id) || informationTaskIds.has(event.task_id)) return [];
    const task = taskById.get(event.task_id);
    return [{
      id: `event:${event.id}`,
      type: timeout ? 'timeout' : 'information',
      status: 'pending',
      sourceStatus: event.type,
      source: 'run_event',
      sourceRecord: publicEvent,
      runId: event.run_id,
      taskId: event.task_id,
      ownerId: task?.owner_id || '',
      agent: task?.agent_role || '',
      risk: timeout ? 'high' : 'medium',
      goalId: task?.goal_id || '',
      dueAt: '',
      createdAt: event.occurred_at,
      updatedAt: event.occurred_at,
      title: task?.title || event.summary,
      summary: event.summary,
      eventType: event.type,
      payload: publicPayload,
    } satisfies WorkItemRecord];
  });
  const publishingRecords = Array.from(new Map(
    [...allPublishingPosts, ...publishingReconciliations].map(post => [post.id, post]),
  ).values());
  const publishingItems: WorkItemRecord[] = publishingRecords.filter(post => {
    const stats = jsonObject<Record<string, unknown>>(post.stats, {});
    return post.reconciliation_required === true
      || (stats.source === 'digital_employee' && stats.status === 'on_hold');
  }).map(post => {
    const stats = jsonObject<Record<string, unknown>>(post.stats, {});
    const runId = String(post.digital_employee_run_id || '');
    const reconciliationRequired = post.reconciliation_required === true;
    return {
      id: `${reconciliationRequired ? 'publishing-reconciliation' : 'publishing-hold'}:${post.id}`,
      type: reconciliationRequired ? 'publishing_reconciliation' : 'publishing_hold',
      status: 'pending',
      sourceStatus: String(stats.status || 'needs_reconciliation'),
      source: 'post',
      sourceRecord: publicPublishTracking(post),
      runId,
      taskId: '',
      ownerId: '',
      agent: 'publishing',
      risk: 'high',
      goalId: '',
      dueAt: '',
      createdAt: String(post.created || ''),
      updatedAt: String(post.updated || ''),
      title: String(post.title || '发布结果待对账'),
      summary: String(stats.publishError || (reconciliationRequired ? '平台调用结果不确定，需要按账号提交回执后才能处理' : '运行或审批已暂停发布，恢复前不会进入平台调用')),
      postId: post.id,
      expectedRevision: Number(post.publish_revision || 0),
      targetAccountIds: Array.isArray(stats.targetAccountIds) ? stats.targetAccountIds : [],
      allowedDecisions: reconciliationRequired ? ['confirm_published', 'confirm_not_published_retry', 'void'] : [],
      blindRetryAllowed: false,
    } satisfies WorkItemRecord;
  });
  const items: WorkItemRecord[] = [
    ...approvals.items.map(item => {
      const task = taskById.get(item.task_id);
      const expired = item.status === 'pending' && Boolean(item.expires_at) && Date.parse(String(item.expires_at)) <= nowMs;
      const actionPayload = jsonObject<Record<string, unknown>>(item.action_payload, {});
      const evidence = jsonObject<Array<Record<string, unknown>>>(item.evidence, []);
      const approval = publicWorkflowApproval({
        ...item,
        action_payload: actionPayload,
        evidence,
        target_account: jsonObject<Record<string, unknown>>(item.target_account, {}),
        changes: jsonObject<Record<string, unknown>>(item.changes, {}),
        diff: jsonObject<Record<string, unknown>>(item.diff, {}),
      });
      return {
        id: item.id,
        type: 'approval',
        status: expired ? 'expired' : item.status,
        sourceStatus: item.status,
        source: 'approval_request',
        runId: item.run_id,
        taskId: item.task_id,
        ownerId: item.owner_id,
        agent: item.requested_by_agent,
        risk: item.risk_level,
        goalId: item.goal_id,
        dueAt: String(item.expires_at || ''),
        createdAt: item.created_at,
        updatedAt: item.decided_at || item.created_at,
        title: task?.title || item.action_summary || '对外动作审批',
        summary: item.action_summary,
        action_summary: item.action_summary,
        action_type: item.action_type || '',
        action_payload: approval.action_payload,
        action_version: Number(item.action_version || 0),
        payload_hash: item.payload_hash,
        approved_payload_hash: item.approved_payload_hash || '',
        target_account: approval.target_account,
        scheduled_at: item.scheduled_at || '',
        estimated_cost: Number(item.estimated_cost || 0),
        reversibility: item.reversibility || '',
        expires_at: item.expires_at || '',
        next_step: item.next_step || '',
        evidence: approval.evidence,
        changes: approval.changes,
        diff: approval.diff,
        created_at: item.created_at,
        decided_at: item.decided_at,
        approval,
        sourceTask: taskSnapshot(task),
      } satisfies WorkItemRecord;
    }),
    ...handoffs.items.map(item => {
      const task = taskById.get(item.task_id);
      const handoff = publicWorkflowHandoff({
        ...item,
        snapshot: jsonObject<Record<string, unknown>>(item.snapshot, {}),
      });
      const snapshot = handoff.snapshot as Record<string, unknown>;
      return {
        id: item.id,
        type: 'handoff',
        status: item.status === 'active' ? 'taken_over' : item.status,
        sourceStatus: item.status,
        source: 'handoff_session',
        sourceRecord: handoff,
        sourceTask: taskSnapshot(task),
        task: taskSnapshot(task),
        runId: item.run_id,
        taskId: item.task_id,
        ownerId: item.taken_by,
        agent: task?.agent_role || '',
        risk: 'medium',
        goalId: task?.goal_id || '',
        dueAt: '',
        createdAt: item.started_at,
        updatedAt: item.returned_at || item.started_at,
        title: task?.title || '人工接管任务',
        summary: String(snapshot.blockedReason || ''),
      } satisfies WorkItemRecord;
    }),
    ...taskItems,
    ...informationTasks,
    ...eventItems,
    ...publishingItems,
  ];
  const filtered = items.filter(item => !req.query.status || item.status === req.query.status)
    .filter(item => !req.query.type || item.type === req.query.type)
    .filter(item => !req.query.agent || item.agent === req.query.agent)
    .filter(item => !req.query.owner || item.ownerId === req.query.owner)
    .filter(item => !req.query.goalId || item.goalId === req.query.goalId)
    .filter(item => !req.query.risk || item.risk === req.query.risk);
  res.json({ items: publicWorkflowValue(filtered), total: filtered.length });
});

digitalEmployeesRouter.post('/work-items/:workItemId/transfer', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  if (!roleAllowed(res, ['super_admin', 'admin', 'social_operator'])) return;
  const ownerId = String(req.body?.ownerId || '').trim();
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  if (!ownerId) { res.status(400).json({ error: 'transfer_owner_required' }); return; }
  if (ownerId !== userId && !await isTenantUser(ownerId, tenantId)) { res.status(400).json({ error: 'transfer_owner_invalid' }); return; }
  const [approval, handoff, failedTask] = await Promise.all([
    tenantRecord<ApprovalRecord>(COLLECTION.approvals, req.params.workItemId, tenantId),
    tenantRecord<HandoffRecord>(COLLECTION.handoffs, req.params.workItemId, tenantId),
    tenantRecord<TaskRecord>(COLLECTION.tasks, req.params.workItemId, tenantId),
  ]);
  const role = (res.locals as DigitalEmployeeLocals).digitalEmployeeRole!;
  const admin = ADMIN_ROLES.has(role);
  const now = new Date().toISOString();
  if (approval) {
    if (approval.status !== 'pending' || approval.expires_at && Date.parse(approval.expires_at) <= Date.now()) { res.status(409).json({ error: 'work_item_not_transferable', status: approval.status }); return; }
    if (!admin && approval.owner_id !== userId) { res.status(403).json({ error: 'work_item_owner_required' }); return; }
    await appendAudit({ tenantId, userId, action: 'approval.transfer_requested', targetType: 'approval_request', targetId: approval.id, metadata: { from: approval.owner_id, to: ownerId, note } });
    const moved = await compareAndSetRecord<ApprovalRecord>({ store, collection: COLLECTION.approvals, id: approval.id, expected: { status: 'pending', owner_id: approval.owner_id, ...(approval.revision === undefined ? {} : { revision: Number(approval.revision || 0) }) }, patch: { owner_id: ownerId, transfer_note: note, revision: Number(approval.revision || 0) + 1 } });
    if (!moved.ok) { res.status(409).json({ error: 'work_item_transfer_conflict' }); return; }
    await appendEvent({ tenantId, runId: approval.run_id, taskId: approval.task_id, type: 'approval.transferred', level: 'warning', summary: '审批待办已转交', payload: { from: approval.owner_id, to: ownerId, note } });
    res.json({ ok: true, item: { id: approval.id, type: 'approval', ownerId } }); return;
  }
  if (handoff) {
    if (handoff.status !== 'active') { res.status(409).json({ error: 'work_item_not_transferable', status: handoff.status }); return; }
    const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, handoff.task_id, tenantId);
    const handoffSnapshot = jsonObject<Record<string, unknown>>(handoff.snapshot, {});
    if (!task || task.status !== 'handed_off' || handoffSnapshot.returnState === 'committing') {
      res.status(409).json({ error: 'work_item_not_transferable', status: task?.status || handoff.status }); return;
    }
    if (!admin && handoff.taken_by !== userId) { res.status(403).json({ error: 'work_item_owner_required' }); return; }
    await appendAudit({ tenantId, userId, action: 'handoff.transfer_requested', targetType: 'handoff_session', targetId: handoff.id, metadata: { from: handoff.taken_by, to: ownerId, note } });
    const moved = await compareAndSetRecord<HandoffRecord>({ store, collection: COLLECTION.handoffs, id: handoff.id, expected: { status: 'active', taken_by: handoff.taken_by, ...(handoff.revision === undefined ? {} : { revision: Number(handoff.revision || 0) }) }, patch: { taken_by: ownerId, transfer_note: note, revision: Number(handoff.revision || 0) + 1 } });
    if (!moved.ok) { res.status(409).json({ error: 'work_item_transfer_conflict' }); return; }
    const movedTask = await compareAndSetRecord<TaskRecord>({
      store, collection: COLLECTION.tasks, id: task.id,
      expected: { status: 'handed_off', owner_id: handoff.taken_by, ...(task.revision === undefined ? {} : { revision: Number(task.revision || 0) }) },
      patch: { owner_id: ownerId, updated_at: now, revision: Number(task.revision || 0) + 1 },
    });
    if (!movedTask.ok) {
      const reverted = await compareAndSetRecord<HandoffRecord>({
        store, collection: COLLECTION.handoffs, id: handoff.id,
        expected: { status: 'active', taken_by: ownerId, revision: Number(moved.record.revision || 0) },
        patch: { taken_by: handoff.taken_by, transfer_note: '', revision: Number(moved.record.revision || 0) + 1 },
      });
      if (!reverted.ok) throw new ReliableKernelError('handoff_transfer_compensation_failed');
      res.status(409).json({ error: 'work_item_transfer_conflict' }); return;
    }
    await appendEvent({ tenantId, runId: handoff.run_id, taskId: handoff.task_id, type: 'handoff.transferred', level: 'warning', summary: '人工接管已转交', payload: { from: handoff.taken_by, to: ownerId, note } });
    res.json({ ok: true, item: { id: handoff.id, type: 'handoff', ownerId } }); return;
  }
  if (failedTask && failedTask.status === 'failed') {
    const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, failedTask.goal_id, tenantId);
    const currentOwner = failedTask.owner_id || goal?.owner_id || '';
    if (!admin && currentOwner !== userId) { res.status(403).json({ error: 'work_item_owner_required' }); return; }
    await appendAudit({ tenantId, userId, action: 'failure.transfer_requested', targetType: 'workflow_task', targetId: failedTask.id, metadata: { from: currentOwner, to: ownerId, note } });
    const moved = await compareAndSetRecord<TaskRecord>({ store, collection: COLLECTION.tasks, id: failedTask.id, expected: { status: 'failed', owner_id: failedTask.owner_id || '', ...(failedTask.revision === undefined ? {} : { revision: Number(failedTask.revision || 0) }) }, patch: { owner_id: ownerId, updated_at: now, revision: Number(failedTask.revision || 0) + 1 } });
    if (!moved.ok) { res.status(409).json({ error: 'work_item_transfer_conflict' }); return; }
    await appendEvent({ tenantId, runId: failedTask.run_id, taskId: failedTask.id, type: 'failure.transferred', level: 'warning', summary: '失败处理待办已转交', payload: { from: currentOwner, to: ownerId, note } });
    res.json({ ok: true, item: { id: failedTask.id, type: 'failure', ownerId } }); return;
  }
  res.status(404).json({ error: 'work_item_not_found' });
});

digitalEmployeesRouter.post('/onboarding/complete', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  if (!roleAllowed(res, ['super_admin', 'admin'])) return;
  const requestedApprovalOwner = String(req.body?.approvalOwner || userId).trim();
  if (requestedApprovalOwner !== userId && !await isTenantUser(requestedApprovalOwner, tenantId)) {
    res.status(400).json({ error: 'approval_owner_invalid', message: '审批负责人必须是本企业的有效用户 ID' }); return;
  }
  const config = normalizeDigitalEmployeeConfig({ ...(req.body || {}), approvalOwner: requestedApprovalOwner });
  const missing = validateDigitalEmployeeConfig(config);
  if (missing.length) { res.status(400).json({ error: 'onboarding_incomplete', missing }); return; }
  const existing = await configForTenant(tenantId);
  const now = new Date().toISOString();
  const payload = { tenant_id: tenantId, config, status: 'completed', updated_by: userId, updated_at: now };
  const saved = existing
    ? await store.update(COLLECTION.config, existing.id, payload)
    : Boolean(await store.create(COLLECTION.config, { ...payload, created_at: now }));
  if (!saved) { res.status(503).json({ error: 'onboarding_storage_unavailable' }); return; }
  await appendAudit({ tenantId, userId, action: 'digital_employee.onboarding.completed', targetType: 'digital_employee_config', targetId: existing?.id || tenantId, metadata: { autonomyMode: config.autonomyMode } });
  res.json(await buildOverview(tenantId));
});

digitalEmployeesRouter.post('/goals', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  if (!roleAllowed(res, ['super_admin', 'admin', 'social_operator'])) return;
  const configRecord = await configForTenant(tenantId);
  const config = publicConfig(configRecord);
  if (!config) { res.status(409).json({ error: 'onboarding_required' }); return; }
  const goal = normalizeWeeklyGoal(req.body || {}, config);
  const missing = validateWeeklyGoal(goal);
  if (missing.length) { res.status(400).json({ error: 'goal_invalid', missing }); return; }
  const now = new Date().toISOString();
  const created = await requiredCreate<GoalRecord>(COLLECTION.goals, {
    tenant_id: tenantId,
    title: goal.title,
    objective: goal.objective,
    metric: goal.metric,
    baseline: goal.baseline,
    target: goal.target,
    unit: goal.unit,
    starts_at: goal.startsAt,
    ends_at: goal.endsAt,
    scope: goal.scope,
    budget_limit: goal.budgetLimit,
    constraints: goal.constraints,
    owner_id: userId,
    status: 'draft',
    version: 1,
    created_at: now,
    updated_at: now,
  });
  await appendAudit({ tenantId, userId, action: 'weekly_goal.created', targetType: 'weekly_goal', targetId: created.id, metadata: { metric: goal.metric, target: goal.target } });
  const contract = await compileExecutionContract({ tenantId, goal, goalVersion: created.version, config });
  await requiredCreate<ContractRecord>(COLLECTION.contracts, {
    tenant_id: tenantId, goal_id: created.id, goal_version: created.version, version: 1,
    status: contract.readiness === 'blocked' ? 'blocked' : 'pending_confirmation', payload_hash: contract.payloadHash,
    source_fingerprint: contract.sourceFingerprint, contract, confirmed_by: '', compiled_at: contract.compiledAt,
    confirmed_at: '', invalidated_at: '',
  });
  res.status(201).json(await buildOverview(tenantId));
});

digitalEmployeesRouter.post('/goals/:goalId/contract/recompile', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  if (!roleAllowed(res, ['super_admin', 'admin', 'social_operator'])) return;
  const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, req.params.goalId, tenantId);
  if (!goal) { res.status(404).json({ error: 'goal_not_found' }); return; }
  if (!adminOrOwner(res, userId, goal.owner_id)) { res.status(403).json({ error: 'goal_owner_required' }); return; }
  const config = publicConfig(await configForTenant(tenantId));
  if (!config) { res.status(409).json({ error: 'onboarding_required' }); return; }
  const previous = await first<ContractRecord>(COLLECTION.contracts, { tenant_id: tenantId, goal_id: goal.id }, '-version');
  const contract = await compileExecutionContract({ tenantId, goal: goalInput(goal), goalVersion: goal.version, config });
  if (previous?.status === 'confirmed') {
    const invalidated = await compareAndSetRecord<ContractRecord>({ store, collection: COLLECTION.contracts, id: previous.id, expected: { status: 'confirmed', version: previous.version, payload_hash: previous.payload_hash }, patch: { status: 'invalidated', invalidated_at: new Date().toISOString() } });
    if (!invalidated.ok) { res.status(409).json({ error: 'execution_contract_recompile_conflict' }); return; }
  }
  await requiredCreate<ContractRecord>(COLLECTION.contracts, {
    tenant_id: tenantId, goal_id: goal.id, goal_version: goal.version, version: Number(previous?.version || 0) + 1,
    status: contract.readiness === 'blocked' ? 'blocked' : 'pending_confirmation', payload_hash: contract.payloadHash,
    source_fingerprint: contract.sourceFingerprint, contract, confirmed_by: '', compiled_at: contract.compiledAt, confirmed_at: '', invalidated_at: '',
  });
  await appendAudit({ tenantId, userId, action: 'execution_contract.recompiled', targetType: 'weekly_goal', targetId: goal.id, metadata: { previousVersion: previous?.version || 0 } });
  res.json(await buildOverview(tenantId));
});

digitalEmployeesRouter.post('/goals/:goalId/contract/confirm', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  if (!roleAllowed(res, ['super_admin', 'admin', 'social_operator'])) return;
  const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, req.params.goalId, tenantId);
  if (!goal) { res.status(404).json({ error: 'goal_not_found' }); return; }
  if (!adminOrOwner(res, userId, goal.owner_id)) { res.status(403).json({ error: 'goal_owner_required' }); return; }
  const record = await first<ContractRecord>(COLLECTION.contracts, { tenant_id: tenantId, goal_id: goal.id }, '-version');
  if (!record) { res.status(409).json({ error: 'execution_contract_missing' }); return; }
  if (record.status === 'blocked') { res.status(409).json({ error: 'execution_contract_blocked', gaps: jsonObject<ExecutionContract>(record.contract, {} as ExecutionContract).gaps || [] }); return; }
  if (req.body?.payloadHash !== record.payload_hash) { res.status(409).json({ error: 'execution_contract_changed' }); return; }
  if (record.goal_version !== goal.version) { res.status(409).json({ error: 'execution_contract_stale' }); return; }
  if (record.status === 'confirmed') { res.json(await buildOverview(tenantId)); return; }
  if (record.status !== 'pending_confirmation') { res.status(409).json({ error: 'execution_contract_not_confirmable', status: record.status }); return; }
  const now = new Date().toISOString();
  const confirmed = await compareAndSetRecord<ContractRecord>({ store, collection: COLLECTION.contracts, id: record.id, expected: { status: 'pending_confirmation', version: record.version, payload_hash: record.payload_hash }, patch: { status: 'confirmed', confirmed_by: userId, confirmed_at: now } });
  if (!confirmed.ok) { res.status(409).json({ error: 'execution_contract_confirmation_conflict' }); return; }
  await appendAudit({ tenantId, userId, action: 'execution_contract.confirmed', targetType: 'execution_contract', targetId: record.id, metadata: { goalId: goal.id, version: record.version, payloadHash: record.payload_hash } });
  res.json(await buildOverview(tenantId));
});

digitalEmployeesRouter.post('/goals/:goalId/approve', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  if (!roleAllowed(res, ['super_admin', 'admin'])) return;
  const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, req.params.goalId, tenantId);
  if (!goal) { res.status(404).json({ error: 'goal_not_found' }); return; }
  const existingRun = await first<RunRecord>(COLLECTION.runs, { tenant_id: tenantId, goal_id: goal.id }, '-started_at');
  if (existingRun) {
    await repairIncompleteRun(existingRun);
    res.json(await buildOverview(tenantId)); return;
  }
  if (!['draft', 'pending_approval'].includes(goal.status)) { res.status(409).json({ error: 'goal_not_approvable', status: goal.status }); return; }
  const configRecord = await configForTenant(tenantId);
  const config = publicConfig(configRecord);
  if (!config) { res.status(409).json({ error: 'onboarding_required' }); return; }
  if (config.approvalOwner !== goal.owner_id && config.approvalOwner !== userId && !await isTenantUser(config.approvalOwner, tenantId)) {
    res.status(409).json({ error: 'approval_owner_invalid', message: '请重新配置企业内有效审批负责人' }); return;
  }
  const contractRecord = await first<ContractRecord>(COLLECTION.contracts, { tenant_id: tenantId, goal_id: goal.id }, '-version');
  if (!contractRecord || contractRecord.status !== 'confirmed' || contractRecord.goal_version !== goal.version) {
    res.status(409).json({ error: 'execution_contract_confirmation_required' }); return;
  }
  const executionContract = jsonObject<ExecutionContract>(contractRecord.contract, {} as ExecutionContract);
  const currentContract = await compileExecutionContract({ tenantId, goal: goalInput(goal), goalVersion: goal.version, config });
  if (currentContract.sourceFingerprint !== contractRecord.source_fingerprint) {
    const now = new Date().toISOString();
    const invalidated = await compareAndSetRecord<ContractRecord>({ store, collection: COLLECTION.contracts, id: contractRecord.id, expected: { status: 'confirmed', version: contractRecord.version, payload_hash: contractRecord.payload_hash }, patch: { status: 'invalidated', invalidated_at: now } });
    if (!invalidated.ok) { res.status(409).json({ error: 'execution_contract_invalidation_conflict' }); return; }
    await requiredCreate<ContractRecord>(COLLECTION.contracts, {
      tenant_id: tenantId, goal_id: goal.id, goal_version: goal.version, version: contractRecord.version + 1,
      status: currentContract.readiness === 'blocked' ? 'blocked' : 'pending_confirmation', payload_hash: currentContract.payloadHash,
      source_fingerprint: currentContract.sourceFingerprint, contract: currentContract, confirmed_by: '', compiled_at: currentContract.compiledAt, confirmed_at: '', invalidated_at: '',
    });
    await appendAudit({ tenantId, userId, action: 'execution_contract.invalidated', targetType: 'execution_contract', targetId: contractRecord.id, metadata: { reason: 'formal_source_changed', goalId: goal.id } });
    res.status(409).json({ error: 'execution_contract_source_changed', message: '正式数据源已变更，请审阅新契约' }); return;
  }
  if (executionContract.readiness === 'blocked' || executionContract.dataGovernance?.aiAccessEnabled === false) {
    res.status(409).json({ error: 'execution_contract_blocked', gaps: executionContract.gaps || [] }); return;
  }
  const planDraft = buildWeeklyPlan(goalInput(goal), config, executionContract);
  const now = new Date().toISOString();
  await appendAudit({ tenantId, userId, action: 'weekly_goal.start_requested', targetType: 'weekly_goal', targetId: goal.id, metadata: { goalVersion: goal.version, contractVersion: contractRecord.version } });
  const planResult = await createRecordIfAbsent<PlanRecord>({
    store, collection: COLLECTION.plans,
    uniqueWhere: { tenant_id: tenantId, goal_id: goal.id, goal_version: goal.version },
    data: { tenant_id: tenantId, goal_id: goal.id, goal_version: goal.version, version: 1, status: 'approved', plan: planDraft, idempotency_key: `goal:${goal.id}:v${goal.version}:plan`, created_at: now },
  });
  const plan = planResult.record;
  const runResult = await createRecordIfAbsent<RunRecord>({
    store, collection: COLLECTION.runs,
    uniqueWhere: { tenant_id: tenantId, idempotency_key: `goal:${goal.id}:v${goal.version}` },
    data: {
    tenant_id: tenantId,
    goal_id: goal.id,
    plan_id: plan.id,
    status: 'planning',
    current_controller: 'agent',
    pause_reason: '',
    budget_limit: goal.budget_limit,
    budget_spent: 0,
    execution_snapshot: { config, goal: goalInput(goal), executionContract, plan: planDraft, policy: executionContract.policy, versions: { goal: goal.version, contract: contractRecord.version, plan: 1, policy: 1 } },
    idempotency_key: `goal:${goal.id}:v${goal.version}`,
    available_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    lease_owner: '',
    lease_expires_at: '',
    started_at: now,
    completed_at: '',
    revision: 0,
    error_code: '',
    error_detail: '',
  },
  });
  const run = runResult.record;
  await repairIncompleteRun(run);
  const activated = await compareAndSetRecord<GoalRecord>({
    store, collection: COLLECTION.goals, id: goal.id,
    expected: { status: goal.status, version: goal.version },
    patch: { status: 'active', updated_at: now },
  });
  if (!activated.ok) {
    const currentGoal = await tenantRecord<GoalRecord>(COLLECTION.goals, goal.id, tenantId);
    if (currentGoal?.status !== 'active') throw new ReliableKernelError('goal_start_state_conflict');
  }
  const released = await compareAndSetRecord<RunRecord>({ store, collection: COLLECTION.runs, id: run.id, expected: { status: 'planning', lease_owner: '' }, patch: { available_at: now, error_code: '', error_detail: '' } });
  if (!released.ok && released.reason !== 'conflict') throw new ReliableKernelError('run_start_release_failed');
  if (runResult.created) {
    await appendEvent({ tenantId, runId: run.id, type: 'plan.generated', level: 'success', summary: `计划 Agent 已生成 ${planDraft.tasks.length} 个任务`, payload: { strategy: planDraft.strategy } });
    await appendEvent({ tenantId, runId: run.id, type: 'workflow.started', summary: '数字员工已开始执行本周计划' });
  }
  await appendAudit({ tenantId, userId, action: 'weekly_goal.approved', targetType: 'weekly_goal', targetId: goal.id, metadata: { planId: plan.id, runId: run.id } });
  res.json(await buildOverview(tenantId));
});

digitalEmployeesRouter.get('/runs/:runId/events', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
  if (!run) { res.status(404).json({ error: 'run_not_found' }); return; }
  const after = normalizeEventCursor(req.query.after);
  const result = await store.list<EventRecord>(COLLECTION.events, {
    where: { tenant_id: tenantId, run_id: run.id }, sort: 'sequence', page: eventPageForCursor(after), perPage: 500,
  });
  res.json({
    events: result.items
      .filter(event => Number(event.sequence) > after)
      .map(event => publicWorkflowEvent({
        ...event,
        payload: jsonObject<Record<string, unknown>>(event.payload, {}),
      })),
  });
});

digitalEmployeesRouter.get('/runs/:runId/stream', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
  if (!run) { res.status(404).json({ error: 'run_not_found' }); return; }
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const after = normalizeEventCursor(req.headers['last-event-id'] || req.query.after);
  streamCursors.set(res, after);
  const persisted = await store.list<EventRecord>(COLLECTION.events, {
    where: { tenant_id: tenantId, run_id: run.id }, sort: 'sequence', page: eventPageForCursor(after), perPage: 500,
  });
  const initial = persisted.items.filter(item => Number(item.sequence) > after);
  for (const event of initial) sendEvent(res, event);
  const clients = streamClients.get(run.id) || new Set<Response>();
  clients.add(res);
  streamClients.set(run.id, clients);
  let polling = false;
  const durablePoll = setInterval(() => {
    if (polling || res.writableEnded) return;
    polling = true;
    const cursor = streamCursors.get(res) || 0;
    void store.list<EventRecord>(COLLECTION.events, {
      where: { tenant_id: tenantId, run_id: run.id }, sort: 'sequence', page: eventPageForCursor(cursor), perPage: 500,
    })
      .then(async result => {
        const currentCursor = streamCursors.get(res) || 0;
        const unseen = result.items.filter(item => Number(item.sequence) > currentCursor);
        for (const event of unseen) sendEvent(res, event);
      })
      .catch(() => {
        // Keep the SSE connection alive. The next durable poll retries and the
        // client cursor prevents duplicates after transient store failures.
      })
      .finally(() => { polling = false; });
  }, 1_500);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
  req.on('close', () => {
    clearInterval(durablePoll);
    clearInterval(heartbeat);
    clients.delete(res);
    streamCursors.delete(res);
    if (!clients.size) streamClients.delete(run.id);
  });
});

function proposalWithApprovedChanges(input: {
  approval: ApprovalRecord; run: RunRecord; changes: Record<string, unknown>;
}): { proposal: OutboundActionProposal; payloadHash: string; diff: Record<string, unknown> } {
  const allowed = new Set(['scheduledAt', 'targetAccount', 'estimatedCost']);
  const unsupported = Object.keys(input.changes).filter(key => !allowed.has(key));
  if (unsupported.length) {
    throw new ReliableKernelError('approval_changes_unsupported', `以下字段必须修改原产出并重新审批：${unsupported.join(', ')}`);
  }
  const original = jsonObject<OutboundActionProposal>(input.approval.action_payload, {} as OutboundActionProposal);
  if (!original.actionType || proposalIntegrityHash(original) !== input.approval.payload_hash) {
    throw new ReliableKernelError('approval_snapshot_stale');
  }
  const next: OutboundActionProposal = {
    ...original,
    artifact: { ...original.artifact },
    targetAccount: { ...original.targetAccount },
    schedulePayload: { ...original.schedulePayload, targetAccountIds: [...original.schedulePayload.targetAccountIds], targetAccountLabels: [...(original.schedulePayload.targetAccountLabels || [])] },
  };
  const diff: Record<string, unknown> = {};
  if (input.changes.scheduledAt !== undefined) {
    const scheduledAt = String(input.changes.scheduledAt || '');
    if (!Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now()) throw new ReliableKernelError('scheduled_at_invalid');
    diff.scheduledAt = { before: original.scheduledAt, after: scheduledAt };
    next.scheduledAt = scheduledAt;
    next.schedulePayload.scheduledAt = scheduledAt;
  }
  if (input.changes.targetAccount !== undefined) {
    const account = input.changes.targetAccount;
    if (!account || typeof account !== 'object' || Array.isArray(account)) throw new ReliableKernelError('target_account_invalid');
    const normalized = {
      id: String((account as Record<string, unknown>).id || ''),
      label: String((account as Record<string, unknown>).label || ''),
      platform: String((account as Record<string, unknown>).platform || '').toLowerCase(),
    };
    const snapshot = jsonObject<{ executionContract?: ExecutionContract }>(input.run.execution_snapshot, {});
    const authorized = snapshot.executionContract?.resources.connectedAccounts.some(item => item.id === normalized.id && item.platform.toLowerCase() === normalized.platform);
    if (!normalized.id || !authorized) throw new ReliableKernelError('target_account_not_in_execution_snapshot');
    diff.targetAccount = { before: original.targetAccount, after: normalized };
    next.targetAccount = normalized;
    next.schedulePayload.platform = normalized.platform;
    next.schedulePayload.targetAccountIds = [normalized.id];
    next.schedulePayload.targetAccountLabels = [normalized.label || normalized.platform];
  }
  if (input.changes.estimatedCost !== undefined) {
    const estimatedCost = Number(input.changes.estimatedCost);
    if (!Number.isFinite(estimatedCost) || estimatedCost < 0 || estimatedCost > Math.max(0, Number(input.run.budget_limit || 0) - Number(input.run.budget_spent || 0))) {
      throw new ReliableKernelError('approval_cost_invalid');
    }
    diff.estimatedCost = { before: original.estimatedCost, after: estimatedCost };
    next.estimatedCost = estimatedCost;
  }
  next.payloadHash = proposalIntegrityHash(next);
  return { proposal: next, payloadHash: next.payloadHash, diff };
}

digitalEmployeesRouter.post('/approvals/:approvalId/decide', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  if (!roleAllowed(res, ['super_admin', 'admin', 'social_operator'])) return;
  const approval = await tenantRecord<ApprovalRecord>(COLLECTION.approvals, req.params.approvalId, tenantId);
  if (!approval) { res.status(404).json({ error: 'approval_not_found' }); return; }
  const decision = parseApprovalDecision(req.body?.decision);
  if (!decision) { res.status(400).json({ error: 'approval_decision_invalid', allowed: ['approved', 'approved_with_changes', 'rejected', 'handoff'] }); return; }
  const role = (res.locals as DigitalEmployeeLocals).digitalEmployeeRole!;
  if (!ADMIN_ROLES.has(role) && !canPerformDigitalEmployeeAction({ action: 'decide_approval', userId, ownerId: approval.owner_id })) {
    res.status(403).json({ error: 'approval_owner_required' }); return;
  }
  const expectedActionVersion = Number(req.body?.expectedActionVersion);
  const expectedPayloadHash = String(req.body?.expectedPayloadHash || '');
  const precondition = validateApprovalPrecondition({ status: approval.status, actionVersion: Number(approval.action_version), payloadHash: approval.payload_hash, expiresAt: approval.expires_at, expectedActionVersion, expectedPayloadHash });
  if (!precondition.ok && precondition.code === 'approval_precondition_required') {
    res.status(400).json({ error: precondition.code, required: ['expectedActionVersion', 'expectedPayloadHash'] }); return;
  }
  if (!precondition.ok && precondition.code === 'approval_stale') {
    res.status(409).json({ error: precondition.code, actionVersion: approval.action_version, payloadHash: approval.payload_hash }); return;
  }
  if (!precondition.ok && precondition.code === 'approval_already_decided') { res.status(409).json({ error: precondition.code, status: approval.status }); return; }
  if (!precondition.ok && precondition.code === 'approval_expired') {
    await compareAndSetRecord<ApprovalRecord>({ store, collection: COLLECTION.approvals, id: approval.id, expected: { status: 'pending', action_version: approval.action_version, payload_hash: approval.payload_hash }, patch: { status: 'expired', revision: Number(approval.revision || 0) + 1 } });
    res.status(409).json({ error: 'approval_expired' }); return;
  }
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  if (decision === 'approved_with_changes' && (!req.body?.changes || typeof req.body.changes !== 'object' || Array.isArray(req.body.changes))) {
    res.status(400).json({ error: 'approval_changes_required' }); return;
  }
  if (decision === 'handoff') { res.status(409).json({ error: 'use_handoff_endpoint' }); return; }
  const now = new Date().toISOString();
  const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, approval.task_id, tenantId);
  const run = await tenantRecord<RunRecord>(COLLECTION.runs, approval.run_id, tenantId);
  const goal = run ? await tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, tenantId) : null;
  if (!task || !run || !goal) { res.status(409).json({ error: 'approval_context_missing' }); return; }
  if (task.status !== 'waiting_approval' || run.status !== 'waiting_approval') { res.status(409).json({ error: 'approval_context_state_changed' }); return; }
  if (decision !== 'rejected') {
    const liveGate = await liveExecutionContractGate(run);
    if (!liveGate.ok) { res.status(409).json({ error: liveGate.code, message: liveGate.detail }); return; }
  }
  let effectiveProposal = jsonObject<OutboundActionProposal>(approval.action_payload, {} as OutboundActionProposal);
  let approvedPayloadHash = decision === 'rejected' ? '' : approval.payload_hash;
  let diff: Record<string, unknown> = {};
  const changes = decision === 'approved_with_changes' ? req.body.changes as Record<string, unknown> : {};
  if (decision === 'approved_with_changes') {
    try {
      const modified = proposalWithApprovedChanges({ approval, run, changes });
      effectiveProposal = modified.proposal; approvedPayloadHash = modified.payloadHash; diff = modified.diff;
    } catch (error) {
      const info = errorInfo(error);
      res.status(409).json({ error: info.code, message: info.detail }); return;
    }
  } else if (decision !== 'rejected' && proposalIntegrityHash(effectiveProposal) !== approval.payload_hash) {
    res.status(409).json({ error: 'approval_snapshot_stale' }); return;
  }
  await appendAudit({ tenantId, userId, action: 'approval.decision_requested', targetType: 'approval_request', targetId: approval.id, metadata: { decision, runId: run.id, taskId: task.id, expectedActionVersion, expectedPayloadHash } });
  const decided = await compareAndSetRecord<ApprovalRecord>({
    store, collection: COLLECTION.approvals, id: approval.id,
    expected: { status: 'pending', action_version: expectedActionVersion, payload_hash: expectedPayloadHash, ...(approval.revision === undefined ? {} : { revision: Number(approval.revision || 0) }) },
    patch: { status: decision, decided_by: userId, decision_note: note, decided_at: now, approved_payload_hash: approvedPayloadHash, action_payload: effectiveProposal, changes, diff, revision: Number(approval.revision || 0) + 1 },
  });
  if (!decided.ok) { res.status(409).json({ error: 'approval_concurrent_decision', status: decided.current?.status }); return; }
  await reconcileApprovalDecision({ tenantId, approval: decided.record, task, run, goal });
  await appendAudit({ tenantId, userId, action: 'approval.decided', targetType: 'approval_request', targetId: approval.id, metadata: { decision, runId: run.id, taskId: task.id, approvedPayloadHash, diff } });
  await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'approval.decided', level: decision === 'rejected' ? 'error' : 'success', summary: decision === 'rejected' ? '审批已驳回，运行停止并进入可解释复盘' : '精确审批已通过，任务交还数字员工继续执行', payload: { decision, note, approvedPayloadHash, diff } });
  res.json(await buildOverview(tenantId));
});

async function supersedeGeneratedReview(tenantId: string, runId: string, userId: string, reason: string): Promise<void> {
  const review = await first<StoredRecord & { tenant_id: string }>(COLLECTION.reviews, { tenant_id: tenantId, run_id: runId, status: 'generated' }, '-version');
  if (!review) return;
  const changed = await compareAndSetRecord({ store, collection: COLLECTION.reviews, id: review.id, expected: { status: 'generated' }, patch: { status: 'superseded', superseded_at: new Date().toISOString(), superseded_by: userId, superseded_reason: reason } });
  if (!changed.ok && changed.reason !== 'conflict') throw new ReliableKernelError('review_supersede_failed');
}

digitalEmployeesRouter.post('/tasks/:taskId/actions', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  if (!roleAllowed(res, ['super_admin', 'admin', 'social_operator'])) return;
  const action = String(req.body?.action || '');
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  if (!['retry', 'skip', 'replan'].includes(action)) { res.status(400).json({ error: 'task_action_invalid', allowed: ['retry', 'skip', 'replan'] }); return; }
  const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, req.params.taskId, tenantId);
  if (!task) { res.status(404).json({ error: 'task_not_found' }); return; }
  const [run, goal] = await Promise.all([
    tenantRecord<RunRecord>(COLLECTION.runs, task.run_id, tenantId),
    tenantRecord<GoalRecord>(COLLECTION.goals, task.goal_id, tenantId),
  ]);
  if (!run || !goal) { res.status(409).json({ error: 'task_action_context_missing' }); return; }
  const role = (res.locals as DigitalEmployeeLocals).digitalEmployeeRole!;
  const effectiveOwner = task.owner_id || goal.owner_id;
  if (!ADMIN_ROLES.has(role) && effectiveOwner !== userId) { res.status(403).json({ error: 'task_action_owner_required' }); return; }
  if (task.status !== 'failed') { res.status(409).json({ error: 'task_action_state_invalid', status: task.status }); return; }
  if ((action === 'skip' || action === 'replan') && !note) { res.status(400).json({ error: 'task_action_note_required' }); return; }
  const now = new Date().toISOString();

  if (action === 'replan') {
    const config = publicConfig(await configForTenant(tenantId));
    const contractRecord = await first<ContractRecord>(COLLECTION.contracts, { tenant_id: tenantId, goal_id: goal.id, status: 'confirmed' }, '-version');
    if (!config || !contractRecord || contractRecord.goal_version !== goal.version) { res.status(409).json({ error: 'confirmed_execution_contract_required' }); return; }
    const executionContract = jsonObject<ExecutionContract>(contractRecord.contract, {} as ExecutionContract);
    const currentContract = await compileExecutionContract({ tenantId, goal: goalInput(goal), goalVersion: goal.version, config });
    if (currentContract.sourceFingerprint !== contractRecord.source_fingerprint || currentContract.readiness === 'blocked') { res.status(409).json({ error: 'execution_contract_reconfirmation_required' }); return; }
    const previousPlan = await first<PlanRecord & { version?: number }>(COLLECTION.plans, { tenant_id: tenantId, goal_id: goal.id }, '-version');
    const planVersion = Number(previousPlan?.version || 1) + 1;
    const planDraft = buildWeeklyPlan(goalInput(goal), config, executionContract);
    await appendAudit({ tenantId, userId, action: 'workflow.replan_requested', targetType: 'workflow_task', targetId: task.id, metadata: { runId: run.id, planVersion, note } });
    const planResult = await createRecordIfAbsent<PlanRecord>({ store, collection: COLLECTION.plans, uniqueWhere: { tenant_id: tenantId, goal_id: goal.id, version: planVersion }, data: { tenant_id: tenantId, goal_id: goal.id, goal_version: goal.version, version: planVersion, status: 'approved', plan: planDraft, reason: note, parent_plan_id: run.plan_id, idempotency_key: `goal:${goal.id}:v${goal.version}:plan:${planVersion}`, created_at: now } });
    const nextRun = await createRecordIfAbsent<RunRecord>({
      store, collection: COLLECTION.runs,
      uniqueWhere: { tenant_id: tenantId, idempotency_key: `goal:${goal.id}:v${goal.version}:replan:${planVersion}` },
      data: { tenant_id: tenantId, goal_id: goal.id, plan_id: planResult.record.id, status: 'planning', current_controller: 'agent', pause_reason: '', budget_limit: goal.budget_limit, budget_spent: 0, execution_snapshot: { config, goal: goalInput(goal), executionContract, plan: planDraft, policy: executionContract.policy, versions: { goal: goal.version, contract: contractRecord.version, plan: planVersion, policy: 1 }, replan: { previousRunId: run.id, failedTaskId: task.id, note } }, idempotency_key: `goal:${goal.id}:v${goal.version}:replan:${planVersion}`, available_at: now, lease_owner: '', lease_expires_at: '', started_at: now, completed_at: '', revision: 0, error_code: '', error_detail: '' },
    });
    await repairIncompleteRun(nextRun.record);
    if (goal.status === 'paused') {
      const resumedGoal = await compareAndSetRecord<GoalRecord>({ store, collection: COLLECTION.goals, id: goal.id, expected: { status: 'paused', version: goal.version }, patch: { status: 'active', updated_at: now } });
      if (!resumedGoal.ok) { res.status(409).json({ error: 'goal_replan_state_conflict' }); return; }
    }
    if (nextRun.created) {
      await appendEvent({ tenantId, runId: nextRun.record.id, type: 'plan.replanned', level: 'warning', summary: '已基于当前确认契约生成新计划版本', payload: { planVersion, previousRunId: run.id, failedTaskId: task.id, note } });
    }
    res.json(await buildOverview(tenantId)); return;
  }

  const maxAttempts = Math.max(1, Number(task.max_attempts || 3));
  if (action === 'retry' && !canRetryTask(Number(task.attempt || 0), maxAttempts, true)) { res.status(409).json({ error: 'task_retry_exhausted', attempt: task.attempt, maxAttempts }); return; }
  if (run.status !== 'failed') { res.status(409).json({ error: 'run_recovery_state_invalid', status: run.status }); return; }
  await appendAudit({ tenantId, userId, action: `task.${action}_requested`, targetType: 'workflow_task', targetId: task.id, metadata: { runId: run.id, note, priorError: task.error_code || '' } });
  await transitionRun(run, 'running', { current_controller: 'agent', pause_reason: '', completed_at: '', available_at: now, lease_owner: '', lease_expires_at: '', error_code: '', error_detail: '' });
  try {
    if (action === 'retry') {
      await transitionTask(task, 'pending', { output: { ...jsonObject<Record<string, unknown>>(task.output, {}), recovery: { action, requestedBy: userId, note, requestedAt: now, priorError: task.error_code || '' } }, blocked_reason: '', owner_id: '', available_at: now, lease_owner: '', lease_expires_at: '', completed_at: '', error_code: '', error_detail: '', updated_at: now });
    } else {
      await transitionTask(task, 'skipped', { output: { ...jsonObject<Record<string, unknown>>(task.output, {}), skipEvidence: { explicitlySkipped: true, requestedBy: userId, note, skippedAt: now, priorError: task.error_code || '', priorDetail: task.error_detail || '' } }, blocked_reason: `人工明确跳过：${note}`, owner_id: userId, completed_at: now, lease_owner: '', lease_expires_at: '', updated_at: now });
    }
  } catch (error) {
    await transitionRun(run, 'failed', { current_controller: 'human', pause_reason: '任务恢复并发冲突', completed_at: now, lease_owner: '', lease_expires_at: '' }).catch(() => undefined);
    throw error;
  }
  if (goal.status === 'paused') {
    await compareAndSetRecord<GoalRecord>({ store, collection: COLLECTION.goals, id: goal.id, expected: { status: 'paused', version: goal.version }, patch: { status: 'active', updated_at: now } });
  }
  await supersedeGeneratedReview(tenantId, run.id, userId, action);
  await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: `task.${action}_requested`, level: 'warning', summary: action === 'retry' ? `${task.title} 已由人工批准重试` : `${task.title} 已被人工明确跳过`, payload: { note, requestedBy: userId } });
  res.json(await buildOverview(tenantId));
});

digitalEmployeesRouter.post('/tasks/:taskId/handoff', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  if (!roleAllowed(res, ['super_admin', 'admin', 'social_operator'])) return;
  const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, req.params.taskId, tenantId);
  if (!task) { res.status(404).json({ error: 'task_not_found' }); return; }
  const run = await tenantRecord<RunRecord>(COLLECTION.runs, task.run_id, tenantId);
  if (!run || !['waiting_approval', 'running'].includes(run.status)) { res.status(409).json({ error: 'run_not_handoff_ready' }); return; }
  const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, tenantId);
  if (!goal || !adminOrOwner(res, userId, goal.owner_id)) { res.status(403).json({ error: 'goal_owner_required' }); return; }
  const now = new Date().toISOString();
  await appendAudit({ tenantId, userId, action: 'handoff.start_requested', targetType: 'workflow_task', targetId: task.id, metadata: { runId: run.id, priorTaskStatus: task.status } });
  const sessionResult = await createRecordIfAbsent<HandoffRecord>({ store, collection: COLLECTION.handoffs, uniqueWhere: { tenant_id: tenantId, task_id: task.id, status: 'active' }, data: {
    tenant_id: tenantId,
    run_id: run.id,
    task_id: task.id,
    status: 'active',
    taken_by: userId,
    snapshot: {
      taskStatus: task.status,
      taskOutput: jsonObject(task.output, {}),
      blockedReason: task.blocked_reason,
      externalActionsPerformed: false,
      constraints: ['接管期间 Agent 停止外部写入与费用消耗'],
    },
    started_at: now,
    returned_at: '',
    revision: 0,
  } });
  const session = sessionResult.record;
  if (!sessionResult.created) {
    res.status(409).json({ error: 'handoff_already_active', handoffId: session.id, ownerId: session.taken_by }); return;
  }
  try {
    await transitionTask(task, 'handed_off', { owner_id: userId, blocked_reason: '人工完整接管', lease_owner: '', lease_expires_at: '', updated_at: now });
  } catch (error) {
    if (sessionResult.created) await compareAndSetRecord({ store, collection: COLLECTION.handoffs, id: session.id, expected: { status: 'active' }, patch: { status: 'cancelled', returned_at: now, revision: Number(session.revision || 0) + 1 } }).catch(() => undefined);
    throw error;
  }
  try {
    await transitionRun(run, 'waiting_human', { current_controller: userId, pause_reason: '人工完整接管', lease_owner: '', lease_expires_at: '' });
  } catch (error) {
    const fallback = task.requires_approval ? 'waiting_approval' : 'pending';
    await transitionTask(task, fallback, { owner_id: '', blocked_reason: fallback === 'waiting_approval' ? '等待负责人审批' : '', updated_at: now }).catch(() => undefined);
    await compareAndSetRecord({ store, collection: COLLECTION.handoffs, id: session.id, expected: { status: 'active' }, patch: { status: 'cancelled', returned_at: now, revision: Number(session.revision || 0) + 1 } }).catch(() => undefined);
    throw error;
  }
  await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'handoff.started', level: 'warning', summary: `${task.title} 已由人工完整接管`, payload: { handoffId: session.id } });
  await appendAudit({ tenantId, userId, action: 'handoff.started', targetType: 'workflow_task', targetId: task.id, metadata: { runId: run.id, handoffId: session.id } });
  res.json(await buildOverview(tenantId));
});

digitalEmployeesRouter.post('/tasks/:taskId/return-to-agent', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  if (!roleAllowed(res, ['super_admin', 'admin', 'social_operator'])) return;
  const task = await tenantRecord<TaskRecord>(COLLECTION.tasks, req.params.taskId, tenantId);
  if (!task || task.status !== 'handed_off') { res.status(409).json({ error: 'task_not_handed_off' }); return; }
  const run = await tenantRecord<RunRecord>(COLLECTION.runs, task.run_id, tenantId);
  const handoff = await first<HandoffRecord>(COLLECTION.handoffs, { tenant_id: tenantId, task_id: task.id, status: 'active' }, '-started_at');
  if (!run || !handoff) { res.status(409).json({ error: 'handoff_context_missing' }); return; }
  if (!adminOrOwner(res, userId, handoff.taken_by)) { res.status(403).json({ error: 'handoff_owner_required' }); return; }
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  const outcome = String(req.body?.outcome || '');
  const externalActionsPerformed = req.body?.externalActionsPerformed;
  const result = req.body?.result;
  const rawReferences = req.body?.references;
  if (!note) { res.status(400).json({ error: 'handoff_note_required' }); return; }
  if (!['continue', 'completed'].includes(outcome)) { res.status(400).json({ error: 'handoff_outcome_invalid', allowed: ['continue', 'completed'] }); return; }
  if (typeof externalActionsPerformed !== 'boolean') { res.status(400).json({ error: 'handoff_external_actions_flag_required' }); return; }
  if (!result || typeof result !== 'object' || Array.isArray(result)) { res.status(400).json({ error: 'handoff_result_invalid' }); return; }
  const references = normalizeHandoffReferences(rawReferences);
  if (!references) { res.status(400).json({ error: 'handoff_references_invalid' }); return; }
  if (outcome === 'completed' && !hasMeaningfulHandoffResult(result)) {
    res.status(400).json({ error: 'handoff_completed_result_required' }); return;
  }
  if (externalActionsPerformed && references.length === 0) {
    res.status(400).json({ error: 'handoff_external_action_reference_required' }); return;
  }
  if (outcome === 'continue' && externalActionsPerformed && ['activation', 'production'].includes(task.kind)) {
    res.status(409).json({ error: 'external_action_reconciliation_required', message: '已发生外部动作的任务不能交还 Agent 重跑；请提交 completed 人工结果或先完成对账' }); return;
  }
  const now = new Date().toISOString();
  await appendAudit({ tenantId, userId, action: 'handoff.return_requested', targetType: 'handoff_session', targetId: handoff.id, metadata: { runId: run.id, taskId: task.id, note, outcome, externalActionsPerformed, references } });
  const taskStatus: WorkflowTaskStatus = outcome === 'completed' ? 'succeeded' : task.requires_approval ? 'waiting_approval' : 'pending';
  const runStatus = outcome === 'completed' ? 'running' : task.requires_approval ? 'waiting_approval' : 'running';
  const returnRequest: HandoffReturnRequest = {
    submittedBy: userId,
    submittedAt: now,
    note,
    result: result as Record<string, unknown>,
    references,
    externalActionsPerformed,
    outcome: outcome as HandoffReturnRequest['outcome'],
    taskStatus,
    runStatus,
  };
  const originalSnapshot = jsonObject<Record<string, unknown>>(handoff.snapshot, {});
  const reserved = await compareAndSetRecord<HandoffRecord>({
    store, collection: COLLECTION.handoffs, id: handoff.id,
    expected: { status: 'active', taken_by: handoff.taken_by, ...(handoff.revision === undefined ? {} : { revision: Number(handoff.revision || 0) }) },
    patch: {
      snapshot: { ...originalSnapshot, returnState: 'committing', returnRequest },
      revision: Number(handoff.revision || 0) + 1,
    },
  });
  if (!reserved.ok) { res.status(409).json({ error: 'handoff_return_conflict' }); return; }
  Object.assign(handoff, reserved.record);
  try {
    await transitionRun(run, runStatus, { current_controller: 'agent', pause_reason: '', available_at: now, lease_owner: '', lease_expires_at: '' });
  } catch (error) {
    await compareAndSetRecord<HandoffRecord>({
      store, collection: COLLECTION.handoffs, id: handoff.id,
      expected: { status: 'active', revision: Number(handoff.revision || 0) },
      patch: { snapshot: originalSnapshot, revision: Number(handoff.revision || 0) + 1 },
    }).catch(() => undefined);
    throw error;
  }
  try {
    await transitionTask(task, taskStatus, {
      owner_id: outcome === 'completed' ? userId : '', blocked_reason: taskStatus === 'waiting_approval' ? '等待负责人审批' : '',
      output: outcome === 'completed' ? { ...jsonObject<Record<string, unknown>>(task.output, {}), humanResult: returnRequest } : jsonObject<Record<string, unknown>>(task.output, {}),
      available_at: now, completed_at: outcome === 'completed' ? now : '', lease_owner: '', lease_expires_at: '', updated_at: now,
    });
  } catch (error) {
    await transitionRun(run, 'waiting_human', { current_controller: handoff.taken_by, pause_reason: '人工返还并发冲突', lease_owner: '', lease_expires_at: '' }).catch(() => undefined);
    await compareAndSetRecord<HandoffRecord>({
      store, collection: COLLECTION.handoffs, id: handoff.id,
      expected: { status: 'active', revision: Number(handoff.revision || 0) },
      patch: { snapshot: originalSnapshot, revision: Number(handoff.revision || 0) + 1 },
    }).catch(() => undefined);
    throw error;
  }
  await persistHandoffReturnSideEffects({ tenantId, run, task, handoff, request: returnRequest });
  const returned = await compareAndSetRecord<HandoffRecord>({
    store, collection: COLLECTION.handoffs, id: handoff.id,
    expected: { status: 'active', taken_by: handoff.taken_by, revision: Number(handoff.revision || 0) },
    patch: {
      status: 'returned',
      returned_at: now,
      snapshot: { ...originalSnapshot, returnState: 'completed', returnRequest, returnNote: note, humanResult: result, references, externalActionsPerformed, outcome },
      revision: Number(handoff.revision || 0) + 1,
    },
  });
  if (!returned.ok) throw new ReliableKernelError('handoff_return_conflict');
  await appendEvent({ tenantId, runId: run.id, taskId: task.id, type: 'handoff.returned', level: 'success', summary: outcome === 'completed' ? `${task.title} 已提交人工完成结果，Agent 不会重复该外部动作` : `${task.title} 已安全交还数字员工`, payload: { note, outcome, externalActionsPerformed, referenceCount: references.length } });
  await appendAudit({ tenantId, userId, action: 'handoff.returned', targetType: 'workflow_task', targetId: task.id, metadata: { runId: run.id, handoffId: handoff.id, outcome, externalActionsPerformed } });
  res.json(await buildOverview(tenantId));
});

digitalEmployeesRouter.post('/publishing-reconciliations/:postId/decide', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  if (!roleAllowed(res, ['super_admin', 'admin'])) return;
  const post = await tenantRecord<PostRecord & { tenant_id: string }>('posts', req.params.postId, tenantId);
  if (!post) { res.status(404).json({ error: 'publishing_reconciliation_not_found' }); return; }
  const stats = jsonObject<Record<string, unknown>>(post.stats, {});
  const digitalEmployeePost = stats.source === 'digital_employee';
  const recoverableFenceRelease = ['digital_employee', 'manual'].includes(String(stats.source || ''))
    && stats.status === 'voided'
    && stats.reconciliationDecision === 'void'
    && stats.externalPublicationsDetected !== true;
  if (recoverableFenceRelease) {
    const operationBlock = reconciliationOperationBlock(post);
    if (operationBlock) {
      res.status(409).json({ error: operationBlock, retryNotBefore: String(post.publish_retry_not_before || '') });
      return;
    }
    try {
      await releasePostContentFences(store, post.id);
    } catch (error) {
      await appendAudit({
        tenantId, userId, action: 'publishing.content_fence_release_failed', targetType: 'post', targetId: post.id,
        metadata: { decision: 'void', recovery: true, error: String((error as Error)?.message || error).slice(0, 500) },
      });
      res.status(503).json({ error: 'publishing_content_fence_release_failed', retryable: true });
      return;
    }
    await appendAudit({
      tenantId, userId, action: 'publishing.content_fence_released', targetType: 'post', targetId: post.id,
      metadata: { decision: 'void', recovery: true },
    });
    res.json({ post: publicPublishTracking(post), decision: 'void', recoveredFenceRelease: true });
    return;
  }
  if (!['digital_employee', 'manual'].includes(String(stats.source || ''))
    || post.reconciliation_required !== true || stats.status !== 'needs_reconciliation') {
    res.status(409).json({ error: 'publishing_reconciliation_not_pending', status: stats.status || '', publishRevision: Number(post.publish_revision || 0) });
    return;
  }
  if (digitalEmployeePost && (!String(post.digital_employee_run_id || '') || !String(post.digital_employee_approval_id || '')
    || !/^[a-f0-9]{64}$/.test(String(post.digital_employee_action_hash || '')))) {
    res.status(409).json({ error: 'publishing_reconciliation_binding_missing' });
    return;
  }
  const normalized = normalizeReconciliationDecision(post, req.body);
  if (!normalized.ok) { res.status(400).json({ error: normalized.error }); return; }
  const decision = normalized.value;
  if (decision.expectedRevision !== Number(post.publish_revision || 0)) {
    res.status(409).json({ error: 'publishing_reconciliation_revision_conflict', publishRevision: Number(post.publish_revision || 0) });
    return;
  }
  const releasesOrReusesNotPublishedFence = decision.action === 'confirm_not_published_retry'
    || (decision.action === 'void' && decision.receipts.every(receipt => receipt.outcome === 'not_published'));
  if (releasesOrReusesNotPublishedFence) {
    const operationBlock = reconciliationOperationBlock(post);
    if (operationBlock) {
      res.status(409).json({
        error: operationBlock,
        retryNotBefore: String(post.publish_retry_not_before || ''),
        message: operationBlock === 'publish_operation_not_quiesced'
          ? '上一次平台上传尚未确认停止，不能释放内容围栏或重试。'
          : '上一次上传刚结束，安全冷却期内不能重试。',
      });
      return;
    }
    const authorization = await validateReconciliationRetryAuthorization(post);
    if (!authorization.ok) {
      res.status(409).json({ error: authorization.code || 'publishing_retry_not_authorized', disposition: authorization.disposition || 'hold' });
      return;
    }
  }
  await appendAudit({
    tenantId,
    userId,
    action: 'publishing.reconciliation_requested',
    targetType: 'post',
    targetId: post.id,
    metadata: {
      decision: decision.action,
      expectedRevision: decision.expectedRevision,
      note: decision.note,
      receipts: decision.receipts,
      source: String(stats.source || ''),
      runId: String(post.digital_employee_run_id || ''),
      approvalId: String(post.digital_employee_approval_id || ''),
    },
  });
  const now = new Date().toISOString();
  const changed = await compareAndSetRecord<PostRecord>({
    store,
    collection: 'posts',
    id: post.id,
    expected: {
      publish_revision: decision.expectedRevision,
      reconciliation_required: true,
      digital_employee_fence_revision: Number(post.digital_employee_fence_revision || 0),
      ...(digitalEmployeePost ? {
        digital_employee_run_id: String(post.digital_employee_run_id || ''),
        digital_employee_approval_id: String(post.digital_employee_approval_id || ''),
        digital_employee_action_hash: String(post.digital_employee_action_hash || ''),
      } : {}),
    },
    patch: reconciliationPatchForDecision(post, decision, userId, now),
  });
  if (!changed.ok) {
    res.status(409).json({ error: 'publishing_reconciliation_revision_conflict' });
    return;
  }
  if (decision.action === 'void' && decision.receipts.every(receipt => receipt.outcome === 'not_published')) {
    try {
      await releasePostContentFences(store, post.id);
    } catch (error) {
      await appendAudit({
        tenantId, userId, action: 'publishing.content_fence_release_failed', targetType: 'post', targetId: post.id,
        metadata: {
          decision: decision.action,
          publishRevision: Number(changed.record.publish_revision || 0),
          error: String((error as Error)?.message || error).slice(0, 500),
        },
      });
      res.status(503).json({
        error: 'publishing_content_fence_release_failed',
        retryable: true,
        post: publicPublishTracking(changed.record),
        decision: decision.action,
      });
      return;
    }
  }
  if (digitalEmployeePost) {
    await appendEvent({
      tenantId,
      runId: String(post.digital_employee_run_id || ''),
      type: 'publishing.reconciliation_resolved',
      level: decision.action === 'confirm_published' ? 'success' : 'warning',
      summary: decision.action === 'confirm_published' ? '已根据账号回执确认发布成功' : decision.action === 'confirm_not_published_retry' ? '已确认平台未发布，允许安全重试' : '已根据账号回执作废发布任务',
      payload: { postId: post.id, decision: decision.action, publishRevision: Number(changed.record.publish_revision || 0) },
    });
  }
  await appendAudit({
    tenantId,
    userId,
    action: 'publishing.reconciliation_resolved',
    targetType: 'post',
    targetId: post.id,
    metadata: { decision: decision.action, publishRevision: Number(changed.record.publish_revision || 0) },
  });
  res.json({ post: publicPublishTracking(changed.record), decision: decision.action });
});

digitalEmployeesRouter.post('/runs/:runId/pause', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  if (!roleAllowed(res, ['super_admin', 'admin'])) return;
  const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
  if (!run) { res.status(404).json({ error: 'run_not_found' }); return; }
  const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, tenantId);
  if (!goal) { res.status(409).json({ error: 'goal_context_missing' }); return; }
  if (!['succeeded', 'failed', 'cancelled'].includes(run.status)) {
    const reason = String(req.body?.reason || '人工暂停').slice(0, 500);
    await appendAudit({ tenantId, userId, action: 'workflow.pause_requested', targetType: 'workflow_run', targetId: run.id, metadata: { from: run.status, reason } });
    await transitionRun(run, 'paused', { pause_reason: reason, current_controller: 'human', lease_owner: '', lease_expires_at: '' });
    const fenced = await fenceDigitalEmployeePostsForRun({ tenantId, runId: run.id, mode: 'pause', reason });
    await appendEvent({ tenantId, runId: run.id, type: 'workflow.paused', level: 'warning', summary: '运行已由人工暂停', payload: { publishingFence: fenced } });
    await appendAudit({ tenantId, userId, action: 'workflow.paused', targetType: 'workflow_run', targetId: run.id, metadata: { publishingFence: fenced } });
    if (fenced.conflicts.length) {
      res.status(409).json({ error: 'publishing_fence_conflict', runStatus: run.status, publishingFence: fenced });
      return;
    }
  }
  res.json(await buildOverview(tenantId));
});

digitalEmployeesRouter.post('/runs/:runId/resume', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  if (!roleAllowed(res, ['super_admin', 'admin'])) return;
  const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
  if (!run) { res.status(404).json({ error: 'run_not_found' }); return; }
  const goal = await tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, tenantId);
  if (!goal) { res.status(409).json({ error: 'goal_context_missing' }); return; }
  if (run.status === 'paused') {
    const liveGate = await liveExecutionContractGate(run);
    if (!liveGate.ok) { res.status(409).json({ error: liveGate.code, message: liveGate.detail }); return; }
    const pendingApproval = await first<ApprovalRecord>(COLLECTION.approvals, { tenant_id: tenantId, run_id: run.id, status: 'pending' });
    const target = pendingApproval ? 'waiting_approval' : 'running';
    await appendAudit({ tenantId, userId, action: 'workflow.resume_requested', targetType: 'workflow_run', targetId: run.id, metadata: { target } });
    await transitionRun(run, target, { pause_reason: '', current_controller: pendingApproval ? 'human' : 'agent', available_at: new Date().toISOString(), lease_owner: '', lease_expires_at: '' });
    const released = target === 'running'
      ? await releaseHeldDigitalEmployeePostsForRun({ tenantId, runId: run.id })
      : { inspected: 0, changed: 0, reconciliations: 0, conflicts: [] as string[] };
    await appendEvent({ tenantId, runId: run.id, type: 'workflow.resumed', level: 'success', summary: pendingApproval ? '运行已恢复，继续等待审批' : '运行已恢复', payload: { publishingFence: released } });
    await appendAudit({ tenantId, userId, action: 'workflow.resumed', targetType: 'workflow_run', targetId: run.id, metadata: { publishingFence: released } });
    if (released.conflicts.length) {
      res.status(409).json({ error: 'publishing_release_conflict', runStatus: run.status, publishingFence: released });
      return;
    }
  }
  res.json(await buildOverview(tenantId));
});

digitalEmployeesRouter.post('/runs/:runId/cancel', async (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  if (!roleAllowed(res, ['super_admin', 'admin'])) return;
  const run = await tenantRecord<RunRecord>(COLLECTION.runs, req.params.runId, tenantId);
  if (!run) { res.status(404).json({ error: 'run_not_found' }); return; }
  const ownerGoal = await tenantRecord<GoalRecord>(COLLECTION.goals, run.goal_id, tenantId);
  if (!ownerGoal) { res.status(409).json({ error: 'goal_context_missing' }); return; }
  if (['succeeded', 'cancelled'].includes(run.status)) { res.status(409).json({ error: 'run_not_cancellable', status: run.status }); return; }
  const now = new Date().toISOString();
  const [tasks, pendingApprovals, activeHandoffs] = await Promise.all([
    listAllRecords<TaskRecord>({ store, collection: COLLECTION.tasks, query: { where: { tenant_id: tenantId, run_id: run.id }, sort: 'id' } }),
    listAllRecords<ApprovalRecord>({ store, collection: COLLECTION.approvals, query: { where: { tenant_id: tenantId, run_id: run.id, status: 'pending' }, sort: 'id' } }),
    listAllRecords<HandoffRecord>({ store, collection: COLLECTION.handoffs, query: { where: { tenant_id: tenantId, run_id: run.id, status: 'active' }, sort: 'id' } }),
  ]);
  await appendAudit({ tenantId, userId, action: 'workflow.cancel_requested', targetType: 'workflow_run', targetId: run.id, metadata: { from: run.status } });
  await transitionRun(run, 'cancelled', { current_controller: 'human', pause_reason: '人工取消', completed_at: now, lease_owner: '', lease_expires_at: '' });
  const fenced = await fenceDigitalEmployeePostsForRun({ tenantId, runId: run.id, mode: 'cancel', reason: '运行已由人工取消' });
  for (const task of tasks.filter(item => !['succeeded', 'skipped', 'failed', 'cancelled'].includes(item.status))) {
    await transitionTask(task, 'cancelled', { blocked_reason: '运行已由人工取消', completed_at: now, lease_owner: '', lease_expires_at: '', updated_at: now });
  }
  await Promise.all(pendingApprovals.map(approval => compareAndSetRecord({ store, collection: COLLECTION.approvals, id: approval.id, expected: { status: 'pending', payload_hash: approval.payload_hash }, patch: { status: 'invalidated', decision_note: '运行已取消', decided_at: now, revision: Number(approval.revision || 0) + 1 } })));
  await Promise.all(activeHandoffs.map(handoff => compareAndSetRecord({ store, collection: COLLECTION.handoffs, id: handoff.id, expected: { status: 'active' }, patch: { status: 'cancelled', returned_at: now, revision: Number(handoff.revision || 0) + 1 } })));
  if (!['completed', 'cancelled'].includes(ownerGoal.status)) {
    const goalCancelled = await compareAndSetRecord<GoalRecord>({ store, collection: COLLECTION.goals, id: ownerGoal.id, expected: { status: ownerGoal.status, version: ownerGoal.version }, patch: { status: 'cancelled', updated_at: now } });
    if (!goalCancelled.ok) throw new ReliableKernelError('goal_cancel_conflict');
  }
  await appendEvent({ tenantId, runId: run.id, type: 'workflow.cancelled', level: 'warning', summary: '运行已取消，未完成任务停止执行', payload: { publishingFence: fenced } });
  await appendAudit({ tenantId, userId, action: 'workflow.cancelled', targetType: 'workflow_run', targetId: run.id, metadata: { publishingFence: fenced } });
  if (fenced.conflicts.length) {
    res.status(409).json({ error: 'publishing_fence_conflict', runStatus: run.status, publishingFence: fenced });
    return;
  }
  res.json(await buildOverview(tenantId));
});
