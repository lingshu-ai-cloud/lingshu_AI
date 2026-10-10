import assert from 'node:assert/strict';
import fs from 'node:fs';

const route = fs.readFileSync(new URL('../routes/digitalEmployees.ts', import.meta.url), 'utf8');
const approvalDecision = fs.readFileSync(new URL('./approvalDecision.ts', import.meta.url), 'utf8');
const execution = fs.readFileSync(new URL('./publishingExecution.ts', import.meta.url), 'utf8');
const publishing = fs.readFileSync(new URL('../routes/publishing.ts', import.meta.url), 'utf8');
const publisher = fs.readFileSync(new URL('../publishing/scheduledPublisher.ts', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../../src/components/DigitalEmployeePage.tsx', import.meta.url), 'utf8');

assert.match(route, /get\('\/publishing-accounts'[\s\S]*listConnectedPublishingAccounts\(tenantId\)/, 'account choices must come from tenant-scoped connected records');
assert.match(route, /bindPublishingTargets\(tenantId, submittedConfig\.publishingTargets\)/, 'onboarding must not trust browser-provided account metadata');
assert.match(route, /key: 'selected_publishing_accounts'[\s\S]*packageAccountIds.every\(accountId => connectedIds.has\(accountId\)\)/, 'runtime publishing preflight must reject missing or disconnected selected accounts without preventing independent tasks from starting');
assert.match(route, /publishing_approval_package/, 'content approval must carry its itemized immutable package');
assert.match(approvalDecision, /publishingPackage\.contentHash !== text\(approval\.content_hash\)/, 'changed content must invalidate approval in the shared decision authority');
assert.match(approvalDecision, /await dependencies\.listConnectedPublishingAccounts\(input\.tenantId\)/, 'the selected accounts must still be connected when the approval is decided');
assert.match(approvalDecision, /await dependencies\.createPublishingCalendarEntries\(/, 'approved content must enter the publishing calendar');
assert.match(execution, /allowRealPublishing\s*\?\s*'scheduled'\s*:\s*'awaiting_manual_publish'/, 'an approved package without real-publishing consent must stop in the manual queue');
assert.match(publisher, /workflowRunId[\s\S]*realPublishingAuthorized !== true/, 'the worker must enforce explicit real-publishing consent');
assert.match(publishing, /awaiting_reapproval/, 'editing an approved calendar item must stop delivery and require reapproval');
assert.doesNotMatch(page, /frontend_preview|BUSINESS_PREVIEW|PreviewExecutionPanel|查看示例数据/, 'real tenant pages must contain no synthetic operating receipt path');
assert.match(page, /发布平台与具体账号/, 'onboarding must collect concrete publishing accounts before the goal');
assert.match(page, /审批通过后允许真实发布/, 'real publishing consent must be explicit');

console.log('digital employee publishing integration contract tests passed');
