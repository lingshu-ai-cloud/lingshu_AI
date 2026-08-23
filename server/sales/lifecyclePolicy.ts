import type { SalesArtifactType, SalesConversationStateV1, SalesLifecycleStage } from './conversationState.js';

export interface LifecycleTransitionDecision {
  allowed: boolean;
  from: SalesLifecycleStage;
  to: SalesLifecycleStage;
  reason: string;
  missingConditions: string[];
}

export interface LifecyclePolicyConfig {
  requiredArtifacts?: Partial<Record<SalesLifecycleStage, SalesArtifactType[]>>;
  requiredEvidence?: Partial<Record<SalesLifecycleStage, string[]>>;
}

export const DEFAULT_LIFECYCLE_POLICY: LifecyclePolicyConfig = {
  requiredArtifacts: {
    technical_sample_validation: ['sample'],
    proposal_quote: ['quotation'],
    negotiation_approval: ['quotation'],
  },
  requiredEvidence: {
    closed: ['purchase_order_received|payment_received'],
  },
};

function sentArtifact(state: SalesConversationStateV1, type: SalesArtifactType): boolean {
  return state.artifacts.items.some(item => item.type === type && item.status === 'sent' && (item.approvalStatus === 'approved' || item.approvalStatus === 'not_required'));
}

export function evaluateLifecycleTransition(state: SalesConversationStateV1, to: SalesLifecycleStage, config: LifecyclePolicyConfig = DEFAULT_LIFECYCLE_POLICY): LifecycleTransitionDecision {
  const missingConditions: string[] = [];
  const artifactRequirements = config.requiredArtifacts?.[to] || DEFAULT_LIFECYCLE_POLICY.requiredArtifacts?.[to] || [];
  artifactRequirements.forEach(type => { if (!sentArtifact(state, type)) missingConditions.push(`已审批并发送的${type}文档`); });
  const evidenceRequirements = config.requiredEvidence?.[to] || DEFAULT_LIFECYCLE_POLICY.requiredEvidence?.[to] || [];
  evidenceRequirements.forEach(requirement => {
    const alternatives = requirement.split('|');
    const satisfied = alternatives.some(key => {
      if (state.dealEvidence.fields[key]?.status === 'verified') return true;
      if (key === 'purchase_order_received') return state.artifacts.items.some(item => item.type === 'purchase_order' && item.status === 'accepted');
      if (key === 'payment_received') return state.artifacts.items.some(item => item.type === 'payment_proof' && (item.status === 'accepted' || item.status === 'sent'));
      return false;
    });
    if (!satisfied) missingConditions.push(`已确认的${alternatives.join('或')}证据`);
  });
  return {
    allowed: missingConditions.length === 0,
    from: state.lifecycle.stage,
    to,
    reason: missingConditions.length ? 'transition_prerequisites_missing' : 'observable_prerequisites_satisfied',
    missingConditions,
  };
}
