import assert from 'node:assert/strict';
import fs from 'node:fs';

const routeSource = fs.readFileSync('server/routes/digitalEmployees.ts', 'utf8');
const domainSource = fs.readFileSync('server/digitalEmployees/assistantDecisionCenter.ts', 'utf8');

function routeBlock(start: string): string {
  const begin = routeSource.indexOf(start);
  assert.notEqual(begin, -1, `missing route: ${start}`);
  const next = routeSource.indexOf('\ndigitalEmployeesRouter.', begin + start.length);
  return routeSource.slice(begin, next === -1 ? routeSource.length : next);
}

const authIndex = routeSource.indexOf('digitalEmployeesRouter.use(requireAuth)');
const tenantReadOnlyIndex = routeSource.indexOf('digitalEmployeesRouter.use(enforceSupportSessionReadOnly)');
const getIndex = routeSource.indexOf("digitalEmployeesRouter.get('/assistant/decision-center'");
const postIndex = routeSource.indexOf("digitalEmployeesRouter.post('/assistant/decision-center/:decisionId/actions'");
assert.ok(authIndex >= 0 && tenantReadOnlyIndex > authIndex, 'decision routes must inherit auth and support-session write protection');
assert.ok(getIndex > tenantReadOnlyIndex && postIndex > tenantReadOnlyIndex, 'GET and POST must be registered after router security middleware');

const feedLoaderStart = routeSource.indexOf('async function buildDigitalEmployeeAssistantFeed');
const feedLoaderEnd = routeSource.indexOf('async function buildStarterAssistantCards', feedLoaderStart);
assert.ok(feedLoaderStart >= 0 && feedLoaderEnd > feedLoaderStart, 'missing decision feed loader');
const feedLoader = routeSource.slice(feedLoaderStart, feedLoaderEnd);
assert.match(feedLoader, /where:\s*\{\s*tenant_id:\s*tenantId\s*\}/, 'goals must be tenant scoped');
assert.match(feedLoader, /first<PlanRecord>\([^\n]+tenant_id:\s*tenantId/, 'plans must be tenant scoped');
assert.match(feedLoader, /first<RunRecord>\([^\n]+tenant_id:\s*tenantId/, 'runs must be tenant scoped');
assert.match(feedLoader, /tenant_id:\s*tenantId,\s*run_id:\s*run\.id/, 'tasks and approvals must be tenant scoped');

const getRoute = routeBlock("digitalEmployeesRouter.get('/assistant/decision-center'");
assert.match(getRoute, /res\.locals as AuthLocals/, 'GET must use the authenticated identity');
assert.match(getRoute, /tenantRecord<GoalRecord>\([^\n]+identity\.tenantId/, 'GET goal lookup must enforce tenant ownership');
assert.match(getRoute, /assistantDecisionFeedForRequest\(req, identity/, 'GET must build the compact authenticated feed');
assert.doesNotMatch(getRoute, /listRunEventsAfter|COLLECTION\.events|executionLog|providerLog/, 'GET must not expose execution history or logs');

const postRoute = routeBlock("digitalEmployeesRouter.post('/assistant/decision-center/:decisionId/actions'");
assert.match(postRoute, /res\.locals as AuthLocals/, 'POST must use the authenticated identity');
assert.match(postRoute, /expectedVersion/, 'POST must require the optimistic concurrency token');
assert.match(postRoute, /AssistantDecisionValidationError/, 'stale versions must retain the typed 409 response');
assert.match(postRoute, /executeAssistantDecisionCommand/, 'POST must dispatch through the allowlisted domain command');
assert.match(postRoute, /approveGoalForReview/, 'plan approval must use the existing validated activation service');
assert.match(postRoute, /decideDigitalEmployeeApprovalUseCase/, 'advanced approval must use the persisted approval application service');
assert.match(postRoute, /assertAssistantDecisionVersion\(selected, approvalDecisionVersion\(approval\)\)/, 'the loaded approval must still match the displayed frozen request');
assert.match(postRoute, /expectedRequestHash: customerApprovalRequestHash/, 'weekly customer approvals retain canonical frozen request verification');
assert.match(postRoute, /expectedContentHash/, 'content-bound approvals retain canonical content verification');
assert.match(postRoute, /takeOverWorkflowTask/, 'handoff must use the persisted task takeover operation');
assert.match(postRoute, /runStarter198Command/, 'starter decisions must use the canonical starter command service');
assert.match(postRoute, /identity\.tenantId/g, 'every POST action must remain tenant scoped');
assert.doesNotMatch(postRoute, /listRunEventsAfter|COLLECTION\.events|executionLog|providerLog/, 'POST response must not expose execution history or logs');

assert.match(domainSource, /assistant_decision_changed', 409/, 'stale decision versions must fail with HTTP 409 semantics');
assert.match(domainSource, /action\.mode === 'navigate'/, 'navigation actions must never invoke mutation handlers');
assert.doesNotMatch(domainSource, /EventRecord|RunEvent|listRunEventsAfter|executionLog|providerLog/, 'the decision read model must be structurally independent of execution telemetry');

console.log('assistant decision center route contract tests passed');
