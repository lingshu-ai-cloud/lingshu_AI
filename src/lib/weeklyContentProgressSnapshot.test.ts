import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DigitalEmployeeOverview } from './digitalEmployees';
import { readWeeklyContentProgressSnapshot } from './weeklyContentProgressSnapshot';

const overview = (projectIds: string[] = []): DigitalEmployeeOverview => ({
  goal: { id: 'goal' }, plan: { id: 'plan', businessPackage: { tasks: [{ templateId: 'production', videoPlans: [{ contentId: 'content', productionRole: 'master', route: 'material', presenter: 'material' }] }] } },
  run: { id: 'run', goal_id: 'goal', plan_id: 'plan', status: 'running' },
  tasks: [{ id: 'task', run_id: 'run', task_key: 'content_production', status: 'running' }],
  contentQueue: { items: [{ id: 'queue', contentId: 'content', orderId: 'order', taskId: 'task', origin: 'weekly_plan', lineage: { goalId: 'goal', planId: 'plan' }, projectIds, steps: [], status: 'producing' }] },
} as unknown as DigitalEmployeeOverview);
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
const fetchSnapshot = (data: DigitalEmployeeOverview, projects: unknown = []): typeof fetch => async (url) => response(String(url).includes('/overview?') ? data : projects);

test('read-only snapshot discovers new projects and refreshes the run alongside receipts', async () => {
  const before = overview(), next = overview(['project']); next.run!.status = 'paused';
  const original = JSON.stringify(before), calls: Array<{ url: string; init?: RequestInit }> = [];
  const snapshot = await readWeeklyContentProgressSnapshot({ data: before, contentId: 'content', headers: { Authorization: 'Bearer test' }, fetcher: async (url, init) => {
    calls.push({ url: String(url), init });
    return response(String(url).includes('/overview?') ? next : [{ id: 'project', spec: {} }, { id: 'unrelated', spec: {} }]);
  } });
  assert.equal(snapshot.data.run?.status, 'paused');
  assert.deepEqual(snapshot.projects.map(project => project.id), ['project']);
  assert.equal(JSON.stringify(before), original);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.init?.method, 'GET');
    assert.equal(call.init?.cache, 'no-store');
    assert.equal((call.init?.headers as Record<string, string>).Authorization, 'Bearer test');
    assert.ok(call.init?.signal);
    assert.doesNotMatch(call.url, /reconcile|retry|start|approve/);
  }
});

test('direct content snapshot loads provider executions without turning a missing optional ledger into completion', async () => {
  const direct = overview(['project']);
  Object.assign(direct.contentQueue!.items[0]!, {
    id: 'social:direct-task',
    contentId: 'direct-task',
    socialContentTaskId: 'direct-task',
    origin: 'manual',
  });
  const urls: string[] = [];
  const snapshot = await readWeeklyContentProgressSnapshot({ data: direct, contentId: 'direct-task', headers: {}, fetcher: async url => {
    const value = String(url); urls.push(value);
    if (value.includes('/overview?')) return response(direct);
    if (value.includes('/production/executions?')) return response([{ id: 'execution', projectId: 'project', state: 'pending', externalTaskId: 'provider-task' }]);
    return response([{ id: 'project', spec: { socialContentTaskId: 'direct-task', presentationMode: 'avatar' } }]);
  } });
  assert.equal(urls.length, 3);
  assert.equal(snapshot.projects[0]?.executionsStatus, 'available');
  assert.deepEqual(snapshot.projects[0]?.executions?.map(item => item.id), ['execution']);

  const unavailable = await readWeeklyContentProgressSnapshot({ data: direct, contentId: 'direct-task', headers: {}, fetcher: async url => {
    const value = String(url);
    if (value.includes('/overview?')) return response(direct);
    if (value.includes('/production/executions?')) return new Response('', { status: 503 });
    return response([{ id: 'project', spec: { socialContentTaskId: 'direct-task', presentationMode: 'avatar' } }]);
  } });
  assert.equal(unavailable.projects[0]?.executionsStatus, 'unavailable');
  assert.deepEqual(unavailable.projects[0]?.executions, []);
});

test('new run can appear after starting the same scoped plan', async () => {
  const before = overview(); before.run = null;
  const snapshot = await readWeeklyContentProgressSnapshot({ data: before, contentId: 'content', headers: {}, fetcher: fetchSnapshot(overview()) });
  assert.equal(snapshot.data.run?.id, 'run');
});

test('rejects foreign goal, plan, replaced run, malformed results and inconsistent lineage', async () => {
  for (const mutate of [
    (data: DigitalEmployeeOverview) => { data.goal!.id = 'other'; },
    (data: DigitalEmployeeOverview) => { data.plan!.id = 'other'; },
    (data: DigitalEmployeeOverview) => { data.run!.id = 'other'; },
    (data: DigitalEmployeeOverview) => { data.run!.plan_id = 'other'; },
    (data: DigitalEmployeeOverview) => { data.run!.goal_id = 'other'; },
    (data: DigitalEmployeeOverview) => { data.tasks = undefined as never; },
  ]) {
    const next = overview(); mutate(next);
    await assert.rejects(readWeeklyContentProgressSnapshot({ data: overview(), contentId: 'content', headers: {}, fetcher: fetchSnapshot(next) }), /目标、计划或运行已变化/);
  }
  await assert.rejects(readWeeklyContentProgressSnapshot({ data: overview(), contentId: 'content', headers: {}, fetcher: fetchSnapshot(overview(), {}) }), /目标、计划或运行已变化/);
});

const pendingFetch: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
  const aborted = () => reject(init?.signal?.reason ?? new Error('aborted'));
  if (init?.signal?.aborted) aborted();
  else init?.signal?.addEventListener('abort', aborted, { once: true });
});

test('timeout aborts both GET requests so a hung poll cannot stop later refreshes', async () => {
  await assert.rejects(readWeeklyContentProgressSnapshot({ data: overview(), contentId: 'content', headers: {}, timeoutMs: 10, fetcher: pendingFetch }), /读取超时/);
});

test('closing a drawer aborts in-flight work without committing a partial snapshot', async () => {
  const controller = new AbortController();
  const request = readWeeklyContentProgressSnapshot({ data: overview(), contentId: 'content', headers: {}, signal: controller.signal, fetcher: pendingFetch });
  controller.abort(new Error('drawer closed'));
  await assert.rejects(request, /drawer closed/);
});

test('one failed GET rejects the snapshot and cancels the other GET', async () => {
  let cancelled = false;
  await assert.rejects(readWeeklyContentProgressSnapshot({ data: overview(), contentId: 'content', headers: {}, fetcher: (url, init) => {
    if (String(url).includes('/overview?')) return Promise.resolve(new Response('', { status: 503 }));
    init?.signal?.addEventListener('abort', () => { cancelled = true; }, { once: true });
    return pendingFetch(url, init);
  } }), /503/);
  assert.equal(cancelled, true);
});
