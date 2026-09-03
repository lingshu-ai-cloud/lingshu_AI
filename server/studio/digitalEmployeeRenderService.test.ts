import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { EnterpriseProfile } from '../routes/enterprise.js';
import { enterpriseAssetTenantKey } from '../storage/enterpriseAssets.js';
import { renderDigitalEmployeeDraft, verifyDigitalEmployeeRenderedVideo } from './digitalEmployeeRenderService.js';

const objectStorageVariables = [
  'OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_ACCESS_KEY_ID', 'OBJECT_STORAGE_SECRET_ACCESS_KEY', 'OBJECT_STORAGE_BUCKET_NAME',
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME',
] as const;
const savedObjectStorage = Object.fromEntries(objectStorageVariables.map(name => [name, process.env[name]]));
for (const name of objectStorageVariables) delete process.env[name];
const savedVoiceoverMode = process.env.DIGITAL_EMPLOYEE_VOICEOVER_MODE;
const savedRealPublish = process.env.DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED;
const savedQwenKey = process.env.DASHSCOPE_API_KEY;
const savedMinimaxKey = process.env.MINIMAX_API_KEY;
process.env.DIGITAL_EMPLOYEE_VOICEOVER_MODE = 'silent_test';
process.env.DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED = 'false';
delete process.env.DASHSCOPE_API_KEY;
delete process.env.MINIMAX_API_KEY;

const tenantId = `render-test-${randomUUID()}`;
const tenantAssetDirectory = path.resolve(process.cwd(), 'data', 'enterprise-assets', enterpriseAssetTenantKey(tenantId));
const tenantOutputDirectory = path.resolve(process.cwd(), 'data', 'publishing-uploads', tenantId);
const validFilename = 'verified.png';
const invalidFilename = 'forged.png';
const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function profileFor(filename: string): EnterpriseProfile {
  return {
    company: { name: 'Render Test', industry: 'Test', mainMarkets: 'US', founded: '', description: '' },
    products: {
      categories: 'Test', priceRange: '', moq: '', certifications: '', highlights: '',
      items: [{
        name: 'Verified product',
        images: [{
          name: filename,
          type: 'image/png',
          size: filename === validFilename ? onePixelPng.length : 32,
          updatedAt: new Date(0).toISOString(),
          url: `/api/overseas/enterprise/assets/${filename}`,
        }],
      }],
    },
    brand: { tone: '', style: '', taboos: '', usp: '' },
  } as EnterpriseProfile;
}

try {
  fs.mkdirSync(tenantAssetDirectory, { recursive: true });
  fs.writeFileSync(path.join(tenantAssetDirectory, validFilename), onePixelPng);
  fs.writeFileSync(path.join(tenantAssetDirectory, invalidFilename), Buffer.from('not a real png payload'));

  const input = {
    tenantId,
    runId: 'run-verified',
    taskId: 'task-render',
    profile: profileFor(validFilename),
    focusProducts: ['Verified product'],
    draft: {
      platform: 'tiktok', language: 'en', title: 'Verified render',
      storyboard: [{ voice: 'Verified product media only.', durationSeconds: 1.5 }],
    },
  };
  const first = await renderDigitalEmployeeDraft(input);
  assert.equal(first.status, 'rendered');
  assert.equal(first.sourceAssetCount, 1);
  assert.equal(first.voiceoverStatus, 'silent_fallback');
  assert.equal(first.voiceoverReason, 'tts_provider_not_configured_test_fallback');
  assert.ok(first.videoPath && fs.existsSync(first.videoPath));
  assert.match(first.videoSha256 || '', /^[a-f0-9]{64}$/);
  assert.equal(path.dirname(first.videoPath || ''), tenantOutputDirectory, 'render must stay in the authenticated tenant directory');
  assert.equal(await verifyDigitalEmployeeRenderedVideo({
    tenantId,
    videoPath: first.videoPath || '',
    videoSha256: first.videoSha256 || '',
  }), true);
  assert.equal(await verifyDigitalEmployeeRenderedVideo({
    tenantId: `${tenantId}-other`,
    videoPath: first.videoPath || '',
    videoSha256: first.videoSha256 || '',
  }), false, 'another tenant must not validate this artifact');

  const second = await renderDigitalEmployeeDraft(input);
  assert.equal(second.videoPath, first.videoPath, 'same immutable inputs must reuse the same artifact');
  assert.equal(second.videoSha256, first.videoSha256, 'idempotent retry must keep the artifact digest');

  fs.writeFileSync(first.videoPath || '', Buffer.from('corrupted generated artifact'));
  assert.equal(await verifyDigitalEmployeeRenderedVideo({
    tenantId,
    videoPath: first.videoPath || '',
    videoSha256: first.videoSha256 || '',
  }), false, 'corrupted artifact must fail integrity verification');
  const repaired = await renderDigitalEmployeeDraft(input);
  assert.equal(repaired.videoPath, first.videoPath, 'repair keeps the deterministic artifact path');
  assert.equal(await verifyDigitalEmployeeRenderedVideo({
    tenantId,
    videoPath: repaired.videoPath || '',
    videoSha256: repaired.videoSha256 || '',
  }), true, 'retry must replace a corrupt generated artifact with a verified render');

  const concurrentInput = { ...input, runId: 'run-concurrent' };
  const [concurrentA, concurrentB] = await Promise.all([
    renderDigitalEmployeeDraft(concurrentInput),
    renderDigitalEmployeeDraft(concurrentInput),
  ]);
  assert.equal(concurrentA.videoPath, concurrentB.videoPath, 'concurrent retries must converge on one immutable path');
  assert.equal(concurrentA.videoSha256, concurrentB.videoSha256, 'concurrent retries must converge on one complete artifact');

  const forged = await renderDigitalEmployeeDraft({
    ...input,
    runId: 'run-forged',
    profile: profileFor(invalidFilename),
  });
  assert.deepEqual(forged, {
    status: 'not_available',
    sourceAssetCount: 0,
    reason: 'verified_product_media_missing',
  }, 'extension/MIME claims must not turn forged bytes into a publishable render');

  console.log('digital employee verified render regression passed');
} finally {
  fs.rmSync(tenantAssetDirectory, { recursive: true, force: true });
  fs.rmSync(tenantOutputDirectory, { recursive: true, force: true });
  for (const name of objectStorageVariables) {
    const value = savedObjectStorage[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  if (savedVoiceoverMode === undefined) delete process.env.DIGITAL_EMPLOYEE_VOICEOVER_MODE;
  else process.env.DIGITAL_EMPLOYEE_VOICEOVER_MODE = savedVoiceoverMode;
  if (savedRealPublish === undefined) delete process.env.DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED;
  else process.env.DIGITAL_EMPLOYEE_REAL_PUBLISH_ENABLED = savedRealPublish;
  if (savedQwenKey === undefined) delete process.env.DASHSCOPE_API_KEY;
  else process.env.DASHSCOPE_API_KEY = savedQwenKey;
  if (savedMinimaxKey === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = savedMinimaxKey;
}
