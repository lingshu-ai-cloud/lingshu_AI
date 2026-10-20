export type SocialImageRevisionTarget = 'background' | 'product' | 'logo' | 'typography' | 'full_composite';
export type SocialImageRequestedRatio = '1:1' | '4:5' | '9:16' | '16:9';

export function socialImageRequestedRatio(instruction: string): SocialImageRequestedRatio | null {
  const match = String(instruction || '').match(/(?:^|[^\d])(1\s*:\s*1|4\s*:\s*5|9\s*:\s*16|16\s*:\s*9)(?:[^\d]|$)/);
  return match ? match[1]!.replace(/\s/g, '') as SocialImageRequestedRatio : null;
}
export function socialImageRevisionTarget(instruction: string): SocialImageRevisionTarget {
  const value = String(instruction || '').trim();
  if (/比例|画布|尺寸|横版|竖版|方图|标题|副标题|说明|文案|文字|字体|字号|字重|行距|字距|底栏|底部栏|角标|信息栏|CTA|UI|caption|headline|text/i.test(value)) return 'typography';
  if (/产品|瓶|包装|套组|组合|主体|product|packag/i.test(value)) return 'product';
  if (/logo|标志|商标|品牌标识/i.test(value)) return 'logo';
  if (/背景|底图|天空|场景|光线|色调|配色|遮罩|蒙版|background|scene|mask/i.test(value)) return 'background';
  return 'full_composite';
}

export function buildSocialImageRevisionPrompt(input: {
  instruction: string;
  target: SocialImageRevisionTarget;
  unitIndex: number;
  unitCount: number;
  exactCanvas: string;
}): string {
  return [
    'Edit the supplied CURRENT OUTPUT; do not redesign it from scratch.',
    `Requested change: ${input.instruction}`,
    `Target layer: ${input.target}. Work unit ${input.unitIndex + 1} of ${input.unitCount}.`,
    `The final canvas is locked to ${input.exactCanvas}.`,
    'Reference image 1 is the current output and is authoritative for every pixel region not named by the requested change.',
    'When present, reference image 2 is the original benchmark and is authoritative for composition, module positions, density, typography hierarchy, and whitespace.',
    'Remaining references are tenant-owned assets and are authoritative for product, package, logo, and brand identity.',
    'Change only the requested target layer. Preserve all other subjects, copy, facts, module coordinates, z-order, scale, crop, palette, lighting, and negative space.',
    'Never invent or alter labels, products, certifications, prices, MOQ, lead time, contacts, flags, or commercial claims.',
    'Keep every product cap/top closure, brand name, core label, and group silhouette visible. Do not cover the main subject with text or UI.',
    'Return exactly one revised finished image with no explanation.',
  ].join('\n');
}
