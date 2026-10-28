import test from 'node:test';
import assert from 'node:assert/strict';
import type {SocialAssetSupplyPlan} from '../../shared/contracts/socialContentReplication.js';
import {blockOnMissingBenchmarkLabels} from './socialContentMissingLabelBlock.js';
import {runWithContentExecutionContext} from '../contentExecution/context.js';
import type {DataStore} from '../storage/datastore.js';

const plan = (shots: unknown[], version = 'type-aware.v3') =>
  ({materialRoutingPolicyVersion: version, shots} as unknown as SocialAssetSupplyPlan);
const unknown = (shotId: string) => ({shotId, materialRouting: {materialType: 'unknown', pendingReason: 'material_label_unresolved'}});
const identity = {tenantId: 'tenant', taskId: 'task', runId: 'run', taskVersion: 'v1'};

test('unresolved labels block with original task, run, plan and slot evidence', async () => {
  const writes: any[] = [];
  await assert.rejects(blockOnMissingBenchmarkLabels({...identity, plan: plan([unknown('s1'), unknown('s2')]),
    record: async entry => {writes.push(entry);}}), /benchmark_label_unresolved:s1,s2/);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].stage, 'social.benchmark_label_block');
  assert.deepEqual(writes[0].payload.pending, [{shotId: 's1', reason: 'material_label_unresolved'},
    {shotId: 's2', reason: 'material_label_unresolved'}]);
  assert.equal(writes[0].payload.analysisStatus, 'unavailable');
  assert.deepEqual([writes[0].payload.tenantId, writes[0].payload.taskId, writes[0].payload.runId,
    writes[0].payload.taskVersion], ['tenant', 'task', 'run', 'v1']);
  assert.match(writes[0].payload.planHash, /^[a-f0-9]{64}$/);
});

test('legacy and resolved routes pass; malformed and duplicate evidence fails closed', async () => {
  let calls = 0; const record = async () => { calls += 1; };
  await blockOnMissingBenchmarkLabels({...identity, plan: plan([unknown('s1')], 'type-aware.v2'), record});
  await blockOnMissingBenchmarkLabels({...identity, plan: plan([{shotId:'s1', materialRouting: {materialType:'factory'}}]), record});
  await assert.rejects(blockOnMissingBenchmarkLabels({...identity, plan: plan([unknown('bad/id')]), record}), /benchmark_label_pending_invalid/);
  await assert.rejects(blockOnMissingBenchmarkLabels({...identity, plan: plan([unknown('s1'), unknown('s1')]), record}), /benchmark_label_pending_identity_invalid/);
  assert.equal(calls, 0);
});

test('checkpoint preserves existing original job checkpoints', async () => {
  const previous = {version:'1', inputHash:'hash', payload:{retained:true}, updatedAt:'2026-01-01T00:00:00.000Z'};
  let saved: Record<string, unknown> | undefined;
  const store = {update: async (_collection: string, _id: string, patch: Record<string, unknown>) => {saved = patch; return {id:'job'};}} as unknown as DataStore;
  await assert.rejects(runWithContentExecutionContext({dataStore:store, jobId:'job', checkpoints:{'social.existing':previous},
    action: () => blockOnMissingBenchmarkLabels({...identity, plan:plan([unknown('s1')])})}), /benchmark_label_unresolved/);
  const checkpoints = saved?.checkpoints as Record<string, {payload: any}>;
  assert.deepEqual(checkpoints['social.existing'], previous);
  assert.equal(checkpoints['social.benchmark_label_block']!.payload.runId, 'run');
});

// A stale or incomplete projection may lose the display reason. The actual
// unresolved label still governs admission; absence of prose cannot authorize
// fabrication of a production route.
test('unknown type blocks even when a stale projection omitted its pending reason', async () => {
  const writes: any[] = [];
  await assert.rejects(blockOnMissingBenchmarkLabels({...identity,
    plan: plan([{shotId:'s1',materialRouting:{materialType:'unknown'}}]),
    record: async entry => {writes.push(entry);}}), /benchmark_label_unresolved:s1/);
  assert.deepEqual(writes[0].payload.pending,[{shotId:'s1',reason:'material_label_unresolved'}]);
  assert.equal(writes[0].payload.analysisStatus,'unavailable');
});
