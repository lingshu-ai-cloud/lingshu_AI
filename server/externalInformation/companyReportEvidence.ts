import { assertCompanyIncomeDisclosure } from './companyDisclosureContradictions.js';
import { assertCompanyFinancialRatioDirection } from './companyFinancialRatioDirection.js';
import { assertCompanyBusinessClaim } from './companyBusinessClaimQuality.js';
import { createHash } from 'node:crypto';
import { companyCoverIdentityMatches } from './companyRegistry.js';
import { ExternalInformationError } from './http.js';
import type { CompanyReportTarget } from './companyReportCatalog.js';
import { COMPANY_REPORT_MAX_EVIDENCE_PAGES, type CompanyReport, type CompanyAnalysis } from '../../shared/contracts/companyReport.js';

export type ReportPage = { page: number; text: string };
export const compactReportText = (value: string) => value.replace(/\s+/gu, '').normalize('NFKC');
const amount = '(-?\\s*\\d[\\d,\\s]*?\\.\\s*\\d\\s*\\d)';
const percentage = '(-?\\s*\\d[\\d,]*(?:\\.\\s*\\d+)?)';
const labels = [
  ['revenue', '营业收入'], ['profit', '归属于上市公司股东的净利润'],
  ['core-profit', '归属于上市公司股东的扣除非经常性损益的净利润'],
  ['cashflow', '经营活动产生的现金流量净额'],
  ['selling', '销售费用'], ['research', '研发费用'], ['cost', '营业成本'], ['administration', '管理费用'], ['research-input', '研发投入'],
] as const;

export function extractCompanyMetrics(pages: ReportPage[]): CompanyReport['metrics'] {
  const metrics: CompanyReport['metrics'] = [];
  const currencyBasis = pages.find(page => /元、万元指人民币元、人民币万元|记账本位币.{0,20}人民币|人民币.{0,12}记账本位币/u.test(compactReportText(page.text)));
  const unitProof = currencyBasis ? (() => {
    const compact = compactReportText(currencyBasis.text);
    const found = /元、万元指人民币元、人民币万元|记账本位币.{0,20}人民币|人民币.{0,12}记账本位币/u.exec(compact)!;
    return { page: currencyBasis.page, text: compact.slice(Math.max(0, found.index - 40), found.index + found[0].length + 100) };
  })() : undefined;
  for (const [id, label] of labels) {
    for (const [index, page] of pages.entries()) {
      const currentText = compactReportText(page.text), previousText = index ? compactReportText(pages[index - 1].text) : '';
      const scopeText = previousText + currentText;
      if (!/主要会计数据|财务报表相关科目变动|主要财务数据同比变动情况/u.test(scopeText)) continue;
      const samePageRmb = /单位[：:]?元.*币种[：:]?人民币/u.test(currentText);
      const rowUnit = new RegExp(label.split('').join('\\s*') + '\\s*[（(]\\s*元\\s*[）)]', 'u').test(page.text);
      const tableUnit = /单位[：:]?元/u.test(currentText) || (!/单位[：:]?/u.test(currentText) && /单位[：:]?元/u.test(previousText));
      if (/币种[：:]?(?:美元|港币|欧元)|单位[：:]?(?:万美元|港元|欧元)/u.test(currentText)) continue;
      if (!samePageRmb && !(currencyBasis && (rowUnit || tableUnit))) continue;
      if (/单位[：:]?万元/u.test(currentText) && !rowUnit) continue;
      const pattern = label.split('').join('\\s*') + `(?:\\s*[（(]\\s*元\\s*[）)])?\\s+${amount}\\s+${amount}\\s+${percentage}`;
      const match = new RegExp(pattern, 'u').exec(page.text);
      if (!match) continue;
      const current = match[1].replace(/[,\s]/gu, ''), previous = match[2].replace(/[,\s]/gu, ''), changePct = match[3].replace(/[,\s]/gu, '');
      const prior = Number(previous), actual = (Number(current) - prior) / Math.abs(prior) * 100;
      // A reported percentage is only accepted when it recomputes from the same row.
      if (!Number.isFinite(actual) || Math.abs(actual - Number(changePct)) > .06) {
        throw new ExternalInformationError('company_report_metric_mismatch', '财报金额与同比列未能一致核对，本次不输出报告。');
      }
      metrics.push({ id, label, current, previous, changePct, unit: '元人民币', page: page.page, excerpt: match[0].slice(0, 1600), ...(!samePageRmb && currencyBasis ? { unitEvidence: unitProof } : {}) });
      break;
    }
  }
  if (metrics.length < 4 || !['revenue', 'profit', 'core-profit', 'cashflow'].every(id => metrics.some(metric => metric.id === id))) {
    throw new ExternalInformationError('company_report_metrics_missing', '财报主要指标提取不完整，本次不猜测数字或报告口径。');
  }
  return metrics;
}

export function selectCompanyEvidence(pages: ReportPage[], target: CompanyReportTarget, metrics: CompanyReport['metrics']): CompanyReport['evidence'] {
  const selected = new Map<number, ReportPage>();
  for (const metric of metrics) { selected.set(metric.page, pages.find(page => page.page === metric.page)!);
    if (metric.unitEvidence) selected.set(metric.unitEvidence.page, pages.find(page => page.page === metric.unitEvidence!.page)!); }
  for (const term of target.evidenceTerms) {
    const page = pages.find(page => compactReportText(page.text).includes(term));
    if (page) selected.set(page.page, page);
  }
  return [...selected.values()].slice(0, COMPANY_REPORT_MAX_EVIDENCE_PAGES).sort((a, b) => a.page - b.page)
    .map(page => ({ id: `P${page.page}`, page: page.page, text: page.text.slice(0, 6000) }));
}

export async function readCompanyDocument(target: CompanyReportTarget, signal?: AbortSignal): Promise<{
  pages: ReportPage[]; totalPages: number; fetchedAt: string; sha256: string; audited: boolean; auditStatus?: 'audited' | 'unaudited' | 'not-stated';
}> {
  const response = await fetch(target.url, { signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(25000)]), redirect: 'error' });
  if (!response.ok) throw new ExternalInformationError('company_report_source_unavailable', '官方财报原文暂时无法读取，请稍后重试。');
  const chunks: Uint8Array[] = []; let size = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new ExternalInformationError('company_report_pdf_invalid', '财报原文为空。');
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
      if (size > 18_000_000) throw new ExternalInformationError('company_report_pdf_too_large', '财报原文超出本次读取上限。');
      chunks.push(next.value); }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = Buffer.concat(chunks);
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new ExternalInformationError('company_report_pdf_invalid', '来源未返回PDF原文。');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false }).promise;
  try {
    if (document.numPages > 500) throw new ExternalInformationError('company_report_pdf_too_large', '财报页数超出本次读取范围。');
    const pages: ReportPage[] = [];
    for (let page = 1; page <= Math.min(document.numPages, 65); page++) {
      signal?.throwIfAborted();
      const content = await (await document.getPage(page)).getTextContent();
      const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
      pages.push({ page, text });
    }
    const cover = compactReportText(pages.slice(0, 3).map(page => page.text).join(''));
    if (!companyCoverIdentityMatches(target.id, target.name, cover) || !cover.includes(`${target.year}年半年度报告`)) throw new ExternalInformationError('company_report_identity_mismatch', '财报企业或期间与请求不一致，已停止分析。');
    const unaudited = /未经审计|未经审核|未经会计师事务所审计/u.test(cover);
    const audited = !unaudited && /已审计|已经审计|标准无保留意见的审计报告/u.test(cover);
    return { pages, totalPages: document.numPages, fetchedAt: new Date().toISOString(), sha256,
      audited, auditStatus: unaudited ? 'unaudited' : audited ? 'audited' : 'not-stated' };
  } finally { await document.destroy(); }
}

/** Repair only decimal glyph gaps seen in PDF table cells; never concatenate adjacent complete figures. */
export function normalizeReportNumericText(value: string): string {
  return value.normalize('NFKC').replace(/\b(20\d)\s+(\d)\b/gu, '$1$2')
    .replace(/(?<![\d.])(\d)[ \t]+(\d)[ \t]+\.[ \t]*(\d+)(?![\d.])/gu, '$1$2.$3')
    .replace(/(\d)\.[ \t]+(\d)/gu, '$1.$2')
    .replace(/(\d+\.\d)[ \t](\d)(?![\d.])/gu, '$1$2')
    .replace(/\d{1,3}(?:,\d{3})+/gu, number => number.replaceAll(',', ''));
}

/** Selected pages cannot establish exhaustive absence or a comparable multi-period trend. */
export function assertCompanyClaimScope(prose: string, source: string): void {
  assertCompanyIncomeDisclosure(prose, source);
  try { assertCompanyBusinessClaim(prose, source); }
  catch { throw new ExternalInformationError('company_report_claim_unsupported', '所引证据不足以支持该经营因果判断，本次未采用。'); }
  source = compactReportText(source);
  const compactProse = compactReportText(prose);
  const sourceBacked = (claim: string) => source.includes(compactReportText(claim));
  const continuous = [...compactProse.matchAll(/连续(?:两|三|四|五|多|[2-9])(?:年|个季度|季度|个半年)[^。；;！？]{0,14}(?:负增长|增长|下降|下滑|承压|增加|减少)|(?:持续|连续)(?:负增长|增长|下降|下滑|增加|减少|加码|攀升|承压)/gu)]
    .filter(match => !/(?:若|如果|假如|一旦|是否|能否|会否)[^。；;！？]{0,30}$/u.test(compactProse.slice(Math.max(0, (match.index ?? 0) - 32), match.index)))
    .map(match => match[0]);
  if (continuous.some(claim => !sourceBacked(claim))) throw new ExternalInformationError('company_report_scope_mismatch', '所引证据未明确支持同口径连续期间变化，本次未采用此趋势判断。');
  const priorPeriod = [...compactProse.matchAll(/(20\d{2})年同期/gu)].map(match => match[0]);
  if (priorPeriod.some(period => !source.includes(period)) && /20\d{2}H1/iu.test(source) && /20\d{2}(?:年)?(?:比上年|同比)|20\d{2}年/u.test(source)) {
    throw new ExternalInformationError('company_report_scope_mismatch', '报告将历史全年列与上半年同期口径混用，本次未采用此比较。');
  }
  const exhaustive = compactProse.match(/(?:未披露|未提及|未公开|没有披露)(?:任何)?(?:境外|海外|国际|出口|国际化)(?:业务)?[^。；;！？]{0,28}|(?:暂无|尚无)(?:国际|海外|境外|实质)(?:业务)?(?:收入|进展|布局|动作|披露)[^。；;！？]{0,12}/gu) ?? [];
  if (exhaustive.some(claim => !sourceBacked(claim))) throw new ExternalInformationError('company_report_claim_unsupported', '局部证据不能证明全部业务未披露或不存在，本次未采用此否定判断。');
  const exclusiveAi = compactProse.match(/(?:AI|人工智能)[^。；;！？]{0,16}(?:仅限于|限于|仅用于|只用于)[^。；;！？]{0,45}|(?:AI|人工智能)[^。；;！？]{0,35}而非(?:研发|产品|供应链)[^。；;！？]{0,20}|(?:AI|人工智能)[^。；;！？]{0,35}(?:尚未|没有|未曾)(?:触及|应用于|进入|涉及)(?:研发|产品|供应链)[^。；;！？]{0,20}|尚未形成[^。；;！？]{0,35}实质性赋能/giu) ?? [];
  if (exclusiveAi.some(claim => !sourceBacked(claim))) throw new ExternalInformationError('company_report_claim_unsupported', '局部AI案例不能证明其应用仅限于某一领域，本次未采用此排他判断。');
  const allBrands = compactProse.match(/(?:各品牌均|全品牌|所有品牌)[^。；;！？]{0,18}(?:线上|在线)[^。；;！？]{0,10}/gu) ?? [];
  if (allBrands.some(claim => !sourceBacked(claim))) throw new ExternalInformationError('company_report_claim_unsupported', '部分品牌的渠道披露不能代表所有品牌，本次未采用此全量判断。');
  if (/翻倍(?:式)?增长|增长(?:了)?一倍|粉饰利润|财务造假|虚增收入|操纵财报/u.test(compactProse)
    && !(compactProse.match(/翻倍(?:式)?增长|增长(?:了)?一倍|粉饰利润|财务造假|虚增收入|操纵财报/gu) ?? []).every(sourceBacked)) {
    throw new ExternalInformationError('company_report_claim_unsupported', '所引原文不支持该增长倍数或指控，本次未采用。');
  }
}

export function validateCompanyAnalysis(analysis: CompanyAnalysis, evidence: CompanyReport['evidence'], metrics: CompanyReport['metrics']): void {
  const byId = new Map(evidence.map(item => [item.id, item]));
  const insights = [analysis.conclusion, ...analysis.sections.flatMap(section => [section.observation, ...(section.interpretation ? [section.interpretation] : []), ...(section.implication ? [section.implication] : [])]), ...analysis.watchpoints];
  for (const insight of insights) {
    if (insight.evidenceIds.some(id => !byId.has(id))) throw new ExternalInformationError('company_report_citation_invalid', '报告引用了不存在的财报证据，本次未采用。');
    const source = compactReportText(insight.evidenceIds.map(id => byId.get(id)!.text).join(''));
    const numericSource = normalizeReportNumericText(insight.evidenceIds.map(id => byId.get(id)!.text).join('\n'));
    const allowed = new Set([...numericSource.matchAll(/\d+(?:\.\d+)?/g)].map(match => match[0]));
    for (const metric of metrics.filter(item => insight.evidenceIds.includes(`P${item.page}`))) {
      for (const value of [Math.abs(Number(metric.changePct)).toFixed(0), Math.abs(Number(metric.changePct)).toFixed(1), metric.current, metric.previous, metric.changePct, (Number(metric.current) / 1e8).toFixed(2), (Number(metric.previous) / 1e8).toFixed(2)]) allowed.add(value.replace(/^-/, ''));
    }
    const prose = insight.text + ('verifyWith' in insight ? ` ${insight.verifyWith}` : '');
    assertCompanyClaimScope(prose, insight.evidenceIds.map(id => byId.get(id)!.text).join('\n'));
    assertCompanyFinancialRatioDirection(prose, metrics, insight.evidenceIds);
    for (const match of prose.replace(/财报第\d+页/gu, '').replace(/\d{1,3}(?:,\d{3})+/g, value => value.replaceAll(',', '')).matchAll(/\d+(?:\.\d+)?/g)) {
      if (!allowed.has(match[0])) { console.error('[company-report-number]', JSON.stringify({ number: match[0], evidenceIds: insight.evidenceIds, text: insight.text })); throw new ExternalInformationError('company_report_number_unsupported', '报告中有数字无法与所引财报对应，本次未采用。'); }
    }
    if ('quote' in insight && String(insight.quote).split('\n').some(piece => !source.includes(compactReportText(piece)))) throw new ExternalInformationError('company_report_quote_unsupported', '报告原文摘录未能在证据中匹配，本次未采用。');
    if (/占(?:公司)?(?:总收入|集团收入)/u.test(prose) && /占(?:公司)?主营业务(?:总)?收入/u.test(source) && !/占(?:公司)?(?:总收入|集团收入)/u.test(source)) throw new ExternalInformationError('company_report_scope_mismatch', '报告把主营业务收入与集团总收入的口径混用了，本次未采用。');
    if (/(?:未披露任何(?:境外|海外|国际)(?:收入|市场|注册|子公司)|尚无(?:国际收入|海外收入|境外收入|实质收入))/u.test(prose) && !/(?:未披露任何(?:境外|海外|国际)|尚无(?:国际收入|海外收入|境外收入|实质收入))/u.test(source)) throw new ExternalInformationError('company_report_claim_unsupported', '所选证据不能证明全部境外业务未披露，本次未采用此结论。');
    if (/采购支出减少[（(]营业成本/u.test(prose)) throw new ExternalInformationError('company_report_scope_mismatch', '报告把采购现金与营业成本口径混用了，本次未采用。');
    if (/超预期|不及预期|市场一致预期|consensus|明年必然|保证增长|一定上涨/iu.test(prose + analysis.headline)) throw new ExternalInformationError('company_report_claim_unsupported', '报告包含未接入预期或确定性预测，本次未采用。');
  }
}
