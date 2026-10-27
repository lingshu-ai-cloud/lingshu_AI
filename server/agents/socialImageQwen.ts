import { createHash } from 'node:crypto';
import { exactQwenScope } from './exactQwenScope.js';
import { createQwenClient } from './qwenClient.js';
import type { SocialImageQualityCheck, SocialImageQualityCheckKey } from '../../shared/contracts/socialImageCreation.js';

export const SOCIAL_IMAGE_VISUAL_KEYS: SocialImageQualityCheckKey[] = [
  'product_identity', 'packaging_visibility', 'subject_visibility', 'label_ocr', 'fact_consistency', 'copy_visual_consistency',
  'brand_consistency', 'text_overflow', 'safe_zone', 'visual_cohesion', 'reference_structure_similarity',
];

function parseChecks(raw: string): unknown[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as { checks?: unknown[] };
    return Array.isArray(parsed.checks) ? parsed.checks : [];
  } catch { return []; }
}

export async function qualityCheckSocialImageWithQwen(input: {
  generated: { bytes: Buffer; mimeType: string };
  products: Array<{ name: string; bytes: Buffer; mimeType: string }>;
  reference?: { bytes: Buffer; mimeType: string };
  expected: { headline: string; supportingText?: string; cta?: string; facts: string[]; format: string; language?: string };
}): Promise<SocialImageQualityCheck[]> {
  const image = (label: string, value: { bytes: Buffer; mimeType: string }) => [
    { type: 'text' as const, text: label },
    { type: 'image_url' as const, image_url: { url: `data:${value.mimeType};base64,${value.bytes.toString('base64')}` } },
  ];
  const model = (exactQwenScope()?.model || process.env.QWEN_EXACT_VL_MODEL || 'qwen3-vl-plus').trim();
  const candidateHash = createHash('sha256').update(input.generated.bytes).digest('hex');
  const productHashes = input.products.map(product => createHash('sha256').update(product.bytes).digest('hex'));
  const prompt = `只根据图片像素判定，不能看清时选 uncertain。必须返回纯 JSON：{"checks":[{"key":"...","verdict":"pass|fail|uncertain","note":"不超过20字","region":{"x":0,"y":0,"width":1,"height":1}}]}。按顺序恰好返回以下 ${SOCIAL_IMAGE_VISUAL_KEYS.length} 项，每项一次：${SOCIAL_IMAGE_VISUAL_KEYS.join(',')}。region 是成片上的归一化位置；pass 必须有可定位 region，uncertain 可省略。比较 GENERATED OUTPUT 与 AUTHORITATIVE PRODUCT：品牌、包装文字和瓶盖要保真，不能用相似产品替代；检查遮挡、文字、事实、安全边距，以及主体与背景的光线、透视、边缘是否自然。背景贴图接缝、光晕或悬浮主体使 visual_cohesion=fail。ORIGINAL BENCHMARK 只用于结构比较。EXPECTED.language 只约束新写文字，原包装文字保持原样。EXPECTED.facts 是允许事实边界，不要求全部写出；产品名称不能与可见包装冲突。EXPECTED=${JSON.stringify(input.expected)}`;
  const completion = await createQwenClient().chat.completions.create({
    model,
    messages: [{ role: 'user', content: [
      { type: 'text', text: prompt },
      ...image('GENERATED OUTPUT（待检成片）', input.generated),
      ...input.products.flatMap((product, index) => image(`AUTHORITATIVE PRODUCT ${index + 1}: ${product.name}`, product)),
      ...(input.reference ? image('ORIGINAL BENCHMARK（只比较结构）', input.reference) : []),
    ] as any }],
    response_format: { type: 'json_object' }, enable_thinking: false, max_tokens: 2600,
  } as any, { timeout: 120_000, maxRetries: 0 });
  const seen = new Set<string>();
  return parseChecks(String(completion.choices[0]?.message?.content || '')).flatMap(raw => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const key = String(row.key || ''), verdict = String(row.verdict || 'uncertain');
    if (!SOCIAL_IMAGE_VISUAL_KEYS.includes(key as SocialImageQualityCheckKey) || seen.has(key) || !['pass', 'fail', 'uncertain'].includes(verdict)) return [];
    seen.add(key);
    const checkedKey = key as SocialImageQualityCheckKey;
    const regionRow = row.region && typeof row.region === 'object' ? row.region as Record<string, unknown> : null;
    const values = regionRow ? ['x', 'y', 'width', 'height'].map(field => Number(regionRow[field])) : [];
    const region = values.length === 4 && values.every(Number.isFinite) && values[0]! >= 0 && values[1]! >= 0
      && values[2]! > 0 && values[3]! > 0 && values[0]! + values[2]! <= 1.001 && values[1]! + values[3]! <= 1.001
      ? { x: values[0]!, y: values[1]!, width: values[2]!, height: values[3]! } : undefined;
    const missingComparison = (['product_identity', 'packaging_visibility', 'brand_consistency'].includes(checkedKey) && !input.products.length)
      || (checkedKey === 'reference_structure_similarity' && !input.reference);
    const checkedVerdict = verdict === 'pass' && (!region || missingComparison) ? 'uncertain' : verdict as 'pass' | 'fail' | 'uncertain';
    return [{
      key: checkedKey, verdict: checkedVerdict,
      severity: checkedKey === 'reference_structure_similarity' ? 'soft' as const : 'hard' as const,
      checker: 'multimodal' as const, note: String(row.note || '视觉模型未提供充分说明').slice(0, 500),
      ...(Number.isFinite(Number(row.score)) ? { score: Math.max(0, Math.min(1, Number(row.score))) } : {}),
      evidence: [`candidate-sha256:${candidateHash}`,
        ...(checkedKey === 'product_identity' || checkedKey === 'packaging_visibility' || checkedKey === 'brand_consistency'
          ? productHashes.map(value => `product-sha256:${value}`) : []),
        ...(Array.isArray(row.evidence) ? row.evidence.map(String).slice(0, 8) : [])],
      ...(region ? { region } : {}),
      ...(row.repairSuggestion ? { repairSuggestion: String(row.repairSuggestion).slice(0, 500) } : {}),
    }];
  });
}
