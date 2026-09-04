/** Called only by the temporary PocketBase rehearsal, never the live server. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';

assert.equal(process.env.LINGSHU_PB_REHEARSAL, 'isolated');
assert.equal(process.env.NODE_ENV, 'test');
const pb = new URL(process.env.PB_URL || '');
assert.equal(pb.hostname, '127.0.0.1');
let adminToken = '';
const pbRequest = async (endpoint: string, body: unknown) => {
  const response = await fetch(new URL('/api/' + endpoint, pb), { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: adminToken }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const result = await response.json() as any;
  assert.ok(response.ok, `PocketBase ${endpoint}: ${JSON.stringify(result)}`);
  return result;
};
adminToken = (await pbRequest('collections/_superusers/auth-with-password', {
  identity: process.env.PB_ADMIN_EMAIL, password: process.env.PB_ADMIN_PASSWORD,
})).token;
const tenant = await pbRequest('collections/tenants/records', { name: 'isolated route rehearsal', subscriptionStatus: 'active', subscriptionPlan: 'admin' });
const email = `rehearsal-${randomUUID()}@lingshu.invalid`;
const password = randomUUID();
await pbRequest('collections/users/records', { email, password, passwordConfirm: password, tenantId: tenant.id, role: 'admin', name: 'Rehearsal' });
const token = (await pbRequest('collections/users/auth-with-password', { identity: email, password })).token;
const { digitalEmployeesRouter } = await import('../server/routes/digitalEmployees.js');
const app = express(); app.use(express.json()); app.use('/digital-employees', digitalEmployeesRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address(); assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const request = async (endpoint: string, body: unknown) => {
  const response = await fetch(origin + '/digital-employees/' + endpoint, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const result = await response.json() as any;
  assert.ok(response.ok, `${endpoint}: ${JSON.stringify(result)}`); return result;
};
try {
  assert.equal((await fetch(origin + '/digital-employees')).status, 401);
  const config = {
    companyName: 'isolated route rehearsal', industry: '本地自动化验收', primaryBusiness: '验证首次配置与经营状态机',
    targetMarkets: '美国', customerProfile: '明确同意测试的采购联系人', autonomyMode: 'managed', approvalOwner: 'Rehearsal',
    primaryGoal: 'leads', focusProducts: '', enabledWorkflows: ['customer_segmentation'], socialCadence: '不采集',
    followupCadence: '每周五 09:00 生成分层草稿；真实发送前人工审批', reviewSchedule: '周五 17:30（北京时间）',
    publishingTargets: [], allowGeneratedVisuals: false, allowRealPublishing: false, allowRealCustomerMessages: false,
    constraints: ['禁止真实发布', '禁止真实发送'], team: ['planner', 'knowledge', 'customer', 'review'],
  };
  const onboarding = await request('onboarding/complete', config);
  assert.ok(onboarding.config); assert.equal(onboarding.goal, null);
  const now = new Date();
  const goal = await request('goals', {
    businessLine: 'customer_conversion', contentPlatforms: ['youtube'], title: '隔离客户分层验收', objective: '没有真实客户时明确阻断',
    metric: 'qualified_customers', baseline: 0, target: 1, unit: '人', startsAt: now.toISOString().slice(0, 10),
    endsAt: new Date(now.getTime() + 6 * 86400000).toISOString().slice(0, 10), scope: '仅当前隔离租户', constraints: ['不发送真实消息'],
  });
  assert.equal(goal.goal.status, 'draft'); assert.equal(goal.run, null);
  const approved = await request(`goals/${goal.goal.id}/approve`, {});
  assert.deepEqual(approved.tasks.map((item: any) => item.task_key), ['context_readiness', 'goal_decomposition', 'customer_segmentation', 'weekly_review']);
  assert.equal(approved.run.status, 'waiting_external');
  const task = approved.tasks.find((item: any) => item.task_key === 'customer_segmentation');
  assert.equal(task.status, 'waiting_external'); assert.match(task.blocked_reason, /客户/);
  console.log('[routes] real PocketBase auth, onboarding, draft, approval, task persistence and missing-customer gate passed; no provider calls');
} finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
