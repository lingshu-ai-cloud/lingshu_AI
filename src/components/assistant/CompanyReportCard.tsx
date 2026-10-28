import { useState } from 'react';
import { Button, Collapse, Drawer, Table, Tabs } from 'antd';
import { ArrowUpRight, BookOpen, FileText } from 'lucide-react';
import type { CompanyReport } from '../../../shared/contracts/companyReport';
import './companyReport.css';
import CompanyBusinessInsights, { CompanyInsightScope } from './CompanyBusinessInsights';
import CompanyReportBrandMedia from './CompanyReportBrandMedia';
import { CompanyReportCharts, CompanyOperatingHighlights } from './CompanyReportCharts';
import { companyReportVisibleText, isCompanyOperatingSection } from './companyReportPresentation';

export const companyReportMoney = (value: string) => (Number(value) / 1e8).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const change = (value: string) => `${Number(value) > 0 ? '+' : ''}${value}%`;

function Evidence({ report, ids, quote, supplementaryIds = [] }: { report: CompanyReport; ids: string[]; quote?: string; supplementaryIds?: string[] }) {
  return <Collapse size="small" ghost className="company-report__evidence" items={[{ key: 'sources', label: '原文与判断依据', children: <>
    {quote && <blockquote>{quote}</blockquote>}
    {ids.map(id => report.evidence.find(item => item.id === id)).filter(Boolean).map(item => <div key={item!.id} className="company-report__source">
      <a href={`${report.source.url}#page=${item!.page}`} target="_blank" rel="noopener noreferrer">财报第 {item!.page} 页 <ArrowUpRight size={12}/></a>
      <p>{item!.text}</p>
    </div>)}
    {supplementaryIds.map(id => report.supplementarySources?.find(item => item.id === id)).filter(Boolean).map(item => <div key={item!.id} className="company-report__source">
      <a href={item!.url} target="_blank" rel="noopener noreferrer">{item!.title} <ArrowUpRight size={12}/></a>
      <p>{item!.publishedAt} · {item!.excerpt}</p>
    </div>)}
  </> }]} />;
}

export default function CompanyReportCard({ report }: { report: CompanyReport }) {
  const [open, setOpen] = useState(false);
  const hasInsights = report.businessInsights?.status === 'ready';
  const highlights = ['revenue', 'core-profit', 'cashflow'].map(id => report.metrics.find(metric => metric.id === id)!).filter(Boolean);
  return <>
    <article className="company-report-card" aria-label={`${report.company}企业解读`}>
      <div className="company-report-card__heading"><FileText size={19}/><div><strong>{report.company} · {report.period}</strong><p>{hasInsights ? '企业经营洞察 · 财报与近90天公开动态' : '财报经营解读 · 附原文页码'}</p></div></div>
      <div className="company-report-card__metrics">{highlights.map(metric => <div key={metric.id}><span>{metric.label.replace('归属于上市公司股东的扣除非经常性损益的净利润', '扣非净利润').replace('经营活动产生的现金流量净额', '经营现金流')}</span><strong>{companyReportMoney(metric.current)}<small>亿元</small></strong><span>同比 {change(metric.changePct)}</span></div>)}</div>
      <div className="company-report-card__footer"><span>原文已读取{report.source.auditStatus === 'not-stated' ? '' : report.source.audited ? ' · 财务数据以原文为准' : ' · 原文未经审计'}</span><Button type="primary" icon={<BookOpen size={14}/>} onClick={() => setOpen(true)}>{hasInsights ? '阅读经营洞察' : '阅读完整解读'}</Button></div>
    </article>
    <Drawer title={`${report.company} · ${hasInsights ? '企业经营洞察' : `${report.period}经营解读`}`} size={typeof window === 'undefined' ? 960 : Math.min(960, window.innerWidth)} open={open} onClose={() => setOpen(false)} destroyOnHidden className="company-report-drawer">
      <CompanyReportPresentation report={report}/>
    </Drawer>
  </>;
}

export function CompanyReportPresentation({ report }: { report: CompanyReport }) {
  return report.businessInsights?.status === 'ready' ? <Tabs className="company-report-mode-tabs" defaultActiveKey="insights" items={[
    { key: 'insights', label: '企业经营洞察', children: <CompanyBusinessInsights report={report}/> },
    { key: 'financial', label: '纯财报解读', children: <CompanyReportContents report={report}/> },
  ]}/> : <CompanyReportContents report={report}/>;
}

export function CompanyReportContents({ report }: { report: CompanyReport }) {
  const conclusion = companyReportVisibleText(report.analysis.conclusion.text);
  const watchpoints = report.analysis.watchpoints.map(item => ({ ...item, text: companyReportVisibleText(item.text), verifyWith: companyReportVisibleText(item.verifyWith) })).filter(item => item.text);
  return <div className="company-report">
        <CompanyInsightScope report={report}/>
        <h1>{companyReportVisibleText(report.analysis.headline)}</h1>
        <section className="company-report__conclusion"><div className="company-report__label">核心判断</div><CompanyOperatingHighlights report={report}/>{conclusion && <p>{conclusion}</p>}<Evidence report={report} ids={report.analysis.conclusion.evidenceIds} supplementaryIds={report.analysis.conclusion.supplementaryEvidenceIds}/></section>
        <section><h2>整体经营对照</h2><CompanyReportCharts report={report}/><p className="company-report__meta">金额按亿元展示，保留两位小数；同比采用原表百分比并已复算核对。</p>
          <Table size="small" pagination={false} rowKey="id" dataSource={report.metrics} scroll={{ x: 550 }} columns={[
            { title: '指标', dataIndex: 'label', key: 'label', width: 240 },
            { title: '本期（亿元）', dataIndex: 'current', key: 'current', align: 'right', render: companyReportMoney },
            { title: '上年同期（亿元）', dataIndex: 'previous', key: 'previous', align: 'right', render: companyReportMoney },
            { title: '同比', dataIndex: 'changePct', key: 'changePct', align: 'right', render: change },
          ]}/>
          <Evidence report={report} ids={[...new Set(report.metrics.flatMap(metric => [`P${metric.page}`, ...(metric.unitEvidence ? [`P${metric.unitEvidence.page}`] : [])]))]}/>
        </section>
        {report.analysis.sections.map((section, index) => {
          const observation = companyReportVisibleText(section.observation.text);
          const interpretation = companyReportVisibleText(section.interpretation?.text || '');
          const implication = companyReportVisibleText(section.implication?.text || '');
          if (!observation && !interpretation && !implication) return null;
          return <section key={section.title}>
            {companyReportVisibleText(section.title) && <h2><span className="company-report__index">{String(index + 1).padStart(2, '0')}</span>{companyReportVisibleText(section.title)}</h2>}
            {isCompanyOperatingSection(section.title) && <CompanyOperatingHighlights report={report}/>}
            {observation && <><div className="company-report__label">公司披露</div><p>{observation}</p><CompanyReportBrandMedia companyId={report.companyId} text={`${section.title} ${observation}`}/></>}
            {interpretation && <><div className="company-report__label">经营解读</div><p>{interpretation}</p></>}
            {implication && <div className="company-report__implication"><strong>对同类企业的含义</strong><p>{implication}</p></div>}
            <Evidence report={report} ids={[...new Set([...(observation ? section.observation.evidenceIds : []), ...(interpretation ? section.interpretation?.evidenceIds || [] : []), ...(implication ? section.implication?.evidenceIds || [] : [])])]} quote={observation ? section.observation.quote : undefined} supplementaryIds={[...new Set([...(observation ? section.observation.supplementaryEvidenceIds || [] : []), ...(interpretation ? section.interpretation?.supplementaryEvidenceIds || [] : []), ...(implication ? section.implication?.supplementaryEvidenceIds || [] : [])])]}/>
          </section>;
        })}
        {watchpoints.length > 0 && <section><h2>下一次披露，重点验证什么？</h2><ol className="company-report__watchpoints">{watchpoints.map(item => <li key={item.text}><strong>{item.text}</strong>{item.verifyWith && <p>{item.verifyWith}</p>}<Evidence report={report} ids={item.evidenceIds} supplementaryIds={item.supplementaryEvidenceIds}/></li>)}</ol></section>}
        <section className="company-report__limits"><h2>报告范围与数据来源</h2><ul>{report.limitations.map(companyReportVisibleText).filter(Boolean).filter(text => !/^有\d+句未通过/u.test(text)).map(text => <li key={text}>{text}</li>)}</ul>
          <a href={report.source.url} target="_blank" rel="noopener noreferrer">{report.source.title} <ArrowUpRight size={13}/></a>
          <p>财报发布：{report.source.publishedAt} · 读取：{new Date(report.source.fetchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）</p>
          <p>本轮生成：{new Date(report.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）</p>
        </section>
      </div>;
}
