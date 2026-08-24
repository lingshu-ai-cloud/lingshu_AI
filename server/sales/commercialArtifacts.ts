import type { SalesArtifactType, SalesConversationStateV1 } from './conversationState.js';

export const APPROVAL_REQUIRED_ARTIFACTS = new Set<SalesArtifactType>(['quotation', 'pi', 'contract', 'claim']);

export function artifactApprovalRequired(type: SalesArtifactType): boolean {
  return APPROVAL_REQUIRED_ARTIFACTS.has(type);
}
export function validateArtifactSend(state: SalesConversationStateV1, artifactId: string): { allowed: boolean; reason?: string } {
  const artifact = state.artifacts.items.find(item => item.id === artifactId);
  if (!artifact) return { allowed: false, reason: 'artifact_not_found' };
  if (artifact.status === 'expired') return { allowed: false, reason: 'artifact_expired' };
  if (artifact.approvalStatus === 'pending' || artifact.approvalStatus === 'rejected') return { allowed: false, reason: 'artifact_not_approved' };
  if (!artifact.externalRef) return { allowed: false, reason: 'artifact_file_or_reference_required' };
  return { allowed: true };
}

export function commercialFieldRisk(field: string): { riskLevel: 'L2' | 'L3' | 'L4'; executionMode: 'ai_draft' | 'human_approval' | 'mandatory_handoff' } {
  if (/compensation|claim|exclusive|赔偿|索赔|独家/i.test(field)) return { riskLevel: 'L4', executionMode: 'mandatory_handoff' };
  if (/price|discount|payment|delivery|lead.?time|价格|折扣|付款|交期/i.test(field)) return { riskLevel: 'L3', executionMode: 'human_approval' };
  return { riskLevel: 'L2', executionMode: 'ai_draft' };
}
