import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { DIGITAL_HUMAN_PIPELINE_VERSION } from '../../src/lib/digitalHumanPipeline.js';
import {
  buildDigitalHumanRenderTreatmentAudit,
  buildDigitalHumanRenderTreatmentReceipt,
} from '../lib/digitalHumanRenderTreatment.js';
import { buildDigitalHumanSegmentProvenance } from '../lib/digitalHumanTimelineIntegrity.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-render-batch-http-'));
const tenantId = 'tenant-render-batch';
const sourceProjectId = 'project-render-batch';
const materialsFile = path.join(root, 'materials.json');
const digitalJobsFile = path.join(root, 'digital-human-jobs.json');
const renderJobsFile = path.join(root, 'render-jobs.json');
const authorizationsFile = path.join(root, 'render-authorizations.json');
const usageFile = path.join(root, 'demo-usage.json');
const localStoreDir = path.join(root, 'local-store');
fs.mkdirSync(localStoreDir, { recursive: true });
fs.writeFileSync(path.join(localStoreDir, 'studio_projects.json'), JSON.stringify([{
  id: sourceProjectId, tenant_id: tenantId, title: 'Batch project', status: 'draft', spec: {},
}], null, 2));

const languages = ['zh', 'en', 'es'] as const;
const jobs = languages.map((language, index) => {
  const outputSha256 = String(index + 1).repeat(64);
  const receipt = buildDigitalHumanRenderTreatmentReceipt({
    attempt: 1,
    treatmentId: 'baseline_unsharp',
    renderContext: 'performance',
    baseRenderFingerprint: 'b'.repeat(64),
    inputSha256: 'c'.repeat(64),
    outputSha256,
    qualityPassed: true,
    appliedAt: '2026-09-03T00:00:00.000Z',
  });
  return {
    id: `job-${language}`,
    batchId: `worker-batch-${language}`,
    tenantId,
    projectId: sourceProjectId,
    storyboardSlotId: 'slot-1',
    audioStartSeconds: 0,
    audioEndSeconds: 15,
    inputSignature: `input-${language}`,
    sourceFingerprint: `source-${language}`,
    performanceSignature: `performance-${language}`,
    pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
    avatarMaterialId: 'avatar-1',
    language,
    status: 'completed',
    outputMaterialId: `clip-${language}`,
    resultSha256: outputSha256,
    motionClipIds: ['motion-1'],
    performancePlan: { orchestrationProfile: {
      profileId: 'profile-1', fingerprint: 'd'.repeat(64), motionProfileId: 'motion-profile-1',
      gesture: 'cta', beatStrategy: 'single_continuous_clip', originalBeatCount: 1,
    } },
    qualityReport: {
      passed: true,
      validationStatus: 'passed',
      reviewRequired: false,
      outputSha256,
      gateVersion: 'commercial-v1+server-media-v1',
      validatorVersion: 'final-quality-v2.4.0',
      serverValidation: { passed: true },
      renderTreatmentAudit: buildDigitalHumanRenderTreatmentAudit([receipt], 1),
    },
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
  };
});
fs.writeFileSync(digitalJobsFile, JSON.stringify(jobs, null, 2));
fs.writeFileSync(materialsFile, JSON.stringify(languages.map(language => ({
  id: `clip-${language}`,
  name: `clip-${language}.mp4`,
  folder: 'presenter',
  type: 'video',
  duration: 15,
  width: 1080,
  height: 1920,
  size: '1 MB',
  file: `clip-${language}.mp4`,
  url: `/media/clip-${language}.mp4`,
  scope: 'shared',
  usage: 'editable',
  sourceType: 'digital-human',
  assetRole: 'generated_clip',
  createdAt: '2026-09-03T00:00:00.000Z',
})), null, 2));

Object.assign(process.env, {
  NODE_ENV: 'test',
  PB_URL: 'http://127.0.0.1:1',
  PB_ADMIN_EMAIL: '',
  PB_ADMIN_PASSWORD: '',
  LINGSHU_LOCAL_STORE_DIR: localStoreDir,
  SUBSCRIPTION_ENFORCED: 'false',
  DEMO_MODE: 'true',
  DEMO_DAILY_RENDER_LIMIT: '3',
  DEMO_USAGE_FILE: usageFile,
  PUBLIC_BASE_URL: '',
  RENDER_TOKEN_SECRET: 'render-batch-http-secret',
  STUDIO_MATERIALS_FILE: materialsFile,
  DIGITAL_HUMAN_JOBS_FILE: digitalJobsFile,
  STUDIO_RENDER_JOBS_FILE: renderJobsFile,
  RENDER_AUTHORIZATIONS_FILE: authorizationsFile,
});

const { clearRenderAuthorizationMemoryForTests, resolveRenderAuthorization } = await import('../lib/renderAuthorizationStore.js');
const { studioRouter } = await import('./studio.js');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/studio', studioRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});

function authHeader(): Record<string, string> {
  const identity = Buffer.from(JSON.stringify({ userId: 'user-render-batch', tenantId }), 'utf8').toString('base64url');
  return { authorization: `Bearer local-demo.${identity}`, 'content-type': 'application/json' };
}

function spec(language: typeof languages[number]) {
  const job = jobs.find(item => item.language === language)!;
  return {
    sourceProjectId,
    language,
    ratio: '9:16',
    duration: 15,
    platform: 'tiktok',
    materials: [`clip-${language}.mp4`],
    timeline: [{
      clipId: `clip-${language}`,
      name: `clip-${language}.mp4`,
      trimStart: 0,
      trimEnd: 15,
      speed: 1,
      targetStart: 0,
      targetEnd: 15,
      targetDuration: 15,
      digitalHumanSegment: buildDigitalHumanSegmentProvenance(job),
    }],
    subtitles: { mode: 'off', cues: [], style: {} },
  };
}

function body(batchKey: string) {
  return { batchKey, sourceProjectId, renders: languages.map(language => ({ language, spec: spec(language) })) };
}

async function authorize(payload: unknown) {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const response = await fetch(`http://127.0.0.1:${address.port}/studio/render/authorizations/trilingual`, {
    method: 'POST', headers: authHeader(), body: JSON.stringify(payload),
  });
  return { response, body: await response.json() as any };
}

try {
  const invalid = body('render-batch-invalid');
  invalid.renders.pop();
  const invalidResult = await authorize(invalid);
  assert.equal(invalidResult.response.status, 400);
  assert.equal(fs.existsSync(usageFile), false, 'invalid specs must not consume quota');

  const first = await authorize(body('render-batch-valid'));
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  assert.deepEqual(first.body.authorizations.map((item: any) => item.language), ['zh', 'en', 'es']);
  assert.equal(JSON.parse(fs.readFileSync(renderJobsFile, 'utf8')).length, 3);
  assert.equal(JSON.parse(fs.readFileSync(authorizationsFile, 'utf8')).length, 3);
  const persisted = JSON.parse(fs.readFileSync(renderJobsFile, 'utf8')) as any[];
  assert.ok(persisted.every(item => item.sourceProjectId === sourceProjectId && item.manifest && item.digitalHumanTimelineAudit?.length === 1));

  const firstJob = first.body.authorizations[0];
  clearRenderAuthorizationMemoryForTests();
  assert.equal(resolveRenderAuthorization({ token: firstJob.token, tenantId, jobId: firstJob.manifest.jobId }).ok, true, 'authorization survives memory reset');

  const repeated = await authorize(body('render-batch-valid'));
  assert.equal(repeated.response.status, 200, JSON.stringify(repeated.body));
  assert.equal(repeated.body.reused, true);
  assert.deepEqual(repeated.body.authorizations.map((item: any) => item.manifest.jobId), first.body.authorizations.map((item: any) => item.manifest.jobId));
  assert.equal(JSON.parse(fs.readFileSync(renderJobsFile, 'utf8')).length, 3, 'idempotent retry must not duplicate jobs');

  const quotaDenied = await authorize(body('render-batch-second'));
  assert.equal(quotaDenied.response.status, 429, JSON.stringify(quotaDenied.body));
  assert.equal(JSON.parse(fs.readFileSync(renderJobsFile, 'utf8')).length, 3, 'failed batch reservation must not create partial jobs');
  const usage = JSON.parse(fs.readFileSync(usageFile, 'utf8')) as Record<string, Record<string, { render: number }>>;
  const day = new Date().toISOString().slice(0, 10);
  assert.equal(usage[`tenant:${tenantId}`]?.[day]?.render, 3, 'one trilingual batch consumes exactly three renders once');

  console.log('studio render batch authorization HTTP integration tests passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
}
