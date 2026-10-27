import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  SOCIAL_IMAGE_HARD_CHECKS,
  type SocialImageCreationTask,
  type SocialImageQualityCheck,
  type SocialImageQualityCheckKey,
} from '../../shared/contracts/socialImageCreation.js';
import { socialImageCanvasForAspectRatio } from './referenceCanvas.js';
import { isSocialImageBuyerPoster, socialImageBuyerVisibleTexts } from './socialImageBuyerOverlay.js';

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
  const text = (task.renderBrief && isSocialImageBuyerPoster(task.renderBrief)
    ? socialImageBuyerVisibleTexts(task.renderBrief)
    : [task.imageTextContract.headline, task.imageTextContract.supportingText, task.imageTextContract.cta])
    .filter(Boolean).join(' ');
  const factReady = task.contentBrief.factuality === 'verified' && task.fieldsToConfirm.length === 0 && task.imageTextContract.requiredFacts.every(Boolean);
  const referenceReady = task.creationPath !== 'viral_replication' || Boolean(task.referenceSnapshot?.imageUrls.length && task.replicationRecipe);

  const byKey: Partial<Record<SocialImageQualityCheckKey, SocialImageQualityCheck>> = {
    file_decode: uncertain('file_decode', '等待读取候选图片实际字节'),
    pixel_dimensions: uncertain('pixel_dimensions', '等待读取候选图片实际像素尺寸'),
    product_identity: productsBound
      ? { key: 'product_identity', verdict: 'uncertain', severity: 'hard', note: '产品 ID 已绑定；等待候选像素与企业产品原图比较', checker: 'deterministic', evidence: [...productIds] }
      : { key: 'product_identity', verdict: 'fail', severity: 'hard', note: '存在未绑定企业知识库的产品', checker: 'deterministic', repairSuggestion: '重新选择企业知识库产品资产' },
    fact_consistency: factReady
      ? { key: 'fact_consistency', verdict: 'uncertain', severity: 'hard', note: '事实来源已验证；等待候选像素中的表达比较', checker: 'deterministic' }
      : { key: 'fact_consistency', verdict: 'fail', severity: 'hard', note: '事实未验证或仍有待确认字段', checker: 'deterministic', repairSuggestion: '补充企业事实证据后重新策划' },
    text_overflow: text.length <= 280
      ? { key: 'text_overflow', verdict: 'uncertain', severity: 'hard', note: '文字长度预检通过；等待候选像素中的裁切检查', checker: 'deterministic' }
      : { key: 'text_overflow', verdict: 'fail', severity: 'hard', note: '海报可见文字超过预设容量', checker: 'deterministic', repairSuggestion: '缩短标题、辅助文字或 CTA' },
    reference_structure_similarity: referenceReady
      ? { key: 'reference_structure_similarity', verdict: 'uncertain', severity: 'soft', note: '参考快照与复刻配方齐全，等待多模态比较', checker: 'deterministic' }
      : { key: 'reference_structure_similarity', verdict: 'fail', severity: 'soft', note: '参考快照或复刻配方缺失', checker: 'deterministic', repairSuggestion: '重新从灵感中心进入爆款复刻' },
  };
  const pixelNotes: Partial<Record<SocialImageQualityCheckKey, string>> = {
    packaging_visibility: '需要检测包装、瓶盖和标签像素可见性', subject_visibility: '需要检测主体与内容模块碰撞',
    label_ocr: '需要 OCR 比对企业资产标签', copy_visual_consistency: '需要多模态判断图文一致性',
    brand_consistency: '需要比对企业品牌资产与成片', safe_zone: '需要检测主体框与安全区',
    visual_cohesion: '需要检查产品与场景的光线、阴影、透视和边缘是否统一',
    motion_mechanism_similarity: '静态预检不判断动效机制',
  };
  return [...new Set([...SOCIAL_IMAGE_HARD_CHECKS, 'reference_structure_similarity' as const, ...(task.deliverySpec.format === 'gif' ? ['motion_mechanism_similarity' as const] : [])])]
    .map(key => byKey[key] || uncertain(key, pixelNotes[key] || '等待视觉质检'));
}

export async function socialImageCandidatePixelChecks(input: {
  bytes: Buffer;
  aspectRatio: SocialImageCreationTask['deliverySpec']['aspectRatio'];
}): Promise<SocialImageQualityCheck[]> {
  const contentHash = createHash('sha256').update(input.bytes).digest('hex');
  try {
    const decoded = await sharp(input.bytes, { limitInputPixels: 40_000_000 }).rotate().toBuffer({ resolveWithObject: true });
    const width = Number(decoded.info.width || 0), height = Number(decoded.info.height || 0);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error('decode');
    const expected = socialImageCanvasForAspectRatio(input.aspectRatio);
    const dimensionPass = width === expected.width && height === expected.height;
    return [
      { key: 'file_decode', verdict: 'pass', severity: 'hard', checker: 'deterministic', note: `候选图片可解码：${width}×${height}`,
        evidence: [`candidate-sha256:${contentHash}`] },
      { key: 'pixel_dimensions', verdict: dimensionPass ? 'pass' : 'fail', severity: 'hard', checker: 'deterministic',
        note: dimensionPass ? `实际像素与 ${input.aspectRatio} 交付规格一致` : `实际像素 ${width}×${height}，要求 ${expected.width}×${expected.height}`,
        evidence: [`candidate-sha256:${contentHash}`, `actual:${width}x${height}`, `expected:${expected.width}x${expected.height}`],
        ...(dimensionPass ? {} : { repairSuggestion: `将候选规范化为 ${expected.width}×${expected.height}` }) },
    ];
  } catch {
    return [
      { key: 'file_decode', verdict: 'fail', severity: 'hard', checker: 'deterministic', note: '候选图片实际字节不可解码',
        evidence: [`candidate-sha256:${contentHash}`], repairSuggestion: '重新生成或恢复可读取的候选文件' },
      { key: 'pixel_dimensions', verdict: 'uncertain', severity: 'hard', checker: 'deterministic', note: '文件不可解码，无法验证像素尺寸',
        evidence: [`candidate-sha256:${contentHash}`] },
    ];
  }
}

/** Validate the encoded animation, not only Sharp's default first-page view. */
export async function socialImageGifAnimationCheck(input: {
  bytes: Buffer;
  aspectRatio: SocialImageCreationTask['deliverySpec']['aspectRatio'];
  expectedFrames: number;
  expectedFrameBytes?: Buffer[];
}): Promise<SocialImageQualityCheck> {
  const candidateHash = createHash('sha256').update(input.bytes).digest('hex');
  const evidence = [`candidate-sha256:${candidateHash}`];
  try {
    const metadata = await sharp(input.bytes, { animated: true, limitInputPixels: 40_000_000 }).metadata();
    const expected = socialImageCanvasForAspectRatio(input.aspectRatio);
    const pages = Number(metadata.pages || 0);
    if (metadata.format !== 'gif' || pages !== input.expectedFrames || pages < 2
      || metadata.width !== expected.width || metadata.pageHeight !== expected.height) {
      return { key: 'motion_mechanism_similarity', verdict: 'fail', severity: 'hard', checker: 'deterministic',
        note: `GIF 实际帧数或尺寸不符：${pages} 帧，${metadata.width || 0}×${metadata.pageHeight || 0}`,
        evidence, repairSuggestion: '使用已质检的合成帧重新编码动图' };
    }
    if (input.expectedFrameBytes && input.expectedFrameBytes.length !== pages) {
      return { key: 'motion_mechanism_similarity', verdict: 'fail', severity: 'hard', checker: 'deterministic',
        note: 'GIF 合成帧证据不完整，无法证明编码成片与已质检画面一致', evidence };
    }
    const decodedFrames = await Promise.all(Array.from({ length: pages }, (_, index) =>
      sharp(input.bytes, { page: index, pages: 1, limitInputPixels: 40_000_000 })
        .resize(64, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer()));
    const frameHashes = decodedFrames.map(bytes => createHash('sha256').update(bytes).digest('hex'));
    const expectedFrames = await Promise.all((input.expectedFrameBytes || []).map(bytes =>
      sharp(bytes, { limitInputPixels: 40_000_000 }).resize(64, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer()));
    const averageDifference = (left: Buffer, right: Buffer) => {
      if (left.length !== right.length) return Infinity;
      let difference = 0;
      for (let pixel = 0; pixel < left.length; pixel += 1) difference += Math.abs(left[pixel]! - right[pixel]!);
      return difference / left.length;
    };
    const matched = expectedFrames.every((expectedFrame, index) => {
      const actualFrame = decodedFrames[index];
      return Boolean(actualFrame && averageDifference(expectedFrame, actualFrame) <= 40); // GIF palette quantization is lossy.
    });
    const actualMotion = decodedFrames.some((frame, index) => index > 0 && averageDifference(frame, decodedFrames[index - 1]!) > 5);
    const expectedMotion = expectedFrames.length === 0 || expectedFrames.some((frame, index) =>
      index > 0 && averageDifference(frame, expectedFrames[index - 1]!) > 5);
    const passed = actualMotion && expectedMotion && matched;
    return { key: 'motion_mechanism_similarity', verdict: passed ? 'pass' : 'fail',
      severity: 'hard', checker: 'deterministic',
      note: passed ? 'GIF 全部编码帧与合成画面一致，且真实形成切换动效'
        : !matched ? 'GIF 编码帧与已质检合成画面不一致' : 'GIF 所有画面相同，未形成切换动效',
      evidence: [...evidence, `actual-frames:${pages}`, ...frameHashes.map(value => `frame-sha256:${value}`),
        ...(input.expectedFrameBytes?.map(bytes => `composed-frame-sha256:${createHash('sha256').update(bytes).digest('hex')}`) || [])] };
  } catch {
    return { key: 'motion_mechanism_similarity', verdict: 'fail', severity: 'hard', checker: 'deterministic',
      note: 'GIF 动图字节不可完整解码', evidence, repairSuggestion: '重新编码并复检全部帧' };
  }
}

export async function socialImageCandidateOcrCheck(input: {
  bytes: Buffer;
  mimeType: string;
  expectedTexts: string[];
  recognize: (input: { bytes: Buffer; mimeType: string }) => Promise<string>;
}): Promise<SocialImageQualityCheck> {
  const expected = input.expectedTexts.map(value => value.trim()).filter(Boolean);
  if (!expected.length) return { key: 'label_ocr', verdict: 'not_applicable', severity: 'hard', checker: 'deterministic',
    note: '该候选没有要求显示的文字' };
  const candidateHash = createHash('sha256').update(input.bytes).digest('hex');
  try {
    const observed = await input.recognize({ bytes: input.bytes, mimeType: input.mimeType });
    const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const normalizedObserved = normalize(observed);
    const missing = expected.filter(value => !normalizedObserved.includes(normalize(value)));
    const evidence = [`candidate-sha256:${candidateHash}`, `ocr-sha256:${createHash('sha256').update(observed).digest('hex')}`];
    return missing.length ? { key: 'label_ocr', verdict: observed.trim() ? 'fail' : 'uncertain', severity: 'hard', checker: 'deterministic',
      note: observed.trim() ? `OCR 未完整识别要求文字：${missing.join('、')}` : 'OCR 未识别到可验证文字', evidence,
      repairSuggestion: '使用确定性文字图层重新渲染，并再次执行 OCR' }
      : { key: 'label_ocr', verdict: 'pass', severity: 'hard', checker: 'deterministic', note: '候选实际像素 OCR 与要求文字一致', evidence };
  } catch {
    return { key: 'label_ocr', verdict: 'uncertain', severity: 'hard', checker: 'deterministic',
      note: '本地 OCR 不可用，不能证明图片文字正确', evidence: [`candidate-sha256:${candidateHash}`] };
  }
}

/** Deterministic failures are authoritative; visual evidence may resolve only
 * uncertain checks, and missing model rows never become passes. */
export function mergeSocialImageVisualChecks(
  deterministic: SocialImageQualityCheck[],
  visual: SocialImageQualityCheck[],
): SocialImageQualityCheck[] {
  const visualByKey = new Map(visual.map(check => [check.key, check]));
  return deterministic.map(check => {
    if (check.verdict === 'fail' || check.verdict === 'pass' || check.verdict === 'not_applicable') return check;
    const observed = visualByKey.get(check.key);
    if (!observed || observed.checker !== 'multimodal') return check;
    return { ...observed, severity: check.severity };
  });
}
