// A visual index is not evidence of composition, performance or hidden causes.
const unverifiableClaim = /疑似|可能|无法确认|水滴|液滴|液体|油污|腐蚀|认证|耐压|防水|导电率|合格率|铜制|铝制|钢制|非水滴/;
export function groundedMaterialFacts(values: string[]) {
  return {facts:values.filter(value=>!unverifiableClaim.test(value)),review:values.filter(value=>unverifiableClaim.test(value))};
}
/** Material footage may be one continuous take. Do not impose reference-video shot density. */
export function normalizeMaterialObservations(id: string, duration: number, raw: unknown): Array<Record<string, unknown>> {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).segments)) throw Error('素材分析没有返回可用时间区间');
  let previousEnd = 0;
  return (raw as any).segments.map((item: any, index: number) => {
    const start = Number(item.start), end = Number(item.end), confidence = Number(item.confidence);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < previousEnd - .05 || start < 0 || end <= start || end > duration + .05) throw Error('素材分析时间区间无效，请重试分析');
    previousEnd = end;
    const observedFacts = (Array.isArray(item.observedFacts) ? item.observedFacts : []).filter((value: unknown): value is string => typeof value === 'string' && !!value.trim()).slice(0,12);
    if (!observedFacts.length) throw Error('素材分析缺少可见事实');
    const grounded = groundedMaterialFacts(observedFacts);
    const score = Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0;
    return { id: `${id}-segment-${index + 1}`, start, end: Math.min(end,duration), duration: end-start,
      subject: Array.isArray(item.subject) ? item.subject.filter((value: unknown) => typeof value === 'string').slice(0,8) : [],
      action: String(item.action || ''), shot: String(item.shot || ''), camera: String(item.camera || ''), environment: String(item.environment || ''),
      observedFacts: grounded.facts, excludedObservations: grounded.review, visual: grounded.facts.join('；'), confidence: score, needsReview: item.needsReview !== false || score < .65 || !grounded.facts.length,
      recommendedFunctions: ['detail'], productVisible: false, productClarity: 'none', ocrText: '', angle: '', composition: '', quality: Math.round(score * 100), hasPerson: false, hasLogo: false, logoText: [], authenticity: '原始素材视觉分析',
    };
  });
}
