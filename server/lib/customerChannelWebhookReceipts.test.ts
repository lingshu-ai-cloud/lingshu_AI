import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { extractSignedCustomerChannelReceipts } from './customerChannelWebhookReceipts.js';
const base = { tenantId: 'tenant', channel: 'messenger' as const, rawBody: Buffer.from('actual signed source bytes'), verifiedSignature: true as const };
test('signed exact MID echo and delivery preserve source account, recipient and raw-body hash', () => {
  const result = extractSignedCustomerChannelReceipts({ ...base, entries: [{ id: 'page', messaging: [
    { timestamp: 1791266400000, sender: { id: 'page' }, recipient: { id: 'buyer' }, message: { is_echo: true, mid: 'mid-1', text: 'actual body' } },
    { timestamp: 1791266400100, sender: { id: 'buyer' }, recipient: { id: 'page' }, delivery: { mids: ['mid-1', 'mid-1'] } },
  ] }] });
  assert.equal(result.length, 2); assert.deepEqual(result.map(r => r.status), ['sent', 'delivered']);
  assert.ok(result.every(r => r.nativeAccountId === 'page' && r.recipientId === 'buyer' && r.providerMessageId === 'mid-1'));
  assert.equal(result[0]!.signedBodyHash, createHash('sha256').update(base.rawBody).digest('hex'));
});
test('watermark-only, missing time, inbound text and wrong account direction cannot manufacture send proof', () => {
  assert.deepEqual(extractSignedCustomerChannelReceipts({ ...base, entries: [{ id: 'page', messaging: [
    { sender: { id: 'buyer' }, recipient: { id: 'page' }, read: { watermark: 1791266400000 } },
    { sender: { id: 'page' }, recipient: { id: 'buyer' }, message: { is_echo: true, mid: 'no-time' } },
    { timestamp: 1791266400000, sender: { id: 'foreign' }, recipient: { id: 'buyer' }, message: { is_echo: true, mid: 'foreign' } },
    { timestamp: 1791266400000, sender: { id: 'buyer' }, recipient: { id: 'page' }, message: { mid: 'inbound', text: 'hello' } },
  ] }] }), []);
});
test('Instagram messaging alias remains bound to its canonical native account and actual MID', () => {
  const result = extractSignedCustomerChannelReceipts({ ...base, channel: 'instagram', entries: [{ id: 'ig-account', messagingAccountId: 'ig-alias', messaging: [
    { timestamp: 1791266400000, sender: { id: 'buyer' }, recipient: { id: 'ig-alias' }, read: { mids: ['ig-mid'] } },
  ] }] });
  assert.equal(result[0]!.nativeAccountId, 'ig-account'); assert.equal(result[0]!.status, 'read');
});
