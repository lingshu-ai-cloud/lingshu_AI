import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// The route persists beside its module. Run a disposable code copy instead of
// adding/removing test records in a live service's job file.
const root = fs.realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
if (process.env.LINGSHU_HEYGEN_RETRY_TEST_ROOT !== root) {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-heygen-retry-')));
  try {
    for (const directory of ['server', 'src', 'shared', 'desktop']) fs.cpSync(path.join(root, directory), path.join(temporary, directory), { recursive: true });
    fs.copyFileSync(path.join(root, 'package.json'), path.join(temporary, 'package.json'));
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'server/integrations/heygenRetry.test.ts'], {
      cwd: temporary, env: { ...process.env, LINGSHU_HEYGEN_RETRY_TEST_ROOT: temporary }, encoding: 'utf8', timeout: 30_000,
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    assert.equal(result.status, 0, result.error?.message || 'isolated retry test failed');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
} else {
  const jobsPath = path.join(root, 'data/digital-human-jobs.json');
  const tenantId = 'retry-isolation';
  const voiceDirectory = path.join(root, 'data/tts/tenants', tenantId);
  fs.mkdirSync(voiceDirectory, { recursive: true });
  fs.writeFileSync(path.join(voiceDirectory, 'voice.wav'), Buffer.alloc(1000));
  const now = new Date().toISOString();
  const parent = { id: 'failed-credit-parent', tenantId, provider: 'heygen', status: 'failed', errorMessage: 'Insufficient credits',
    heygenAvatarId: 'fixture-avatar', voiceoverUrl: '/tts/voice.wav', scriptSnapshot: 'Fixture narration.', language: 'en',
    versionNumber: 1, createdAt: now, updatedAt: now };
  fs.writeFileSync(jobsPath, JSON.stringify([parent]));
  process.env.HEYGEN_API_KEY = 'isolated-test-only';
  let submissions = 0;
  globalThis.fetch = (async (url: any) => {
    const target = String(url);
    assert(target.startsWith('https://api.heygen.com/v3/'), 'every provider request is intercepted');
    if (target.endsWith('/assets')) return Response.json({ data: { asset_id: 'fixture-audio' } });
    if (target.endsWith('/videos')) { submissions++; return Response.json({ data: { video_id: `fixture-${submissions}` } }); }
    return Response.json({ data: { status: 'failed', failure_message: 'Insufficient credits' } });
  }) as typeof fetch;
  const { studioRouter } = await import('../routes/studio.js');
  const layer = (studioRouter as any).stack.find((entry: any) => entry.route?.path === '/digital-human/jobs/:id/retry');
  const handler = layer.route.stack.at(-1).handle;
  const invoke = async (id: string, tenant = tenantId) => {
    const response: any = { locals: { tenantId: tenant }, statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } };
    await handler({ params: { id } }, response);
    return response;
  };
  const [first, duplicate] = await Promise.all([invoke(parent.id), invoke(parent.id)]);
  assert.equal(first.statusCode, 202);
  assert.equal(duplicate.body.job.id, first.body.job.id, 'same parent has exactly one retry child');
  let jobs: any[] = [];
  for (let index = 0; index < 50; index++) {
    jobs = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
    if (jobs.find(job => job.id === first.body.job.id)?.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(submissions, 1, 'duplicate retry must not create a second billable submission');
  assert.equal(jobs.filter(job => job.parentJobId === parent.id).length, 1);
  const child = jobs.find(job => job.id === first.body.job.id)!;
  assert.equal(child.status, 'failed', 'insufficient credit remains failed, never review/completed');
  assert.equal(child.errorMessage, 'Insufficient credits');
  assert.equal(child.versionNumber, 2);
  assert.equal((await invoke(parent.id)).body.job.id, child.id, 'replaying parent after child failure still reuses child');
  assert.equal((await invoke(parent.id, 'other-tenant')).statusCode, 404);
  const nextAttempt = await invoke(child.id);
  assert.notEqual(nextAttempt.body.job.id, child.id, 'explicit retry of failed child creates a new attempt');
  assert.equal(nextAttempt.body.job.parentJobId, child.id);
  for (let index = 0; index < 50 && submissions < 2; index++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(submissions, 2);
  console.log('HeyGen retry route: concurrent/replayed parent deduplication, credit failure, lineage and tenant isolation passed');
}
