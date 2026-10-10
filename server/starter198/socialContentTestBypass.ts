import type { SocialExecutionPlanReviewReason } from '../../shared/contracts/socialContentAgentContract.js';

const SAFETY_BLOCKERS = new Set<SocialExecutionPlanReviewReason>([
  'facts_missing',
  'rights_missing',
]);

const DEMO_BYPASSABLE_BLOCKERS = new Set<SocialExecutionPlanReviewReason>([
  'budget_exceeded',
]);

function enabled(value: string | undefined): boolean | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

/**
 * Lets a local operator ignore only the budget ceiling during a walkthrough.
 * Product facts, rights, capability, duration and generation quality stay
 * fail-closed, and the production environment never enables the bypass.
 *
 * Local development defaults to enabled for the current test workflow. Set
 * CONTENT_CREATION_TEST_BYPASS=false to restore normal local admission.
 * Tests stay deterministic unless they explicitly opt in.
 */
export function socialContentTestBypassEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (environment.NODE_ENV === 'production') return false;
  const configured = enabled(environment.CONTENT_CREATION_TEST_BYPASS);
  if (configured !== null) return configured;
  return environment.NODE_ENV !== 'test';
}

export function socialContentHasSafetyBlocker(
  reasonCodes: readonly SocialExecutionPlanReviewReason[] | null | undefined,
): boolean {
  return Boolean(reasonCodes?.some(reason => SAFETY_BLOCKERS.has(reason)));
}

export function socialContentReviewAdmissionAllowed(input: {
  approved: boolean;
  reasonCodes?: readonly SocialExecutionPlanReviewReason[] | null;
  environment?: NodeJS.ProcessEnv;
}): boolean {
  if (input.approved) return true;
  const reasons = input.reasonCodes || [];
  return socialContentTestBypassEnabled(input.environment)
    && reasons.length > 0
    && reasons.every(reason => DEMO_BYPASSABLE_BLOCKERS.has(reason));
}
