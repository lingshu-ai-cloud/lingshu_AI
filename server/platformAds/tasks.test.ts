import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingshu-platform-ads-'));
process.env.LOCAL_STORE_DIR = tempDir;
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.NODE_ENV = 'test';
// Isolated test JSON records and mocked provider calls only.
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
process.env.TEST_ONLY_EXTERNAL_EFFECT_LEASE_FALLBACK = 'true';

try {
  const { createPlatformAdTask, getPlatformAdTask, listPlatformAdTasks, updatePlatformAdTask, validatePlatformAdTask, changePlatformAdManagement, withPlatformAdTaskLock } = await import('./tasks.js');
  const { store } = await import('../storage/index.js');
  const input = { name: '美国新品视频放量', video: '秋季新品 15 秒版', goal: '提升有效视频观看', market: '美国，英语', budget: 500, channels: ['Facebook', 'TikTok'] };
  const created = await createPlatformAdTask('tenant-a', 'user-a', input);
  assert.ok(created.id);
  assert.equal(created.status, 'draft');
  assert.equal(created.creationSource, 'manual');
  assert.equal(created.managementMode, 'manual');
  assert.throws(() => validatePlatformAdTask({ ...input, managementMode: 'managed' }), /授权/);
  assert.throws(() => validatePlatformAdTask({ ...input, creationSource: 'platform_import' }), /来源/);
  assert.throws(() => validatePlatformAdTask({ ...input, configuration: { dailyBudget: 501 } }), /日预算/);
  assert.throws(() => validatePlatformAdTask({ ...input, configuration: { startsAt: '2026-10-02T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' } }), /结束时间/);
  const configured = await updatePlatformAdTask('tenant-a', created.id, { ...input, configuration: { dailyBudget: 100, audience: '经销商', startsAt: '2026-10-01T00:00:00Z' } });
  assert.equal(configured?.configuration.audience, '经销商');
  const preserved = await updatePlatformAdTask('tenant-a', created.id, input);
  assert.equal(preserved?.configuration.dailyBudget, 100, 'older clients must preserve saved configuration');
  await assert.rejects(updatePlatformAdTask('tenant-a', created.id, { ...input, budget: 50 }), /日预算/);
  assert.equal((await listPlatformAdTasks('tenant-a')).length, 1);
  assert.equal((await listPlatformAdTasks('tenant-b')).length, 0, 'tasks must be tenant isolated');
  assert.equal(await getPlatformAdTask('tenant-b', created.id), null, 'cross-tenant task reads must fail');
  assert.equal((await getPlatformAdTask('tenant-a', created.id))?.name, input.name);
  const updated = await updatePlatformAdTask('tenant-a', created.id, { ...input, budget: 725 });
  assert.equal(updated?.budget, 725);
  assert.equal(await updatePlatformAdTask('tenant-b', created.id, input), null, 'cross-tenant task updates must fail');
  assert.throws(() => validatePlatformAdTask({ ...input, budget: 0 }), /预算/);
  assert.throws(() => validatePlatformAdTask({ ...input, channels: ['Unknown'] }), /渠道/);
  const authorization = { accountIds: ['account-a'], allowedActions: ['pause', 'adjust_budget'], maxDailyBudget: 100, maxTotalBudget: 500, maxAdjustmentPercent: 20, expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
  await store.create('platform_ad_connections', { id: 'account-a', tenant_id: 'tenant-a', currency: 'USD', provider: 'meta', status: 'connected' });
  const managed = await changePlatformAdManagement('tenant-a', 'user-a', created.id, { expectedVersion: updated!.version, managementMode: 'managed', authorization });
  assert.equal(managed?.creationSource, 'manual', 'creation provenance survives management changes');
  assert.equal(managed?.managementMode, 'managed');
  await assert.rejects(updatePlatformAdTask('tenant-a', created.id, input), /接管/);
  await assert.rejects(changePlatformAdManagement('tenant-a', 'user-a', created.id, { expectedVersion: updated!.version, managementMode: 'manual' }), /刷新/);
  const takeover = await changePlatformAdManagement('tenant-a', 'user-a', created.id, { expectedVersion: managed!.version, managementMode: 'manual' });
  assert.equal(takeover?.authorization, null);
  assert.equal(takeover?.managementHistory.length, 2);
  await assert.rejects(changePlatformAdManagement('tenant-a', 'user-a', created.id, { expectedVersion: takeover!.version, managementMode: 'managed', authorization: { ...authorization, maxTotalBudget: 1000 } }), /额度/);
  await withPlatformAdTaskLock('tenant-a', created.id, async () => {
    await assert.rejects(updatePlatformAdTask('tenant-a', created.id, input), /正在执行/);
  });
  const fromAi = await createPlatformAdTask('tenant-a', 'user-a', input, {
    creationSource: 'ai_assisted',
    proposal: {
      rationale: '已确认方案', audienceStrategy: '已确认人群', creativeStrategy: '已确认素材',
      risks: ['待核验'], assumptions: ['待核验'], expectedOutcome: '暂不可预测', generatedAt: new Date().toISOString(),
      enterpriseFactVersion: 'enterprise-facts-v1-test',
    },
  });
  const editedAi = await updatePlatformAdTask('tenant-a', fromAi.id, { ...input, expectedVersion: fromAi.version });
  assert.equal(editedAi?.creationSource, 'ai_assisted');
  assert.equal(editedAi?.managementMode, 'manual');
  assert.equal(editedAi?.proposal, null, 'editing an AI task must invalidate its fact-bound proposal');
  const { parseAdProposal } = await import('./planning.js');
  const proposal = parseAdProposal(JSON.stringify({ rationale: '市场匹配', audienceStrategy: '目标客户', creativeStrategy: '素材对照', risks: ['缺少样本'], assumptions: ['待验证'], expectedOutcome: '保证收益 100 倍' }));
  assert.match(proposal.expectedOutcome, /暂不可预测/);
  assert.throws(() => parseAdProposal('{}'), /缺少/);
  await store.create('platform_ad_executions', { tenant_id: 'tenant-a', taskId: fromAi.id, status: 'UNKNOWN' });
  await assert.rejects(updatePlatformAdTask('tenant-a', fromAi.id, input), /平台执行记录/);
  const cnyInput = { ...input, currency: 'CNY', channels: ['Facebook'], budget: 123.45 };
  const cny = await createPlatformAdTask('tenant-a', 'user-a', cnyInput);
  assert.equal(cny.currency, 'CNY');
  assert.equal(cny.budget, 123.45);
  const preservedCny = await updatePlatformAdTask('tenant-a', cny.id, { ...input, channels: ['Facebook'] });
  assert.equal(preservedCny?.currency, 'CNY', 'old-client updates must preserve CNY');
  await assert.rejects(updatePlatformAdTask('tenant-a', cny.id, { ...input, currency: 'USD', channels: ['Facebook'] }), /不能更换币种/);
  assert.throws(() => validatePlatformAdTask({ ...input, currency: 'EUR' }), /币种/);
  assert.throws(() => validatePlatformAdTask({ ...input, currency: 'CNY' }), /仅支持 Meta/);
  await assert.rejects(changePlatformAdManagement('tenant-a', 'user-a', cny.id, { expectedVersion: preservedCny!.version, managementMode: 'managed', authorization }), /币种/);
  await store.create('platform_ad_connections', { id: 'account-cny', tenant_id: 'tenant-a', currency: 'CNY', provider: 'meta', status: 'connected' });
  const cnyManaged = await changePlatformAdManagement('tenant-a', 'user-a', cny.id, { expectedVersion: preservedCny!.version, managementMode: 'managed', authorization: { ...authorization, accountIds: ['account-cny'] } });
  assert.equal(cnyManaged?.currency, 'CNY');
  const { metaCurrencyOffsets } = await import('../../src/lib/platformAdsDomain.js');
  assert.equal(Math.round(123.45 * metaCurrencyOffsets.CNY), 12345, 'Meta CNY is denominated in hundredths');
  console.log('platform ads task persistence tests passed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
