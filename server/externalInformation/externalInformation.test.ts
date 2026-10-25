import assert from 'node:assert/strict';
import test from 'node:test';
import { createExchangeRateReader } from './exchangeRates.js';
import { createComtradeReader, type TradeQuery } from './comtrade.js';
import { externalJson } from './http.js';
import { appendInformationSources } from './sourceFooter.js';

const now = Date.parse('2026-10-25T02:00:00Z');
const ratePayload = () => ({ result: 'success', base_code: 'USD', time_last_update_unix: now / 1000 - 3600,
  time_next_update_unix: now / 1000 + 86_400, rates: { USD: 1, CNY: 7.123456, EUR: 0.92 } });
const query: TradeQuery = { year: 2025, reporter: 156, hs: '8504', flow: 'X' };
const row = (partnerCode = 842, primaryValue = 1234.56) => ({ reporterCode: 156, period: '2025', cmdCode: '8504',
  flowCode: 'X', partner2Code: 0, motCode: 0, customsCode: 'C00', partnerCode, partnerISO: 'USA',
  primaryValue, partnerDesc: 'United States', cmdDesc: 'Electrical transformers' });

test('shared FX reader uses current free endpoint, upstream time and hourly cache without inventing dates', async () => {
  let calls = 0;
  const rates = createExchangeRateReader({ now: () => now, fetcher: async input => {
    calls++;
    assert.equal(String(input), 'https://open.er-api.com/v6/latest/USD');
    return Response.json(ratePayload());
  } });
  const first = await rates('USD');
  assert.equal(first.sourceDate, '2026-10-25');
  assert.equal(first.updatedAt, '2026-10-25T01:00:00.000Z');
  assert.equal(first.rates.CNY, '7.123456');
  assert.equal((await rates('USD')).cached, true);
  assert.equal(calls, 1);
  await assert.rejects(rates('../USD'), /币种/);
  assert.equal(calls, 1);
});

test('FX rejects stale, future, missing time and inconsistent base data; failures are not cached', async () => {
  for (const patch of [ { time_last_update_unix: 0 }, { time_last_update_unix: now / 1000 + 3600 },
    { time_next_update_unix: null }, { base_code: 'EUR' }, { rates: { USD: 2 } } ]) {
    let calls = 0;
    const rates = createExchangeRateReader({ now: () => now, fetcher: async () => {
      calls++;
      return Response.json(calls === 1 ? { ...ratePayload(), ...patch } : ratePayload());
    } });
    await assert.rejects(rates('USD'));
    assert.equal((await rates('USD')).cached, false);
    assert.equal(calls, 2);
  }
});

test('Comtrade sends bounded scoped requests; key is only in header, never in citation/cache identity', async () => {
  let calls = 0;
  const trade = createComtradeReader({ now: () => now, apiKey: () => 'test-only-secret', fetcher: async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.pathname, '/data/v1/get/C/A/HS');
    assert.equal(url.searchParams.get('reporterCode'), '156');
    assert.equal(url.searchParams.get('maxRecords'), '500');
    assert.equal(url.searchParams.has('subscription-key'), false);
    assert.equal(new Headers(init?.headers).get('Ocp-Apim-Subscription-Key'), 'test-only-secret');
    return Response.json({ count: 1, data: [row()] });
  } });
  const result = await trade(query);
  assert.equal(result.rows[0].valueUsd, 1234.56);
  assert.ok(!JSON.stringify(result).includes('test-only-secret'));
  assert.equal((await trade(query)).cached, true);
  assert.equal(calls, 1);
});

test('Comtrade preview is keyless, distinguishes empty from zero and does not rank capped samples as complete', async () => {
  const trade = createComtradeReader({ now: () => now, apiKey: () => '', fetcher: async input => {
    assert.equal(new URL(String(input)).pathname, '/public/v1/preview/C/A/HS');
    return Response.json({ count: 500, data: [row(842, 0), { ...row(0, 100), partnerISO: 'W00' }] });
  } });
  const result = await trade(query);
  assert.equal(result.limited, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].valueUsd, 0);
  const empty = createComtradeReader({ now: () => now, apiKey: () => '', fetcher: async () => Response.json({ count: 0, data: [] }) });
  assert.deepEqual((await empty(query)).rows, []);
});

test('Comtrade refuses duplicate versions, scope drift, negative or missing amounts instead of summing', async () => {
  for (const data of [[row(), row()], [{ ...row(), period: '2024' }], [{ ...row(), motCode: 1 }],
    [{ ...row(), primaryValue: null }], [row(842, -1)], [{ ...row(), reporterCode: 842 }]]) {
    const trade = createComtradeReader({ now: () => now, apiKey: () => '', fetcher: async () => Response.json({ count: data.length, data }) });
    await assert.rejects(trade(query));
  }
});

test('external transport does not retry 429, stops on caller cancellation and bounds response sizes', async () => {
  let calls = 0;
  await assert.rejects(externalJson(new URL('https://example.com'), { fetcher: async () => { calls++; return new Response('', { status: 429 }); } }), /限流/);
  assert.equal(calls, 1);
  const controller = new AbortController(); controller.abort(new Error('cancelled-test'));
  await assert.rejects(externalJson(new URL('https://example.com'), { signal: controller.signal, fetcher: async (_input, init) => {
    assert.equal(init?.signal?.aborted, true); throw init?.signal?.reason;
  } }), /cancelled-test/);
  await assert.rejects(externalJson(new URL('https://example.com'), { fetcher: async () => new Response('x'.repeat(2_000_001)) }), /超出/);
});

test('sources are appended in the actual answer, safely escaped and independent of sources events', () => {
  const answer = appendInformationSources('核验结论', [{ title: '[来源]\n正文', uri: 'https://example.com/report(1)' }], new Date(now));
  assert.match(answer, /^核验结论\n\n信息来源/);
  assert.match(answer, /北京时间/);
  assert.ok(answer.endsWith('(https://example.com/report%281%29)'));
  const fenced = appendInformationSources('```copy\n可复制内容', [{ title: '来源', uri: 'https://example.com' }]);
  assert.match(fenced, /可复制内容\n```\n\n信息来源/u);
  assert.match(appendInformationSources('````text\n内容\n```', [{ title: '来源', uri: 'https://example.com' }]), /\n````\n\n信息来源/u);
});
