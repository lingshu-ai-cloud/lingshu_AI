import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataStore } from '../storage/datastore.js';
import { advanceManagedReplication, type ManagedReplicationPorts } from './replicationContentProduction.js';

function fixture() {
  let row: any = { id: 'p', tenant_id: 't', status: 'draft', spec: { automation: { route: 'clone', stage: 'blocked', blocker: 'needs_per_shot_replication_bridge', referenceAnalysisId: 'r' }, workflowRunId: 'run' } };
  const store: DataStore = { getById: async () => structuredClone(row), update: async (_c, _id, patch) => { row = { ...row, ...patch }; return true; },
    create: async () => null, delete: async () => false, list: async () => ({ items: [], page: 1, perPage: 1, totalItems: 0, totalPages: 0 }) };
  let calls = 0;
  const ports: ManagedReplicationPorts = { initialize: input => ({ ...input.spec, automatedReplicationPlan: { version: 1 } }),
    execute: async () => { calls++; return { state: calls === 1 ? 'pending' : 'ready', changed: true }; },
    materials: async () => [], finish: async () => ({ renderOutputPath: '/real/finished.mp4', automation: { quality: { passed: true } } }) };
  return { store, ports, row: () => row, calls: () => calls, input: { tenantId: 't', projectId: 'p', store, references: [{ id: 'r', tenantId: 't' }], ports } };
}
test('old blocked business clone progresses through actual executor then verified finalizer without generic edit fallback', async () => {
  const f = fixture();
  await advanceManagedReplication(f.input);
  assert.equal(f.row().spec.workflowRunId, 'run'); assert.equal(f.calls(), 0);
  await advanceManagedReplication(f.input);
  assert.equal(f.row().status, 'draft'); assert.equal(f.row().spec.automation.stage, 'material_match');
  await advanceManagedReplication(f.input);
  assert.equal(f.row().status, 'ready_for_approval'); assert.equal(f.row().spec.automation.stage, 'completed');
  assert.deepEqual(await advanceManagedReplication(f.input), { changed: false, blocker: '' }); assert.equal(f.calls(), 2);
});
test('partial native receipts survive an uncertain failure and failed finalization never completes', async () => {
  const f = fixture(); await advanceManagedReplication(f.input);
  f.ports.execute = async () => {
    await f.store.update('studio_projects', 'p', { spec: { ...f.row().spec, providerTasks: { cue: 'paid-original' } } });
    throw Error('供应商受理后状态未知，不能重复提交');
  };
  const failed = await advanceManagedReplication(f.input);
  assert.match(failed.blocker, /状态未知/); assert.equal(f.row().spec.providerTasks.cue, 'paid-original');
  assert.equal(f.row().spec.automation.stage, 'blocked'); assert.equal(f.row().status, 'draft');
  f.ports.execute = async () => ({ state: 'ready', changed: false });
  f.ports.finish = async () => ({ renderOutputPath: '/bad.mp4', automation: { quality: { passed: false } } });
  assert.match((await advanceManagedReplication(f.input)).blocker, /真实成片/);
  assert.notEqual(f.row().status, 'ready_for_approval');
});
test('tenant mismatch and missing exact reference stop before supplier work', async () => {
  const f = fixture();
  await assert.rejects(() => advanceManagedReplication({ ...f.input, tenantId: 'foreign' }), /不属于/);
  assert.match((await advanceManagedReplication({ ...f.input, references: [] })).blocker, /精确参考/);
  assert.equal(f.calls(), 0);
});
test('an edit during final assembly cannot be overwritten by an older successful render', async () => {
  const f = fixture(); await advanceManagedReplication(f.input);
  f.ports.execute = async () => ({ state: 'ready', changed: false });
  f.ports.finish = async () => {
    await f.store.update('studio_projects', 'p', { spec: { ...f.row().spec, script: 'newly edited narration' } });
    return { renderOutputPath: '/old.mp4', automation: { quality: { passed: true } } };
  };
  assert.match((await advanceManagedReplication(f.input)).blocker, /参数已变化/);
  assert.equal(f.row().spec.script, 'newly edited narration'); assert.equal(f.row().spec.renderOutputPath, undefined);
});
