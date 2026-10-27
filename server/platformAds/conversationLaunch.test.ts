import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueConversationPlan, conversationLaunchReaders } from './conversationLaunch.js';
const input = { expectedVersion: 3, creativeId: 'creative', pageId: '123', launchMode: 'create_paused', expiresAt: '2030-01-01T00:00:00Z', lead: { messageDestination: '', whatsappPhoneNumber: '', instagramActorId: '', instagramUsername: '', leadFormId: '', pixelId: '' } };
function fixture() {
  const calls: Array<{ kind: string; value: any }> = [];
  const task = { id: 'plan', version: 3, status: 'draft', managementMode: 'manual', budget: 100, channels: ['Facebook'], goal: '提升有效视频观看', configuration: { accountConnectionId: 'account', countries: ['US'], adMessage: 'View the product', dailyBudget: 5, materialSource: { sha256: 'sha', sourceTaskId: 'source', artifactId: 'artifact' } } };
  const creative = { id: 'creative', taskId: 'plan', taskVersion: 3, status: 'ready', connectionId: 'account', sha256: 'sha', sourceTaskId: 'source', artifactId: 'artifact' };
  const read = { lock: async (_tenant: string, _id: string, fn: () => Promise<unknown>) => fn(),
    task: async () => task, creative: async () => creative, preview: async () => ({ videoId: '456', thumbnailUrl: 'https://example.com/cover.jpg' }),
    release: () => {}, management: async (_tenant: string, _user: string, _id: string, value: unknown) => { calls.push({ kind: 'grant', value }); task.version = 4; task.managementMode = 'managed'; return { ...task }; },
    launch: async (_tenant: string, _id: string, value: unknown) => { calls.push({ kind: 'queue', value }); return { id: 'launch', status: 'PENDING' }; },
  } as unknown as typeof conversationLaunchReaders;
  return { task, creative, calls, read };
}
test('conversation confirmation uses the existing limited grant and pending launch queue', async () => {
  const f = fixture(); const result = await enqueueConversationPlan('tenant', 'user', 'plan', input, f.read);
  assert.equal(result.launch.status, 'PENDING'); assert.deepEqual(f.calls.map(c => c.kind), ['grant', 'queue']);
  assert.deepEqual(f.calls[0].value.authorization.allowedActions, ['create']);
  assert.equal(f.calls[0].value.authorization.maxAdjustmentPercent, 0);
  assert.equal(f.calls[1].value.expectedVersion, 4); assert.equal(f.calls[1].value.meta.videoId, '456');
  assert.equal(f.calls[1].value.launchMode, 'create_paused');
  await assert.rejects(enqueueConversationPlan('tenant', 'user', 'plan', input, f.read), /已变化/);
  assert.equal(f.calls.length, 2, 'replaying confirmation must not grant or queue twice');
});
test('activation is only authorized when the final confirmed mode explicitly includes it', async () => {
  const f = fixture(); await enqueueConversationPlan('tenant', 'user', 'plan', { ...input, launchMode: 'create_and_activate' }, f.read);
  assert.deepEqual(f.calls[0].value.authorization.allowedActions, ['create', 'activate']);
});
test('stale plans, foreign creative bindings, release restrictions and invalid budgets cannot grant or queue', async () => {
  for (const scenario of ['version', 'creative', 'release', 'budget']) {
    const f = fixture();
    if (scenario === 'version') f.task.version = 4;
    if (scenario === 'creative') f.creative.taskId = 'other-tenant-plan';
    if (scenario === 'release') f.read.release = () => { throw Error('Execution disabled'); };
    if (scenario === 'budget') f.task.configuration.dailyBudget = 101;
    await assert.rejects(enqueueConversationPlan('tenant', 'user', 'plan', input, f.read));
    assert.equal(f.calls.length, 0, scenario);
  }
});
test('queue failure propagates and never claims successful submission or retries', async () => {
  const f = fixture(); let calls = 0; f.read.launch = async () => { calls++; throw Error('storage unavailable'); };
  await assert.rejects(enqueueConversationPlan('tenant', 'user', 'plan', input, f.read), /storage unavailable/);
  assert.equal(calls, 1);
});
