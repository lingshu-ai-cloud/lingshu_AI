/** Standalone acceptance contract. Not connected to production routes or billing.
 * Records supplied here must come from a trusted store, never request-body claims.
 */
export type MvpScope = { tenantId: string; accountId: string; productId: string; taskId: string; runId: string; version: string };
export type MvpAction = 'generate_a' | 'generate_b' | 'publish' | 'production_change' | 'human_quality_review';
export type MvpAuthorization = {
  scope: MvpScope; action: MvpAction; actorId: string; source: 'human' | 'agent';
  sourceRef: string; expiresAt: string; revoked: boolean;
};
export type MvpBudgetEntry = {
  scope: MvpScope; allocation: 'A' | 'B'; requestId: string;
  reservedCny: number; actualCny: number | null;
};
export type MvpBoundaryInput = {
  scope: MvpScope; inputScopes: MvpScope[]; action: MvpAction;
  authorizations: MvpAuthorization[]; now: string;
  operation: 'new' | 'recover'; outcome: 'none' | 'unknown' | 'completed';
  originalTaskId?: string;
  budget?: { allocation: 'A' | 'B'; currency: 'CNY'; limitCny: number; entries: MvpBudgetEntry[]; nextReservationCny: number; pricingSourceRef: string };
  brandRequirementChanged?: boolean;
  supplier?: string; model?: string;
};
export type MvpBoundaryDecision = { allowed: boolean; reason: string; owner: 'agent' | 'business' | 'administrator'; requiresCustomerApproval: boolean };
const scopeKeys = ['tenantId', 'accountId', 'productId', 'taskId', 'runId', 'version'] as const;
const sameScope = (a: MvpScope, b: MvpScope) => scopeKeys.every(key => a[key] === b[key]);
// Retries and input revisions share one allocation across versions and request IDs.
const sameBudgetScope = (a: MvpScope, b: MvpScope) => scopeKeys.filter(key => key !== 'version').every(key => a[key] === b[key]);
const money = (value: number) => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 1e6));
const units = (value: number) => Math.round(value * 1e6);

export function decideMvpBoundary(input: MvpBoundaryInput): MvpBoundaryDecision {
  const reject = (reason: string, owner: MvpBoundaryDecision['owner'], requiresCustomerApproval = false): MvpBoundaryDecision => ({ allowed: false, reason, owner, requiresCustomerApproval });
  if (scopeKeys.some(key => !input.scope[key]?.trim()) || !input.inputScopes.length || input.inputScopes.some(scope => !sameScope(input.scope, scope))) return reject('scope_conflict', 'business');
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) return reject('invalid_clock', 'administrator');
  const authorized = input.authorizations.some(grant => sameScope(grant.scope, input.scope) && grant.action === input.action
    && grant.source === 'human' && grant.actorId.trim() && grant.sourceRef.trim() && !grant.revoked
    && Number.isFinite(Date.parse(grant.expiresAt)) && Date.parse(grant.expiresAt) > now);
  if (!authorized) return reject('missing_valid_human_authorization', input.action === 'production_change' ? 'administrator' : 'business', true);
  if (input.brandRequirementChanged) return reject('explicit_brand_requirement_changed', 'business', true);
  if (input.outcome === 'unknown' && input.operation !== 'recover') return reject('unknown_original_task_only', 'administrator');
  if (input.outcome === 'completed' && input.operation === 'new') return reject('passed_task_must_not_regenerate', 'agent');
  if (input.operation === 'recover' && !input.originalTaskId?.trim()) return reject('unknown_task_id_requires_reconciliation', 'administrator');
  if (input.action === 'generate_a' || input.action === 'generate_b') {
    const budget = input.budget;
    const allocation = input.action === 'generate_a' ? 'A' : 'B';
    if (!budget || budget.allocation !== allocation || budget.currency !== 'CNY') return reject('wrong_budget_allocation', 'administrator');
    if (!money(budget.limitCny) || !money(budget.nextReservationCny) || !budget.pricingSourceRef.trim()
      || budget.entries.some(entry => !money(entry.reservedCny) || (entry.actualCny !== null && !money(entry.actualCny)))) return reject('unverified_budget_or_price', 'administrator');
    if (allocation === 'A' && budget.limitCny > 5) return reject('a_budget_exceeds_customer_five_cny', 'business', true);
    const used = budget.entries.filter(entry => entry.allocation === allocation && sameBudgetScope(entry.scope, input.scope))
      .reduce((sum, entry) => sum + Math.max(units(entry.reservedCny), entry.actualCny === null ? 0 : units(entry.actualCny)), 0);
    if (!Number.isSafeInteger(used)) return reject('invalid_budget_total', 'administrator');
    if (input.operation === 'recover' && budget.nextReservationCny !== 0) return reject('recovery_must_not_reserve_again', 'administrator');
    if (used + units(budget.nextReservationCny) > units(budget.limitCny)) return reject('cumulative_budget_exceeded', 'business', true);
  }
  return { allowed: true, reason: 'within_authorized_scope', owner: 'agent', requiresCustomerApproval: false };
}
