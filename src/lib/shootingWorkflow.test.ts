import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileShootingSlots, shootingRefillTarget, type ScriptGapTask } from './shootingWorkflow.js';

let counter = 0;
const newId = () => `shot-${++counter}`;
const input = [{ id: 'slot-1', detail: '画面：设备进料', start: 0, end: 3 }, { id: 'slot-2', detail: '画面：成品特写', start: 3, end: 6 }];
const slots = reconcileShootingSlots([], input, 'product-A/zh/9:16', newId);
const task: ScriptGapTask = { id: 'task', origin: 'script_gap', title: '补拍', productLabel: 'A', themeTitle: '演示', shotBrief: '进料', suggestedDurationSec: 3,
  sourceProjectId: 'draft', sourceAssemblyId: 'video-1', sourceShotId: slots[0].id, requirements: slots[0].requirements, createdAt: '2026-09-12', uploadedMaterialIds: ['video'], soundMode: 'voiceover' };
const context = { projectId: 'draft', assemblyId: 'video-1', slots, assignments: {}, confirmed: {} };

test('empty matching shot can refill', () => assert.equal(shootingRefillTarget(task, context).slot?.id, slots[0].id));
test('unique shot keeps identity across reordering and resolves new display slot', () => {
  const reordered = reconcileShootingSlots(slots, [{ ...input[1], id: 'slot-1' }, { ...input[0], id: 'slot-2' }], 'product-A/zh/9:16', newId);
  assert.equal(reordered[1].id, slots[0].id);
  assert.equal(shootingRefillTarget(task, { ...context, slots: reordered }).slot?.slotId, 'slot-2');
});
test('deleting or rewriting the target cannot silently refill another shot', () => {
  const changed = reconcileShootingSlots(slots, [{ ...input[0], detail: '换台词和画面' }, input[1]], 'product-A/zh/9:16', newId);
  assert.equal(shootingRefillTarget(task, { ...context, slots: changed }).slot, undefined);
  assert.equal(shootingRefillTarget(task, { ...context, slots: slots.slice(1) }).slot, undefined);
});
test('product, language, ratio or duration change invalidates old requirements', () => {
  for (const next of ['product-B/zh/9:16', 'product-A/en/9:16', 'product-A/zh/16:9']) {
    assert.equal(shootingRefillTarget(task, { ...context, slots: reconcileShootingSlots(slots, input, next, newId) }).slot, undefined);
  }
  assert.equal(shootingRefillTarget(task, { ...context, slots: reconcileShootingSlots(slots, [{ ...input[0], end: 4 }, input[1]], 'product-A/zh/9:16', newId) }).slot, undefined);
});
test('existing or confirmed shots are never replaced, including repeat events', () => {
  assert.equal(shootingRefillTarget(task, { ...context, assignments: { 'slot-1': 'chosen' } }).slot, undefined);
  assert.equal(shootingRefillTarget(task, { ...context, confirmed: { 'slot-1': true } }).slot, undefined);
});
test('another project/assembly, unbound legacy tasks and empty uploads cannot refill', () => {
  assert.equal(shootingRefillTarget(task, { ...context, projectId: 'another' }).slot, undefined);
  assert.equal(shootingRefillTarget(task, { ...context, assemblyId: 'video-2' }).slot, undefined);
  assert.equal(shootingRefillTarget({ ...task, sourceShotId: undefined }, context).slot, undefined);
  assert.equal(shootingRefillTarget({ ...task, uploadedMaterialIds: [] }, context).slot, undefined);
});
test('ambiguous repeated shots fail closed when the script structure changes', () => {
  const repeated = reconcileShootingSlots([], [input[0], { ...input[0], id: 'slot-2' }], 'same', newId);
  const unchanged = reconcileShootingSlots(repeated, [input[0], { ...input[0], id: 'slot-2' }], 'same', newId);
  assert.equal(unchanged[0].id, repeated[0].id);
  const changed = reconcileShootingSlots(repeated, [input[1], input[0], { ...input[0], id: 'slot-3' }], 'same', newId);
  assert.ok(changed.every(item => !repeated.some(old => old.id === item.id)));
});
