import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { REPORT_COMPANIES, companyCoverIdentityMatches } from '../server/externalInformation/companyRegistry.js';
import { extractCompanyMetrics, type ReportPage } from '../server/externalInformation/companyReportEvidence.js';

if (!process.argv[2]) throw Error('Pass an existing source-verification artifact directory. This script makes no network or model calls.');
const directory = path.resolve(process.argv[2]);
const results = [];
for (const company of REPORT_COMPANIES) {
  const proofs = JSON.parse(await fs.readFile(path.join(directory, `${company.id}-pdf-proofs.json`), 'utf8')) as Array<{
    year: number; kind: string; status: string; sha256: string; archivedPath: string; url: string;
  }>;
  const latest = proofs.filter(item => item.kind === 'half-year' && item.status === 'verified').sort((a, b) => b.year - a.year)[0];
  let parsedPages: ReportPage[] = [];
  try {
    if (!latest || !path.resolve(latest.archivedPath).startsWith(`${path.join(directory, 'pdfs')}${path.sep}`)) throw Error('No verified in-scope half-year file.');
    const bytes = await fs.readFile(latest.archivedPath);
    if (createHash('sha256').update(bytes).digest('hex') !== latest.sha256) throw Error('Archived file hash changed.');
    const document = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false }).promise;
    const pages: ReportPage[] = [];
    try {
      for (let page = 1; page <= Math.min(document.numPages, 65); page++) {
        const content = await (await document.getPage(page)).getTextContent();
        pages.push({ page, text: content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('') });
      }
    } finally { await document.destroy(); }
    parsedPages = pages;
    const cover = pages.slice(0, 3).map(item => item.text).join('').replace(/\s/gu, '').normalize('NFKC');
    if (!companyCoverIdentityMatches(company.id, company.name, cover) || !cover.includes(`${latest.year}年半年度报告`)) throw Error('Company or period does not match actual cover.');
    const metrics = extractCompanyMetrics(pages);
    const result = { companyId: company.id, company: company.name, status: 'extracted', year: latest.year, url: latest.url, sha256: latest.sha256, metrics };
    results.push(result); console.log(JSON.stringify({ company: company.name, metrics: metrics.length }));
  } catch (error) {
    const result = { companyId: company.id, company: company.name, status: 'not-adapted', year: latest?.year, url: latest?.url,
      error: error instanceof Error ? error.message : String(error) };
    if (parsedPages.length) await fs.writeFile(path.join(directory, `${company.id}-unadapted-pages.json`), JSON.stringify(parsedPages));
    results.push(result); console.log(JSON.stringify(result));
  }
}
await fs.writeFile(path.join(directory, 'metric-extraction.json'), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
if (results.some(item => item.status !== 'extracted')) process.exitCode = 1;
