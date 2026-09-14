import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  PB_URL: process.env.PB_URL,
  DISABLE_LOCAL_AUTH_FALLBACK: process.env.DISABLE_LOCAL_AUTH_FALLBACK,
  SUPPORT_ACCESS_SECRET: process.env.SUPPORT_ACCESS_SECRET,
  LOCAL_STORE_DIR: process.env.LOCAL_STORE_DIR,
  DIGITAL_HUMAN_JOBS_FILE: process.env.DIGITAL_HUMAN_JOBS_FILE,
};
const originalCwd = process.cwd();
const temporaryCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-support-read-only-'));

process.chdir(temporaryCwd);
process.env.NODE_ENV = 'test';
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.DISABLE_LOCAL_AUTH_FALLBACK = 'false';
process.env.SUPPORT_ACCESS_SECRET = 'support-read-only-route-test-secret';
process.env.LOCAL_STORE_DIR = path.join(temporaryCwd, 'local-store');
process.env.DIGITAL_HUMAN_JOBS_FILE = path.join(temporaryCwd, 'digital-human-jobs.json');
fs.writeFileSync(process.env.DIGITAL_HUMAN_JOBS_FILE, JSON.stringify([{
  id: 'support-visible-job', tenantId: 'support-read-only-tenant', projectId: 'project-1', avatarMaterialId: 'avatar-1', avatarName: 'Presenter', voiceoverUrl: '/tts/sample.mp3', scriptSnapshot: 'hello', language: 'en', mode: 'quality', consentConfirmed: true, commercialRightsStatus: 'cleared', provider: 'latentsync', status: 'queued', stage: 'queued', progress: 0, versionNumber: 1, createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z',
}], null, 2), { mode: 0o600 });

const [{
  createSupportAccessRequest,
  issueSupportAccessToken,
  setSupportAccessDefaultAuthorized,
}, { store }, { digitalEmployeesRouter }, { enterpriseRouter }, { studioRouter }, { socialRouter }, { youtubeRouter }, { agentMemoryRouter }, { videosRouter }, { assistantThreadsRouter }, { authRouter }, { customerSuggestionsRouter }, { schedulerRouter }, { createBrowserReadSession }, { isSideEffectingReadPath }] = await Promise.all([
  import('../lib/supportAccess.js'),
  import('../storage/index.js'),
  import('../routes/digitalEmployees.js'),
  import('../routes/enterprise.js'),
  import('../routes/studio.js'),
  import('../routes/social.js'),
  import('../routes/youtube.js'),
  import('../routes/agentMemory.js'),
  import('../routes/videos.js'),
  import('../routes/assistantThreads.js'),
  import('../routes/auth.js'),
  import('../routes/customerSuggestions.js'),
  import('../routes/scheduler.js'),
  import('../digitalEmployees/browserReadSession.js'),
  import('./readOnlyHttp.js'),
]);

assert.equal(isSideEffectingReadPath({
  originalUrl: '/api/overseas/scheduler/business-dynamics',
  url: '/business-dynamics',
}), false, 'an ordinary cached business-dynamics projection remains a read');
assert.equal(isSideEffectingReadPath({
  originalUrl: '/api/overseas/scheduler/business-dynamics?refresh=1',
  url: '/business-dynamics?refresh=1',
}), true, 'an explicit business-dynamics refresh is side-effecting');
assert.equal(isSideEffectingReadPath({
  originalUrl: '/api/overseas/customers/customer-1/suggestions',
  url: '/customer-1/suggestions',
}), true, 'customer suggestions consume an AI generation and are not a read');

const tenantId = 'support-read-only-tenant';
const adminUserId = 'support-read-only-admin';
setSupportAccessDefaultAuthorized(tenantId, adminUserId, true);
const supportRequest = createSupportAccessRequest({
  tenantId,
  tenantName: 'Support Read Only Tenant',
  requestedByUserId: adminUserId,
  requestedByEmail: 'support-agent@example.test',
});
const issued = issueSupportAccessToken(supportRequest.id, adminUserId);
assert.ok(issued, 'fixture must issue a real signed support token');
const browserReadSession = createBrowserReadSession({
  tenantId,
  userId: 'support-read-only-browser-agent',
  role: 'admin',
});

const originalStore = {
  list: store.list,
  getById: store.getById,
  create: store.create,
  update: store.update,
  delete: store.delete,
};
let mutationCalls = 0;
let exposeLegacyFakeVideo = false;
store.list = (async (collection: string) => {
  const items = exposeLegacyFakeVideo && collection === 'trend_videos'
    ? [{ id: 'legacy-fake', tenantId, title: 'auto-crawl sample', sourceUrl: 'https://example.test/#auto-crawl-1', contentFormat: 'video', status: 'ready' }]
    : [];
  return { items, totalItems: items.length, totalPages: items.length ? 1 : 0, page: 1, perPage: 100 };
}) as typeof store.list;
store.getById = (async () => null) as typeof store.getById;
store.create = (async () => { mutationCalls += 1; return null; }) as typeof store.create;
store.update = (async () => { mutationCalls += 1; return false; }) as typeof store.update;
store.delete = (async () => { mutationCalls += 1; return false; }) as typeof store.delete;

const app = express();
app.use(express.json());
app.use('/api/overseas/digital-employees', digitalEmployeesRouter);
app.use('/api/overseas/enterprise', enterpriseRouter);
app.use('/api/overseas/studio', studioRouter);
app.use('/api/overseas/social', socialRouter);
app.use('/api/overseas/youtube', youtubeRouter);
app.use('/api/overseas/agent-memory', agentMemoryRouter);
app.use('/api/overseas/videos', videosRouter);
app.use('/api/overseas/assistant-threads', assistantThreadsRouter);
app.use('/api/overseas/auth', authRouter);
app.use('/api/overseas/customers', customerSuggestionsRouter);
app.use('/api/overseas/scheduler', schedulerRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('test server did not bind a TCP port');
const origin = `http://127.0.0.1:${address.port}/api/overseas/digital-employees`;
const supportAuthorization = { Authorization: `Bearer ${issued.token}` };

async function request(pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    ...init,
    headers: {
      ...supportAuthorization,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  return {
    status: response.status,
    body: init.method === 'HEAD'
      ? {}
      : response.headers.get('content-type')?.includes('application/json')
      ? await response.json() as Record<string, unknown>
      : {},
  };
}

try {
  const readable = await request('/publishing-accounts');
  assert.equal(readable.status, 200, 'a support session must retain ordinary read access');
  assert.deepEqual(readable.body, { items: [] });

  const readableHead = await request('/publishing-accounts', { method: 'HEAD' });
  assert.equal(readableHead.status, 200, 'an ordinary read-only HEAD request must remain available');

  const options = await request('/publishing-accounts', { method: 'OPTIONS' });
  assert.equal(options.status, 403, 'support sessions are restricted to GET/HEAD; OPTIONS must fail closed too');
  assert.equal(options.body.error, 'support_access_read_only');

  const deniedWrites: Array<[string, RequestInit]> = [
    ['/approvals/approval-1/decide', { method: 'POST', body: JSON.stringify({ decision: 'approved' }) }],
    ['/followup-batches/batch-1/dispatch', { method: 'POST', body: '{}' }],
    ['/tasks/task-1/skip', { method: 'POST', body: '{}' }],
    ['/runs/run-1/cancel', { method: 'POST', body: '{}' }],
    ['/content-projects/project-1/approve', { method: 'POST', body: JSON.stringify({ hash: 'approved-hash' }) }],
    ['/review-todos', { method: 'PUT', body: '{}' }],
  ];
  for (const [pathname, init] of deniedWrites) {
    const denied = await request(pathname, init);
    assert.equal(denied.status, 403, `${pathname} must be denied before route business logic`);
    assert.equal(denied.body.error, 'support_access_read_only');
  }

  for (const [pathname, init] of [
    ['/enterprise/profile', { method: 'PATCH', body: '{}' }],
    ['/studio/projects', { method: 'POST', body: '{}' }],
    ['/social/accounts/account-1', { method: 'DELETE' }],
    ['/videos/video-1/reanalyze-image', { method: 'POST', body: '{}' }],
    ['/assistant-threads/sales', { method: 'PUT', body: '{}' }],
    ['/auth/guide-seen', { method: 'POST', body: '{}' }],
  ] as Array<[string, RequestInit]>) {
    const denied = await fetch(`${origin.replace('/digital-employees', '')}${pathname}`, {
      ...init,
      headers: { ...supportAuthorization, 'Content-Type': 'application/json' },
    });
    assert.equal(denied.status, 403, `${pathname} must inherit the global support read-only gate`);
    assert.equal((await denied.json() as Record<string, unknown>).error, 'support_access_read_only');
  }

  exposeLegacyFakeVideo = true;
  const videosRead = await fetch(`${origin.replace('/digital-employees', '')}/videos`, { headers: supportAuthorization });
  assert.equal(videosRead.status, 200, 'support may read a tenant video inventory');
  assert.equal(mutationCalls, 0, 'video inventory GET must not run the global legacy purge');
  exposeLegacyFakeVideo = false;

  const jobBytes = fs.readFileSync(process.env.DIGITAL_HUMAN_JOBS_FILE);
  const jobMtime = fs.statSync(process.env.DIGITAL_HUMAN_JOBS_FILE).mtimeMs;
  const jobRead = await fetch(`${origin.replace('/digital-employees', '')}/studio/digital-human/jobs/support-visible-job`, { headers: supportAuthorization });
  assert.equal(jobRead.status, 200, 'support may inspect an in-flight digital-human job');
  assert.deepEqual(fs.readFileSync(process.env.DIGITAL_HUMAN_JOBS_FILE), jobBytes, 'job GET must not refresh or persist provider state');
  assert.equal(fs.statSync(process.env.DIGITAL_HUMAN_JOBS_FILE).mtimeMs, jobMtime);

  const sideEffectingRead = await request('/runs/run-1/tasks/task-1/browser-stream');
  assert.equal(sideEffectingRead.status, 403, 'a GET that launches a browser and writes telemetry is not read-only');
  assert.equal(sideEffectingRead.body.error, 'support_access_read_only');
  const sideEffectingHead = await request('/runs/run-1/tasks/task-1/browser-stream', { method: 'HEAD' });
  assert.equal(sideEffectingHead.status, 403, 'HEAD must not fall through to a side-effecting GET handler');
  for (const pathname of [
    '/agent-memory/backup',
    '/social/accounts/account-1/insights',
    '/social/accounts/account-1/videos',
    '/youtube/accounts/account-1/analytics',
    '/studio/materials/pb/material-1/poster',
    '/studio/bgm',
    '/videos/video-1/thumbnail',
    '/customers/customer-1/suggestions',
    '/scheduler/business-dynamics?refresh=1',
  ]) {
    for (const method of ['GET', 'HEAD']) {
      const denied = await fetch(`${origin.replace('/digital-employees', '')}${pathname}`, {
        method,
        headers: supportAuthorization,
      });
      assert.equal(denied.status, 403, `${method} ${pathname} must be denied before its read-side persistence`);
      if (method === 'GET') {
        assert.equal((await denied.json() as Record<string, unknown>).error, 'support_access_read_only');
      }
    }
  }
  assert.equal(mutationCalls, 0, 'denied support requests must not reach persistent mutations');

  const browserAuthorization = { Authorization: `Bearer ${browserReadSession.token}` };
  const browserOrdinaryRead = await fetch(`${origin}/publishing-accounts`, { headers: browserAuthorization });
  assert.equal(browserOrdinaryRead.status, 200, 'browser-read sessions must retain access to genuinely read-only tenant routes');
  for (const pathname of [
    '/digital-employees/runs/run-1/tasks/task-1/browser-stream/',
    '/agent-memory/backup',
    '/social/accounts/account-1/insights',
    '/social/accounts/account-1/videos',
    '/youtube/accounts/account-1/analytics',
    '/studio/materials/pb/material-1/poster',
    '/studio/bgm',
    '/videos/video-1/thumbnail',
    '/customers/customer-1/suggestions',
    '/scheduler/business-dynamics?refresh=1',
  ]) {
    for (const method of ['GET', 'HEAD']) {
      const denied = await fetch(`${origin.replace('/digital-employees', '')}${pathname}`, {
        method,
        headers: browserAuthorization,
      });
      assert.equal(denied.status, 403, `${method} ${pathname} must not let a browser-read token trigger persistence`);
      if (method === 'GET') {
        assert.equal((await denied.json() as Record<string, unknown>).error, 'agent_browser_read_only');
      }
    }
  }
  assert.equal(mutationCalls, 0, 'denied browser-read requests must not reach persistent mutations');

  const ordinaryToken = `local-demo.${Buffer.from(JSON.stringify({
    userId: 'ordinary-user',
    tenantId,
  }), 'utf8').toString('base64url')}`;
  const ordinaryResponse = await fetch(`${origin}/approvals/missing/decide`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ordinaryToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'approved' }),
  });
  assert.equal(ordinaryResponse.status, 404, 'the support-only gate must not block an ordinary tenant session');

  console.log('support session read-only route tests passed');
} finally {
  browserReadSession.revoke();
  Object.assign(store, originalStore);
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  process.chdir(originalCwd);
  fs.rmSync(temporaryCwd, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
