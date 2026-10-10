import assert from 'node:assert/strict';
import { buildPublicationAssignment, type PublishableProductionResult } from '../digitalEmployees/publishingExecution.js';
import type { WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';
import { aggregatePublicationAttempts, buildAssignedPublicationPackage, reconcileSimulatedAttempt, simulatePublicationAttempt, validateWeeklyAssignmentBoundary } from './weeklyLineage.js';

const task = { publicationTaskId: 'weekly-item-1', motherContentId: 'mother-1', adaptationOfPublicationTaskId: null, platform: 'youtube' as const, accountId: 'account-1', accountPositioning: 'proof', businessProposition: 'verified fact', cta: 'contact us', factRefs: [{ type: 'enterprise_fact', id: 'fact-1', version: 3 }], metricTargets: ['inquiries'], publishWindow: '2026-09-22/2026-09-28', status: 'ready' as const };
const weekly = {
  packageId: 'weekly-package-1', programId: 'program-1', version: 2, status: 'active', weekStart: '2026-09-22', weekEnd: '2026-09-28', objective: 'test',
  enterpriseProfileRef: { type: 'enterprise_profile', id: 'enterprise-1', version: 4 }, businessContentGoalRef: { type: 'business_content_goal', id: 'goal-1', version: 2 }, monthlyPlanRef: null,
  workflows: [], appliedWorkflowEvents: [], taskVersionMappings: [], planningBlockers: [], capacityPlanRef: null, automationPolicyRef: null, discoveryBudgetCny: null,
  workflowTasks: [{ taskId: 'workflow-publishing', kind: 'publishing', taskRef: { type: 'weekly_workflow_task', id: 'workflow-publishing', version: 1 }, dependsOnTaskIds: [], subjectRefs: [], status: 'planned', ownBlockingReasons: [], inheritedBlockingTaskIds: [], carriedFromTaskId: null }],
  socialContentPackage: { contentPackageId: 'content-package-1', operatingPackageId: 'weekly-package-1', version: 2, status: 'active', originalContentTarget: 1, adaptationVersionTarget: 0, publicationTaskTarget: 1, publicationTasks: [task], weeklyBudgetCny: 100, perItemBudgetCny: 100, capacityNotes: [], authorization: { mode: 'bounded', accountIds: ['account-1'], maxPublishItems: 1, weekStart: '2026-09-22', weekEnd: '2026-09-28', allowRealPublishing: true, authorizedBy: 'operator-1', authorizedAt: '2026-09-21T00:00:00Z', revokedBy: null, revokedAt: null } },
  successCriteria: [], changeReason: null, previousVersion: 1, createdBy: 'operator-1', createdAt: '2026-09-21T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z',
} satisfies WeeklyOperatingPackage;
const production: PublishableProductionResult = { productionResultId: 'production-1', contentId: 'content-1', contentVersion: 'v3', contentHash: 'a'.repeat(64), title: 'Title', body: 'Body', assets: [{ kind: 'video', fileName: 'video.mp4', downloadUrl: 'https://cdn.example.com/video.mp4', contentHash: 'b'.repeat(64) }], sourceRefs: [{ type: 'director_brief', id: 'brief-1', version: 2 }], acceptedAt: '2026-09-21T10:00:00Z' };

const assignment = buildPublicationAssignment({ tenantId: 'tenant-a', operatingPackage: weekly, publicationTask: task, productionResult: production });
assert.deepEqual(assignment, buildPublicationAssignment({ tenantId: 'tenant-a', operatingPackage: weekly, publicationTask: task, productionResult: production }), 'mapping must be stable');
const manifest = buildAssignedPublicationPackage({ assignment, productionResult: production });
assert.equal(manifest.packageId, assignment.packageId, 'assignment and package identities remain stable');
assert.equal(manifest.operatingLineage?.weeklyPublicationTaskRef.id, task.publicationTaskId, 'the persisted manifest carries complete weekly lineage');
assert.equal(assignment.lineage.businessGoalRef?.id, 'goal-1');
assert.equal(assignment.lineage.upstreamRefs[0]?.id, 'brief-1');

const state = { attempts: {} };
const success = simulatePublicationAttempt({ assignment, contentPackage: weekly.socialContentPackage, outcome: 'success', state, existingPublishedCount: 0, now: '2026-09-25T00:00:00Z' });
assert.equal(success.status, 'published');
assert.ok(success.platformPostId && success.providerReceiptId, 'published requires a provider receipt and platform id');
assert.deepEqual(simulatePublicationAttempt({ assignment, contentPackage: weekly.socialContentPackage, outcome: 'rejected', state, existingPublishedCount: 0, now: '2026-09-25T01:00:00Z' }), success, 'retry is idempotent');

assert.equal(validateWeeklyAssignmentBoundary({ assignment: { ...assignment, accountId: 'outside' }, contentPackage: weekly.socialContentPackage, existingPublishedCount: 0, now: '2026-09-25' }), 'assignment_outside_package');
assert.equal(validateWeeklyAssignmentBoundary({ assignment, contentPackage: weekly.socialContentPackage, existingPublishedCount: 1, now: '2026-09-25' }), 'authorization_limit_exceeded');
assert.equal(validateWeeklyAssignmentBoundary({ assignment, contentPackage: weekly.socialContentPackage, existingPublishedCount: 0, now: '2026-10-01' }), 'authorization_expired');
assert.equal(validateWeeklyAssignmentBoundary({ assignment, contentPackage: { ...weekly.socialContentPackage, authorization: { ...weekly.socialContentPackage.authorization, allowRealPublishing: false, revokedAt: '2026-09-24T00:00:00Z', revokedBy: 'operator-1' } }, existingPublishedCount: 0, now: '2026-09-25' }), 'authorization_revoked');

const unknownState = { attempts: {} };
const unknown = simulatePublicationAttempt({ assignment, contentPackage: weekly.socialContentPackage, outcome: 'unknown', state: unknownState, existingPublishedCount: 0, now: '2026-09-25T00:00:00Z' });
assert.equal(unknown.status, 'unknown');
assert.equal(simulatePublicationAttempt({ assignment, contentPackage: weekly.socialContentPackage, outcome: 'success', state: unknownState, existingPublishedCount: 0, now: '2026-09-25T01:00:00Z' }).status, 'unknown', 'unknown receipt must not blindly retry');
assert.equal(reconcileSimulatedAttempt({ state: unknownState, attemptId: unknown.attemptId, now: '2026-09-25T02:00:00Z' }).status, 'unknown');
const recovered = reconcileSimulatedAttempt({ state: unknownState, attemptId: unknown.attemptId, platformPostId: 'real-post-1', providerReceiptId: 'receipt-1', now: '2026-09-25T03:00:00Z' });
assert.equal(recovered.status, 'published');
assert.equal(aggregatePublicationAttempts([success, { ...success, attemptId: 'failure', status: 'failed', platformPostId: undefined, providerReceiptId: undefined }]), 'partial');
console.log('weekly publication lineage and simulated receipt tests passed');
