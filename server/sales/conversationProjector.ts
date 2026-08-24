import type { SalesConversationEvent } from './conversationEvents.js';
import { salesConversationEventKey } from './conversationEvents.js';
import {
  SALES_CONVERSATION_STATE_VERSION,
  type EngagementStatus,
  type ExecutionMode,
  type SalesConversationStateV1,
  type SalesLifecycleStage,
} from './conversationState.js';

const MAX_APPLIED_EVENT_IDS = 200;
const DAY_MS = 86_400_000;

const LIFECYCLE_ORDER: Record<SalesLifecycleStage, number> = {
  new_inquiry: 0,
  discovery_qualification: 1,
  technical_sample_validation: 2,
  proposal_quote: 3,
  negotiation_approval: 4,
  closed: 5,
  fulfillment_relationship: 6,
};

export interface CreateSalesConversationStateInput {
  occurredAt: number;
  channel?: string;
  lifecycleStage?: SalesLifecycleStage;
  engagementStatus?: EngagementStatus;
  executionMode?: ExecutionMode;
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function engagementStatusAt(lastActivityAt: number, now: number): EngagementStatus | null {
  const inactiveFor = Math.max(0, now - lastActivityAt);
  if (inactiveFor > 60 * DAY_MS) return 'dormant_60d';
  if (inactiveFor > 30 * DAY_MS) return 'dormant_30d';
  return null;
}

export function createSalesConversationState(input: CreateSalesConversationStateInput): SalesConversationStateV1 {
  const updatedAt = iso(input.occurredAt);
  return {
    schemaVersion: SALES_CONVERSATION_STATE_VERSION,
    lifecycle: {
      stage: input.lifecycleStage || 'new_inquiry',
      enteredAt: updatedAt,
      lastProgressedAt: updatedAt,
    },
    engagement: {
      status: input.engagementStatus || 'active',
      lastActivityAt: input.occurredAt,
      updatedAt,
    },
    intents: { active: [], updatedAt },
    dealEvidence: { fields: {}, updatedAt },
    knowledge: { state: 'missing', referenceIds: [], updatedAt },
    authorityRisk: {
      riskLevel: 'L1',
      executionMode: input.executionMode || 'ai_draft',
      reasons: [],
      updatedAt,
    },
    artifacts: { items: [], updatedAt },
    channelOwnership: {
      channel: input.channel || 'whatsapp',
      owner: { type: 'ai' },
      handoffStatus: 'none',
      updatedAt,
    },
    revision: 0,
    appliedEventIds: [],
    updatedAt,
  };
}

function withAppliedEvent(state: SalesConversationStateV1, event: SalesConversationEvent): SalesConversationStateV1 {
  const key = salesConversationEventKey(event);
  return {
    ...state,
    revision: state.revision + 1,
    appliedEventIds: [...state.appliedEventIds, key].slice(-MAX_APPLIED_EVENT_IDS),
    updatedAt: iso(event.occurredAt),
  };
}

export function projectSalesConversationEvent(
  state: SalesConversationStateV1,
  event: SalesConversationEvent,
): SalesConversationStateV1 {
  const key = salesConversationEventKey(event);
  if (state.appliedEventIds.includes(key)) return state;

  const updatedAt = iso(event.occurredAt);
  let next = state;

  switch (event.type) {
    case 'customer_created':
      break;
    case 'buyer_message_received':
      next = {
        ...state,
        engagement: {
          ...state.engagement,
          status: event.occurredAt >= state.engagement.lastActivityAt ? 'waiting_seller' : state.engagement.status,
          lastActivityAt: Math.max(state.engagement.lastActivityAt, event.occurredAt),
          lastBuyerMessageAt: Math.max(state.engagement.lastBuyerMessageAt || 0, event.occurredAt),
          updatedAt,
        },
      };
      break;
    case 'seller_message_sent':
      next = {
        ...state,
        engagement: {
          ...state.engagement,
          status: event.occurredAt >= state.engagement.lastActivityAt ? 'waiting_buyer' : state.engagement.status,
          lastActivityAt: Math.max(state.engagement.lastActivityAt, event.occurredAt),
          lastSellerMessageAt: Math.max(state.engagement.lastSellerMessageAt || 0, event.occurredAt),
          updatedAt,
        },
      };
      break;
    case 'engagement_recomputed': {
      const dormantStatus = engagementStatusAt(state.engagement.lastActivityAt, event.asOf);
      if (dormantStatus && dormantStatus !== state.engagement.status) {
        next = {
          ...state,
          engagement: { ...state.engagement, status: dormantStatus, updatedAt },
        };
      }
      break;
    }
    case 'lifecycle_transitioned': {
      const canTransition = event.allowRegression
        || LIFECYCLE_ORDER[event.stage] >= LIFECYCLE_ORDER[state.lifecycle.stage];
      if (canTransition) {
        next = {
          ...state,
          lifecycle: {
            stage: event.stage,
            ...(event.outcome ? { outcome: event.outcome } : state.lifecycle.outcome ? { outcome: state.lifecycle.outcome } : {}),
            enteredAt: event.stage === state.lifecycle.stage ? state.lifecycle.enteredAt : updatedAt,
            lastProgressedAt: updatedAt,
            history: [...(state.lifecycle.history || []), {
              from: state.lifecycle.stage,
              to: event.stage,
              ...(event.outcome ? { outcome: event.outcome } : {}),
              eventId: event.id,
              reason: event.reason || 'observable_event',
              occurredAt: updatedAt,
            }].slice(-100),
          },
        };
      }
      break;
    }
    case 'intents_detected': {
      const byType = new Map(state.intents.active.map(item => [item.type, item]));
      for (const intent of event.intents) {
        const previous = byType.get(intent.type);
        byType.set(intent.type, previous
          ? {
              ...previous,
              confidence: Math.max(previous.confidence, intent.confidence),
              sourceEventIds: Array.from(new Set([...previous.sourceEventIds, ...intent.sourceEventIds])),
              updatedAt,
            }
          : { ...intent, sourceEventIds: Array.from(new Set(intent.sourceEventIds)), updatedAt });
      }
      const detectedTypes = new Set(event.intents.map(intent => intent.type));
      const mandatory = detectedTypes.has('complaint_claim') || detectedTypes.has('human_contact_request');
      const approval = detectedTypes.has('price_negotiation') || detectedTypes.has('quotation_request') || detectedTypes.has('payment_delivery');
      const riskLevel = mandatory ? 'L4' : approval && state.authorityRisk.riskLevel !== 'L4' ? 'L3' : state.authorityRisk.riskLevel;
      const executionMode = mandatory ? 'mandatory_handoff'
        : approval && state.authorityRisk.executionMode !== 'mandatory_handoff' ? 'human_approval'
        : state.authorityRisk.executionMode;
      const reasons = [
        ...state.authorityRisk.reasons,
        ...(mandatory ? ['投诉、索赔或明确人工请求需要强制接管'] : []),
        ...(approval ? ['价格、报价、付款或交期字段需要人工审批'] : []),
      ];
      next = {
        ...state,
        intents: { active: Array.from(byType.values()), updatedAt },
        authorityRisk: { ...state.authorityRisk, riskLevel, executionMode, reasons: Array.from(new Set(reasons)), updatedAt },
      };
      break;
    }
    case 'evidence_observed': {
      const previous = state.dealEvidence.fields[event.key];
      const sameValue = previous?.value === event.field.value;
      const confirmed = previous?.status === 'verified' && previous.confirmedByHuman;
      const status = confirmed
        ? previous.status
        : previous && previous.value !== undefined && event.field.value !== undefined && !sameValue
          ? 'conflicting'
          : event.field.status;
      const history = [
        ...(previous?.history || []),
        ...(event.field.history || [{
          value: event.field.value,
          status: event.field.status,
          sourceEventId: event.id,
          actor: 'ai' as const,
          occurredAt: updatedAt,
        }]),
      ].slice(-50);
      next = {
        ...state,
        dealEvidence: {
          fields: {
            ...state.dealEvidence.fields,
            [event.key]: {
              ...event.field,
              ...(confirmed ? { value: previous.value, confirmedByHuman: true } : {}),
              status,
              confidence: Math.max(previous?.confidence || 0, event.field.confidence || 0),
              sourceEventIds: Array.from(new Set([...(previous?.sourceEventIds || []), ...event.field.sourceEventIds, event.id])),
              history,
              updatedAt,
            },
          },
          updatedAt,
        },
      };
      break;
    }
    case 'evidence_confirmed': {
      const previous = state.dealEvidence.fields[event.key];
      if (!previous) break;
      const value = event.value === undefined ? previous.value : event.value;
      next = {
        ...state,
        dealEvidence: {
          fields: {
            ...state.dealEvidence.fields,
            [event.key]: {
              ...previous,
              value,
              status: 'verified',
              confirmedByHuman: true,
              sourceEventIds: Array.from(new Set([...previous.sourceEventIds, event.id])),
              history: [...(previous.history || []), {
                value,
                status: 'verified' as const,
                sourceEventId: event.id,
                actor: 'human' as const,
                occurredAt: updatedAt,
              }].slice(-50),
              updatedAt,
            },
          },
          updatedAt,
        },
      };
      break;
    }
    case 'evidence_withdrawn': {
      const previous = state.dealEvidence.fields[event.key];
      if (!previous) break;
      next = {
        ...state,
        dealEvidence: {
          fields: {
            ...state.dealEvidence.fields,
            [event.key]: {
              ...previous,
              status: 'unknown',
              confirmedByHuman: false,
              sourceEventIds: Array.from(new Set([...previous.sourceEventIds, event.id])),
              history: [...(previous.history || []), {
                value: previous.value,
                status: 'unknown' as const,
                sourceEventId: event.id,
                actor: 'human' as const,
                occurredAt: updatedAt,
              }].slice(-50),
              updatedAt,
            },
          },
          updatedAt,
        },
      };
      break;
    }
    case 'knowledge_evaluated':
      next = {
        ...state,
        knowledge: {
          state: event.state,
          referenceIds: Array.from(new Set(event.referenceIds)).slice(0, 50),
          updatedAt,
        },
      };
      break;
    case 'artifact_created':
    case 'artifact_received': {
      const existingVersions = state.artifacts.items.filter(item => item.type === event.artifact.artifactType);
      const item = {
        id: event.artifact.id,
        type: event.artifact.artifactType,
        status: event.type === 'artifact_received' ? 'accepted' as const : 'draft' as const,
        version: Math.max(0, ...existingVersions.map(existing => existing.version)) + 1,
        approvalStatus: event.type === 'artifact_received' ? 'not_required' as const : event.artifact.approvalRequired ? 'pending' as const : 'not_required' as const,
        ...(event.artifact.title ? { title: event.artifact.title } : {}),
        ...(event.artifact.externalRef ? { externalRef: event.artifact.externalRef } : {}),
        ...(event.artifact.expiresAt ? { expiresAt: event.artifact.expiresAt } : {}),
        ...(event.artifact.supersedesId ? { supersedesId: event.artifact.supersedesId } : {}),
        sourceEventIds: [event.id],
        updatedAt,
      };
      const items = state.artifacts.items.some(existing => existing.id === item.id)
        ? state.artifacts.items
        : [...state.artifacts.items, item];
      next = { ...state, artifacts: { items, updatedAt } };
      break;
    }
    case 'artifact_approved':
    case 'artifact_rejected':
    case 'artifact_sent':
    case 'artifact_expired': {
      const items = state.artifacts.items.map(item => {
        if (item.id !== event.artifactId) return item;
        if (event.type === 'artifact_approved') return { ...item, approvalStatus: 'approved' as const, status: 'pending_approval' as const, approvedBy: event.actorId, approvedAt: updatedAt, sourceEventIds: [...item.sourceEventIds, event.id], updatedAt };
        if (event.type === 'artifact_rejected') return { ...item, approvalStatus: 'rejected' as const, status: 'rejected' as const, sourceEventIds: [...item.sourceEventIds, event.id], updatedAt };
        if (event.type === 'artifact_expired') return { ...item, status: 'expired' as const, sourceEventIds: [...item.sourceEventIds, event.id], updatedAt };
        if (item.approvalStatus !== 'approved' && item.approvalStatus !== 'not_required') return item;
        return { ...item, status: 'sent' as const, sentAt: updatedAt, sourceEventIds: [...item.sourceEventIds, event.id, event.deliveryEvidence], updatedAt };
      });
      next = { ...state, artifacts: { items, updatedAt } };
      break;
    }
    case 'human_takeover_requested':
      next = {
        ...state,
        authorityRisk: { ...state.authorityRisk, executionMode: 'mandatory_handoff', updatedAt },
        channelOwnership: {
          ...state.channelOwnership,
          owner: { type: event.ownerId || event.ownerName ? 'human' : 'unassigned', ...(event.ownerId ? { id: event.ownerId } : {}), ...(event.ownerName ? { name: event.ownerName } : {}) },
          handoffStatus: 'requested',
          updatedAt,
        },
      };
      break;
    case 'human_takeover_accepted':
      next = {
        ...state,
        authorityRisk: { ...state.authorityRisk, executionMode: 'human_approval', updatedAt },
        channelOwnership: {
          ...state.channelOwnership,
          owner: { type: 'human', ...(event.ownerId ? { id: event.ownerId } : {}), ...(event.ownerName ? { name: event.ownerName } : {}) },
          handoffStatus: 'accepted',
          updatedAt,
        },
      };
      break;
    case 'conversation_returned_to_ai':
      next = {
        ...state,
        authorityRisk: { ...state.authorityRisk, executionMode: 'ai_draft', updatedAt },
        channelOwnership: {
          ...state.channelOwnership,
          owner: { type: 'ai' },
          handoffStatus: 'resolved',
          updatedAt,
        },
      };
      break;
  }

  return withAppliedEvent(next, event);
}

export function projectSalesConversationEvents(
  state: SalesConversationStateV1,
  events: SalesConversationEvent[],
): SalesConversationStateV1 {
  return events.reduce(projectSalesConversationEvent, state);
}
