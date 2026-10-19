import assert from 'node:assert/strict';
import { test } from 'node:test';
import { store } from '../storage/index.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
import { buildContentQueueProjection, currentGraphReviewState } from './contentQueue.js';

const sha = 'a'.repeat(64);
const task = { id: 'task-row', tenant_id: 't', task_id: 'content', run_id: 'run', status: 'asset_review', brief: { title: '同源成片', _weeklyAuthority: { weeklyPackage: { packageId: 'package' } } } };
function content() {
  return {
    workflowSchema: 'social-content.auto-production.v3',
    productionWorkspaceSource: { type: 'actual_social_render', creationMode: 'material_processing', runId: 'run', outputSha256: sha },
    mediaStorage: { video: { fileId: 'file', sha256: sha } },
    productionResult: { technicalReview: { approved: true, failures: [] }, creativeReview: { approved: true, failedCriteria: [] } },
    technicalQualityReport: { schemaVersion: 'initial-scene-quality.v1', visual: { passed: true, failures: [] }, scenes: { passed: true, issues: [], checkedScenes: 1 }, audio: { ok: true, error: null } },
    render: { completed: true, qualityPassed: true, audioDecoded: true },
    review: { automatedChecksPassed: true, technicalChecksPassed: true, creativeChecksPassed: true, state: 'requires_user_approval' },
    delivery: { status: 'publish_candidate' },
  };
}
test('v3 queue only projects final review after same-run graph quality interrupt', async () => {
  const originalList = store.list, originalGet = store.getById;
  const film = content();
  const artifact = { id: 'artifact-row', tenant_id: 't', task_id: 'content', artifact_id: 'artifact', version: '1', status: 'review_required', origin: 'agent', artifact_kind: 'short_video', resource_ref: 'socialfile:file', content: film,
    get content_hash() { return socialRequestHash({ resourceRef: this.resource_ref, content: this.content }); } };
  const checkpoint = { version: '1', inputHash: sha, updatedAt: '2026-10-18T00:00:00.000Z', payload: { waitingReview: true, runId: 'run', artifactId: 'artifact', version: '1', contentHash: socialRequestHash(film), outputSha256: sha } };
  const job = { id: 'job', tenant_id: 't', job_key: 'job', task_id: 'content', run_id: 'run', user_id: 'owner', account_id: 'account', task_type: 'social_content', status: 'running', checkpoints: {} as Record<string, unknown> };
  const run: { id: string; tenant_id: string; status: string; pause_reason: string | null } = { id: 'run', tenant_id: 't', status: 'running', pause_reason: null };
  try {
    store.list = (async (collection: string) => {
      const items = collection === 'starter_social_content_tasks' ? [task]
        : collection === 'starter_social_content_artifacts' ? [artifact]
        : collection === 'content_execution_jobs' ? [job]
          : collection === 'starter_social_content_files' ? [{ id: 'file-row', tenant_id: 't', task_id: 'content', file_id: 'file', content_sha256: sha, byte_size: 1024 }]
            : [];
      return { items, totalItems: items.length, page: 1, perPage: 500, totalPages: 1 } as any;
    }) as typeof store.list;
    store.getById = (async (collection: string) => collection === 'workflow_runs' ? run : null) as typeof store.getById;
    assert.equal(await currentGraphReviewState(task), 'producing', 'archived film precedes graph QA');
    const projection = () => buildContentQueueProjection({ tenantId: 't', runId: 'run', planBody: {}, tasks: [] });
    assert.equal((await projection()).items[0]?.status, 'producing');
    film.technicalQualityReport.scenes.passed = false;
    assert.equal(await currentGraphReviewState(task), 'blocked', 'failed hard QA cannot be shown as user-reviewable');
    assert.equal((await projection()).items[0]?.status, 'blocked');
    film.technicalQualityReport.scenes.passed = true;
    job.checkpoints['social.graph_review'] = checkpoint;
    job.status = 'paused'; run.status = 'waiting_human'; run.pause_reason = 'langgraph_artifact_review_required';
    assert.equal(await currentGraphReviewState(task), 'waiting_review');
    assert.equal((await projection()).items[0]?.status, 'waiting_review');
    checkpoint.payload.outputSha256 = 'b'.repeat(64);
    assert.equal(await currentGraphReviewState(task), 'blocked', 'checkpoint media must be current');
  } finally { store.list = originalList; store.getById = originalGet; }
});
