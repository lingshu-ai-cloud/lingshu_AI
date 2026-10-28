import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Radio, Select, Spin } from 'antd';
import type { CompanyReportOptions } from '../../../shared/contracts/companyFilings';
import { companyReportSceneRequest, fetchCompanyReportOptions } from '../../lib/companyReportApi';
import './companyReportScene.css';

// Visible artwork bounds (including a small safety margin), not image canvas bounds.
// CSS compensates for the different source padding without modifying the supplied logos.
const COMPANY_LOGOS: Record<string, { file?: string; size: [number, number]; bounds: [number, number, number, number] }> = {
  bloomage: { size: [356, 154], bounds: [39, 36, 293, 140] },
  proya: { size: [322, 128], bounds: [41, 19, 260, 110] },
  botanee: { size: [390, 68], bounds: [36, 23, 308, 68] },
  freda: { file: 'freda-transparent.png', size: [1840, 855], bounds: [224, 197, 1633, 714] },
  cosmos: { size: [452, 306], bounds: [52, 33, 253, 208] },
  jahen: { size: [480, 144], bounds: [10, 2, 422, 137] },
  jahwa: { size: [444, 98], bounds: [42, 20, 410, 93] },
  marubi: { size: [454, 132], bounds: [44, 35, 370, 89] },
};

function CompanyLogo({ id }: { id: string }) {
  const logo = COMPANY_LOGOS[id];
  if (!logo) return null;
  const [left, top, right, bottom] = logo.bounds;
  const width = right - left, height = bottom - top;
  const scale = Math.min(152 / width, 64 / height);
  return <span className="company-report-scene__logo-art" style={{ width: width * scale, height: height * scale }}>
    <img src={`/company-logos/${logo.file ?? `${id}.png`}`} alt="" aria-hidden="true" draggable={false}
      style={{ width: `${logo.size[0] / width * 100}%`, height: `${logo.size[1] / height * 100}%`,
        left: `${-left / width * 100}%`, top: `${-top / height * 100}%` }}/>
  </span>;
}

export default function CompanyReportScene({ busy, onConfirm }: {
  busy: boolean;
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
    submitted.current = false; setCompanyId(id); setYear(options?.companies.find(item => item.id === id)?.reports[0]?.year);
  };
  const confirm = () => {
    if (!options || !companyId || report?.status === 'needs_review' || busy || submitted.current) return;
    submitted.current = true;
    onConfirm(companyReportSceneRequest(options, companyId, year));
  };
  return <section ref={panel} className="company-report-scene" aria-label="选择重点企业">
    <div className="company-report-scene__header"><strong>选择重点企业</strong><span>选择企业和财报期间，结合近90天公开动态生成经营洞察</span></div>
    {error ? <Alert type="error" showIcon title={error} action={<Button size="small" onClick={() => setRevision(value => value + 1)}>重新加载</Button>}/> : !options ?
      <div className="company-report-scene__loading" role="status"><Spin size="small"/>正在读取已核验的企业财报目录…</div> : <>
      <div className="company-report-scene__companies">
        <Radio.Group name="company-report-target" role="radiogroup" value={companyId} onChange={event => chooseCompany(String(event.target.value))} aria-label="重点企业"
          optionType="button" options={options.companies.map(item => ({ value: item.id,
            label: <><span className="company-report-scene__logo"><CompanyLogo id={item.id}/></span><strong>{item.name}</strong><span className="company-report-scene__segment">{item.segment}</span></>,
          }))}/>
      </div>
      {company && <div className="company-report-scene__selection"><span>{company.name} · {company.code}</span><label htmlFor="company-report-period">财务基准</label><Select id="company-report-period" aria-label="财报期间" value={year} onChange={value => { submitted.current = false; setYear(value); }} disabled={!company.reports.length} placeholder="生成时检索官方半年报" options={company.reports.map(item => ({ value: item.year, label: item.period + (item.status === 'needs_review' ? '（版本待核对）' : '') }))}/><span>公开动态：近90天</span></div>}
      {report?.status === 'needs_review' && <Alert type="warning" title="该期间有更正或版本变化，核对前暂不生成报告。"/>}
    </>}
    <div className="company-report-scene__footer"><Button type="primary" disabled={!company || report?.status === 'needs_review' || busy} onClick={confirm}>生成经营洞察</Button></div>
  </section>;
}
