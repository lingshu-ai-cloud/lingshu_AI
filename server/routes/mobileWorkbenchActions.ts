import { createHash } from 'node:crypto';
import { Router, json, type Request, type Response } from 'express';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { enforceSupportSessionReadOnly, type AuthLocals } from '../middleware/auth.js';
import { requestOrganizationRoleStrict, type OrganizationRole } from '../lib/organizationRole.js';

export const MOBILE_WORKBENCH_ACTION_RECEIPTS = 'mobile_workbench_action_receipts';
export type MobileWorkbenchActionStatus = 'accepted' | 'running' | 'succeeded' | 'failed';
export type MobileWorkbenchActionKind = 'approval_decision' | 'retry_task' | 'starter_command'
  | 'scoped_repair' | 'material_fulfillment' | 'connection_repair'
  | 'publication_evidence_submit' | 'publication_receipt_verify'
  | 'conversation_reply_send' | 'conversation_assign' | 'dependency_retry';
export type MobileWorkbenchActionCapability = 'approval.decide' | 'task.retry' | 'content.repair'
  | 'material.fulfill' | 'connection.repair' | 'publication.manage' | 'conversation.manage';

const ACTION_CAPABILITY: Readonly<Partial<Record<MobileWorkbenchActionKind, MobileWorkbenchActionCapability>>> = {
  approval_decision: 'approval.decide',
  retry_task: 'task.retry',
  dependency_retry: 'task.retry',
  scoped_repair: 'content.repair',
  material_fulfillment: 'material.fulfill',
  connection_repair: 'connection.repair',
  publication_evidence_submit: 'publication.manage',
  publication_receipt_verify: 'publication.manage',
  conversation_reply_send: 'conversation.manage',
  conversation_assign: 'conversation.manage',
};

const CAPABILITY_ROLES: Readonly<Record<MobileWorkbenchActionCapability, ReadonlySet<OrganizationRole>>> = {
  'approval.decide': new Set<OrganizationRole>(['super_admin', 'admin']),
  'task.retry': new Set<OrganizationRole>(['super_admin', 'admin', 'social_operator', 'customer_service']),
  'content.repair': new Set<OrganizationRole>(['super_admin', 'admin', 'social_operator']),
  'material.fulfill': new Set<OrganizationRole>(['super_admin', 'admin', 'social_operator']),
  'connection.repair': new Set<OrganizationRole>(['super_admin', 'admin', 'social_operator']),
  'publication.manage': new Set<OrganizationRole>(['super_admin', 'admin', 'social_operator']),
  'conversation.manage': new Set<OrganizationRole>(['super_admin', 'admin', 'customer_service']),
};

export function mobileWorkbenchActionCapabilityAllowed(
  role: OrganizationRole | null,
  kind: MobileWorkbenchActionKind,
): boolean {
  const capability = ACTION_CAPABILITY[kind];
  return Boolean(role && capability && CAPABILITY_ROLES[capability].has(role));
}

export interface MobileWorkbenchActionInput {
  kind: MobileWorkbenchActionKind;
  targetId: string;
  expectedVersion: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface MobileWorkbenchActionExecution {
  tenantId: string;
  userId: string;
  receiptId: string;
  action: MobileWorkbenchActionInput;
  subject: Record_;
}

export type MobileWorkbenchActionExecutor = (input: MobileWorkbenchActionExecution) => Promise<Record<string, unknown> | void>;

const IN_FLIGHT_STATUSES = new Set<MobileWorkbenchActionStatus>(['accepted', 'running']);
const RECEIPT_CONTRACT_VERSION = 1;

export function createMobileWorkbenchDomainExecutor(dependencies: {
  decideApproval(input: { tenantId: string; userId: string; approvalId: string; decision: 'approved' | 'rejected'; note?: string; expectedSubjectVersion: string }): Promise<unknown>;
  retryTask(input: { tenantId: string; userId: string; taskId: string; expectedTaskVersion: string; instruction?: string; rerunDownstream?: boolean }): Promise<unknown>;
}): MobileWorkbenchActionExecutor {
  return async ({ tenantId, userId, action }) => {
    if (action.kind === 'approval_decision') {
      const result = await dependencies.decideApproval({
        tenantId, userId, approvalId: action.targetId,
        decision: String(action.payload.decision) as 'approved' | 'rejected',
        note: String(action.payload.note || '').slice(0, 5000),
        expectedSubjectVersion: action.expectedVersion,
      });
      return result && typeof result === 'object' && !Array.isArray(result) ? { ...result } : {};
    }
    if (action.kind === 'retry_task') {
      const result = await dependencies.retryTask({
        tenantId, userId, taskId: action.targetId, expectedTaskVersion: action.expectedVersion,
        instruction: String(action.payload.instruction || '').slice(0, 5000),
        rerunDownstream: action.payload.rerunDownstream !== false,
      });
      return result && typeof result === 'object' && !Array.isArray(result) ? { ...result } : {};
    }
    throw new Error('mobile_action_executor_unavailable');
  };
}

function text(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function publicReceipt(row: Record_) {
  const status = row.status as MobileWorkbenchActionStatus;
  const outcomeUnknown = status === 'failed'
    && Boolean(row.error && typeof row.error === 'object' && (row.error as Record<string, unknown>).code === 'mobile_action_outcome_unknown');
  const startedAtMs = Date.parse(text(row.started_at));
  const needsReconciliation = status === 'running' && Number.isFinite(startedAtMs)
    && Date.now() - startedAtMs >= 15 * 60_000;
  return {
    id: row.id,
    kind: row.kind,
    targetId: row.target_id,
    expectedVersion: row.expected_version,
    status,
    acceptedAt: row.accepted_at,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    result: row.result || null,
    error: row.error || null,
    terminal: !IN_FLIGHT_STATUSES.has(status),
    recovery: {
      pollAfterMs: IN_FLIGHT_STATUSES.has(status) ? 1500 : null,
      canRetry: status === 'failed' && !outcomeUnknown,
      outcomeKnown: status === 'succeeded' || (status === 'failed' && !outcomeUnknown),
      needsReconciliation,
    },
  };
}

function receiptEnvelope(row: Record_) {
  return { contractVersion: RECEIPT_CONTRACT_VERSION, receipt: publicReceipt(row) };
}

function parseAction(value: unknown): MobileWorkbenchActionInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).sort();
  if (keys.join(',') !== ['expectedVersion', 'idempotencyKey', 'kind', 'payload', 'targetId'].sort().join(',')) return null;
  const kind = text(source.kind) as MobileWorkbenchActionKind;
  const targetId = text(source.targetId);
  const expectedVersion = text(source.expectedVersion);
  const idempotencyKey = text(source.idempotencyKey, 128);
  const payload = source.payload;
  if (!Object.prototype.hasOwnProperty.call(ACTION_CAPABILITY, kind) && kind !== 'starter_command'
    || !/^[A-Za-z0-9:_-]{1,200}$/.test(targetId)
    || !/^[A-Za-z0-9:._-]{1,128}$/.test(expectedVersion)
    || !/^[A-Za-z0-9:._-]{8,128}$/.test(idempotencyKey)
    || !payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return { kind, targetId, expectedVersion, idempotencyKey, payload: payload as Record<string, unknown> };
}

function subjectVersion(subject: Record_, kind: MobileWorkbenchActionKind): string {
  const value = kind === 'approval_decision'
    ? subject.subject_version ?? subject.version ?? subject.updated_at
    : subject.task_version ?? subject.version ?? subject.updated_at;
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : text(value);
}

async function authoritativeSubject(store: DataStore, tenantId: string, action: MobileWorkbenchActionInput): Promise<Record_ | null> {
  if (action.kind === 'starter_command') return null;
  const collection = action.kind === 'approval_decision' ? 'approval_requests' : 'workflow_tasks';
  const subject = await store.getById<Record_>(collection, action.targetId);
  if (!subject || subject.tenant_id !== tenantId) return null;
  return subject;
}

export type MobileWorkbenchSubjectResolver = (
  store: DataStore,
  tenantId: string,
  action: MobileWorkbenchActionInput,
) => Promise<Record_ | null>;

function actionConflict(subject: Record_, action: MobileWorkbenchActionInput): string | null {
  if (subjectVersion(subject, action.kind) !== action.expectedVersion) return 'mobile_action_version_conflict';
  if (action.kind === 'approval_decision') {
    if (subject.status !== 'pending') return 'mobile_action_not_actionable';
    if (!['approved', 'rejected'].includes(text(action.payload.decision))) return 'mobile_action_payload_invalid';
  }
  if (action.kind === 'retry_task' && !['failed', 'handed_off', 'blocked'].includes(text(subject.status))) return 'mobile_action_not_actionable';
  return null;
}

async function persistStatus(store: DataStore, receipt: Record_, status: MobileWorkbenchActionStatus, fields: Record<string, unknown>): Promise<Record_> {
  if (!await store.update(MOBILE_WORKBENCH_ACTION_RECEIPTS, receipt.id, { status, ...fields })) {
    throw new Error('mobile_action_receipt_storage_unavailable');
  }
  const updated = await store.getById<Record_>(MOBILE_WORKBENCH_ACTION_RECEIPTS, receipt.id);
  if (!updated || updated.tenant_id !== receipt.tenant_id || updated.user_id !== receipt.user_id) {
    throw new Error('mobile_action_receipt_integrity_violation');
  }
  return updated;
}


export type MobileWorkbenchRoleResolver = (
  request: Request,
  userId: string,
) => Promise<OrganizationRole | null>;

export function createMobileWorkbenchActionsRouter(
  store: DataStore,
  executor?: MobileWorkbenchActionExecutor,
  resolveRole: MobileWorkbenchRoleResolver = (request, userId) => requestOrganizationRoleStrict(request.headers.authorization, userId),
  resolveSubject: MobileWorkbenchSubjectResolver = authoritativeSubject,
) {
  const router = Router();
  router.use(enforceSupportSessionReadOnly);

  router.post('/actions', json({ limit: '64kb' }), async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const action = parseAction(req.body);
    if (!action) { res.status(400).json({ error: 'mobile_action_invalid' }); return; }
    let role: OrganizationRole | null;
    try {
      role = await resolveRole(req, userId);
    } catch {
      res.status(503).json({ error: 'mobile_action_authorization_unavailable' }); return;
    }
    if (!mobileWorkbenchActionCapabilityAllowed(role, action.kind)) {
      res.status(403).json({
        error: 'mobile_action_capability_required',
        capability: ACTION_CAPABILITY[action.kind] ?? null,
        message: '当前组织角色无权执行此操作。',
      });
      return;
    }
    const requestHash = hash(action);
    const receiptId = hash([tenantId, userId, action.idempotencyKey]).slice(0, 24);
    try {
      const existing = await store.getById<Record_>(MOBILE_WORKBENCH_ACTION_RECEIPTS, receiptId);
      if (existing) {
        if (existing.tenant_id !== tenantId || existing.user_id !== userId || existing.request_hash !== requestHash) {
          res.status(409).json({ error: 'mobile_action_idempotency_conflict' }); return;
        }
        res.setHeader('Cache-Control', 'private, no-store');
        res.status(existing.status === 'accepted' || existing.status === 'running' ? 202 : 200).json({ ...receiptEnvelope(existing), replayed: true });
        return;
      }
      if (action.kind === 'starter_command') {
        // Starter commands require role/capability resolution in the Starter router.
        // This shared route records no unverified command as if it had executed.
        res.status(409).json({ error: 'mobile_action_executor_required' }); return;
      }
      const subject = await resolveSubject(store, tenantId, action);
      if (!subject) { res.status(404).json({ error: 'mobile_action_target_not_found' }); return; }
      const conflict = ['approval_decision', 'retry_task'].includes(action.kind) ? actionConflict(subject, action) : null;
      if (conflict) { res.status(conflict.endsWith('payload_invalid') ? 400 : 409).json({ error: conflict }); return; }
      const now = new Date().toISOString();
      const data = {
        id: receiptId, tenant_id: tenantId, user_id: userId, kind: action.kind,
        target_id: action.targetId, expected_version: action.expectedVersion,
        idempotency_key: action.idempotencyKey, request_hash: requestHash,
        payload: action.payload, status: 'accepted', accepted_at: now,
        started_at: '', finished_at: '', result: null, error: null,
      };
      let receipt: Record_ | null = null;
      try { receipt = await store.create<Record_>(MOBILE_WORKBENCH_ACTION_RECEIPTS, data); } catch { /* verify a concurrent insert below */ }
      if (!receipt) receipt = await store.getById<Record_>(MOBILE_WORKBENCH_ACTION_RECEIPTS, receiptId);
      if (!receipt || receipt.tenant_id !== tenantId || receipt.user_id !== userId || receipt.request_hash !== requestHash) {
        if (receipt && receipt.tenant_id === tenantId && receipt.user_id === userId && receipt.request_hash !== requestHash) {
          res.status(409).json({ error: 'mobile_action_idempotency_conflict' }); return;
        }
        throw new Error('mobile_action_receipt_storage_unavailable');
      }
      if (!executor) {
        res.setHeader('Cache-Control', 'private, no-store');
        res.status(202).json({ ...receiptEnvelope(receipt), replayed: false });
        return;
      }
      receipt = await persistStatus(store, receipt, 'running', { started_at: new Date().toISOString() });
      try {
        const result = await executor({ tenantId, userId, receiptId, action, subject });
        const domainStatus = result && typeof result === 'object' ? text((result as Record<string, unknown>).status, 64) : '';
        const remainsInFlight = ['accepted', 'queued', 'running', 'waiting_user', 'waiting_verification', 'accepted_unconfirmed'].includes(domainStatus);
        receipt = await persistStatus(store, receipt, remainsInFlight ? 'running' : 'succeeded', {
          result: result ?? {}, error: null, ...(remainsInFlight ? {} : { finished_at: new Date().toISOString() }),
        });
        res.status(remainsInFlight ? 202 : 200).json({ ...receiptEnvelope(receipt), replayed: false });
      } catch (error) {
        const failure = { code: error instanceof Error ? text(error.message, 160) || 'mobile_action_failed' : 'mobile_action_failed' };
        receipt = await persistStatus(store, receipt, 'failed', { error: failure, finished_at: new Date().toISOString() });
        res.status(200).json({ ...receiptEnvelope(receipt), replayed: false });
      }
    } catch {
      res.status(503).json({ error: 'mobile_action_receipt_unavailable' });
    }
  });

  router.get('/actions', async (req, res: Response) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const scope = text(req.query.scope, 20) || 'in_flight';
    const limit = Math.min(100, Math.max(1, Number.parseInt(text(req.query.limit, 3), 10) || 50));
    if (!['in_flight', 'all'].includes(scope)) { res.status(400).json({ error: 'mobile_action_receipt_scope_invalid' }); return; }
    try {
      const baseWhere = { tenant_id: tenantId, user_id: userId };
      let scoped: Record_[];
      if (scope === 'in_flight') {
        const [accepted, running] = await Promise.all([
          store.list<Record_>(MOBILE_WORKBENCH_ACTION_RECEIPTS, { where: { ...baseWhere, status: 'accepted' }, sort: '-accepted_at', page: 1, perPage: limit }),
          store.list<Record_>(MOBILE_WORKBENCH_ACTION_RECEIPTS, { where: { ...baseWhere, status: 'running' }, sort: '-accepted_at', page: 1, perPage: limit }),
        ]);
        scoped = [...accepted.items, ...running.items]
          .sort((left, right) => text(right.accepted_at).localeCompare(text(left.accepted_at))).slice(0, limit);
      } else {
        const result = await store.list<Record_>(MOBILE_WORKBENCH_ACTION_RECEIPTS, {
          where: baseWhere, sort: '-accepted_at', page: 1, perPage: limit,
        });
        scoped = result.items;
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        contractVersion: RECEIPT_CONTRACT_VERSION,
        receipts: scoped.map(publicReceipt),
        scope,
        serverTime: new Date().toISOString(),
      });
    } catch { res.status(503).json({ error: 'mobile_action_receipt_unavailable' }); }
  });

  router.get('/actions/:receiptId', async (req, res: Response) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const receiptId = text(req.params.receiptId, 64);
    if (!/^[a-f0-9]{24}$/.test(receiptId)) { res.status(400).json({ error: 'mobile_action_receipt_id_invalid' }); return; }
    try {
      const receipt = await store.getById<Record_>(MOBILE_WORKBENCH_ACTION_RECEIPTS, receiptId);
      if (!receipt || receipt.tenant_id !== tenantId || receipt.user_id !== userId) {
        res.status(404).json({ error: 'mobile_action_receipt_not_found' }); return;
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(receiptEnvelope(receipt));
    } catch { res.status(503).json({ error: 'mobile_action_receipt_unavailable' }); }
  });
  return router;
}
