import assert from 'node:assert/strict';
import test from 'node:test';
import { companyReportSceneRequest, fetchCompanyReportOptions } from './companyReportApi';
import { companyReportOptionsSchema } from '../../shared/contracts/companyFilings';

const options = companyReportOptionsSchema.parse({ checkedAt: '2026-10-26T05:00:00Z', companies: [
  { id: 'bloomage', name: '华熙生物', code: '688363', segment: '生物原料', sourceCheckedAt: '2026-10-26T05:00:00Z',
    reports: [{ year: 2026, period: '2026年半年度', publishedAt: '2026-08-28', status: 'available' }] },
  { id: 'cosmos', name: '科思股份', code: '300856', segment: '化妆品原料', sourceCheckedAt: '2026-10-26T05:00:00Z',
    reports: [{ year: 2026, period: '2026年半年度', publishedAt: '2026-08-27', status: 'available' },
      { year: 2025, period: '2025年半年度', publishedAt: '2025-08-20', status: 'needs_review' }] },
] });

test('report confirmation binds the selected company and explicit report period, not the first default company', () => {
  const request = companyReportSceneRequest(options, 'cosmos', 2026);
  assert.equal(request.companyId, 'cosmos'); assert.equal(request.year, 2026);
  assert.match(request.text, /科思股份2026年半年度报告/u);
  assert.ok(!request.text.includes('华熙生物'));
  assert.throws(() => companyReportSceneRequest(options, 'unknown', 2026), /请选择/u);
  assert.throws(() => companyReportSceneRequest(options, 'cosmos', 2024), /请选择/u);
  assert.throws(() => companyReportSceneRequest(options, 'cosmos', 2025), /请选择/u);
});

test('options use authenticated read-only API and reject malformed or failed responses', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const originalStorage = globalThis.localStorage;
  const storage = { getItem: (key: string) => key === 'overseas_token' ? 'fixture-token' : null };
  Object.assign(globalThis, { window: { localStorage: storage, location: { search: '' } }, localStorage: storage });
  try {
    const controller = new AbortController();
    globalThis.fetch = async (input, init) => {
      assert.equal(input, '/api/overseas/strategy/company-report-options');
      assert.equal(init?.signal, controller.signal);
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer fixture-token');
      assert.ok(!init?.body && !init?.method);
      return Response.json(options);
    };
    assert.deepEqual(await fetchCompanyReportOptions(controller.signal), options);
    globalThis.fetch = async () => Response.json({ companies: [] });
    await assert.rejects(fetchCompanyReportOptions(), /不完整/u);
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(fetchCompanyReportOptions(), /暂时/u);
  } finally { globalThis.fetch = originalFetch; Object.assign(globalThis, { window: originalWindow, localStorage: originalStorage }); }
});
