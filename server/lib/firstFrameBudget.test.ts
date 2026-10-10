import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FirstFrameBudget } from './firstFrameBudget.js';

test('first-frame budget is idempotent and rejects a fourth composition before supplier work', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'first-frame-budget-'));
  try {
    const budget = new FirstFrameBudget(root, () => 2, () => 3);
    for (let index = 1; index <= 3; index += 1) await budget.reserve({ tenantId: 't', videoId: 'v', operationId: `op-${index}`, compositionId: `c-${index}`, estimatedCostCny: 0.22 });
    const replay = await budget.reserve({ tenantId: 't', videoId: 'v', operationId: 'op-1', compositionId: 'c-1', estimatedCostCny: 0.22 });
    assert.equal(replay.existing, true);
    await assert.rejects(() => budget.reserve({ tenantId: 't', videoId: 'v', operationId: 'op-4', compositionId: 'c-4', estimatedCostCny: 0.22 }), /最多生成 3 张/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('first-frame budget rejects cost above the per-video limit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'first-frame-budget-'));
  try {
    const budget = new FirstFrameBudget(root, () => 0.5, () => 3);
    await budget.reserve({ tenantId: 't', videoId: 'v', operationId: 'op-1', compositionId: 'c-1', estimatedCostCny: 0.3 });
    await assert.rejects(() => budget.reserve({ tenantId: 't', videoId: 'v', operationId: 'op-2', compositionId: 'c-2', estimatedCostCny: 0.3 }), /预算上限/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
