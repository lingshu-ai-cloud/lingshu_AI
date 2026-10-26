import test from 'node:test';
import assert from 'node:assert/strict';
import { planExternalQuestion } from '../externalQuestion.js';
import { assistantHomePromptById } from '../../../src/lib/assistantHomeQuickPrompts.js';
import { sceneSelectionSchema } from '../../../shared/contracts/assistantBusinessScene.js';
import { assertSceneRole } from './service.js';
test('all audited internal prompts stay internal; explicit external research remains mixed', () => {
  for (const id of ['OP-04', 'OP-06', 'PU-04', 'AD-01', 'CS-01', 'AD-03', 'AD-04', 'OP-08']) {
    assert.equal(planExternalQuestion(assistantHomePromptById(id)!.prompt).kind, 'internal', id);
  }
  assert.equal(planExternalQuestion('查询最新美元兑人民币汇率').kind, 'exchange');
  assert.equal(planExternalQuestion('查看当前经营数据，并检索行业资讯').mixed, true);
  assert.equal(planExternalQuestion('查看当前经营数据，并检索行业资讯').kind, 'web');
  assert.equal(planExternalQuestion('行业资讯：查询家具行业最近30天的资讯').kind, 'web');
});
test('selection and role boundary require real scoped objects and do not grant operator access', () => {
  const period = { from: '2026-10-01', to: '2026-10-26' };
  assert.equal(sceneSelectionSchema.safeParse({ ...period, sceneId: 'CS-02' }).success, false);
  assert.equal(sceneSelectionSchema.safeParse({ ...period, sceneId: 'AD-01' }).success, false);
  assert.equal(sceneSelectionSchema.safeParse({ ...period, sceneId: 'AD-02' }).success, true);
  assert.equal(sceneSelectionSchema.safeParse({ ...period, sceneId: 'OP-04', tenantId: 'forged' }).success, false);
  assert.equal(sceneSelectionSchema.safeParse({ ...period, sceneId: 'OP-04', to: '2026-02-30' }).success, false);
  assert.throws(() => assertSceneRole({ tenantId: 't', userId: 'u', role: 'customer_service' }, 'AD-01'));
  assert.doesNotThrow(() => assertSceneRole({ tenantId: 't', userId: 'u', role: 'customer_service' }, 'CS-02'));
});

test('same-scene followups retain the typed object while external/new topics drop it; business week uses Shanghai dates', async () => {
  const { businessSceneFollowup, defaultBusinessPeriod } = await import('../../../shared/contracts/assistantBusinessScene.js');
  const scene = { sceneId: 'CS-02' as const, from: '2026-10-01', to: '2026-10-26', customerId: 'a' };
  assert.deepEqual(businessSceneFollowup('继续分析这个客户', { role: 'assistant', businessScene: scene }), scene);
  assert.equal(businessSceneFollowup('继续查最新行业资讯', { role: 'assistant', businessScene: scene }), undefined);
  assert.equal(businessSceneFollowup('切换计划', { role: 'assistant', businessScene: scene }), undefined);
  const monday = new Date('2026-10-25T17:00:00Z');
  assert.deepEqual(defaultBusinessPeriod('OP-07', monday), { from: '2026-10-26', to: '2026-10-26' });
  assert.deepEqual(defaultBusinessPeriod('OP-05', monday), { from: '2026-10-26', to: '2026-10-26' });
});
