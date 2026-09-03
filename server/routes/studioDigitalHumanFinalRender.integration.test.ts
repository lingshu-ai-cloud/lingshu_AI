import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import ffmpegStatic from 'ffmpeg-static';
import { DIGITAL_HUMAN_PIPELINE_VERSION } from '../../src/lib/digitalHumanPipeline.js';
import {
  buildDigitalHumanRenderTreatmentAudit,
  buildDigitalHumanRenderTreatmentReceipt,
} from '../lib/digitalHumanRenderTreatment.js';
import { buildDigitalHumanSegmentProvenance } from '../lib/digitalHumanTimelineIntegrity.js';

assert.ok(ffmpegStatic, 'ffmpeg-static is required for the final-render HTTP integration test');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-final-render-http-'));
const mediaDir = path.join(root, 'media');
const outputDir = path.join(root, 'outputs');
const materialsFile = path.join(root, 'materials.json');
const digitalHumanJobsFile = path.join(root, 'digital-human-jobs.json');
const renderJobsFile = path.join(root, 'render-jobs.json');
fs.mkdirSync(mediaDir, { recursive: true });

function makeVideo(filename: string, source: string): void {
  execFileSync(String(ffmpegStatic), [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', source,
    '-t', '1.2', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-y',
    path.join(mediaDir, filename),
  ], { windowsHide: true, stdio: 'pipe' });
}

makeVideo('dynamic.mp4', 'testsrc2=size=360x640:rate=30');
makeVideo('black.mp4', 'color=c=black:size=360x640:rate=30');

const material = (id: string, file: string, sourceType: string, duration = 1.2) => ({
  id,
  name: `${id}.mp4`,
  folder: sourceType === 'digital-human' ? 'presenter' : 'upload',
  type: 'video',
  duration,
  width: 360,
  height: 640,
  size: '10 KB',
  file,
  url: `/media/${file}`,
  scope: 'shared',
  usage: 'editable',
  sourceType,
  ...(sourceType === 'digital-human' ? { assetRole: 'generated_clip' } : {}),
  createdAt: '2026-09-03T00:00:00.000Z',
});

fs.writeFileSync(materialsFile, JSON.stringify([
  material('digital-dynamic', 'dynamic.mp4', 'digital-human', 12),
  material('digital-black', 'black.mp4', 'digital-human', 12),
  material('ordinary-dynamic', 'dynamic.mp4', 'uploaded'),
  material('ordinary-black', 'black.mp4', 'uploaded'),
], null, 2));

const tenantId = 'tenant-final-render';
const sourceProjectId = 'project-final-render';
const fileSha256 = (filename: string) => createHash('sha256').update(fs.readFileSync(path.join(mediaDir, filename))).digest('hex');
function completedDigitalHumanJob(id: string, outputMaterialId: string, filename: string) {
  const resultSha256 = fileSha256(filename);
  const inputSignature = `digital-human-input-v2:${(id === 'job-dynamic' ? '1' : '2').repeat(64)}`;
  const receipt = buildDigitalHumanRenderTreatmentReceipt({
    attempt: 1,
    treatmentId: 'baseline_unsharp',
    renderContext: 'performance',
    baseRenderFingerprint: 'b'.repeat(64),
    inputSha256: 'c'.repeat(64),
    outputSha256: resultSha256,
    qualityPassed: true,
    appliedAt: '2026-09-03T00:00:00.000Z',
  });
  return {
    id,
    tenantId,
    projectId: sourceProjectId,
    storyboardSlotId: 'slot-1',
    audioStartSeconds: 0,
    audioEndSeconds: 12,
    inputSignature,
    sourceFingerprint: `source-${id}`,
    performanceSignature: inputSignature,
    pipelineVersion: DIGITAL_HUMAN_PIPELINE_VERSION,
    avatarMaterialId: 'avatar-1',
    language: 'zh',
    status: 'completed',
    outputMaterialId,
    resultSha256,
    motionClipIds: ['motion-1'],
    performancePlan: { orchestrationProfile: {
      profileId: 'profile-1', fingerprint: 'd'.repeat(64), motionProfileId: 'hook-1',
      gesture: 'cta', beatStrategy: 'single_continuous_clip', originalBeatCount: 1,
    } },
    qualityReport: {
      passed: true,
      validationStatus: 'passed',
      reviewRequired: false,
      outputSha256: resultSha256,
      gateVersion: 'commercial-v1+server-media-v1',
      validatorVersion: 'final-quality-v2.4.0',
      serverValidation: { passed: true },
      renderTreatmentAudit: buildDigitalHumanRenderTreatmentAudit([receipt], 1),
    },
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
  };
}
const digitalJobs = [
  completedDigitalHumanJob('job-dynamic', 'digital-dynamic', 'dynamic.mp4'),
  completedDigitalHumanJob('job-black', 'digital-black', 'black.mp4'),
];
fs.writeFileSync(digitalHumanJobsFile, JSON.stringify(digitalJobs, null, 2));

Object.assign(process.env, {
  NODE_ENV: 'test',
  SUBSCRIPTION_ENFORCED: 'false',
  DEMO_MODE: 'false',
  PUBLIC_BASE_URL: '',
  RENDER_TOKEN_SECRET: 'final-render-http-secret',
  STUDIO_MATERIALS_FILE: materialsFile,
  STUDIO_MEDIA_DIR: mediaDir,
  STUDIO_PUBLISHING_RENDER_DIR: outputDir,
  STUDIO_RENDER_JOBS_FILE: renderJobsFile,
  DIGITAL_HUMAN_JOBS_FILE: digitalHumanJobsFile,
});

const { clearRenderAuthorizationStoreForTests } = await import('../lib/renderAuthorizationStore.js');
const { findStudioRenderJob } = await import('../lib/studioRenderJobStore.js');
clearRenderAuthorizationStoreForTests();
const { studioRouter } = await import('./studio.js');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api/overseas/studio', studioRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});

function localToken(tenantId: string): string {
  return `local-demo.${Buffer.from(JSON.stringify({ userId: `user-${tenantId}`, tenantId }), 'utf8').toString('base64url')}`;
}

try {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}/api/overseas/studio`;
  const authHeaders = { authorization: `Bearer ${localToken(tenantId)}`, 'content-type': 'application/json' };

  const postAuthorization = async (requestBody: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}/render`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(requestBody),
    });
    const responseBody = await response.json() as any;
    return { response, body: responseBody };
  };

  const digitalRenderBody = (clipId: 'digital-dynamic' | 'digital-black') => {
    const job = digitalJobs.find(item => item.outputMaterialId === clipId)!;
    return {
      sourceProjectId,
      timeline: [
        {
          clipId, name: `${clipId}.mp4`, trimStart: 0, trimEnd: 12, speed: 1,
          targetStart: 0, targetEnd: 12, targetDuration: 12,
          digitalHumanSegment: buildDigitalHumanSegmentProvenance(job),
        },
        {
          clipId: 'ordinary-dynamic', name: 'ordinary-dynamic.mp4', trimStart: 0, trimEnd: 1.2, speed: 0.4,
          targetStart: 12, targetEnd: 15, targetDuration: 3,
        },
      ],
      duration: 15,
      ratio: '9:16',
      platform: 'tiktok',
      language: 'zh',
      subtitles: { mode: 'off', cues: [], style: {} },
    };
  };

  const authorizeDigital = async (clipId: 'digital-dynamic' | 'digital-black') => {
    const result = await postAuthorization(digitalRenderBody(clipId));
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    return result.body;
  };

  const authorizeOrdinary = async (clipId: string, ratio: string) => {
    const result = await postAuthorization({
      timeline: [{ clipId, name: `${clipId}.mp4`, trimStart: 0, trimEnd: 1.2, targetDuration: 1.2 }],
      duration: 1.2,
      ratio,
      platform: 'tiktok',
      language: 'zh',
      subtitles: { mode: 'off', cues: [], style: {} },
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    return result.body;
  };

  const complete = async (authorization: any) => {
    const response = await fetch(`${baseUrl}/render/local`, {
      method: 'POST',
      headers: { ...authHeaders, 'x-render-token': authorization.token },
      body: JSON.stringify({ jobId: authorization.manifest.jobId }),
    });
    return { response, body: await response.json() as any };
  };

  const validAuthorization = await authorizeDigital('digital-dynamic');
  assert.equal(validAuthorization.manifest.timeline[0].digitalHumanGenerated, true);
  assert.equal(validAuthorization.manifest.timeline[0].speed, 1);
  assert.equal(validAuthorization.manifest.digitalHumanSegments.segments[0].provenance.workerOutputSha256, digitalJobs[0]!.resultSha256);

  const changedSpeed = digitalRenderBody('digital-dynamic');
  changedSpeed.timeline[0]!.speed = 1.01;
  const speedRejected = await postAuthorization(changedSpeed);
  assert.equal(speedRejected.response.status, 400);
  assert.match(String(speedRejected.body.error), /变速|speed/i);

  const missingSourceProject = digitalRenderBody('digital-dynamic') as Record<string, unknown>;
  delete missingSourceProject.sourceProjectId;
  const missingProjectRejected = await postAuthorization(missingSourceProject);
  assert.equal(missingProjectRejected.response.status, 400);
  assert.match(String(missingProjectRejected.body.error), /sourceProjectId/);

  const changedTrim = digitalRenderBody('digital-dynamic');
  changedTrim.timeline[0]!.trimStart = 0.1;
  const trimRejected = await postAuthorization(changedTrim);
  assert.equal(trimRejected.response.status, 400);
  assert.match(String(trimRejected.body.error), /裁切|trim/i);

  const wrongLanguage = digitalRenderBody('digital-dynamic');
  wrongLanguage.language = 'en';
  const languageRejected = await postAuthorization(wrongLanguage);
  assert.equal(languageRejected.response.status, 400);
  assert.match(String(languageRejected.body.error), /tenant project job|任务记录|语言/i);

  const tamperedSha = digitalRenderBody('digital-dynamic');
  (tamperedSha.timeline[0] as { digitalHumanSegment: { workerOutputSha256: string } }).digitalHumanSegment.workerOutputSha256 = 'f'.repeat(64);
  const shaRejected = await postAuthorization(tamperedSha);
  assert.equal(shaRejected.response.status, 400);
  assert.match(String(shaRejected.body.error), /任务记录不一致/);

  const wrongJob = digitalRenderBody('digital-dynamic');
  (wrongJob.timeline[0] as { digitalHumanSegment: { jobId: string } }).digitalHumanSegment.jobId = 'job-from-another-render';
  const jobRejected = await postAuthorization(wrongJob);
  assert.equal(jobRejected.response.status, 400);
  assert.match(String(jobRejected.body.error), /任务记录不一致/);

  const wrongDuration = digitalRenderBody('digital-dynamic');
  wrongDuration.duration = 14.9;
  const durationRejected = await postAuthorization(wrongDuration);
  assert.equal(durationRejected.response.status, 400);
  assert.match(String(durationRejected.body.error), /exactly 15/);

  const valid = await complete(validAuthorization);
  assert.equal(valid.response.status, 200, JSON.stringify(valid.body));
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.qualityReport?.passed, true, JSON.stringify(valid.body.qualityReport));
  assert.equal(valid.body.qualityReport?.syncNetApplied, false, 'mixed/final composition must not receive whole-film SyncNet');
  assert.equal(valid.body.qualityReport?.media?.decodePassed, true);
  assert.equal(valid.body.qualityReport?.media?.width, 1080);
  assert.equal(valid.body.qualityReport?.media?.height, 1920);
  assert.equal(valid.body.qualityReport?.media?.videoCodec, 'h264');
  assert.equal(valid.body.qualityReport?.media?.audioCodec, 'aac');
  assert.equal(valid.body.qualityReport?.nonEmptyFrames?.passed, true);
  assert.ok(valid.body.downloadUrl);
  assert.equal(findStudioRenderJob(validAuthorization.manifest.jobId, tenantId)?.status, 'completed');

  const download = await fetch(new URL(valid.body.downloadUrl, baseUrl), { headers: { authorization: authHeaders.authorization } });
  assert.equal(download.status, 200, 'approved digital-human output must be downloadable');
  await download.arrayBuffer();

  const blackAuthorization = await authorizeDigital('digital-black');
  const rejected = await complete(blackAuthorization);
  assert.equal(rejected.response.status, 422, JSON.stringify(rejected.body));
  assert.equal(rejected.body.ok, false);
  assert.equal(rejected.body.code, 'DIGITAL_HUMAN_FINAL_MEDIA_REJECTED');
  assert.equal(rejected.body.qualityReport?.passed, false);
  assert.equal(rejected.body.qualityReport?.nonEmptyFrames?.passed, false);
  assert.equal(rejected.body.outputPath, undefined);
  assert.equal(rejected.body.downloadUrl, undefined);
  const rejectedRecord = findStudioRenderJob(blackAuthorization.manifest.jobId, tenantId);
  assert.equal(rejectedRecord?.status, 'rejected');
  assert.equal(rejectedRecord?.qualityReport?.passed, false);
  const rejectedPath = path.join(outputDir, tenantId, `studio-${blackAuthorization.manifest.jobId}.mp4`);
  assert.equal(fs.existsSync(rejectedPath), false, 'rejected output must be removed');

  // Even if a stale/partial file reappears under the predictable filename, its
  // rejected task record must prevent the download endpoint from serving it.
  fs.writeFileSync(rejectedPath, 'not-approved');
  const blockedDownload = await fetch(`${baseUrl}/render/download/${encodeURIComponent(path.basename(rejectedPath))}`, {
    headers: { authorization: authHeaders.authorization },
  });
  assert.equal(blockedDownload.status, 409);
  assert.equal((await blockedDownload.json() as any).code, 'RENDER_NOT_DOWNLOADABLE');

  // Ordinary B-roll intentionally bypasses the digital-human-only gate: a 1:1
  // black creative is still a valid technical export and receives no SyncNet
  // or digital-human quality receipt.
  const ordinaryAuthorization = await authorizeOrdinary('ordinary-black', '1:1');
  assert.equal(ordinaryAuthorization.manifest.timeline[0].digitalHumanGenerated, false);
  const ordinary = await complete(ordinaryAuthorization);
  assert.equal(ordinary.response.status, 200, JSON.stringify(ordinary.body));
  assert.equal(ordinary.body.ok, true);
  assert.equal(ordinary.body.qualityReport, undefined);
  assert.equal(ordinary.body.renderJob?.containsDigitalHuman, false);
  assert.ok(ordinary.body.downloadUrl);

  console.log('studio digital human final-render HTTP integration tests passed');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  clearRenderAuthorizationStoreForTests();
  fs.rmSync(root, { recursive: true, force: true });
}
