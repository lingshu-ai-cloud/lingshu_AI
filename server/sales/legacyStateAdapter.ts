import { createSalesConversationState, engagementStatusAt } from './conversationProjector.js';
import { isSalesConversationStateV1, type EngagementStatus, type ExecutionMode, type SalesConversationStateV1, type SalesLifecycleStage } from './conversationState.js';

export type LegacyCustomerStage = 'lead' | 'inquiry' | 'quoted' | 'won' | 'silent30' | 'silent60';
export type LegacyHandlingMode = 'ai_auto' | 'ai_draft' | 'human_needed';

export interface LegacyStateInput {
  stage: LegacyCustomerStage;
  lastActiveAt: number;
  createdAt?: string;
  updatedAt?: string;
  handlingMode?: LegacyHandlingMode;
  hasPaidOrder?: boolean;
  salesState?: unknown;
}
function lifecycleFromLegacy(stage: LegacyCustomerStage, hasPaidOrder: boolean): { stage: SalesLifecycleStage; outcome?: 'won' } {
  if (stage === 'won' || hasPaidOrder) return { stage: 'closed', outcome: 'won' };
  if (stage === 'quoted') return { stage: 'proposal_quote' };
  if (stage === 'lead') return { stage: 'new_inquiry' };
  return { stage: 'discovery_qualification' };
}

function engagementFromLegacy(stage: LegacyCustomerStage, lastActiveAt: number, now: number): EngagementStatus {
  if (stage === 'silent60') return 'dormant_60d';
  if (stage === 'silent30') return 'dormant_30d';
  return engagementStatusAt(lastActiveAt, now) || 'active';
}

function executionFromLegacy(mode?: LegacyHandlingMode): ExecutionMode {
  if (mode === 'ai_auto') return 'ai_auto';
  if (mode === 'human_needed') return 'mandatory_handoff';
  return 'ai_draft';
}

export function salesStateFromLegacyCustomer(input: LegacyStateInput, now = Date.now()): SalesConversationStateV1 {
  if (isSalesConversationStateV1(input.salesState)) return input.salesState;
  const lifecycle = lifecycleFromLegacy(input.stage, Boolean(input.hasPaidOrder));
  const state = createSalesConversationState({
    occurredAt: input.lastActiveAt,
    channel: 'whatsapp',
    lifecycleStage: lifecycle.stage,
    engagementStatus: engagementFromLegacy(input.stage, input.lastActiveAt, now),
    executionMode: executionFromLegacy(input.handlingMode),
  });
  const enteredAt = input.updatedAt || input.createdAt || new Date(input.lastActiveAt).toISOString();
  return {
    ...state,
    lifecycle: {
      ...state.lifecycle,
      ...(lifecycle.outcome ? { outcome: lifecycle.outcome } : {}),
      enteredAt,
      lastProgressedAt: enteredAt,
    },
    channelOwnership: {
      ...state.channelOwnership,
      owner: input.handlingMode === 'human_needed' ? { type: 'unassigned' } : { type: 'ai' },
      handoffStatus: input.handlingMode === 'human_needed' ? 'requested' : 'none',
    },
  };
}

export function legacyStageFromSalesState(state: SalesConversationStateV1): LegacyCustomerStage {
  const lifecycle = state.lifecycle.stage;
  if (lifecycle === 'closed' && state.lifecycle.outcome === 'won') return 'won';
  if (lifecycle === 'fulfillment_relationship') return 'won';
  if (lifecycle === 'proposal_quote' || lifecycle === 'negotiation_approval') return 'quoted';
  if (state.engagement.status === 'dormant_60d') return 'silent60';
  if (state.engagement.status === 'dormant_30d') return 'silent30';
  if (lifecycle === 'new_inquiry') return 'lead';
  return 'inquiry';
}
