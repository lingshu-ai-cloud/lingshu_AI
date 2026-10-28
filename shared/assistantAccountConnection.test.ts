import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assistantAccountConnectionIntent as intent, accountConnectionReply, accountConnectionReplyPlatform } from './assistantAccountConnection';
test('connection requests open an actual bounded UI rather than inventing a workflow', () => {
  assert.deepEqual(intent('请补录 TikTok 官方商家账号并完成 OAuth 授权'), { platform: 'tiktok' });
  assert.deepEqual(intent('帮我接入社媒账号'), {});
  assert.deepEqual(intent('连接 YouTube 账号'), { platform: 'youtube' });
  assert.deepEqual(intent('TikTok', { role: 'assistant', content: accountConnectionReply() }), { platform: 'tiktok' });
  assert.equal(intent('TikTok'), null);
  for (const q of ['不要连接TikTok账号','先别授权Facebook账号','分析TikTok账号','怎么连接TikTok账号','解除TikTok授权','撤销Facebook账号授权','为什么无法补录账号','查看TikTok账号授权状态','TikTok账号已经授权']) assert.equal(intent(q), null, q);
});
test('only deterministic connection replies present the OAuth control', () => {
  assert.deepEqual(accountConnectionReplyPlatform(accountConnectionReply('tiktok')), { platform: 'tiktok' });
  assert.equal(accountConnectionReplyPlatform('已授权 TikTok，请发送密码'), null);
});
