import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temp = await mkdtemp(path.join(os.tmpdir(), 'ad-handoff-'));
process.env.LOCAL_STORE_DIR = temp;
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.NODE_ENV = 'test';
try {
  const { store } = await import('../storage/index.js');
  const { handoffGoalToAds, goalAdHandoffs } = await import('./handoff.js');
  const goal = await store.create('weekly_goals', { tenant_id: 'tenant-a', title: '新品曝光', objective: '扩大新品曝光', status: 'active', metric: '观看', target: 1000, unit: '次', constraints: ['仅美国'] });
  assert.ok(goal);
  const input = { requestId: 'handoff-request-001', evidence: '新品内容互动提升，选择进行付费验证', video: '新品视频', goal: '提升有效视频观看', market: 'US', budget: 100, channels: ['Facebook'] };
  await assert.rejects(handoffGoalToAds('tenant-b', 'user', goal.id, input), /未找到经营目标/);
  await assert.rejects(handoffGoalToAds('tenant-a', 'user', goal.id, { ...input, budget: 0 }), /预算/);
  const result = await handoffGoalToAds('tenant-a', 'user', goal.id, input);
  const again = await handoffGoalToAds('tenant-a', 'user', goal.id, input);
  assert.equal(result.adTaskId, again.adTaskId, 'retries must reuse the draft');
  assert.equal(result.task.managementMode, 'manual', 'business goals do not grant authority to spend');
  assert.equal(result.task.sourceContext?.goalId, goal.id);
  assert.match(result.expectedOutcome, /非投放预测/);
  assert.equal((await goalAdHandoffs('tenant-a', goal.id)).length, 1);
  const cny = await handoffGoalToAds('tenant-a', 'user', goal.id, { ...input, requestId: 'handoff-request-cny', currency: 'CNY' });
  assert.equal(cny.task.currency, 'CNY', 'business handoff preserves the budget currency');
  await assert.rejects(goalAdHandoffs('tenant-b', goal.id), /未找到经营目标/);
  console.log('ad handoff tenant, replay and provenance tests passed');
} finally { await rm(temp, { recursive: true, force: true }); }
