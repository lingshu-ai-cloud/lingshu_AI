import { useState } from 'react';
import { LsMediaStateFrame, LsProgressiveMedia } from '../ui/LsExperiencePrimitives';
import type { SocialImageContentType, SocialImageCreationTask, SocialImageQualityCheckKey } from '../../../shared/contracts/socialImageCreation';

export const IMAGE_TYPES: Array<{ id: SocialImageContentType; label: string; description: string; available: boolean }> = [
  { id: 'light_packaging', label: '单图/轻包装', description: '产品实拍或场景图加少量文字包装', available: true },
  { id: 'product_poster', label: '产品海报', description: '突出产品、卖点和询盘动作', available: true },
  { id: 'brand_news', label: '品牌新闻', description: '合作、发布、展会或企业事件', available: true },
  { id: 'experiment_comparison', label: '实验对比', description: '用前后差异或实验过程证明价值', available: true },
  { id: 'trend', label: '趋势内容', description: '趋势洞察连接企业产品机会', available: true },
  { id: 'infographic', label: '信息图', description: '结构化解释技术、流程或数据', available: true },
  { id: 'carousel', label: '轮播图', description: '连续多页讲清问题、证据和方案', available: true },
  { id: 'gif_poster', label: 'GIF 动态海报', description: '多底图切换，产品与文字固定', available: true },
];

export const STEP_ITEMS = [
  { key: 'inputs', title: '内容与资产' }, { key: 'production', title: '生成首版' }, { key: 'review', title: '审阅交付' },
] as const;

export const CHECK_LABELS: Record<SocialImageQualityCheckKey, string> = {
  file_decode: '文件可以解码', pixel_dimensions: '实际像素尺寸正确',
  product_identity: '产品身份正确', packaging_visibility: '包装关键部位可见', subject_visibility: '主体未被内容模块遮挡',
  label_ocr: '图片文字正确', fact_consistency: '图片与已确认事实一致', copy_visual_consistency: '图片与帖子配文一致',
  brand_consistency: '品牌与配色一致', text_overflow: '文字没有溢出或裁切', safe_zone: '主体位于安全区',
  reference_structure_similarity: '参考结构还原度', motion_mechanism_similarity: '动效机制还原度',
};

export const resolvedQuality = (verdict: string) => verdict === 'pass' || verdict === 'not_applicable';
export const passedQualityKeys = (outputs: SocialImageCreationTask['outputs']) => [...new Set(outputs.flatMap(output =>
  output.qualityChecks.filter(check => resolvedQuality(check.verdict)).map(check => check.key)))];

export function socialImageSoftReferenceFindings(outputs: SocialImageCreationTask['outputs']): string[] {
  const labels: Record<string, string> = {
    reference_structure_similarity: '参考结构相似度待判断',
    'hook_factor:reference-attention-region': '注意力区域未完全对齐',
    'hook_factor:reference-text-hierarchy': '标题层级未完全对齐',
  };
  return [...new Set(outputs.flatMap(output => output.qualityChecks
    .filter(check => check.severity === 'soft' && check.verdict !== 'pass')
    .map(check => labels[check.key] || check.key)))];
}

export function topicForType(type: SocialImageContentType) {
  if (type === 'brand_news') return 'partnership_news';
  if (type === 'experiment_comparison') return 'experiment_comparison';
  if (type === 'trend') return 'trend';
  return 'technical_solution';
}

export function posterStyleForType(type: SocialImageContentType) {
  if (type === 'brand_news') return 'news-editorial';
  if (type === 'experiment_comparison') return 'comparison-proof';
  if (type === 'trend') return 'trend-editorial';
  return 'oem-factory';
}

export function ReviewImage({ src, alt, onAvailability }: { src: string; alt: string; onAvailability?: (ready: boolean) => void }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return <LsMediaStateFrame state={failed ? 'error' : loaded ? 'ready' : 'loading'}
    label={failed ? '图片暂不可用' : '正在加载图片'} className="h-full w-full">
    <LsProgressiveMedia src={src} alt={alt} width="100%" height="100%" className="h-full w-full object-contain" preview={false}
      onLoad={() => { setLoaded(true); if (!failed) onAvailability?.(true); }} onError={() => { setFailed(true); onAvailability?.(false); }} />
  </LsMediaStateFrame>;
}
