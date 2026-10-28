import type { DailyNewsWindow } from './dailyNewsWindow.js';
import type { IndustryMetric } from './industryEvidenceMetrics.js';
import { industrySignalHeadline } from '../../shared/industrySignalHeadline.js';
/** Structured presentation of verified source material; counts describe this sample only. */
export type IndustrySignal = {
  title: string; category: string; publishedAt: string; fact: string; implication: string; action: string;
  sourceTitle: string; sourceUrl: string; quote: string; sourceType?: string;
};

/** Attribute public material by content type without excluding accessible research or commentary. */
export function industrySourceType(text: string): string {
  const body = text.normalize('NFKC');
  const generatedDisclosure = /(?:本文|本文章|文章|本内容|该内容|本报道|该文章)[^，。；;,:：\n]{0,10}(?:由|系|使用|采用)[^，。；;,:：\n]{0,20}(?:AI|人工智能|人工智慧)[^，。；;,:：\n]{0,20}(?:生成|撰写|创作)/iu.test(body)
    || /\b(?:this\s+(?:article|content|report)|the\s+article)\s+(?:was\s+|is\s+)?(?:generated|written|created)\s+(?:by|using|with)\s+(?:AI|artificial intelligence)\b/iu.test(body);
  if (generatedDisclosure) return 'AI整理内容';
  const summary = /报告(?:内容)?摘要|报告简介|报告概述|report\s+(?:summary|preview|overview)/iu.test(body);
  const contents = /报告目录|目录章节|章节目录|table\s+of\s+contents/iu.test(body);
  const previewSale = /以(?:最终|正式|完整).{0,6}报告为准|订购(?:报告|咨询)|购买(?:报告|完整版)|订阅报告|(?:order|purchase)\s+(?:(?:this|the)\s+)?report/iu.test(body);
  if (summary && contents && previewSale) return '商业研究报告';
  if (/研究摘要|研究方法|对照试验|研究结果|methodology|research findings/iu.test(body)) return '研究资料';
  if (/官网公告|公司公告|企业披露|官方发布|press release/iu.test(body)) return '企业披露';
  if (/采访|媒体报道|记者|独立报道|reported by|interview/iu.test(body)) return '媒体报道';
  return '公开资料';
}

export function industrySignalCategory(text: string): string {
  if (/法规|监管|条例|合规|regulation|regulatory|legislation/iu.test(text)) return '法规与合规';
  if (/供应链|产能|生产基地|供应保障|supply chain|manufacturing capacity/iu.test(text)) return '供应链';
  if (/研发|技术|配方|原料|成分|innovation|ingredient|formulation/iu.test(text)) return '产品与技术';
  if (/收购|并购|合作|竞争|acquisition|partnership/iu.test(text)) return '企业动态';
  return '其他动态';
}


const compact = (text: string) => text.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
export function deduplicateIndustrySignals(signals: IndustrySignal[]): IndustrySignal[] {
  const urls = new Set<string>(), facts = new Set<string>(), quotes = new Set<string>();
  return signals.filter(signal => {
    let url: URL;
    try { url = new URL(signal.sourceUrl); } catch { return false; }
    if (url.protocol !== 'https:' || url.username || url.password || !signal.fact.trim() || !signal.quote.trim()) return false;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_|fbclid$|gclid$)/iu.test(key)) url.searchParams.delete(key);
    const fact = compact(signal.fact), quote = compact(signal.quote);
    if (urls.has(url.href) || facts.has(fact) || quotes.has(quote)) return false;
    urls.add(url.href); facts.add(fact); quotes.add(quote); return true;
  });
}

export function industryInsightScope(question: string): { industry: string; market: string } {
  const industry = [...question.matchAll(/(?:^|[。；;\n，,：:])(?:行业|品类)[：:]\s*([^，,。；;\n：:]{1,60})/gu)].at(-1)?.[1]?.trim() ?? '';
  const market = question.match(/(?:目标市场|市场)[：:]\s*([^，,。；;\n：:]{1,60})/u)?.[1]?.trim() ?? '';
  let defaults: Record<string, unknown> = {};
  try { defaults = JSON.parse(question.match(/已明确的查询范围[：:]\s*(\{[^\n]*?\})/u)?.[1] ?? '{}'); } catch { /* An invalid scope cannot supply invented defaults. */ }
  const value = (input: unknown) => typeof input === 'string' && !/以用户本轮指定为准/u.test(input) ? input.trim().slice(0, 120) : '';
  return { industry: industry || value(defaults.industry) || value(defaults.products), market: market || value(defaults.market) };
}

/** The introduction only summarizes accepted items; rejected search candidates cannot leak into it. */
export function industryInsightSummary(signals: IndustrySignal[]): string {
  const selected = deduplicateIndustrySignals(signals);
  if (!selected.length) return '暂无可展示的专题资料。';
  const headlines = selected.slice(0, 3).map(signal => industrySignalHeadline(signal.fact, signal.title));
  const opening = '专题观察重点';
  return `${opening}：${headlines.join('；')}。${selected[0].implication ? `经营关注：${selected[0].implication}` : ''}`;
}

export function industryInsightBlock(question: string, signals: IndustrySignal[], summary: string, _rejected: number, days?: number, metrics: IndustryMetric[] = [], dailyWindow?:DailyNewsWindow): string {
  const { industry, market } = industryInsightScope(question);
  const selected = deduplicateIndustrySignals(signals);
  const limitations = ['AI结论仅供参考'];
  const asOf = dailyWindow ? new Intl.DateTimeFormat('sv-SE',{timeZone:dailyWindow.timeZone,dateStyle:'short',timeStyle:'short',hour12:false}).format(new Date(dailyWindow.cutoff)) : '';
  const observedSummary = dailyWindow ? `截至${asOf}（Asia/Shanghai），实际收录${dailyWindow.day}当天发布的${selected.length}条资讯、${new Set(selected.map(signal=>new URL(signal.sourceUrl).hostname.replace(/^www\./u,''))).size}个发布方。${summary}` : summary;
  const report = { version: 1, title: '专题观察', industry, market, period: dailyWindow ? `${dailyWindow.day}（Asia/Shanghai当天）` : days ? `最近${days}天` : '按查询范围', generatedAt: new Date().toISOString(), summary:observedSummary,
    signals: selected.map(signal => ({ ...signal, sourceType: signal.sourceType || industrySourceType(signal.sourceTitle + ' ' + signal.quote), title: industrySignalHeadline(signal.fact, signal.title) })), ...(metrics.length ? { metrics } : {}), limitations };
  // Fence delimiters cannot be supplied by an untrusted title, URL or model output.
  return '```industry-insight\n' + JSON.stringify(report).replace(/`/gu, '\\u0060') + '\n```';
}
