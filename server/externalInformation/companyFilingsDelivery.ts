import type { CompanyFilingsSnapshot } from '../../shared/contracts/companyFilings.js';
import { companyReportOptionsSchema } from '../../shared/contracts/companyFilings.js';
import { REPORT_COMPANIES, reportCompaniesIn, type ReportCompany } from './companyRegistry.js';
import { discoverCompanyFilings, readCompanyFilingsSnapshot, filingCoverage, selectedFilings, type FilingsDependencies } from './companyFilings.js';
import { ExternalInformationError } from './http.js';
import { COMPANY_REPORT_CATALOG, type CompanyReportTarget } from './companyReportCatalog.js';

export function companyFilingsIntent(question: string): { companies: readonly ReportCompany[]; force: boolean } | null {
  if (/不(?:用|要|必)联网|无需联网|不(?:用|要)搜索/u.test(question)) return null;
  if (!/财报|年报|半年报|季报|报告/u.test(question)
    || !/目录|资料|历史|近三年|最近.{0,4}[八8]|最新|更新|刷新|有哪些|数据源|观察池|企业池/u.test(question)) return null;
  const companies = reportCompaniesIn(question);
  if (!companies.length && !/观察池|企业池|资料库|美妆|原料/u.test(question)) return null;
  return { companies: companies.length ? companies : REPORT_COMPANIES, force: /刷新|更新/u.test(question) };
}

export type FilingsResult = { company: ReportCompany; snapshot?: CompanyFilingsSnapshot; snapshotOnly?: boolean; error?: string };
export async function companyReportOptions() {
  const companies = [];
  for (const company of REPORT_COMPANIES) {
    const snapshot = await readCompanyFilingsSnapshot(company);
    companies.push({ id: company.id, name: company.name, code: company.code, segment: company.segment,
      sourceCheckedAt: snapshot?.fetchedAt ?? null,
      reports: snapshot ? selectedFilings(snapshot).flatMap(entry => entry.filing?.kind === 'half-year' ? [{
        year: entry.filing.year, period: `${entry.filing.year}年半年度`, publishedAt: entry.filing.publishedAt,
        status: entry.needsReview ? 'needs_review' as const : 'available' as const,
      }] : []) : [] });
  }
  return companyReportOptionsSchema.parse({ checkedAt: new Date().toISOString(), companies });
}
export async function queryCompanyFilings(companies: readonly ReportCompany[], options: FilingsDependencies = {}): Promise<FilingsResult[]> {
  const results: FilingsResult[] = [];
  for (const company of companies) {
    options.signal?.throwIfAborted();
    try {
      // A pool overview reads published-source snapshots; one explicit company refresh stays within the existing 16-request preview scope.
      const snapshotOnly = companies.length > 1;
      const snapshot = snapshotOnly ? await readCompanyFilingsSnapshot(company, options.storeDir) : await discoverCompanyFilings(company, options);
      results.push({ company, snapshot, snapshotOnly, ...(!snapshot ? { error: '尚未建立目录，请指定该企业刷新财报目录。' } : {}) });
    }
    catch (error) {
      if (options.signal?.aborted) throw error;
      results.push({ company, error: error instanceof ExternalInformationError ? error.message : '官方目录读取失败，本次未取得完整结果。' });
    }
  }
  return results;
}

export function renderCompanyFilings(results: FilingsResult[]): { text: string; sources: Array<{ title: string; uri: string }> } {
  const available = results.flatMap(result => result.snapshot ? [result.snapshot] : []);
  const count = available.reduce((sum, snapshot) => sum + snapshot.filings.length, 0);
  const lines = [`企业财报资料库\n\n本次读取 ${available.length}/${results.length} 家企业的官方来源目录${results.length > 1 ? '快照' : '（可能复用十分钟内的完整快照）'}，共 ${count} 份财报及更正文件。目录发现与PDF内容解析分别记录；以下不代表经营判断已经复核。`];
  const sources: Array<{ title: string; uri: string }> = [];
  if (results.length > 1) lines.push('| 企业 | 快照内最近期间 | 近三年年报 | 最近八个报告期 | 核验状态及时间 |', '|---|---|---|---|---|');
  for (const result of results) {
    const { company, snapshot } = result;
    if (!snapshot) { lines.push(results.length > 1 ? `| ${company.name} | 未取得 | — | — | ${result.error} |` : `${company.name}：${result.error}`); continue; }
    const coverage = filingCoverage(snapshot);
    const years = coverage.annual.filter(item => item.entry?.filing && !item.entry.needsReview).length;
    const recent = coverage.recent.filter(item => item.entry?.filing && !item.entry.needsReview).length;
    const latest = coverage.latest;
    const timestamp = new Date(snapshot.fetchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    if (latest) sources.push({ title: `${company.name}${latest.periodLabel}`, uri: latest.url });
    const link = latest ? `[${latest.periodLabel}](${latest.url})` : '未找到可确认期间的全文';
    const status = !snapshot.complete ? '目录不完整，不能确认最近期间' : selectedFilings(snapshot).some(entry => entry.needsReview) ? '部分版本待核对' : '目录查询完成';
    if (results.length > 1) lines.push(`| ${company.name} | ${link} | ${years}/3 | ${recent}/8 | ${status} · ${timestamp} |`);
    else {
      lines.push(`\n${company.name}（${company.code}） · ${company.segment}\n\n${status}；查询范围 ${snapshot.from} 至 ${snapshot.through}；查询时间 ${timestamp}（北京时间）。\n\n近三年年报 ${years}/3，最近八个报告期 ${recent}/8。\n`,
        '| 报告期间 | 披露日期 | 原文与版本状态 |', '|---|---|---|');
      for (const entry of selectedFilings(snapshot)) {
        if (!entry.filing) { lines.push('| 仅发现更正公告 | — | 缺少对应全文，待核对 |'); continue; }
        const filing = entry.filing;
        lines.push(`| ${filing.periodLabel} | ${filing.publishedAt} | [${filing.revised ? '修订全文' : '财报全文'}](${filing.url})${entry.needsReview ? ' · 待人工核对版本' : ''}${filing.periodBasis === 'pdf-cover' ? ' · 期间由PDF封面核验' : ''} |`);
        for (const notice of entry.notices) lines.push(`| 同期更正说明 | ${notice.publishedAt} | [更正公告](${notice.url}) |`);
      }
      const gaps = coverage.recent.filter(item => !item.entry?.filing || item.entry.needsReview).map(item => item.periodKey);
      if (gaps.length) lines.push(`\n缺少可直接采用的报告期间：${gaps.join('、')}。缺失不按零处理。`);
      if (snapshot.changes.removedIds.length || snapshot.changes.changedIds.length)
        lines.push(`\n与上次快照相比，${snapshot.changes.changedIds.length} 份元数据变化，${snapshot.changes.removedIds.length} 份不再出现在本次查询结果中；需核对后采用。`);
    }
  }
  if (results.length > 1 && available.length) lines.push('\n企业池总览读取各自最近一次快照，不代表刚刚逐家联网刷新。可继续提问“刷新科思股份历史财报目录”，实时查询单家企业并查看逐期原文。');
  lines.push('\n口径：第三季度报告通常为1—9月累计，全年报告不是独立第四季度报告；最近八个报告期包含年报、半年报和季度报告。原文链接由官方目录返回，未把摘要当全文。',
    '\n更新方式：本次按需查询；完整目录缓存十分钟，提问“刷新某企业财报目录”可重新查询。尚未启用后台定时监测，不承诺发布后多少分钟内发现。',
    '\n深度解读目前只适配已核对的半年报表格；发现年报或季报不代表其指标已完整解析。经营判断仍按研究草稿交付。');
  return { text: lines.join('\n'), sources };
}

/** Resolve a half-year analysis from current discovery; never silently use an old hardcoded revision. */
export async function resolveHalfYearReport(companyId: string, year: number, options: FilingsDependencies = {}): Promise<CompanyReportTarget> {
  const company = REPORT_COMPANIES.find(item => item.id === companyId);
  if (!company) throw new ExternalInformationError('filing_identity_invalid', '企业不在当前观察池。');
  const snapshot = await discoverCompanyFilings(company, options);
  const selected = selectedFilings(snapshot).find(item => item.filing?.year === year && item.filing.kind === 'half-year');
  if (!selected?.filing || selected.needsReview || snapshot.changes.removedIds.length || snapshot.changes.changedIds.length)
    throw new ExternalInformationError('filing_source_needs_review', '未取得可直接采用的半年报全文，或发现更正/目录变动，请先查看该企业财报目录核对版本。');
  return { ...company, year, period: `${year}年半年度`, publishedAt: selected.filing.publishedAt, url: selected.filing.url,
    evidenceTerms: COMPANY_REPORT_CATALOG.find(item => item.id === companyId)?.evidenceTerms ?? ['主要会计数据', '财务报表相关科目变动分析表', '原料业务实现收入', '主要品牌', '销售渠道', '研发投入', '主要经营情况', '核心竞争力', '国际市场', '注册及临床试验进展'] };
}
