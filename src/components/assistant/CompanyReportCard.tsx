import { useState } from 'react';
import { Button, Collapse, Drawer, Table, Tag } from 'antd';
import { ArrowUpRight, BookOpen, FileText } from 'lucide-react';
import type { CompanyReport } from '../../../shared/contracts/companyReport';
import './companyReport.css';

export const companyReportMoney = (value: string) => (Number(value) / 1e8).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const change = (value: string) => `${Number(value) > 0 ? '+' : ''}${value}%`;

function Evidence({ report, ids, quote }: { report: CompanyReport; ids: string[]; quote?: string }) {
  return <Collapse size="small" ghost className="company-report__evidence" items={[{ key: 'sources', label: '原文与判断依据', children: <>
    {quote && <blockquote>{quote}</blockquote>}
    {ids.map(id => report.evidence.find(item => item.id === id)).filter(Boolean).map(item => <div key={item!.id} className="company-report__source">
      <a href={`${report.source.url}#page=${item!.page}`} target="_blank" rel="noopener noreferrer">财报第 {item!.page} 页 <ArrowUpRight size={12}/></a>
      <p>{item!.text}</p>
    </div>)}
  </> }]} />;
}

export default function CompanyReportCard({ report }: { report: CompanyReport }) {
  const [open, setOpen] = useState(false);
  const highlights = ['revenue', 'core-profit', 'cashflow'].map(id => report.metrics.find(metric => metric.id === id)!).filter(Boolean);
  return <>
    <article className="company-report-card" aria-label={`${report.company}企业解读`}>
      <div className="company-report-card__heading"><FileText size={19}/><div><strong>{report.company} · {report.period}</strong><p>财报研究草稿 · 附原文页码</p></div><Tag variant="filled">判断待复核</Tag></div>
      <div className="company-report-card__metrics">{highlights.map(metric => <div key={metric.id}><span>{metric.label.replace('归属于上市公司股东的扣除非经常性损益的净利润', '扣非净利润').replace('经营活动产生的现金流量净额', '经营现金流')}</span><strong>{companyReportMoney(metric.current)}<small>亿元</small></strong><span>同比 {change(metric.changePct)}</span></div>)}</div>
      <div className="company-report-card__footer"><span>原文已读取 · {report.source.auditStatus === 'not-stated' ? '审计状态未核验' : report.source.audited ? '财务数据以原文为准' : '原文未经审计'}</span><Button type="primary" icon={<BookOpen size={14}/>} onClick={() => setOpen(true)}>阅读完整解读</Button></div>
    </article>
    <Drawer title={`${report.company} · ${report.period}经营解读`} size={typeof window === 'undefined' ? 960 : Math.min(960, window.innerWidth)} open={open} onClose={() => setOpen(false)} destroyOnHidden className="company-report-drawer">
      <div className="company-report">
        <div className="company-report__meta">研究草稿 · 数字与引用已作自动核验，经营判断仍需复核</div>
        <h1>{report.analysis.headline}</h1>
        {report.limitations.some(item => /^有\d+句未通过/u.test(item)) && <p className="company-report__meta" role="status">部分句子未通过证据核验，已省略；请结合文末报告范围阅读。</p>}
        <section className="company-report__conclusion"><div className="company-report__label">核心判断</div><p>{report.analysis.conclusion.text}</p><Evidence report={report} ids={report.analysis.conclusion.evidenceIds}/></section>
        <section><h2>整体经营对照</h2><p className="company-report__meta">金额按亿元展示，保留两位小数；同比采用原表百分比并已复算核对。</p>
          <Table size="small" pagination={false} rowKey="id" dataSource={report.metrics} scroll={{ x: 550 }} columns={[
            { title: '指标', dataIndex: 'label', key: 'label', width: 240 },
            { title: '本期（亿元）', dataIndex: 'current', key: 'current', align: 'right', render: companyReportMoney },
            { title: '上年同期（亿元）', dataIndex: 'previous', key: 'previous', align: 'right', render: companyReportMoney },
            { title: '同比', dataIndex: 'changePct', key: 'changePct', align: 'right', render: change },
          ]}/>
          <Evidence report={report} ids={[...new Set(report.metrics.flatMap(metric => [`P${metric.page}`, ...(metric.unitEvidence ? [`P${metric.unitEvidence.page}`] : [])]))]}/>
        </section>
        {report.analysis.sections.map((section, index) => <section key={section.title}>
          <h2><span className="company-report__index">{String(index + 1).padStart(2, '0')}</span>{section.title}</h2>
          <div className="company-report__label">公司披露</div><p>{section.observation.text}</p>
          <div className="company-report__label">经营解读</div><p>{section.interpretation.text}</p>
          <div className="company-report__implication"><strong>对同类企业的含义</strong><p>{section.implication.text}</p></div>
          <Evidence report={report} ids={[...new Set([...section.observation.evidenceIds, ...section.interpretation.evidenceIds, ...section.implication.evidenceIds])]} quote={section.observation.quote}/>
        </section>)}
        <section><h2>下一次披露，重点验证什么？</h2><ol className="company-report__watchpoints">{report.analysis.watchpoints.map(item => <li key={item.text}><strong>{item.text}</strong><p>{item.verifyWith}</p><Evidence report={report} ids={item.evidenceIds}/></li>)}</ol></section>
        <section className="company-report__limits"><h2>报告范围与数据来源</h2><ul>{report.limitations.map(text => <li key={text}>{text}</li>)}</ul>
          <a href={report.source.url} target="_blank" rel="noopener noreferrer">{report.source.title} <ArrowUpRight size={13}/></a>
          <p>财报发布：{report.source.publishedAt} · 读取：{new Date(report.source.fetchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）</p>
          <p>本轮生成：{new Date(report.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）</p>
        </section>
      </div>
    </Drawer>
  </>;
}
