import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSavedMetaMessage } from './metaMessageInput.js';
import { normalizeMetaMessageChoice, adMarketSummary } from '../../shared/metaMessageChoice.js';
import { validatePlatformAdTask } from './tasks.js';
const task = (choice?: any): any => ({ goal: '获取消息会话', configuration: { ...(choice ? { metaMessage: choice } : {}) } });
const assets = { kind: 'messages' as const, pageId: '1', forms: [], termsAccepted: null, pixels: [], whatsappPhoneNumber: '+8613800138000', instagram: { id: '7', username: 'factory' } };
test('saved WhatsApp/Instagram/Messenger choice resolves actual assets without caller supplied IDs', async () => {
  for (const [destination, recipientId] of [['WHATSAPP', '+8613800138000'], ['INSTAGRAM_DIRECT', '7'], ['MESSENGER', '1']]) {
    const calls: any[] = [];
    const value: any = await resolveSavedMetaMessage('tenant-a', task({ pageId: '1', destination, recipientId }), 'account-a', { videoId: '2', instagramActorId: 'forged' }, async (tenantId, connectionId, query) => { calls.push([tenantId, connectionId, query]); return assets; });
    assert.equal(value.messageDestination, destination); assert.equal(value.instagramActorId, '7'); assert.equal(value.instagramUsername, 'factory'); assert.equal(value.whatsappPhoneNumber, assets.whatsappPhoneNumber);
    assert.deepEqual(calls, [['tenant-a', 'account-a', { pageId: '1', kind: 'messages' }]]);
  }
});
test('unavailable recipient, caller channel override and permission errors never fall back or create', async () => {
  const value = task({ pageId: '1', destination: 'WHATSAPP', recipientId: '+8613800138000' });
  let reads = 0;
  await assert.rejects(resolveSavedMetaMessage('t', value, 'c', { messageDestination: 'MESSENGER' }, async () => { reads++; return assets; }), (e: any) => e.code === 'MESSAGE_DESTINATION_CHANGED');
  assert.equal(reads, 0);
  await assert.rejects(resolveSavedMetaMessage('t', value, 'c', {}, async () => ({ ...assets, whatsappPhoneNumber: '+8613900139000' })), (e: any) => e.code === 'MESSAGE_RECIPIENT_CHANGED');
  await assert.rejects(resolveSavedMetaMessage('t', value, 'c', {}, async () => ({ ...assets, whatsappPhoneNumber: '' })), (e: any) => e.code === 'MESSAGE_RECIPIENT_CHANGED');
  await assert.rejects(resolveSavedMetaMessage('t', value, 'c', {}, async () => { throw Error('permission denied'); }), /permission denied/);
  const legacy = { messageDestination: 'WHATSAPP' }; assert.equal(await resolveSavedMetaMessage('t', task(), 'c', legacy), legacy);
});
test('market summary derives from countries/languages, keeping legacy records and validating saved choices', () => {
  const input = { name: 'Message', video: 'Video', goal: '获取消息会话', market: 'incorrect duplicate input', budget: 100, channels: ['Facebook'], configuration: { countries: ['US', 'CA'], metaMessage: { pageId: '1', destination: 'MESSENGER', recipientId: '1' } } };
  const valid = validatePlatformAdTask(input); assert.equal(valid.market, adMarketSummary(['US', 'CA'])); assert.match(valid.market, /美国.*加拿大/);
  assert.deepEqual(valid.configuration.metaMessage, input.configuration.metaMessage);
  assert.equal(validatePlatformAdTask({ ...input, configuration: {} }).market, 'incorrect duplicate input');
  assert.throws(() => validatePlatformAdTask({ ...input, goal: '提升网站访问' }), /消息会话/);
  assert.throws(() => normalizeMetaMessageChoice({ pageId: '1', destination: 'WHATSAPP', recipientId: '' }), /接收账号/);
  assert.throws(() => normalizeMetaMessageChoice({ pageId: '1', destination: 'invented', recipientId: '1' }));
});
