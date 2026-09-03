import type {
  ApprovalActionSnapshot,
  ApprovalRequest,
  BusinessGoalResult,
  DigitalEmployeeOverview,
  PublishingReconciliationAction,
  RunEvent,
  WeeklyGoal,
  WeeklyReview,
  WorkItem,
  WorkflowTask,
} from '../../lib/digitalEmployees';

export type ProductionFilter = 'all' | 'running' | 'attention' | 'exception' | 'completed';
export type CanonicalWorkItemStatus = 'pending' | 'processed' | 'taken_over' | 'expired';

export interface WorkItemFilterState {
  status: 'all' | CanonicalWorkItemStatus;
  type: string;
  risk: string;
  agent: string;
  owner: string;
  goalId: string;
}

export interface ApprovalSnapshotView extends ApprovalActionSnapshot {
  actionVersion: number;
  payloadHash: string;
  riskLevel: string;
  missingFields: string[];
  expired: boolean;
  canDecide: boolean;
}

export interface ObjectDiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}

export interface WorkflowProgress {
  completed: number;
  total: number;
  failed: number;
  rate: number;
}

export interface BusinessOutcomeView {
  status: string;
  label: string;
  metric: string;
  definition: string;
  baseline: number | null;
  target: number | null;
  current: number | null;
  unit: string;
  progressRate: number | null;
  source: string;
  sourceStatus: string;
  windowLabel: string;
  missingReason: string;
}

export interface PublishingReconciliationView {
  postId: string;
  expectedRevision: number;
  targetAccountIds: string[];
  allowedDecisions: PublishingReconciliationAction[];
  blindRetryAllowed: false;
  missingFields: string[];
  canDecide: boolean;
}

export interface ManualHandoffSubmissionState {
  canSubmit: boolean;
  error: '' | 'note_required' | 'completed_result_required' | 'external_action_reference_required' | 'external_action_cannot_continue';
}

const activeRank: Record<string, number> = {
  waiting_approval: 0,
  handed_off: 1,
  waiting_human: 1,
  failed: 2,
  running: 3,
  pending: 4,
  succeeded: 5,
  cancelled: 6,
};

const riskRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const statusRank: Record<CanonicalWorkItemStatus, number> = { pending: 0, expired: 1, taken_over: 2, processed: 3 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function finite(value: unknown): number | undefined {
  const number = Number(value);
  return value !== '' && value !== null && value !== undefined && Number.isFinite(number) ? number : undefined;
}

function firstDefined<T>(...values: Array<T | null | undefined>): T | undefined {
  return values.find(value => value !== undefined && value !== null) ?? undefined;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function selectPriorityTasks(tasks: WorkflowTask[]): WorkflowTask[] {
  return [...tasks].sort((a, b) => (activeRank[a.status] ?? 4) - (activeRank[b.status] ?? 4) || a.sequence - b.sequence);
}

export function selectProductionEvents(events: RunEvent[], filter: ProductionFilter, limit = 5): RunEvent[] {
  const matches = (event: RunEvent) => {
    if (filter === 'all') return true;
    if (filter === 'running') return /started|running|resumed|heartbeat/.test(event.type);
    if (filter === 'attention') return /approval|handoff|human|information|required/.test(event.type);
    if (filter === 'exception') return event.level === 'error' || /failed|timeout|dead_letter|cancelled/.test(event.type);
    return event.level === 'success' || /completed|succeeded|decided|returned/.test(event.type);
  };
  return [...events]
    .filter(matches)
    .sort((a, b) => Number(b.sequence) - Number(a.sequence))
    .slice(0, Math.max(0, limit));
}

export function mergeRunEvents(current: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  const byKey = new Map<string, RunEvent>();
  for (const event of [...current, ...incoming]) {
    const key = event.id || `${event.run_id}:${event.sequence}`;
    byKey.set(key, event);
  }
  return [...byKey.values()].sort((a, b) => Number(a.sequence) - Number(b.sequence));
}

export function mergeOverview(current: DigitalEmployeeOverview | null, incoming: DigitalEmployeeOverview): DigitalEmployeeOverview {
  if (!current || current.run?.id !== incoming.run?.id) return incoming;
  return { ...incoming, events: mergeRunEvents(current.events, incoming.events) };
}

export function selectWorkflowProgress(tasks: WorkflowTask[]): WorkflowProgress {
  const total = tasks.length;
  const completed = tasks.filter(task => task.status === 'succeeded').length;
  const failed = tasks.filter(task => task.status === 'failed').length;
  return { completed, total, failed, rate: total ? Math.round((completed / total) * 100) : 0 };
}

export function canonicalWorkItemStatus(status: string, dueAt = '', now = new Date()): CanonicalWorkItemStatus {
  if (status === 'pending' && dueAt && new Date(dueAt).getTime() <= now.getTime()) return 'expired';
  if (['expired', 'timed_out'].includes(status)) return 'expired';
  if (['active', 'taken_over', 'handed_off', 'waiting_human'].includes(status)) return 'taken_over';
  if (['approved', 'approved_with_changes', 'rejected', 'returned', 'resolved', 'completed', 'succeeded', 'cancelled', 'processed'].includes(status)) return 'processed';
  return 'pending';
}

function localWorkItems(data: DigitalEmployeeOverview): WorkItem[] {
  return [
    ...data.approvals.map(item => ({
      id: item.id,
      type: 'approval',
      status: item.status,
      sourceStatus: item.status,
      runId: item.run_id,
      taskId: item.task_id,
      ownerId: item.owner_id || '',
      agent: item.requested_by_agent,
      risk: item.risk_level,
      goalId: item.goal_id || data.goal?.id || '',
      dueAt: item.expires_at || '',
      createdAt: item.created_at,
      summary: item.action_summary,
    } satisfies WorkItem)),
    ...data.handoffs.map(item => ({
      id: item.id,
      type: 'handoff',
      status: item.status,
      sourceStatus: item.status,
      runId: item.run_id,
      taskId: item.task_id,
      ownerId: item.taken_by,
      agent: '',
      risk: 'medium',
      goalId: data.goal?.id || '',
      dueAt: '',
      createdAt: item.started_at,
    } satisfies WorkItem)),
    ...data.tasks.filter(item => item.status === 'failed').map(item => ({
      id: item.id,
      type: 'failure',
      status: 'pending',
      sourceStatus: item.status,
      runId: item.run_id,
      taskId: item.id,
      ownerId: item.owner_id,
      agent: item.agent_role,
      risk: 'high',
      goalId: data.goal?.id || '',
      dueAt: '',
      updatedAt: item.updated_at,
      title: item.title,
      summary: item.error_detail || item.blocked_reason,
    } satisfies WorkItem)),
  ];
}

export function selectWorkItems(data: DigitalEmployeeOverview | null, remoteItems: WorkItem[] = []): WorkItem[] {
  if (!data && remoteItems.length === 0) return [];
  const source = remoteItems.length > 0 ? remoteItems : data ? localWorkItems(data) : [];
  const seen = new Set<string>();
  return source
    .map(item => ({ ...item, sourceStatus: item.sourceStatus || item.status, status: canonicalWorkItemStatus(item.status, item.dueAt) }))
    .filter(item => {
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const statusDifference = statusRank[a.status as CanonicalWorkItemStatus] - statusRank[b.status as CanonicalWorkItemStatus];
      if (statusDifference) return statusDifference;
      const riskDifference = (riskRank[a.risk] ?? 4) - (riskRank[b.risk] ?? 4);
      if (riskDifference) return riskDifference;
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aDue - bDue;
    });
}

export function filterWorkItems(items: WorkItem[], filters: WorkItemFilterState): WorkItem[] {
  return items.filter(item => (filters.status === 'all' || item.status === filters.status)
    && (!filters.type || item.type === filters.type)
    && (!filters.risk || item.risk === filters.risk)
    && (!filters.agent || item.agent === filters.agent)
    && (!filters.owner || item.ownerId === filters.owner)
    && (!filters.goalId || item.goalId === filters.goalId));
}

export function selectActionableWorkItemCount(items: WorkItem[]): number {
  return items.filter(item => item.status === 'pending' || item.status === 'taken_over').length;
}

const PUBLISHING_RECONCILIATION_ACTIONS = new Set<PublishingReconciliationAction>([
  'confirm_published',
  'confirm_not_published_retry',
  'void',
]);

export function selectPublishingReconciliation(item: WorkItem): PublishingReconciliationView | null {
  if (item.type !== 'publishing_reconciliation') return null;
  const postId = text(item.postId);
  const expectedRevision = finite(item.expectedRevision);
  const targetAccountIds = Array.from(new Set((Array.isArray(item.targetAccountIds) ? item.targetAccountIds : [])
    .map(text)
    .filter(Boolean)));
  const allowedDecisions = Array.from(new Set((Array.isArray(item.allowedDecisions) ? item.allowedDecisions : [])
    .filter((action): action is PublishingReconciliationAction => PUBLISHING_RECONCILIATION_ACTIONS.has(action as PublishingReconciliationAction))));
  const missingFields = [
    !postId && '发布记录 ID',
    (expectedRevision === undefined || !Number.isInteger(expectedRevision) || expectedRevision < 0) && '发布版本',
    targetAccountIds.length === 0 && '目标账号',
    allowedDecisions.length === 0 && '允许的对账结论',
    item.blindRetryAllowed !== false && '禁止盲目重试标记',
  ].filter(Boolean) as string[];
  return {
    postId,
    expectedRevision: expectedRevision ?? -1,
    targetAccountIds,
    allowedDecisions,
    blindRetryAllowed: false,
    missingFields,
    canDecide: item.status === 'pending' && missingFields.length === 0,
  };
}

export function selectManualHandoffSubmission(input: {
  note: string;
  resultSummary: string;
  references: string[];
  externalActionsPerformed: boolean;
  outcome: 'continue' | 'completed';
}): ManualHandoffSubmissionState {
  if (!input.note.trim()) return { canSubmit: false, error: 'note_required' };
  if (input.outcome === 'continue' && input.externalActionsPerformed) return { canSubmit: false, error: 'external_action_cannot_continue' };
  if (input.outcome === 'completed' && !input.resultSummary.trim()) return { canSubmit: false, error: 'completed_result_required' };
  if (input.externalActionsPerformed && input.references.every(value => !value.trim())) return { canSubmit: false, error: 'external_action_reference_required' };
  return { canSubmit: true, error: '' };
}

function normalizeAccounts(value: unknown): Array<{ id: string; platform?: string; name?: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(item => {
    if (typeof item === 'string') return { id: item };
    if (!isRecord(item)) return { id: '' };
    return { id: text(item.id), platform: text(item.platform), name: text(item.name || item.label) };
  }).filter(item => item.id);
}

export function selectApprovalSnapshot(approval: ApprovalRequest, now = new Date()): ApprovalSnapshotView {
  const raw = approval as ApprovalRequest & Record<string, unknown>;
  const nested = isRecord(raw.action_snapshot) ? raw.action_snapshot : {};
  const payload = isRecord(raw.action_payload) ? raw.action_payload : {};
  const parameters = firstDefined(
    isRecord(raw.action_parameters) ? raw.action_parameters : undefined,
    isRecord(nested.parameters) ? nested.parameters : undefined,
    isRecord(payload.parameters) ? payload.parameters : undefined,
    Object.keys(payload).length ? payload : undefined,
  );
  const actionType = text(firstDefined(raw.action_type, nested.actionType, nested.action_type, payload.actionType, payload.action_type, payload.type));
  const mode = text(firstDefined(nested.mode, payload.mode));
  const targetAccounts = firstDefined(
    normalizeAccounts(raw.target_accounts),
    normalizeAccounts(raw.target_account_ids),
    normalizeAccounts(raw.target_account ? [raw.target_account] : undefined),
    normalizeAccounts(nested.targetAccounts),
    normalizeAccounts(payload.targetAccounts),
    normalizeAccounts(payload.target_account_ids),
    normalizeAccounts(payload.targetAccount ? [payload.targetAccount] : undefined),
  );
  const scheduledAt = text(firstDefined(raw.scheduled_at, nested.scheduledAt, nested.scheduled_at, payload.scheduledAt, payload.scheduled_at));
  const estimatedCost = firstDefined(
    finite(raw.estimated_cost), finite(nested.estimatedCost), finite(nested.estimated_cost), finite(payload.estimatedCost), finite(payload.estimated_cost),
  );
  const rawReversible = firstDefined(raw.reversible, nested.reversible, payload.reversible);
  const reversible = typeof rawReversible === 'boolean' ? rawReversible : undefined;
  const reversibility = text(firstDefined(raw.reversibility, nested.reversibility, payload.reversibility));
  const expiresAt = text(firstDefined(raw.expires_at, nested.expiresAt, nested.expires_at, payload.expiresAt, payload.expires_at));
  const nextStep = text(firstDefined(raw.next_step, nested.nextStep, nested.next_step, payload.nextStep, payload.next_step));
  const artifact = isRecord(payload.artifact) ? payload.artifact : {};
  const contentSnapshot = isRecord(payload.contentSnapshot) ? payload.contentSnapshot : undefined;
  const contentPayloadHash = text(payload.contentPayloadHash);
  const contentVersion = text(firstDefined(raw.content_version, nested.contentVersion, nested.content_version, payload.contentVersion, payload.content_version, artifact.version));
  const artifactMaterials = Object.keys(artifact).length
    ? [artifact.scriptId, artifact.videoPath, artifact.videoUrl].filter(value => typeof value === 'string' && value) as string[]
    : undefined;
  const materialVersions = firstDefined(
    Array.isArray(raw.material_versions) ? raw.material_versions : undefined,
    Array.isArray(nested.materialVersions) ? nested.materialVersions as ApprovalActionSnapshot['materialVersions'] : undefined,
    Array.isArray(payload.material_versions) ? payload.material_versions as ApprovalActionSnapshot['materialVersions'] : undefined,
    artifactMaterials,
  );
  const actionVersion = finite(raw.action_version) || 0;
  const payloadHash = text(raw.payload_hash);
  const externalAction = /publish|schedule|post|send|outbound|register_schedule/i.test(actionType);
  const missingFields = [
    !actionType && '动作类型',
    !parameters && '完整动作参数',
    !actionVersion && '动作版本',
    !payloadHash && 'Payload Hash',
    !contentVersion && '内容版本',
    materialVersions === undefined && '素材版本清单',
    estimatedCost === undefined && '预计费用',
    reversible === undefined && !reversibility && '可逆性',
    !expiresAt && '失效时间',
    !nextStep && '批准后下一步',
    externalAction && mode !== 'dry_run' && !targetAccounts?.length && '目标账号',
    externalAction && !scheduledAt && '排期时间',
    externalAction && !contentSnapshot && '完整内容快照',
    externalAction && !contentPayloadHash && '内容快照 Hash',
  ].filter(Boolean) as string[];
  const expired = Boolean(expiresAt && new Date(expiresAt).getTime() <= now.getTime());
  return {
    actionType,
    mode,
    parameters,
    contentVersion,
    materialVersions,
    targetAccounts,
    scheduledAt,
    estimatedCost,
    reversible,
    reversibility,
    expiresAt,
    nextStep,
    contentSnapshot,
    contentPayloadHash,
    artifact,
    actionVersion,
    payloadHash,
    riskLevel: text(firstDefined(raw.risk_level, raw.risk, nested.riskLevel, nested.risk_level, payload.risk)) || 'unknown',
    missingFields,
    expired,
    canDecide: approval.status === 'pending' && !expired && missingFields.length === 0,
  };
}

function deepDiff(before: unknown, after: unknown, path: string, entries: ObjectDiffEntry[]): void {
  if (Object.is(before, after)) return;
  if (isRecord(before) && isRecord(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) deepDiff(before[key], after[key], path ? `${path}.${key}` : key, entries);
    return;
  }
  entries.push({ path: path || '(根)', before, after });
}

export function buildObjectDiff(base: Record<string, unknown>, changes: Record<string, unknown>): ObjectDiffEntry[] {
  const merged = { ...base, ...changes };
  const entries: ObjectDiffEntry[] = [];
  deepDiff(base, merged, '', entries);
  return entries;
}

export function parseApprovalChanges(value: string): { changes: Record<string, unknown> | null; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { changes: null, error: '请输入需要修改的参数' };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed) || Object.keys(parsed).length === 0) return { changes: null, error: '修改内容必须是非空 JSON 对象' };
    return { changes: parsed, error: '' };
  } catch {
    return { changes: null, error: '修改内容不是有效 JSON' };
  }
}

function businessResult(review: WeeklyReview | null): BusinessGoalResult | null {
  if (review?.summary.businessGoal) return review.summary.businessGoal;
  const outcome = review?.summary.businessOutcome;
  if (!outcome) return null;
  const statusMap: Record<string, string> = {
    achieved: 'achieved', not_achieved: 'not_achieved', in_progress: 'observing',
    awaiting_measurement: 'insufficient_data', unsupported_metric: 'insufficient_data',
  };
  return {
    status: statusMap[outcome.status] || outcome.status,
    metric: outcome.metric,
    definition: outcome.explanation,
    baseline: outcome.baseline,
    target: outcome.target,
    current: outcome.observedValue === null ? undefined : outcome.observedValue,
    progressRate: outcome.progressPercent === null ? undefined : outcome.progressPercent,
    observationWindow: outcome.window,
    source: outcome.source,
    sourceStatus: outcome.dataQuality === 'verified' ? 'available' : outcome.dataQuality === 'partial' ? 'partial' : 'missing',
    missingReason: outcome.explanation,
  };
}

export function selectBusinessOutcome(review: WeeklyReview | null, goal: WeeklyGoal | null): BusinessOutcomeView {
  const result = businessResult(review);
  const baseline = finite(result?.baseline);
  const target = finite(result?.target);
  const current = finite(result?.current);
  const explicitProgress = finite(result?.progressRate);
  const sourceStatus = result?.sourceStatus || (result ? 'partial' : 'missing');
  const hasOutcomeData = Boolean(result && sourceStatus !== 'missing' && current !== undefined);
  let progressRate = explicitProgress;
  if (progressRate === undefined && hasOutcomeData && baseline !== undefined && target !== undefined && target !== baseline) {
    progressRate = Math.round(((current! - baseline) / (target - baseline)) * 100);
  }
  const status = result?.status || (review ? 'insufficient_data' : 'observing');
  const labels: Record<string, string> = {
    achieved: '已达成', not_achieved: '未达成', observing: '观察中', insufficient_data: '数据不足',
  };
  const startsAt = result?.observationWindow?.startsAt || goal?.startsAt || '';
  const endsAt = result?.observationWindow?.endsAt || goal?.endsAt || '';
  return {
    status,
    label: labels[status] || status,
    metric: result?.metric || goal?.metric || '经营指标',
    definition: result?.definition || '',
    baseline: baseline ?? (goal ? goal.baseline : null),
    target: target ?? (goal ? goal.target : null),
    current: hasOutcomeData ? current! : null,
    unit: result?.unit || goal?.unit || '',
    progressRate: hasOutcomeData && progressRate !== undefined ? progressRate : null,
    source: result?.source || '',
    sourceStatus,
    windowLabel: startsAt || endsAt ? `${startsAt || '—'} 至 ${endsAt || '—'}` : '未定义',
    missingReason: result?.missingReason || (!result ? '尚未回写真实发布结果与社媒指标，不能从任务完成率推断经营结果。' : !hasOutcomeData ? '数据源尚未返回可用观测值。' : ''),
  };
}

export function hasRecordField(record: Record<string, unknown>, key: string): boolean {
  return hasOwn(record, key);
}
