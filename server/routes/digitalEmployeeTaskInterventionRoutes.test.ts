import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { registerTaskInterventionRoutes } from './digitalEmployeeTaskInterventionRoutes.js';
import { TaskControlError, type TaskInterventionApplication } from '../digitalEmployees/taskInterventionApplication.js';

async function fixture() {
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => { res.locals = { tenantId: 'authenticated-tenant', userId: 'authenticated-user' }; next(); });
  const calls: Array<{ operation: string; input: Record<string, unknown> }> = [];
  const queued: string[] = [];
  let failure: TaskControlError | undefined;
  const operation = (name: string) => async (input: Record<string, unknown>) => {
    calls.push({ operation: name, input });
    if (failure) throw failure;
    return { runId: 'run', goalId: 'goal' };
  };
  const application: TaskInterventionApplication = {
    applyTaskControl: operation('control'), decideDirectorDirection: operation('director'), attachTaskEvidence: operation('evidence'),
  };
  registerTaskInterventionRoutes(app, {
    application,
    queueDigitalEmployeeRunAdvance: (tenantId, runId) => { queued.push(`${tenantId}:${runId}`); },
    buildOverview: async (tenantId, goalId) => ({ tenantId, goalId }),
    registerProductionBudgetRoute() { app.post('/tasks/:taskId/production-budget-reforecast', (_req, res) => res.json({ registered: true })); },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { calls, queued, fail: (error: TaskControlError) => { failure = error; },
    post: (path: string, body: Record<string, unknown>) => fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

test('quick and detailed correction routes share one authority and use authenticated identity', async () => {
  const f = await fixture();
  try {
    for (const [suffix, action] of [['retry', 'retry'], ['skip', 'skip'], ['complete', 'manual_complete']]) {
      const response = await f.post(`/tasks/task/${suffix}`, { tenantId: 'forged', userId: 'forged', note: 'human note', action: 'replan' });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { tenantId: 'authenticated-tenant', goalId: 'goal' });
      assert.equal(f.calls.at(-1)!.input.action, action);
      assert.equal(f.calls.at(-1)!.input.scope, 'one_off');
      assert.equal(f.calls.at(-1)!.input.tenantId, 'authenticated-tenant');
      assert.equal(f.calls.at(-1)!.input.userId, 'authenticated-user');
    }
    assert.equal((await f.post('/tasks/task/corrections', { action: 'replan', scope: 'rule_candidate', instruction: 'Rebuild', rerunDownstream: false })).status, 200);
    assert.equal(f.calls.at(-1)!.input.scope, 'rule_candidate');
    assert.equal(f.calls.at(-1)!.input.rerunDownstream, false);
    assert.equal(f.queued.length, 4);
    assert.equal((await f.post('/tasks/task/production-budget-reforecast', {})).status, 200);
  } finally { await f.close(); }
});

test('invalid correction actions, notes, scopes and workflow lists never reach the application', async () => {
  const f = await fixture();
  try {
    for (const [path, body, code] of [
      ['/tasks/task/corrections', { action: 'unknown' }, 'invalid_correction_action'],
      ['/tasks/task/corrections', { scope: 'forever' }, 'invalid_correction_scope'],
      ['/tasks/task/complete', {}, 'task_control_note_required'],
      ['/tasks/task/corrections', { scope: 'one_off', instruction: 'x', enabledWorkflows: ['unknown'] }, 'invalid_enabled_workflows'],
    ] as const) {
      const response = await f.post(path, body);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, code);
    }
    assert.equal(f.calls.length, 0); assert.equal(f.queued.length, 0);
  } finally { await f.close(); }
});

test('typed service conflicts retain HTTP status/details and do not queue another run', async () => {
  const f = await fixture();
  try {
    f.fail(new TaskControlError(409, 'irreversible_external_effect', { effects: ['receipt'] }));
    const response = await f.post('/tasks/task/retry', {});
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'irreversible_external_effect', effects: ['receipt'] });
    assert.deepEqual(f.queued, []);
  } finally { await f.close(); }
});

test('director and evidence endpoints preserve canonical inputs and structured validation errors', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.post('/tasks/task/director-decision', { decision: 'adjust', reason: 'weak_product_fit', contentId: 'content', applyToSimilar: true })).status, 200);
    assert.equal(f.calls[0]!.operation, 'director');
    assert.equal(f.calls[0]!.input.applyToSimilar, true);
    assert.equal(f.calls[0]!.input.taskId, 'task');
    assert.equal((await f.post('/tasks/task/evidence', { businessRefs: [{ type: 'studio_project', id: 'project' }] })).status, 200);
    assert.equal(f.calls[1]!.operation, 'evidence');
    assert.deepEqual(f.calls[1]!.input.businessRefs, [{ type: 'studio_project', id: 'project' }]);
    f.fail(new TaskControlError(400, 'evidence_reference_invalid', { index: 0 }));
    const response = await f.post('/tasks/task/evidence', { businessRefs: [{ type: 'post', id: 'foreign' }] });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'evidence_reference_invalid', index: 0 });
    assert.deepEqual(f.queued, [], 'director and evidence continuation stays inside their application operations');
  } finally { await f.close(); }
});
