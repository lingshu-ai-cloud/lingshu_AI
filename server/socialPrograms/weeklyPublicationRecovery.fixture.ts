import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { DataStore, ListQuery } from '../storage/datastore.js';
import { buildPublicationAssignment, type PublishableProductionResult } from '../digitalEmployees/publishingExecution.js';
import type { WeeklyOperatingPackage, WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';
import { planWeeklyExecutionTasks } from '../socialPrograms/executionTasks.js';
import { createAssignedPublicationPackage, persistPublicationAssignment, markPublicationAssignmentPackageReady, type WeeklyPublishingProviderAdapter } from '../publishing/weeklyLineage.js';
import { createSocialWeeklyPublicationAdapter } from '../runtime/socialWeeklyPublicationAdapter.js';
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

const task = { publicationTaskId: 'weekly-item-1', motherContentId: 'mother-1', adaptationOfPublicationTaskId: null, platform: 'youtube' as const, accountId: 'account-1', accountPositioning: 'proof', businessProposition: 'verified fact', cta: 'contact us', factRefs: [{ type: 'enterprise_fact', id: 'fact-1', version: 3 }], metricTargets: ['inquiries'], publishWindow: '2026-09-22T10:00:00Z', status: 'ready' as const };
const weekly = {
  packageId: 'weekly-package-1', programId: 'program-1', version: 2, status: 'active', weekStart: '2026-09-22', weekEnd: '2026-09-28', objective: 'test',
  enterpriseProfileRef: { type: 'enterprise_profile', id: 'enterprise-1', version: 4 }, businessContentGoalRef: { type: 'business_content_goal', id: 'goal-1', version: 2 }, monthlyPlanRef: null,
  workflows: [], appliedWorkflowEvents: [], taskVersionMappings: [], planningBlockers: [], capacityPlanRef: null, automationPolicyRef: null, discoveryBudgetCny: null,
  workflowTasks: [{ taskId: 'workflow-publishing', kind: 'publishing', taskRef: { type: 'weekly_workflow_task', id: 'workflow-publishing', version: 1 }, dependsOnTaskIds: [], subjectRefs: [], status: 'planned', ownBlockingReasons: [], inheritedBlockingTaskIds: [], carriedFromTaskId: null }],
  socialContentPackage: { contentPackageId: 'content-package-1', operatingPackageId: 'weekly-package-1', version: 2, status: 'active', originalContentTarget: 1, adaptationVersionTarget: 0, publicationTaskTarget: 1, publicationTasks: [task], weeklyBudgetCny: 100, perItemBudgetCny: 100, capacityNotes: [], authorization: { mode: 'bounded', accountIds: ['account-1'], maxPublishItems: 1, weekStart: '2026-09-22', weekEnd: '2026-09-28', allowRealPublishing: true, authorizedBy: 'operator-1', authorizedAt: '2026-09-21T00:00:00Z', revokedBy: null, revokedAt: null } },
  successCriteria: [], changeReason: null, previousVersion: 1, createdBy: 'operator-1', createdAt: '2026-09-21T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z',
} satisfies WeeklyOperatingPackage;
const production: PublishableProductionResult = { productionResultId: 'production-1', contentId: 'content-1', contentVersion: 'v3', contentHash: 'a'.repeat(64), title: 'Title', body: 'Body', assets: [{ kind: 'video', fileName: 'video.mp4', downloadUrl: '/api/overseas/files/video.mp4', contentHash: 'b'.repeat(64) }], sourceRefs: [{ type: 'director_brief', id: 'brief-1', version: 2 }], acceptedAt: '2026-09-21T10:00:00Z' };


export async function publicationRecoveryFixture(context: TestContext) {
  const bytes = Buffer.from('isolated published-media acceptance fixture');
  const mediaHash = createHash('sha256').update(bytes).digest('hex');
  const folder = path.resolve('data/social-content-sources', `weekly-publish-test-${randomUUID()}`);
  const local = path.join(folder, `${mediaHash}.mp4`);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(local, bytes);
  context.after(() => fs.rm(folder, { recursive: true, force: true }));
  const dataStore = memoryStore();
  await dataStore.create('social_weekly_operating_packages', { tenant_id: 'tenant-a', program_id: weekly.programId, package_id: weekly.packageId, version: weekly.version, payload: structuredClone(weekly) });
  const tasks = planWeeklyExecutionTasks('tenant-a', weekly,weekly.createdAt);
  const publicationTask = tasks.find(item => item.schedule.stepKind === 'publishing')!;
  const approval = tasks.find(item => item.schedule.stepKind === 'user_approval')!;
  await dataStore.create('social_weekly_execution_tasks', { tenant_id: 'tenant-a', package_id: weekly.packageId, package_version: weekly.version, payload: { ...approval, status: 'succeeded', resultRefs: [{ type: 'user_content_approval', id: 'approval-1', version: 1 }, { type: 'starter_social_content_artifact', id: 'accepted-artifact', version: 3 }] } });
  for (const dependencyId of publicationTask.dependsOnTaskIds.filter(id => id !== approval.taskId)) {
    const dependency = tasks.find(item => item.taskId === dependencyId);
    assert.ok(dependency, `publishing dependency ${dependencyId} must exist in the planned graph`);
    const completed = { ...dependency, status: 'succeeded' as const, ownBlockingReasons: [], inheritedBlockingTaskIds: [], blockingReasons: [], schedule: { ...dependency.schedule, actualStartedAt: '2026-09-21T08:00:00Z', actualFinishedAt: '2026-09-21T09:00:00Z' } };
    await dataStore.create('social_weekly_execution_tasks', { tenant_id: 'tenant-a', program_id: weekly.programId, package_id: weekly.packageId, package_version: weekly.version, task_id: completed.taskId, status: completed.status, payload: completed });
  }
  await dataStore.create('starter_social_content_tasks', { tenant_id: 'tenant-a', task_id: 'production-task', status: 'asset_review', run_id: 'production-run', brief: { programRef: { id: weekly.programId } }, create_idempotency_key: `weekly-production:${weekly.packageId}:${weekly.version}:${task.publicationTaskId}` });
  await dataStore.create('workflow_runs', { id: 'production-run', tenant_id: 'tenant-a', status: 'succeeded' });
  await dataStore.create('starter_social_content_files', { tenant_id: 'tenant-a', task_id: 'production-task', file_id: 'accepted-file', usage: 'artifact_media', content_sha256: mediaHash, byte_size: bytes.length, storage_kind: 'local', storage_key: path.relative(path.resolve('data/social-content-sources'), local), name: 'video.mp4', mime_type: 'video/mp4' });
  await dataStore.create('starter_social_content_artifacts', { tenant_id: 'tenant-a', task_id: 'production-task', artifact_id: 'accepted-artifact', artifact_kind: 'short_video', origin: 'agent', status: 'approved', version: '3', resource_ref: 'socialfile:accepted-file', content: { render: { completed: true }, mediaStorage: { video: { fileId: 'accepted-file', sha256: mediaHash, url: '/video.mp4' } }, productionResult: { productionResultId: production.productionResultId, technicalReview: { approved: true }, creativeReview: { approved: true } } } });
  const assignment = buildPublicationAssignment({ tenantId: 'tenant-a', operatingPackage: weekly, publicationTask: task, productionResult: production });
  await persistPublicationAssignment(assignment, dataStore);
  await createAssignedPublicationPackage({ assignment, productionResult: production }, dataStore);
  await markPublicationAssignmentPackageReady('tenant-a', assignment.assignmentId, dataStore);
  return { dataStore, tasks, publicationTask, assignment };
}

