import { createHash } from 'node:crypto';
import { Router, json, type Response } from 'express';
import type { DataStore, Record_ } from '../storage/datastore.js';
import { enforceSupportSessionReadOnly, type AuthLocals } from '../middleware/auth.js';

export const MOBILE_WORKBENCH_ACTION_RECEIPTS = 'mobile_workbench_action_receipts';
export type MobileWorkbenchActionStatus = 'accepted' | 'running' | 'succeeded' | 'failed';
export type MobileWorkbenchActionKind = 'approval_decision' | 'retry_task' | 'starter_command';

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

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function publicReceipt(row: Record_) {
  return {
    id: row.id,
    kind: row.kind,
    targetId: row.target_id,
    expectedVersion: row.expected_version,
    status: row.status,
    acceptedAt: row.accepted_at,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    result: row.result || null,
    error: row.error || null,
  };
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
  if (!['approval_decision', 'retry_task', 'starter_command'].includes(kind)
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

export function createMobileWorkbenchActionsRouter(store: DataStore, executor?: MobileWorkbenchActionExecutor) {
  const router = Router();
  router.use(enforceSupportSessionReadOnly);

  router.post('/actions', json({ limit: '64kb' }), async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    const action = parseAction(req.body);
    if (!action) { res.status(400).json({ error: 'mobile_action_invalid' }); return; }
    const requestHash = hash(action);
    const receiptId = hash([tenantId, userId, action.idempotencyKey]).slice(0, 24);
    try {
      const existing = await store.getById<Record_>(MOBILE_WORKBENCH_ACTION_RECEIPTS, receiptId);
      if (existing) {
        if (existing.tenant_id !== tenantId || existing.user_id !== userId || existing.request_hash !== requestHash) {
          res.status(409).json({ error: 'mobile_action_idempotency_conflict' }); return;
        }
        res.setHeader('Cache-Control', 'private, no-store');
        res.status(existing.status === 'accepted' || existing.status === 'running' ? 202 : 200).json({ receipt: publicReceipt(existing), replayed: true });
        return;
      }
      if (action.kind === 'starter_command') {
        // Starter commands require role/capability resolution in the Starter router.
        // This shared route records no unverified command as if it had executed.
        res.status(409).json({ error: 'mobile_action_executor_required' }); return;
      }
      const subject = await authoritativeSubject(store, tenantId, action);
      if (!subject) { res.status(404).json({ error: 'mobile_action_target_not_found' }); return; }
      const conflict = actionConflict(subject, action);
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
        throw new Error('mobile_action_receipt_storage_unavailable');
      }
      if (!executor) {
        res.setHeader('Cache-Control', 'private, no-store');
        res.status(202).json({ receipt: publicReceipt(receipt), replayed: false });
        return;
      }
      receipt = await persistStatus(store, receipt, 'running', { started_at: new Date().toISOString() });
      try {
        const result = await executor({ tenantId, userId, receiptId, action, subject });
        receipt = await persistStatus(store, receipt, 'succeeded', { result: result ?? {}, error: null, finished_at: new Date().toISOString() });
        res.status(200).json({ receipt: publicReceipt(receipt), replayed: false });
      } catch (error) {
        const failure = { code: error instanceof Error ? text(error.message, 160) || 'mobile_action_failed' : 'mobile_action_failed' };
        receipt = await persistStatus(store, receipt, 'failed', { error: failure, finished_at: new Date().toISOString() });
        res.status(200).json({ receipt: publicReceipt(receipt), replayed: false });
      }
    } catch {
      res.status(503).json({ error: 'mobile_action_receipt_unavailable' });
    }
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
      res.json({ receipt: publicReceipt(receipt) });
    } catch { res.status(503).json({ error: 'mobile_action_receipt_unavailable' }); }
  });
  return router;
}
