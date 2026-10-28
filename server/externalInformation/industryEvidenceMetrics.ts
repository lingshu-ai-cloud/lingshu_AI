import { z } from 'zod';
import type { SearchOriginal } from './searchEvidenceAnswer.js';
export type IndustryMetric = { label: string; period: string; value: number; unit: string; kind: 'reported' | 'forecast'; sourceUrl: string; sourceTitle: string; quote: string };
export const industryMetricCandidateSchema = z.object({ label: z.string().min(2).max(80), period: z.string().regex(/^20\d{2}$/u), value: z.number().finite().nonnegative().max(1e18), unit: z.string().min(1).max(30), kind: z.enum(['reported', 'forecast']), sourceId: z.string(), quoteId: z.string() }).strict();
type Candidate = z.infer<typeof industryMetricCandidateSchema>;
type Quote = { id: string; text: string };
const compact = (text: string) => text.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
const forecast = /预计|预测|预期|估计|估算|有望|forecast|projected|expected|estimated/iu;
/** Bind each amount to its own preceding year and local clause, never another comparison year's figure. */
function observations(quote: string) {
  const result: Array<Pick<IndustryMetric, 'period' | 'value' | 'unit' | 'kind'> & { context: string }> = [];
  const pattern = /(20\d{2})\s*年?([^。；;！？\n\d]{0,100}?)(\d[\d,]*(?:\.\d+)?)\s*(亿美元|亿元人民币|亿元|万元人民币|万元|百万美元|亿美元|美元|billion\s+USD|million\s+USD)/giu;
  for (const match of quote.matchAll(pattern)) {
    const period = match[1], value = Number(match[3].replaceAll(',', '')), unit = match[4];
    const before = quote.slice(0, match.index);
    const boundary = Math.max(before.lastIndexOf('，'), before.lastIndexOf(','), before.lastIndexOf('；'), before.lastIndexOf(';'));
    const local = quote.slice(boundary + 1, match.index + match[0].length);
    if (Number.isFinite(value)) result.push({ period, value, unit, kind: forecast.test(local) ? 'forecast' : 'reported', context: local });
  }
  return result;
}
/** Preserve the market object explicitly named by the source instead of labelling every monetary series alike. */
function metricMarketLabel(candidate: string, quote: string, original: SearchOriginal, context: string): string {
  const subject = (text: string) => {
    const normalized = text.normalize('NFKC').replace(/\s+/gu, '');
    const geographic = normalized.match(/((?:全球|中国|美国|欧洲|亚太|国内|国际|日本|韩国)(?!市场)[\p{L}A-Za-z/&-]{1,32}?)(?:市场(?:规模|销售额)?|规模)/u)?.[1];
    const named = normalized.match(/((?:化妆品|美妆|个人护理|个护|护肤|彩妆)(?:原料|包装|包材|代工服务|OEM\/ODM|OEM|ODM)?)(?:市场(?:规模|销售额)?|规模)/iu)?.[1];
    return geographic ?? named;
  };
  const market = subject(context) ?? subject(quote) ?? subject(original.source.title);
  return market ? `${market}市场规模` : compact(quote).includes(compact(candidate)) ? candidate : '市场规模';
}
/** Canonical validation of model candidates or replay data against already-read original sentences. */
export function validateIndustryMetrics(candidates: unknown[], originals: SearchOriginal[], quotes: Map<string, Quote[]>): IndustryMetric[] {
  const result: IndustryMetric[] = [], seen = new Set<string>();
  for (const input of candidates.slice(0, 24)) {
    const candidate = industryMetricCandidateSchema.safeParse(input); if (!candidate.success) continue;
    const item = candidate.data, original = originals.find(original => original.id === item.sourceId);
    const quote = quotes.get(item.sourceId)?.find(quote => quote.id === item.quoteId)?.text;
    if (!original || !quote || !compact(original.text).includes(compact(quote))) continue;
    const observation = observations(quote).find(value => value.period === item.period && value.value === item.value && compact(value.unit) === compact(item.unit) && value.kind === item.kind);
    if (!observation || !/市场规模|market\s+size/iu.test(quote)) continue;
    // Do not let a translated or invented geography in a model label redefine the source's market.
    const label = metricMarketLabel(item.label, quote, original, observation.context);
    const key = [original.source.uri, label, item.period, item.value, compact(item.unit), item.kind].join(':');
    if (seen.has(key)) continue; seen.add(key);
    result.push({ label, period: item.period, value: item.value, unit: item.unit, kind: item.kind, sourceUrl: original.source.uri, sourceTitle: original.source.title, quote: quote.slice(0, 600) });
  }
  return result;
}
/** No model call: recover explicitly stated market-size figures from already-read source sentences. */
export function extractIndustryMetrics(originals: SearchOriginal[]): IndustryMetric[] {
  const candidates: Candidate[] = [], quotes = new Map<string, Quote[]>();
  for (const original of originals) {
    const sentences = (original.text.match(/[^。！？\n]+[。！？]?/gu) ?? []).filter(sentence => /市场规模|market\s+size/iu.test(sentence));
    const entries = sentences.filter(sentence => sentence.length <= 600).map((text, index) => ({ id: `${original.id}-M${index + 1}`, text })); quotes.set(original.id, entries);
    for (const quote of entries) for (const observation of observations(quote.text)) { const { context: _context, ...values } = observation; candidates.push({ ...values, label: '市场规模', sourceId: original.id, quoteId: quote.id }); }
  }
  return validateIndustryMetrics(candidates, originals, quotes);
}
