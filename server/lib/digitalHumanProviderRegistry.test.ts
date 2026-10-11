import assert from 'node:assert/strict';
import test from 'node:test';
import { digitalHumanToolCapabilities, requiredReferencePreservation, selectReferenceAdapter, verifiedSupplierCost } from './digitalHumanProviderRegistry.js';

test('generic Seedance availability is not misreported as reference-person execution', () => {
  const capabilities = digitalHumanToolCapabilities({ talkingEnabled: false });
  assert.equal(capabilities.find(item => item.id === 'runway_seedance')?.execution, false);
  assert.match(capabilities.find(item => item.id === 'runway_seedance')?.reason || '', /通用 Seedance/);
  assert.equal(capabilities.find(item => item.id === 'heygen')?.execution, false);
  assert.equal(capabilities.find(item => item.id === 'heygen')?.qualityInspection, false);
  assert.equal(capabilities.find(item => item.id === 'local_head_pipeline')?.qualityInspection, false);
  assert.deepEqual(capabilities.find(item => item.id === 'runway_act_two')?.methods, ['reenact']);
  const diagnosed = digitalHumanToolCapabilities({ talkingEnabled: false, unavailableReasons: { runway_act_two: '缺少对象存储与预算配置' } });
  assert.equal(diagnosed.find(item => item.id === 'runway_act_two')?.reason, '缺少对象存储与预算配置');
});

test('only explicitly registered adapters become executable', () => {
  const capabilities = digitalHumanToolCapabilities({ talkingEnabled: true, talkingCostReconciliation: true, adapters: [{ id: 'runway_act_two', methods: ['reenact'],
    async submit() { return { externalTaskId: 'task-1' }; }, async status() { return { state: 'pending' }; }, async cost() { return { actualCostCny: 1, costSourceRef: 'usage-1' }; } }] });
  assert.equal(capabilities.find(item => item.id === 'heygen')?.execution, true);
  assert.equal(capabilities.find(item => item.id === 'heygen')?.qualityInspection, true);
  assert.equal(capabilities.find(item => item.id === 'runway_act_two')?.execution, true);
  assert.equal(capabilities.find(item => item.id === 'runway_act_two')?.qualityInspection, false);
  assert.deepEqual(capabilities.find(item => item.id === 'runway_act_two')?.methods, ['reenact']);
  assert.equal(capabilities.find(item => item.id === 'runway_kling_motion')?.execution, false);
  assert.equal(capabilities.find(item => item.id === 'heygen')?.costReconciliation, true);
  assert.equal(capabilities.find(item => item.id === 'runway_act_two')?.costReconciliation, true);
  assert.equal(capabilities.find(item => item.id === 'runway_kling_motion')?.costReconciliation, false);
  const inspected = digitalHumanToolCapabilities({ talkingEnabled: false, adapters: [{ id: 'runway_act_two', methods: ['reenact'],
    executionProfile: { preserves: ['identity'], qualityInspection: true }, async submit() { return { externalTaskId: 'task-2' }; }, async status() { return { state: 'pending' }; } }] });
  assert.equal(inspected.find(item => item.id === 'runway_act_two')?.qualityInspection, true);
  assert.equal(inspected.find(item => item.id === 'runway_act_two')?.executionProfile?.qualityInspection, true);
});

test('supplier cost is reconciled only with a valid amount and evidence reference', () => {
  assert.equal(verifiedSupplierCost({}), null);
  assert.deepEqual(verifiedSupplierCost({ actualCostCny: 1.23456, costSourceRef: ' invoice-1 ' }), { actualCostCny: 1.2346, costSourceRef: 'invoice-1' });
  assert.throws(() => verifiedSupplierCost({ actualCostCny: 1.2 }), /实际费用依据/);
  assert.throws(() => verifiedSupplierCost({ costSourceRef: 'invoice-1' }), /实际费用依据/);
  assert.throws(() => verifiedSupplierCost({ actualCostCny: -1, costSourceRef: 'invoice-1' }), /实际费用依据/);
});

test('reference routing rejects registered tools that cannot honor duration or preservation constraints', () => {
  const adapter = (id: 'runway_kling_motion' | 'local_head_pipeline', profile: NonNullable<Parameters<typeof selectReferenceAdapter>[0]['adapters'][number]['executionProfile']>) => ({
    id, methods: ['replace' as const], executionProfile: profile,
    async submit() { return { externalTaskId: id }; }, async status() { return { state: 'pending' as const }; },
  });
  const adapters = [
    adapter('runway_kling_motion', { maxDurationSeconds: 5, preserves: ['identity', 'motion'], qualityInspection: false, estimatedCostCnyPerSecond: 1 }),
    adapter('local_head_pipeline', { maxDurationSeconds: 15, preserves: ['identity', 'motion', 'product', 'background', 'composition'], qualityInspection: true, estimatedCostCnyPerSecond: 2 }),
  ];
  assert.deepEqual(requiredReferencePreservation({ preserve: '保持动作、产品、背景和构图' }), ['identity', 'motion', 'product', 'background', 'composition']);
  const selected = selectReferenceAdapter({ adapters, candidates: ['runway_kling_motion', 'local_head_pipeline'], method: 'replace', targetDurationSeconds: 8,
    requiredPreservation: ['identity', 'motion', 'product', 'background', 'composition'] });
  assert.equal(selected.adapter?.id, 'local_head_pipeline'); assert.equal(selected.estimatedCostCny, 16);
  const blocked = selectReferenceAdapter({ adapters: [adapters[0]], candidates: ['runway_kling_motion'], method: 'replace', targetDurationSeconds: 8,
    requiredPreservation: ['identity', 'product'] });
  assert.equal(blocked.adapter, undefined); assert.match(blocked.reason, /最长支持 5 秒/);
  const unprofiled = { id: 'local_head_pipeline' as const, methods: ['replace' as const], async submit() { return { externalTaskId: 'x' }; }, async status() { return { state: 'pending' as const }; } };
  assert.equal(selectReferenceAdapter({ adapters: [unprofiled], candidates: ['local_head_pipeline'], method: 'replace', requiredPreservation: ['identity', 'background'] }).adapter, undefined);
  const overBudget = selectReferenceAdapter({ adapters: [adapters[1]], candidates: ['local_head_pipeline'], method: 'replace', targetDurationSeconds: 8, maxEstimatedCostCny: 10, requiredPreservation: ['identity'] });
  assert.equal(overBudget.adapter, undefined); assert.match(overBudget.reason, /超出预算上限 ¥10\.00/);
  const unknownPrice = selectReferenceAdapter({ adapters: [unprofiled], candidates: ['local_head_pipeline'], method: 'replace', maxEstimatedCostCny: 10, requiredPreservation: ['identity'] });
  assert.equal(unknownPrice.adapter, undefined); assert.match(unknownPrice.reason, /无法验证预算/);
});


test('malformed production duration, budget or supplier price cannot admit a paid reference adapter', () => {
  let submissions = 0;
  const adapter = { id: 'runway_act_two' as const, methods: ['reenact' as const],
    executionProfile: { maxDurationSeconds: 30, preserves: ['identity' as const], qualityInspection: true, estimatedCostCnyPerSecond: 2 },
    async submit() { submissions++; return { externalTaskId: 'must-not-submit' }; }, async status() { return { state: 'pending' as const }; } };
  const valid = { adapters: [adapter], candidates: ['runway_act_two'], method: 'reenact' as const, targetDurationSeconds: 6, maxEstimatedCostCny: 20, requiredPreservation: ['identity' as const] };
  for (const targetDurationSeconds of [0, -1, NaN, Infinity]) assert.equal(selectReferenceAdapter({ ...valid, targetDurationSeconds }).adapter, undefined);
  for (const maxEstimatedCostCny of [-1, NaN, Infinity]) assert.equal(selectReferenceAdapter({ ...valid, maxEstimatedCostCny }).adapter, undefined);
  for (const estimatedCostCnyPerSecond of [-1, NaN, Infinity, Number.MAX_VALUE]) assert.equal(selectReferenceAdapter({ ...valid, adapters: [{ ...adapter, executionProfile: { ...adapter.executionProfile, estimatedCostCnyPerSecond } }] }).adapter, undefined);
  for (const maxDurationSeconds of [0, -1, NaN, Infinity]) assert.equal(selectReferenceAdapter({ ...valid, adapters: [{ ...adapter, executionProfile: { ...adapter.executionProfile, maxDurationSeconds } }] }).adapter, undefined);
  const free = selectReferenceAdapter({ ...valid, maxEstimatedCostCny: 0, adapters: [{ ...adapter, executionProfile: { ...adapter.executionProfile, estimatedCostCnyPerSecond: 0 } }] });
  assert.equal(free.adapter?.id, adapter.id); assert.equal(free.estimatedCostCny, 0);
  assert.equal(selectReferenceAdapter(valid).estimatedCostCny, 12); assert.equal(submissions, 0);
});
