import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectStoryboardExistingOperation } from './storyboardExistingOperation.js';
import type { StoryboardAigcSpendEntry } from './storyboardAigcProjectBudget.js';

const entry: StoryboardAigcSpendEntry = {
  operationId: 'storyboard-video:original', shotId: 'slot-1', stage: 'video',
  amountMicros: 3_600_000, originalAmountMicros: 3_600_000,
  status: 'reserved', at: '2026-10-11T00:00:00.000Z',
  output: { providerTaskId: 'supplier-original', providerModel: 'original-model' },
};
const expected = { operationId: entry.operationId, shotId: entry.shotId,
  stage: entry.stage, estimatedCostCny: 3.6 };

test('original paid operations remain queryable when the remaining new-call budget is zero', () => {
  const frozenLedger = Object.freeze({ usedCny: 12.5, limitCny: 12.5,
    entries: Object.freeze([Object.freeze({ ...entry, output: Object.freeze({ ...entry.output }) })]) });
  assert.equal(frozenLedger.limitCny - frozenLedger.usedCny, 0);
  const result = inspectStoryboardExistingOperation({ ...expected, entry: frozenLedger.entries[0] });
  assert.equal(result.kind, 'existing');
  if (result.kind === 'existing') assert.equal(result.entry.output?.providerTaskId, 'supplier-original');
  assert.equal(frozenLedger.usedCny, 12.5, 'receipt lookup does not release or re-reserve spend');
});

test('completed, pending and uncertain receipts are distinguished by their retained entry, not resubmitted', () => {
  for (const status of ['reserved', 'uncertain', 'completed'] as const) {
    const original = { ...entry, status, output: { ...entry.output, materialId: 'candidate-needs-validation' } };
    const result = inspectStoryboardExistingOperation({ ...expected, entry: original });
    assert.equal(result.kind, 'existing');
    if (result.kind === 'existing') assert.equal(result.entry, original);
  }
  assert.deepEqual(inspectStoryboardExistingOperation({ ...expected, entry: undefined }), { kind: 'none' });
});

test('partial multi-segment occupancy replays against the original reservation without refunding it', () => {
  const partial = { ...entry, status: 'completed' as const, amountMicros: 900_000 };
  assert.equal(inspectStoryboardExistingOperation({ ...expected, entry: partial }).kind, 'existing');
  assert.equal(inspectStoryboardExistingOperation({ ...expected, estimatedCostCny: 0.9, entry: partial }).kind, 'conflict');
  assert.equal(partial.amountMicros, 900_000);
  assert.equal(inspectStoryboardExistingOperation({ ...expected, entry: { ...entry, originalAmountMicros: undefined } }).kind, 'existing');
});

test('different operation, slot, stage, amount or input revision cannot recover another request', () => {
  for (const changed of [{ operationId: 'other' }, { shotId: 'slot-2' },
    { stage: 'first_frame' as const }, { estimatedCostCny: 3.7 }, { inputFingerprint: 'new-reference' }]) {
    const result = inspectStoryboardExistingOperation({ ...expected, ...changed, entry });
    assert.equal(result.kind, 'conflict');
    if (result.kind === 'conflict') assert.equal(result.code, 'STORYBOARD_OPERATION_INPUT_CONFLICT');
  }
  const fingerprinted = { ...entry, inputFingerprint: 'confirmed-input' };
  assert.equal(inspectStoryboardExistingOperation({ ...expected, entry: fingerprinted }).kind, 'conflict');
  assert.equal(inspectStoryboardExistingOperation({ ...expected, entry: fingerprinted, inputFingerprint: 'confirmed-input' }).kind, 'existing');
});

test('invalid cost and corrupt ledger evidence fail closed, while micro-CNY rounding is stable', () => {
  for (const estimatedCostCny of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.equal(inspectStoryboardExistingOperation({ ...expected, estimatedCostCny, entry }).kind, 'conflict');
  }
  for (const changed of [{ amountMicros: 0 }, { amountMicros: 3_600_001 },
    { originalAmountMicros: 0 }, { originalAmountMicros: NaN }, { status: 'released' as any }]) {
    assert.equal(inspectStoryboardExistingOperation({ ...expected, entry: { ...entry, ...changed } }).kind, 'conflict');
  }
  assert.equal(inspectStoryboardExistingOperation({ ...expected, estimatedCostCny: 0.1 + 0.2,
    entry: { ...entry, amountMicros: 300_000, originalAmountMicros: 300_000 } }).kind, 'existing');
});
