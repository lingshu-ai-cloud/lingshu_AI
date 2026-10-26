import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { companyReportSchema } from '../shared/contracts/companyReport.js';

if (!process.argv.includes('--run')) throw Error('Add --run only for an authorized real-provider acceptance run.');
const origin = 'http://127.0.0.1:5285';
const directory = path.resolve('artifacts/company-report-acceptance', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(directory, { recursive: true, mode: 0o700 });
const unauthorized = await fetch(`${origin}/api/overseas/strategy/chat`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: '华熙生物2026年半年度报告' }] }) });
assert.equal(unauthorized.status, 401);
const session = await fetch(`${origin}/api/overseas/auth/local-preview-session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' } });
assert.equal(session.status, 200);
const { token } = await session.json() as { token: string };
assert.ok(token.startsWith('local-demo.v1.'));
async function chat(question: string, name: string) {
  const start = Date.now();
  const response = await fetch(`${origin}/api/overseas/strategy/chat`, { method: 'POST',
    signal: AbortSignal.timeout(180000), headers: { Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: question }] }) });
  assert.equal(response.status, 200);
  const text = await response.text();
  await fs.writeFile(path.join(directory, `${name}.sse`), text, { mode: 0o600 });
  const events = text.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
  assert.ok(text.includes('data: [DONE]'));
  console.log(JSON.stringify({ name, elapsedMs: Date.now() - start, phases: events.filter(event => event.companyReportProgress).map(event => event.companyReportProgress), error: events.find(event => event.error) }));
  return { events, elapsedMs: Date.now() - start };
}
const wrong = await chat('解读华熙生物2026年Q2财报', 'unsupported-quarter');
assert.ok(wrong.events.some(event => /不能替代单季/.test(event.text || '')));
assert.ok(!wrong.events.some(event => event.companyReport || event.companyReportProgress));
const actual = await chat('请解读华熙生物2026年半年度报告，拆解整体经营、原料与终端业务、技术产品和海外布局，区分公司披露与分析推断，说明对美妆原料企业的含义，并列出后续验证点。', 'bloomage-h1');
const result = actual.events.find(event => event.companyReport);
if (!result) throw Error('Real report failed; inspect saved SSE. No retry or synthetic success was performed.');
const report = companyReportSchema.parse(result.companyReport);
const expected = { revenue: ['1756179663.09', '-22.32'], profit: ['152789535.21', '-30.82'], 'core-profit': ['129463488.75', '-25.49'], cashflow: ['524173956.77', '140.08'], selling: ['599201796.04', '-25.84'], research: ['211932581.97', '-8.29'], cost: ['562891118.66', '-14.16'], administration: ['226860666.38', '-17.55'] };
for (const [id, [amount, change]] of Object.entries(expected)) {
  const metric = report.metrics.find(item => item.id === id)!;
  assert.equal(metric.current, amount); assert.equal(metric.changePct, change);
}
assert.equal(report.company, '华熙生物'); assert.equal(report.source.latestVerified, false);
assert.equal(report.source.audited, false); assert.ok(report.analysis.sections.length >= 3);
const chineseCharacters = (JSON.stringify(report.analysis).match(/[\u4e00-\u9fff]/g) || []).length;
assert.ok(chineseCharacters >= 1000, 'Report must contain substantive analysis rather than only a short news summary.');
await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
await fs.writeFile(path.join(directory, 'acceptance.json'), JSON.stringify({ run: directory, reportId: report.id,
  elapsedMs: actual.elapsedMs, unauthenticatedStatus: unauthorized.status, wrongPeriodRejected: true,
  expectedMetricsPassed: Object.keys(expected).length, sections: report.analysis.sections.length,
  watchpoints: report.analysis.watchpoints.length, chineseCharacters, reportBytes: Buffer.byteLength(JSON.stringify(report)),
  sourceSha256: report.source.sha256, latestClaim: false, sourceAudited: false,
  note: 'Real feature acceptance, not production readiness or golden business E2E. Browser persistence and visual QA are separate checks.' }, null, 2));
console.log(JSON.stringify({ reportPath: path.join(directory, 'report.json'), reportId: report.id, chineseCharacters, metrics: report.metrics.length, bytes: Buffer.byteLength(JSON.stringify(report)) }));
