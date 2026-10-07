import test from 'node:test';
import assert from 'node:assert/strict';
import type { DataStore, Record_ } from '../storage/datastore.js';
import type { WeeklyExecutionTask } from '../../shared/contracts/socialProgram.js';
import { validateWeeklyExecutionResults } from './socialWeeklyResultValidation.js';
const task = (workflowKind = 'engagement', stepKind = 'performance_monitoring') => ({ tenantId: 'tenant-a', taskId: 'task-a', programId: 'program-a', packageId: 'package-a', packageVersion: 1, accountId: 'account-a', publicationTaskId: 'pub-a', workflowKind, schedule: { stepKind } }) as WeeklyExecutionTask;
function store(rows: Record<string, Record_[]>): DataStore {
  return {
    async getById<T>(collection: string, id: string) { return (rows[collection]?.find(row => row.id === id) ?? null) as T | null; },
    async list<T>(collection: string, query: any = {}) { const items = (rows[collection] ?? []).filter(row => Object.entries(query.where ?? {}).every(([key, value]) => row[key] === value)); return { items: items as T[], totalItems: items.length, totalPages: 1, page: 1, perPage: 2 }; },
  } as DataStore;
}
test('every workflow fails closed on empty, forged or unsupported references', async () => {
  for (const kind of ['readiness', 'discovery', 'directing', 'content', 'publishing', 'engagement', 'review']) {
    for (const refs of [[], [{ type: 'fake', id: 'fake', version: 1 }], [{ type: 'social_metric_snapshot', id: 'fake', version: 1 }]]) {
      await assert.rejects(validateWeeklyExecutionResults(store({}), task(kind), refs));
    }
  }
});
test('metric completion requires real tenant-owned account metrics and valid capture', async () => {
  const row = { id: 'metric', tenant_id: 'tenant-a', account_id: 'account-a', captured_at: '2026-10-01T12:00:00Z', metrics: { views: 0 } };
  const ref = [{ type: 'social_metric_snapshot', id: 'metric', version: 1 }];
  const pkg = [{ id: 'package-row', tenant_id: 'tenant-a', package_id: 'package-a', version: 1, payload: { programId: 'program-a', weekStart: '2026-10-01', weekEnd: '2026-10-07' } }];
  await validateWeeklyExecutionResults(store({ social_metric_snapshots: [row], social_weekly_operating_packages: pkg }), task(), ref);
  for (const changes of [{ tenant_id: 'tenant-b' }, { account_id: 'account-b' }, { metrics: {} }, { metrics: { views: NaN } }, { captured_at: 'invalid' }, { captured_at: '2026-09-01T00:00:00Z' }, { captured_at: '2099-10-01T00:00:00Z' }, { mock: true }, { simulated: true }, { source: 'simulated' }]) {
    await assert.rejects(validateWeeklyExecutionResults(store({ social_metric_snapshots: [{ ...row, ...changes }], social_weekly_operating_packages: pkg }), task(), ref));
  }
});
test('published label alone, ambiguous and simulated receipts cannot complete publication', async () => {
  const ref = [{ type: 'weekly_publication_attempt', id: 'attempt', version: 1 }];
  for (const changes of [{ status: 'unknown' }, { provider_receipt_id: '' }, { provider_receipt_id: 'simr_fake' }, { platform_post_id: '' }, { tenant_id: 'tenant-b' }, { provider: 'mock' }, { provider: 'simulated' }, { simulated: true }, { mock: true }]) {
    const attempt = { id: 'row', tenant_id: 'tenant-a', attempt_id: 'attempt', provider: 'youtube', status: 'published', provider_receipt_id: 'receipt', platform_post_id: 'post', resolved_at: '2026-10-01T00:00:00Z', ...changes };
    await assert.rejects(validateWeeklyExecutionResults(store({ social_publication_attempts: [attempt] }), task('publishing', 'publishing'), ref));
  }
});
test('review requires persisted frozen matching package and tenant snapshot', async () => {
  const ref = [{ type: 'weekly_review_snapshot', id: 'snapshot', version: 1 }];
  const row = { id: 'review', tenant_id: 'tenant-a', package_id: 'package-a', package_version: 1, snapshot_id: 'snapshot', source_digest: 'digest', frozen_by: 'owner', frozen_at: '2026-10-07T00:00:00Z', snapshot: { snapshotId: 'snapshot', tenantId: 'tenant-a', programId: 'program-a', sourceDigest: 'digest', operatingPackageRef: { id: 'package-a', version: 1 }, window: { frozenAt: '2026-10-07T00:00:00Z' } } };
  await validateWeeklyExecutionResults(store({ social_weekly_review_snapshots: [row] }), task('review', 'weekly_review'), ref);
  for (const changes of [{ package_version: 2 }, { tenant_id: 'tenant-b' }, { frozen_by: '' }, { snapshot: {} }]) await assert.rejects(validateWeeklyExecutionResults(store({ social_weekly_review_snapshots: [{ ...row, ...changes }] }), task('review', 'weekly_review'), ref));
});

test('all automatic content steps require actual persisted media, identity and step evidence', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { createHash, randomUUID } = await import('node:crypto');
  const bytes = Buffer.from('isolated validation fixture');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const folder = path.resolve('data/social-content-sources', `d06-test-${randomUUID()}`);
  const local = path.join(folder, `${hash}.mp4`);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(local, bytes);
  const file = { id: 'file-row', file_id: 'file', task_id: 'source', tenant_id: 'tenant-a', usage: 'artifact_media', name: 'video.mp4', mime_type: 'video/mp4', byte_size: bytes.length, content_sha256: hash, storage_kind: 'local', storage_key: path.relative(path.resolve('data/social-content-sources'), local) };
  const content = { render: { completed: true, selectedAssetIds: ['asset'] }, scriptBaseline: { scenes: [{ script: 'Verified script' }] }, directorPlan: { sceneCount: 1 }, mediaStorage: { video: { fileId: 'file', url: '/video', sha256: hash } }, productionResult: { technicalReview: { approved: true }, creativeReview: { approved: true } } };
  const artifact = { id: 'artifact-row', tenant_id: 'tenant-a', task_id: 'source', artifact_id: 'artifact', artifact_kind: 'short_video', origin: 'agent', resource_ref: 'socialfile:file', version: '1', status: 'review_required', content };
  const source = { id: 'source-row', tenant_id: 'tenant-a', task_id: 'source', status: 'asset_review', run_id: 'run', create_idempotency_key: 'weekly-production:package-a:1:pub-a', brief: { programRef: { id: 'program-a' } } };
  const ref = [{ type: 'starter_social_content_artifact', id: 'artifact', version: 1 }];
  const rows = { workflow_runs: [{ id: 'run', tenant_id: 'tenant-a', status: 'succeeded' }], starter_social_content_artifacts: [artifact], starter_social_content_tasks: [source], starter_social_content_files: [file] };
  try {
    for (const step of ['script', 'storyboard', 'asset_generation', 'video_generation', 'quality_check', 'rework']) await validateWeeklyExecutionResults(store(rows), task('content', step), ref);
    for (const changes of [{ tenant_id: 'tenant-b' }, { version: '2' }, { status: 'superseded' }, { task_id: 'another-source' }]) await assert.rejects(validateWeeklyExecutionResults(store({ ...rows, starter_social_content_artifacts: [{ ...artifact, ...changes }] }), task('content', 'video_generation'), ref));
    await assert.rejects(validateWeeklyExecutionResults(store({ ...rows, starter_social_content_artifacts: [{ ...artifact, content: { ...content, productionResult: { technicalReview: { approved: false }, creativeReview: { approved: true } } } }] }), task('content', 'quality_check'), ref));
    const publishingRows = {
      ...rows,
      starter_social_content_artifacts: [{ ...artifact, status: 'approved', content: { ...content, productionResult: { ...content.productionResult, productionResultId: 'production' } } }],
      social_publication_attempts: [{ id: 'receipt-row', tenant_id: 'tenant-a', attempt_id: 'attempt', assignment_id: 'assignment', package_id: 'publication-package', status: 'published', provider: 'youtube', provider_receipt_id: 'real-receipt', platform_post_id: 'real-post', resolved_at: '2026-10-01T00:00:00Z' }],
      social_publication_assignments: [{ id: 'assignment-row', tenant_id: 'tenant-a', assignment_id: 'assignment', package_id: 'publication-package', operating_package_id: 'package-a', operating_package_version: 1, publication_task_id: 'pub-a', account_id: 'account-a', status: 'package_ready', production_result_id: 'production' }],
      social_weekly_operating_packages: [{ id: 'package-row', tenant_id: 'tenant-a', package_id: 'package-a', version: 1, payload: { socialContentPackage: { authorization: { allowRealPublishing: true, accountIds: ['account-a'] } } } }],
      social_weekly_execution_tasks: [{ id: 'approval-row', tenant_id: 'tenant-a', package_id: 'package-a', package_version: 1, payload: { tenantId: 'tenant-a', publicationTaskId: 'pub-a', schedule: { stepKind: 'user_approval' }, status: 'succeeded', resultRefs: [{ type: 'user_content_approval', id: 'approval', version: 1 }, ...ref] } }],
    };
    const publishRef = [{ type: 'weekly_publication_attempt', id: 'attempt', version: 1 }];
    await validateWeeklyExecutionResults(store(publishingRows), task('publishing', 'publishing'), publishRef);
    await assert.rejects(validateWeeklyExecutionResults(store({ ...publishingRows, social_weekly_execution_tasks: [] }), task('publishing', 'publishing'), publishRef));
    await assert.rejects(validateWeeklyExecutionResults(store({ ...publishingRows, social_publication_assignments: [{ ...publishingRows.social_publication_assignments[0]!, production_result_id: 'forged' }] }), task('publishing', 'publishing'), publishRef));
    await fs.unlink(local);
    await assert.rejects(validateWeeklyExecutionResults(store(publishingRows), task('publishing', 'publishing'), publishRef));
    await assert.rejects(validateWeeklyExecutionResults(store(rows), task('content', 'video_generation'), ref));
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

test('planning completion requires actual dispatched, confirmed matching step evidence', async () => {
  const row = { id: 'planning-row', tenant_id: 'tenant-a', program_id: 'program-a', package_id: 'package-a', package_version: 1, planning_version: 2,
    payload: { planningId: 'plan', version: 2, status: 'dispatched', userConfirmation: { confirmedBy: 'owner', confirmedAt: '2026-10-01T00:00:00Z' }, skeleton: { slots: [{ slotId: 'slot', motherContentId: 'mother', accountIds: ['account-a'], publicationTaskIds: ['pub-a'] }] }, directorAnalyses: [{ slotId: 'slot', packageVersion: 1, benchmarkAccountRefs: ['account'], benchmarkVideoRefs: ['video'], benchmarkEvidenceRefs: ['evidence'], contentDirection: 'direction' }], detailedSchedule: { items: [{ publicationTaskId: 'pub-a' }] }, dispatch: { scheduleItems: [{ publicationTaskId: 'pub-a' }] } } };
  const refs = [{ type: 'weekly_agent_planning', id: 'plan', version: 2 }];
  for (const [kind, step] of [['readiness', 'business_outline'], ['discovery', 'benchmark_collection'], ['directing', 'benchmark_scoring'], ['directing', 'director_analysis'], ['directing', 'business_schedule']]) {
    const target = { ...task(kind, step), inputSnapshot: { motherContentId: 'mother' } };
    await validateWeeklyExecutionResults(store({ social_weekly_agent_planning: [row] }), target, refs);
    await assert.rejects(validateWeeklyExecutionResults(store({ social_weekly_agent_planning: [{ ...row, payload: { ...row.payload, status: 'confirmed' } }] }), target, refs));
    await assert.rejects(validateWeeklyExecutionResults(store({ social_weekly_agent_planning: [{ ...row, tenant_id: 'tenant-b' }] }), target, refs));
  }
});
