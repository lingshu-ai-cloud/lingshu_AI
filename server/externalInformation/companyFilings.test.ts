import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { REPORT_COMPANIES } from './companyRegistry.js';
import { chinaDate, CNINFO_IDENTITY, CNINFO_ANNOUNCEMENTS, discoverCompanyFilings, filingCoverage, parseCompanyFiling, selectedFilings } from './companyFilings.js';
import { companyFilingsSnapshotSchema } from '../../shared/contracts/companyFilings.js';
import { companyFilingsIntent, renderCompanyFilings, resolveHalfYearReport } from './companyFilingsDelivery.js';
import { publicDisclosureQueryAllowed } from '../../shared/assistantPublicSourcePolicy.mjs';
import { inspectCompanyFilingPdf } from './companyFilingPdf.js';

const company = REPORT_COMPANIES[0], orgId = '9900039135', now = new Date('2026-10-26T05:00:00Z');
function row(id: string, title: string, date = '2026-08-28') {
  return { secCode: company.code, orgId, announcementId: id, announcementTitle: title,
    announcementTime: Date.parse(`${date}T00:00:00+08:00`), adjunctType: 'PDF', adjunctUrl: `finalpage/${date}/${id}.PDF` };
}
const parse = (value: unknown) => parseCompanyFiling(value, company, orgId, '2023-01-01', '2026-10-26');
function snapshot(rows = [row('1225522098', '华熙生物2026年半年度报告')]) {
  return companyFilingsSnapshotSchema.parse({ version: 1, companyId: company.id, company: company.name, code: company.code, orgId,
    fetchedAt: now.toISOString(), from: '2023-01-01', through: '2026-10-26', complete: true,
    filings: rows.map(parse).filter(Boolean), changes: { addedIds: [], changedIds: [], removedIds: [] } });
}
function fakeFetcher(reports: () => unknown[], corrections: () => unknown[] = () => [], pages?: { partial?: boolean; shifting?: boolean }) {
  let calls = 0;
  return { get calls() { return calls; }, fetcher: (async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error');
    if (url.pathname === new URL(CNINFO_IDENTITY).pathname) {
      assert.equal(url.searchParams.get('keyWord'), company.code);
      return Response.json([{ code: company.code, category: 'A股', zwjc: company.name, orgId }]);
    }
    assert.equal(url.href, CNINFO_ANNOUNCEMENTS);
    assert.ok(publicDisclosureQueryAllowed(url.href, 'POST', init?.body));
    const params = new URLSearchParams(String(init?.body));
    const list = params.get('searchkey') ? corrections() : reports();
    const page = Number(params.get('pageNum'));
    return Response.json({ totalRecordNum: pages?.shifting && page > 1 ? 121 : pages?.partial ? 120 : list.length,
      announcements: list, hasMore: Boolean(pages?.partial) });
  }) as typeof fetch };
}

test('periods come from report title or verified cover, never publication-year guessing', () => {
  assert.equal(chinaDate(new Date('2026-10-25T18:00:00Z')), '2026-10-26');
  assert.equal(parse(row('1225522098', '华熙生物2025年年度报告'))?.year, 2025);
  assert.match(parse(row('1225522098', '华熙生物2025年第三季度报告'))!.periodLabel, /1—9月累计/u);
  assert.equal(parse(row('1225522098', '华熙生物2026年半年度报告摘要')), null);
  assert.equal(parse(row('1225522098', '华熙生物2026年半年度报告（英文版）')), null);
  assert.equal(parse(row('1225522098', '华熙生物第三季度报告')), null);
  const coverBased = parseCompanyFiling(row('1225522098', '华熙生物第三季度报告'), company, orgId, '2023-01-01', '2026-10-26', { year: 2025, kind: 'q3' });
  assert.equal(coverBased?.periodBasis, 'pdf-cover'); assert.equal(coverBased?.year, 2025);
  assert.throws(() => parse(row('1225522098', '华熙生物2026年年度报告')), /日期|期间/u);
  assert.throws(() => parse({ ...row('1225522098', '华熙生物2026年半年度报告'), secCode: '603605' }), /身份/u);
  assert.throws(() => parse({ ...row('1225522098', '华熙生物2026年半年度报告'), adjunctUrl: '//attacker.test/a.pdf' }), /地址/u);
});

test('revision selection retains originals and notices and refuses unresolved same-day changes', () => {
  const data = snapshot([row('1225522098', '华熙生物2026年半年度报告'),
    row('1225522099', '关于2026年半年度报告的更正公告', '2026-09-01'),
    row('1225522100', '华熙生物2026年半年度报告（修订版）', '2026-09-01')]);
  const selected = selectedFilings(data)[0];
  assert.equal(data.filings.length, 3); assert.equal(selected.filing?.id, '1225522100');
  assert.equal(selected.needsReview, true); assert.equal(selected.notices.length, 1);
  const later = snapshot([row('1225522098', '华熙生物2026年半年度报告'), row('1225522100', '华熙生物2026年半年度报告（修订版）', '2026-09-02')]);
  assert.equal(selectedFilings(later)[0].filing?.revised, true);
});

test('coverage orders accounting periods rather than publication dates and exposes missing periods', () => {
  const data = snapshot([row('1225522098', '华熙生物2026年半年度报告'),
    row('1225522100', '华熙生物2023年年度报告（修订版）', '2026-09-02')]);
  const coverage = filingCoverage(data);
  assert.equal(coverage.latest?.periodKey, '2026-half-year');
  assert.deepEqual(coverage.annual.map(item => item.year), [2025, 2024, 2023]);
  assert.equal(coverage.recent.length, 8); assert.equal(coverage.recent[1].entry, undefined);
});

test('public source capability allows only the two bounded read queries and rejects writes or secret parameters', () => {
  assert.ok(publicDisclosureQueryAllowed(`${CNINFO_IDENTITY}?keyWord=688363&maxNum=10`, 'POST'));
  for (const url of [`${CNINFO_IDENTITY}?keyWord=688363&maxNum=10&token=secret`, 'https://www.cninfo.com.cn/new/account/save',
    'https://www.cninfo.com.cn.attacker.test/new/information/topSearch/query?keyWord=688363&maxNum=10'])
    assert.equal(publicDisclosureQueryAllowed(url, 'POST'), false);
  const body = new URLSearchParams({ pageNum: '1', pageSize: '30', column: 'sse', tabName: 'fulltext', stock: `${company.code},${orgId}`,
    searchkey: '', category: '', seDate: '2023-01-01~2026-10-26', isHLtitle: 'false' }).toString();
  assert.ok(publicDisclosureQueryAllowed(CNINFO_ANNOUNCEMENTS, 'POST', body));
  assert.equal(publicDisclosureQueryAllowed(CNINFO_ANNOUNCEMENTS, 'POST', `${body}&token=secret`), false);
  assert.equal(publicDisclosureQueryAllowed(CNINFO_ANNOUNCEMENTS, 'GET', body), false);
});

test('discovery persists versioned complete snapshots, detects changes and retains pending review on later refresh', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'filing-discovery-'));
  let rows = [row('1225522098', '华熙生物2026年半年度报告')];
  const transport = fakeFetcher(() => rows);
  try {
    const first = await discoverCompanyFilings(company, { now, storeDir: directory, fetcher: transport.fetcher });
    assert.equal(transport.calls, 4); assert.equal(first.complete, true); assert.equal(first.filings.length, 1);
    assert.deepEqual(first.changes.addedIds, ['1225522098']);
    rows = [...rows, row('1225522100', '华熙生物2026年半年度报告（修订版）', '2026-09-01')];
    const second = await discoverCompanyFilings(company, { now, storeDir: directory, fetcher: transport.fetcher });
    assert.deepEqual(second.pendingReviewPeriodKeys, ['2026-half-year']);
    assert.equal(selectedFilings(second)[0].needsReview, true);
    const third = await discoverCompanyFilings(company, { now, storeDir: directory, fetcher: transport.fetcher });
    assert.deepEqual(third.changes.addedIds, []); assert.equal(selectedFilings(third)[0].needsReview, true);
    assert.ok((await fs.readdir(directory)).filter(file => /^bloomage-[a-f0-9]+\.json$/u.test(file)).length >= 2);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('capped or shifting pagination is never described or saved as complete', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'filing-pages-'));
  try {
    const initial = fakeFetcher(() => [row('1225522098', '华熙生物2026年半年度报告')]);
    await discoverCompanyFilings(company, { now, storeDir: directory, fetcher: initial.fetcher });
    const before = await fs.readFile(path.join(directory, 'bloomage.json'), 'utf8');
    const partial = fakeFetcher(() => [row('1225522098', '华熙生物2026年半年度报告')], () => [], { partial: true });
    const result = await discoverCompanyFilings(company, { now, storeDir: directory, fetcher: partial.fetcher });
    assert.equal(result.complete, false); assert.equal(selectedFilings(result)[0].needsReview, true);
    assert.equal(await fs.readFile(path.join(directory, 'bloomage.json'), 'utf8'), before);
    const shifting = fakeFetcher(() => [row('1225522098', '华熙生物2026年半年度报告')], () => [], { partial: true, shifting: true });
    await assert.rejects(discoverCompanyFilings(company, { now, storeDir: directory, fetcher: shifting.fetcher }), /分页/u);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('library intent is explicit; delivery labels cumulative periods, missing data and partial failures', () => {
  assert.equal(companyFilingsIntent('不要联网，查询华熙生物最新财报'), null);
  assert.equal(companyFilingsIntent('小米最新财报'), null);
  assert.equal(companyFilingsIntent('解读华熙生物2026年半年度报告'), null);
  assert.equal(companyFilingsIntent('刷新科思股份历史财报目录')?.companies[0].code, '300856');
  assert.equal(companyFilingsIntent('查询美妆企业财报资料库')?.companies.length, 8);
  const delivered = renderCompanyFilings([{ company, snapshot: snapshot() }]);
  assert.match(delivered.text, /1—9月累计/u); assert.match(delivered.text, /缺少可直接采用/u);
  assert.match(delivered.text, /尚未启用后台定时监测/u); assert.equal(delivered.sources.length, 1);
});

test('half-year analysis resolves a discovered source while invalid PDF URLs cannot trigger a fetch', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'filing-resolve-'));
  try {
    const transport = fakeFetcher(() => [row('1225522098', '华熙生物2026年半年度报告')]);
    const resolved = await resolveHalfYearReport('bloomage', 2026, { now, storeDir: directory, fetcher: transport.fetcher });
    assert.equal(resolved.url, 'https://static.cninfo.com.cn/finalpage/2026-08-28/1225522098.PDF');
    await assert.rejects(inspectCompanyFilingPdf('http://localhost/secret.pdf', company, { fetcher: async () => { throw Error('must not fetch'); } }), /官方目录/u);
    await assert.rejects(inspectCompanyFilingPdf(resolved.url, company, { fetcher: async () => new Response('<html>not PDF</html>') }), /没有返回PDF/u);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
