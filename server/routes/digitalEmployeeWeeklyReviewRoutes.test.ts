import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import type { GoalRecord, RunRecord } from './digitalEmployeeRecords.js';
import type { ReviewTodoBoard } from '../../src/lib/reviewTodos.js';
import { registerWeeklyReviewGenerationRoutes, registerReviewTodoRoutes } from './digitalEmployeeWeeklyReviewRoutes.js';

async function fixture() {
  const app = express(); app.use(express.json());
  app.use((_req, res, next) => { res.locals = { tenantId: 'a', userId: 'user' }; next(); });
  const calls: unknown[][] = [];
  let error = '';
  const board: ReviewTodoBoard = { id: 'board', revision: 2, sourceGoalId: 'source', week: '2026-10-26', targetGoalId: '', autoAssign: false, scheduledAt: '', items: [], lastError: '' };
  registerWeeklyReviewGenerationRoutes(app, {
    application: { async generateRunReview(...args) {
      calls.push(['generate', ...args]); if (error) throw Error(error);
      return { run: { id: args[2] } as RunRecord, goal: { id: 'goal' } as GoalRecord };
    } },
    async buildOverview(tenantId, goalId) { return { tenantId, goalId }; },
  });
  registerReviewTodoRoutes(app, { async allocateReviewTodos(...args) { calls.push(['allocate', ...args]); return 'next-goal'; } }, {
    async get(...args) { calls.push(['get', ...args]); if (error) throw Error(error); return board; },
    async save(...args) { calls.push(['save', ...args]); if (error) throw Error(error); return board; },
    async dispatch(tenantId, userId, week, allocate, revision) {
      calls.push(['dispatch', tenantId, userId, week, revision]); if (error) throw Error(error);
      const targetGoalId = await allocate(tenantId, userId, board); return { ...board, targetGoalId };
    },
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  return { calls, fail: (code: string) => { error = code; },
    request: (path: string, method = 'POST', body: unknown = {}) => fetch(`http://127.0.0.1:${address.port}${path}`, {
      method, ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    }),
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

test('both generation endpoints use authenticated identity and project the same goal', async () => {
  const f = await fixture();
  try {
    for (const [path, body] of [['/runs/run/reviews/generate', { tenantId: 'forged' }], ['/reviews/generate', { runId: ' run ', userId: 'forged' }]] as const) {
      const response = await f.request(path, 'POST', body);
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), { tenantId: 'a', goalId: 'goal' });
    }
    assert.deepEqual(f.calls, [['generate', 'a', 'user', 'run'], ['generate', 'a', 'user', 'run']]);
    assert.equal((await f.request('/reviews/generate')).status, 400);
    assert.equal(f.calls.length, 2);
  } finally { await f.close(); }
});

test('review generation maps missing runs and persistence conflicts without reporting success', async () => {
  const f = await fixture();
  try {
    f.fail('run_not_found'); assert.equal((await f.request('/runs/foreign/reviews/generate')).status, 404);
    f.fail('weekly_reviews_storage_unavailable');
    const response = await f.request('/reviews/generate', 'POST', { runId: 'run' });
    assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: 'weekly_reviews_storage_unavailable' });
  } finally { await f.close(); }
});

test('todo read/save/dispatch preserve tenant, actor, revision and the shared allocator', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/review-todos?week=2026-10-26', 'GET')).status, 200);
    assert.equal((await f.request('/review-todos', 'PUT', { tenantId: 'forged', revision: 2 })).status, 200);
    const response = await f.request('/review-todos/dispatch', 'POST', { week: '2026-10-26', revision: '2' });
    assert.equal(response.status, 200); assert.equal((await response.json()).targetGoalId, 'next-goal');
    assert.deepEqual(f.calls[0], ['get', 'a', '2026-10-26']);
    assert.deepEqual(f.calls[1], ['save', 'a', { tenantId: 'forged', revision: 2 }, 'user']);
    assert.deepEqual(f.calls[2], ['dispatch', 'a', 'user', '2026-10-26', 2]);
    assert.deepEqual(f.calls[3]!.slice(0, 3), ['allocate', 'a', 'user']);
    f.fail('revision_conflict'); assert.equal((await f.request('/review-todos', 'GET')).status, 503);
    assert.equal((await f.request('/review-todos', 'PUT')).status, 409);
  } finally { await f.close(); }
});
