import { z } from 'zod';

export const customerTagDimensions = ['profile', 'need', 'signal', 'risk'] as const;
export type CustomerTagDimension = typeof customerTagDimensions[number];
export const customerTagDimensionLabels: Record<CustomerTagDimension, string> = {
  profile: '客户属性', need: '产品需求', signal: '采购信号', risk: '风险关注',
};
export const customerTagCorrectionInput = z.strictObject({
  tag: z.string().trim().min(1).max(100), replacement: z.string().trim().min(1).max(100).nullable(),
  dimension: z.enum(customerTagDimensions), reason: z.string().trim().min(1).max(500),
  expectedUpdatedAt: z.string().nullable(),
});
export type CustomerTagCorrectionInput = z.infer<typeof customerTagCorrectionInput>;
export type CustomerTagCorrection = Omit<CustomerTagCorrectionInput, 'tag' | 'expectedUpdatedAt'> & {
  tag: string; updatedAt: string; evidence?: Array<{ messageId: string; excerpt: string }>;
};
export function protectedCustomerTag(tag: string) {
  return /黑名单|退订|拒收|勿扰|不要联系|do not contact|unsubscribe|opt.?out|blacklist/i.test(tag);
}
export function readTagCorrections(value: unknown): CustomerTagCorrection[] {
  const schema = customerTagCorrectionInput.omit({ expectedUpdatedAt: true }).extend({ updatedAt: z.string().datetime(), evidence: z.array(z.strictObject({messageId:z.string().max(200),excerpt:z.string().max(500)})).max(10).optional() });
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => { const r = schema.safeParse(item); return r.success ? [r.data] : []; });
}
export function applyTagCorrections(tags: string[], corrections: CustomerTagCorrection[]): string[] {
  const map = new Map(corrections.map(c => [c.tag, c]));
  const result = tags.flatMap(tag => {
    const correction = map.get(tag);
    return protectedCustomerTag(tag) || !correction ? [tag] : correction.replacement ? [correction.replacement] : [];
  });
  for (const c of corrections) if (!protectedCustomerTag(c.tag) && c.replacement) result.push(c.replacement);
  return [...new Set(result)];
}
export function correctCustomerTag(tags: string[], prior: CustomerTagCorrection[], input: CustomerTagCorrectionInput, updatedAt: string, evidence: Array<{tag:string;messageId:string;excerpt:string}> = []) {
  const old = prior.find(c => c.tag === input.tag);
  if (protectedCustomerTag(input.tag) || input.replacement && protectedCustomerTag(input.replacement)) throw Error('customer_tag_permission_separate');
  if (!tags.includes(input.tag) && !old) throw Error('customer_tag_not_found');
  if ((old?.updatedAt || null) !== input.expectedUpdatedAt) throw Error('customer_tag_correction_conflict');
  const { expectedUpdatedAt: _, ...value } = input;
  const originalEvidence = old?.evidence || evidence.filter(e => e.tag === input.tag).slice(0,10).map(e => ({messageId:e.messageId,excerpt:e.excerpt.slice(0,500)}));
  const corrections = [...prior.filter(c => c.tag !== input.tag), { ...value, updatedAt, evidence: originalEvidence }];
  // Remove the previous human replacement when revising the same correction.
  return { contextTagCorrections: corrections, tags: applyTagCorrections(tags.filter(t => t !== old?.replacement), corrections) };
}
