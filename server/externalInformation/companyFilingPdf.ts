import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ExternalInformationError } from './http.js';
import { companyCoverIdentityMatches, type ReportCompany } from './companyRegistry.js';
import type { FilingKind } from '../../shared/contracts/companyFilings.js';

/** Verify the actual source file and its cover. This is not full statement extraction. */
export async function inspectCompanyFilingPdf(url: string, company: ReportCompany, options: {
  signal?: AbortSignal; fetcher?: typeof fetch; archiveDirectory?: string;
} = {}) {
  if (!/^https:\/\/static\.cninfo\.com\.cn\/finalpage\/\d{4}-\d{2}-\d{2}\/\d+\.pdf$/iu.test(url))
    throw new ExternalInformationError('filing_url_invalid', '只读取官方目录中符合格式的财报PDF。');
  const signal = AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(30000)]);
  const response = await (options.fetcher ?? fetch)(url, { signal, redirect: 'error' });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new ExternalInformationError('filing_pdf_unavailable', '财报原文暂时无法读取。'); }
  const chunks: Uint8Array[] = []; let size = 0;
  const reader = response.body.getReader();
  try { for (;;) { const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 25_000_000) throw new ExternalInformationError('filing_pdf_too_large', '财报原文超过本次读取上限。');
    chunks.push(chunk.value);
  } } finally { await reader.cancel().catch(() => {}); }
  const bytes = Buffer.concat(chunks);
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new ExternalInformationError('filing_pdf_invalid', '原文地址没有返回PDF。');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false }).promise;
  let cover = '';
  try {
    if (document.numPages > 600) throw new ExternalInformationError('filing_pdf_too_large', '财报页数超过本次核验范围。');
    for (let page = 1; page <= Math.min(document.numPages, 3); page++) {
      signal.throwIfAborted();
      const content = await (await document.getPage(page)).getTextContent();
      cover += content.items.map(item => 'str' in item ? item.str : '').join(' ');
    }
    const compact = cover.replace(/\s/gu, '').normalize('NFKC');
    if (!companyCoverIdentityMatches(company.id, company.name, compact)) throw new ExternalInformationError('filing_identity_invalid', 'PDF封面未能确认该企业。');
    const period = /(20\d{2})年?(年度|半年度|第一季度|第三季度|一季度|三季度)报告/u.exec(compact);
    if (!period) throw new ExternalInformationError('filing_period_unverified', 'PDF封面未能确认报告期间。');
    const kind: FilingKind = period[2] === '年度' ? 'annual' : period[2] === '半年度' ? 'half-year' : /一/u.test(period[2]) ? 'q1' : 'q3';
    let archivedPath: string | undefined;
    if (options.archiveDirectory) {
      await fs.mkdir(options.archiveDirectory, { recursive: true });
      archivedPath = path.join(options.archiveDirectory, `${company.id}-${period[1]}-${kind}-${sha256.slice(0, 12)}.pdf`);
      await fs.writeFile(archivedPath, bytes);
    }
    return { companyId: company.id, url, year: Number(period[1]), kind, pages: document.numPages, sha256,
      bytes: bytes.byteLength, fetchedAt: new Date().toISOString(), archivedPath,
      auditStatus: /未经审计|未经审核/u.test(compact) ? 'unaudited' as const : 'not-stated' as const,
      coverExcerpt: cover.slice(0, 3500) };
  } finally { await document.destroy(); }
}
