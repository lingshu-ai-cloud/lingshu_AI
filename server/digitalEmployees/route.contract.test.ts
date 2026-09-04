import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('server/routes/digitalEmployees.ts', 'utf8');

function routeBlock(start: string): string {
  const begin = source.indexOf(start);
  assert.notEqual(begin, -1, `missing route: ${start}`);
  const next = source.indexOf('\ndigitalEmployeesRouter.', begin + start.length);
  return source.slice(begin, next === -1 ? source.length : next);
}

assert.match(source, /digitalEmployeesRouter\.use\(requireAuth\)/, 'every Digital Employee endpoint must require an authenticated tenant');
assert.match(source, /buildBusinessSnapshot/, 'overview must aggregate the real content and customer business snapshot');
assert.match(source, /businessSnapshot/, 'overview must expose businessSnapshot as a top-level field');
assert.match(source, /updateTenantEnterpriseProfile/, 'onboarding must synchronize missing company basics into the tenant enterprise profile');
const createGoal = routeBlock("digitalEmployeesRouter.post('/goals'");
assert.match(createGoal, /business_line:\s*goal\.businessLine/, 'weekly goals must persist their business line');
assert.match(createGoal, /content_platforms:\s*goal\.contentPlatforms/, 'content goals must persist their platform scope');

const approveGoal = routeBlock("digitalEmployeesRouter.post('/goals/:goalId/approve'");
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
assert.match(approveGoal, /missingGoalResources/, 'goal approval must enforce server-side business resource readiness');
assert.match(approveGoal, /missing_required_resources/, 'missing goal resources need a stable HTTP error contract');
assert.match(approveGoal, /active_goal_exists/, 'a tenant must not start overlapping active weekly goals');

const streamRoute = routeBlock("digitalEmployeesRouter.get('/runs/:runId/stream'");
assert.match(streamRoute, /tenantRecord<RunRecord>/, 'SSE subscriptions must verify run ownership before streaming');
assert.match(streamRoute, /text\/event-stream/, 'production scene must use an SSE response');
assert.match(streamRoute, /sequence[^\n]*after|after[^\n]*sequence/, 'SSE reconnect must replay only events after the last persisted sequence');
assert.match(source, /response\.write\(`id:\s*\$\{event\.sequence\}/, 'SSE events need stable sequence IDs for reconnect');
assert.match(source, /response\.write\(`event:\s*\$\{event\.type\}/, 'SSE events must retain their semantic event type');
assert.match(source, /response\.write\(`data:\s*\$\{JSON\.stringify\(event\)\}/, 'SSE must externalize the persisted event payload');
assert.match(source, /publicEventPayload[\s\S]*?chain_of_thought/, 'event payloads must strip private reasoning fields before persistence and streaming');
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

const approvalRoute = routeBlock("digitalEmployeesRouter.post('/approvals/:approvalId/decide'");
assert.doesNotMatch(
  approvalRoute,
  /===\s*['"]rejected['"]\s*\?\s*['"]rejected['"]\s*:\s*['"]approved['"]/,
  'an unknown approval decision must never default to approved',
);
assert.match(approvalRoute, /status\(400\)/, 'an invalid approval decision must return HTTP 400');
assert.match(approvalRoute, /invalid_approval_decision|approval_decision_invalid|decision_invalid/, 'invalid approval decisions need a stable error contract');
assert.match(approvalRoute, /tenantRecord<ApprovalRecord>/, 'approval records must be tenant scoped');
assert.match(approvalRoute, /subject_version|content_hash/, 'approval must remain bound to the reviewed version or content hash');
assert.match(approvalRoute, /withDigitalEmployeeRunLock/, 'approval decisions must serialize with human lifecycle controls');
assert.match(approvalRoute, /approvalRunBlockedReason/, 'old approvals must not resume stopped runs or non-waiting tasks');
assert.ok(approvalRoute.indexOf('approvalRunBlockedReason') < approvalRoute.indexOf('createPublishingCalendarEntries'), 'run eligibility must precede creation of externally actionable calendar entries');
for (const control of ['pause', 'resume', 'cancel']) {
  assert.match(routeBlock(`digitalEmployeesRouter.post('/runs/:runId/${control}'`), /withDigitalEmployeeRunLock/, `${control} must share the execution lock`);
}
assert.match(routeBlock("digitalEmployeesRouter.post('/runs/:runId/cancel'"), /status: 'superseded'/, 'cancellation must invalidate pending approvals');
assert.match(routeBlock("digitalEmployeesRouter.post('/tasks/:taskId/handoff'"), /withDigitalEmployeeRunLock/, 'handoff must serialize with external actions');

const correctionStart = source.indexOf('async function applyTaskControl');
const correctionEnd = source.indexOf("\ndigitalEmployeesRouter.post('/tasks/:taskId/handoff'", correctionStart);
assert.notEqual(correctionStart, -1, 'missing task-control implementation');
assert.notEqual(correctionEnd, -1, 'missing task-control route boundary');
const correctionRoute = source.slice(correctionStart, correctionEnd);
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
assert.match(source, /digitalEmployeesRouter\.post\('\/tasks\/:taskId\/evidence'/, 'current-run tasks need an explicit tenant-validated business evidence link');
assert.match(source, /canonicalEvidenceRef/, 'attached evidence must be resolved against tenant-owned records');

assert.match(source, /runReviewSummary/, 'active workflow runs must expose a live review summary');
assert.match(source, /liveReview/, 'overview must return a live review before the run is terminal');
assert.match(source, /recordBelongsToTask/, 'business evidence must be scoped to the workflow run and task lineage');
assert.match(source, /const canonicalBusinessRefs = observation\.businessRefs\.length[\s\S]{0,180}task\.business_refs/, 'observe reconciliation must preserve business refs prepared earlier in the same tick');
assert.match(source, /status: 'waiting_external'[\s\S]{0,180}business_refs: canonicalBusinessRefs/, 'waiting tasks must persist canonical prepared/observed business refs');
assert.match(source, /status: 'succeeded'[\s\S]{0,180}business_refs: canonicalBusinessRefs/, 'successful tasks must persist the same canonical business refs contract');
assert.match(source, /runScheduledTaskNow/, 'the first scheduled collection must reuse the real scheduler execution entry point');
assert.match(source, /ensureContentBatchPlan/, 'content mode routing must persist a real content batch plan');
assert.match(source, /type: 'content_order'/, 'content mode routing must persist auditable content-order refs');
assert.match(source, /batchPlanId: batchPlan\.id, contentOrders:/, 'content production must consume the frozen batch plan orders');
assert.match(source, /metadata\.executionMode === 'observe' \|\| metadata\.executionMode === 'draft_executor'/, 'draft production must use an explicit executor mode rather than masquerading as observation');
assert.match(source, /record\.status === 'ready_for_approval'/, 'completed production and published delivery must remain separate states');

assert.match(source, /createCustomerSegmentSnapshot/, 'customer segmentation tasks must create a frozen customer snapshot');
assert.match(source, /createFollowupBatch/, 'follow-up draft tasks must create per-customer draft records');
assert.match(source, /applyFollowupBatchDecision/, 'batch approval must update the corresponding follow-up batch and items');
assert.match(source, /followupRunHasExternalReceipt/, 'workflow completion must distinguish approval from provider-confirmed delivery');
const dispatchRoute = routeBlock("digitalEmployeesRouter.post('/followup-batches/:batchId/dispatch'");
assert.match(dispatchRoute, /dispatchFollowupBatch/, 'an approved follow-up batch must enter the real dispatch worker');
assert.match(dispatchRoute, /status\(202\)/, 'manual dispatch must return an accepted worker result instead of fake delivery');
assert.doesNotMatch(dispatchRoute, /bulk_worker_not_connected/, 'the connected worker route must no longer be a permanent 409 stub');
const dispatchPreflightRoute = routeBlock("digitalEmployeesRouter.get('/followup-batches/:batchId/dispatch-preflight'");
assert.match(dispatchPreflightRoute, /preflightFollowupBatchDispatch/, 'operators need a read-only dispatch preflight before any real provider call');
assert.match(source, /dispatchPreflight/, 'follow-up task output must expose structured read-only preflight facts to the UI');
assert.match(source, /followupDispatchPreflightBlockedReason/, 'follow-up task blockers must be derived from the real dispatch preflight');
assert.doesNotMatch(source, /批量发送 Worker 已接入（\$\{followupWorkerMode\}）；等待到达逐客发送时间或真实 WhatsApp 回执/, 'an unavailable provider must not be described as merely waiting for a receipt');
assert.match(source, /onFollowupWorkerEvent/, 'worker progress and receipts must enter the persisted production event stream');
assert.doesNotMatch(source, /['"]outreach_(?:batches|recipients)['"]/, 'routes must not write to legacy outreach aliases');

console.log('digital employee route contract tests passed');
