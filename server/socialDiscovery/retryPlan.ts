import type { SocialInspirationCollectionRun } from '../../shared/contracts/socialContentWorkflow.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';

/** A plan is diagnostic evidence, NOT an execution permit or quota grant. */
export function planTerminalDiscoverySourceRetry(run: SocialInspirationCollectionRun) {
  const terminal = run.status === 'failed';
  const resultsExist = Object.values(run.modeStats ?? {}).some(stats => (stats?.fetched ?? 0) > 0 || (stats?.accepted ?? 0) > 0);
  const blockingCodes: string[] = [];
  if (!terminal) blockingCodes.push('discovery_retry_terminal_failure_required');
  if (resultsExist) blockingCodes.push('discovery_retry_existing_results_require_reconciliation');
  const eligibleSources = (run.failureDetails ?? []).filter(source =>
    // Require the provider's explicit pre-launch refusal marker, not just a
    // generic HTTP error, balance guess, run.status, or user-supplied code.
    /not-enough-usage-to-run-paid-actor/.test(source.error)
    && /HTTP\s*402\b/.test(source.error)
    && !/timed?\s*out|timeout|socket|connection reset|run [A-Za-z0-9_-]+ ended/i.test(source.error),
  ).map(source => ({ mode: source.mode, platform: source.platform, queryRef: source.queryRef }));
  const keys = new Set(eligibleSources.map(source => socialRequestHash(source)));
  const unresolvedSources = (run.failureDetails ?? []).filter(source => !keys.has(socialRequestHash({ mode: source.mode, platform: source.platform, queryRef: source.queryRef })))
    .map(source => ({ mode: source.mode, platform: source.platform, queryRef: source.queryRef, reason: 'provider_settlement_not_proven' }));
  if (!eligibleSources.length) blockingCodes.push('discovery_retry_definitive_rejection_required');
  return {
    schema: 'terminal-discovery-source-retry-plan.v1' as const,
    parentRunId: run.runId,
    parentRunHash: socialRequestHash(run),
    scopeId: run.discoveryScopeId,
    scopeVersion: run.discoveryScopeVersion,
    eligibleSources: blockingCodes.length ? [] : eligibleSources,
    unresolvedSources,
    blockingCodes,
    // A whole-run retry is forbidden while even one source lacks settlement.
    wholeRunRetryEligible: !blockingCodes.length && !unresolvedSources.length,
    requiresNewAttemptIdentity: true,
    retainsOriginalRunAndQuota: true,
    authorizesExecution: false,
    grantsAdditionalDailyQuota: false,
  };
}
