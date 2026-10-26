import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { companyFilingSchema, companyFilingsSnapshotSchema, type CompanyFiling, type CompanyFilingsSnapshot, type FilingKind } from '../../shared/contracts/companyFilings.js';
import { externalJson, ExternalInformationError, object } from './http.js';
import type { ReportCompany } from './companyRegistry.js';
import { inspectCompanyFilingPdf } from './companyFilingPdf.js';

export const CNINFO_IDENTITY = 'https://www.cninfo.com.cn/new/information/topSearch/query';
export const CNINFO_ANNOUNCEMENTS = 'https://www.cninfo.com.cn/new/hisAnnouncement/query';
const categories = 'category_ndbg_szsh;category_bndbg_szsh;category_yjdbg_szsh;category_sjdbg_szsh';
export const chinaDate = (date: Date) => new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
const periodInfo: Record<FilingKind, { rank: number; label: string; end: string }> = {
  q1: { rank: 0, label: '第一季度（1—3月）', end: '03-31' },
  'half-year': { rank: 1, label: '半年度（1—6月）', end: '06-30' },
  q3: { rank: 2, label: '第三季度报告（1—9月累计）', end: '09-30' },
  annual: { rank: 3, label: '年度（1—12月）', end: '12-31' },
};
export const filingRank = (filing: Pick<CompanyFiling, 'year' | 'kind'>) => filing.year * 4 + periodInfo[filing.kind].rank;

export function parseCompanyFiling(value: unknown, company: ReportCompany, orgId: string, from: string, through: string, coverPeriod?: { year: number; kind: FilingKind }): CompanyFiling | null {
  const row = object(value);
  if (row.secCode !== company.code || String(row.orgId) !== orgId) throw new ExternalInformationError('filing_scope_mismatch', '公告企业身份不一致，已停止采用该数据。');
  const title = String(row.announcementTitle ?? '').replace(/<[^>]*>/gu, '').replace(/&nbsp;/gu, ' ').trim();
  if (/摘要|英文|英语|English/iu.test(title)) return null;
  const match = /(20\d{2})年?(年度|半年度|第一季度|第三季度|一季度|三季度)报告/u.exec(title);
  if (!match && !coverPeriod) return null;
  const tail = match ? title.slice(match.index + match[0].length) : '';
  const form = /更正|修订/u.test(title) && /公告|说明/u.test(tail) ? 'correction-notice' : 'full';
  if (form === 'full' && !/^(?:全文)?(?:[（(][^()（）]{0,40}[)）])?$/u.test(tail.replace(/\s/gu, ''))) return null;
  const kind: FilingKind = match ? (match[2] === '年度' ? 'annual' : match[2] === '半年度' ? 'half-year' : /一/u.test(match[2]) ? 'q1' : 'q3') : coverPeriod!.kind;
  const year = match ? Number(match[1]) : coverPeriod!.year, published = Number(row.announcementTime);
  if (!Number.isFinite(published)) throw new ExternalInformationError('filing_date_invalid', '公告缺少有效披露日期。');
  const publishedAt = chinaDate(new Date(published));
  const periodEnd = `${year}-${periodInfo[kind].end}`;
  if (publishedAt < from || publishedAt > through || periodEnd > through || publishedAt < periodEnd) throw new ExternalInformationError('filing_date_invalid', '公告日期或报告期间超出查询范围。');
  const adjunct = String(row.adjunctUrl ?? '');
  if (!/^finalpage\/\d{4}-\d{2}-\d{2}\/\d+\.pdf$/iu.test(adjunct) || String(row.adjunctType).toUpperCase() !== 'PDF')
    throw new ExternalInformationError('filing_url_invalid', '公告原文地址不符合官方PDF格式。');
  return companyFilingSchema.parse({ id: String(row.announcementId), companyId: company.id, code: company.code,
    title, year, kind, periodKey: `${year}-${kind}`, periodLabel: `${year}年${periodInfo[kind].label}`, periodEnd,
    publishedAt, url: `https://static.cninfo.com.cn/${adjunct}`, form, revised: /更正|修订|更新/u.test(title), periodBasis: match ? 'title' : 'pdf-cover' });
}

export type FilingsDependencies = { fetcher?: typeof fetch; signal?: AbortSignal; now?: Date; storeDir?: string; force?: boolean };
const cache = new Map<string, CompanyFilingsSnapshot>();
const active = new Map<string, Promise<CompanyFilingsSnapshot>>();

export async function readCompanyFilingsSnapshot(company: ReportCompany, storeDir?: string): Promise<CompanyFilingsSnapshot | undefined> {
  try {
    const snapshot = companyFilingsSnapshotSchema.parse(JSON.parse(await fs.readFile(path.join(storeDir ?? path.resolve('data/local-store/company-filings'), `${company.id}.json`), 'utf8')));
    if (snapshot.companyId !== company.id || snapshot.code !== company.code) throw Error('snapshot_identity_mismatch');
    return snapshot;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
    throw new ExternalInformationError('filing_snapshot_invalid', '本地财报目录无法核验，未覆盖既有记录。');
  }
}

/** The POSTs below are fixed public read-only searches. No cookies, keys, or user-supplied endpoints. */
async function queryRows(company: ReportCompany, orgId: string, from: string, through: string, keyword: string,
  options: FilingsDependencies): Promise<{ rows: unknown[]; complete: boolean }> {
  const rows: unknown[] = []; let total: number | undefined;
  for (let page = 1; page <= 4; page++) {
    const body = new URLSearchParams({ pageNum: String(page), pageSize: '30', column: company.code.startsWith('6') ? 'sse' : 'szse',
      tabName: 'fulltext', stock: `${company.code},${orgId}`, searchkey: keyword, category: keyword ? '' : categories,
      seDate: `${from}~${through}`, isHLtitle: 'false' });
    const raw = object(await externalJson(new URL(CNINFO_ANNOUNCEMENTS), { signal: options.signal, fetcher: options.fetcher,
      timeoutMs: 15000, init: { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() } }));
    if (!Number.isSafeInteger(raw.totalRecordNum) || Number(raw.totalRecordNum) < 0 || typeof raw.hasMore !== 'boolean'
      || !(Array.isArray(raw.announcements) || (raw.announcements === null && raw.totalRecordNum === 0)))
      throw new ExternalInformationError('filing_response_invalid', '公告列表格式不完整，本次不能确认覆盖范围。');
    if (total !== undefined && total !== raw.totalRecordNum) throw new ExternalInformationError('filing_query_changed', '分页期间公告列表发生变化，请重新查询。');
    total = Number(raw.totalRecordNum);
    const pageRows = Array.isArray(raw.announcements) ? raw.announcements : [];
    rows.push(...pageRows);
    if (pageRows.length > 30) throw new ExternalInformationError('filing_response_invalid', '公告分页超出请求上限。');
    if (!raw.hasMore) return { rows, complete: rows.length === total && new Set(rows.map(item => String(object(item).announcementId))).size === rows.length };
    if (!pageRows.length) return { rows, complete: false };
  }
  return { rows, complete: false };
}

async function discover(company: ReportCompany, options: FilingsDependencies): Promise<CompanyFilingsSnapshot> {
  const now = options.now ?? new Date(), through = chinaDate(now), year = Number(through.slice(0, 4));
  const from = `${year - 3}-01-01`;
  const identityUrl = new URL(CNINFO_IDENTITY);
  identityUrl.search = new URLSearchParams({ keyWord: company.code, maxNum: '10' }).toString();
  const identities = await externalJson(identityUrl, { signal: options.signal, fetcher: options.fetcher, timeoutMs: 15000, init: { method: 'POST' } });
  const exact = Array.isArray(identities) ? identities.map(object).filter(item => item.code === company.code && item.category === 'A股') : [];
  if (exact.length !== 1 || ![company.name, ...company.aliases].some(name => name === String(exact[0].zwjc)) || !/^[\w-]{2,40}$/u.test(String(exact[0].orgId)))
    throw new ExternalInformationError('filing_identity_invalid', '证券代码与企业名称未能在官方目录中一致核对。');
  const orgId = String(exact[0].orgId);
  const groups = [];
  // Sequential bounded queries keep request pressure low and capture correction notices outside report categories.
  for (const keyword of ['', '更正', '修订']) groups.push(await queryRows(company, orgId, from, through, keyword, options));
  const byId = new Map<string, CompanyFiling>();
  for (const group of groups) for (const row of group.rows) {
    let filing = parseCompanyFiling(row, company, orgId, from, through);
    const candidate = object(row), title = String(candidate.announcementTitle ?? '');
    if (!filing && !/20\d{2}|摘要|英文/u.test(title) && /(?:年度|半年度|第一季度|第三季度)报告$/u.test(title)) {
      const cover = await inspectCompanyFilingPdf(`https://static.cninfo.com.cn/${candidate.adjunctUrl}`, company, options);
      filing = parseCompanyFiling(row, company, orgId, from, through, cover);
    }
    if (!filing || filing.year < year - 3) continue;
    const prior = byId.get(filing.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(filing)) throw new ExternalInformationError('filing_version_conflict', '同一公告编号返回了不同内容，本次停止采用。');
    byId.set(filing.id, filing);
  }
  const filings = [...byId.values()].sort((a, b) => filingRank(b) - filingRank(a) || b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id));
  let previous: CompanyFilingsSnapshot | undefined;
  const directory = options.storeDir ?? path.resolve('data/local-store/company-filings');
  const file = path.join(directory, `${company.id}.json`);
  try { previous = companyFilingsSnapshotSchema.parse(JSON.parse(await fs.readFile(file, 'utf8'))); }
  catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw new ExternalInformationError('filing_snapshot_invalid', '本地财报目录无法核验，未覆盖既有记录。'); }
  if (previous && (previous.companyId !== company.id || previous.code !== company.code || previous.orgId !== orgId))
    throw new ExternalInformationError('filing_snapshot_invalid', '本地目录的企业身份与官方结果不一致。');
  const old = new Map((previous?.filings ?? []).map(item => [item.id, item]));
  const modified = filings.filter(item => old.has(item.id) && JSON.stringify(old.get(item.id)) !== JSON.stringify(item));
  const removed = (previous?.filings ?? []).filter(item => item.publishedAt >= from && !byId.has(item.id));
  const revisedPeriods = filings.filter(item => !old.has(item.id) && (previous?.filings ?? []).some(prior => prior.periodKey === item.periodKey));
  const snapshot = companyFilingsSnapshotSchema.parse({ version: 1, companyId: company.id, company: company.name, code: company.code, orgId,
    fetchedAt: now.toISOString(), from, through, complete: groups.every(group => group.complete), filings,
    pendingReviewPeriodKeys: [...new Set([...(previous?.pendingReviewPeriodKeys ?? []), ...modified.map(item => item.periodKey),
      ...removed.map(item => item.periodKey), ...revisedPeriods.map(item => item.periodKey)])],
    changes: { addedIds: filings.filter(item => !old.has(item.id)).map(item => item.id),
      removedIds: (previous?.filings ?? []).filter(item => item.publishedAt >= from && !byId.has(item.id)).map(item => item.id),
      changedIds: filings.filter(item => old.has(item.id) && JSON.stringify(old.get(item.id)) !== JSON.stringify(item)).map(item => item.id) } });
  // Preserve complete history and never overwrite a complete index with a truncated query.
  if (snapshot.complete) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const revision = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16);
    await fs.writeFile(path.join(directory, `${company.id}-${revision}.json`), JSON.stringify(snapshot, null, 2), { mode: 0o600 });
    const temp = `${file}.${revision}.tmp`;
    await fs.writeFile(temp, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
    await fs.rename(temp, file);
    if (!options.fetcher && !options.storeDir) cache.set(company.id, snapshot);
  }
  return snapshot;
}

export async function discoverCompanyFilings(company: ReportCompany, options: FilingsDependencies = {}): Promise<CompanyFilingsSnapshot> {
  const cached = !options.fetcher && !options.storeDir && !options.force ? cache.get(company.id) ?? await readCompanyFilingsSnapshot(company) : undefined;
  const now = options.now ?? new Date();
  if (!options.fetcher && !options.storeDir && !options.force && cached && cached.through === chinaDate(now)
    && now.getTime() - Date.parse(cached.fetchedAt) >= 0 && now.getTime() - Date.parse(cached.fetchedAt) < 10 * 60_000) return cached;
  const key = `${options.storeDir ?? 'default'}:${company.id}`;
  if (active.has(key)) throw new ExternalInformationError('filing_discovery_busy', '该企业公告正在查询中，请稍后查看。');
  const run = discover(company, options); active.set(key, run);
  try { return await run; } finally { active.delete(key); }
}

export function selectedFilings(snapshot: CompanyFilingsSnapshot) {
  const groups = new Map<string, CompanyFiling[]>();
  for (const filing of snapshot.filings) groups.set(filing.periodKey, [...(groups.get(filing.periodKey) ?? []), filing]);
  return [...groups.values()].map(items => {
    const full = items.filter(item => item.form === 'full');
    const revised = full.filter(item => item.revised);
    const candidates = revised.length ? revised : full;
    const sorted = candidates.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id));
    const chosen = sorted[0];
    const notices = items.filter(item => item.form === 'correction-notice');
    // Same-day notice/revised PDF sequencing is not guaranteed by the publisher's date-only field.
    const needsReview = !snapshot.complete || !chosen || snapshot.pendingReviewPeriodKeys.includes(chosen.periodKey) || notices.some(item => !chosen.revised || item.publishedAt >= chosen.publishedAt)
      || sorted.filter(item => item.publishedAt === chosen?.publishedAt).length > 1;
    return { filing: chosen, notices, needsReview };
  }).sort((a, b) => (b.filing ? filingRank(b.filing) : -1) - (a.filing ? filingRank(a.filing) : -1));
}

export function filingCoverage(snapshot: CompanyFilingsSnapshot) {
  const selected = selectedFilings(snapshot), currentYear = Number(snapshot.through.slice(0, 4));
  const annualYears = [currentYear - 1, currentYear - 2, currentYear - 3];
  const annual = annualYears.map(year => ({ year, entry: selected.find(item => item.filing?.year === year && item.filing.kind === 'annual') }));
  const latest = selected.find(item => item.filing)?.filing;
  const recent = Array.from({ length: latest ? 8 : 0 }, (_, offset) => {
    const rank = filingRank(latest!) - offset, year = Math.floor(rank / 4);
    const kind = (['q1', 'half-year', 'q3', 'annual'] as const)[rank % 4];
    return { periodKey: `${year}-${kind}`, entry: selected.find(item => item.filing?.year === year && item.filing.kind === kind) };
  });
  return { annual, recent, latest };
}
