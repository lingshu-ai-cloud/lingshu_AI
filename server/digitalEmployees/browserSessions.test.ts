import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Page } from 'playwright-core';
import { createServer } from 'vite';
import { AgentBrowserSessions, type BrowserFrame, type BrowserProductionTarget } from './browserSessions.js';
import { browserReadIdentity, createBrowserReadSession } from './browserReadSession.js';

// Test fixtures live only in a temporary datastore. The browser loads the
// actual App, AiCreateStudio and original API routes, never a substitute HTML UI.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-production-page-test-'));
process.env.LOCAL_STORE_DIR = temp;
process.env.NODE_ENV = 'test';
process.env.PB_URL = 'http://127.0.0.1:1';
const scope = { tenantId: 'browser-test-a', runId: 'run-a', taskId: 'script-a' };
const projectId = 'browser-test-project';
const project = { id: projectId, tenant_id: scope.tenantId, title: '隔离测试项目', status: 'draft', spec: { mode: 'material_mix', productName: '浏览器回归产品', script: '', duration: 15 }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
fs.writeFileSync(path.join(temp, 'studio_projects.json'), JSON.stringify([project]));
const { authRouter } = await import('../routes/auth.js');
const { studioRouter } = await import('../routes/studio.js');
const { enterpriseRouter } = await import('../routes/enterprise.js');
const { createMockCustomers } = await import('../../src/mocks/customerProfiles.js');
const customerFixture = { ...createMockCustomers()[0], id: 'browser-test-customer', name: '隔离回归客户', isMock: false, stage: 'silent30' as const };
const app = express();
app.use(express.json());
app.use('/api/overseas/auth', authRouter);
app.get('/api/overseas/customers', (req, res) => {
  const identity = browserReadIdentity(req);
  if (!identity || identity.tenantId !== scope.tenantId) { res.status(403).json({ error: 'not_allowed' }); return; }
  res.json({ items: [customerFixture], source: 'test_fixture' });
});
app.get('/api/overseas/scheduler', (req, res) => {
  const identity = browserReadIdentity(req);
  if (!identity || identity.tenantId !== scope.tenantId) { res.status(403).json({ error: 'not_allowed' }); return; }
  res.json([{ id: 'browser-test-schedule', name: '隔离采集回归', taskType: 'video_keyword_crawl', category: 'daily', cronExpr: '0 9 * * *', cronLabel: '每天 09:00', enabled: true, config: { platforms: 'youtube', keywords: 'test' }, createdAt: new Date().toISOString() }]);
});
app.use('/api/overseas/studio', studioRouter);
app.use('/api/overseas/enterprise', enterpriseRouter);
app.use('/api/overseas', (_req, res) => { res.status(404).json({ error: 'test_unmounted_route' }); });
const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'spa', logLevel: 'error' });
app.use(vite.middlewares);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const manager = new AgentBrowserSessions({ appOrigin: origin, maxSessions: 3 });
let executions = 0;
const frames: BrowserFrame[] = [];
const clicks: unknown[] = [];
const read = async (): Promise<BrowserProductionTarget> => ({ userId: 'browser-test-user', projectId, stage: 'script', revision: String(executions), link: { page: 'smartAssets', runId: scope.runId, taskId: scope.taskId, businessRef: { entityId: projectId, taskKey: 'content_production' } } });
manager.setTelemetry(async (_, action) => { if (action.kind === 'click') clicks.push(action); });
try {
  const credential = createBrowserReadSession({ tenantId: scope.tenantId, userId: 'test', role: 'social_operator' });
  const req = { headers: { authorization: `Bearer ${credential.token}` }, method: 'GET', originalUrl: '/api/overseas/studio/projects', url: '' };
  assert.equal(browserReadIdentity(req)?.tenantId, scope.tenantId);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(browserReadIdentity({ ...req, method }), null);
  for (const originalUrl of ['/api/overseas/admin', '/api/overseas/customers', '/api/overseas/auth/employees', '/api/overseas/x/browser-stream']) assert.equal(browserReadIdentity({ ...req, originalUrl }), null);
  credential.revoke();
  assert.equal(browserReadIdentity(req), null);
  const stop = await manager.watch(scope, read, packet => { if (packet.type === 'frame') frames.push(packet); });
  const sessions = (manager as unknown as { sessions: Map<string, Promise<{ page: Page }>> }).sessions;
  const { page } = await sessions.values().next().value!;
  page.on('pageerror', error => console.error('PAGE ERROR', error.message));
  await page.locator('[data-agent-action="studio-primary"]').waitFor({ timeout: 60_000 });
  assert.equal(new URL(page.url()).pathname, '/');
  assert.equal(new URL(page.url()).searchParams.get('page'), 'smartAssets');
  assert.equal(new URL(page.url()).searchParams.get('project'), projectId);
  assert.match(await page.locator('body').innerText(), /AI 智能创作|AI智能创作|智能创作/);
  assert.equal(executions, 0);
  assert.equal(clicks.length, 0);
  assert.ok(frames.length);
  assert.equal(Buffer.from(frames[0].image, 'base64').subarray(0, 2).toString('hex'), 'ffd8');
  assert.equal(await manager.perform(scope, read, '验证原页面点击', async () => { executions++; return 'clicked'; }), 'clicked');
  assert.equal(executions, 1);
  assert.equal(clicks.length, 1);
  await assert.rejects(manager.perform(scope, read, '验证失败释放', async () => { throw new Error('test-step-failed'); }), /test-step-failed/);
  await manager.perform(scope, read, '验证重试', async () => { executions++; });
  assert.equal(executions, 2);
  // Page scripts cannot bypass the browser gate with ordinary writes.
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/overseas/studio/projects', { method: 'POST', body: '{}' }); return false; } catch { return true; } }), true);
  stop();
  const customerScope = { ...scope, taskId: 'customer-task' };
  const customerRead = async (): Promise<BrowserProductionTarget> => ({ userId: 'browser-test-user', customerId: customerFixture.id, link: { page: 'conversion', runId: scope.runId, taskId: customerScope.taskId, businessRef: { taskKey: 'followup_batch_draft', entityId: customerFixture.id } } });
  const stopCustomer = await manager.watch(customerScope, customerRead, () => {});
  const customerSession = await sessions.get(JSON.stringify([scope.tenantId, scope.runId, customerScope.taskId]))!;
  await customerSession.page.getByText(customerFixture.name, { exact: true }).first().waitFor({ timeout: 30_000 });
  const originalMessage = customerFixture.timeline.find(item => item.body)?.body;
  if (originalMessage) await customerSession.page.getByText(originalMessage, { exact: false }).first().waitFor({ timeout: 30_000 });
  await manager.perform(customerScope, customerRead, '验证原会话操作', async () => { executions++; });
  assert.equal(executions, 3);
  assert.equal(new URL(customerSession.page.url()).searchParams.get('customer'), customerFixture.id);
  stopCustomer();
  const schedulerScope = { ...scope, taskId: 'scheduler-task' };
  const schedulerRead = async (): Promise<BrowserProductionTarget> => ({ userId: 'browser-test-user', link: { page: 'scheduled', runId: scope.runId, taskId: schedulerScope.taskId, businessRef: { taskKey: 'scheduled_source_collection', entityId: 'browser-test-schedule' } } });
  const stopScheduler = await manager.watch(schedulerScope, schedulerRead, () => {});
  await manager.perform(schedulerScope, schedulerRead, '执行采集回归', async () => { executions++; });
  assert.equal(executions, 4);
  stopScheduler();
  console.log('Production App browser tests passed: original studio and customer routes, project/customer binding, conversation context, actual clicks, read-only viewing, failed action retry');
} catch (error) {
  const sessions = (manager as unknown as { sessions: Map<string, Promise<{ page: Page }>> }).sessions;
  const current = [...sessions.values()].at(-1);
  if (current) { const { page } = await current; await page.screenshot({ path: '/tmp/agent-production-ui-failure.png' }); console.error((await page.locator('body').innerText()).slice(-6000), clicks); }
  throw error;
} finally {
  await manager.close();
  await vite.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(temp, { recursive: true, force: true });
}
