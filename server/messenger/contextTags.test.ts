import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyContextTags, vetoRevokedContextTags } from './contextTags.js';
test('标签证据只接受客户原文，排除销售陈述、伪造证据、重复和未知标签', async () => {
 const turns = [{ id: 'b', actor: 'buyer', body: 'We buy wholesale. No samples needed.' }, { id: 's', actor: 'seller', body: 'You are the owner and need OEM.' }];
 const items = await classifyContextTags(turns, async () => JSON.stringify({ items: [
 { tag: '批发采购', messageId: 'b', excerpt: 'We buy wholesale.' },
 { tag: '批发采购', messageId: 'b', excerpt: 'We buy wholesale.' },
 { tag: '采购决策人', messageId: 's', excerpt: 'You are the owner' },
 { tag: '定制需求', messageId: 'b', excerpt: 'need OEM' },
 { tag: '高价值用户', messageId: 'b', excerpt: 'We buy wholesale.' },
 ] }));
 assert.deepEqual(items, [{ tag: '批发采购', messageId: 'b', excerpt: 'We buy wholesale.' }]);
});
test('无可核验输出时不产生标签，模型失败不能当成空分析覆盖旧标签', async () => {
 await assert.rejects(classifyContextTags([], async () => 'not json'));
 await assert.rejects(classifyContextTags([], async () => '{"error":"failed"}'));
 assert.deepEqual(await classifyContextTags([], async () => '{"items":[]}'), []);
});

test('后续明确否定会否决模型引用的旧证据，销售否定不会替客户撤销标签', async () => {
 const original = { id: 'old', actor: 'buyer', body: 'I am the purchasing decision maker. We need OEM and samples.' };
 const model = async () => JSON.stringify({ items: [
  { tag: '采购决策人', messageId: 'old', excerpt: 'I am the purchasing decision maker.' },
  { tag: '定制需求', messageId: 'old', excerpt: 'We need OEM and samples.' },
  { tag: '索取样品', messageId: 'old', excerpt: 'We need OEM and samples.' },
 ] });
 const correction = { id: 'new', actor: 'buyer', body: 'I cannot approve purchases. No customization or OEM, and no samples.' };
 assert.deepEqual(await classifyContextTags([original, correction], model), []);
 assert.equal((await classifyContextTags([original, { ...correction, actor: 'seller' }], model)).length, 3);
 const renewed = { id: 'renewed', actor: 'buyer', body: original.body };
 const renewedModel = async () => JSON.stringify({ items: [{ tag: '定制需求', messageId: 'renewed', excerpt: 'We need OEM and samples.' }] });
 assert.equal((await classifyContextTags([original, correction, renewed], renewedModel)).length, 1);
});

test('delivery deadline veto removes historical buyer evidence while preserving later renewed evidence', async () => {
 const original = { id: 'deadline-old', actor: 'buyer', body: 'The deadline is within 30 days.' };
 const correction = { id: 'deadline-new', actor: 'buyer', body: 'There is no delivery deadline anymore.' };
 const model = async () => JSON.stringify({ items: [{ tag: '明确交期', messageId: original.id, excerpt: original.body }] });
 assert.deepEqual(await classifyContextTags([original, correction], model), []);
 assert.equal((await classifyContextTags([original, { ...correction, actor: 'seller' }], model)).length, 1);
 const renewed = { ...original, id: 'deadline-renewed' };
 const renewedModel = async () => JSON.stringify({ items: [{ tag: '明确交期', messageId: renewed.id, excerpt: renewed.body }] });
 assert.equal((await classifyContextTags([original, correction, renewed], renewedModel)).length, 1);
});

test('wholesale model label requires explicit buyer resale purpose, never quantity alone', async () => {
 const classify = (excerpt: string) => async () => JSON.stringify({ items: [{ tag: '批发采购', messageId: 'buyer', excerpt }] });
 for (const body of ['I need 2000 customized products', 'We need 5000 pcs.', '需要2000件产品。']) {
  assert.deepEqual(await classifyContextTags([{ id: 'buyer', actor: 'buyer', body }], classify(body)), []);
 }
 for (const body of ['We buy wholesale.', 'I need these products for resale.', 'We are a distributor.', '我们做批发，计划转售。', '用于我们的门店销售。']) {
  assert.equal((await classifyContextTags([{ id: 'buyer', actor: 'buyer', body }], classify(body))).length, 1);
 }
 const body = 'We are a distributor. I need 2000 customized products';
 assert.deepEqual(await classifyContextTags([{ id: 'buyer', actor: 'buyer', body }], classify('I need 2000 customized products')), [], 'accepted evidence itself must establish purpose');
 assert.deepEqual(await classifyContextTags([{ id: 'buyer', actor: 'buyer', body: '2000 pcs' }, { id: 'seller', actor: 'seller', body: 'We buy wholesale.' }], classify('2000 pcs')), [], 'seller cannot supply missing business purpose');
});

assert.deepEqual(vetoRevokedContextTags([{ tag: '批发采购', messageId: 'existing', excerpt: 'I need 2000 customized products' }], [{ id: 'existing', actor: 'buyer', body: 'I need 2000 customized products' }]), [], 'persisted invalid model wholesale evidence is vetoed without another model call');


test('channel test messages cannot become sample requests, including persisted model evidence', async () => {
  for (const body of ['普通客户测试 NR-20261009-01', 'This is a test message.', 'Please test the callback.']) {
    const turns = [{ id: 'buyer', actor: 'buyer', body }];
    const evidence = [{ tag: '索取样品', messageId: 'buyer', excerpt: body }];
    assert.deepEqual(await classifyContextTags(turns, async () => JSON.stringify({ items: evidence })), []);
    assert.deepEqual(vetoRevokedContextTags(evidence, turns), []);
  }
  for (const body of ['Please send samples.', '请提供样品。']) {
    const turns = [{ id: 'buyer', actor: 'buyer', body }];
    assert.equal((await classifyContextTags(turns, async () => JSON.stringify({ items: [{ tag: '索取样品', messageId: 'buyer', excerpt: body }] }))).length, 1);
  }
});
