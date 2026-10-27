import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Radio, Select, Spin } from 'antd';
import type { CompanyReportOptions } from '../../../shared/contracts/companyFilings';
import { companyReportSceneRequest, fetchCompanyReportOptions } from '../../lib/companyReportApi';
import './companyReportScene.css';

export default function CompanyReportScene({ busy, onCancel, onPrompt, onConfirm }: {
  busy: boolean; onCancel: () => void;
  onPrompt: (text: string) => void;
  onConfirm: (request: ReturnType<typeof companyReportSceneRequest>) => void;
}) {
  const [options, setOptions] = useState<CompanyReportOptions | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [companyId, setCompanyId] = useState<string>();
  const [year, setYear] = useState<number>();
  const submitted = useRef(false);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (options) panel.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [options, companyId]);
  useEffect(() => {
    const controller = new AbortController();
    setOptions(null); setError(''); setCompanyId(undefined); setYear(undefined);
    fetchCompanyReportOptions(controller.signal).then(value => { if (!controller.signal.aborted) setOptions(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '企业目录读取失败。'); });
    return () => controller.abort();
  }, [revision]);
  const company = options?.companies.find(item => item.id === companyId);
  const report = company?.reports.find(item => item.year === year);
  const chooseCompany = (id: string) => {
    setCompanyId(id); setYear(options?.companies.find(item => item.id === id)?.reports[0]?.year);
  };
  const confirm = () => {
    if (!options || !companyId || !year || report?.status !== 'available' || busy || submitted.current) return;
    submitted.current = true;
    onConfirm(companyReportSceneRequest(options, companyId, year));
  };
  return <section ref={panel} className="company-report-scene" aria-label="选择重点企业">
    <div className="company-report-scene__header"><strong>选择重点企业</strong><span>选择一家企业，确认报告期间后生成深度解读</span></div>
    {error ? <Alert type="error" showIcon title={error} action={<Button size="small" onClick={() => setRevision(value => value + 1)}>重新加载</Button>}/> : !options ?
      <div className="company-report-scene__loading" role="status"><Spin size="small"/>正在读取已核验的企业财报目录…</div> : <>
      <div className="company-report-scene__companies">
        <Radio.Group name="company-report-target" role="radiogroup" value={companyId} onChange={event => chooseCompany(String(event.target.value))} aria-label="重点企业"
          optionType="button" options={options.companies.map(item => ({ value: item.id,
            label: <><strong>{item.name}</strong><span>{item.segment}</span></>,
          }))}/>
      </div>
      <div className="company-report-scene__selection">
        {company ? <><span>{company.name} · {company.code}</span><label htmlFor="company-report-period">报告期间</label>
          <Select id="company-report-period" aria-label="报告期间" value={year} onChange={setYear} placeholder="暂无可用半年报" disabled={!company.reports.length}
            options={company.reports.map(item => ({ value: item.year, label: `${item.period}${item.status === 'needs_review' ? ' · 版本待核对' : ''}` }))}/>
          {report && <span>统计期间：一至六月 · 原文披露 {report.publishedAt}</span>}
        </> : <span>请先选择目标企业</span>}
      </div>
      {company && !company.reports.length && <section className="space-y-2"><p>{company.name}（{company.code}）· {company.segment}</p>
        <p className="text-sm text-text-secondary">本地还没有可核验的半年报全文。可以先看企业公开信息，或读取官方财报目录。</p>
        <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => onPrompt(`请查询${company.name}（${company.code}）的企业公开信息，介绍主营业务、产品和海外布局，优先引用官网及公开披露；缺少半年报不影响呈现已核验的信息，不推算财务数字。`)}>查看企业公开信息</Button>
          <Button disabled={busy} onClick={() => onPrompt(`刷新${company.name}历史财报目录`)}>刷新官方财报目录</Button></div>
      </section>}
      {report?.status === 'needs_review' && <Alert type="warning" title="该期间有更正或版本变化，核对前暂不生成报告。"/>}
    </>}
    <div className="company-report-scene__footer"><p>{busy ? '当前回复完成后即可生成。' : '基于所选期间的财报原文生成研究草稿，附数字对照、业务解读及来源页码。'}</p>
      <div><Button onClick={onCancel}>取消</Button><Button type="primary" disabled={!report || report.status !== 'available' || busy} onClick={confirm}>填入输入框</Button></div>
    </div>
  </section>;
}
