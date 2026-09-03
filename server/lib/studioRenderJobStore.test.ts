import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-render-job-store-'));
process.env.NODE_ENV = 'test';
process.env.STUDIO_RENDER_JOBS_FILE = path.join(root, 'jobs.json');

const {
  claimStudioRenderJobLease,
  createStudioRenderJob,
  createStudioRenderJobBatch,
  findStudioRenderJob,
  findStudioRenderJobByOutput,
  findStudioRenderJobsByBatch,
  refreshStudioRenderJobAuthorizations,
  studioRenderOutputIsDownloadable,
  updateStudioRenderJob,
  updateStudioRenderJobForLease,
} = await import('./studioRenderJobStore.js');

try {
  const created = createStudioRenderJob({
    jobId: 'render-1', tenantId: 'tenant-a', manifestSha256: 'a'.repeat(64),
    manifest: { jobId: 'render-1', spec: { language: 'zh' } },
    containsDigitalHuman: true, outputFilename: 'studio-render-1.mp4',
  });
  assert.equal(created.status, 'authorized');
  assert.equal(studioRenderOutputIsDownloadable(created), false);
  assert.equal(findStudioRenderJob('render-1', 'tenant-b'), null);

  const rejected = updateStudioRenderJob('render-1', 'tenant-a', {
    status: 'rejected', qualityReport: { passed: false, failures: ['blank frame'] },
  });
  assert.ok(rejected);
  assert.equal(studioRenderOutputIsDownloadable(rejected), false);

  const completed = updateStudioRenderJob('render-1', 'tenant-a', {
    status: 'completed', qualityReport: { passed: true }, outputSha256: 'b'.repeat(64), outputSizeBytes: 1234,
  });
  assert.ok(completed);
  assert.equal(studioRenderOutputIsDownloadable(completed), true);
  assert.equal(findStudioRenderJobByOutput('studio-render-1.mp4', 'tenant-a')?.jobId, 'render-1');
  assert.equal(findStudioRenderJobByOutput('../studio-render-1.mp4', 'tenant-b'), null);

  const ordinary = createStudioRenderJob({
    jobId: 'render-2', tenantId: 'tenant-a', manifestSha256: 'c'.repeat(64),
    manifest: { jobId: 'render-2', spec: { language: 'zh' } },
    containsDigitalHuman: false, outputFilename: 'studio-render-2.mp4',
  });
  assert.equal(studioRenderOutputIsDownloadable(ordinary), false);
  const ordinaryCompleted = updateStudioRenderJob('render-2', 'tenant-a', { status: 'completed' });
  assert.equal(studioRenderOutputIsDownloadable(ordinaryCompleted), true, 'ordinary B-roll does not require the digital-human report');

  assert.throws(() => createStudioRenderJob({
    jobId: 'render-1', tenantId: 'tenant-a', manifestSha256: 'd'.repeat(64),
    manifest: { jobId: 'render-1' }, containsDigitalHuman: true,
  }), /already exists/);

  const batch = createStudioRenderJobBatch(['zh', 'en', 'es'].map(language => ({
    jobId: `batch-${language}`,
    tenantId: 'tenant-a',
    manifestSha256: language.repeat(64).slice(0, 64),
    manifest: { jobId: `batch-${language}`, sourceProjectId: 'project-1', spec: { language } },
    sourceProjectId: 'project-1',
    language,
    authorizationBatchKey: 'batch-key-1',
    authorizationBatchFingerprint: 'e'.repeat(64),
    authorizationExpiresAt: 2_000_000_000,
    containsDigitalHuman: true,
  })));
  assert.equal(batch.length, 3);
  assert.equal(findStudioRenderJobsByBatch('batch-key-1', 'tenant-a').length, 3);
  assert.throws(() => createStudioRenderJobBatch([{
    jobId: 'batch-other', tenantId: 'tenant-a', manifestSha256: 'f'.repeat(64), manifest: {},
    authorizationBatchKey: 'batch-key-1', containsDigitalHuman: true,
  }]), /batch already exists/);

  const refreshed = refreshStudioRenderJobAuthorizations(batch.map(record => ({
    jobId: record.jobId,
    tenantId: record.tenantId,
    authorizationBatchKey: 'batch-key-1',
    authorizationBatchFingerprint: 'e'.repeat(64),
    manifestSha256: '1'.repeat(64),
    manifest: { ...record.manifest, refreshed: true },
    authorizationExpiresAt: 2_000_000_100,
  })));
  assert.ok(refreshed.every(record => record.manifestSha256 === '1'.repeat(64)));

  const lease = claimStudioRenderJobLease({
    jobId: 'batch-zh', tenantId: 'tenant-a', leaseId: 'lease-1', nowMs: 1_000, leaseDurationMs: 5_000,
  });
  assert.equal(lease.ok, true);
  assert.deepEqual(claimStudioRenderJobLease({
    jobId: 'batch-zh', tenantId: 'tenant-a', leaseId: 'lease-2', nowMs: 2_000, leaseDurationMs: 5_000,
  }), { ok: false, code: 'already_running' });
  const recovered = claimStudioRenderJobLease({
    jobId: 'batch-zh', tenantId: 'tenant-a', leaseId: 'lease-2', nowMs: 6_001, leaseDurationMs: 5_000,
  });
  assert.equal(recovered.ok, true, 'an expired rendering lease must be recoverable');
  assert.equal(updateStudioRenderJobForLease('batch-zh', 'tenant-a', 'lease-1', { status: 'completed' }), null, 'a stale renderer cannot commit');
  assert.equal(updateStudioRenderJobForLease('batch-zh', 'tenant-a', 'lease-2', {
    status: 'completed', renderLeaseId: undefined, renderLeaseUntil: undefined, qualityReport: { passed: true },
  })?.status, 'completed');
  console.log('studio render job store tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
