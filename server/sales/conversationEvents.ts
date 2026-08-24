import type { DealOutcome, KnowledgeGroundingState, SalesArtifactType, SalesEvidenceField, SalesIntentSignal, SalesLifecycleStage } from './conversationState.js';

interface SalesConversationEventBase {
  id: string;
  occurredAt: number;
  source: 'whatsapp' | 'crm' | 'system' | 'migration' | 'user';
  idempotencyKey?: string;
}

export type SalesConversationEvent =
  | (SalesConversationEventBase & { type: 'customer_created' })
  | (SalesConversationEventBase & { type: 'buyer_message_received' })
  | (SalesConversationEventBase & { type: 'seller_message_sent'; actor: 'ai' | 'human' })
  | (SalesConversationEventBase & { type: 'engagement_recomputed'; asOf: number })
  | (SalesConversationEventBase & {
      type: 'lifecycle_transitioned';
      stage: SalesLifecycleStage;
      outcome?: DealOutcome;
      reason?: string;
      allowRegression?: boolean;
    })
  | (SalesConversationEventBase & { type: 'intents_detected'; intents: SalesIntentSignal[] })
  | (SalesConversationEventBase & { type: 'evidence_observed'; key: string; field: SalesEvidenceField })
  | (SalesConversationEventBase & { type: 'evidence_confirmed'; key: string; value?: string | number | boolean; actorId?: string })
  | (SalesConversationEventBase & { type: 'evidence_withdrawn'; key: string; reason?: string })
  | (SalesConversationEventBase & { type: 'knowledge_evaluated'; state: KnowledgeGroundingState; referenceIds: string[] })
  | (SalesConversationEventBase & {
      type: 'artifact_created';
      artifact: {
        id: string;
        artifactType: SalesArtifactType;
        title?: string;
        externalRef?: string;
        expiresAt?: string;
        supersedesId?: string;
        approvalRequired: boolean;
      };
    })
  | (SalesConversationEventBase & {
      type: 'artifact_received';
      artifact: {
        id: string;
        artifactType: SalesArtifactType;
        title?: string;
        externalRef?: string;
        expiresAt?: string;
        supersedesId?: string;
        approvalRequired: false;
      };
    })
  | (SalesConversationEventBase & { type: 'artifact_approved'; artifactId: string; actorId: string })
  | (SalesConversationEventBase & { type: 'artifact_rejected'; artifactId: string; actorId: string; reason?: string })
  | (SalesConversationEventBase & { type: 'artifact_sent'; artifactId: string; deliveryEvidence: string })
  | (SalesConversationEventBase & { type: 'artifact_expired'; artifactId: string })
  | (SalesConversationEventBase & { type: 'human_takeover_requested'; ownerId?: string; ownerName?: string })
  | (SalesConversationEventBase & { type: 'human_takeover_accepted'; ownerId?: string; ownerName?: string })
  | (SalesConversationEventBase & { type: 'conversation_returned_to_ai' });

export function salesConversationEventKey(event: SalesConversationEvent): string {
  return event.idempotencyKey || event.id;
}
