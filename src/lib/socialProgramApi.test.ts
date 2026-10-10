import assert from 'node:assert/strict';
import test from 'node:test';
import { socialProgramApi, SocialProgramRequestError } from './socialProgramApi.js';

test('backward scheduling sends capacity assumptions and exact version without client task authority', async () => {
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  let body: any;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), '/api/overseas/social-programs/program%2Fa/operating-packages/week%2Fa/backward-schedule');
    body = JSON.parse(String(init?.body));
    return Response.json({ item: { revisionApplied: false, publicationGap: 1 } });
  };
  try {
    const result = await socialProgramApi.planBackwardSchedule('program/a', 'week/a', 3, { constraints: {}, resources: {}, remainingBudgetCny: 10, tasks: [{ status: 'succeeded' }], now: '2099-01-01' } as any);
    assert.deepEqual(body, { packageVersion: 3, constraints: {}, resources: {}, remainingBudgetCny: 10 });
    assert.equal(result.revisionApplied, false);
  } finally { globalThis.fetch = previousFetch; Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage }); }
});

const storage = {
  getItem: () => 'test-token',
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
} satisfies Storage;

test('material recheck clears only its named blocker and preserves exact task identity', async () => {
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), '/api/overseas/social-programs/program%2Fa/operating-packages/package%2Fb/execution-tasks/task%2Fc/recheck-required-materials');
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { expectedPackageVersion: 2 });
    return Response.json({ items: [] });
  };
  try { assert.deepEqual(await socialProgramApi.recheckRequiredMaterials('program/a', 'package/b', 'task/c', 2), []); }
  finally { globalThis.fetch = previousFetch; Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage }); }
});

test('social program API rejects an HTML fallback instead of crashing the page', async () => {
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  globalThis.fetch = async () => new Response('<!doctype html><title>stale backend</title>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=UTF-8' },
  });
  try {
    await assert.rejects(
      () => socialProgramApi.list(),
      (error: unknown) => error instanceof SocialProgramRequestError && error.code === 'social_program_invalid_response',
    );
  } finally {
    globalThis.fetch = previousFetch;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage });
  }
});

test('social program API accepts a valid project list', async () => {
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  globalThis.fetch = async () => Response.json({ items: [] });
  try {
    assert.deepEqual(await socialProgramApi.list(), []);
  } finally {
    globalThis.fetch = previousFetch;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage });
  }
});

test('social program API exposes the weekly operating package lifecycle', async () => {
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method || 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return Response.json(String(input).includes('?weekStart=') ? { items: [] } : { item: { packageId: 'package-a' } });
  };
  try {
    assert.deepEqual(await socialProgramApi.listOperatingPackages('program/a', '2026-10-05'), []);
    await socialProgramApi.getOperatingPackage('program/a', 'package/a');
    await socialProgramApi.createOperatingPackage('program/a', { weekStart: '2026-10-05' });
    await socialProgramApi.reviseOperatingPackage('program/a', 'package/a', { expectedVersion: 1 });
    await socialProgramApi.activateOperatingPackage('program/a', 'package/a', { expectedVersion: 2 });
    await socialProgramApi.retireOperatingPackage('program/a', 'package/a', { expectedVersion: 2 });
    assert.deepEqual(calls, [
      { url: '/api/overseas/social-programs/program%2Fa/operating-packages?weekStart=2026-10-05', method: 'GET', body: null },
      { url: '/api/overseas/social-programs/program%2Fa/operating-packages/package%2Fa', method: 'GET', body: null },
      { url: '/api/overseas/social-programs/program%2Fa/operating-packages', method: 'POST', body: { weekStart: '2026-10-05' } },
      { url: '/api/overseas/social-programs/program%2Fa/operating-packages/package%2Fa', method: 'PUT', body: { expectedVersion: 1 } },
      { url: '/api/overseas/social-programs/program%2Fa/operating-packages/package%2Fa/activate', method: 'POST', body: { expectedVersion: 2 } },
      { url: '/api/overseas/social-programs/program%2Fa/operating-packages/package%2Fa/retire', method: 'POST', body: { expectedVersion: 2 } },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage });
  }
});

test('social program API exposes the two-step Agent plan and detailed execution timeline', async () => {
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json(url.includes('/execution-tasks') ? { items: [] } : { item: { planningId: 'planning-a', version: 2 } });
  };
  try {
    await socialProgramApi.getAgentPlanning('program/a', 'package/a', 3);
    await socialProgramApi.runDirectorPlanning('program/a', 'package/a', { expectedPackageVersion: 3, expectedPlanningVersion: 2 });
    await socialProgramApi.mergeAgentSchedule('program/a', 'package/a', { expectedPackageVersion: 3, expectedPlanningVersion: 3 });
    await socialProgramApi.confirmAgentSchedule('program/a', 'package/a', { expectedPackageVersion: 3, expectedPlanningVersion: 4 });
    await socialProgramApi.dispatchAgentSchedule('program/a', 'package/a', { expectedPackageVersion: 3, expectedPlanningVersion: 5 });
    assert.deepEqual(await socialProgramApi.listExecutionTasks('program/a', 'package/a', 3), []);
    assert.deepEqual(await socialProgramApi.approveExecutionTask('program/a', 'package/a', 'task/a'), []);
    assert.deepEqual(calls, [
      { url: '/api/overseas/social-programs/program%2Fa/operating-packages/package%2Fa/agent-planning?version=3', method: 'GET', body: null },
      { url: '/api/overseas/social-programs/program%2Fa/operating-packages/package%2Fa/agent-planning/director-analysis', method: 'POST', body: { expectedPackageVersion: 3, expectedPlanningVersion: 2 } },
      { url: '/api/overseas/social-programs/program%2Fa/operating-packages/package%2Fa/agent-planning/merge', method: 'POST', body: { expectedPackageVersion: 3, expectedPlanningVersion: 3 } },
      { url: '/api/overseas/social-programs/program%2Fa/operating-packages/package%2Fa/agent-planning/confirm', method: 'POST', body: { expectedPackageVersion: 3, expectedPlanningVersion: 4 } },
      { url: '/api/overseas/social-programs/program%2Fa/operating-packages/package%2Fa/agent-planning/dispatch', method: 'POST', body: { expectedPackageVersion: 3, expectedPlanningVersion: 5 } },
      { url: '/api/overseas/social-programs/program%2Fa/operating-packages/package%2Fa/execution-tasks?version=3', method: 'GET', body: null },
      { url: '/api/overseas/social-programs/program%2Fa/operating-packages/package%2Fa/execution-tasks/task%2Fa/approve', method: 'POST', body: {} },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage });
  }
});

test('social program API exposes raw operating constraints and server resolution without accepting computed results', async () => {
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(input).endsWith('/operating-constraints') && !init?.method) return Response.json({ item: null });
    if (String(input).endsWith('/operating-plan/resolve')) return Response.json({ item: { snapshot: { snapshotId: 'snapshot-a' } }, weeklyAuthority: { operatingDecisionSnapshotRef: { type: 'operating_authority_snapshot', id: 'snapshot-a', version: 1 } } });
    return Response.json({ item: { constraintsId: 'constraints-a', version: 1 } });
  };
  try {
    assert.equal(await socialProgramApi.getOperatingConstraints('program/a'), null);
    await socialProgramApi.saveOperatingConstraints('program/a', { expectedVersion: 0, weeklyBudgetCny: 100 });
    await socialProgramApi.resolveOperatingPlan('program/a', { weekStart: '2026-10-05' });
    assert.deepEqual(calls, [
      { url: '/api/overseas/social-programs/program%2Fa/operating-constraints', method: 'GET', body: null },
      { url: '/api/overseas/social-programs/program%2Fa/operating-constraints', method: 'PUT', body: { expectedVersion: 0, weeklyBudgetCny: 100 } },
      { url: '/api/overseas/social-programs/program%2Fa/operating-plan/resolve', method: 'POST', body: { weekStart: '2026-10-05' } },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage });
  }
});


test('schedule revision confirms frozen server proposal without sending task graph or computed assignments', async () => {
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  const calls: Array<{url:string;body:unknown}> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({url:String(input),body:JSON.parse(String(init?.body))});
    return Response.json(String(input).endsWith('/confirm') ? {activated:false} : {item:{proposalId:'proposal/a'}});
  };
  try {
    const capacity = {constraints:{},resources:{},remainingBudgetCny:100,operationalDeadlines:{monitor:'2026-10-11T20:00:00+08:00'},tasks:[{status:'succeeded'}],now:'forged',assignments:[]} as any;
    await socialProgramApi.createScheduleRevisionProposal('program/a','package/a',3,capacity);
    await socialProgramApi.confirmScheduleRevision('program/a','package/a','proposal/a',3,'frozen-hash');
    assert.deepEqual(calls,[
      {url:'/api/overseas/social-programs/program%2Fa/operating-packages/package%2Fa/schedule-revisions',body:{packageVersion:3,constraints:{},resources:{},remainingBudgetCny:100,operationalDeadlines:capacity.operationalDeadlines}},
      {url:'/api/overseas/social-programs/program%2Fa/operating-packages/package%2Fa/schedule-revisions/proposal%2Fa/confirm',body:{expectedVersion:3,inputEvidenceHash:'frozen-hash'}},
    ]);
  } finally {
    globalThis.fetch = previousFetch;
    Object.defineProperty(globalThis, 'localStorage', { configurable:true,value:previousStorage });
  }
});
