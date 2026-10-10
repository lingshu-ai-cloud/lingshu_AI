import assert from 'node:assert/strict';
import test from 'node:test';
import { STARTER_198_CAPABILITIES } from '../../shared/contracts/starter198.js';
import type { Starter198AccessSnapshot } from './profile.js';
import { createStarter198Repository } from './repository.js';
import { prepared } from './socialContentSceneReworkService.fixture.js';
import { admitSocialSceneRework, confirmSocialSceneReworkAdmissionCost, previewSocialSceneReworkAdmission } from './socialContentSceneReworkAdmission.js';

const access = (): Starter198AccessSnapshot => ({ recordId: 'access', tenantId: 't', productProfile: 'starter_198',
  profileVersion: 'starter_198.v1', entitlementSnapshotId: 'actual-access', status: 'active',
  cycleStartedAt: new Date(Date.now() - 60_000).toISOString(), cycleEndsAt: new Date(Date.now() + 60_000).toISOString(),
  updatedAt: new Date().toISOString(), entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
  resourceLimits: { workspaceCount: 1, brandCount: 1, memberCount: 3, agentTeamCount: 1, productCount: 1,
    marketCount: 1, buyerPersonaCount: 2, languageCount: 2, primaryPlatformCount: 2, concurrentRunCount: 1,
    contentArtifactCountPerCycle: 7, contentRevisionCountPerCycle: 3, publicationPackageCountPerContent: 2,
    assistedSessionCount: 5, inquiryAiCountPerCycle: 100, quoteDraftCountPerCycle: 20, highCostVideoCount: 0,
    budgetCnyPerCycle: 100, agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 } } });

async function setup(paid = false) {
  const f = await prepared(paid);
  f.tables.workflow_runs = f.tables.workflow_runs!.filter(row => row.id !== 'rework-run');
  const original = f.tables.workflow_runs!.find(row => row.id === 'run')!;
  original.status = 'succeeded';
  const user = f.tables.users!.find(row => row.id === 'owner')!;
  Object.assign(user, { tenantId: 't', role: 'social_operator', active: true });
  await f.service.saveCache(f.context);
  const repository = createStarter198Repository(f.store);
  repository.access = async () => access();
  return { ...f, repository, original, user, input: { repository, tenantId: 't', actorUserId: 'owner', taskId: 'content',
    sourceRunId: 'run', parentArtifactId: 'artifact',
    affectedSceneIds: [paid ? 'scene-transition' : 'scene-cta'] } };
}

const tariff = () => ({ QWEN_IMAGE_MODEL: 'qwen-image-3.0', SCENE_REWORK_QWEN_TARIFF_MODEL: 'qwen-image-3.0',
  SCENE_REWORK_QWEN_MAX_BILLED_CNY_PER_IMAGE: '0.25',
  SCENE_REWORK_QWEN_TARIFF_SOURCE_REF: 'server-approved-contract-v1', SCENE_REWORK_QWEN_TARIFF_VERSION: '1',
  SCENE_REWORK_QWEN_TARIFF_VALID_UNTIL: new Date(Date.now() + 3_600_000).toISOString() });

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
