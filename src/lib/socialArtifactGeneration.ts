import type { SocialContentArtifact } from '../../shared/contracts/socialContentWorkflow';

export type SocialArtifactGenerationDisclosure = {
  sourceLabel: string;
  verificationLabel: string;
  verified: boolean;
  approvalAllowed: boolean;
};

export function socialArtifactGenerationDisclosure(
  artifact: SocialContentArtifact,
): SocialArtifactGenerationDisclosure {
  const content = artifact.content || {};
  const studio = /^studio_/i.test(typeof content.sourceKey === 'string' ? content.sourceKey : '');
  const provenance = typeof content.generationProvenance === 'string' ? content.generationProvenance : '';
  const quality = typeof content.qualityStatus === 'string' ? content.qualityStatus : '';
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
    };
  }
  return {
    sourceLabel: artifact.origin === 'agent' ? '智能员工生成' : '人工提交',
    verificationLabel: verified ? '生成验证通过' : '按当前流程人工验收',
    verified,
    approvalAllowed: true,
  };
}
