import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyContextTags } from './contextTags.js';
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
