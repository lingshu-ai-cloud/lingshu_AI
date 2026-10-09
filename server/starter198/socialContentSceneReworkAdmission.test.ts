import assert from 'node:assert/strict';
import test from 'node:test';
import { STARTER_198_CAPABILITIES } from '../../shared/contracts/starter198.js';
import type { Starter198AccessSnapshot } from './profile.js';
import { createStarter198Repository } from './repository.js';
import { prepared } from './socialContentSceneReworkService.fixture.js';
import { admitSocialSceneRework } from './socialContentSceneReworkAdmission.js';

const access = (): Starter198AccessSnapshot => ({ recordId: 'access', tenantId: 't', productProfile: 'starter_198',
  profileVersion: 'starter_198.v1', entitlementSnapshotId: 'actual-access', status: 'active',
  cycleStartedAt: new Date(Date.now() - 60_000).toISOString(), cycleEndsAt: new Date(Date.now() + 60_000).toISOString(),
  updatedAt: new Date().toISOString(), entitlements: STARTER_198_CAPABILITIES.map(capability => ({ capability, enabled: true })),
  resourceLimits: { workspaceCount: 1, brandCount: 1, memberCount: 3, agentTeamCount: 1, productCount: 1,
    marketCount: 1, buyerPersonaCount: 2, languageCount: 2, primaryPlatformCount: 2, concurrentRunCount: 1,
    contentArtifactCountPerCycle: 7, contentRevisionCountPerCycle: 3, publicationPackageCountPerContent: 2,
    assistedSessionCount: 5, inquiryAiCountPerCycle: 100, quoteDraftCountPerCycle: 20, highCostVideoCount: 0,
    budgetCnyPerCycle: 100, agentBudgetCny: { orchestrator: 25, content: 25, traffic: 25, sales: 25 } } });

async function setup() {
  const f = await prepared();
  f.tables.workflow_runs = f.tables.workflow_runs!.filter(row => row.id !== 'rework-run');
  const original = f.tables.workflow_runs!.find(row => row.id === 'run')!;
  original.status = 'succeeded';
  const user = f.tables.users!.find(row => row.id === 'owner')!;
  Object.assign(user, { tenantId: 't', role: 'social_operator', active: true });
  await f.service.saveCache(f.context);
  const repository = createStarter198Repository(f.store);
  repository.access = async () => access();
  return { ...f, repository, original, user, input: { repository, tenantId: 't', actorUserId: 'owner', taskId: 'content',
    sourceRunId: 'run', parentArtifactId: 'artifact', affectedSceneIds: ['scene-cta'] } };
}

test('repair admission creates a genuine distinct run and durable job without reviving source; retry is idempotent', async () => {
  const f = await setup();
  try {
    const first = await admitSocialSceneRework(f.input);
    const second = await admitSocialSceneRework(f.input);
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
    await assert.rejects(admitSocialSceneRework(f.input), /actor_forbidden/);
    f.user.role = 'social_operator';
    f.original.status = 'running';
    await assert.rejects(admitSocialSceneRework(f.input), /source_run_not_terminal/);
    f.original.status = 'succeeded';
    f.tables.workflow_runs!.push({ id: 'other-active', tenant_id: 't', status: 'running' });
    await assert.rejects(admitSocialSceneRework(f.input), /concurrent_run_quota_exceeded/);
    assert.equal(f.tables.content_execution_jobs?.length ?? 0, 0);
    assert.equal(f.tables.workflow_runs!.length, 2);
  } finally { await f.cleanup(); }
});
