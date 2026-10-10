import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StoryboardAigcProjectBudget } from './storyboardAigcProjectBudget.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-aigc-budget-'));
try {
  const budget = new StoryboardAigcProjectBudget(root, () => 10, () => 1);
  const base = { tenantId: 'tenant', projectId: 'project', shotId: 'shot', stage: 'first_frame' as const, estimatedCostCny: 2 };
  const first = await budget.reserve({ ...base, operationId: 'frame-a' });
  assert.equal(first.existing, false);
  assert.equal((await budget.reserve({ ...base, operationId: 'frame-a' })).existing, true);
  await assert.rejects(budget.reserve({ ...base, operationId: 'frame-a', estimatedCostCny: 3 }), /不同输入/);
  await budget.mark('tenant', 'project', 'frame-a', 'completed', { materialId: 'm1' });
  await budget.releaseRejected('tenant', 'project', 'frame-a');
  assert.equal((await budget.status('tenant', 'project')).usedCny, 2);
  const second = await budget.reserve({ ...base, operationId: 'frame-b' });
  assert.equal(second.existing, false);
  await assert.rejects(budget.reserve({ ...base, operationId: 'frame-c' }), /生成上限/);
  await budget.releaseRejected('tenant', 'project', 'frame-b');
  assert.equal((await budget.status('tenant', 'project')).usedCny, 2);
  await budget.reserve({ ...base, operationId: 'frame-c' });
  await budget.mark('tenant', 'project', 'frame-c', 'uncertain');
  assert.equal((await budget.status('tenant', 'project')).usedCny, 4);
  await assert.rejects(budget.reserve({ ...base, operationId: 'frame-d' }), /生成上限/);
  const video = { ...base, stage: 'video' as const, estimatedCostCny: 6 };
  await budget.reserve({ ...video, operationId: 'video-a' });
  await assert.rejects(budget.reserve({ ...video, operationId: 'video-b' }), /预算剩余/);
  assert.equal((await budget.status('tenant', 'project')).usedCny, 10);
  await budget.reserve({ ...base, tenantId: 'frozen-cap', operationId: 'frame-a', limitCny: 3 });
  await assert.rejects(budget.reserve({ ...base, tenantId: 'frozen-cap', shotId: 'shot-b', operationId: 'frame-b', limitCny: 3 }), /预算剩余/,
    'an order-local frozen ceiling must be stricter than the installation default');
  await assert.rejects(budget.reserve({ ...base, tenantId: 'missing-cap', operationId: 'frame-a', limitCny: 0 }), /冻结制作额度无效/);
  const otherTenant = await budget.reserve({ ...base, tenantId: 'other', operationId: 'frame-a' });
  assert.equal(otherTenant.existing, false);
  await budget.reserve({ ...video, tenantId: 'accepted', operationId: 'video-accepted' });
  await budget.recordProviderAcceptance('accepted', 'project', 'video-accepted', 'supplier-task-1', 'model-1');
  await budget.releaseRejected('accepted', 'project', 'video-accepted');
  const accepted = (await budget.status('accepted', 'project')).entries[0]!;
  assert.equal(accepted.status, 'reserved', 'provider acceptance is not video completion');
  assert.equal(accepted.output?.providerTaskId, 'supplier-task-1');
  assert.equal((await budget.status('accepted', 'project')).usedCny, 6, 'accepted spend cannot be released as a rejection');
  await assert.rejects(budget.recordProviderAcceptance('accepted', 'project', 'video-accepted', 'different-task', 'model-1'), /不同供应商任务/);
  await budget.mark('accepted', 'project', 'video-accepted', 'uncertain', { error: 'poll_timeout' });
  assert.equal((await budget.status('accepted', 'project')).entries[0]?.output?.providerTaskId, 'supplier-task-1', 'poll failure preserves the original supplier receipt');
  await budget.mark('accepted', 'project', 'video-accepted', 'completed', { materialId: 'generated-video' });
  assert.equal((await budget.status('accepted', 'project')).entries[0]?.output?.providerTaskId, 'supplier-task-1', 'material completion preserves acceptance identity');
  await budget.reserve({ ...base, tenantId: 'fingerprint', operationId: 'frame-input', inputFingerprint: 'version-1' });
  await assert.rejects(budget.reserve({ ...base, tenantId: 'fingerprint', operationId: 'frame-input', inputFingerprint: 'version-2' }), /参考资产或镜头输入已变化/);
  const revised = await budget.reserve({ ...base, tenantId: 'fingerprint', operationId: 'frame-revised', inputFingerprint: 'version-2' });
  assert.equal(revised.existing, false, 'a materially revised product/reference input gets its own retry bucket');
  const concurrent = await Promise.allSettled([
    budget.reserve({ tenantId: 'concurrent', projectId: 'one', shotId: 'a', stage: 'video', operationId: 'op-a', estimatedCostCny: 7 }),
    budget.reserve({ tenantId: 'concurrent', projectId: 'one', shotId: 'b', stage: 'video', operationId: 'op-b', estimatedCostCny: 7 }),
  ]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1, 'cross-process lock and budget permit one of two racing calls');
  assert.equal((await budget.status('concurrent', 'one')).usedCny, 7);
  const partial = await budget.reserve({ tenantId: 'partial', projectId: 'one', shotId: 'a', stage: 'video', operationId: 'segments', estimatedCostCny: 8 });
  assert.equal(partial.existing, false);
  await budget.settlePartial('partial', 'one', 'segments', 3, { acceptedSegments: 1 });
  assert.equal((await budget.status('partial', 'one')).usedCny, 3);
  assert.equal((await budget.reserve({ tenantId: 'partial', projectId: 'one', shotId: 'a', stage: 'video',
    operationId: 'segments', estimatedCostCny: 8 })).existing, true);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('storyboardAigcProjectBudget tests passed');
