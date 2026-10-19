import {
  assertAndNormalizeFixedYieldProductionPlan,
  type FixedYieldProductionPlan,
} from '../../shared/contracts/fixedYieldProduction.js';
import type { SocialContentTaskBudget, SocialTaskBudgetOperation, SocialTaskBudgetScope } from '../lib/socialContentTaskBudget.js';

export interface FixedYieldBudgetAuthorization {
  schemaVersion: 'fixed-yield-budget-authorization.v2';
  tenantId: string;
  taskId: string;
  runId: string;
  planHash: string;
  coreHash: string;
  maximumCostFen: number;
  strategy: 'complete' | 'reduced';
  authorizedBy: string;
  authorizedAt: string;
}

export interface FixedYieldProviderAccountBinding {
  provider: string;
  accountRef: string;
}

function fail(code: string): never {
  throw new Error(`fixed_yield_budget_${code}`);
}

export function assertFixedYieldBudgetAuthorization(input: {
  plan: FixedYieldProductionPlan;
  taskId: string;
  authorization: FixedYieldBudgetAuthorization;
}): FixedYieldProductionPlan {
  const plan = assertAndNormalizeFixedYieldProductionPlan(input.plan);
  const { authorization } = input;
  if (authorization.schemaVersion !== 'fixed-yield-budget-authorization.v2'
    || authorization.tenantId !== plan.core.tenantId || authorization.taskId !== input.taskId
    || authorization.runId !== plan.runId || authorization.planHash !== plan.planHash
    || authorization.coreHash !== plan.coreHash || !authorization.authorizedBy.trim()
    || !Number.isFinite(Date.parse(authorization.authorizedAt))) fail('authorization_scope_invalid');
  if (!Number.isSafeInteger(authorization.maximumCostFen) || authorization.maximumCostFen < plan.core.totalReservedCostFen) {
    fail('authorization_insufficient');
  }
  if (authorization.strategy === 'reduced' && authorization.maximumCostFen !== plan.core.totalReservedCostFen) {
    fail('reduced_plan_not_recompiled');
  }
  return plan;
}

export function fixedYieldPaidBudgetOperations(input: {
  plan: FixedYieldProductionPlan;
  providerAccounts: FixedYieldProviderAccountBinding[];
}): SocialTaskBudgetOperation[] {
  const plan = assertAndNormalizeFixedYieldProductionPlan(input.plan);
  const accountByProvider = new Map(input.providerAccounts.map(binding => [binding.provider, binding.accountRef]));
  return plan.operations.filter(operation => operation.executionKind === 'provider').map(operation => {
    const provider = operation.provider || fail('provider_missing');
    const accountRef = accountByProvider.get(provider);
    if (!accountRef) fail(`provider_account_missing:${provider}`);
    return {
      operationId: operation.idempotencyKey,
      fingerprint: operation.operationIdentityHash,
      provider,
      model: operation.executor,
      accountRef,
      stage: operation.role,
      shotId: operation.shotId,
    };
  });
}

/** Reserves every possible paid branch immediately after user confirmation.
 * Execution later consumes this reservation and never asks for a larger budget. */
export async function authorizeFixedYieldPlanBeforeExecution(input: {
  plan: FixedYieldProductionPlan;
  taskId: string;
  authorization: FixedYieldBudgetAuthorization;
  providerAccounts: FixedYieldProviderAccountBinding[];
  ledger: Pick<SocialContentTaskBudget, 'reserveBatch' | 'status'>;
}): Promise<{ scope: SocialTaskBudgetScope; paidOperationCount: number; status: ReturnType<SocialContentTaskBudget['status']> }> {
  const plan = assertFixedYieldBudgetAuthorization(input);
  const scope: SocialTaskBudgetScope = {
    tenantId: plan.core.tenantId, taskId: input.taskId, runId: plan.runId, planHash: plan.planHash,
  };
  const operations = fixedYieldPaidBudgetOperations({ plan, providerAccounts: input.providerAccounts });
  if (operations.length) await input.ledger.reserveBatch(scope, operations);
  return { scope, paidOperationCount: operations.length, status: input.ledger.status(scope) };
}
