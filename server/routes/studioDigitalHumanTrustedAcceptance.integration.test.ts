import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { freezeDigitalHumanSegments } from '../lib/digitalHumanTimelineIntegrity.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-trusted-acceptance-'));
const renderJobsFile = path.join(root, 'render-jobs.json');
const authorizationFile = path.join(root, 'render-authorizations.json');
const outputRoot = path.join(root, 'outputs');
const tenantId = 'tenant-acceptance';
const batchId = 'server-batch-001';
const sourceProjectId = 'project-acceptance';
Object.assign(process.env, {
  NODE_ENV: 'test', SUBSCRIPTION_ENFORCED: 'false', DEMO_MODE: 'false',
  RENDER_TOKEN_SECRET: 'trusted-acceptance-http-secret',
  STUDIO_RENDER_JOBS_FILE: renderJobsFile,
  RENDER_AUTHORIZATIONS_FILE: authorizationFile,
  STUDIO_PUBLISHING_RENDER_DIR: outputRoot,
});

const provenance = (language: string, index: number, start: number, end: number) => ({
  schemaVersion: 'digital-human-segment-provenance-v1', language, jobId: `source-${language}-${index}`,
  projectId: sourceProjectId, storyboardSlotId: `slot-${index}`, outputMaterialId: `clip-${language}-${index}`,
  inputSignature: `input-${language}-${index}`, baseSourceSignature: `base-${language}-${index}`,
  pipelineVersion: 'digital-human-v2-p1.4', avatarMaterialId: 'avatar-1', performanceSignature: `perf-${language}-${index}`,
  performanceProfileId: `profile-${index}`, performanceProfileFingerprint: String(index + 1).repeat(64),
  motionProfileId: `motion-${index}`, motionClipIds: [`motion-${index}`], configuredGesture: `gesture-${index}`,
  beatStrategy: 'single_continuous_clip', originalBeatCount: 1, orchestrationAuditFingerprint: 'a'.repeat(64),
  treatmentId: 'baseline_unsharp', treatmentAttempt: 1, treatmentAuditVersion: 'render-treatment-audit-v2',
  treatmentRenderFingerprint: 'b'.repeat(64), treatmentFilterSha256: 'c'.repeat(64), treatmentBaseRenderFingerprint: 'd'.repeat(64),
  workerOutputSha256: 'e'.repeat(64), audioStartSeconds: start, audioEndSeconds: end,
  qualityGateVersion: 'commercial-v1', workerValidatorVersion: 'final-quality-v2.4.0',
});

function manifest(language: string, jobId: string) {
  const times = [[0, 3], [5, 8], [11, 15]] as const;
  const timeline: any[] = [];
  for (const [index, [start, end]] of times.entries()) {
    if (index === 1) timeline.push({ clipId: `broll-${language}-1`, type: 'video', targetStart: 3, targetEnd: 5, targetDuration: 2 });
    if (index === 2) timeline.push({ clipId: `broll-${language}-2`, type: 'video', targetStart: 8, targetEnd: 11, targetDuration: 3 });
    timeline.push({
      clipId: `clip-${language}-${index}`, type: 'video', trimStart: 0, trimEnd: end - start, speed: 1,
      targetStart: start, targetEnd: end, targetDuration: end - start, digitalHumanGenerated: true,
      digitalHumanSegment: provenance(language, index, start, end),
    });
  }
  timeline.sort((left, right) => left.targetStart - right.targetStart);
  const digitalHumanSegments = freezeDigitalHumanSegments(timeline, 15, language);
  return { jobId, sourceProjectId, spec: { ratio: '9:16', duration: 15, language }, timeline, digitalHumanSegments };
}

const {
  createStudioRenderJobBatch, updateStudioRenderJob,
} = await import('../lib/studioRenderJobStore.js');
const {
  rememberRenderAuthorizationBatch, renderManifestSha256, clearRenderAuthorizationStoreForTests,
} = await import('../lib/renderAuthorizationStore.js');
clearRenderAuthorizationStoreForTests();
const tenantOutput = path.join(outputRoot, tenantId);
fs.mkdirSync(tenantOutput, { recursive: true });
const records = ['zh', 'en', 'es'].map(language => {
  const jobId = `job-${language}`;
  const frozen = manifest(language, jobId);
  const outputFilename = `studio-${jobId}.mp4`;
  const contents = Buffer.from(`real-render-output-${language}`);
  fs.writeFileSync(path.join(tenantOutput, outputFilename), contents);
  const outputSha256 = createHash('sha256').update(contents).digest('hex');
  const audit = frozen.digitalHumanSegments.segments.map(segment => ({ sourceProjectId, language, ...segment }));
  return { jobId, language, frozen, outputFilename, outputSha256, sizeBytes: contents.length, audit };
});
createStudioRenderJobBatch(records.map(item => ({
  jobId: item.jobId, tenantId, manifestSha256: renderManifestSha256(item.frozen), manifest: item.frozen,
  sourceProjectId, language: item.language, authorizationBatchKey: batchId,
  authorizationBatchFingerprint: 'f'.repeat(64), authorizationExpiresAt: Math.floor(Date.now() / 1000) + 3600,
  digitalHumanTimelineAudit: item.audit, containsDigitalHuman: true, outputFilename: item.outputFilename,
})));
rememberRenderAuthorizationBatch(records.map(item => ({
  tenantId, expiresAt: Math.floor(Date.now() / 1000) + 3600, manifest: item.frozen,
})));
for (const item of records) updateStudioRenderJob(item.jobId, tenantId, {
  status: 'completed', outputSha256: item.outputSha256, outputSizeBytes: item.sizeBytes,
  qualityReport: {
    schemaVersion: 'digital-human-final-render-quality-v1', passed: true, checkedAt: new Date().toISOString(),
    media: { sha256: item.outputSha256 }, timelineIntegrity: { passed: true },
  },
});

const { studioRouter } = await import('./studio.js');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/studio', studioRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const localToken = (tenant: string) => `local-demo.${Buffer.from(JSON.stringify({ userId: `user-${tenant}`, tenantId: tenant })).toString('base64url')}`;

try {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}/studio/render/batches/${batchId}/digital-human-acceptance`;
  const headers = { authorization: `Bearer ${localToken(tenantId)}`, 'content-type': 'application/json' };
  const pendingResponse = await fetch(base, { headers });
  const pending = await pendingResponse.json() as any;
  assert.equal(pendingResponse.status, 200, JSON.stringify(pending));
  assert.equal(pending.acceptance.trust, 'server_attested');
  assert.equal(pending.acceptance.summary.automatedPassed, true);
  assert.equal(pending.acceptance.summary.passed, false);
  assert.equal(pending.acceptance.summary.validationStatus, 'requires_human_review');

  const reviewedAt = new Date().toISOString();
  const reviews = records.map(item => ({
    language: item.language, reviewer: 'QA reviewer', reviewedAt, outputSha256: item.outputSha256,
    doubleMouth: 'approved', complexHands: 'approved', voiceMatch: 'approved',
  }));
  const reviewResponse = await fetch(`${base}/reviews`, { method: 'PUT', headers, body: JSON.stringify({ reviews }) });
  const reviewed = await reviewResponse.json() as any;
  assert.equal(reviewResponse.status, 200, JSON.stringify(reviewed));
  assert.equal(reviewed.acceptance.summary.passed, true);
  assert.equal(reviewed.acceptance.summary.manualEvidenceCount, 3);
  assert.ok(reviewed.acceptance.items.every((item: any) => item.manualEvidence.review.outputSha256 === item.output.sha256));

  const foreignResponse = await fetch(base, { headers: { ...headers, authorization: `Bearer ${localToken('other-tenant')}` } });
  assert.equal(foreignResponse.status, 409, 'another tenant must not discover this batch');

  fs.appendFileSync(path.join(tenantOutput, records[0]!.outputFilename), 'tampered');
  const tamperedResponse = await fetch(base, { headers });
  assert.equal(tamperedResponse.status, 409, 'an output modified after completion must fail closed');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('studio digital human trusted acceptance HTTP integration tests passed');
