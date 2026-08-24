import assert from 'node:assert/strict';
import { artifactApprovalRequired, validateArtifactSend } from './commercialArtifacts.js';
import { createSalesConversationState, projectSalesConversationEvent, projectSalesConversationEvents } from './conversationProjector.js';
import { evaluateLifecycleTransition } from './lifecyclePolicy.js';
import { decideNextBestAction } from './nextBestAction.js';
import { aggregatePilotMetrics, type PilotEvent } from './pilotMetrics.js';
import { buyerSignalEvents, extractBuyerSalesSignals } from './salesSignalExtractor.js';
import { findUnauthorizedCommitments, runSalesQualityEvaluation } from './salesQualityEvaluator.js';
import { whatsappWindowState } from './whatsappWindow.js';

const now = Date.parse('2026-08-23T00:00:00.000Z');

const ceSignals = extractBuyerSalesSignals('We need CE for this model. Do you have the certificate?', 'buyer-msg-ce', now);
assert.ok(ceSignals.intents.some(intent => intent.type === 'capability_validation'));
assert.equal(ceSignals.evidence.find(item => item.key === 'requirements.certification')?.field.valueRole, 'buyer_requirement');
assert.ok(!ceSignals.evidence.some(item => item.key.includes('seller_capability')), '买家要求不得变成卖家能力');

let state = projectSalesConversationEvents(
  createSalesConversationState({ occurredAt: now }),
  buyerSignalEvents('We need 5,000 pcs for Dubai next month. What is your best price?', 'buyer-msg-1', now),
);
assert.equal(state.lifecycle.stage, 'new_inquiry', '询价本身不得推进报价阶段');
assert.equal(state.authorityRisk.riskLevel, 'L3');
assert.equal(state.authorityRisk.executionMode, 'human_approval');
assert.equal(state.dealEvidence.fields.quantity.value, '5,000 pcs');
assert.ok(state.dealEvidence.fields.quantity.sourceEventIds.includes('buyer-msg-1'));
assert.equal(decideNextBestAction(state).type, 'prepare_quote');

state = projectSalesConversationEvent(state, {
  id: 'conflicting-quantity', type: 'evidence_observed', source: 'system', occurredAt: now + 1, key: 'quantity',
  field: { value: '6,000 pcs', status: 'claimed', confidence: 0.9, sourceEventIds: ['buyer-msg-2'], valueRole: 'buyer_statement', updatedAt: new Date(now + 1).toISOString() },
});
assert.equal(state.dealEvidence.fields.quantity.status, 'conflicting');
state = projectSalesConversationEvent(state, { id: 'human-confirm-quantity', type: 'evidence_confirmed', source: 'user', occurredAt: now + 2, key: 'quantity', value: '5,000 pcs' });
assert.equal(state.dealEvidence.fields.quantity.status, 'verified');
assert.equal(state.dealEvidence.fields.quantity.confirmedByHuman, true);
const afterLowerConfidenceRepeat = projectSalesConversationEvent(state, {
  id: 'repeat-lower-confidence', type: 'evidence_observed', source: 'system', occurredAt: now + 3, key: 'quantity',
  field: { value: '6,000 pcs', status: 'claimed', confidence: 0.5, sourceEventIds: ['buyer-msg-3'], valueRole: 'buyer_statement', updatedAt: new Date(now + 3).toISOString() },
});
assert.equal(afterLowerConfidenceRepeat.dealEvidence.fields.quantity.value, '5,000 pcs', '人工确认值不得被模型覆盖');
assert.equal(afterLowerConfidenceRepeat.dealEvidence.fields.quantity.status, 'verified');
state = projectSalesConversationEvent(afterLowerConfidenceRepeat, { id: 'knowledge-grounded', type: 'knowledge_evaluated', source: 'system', occurredAt: now + 3, state: 'grounded_static', referenceIds: ['SKU-001', 'FAQ-002'] });
assert.equal(state.knowledge.state, 'grounded_static');
assert.deepEqual(state.knowledge.referenceIds, ['SKU-001', 'FAQ-002']);

assert.equal(evaluateLifecycleTransition(state, 'proposal_quote').allowed, false);
const quoteId = 'quote-v1';
state = projectSalesConversationEvent(state, {
  id: 'quote-create', type: 'artifact_created', source: 'user', occurredAt: now + 4,
  artifact: { id: quoteId, artifactType: 'quotation', title: 'Quotation V1', externalRef: 'internal:quote-v1', approvalRequired: artifactApprovalRequired('quotation') },
});
assert.equal(validateArtifactSend(state, quoteId).allowed, false);
const unapprovedAttempt = projectSalesConversationEvent(state, { id: 'quote-send-too-early', type: 'artifact_sent', source: 'user', occurredAt: now + 5, artifactId: quoteId, deliveryEvidence: 'wa-message-1' });
assert.equal(unapprovedAttempt.artifacts.items[0].status, 'draft');
assert.equal(unapprovedAttempt.lifecycle.stage, 'new_inquiry');
state = projectSalesConversationEvent(unapprovedAttempt, { id: 'quote-approve', type: 'artifact_approved', source: 'user', occurredAt: now + 6, artifactId: quoteId, actorId: 'sales-manager' });
assert.equal(validateArtifactSend(state, quoteId).allowed, true);
state = projectSalesConversationEvent(state, { id: 'quote-send-approved', type: 'artifact_sent', source: 'user', occurredAt: now + 7, artifactId: quoteId, deliveryEvidence: 'wa-message-2' });
assert.equal(state.artifacts.items[0].status, 'sent');
assert.equal(state.lifecycle.stage, 'new_inquiry', '文档发送事件本身不应绕过转换策略');
const quoteTransition = evaluateLifecycleTransition(state, 'proposal_quote');
assert.equal(quoteTransition.allowed, true);
state = projectSalesConversationEvent(state, { id: 'quote-stage-transition', type: 'lifecycle_transitioned', source: 'system', occurredAt: now + 8, stage: 'proposal_quote', reason: 'approved_quotation_sent' });
assert.equal(state.lifecycle.stage, 'proposal_quote');
assert.equal(state.lifecycle.history?.at(-1)?.reason, 'approved_quotation_sent');
state = projectSalesConversationEvent(state, { id: 'quote-v2-create', type: 'artifact_created', source: 'user', occurredAt: now + 8, artifact: { id: 'quote-v2', artifactType: 'quotation', title: 'Quotation V2', externalRef: 'internal:quote-v2', supersedesId: quoteId, approvalRequired: true } });
assert.equal(state.artifacts.items.find(item => item.id === 'quote-v2')?.version, 2);
assert.equal(state.artifacts.items.find(item => item.id === 'quote-v2')?.supersedesId, quoteId);
state = projectSalesConversationEvent(state, { id: 'quote-v2-expire', type: 'artifact_expired', source: 'system', occurredAt: now + 9, artifactId: 'quote-v2' });
assert.equal(state.artifacts.items.find(item => item.id === 'quote-v2')?.status, 'expired');
assert.equal(evaluateLifecycleTransition(state, 'closed').allowed, false);
state = projectSalesConversationEvent(state, { id: 'po-received', type: 'artifact_received', source: 'user', occurredAt: now + 10, artifact: { id: 'po-1', artifactType: 'purchase_order', title: 'PO-001', externalRef: 'internal:po-1', approvalRequired: false } });
assert.equal(state.artifacts.items.find(item => item.id === 'po-1')?.status, 'accepted');
assert.equal(evaluateLifecycleTransition(state, 'closed').allowed, true);

state = projectSalesConversationEvent(state, { id: 'handoff-request', type: 'human_takeover_requested', source: 'user', occurredAt: now + 11 });
assert.equal(state.authorityRisk.executionMode, 'mandatory_handoff');
assert.equal(state.channelOwnership.handoffStatus, 'requested');
assert.equal(decideNextBestAction(state).type, 'request_human_takeover');
state = projectSalesConversationEvent(state, { id: 'handoff-accepted', type: 'human_takeover_accepted', source: 'user', occurredAt: now + 12, ownerId: 'seller-1' });
assert.equal(state.channelOwnership.owner.id, 'seller-1');
state = projectSalesConversationEvent(state, { id: 'handoff-return', type: 'conversation_returned_to_ai', source: 'user', occurredAt: now + 13 });
assert.equal(state.channelOwnership.owner.type, 'ai');
assert.equal(state.channelOwnership.handoffStatus, 'resolved');

assert.equal(whatsappWindowState(now, now + 23 * 60 * 60 * 1000).templateRequired, false);
assert.equal(whatsappWindowState(now, now + 25 * 60 * 60 * 1000).templateRequired, true);

const quality = runSalesQualityEvaluation(undefined, now);
assert.equal(quality.totalCases, 16);
assert.equal(quality.hardGate.passed, true);
assert.equal(quality.metrics.unauthorizedCommitments, 0);
assert.equal(quality.failures.length, 0);
assert.deepEqual(findUnauthorizedCommitments('We guarantee delivery in 14 days.'), ['delivery_guarantee']);

const pilotEvents: PilotEvent[] = [
  { id: 'p1', tenantId: 't1', customerId: 'c1', type: 'draft_generated', occurredAt: new Date(now).toISOString() },
  { id: 'p2', tenantId: 't1', customerId: 'c1', type: 'draft_adopted', occurredAt: new Date(now + 1).toISOString() },
  { id: 'p3', tenantId: 't1', customerId: 'c1', type: 'evidence_acquired', occurredAt: new Date(now + 2).toISOString(), turnIndex: 3 },
  { id: 'p4', tenantId: 't1', customerId: 'c1', type: 'handoff_requested', occurredAt: new Date(now + 3 * 60_000).toISOString() },
  { id: 'p4v', tenantId: 't1', customerId: 'c1', type: 'handoff_viewed', occurredAt: new Date(now + 4 * 60_000).toISOString() },
  { id: 'p5', tenantId: 't1', customerId: 'c1', type: 'handoff_accepted', occurredAt: new Date(now + 8 * 60_000).toISOString() },
  { id: 'other', tenantId: 't2', customerId: 'c2', type: 'draft_generated', occurredAt: new Date(now).toISOString() },
];
const pilot = aggregatePilotMetrics(pilotEvents, 't1', now + 10 * 60_000);
assert.equal(pilot.sample.customers, 1);
assert.equal(pilot.draft.adoptionRate, 100);
assert.equal(pilot.evidence.acquiredWithin3Turns, 1);
assert.equal(pilot.handoff.medianViewMinutes, 1);
assert.equal(pilot.handoff.medianAcceptMinutes, 5);
assert.match(pilot.interpretation, /不构成/);

console.log('P1-P5 sales architecture, policy, evaluation and pilot metrics passed');
