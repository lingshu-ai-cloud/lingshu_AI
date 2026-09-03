import { createHash, randomUUID } from 'node:crypto';
import type { DataStore, Record_ } from '../storage/datastore.js';
import {
  RUN_TRANSITIONS,
  TASK_TRANSITIONS,
  canTransition,
  type WorkflowTaskStatus,
} from './domain.js';

export type AtomicConflictReason = 'not_found' | 'conflict';
export type CompareAndSetResult<T> =
  | { ok: true; record: T }
  | { ok: false; reason: AtomicConflictReason; current?: T };
export type CreateIfAbsentResult<T> = { created: boolean; record: T };

/**
 * Optional production primitives implemented by durable stores. The worker
 * deliberately does not pretend a read-then-write sequence is atomic in a
 * multi-instance production deployment.
 */
export type AtomicDataStore = DataStore & {
  compareAndSet?<T = Record_>(
    collection: string,
    id: string,
    expected: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Promise<CompareAndSetResult<T>>;
  createIfAbsent?<T = Record_>(
    collection: string,
    uniqueWhere: Record<string, string | number | boolean>,
    data: Record<string, unknown>,
  ): Promise<CreateIfAbsentResult<T>>;
};

const localLocks = new Map<string, Promise<void>>();

async function withLocalLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const predecessor = localLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  const tail = predecessor.then(() => current);
  localLocks.set(key, tail);
  await predecessor;
  try {
    return await work();
  } finally {
    release();
    if (localLocks.get(key) === tail) localLocks.delete(key);
  }
}

function recordMatches(record: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => {
    const actual = record[key];
    if (actual === undefined && (value === '' || value === null)) return true;
    return String(actual ?? '') === String(value ?? '');
  });
}

export class ReliableKernelError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message = code, retryable = false) {
    super(message);
    this.name = 'ReliableKernelError';
    this.code = code;
    this.retryable = retryable;
  }
}

function nativeAtomicRequired(): boolean {
  return process.env.NODE_ENV === 'production'
    && process.env.ALLOW_NON_ATOMIC_DIGITAL_EMPLOYEE_STORE !== 'true';
}

export async function compareAndSetRecord<T extends Record_>(input: {
  store: DataStore;
  collection: string;
  id: string;
  expected: Record<string, unknown>;
  patch: Record<string, unknown>;
}): Promise<CompareAndSetResult<T>> {
  const atomic = input.store as AtomicDataStore;
  if (atomic.compareAndSet) {
    return atomic.compareAndSet<T>(input.collection, input.id, input.expected, input.patch);
  }
  if (nativeAtomicRequired()) {
    throw new ReliableKernelError(
      'atomic_store_required',
      'The durable store does not implement compareAndSet; reliable execution is disabled.',
    );
  }
  return withLocalLock(`${input.collection}:${input.id}`, async () => {
    const current = await input.store.getById<T>(input.collection, input.id);
    if (!current) return { ok: false, reason: 'not_found' };
    if (!recordMatches(current, input.expected)) return { ok: false, reason: 'conflict', current };
    const updated = await input.store.update(input.collection, input.id, input.patch);
    if (!updated) return { ok: false, reason: 'conflict', current };
    const record = await input.store.getById<T>(input.collection, input.id);
    if (!record) throw new ReliableKernelError('storage_read_after_write_failed');
    return { ok: true, record };
  });
}

export async function createRecordIfAbsent<T extends Record_>(input: {
  store: DataStore;
  collection: string;
  uniqueWhere: Record<string, string | number | boolean>;
  data: Record<string, unknown>;
}): Promise<CreateIfAbsentResult<T>> {
  const atomic = input.store as AtomicDataStore;
  if (atomic.createIfAbsent) {
    return atomic.createIfAbsent<T>(input.collection, input.uniqueWhere, input.data);
  }
  if (nativeAtomicRequired()) {
    throw new ReliableKernelError(
      'atomic_store_required',
      'The durable store does not implement createIfAbsent; reliable execution is disabled.',
    );
  }
  const key = `${input.collection}:${stableHash(input.uniqueWhere)}`;
  return withLocalLock(key, async () => {
    const existing = await input.store.list<T>(input.collection, { where: input.uniqueWhere, page: 1, perPage: 1 });
    if (existing.items[0]) return { created: false, record: existing.items[0] };
    const record = await input.store.create<T>(input.collection, input.data);
    if (!record) throw new ReliableKernelError(`${input.collection}_storage_unavailable`);
    return { created: true, record };
  });
}

export function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function normalizeEventCursor(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

/**
 * Event sequences are dense and one-based. Mapping the cursor to a durable
 * page lets SSE catch up beyond a single store page without an unsupported
 * greater-than query.
 */
export function eventPageForCursor(cursor: unknown, perPage = 500): number {
  const size = Math.max(1, Math.floor(perPage));
  return Math.floor(normalizeEventCursor(cursor) / size) + 1;
}

export function isNextEventSequence(cursor: unknown, sequence: unknown): boolean {
  return normalizeEventCursor(sequence) === normalizeEventCursor(cursor) + 1;
}

export function workerIdentity(prefix = 'digital-worker'): string {
  return `${prefix}:${process.pid}:${randomUUID()}`;
}

export function retryDelayMs(attempt: number, baseMs = 1_000, maxMs = 60_000): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(maxMs, baseMs * (2 ** Math.min(10, normalizedAttempt - 1)));
}

export function canRetryTask(attempt: number, maxAttempts: number, retryable: boolean): boolean {
  return retryable && Math.max(0, Math.floor(attempt)) < Math.max(1, Math.floor(maxAttempts));
}

export function taskExecutionTimeoutMs(taskKey: string, genericTimeoutMs: number, renderTimeoutMs: number): number {
  if (taskKey === 'content_execution_pack') return Math.max(10 * 60_000, Math.floor(renderTimeoutMs));
  return Math.max(1, Math.floor(genericTimeoutMs));
}

export function validateApprovalPrecondition(input: {
  status: string;
  actionVersion: number;
  payloadHash: string;
  expiresAt?: string;
  expectedActionVersion: number;
  expectedPayloadHash: string;
  nowMs?: number;
}): { ok: true } | { ok: false; code: 'approval_precondition_required' | 'approval_stale' | 'approval_already_decided' | 'approval_expired' } {
  if (!Number.isInteger(input.expectedActionVersion) || input.expectedActionVersion < 1 || !input.expectedPayloadHash) {
    return { ok: false, code: 'approval_precondition_required' };
  }
  if (input.expectedActionVersion !== input.actionVersion || input.expectedPayloadHash !== input.payloadHash) {
    return { ok: false, code: 'approval_stale' };
  }
  if (input.status !== 'pending') return { ok: false, code: 'approval_already_decided' };
  if (input.expiresAt && Date.parse(input.expiresAt) <= (input.nowMs ?? Date.now())) return { ok: false, code: 'approval_expired' };
  return { ok: true };
}

/** Idempotent repair primitive: rerunning after a partial failure is safe. */
export async function repairRecordSet(keys: readonly string[], ensure: (key: string) => Promise<void>): Promise<void> {
  for (const key of keys) await ensure(key);
}

export class WorkerAdmissionController {
  #accepting = true;
  accepting(): boolean { return this.#accepting; }
  start(): void { this.#accepting = true; }
  stop(): void { this.#accepting = false; }
}

export async function liveAiGovernanceAllowsExecution(
  readGovernance: () => Promise<{ aiAccessEnabled?: boolean } | undefined>,
): Promise<boolean> {
  const governance = await readGovernance();
  return governance?.aiAccessEnabled !== false;
}

export function validateLiveGovernanceSnapshot(
  expected: { aiAccessEnabled?: boolean; sourceVersion?: string } | undefined,
  live: { aiAccessEnabled?: boolean; sourceVersion?: string },
): { ok: true } | { ok: false; code: 'execution_contract_governance_snapshot_missing' | 'ai_data_access_disabled' | 'execution_contract_source_changed' } {
  if (!expected?.sourceVersion) return { ok: false, code: 'execution_contract_governance_snapshot_missing' };
  if (live.aiAccessEnabled === false) return { ok: false, code: 'ai_data_access_disabled' };
  if ((live.sourceVersion || 'unknown') !== expected.sourceVersion) return { ok: false, code: 'execution_contract_source_changed' };
  return { ok: true };
}

export function isLeaseExpired(leaseExpiresAt: unknown, nowMs = Date.now()): boolean {
  const expiresAt = Date.parse(String(leaseExpiresAt || ''));
  return !Number.isFinite(expiresAt) || expiresAt <= nowMs;
}

export function isAvailable(availableAt: unknown, nowMs = Date.now()): boolean {
  const timestamp = Date.parse(String(availableAt || ''));
  return !Number.isFinite(timestamp) || timestamp <= nowMs;
}

export function assertRunTransition(from: string, to: string): void {
  if (!canTransition(RUN_TRANSITIONS, from, to)) {
    throw new ReliableKernelError('run_transition_invalid', `${from} -> ${to}`);
  }
}

export function assertTaskTransition(from: string, to: WorkflowTaskStatus): void {
  if (!canTransition(TASK_TRANSITIONS, from, to)) {
    throw new ReliableKernelError('task_transition_invalid', `${from} -> ${to}`);
  }
}

export interface GateTask {
  id: string;
  task_key: string;
  agent_role: string;
  kind: string;
  status: string;
  depends_on?: unknown;
  requires_approval?: boolean;
  expected_cost?: number;
}

export interface GateRun {
  status: string;
  budget_limit?: number;
  budget_spent?: number;
  execution_snapshot?: unknown;
}

export interface ExecutionGateResult {
  allowed: boolean;
  needsApproval: boolean;
  code?: string;
  detail?: string;
  estimatedCost: number;
}

function objectValue<T extends Record<string, unknown>>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return fallback; }
  }
  return typeof value === 'object' && !Array.isArray(value) ? value as T : fallback;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item)).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(item => String(item)).filter(Boolean) : [];
    } catch { return []; }
  }
  return [];
}

/** Evaluate all non-negotiable gates before a task is leased. */
export function evaluateExecutionGates(input: {
  run: GateRun;
  task: GateTask;
  tasks: GateTask[];
}): ExecutionGateResult {
  const snapshot = objectValue<Record<string, unknown>>(input.run.execution_snapshot, {});
  const config = objectValue<Record<string, unknown>>(snapshot.config, {});
  const contract = objectValue<Record<string, unknown>>(snapshot.executionContract, {});
  const policy = objectValue<Record<string, unknown>>(snapshot.policy || contract.policy, {});
  const governance = objectValue<Record<string, unknown>>(contract.dataGovernance, {});
  const plan = objectValue<Record<string, unknown>>(snapshot.plan, {});
  const plannedTasks = Array.isArray(plan.tasks) ? plan.tasks as Array<Record<string, unknown>> : [];
  const planned = plannedTasks.find(item => String(item.key) === input.task.task_key);
  const planTotalCost = Math.max(0, Number(plan.estimatedCost || 0));
  const estimatedCost = Math.max(0, Number(input.task.expected_cost ?? planned?.estimatedCost ?? (
    plannedTasks.length ? planTotalCost / plannedTasks.length : 0
  )) || 0);

  if (contract.readiness === 'blocked') {
    return { allowed: false, needsApproval: false, code: 'execution_contract_blocked', detail: '执行契约存在阻塞缺口', estimatedCost };
  }
  if (governance.aiAccessEnabled === false || policy.aiAccessEnabled === false) {
    return { allowed: false, needsApproval: false, code: 'ai_data_access_disabled', detail: '企业已关闭 AI 数据访问授权', estimatedCost };
  }
  const team = stringList(config.team);
  if (team.length && !team.includes(input.task.agent_role)) {
    return { allowed: false, needsApproval: false, code: 'agent_not_in_team', detail: `${input.task.agent_role} Agent 不在获准团队中`, estimatedCost };
  }
  const dependencies = stringList(input.task.depends_on);
  for (const key of dependencies) {
    const dependency = input.tasks.find(item => item.task_key === key);
    if (!dependency) {
      return { allowed: false, needsApproval: false, code: 'dependency_missing', detail: `缺少依赖任务 ${key}`, estimatedCost };
    }
    if (['failed', 'cancelled'].includes(dependency.status)) {
      return { allowed: false, needsApproval: false, code: 'dependency_failed', detail: `依赖任务 ${key} 未成功`, estimatedCost };
    }
    if (!['succeeded', 'skipped'].includes(dependency.status)) {
      return { allowed: false, needsApproval: false, code: 'dependency_pending', detail: `等待依赖任务 ${key}`, estimatedCost };
    }
  }
  const limit = Math.max(0, Number(input.run.budget_limit ?? policy.budgetLimit ?? 0));
  const spent = Math.max(0, Number(input.run.budget_spent || 0));
  if (estimatedCost > Math.max(0, limit - spent)) {
    return { allowed: false, needsApproval: false, code: 'budget_exceeded', detail: '任务预计费用超过剩余预算', estimatedCost };
  }
  const autonomyMode = String(policy.autonomyMode || config.autonomyMode || 'managed');
  if (!['suggest', 'collaborate', 'managed', 'automatic'].includes(autonomyMode)) {
    return { allowed: false, needsApproval: false, code: 'autonomy_mode_invalid', detail: '运行快照中的自主模式无效', estimatedCost };
  }
  // Suggest mode is enforced by the outbound proposal compiler as dry-run
  // only. Internal draft generation remains allowed so the human has a
  // concrete artifact to review; the existing exact outbound approval task is
  // still mandatory before activation in every mode.
  const suggestNeedsApproval = false;
  const collaborateNeedsApproval = false;
  return {
    allowed: true,
    needsApproval: Boolean(input.task.requires_approval || suggestNeedsApproval || collaborateNeedsApproval),
    estimatedCost,
  };
}

export function errorInfo(error: unknown): { code: string; detail: string; retryable: boolean } {
  if (error instanceof ReliableKernelError) {
    return { code: error.code, detail: error.message.slice(0, 2_000), retryable: error.retryable };
  }
  const candidate = error as { code?: unknown; message?: unknown; retryable?: unknown };
  const rawMessage = String(candidate?.message || error || 'task_execution_failed');
  const inferredCode = /^[a-z][a-z0-9_]{2,119}$/.test(rawMessage) ? rawMessage : 'task_execution_failed';
  const code = String(candidate?.code || inferredCode).slice(0, 120);
  const detail = rawMessage.slice(0, 2_000);
  const nonRetryable = new Set([
    'ai_data_access_disabled', 'budget_exceeded', 'execution_contract_blocked',
    'dependency_failed', 'dependency_missing', 'approval_snapshot_stale',
    'execution_contract_source_changed', 'execution_contract_governance_snapshot_missing',
    'enterprise_ai_access_not_authorized', 'approved_action_payload_changed',
    'approved_action_expired', 'approved_action_payload_invalid', 'approved_action_hash_missing',
  ]);
  return { code, detail, retryable: candidate?.retryable === true || !nonRetryable.has(code) };
}

export async function runWithHeartbeat<T>(input: {
  work: (signal: AbortSignal) => Promise<T>;
  heartbeat: () => Promise<boolean>;
  heartbeatMs: number;
  timeoutMs: number;
}): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let timeout: NodeJS.Timeout | undefined;
  let leaseLost = false;
  let heartbeatBusy = false;
  const heartbeat = async () => {
    if (heartbeatBusy || controller.signal.aborted) return;
    heartbeatBusy = true;
    try {
      const retained = await input.heartbeat();
      if (!retained) {
        leaseLost = true;
        controller.abort(new ReliableKernelError('task_lease_lost'));
      }
    } catch (error) {
      leaseLost = true;
      controller.abort(error);
    } finally {
      heartbeatBusy = false;
    }
  };
  timer = setInterval(() => { void heartbeat(); }, Math.max(250, input.heartbeatMs));
  const abortPromise = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => {
      reject(controller.signal.reason || new ReliableKernelError('task_aborted'));
    }, { once: true });
  });
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new ReliableKernelError('task_timeout', 'Task execution timed out.', true);
      controller.abort(error);
      reject(error);
    }, Math.max(1, input.timeoutMs));
  });
  try {
    const result = await Promise.race([input.work(controller.signal), timeoutPromise, abortPromise]);
    if (leaseLost) throw new ReliableKernelError('task_lease_lost', 'Task lease was lost.', true);
    return result;
  } finally {
    if (timer) clearInterval(timer);
    if (timeout) clearTimeout(timeout);
  }
}
