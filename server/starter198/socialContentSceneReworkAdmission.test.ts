import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { admitSocialSceneRework, confirmSocialSceneReworkAdmissionCost, previewSocialSceneReworkAdmission } from './socialContentSceneReworkAdmission.js';
import { setup, tariff } from './socialContentSceneReworkAdmission.fixture.js';

test('local repair preview writes no run/job; confirmed preview admits one genuine idempotent run/job', async () => {
  const f = await setup();
  try {
    const beforeRuns = f.tables.workflow_runs!.length;
    const preview = await previewSocialSceneReworkAdmission(f.input);
    assert.equal(preview.localOnly, true);
    assert.equal(preview.quote, null);
    assert.equal(f.tables.workflow_runs!.length, beforeRuns);
    assert.equal(f.tables.content_execution_jobs?.length ?? 0, 0);
    const first = await admitSocialSceneRework({ ...f.input, expectedPreviewHash: preview.previewHash });
    const second = await admitSocialSceneRework({ ...f.input, expectedPreviewHash: preview.previewHash });
    assert.notEqual(first.job.runId, 'run');
    assert.equal(first.intent.sourceRunId, 'run');
    assert.equal(first.intent.executionRunId, first.job.runId);
    assert.equal(second.job.id, first.job.id);
    assert.equal(f.original.status, 'succeeded');
    assert.equal(f.tables.workflow_runs!.length, 2);
    assert.equal(f.tables.content_execution_jobs!.length, 1);
  } finally { await f.cleanup(); }
});

test('voice-driven repair without measured voice proof blocks before creating side effects', async () => {
  const f = await setup(true, true, false);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-rework-v3-no-proof-'));
  try {
    const input = {...f.input, env: tariff(), ledgerRoot: root};
    const preview = await previewSocialSceneReworkAdmission(input);
    assert.ok(preview.gaps.includes('scene_rework_measured_voice_proof_missing'));
    await assert.rejects(admitSocialSceneRework({...input, expectedPreviewHash: preview.previewHash}),
      /scene_rework_measured_voice_proof_missing/);
    assert.equal(f.tables.workflow_runs!.length, 1);
    assert.equal(f.tables.content_execution_jobs?.length ?? 0, 0);
    assert.equal(f.tables.starter_social_scene_rework_cost_policies?.length ?? 0, 0);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally { fs.rmSync(root, {recursive:true, force:true}); await f.cleanup(); }
});

test('wrong actor, active source and exhausted actual run quota cannot create a repair run or job', async () => {
  const f = await setup();
  try {
    f.user.role = 'customer_service';
    await assert.rejects(previewSocialSceneReworkAdmission(f.input), /actor_forbidden/);
    f.user.role = 'social_operator';
    f.original.status = 'running';
    await assert.rejects(previewSocialSceneReworkAdmission(f.input), /source_run_not_terminal/);
    f.original.status = 'succeeded';
    f.tables.workflow_runs!.push({ id: 'other-active', tenant_id: 't', status: 'running' });
    const preview = await previewSocialSceneReworkAdmission(f.input);
    await assert.rejects(admitSocialSceneRework({ ...f.input, expectedPreviewHash: preview.previewHash }), /concurrent_run_quota_exceeded/);
    assert.equal(f.tables.content_execution_jobs?.length ?? 0, 0);
    assert.equal(f.tables.workflow_runs!.length, 2);
  } finally { await f.cleanup(); }
});

test('paid repair creates no run/job before immutable confirmation and rejects tariff drift before admission', async () => {
  const f = await setup(true);
  try {
    const env = tariff();
    const input = { ...f.input, env };
    const beforeRuns = f.tables.workflow_runs!.length;
    const preview = await previewSocialSceneReworkAdmission(input);
    assert.equal(preview.localOnly, false);
    assert.equal(preview.quote?.totalUpperBoundCny, 0.25);
    assert.equal(f.tables.workflow_runs!.length, beforeRuns);
    assert.equal(f.tables.content_execution_jobs?.length ?? 0, 0);
    await assert.rejects(admitSocialSceneRework({ ...input, expectedPreviewHash: preview.previewHash }),
      /cost_policy_confirmation_required/);
    assert.equal(f.tables.workflow_runs!.length, beforeRuns);
    assert.equal(f.tables.content_execution_jobs?.length ?? 0, 0);
    const policy = await confirmSocialSceneReworkAdmissionCost({ ...input,
      expectedPreviewHash: preview.previewHash, expectedQuoteHash: preview.quote!.recordHash,
      authorizedMaximumCostCny: preview.quote!.totalUpperBoundCny });
    assert.equal(f.tables.workflow_runs!.length, beforeRuns);
    assert.equal(f.tables.content_execution_jobs?.length ?? 0, 0);
    env.SCENE_REWORK_QWEN_MAX_BILLED_CNY_PER_IMAGE = '0.30';
    await assert.rejects(admitSocialSceneRework({ ...input, expectedPreviewHash: preview.previewHash,
      expectedPolicyHash: policy.recordHash }), /preview_conflict/);
    assert.equal(f.tables.workflow_runs!.length, beforeRuns);
    assert.equal(f.tables.content_execution_jobs?.length ?? 0, 0);
    env.SCENE_REWORK_QWEN_MAX_BILLED_CNY_PER_IMAGE = '0.25';
    const admitted = await admitSocialSceneRework({ ...input, expectedPreviewHash: preview.previewHash,
      expectedPolicyHash: policy.recordHash });
    assert.equal(admitted.intent.executionRunId, preview.executionRunId);
    assert.equal(f.tables.workflow_runs!.length, beforeRuns + 1);
    assert.equal(f.tables.content_execution_jobs!.length, 1);
  } finally { await f.cleanup(); }
});
