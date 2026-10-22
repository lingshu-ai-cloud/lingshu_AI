import { createHash } from 'node:crypto';
import type { SocialTaskBudgetScope } from '../lib/socialContentTaskBudget.js';
import { createSocialContentTaskBudgetAuthority, type SocialApprovedBudgetPlan, type SocialPaidOperationIntent, type SocialVerifiedAccountTariff } from '../lib/socialContentTaskBudgetAuthority.js';
import { createSocialContentPaidOperationPermit } from '../lib/socialContentPaidOperationPermit.js';
import type { OpenAiImageEvidencePaidCall } from './openaiImageEvidence.js';
import { createImageEvidenceReceiptStore } from './imageEvidenceReceiptStore.js';

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest = (value: string) => /^[a-f0-9]{64}$/.test(value);

export interface ImageEvidenceApprovedPlan extends SocialApprovedBudgetPlan {
  recordId: string;
  recordSha256: string;
}

export function imageEvidenceReviewPlanHash(input: {
  tenantId: string; recordId: string; recordSha256: string; authorizationRef: string;
  maximumCny: number; intent: SocialPaidOperationIntent;
}): string {
  return sha(input);
}

export interface ImageEvidencePaidContextPorts {
  /** Must read an already durable, explicitly approved plan, not request JSON. */
  readApprovedPlan(scope: SocialTaskBudgetScope): Promise<ImageEvidenceApprovedPlan>;
  /** Re-read the tenant-owned record and compare its frozen source snapshot. */
  assertRecordCurrent(input: { tenantId: string; recordId: string; recordSha256: string }): Promise<void>;
  /** Re-check the durable human/budget authorization, never an HTTP body flag. */
  assertApproved(input: { scope: SocialTaskBudgetScope; authorizationRef: string }): Promise<void>;
  assertProviderBinding(input: { intent: SocialPaidOperationIntent; baseUrl: string; credentialSha256: string }): Promise<void>;
  readVerifiedTariff(intent: SocialPaidOperationIntent): Promise<SocialVerifiedAccountTariff | null>;
  measureInputTokens: OpenAiImageEvidencePaidCall['measureInputTokens'];
  /** Deployment must prove every web/worker instance uses this same durable volume. */
  assertSharedVolume(): Promise<void>;
}

/** Reuses the existing all-stage tariff, reservation and one-shot permit machinery. */
export async function reserveImageEvidencePaidCall(input: {
  scope: SocialTaskBudgetScope;
  recordId: string;
  recordSha256: string;
  requestSha256: string;
  ledgerRoot: string;
  permitRoot: string;
  receiptRoot: string;
  ports: ImageEvidencePaidContextPorts;
}): Promise<OpenAiImageEvidencePaidCall & { recoverReceipt(): Promise<{ status: string; response: { status: number; body: string } | null }> }> {
  const { scope, ports } = input;
  if (!input.recordId.trim() || !digest(input.recordSha256) || !digest(input.requestSha256)
    || scope.taskId !== `image-evidence:${input.recordId}:${input.recordSha256}` || scope.runId !== input.recordSha256
    || !digest(scope.planHash) || !input.ledgerRoot || !input.permitRoot || !input.receiptRoot) {
    throw Error('image_evidence_paid_scope_invalid');
  }
  await ports.assertSharedVolume();
  const readPlan = async (): Promise<ImageEvidenceApprovedPlan> => {
    const plan = await ports.readApprovedPlan(scope);
    if (!plan || !plan.scope || !Array.isArray(plan.paidOperations)) throw Error('image_evidence_paid_plan_invalid');
    const intent = plan.paidOperations?.[0];
    if (plan.recordId !== input.recordId || plan.recordSha256 !== input.recordSha256
      || plan.scope.tenantId !== scope.tenantId || plan.scope.taskId !== scope.taskId
      || plan.scope.runId !== scope.runId || plan.scope.planHash !== scope.planHash
      || !plan.authorizationRef?.trim() || !Number.isFinite(plan.maximumCny)
      || plan.maximumCny <= 0 || plan.maximumCny > 15 || plan.paidOperations?.length !== 1
      || !intent || intent.provider !== 'openai' || intent.stage !== 'image_post_evidence_review'
      || intent.shotId !== null || intent.inputContractHash !== input.requestSha256
      || scope.planHash !== imageEvidenceReviewPlanHash({ tenantId: scope.tenantId, recordId: input.recordId,
        recordSha256: input.recordSha256, authorizationRef: plan.authorizationRef,
        maximumCny: plan.maximumCny, intent })) {
      throw Error('image_evidence_paid_plan_invalid');
    }
    return plan;
  };
  const assertCurrent = async (candidate: SocialTaskBudgetScope) => {
    if (sha(candidate) !== sha(scope)) throw Error('image_evidence_paid_scope_changed');
    const plan = await readPlan();
    await ports.assertRecordCurrent({ tenantId: scope.tenantId, recordId: input.recordId, recordSha256: input.recordSha256 });
    await ports.assertApproved({ scope, authorizationRef: plan.authorizationRef });
  };
  const authority = createSocialContentTaskBudgetAuthority({ ledgerRoot: input.ledgerRoot, ports: {
    readApprovedPlan: readPlan,
    assertCurrent,
    readVerifiedTariff: ports.readVerifiedTariff,
    verifyRejection: async () => false,
  } });
  const reserved = await authority.prepareAndReserve(scope);
  const intent = reserved.intents[0]!;
  const permit = createSocialContentPaidOperationPermit({ ...reserved, root: input.permitRoot, assertCurrent,
    assertNewSubmit: assertCurrent });
  const receipts = createImageEvidenceReceiptStore({ root: input.receiptRoot, scope, operationId: intent.operationId,
    requestSha256: input.requestSha256 });
  return { intent, permit, measureInputTokens: ports.measureInputTokens,
    assertProviderBinding: async actual => {
      if (actual.model !== intent.model || actual.accountRef !== intent.accountRef) throw Error('image_evidence_paid_account_changed');
      await ports.assertProviderBinding({ intent, baseUrl: actual.baseUrl, credentialSha256: actual.credentialSha256 });
    },
    persistProviderReceipt: async receipt => {
      if (receipt.requestSha256 !== input.requestSha256) throw Error('image_evidence_paid_receipt_binding_invalid');
      // A source record may change while the provider is in flight. Preserve
      // the response regardless; settlement can remain unknown for reconciliation.
      return receipts.persist(receipt);
    },
    async recoverReceipt() {
      const checkpoint = await permit.assertRecovery(intent.operationId);
      const ref = checkpoint.receiptRef;
      return { status: checkpoint.status,
        response: typeof ref === 'string' && ref.startsWith('image-evidence-receipt:') ? receipts.read(ref) : null };
    } };
}
