import type { SocialExecutionPlanReviewReason } from '../../shared/contracts/socialContentAgentContract.js';

const SAFETY_BLOCKERS = new Set<SocialExecutionPlanReviewReason>([
  'facts_missing',
  'rights_missing',
]);

function enabled(value: string | undefined): boolean | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

/**
 * Lets a local operator exercise every content-production node without first
 * satisfying product/theme/budget/quality convenience gates. Production is
 * always fail-closed, even if the environment variable is accidentally set.
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
  return socialContentTestBypassEnabled(input.environment);
}
