import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('server/routes/digitalEmployees.ts', 'utf8');
const routeStart = "digitalEmployeesRouter.post('/goals/:goalId/rebuild-from-latest-facts'";
const begin = source.indexOf(routeStart);
assert.notEqual(begin, -1, 'missing latest-enterprise-facts goal rebuild route');
const next = source.indexOf('\ndigitalEmployeesRouter.', begin + routeStart.length);
const route = source.slice(begin, next === -1 ? source.length : next);

assert.match(route, /req\.body\?\.requestId/, 'fact rebuilds must require a caller idempotency key');
assert.match(route, /req\.body\?\.expectedGoalVersion/, 'fact rebuilds must be bound to the draft version the caller observed');
assert.match(route, /req\.body\?\.sourcePlanId/, 'fact rebuilds must be bound to the source plan the caller observed');
assert.match(route, /req\.body\?\.expectedSourcePlanDigest/, 'fact rebuilds must be bound to the exact source plan payload the caller observed');
assert.match(route, /isDigitalEmployeeOperatingGoal\(source\)/, 'non-operating lineage goals must not enter the rebuild flow');
assert.match(route, /source\.status !== 'draft'/, 'only a draft may enter a new fact rebuild');
assert.match(route, /sourcePlan\.status !== 'draft'/, 'only a draft plan may enter a new fact rebuild');
assert.match(route, /first<RunRecord>\(COLLECTION\.runs/, 'a draft with any run history must never be rebuilt automatically');
assert.match(route, /fromFactsVersion === toFactsVersion/, 'a current draft must not be replaced unnecessarily');
assert.match(route, /withLocalQueue\(goalApprovalQueues, `\$\{tenantId\}:activate`/, 'rebuilds must serialize with goal activation in this process');
assert.match(route, /supportsAtomicOperationLease/, 'rebuilds may optimize contention only when the store confirms atomic lease support');
assert.match(route, /acquireDurableOperationLease/, 'supported stores must serialize rebuild generation with a cross-instance lease');
assert.match(route, /assertDurableOperationLease/, 'only the current fact-rebuild lease may persist a replacement');
assert.match(route, /releaseDurableOperationLease/, 'fact-rebuild leases must always be released');
assert.match(route, /weeklyGoalFactRebuildRecordId\('goal'/, 'replacement goals need a deterministic recovery identity');
assert.match(route, /weeklyGoalFactRebuildRecordId\('plan'/, 'replacement plans need a deterministic recovery identity');
assert.match(route, /weeklyGoalFactRebuildRecordId\('goal',[^\n]+resolved\.configVersion, resolved\.policyVersion, suppliedSourcePlanDigest\)/, 'goal identity must include source plan, configuration, and policy versions');
assert.match(route, /weeklyGoalFactRebuildRecordId\('plan',[^\n]+resolved\.configVersion, resolved\.policyVersion, suppliedSourcePlanDigest\)/, 'plan identity must include source plan, configuration, and policy versions');
assert.match(route, /recommendPackageWithTenantEvidence/, 'the replacement package must be regenerated from tenant evidence');
assert.match(route, /configurationSnapshot\(resolved\)/, 'the replacement plan must freeze the latest verified facts and policy snapshot');
assert.match(route, /commitWeeklyGoalFactRebuildReplacement/, 'old-draft cancellation must use the atomic persistence service');
assert.match(route, /const finalResolved = await resolveCurrentConfiguration/, 'the route must reread canonical configuration immediately before commit');
assert.match(route, /weeklyGoalFactRebuildSnapshotMatches/, 'the precommit fence must reject changed facts, configuration, or policy');
assert.match(route, /finalResolved\.knowledgeBinding\.factsVersion !== rebuildIdentity\.toFactsVersion[\s\S]*error:\s*'enterprise_facts_changed'[\s\S]*weeklyGoalFactRebuildRecovery\(source, sourcePlan, fromFactsVersion, finalResolved\.knowledgeBinding\.factsVersion\)/, 'a final facts-only fence failure must return a complete retry token');
assert.match(route, /validateAfterSourcePlanFence:\s*async \(\) => \{[\s\S]*resolveCurrentConfiguration[\s\S]*enterprise_facts_changed/, 'canonical facts must be revalidated after the durable source-plan fence and before source cancellation');
assert.match(route, /error\.code === 'enterprise_facts_changed'[\s\S]*weeklyGoalFactRebuildRecovery\(source!, sourcePlan!, fromFactsVersion, postFenceFactsVersion\)/, 'a post-fence facts change must return the complete retry token');
assert.doesNotMatch(route, /error instanceof Error \? error\.message/, 'unexpected provider or database exception details must not reach clients');
assert.ok(
  route.indexOf("store.create<PlanRecord>(COLLECTION.plans") < route.lastIndexOf('commitWeeklyGoalFactRebuildReplacement'),
  'the complete replacement goal and plan must exist before the old draft is cancelled',
);
assert.match(route, /ensureWeeklyGoalFactRebuildAudit/, 'automatic rebuilds must retain a durable audit trail');
assert.match(route, /res\.json\(await buildOverview\(tenantId, targetGoalId\)\)/, 'a successful rebuild must return the canonical DigitalEmployeeOverview');
assert.doesNotMatch(route, /approveGoalForReview|ensureReviewRunTasks|advanceRun\(/, 'rebuilding a draft must not start work or replay an old operation');

assert.match(source, /function weeklyGoalFactRebuildRecovery[\s\S]*expectedSourcePlanDigest:\s*weeklyGoalFactRebuildSourcePlanDigest\(plan\)/, 'stale-facts conflicts must issue a source-plan-bound recovery token');
const staleFactResponses = [...source.matchAll(/error:\s*'enterprise_facts_changed'/g)];
assert.ok(staleFactResponses.length >= 4, 'all stale-facts API paths must remain discoverable by the client');
for (const response of staleFactResponses) {
  assert.match(
    source.slice(response.index, response.index + 520),
    /weeklyGoalFactRebuildRecovery\(/,
    'every enterprise_facts_changed response must include the complete source goal and plan recovery token',
  );
}
const approvalStart = source.indexOf('export async function approveGoalForReview');
const approvalEnd = source.indexOf("digitalEmployeesRouter.post('/goals/:goalId/approve'", approvalStart);
assert.notEqual(approvalStart, -1);
assert.notEqual(approvalEnd, -1);
assert.match(source.slice(approvalStart, approvalEnd), /weeklyGoalFactRebuildTargetCommitted/, 'a partially written replacement must not be activated before its source is durably cancelled');
assert.match(source, /async function committedDigitalEmployeeOperatingGoals[\s\S]*weeklyGoalFactRebuildTargetCommitted/, 'overview and assistant goal selection must isolate uncommitted replacement targets');
assert.match(source, /const operatingGoals = await committedDigitalEmployeeOperatingGoals\(tenantId, goalResult\.items\)/, 'overview must not select an uncommitted replacement as the current plan');
assert.match(source, /const goals = await committedDigitalEmployeeOperatingGoals\(tenantId, goalResult\.items\)/, 'assistant feeds must not expose uncommitted replacement targets');
assert.match(source, /store\.compareAndSwap\?\.\(COLLECTION\.plans, existingPlan\.id[\s\S]*status: 'approved'/, 'approval must win the exact source-plan CAS before activating a goal');
assert.ok(
  source.slice(approvalStart, approvalEnd).indexOf("store.compareAndSwap?.(COLLECTION.plans")
    < source.slice(approvalStart, approvalEnd).indexOf("store.compareAndSwap?.(COLLECTION.goals"),
  'approval must claim the plan before changing goal status or creating a run',
);

const packageDetailsStart = source.indexOf("digitalEmployeesRouter.post('/goals/:goalId/package/details'");
const packageSaveStart = source.indexOf("digitalEmployeesRouter.put('/goals/:goalId/package'");
assert.match(source.slice(packageDetailsStart, packageSaveStart), /compareAndSwap\(COLLECTION\.plans/, 'detail generation must exact-CAS every draft plan write');
assert.match(source.slice(packageSaveStart, begin), /compareAndSwap\(COLLECTION\.plans/, 'package saves must exact-CAS the observed draft plan');
assert.match(source, /hasWeeklyGoalFactRebuildPlanFence/, 'draft writers must reject a durable rebuild fence');

console.log('latest enterprise facts goal rebuild route contract tests passed');
