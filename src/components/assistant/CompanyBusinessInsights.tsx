import { Collapse } from 'antd';
import { ArrowUpRight, Building2, Handshake, Lightbulb, Package, Route, Search } from 'lucide-react';
import { reportPresentationText } from '../../../shared/reportPresentation';
import type { CompanyReport } from '../../../shared/contracts/companyReport';
import { CompanyReportCharts, CompanyOperatingHighlights } from './CompanyReportCharts';
import CompanyReportBrandMedia from './CompanyReportBrandMedia';
import './companyBusinessInsights.css';

const categories = {
  product: { label: '产品与品牌', Icon: Package }, partnership: { label: '合作与能力建设', Icon: Handshake },
  channel: { label: '渠道布局', Icon: Route }, 'supply-chain': { label: '供应链建设', Icon: Building2 },
  overseas: { label: '海外市场', Icon: Route }, research: { label: '研发创新', Icon: Search },
};
export function companyInsightSafeUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.searchParams.has('token') ? url.href : null; } catch { return null; }
}
const date = (value: string) => !Number.isFinite(Date.parse(value)) ? '—' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));

export function CompanyInsightScope({ report }: { report: CompanyReport }) {
  return <div className="company-insight__scope" aria-label="报告时间口径"><div><span>财务基准</span><strong>{report.period}</strong></div>{report.businessInsights && <div><span>公开动态观察期</span><strong>{date(report.businessInsights.observationPeriod.from)} — {date(report.businessInsights.observationPeriod.to)}</strong></div>}<div><span>生成日期</span><strong>{date(report.generatedAt)}</strong></div></div>;
}

export default function CompanyBusinessInsights({ report }: { report: CompanyReport }) {
  const insight = report.businessInsights;
  if (!insight || insight.status !== 'ready') return null;
  const sources = insight.sources.filter(source => companyInsightSafeUrl(source.url));
  const sourceIds = new Set(sources.map(source => source.id));
  const events = insight.events.map(event => ({ ...event, title: reportPresentationText(event.title), summary: reportPresentationText(event.summary) })).filter(event => event.title && event.summary && event.sourceIds.some(id => sourceIds.has(id)));
  const financialIds = new Set(report.evidence.map(item => item.id));
  const supported = (item: { sourceIds: string[]; financialEvidenceIds: string[] }) => item.sourceIds.some(id => sourceIds.has(id)) && item.financialEvidenceIds.some(id => financialIds.has(id));
  const judgments = insight.judgments.map(item => ({ ...item, title: reportPresentationText(item.title), text: reportPresentationText(item.text) })).filter(item => item.title && item.text && supported(item));
  const actions = insight.actions.map(item => ({ ...item, text: reportPresentationText(item.text), verifyWith: reportPresentationText(item.verifyWith) })).filter(item => item.text && supported(item));
  const links = (ids: string[], financialEvidenceIds: string[] = []) => <div className="company-insight__references">
    {ids.map(id => sources.find(source => source.id === id)).filter(Boolean).map(source => <a key={source!.id} href={companyInsightSafeUrl(source!.url)!} target="_blank" rel="noopener noreferrer">{source!.title}<ArrowUpRight size={12}/></a>)}
    {financialEvidenceIds.map(id => report.evidence.find(item => item.id === id)).filter(Boolean).map(item => <a key={item!.id} href={`${report.source.url}#page=${item!.page}`} target="_blank" rel="noopener noreferrer">财报第{item!.page}页<ArrowUpRight size={12}/></a>)}
  </div>;
  return <div className="company-report company-insight">
    <CompanyInsightScope report={report}/>
    <h1>{report.company}企业经营洞察</h1>
    {judgments.length > 0 && <section className="company-report__conclusion"><h2><Lightbulb size={19}/>核心经营判断</h2><div className="company-insight__judgments">{judgments.map((item, index) => <article key={item.title}><span className="company-insight__eyebrow">分析判断 · {String(index + 1).padStart(2, '0')}</span><h3>{item.title}</h3><p>{item.text}</p>{links(item.sourceIds, item.financialEvidenceIds)}</article>)}</div></section>}
    <section><h2>经营基本盘</h2><CompanyOperatingHighlights report={report}/><CompanyReportCharts report={report}/><p className="company-report__meta">财务数据来自{report.period}财报；近期业务动作不作为该期间收入或利润的证明。</p></section>
    {events.length > 0 && <section><h2>战略与业务动作</h2><p className="company-report__meta">以下为观察期内已发布的企业动作，按事件日期排列。宣布合作不等同于完成实施或产生收入。</p><ol className="company-insight__timeline">{[...events].sort((a, b) => b.date.localeCompare(a.date)).map(event => {
      const { label, Icon } = categories[event.category];
      return <li key={event.id}><div className="company-insight__event-mark"><Icon size={17}/></div><article><div className="company-insight__event-meta"><time dateTime={event.date}>{date(event.date)}</time><span>{label} · 已报道事实</span></div><h3>{event.title}</h3><p>{event.summary}</p><CompanyReportBrandMedia companyId={report.companyId} text={`${event.title} ${event.summary}`}/><Collapse size="small" ghost className="company-report__evidence" items={[{ key: event.id, label: '查看原文摘录', children: <blockquote>{event.quote}</blockquote> }]}/>{links(event.sourceIds)}</article></li>;
    })}</ol></section>}
    {actions.length > 0 && <section><h2>B2B经营行动启示</h2><div className="company-insight__actions">{actions.map((action, index) => <article key={`${action.audience}-${index}`}><span className="company-insight__eyebrow">行动建议 · {action.audience}</span><h3>{action.text}</h3>{action.verifyWith && <p><strong>执行前准备与核实：</strong>{action.verifyWith}</p>}{links(action.sourceIds, action.financialEvidenceIds)}</article>)}</div></section>}
    <section className="company-report__limits"><h2>公开信息来源</h2><p>收录{sources.length}篇可读取公开资料；企业发布反映其披露立场，分析判断与行动建议已分别标注。</p>{sources.map(source => <article className="company-report__source" key={source.id}><a href={companyInsightSafeUrl(source.url)!} target="_blank" rel="noopener noreferrer">{source.title}<ArrowUpRight size={12}/></a><p>{date(source.publishedAt)} · {source.excerpt}</p></article>)}</section>
  </div>;
}
