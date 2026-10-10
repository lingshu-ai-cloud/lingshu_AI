import assert from 'node:assert/strict';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { buildPublicationAssignment, type PublishableProductionResult } from '../digitalEmployees/publishingExecution.js';
import type { WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
import {
  createAssignedPublicationPackage, executeWeeklyPublication, markPublicationAssignmentPackageReady,
  persistPublicationAssignment, realPublishingCapabilities, reconcileWeeklyPublication,
  revokePublicationAssignments, type WeeklyPublishingProviderAdapter,
} from './weeklyLineage.js';
import { runWeeklyPublicationExecutionScan } from './weeklyPublicationExecutionWorker.js';
import { runWeeklyPublicationPackageScan } from './weeklyPublicationWorker.js';

type Row = { id: string; [key: string]: any };
function memoryStore(): DataStore & { rows: Map<string, Row[]> } {
  const rows = new Map<string, Row[]>();
  const list = async <T>(collection: string, query: ListQuery = {}) => {
    let items = [...(rows.get(collection) || [])];
    for (const [key, value] of Object.entries(query.where || {})) items = items.filter(item => item[key] === value);
    if (query.sort) {
      const descending = query.sort.startsWith('-'), key = descending ? query.sort.slice(1) : query.sort;
      items.sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (descending ? -1 : 1));
    }
    const page = query.page ?? 1, perPage = query.perPage ?? 500, totalItems = items.length;
    return { items: items.slice((page - 1) * perPage, page * perPage) as T[], totalItems, totalPages: Math.ceil(totalItems / perPage), page, perPage };
  };
  return {
    // Explicit isolated, controlled provider fixture capability.
    supportsAtomicOperationLease: () => true,
    rows, list,
    async getById<T>(collection: string, id: string) { return ((rows.get(collection) || []).find(item => item.id === id) as T | undefined) ?? null; },
    async create<T>(collection: string, data: Record<string, unknown>) { const item = { id: `${collection}-${(rows.get(collection)?.length || 0) + 1}`, ...data }; rows.set(collection, [...(rows.get(collection) || []), item]); return item as T; },
    async update(collection: string, id: string, data: Record<string, unknown>) { const item = (rows.get(collection) || []).find(row => row.id === id); if (!item) return false; Object.assign(item, data); return true; },
    async delete(collection: string, id: string) { const current = rows.get(collection) || []; const next = current.filter(item => item.id !== id); rows.set(collection, next); return next.length !== current.length; },
  };
}

const task = { publicationTaskId: 'weekly-item-1', motherContentId: 'mother-1', adaptationOfPublicationTaskId: null, platform: 'youtube' as const, accountId: 'account-1', accountPositioning: 'proof', businessProposition: 'verified fact', cta: 'contact us', factRefs: [{ type: 'enterprise_fact', id: 'fact-1', version: 3 }], metricTargets: ['inquiries'], publishWindow: '2026-09-22/2026-09-28', status: 'ready' as const };
const weekly = {
  packageId: 'weekly-package-1', programId: 'program-1', version: 2, status: 'active', weekStart: '2026-09-22', weekEnd: '2026-09-28', objective: 'test',
  enterpriseProfileRef: { type: 'enterprise_profile', id: 'enterprise-1', version: 4 }, businessContentGoalRef: { type: 'business_content_goal', id: 'goal-1', version: 2 }, monthlyPlanRef: null,
  workflows: [], appliedWorkflowEvents: [], taskVersionMappings: [], planningBlockers: [], capacityPlanRef: null, automationPolicyRef: null, discoveryBudgetCny: null,
  workflowTasks: [{ taskId: 'workflow-publishing', kind: 'publishing', taskRef: { type: 'weekly_workflow_task', id: 'workflow-publishing', version: 1 }, dependsOnTaskIds: [], subjectRefs: [], status: 'planned', ownBlockingReasons: [], inheritedBlockingTaskIds: [], carriedFromTaskId: null }],
  socialContentPackage: { contentPackageId: 'content-package-1', operatingPackageId: 'weekly-package-1', version: 2, status: 'active', originalContentTarget: 1, adaptationVersionTarget: 0, publicationTaskTarget: 1, publicationTasks: [task], weeklyBudgetCny: 100, perItemBudgetCny: 100, capacityNotes: [], authorization: { mode: 'bounded', accountIds: ['account-1'], maxPublishItems: 1, weekStart: '2026-09-22', weekEnd: '2026-09-28', allowRealPublishing: true, authorizedBy: 'operator-1', authorizedAt: '2026-09-21T00:00:00Z', revokedBy: null, revokedAt: null } },
  successCriteria: [], changeReason: null, previousVersion: 1, createdBy: 'operator-1', createdAt: '2026-09-21T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z',
} satisfies WeeklyOperatingPackage;
const production: PublishableProductionResult = { productionResultId: 'production-1', contentId: 'content-1', contentVersion: 'v3', contentHash: 'a'.repeat(64), title: 'Title', body: 'Body', assets: [{ kind: 'video', fileName: 'video.mp4', downloadUrl: '/api/overseas/files/video.mp4', contentHash: 'b'.repeat(64) }], sourceRefs: [{ type: 'director_brief', id: 'brief-1', version: 2 }], acceptedAt: '2026-09-21T10:00:00Z' };

const dataStore = memoryStore();
const assignment = buildPublicationAssignment({ tenantId: 'tenant-a', operatingPackage: weekly, publicationTask: task, productionResult: production });
assert.equal((await persistPublicationAssignment(assignment, dataStore)).created, true);
assert.equal((await persistPublicationAssignment(assignment, dataStore)).created, false, 'assignment replay is idempotent');
const packageResult = await createAssignedPublicationPackage({ assignment, productionResult: production }, dataStore);
await markPublicationAssignmentPackageReady('tenant-a', assignment.assignmentId, dataStore);

let publishCalls = 0, reconcileCalls = 0;
const adapter: WeeklyPublishingProviderAdapter = {
  provider: 'mock-provider', platform: 'youtube', capability: 'available',
  async publish() { publishCalls += 1; return { status: 'unknown', providerReceiptId: 'mock-receipt-pending' }; },
  async reconcile() { reconcileCalls += 1; return { status: 'published', providerReceiptId: 'mock-receipt-1', platformPostId: 'mock-post-1', platformUrl: 'https://youtube.com/watch?v=mock-post-1' }; },
};
const unknown = await executeWeeklyPublication({ assignment, publicationPackage: packageResult.package, contentPackage: weekly.socialContentPackage, adapter, existingPublishedCount: 0, now: new Date('2026-09-25T00:00:00Z'), dataStore });
assert.equal(unknown.status, 'unknown');
assert.equal((await executeWeeklyPublication({ assignment, publicationPackage: packageResult.package, contentPackage: weekly.socialContentPackage, adapter, existingPublishedCount: 0, now: new Date('2026-09-25T01:00:00Z'), dataStore })).status, 'unknown');
assert.equal(publishCalls, 1, 'unknown provider outcome is never resubmitted');
const foreignProvider={...adapter,provider:'replacement-provider',async reconcile(){throw Error('a replacement provider must not inspect the original receipt');}};
await assert.rejects(reconcileWeeklyPublication({assignment,publicationPackage:packageResult.package,adapter:foreignProvider,dataStore,now:new Date('2026-09-25T01:30:00Z')}),/publication_receipt_provider_mismatch/);
assert.equal(reconcileCalls,0,'provider identity drift cannot consume or replace the original attempt');
const recovered = await reconcileWeeklyPublication({ assignment, publicationPackage: packageResult.package, adapter, dataStore, now: new Date('2026-09-25T02:00:00Z') });
assert.equal(recovered.status, 'published');
assert.equal(recovered.platform_post_id, 'mock-post-1');
assert.equal(reconcileCalls, 1);
assert.equal(await revokePublicationAssignments({ tenantId: 'tenant-a', operatingPackageId: weekly.packageId, operatingPackageVersion: weekly.version, revokedBy: 'operator-1', dataStore }), 1);
assert.equal(dataStore.rows.get('social_publication_assignments')?.[0]?.status, 'revoked');
assert.equal(dataStore.rows.get('social_publication_attempts')?.[0]?.status, 'published', 'revocation preserves real receipts');

process.env.GOOGLE_CLIENT_ID = 'configured-is-not-proof';
assert.equal(realPublishingCapabilities().find(item => item.platform === 'youtube')?.status, 'unavailable');
assert.equal(realPublishingCapabilities([{ id: 'e1', tenant_id: 'tenant-a', account_id: 'account-1', platform: 'youtube', capability: 'publishing.official', status: 'verified', evidence_source: 'provider_probe', evidence_ref: 'provider:youtube:account:account-1', verified_at: '2026-09-25T23:50:00Z', expires_at: '2026-09-26T00:05:00Z', created_at: '2026-09-25T23:50:00Z', updated_at: '2026-09-25T23:50:00Z' }], new Date('2026-09-26T00:00:00Z')).find(item => item.platform === 'youtube')?.status, 'available');
delete process.env.GOOGLE_CLIENT_ID;

const workerStore = memoryStore();
const lineage: any = {
  schemaVersion: 'social-content-authority-lineage.v1', lineageId: 'lineage-1', version: '1',
  programRef: { type: 'social_program', id: weekly.programId, version: 1 },
  packageRef: { type: 'weekly_operating_package', id: weekly.packageId, version: weekly.version },
  weeklyTaskRef: { type: 'weekly_workflow_task', id: task.publicationTaskId, version: 1 },
  publicationTaskRef: { type: 'publication_task', id: task.publicationTaskId, version: 1 },
  businessGoalRef: weekly.businessContentGoalRef, enterpriseProfileRef: weekly.enterpriseProfileRef,
  enterpriseFactRefs: task.factRefs, referenceSelectionRef: { type: 'reference_selection', id: 'selection-1', version: 1 },
  candidateEvidenceRefs: [], inspirationHandoffRefs: [], directorBriefRef: { type: 'director_brief', id: 'brief-1', version: 2 },
  productionResultRef: { type: 'production_result', id: 'r4-production-1', version: 1 },
  upstreamFingerprint: 'c'.repeat(64), invalidation: { status: 'valid', affectedObjects: [], affectedSceneIds: [], reasons: [] },
  createdAt: '2026-09-25T00:00:00Z', recordHash: '',
};
lineage.recordHash = socialRequestHash((({ recordHash: _ignored, ...payload }) => payload)(lineage));
workerStore.rows.set('social_weekly_operating_packages', [{ id: 'weekly-row-1', tenant_id: 'tenant-a', package_id: weekly.packageId, version: weekly.version, payload: weekly }]);
workerStore.rows.set('starter_social_content_lineage', [{ id: 'lineage-row-1', tenant_id: 'tenant-a', production_result_id: 'r4-production-1', payload: lineage, record_hash: lineage.recordHash }]);
workerStore.rows.set('starter_social_content_artifacts', [{
  id: 'artifact-row-1', tenant_id: 'tenant-a', task_id: task.publicationTaskId, artifact_id: 'artifact-1', version: '1', status: 'approved',
  content_hash: 'd'.repeat(64), updated_at: '2026-09-25T01:00:00Z', content: {
    adaptedScript: 'Approved R4 script', mediaStorage: { video: { url: '/api/overseas/files/r4-video.mp4', sha256: 'e'.repeat(64) } },
    productionResult: { productionResultId: 'r4-production-1', version: '1', executionPlanId: 'plan-1', executionPlanVersion: '1', executionPlanReviewId: 'review-1', artifactId: 'artifact-1', creativeReviewId: 'creative-1', publishAssignmentId: null, status: 'asset_review', sceneResults: [], technicalReview: { approved: true, checkedScenes: 1, failures: [] }, creativeReview: { approved: true, failedCriteria: [], reviewedBy: 'director_agent' }, artifactResourceRef: '/api/overseas/files/r4-video.mp4', createdAt: '2026-09-25T00:30:00Z' },
  },
}]);
// Automatic technical/creative QC does not supply the independent user's acceptance.
const weeklyBoundStore = memoryStore();
for (const [collection, rows] of workerStore.rows) weeklyBoundStore.rows.set(collection, structuredClone(rows));
weeklyBoundStore.rows.set('starter_social_content_tasks', [{ id: 'bound-content-task', tenant_id: 'tenant-a', task_id: task.publicationTaskId, create_idempotency_key: 'weekly-production:tenant-a:weekly-package-1:2:weekly-item-1' }]);
const awaitingAcceptance = await runWeeklyPublicationPackageScan({ dataStore: weeklyBoundStore });
assert.deepEqual({ assignments: awaitingAcceptance.createdAssignments, packages: awaitingAcceptance.createdPackages, skipped: awaitingAcceptance.skipped, errors: awaitingAcceptance.errors.length }, { assignments: 0, packages: 0, skipped: 1, errors: 0 }, 'automatic QC approval must not create a weekly publication package');
const approval = { publicationTaskId: task.publicationTaskId, schedule: { stepKind: 'user_approval' }, status: 'succeeded', resultRefs: [{ type: 'starter_social_content_artifact', id: 'artifact-1', version: 1 }] };
const approvalRow=(id:string,tenantId:string,packageVersion:number,payload:typeof approval)=>({id,tenant_id:tenantId,program_id:weekly.programId,package_id:weekly.packageId,package_version:packageVersion,task_id:id,payload:{...payload,taskId:id,tenantId,programId:weekly.programId,packageId:weekly.packageId,packageVersion,accountId:task.accountId,workflowKind:'approval'}});
weeklyBoundStore.rows.set('social_weekly_execution_tasks', [
  approvalRow('other-tenant-approval','tenant-b',weekly.version,approval),
  approvalRow('other-artifact-approval','tenant-a',weekly.version,{ ...approval, resultRefs: [{ type: 'starter_social_content_artifact', id: 'artifact-old', version: 1 }] }),
  approvalRow('other-artifact-version-approval','tenant-a',weekly.version,{ ...approval, resultRefs: [{ type: 'starter_social_content_artifact', id: 'artifact-1', version: 2 }] }),
  approvalRow('other-package-version-approval','tenant-a',weekly.version-1,approval),
]);
const mismatchedAcceptance = await runWeeklyPublicationPackageScan({ dataStore: weeklyBoundStore });
assert.equal(mismatchedAcceptance.createdPackages, 0, 'cross-tenant, obsolete package, different artifact and wrong artifact version acceptance cannot release packaging');
weeklyBoundStore.rows.get('social_weekly_execution_tasks')!.push(approvalRow('actual-approval','tenant-a',weekly.version,approval));
const acceptedScan = await runWeeklyPublicationPackageScan({ dataStore: weeklyBoundStore });
assert.deepEqual({ assignments: acceptedScan.createdAssignments, packages: acceptedScan.createdPackages, errors: acceptedScan.errors.length }, { assignments: 1, packages: 1, errors: 0 }, 'matching actual user acceptance releases packaging');
const acceptedReplay = await runWeeklyPublicationPackageScan({ dataStore: weeklyBoundStore });
assert.equal(acceptedReplay.createdPackages, 0, 'accepted package reconciliation remains idempotent');
weeklyBoundStore.rows.get('social_weekly_execution_tasks')!.push({
  id: 'formal-weekly-publishing-task', tenant_id: 'tenant-a', program_id: weekly.programId, package_id: weekly.packageId, package_version: weekly.version, task_id: 'formal-weekly-publishing-task',
  payload: { taskId: 'formal-weekly-publishing-task', tenantId: 'tenant-a', programId: weekly.programId, packageId: weekly.packageId, packageVersion: weekly.version, publicationTaskId: task.publicationTaskId, accountId: task.accountId, workflowKind: 'publishing', schedule: { stepKind: 'publishing' }, status: 'blocked' },
});
let legacyAdapterCalls = 0, legacyProviderCalls = 0;
const delegatedExecution = await runWeeklyPublicationExecutionScan({
  dataStore: weeklyBoundStore, now: new Date('2026-09-25T02:00:00Z'),
  adapterFactory: async () => {
    legacyAdapterCalls++;
    return { provider: 'isolated-legacy-test', platform: 'youtube', capability: 'available',
      async publish() { legacyProviderCalls++; return { status: 'published', providerReceiptId: 'unexpected', platformPostId: 'unexpected' }; },
      async reconcile() { legacyProviderCalls++; return { status: 'published', providerReceiptId: 'unexpected', platformPostId: 'unexpected' }; },
    };
  },
});
assert.deepEqual({ skipped: delegatedExecution.skipped, pending: delegatedExecution.pending, published: delegatedExecution.published, errors: delegatedExecution.errors.length }, { skipped: 1, pending: 0, published: 0, errors: 0 }, 'formal weekly publishing task reserves execution for the leased consumer');
assert.equal(legacyAdapterCalls, 0, 'legacy scanner must not admit a provider adapter outside the formal weekly gate');
assert.equal(legacyProviderCalls, 0, 'legacy scanner must not submit or reconcile the delegated assignment');
assert.equal(weeklyBoundStore.rows.get('social_publication_attempts')?.length ?? 0, 0, 'skipping leaves no fabricated provider attempt');

const firstScan = await runWeeklyPublicationPackageScan({ dataStore: workerStore });
assert.deepEqual({ assignments: firstScan.createdAssignments, packages: firstScan.createdPackages, errors: firstScan.errors.length }, { assignments: 1, packages: 1, errors: 0 });
const replayScan = await runWeeklyPublicationPackageScan({ dataStore: workerStore });
assert.deepEqual({ assignments: replayScan.createdAssignments, packages: replayScan.createdPackages }, { assignments: 0, packages: 0 }, 'worker replay is idempotent');

console.log('weekly publication durable runtime tests passed');
