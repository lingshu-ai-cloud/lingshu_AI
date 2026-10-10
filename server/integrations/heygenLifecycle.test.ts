import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureHeygenAutomationJob } from '../routes/studio.js';
const tenantId = `heygen-contract-${randomUUID()}`;
const audioDir = path.resolve('data/tts/tenants', tenantId);
const jobsFile = path.resolve('data/digital-human-jobs.json');
const hadJobsFile = fs.existsSync(jobsFile);
fs.mkdirSync(audioDir, { recursive: true }); fs.writeFileSync(path.join(audioDir, 'voice.wav'), Buffer.alloc(1000));
const originalFetch = globalThis.fetch, originalKey = process.env.HEYGEN_API_KEY;
let submissions = 0;
let networkFailure = false;
try {
  process.env.HEYGEN_API_KEY = 'contract-test-only';
  globalThis.fetch = (async (url: any) => {
    const target = String(url);
    assert(target.startsWith('https://api.heygen.com/v3/'), 'test must never contact another service');
    if (target.includes('/avatars/looks?')) return Response.json({ data: [{ id: 'public-avatar', name: 'Public avatar', status: 'completed' }] });
    if (target.endsWith('/assets')) return Response.json({ data: { asset_id: 'audio' } });
    if (target.endsWith('/videos')) { submissions++; return Response.json({ data: { video_id: 'failed-task' } }); }
    if (networkFailure) throw new TypeError('fetch failed');
    return Response.json({ data: { status: 'failed', failure_message: 'contract fixture failure' } });
  }) as typeof fetch;
  const input = { tenantId, projectId: 'project', avatarId: 'public-avatar', consent: true, voiceoverUrl: '/tts/voice.wav', script: 'A confirmed narration.', language: 'en' };
  const [a, b] = await Promise.all([ensureHeygenAutomationJob(input), ensureHeygenAutomationJob(input)]);
  assert.equal(a.id, b.id, 'concurrent requests share one job');
  assert.equal(a.status, 'failed');
  assert.equal((await ensureHeygenAutomationJob(input)).id, a.id, 'failure waits for explicit retry');
  assert.equal(submissions, 1, 'failed polling must not create more billable submissions');
  await assert.rejects(ensureHeygenAutomationJob({ ...input, consent: false }));
  networkFailure = true;
  const pending = await ensureHeygenAutomationJob({ ...input, projectId: 'network-case' });
  assert.equal(pending.status, 'processing', 'poll network failures keep the submitted task alive');
  assert.equal(pending.providerTaskId, 'failed-task');
  assert.equal((await ensureHeygenAutomationJob({ ...input, projectId: 'network-case' })).id, pending.id);
  assert.equal(submissions, 2, 'network failures do not create new paid tasks');
  console.log('HeyGen concurrency, failed-job idempotency and consent tests passed');
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.HEYGEN_API_KEY; else process.env.HEYGEN_API_KEY = originalKey;
  if (fs.existsSync(jobsFile)) {
    const remaining = JSON.parse(fs.readFileSync(jobsFile, 'utf8')).filter((job: any) => job.tenantId !== tenantId);
    if (!hadJobsFile && !remaining.length) fs.unlinkSync(jobsFile); else fs.writeFileSync(jobsFile, JSON.stringify(remaining, null, 2));
  }
  fs.rmSync(audioDir, { recursive: true, force: true });
}
