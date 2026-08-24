import { decideNextBestAction } from './nextBestAction.js';
import type { SalesConversationStateV1 } from './conversationState.js';

export interface StructuredHandoffPackage {
  customerQuestion: string;
  lifecycle: SalesConversationStateV1['lifecycle'];
  activeIntents: string[];
  verifiedEvidence: Array<{ key: string; value: string | number | boolean; sourceEventIds: string[] }>;
  conflictingEvidence: string[];
  risk: SalesConversationStateV1['authorityRisk'];
  artifacts: SalesConversationStateV1['artifacts']['items'];
  nextAction: ReturnType<typeof decideNextBestAction>;
  generatedAt: string;
}

export function buildStructuredHandoffPackage(state: SalesConversationStateV1, customerQuestion: string, now = Date.now()): StructuredHandoffPackage {
  const fields = Object.entries(state.dealEvidence.fields);
  return {
    customerQuestion,
    lifecycle: state.lifecycle,
    activeIntents: state.intents.active.map(intent => intent.type),
    verifiedEvidence: fields
      .filter(([, field]) => field.value !== undefined && (field.status === 'verified' || field.status === 'claimed'))
      .map(([key, field]) => ({ key, value: field.value!, sourceEventIds: field.sourceEventIds })),
    conflictingEvidence: fields.filter(([, field]) => field.status === 'conflicting').map(([key]) => key),
    risk: state.authorityRisk,
    artifacts: state.artifacts.items,
    nextAction: decideNextBestAction(state),
    generatedAt: new Date(now).toISOString(),
  };
}
