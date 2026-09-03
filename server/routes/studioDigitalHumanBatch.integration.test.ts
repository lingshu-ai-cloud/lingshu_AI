import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { DIGITAL_HUMAN_PIPELINE_VERSION } from '../../src/lib/digitalHumanPipeline.js';
import { shotDigitalHumanSourceFingerprint } from '../../src/lib/shotDigitalHuman.js';
import {
  DIGITAL_HUMAN_MOUTH_STABILIZATION_ALGORITHM_VERSION,
  DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256,
} from '../lib/digitalHumanMouthStabilization.js';

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-digital-human-batch-'));
const materialsFile = path.join(testRoot, 'materials.json');
const jobsFile = path.join(testRoot, 'digital-human-jobs.json');
const localStoreDir = path.join(testRoot, 'local-store');
const now = '2026-09-03T00:00:00.000Z';

const avatar = (id: string, scope: 'shared' | 'own', tenantId?: string) => ({
  id,
  name: `${id}.mp4`,
  folder: 'presenter',
  type: 'video',
  duration: 12,
  size: '1 MB',
  file: `${id}.mp4`,
  url: `/media/${id}.mp4`,
  scope,
  ...(tenantId ? { tenantId } : {}),
  usage: 'editable',
  sourceType: 'licensed-avatar-master',
  assetRole: 'avatar_master',
  rightsStatus: 'commercial_cleared',
  avatarId: id,
  avatarVersion: 3,
  sourceHash: id === 'avatar-shared' ? 'a'.repeat(64) : 'b'.repeat(64),
  rightsUsageScope: ['internal_preview'],
  productionReady: true,
  createdAt: now,
});

fs.writeFileSync(materialsFile, JSON.stringify([
  avatar('avatar-shared', 'shared'),
  avatar('avatar-tenant-a', 'own', 'tenant-a'),
], null, 2));
fs.mkdirSync(localStoreDir, { recursive: true });
fs.writeFileSync(path.join(localStoreDir, 'studio_projects.json'), JSON.stringify([
  { id: 'project-1', tenant_id: 'tenant-a' },
  { id: 'tenant-b-project', tenant_id: 'tenant-b' },
  { id: 'capacity-project', tenant_id: 'tenant-capacity' },
], null, 2));

Object.assign(process.env, {
  NODE_ENV: 'test',
  SUBSCRIPTION_ENFORCED: 'false',
  DEMO_MODE: 'false',
  DIGITAL_HUMAN_PULL_WORKER_ENABLED: 'true',
  DIGITAL_HUMAN_WORKER_KEY: 'batch-http-worker-key',
  STUDIO_MATERIALS_FILE: materialsFile,
  DIGITAL_HUMAN_JOBS_FILE: jobsFile,
  LINGSHU_LOCAL_STORE_DIR: localStoreDir,
});

function localToken(tenantId: string): string {
  const identity = { userId: `user-${tenantId}`, tenantId };
  return `local-demo.${Buffer.from(JSON.stringify(identity), 'utf8').toString('base64url')}`;
}

function headers(tenantId: string): Record<string, string> {
  return { authorization: `Bearer ${localToken(tenantId)}`, 'content-type': 'application/json' };
}

function performancePlan(label = 'default') {
  return {
    schemaVersion: 'performance-v1',
    durationMs: 3_200,
    preset: 'commerce',
    variationSeed: 0,
    scene: { camera: 'static', composition: 'medium', label },
    beats: [{
      id: 'beat-1', startMs: 0, endMs: 3_200,
      expression: 'neutral', head: 'steady', gaze: 'camera', gesture: 'open_palm', actionPeakMs: 1_600,
    }],
  };
}

function variant(tenantId: string, language: string, overrides: Record<string, unknown> = {}) {
  return {
    language,
    voiceoverUrl: `/tts/tenants/${encodeURIComponent(tenantId)}/voice-${language}.wav`,
    script: `script-${language}`,
    audioStartSeconds: 0,
    audioEndSeconds: 3.2,
    inputSignature: `untrusted-client-${language}`,
    performancePlanVersion: 'performance-v1',
    performancePlan: performancePlan(),
    pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
    ...overrides,
  };
}

function batchBody(tenantId: string, variants: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'project-1',
    storyboardSlotId: 'shot-1',
    avatarMaterialId: 'avatar-shared',
    mode: 'quality',
    usagePurpose: 'internal_preview',
    consentConfirmed: true,
    variants,
    ...overrides,
  };
}

function persistedJobs(): any[] {
  if (!fs.existsSync(jobsFile)) return [];
  return JSON.parse(fs.readFileSync(jobsFile, 'utf8')) as any[];
}

const { studioRouter } = await import('./studio.js');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/studio', studioRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});

try {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}/studio`;

  const presence = await fetch(`${baseUrl}/digital-human/worker/presence`, {
    method: 'POST',
    headers: { authorization: 'Bearer batch-http-worker-key', 'content-type': 'application/json' },
    body: JSON.stringify({
      workerId: 'batch-http-worker',
      health: {
        schemaVersion: 'digital-human-worker-presence-v2',
        pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
        runnerConfigured: true,
        mouthStabilizerConfigured: true,
        mouthStabilizerAlgorithmVersion: DIGITAL_HUMAN_MOUTH_STABILIZATION_ALGORITHM_VERSION,
        mouthStabilizerScriptSha256: DIGITAL_HUMAN_MOUTH_STABILIZER_RELEASE_SCRIPT_SHA256,
        gpu: { available: true, name: 'test-gpu', totalVramMb: 8192, freeVramMb: 8192 },
        disk: { freeBytes: 20 * 1024 ** 3 },
        validatorConfigured: true,
        validatorVersion: 'test-validator-v1',
        gateVersion: 'test-gate-v1',
        reportedAt: new Date().toISOString(),
      },
    }),
  });
  assert.equal(presence.status, 200, await presence.text());

  const claim = await fetch(`${baseUrl}/digital-human/worker/claim?workerId=batch-http-worker`, {
    headers: { authorization: 'Bearer batch-http-worker-key' },
  });
  assert.equal(claim.status, 204, 'a preflight-ready authenticated worker may claim');

  const postBatch = async (tenantId: string, body: unknown) => {
    const response = await fetch(`${baseUrl}/digital-human/job-batches`, {
      method: 'POST', headers: headers(tenantId), body: JSON.stringify(body),
    });
    return { response, body: await response.json() as any };
  };

  const missingProject = await postBatch('tenant-a', batchBody('tenant-a', [variant('tenant-a', 'zh')], { projectId: '' }));
  assert.equal(missingProject.response.status, 400);
  assert.equal(missingProject.body.code, 'DIGITAL_HUMAN_PROJECT_REQUIRED');
  const foreignProject = await postBatch('tenant-b', batchBody('tenant-b', [variant('tenant-b', 'zh')], { projectId: 'project-1' }));
  assert.equal(foreignProject.response.status, 404);
  assert.equal(foreignProject.body.code, 'DIGITAL_HUMAN_PROJECT_NOT_FOUND');
  assert.deepEqual(persistedJobs(), [], 'missing/cross-tenant projects must create zero jobs');

  // Atomic validation: a valid first child must not leak into persistence when
  // a later child is invalid.
  const invalid = await postBatch('tenant-a', batchBody('tenant-a', [
    variant('tenant-a', 'zh'),
    variant('tenant-a', 'en', { voiceoverUrl: '/tts/tenants/tenant-b/foreign.wav' }),
  ]));
  assert.equal(invalid.response.status, 400, JSON.stringify(invalid.body));
  assert.equal(invalid.body.code, 'INVALID_VOICEOVER');
  assert.deepEqual(persistedJobs(), [], 'an invalid child must create zero siblings');

  const oldPipeline = await postBatch('tenant-a', batchBody('tenant-a', [
    variant('tenant-a', 'zh', { pipelineVersion: 'digital-human-v2-p0' }),
  ]));
  assert.equal(oldPipeline.response.status, 400, JSON.stringify(oldPipeline.body));
  assert.equal(oldPipeline.body.code, 'UNSUPPORTED_PIPELINE_VERSION');
  assert.deepEqual(persistedJobs(), [], 'P0不得冒用P1链路或污染P1缓存');

  // First request creates. Exact replay reuses. A malicious/stale browser
  // signature cannot select the old job after a server-owned field changes.
  const originalRequest = batchBody('tenant-a', [variant('tenant-a', 'zh', { inputSignature: 'client-controlled' })]);
  const first = await postBatch('tenant-a', originalRequest);
  assert.equal(first.response.status, 202, JSON.stringify(first.body));
  assert.equal(first.body.batch.createdJobIds.length, 1);
  assert.equal(first.body.batch.reusedJobIds.length, 0);
  const firstJobId = first.body.jobs[0].id;
  assert.equal(first.body.jobs[0].canonicalInputSignature, undefined, 'server reuse hashes are private implementation details');
  assert.match(first.body.jobs[0].inputSignature, /^digital-human-input-v2:[0-9a-f]{64}$/, 'public inputSignature must be server canonical');
  assert.equal(first.body.jobs[0].performanceSignature, first.body.jobs[0].inputSignature, 'performance signature must be server-owned and cover the normalized plan/profile');
  assert.match(first.body.jobs[0].sourceFingerprint, /^"digital-human-source-v1"\|/, 'server must persist the editor-controlled source fingerprint');
  assert.equal(first.body.jobs[0].sourceFingerprint, shotDigitalHumanSourceFingerprint({
    slotId: 'shot-1', language: 'zh', script: 'script-zh',
    voiceoverUrl: '/tts/tenants/tenant-a/voice-zh.wav?rotating-token=ignored',
    start: 0, end: 3.2, avatarMaterialId: 'avatar-shared', avatarVersion: 3,
    pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
  }), 'browser and server must derive the same base/source identity');

  // A pre-migration canonical job may still contain the old browser signature
  // and no source layer. Exact canonical replay is sufficient proof to backfill
  // it without starting another GPU task.
  const legacyPersisted = persistedJobs();
  legacyPersisted[0].inputSignature = 'client-controlled';
  delete legacyPersisted[0].sourceFingerprint;
  delete legacyPersisted[0].performanceSignature;
  fs.writeFileSync(jobsFile, JSON.stringify(legacyPersisted, null, 2));

  const replay = await postBatch('tenant-a', originalRequest);
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.deepEqual(replay.body.batch.createdJobIds, []);
  assert.deepEqual(replay.body.batch.reusedJobIds, [firstJobId]);
  assert.equal(replay.body.jobs[0].id, firstJobId);
  assert.equal(replay.body.jobs[0].inputSignature, replay.body.jobs[0].performanceSignature);
  assert.equal(replay.body.jobs[0].sourceFingerprint, first.body.jobs[0].sourceFingerprint);
  assert.equal(persistedJobs().filter(job => job.tenantId === 'tenant-a').length, 1);

  const changedAvatarMaterials = JSON.parse(fs.readFileSync(materialsFile, 'utf8')) as any[];
  changedAvatarMaterials.find(item => item.id === 'avatar-shared').avatarVersion = 4;
  fs.writeFileSync(materialsFile, JSON.stringify(changedAvatarMaterials, null, 2));
  const changedAvatarJobResponse = await fetch(`${baseUrl}/digital-human/jobs/${encodeURIComponent(firstJobId)}`, { headers: headers('tenant-a') });
  const changedAvatarJob = await changedAvatarJobResponse.json() as any;
  assert.equal(changedAvatarJobResponse.status, 200);
  assert.equal(changedAvatarJob.job.sourceFingerprint, undefined, 'avatar identity changes must make an old server source proof unverifiable');
  changedAvatarMaterials.find(item => item.id === 'avatar-shared').avatarVersion = 3;
  fs.writeFileSync(materialsFile, JSON.stringify(changedAvatarMaterials, null, 2));

  const changedPerformance = await postBatch('tenant-a', batchBody('tenant-a', [
    variant('tenant-a', 'zh', { inputSignature: 'client-controlled', performancePlan: performancePlan('alternate-profile') }),
  ]));
  assert.equal(changedPerformance.response.status, 202, JSON.stringify(changedPerformance.body));
  assert.equal(changedPerformance.body.jobs[0].sourceFingerprint, first.body.jobs[0].sourceFingerprint, 'planner/profile changes must preserve the base source layer');
  assert.notEqual(changedPerformance.body.jobs[0].inputSignature, first.body.jobs[0].inputSignature, 'planner/profile changes must alter the server performance signature');
  assert.equal(changedPerformance.body.jobs[0].performanceSignature, changedPerformance.body.jobs[0].inputSignature);

  const changedServerInput = await postBatch('tenant-a', batchBody('tenant-a', [
    variant('tenant-a', 'zh', { inputSignature: 'client-controlled', script: 'a genuinely different script' }),
  ]));
  assert.equal(changedServerInput.response.status, 202, JSON.stringify(changedServerInput.body));
  assert.notEqual(changedServerInput.body.jobs[0].id, firstJobId, 'client signature must not force stale reuse');
  const tenantAJobs = persistedJobs().filter(job => job.tenantId === 'tenant-a');
  assert.equal(tenantAJobs.length, 3);
  assert.ok(tenantAJobs.every(job => /^digital-human-input-v2:[0-9a-f]{64}$/.test(job.canonicalInputSignature)));
  assert.ok(tenantAJobs.every(job => job.inputSignature === job.canonicalInputSignature), 'persisted authoritative inputSignature must not trust the browser');
  assert.ok(tenantAJobs.every(job => job.performanceSignature === job.canonicalInputSignature));
  assert.notEqual(tenantAJobs[0].canonicalInputSignature, tenantAJobs[1].canonicalInputSignature);
  assert.notEqual(first.body.jobs[0].sourceFingerprint, changedServerInput.body.jobs[0].sourceFingerprint, 'script changes must invalidate the base/source fingerprint');

  // Tenant B cannot use tenant A's private avatar, and an otherwise identical
  // shared-avatar request must create a tenant-B-owned job rather than reuse A.
  const foreignAvatar = await postBatch('tenant-b', batchBody('tenant-b', [variant('tenant-b', 'zh')], {
    projectId: 'tenant-b-project',
    avatarMaterialId: 'avatar-tenant-a',
  }));
  assert.equal(foreignAvatar.response.status, 400, JSON.stringify(foreignAvatar.body));
  assert.equal(foreignAvatar.body.code, 'INVALID_AVATAR');
  assert.equal(persistedJobs().filter(job => job.tenantId === 'tenant-b').length, 0);

  const tenantB = await postBatch('tenant-b', batchBody('tenant-b', [
    variant('tenant-b', 'zh', { inputSignature: 'client-controlled', script: 'script-zh' }),
  ], { projectId: 'tenant-b-project' }));
  assert.equal(tenantB.response.status, 202, JSON.stringify(tenantB.body));
  assert.notEqual(tenantB.body.jobs[0].id, firstJobId);

  for (const tenantId of ['tenant-a', 'tenant-b']) {
    const response = await fetch(`${baseUrl}/digital-human/jobs`, { headers: headers(tenantId) });
    assert.equal(response.status, 200);
    const jobs = await response.json() as any[];
    assert.ok(jobs.length > 0);
    assert.ok(jobs.every(job => job.tenantId === undefined));
    const expectedIds = new Set(persistedJobs().filter(job => job.tenantId === tenantId).map(job => job.id));
    assert.ok(jobs.every(job => expectedIds.has(job.id)), `${tenantId} must only observe its own jobs`);
  }

  // Capacity boundary: exactly 60 active children are accepted for one tenant;
  // child 61 is rejected without a partial write. A full replay remains valid.
  const capacity32 = Array.from({ length: 32 }, (_, index) => variant('tenant-capacity', `lang-${index}`));
  const capacity28 = Array.from({ length: 28 }, (_, index) => variant('tenant-capacity', `lang-${index + 32}`));
  const capacityFirst = await postBatch('tenant-capacity', batchBody('tenant-capacity', capacity32, { projectId: 'capacity-project' }));
  assert.equal(capacityFirst.response.status, 202, JSON.stringify(capacityFirst.body));
  assert.equal(capacityFirst.body.batch.createdJobIds.length, 32);
  const capacitySecond = await postBatch('tenant-capacity', batchBody('tenant-capacity', capacity28, { projectId: 'capacity-project' }));
  assert.equal(capacitySecond.response.status, 202, JSON.stringify(capacitySecond.body));
  assert.equal(capacitySecond.body.batch.createdJobIds.length, 28);
  assert.equal(persistedJobs().filter(job => job.tenantId === 'tenant-capacity').length, 60);

  const beforeOverflow = fs.readFileSync(jobsFile, 'utf8');
  const overflow = await postBatch('tenant-capacity', batchBody('tenant-capacity', [
    variant('tenant-capacity', 'lang-60'),
  ], { projectId: 'capacity-project' }));
  assert.equal(overflow.response.status, 429, JSON.stringify(overflow.body));
  assert.equal(overflow.body.code, 'QUEUE_LIMIT');
  assert.equal(fs.readFileSync(jobsFile, 'utf8'), beforeOverflow, 'capacity rejection must not mutate the job store');

  const replayAtCapacity = await postBatch('tenant-capacity', batchBody('tenant-capacity', capacity32, { projectId: 'capacity-project' }));
  assert.equal(replayAtCapacity.response.status, 200, JSON.stringify(replayAtCapacity.body));
  assert.equal(replayAtCapacity.body.batch.createdJobIds.length, 0);
  assert.equal(replayAtCapacity.body.batch.reusedJobIds.length, 32);
  assert.equal(persistedJobs().filter(job => job.tenantId === 'tenant-capacity').length, 60);

  console.log('studio digital human batch HTTP integration tests passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(testRoot, { recursive: true, force: true });
}
