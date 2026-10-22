import assert from 'node:assert/strict';
import test from 'node:test';
import { configSnapshotForPlan, goalInput, publicAgentStatuses, publicConfig, publicConfigurationMetadata, publicEventPayload, publicGoal, publicOverviewPlan } from './overviewProjection.js';
import type { GoalRecord, PlanRecord, TaskRecord } from '../routes/digitalEmployeeRecords.js';

const goal: GoalRecord = {
  id: 'goal-1', tenant_id: 'tenant-1', owner_id: 'owner-1', title: 'Increase leads', objective: 'Qualify customers',
  business_line: 'legacy-line', content_platforms: JSON.stringify(['facebook', 'youtube']),
  metric: 'qualified_leads', baseline: 1, target: 10, unit: 'leads', starts_at: '2026-10-19', ends_at: '2026-10-25',
  scope: JSON.stringify({ description: 'North America', videoPlans: [{ id: 'video-1' }] }), constraints: JSON.stringify(['No auto-send']),
  status: 'active', version: 2, created_at: '2026-10-18T00:00:00Z', updated_at: '2026-10-20T00:00:00Z',
};

test('overview goal projection keeps legacy line safe and strips persistence metadata from domain input', () => {
  const publicRecord = publicGoal(goal);
  assert.equal(publicRecord.businessLine, 'full_funnel');
  assert.deepEqual(publicRecord.contentPlatforms, ['facebook', 'youtube']);
  assert.equal(publicRecord.scope, 'North America');
  assert.deepEqual(publicRecord.videoPlans, [{ id: 'video-1' }]);
  assert.deepEqual(publicRecord.constraints, ['No auto-send']);
  assert.equal(publicRecord.version, 2);
  const input = goalInput(goal);
  assert.equal(input.scope, 'North America');
  assert.equal('id' in input, false);
  assert.equal('status' in input, false);
  assert.equal('version' in input, false);
});

test('overview configuration metadata exposes only resolved public policy fields', () => {
  assert.equal(publicConfig(null), null);
  assert.equal(publicConfigurationMetadata(null), null);
  const config = publicConfig({ id: 'config-1', tenant_id: 'tenant-1', status: 'active', config: '{}' });
  assert.ok(config);
  const resolved = { config, configVersion: 3, policyVersion: 'policy-3', knowledgeBinding: { factsVersion: 'facts-3' }, runtimePolicy: { mode: 'guarded' }, privateCredential: 'secret' };
  const metadata = publicConfigurationMetadata(resolved as unknown as Parameters<typeof publicConfigurationMetadata>[0]);
  assert.deepEqual(metadata, {
    configVersion: 3, policyVersion: 'policy-3', knowledgeBinding: { factsVersion: 'facts-3' }, runtimePolicy: { mode: 'guarded' },
  });
  assert.equal(JSON.stringify(metadata).includes('secret'), false);
});

test('fixed four-agent read model shows waiting-human work and completed roles', () => {
  const tasks = [
    { agent_role: 'business', status: 'waiting_human', title: 'Confirm account' },
    { agent_role: 'director', status: 'succeeded', title: 'Review video' },
  ] as Array<TaskRecord & { agent_role: 'business' | 'director' }>;
  const agents = publicAgentStatuses(tasks);
  assert.deepEqual(agents.map(agent => agent.role), ['business', 'director', 'content', 'customer']);
  assert.equal(agents[0]?.status, 'waiting_human');
  assert.equal(agents[0]?.currentTask, 'Confirm account');
  assert.equal(agents[1]?.status, 'completed');
  assert.equal(agents[1]?.completed, 1);
  assert.equal(agents[2]?.status, 'idle');
});

test('event payload recursively removes private reasoning while preserving public evidence', () => {
  const payload = { summary: 'ready', thoughts: 'private', nested: [{ reasoning: 'private', result: 'visible', chainOfThought: 'private' }], AI_REaSonIng: 'private' };
  assert.deepEqual(publicEventPayload(payload), { summary: 'ready', nested: [{ result: 'visible' }] });
  assert.deepEqual(payload.nested[0]?.result, 'visible', 'projection must not mutate the source event');
});

test('overview plan normalizes legacy task roles and fixed team without altering persisted body', () => {
  const body = {
    tasks: [{ key: 'viral_analysis', agentRole: 'industry', title: 'Analyze' }],
    configSnapshot: { team: ['industry'], note: 'frozen' },
  };
  const plan = { id: 'plan-1', tenant_id: 'tenant-1', goal_id: goal.id, status: 'draft', plan: body, created_at: '2026-10-20T00:00:00Z' } satisfies PlanRecord;
  assert.equal(publicOverviewPlan({ plan: null, body, goal, resolvedConfiguration: null }), null);
  const projected = publicOverviewPlan({ plan, body, goal, resolvedConfiguration: null });
  assert.equal(projected?.id, 'plan-1');
  assert.equal(projected?.tasks[0]?.agentRole, 'director');
  assert.deepEqual(projected?.configSnapshot, { team: ['business', 'director', 'content', 'customer'], note: 'frozen' });
  assert.equal(projected?.businessPackage, undefined);
  assert.deepEqual(body.configSnapshot.team, ['industry']);
  const fallback = publicConfig({ id: 'config-1', tenant_id: 'tenant-1', status: 'active', config: '{}' });
  assert.ok(fallback);
  assert.equal(configSnapshotForPlan(null, fallback), fallback);
});
