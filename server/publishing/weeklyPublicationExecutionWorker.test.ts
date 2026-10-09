import assert from 'node:assert/strict';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { buildPublicationAssignment, type PublishableProductionResult } from '../digitalEmployees/publishingExecution.js';
import { sealAccountCredential } from '../lib/accountCredentials.js';
import type { WeeklyOperatingPackage } from '../../shared/contracts/socialProgram.js';
import { createAssignedPublicationPackage, markPublicationAssignmentPackageReady, persistPublicationAssignment, PUBLICATION_ASSIGNMENTS, PUBLICATION_ATTEMPTS, type StoredPublicationAssignment, type WeeklyPublishingProviderAdapter } from './weeklyLineage.js';
import { runWeeklyPublicationExecutionScan } from './weeklyPublicationExecutionWorker.js';

type Row = { id: string; [key: string]: any };
function memoryStore(): DataStore & { rows: Map<string, Row[]> } {
  const rows = new Map<string, Row[]>();
  return {
    rows,
    async list<T>(collection: string, query: ListQuery = {}) {
      let items = [...(rows.get(collection) || [])];
      for (const [key, value] of Object.entries(query.where || {})) items = items.filter(item => item[key] === value);
      if (query.sort) { const desc = query.sort.startsWith('-'), key = desc ? query.sort.slice(1) : query.sort; items.sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (desc ? -1 : 1)); }
      const page = query.page ?? 1, perPage = query.perPage ?? 500, totalItems = items.length;
      return { items: items.slice((page - 1) * perPage, page * perPage) as T[], totalItems, totalPages: Math.ceil(totalItems / perPage), page, perPage };
    },
    async getById<T>(collection: string, id: string) { return ((rows.get(collection) || []).find(item => item.id === id) as T | undefined) ?? null; },
    async create<T>(collection: string, data: Record<string, unknown>) { const item = { id: `${collection}-${(rows.get(collection)?.length || 0) + 1}`, ...data }; rows.set(collection, [...(rows.get(collection) || []), item]); return item as T; },
    async update(collection: string, id: string, data: Record<string, unknown>) { const item = (rows.get(collection) || []).find(row => row.id === id); if (!item) return false; Object.assign(item, data); return true; },
    async delete(collection:string,id:string) {const before=rows.get(collection)||[];const after=before.filter(row=>row.id!==id);rows.set(collection,after);return after.length!==before.length;},
  };
}

const task = (id: string, accountId: string) => ({ publicationTaskId: id, motherContentId: `mother-${id}`, adaptationOfPublicationTaskId: null, platform: 'tiktok' as const, accountId, accountPositioning: 'proof', businessProposition: 'verified', cta: 'contact', factRefs: [{ type: 'enterprise_fact' as const, id: 'fact-1', version: 1 }], metricTargets: ['inquiries'], publishWindow: '2026-09-22/2026-09-28', status: 'ready' as const });
const tasks = [task('task-1', 'account-1'), task('task-2', 'account-2')];
const weekly: WeeklyOperatingPackage = {
  packageId: 'weekly-1', programId: 'program-1', version: 1, status: 'active', weekStart: '2026-09-22', weekEnd: '2026-09-28', objective: 'worker test',
  enterpriseProfileRef: { type: 'enterprise_profile', id: 'enterprise-1', version: 1 }, businessContentGoalRef: { type: 'business_content_goal', id: 'goal-1', version: 1 }, monthlyPlanRef: null,
  workflows: [], appliedWorkflowEvents: [], taskVersionMappings: [], planningBlockers: [], capacityPlanRef: null, automationPolicyRef: null, discoveryBudgetCny: null,
  workflowTasks: tasks.map(item => ({ taskId: `workflow-${item.publicationTaskId}`, kind: 'publishing' as const, taskRef: { type: 'weekly_workflow_task' as const, id: `workflow-${item.publicationTaskId}`, version: 1 }, dependsOnTaskIds: [], subjectRefs: [], status: 'planned' as const, ownBlockingReasons: [], inheritedBlockingTaskIds: [], carriedFromTaskId: null })),
  socialContentPackage: { contentPackageId: 'content-package-1', operatingPackageId: 'weekly-1', version: 1, status: 'active', originalContentTarget: 2, adaptationVersionTarget: 0, publicationTaskTarget: 2, publicationTasks: tasks, weeklyBudgetCny: 100, perItemBudgetCny: 50, capacityNotes: [], authorization: { mode: 'bounded', accountIds: ['account-1', 'account-2'], maxPublishItems: 2, weekStart: '2026-09-22', weekEnd: '2026-09-28', allowRealPublishing: true, authorizedBy: 'operator', authorizedAt: '2026-09-21T00:00:00Z', revokedBy: null, revokedAt: null } },
  successCriteria: [], changeReason: null, previousVersion: null, createdBy: 'operator', createdAt: '2026-09-21T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z',
};
const production = (id: string): PublishableProductionResult => ({ productionResultId: `production-${id}`, contentId: `content-${id}`, contentVersion: '1', contentHash: id.repeat(64).slice(0, 64), title: `Title ${id}`, body: 'Body', assets: [{ kind: 'video', fileName: `${id}.mp4`, downloadUrl: `https://media.example/${id}.mp4`, contentHash: 'a'.repeat(64) }], sourceRefs: [], acceptedAt: '2026-09-21T10:00:00Z' });

async function seed(store: ReturnType<typeof memoryStore>, weeklyPackage = weekly) {
  store.rows.set('social_weekly_operating_packages', [{ id: 'weekly-row', tenant_id: 'tenant-a', package_id: weeklyPackage.packageId, version: weeklyPackage.version, payload: weeklyPackage }]);
  const assignments = [];
  for (let index = 0; index < weeklyPackage.socialContentPackage.publicationTasks.length; index += 1) {
    const publicationTask = weeklyPackage.socialContentPackage.publicationTasks[index]!;
    const result = production(String(index + 1));
    const assignment = buildPublicationAssignment({ tenantId: 'tenant-a', operatingPackage: weeklyPackage, publicationTask, productionResult: result });
    await persistPublicationAssignment(assignment, store);
    await createAssignedPublicationPackage({ assignment, productionResult: result }, store);
    await markPublicationAssignmentPackageReady('tenant-a', assignment.assignmentId, store);
    assignments.push(assignment);
  }
  return assignments;
}

const store = memoryStore();
const [first, second] = await seed(store);
let publishCalls = 0, reconcileCalls = 0;
const adapter: WeeklyPublishingProviderAdapter = { provider: 'controlled-tiktok-port', platform: 'tiktok', capability: 'available', async publish() { publishCalls += 1; return { status: 'accepted', providerReceiptId: `receipt-${publishCalls}` }; }, async reconcile({ attempt }) { reconcileCalls += 1; return { status: 'published', providerReceiptId: attempt.provider_receipt_id, platformPostId: `post-${reconcileCalls}` }; } };
const onlyFirst = async (row: StoredPublicationAssignment) => row.assignment_id === first!.assignmentId ? adapter : { ...adapter, capability: 'unavailable' as const, unavailableReason: 'not_selected' };
let scan = await runWeeklyPublicationExecutionScan({ dataStore: store, now: new Date('2026-09-25T00:00:00Z'), adapterFactory: onlyFirst });
assert.equal(scan.pending, 1); assert.equal(publishCalls, 1); assert.equal(reconcileCalls, 0);
scan = await runWeeklyPublicationExecutionScan({ dataStore: store, now: new Date('2026-09-25T00:01:00Z'), adapterFactory: onlyFirst });
assert.equal(scan.published, 1); assert.equal(publishCalls, 1, 'unknown attempt must not publish again'); assert.equal(reconcileCalls, 1);
await runWeeklyPublicationExecutionScan({ dataStore: store, now: new Date('2026-09-25T00:02:00Z'), adapterFactory: onlyFirst });
assert.equal(publishCalls, 1, 'terminal replay must not publish again'); assert.equal(reconcileCalls, 1, 'terminal replay must not reconcile again');

const secondRow = store.rows.get(PUBLICATION_ASSIGNMENTS)!.find(row => row.assignment_id === second!.assignmentId)!;
store.rows.set(PUBLICATION_ATTEMPTS, [...store.rows.get(PUBLICATION_ATTEMPTS)!, { id: 'in-flight-second', tenant_id: 'tenant-a', attempt_id: 'attempt-second', assignment_id: second!.assignmentId, package_id: second!.packageId, provider: adapter.provider, status: 'in_flight', provider_receipt_id: 'receipt-in-flight', started_at: '2026-09-25T00:02:30Z', updated_at: '2026-09-25T00:02:30Z' }]);
await runWeeklyPublicationExecutionScan({ dataStore: store, now: new Date('2026-09-25T00:02:45Z'), adapterFactory: async () => adapter });
assert.equal(publishCalls, 1, 'in-flight attempt must only reconcile'); assert.equal(reconcileCalls, 2);
store.rows.set(PUBLICATION_ATTEMPTS, store.rows.get(PUBLICATION_ATTEMPTS)!.filter(row => row.assignment_id !== second!.assignmentId));
Object.assign(secondRow, { status: 'revoked' });
await runWeeklyPublicationExecutionScan({ dataStore: store, now: new Date('2026-09-25T00:03:00Z'), adapterFactory: async () => adapter });
assert.equal(publishCalls, 1, 'revoked assignment is outside the ready scan');

// A one-item weekly limit blocks the remaining ready assignment after the first terminal publish.
Object.assign(secondRow, { status: 'package_ready' });
const weeklyRow = store.rows.get('social_weekly_operating_packages')![0]!;
weeklyRow.payload = { ...weekly, socialContentPackage: { ...weekly.socialContentPackage, authorization: { ...weekly.socialContentPackage.authorization, maxPublishItems: 1 } } };
scan = await runWeeklyPublicationExecutionScan({ dataStore: store, now: new Date('2026-09-25T00:04:00Z'), adapterFactory: async () => adapter });
assert.equal(scan.errors.some(item => item.assignmentId === second!.assignmentId && item.code === 'authorization_limit_exceeded'), true);
assert.equal(publishCalls, 1);

// Persisted row/payload tenant disagreement cannot cross tenant scope.
Object.assign(secondRow, { tenant_id: 'tenant-b', status: 'package_ready' });
scan = await runWeeklyPublicationExecutionScan({ dataStore: store, now: new Date('2026-09-25T00:05:00Z'), adapterFactory: async () => adapter });
assert.equal(scan.errors.some(item => item.assignmentId === second!.assignmentId), true);
assert.equal(publishCalls, 1);

// The production factory reads the existing camelCase account shape and fails closed without both probes.
process.env.PLATFORM_TOKEN_ENCRYPTION_KEY = 'weekly-worker-test-key';
const permissionStore = memoryStore();
await seed(permissionStore, { ...weekly, socialContentPackage: { ...weekly.socialContentPackage, publicationTasks: [tasks[0]!], publicationTaskTarget: 1, originalContentTarget: 1, authorization: { ...weekly.socialContentPackage.authorization, accountIds: ['account-1'], maxPublishItems: 1 } } });
permissionStore.rows.set('social_accounts', [{ id: 'account-1', tenantId: 'tenant-a', platform: 'tiktok', status: 'connected', accessToken: sealAccountCredential('token') }]);
permissionStore.rows.set('social_platform_capability_evidence', [{ id: 'publish-probe', tenant_id: 'tenant-a', account_id: 'account-1', platform: 'tiktok', capability: 'publishing.official', status: 'verified', evidence_source: 'provider_probe', evidence_ref: 'provider:tiktok:account:account-1', verified_at: '2026-09-25T00:50:00Z', expires_at: '2026-09-25T01:05:00Z', created_at: '2026-09-25T00:50:00Z', updated_at: '2026-09-25T00:50:00Z' }]);
scan = await runWeeklyPublicationExecutionScan({ dataStore: permissionStore, now: new Date('2026-09-25T01:00:00Z') });
assert.equal(scan.errors.some(item => item.code === 'provider_capability_not_verified'), false, 'a first TikTok publish must not require a receipt that cannot exist yet');
assert.equal(permissionStore.rows.get(PUBLICATION_ATTEMPTS)?.length ?? 0, 1, 'the official publish probe opens the durable first-attempt path; receipt lookup is checked only during reconciliation');

// The execution worker routes every first-release platform through the same
// durable assignment/authorization path instead of silently skipping it.
for (const platform of ['youtube', 'instagram', 'facebook'] as const) {
  const platformStore = memoryStore();
  const platformTask = { ...task(`task-${platform}`, `account-${platform}`), platform };
  const platformWeekly = {
    ...weekly,
    packageId: `weekly-${platform}`,
    workflowTasks: [{ ...weekly.workflowTasks[0]!, taskId: `workflow-${platform}`, taskRef: { type: 'weekly_workflow_task' as const, id: `workflow-${platform}`, version: 1 } }],
    socialContentPackage: {
      ...weekly.socialContentPackage, operatingPackageId: `weekly-${platform}`,
      publicationTasks: [platformTask], publicationTaskTarget: 1, originalContentTarget: 1,
      authorization: { ...weekly.socialContentPackage.authorization, accountIds: [`account-${platform}`], maxPublishItems: 1 },
    },
  } satisfies WeeklyOperatingPackage;
  await seed(platformStore, platformWeekly);
  let platformPublishCalls = 0;
  const platformAdapter: WeeklyPublishingProviderAdapter = {
    provider: `${platform}-official-api`, platform, capability: 'available',
    async publish() { platformPublishCalls += 1; return { status: 'published', providerReceiptId: `${platform}-post-1`, platformPostId: `${platform}-post-1` }; },
    async reconcile() { return { status: 'unknown' }; },
  };
  const platformScan = await runWeeklyPublicationExecutionScan({
    dataStore: platformStore,
    now: new Date('2026-09-25T00:04:00Z'),
    adapterFactory: async () => platformAdapter,
  });
  assert.equal(platformScan.published, 1, `${platform} assignment must execute through the weekly worker: ${JSON.stringify(platformScan)}`);
  assert.equal(platformPublishCalls, 1);
}

console.log('weekly publication execution worker tests passed');
