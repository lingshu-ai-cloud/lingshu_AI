import type { SalesConversationEvent } from './conversationEvents.js';
import type { SalesEvidenceField, SalesIntentSignal, SalesIntentType } from './conversationState.js';
import type { BantAssessment } from './qualification.js';

export interface ExtractedBuyerSignals {
  intents: SalesIntentSignal[];
  evidence: Array<{ key: string; field: SalesEvidenceField }>;
}

const INTENT_RULES: Array<{ type: SalesIntentType; pattern: RegExp }> = [
  { type: 'product_discovery', pattern: /what do you sell|which products?|catalog(?:ue)?|有哪些产品|产品目录|qué productos|catálogo|ما المنتجات/i },
  { type: 'requirements_clarification', pattern: /need|looking for|require|spec(?:ification)?|需要|规格|需求|necesit|requer|نحتاج|مواصفات/i },
  { type: 'capability_validation', pattern: /can you (?:make|do|support|custom)|private label|oem|odm|certificate|certification|能做|支持定制|贴牌|认证|pueden|certific|هل يمكنكم|شهادة/i },
  { type: 'sample_request', pattern: /sample|prototype|样品|打样|muestra|عينة/i },
  { type: 'quotation_request', pattern: /price|quote|quotation|best price|discount|报价|价格|折扣|precio|cotiz|descuento|السعر|عرض سعر|خصم/i },
  { type: 'price_negotiation', pattern: /cheaper|discount|match (?:the )?price|too expensive|便宜|折扣|太贵|más barato|descuento|أرخص|خصم/i },
  { type: 'payment_delivery', pattern: /payment|\bpay\b|deposit|lead time|delivery|ship(?:ping)?|\bpi\b|\bpo\b|procurement|付款|定金|交期|发货|形式发票|采购流程|pago|entrega|cotiz|دفع|تسليم/i },
  { type: 'complaint_claim', pattern: /complaint|refund|damaged|broken|compensation|投诉|退款|损坏|赔偿|queja|reembolso|شكوى|تعويض/i },
  { type: 'human_contact_request', pattern: /call me|phone call|talk to (?:a )?(?:manager|person)|human|人工|(?:打|安排|直接).{0,8}电话|(?:找|让|转).{0,8}经理|llamada|(?:hablar|llamar).{0,20}gerente|اتصال|(?:تحدث|اتصل).{0,20}مدير/i },
];

function makeField(
  value: string | number | boolean,
  sourceEventId: string,
  occurredAt: number,
  confidence: number,
  valueRole: NonNullable<SalesEvidenceField['valueRole']> = 'buyer_statement',
): SalesEvidenceField {
  const updatedAt = new Date(occurredAt).toISOString();
  return {
    value,
    status: 'claimed',
    confidence,
    sourceEventIds: [sourceEventId],
    extractor: 'deterministic_sales_signal_v1',
    valueRole,
    history: [{ value, status: 'claimed', sourceEventId, actor: 'buyer', occurredAt: updatedAt }],
    updatedAt,
  };
}

function normalizedText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function extractBuyerSalesSignals(body: string, sourceEventId: string, occurredAt: number): ExtractedBuyerSignals {
  const text = normalizedText(body);
  const updatedAt = new Date(occurredAt).toISOString();
  const intents = INTENT_RULES
    .filter(rule => rule.pattern.test(text))
    .map(rule => ({ type: rule.type, confidence: 0.9, sourceEventIds: [sourceEventId], updatedAt }));
  const evidence: ExtractedBuyerSignals['evidence'] = [];
  const seen = new Set<string>();
  const add = (key: string, field: SalesEvidenceField) => {
    if (seen.has(key)) return;
    seen.add(key);
    evidence.push({ key, field });
  };

  const quantity = text.match(/\b\d[\d,]*(?:\.\d+)?\s*(?:pcs?|pieces?|units?|sets?|bottles?|boxes?|cartons?|lines?|kg|tons?|条线|件|套|个|箱|قطعة|وحدة)/i)?.[0];
  if (quantity) add('quantity', makeField(quantity, sourceEventId, occurredAt, 0.98));

  const market = text.match(/(?:dubai|uae|united arab emirates|saudi arabia|ksa|qatar|kuwait|oman|bahrain|usa|united states|uk|united kingdom|germany|france|spain|italy|m[eé]xico|brazil|indonesia|vietnam|thailand|india|利雅得|迪拜|沙特|阿联酋|美国|英国|德国|法国|墨西哥|巴西|印度尼西亚|越南|泰国|印度|السعودية|للسعودية|الإمارات|للإمارات)/i)?.[0];
  if (market) add('target_market', makeField(market, sourceEventId, occurredAt, 0.95));

  const timing = text.match(/\b(?:today|tomorrow|this week|next week|this month|next month|monday|tuesday|wednesday|thursday|friday|q[1-4]|\d{4}-\d{1,2}-\d{1,2})\b|今天|明天|本周|下周|本月|下个月|这个季度|下季度|lunes|martes|miércoles|jueves|viernes|هذا الشهر|الأسبوع القادم/i)?.[0];
  if (timing) add('key_event_timing', makeField(timing, sourceEventId, occurredAt, 0.9));

  if (/budget (?:is )?approved|budget approved|预算(?:已经|已)?批准|预算已立项|presupuesto aprobado|الميزانية معتمدة/i.test(text)) {
    add('budget_status', makeField('approved', sourceEventId, occurredAt, 0.97, 'transaction_fact'));
  }
  const decisionRole = text.match(/\b(?:ceo|coo|owner|founder|general manager|procurement manager|procurement team|purchase manager|quality manager|operations manager)\b|总经理|老板|采购经理|质量经理|运营经理|director general|gerente de compras|gerente de calidad|equipo de compras|مدير العمليات|المدير العام/i)?.[0];
  if (decisionRole) add('decision_maker', makeField(decisionRole, sourceEventId, occurredAt, 0.93));

  const competitor = text.match(/(?:another|other) supplier[^.!?。！？]{0,100}|其他供应商[^。！？]{0,100}|另一家供应商[^。！？]{0,100}|otro proveedor[^.!?]{0,100}|مورد آخر[^.!?]{0,100}/i)?.[0];
  if (competitor) add('competition', makeField(competitor, sourceEventId, occurredAt, 0.91));

  const pain = text.match(/[^.!?。！？]{0,80}(?:slow|too expensive|delay|problem|bottleneck|difficult|waste|damaged|broken|慢|太贵|延误|问题|瓶颈|困难|浪费|损坏|lento|problema|difícil|dañado|بطيء|مشكلة|تالف)[^.!?。！？]{0,100}/i)?.[0]?.trim();
  if (pain) add('pain_point', makeField(pain, sourceEventId, occurredAt, 0.82));

  const goal = text.match(/[^.!?。！？]{0,80}(?:want to|plan to|goal is|希望|计划|目标|queremos|planeamos|نريد|نخطط)[^.!?。！？]{0,120}/i)?.[0]?.trim();
  if (goal) add('business_goal', makeField(goal, sourceEventId, occurredAt, 0.82));

  const criteria = text.match(/[^.!?。！？]{0,80}(?:must|important|priority|acceptance|criteria|guaranteed|必须|重要|优先|验收|标准|保证|debe|importante|criterio|aceptación|garantiz|يجب|مهم|مضمون)[^.!?。！？]{0,120}/i)?.[0]?.trim();
  if (criteria) add('decision_criteria', makeField(criteria, sourceEventId, occurredAt, 0.8));

  const certification = text.match(/\b(?:ce|fda|ul|rohs|reach|iso\s?\d*)\b/i)?.[0];
  if (certification && /need|require|must|do you have|有没有|需要|要求|tienen|necesit|هل لديكم|نحتاج/i.test(text)) {
    // Buyer requirements are intentionally stored separately from seller capabilities.
    add('requirements.certification', makeField(certification.toUpperCase(), sourceEventId, occurredAt, 0.97, 'buyer_requirement'));
  }

  if (!intents.length && evidence.length) intents.push({ type: 'requirements_clarification', confidence: 0.72, sourceEventIds: [sourceEventId], updatedAt });
  return { intents, evidence };
}

export function buyerSignalEvents(body: string, sourceEventId: string, occurredAt: number): SalesConversationEvent[] {
  const extracted = extractBuyerSalesSignals(body, sourceEventId, occurredAt);
  const events: SalesConversationEvent[] = [];
  if (extracted.intents.length) {
    events.push({ id: `intent:${sourceEventId}`, type: 'intents_detected', source: 'system', occurredAt, intents: extracted.intents });
  }
  extracted.evidence.forEach(({ key, field }) => events.push({
    id: `evidence:${sourceEventId}:${key}`,
    type: 'evidence_observed',
    source: 'system',
    occurredAt,
    key,
    field,
  }));
  return events;
}

export function qualificationEvidenceEvents(
  assessment: BantAssessment,
  sourceEventId: string,
  occurredAt: number,
): SalesConversationEvent[] {
  const dimensions = [
    ['bant.budget', assessment.budget],
    ['bant.authority', assessment.authority],
    ['bant.need', assessment.need],
    ['bant.timing', assessment.timing],
  ] as const;
  const stableHash = (value: string) => {
    let hash = 2166136261;
    for (const char of value.normalize('NFKC').toLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return (hash >>> 0).toString(36);
  };
  return dimensions.flatMap(([dimensionKey, dimension]) => {
    if (!dimension.evidence.length) return [];
    return dimension.evidence.map(value => {
      const key = `${dimensionKey}.${stableHash(value)}`;
      const field = makeField(value, sourceEventId, occurredAt, Math.min(0.95, 0.55 + dimension.score / 100));
      field.extractor = 'bant_compatibility_projection_v1';
      return {
        id: `evidence:${sourceEventId}:${key}`,
        type: 'evidence_observed' as const,
        source: 'system' as const,
        occurredAt,
        key,
        field,
      };
    });
  });
}
