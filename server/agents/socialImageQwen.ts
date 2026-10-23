import { createHash } from 'node:crypto';
import { exactQwenScope } from './exactQwenScope.js';
import { createQwenClient } from './qwenClient.js';
import type { SocialImageQualityCheck, SocialImageQualityCheckKey } from '../../shared/contracts/socialImageCreation.js';

const imageKeys: SocialImageQualityCheckKey[] = [
  'product_identity', 'packaging_visibility', 'subject_visibility', 'label_ocr', 'fact_consistency', 'copy_visual_consistency',
  'brand_consistency', 'text_overflow', 'safe_zone', 'reference_structure_similarity',
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
  expected: { headline: string; supportingText?: string; cta?: string; facts: string[]; format: string };
}): Promise<SocialImageQualityCheck[]> {
  const image = (label: string, value: { bytes: Buffer; mimeType: string }) => [
    { type: 'text' as const, text: label },
    { type: 'image_url' as const, image_url: { url: `data:${value.mimeType};base64,${value.bytes.toString('base64')}` } },
  ];
  const model = (exactQwenScope()?.model || process.env.QWEN_EXACT_VL_MODEL || 'qwen3-vl-plus').trim();
  const candidateHash = createHash('sha256').update(input.generated.bytes).digest('hex');
  const productHashes = input.products.map(product => createHash('sha256').update(product.bytes).digest('hex'));
  const prompt = `只根据图像像素和 EXPECTED 判定，不得把看不清或缺少对照的项目判为 pass。返回 JSON {"checks":[{"key":"key","verdict":"pass|fail|uncertain","note":"可观察证据","score":0.0,"region":{"x":0.0,"y":0.0,"width":1.0,"height":1.0},"evidence":["证据"],"repairSuggestion":"失败时的局部修复建议"}]}。region 必须是待检成片上的归一化证据区域；无法定位时 verdict 必须为 uncertain。必须返回这些 key：${imageKeys.join(',')}。逐像素比较 GENERATED OUTPUT 与 AUTHORITATIVE PRODUCT，核对产品身份、包装/瓶盖/泵头/标签可见性、主体遮挡、文字 OCR、事实表达、图文主题、品牌视觉、文字裁切、安全边距；只有存在对标图时比较结构，否则 reference_structure_similarity 为 uncertain。EXPECTED=${JSON.stringify(input.expected)}`;
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
    if (!imageKeys.includes(key as SocialImageQualityCheckKey) || seen.has(key) || !['pass', 'fail', 'uncertain'].includes(verdict)) return [];
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
