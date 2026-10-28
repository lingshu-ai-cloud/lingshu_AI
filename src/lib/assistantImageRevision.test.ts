import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from '../appSession';
import { assistantImageRevisionTarget } from './assistantImageRevision';

test('only an explicit edit following a bound image card targets its task', () => {
  const message = { role: 'assistant', content: '已生成', creationPortal: { imageReplication: { intake: { imageTaskId: 'img-1' } } } } as unknown as Message;
  assert.equal(assistantImageRevisionTarget([message], '把产品往左移一点'), 'img-1');
  assert.equal(assistantImageRevisionTarget([message], '调整一下背景'), 'img-1');
  assert.equal(assistantImageRevisionTarget([message, { role: 'user', content: '调亮' }, { role: 'assistant', content: '已收到修改意见。' }], '再往左移'), 'img-1');
  assert.equal(assistantImageRevisionTarget([message, { role: 'assistant', content: '其他话题' }], '修改图片'), null);
  assert.equal(assistantImageRevisionTarget([message], '这张图可以修改吗？'), null);
  assert.equal(assistantImageRevisionTarget([message], '帮我创建周计划'), null);
  assert.equal(assistantImageRevisionTarget([], '修改图片'), null);
});
