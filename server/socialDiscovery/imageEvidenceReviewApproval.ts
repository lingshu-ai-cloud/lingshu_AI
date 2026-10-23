import { createHash } from 'node:crypto';
import type { DataStore, Record_ } from '../storage/datastore.js';
import type { SocialTaskBudgetScope } from '../lib/socialContentTaskBudget.js';
import type { SocialPaidOperationIntent } from '../lib/socialContentTaskBudgetAuthority.js';
import { organizationRoleOrNull } from '../lib/organizationRole.js';
import { readWeeklyReviewActor } from '../socialPrograms/weeklyReviewActor.js';
import { imageEvidenceReviewPlanHash, type ImageEvidenceApprovedPlan } from '../agents/imageEvidencePaidContext.js';
import { imagePostSourceHash } from './imagePostReanalysis.js';
import { videoAnalysisOf } from '../lib/videoAnalysisCodec.js';

export const IMAGE_EVIDENCE_REVIEW_APPROVALS = 'social_image_evidence_review_approvals';
export const IMAGE_EVIDENCE_REVIEW_REVOCATIONS = 'social_image_evidence_review_revocations';
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = (reason: string): never => { throw Error(`image_evidence_review_approval_${reason}`); };

export interface ImageEvidenceReviewApproval {
  schema: 'image-evidence-review-approval.v1';
  approvalId: string;
  tenantId: string;
  recordId: string;
  recordSha256: string;
  plan: ImageEvidenceApprovedPlan;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
  recordHash: string;
}

export const imageEvidenceReviewApprovalId = (tenantId: string, recordId: string, recordSha256: string) =>
  sha(['image-evidence-review-approval.v1', tenantId, recordId, recordSha256]).slice(0, 15);
const revocationId = (id: string) => sha(['image-evidence-review-revocation.v1', id]).slice(0, 15);

async function assertActor(store: DataStore, tenantId: string, userId: string): Promise<void> {
  const actor = await readWeeklyReviewActor(store, tenantId, userId);
  if (!actor || actor.tenantId !== tenantId || !['admin', 'super_admin', 'social_operator']
    .includes(organizationRoleOrNull(actor.role) ?? '') || actor.active === false
    || actor.disabled === true || ['disabled', 'suspended'].includes(String(actor.status))) fail('actor_invalid');
}

async function assertSource(store: DataStore, tenantId: string, recordId: string, recordSha256: string): Promise<void> {
  const record = await store.getById<Record_>('trend_videos', recordId);
  const analysis = record ? videoAnalysisOf(record) : null;
  if (!record || record.tenantId !== tenantId || record.id !== recordId
    || (record.contentFormat !== 'image' && analysis?.contentFormat !== 'image')
    || ['queued', 'processing', 'unknown'].includes(String(analysis?.imageAnalysisQueueState || ''))
    || imagePostSourceHash(record) !== recordSha256) fail('source_changed');
}

function frozenPlan(input: { tenantId: string; recordId: string; recordSha256: string;
  maximumCny: number; intent: SocialPaidOperationIntent }): { id: string; plan: ImageEvidenceApprovedPlan } {
  const { tenantId, recordId, recordSha256, maximumCny, intent } = input;
  const id = imageEvidenceReviewApprovalId(tenantId, recordId, recordSha256);
  if (!tenantId.trim() || !recordId.trim() || !hex(recordSha256)
    || !Number.isFinite(maximumCny) || maximumCny <= 0 || maximumCny > 15
    || !Number.isSafeInteger(Math.round(maximumCny * 1_000_000))
    || Math.abs(Math.round(maximumCny * 1_000_000) / 1_000_000 - maximumCny) > 1e-9
    || intent.operationId !== `image-evidence-review:${id}` || intent.provider !== 'openai'
    || intent.stage !== 'image_post_evidence_review' || intent.shotId !== null
    || !intent.model?.trim() || !intent.accountRef?.trim() || !hex(intent.inputContractHash)
    || !Number.isSafeInteger(intent.maximumUnits?.inputTokens) || intent.maximumUnits.inputTokens < 1
    || !Number.isSafeInteger(intent.maximumUnits.outputTokens) || intent.maximumUnits.outputTokens !== 7000
    || Object.keys(intent.maximumUnits).some(key => !['inputTokens', 'outputTokens', 'requests'].includes(key))
    || (intent.maximumUnits.requests !== undefined && intent.maximumUnits.requests !== 1)
    || intent.correction) fail('plan_invalid');
  const scope: SocialTaskBudgetScope = { tenantId,
    taskId: `image-evidence:${recordId}:${recordSha256}`, runId: recordSha256,
    planHash: imageEvidenceReviewPlanHash({ tenantId, recordId, recordSha256,
      authorizationRef: id, maximumCny, intent }) };
  return { id, plan: { scope, recordId, recordSha256, authorizationRef: id,
    maximumCny, paidOperations: [structuredClone(intent)] } };
}

/** Human approval freezes one record and one exact GPT request; it is not a paid permit. */
export async function approveImageEvidenceReview(input: { store: DataStore; tenantId: string; recordId: string;
  recordSha256: string; maximumCny: number; intent: SocialPaidOperationIntent; approvedBy: string;
  expiresAt: string; now?: () => number }): Promise<ImageEvidenceReviewApproval> {
  const now = input.now?.() ?? Date.now();
  const { id, plan } = frozenPlan(input);
  if (!Number.isFinite(now) || !Number.isFinite(Date.parse(input.expiresAt))
    || Date.parse(input.expiresAt) <= now || Date.parse(input.expiresAt) > now + 86_400_000) fail('expiry_invalid');
  await assertActor(input.store, input.tenantId, input.approvedBy);
  await assertSource(input.store, input.tenantId, input.recordId, input.recordSha256);
  const item: ImageEvidenceReviewApproval = { schema: 'image-evidence-review-approval.v1', approvalId: id,
    tenantId: input.tenantId, recordId: input.recordId, recordSha256: input.recordSha256,
    plan, approvedBy: input.approvedBy, approvedAt: new Date(now).toISOString(),
    expiresAt: input.expiresAt, recordHash: '' };
  item.recordHash = sha({ ...item, recordHash: '' });
  if (!await input.store.create(IMAGE_EVIDENCE_REVIEW_APPROVALS, { id, tenant_id: item.tenantId,
    record_id: item.recordId, record_sha256: item.recordSha256, record_hash: item.recordHash,
    payload: item })) fail('write_unknown_or_duplicate');
  return item;
}

/** Every plan read revalidates the source, immutable approval and revocation. */
export async function readCurrentImageEvidenceReviewApproval(input: { store: DataStore;
  approval: ImageEvidenceReviewApproval; now?: number }): Promise<ImageEvidenceReviewApproval> {
  const expected = input.approval;
  const row = await input.store.getById<Record_>(IMAGE_EVIDENCE_REVIEW_APPROVALS, expected.approvalId);
  const item = row?.payload as ImageEvidenceReviewApproval | undefined;
  if (!row || !item) return fail('changed_or_expired');
  if (row.id !== expected.approvalId || row.tenant_id !== item.tenantId
    || row.record_id !== item.recordId || row.record_sha256 !== item.recordSha256
    || row.record_hash !== item.recordHash || item.recordHash !== sha({ ...item, recordHash: '' })
    || item.recordHash !== expected.recordHash || item.schema !== 'image-evidence-review-approval.v1'
    || item.approvalId !== imageEvidenceReviewApprovalId(item.tenantId, item.recordId, item.recordSha256)
    || !hex(item.recordSha256) || !item.plan || !Array.isArray(item.plan.paidOperations)
    || item.plan.paidOperations.length !== 1 || !item.plan.paidOperations[0]
    || !Number.isFinite(Date.parse(item.expiresAt))
    || Date.parse(item.expiresAt) <= (input.now ?? Date.now())) fail('changed_or_expired');
  const { plan } = frozenPlan({ tenantId: item.tenantId, recordId: item.recordId,
    recordSha256: item.recordSha256, maximumCny: item.plan.maximumCny,
    intent: item.plan.paidOperations[0]! });
  if (sha(plan) !== sha(item.plan)) fail('plan_changed');
  await assertSource(input.store, item.tenantId, item.recordId, item.recordSha256);
  if (await input.store.getById(IMAGE_EVIDENCE_REVIEW_REVOCATIONS, revocationId(item.approvalId))) fail('revoked');
  return item;
}

/** Adapter for the existing budget authority, not a second paid workflow. */
export function createImageEvidenceApprovalAssertions(input: { store: DataStore;
  approval: ImageEvidenceReviewApproval; now?: () => number }) {
  const current = () => readCurrentImageEvidenceReviewApproval({ store: input.store,
    approval: input.approval, now: input.now?.() });
  return {
    async readApprovedPlan(scope: SocialTaskBudgetScope): Promise<ImageEvidenceApprovedPlan> {
      const item = await current();
      if (sha(scope) !== sha(item.plan.scope)) fail('scope_changed');
      return structuredClone(item.plan);
    },
    async assertApproved({ scope, authorizationRef }: { scope: SocialTaskBudgetScope; authorizationRef: string }): Promise<void> {
      const item = await current();
      if (sha(scope) !== sha(item.plan.scope) || authorizationRef !== item.approvalId) fail('scope_changed');
    },
    async assertRecordCurrent({ tenantId, recordId, recordSha256 }: { tenantId: string; recordId: string; recordSha256: string }): Promise<void> {
      if (tenantId !== input.approval.tenantId || recordId !== input.approval.recordId
        || recordSha256 !== input.approval.recordSha256) fail('scope_changed');
      await current();
    },
  };
}

export async function revokeImageEvidenceReview(input: { store: DataStore;
  approval: ImageEvidenceReviewApproval; actorUserId: string; reason: string;
  now?: () => number }): Promise<void> {
  if (!input.reason.trim() || input.reason.length > 1000) fail('revocation_invalid');
  await assertActor(input.store, input.approval.tenantId, input.actorUserId);
  const current = await readCurrentImageEvidenceReviewApproval({ store: input.store,
    approval: input.approval, now: input.now?.() });
  const id = revocationId(current.approvalId);
  const item = { schema: 'image-evidence-review-revocation.v1', revocationId: id,
    approvalId: current.approvalId, approvalHash: current.recordHash, tenantId: current.tenantId,
    revokedBy: input.actorUserId, revokedAt: new Date(input.now?.() ?? Date.now()).toISOString(),
    reason: input.reason.trim() };
  if (!await input.store.create(IMAGE_EVIDENCE_REVIEW_REVOCATIONS, { id, tenant_id: item.tenantId,
    approval_id: item.approvalId, record_hash: sha(item), payload: item })) fail('revocation_write_unknown');
}
