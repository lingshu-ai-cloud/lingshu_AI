import { reportPresentationLine } from '../../../shared/reportPresentation';
import { useState } from 'react';
import { Button, Collapse, Drawer, Table } from 'antd';
import { BookOpen, CalendarDays, ExternalLink, Lightbulb, Newspaper, ShieldCheck } from 'lucide-react';
import { LsDataChart, chartPalette } from '../ui/LsDataChart';
import { industrySignalHeadline } from '../../../shared/industrySignalHeadline';
import type { ReplySource } from '../../lib/assistantSourceLinks';

interface Signal {
  title: string; category: string; publishedAt: string; fact: string; quote: string; implication: string; action: string; sourceTitle: string; sourceUrl: string; sourceType?: string;
}
export interface IndustryReportMetric { label: string; value: number; unit: string; period: string; kind: 'reported' | 'forecast'; sourceUrl: string; sourceTitle: string; quote: string; basis?: string }
interface Report {
  version: 1; industry: string; market: string; period: string; generatedAt: string; summary: string; signals: Signal[]; limitations: string[]; metrics?: IndustryReportMetric[];
}
const string = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 3000) : '';
const text = (item: Record<string, unknown>, key: string) => string(item[key]);
const reportDate = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }); };

/** Render data, never model-generated markup. Links are restricted to exact retrieved sources. */
export function parseIndustryInsight(raw: string): Report | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data.version !== 1 || !Array.isArray(data.signals)) return null;
    const signals = data.signals.slice(0, 20).flatMap(value => {
      if (!value || typeof value !== 'object') return [];
      const signal = value as Record<string, unknown>;
      const item: Signal = { title: text(signal, 'title'), category: text(signal, 'category') || '其他', publishedAt: text(signal, 'publishedAt'), fact: text(signal, 'fact'), quote: text(signal, 'quote'), implication: text(signal, 'implication'), action: text(signal, 'action'), sourceTitle: text(signal, 'sourceTitle'), sourceUrl: text(signal, 'sourceUrl'), sourceType: text(signal, 'sourceType') };
      return item.title && item.fact ? [item] : [];
    });
    const metrics: IndustryReportMetric[] = Array.isArray(data.metrics) ? data.metrics.slice(0, 30).flatMap(value => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Record<string, unknown>;
      if (typeof item.value !== 'number' || !Number.isFinite(item.value) || !['reported','forecast'].includes(String(item.kind))) return [];
      const metric: IndustryReportMetric = { label:text(item,'label'), value:item.value, unit:text(item,'unit'), period:text(item,'period'), kind:item.kind as 'reported'|'forecast', sourceUrl:text(item,'sourceUrl'), sourceTitle:text(item,'sourceTitle'), quote:text(item,'quote'), basis:text(item,'basis') };
      return metric.label && metric.unit && metric.period && metric.sourceUrl && metric.quote ? [metric] : [];
    }) : [];
    return { version: 1, industry: text(data, 'industry'), market: text(data, 'market'), period: text(data, 'period'), generatedAt: text(data, 'generatedAt'), summary: text(data, 'summary'), signals, metrics, limitations: Array.isArray(data.limitations) ? data.limitations.map(string).filter(Boolean).slice(0, 8) : [] };
  } catch { return null; }
}
function sourceUrl(value: string, sources: ReplySource[]): string | null {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return sources.some(source => { try { return new URL(source.uri).href === url.href; } catch { return false; } }) ? url.href : null;
  } catch { return null; }
}

const metricPeriodLabel = (period: string) => /^\d{4}$/u.test(period) ? `${period}年` : period;
const metricPeriodBasis = (period: string) => /^\d{4}年?$/u.test(period) ? 'year' : /^\d{4}年?第?[一二三四1-4]季度$/u.test(period) ? 'quarter' : /^\d{4}[-年]\d{1,2}月?$/u.test(period) ? 'month' : /^\d{4}-\d{2}-\d{2}$/u.test(period) ? 'day' : period;

export function industryMetricGroups(report: Report, sources: ReplySource[]) {
  const groups = new Map<string, IndustryReportMetric[]>();
  const seen = new Set<string>();
  for (const metric of report.metrics ?? []) {
    const url = sourceUrl(metric.sourceUrl,sources);
    if (!url || !Number.isFinite(metric.value)) continue;
    const key = JSON.stringify([metric.label,metric.unit,url,metric.basis ?? '',metricPeriodBasis(metric.period)]);
    const identity = JSON.stringify([key,metric.period,metric.kind]);
    if (seen.has(identity)) continue;
    seen.add(identity); groups.set(key,[...(groups.get(key) ?? []),metric]);
  }
  return [...groups.values()].map(group => [...group].sort((a,b) => a.period.localeCompare(b.period)));
}

export function IndustryMarketMetrics({ report, sources }: { report: Report; sources: ReplySource[] }) {
  const groups = industryMetricGroups(report,sources);
  if (!groups.length) return null;
  return <section><h2>市场数据</h2>{groups.map((group,index) => <div key={index} className="industry-insight-report__market-chart"><LsDataChart title={`${group[0].label}（${group[0].unit}）`} description={group[0].basis || '数值按来源原始口径展示'} kind="bar" unit={group[0].unit} labels={group.map(metric => `${metricPeriodLabel(metric.period)} · ${metric.kind === 'forecast' ? '预测' : '报告值'}`)} series={[{ label:group[0].label, color:chartPalette[index % chartPalette.length], values:group.map(metric => metric.value) }]} height={240}/><div className="industry-insight-report__metrics">{group.map((metric,i) => <div key={i}><span>{metricPeriodLabel(metric.period)} · {metric.kind === 'forecast' ? '预测' : '报告值'}</span><strong>{metric.value.toLocaleString('zh-CN')}<small>{metric.unit}</small></strong></div>)}</div><a href={sourceUrl(group[0].sourceUrl,sources)!} target="_blank" rel="noopener noreferrer">数据来源：{group[0].sourceTitle || '查看原文'}<ExternalLink size={12}/></a><Collapse size="small" ghost items={[{ key:'evidence',label:'查看数据原文',children:<>{group.map((metric,i) => <blockquote key={i}>{metricPeriodLabel(metric.period)} · {metric.kind === 'forecast' ? '预测' : '报告值'}：{metric.quote}</blockquote>)}</> }]}/></div>)}</section>;
}

export function industryInsightCoverage(report: Report, sources: ReplySource[]) {
  const seen = new Set<string>();
  const signals = report.signals.map(signal => ({ ...signal, title: industryVisibleText(signal.title), fact: industryVisibleText(signal.fact), implication: industryVisibleText(signal.implication), action: industryVisibleText(signal.action), category: industryVisibleText(signal.category), sourceType: industryVisibleText(signal.sourceType || '') })).filter(signal => {
    const url = sourceUrl(signal.sourceUrl, sources);
    if (!url || !signal.fact) return false;
    const key = `${url}::${signal.fact}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const metricCount = industryMetricGroups(report,sources).flat().length;
  const urls = [...new Set([...signals.map(signal => sourceUrl(signal.sourceUrl, sources)!), ...industryMetricGroups(report,sources).flat().map(metric => sourceUrl(metric.sourceUrl,sources)!)])];
  const publishers = new Set(urls.map(url => new URL(url).hostname.replace(/^www\./u, '')));
  const counts = new Map<string, number>();
  for (const signal of signals) counts.set(signal.category, (counts.get(signal.category) || 0) + 1);
  return { signals, metricCount, urls, publishers, categories: [...counts.entries()].sort((a, b) => b[1] - a[1]), focused: publishers.size < 2 };
}

export const industryVisibleText = (value: string) => value.split(/(?<=[。！？!?\n])/u).filter(sentence => {
  if (!reportPresentationLine(sentence)) return false;
  const text = sentence.trim();
  const substantiveCondition = /^(?:若|如果|倘若|当.{1,60}时|在.{1,60}条件下|随着|由于|受.{1,60}影响)/u.test(text);
  const protectivePhrase = /仅供参考|不代表(?:行业|整个行业|市场|全网)|不能据此|不能视为(?:全行业|行业整体).*事实|未经(?:证实|核验)|不足以代表|不代表.*(?:规模|热度|份额)|仅统计.*样本|证据不足|有待进一步(?:核对|核实)/u.test(text);
  const standalone = /^(?:AI|本(?:次|报告|文|分析|结论)|以上|上述|这些|该(?:内容|结论|报告)|仅供|未经|不代表|不能据此|不能视为|不足以代表|关于|图表)/u.test(text);
  return !protectivePhrase || substantiveCondition || !standalone;
}).join('').trim();

const reportSummary = (report: Report, signals: Signal[]) => industryVisibleText(signals.length === report.signals.length ? report.summary : signals.slice(0, 3).map(signal => signal.fact).join(' '));

export function IndustryInsightReportView({ raw, sources = [] }: { raw: string; sources?: ReplySource[] }) {
  const [open, setOpen] = useState(false);
  const report = parseIndustryInsight(raw);
  if (!report) return <p className="rounded-xl border border-border bg-surface p-3 text-sm text-text-secondary">报告正在整理，或数据格式暂不可用。</p>;
  const coverage = industryInsightCoverage(report, sources);
  const hasContent = coverage.signals.length > 0 || coverage.metricCount > 0;
  const title = !hasContent ? '专题观察 · 未形成报告' : '专题观察';
  return <>
    <article className="industry-insight-card" aria-label="行业资讯报告">
      <header><Newspaper size={19} aria-hidden="true"/><div><h3>{report.industry || '行业'} · {report.market || '目标市场'}</h3><p>{title} · {report.period || '按查询范围'}{report.generatedAt ? ` · ${reportDate(report.generatedAt)}` : ''}</p></div></header>
      {coverage.signals.length > 0 && <p className="industry-insight-card__summary">{reportSummary(report,coverage.signals)}</p>}
      {!hasContent && <p className="industry-insight-card__summary" role="status">本次未取得可交付的资讯原文，尚未形成报告。可补充具体主题后重新查询。</p>}
      <div className="industry-insight-card__coverage" aria-label="本次证据覆盖"><span><strong>{coverage.signals.length}</strong> 条核验资讯</span><span><strong>{coverage.urls.length}</strong> 个原文来源</span><span><strong>{coverage.categories.length}</strong> 类信号</span>{coverage.metricCount > 0 && <span><strong>{coverage.metricCount}</strong> 项公开指标</span>}</div>
      <footer><span>{!hasContent ? '未取得可核验原文' : '附数据来源'}</span><Button type="primary" icon={<BookOpen size={14}/>} onClick={() => setOpen(true)} disabled={!hasContent}>阅读完整行业报告</Button></footer>
    </article>
    <Drawer title={`${report.industry || '行业'} · ${title}`} size={typeof window === 'undefined' ? 960 : Math.min(960, window.innerWidth)} open={open} onClose={() => setOpen(false)} destroyOnHidden className="industry-insight-drawer"><IndustryInsightReportContents raw={raw} sources={sources}/></Drawer>
  </>;
}

export function IndustryInsightReportContents({ raw, sources = [] }: { raw: string; sources?: ReplySource[] }) {
  const report = parseIndustryInsight(raw);
  if (!report) return null;
  const { signals, metricCount, urls, publishers, categories } = industryInsightCoverage(report, sources);
  const sourceLink = (signal: Pick<Signal,'sourceUrl'|'sourceTitle'>) => <a href={sourceUrl(signal.sourceUrl, sources)!} target="_blank" rel="noopener noreferrer">{signal.sourceTitle || '查看原文'}<ExternalLink size={12} aria-hidden="true"/></a>;
  return <div className="industry-insight-report">
    <div className="industry-insight-report__scope"><span>观察范围：{report.industry || '行业'} · {report.market || '目标市场'}</span><span>{report.period || '按查询范围'}{report.generatedAt ? ` · 生成于${reportDate(report.generatedAt)}` : ''}</span></div>
    <h1>{report.industry || '行业'} · {!signals.length && !metricCount ? '专题观察 · 未形成报告' : '专题观察'}</h1>
    {signals.length > 0 && reportSummary(report,signals) && <section><h2><Lightbulb size={19}/>核心摘要</h2><p className="industry-insight-report__lead">{reportSummary(report,signals)}</p></section>}
    <section><h2>本次证据覆盖</h2><div className="industry-insight-report__metrics"><div><strong>{signals.length}</strong><span>条核验资讯</span></div><div><strong>{urls.length}</strong><span>篇原文</span></div><div><strong>{publishers.size}</strong><span>个来源网站</span></div><div><strong>{categories.length}</strong><span>类主题</span></div></div>
      {!signals.length && !metricCount && <p className="industry-insight-report__note">本次未取得可交付的资讯原文，尚未形成报告。可补充具体主题后重新查询。</p>}
      {signals.length === 1 && <p className="industry-insight-report__note">重点主题：{signals[0].category}</p>}
      {signals.length > 1 && categories.length > 1 && <LsDataChart title="本次资讯样本分布" description="按主题统计收录资讯条数" kind="bar" horizontal unit="条" labels={categories.map(([category]) => category)} series={[{ label: '核验资讯', color: chartPalette[0], values: categories.map(([, count]) => count) }]} height={Math.max(180, categories.length * 44)}/>}
    </section>
    <IndustryMarketMetrics report={report} sources={sources}/>
    {signals.length > 0 && <section><h2><CalendarDays size={19}/>重点行业信号</h2><ol className="industry-insight-report__timeline">{[...signals].sort((a,b) => b.publishedAt.localeCompare(a.publishedAt)).map((signal,index) => <li key={`${signal.sourceUrl}-${index}`}><div className="industry-insight-report__signal-meta"><time>{signal.publishedAt || '按原文时间'}</time><span>{signal.category}</span>{signal.sourceType && <span>{signal.sourceType}</span>}</div><h3>{industrySignalHeadline(industryVisibleText(signal.fact), signal.title)}</h3><div className="industry-insight-report__fact"><span>已报道事实</span><p>{industryVisibleText(signal.fact)}</p></div>{industryVisibleText(signal.implication) && <div><span className="industry-insight-report__label">业务影响 · 分析</span><p>{industryVisibleText(signal.implication)}</p></div>}{industryVisibleText(signal.action) && <div className="industry-insight-report__action"><span>建议行动</span><p>{industryVisibleText(signal.action)}</p></div>}{signal.quote && <Collapse size="small" ghost items={[{ key:'quote', label:'查看原文摘录', children:<blockquote>{signal.quote}</blockquote> }]}/>}<div className="industry-insight-report__source-link">{sourceLink(signal)}</div></li>)}</ol></section>}
    {signals.some(signal => industryVisibleText(signal.action)) && <section><h2>B2B行动矩阵</h2><Table size="small" pagination={false} scroll={{ x: 640 }} rowKey={row => `${row.sourceUrl}-${row.fact}`} dataSource={signals.filter(signal => industryVisibleText(signal.action))} columns={[
      { title:'行业信号', key:'title', width:180, render:(_,signal) => industrySignalHeadline(industryVisibleText(signal.fact),signal.title) },
      { title:'业务影响', key:'implication', width:220, render:(_,signal) => industryVisibleText(signal.implication) },
      { title:'建议动作', key:'action', width:240, render:(_,signal) => industryVisibleText(signal.action) },
      { title:'依据', key:'source', width:160, render:(_,signal) => sourceLink(signal) },
    ]}/></section>}
    {urls.length > 0 && <section><h2><ShieldCheck size={19}/>来源依据</h2><ol className="industry-insight-report__sources">{urls.map(url => {const source=signals.find(item => sourceUrl(item.sourceUrl,sources)===url) ?? industryMetricGroups(report,sources).flat().find(item => sourceUrl(item.sourceUrl,sources)===url)!;return <li key={url}>{sourceLink(source)}<p>{'publishedAt' in source ? source.publishedAt : source.period}</p></li>;})}</ol></section>}
    <footer className="industry-insight-report__limits"><p>AI结论仅供参考</p></footer>
  </div>;
}
