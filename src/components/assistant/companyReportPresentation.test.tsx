import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CompanyReport } from '../../../shared/contracts/companyReport';
import { CompanyReportCharts, CompanyOperatingHighlights } from './CompanyReportCharts';
import { companyReportVisibleText, companyReportChartMetrics } from './companyReportPresentation';

const metrics: CompanyReport['metrics'] = [
  { id: 'revenue', label: '营业收入', current: '2591640131.46', previous: '2371785714.29', changePct: '9.27', unit: '元人民币', page: 8, excerpt: '营业收入原表' },
  { id: 'profit', label: '归属于上市公司股东的净利润', current: '291796816.97', previous: '246658340.63', changePct: '18.30', unit: '元人民币', page: 8, excerpt: '净利润原表' },
  { id: 'cashflow', label: '经营活动产生的现金流量净额', current: '-30000000', previous: '-60000000', changePct: '50.00', unit: '元人民币', page: 8, excerpt: '现金流量原表' },
];

test('historical validation placeholders disappear while real disclosures and cautious implications remain', () => {
  assert.equal(companyReportVisibleText('该段未取得可核验的数据，暂不作判断。'), '');
  assert.equal(companyReportVisibleText('营业收入同比增长9.27%。该段未取得可核验的数据，暂不作判断。现金流改善可能减轻周转压力。'), '营业收入同比增长9.27%。现金流改善可能减轻周转压力。');
  assert.equal(companyReportVisibleText('资料不足，无法判断。'), '');
  assert.equal(companyReportVisibleText('公司未披露品牌收入占比，无法判断薇诺娜是否仍为绝对主力。若新品牌未形成规模效应，则可能增加整体毛利率波动。'), '若新品牌未形成规模效应，则可能增加整体毛利率波动。');
  assert.equal(companyReportVisibleText(''), '');
});

test('charts use financial metric values, preserve negatives and never fill malformed inputs with zero', () => {
  assert.deepEqual(companyReportChartMetrics([...metrics, { ...metrics[0], id: 'bad', current: '' }, { ...metrics[0], id: 'nan', current: 'NaN' }]).map(item => item.id), ['revenue', 'profit', 'cashflow']);
  const html = renderToStaticMarkup(<CompanyReportCharts report={{ period: '2026年半年度', metrics } as CompanyReport}/>);
  assert.match(html, /2026年半年度 · 本期与上年同期/);
  assert.match(html, /2026年半年度 · 同比变化/);
  assert.equal(companyReportChartMetrics(metrics)[2].current, '-30000000');
  assert.equal(companyReportChartMetrics(metrics)[1].changePct, '18.30');
  assert.match(html, /查看数据表/);
});

test('operating chapter presents real colored numeric highlights with accessible text and no fabricated metric', () => {
  const html = renderToStaticMarkup(<CompanyOperatingHighlights report={{ period: '2026年半年度', metrics } as CompanyReport}/>);
  assert.match(html, /营业收入/); assert.match(html, /归母净利润/); assert.match(html, /25\.92/);
  assert.match(html, /同比 \+9\.27%/); assert.match(html, /border-top-color:#36A2EB/);
  assert.doesNotMatch(html, /扣非净利润/);
});
