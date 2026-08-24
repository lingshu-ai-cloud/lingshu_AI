import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { requireAuth, type AuthLocals } from '../middleware/auth.js';
import { artifactApprovalRequired, validateArtifactSend } from '../sales/commercialArtifacts.js';
import { buildStructuredHandoffPackage } from '../sales/handoffPackage.js';
import { evaluateLifecycleTransition, type LifecyclePolicyConfig } from '../sales/lifecyclePolicy.js';
import { decideNextBestAction } from '../sales/nextBestAction.js';
import { getPilotMetrics, recordPilotEvent, type PilotEventType } from '../sales/pilotMetrics.js';
import { runSalesQualityEvaluation } from '../sales/salesQualityEvaluator.js';
import type { SalesArtifactType, SalesLifecycleStage } from '../sales/conversationState.js';
import type { SalesConversationEvent } from '../sales/conversationEvents.js';
import { whatsappWindowState } from '../sales/whatsappWindow.js';
import { readTenantEnterpriseProfile } from './enterprise.js';
import {
  applySalesEventToWhatsAppCustomer,
  getWhatsAppCustomers,
  getWhatsAppCustomerSalesState,
  patchWhatsAppCustomer,
} from '../whatsapp/historyImport.js';

export const salesOperationsRouter = Router();
salesOperationsRouter.use(requireAuth);

function customerState(tenantId: string, customerId: string) {
  return getWhatsAppCustomerSalesState(tenantId, customerId);
}

function applyEvent(tenantId: string, customerId: string, event: SalesConversationEvent) {
  return applySalesEventToWhatsAppCustomer({ tenantId, customerId, event });
}

async function lifecyclePolicyForTenant(tenantId: string): Promise<LifecyclePolicyConfig> {
  const profile = await readTenantEnterpriseProfile(tenantId);
  const configured = (profile as unknown as { salesLifecyclePolicy?: LifecyclePolicyConfig }).salesLifecyclePolicy;
  return configured && typeof configured === 'object' ? configured : {};
}

salesOperationsRouter.get('/customers/:id/state', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const customerId = String(req.params.id || '');
  const state = customerState(tenantId, customerId);
  if (!state) { res.status(404).json({ error: 'customer_not_found' }); return; }
  const customer = getWhatsAppCustomers(tenantId).find(item => item.id === customerId);
  const latestQuestion = [...(customer?.timeline || [])].reverse().find((item: any) => item.actor === 'buyer')?.body || '';
  res.json({
    state,
    nextBestAction: decideNextBestAction(state),
    whatsappWindow: whatsappWindowState(state.engagement.lastBuyerMessageAt),
    handoffPackage: buildStructuredHandoffPackage(state, latestQuestion),
  });
});

salesOperationsRouter.post('/customers/:id/evidence/:key/confirm', (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const customerId = String(req.params.id || '');
  const key = String(req.params.key || '');
  const current = customerState(tenantId, customerId);
  if (!current?.dealEvidence.fields[key]) { res.status(404).json({ error: 'evidence_not_found' }); return; }
  const rawValue = req.body?.value;
  const value = typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean' ? rawValue : undefined;
  const updated = applyEvent(tenantId, customerId, {
    id: `evidence-confirm:${customerId}:${key}:${randomUUID()}`,
    type: 'evidence_confirmed', source: 'user', occurredAt: Date.now(), key, value, actorId: userId,
  });
  if (value !== undefined && value !== current.dealEvidence.fields[key].value) {
    recordPilotEvent({ id: `pilot-human-correction:${randomUUID()}`, tenantId, customerId, type: 'human_correction', occurredAt: new Date().toISOString(), metadata: { key, from: current.dealEvidence.fields[key].value, to: value } });
  }
  res.json({ ok: true, state: updated?.salesState });
});

salesOperationsRouter.post('/customers/:id/evidence/:key/withdraw', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const customerId = String(req.params.id || '');
  const key = String(req.params.key || '');
  const updated = applyEvent(tenantId, customerId, {
    id: `evidence-withdraw:${customerId}:${key}:${randomUUID()}`,
    type: 'evidence_withdrawn', source: 'user', occurredAt: Date.now(), key, reason: String(req.body?.reason || ''),
  });
  if (!updated) { res.status(404).json({ error: 'customer_not_found' }); return; }
  res.json({ ok: true, state: updated.salesState });
});

const ARTIFACT_TYPES = new Set<SalesArtifactType>(['catalog', 'specification', 'sample', 'quotation', 'pi', 'purchase_order', 'contract', 'payment_proof', 'logistics', 'claim']);

salesOperationsRouter.post('/customers/:id/artifacts', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const customerId = String(req.params.id || '');
  const artifactType = String(req.body?.type || '') as SalesArtifactType;
  if (!ARTIFACT_TYPES.has(artifactType)) { res.status(400).json({ error: 'invalid_artifact_type' }); return; }
  const artifactId = `artifact_${randomUUID()}`;
  const received = req.body?.received === true && (artifactType === 'purchase_order' || artifactType === 'payment_proof');
  const artifact = {
    id: artifactId,
    artifactType,
    title: String(req.body?.title || '').trim().slice(0, 160) || undefined,
    externalRef: String(req.body?.externalRef || '').trim().slice(0, 500) || undefined,
    expiresAt: String(req.body?.expiresAt || '').trim() || undefined,
    supersedesId: String(req.body?.supersedesId || '').trim() || undefined,
  };
  const updated = received
    ? applyEvent(tenantId, customerId, {
        id: `artifact-received:${artifactId}`, type: 'artifact_received', source: 'user', occurredAt: Date.now(),
        artifact: { ...artifact, approvalRequired: false },
      })
    : applyEvent(tenantId, customerId, {
        id: `artifact-create:${artifactId}`, type: 'artifact_created', source: 'user', occurredAt: Date.now(),
        artifact: { ...artifact, approvalRequired: artifactApprovalRequired(artifactType) },
      });
  if (!updated) { res.status(404).json({ error: 'customer_not_found' }); return; }
  res.status(201).json({ ok: true, artifactId, state: updated.salesState });
});

salesOperationsRouter.post('/customers/:id/artifacts/:artifactId/approve', (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const customerId = String(req.params.id || '');
  const artifactId = String(req.params.artifactId || '');
  const state = customerState(tenantId, customerId);
  if (!state?.artifacts.items.some(item => item.id === artifactId)) { res.status(404).json({ error: 'artifact_not_found' }); return; }
  const updated = applyEvent(tenantId, customerId, { id: `artifact-approve:${artifactId}:${randomUUID()}`, type: 'artifact_approved', source: 'user', occurredAt: Date.now(), artifactId, actorId: userId });
  res.json({ ok: true, state: updated?.salesState });
});

salesOperationsRouter.post('/customers/:id/artifacts/:artifactId/reject', (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const customerId = String(req.params.id || '');
  const artifactId = String(req.params.artifactId || '');
  const state = customerState(tenantId, customerId);
  if (!state?.artifacts.items.some(item => item.id === artifactId)) { res.status(404).json({ error: 'artifact_not_found' }); return; }
  const updated = applyEvent(tenantId, customerId, { id: `artifact-reject:${artifactId}:${randomUUID()}`, type: 'artifact_rejected', source: 'user', occurredAt: Date.now(), artifactId, actorId: userId, reason: String(req.body?.reason || '') });
  res.json({ ok: true, state: updated?.salesState });
});

salesOperationsRouter.post('/customers/:id/artifacts/:artifactId/expire', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const customerId = String(req.params.id || '');
  const artifactId = String(req.params.artifactId || '');
  const state = customerState(tenantId, customerId);
  if (!state?.artifacts.items.some(item => item.id === artifactId)) { res.status(404).json({ error: 'artifact_not_found' }); return; }
  const updated = applyEvent(tenantId, customerId, { id: `artifact-expire:${artifactId}:${randomUUID()}`, type: 'artifact_expired', source: 'system', occurredAt: Date.now(), artifactId });
  res.json({ ok: true, state: updated?.salesState });
});

salesOperationsRouter.post('/customers/:id/artifacts/:artifactId/send', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const customerId = String(req.params.id || '');
  const artifactId = String(req.params.artifactId || '');
  const state = customerState(tenantId, customerId);
  if (!state) { res.status(404).json({ error: 'customer_not_found' }); return; }
  const validation = validateArtifactSend(state, artifactId);
  if (!validation.allowed) { res.status(409).json({ error: validation.reason }); return; }
  const deliveryEvidence = String(req.body?.deliveryEvidence || '').trim();
  if (!deliveryEvidence) { res.status(400).json({ error: 'delivery_evidence_required' }); return; }
  let updated = applyEvent(tenantId, customerId, { id: `artifact-send:${artifactId}:${randomUUID()}`, type: 'artifact_sent', source: 'user', occurredAt: Date.now(), artifactId, deliveryEvidence });
  const sentArtifact = updated?.salesState?.artifacts.items.find(item => item.id === artifactId && item.status === 'sent');
  const targetStage: SalesLifecycleStage | null = sentArtifact?.type === 'quotation' ? 'proposal_quote'
    : sentArtifact?.type === 'sample' ? 'technical_sample_validation'
    : sentArtifact?.type === 'pi' || sentArtifact?.type === 'contract' ? 'negotiation_approval'
    : null;
  if (updated?.salesState && targetStage) {
    const decision = evaluateLifecycleTransition(updated.salesState, targetStage, await lifecyclePolicyForTenant(tenantId));
    if (decision.allowed) {
      updated = applyEvent(tenantId, customerId, { id: `lifecycle-from-artifact:${artifactId}:${randomUUID()}`, type: 'lifecycle_transitioned', source: 'system', occurredAt: Date.now(), stage: targetStage, reason: `approved_${sentArtifact?.type}_sent` });
      recordPilotEvent({ id: `pilot-lifecycle-artifact:${artifactId}`, tenantId, customerId, type: 'stage_changed', occurredAt: new Date().toISOString(), metadata: { from: decision.from, to: targetStage, artifactId } });
    }
  }
  if (sentArtifact?.type === 'quotation') recordPilotEvent({ id: `pilot-quote:${artifactId}`, tenantId, customerId, type: 'quotation_sent', occurredAt: new Date().toISOString(), metadata: { artifactId } });
  res.json({ ok: true, state: updated?.salesState });
});

const LIFECYCLE_STAGES = new Set<SalesLifecycleStage>(['new_inquiry', 'discovery_qualification', 'technical_sample_validation', 'proposal_quote', 'negotiation_approval', 'closed', 'fulfillment_relationship']);
const LIFECYCLE_ORDER: Record<SalesLifecycleStage, number> = { new_inquiry: 0, discovery_qualification: 1, technical_sample_validation: 2, proposal_quote: 3, negotiation_approval: 4, closed: 5, fulfillment_relationship: 6 };

salesOperationsRouter.post('/customers/:id/lifecycle/transition', async (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const customerId = String(req.params.id || '');
  const to = String(req.body?.to || '') as SalesLifecycleStage;
  const state = customerState(tenantId, customerId);
  if (!state) { res.status(404).json({ error: 'customer_not_found' }); return; }
  if (!LIFECYCLE_STAGES.has(to)) { res.status(400).json({ error: 'invalid_lifecycle_stage' }); return; }
  const regression = LIFECYCLE_ORDER[to] < LIFECYCLE_ORDER[state.lifecycle.stage];
  const correctionReason = String(req.body?.reason || '').trim();
  if (regression && (req.body?.allowRegression !== true || !correctionReason)) {
    res.status(409).json({ error: 'explicit_regression_reason_required', missingConditions: ['人工确认回退并填写原因'] }); return;
  }
  const decision = regression
    ? { allowed: true, from: state.lifecycle.stage, to, reason: 'explicit_human_correction', missingConditions: [] }
    : evaluateLifecycleTransition(state, to, await lifecyclePolicyForTenant(tenantId));
  if (!decision.allowed) { res.status(409).json({ error: decision.reason, missingConditions: decision.missingConditions }); return; }
  const updated = applyEvent(tenantId, customerId, {
    id: `lifecycle:${customerId}:${to}:${randomUUID()}`, type: 'lifecycle_transitioned', source: 'user', occurredAt: Date.now(), stage: to,
    outcome: req.body?.outcome === 'won' || req.body?.outcome === 'lost' || req.body?.outcome === 'on_hold' ? req.body.outcome : undefined,
    reason: correctionReason || decision.reason,
    allowRegression: regression,
  });
  recordPilotEvent({ id: `pilot-lifecycle:${randomUUID()}`, tenantId, customerId, type: regression ? 'stage_rolled_back' : 'stage_changed', occurredAt: new Date().toISOString(), metadata: { from: decision.from, to, reason: correctionReason || decision.reason } });
  const outcome = req.body?.outcome;
  if (outcome === 'won' || outcome === 'lost' || outcome === 'on_hold') {
    recordPilotEvent({ id: `pilot-outcome:${randomUUID()}`, tenantId, customerId, type: outcome === 'won' ? 'order_won' : outcome === 'lost' ? 'order_lost' : 'order_on_hold', occurredAt: new Date().toISOString(), metadata: { reason: String(req.body?.reason || '') } });
  }
  res.json({ ok: true, state: updated?.salesState });
});

salesOperationsRouter.post('/customers/:id/handoff', (req, res) => {
  const { tenantId, userId } = res.locals as AuthLocals;
  const customerId = String(req.params.id || '');
  const action = String(req.body?.action || '');
  let event: SalesConversationEvent;
  if (action === 'request') {
    patchWhatsAppCustomer({ tenantId, customerId, patch: { handlingMode: 'human_needed' } });
    event = { id: `handoff-request:${customerId}:${randomUUID()}`, type: 'human_takeover_requested', source: 'user', occurredAt: Date.now(), ownerName: String(req.body?.ownerName || '') || undefined };
  } else if (action === 'accept') {
    patchWhatsAppCustomer({ tenantId, customerId, patch: { handlingMode: 'human_needed' } });
    event = { id: `handoff-accept:${customerId}:${randomUUID()}`, type: 'human_takeover_accepted', source: 'user', occurredAt: Date.now(), ownerId: userId, ownerName: String(req.body?.ownerName || '') || undefined };
  } else if (action === 'return_to_ai') {
    patchWhatsAppCustomer({ tenantId, customerId, patch: { handlingMode: 'ai_draft' } });
    event = { id: `handoff-return:${customerId}:${randomUUID()}`, type: 'conversation_returned_to_ai', source: 'user', occurredAt: Date.now() };
  } else {
    res.status(400).json({ error: 'invalid_handoff_action' }); return;
  }
  const updated = applyEvent(tenantId, customerId, event);
  if (!updated) { res.status(404).json({ error: 'customer_not_found' }); return; }
  if (action !== 'return_to_ai') recordPilotEvent({ id: `pilot-${event.id}`, tenantId, customerId, type: action === 'accept' ? 'handoff_accepted' : 'handoff_requested', occurredAt: new Date(event.occurredAt).toISOString() });
  res.json({ ok: true, state: updated.salesState });
});

salesOperationsRouter.get('/quality', (_req, res) => {
  res.json(runSalesQualityEvaluation());
});

salesOperationsRouter.post('/quality/run', (_req, res) => {
  res.json(runSalesQualityEvaluation());
});

salesOperationsRouter.get('/pilot', (_req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  res.json(getPilotMetrics(tenantId));
});

const PILOT_EVENT_TYPES = new Set<PilotEventType>(['draft_generated', 'draft_adopted', 'draft_edited', 'edit_reason_recorded', 'evidence_acquired', 'stage_changed', 'stage_rolled_back', 'handoff_requested', 'handoff_viewed', 'handoff_accepted', 'quotation_sent', 'order_won', 'order_lost', 'order_on_hold', 'complaint', 'repeated_question', 'human_correction']);

salesOperationsRouter.post('/pilot/events', (req, res) => {
  const { tenantId } = res.locals as AuthLocals;
  const type = String(req.body?.type || '') as PilotEventType;
  const customerId = String(req.body?.customerId || '');
  if (!PILOT_EVENT_TYPES.has(type) || !customerId) { res.status(400).json({ error: 'invalid_pilot_event' }); return; }
  const ok = recordPilotEvent({ id: String(req.body?.id || `pilot_${randomUUID()}`), tenantId, customerId, type, occurredAt: new Date().toISOString(), turnIndex: Number.isFinite(Number(req.body?.turnIndex)) ? Number(req.body.turnIndex) : undefined, metadata: req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : undefined });
  res.status(ok ? 201 : 200).json({ ok });
});
