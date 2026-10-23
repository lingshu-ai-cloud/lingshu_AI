import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import {
  normalizeEnterpriseOnboardingDraft,
  validateEnterpriseOnboardingConfirmation,
  type EnterpriseOnboardingConfirmation,
  type EnterpriseOnboardingDraft,
} from '../../shared/contracts/enterpriseOnboarding.js';
import type { AuthLocals } from '../middleware/auth.js';
import type { DataStore, Record_ } from '../storage/datastore.js';

export const ENTERPRISE_ONBOARDING_DRAFT_COLLECTION = 'enterprise_onboarding_drafts';

type DraftRow = Record_ & {
  tenant_id: string;
  user_id: string;
  schema_version: string;
  revision: number;
  current_step: number;
  base_fact_version: string;
  confirmation_id: string;
  confirmation_state?: string;
  claim_token?: string;
  payload: unknown;
  updated_at: string;
  updated_by: string;
};

function sameDraftContent(left: EnterpriseOnboardingDraft | null, right: EnterpriseOnboardingDraft | null): boolean {
  if (!left || !right) return false;
  return JSON.stringify({ ...left, revision: 0, updatedAt: '' })
    === JSON.stringify({ ...right, revision: 0, updatedAt: '' });
}

async function readDraftRow(store: DataStore, tenantId: string, userId: string): Promise<DraftRow | null> {
  const result = await store.list<DraftRow>(ENTERPRISE_ONBOARDING_DRAFT_COLLECTION, {
    where: { tenant_id: tenantId, user_id: userId }, page: 1, perPage: 2,
  });
  if (result.totalItems > 1) throw new Error('enterprise_onboarding_draft_not_unique');
  const row = result.items[0];
  return row?.tenant_id === tenantId && row.user_id === userId ? row : null;
}

export class EnterpriseOnboardingDraftConflictError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Claim the exact server-saved confirmation before changing any enterprise facts.
 * A successful CAS also fences later PUTs from another tab. A retry of the
 * same confirmation may resume after a partial config write. */
export async function claimEnterpriseOnboardingDraft(
  store: DataStore,
  identity: { tenantId: string; userId: string },
  confirmation: EnterpriseOnboardingConfirmation,
): Promise<string | null> {
  const row = await readDraftRow(store, identity.tenantId, identity.userId);
  const draft = normalizeEnterpriseOnboardingDraft(row?.payload);
  const savedConfirmation = draft && validateEnterpriseOnboardingConfirmation({
    ...draft, draftRevision: confirmation.draftRevision,
  }).confirmation;
  if (!row || !draft || !savedConfirmation
    || row.confirmation_id !== confirmation.confirmationId
    || draft.revision !== confirmation.draftRevision
    || JSON.stringify(savedConfirmation) !== JSON.stringify(confirmation)) {
    throw new EnterpriseOnboardingDraftConflictError(
      'enterprise_onboarding_draft_conflict', '确认资料已在另一个窗口更新，请刷新后重新核对。',
    );
  }
  const state = String(row.confirmation_state || 'draft');
  if (state === 'completed' && row.revision >= confirmation.draftRevision + 2) return null;
  if (!((state === 'draft' && row.revision === confirmation.draftRevision)
    || (['confirming', 'retryable'].includes(state) && row.revision === confirmation.draftRevision + 1))) {
    throw new EnterpriseOnboardingDraftConflictError(
      'enterprise_onboarding_draft_conflict', '确认资料已在另一个窗口更新，请刷新后重新核对。',
    );
  }
  // The same confirmation may resume after a process failure, but must never
  // be executed by two live requests at once. A stale claim can be reclaimed
  // only after the bounded processing window, with a new fencing token.
  const claimedAt = Date.parse(row.updated_at || '');
  if (state === 'confirming' && !Number.isFinite(claimedAt)) throw new Error('enterprise_onboarding_claim_timestamp_invalid');
  if (state === 'confirming' && Date.now() - claimedAt < 10 * 60_000) {
    throw new EnterpriseOnboardingDraftConflictError(
      'enterprise_onboarding_confirmation_in_progress', '原确认正在处理；如结果仍未返回，请约 10 分钟后以同一请求重试。',
    );
  }
  const atomic = await (store.supportsAtomicCompareAndSwapFor?.(ENTERPRISE_ONBOARDING_DRAFT_COLLECTION)
    ?? store.supportsAtomicCompareAndSwap?.() ?? false);
  if (!atomic || !store.compareAndSwap) throw new Error('enterprise_onboarding_draft_atomicity_unavailable');
  const claimToken = randomUUID();
  if (!await store.compareAndSwap(ENTERPRISE_ONBOARDING_DRAFT_COLLECTION, row.id,
    state === 'draft'
      ? { revision: row.revision, confirmation_id: confirmation.confirmationId, confirmation_state: 'draft' }
      : { revision: row.revision, confirmation_id: confirmation.confirmationId, confirmation_state: state, claim_token: row.claim_token, updated_at: row.updated_at },
    { revision: state === 'draft' ? row.revision + 1 : row.revision, confirmation_state: 'confirming', claim_token: claimToken, updated_at: new Date().toISOString() })) {
    throw new EnterpriseOnboardingDraftConflictError(
      'enterprise_onboarding_draft_conflict', '确认资料已在另一个窗口更新，请刷新后重新核对。',
    );
  }
  return claimToken;
}

export async function assertEnterpriseOnboardingDraftClaim(
  store: DataStore,
  identity: { tenantId: string; userId: string },
  confirmationId: string,
  claimToken: string | null,
): Promise<void> {
  const row = await readDraftRow(store, identity.tenantId, identity.userId);
  if (row?.confirmation_id === confirmationId && (
    row.confirmation_state === 'completed'
    || (row.confirmation_state === 'confirming' && row.claim_token === claimToken && Boolean(claimToken))
  )) return;
  throw new EnterpriseOnboardingDraftConflictError(
    'enterprise_onboarding_confirmation_superseded', '原确认已被其他请求接管，请核验当前资料后再继续。',
  );
}

export async function clearEnterpriseOnboardingDraft(
  store: DataStore,
  identity: { tenantId: string; userId: string },
  confirmationId: string,
  claimToken: string | null,
): Promise<void> {
  const row = await readDraftRow(store, identity.tenantId, identity.userId);
  if (!row || row.confirmation_id !== confirmationId) throw new Error('enterprise_onboarding_draft_clear_conflict');
  if (row.confirmation_state === 'completed') return;
  if (row.confirmation_state !== 'confirming' || !claimToken || row.claim_token !== claimToken) throw new Error('enterprise_onboarding_draft_not_claimed');
  const atomic = await (store.supportsAtomicCompareAndSwapFor?.(ENTERPRISE_ONBOARDING_DRAFT_COLLECTION)
    ?? store.supportsAtomicCompareAndSwap?.() ?? false);
  if (!atomic || !store.compareAndSwap) {
    throw new Error('enterprise_onboarding_draft_atomicity_unavailable');
  }
  const updatedAt = new Date().toISOString();
  if (!await store.compareAndSwap(
    ENTERPRISE_ONBOARDING_DRAFT_COLLECTION,
    row.id,
    { revision: row.revision, confirmation_id: confirmationId, claim_token: claimToken },
    {
      revision: row.revision + 1,
      confirmation_state: 'completed',
      updated_at: updatedAt,
      updated_by: identity.userId,
    },
  )) {
    throw new Error('enterprise_onboarding_draft_clear_failed');
  }
}

/** A known pre-write fact-version conflict can safely unlock the draft. An
 * unknown storage result must stay locked for idempotent same-request recovery. */
export async function releaseEnterpriseOnboardingDraftClaim(
  store: DataStore,
  identity: { tenantId: string; userId: string },
  confirmationId: string,
  claimToken: string | null,
): Promise<void> {
  const row = await readDraftRow(store, identity.tenantId, identity.userId);
  if (!row || row.confirmation_id !== confirmationId || row.confirmation_state !== 'confirming'
    || !claimToken || row.claim_token !== claimToken) return;
  const draft = normalizeEnterpriseOnboardingDraft(row.payload);
  if (!draft || !store.compareAndSwap) throw new Error('enterprise_onboarding_draft_release_unavailable');
  const nextRevision = row.revision + 1;
  if (!await store.compareAndSwap(ENTERPRISE_ONBOARDING_DRAFT_COLLECTION, row.id,
    { revision: row.revision, confirmation_id: confirmationId, confirmation_state: 'confirming', claim_token: claimToken },
    { revision: nextRevision, payload: { ...draft, revision: nextRevision }, confirmation_state: 'draft', claim_token: '' })) {
    throw new Error('enterprise_onboarding_draft_release_failed');
  }
}

/** Only a positively known no-write outcome may unlock immediate replay. A
 * transport error or uncertain backend acknowledgement must remain confirming
 * until the stale-claim window closes. */
export async function markEnterpriseOnboardingDraftRetryable(
  store: DataStore,
  identity: { tenantId: string; userId: string },
  confirmationId: string,
  claimToken: string | null,
): Promise<void> {
  const row = await readDraftRow(store, identity.tenantId, identity.userId);
  if (!row || row.confirmation_id !== confirmationId || row.confirmation_state !== 'confirming'
    || !claimToken || row.claim_token !== claimToken || !store.compareAndSwap) {
    throw new Error('enterprise_onboarding_retryable_claim_lost');
  }
  if (!await store.compareAndSwap(ENTERPRISE_ONBOARDING_DRAFT_COLLECTION, row.id,
    { revision: row.revision, confirmation_state: 'confirming', claim_token: claimToken },
    { confirmation_state: 'retryable', updated_at: new Date().toISOString() })) {
    throw new Error('enterprise_onboarding_retryable_mark_failed');
  }
}

export function createEnterpriseOnboardingDraftRouter(store: DataStore): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    try {
      const row = await readDraftRow(store, tenantId, userId);
      const draft = row?.confirmation_state === 'completed' ? null : normalizeEnterpriseOnboardingDraft(row?.payload);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ draft, revision: Math.max(0, Number(row?.revision || 0)) });
    } catch {
      res.status(503).json({ error: 'enterprise_onboarding_draft_unavailable', message: '新手引导草稿暂时无法读取。' });
    }
  });

  router.put('/', async (req, res) => {
    const { tenantId, userId } = res.locals as AuthLocals;
    try {
      const requested = normalizeEnterpriseOnboardingDraft(req.body?.draft);
      const expectedRevision = Math.max(0, Math.floor(Number(req.body?.expectedRevision) || 0));
      if (!requested) {
        res.status(400).json({ error: 'enterprise_onboarding_draft_invalid', message: '新手引导草稿格式无效。' });
        return;
      }
      const current = await readDraftRow(store, tenantId, userId);
      const currentRevision = Math.max(0, Number(current?.revision || 0));
      if (current?.confirmation_state === 'confirming' || current?.confirmation_state === 'retryable') {
        res.status(409).json({ error: 'enterprise_onboarding_confirmation_in_progress', message: '原确认正在处理，请等待结果或重试同一确认请求。' });
        return;
      }
      if (currentRevision !== expectedRevision) {
        const currentDraft = normalizeEnterpriseOnboardingDraft(current?.payload);
        // A client may retry after PocketBase committed the prior save but its
        // response was lost. Return that exact semantic draft as success; never
        // turn an uncertain response into a duplicate revision.
        if (currentRevision === expectedRevision + 1 && sameDraftContent(currentDraft, requested)) {
          res.json({ draft: currentDraft, revision: currentRevision });
          return;
        }
        res.status(409).json({
          error: 'enterprise_onboarding_draft_conflict',
          message: '新手引导已在另一个窗口更新，请刷新后继续。',
          draft: currentDraft,
          revision: currentRevision,
        });
        return;
      }
      const updatedAt = new Date().toISOString();
      const draft: EnterpriseOnboardingDraft = {
        ...requested,
        revision: currentRevision + 1,
        updatedAt,
      };
      const payload = {
        schema_version: draft.schemaVersion,
        revision: draft.revision,
        current_step: draft.currentStep,
        base_fact_version: draft.baseFactVersion,
        confirmation_id: draft.confirmationId,
        confirmation_state: 'draft',
        claim_token: '',
        payload: draft,
        updated_at: updatedAt,
        updated_by: userId,
      };
      if (current) {
        const atomic = await (store.supportsAtomicCompareAndSwapFor?.(ENTERPRISE_ONBOARDING_DRAFT_COLLECTION)
          ?? store.supportsAtomicCompareAndSwap?.() ?? false);
        if (!atomic || !store.compareAndSwap) {
          res.status(503).json({ error: 'enterprise_onboarding_draft_atomicity_unavailable', message: '当前无法安全保存草稿，请稍后重试。' });
          return;
        }
        if (!await store.compareAndSwap(ENTERPRISE_ONBOARDING_DRAFT_COLLECTION, current.id, { revision: currentRevision }, payload)) {
          res.status(409).json({ error: 'enterprise_onboarding_draft_conflict', message: '新手引导已在另一个窗口更新，请刷新后继续。' });
          return;
        }
      } else {
        const uniqueOwner = await (store.supportsAtomicCompareAndSwapFor?.(ENTERPRISE_ONBOARDING_DRAFT_COLLECTION)
          ?? store.supportsAtomicCompareAndSwap?.() ?? false);
        if (!uniqueOwner) {
          res.status(503).json({ error: 'enterprise_onboarding_draft_atomicity_unavailable', message: '当前无法安全创建草稿，请稍后重试。' });
          return;
        }
        const created = await store.create<DraftRow>(ENTERPRISE_ONBOARDING_DRAFT_COLLECTION, {
          tenant_id: tenantId, user_id: userId, ...payload,
        });
        if (!created) throw new Error('enterprise_onboarding_draft_create_failed');
      }
      res.json({ draft, revision: draft.revision });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/unique|duplicate|constraint/iu.test(message)) {
        res.status(409).json({ error: 'enterprise_onboarding_draft_conflict', message: '新手引导已在另一个窗口更新，请刷新后继续。' });
        return;
      }
      res.status(503).json({ error: 'enterprise_onboarding_draft_unavailable', message: '新手引导草稿暂时无法保存。' });
    }
  });

  return router;
}
