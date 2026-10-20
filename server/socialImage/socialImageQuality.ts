import {
  SOCIAL_IMAGE_HARD_CHECKS,
  type SocialImageCreationTask,
  type SocialImageQualityCheck,
  type SocialImageQualityCheckKey,
} from '../../shared/contracts/socialImageCreation.js';

const uncertain = (key: SocialImageQualityCheckKey, note: string, repairSuggestion?: string): SocialImageQualityCheck => ({
  key, verdict: 'uncertain', severity: 'hard', note, checker: 'deterministic', repairSuggestion,
});

/**
 * Cheap, deterministic gates that run before visual-model QA. Pixel-dependent
 * checks deliberately remain uncertain so the server can never fabricate a pass.
 */
export function socialImageDeterministicChecks(task: SocialImageCreationTask): SocialImageQualityCheck[] {
  const productIds = new Set(task.enterpriseAssets.filter(asset => asset.role === 'product' && asset.source === 'enterprise_knowledge_base').map(asset => asset.assetId));
  const productsBound = task.contentBrief.productRefs.length > 0 && task.contentBrief.productRefs.every(id => productIds.has(id));
  const text = [task.imageTextContract.headline, task.imageTextContract.supportingText, task.imageTextContract.cta].filter(Boolean).join(' ');
  const factReady = task.contentBrief.factuality === 'verified' && task.fieldsToConfirm.length === 0 && task.imageTextContract.requiredFacts.every(Boolean);
  const referenceReady = task.creationPath !== 'viral_replication' || Boolean(task.referenceSnapshot?.imageUrls.length && task.replicationRecipe);

  const byKey: Partial<Record<SocialImageQualityCheckKey, SocialImageQualityCheck>> = {
    product_identity: productsBound
      ? { key: 'product_identity', verdict: 'pass', severity: 'hard', note: '产品 ID 已绑定企业知识库', checker: 'deterministic', evidence: [...productIds] }
      : { key: 'product_identity', verdict: 'fail', severity: 'hard', note: '存在未绑定企业知识库的产品', checker: 'deterministic', repairSuggestion: '重新选择企业知识库产品资产' },
    fact_consistency: factReady
      ? { key: 'fact_consistency', verdict: 'pass', severity: 'hard', note: '事实状态与待确认字段通过预检', checker: 'deterministic' }
      : { key: 'fact_consistency', verdict: 'fail', severity: 'hard', note: '事实未验证或仍有待确认字段', checker: 'deterministic', repairSuggestion: '补充企业事实证据后重新策划' },
    text_overflow: text.length <= 280
      ? { key: 'text_overflow', verdict: 'pass', severity: 'hard', note: '确定性文字长度预检通过；仍需渲染后测量', checker: 'deterministic', score: 1 }
      : { key: 'text_overflow', verdict: 'fail', severity: 'hard', note: '海报可见文字超过预设容量', checker: 'deterministic', repairSuggestion: '缩短标题、辅助文字或 CTA' },
    reference_structure_similarity: referenceReady
      ? { key: 'reference_structure_similarity', verdict: 'uncertain', severity: 'soft', note: '参考快照与复刻配方齐全，等待多模态比较', checker: 'deterministic' }
      : { key: 'reference_structure_similarity', verdict: 'fail', severity: 'soft', note: '参考快照或复刻配方缺失', checker: 'deterministic', repairSuggestion: '重新从灵感中心进入爆款复刻' },
  };
  const pixelNotes: Partial<Record<SocialImageQualityCheckKey, string>> = {
    packaging_visibility: '需要检测包装、瓶盖和标签像素可见性', subject_visibility: '需要检测主体与内容模块碰撞',
    label_ocr: '需要 OCR 比对企业资产标签', copy_visual_consistency: '需要多模态判断图文一致性',
    brand_consistency: '需要比对企业品牌资产与成片', safe_zone: '需要检测主体框与安全区',
    motion_mechanism_similarity: '静态预检不判断动效机制',
  };
  return [...new Set([...SOCIAL_IMAGE_HARD_CHECKS, 'reference_structure_similarity' as const, ...(task.deliverySpec.format === 'gif' ? ['motion_mechanism_similarity' as const] : [])])]
    .map(key => byKey[key] || uncertain(key, pixelNotes[key] || '等待视觉质检'));
}

/** Deterministic failures are authoritative. Visual evidence may resolve only
 * checks that were still uncertain; missing model rows never become passes. */
export function mergeSocialImageVisualChecks(
  deterministic: SocialImageQualityCheck[],
  visual: SocialImageQualityCheck[],
): SocialImageQualityCheck[] {
  const visualByKey = new Map(visual.map(check => [check.key, check]));
  return deterministic.map(check => {
    if (check.verdict === 'fail' || check.verdict === 'pass') return check;
    const observed = visualByKey.get(check.key);
    if (!observed || observed.checker !== 'multimodal') return check;
    return { ...observed, severity: check.severity };
  });
}
