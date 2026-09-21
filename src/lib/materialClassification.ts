import type { SocialContentThemeId } from '../../shared/contracts/socialContentWorkflow';

export type MaterialClassificationInput = {
  industry?: string;
  shotFunction?: string;
  tags?: string;
  visualObservations?: string[];
  segments?: Array<{
    action?: string;
    environment?: string;
    subject?: string[];
    recommendedFunctions?: string[];
    productVisible?: boolean;
    productClarity?: string;
  }>;
};

export type MaterialThemeBucket = SocialContentThemeId | 'unclassified';

export function materialIndustryKey(material: Pick<MaterialClassificationInput, 'industry'>): string {
  const value = String(material.industry || '').trim().toLowerCase();
  if (!value) return 'unclassified';
  if (/美妆|护肤|化妆|beauty|cosmetic|skincare/.test(value)) return 'beauty_skincare';
  if (/服装|纺织|apparel|textile/.test(value)) return 'apparel_textile';
  if (/金属|五金|机加|metal|machin/.test(value)) return 'metalworking';
  if (/制造|工厂|工业|manufactur|factory|industrial/.test(value)) return 'universal_manufacturing';
  return 'other';
}

/**
 * Return one primary content theme based only on visual/shot metadata.
 * Product ownership and long applicability disclaimers are deliberately not
 * classification evidence: a factory clip mentioning “产品” in a legal note
 * must never appear under product close-ups.
 */
export function materialThemeBucket(material: MaterialClassificationInput): MaterialThemeBucket {
  const segments = material.segments || [];
  const functions = [
    material.shotFunction,
    ...segments.flatMap(segment => segment.recommendedFunctions || []),
  ].filter(Boolean).join(' ').toLowerCase();
  const visual = [
    material.tags,
    ...(material.visualObservations || []),
    ...segments.flatMap(segment => [segment.action, segment.environment, ...(segment.subject || [])]),
  ].filter(Boolean).join(' ').toLowerCase();
  const combined = `${functions} ${visual}`;

  if (/customer[_ -]?case|客户案例|客户反馈|复购|合作成果|交付成果/.test(combined)) return 'customer_case';
  if (/application|treatment_experience|usage_setup|使用场景|使用过程|涂抹|护理体验|上脸|实操体验/.test(combined)) return 'scenario_solution';
  if (/product_demo|texture_demo|ingredient_visual|产品特写|成品特写|瓶身特写|包装特写|质地展示|膏体|精华液滴|配方成分/.test(combined)
    || segments.some(segment => segment.productVisible && ['high', 'medium'].includes(String(segment.productClarity)))) return 'product_value';
  if (/production|manufacturing_process|packaging|定制|打样|配方研发|灌装|旋盖|贴标|包装|生产流程|加工过程|出货准备/.test(combined)) return 'customization_process';
  if (/factory_proof|factory_exterior|equipment_demo|worker_operation|quality_control|warehouse|logistics_fulfillment|工厂|车间|产线|设备|质检|仓储|物流|研发团队|生产能力/.test(combined)) return 'supplier_capability';
  return 'unclassified';
}
