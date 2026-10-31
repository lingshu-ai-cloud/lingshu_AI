import { readDigitalEmployeeApplicationSources, digitalEmployeeRouteBlock, digitalEmployeeFunction } from '../../tests/fixtures/digitalEmployeeApplicationSources.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  digitalEmployeeOperatingGoals,
  isDigitalEmployeeOperatingGoal,
} from './overviewGoalScope.js';

const mainSource = readDigitalEmployeeApplicationSources();
const interventionApplication = fs.readFileSync('server/digitalEmployees/taskInterventionApplication.ts', 'utf8');
const interventionRoutes = fs.readFileSync('server/routes/digitalEmployeeTaskInterventionRoutes.ts', 'utf8');
const weeklyReviewApplication = fs.readFileSync('server/digitalEmployees/weeklyReviewApplication.ts', 'utf8');
const weeklyReviewRoutes = fs.readFileSync('server/routes/digitalEmployeeWeeklyReviewRoutes.ts', 'utf8');
const businessObservation = fs.readFileSync('server/digitalEmployees/taskBusinessObservation.ts', 'utf8');
const businessPreparation = fs.readFileSync('server/digitalEmployees/taskBusinessPreparation.ts', 'utf8');
const source = [mainSource, interventionApplication, interventionRoutes, weeklyReviewApplication, weeklyReviewRoutes, businessObservation, businessPreparation].join('\n');
assert.match(mainSource, /createTaskBusinessObservation\(\{/, 'reconciliation must wire the shared evidence observer');
assert.match(mainSource, /createTaskBusinessPreparation\(\{/, 'reconciliation must wire the shared resource preparation service');
assert.doesNotMatch(businessObservation + businessPreparation, /from 'express'|req\.body|res\.json/, 'business runtime services must remain independent from HTTP');
assert.doesNotMatch(weeklyReviewApplication, /from 'express'|req\.body|res\.json/, 'weekly review application must remain independent from HTTP');
assert.ok(mainSource.indexOf('digitalEmployeesRouter.use(enforceSupportSessionReadOnly)') < mainSource.indexOf('registerWeeklyReviewGenerationRoutes(digitalEmployeesRouter'), 'review writes must remain behind support session guards');
const followupReadSource = fs.readFileSync('server/routes/digitalEmployeeFollowupReadRoutes.ts', 'utf8');
const overviewReaderSource = fs.readFileSync('server/routes/digitalEmployeeOverviewReader.ts', 'utf8');
const overviewProjectionSource = fs.readFileSync('server/digitalEmployees/overviewProjection.ts', 'utf8');
const productionBudgetRouteSource = fs.readFileSync('server/routes/digitalEmployeeProductionBudgetRoute.ts', 'utf8');
const taskEvidenceProjectionSource = fs.readFileSync('server/digitalEmployees/taskEvidenceProjection.ts', 'utf8');
const approvalApplication = fs.readFileSync('server/digitalEmployees/approvalDecision.ts', 'utf8');
const cancellationApplication = fs.readFileSync('server/digitalEmployees/runCancellation.ts', 'utf8');

function routeBlock(start: string): string {
  return digitalEmployeeRouteBlock(source, start);
}

assert.match(source, /digitalEmployeesRouter\.use\(requireAuth\)/, 'every Digital Employee endpoint must require an authenticated tenant');
assert.match(source, /digitalEmployeesRouter\.use\(enforceSupportSessionReadOnly\)/, 'support sessions must remain read-only');
assert.match(source, /digitalEmployeesRouter\.use\(createDigitalEmployeeFollowupReadRouter\(\)\)/, 'follow-up read endpoints must remain mounted behind the parent gates');
assert.match(followupReadSource, /getFollowupBatch\(tenantId, req\.params\.batchId\)/, 'batch reads must be scoped to the authenticated tenant');
assert.match(followupReadSource, /getTenantFollowupDispatchStatus\(tenantId\)/, 'worker status must be scoped to the authenticated tenant');
assert.match(source, /buildBusinessSnapshot/, 'overview must aggregate the real content and customer business snapshot');
assert.match(overviewReaderSource, /businessSnapshot/, 'overview must expose businessSnapshot as a top-level field');
assert.match(overviewProjectionSource, /VISIBLE_DIGITAL_EMPLOYEE_AGENT_ROLES as VISIBLE_AGENT_ROLES/, 'overview must use the canonical four-expert read model');
assert.match(overviewReaderSource, /agents:\s*projectDirectorAnalysisStatus\(publicAgentStatuses\(normalizedTasks\)/, 'overview must return a fixed four-expert Agent summary enriched with Director analysis');
assert.match(overviewReaderSource, /agents:\s*projectDirectorAnalysisStatus\(publicAgentStatuses\(\[\]\)/, 'overview without a goal must still return four idle expert roles enriched with Director analysis');
assert.match(overviewReaderSource, /agent_role: visibleAgentRole\(task\.agent_role, task\.task_key\)/, 'persisted workflow tasks must be normalized at the read boundary');
assert.match(overviewProjectionSource, /agentRole: visibleAgentRole\(String\(task\.agentRole/, 'persisted plan tasks must be normalized at the read boundary');
assert.match(overviewReaderSource, /requested_by_agent: visibleAgentRole/, 'legacy approval ownership must be normalized at the read boundary');
assert.match(overviewProjectionSource, /team: \[\.\.\.VISIBLE_AGENT_ROLES\]/, 'legacy plan snapshots must expose the fixed four-expert team');
assert.match(overviewReaderSource, /committedDigitalEmployeeOperatingGoals\(tenantId, goalResult\.items\)/, 'overview must exclude non-operating and uncommitted rebuild lineage records before selecting the current weekly goal');
assert.match(source, /isDigitalEmployeeOperatingGoal\(goal\)/, 'direct overview links must reject non-operating lineage records');
assert.match(source, /updateTenantEnterpriseProfile/, 'onboarding must synchronize missing company basics into the tenant enterprise profile');
assert.match(source, /critical_business_change/, 'critical product, market, audience, language, platform, account, or publishing-permission changes must notify the active run');
assert.match(source, /本周预算、产品、市场或发布授权范围已变更/, 'authorization invalidation must explicitly warn about budget and business-boundary changes');
assert.match(source, /appendAuthorizationRequiredEvent/, 'weekly-package changes must emit a visible reauthorization event');
assert.match(source, /invalidatePublishingAuthorizationForRun/, 'weekly-package changes must pause already materialized work that has no provider receipt');
assert.match(source, /savedPackage && plan && taskCorrectionInvalidatesWeeklyAuthorization\(input\.action\)/,
  'an execution-only retry must retain the weekly budget and publishing boundary already approved before production');
assert.match(source, /const invalidatesAuthorization = directorDecisionInvalidatesWeeklyAuthorization\(decision\)/,
  'director decisions must invalidate the weekly authorization only when they actually change the frozen direction');
assert.match(source, /restoreExecutionOnlyInvalidatedAuthorization\(tenantId, goal, run, plan\)/,
  'a previously approved weekly boundary must be recoverable only through its durable approval and invalidation evidence');
assert.match(source, /weekly_package\.authorization_recovered/,
  'an automatic authorization restoration must leave an explicit audit receipt');
assert.match(source, /task\.requires_approval && task\.status === 'failed'[\s\S]{0,500}dataStatus === 'execution_failed'/,
  'an approval preflight exception must be safely re-observed instead of remaining a terminal workflow failure');
assert.match(source, /run\.status === 'waiting_human' && !recoverableApprovalFailure/,
  'a run paused by a recoverable approval preflight exception must be allowed to reconcile');
assert.match(source, /const reobservableUserInputWait = taskResult\.items\.some[\s\S]{0,420}\['input', 'manual'\]\.includes[\s\S]{0,160}waitState/,
  'an actionable input wait must be re-observed so completing the requested setup resumes automatically');
assert.match(source, /error\.message\.includes\('IANA'\)[\s\S]{0,220}发布账号尚未配置有效时区/,
  'a missing publishing timezone must become an actionable approval preflight result instead of an execution exception');
assert.match(source, /error\.message === 'bounded_authorization_actor_missing'[\s\S]{0,220}重新确认周计划/,
  'an invalidated bounded publishing grant must explain the required re-authorization instead of reporting a generic failure');
assert.match(source, /dataStatus: 'preflight_blocked',[\s\S]{0,220}waitState: waitState\('input', preflight\.reason\)/,
  'approval configuration gaps must be presented as explicit user input, not a vague external-service wait');
assert.match(source, /const needsHumanInput = remaining\.find[\s\S]{0,400}'waiting_human'/,
  'a run with an actionable input gap must be owned by the user rather than labeled as an external wait');
assert.match(source, /status: 'waiting_human', output, business_refs: preflight\.businessRefs/,
  'approval preflight inputs such as missing account authorization must be persisted as human work, not an external-service wait');
assert.match(source, /const waitStatus = workflowStatusForWait\(diagnostic\)/,
  'every diagnostic wait must map input, approval and provider states to distinct workflow statuses');
assert.match(overviewProjectionSource, /const active = agentTasks\.find[\s\S]{0,180}'waiting_human'/,
  'an Agent waiting for user input must remain visible in the live employee status instead of appearing idle');
assert.match(source, /const shouldResetTask = \['waiting_external', 'waiting_approval', 'waiting_human', 'pending'\]/,
  'attaching the requested evidence must reset a human-input task so the run can continue');
assert.match(source, /const shouldReconcile = !\['succeeded', 'failed', 'cancelled', 'paused'\]\.includes\(run\.status\)/,
  'a waiting-human run must reconcile immediately after the requested evidence is attached');
const socialContentBridgeGoal = { id: 'social-bridge', metric: 'approved_social_content_artifacts', scope: { socialTaskId: 'socialtask-1' } };
const weeklyOperatingGoal = { id: 'weekly-operating', metric: 'qualified_leads', scope: { description: '本周经营范围' } };
assert.equal(isDigitalEmployeeOperatingGoal(socialContentBridgeGoal), false, 'a social-content execution bridge is not a Digital Employee weekly goal');
assert.deepEqual(digitalEmployeeOperatingGoals([socialContentBridgeGoal, weeklyOperatingGoal]).map(item => item.id), ['weekly-operating']);
const createGoal = routeBlock("digitalEmployeesRouter.post('/goals'");
assert.match(createGoal, /content_production_platform_unsupported/, 'new production goals must refuse unsupported publishing platforms');
assert.match(createGoal, /business_line:\s*goal\.businessLine/, 'weekly goals must persist their business line');
assert.match(createGoal, /content_platforms:\s*goal\.contentPlatforms/, 'content goals must persist their platform scope');
assert.match(createGoal, /smartOperationsEnabled === false/, 'the global Smart Operations switch must stop future outlines without cancelling historical work');

const packageDetailsRoute = routeBlock("digitalEmployeesRouter.post('/goals/:goalId/package/details'");
assert.match(packageDetailsRoute, /withLocalQueue\(goalApprovalQueues/, 'double-clicks on paid detail generation must serialize on one goal lock');
assert.match(packageDetailsRoute, /acquireDurableOperationLease/, 'detail generation must also use a database lease across web instances');
assert.match(packageDetailsRoute, /assertDurableOperationLease/, 'only the active detail-generation lease may persist Agent output');
assert.match(packageDetailsRoute, /releaseDurableOperationLease/, 'completed detail generation must release its database lease');
assert.match(packageDetailsRoute, /detailGeneration\?\.status === 'ready'/, 'a repeated request must reuse an already persisted ready preview');
assert.match(packageDetailsRoute, /status: 'generating'/, 'detail generation must persist an in-progress checkpoint before calling Agents');
assert.match(packageDetailsRoute, /readServerProductionOnboardingReadiness/, 'detail generation must verify authoritative production inputs before acquiring paid work');
assert.match(packageDetailsRoute, /production_onboarding_preflight_blocked/, 'detail generation must return actionable onboarding blockers before calling Agents');
assert.match(packageDetailsRoute, /generateWeeklyTaskPreviews/, 'step 2 must run the Director and Content pre-production analysis');
assert.match(packageDetailsRoute, /status: 'blocked'/, 'a failed detail generation must preserve a retryable blocked state');
const packageUpdateRoute = routeBlock("digitalEmployeesRouter.put('/goals/:goalId/package'");
assert.match(packageUpdateRoute, /delete pack\.detailGeneration/, 'editing an outline must invalidate stale pre-production status');
assert.match(packageUpdateRoute, /delete videoPlan\.preproduction/, 'editing an outline must invalidate every stale task preview');
const publicationScheduleRoute = routeBlock("digitalEmployeesRouter.patch('/goals/:goalId/publication-schedule/:contentId'");
assert.match(publicationScheduleRoute, /beijingDate\(new Date\(scheduledAt\)\)/, 'manual publishing moves must use the explicit Beijing calendar date');
assert.match(publicationScheduleRoute, /publication_schedule_outside_cycle/, 'manual publishing moves must remain inside the current weekly cycle');
assert.match(publicationScheduleRoute, /publication_schedule_locked/, 'approved or executing publications must not be silently rescheduled');
assert.match(publicationScheduleRoute, /compareAndSwap/, 'manual publishing moves must update the weekly plan with optimistic concurrency');
assert.match(publicationScheduleRoute, /ContentBatchPlanRecord/, 'manual publishing moves must keep the frozen production handoff aligned');
assert.match(publicationScheduleRoute, /weekly_publication\.rescheduled/, 'manual publishing moves must enter the audit log');

const goalApprovalRoute = routeBlock("digitalEmployeesRouter.post('/goals/:goalId/approve'");
assert.match(goalApprovalRoute, /approveGoalForReview/, 'manual approval must call the same validated activation as review scheduling');
assert.match(goalApprovalRoute, /contentGenerationAuthorization/, 'manual approval must require explicit content-generation authorization');
const approveGoal = digitalEmployeeFunction(source, 'ensureReviewRunTasks') + digitalEmployeeFunction(source, 'approveGoalForReview');
assert.doesNotMatch(approveGoal, /presenterProductionGate|error: 'presenter_required'/, 'weekly approval must not require a presenter for pure product plans');
for (const [stored, planned] of [
  ['business_domain', 'businessDomain'],
  ['capability_key', 'capabilityKey'],
  ['destination', 'destination'],
  ['destination_view', 'destinationView'],
  ['status_source', 'statusSource'],
  ['execution_mode', 'executionMode'],
  ['external_effect', 'externalEffect'],
] as const) {
  assert.match(approveGoal, new RegExp(`${stored}:\\s*task\\.${planned}`), `approved plans must persist task.${planned} as ${stored}`);
}
assert.match(approveGoal, /task_version:\s*1/, 'new workflow tasks must start at an explicit immutable version');
assert.match(approveGoal, /correction_version:\s*0/, 'new workflow tasks must start before the first correction');
assert.doesNotMatch(approveGoal, /missingGoalResources/, 'missing delivery resources must not block independent branches from starting');
assert.doesNotMatch(approveGoal, /missing_required_resources|publishing_accounts_invalid/, 'delivery checks belong to runtime tasks, not whole-plan activation');
assert.match(approveGoal, /active_goal_exists/, 'a tenant must not start overlapping active weekly goals');
assert.match(approveGoal, /validatePackageForStart/, 'activation must retain structural plan validation');
assert.doesNotMatch(approveGoal, /package_details_blocked|production_onboarding_preflight_blocked|preflightWeeklyImageQueue/, 'item-level preparation and image analysis must not block whole-plan activation');
assert.match(approveGoal, /startIndependentImages/, 'approval starts independently admitted image work');
assert.ok(approveGoal.indexOf("status: 'planning'") < approveGoal.lastIndexOf('startIndependentImages'), 'the formal run must start before image checks');
assert.match(source, /const activeProjects = projectAutomationStates\.filter/, 'content observation must distinguish runnable siblings from item-local blockers');
assert.match(source, /const blocker = activeProjects\.length \? ''/, 'one blocked content item must not pause other runnable content');
assert.match(approveGoal, /savedFactsVersion !== canonicalFactsVersion/, 'a new run must compare the draft fact label with the canonical enterprise fact version');
assert.match(approveGoal, /enterprise_facts_changed/, 'a stale fact version must stop activation instead of relabeling old plan facts');
assert.match(approveGoal, /knowledgeBinding: resolvedConfiguration\.knowledgeBinding/, 'legacy drafts without a frozen payload must bind the canonical snapshot before the run starts');

const streamRoute = routeBlock("digitalEmployeesRouter.get('/runs/:runId/stream'");
assert.match(streamRoute, /tenantRecord<RunRecord>/, 'SSE subscriptions must verify run ownership before streaming');
assert.match(streamRoute, /text\/event-stream/, 'production scene must use an SSE response');
assert.match(streamRoute, /sequence[^\n]*after|after[^\n]*sequence/, 'SSE reconnect must replay only events after the last persisted sequence');
assert.match(source, /response\.write\(`id:\s*\$\{event\.sequence\}/, 'SSE events need stable sequence IDs for reconnect');
assert.match(source, /response\.write\(`event:\s*\$\{event\.type\}/, 'SSE events must retain their semantic event type');
assert.match(source, /response\.write\(`data:\s*\$\{JSON\.stringify\(event\)\}/, 'SSE must externalize the persisted event payload');
assert.match(overviewProjectionSource, /publicEventPayload[\s\S]*?chain_of_thought/, 'event payloads must strip private reasoning fields before persistence and streaming');
assert.match(source, /payload:\s*publicEventPayload\(input\.payload/, 'the SSE source must persist the filtered public event payload');
const uiEventRoute = routeBlock("digitalEmployeesRouter.post('/runs/:runId/tasks/:taskId/ui-events'");
assert.match(uiEventRoute, /x-agent-worker-token/, 'Agent UI telemetry must require the worker credential');
assert.match(uiEventRoute, /tenantRecord<RunRecord>[\s\S]*tenantRecord<TaskRecord>/, 'Agent UI telemetry must validate both run and task ownership');
for (const kind of ['action_started', 'navigation', 'click', 'input', 'screenshot']) {
  assert.match(uiEventRoute, new RegExp(kind), `Agent UI telemetry must accept ${kind} events`);
}
assert.match(uiEventRoute, /appendEvent/, 'Agent UI telemetry must enter the persisted SSE event stream');
assert.match(uiEventRoute, /trusted_screenshot_url_required/, 'screen captures must use a trusted URL rather than arbitrary inline content');
for (const coordinate of ['x', 'y', 'viewportWidth', 'viewportHeight']) {
  assert.match(uiEventRoute, new RegExp(coordinate), `Agent UI telemetry must persist ${coordinate} for the real cursor`);
}
assert.match(uiEventRoute, /kind === ['"]click['"][\s\S]{0,300}ui_click_coordinates_required/, 'a click event without real viewport coordinates must be rejected');

const approvalAdapterStart = source.indexOf('async function decideDigitalEmployeeApproval');
const approvalAdapterEnd = source.indexOf("digitalEmployeesRouter.post('/approvals/:approvalId/decide'", approvalAdapterStart);
assert.notEqual(approvalAdapterStart, -1, 'missing approval HTTP adapter');
assert.notEqual(approvalAdapterEnd, -1, 'missing approval route registration');
const approvalRoute = source.slice(approvalAdapterStart, approvalAdapterEnd);
assert.doesNotMatch(
  `${approvalRoute}\n${approvalApplication}`,
  /===\s*['"]rejected['"]\s*\?\s*['"]rejected['"]\s*:\s*['"]approved['"]/,
  'an unknown approval decision must never default to approved',
);
assert.match(approvalRoute, /decideDigitalEmployeeApprovalUseCase/, 'the legacy route must use the shared approval application service');
assert.match(approvalRoute, /DigitalEmployeeApprovalDecisionError/, 'the route must preserve typed application error status and details');
assert.match(approvalApplication, /'invalid_approval_decision', 400/, 'an invalid approval decision must return HTTP 400');
assert.match(approvalApplication, /tenantRecord<ApprovalDecisionRecord>/, 'approval records must be tenant scoped');
assert.match(approvalApplication, /subject_version|content_hash/, 'approval must remain bound to the reviewed version or content hash');
assert.match(approvalApplication, /withDigitalEmployeeRunLock/, 'approval decisions must serialize with human lifecycle controls');
assert.match(approvalApplication, /approvalRunBlockedReason/, 'old approvals must not resume stopped runs or non-waiting tasks');
assert.ok(approvalApplication.indexOf('approvalRunBlockedReason') < approvalApplication.indexOf('createPublishingCalendarEntries'), 'run eligibility must precede creation of externally actionable calendar entries');
for (const control of ['pause', 'resume']) {
  assert.match(routeBlock(`digitalEmployeesRouter.post('/runs/:runId/${control}'`), /withDigitalEmployeeRunLock/, `${control} must share the execution lock`);
}
assert.match(routeBlock("digitalEmployeesRouter.post('/runs/:runId/pause'"), /pauseContentExecutionJobsForRun[\s\S]*workflow_run_pause/, 'pausing a workflow must durably pause its production jobs');
assert.match(
  routeBlock("digitalEmployeesRouter.post('/runs/:runId/pause'"),
  /\['running', 'waiting_external', 'waiting_approval', 'waiting_human'\]\.includes\(run\.status\)/,
  'a run waiting for human input must still be pausable before publication',
);
assert.match(routeBlock("digitalEmployeesRouter.post('/runs/:runId/resume'"), /resumeContentExecutionJobsForRun[\s\S]*workflow_run_pause/, 'resuming a workflow must resume only its own controlled production jobs');
assert.match(source, /cancelDigitalEmployeeRunApplication/, 'the cancel route must use the shared lifecycle application service');
assert.match(cancellationApplication, /withDigitalEmployeeRunLock/, 'cancel must share the execution lock');
assert.match(cancellationApplication, /status: 'superseded'/, 'cancellation must invalidate pending approvals');
assert.match(routeBlock("digitalEmployeesRouter.post('/tasks/:taskId/handoff'"), /withDigitalEmployeeRunLock/, 'handoff must serialize with external actions');
assert.match(routeBlock("digitalEmployeesRouter.post('/tasks/:taskId/handoff'"), /pauseContentExecutionJobsForRun[\s\S]*workflow_handoff/, 'human handoff must stop every production job under the run');
assert.match(routeBlock("digitalEmployeesRouter.post('/tasks/:taskId/handoff'"), /planWorkflowHandoffAdmission/, 'page takeover must enforce the one-active-handoff-per-run policy');
const returnToAgentRoute = routeBlock("digitalEmployeesRouter.post('/tasks/:taskId/return-to-agent'");
assert.match(returnToAgentRoute, /remainingActiveHandoffs[\s\S]*verifiedReturnPlan\.canResumeRun[\s\S]*resumeContentExecutionJobsForRun[\s\S]*workflow_handoff/, 'returning to Agent must resume jobs only after verifying that no active handoff remains');
assert.match(returnToAgentRoute, /else[\s\S]*status:\s*['"]waiting_human['"]/, 'historical extra handoffs must keep the run fail-closed');
const assistantHandoff = source.slice(source.indexOf('async function takeOverWorkflowTask'), source.indexOf("digitalEmployeesRouter.get('/overview'"));
assert.match(assistantHandoff, /pauseContentExecutionJobsForRun[\s\S]*workflow_handoff/, 'Lingxiaoshu human takeover must use the same durable production stop as the page control');
assert.match(assistantHandoff, /planWorkflowHandoffAdmission/, 'Lingxiaoshu takeover must share the one-active-handoff-per-run policy');

assert.match(mainSource, /registerTaskInterventionRoutes\(digitalEmployeesRouter/, 'intervention endpoints must stay on the authenticated parent router');
assert.ok(mainSource.indexOf('digitalEmployeesRouter.use(enforceSupportSessionReadOnly)') < mainSource.indexOf('registerTaskInterventionRoutes(digitalEmployeesRouter'), 'parent write guards must precede all intervention routes');
assert.doesNotMatch(interventionApplication, /from 'express'|req\.body|res\.json/, 'application rules must not depend on HTTP');
const correctionRoute = interventionApplication + interventionRoutes;
assert.match(correctionRoute, /tenantRecord<TaskRecord>/, 'corrections must only address a task in the current tenant');
assert.match(correctionRoute, /req\.body\?\.instruction|req\.body\.instruction/, 'correction contract must accept instruction');
assert.match(correctionRoute, /req\.body\?\.scope|req\.body\.scope/, 'correction contract must accept scope');
assert.match(correctionRoute, /rerunDownstream/, 'correction contract must accept rerunDownstream');
assert.match(correctionRoute, /one_off/, 'one-off corrections must not silently become long-term rules');
assert.match(correctionRoute, /rule_candidate/, 'long-term corrections must remain reviewable rule candidates');
assert.match(correctionRoute, /workflow_corrections|COLLECTION\.corrections/, 'every correction must be persisted as an auditable record');
assert.match(correctionRoute, /before_state/, 'the audit record must preserve the state before correction');
assert.match(correctionRoute, /after_state/, 'the audit record must preserve the state after correction');
assert.match(correctionRoute, /affected_task_ids/, 'the audit record must identify downstream tasks selected for rerun');
assert.match(correctionRoute, /correction_version/, 'the task must expose which correction version it is executing');
assert.match(correctionRoute, /appendEvent/, 'the live production scene must receive a persisted correction event');
assert.match(correctionRoute, /appendAudit/, 'human corrections must enter the tenant audit log');
assert.match(correctionRoute, /manual_complete/, 'corrections must support auditable manual completion');
assert.match(correctionRoute, /replan/, 'corrections must support rebuilding the current plan graph');
assert.match(correctionRoute, /status:\s*['"]skipped['"]/, 'skip must change the persisted task status');
for (const suffix of ['retry', 'skip', 'complete']) {
  assert.match(source, new RegExp(`digitalEmployeesRouter\\.post\\('/tasks/:taskId/${suffix}'`), `missing ${suffix} task-control endpoint`);
}
const productionBudgetRecovery = productionBudgetRouteSource;
assert.match(productionBudgetRecovery, /withDigitalEmployeeRunLock/, 'legacy budget recovery must serialize with the active production run');
assert.match(productionBudgetRecovery, /verifiedStoryboardProviderCostRange/, 'legacy budget recovery must reprice the exact frozen storyboard');
assert.match(productionBudgetRecovery, /!isInternalBudgetExemptTenant\(tenantId\)[\s\S]{0,220}explicitBatchCeiling/, 'the configured test tenant must not be blocked by the server internal storyboard batch ceiling');
assert.match(productionBudgetRecovery, /productionBudgetMode:[\s\S]*maxAigcRetries:/, 'the reviewed protected or economy choice must freeze the runtime retry policy');
assert.match(productionBudgetRecovery, /contentBatchPlans[\s\S]*studio_projects/, 'the plan, frozen handoff and existing projects must receive one consistent ceiling');
assert.match(productionBudgetRecovery, /legacyRepairProjects/, 'the recovery route must refuse to rewrite unrelated production blockers');
assert.match(productionBudgetRecovery, /managedReplicationPlanHasExecutionGraph/, 'a version-only legacy replication shell must be recognized as incomplete');
assert.match(productionBudgetRecovery, /hasFrozenSpeechEvidence/, 'legacy script repair must protect frozen person speech receipts while allowing narration-only repair to preserve paid visual receipts');
assert.match(productionBudgetRecovery, /appendEvent[\s\S]*appendAudit/, 'a historical budget repair must be visible and auditable');
assert.match(source, /digitalEmployeesRouter\.post\('\/tasks\/:taskId\/evidence'/, 'current-run tasks need an explicit tenant-validated business evidence link');
assert.match(source, /canonicalEvidenceRef/, 'attached evidence must be resolved against tenant-owned records');

assert.match(source, /runReviewSummary/, 'active workflow runs must expose a live review summary');
assert.match(overviewReaderSource, /liveReview/, 'overview must return a live review before the run is terminal');
assert.match(source, /recordBelongsToTask/, 'business evidence must be scoped to the workflow run and task lineage');
assert.match(source, /const canonicalBusinessRefs = observation\.businessRefs\.length[\s\S]{0,180}task\.business_refs/, 'observe reconciliation must preserve business refs prepared earlier in the same tick');
assert.match(source, /const taskUpdate = \{ status: waitStatus[\s\S]{0,180}business_refs: canonicalBusinessRefs/, 'waiting or input-blocked tasks must persist canonical prepared/observed business refs');
assert.match(source, /status: 'succeeded'[\s\S]{0,180}business_refs: canonicalBusinessRefs/, 'successful tasks must persist the same canonical business refs contract');
assert.match(source, /runScheduledTaskNow/, 'the first scheduled collection must reuse the real scheduler execution entry point');
assert.match(source, /ensureContentBatchPlan/, 'content mode routing must persist a real content batch plan');
assert.match(source, /type: 'content_order'/, 'content mode routing must persist auditable content-order refs');
assert.match(source, /batchPlanId: batchPlan\.id, contentOrders:/, 'content production must consume the frozen batch plan orders');
assert.match(source, /ensureFrozenEnterpriseProfileForRun/, 'active runs must resolve enterprise and product facts from their frozen plan snapshot');
assert.match(source, /enterpriseProfile: await frozenRunFacts\(\)/, 'content production and follow-up drafting must receive the frozen run facts explicitly');
assert.match(source, /metadata\.executionMode === 'observe' \|\| metadata\.executionMode === 'draft_executor'/, 'draft production must use an explicit executor mode rather than masquerading as observation');
assert.match(taskEvidenceProjectionSource, /record\.status === 'ready_for_approval'/, 'completed production and published delivery must remain separate states');
assert.match(source, /from '\.\.\/digitalEmployees\/taskEvidenceProjection\.js'/, 'the route must consume task evidence rules from the domain module');

assert.match(source, /createCustomerSegmentSnapshot/, 'customer segmentation tasks must create a frozen customer snapshot');
assert.match(source, /createFollowupBatch/, 'follow-up draft tasks must create per-customer draft records');
assert.match(source, /applyFollowupBatchDecision/, 'batch approval must update the corresponding follow-up batch and items');
assert.match(source, /followupRunHasExternalReceipt/, 'workflow completion must distinguish approval from provider-confirmed delivery');
const dispatchRoute = routeBlock("digitalEmployeesRouter.post('/followup-batches/:batchId/dispatch'");
assert.match(dispatchRoute, /dispatchFollowupBatch/, 'an approved follow-up batch must enter the real dispatch worker');
assert.match(dispatchRoute, /status\(202\)/, 'manual dispatch must return an accepted worker result instead of fake delivery');
assert.doesNotMatch(dispatchRoute, /bulk_worker_not_connected/, 'the connected worker route must no longer be a permanent 409 stub');
const dispatchPreflightRoute = followupReadSource.slice(followupReadSource.indexOf("router.get('/followup-batches/:batchId/dispatch-preflight'"));
assert.match(dispatchPreflightRoute, /preflightFollowupBatchDispatch/, 'operators need a read-only dispatch preflight before any real provider call');
assert.match(source, /dispatchPreflight/, 'follow-up task output must expose structured read-only preflight facts to the UI');
assert.match(source, /followupDispatchPreflightBlockedReason/, 'follow-up task blockers must be derived from the real dispatch preflight');
assert.doesNotMatch(source, /批量发送 Worker 已接入（\$\{followupWorkerMode\}）；等待到达逐客发送时间或真实 WhatsApp 回执/, 'an unavailable provider must not be described as merely waiting for a receipt');
assert.match(source, /onFollowupWorkerEvent/, 'worker progress and receipts must enter the persisted production event stream');
assert.doesNotMatch(source, /['"]outreach_(?:batches|recipients)['"]/, 'routes must not write to legacy outreach aliases');

console.log('digital employee route contract tests passed');
