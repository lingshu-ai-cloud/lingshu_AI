export const SALES_CONVERSATION_STATE_VERSION = 1 as const;

export type SalesLifecycleStage =
  | 'new_inquiry'
  | 'discovery_qualification'
  | 'technical_sample_validation'
  | 'proposal_quote'
  | 'negotiation_approval'
  | 'closed'
  | 'fulfillment_relationship';

export type DealOutcome = 'won' | 'lost' | 'on_hold';

export type EngagementStatus =
  | 'active'
  | 'waiting_buyer'
  | 'waiting_seller'
  | 'dormant_30d'
  | 'dormant_60d';

export type SalesIntentType =
  | 'product_discovery'
  | 'requirements_clarification'
  | 'capability_validation'
  | 'sample_request'
  | 'quotation_request'
  | 'price_negotiation'
  | 'payment_delivery'
  | 'complaint_claim'
  | 'human_contact_request';

export type EvidenceStatus = 'unknown' | 'claimed' | 'verified' | 'conflicting' | 'expired';
export type KnowledgeGroundingState = 'grounded_static' | 'grounded_dynamic' | 'missing' | 'ambiguous' | 'restricted' | 'expired';
export type AuthorityRiskLevel = 'L1' | 'L2' | 'L3' | 'L4';
export type ExecutionMode = 'ai_auto' | 'ai_draft' | 'human_approval' | 'mandatory_handoff';
export type SalesArtifactType = 'catalog' | 'specification' | 'sample' | 'quotation' | 'pi' | 'purchase_order' | 'contract' | 'payment_proof' | 'logistics' | 'claim';
export type SalesArtifactStatus = 'missing' | 'draft' | 'pending_approval' | 'sent' | 'accepted' | 'rejected' | 'expired';
export type ConversationOwnerType = 'ai' | 'human' | 'team' | 'unassigned';
export type HandoffStatus = 'none' | 'requested' | 'accepted' | 'resolved';

export interface SalesIntentSignal {
  type: SalesIntentType;
  confidence: number;
  sourceEventIds: string[];
  updatedAt: string;
}

export interface SalesEvidenceField {
  value?: string | number | boolean;
  status: EvidenceStatus;
  confidence?: number;
  sourceEventIds: string[];
  extractor?: string;
  valueRole?: 'buyer_requirement' | 'buyer_statement' | 'seller_capability' | 'transaction_fact';
  confirmedByHuman?: boolean;
  history?: Array<{
    value?: string | number | boolean;
    status: EvidenceStatus;
    sourceEventId: string;
    actor: 'buyer' | 'ai' | 'human' | 'system';
    occurredAt: string;
  }>;
  updatedAt: string;
}

export interface SalesArtifactState {
  id: string;
  type: SalesArtifactType;
  status: SalesArtifactStatus;
  version: number;
  approvalStatus: 'not_required' | 'pending' | 'approved' | 'rejected';
  title?: string;
  externalRef?: string;
  approvedBy?: string;
  approvedAt?: string;
  sentAt?: string;
  expiresAt?: string;
  supersedesId?: string;
  sourceEventIds: string[];
  updatedAt: string;
}

export interface SalesConversationStateV1 {
  schemaVersion: typeof SALES_CONVERSATION_STATE_VERSION;
  lifecycle: {
    stage: SalesLifecycleStage;
    outcome?: DealOutcome;
    enteredAt: string;
    lastProgressedAt: string;
    history?: Array<{
      from?: SalesLifecycleStage;
      to: SalesLifecycleStage;
      outcome?: DealOutcome;
      eventId: string;
      reason: string;
      occurredAt: string;
    }>;
  };
  engagement: {
    status: EngagementStatus;
    lastActivityAt: number;
    lastBuyerMessageAt?: number;
    lastSellerMessageAt?: number;
    updatedAt: string;
  };
  intents: {
    active: SalesIntentSignal[];
    updatedAt: string;
  };
  dealEvidence: {
    fields: Record<string, SalesEvidenceField>;
    updatedAt: string;
  };
  knowledge: {
    state: KnowledgeGroundingState;
    referenceIds: string[];
    updatedAt: string;
  };
  authorityRisk: {
    riskLevel: AuthorityRiskLevel;
    executionMode: ExecutionMode;
    reasons: string[];
    updatedAt: string;
  };
  artifacts: {
    items: SalesArtifactState[];
    updatedAt: string;
  };
  channelOwnership: {
    channel: string;
    owner: {
      type: ConversationOwnerType;
      id?: string;
      name?: string;
    };
    handoffStatus: HandoffStatus;
    responseDueAt?: string;
    updatedAt: string;
  };
  revision: number;
  appliedEventIds: string[];
  updatedAt: string;
}

export function isSalesConversationStateV1(value: unknown): value is SalesConversationStateV1 {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SalesConversationStateV1>;
  return candidate.schemaVersion === SALES_CONVERSATION_STATE_VERSION
    && typeof candidate.lifecycle?.stage === 'string'
    && typeof candidate.engagement?.status === 'string'
    && Array.isArray(candidate.appliedEventIds);
}
