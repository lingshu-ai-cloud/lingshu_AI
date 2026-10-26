import fs from 'node:fs/promises';
import path from 'node:path';
import { REPORT_COMPANIES } from '../server/externalInformation/companyRegistry.js';
import { chinaDate, discoverCompanyFilings, filingCoverage } from '../server/externalInformation/companyFilings.js';
import { inspectCompanyFilingPdf } from '../server/externalInformation/companyFilingPdf.js';

if (!process.argv.includes('--run')) throw Error('Use --run for an authorized public-source refresh. No model calls are made.');
const now = new Date();
const directory = path.resolve('artifacts/company-filings', now.toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(directory, { recursive: true });
const results = [];
let verificationFailed = false;
for (const company of REPORT_COMPANIES) {
  try {
    const snapshot = await discoverCompanyFilings(company, { now, force: true });
    await fs.writeFile(path.join(directory, `${company.id}.json`), JSON.stringify(snapshot, null, 2));
    const coverage = filingCoverage(snapshot);
    const result = { company: company.name, companyId: company.id, code: company.code, complete: snapshot.complete,
      filings: snapshot.filings.length, annual: coverage.annual.map(item => ({ year: item.year, found: Boolean(item.entry?.filing), needsReview: item.entry?.needsReview ?? true })),
      recent: coverage.recent.map(item => ({ period: item.periodKey, found: Boolean(item.entry?.filing), needsReview: item.entry?.needsReview ?? true })),
      latest: coverage.latest?.periodLabel, latestUrl: coverage.latest?.url, fetchedAt: snapshot.fetchedAt };
    results.push(result); console.log(JSON.stringify(result));
    if (process.argv.includes('--verify-pdfs')) {
      const targets = [...coverage.annual.map(item => item.entry), ...coverage.recent.map(item => item.entry)];
      const unique = new Map(targets.filter(entry => entry?.filing && !entry.needsReview).map(entry => [entry!.filing!.id, entry!.filing!]));
      const proofs = [];
      for (const filing of unique.values()) {
        try {
          const proof = await inspectCompanyFilingPdf(filing.url, company, { archiveDirectory: path.join(directory, 'pdfs') });
          if (proof.year !== filing.year || proof.kind !== filing.kind) throw Error('PDF cover period differs from announcement metadata');
          proofs.push({ filingId: filing.id, status: 'verified', ...proof });
        } catch (error) { verificationFailed = true; proofs.push({ filingId: filing.id, url: filing.url, status: 'failed', error: error instanceof Error ? error.message : String(error) }); }
      }
      await fs.writeFile(path.join(directory, `${company.id}-pdf-proofs.json`), JSON.stringify(proofs, null, 2));
      console.log(JSON.stringify({ company: company.name, pdfsRequested: unique.size, pdfsVerified: proofs.filter(item => item.status === 'verified').length }));
    }
  } catch (error) {
    const result = { company: company.name, companyId: company.id, error: error instanceof Error ? error.message : String(error) };
    results.push(result); console.log(JSON.stringify(result));
  }
}
await fs.writeFile(path.join(directory, 'summary.json'), JSON.stringify({ asOf: chinaDate(now), results }, null, 2));
console.log(JSON.stringify({ directory }));
if (verificationFailed || results.some(result => 'error' in result || !result.complete)) process.exitCode = 1;
