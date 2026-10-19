import type { SocialTaskBudgetScope } from '../lib/socialContentTaskBudget.js';
import { STARTER_COLLECTIONS, type Starter198Repository } from './repository.js';
import { assertSocialContentSubjectLease, withSocialContentSubjectLease } from './socialContentMutation.js';
import { readSocialProductFootageRevisionHandoffGuard } from './socialContentProductFootageRevisionHandoff.js';
import { readSocialProductFootageRevisionPaidPreflight,
  type SocialProductFootageRevisionCanonicalPlan } from './socialContentProductFootageRevisionPaidPreflight.js';
import { socialJson, socialObject, socialRequestHash, SocialContentWorkflowError } from './socialContentValidation.js';

type PreflightInput = Parameters<typeof readSocialProductFootageRevisionPaidPreflight>[0];
type Freeze = { schemaVersion: 'social-product-footage-revision-paid-plan-freeze.v1';
  tenantId: string; taskId: string; runId: string; guardHash: string; planHash: string;
  operationIds: string[]; retainedCny: number; remainingCny: number;
  canonicalPlan: SocialProductFootageRevisionCanonicalPlan; recordHash: string };
const fail = (reason: string): never => {
  throw new SocialContentWorkflowError(`product_footage_revision_paid_plan_${reason}`, 409);
};

/** Durable, non-executable handoff between budget reservation and a future
 * worker admission. It records the exact paid intent, not a provider permit. */
export async function freezeSocialProductFootageRevisionPaidPlan(input: PreflightInput): Promise<{
  recordHash: string; repeated: boolean; authorizesQueue: false; authorizesProvider: false;
  authorizesProduction: false }> {
  const { repository, guard } = input;
  const store = repository.dataStore;
  if (!store?.compareAndSwap || !await store.supportsAtomicCompareAndSwap?.()
    || guard.repository !== repository || guard.prepared.repository !== repository
    || guard.prepared.store !== store) return fail('atomic_store_required');
  const compareAndSwap = store.compareAndSwap.bind(store);
  return withSocialContentSubjectLease({ repository, tenantId: guard.prepared.tenantId,
    subjectId: guard.prepared.taskId, action: async () => {
      const preflight = await readSocialProductFootageRevisionPaidPreflight(input);
      const plan = await input.readCanonicalPlan(preflight.scope);
      if (socialRequestHash(plan) !== preflight.canonicalPlanHash) return fail('plan_changed');
      const body = { schemaVersion: 'social-product-footage-revision-paid-plan-freeze.v1' as const,
        tenantId: preflight.scope.tenantId, taskId: preflight.scope.taskId,
        runId: preflight.scope.runId, guardHash: preflight.guardHash,
        planHash: preflight.canonicalPlanHash, operationIds: preflight.operationIds,
        retainedCny: preflight.retainedCny, remainingCny: preflight.remainingCny,
        canonicalPlan: plan };
      const frozen: Freeze = { ...body, recordHash: socialRequestHash(body) };
      const run = await repository.get(STARTER_COLLECTIONS.runs, guard.prepared.tenantId, guard.revisionRunId);
      const context = socialObject(socialJson(run?.starter_context));
      if (!run || run.status !== 'waiting_external' || !context
        || socialObject(context.paidGuard)?.recordHash !== preflight.guardHash)
        return fail('run_changed');
      const prior = socialObject(context.paidPlanFreeze);
      if (prior && socialRequestHash(prior) !== socialRequestHash(frozen)) return fail('freeze_conflict');
      if (!prior) {
        await assertSocialContentSubjectLease({ repository, tenantId: guard.prepared.tenantId,
          subjectId: guard.prepared.taskId });
        if (!await compareAndSwap(STARTER_COLLECTIONS.runs, run.id,
          { tenant_id: guard.prepared.tenantId, status: run.status, starter_context: run.starter_context },
          { starter_context: { ...context, paidPlanFreeze: frozen } })) return fail('cas_conflict');
      }
      const verified = await readSocialProductFootageRevisionPaidPlanFreeze(input);
      if (verified.recordHash !== frozen.recordHash) return fail('readback_changed');
      return { recordHash: frozen.recordHash, repeated: !!prior, authorizesQueue: false,
        authorizesProvider: false, authorizesProduction: false };
    } });
}

/** A stored plan is never self-authorizing: caller must independently reread
 * the current canonical plan and all rights, bytes, approvals and ledger. */
export async function readSocialProductFootageRevisionPaidPlanFreeze(input: PreflightInput): Promise<{
  recordHash: string; scope: SocialTaskBudgetScope; canonicalPlan: SocialProductFootageRevisionCanonicalPlan;
  authorizesQueue: false; authorizesProvider: false; authorizesProduction: false }> {
  const { repository, guard } = input;
  const run = await repository.get(STARTER_COLLECTIONS.runs, guard.prepared.tenantId, guard.revisionRunId);
  const context = socialObject(socialJson(run?.starter_context));
  const frozen = socialObject(context?.paidPlanFreeze) as Freeze | null;
  if (!frozen || frozen.schemaVersion !== 'social-product-footage-revision-paid-plan-freeze.v1'
    || frozen.tenantId !== guard.prepared.tenantId || frozen.taskId !== guard.prepared.taskId
    || frozen.runId !== guard.revisionRunId || !frozen.canonicalPlan) return fail('missing');
  const { recordHash, ...body } = frozen;
  if (socialRequestHash(body) !== recordHash || socialRequestHash(frozen.canonicalPlan) !== frozen.planHash)
    return fail('corrupt');
  const preflight = await readSocialProductFootageRevisionPaidPreflight(input);
  if (preflight.guardHash !== frozen.guardHash || preflight.canonicalPlanHash !== frozen.planHash
    || socialRequestHash(preflight.operationIds) !== socialRequestHash(frozen.operationIds)
    || preflight.retainedCny !== frozen.retainedCny || preflight.remainingCny !== frozen.remainingCny)
    return fail('authority_changed');
  const finalGuard = await readSocialProductFootageRevisionHandoffGuard(guard);
  if (finalGuard.guard.recordHash !== frozen.guardHash) return fail('guard_changed');
  return { recordHash, scope: preflight.scope, canonicalPlan: frozen.canonicalPlan,
    authorizesQueue: false, authorizesProvider: false, authorizesProduction: false };
}
