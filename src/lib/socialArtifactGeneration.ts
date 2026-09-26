import type { SocialContentArtifact } from '../../shared/contracts/socialContentWorkflow';

export type SocialArtifactGenerationDisclosure = {
  sourceLabel: string;
  verificationLabel: string;
  verified: boolean;
  approvalAllowed: boolean;
  releaseState: 'ready_for_review' | 'changes_required' | 'concept_preview' | 'unverified';
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function socialArtifactGenerationDisclosure(
  artifact: SocialContentArtifact,
): SocialArtifactGenerationDisclosure {
  const content = artifact.content || {};
  const studio = /^studio_/i.test(typeof content.sourceKey === 'string' ? content.sourceKey : '');
  const provenance = typeof content.generationProvenance === 'string' ? content.generationProvenance : '';
  const quality = typeof content.qualityStatus === 'string' ? content.qualityStatus : '';
  const workflowGenerated = content.workflowSchema === 'social-content.auto-production.v3';
  const productionResult = record(content.productionResult);
  const creativeReview = record(productionResult?.creativeReview);
  const replicationEvaluation = record(content.replicationEvaluation);
  const replicationStatus = typeof replicationEvaluation?.status === 'string'
    ? replicationEvaluation.status
    : null;
  const conceptPreview = record(content.delivery)?.status === 'concept_preview'
    || record(content.review)?.deliverableStatus === 'concept_preview';
  const creativeBlocked = creativeReview?.approved === false
    || (replicationStatus !== null && replicationStatus !== 'passed');
  const verified = provenance === 'ai'
    && quality === 'passed'
    && content.publishable === true
    && typeof content.generationRecordId === 'string'
    && Boolean(content.generationRecordId.trim());
  if (studio) {
    return {
      sourceLabel: provenance === 'ai' ? 'Studio AI 生成' : provenance === 'manual_draft' ? 'Studio 手动草稿' : 'Studio 来源待确认',
      verificationLabel: verified ? '质量验证通过 · 可确认' : '质量待验证 · 不可交付',
      verified,
      approvalAllowed: verified,
      releaseState: verified ? 'ready_for_review' : 'unverified',
    };
  }
  if (workflowGenerated && conceptPreview) {
    return {
      sourceLabel: '智能员工概念样片',
      verificationLabel: '仅供确认方向 · 不可发布',
      verified: false,
      approvalAllowed: false,
      releaseState: 'concept_preview',
    };
  }
  if (workflowGenerated && creativeBlocked) {
    return {
      sourceLabel: artifact.origin === 'agent' ? '智能员工生成' : '人工提交',
      verificationLabel: '内容检查未通过 · 请退回修改',
      verified: false,
      approvalAllowed: false,
      releaseState: 'changes_required',
    };
  }
  return {
    sourceLabel: artifact.origin === 'agent' ? '智能员工生成' : '人工提交',
    verificationLabel: workflowGenerated ? '技术检查通过 · 请人工确认内容' : verified ? '生成验证通过' : '按当前流程人工验收',
    verified: verified || workflowGenerated,
    approvalAllowed: true,
    releaseState: 'ready_for_review',
  };
}
