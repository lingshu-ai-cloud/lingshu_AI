import test from 'node:test';
import assert from 'node:assert/strict';
import type {SocialAssetSupplyPlan} from '../../shared/contracts/socialContentReplication.js';
import {blockOnInitialMaterialSupply} from './socialContentInitialMaterialBlock.js';
import {runWithContentExecutionContext} from '../contentExecution/context.js';
import type {DataStore} from '../storage/datastore.js';

const shot = (shotId: string, materialType: string, pendingReason?: string) => ({
  shotId, materialRouting: {materialType, pendingReason},
});
const plan = (shots: unknown[], version = 'type-aware.v3') =>
  ({materialRoutingPolicyVersion: version, shots} as unknown as SocialAssetSupplyPlan);
const identity = {tenantId: 'tenant', taskId: 'task', runId: 'run', taskVersion: 'version-1'};

test('records all initial missing slots with original identity and clearly estimated timing', async () => {
  const writes: Array<Record<string, unknown>> = [];
  const input = {...identity, referenceScenes: ['s1', 's2'].map(sceneId => ({sceneId, duration: {startSeconds: 0, endSeconds: 2}})), plan: plan([shot('s1', 'talking_head', 'awaiting_shoot'),
    shot('s2', 'factory', 'awaiting_theme_material'), shot('s3', 'product')]),shootingTaskIds:{s1:'shoot-1'},
    record: async (entry: unknown) => { writes.push(entry as Record<string, unknown>); }};
  await assert.rejects(blockOnInitialMaterialSupply(input), /initial_material_supply:s1,s2/);
  assert.equal(writes.length, 1);
  assert.equal(writes[0]!.stage, 'social.initial_material_block');
  const payload = writes[0]!.payload as Record<string, unknown>;
  assert.deepEqual([payload.tenantId, payload.taskId, payload.runId, payload.taskVersion], ['tenant', 'task', 'run', 'version-1']);
  assert.match(String(payload.planHash), /^[a-f0-9]{64}$/);
  assert.deepEqual(payload.pending, [
    {shotId: 's1', materialType: 'talking_head', reason: 'awaiting_shoot', shootingTaskId:'shoot-1',referenceDurationSeconds: 2},
    {shotId: 's2', materialType: 'factory', reason: 'awaiting_theme_material', referenceDurationSeconds: 2},
  ]);
  assert.equal('timeline' in payload, false);
});

test('does not block legacy, complete, or unresolved-label plans; rejects invalid pending records', async () => {
  const writes: unknown[] = [];
  const record = async (entry: unknown) => { writes.push(entry); };
  await blockOnInitialMaterialSupply({...identity, plan: plan([shot('s1', 'talking_head', 'awaiting_shoot')], 'type-aware.v2'), record});
  await blockOnInitialMaterialSupply({...identity, plan: plan([shot('s1', 'product'), shot('s2', 'unknown', 'material_label_unresolved')]), record});
  assert.equal(writes.length, 0);
  await assert.rejects(blockOnInitialMaterialSupply({...identity, plan: plan([shot('s1', 'product', 'awaiting_shoot')]), record}), /initial_material_pending_invalid/);
  await assert.rejects(blockOnInitialMaterialSupply({...identity, plan: plan([shot('s1', 'factory', 'awaiting_theme_material'), shot('s1', 'product')]), record}), /initial_material_pending_identity_invalid/);
  assert.equal(writes.length, 0);
});

test('writes through the existing durable job context without replacing prior checkpoints', async () => {
  const previous = {version: '1', inputHash: 'old-hash', payload: {retained: true}, updatedAt: '2026-01-01T00:00:00.000Z'};
  let persisted: Record<string, unknown> | undefined;
  const store = {update: async (collection: string, id: string, patch: Record<string, unknown>) => {
    assert.equal(collection, 'content_execution_jobs'); assert.equal(id, 'job'); persisted = patch; return {id};
  }} as unknown as DataStore;
  await assert.rejects(runWithContentExecutionContext({dataStore: store, jobId: 'job',
    checkpoints: {'social.existing': previous}, action: () => blockOnInitialMaterialSupply({...identity,
      plan: plan([shot('s1', 'factory', 'awaiting_theme_material')])})}), /initial_material_supply:s1/);
  const checkpoints = persisted?.checkpoints as Record<string, {payload: unknown}>;
  assert.deepEqual(checkpoints['social.existing'], previous);
  assert.equal((checkpoints['social.initial_material_block']!.payload as {runId: string}).runId, 'run');
});
