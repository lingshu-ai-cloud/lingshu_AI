import assert from 'node:assert/strict';
import { projectSalesConversationEvent } from './conversationProjector.js';
import { legacyStageFromSalesState, salesStateFromLegacyCustomer } from './legacyStateAdapter.js';

const DAY_MS = 86_400_000;
const now = Date.parse('2026-08-23T00:00:00.000Z');

const quoted = salesStateFromLegacyCustomer({
  stage: 'quoted',
  lastActiveAt: now - 61 * DAY_MS,
  handlingMode: 'ai_draft',
}, now);
assert.equal(quoted.lifecycle.stage, 'proposal_quote');
assert.equal(quoted.engagement.status, 'dormant_60d');
assert.equal(legacyStageFromSalesState(quoted), 'quoted', '报价里程碑优先于沉默兼容标签');

const reactivated = projectSalesConversationEvent(quoted, {
  id: 'msg-buyer-1',
  type: 'buyer_message_received',
  source: 'whatsapp',
  occurredAt: now,
});
assert.equal(reactivated.lifecycle.stage, 'proposal_quote');
assert.equal(reactivated.engagement.status, 'waiting_seller');
assert.equal(legacyStageFromSalesState(reactivated), 'quoted');

const staleSellerMessage = projectSalesConversationEvent(reactivated, {
  id: 'msg-seller-stale',
  type: 'seller_message_sent',
  source: 'migration',
  occurredAt: now - DAY_MS,
  actor: 'human',
});
assert.equal(staleSellerMessage.engagement.status, 'waiting_seller', '迟到的历史消息不得覆盖当前互动状态');

const duplicate = projectSalesConversationEvent(reactivated, {
  id: 'msg-buyer-1',
  type: 'buyer_message_received',
  source: 'whatsapp',
  occurredAt: now,
});
assert.strictEqual(duplicate, reactivated, '同一事件必须幂等');

const negotiation = projectSalesConversationEvent(reactivated, {
  id: 'stage-negotiation',
  type: 'lifecycle_transitioned',
  source: 'crm',
  occurredAt: now + 1,
  stage: 'negotiation_approval',
});
const noRegression = projectSalesConversationEvent(negotiation, {
  id: 'stage-discovery-late',
  type: 'lifecycle_transitioned',
  source: 'system',
  occurredAt: now + 2,
  stage: 'discovery_qualification',
});
assert.equal(noRegression.lifecycle.stage, 'negotiation_approval', '自动投影不得让生命周期倒退');

const dormant = projectSalesConversationEvent(noRegression, {
  id: 'engagement-maintenance',
  type: 'engagement_recomputed',
  source: 'system',
  occurredAt: now + 62 * DAY_MS,
  asOf: now + 62 * DAY_MS,
});
assert.equal(dormant.lifecycle.stage, 'negotiation_approval');
assert.equal(dormant.engagement.status, 'dormant_60d');
assert.equal(legacyStageFromSalesState(dormant), 'quoted');

const wonFromOrder = salesStateFromLegacyCustomer({
  stage: 'silent60',
  lastActiveAt: now - 90 * DAY_MS,
  hasPaidOrder: true,
}, now);
assert.equal(wonFromOrder.lifecycle.stage, 'closed');
assert.equal(wonFromOrder.lifecycle.outcome, 'won');
assert.equal(legacyStageFromSalesState(wonFromOrder), 'won');

console.log('Sales conversation state projection passed');
