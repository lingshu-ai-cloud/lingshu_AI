import assert from 'node:assert/strict';
import test from 'node:test';
import { findOperatingGoalConflict } from './operatingGoalConflicts.js';

const current = { id: 'current', status: 'draft', starts_at: '2026-09-27', ends_at: '2026-10-03', metric: 'approved_content_packages', scope: {} };
const operating = { ...current, id: 'operating', status: 'active' };
const bridge = { ...operating, id: 'bridge', metric: 'approved_social_content_artifacts', scope: { socialTaskId: 'social-task' } };
const run = (goal_id: string, status = 'waiting_external', id = `run-${goal_id}`) => ({ id, goal_id, status });
const find = (goals: typeof current[], runs: ReturnType<typeof run>[], allowDisjoint = false, loadGoal = async (_id: string): Promise<typeof current | null> => null) =>
  findOperatingGoalConflict({ goal: current, goals: [current, ...goals], runs, allowDisjoint, loadGoal });

test('independent video bridges do not block operating goals or mutate their records', async () => {
  const goals = [bridge, { ...bridge, id: 'finished-bridge', scope: JSON.stringify(bridge.scope) }];
  const runs = [run(bridge.id), run('finished-bridge', 'completed')];
  const before = structuredClone({ goals, runs });
  assert.equal(await findOperatingGoalConflict({ goal: current, goals, runs, allowDisjoint: false, loadGoal: async () => null }), null);
  assert.deepEqual({ goals, runs }, before);
});

test('missing run goals are resolved under both overlap policies before classifying bridges', async () => {
  for (const allowDisjoint of [false, true]) {
    const loaded: string[] = [];
    assert.equal(await find([], [run(bridge.id), run(bridge.id, 'running', 'second')], allowDisjoint, async id => { loaded.push(id); return bridge; }), null);
    assert.deepEqual(loaded, [bridge.id]);
  }
});

test('real operating runs conflict and return their own matching goal', async () => {
  const unrelatedActiveGoal = { ...operating, id: 'no-run' };
  const activeRun = run(operating.id);
  const conflict = await find([unrelatedActiveGoal, operating, bridge], [run(bridge.id), activeRun]);
  assert.equal(conflict?.goal?.id, operating.id);
  assert.equal(conflict?.run?.id, activeRun.id);
  assert.equal(conflict?.goal?.id, conflict?.run?.goal_id);
});

test('paused operating goals remain conflicts with or without a run', async () => {
  const paused = { ...operating, status: 'paused' };
  assert.equal((await find([paused], []))?.goal?.id, paused.id);
  assert.equal((await find([paused], [run(paused.id, 'paused')]))?.run?.status, 'paused');
});

test('unknown or incompletely identified goals remain conservative conflicts', async () => {
  const unknownRun = run('missing');
  for (const allowDisjoint of [false, true]) {
    assert.deepEqual(await find([], [unknownRun], allowDisjoint), { goal: null, run: unknownRun });
    for (const incomplete of [{ ...bridge, scope: {} }, { ...bridge, metric: 'approved_content_packages' }]) {
      assert.equal((await find([incomplete], [run(incomplete.id)], allowDisjoint))?.goal?.id, incomplete.id);
    }
  }
});

test('disjoint operating cycles are allowed only by their configured policy', async () => {
  const earlier = { ...operating, starts_at: '2026-09-01', ends_at: '2026-09-07' };
  assert.equal(await find([earlier], [run(earlier.id)], true), null);
  assert.equal(await find([], [run(earlier.id)], true, async () => earlier), null);
  assert.equal((await find([earlier], [run(earlier.id)], false))?.goal?.id, earlier.id);
  assert.equal((await find([operating], [run(operating.id)], true))?.goal?.id, operating.id);
  assert.ok(await find([{ ...earlier, starts_at: '' }], [run(earlier.id)], true), 'unknown dates cannot prove a disjoint cycle');
});

test('terminal attempts never conceal another active attempt for the same goal', async () => {
  for (const terminal of ['succeeded', 'failed', 'cancelled']) {
    const oldRun = run(operating.id, terminal, 'old-attempt');
    assert.equal(await find([operating], [oldRun]), null);
    const activeRun = run(operating.id, 'running', 'active-attempt');
    assert.equal((await find([operating], [oldRun, activeRun]))?.run?.id, activeRun.id);
  }
  assert.equal(await find([], [run(current.id, 'running')]), null, 'idempotent activation of the same goal is not a conflict');
});
