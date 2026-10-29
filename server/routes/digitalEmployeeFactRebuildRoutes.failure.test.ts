import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDigitalEmployeeFactRebuildRoutes } from './digitalEmployeeFactRebuildRoutes.js';
import { weeklyGoalFactRebuildSourcePlanDigest } from '../digitalEmployees/goalFactRebuild.js';

test('fact-sync storage rejection before generation returns 503 and preserves the original plan', async t => {
  const app = express(), router = express.Router();
  let writes = 0;
  const plan = { id: 'plan', goal_id: 'goal', tenant_id: 'tenant', status: 'draft', plan: { knowledgeBinding: { factsVersion: 'facts' } } };
  app.use(express.json());
  app.use((_req, res, next) => { res.locals.tenantId = 'tenant'; res.locals.userId = 'owner'; next(); });
  const routes = createDigitalEmployeeFactRebuildRoutes({
    digitalEmployeesRouter: router,
    goalApprovalQueues: new Map(),
    tenantRecord: async () => ({ id: 'goal', tenant_id: 'tenant', version: 1, status: 'draft', metric: 'approved_content_packages' }),
    weeklyGoalFactRebuildTargetCommitted: async () => true,
    first: async (collection: string, _where: unknown, sort: string) => {
      if (collection === 'weekly_plans') return plan;
      assert.equal(collection, 'workflow_runs');
      assert.equal(sort, '-started_at');
      throw new Error('private storage failure');
    },
    recommendPackageWithTenantEvidence: async () => { writes++; throw Error('must not generate'); },
  } as any);
  routes.registerPostGoalsGoalIdRebuildFromLatestFacts();
  app.use(router);
  app.get('/health', (_req, res) => { res.json({ ok: true }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${base}/goals/goal/rebuild-from-latest-facts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: 'sync-original-0001', expectedGoalVersion: 1, sourcePlanId: 'plan', expectedFactsVersion: 'facts', expectedSourcePlanDigest: weeklyGoalFactRebuildSourcePlanDigest(plan as any) }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'goal_fact_rebuild_failed');
  assert.equal(writes, 0);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});
