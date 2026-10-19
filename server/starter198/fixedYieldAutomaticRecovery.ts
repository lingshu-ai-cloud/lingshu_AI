import { assertAndNormalizeFixedYieldProductionPlan, type FixedYieldProductionPlan } from '../../shared/contracts/fixedYieldProduction.js';
import { assertAndNormalizeFixedYieldRunState, type FixedYieldRunState } from '../../shared/fixedYieldRunState.js';

export interface FixedYieldDegradeRevisionCandidate {
  revisionId: string;
  revisionPlanHash: string;
  parentPlanHash: string;
  affectedShotIds: string[];
  strategy: 'heygen_stable_presenter' | 'heygen_presenter_with_local_product_shot';
  estimatedCostFen: number;
  hardConstraintsPassed: boolean;
  coreFunctionPreserved: boolean;
  providerChanged: boolean;
  splitShot: boolean;
  removedActions: string[];
}

export type FixedYieldAutomaticRecoveryDecision =
  | { action: 'continue'; affectedShotIds: []; evidenceRefs: [] }
  | { action: 'create_degrade_revision'; affectedShotIds: string[]; candidate: FixedYieldDegradeRevisionCandidate;
      remainingBudgetFen: number; evidenceRefs: string[] }
  | { action: 'needs_decision'; affectedShotIds: string[]; reason: 'no_valid_degrade_revision' | 'budget_exhausted';
      remainingBudgetFen: number; evidenceRefs: string[] };

const SHA256 = /^[a-f0-9]{64}$/;

function failedQualityShots(plan: FixedYieldProductionPlan, state: FixedYieldRunState) {
  return plan.operations.flatMap(operation => {
    if (operation.role !== 'shot_finalize' || !operation.shotId) return [];
    const runtime = state.operations[operation.operationId];
    if (runtime?.state !== 'failed_terminal' || runtime.failure?.code !== 'fixed_yield_no_accepted_shot_output') return [];
    const initialId = String(operation.request.initialQualityGateOperationId ?? '').trim();
    const repairId = String(operation.request.repairQualityGateOperationId ?? '').trim();
    const initial = initialId ? state.operations[initialId]?.qualityDecision : null;
    const repair = repairId ? state.operations[repairId]?.qualityDecision : null;
    if (initial?.core.verdict !== 'rejected') return [];
    const repairOperationId = String(operation.request.conditionalRepairOperationId ?? '').trim();
    const repairOperation = repairOperationId ? state.operations[repairOperationId] : null;
    // A configured repair branch must finish and be rejected before degradation.
    if (repairOperationId && (repairOperation?.state !== 'succeeded' || repair?.core.verdict !== 'rejected')) return [];
    return [{ shotId: operation.shotId, evidenceRefs: runtime.failure.evidenceRefs }];
  });
}

function normalizedCandidate(input: FixedYieldDegradeRevisionCandidate, plan: FixedYieldProductionPlan,
  affected: Set<string>): FixedYieldDegradeRevisionCandidate | null {
  const shotIds = [...new Set(input.affectedShotIds.map(value => String(value).trim()).filter(Boolean))].sort();
  if (!input.revisionId.trim() || !SHA256.test(input.revisionPlanHash) || input.parentPlanHash !== plan.planHash
    || !Number.isSafeInteger(input.estimatedCostFen) || input.estimatedCostFen < 0 || !shotIds.length
    || shotIds.some(shotId => !affected.has(shotId)) || !input.hardConstraintsPassed || !input.coreFunctionPreserved) return null;
  // A provider switch, split, or action deletion must be an explicit new revision;
  // this function never mutates the failed frozen plan in place.
  if (!(input.providerChanged || input.splitShot || input.removedActions.length)) return null;
  if (input.strategy === 'heygen_presenter_with_local_product_shot' && !input.splitShot) return null;
  return { ...structuredClone(input), affectedShotIds: shotIds,
    removedActions: [...new Set(input.removedActions.map(value => String(value).trim()).filter(Boolean))].sort() };
}

/** ADR-028 recovery gate over the existing frozen QA/run state and shared task
 * budget. It selects an already-compiled production revision; it does not
 * create another runtime, ledger, QA record, or supplier execution path. */
export function decideFixedYieldAutomaticRecovery(input: {
  plan: FixedYieldProductionPlan;
  state: FixedYieldRunState;
  budget: { limitCny: number; retainedCny: number; remainingCny: number };
  candidates: FixedYieldDegradeRevisionCandidate[];
}): FixedYieldAutomaticRecoveryDecision {
  const plan = assertAndNormalizeFixedYieldProductionPlan(input.plan);
  const state = assertAndNormalizeFixedYieldRunState(plan, input.state);
  const failures = failedQualityShots(plan, state);
  if (!failures.length) return { action: 'continue', affectedShotIds: [], evidenceRefs: [] };
  const affectedShotIds = failures.map(value => value.shotId).sort();
  const evidenceRefs = [...new Set(failures.flatMap(value => value.evidenceRefs))].sort();
  const limitFen = Math.round(input.budget.limitCny * 100);
  const retainedFen = Math.round(input.budget.retainedCny * 100);
  const reportedRemainingFen = Math.round(input.budget.remainingCny * 100);
  if (![limitFen, retainedFen, reportedRemainingFen].every(Number.isSafeInteger)
    || limitFen !== 1_000 || retainedFen < 0 || retainedFen > limitFen
    || reportedRemainingFen !== limitFen - retainedFen) throw new Error('fixed_yield_recovery_budget_invalid');
  const remainingBudgetFen = reportedRemainingFen;
  const affected = new Set(affectedShotIds);
  const valid = input.candidates.map(candidate => normalizedCandidate(candidate, plan, affected))
    .filter((candidate): candidate is FixedYieldDegradeRevisionCandidate => Boolean(candidate))
    .filter(candidate => candidate.estimatedCostFen <= remainingBudgetFen
      && candidate.affectedShotIds.length === affectedShotIds.length
      && candidate.affectedShotIds.every(shotId => affected.has(shotId)))
    .sort((left, right) => left.estimatedCostFen - right.estimatedCostFen
      || left.revisionPlanHash.localeCompare(right.revisionPlanHash));
  const candidate = valid[0];
  if (candidate) return { action: 'create_degrade_revision', affectedShotIds, candidate,
    remainingBudgetFen, evidenceRefs };
  return { action: 'needs_decision', affectedShotIds,
    reason: remainingBudgetFen === 0 ? 'budget_exhausted' : 'no_valid_degrade_revision',
    remainingBudgetFen, evidenceRefs };
}
