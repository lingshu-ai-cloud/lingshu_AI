import assert from 'node:assert/strict';
import { deliverAutoReply } from './autoReplyDelivery.js';
const input = { tenantId: 'isolated', to: 'fixture-recipient', body: 'First.\n\nSecond.' };
const first = { message: 'First.', receipt: { messageId: 'fixture-1', recipientId: input.to, raw: { messages: [{ id: 'fixture-1' }] } }, index: 0, total: 2 };
const second = { message: 'Second.', receipt: { messageId: 'fixture-2', recipientId: input.to, raw: { messages: [{ id: 'fixture-2' }] } }, index: 1, total: 2 };
const saved: string[] = [];
let calls = 0;
const partial = await deliverAutoReply({ ...input, recordAccepted: p => { saved.push(p.receipt.messageId); } }, async (_t,_n,_b,record) => {
  calls++; await record!(first); assert.deepEqual(saved, ['fixture-1']); throw Error('second bubble timeout');
});
assert.equal(calls, 1); assert.equal(partial.complete, false);
assert.equal(partial.accepted[0].receipt.messageId, 'fixture-1');
assert.equal(partial.pendingDraft, undefined, 'partial send must not offer full-body resend');
assert.equal(partial.reason, 'auto_reply_partial_or_writeback_failed');
const unknown = await deliverAutoReply({ ...input, recordAccepted: () => {} }, async () => { throw Error('timeout before receipt'); });
assert.equal(unknown.pendingDraft, undefined); assert.equal(unknown.reason, 'auto_reply_send_outcome_unconfirmed');
let progressed = false;
const writeFailure = await deliverAutoReply({ ...input, recordAccepted: () => { throw Error('disk full'); } }, async (_t,_n,_b,record) => {
  await record!(first); progressed = true; await record!(second); return { messages: ['First.','Second.'], receipts: [first.receipt,second.receipt] };
});
assert.equal(progressed,false,'failed persistence stops before second provider bubble');
assert.equal(writeFailure.accepted.length,1); assert.equal(writeFailure.pendingDraft,undefined);
const complete = await deliverAutoReply({ ...input, recordAccepted: () => {} }, async (_t,_n,_b,record) => {
  await record!(first); await record!(second); return { messages: ['First.','Second.'], receipts: [first.receipt,second.receipt] };
});
assert.equal(complete.complete,true); assert.equal(complete.accepted.length,2);
console.log('Auto reply delivery: accepted-bubble persistence, partial send, unknown outcome, disk failure and completion passed; no real sender used');
