import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { REPORT_COMPANIES } from '../server/externalInformation/companyRegistry.js';

if (!process.argv.includes('--run')) throw Error('Use --run for an authorized local feature test against public filings. No model call is requested.');
const origin = 'http://127.0.0.1:5285', directory = path.resolve('artifacts/company-filings', 'live-chat-acceptance');
await fs.mkdir(directory, { recursive: true });
const headers = { Origin: origin, 'Content-Type': 'application/json' };
const denied = await fetch(`${origin}/api/overseas/strategy/chat`, { method: 'POST', headers,
  body: JSON.stringify({ messages: [{ role: 'user', content: '查询美妆企业财报资料库' }] }) });
assert.equal(denied.status, 401);
const session = await fetch(`${origin}/api/overseas/auth/local-preview-session`, { method: 'POST', headers });
assert.equal(session.status, 200);
const { token } = await session.json() as { token: string };
const optionsDenied = await fetch(`${origin}/api/overseas/strategy/company-report-options`);
assert.equal(optionsDenied.status, 401);
const optionsResponse = await fetch(`${origin}/api/overseas/strategy/company-report-options`, { headers: { Authorization: `Bearer ${token}` } });
assert.equal(optionsResponse.status, 200);
const options = await optionsResponse.json() as { companies: Array<{ id: string; reports: Array<{ year: number; status: string }> }> };
assert.equal(options.companies.length, 8);
for (const company of REPORT_COMPANIES) assert.ok(options.companies.find(item => item.id === company.id)?.reports.some(item => item.year === 2026 && item.status === 'available'), company.name);

async function chat(question: string, file: string) {
  const start = Date.now();
  const response = await fetch(`${origin}/api/overseas/strategy/chat`, { method: 'POST', signal: AbortSignal.timeout(180000),
    headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify({ messages: [{ role: 'user', content: question }] }) });
  assert.equal(response.status, 200);
  const raw = await response.text();
  await fs.writeFile(path.join(directory, file), raw);
  assert.ok(raw.includes('data: [DONE]'));
  const events = raw.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
  assert.ok(!events.some(item => item.error || item.companyReport || item.companyReportProgress));
  const text = events.map(event => event.text ?? '').join('');
  assert.ok(text.includes('企业财报资料库'));
  return { text, elapsedMs: Date.now() - start, sources: events.flatMap(event => event.sources ?? []) as Array<{ title: string; uri: string }> };
}
const overview = await chat('查询美妆企业财报资料库', 'pool.sse');
for (const company of REPORT_COMPANIES) assert.ok(overview.text.includes(company.name), company.name);
assert.ok(overview.text.includes('8/8 家企业')); assert.equal(overview.sources.length, 8);
assert.ok(overview.text.includes('快照')); assert.ok(overview.text.includes('不代表刚刚逐家联网刷新'));
const refreshed = await chat('刷新科思股份历史财报目录', 'single-refresh.sse');
assert.ok(refreshed.text.includes('近三年年报 3/3，最近八个报告期 8/8'));
assert.ok(refreshed.text.includes('2023年年度')); assert.ok(refreshed.text.includes('1—9月累计'));
assert.ok(refreshed.text.includes('北京时间')); assert.ok(refreshed.text.includes('尚未启用后台定时监测'));
for (const source of [...overview.sources, ...refreshed.sources]) assert.ok(/^https:\/\/static\.cninfo\.com\.cn\/finalpage\//u.test(source.uri));
const result = { testedAt: new Date().toISOString(), unauthorizedStatus: denied.status, poolCompanies: overview.sources.length, optionsCompanies: options.companies.length, optionsUnauthorizedStatus: optionsDenied.status,
  poolElapsedMs: overview.elapsedMs, singleRefreshElapsedMs: refreshed.elapsedMs, singleHistoryCoverage: 'annual 3/3, recent periods 8/8',
  noModelReportRequested: true, scope: 'local public-source feature acceptance; not production E2E or research-quality acceptance' };
await fs.writeFile(path.join(directory, 'acceptance.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
