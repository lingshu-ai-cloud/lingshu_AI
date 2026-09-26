import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-notification-routes-'));
process.env.NODE_ENV = 'test';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.LOCAL_STORE_DIR = directory;

const [{ agentNotificationsRouter }, { issueLocalIdentityTokenForTest }] = await Promise.all([
  import('./agentNotifications.js'),
  import('../auth/localIdentity.js'),
]);

const app = express();
app.use(express.json());
app.use('/notifications', agentNotificationsRouter);

const authorization = (tenantId: string, userId: string, role = 'admin') => ({
  authorization: `Bearer ${issueLocalIdentityTokenForTest({ tenantId, userId, role })}`,
  'content-type': 'application/json',
});

async function request(method: string, url: string, headers: Record<string, string>, body?: unknown) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = method;
  req.url = url;
  req.headers = { ...headers, ...(payload ? { 'content-length': String(Buffer.byteLength(payload)) } : {}) };
  const res = new ServerResponse(req);
  const chunks: Buffer[] = [];
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    res.write = ((chunk: unknown) => { if (chunk) chunks.push(Buffer.from(String(chunk))); return true; }) as typeof res.write;
    res.end = ((chunk?: unknown) => {
      if (chunk) chunks.push(Buffer.from(String(chunk)));
      const text = Buffer.concat(chunks).toString('utf8');
      resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {} });
      return res;
    }) as typeof res.end;
    req.once('error', reject);
    app(req, res);
    req.push(payload || null);
    if (payload) req.push(null);
  });
}

try {
  const denied = await request('POST', '/notifications', authorization('tenant-a', 'service-user', 'customer_service'),
    { eventKey: 'denied', type: 'scope_changed', title: '拒绝', summary: '拒绝', sourceAgent: '编导Agent' });
  assert.equal(denied.status, 403, 'customer service users cannot forge Agent events');

  const created = await request('POST', '/notifications', authorization('tenant-a', 'admin-a'), {
      tenantId: 'tenant-b', eventKey: 'weekly:route:v2', type: 'weekly_package_adjusted',
      title: '经营Agent调整了周任务', summary: '发布任务由 26 调整为 24。', sourceAgent: '经营Agent',
      entityType: 'weekly_package', entityId: 'weekly-1',
      changes: [{ field: 'publicationCount', label: '发布任务', before: 26, after: 24 }],
      action: { label: '查看周任务', page: 'socialPlanning' },
  });
  assert.equal(created.status, 201);
  const createdBody = created.body as { item: { id: string }; created: boolean };
  assert.equal(createdBody.created, true);
  assert.match(createdBody.item.id, /^notification_/);

  const tenantBFeed = await request('GET', '/notifications', authorization('tenant-b', 'admin-b'));
  assert.equal((tenantBFeed.body as { items: unknown[] }).items.length, 0, 'request JSON cannot override authenticated tenant');

  const firstFeed = await request('GET', '/notifications', authorization('tenant-a', 'user-a'));
  const firstBody = firstFeed.body as { items: Array<{ id: string; readAt: string | null }>; unreadCount: number };
  assert.equal(firstBody.unreadCount, 1);
  assert.equal(firstBody.items[0].readAt, null);

  const read = await request('PATCH', `/notifications/${encodeURIComponent(createdBody.item.id)}/read`, authorization('tenant-a', 'user-a'));
  assert.equal(read.status, 200);
  assert.ok((read.body as { item: { readAt: string | null } }).item.readAt);
  assert.equal((await request('GET', '/notifications', authorization('tenant-a', 'user-a'))).body.unreadCount, 0);
  assert.equal((await request('GET', '/notifications', authorization('tenant-a', 'user-b'))).body.unreadCount, 1, 'read state is per user');

  const crossTenantRead = await request('PATCH', `/notifications/${encodeURIComponent(createdBody.item.id)}/read`, authorization('tenant-b', 'admin-b'));
  assert.equal(crossTenantRead.status, 404);

  const readAll = await request('POST', '/notifications/read-all', authorization('tenant-a', 'user-b'));
  assert.deepEqual(readAll.body, { updated: 1 });
  console.log('agent notification HTTP auth, tenancy and read-state tests passed');
} finally {
  await rm(directory, { recursive: true, force: true });
}
