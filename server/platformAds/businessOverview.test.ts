import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const temp = mkdtempSync(path.join(tmpdir(), 'meta-business-overview-'));
Object.assign(process.env, { LOCAL_STORE_DIR: temp, PB_URL: 'http://127.0.0.1:1', NODE_ENV: 'test', ENABLE_LOCAL_DEV_FALLBACK: 'true' });
const { readMetaBusinessOverview, getMetaBusinessOverview, getMetaAccountSpend, overviewDays } = await import('./businessOverview');
const { store } = await import('../storage/index.js');
const { encryptSecret } = await import('../lib/tenantPlatformApps.js');
const { metaAccountDate } = await import('../../shared/metaPerformance');
const until = metaAccountDate('Asia/Shanghai');
const since = new Date(Date.parse(`${until}T12:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
const base = { account_id: '123', account_currency: 'CNY', date_start: since, date_stop: until, spend: '10', impressions: '100', clicks: '12', inline_link_clicks: '8', actions: [{ action_type: 'lead', value: '2' }, { action_type: 'onsite_conversion.lead_grouped', value: '1' }, { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '3' }] };
const calls: Array<{ path: string; params: any }> = [];
function adapter(mutate: (value: any, params: any) => any = value => value) {
  return { async request(p: string, params: Record<string, any> = {}): Promise<any> {
    calls.push({ path: p, params });
    if (p === 'act_123') return { id: 'act_123', name: 'Test account', currency: 'CNY', timezone_name: 'Asia/Shanghai' };
    if (p === '900') return { id: '900', account_id: '123', creative: { id: '901' } };
    if (p === '901') return { id: '901', account_id: '123', object_story_spec: { page_id: '400', video_data: { video_id: '500' } } };
    assert.equal(p, 'act_123/insights');
    let value: any = { data: [base] };
    if (params.time_increment === 1) value = { data: [{ ...base, date_start: until, date_stop: until }] };
    if (params.breakdowns) value = { data: [{ ...base, [params.breakdowns]: params.breakdowns === 'age' ? '25-34' : params.breakdowns === 'gender' ? 'female' : 'US' }] };
    if (params.level === 'ad') value = { data: [{ ...base, ad_id: '900', ad_name: 'Video' }] };
    return mutate(value, params);
  } };
}
test('account-native totals retain distinct lead definitions, daily dates and actual audiences', async () => {
  const report = await readMetaBusinessOverview('123', 7, adapter());
  assert.equal(report.totals?.leads, 2); assert.equal(report.totals?.instantFormLeads, 1); assert.equal(report.totals?.messagingConversations, 3);
  assert.equal(report.totals?.websiteLeads, null);
  assert.equal(report.topVideos[0]?.asset.videoIds[0], '500');
  assert.equal(report.topVideos[0]?.metrics.spend, 10);
  assert.equal(report.audiences[0].rows[0].label, '25-34');
  assert.equal(report.daily[0].date, until);
  assert.ok(calls.filter(call => call.path.endsWith('insights')).every(call => call.params.action_report_time === 'impression' && call.params.use_unified_attribution_setting === true));
});
test('account spend uses only the account total and rejects incomplete or foreign reports', async () => {
  calls.length = 0;
  const report = await readMetaBusinessOverview('123', 7, adapter((value, params) => {
    assert.equal(params.fields, 'account_id,account_currency,date_start,date_stop,spend');
    return { data: value.data.map((row: any) => ({ account_id: row.account_id, account_currency: row.account_currency, date_start: row.date_start, date_stop: row.date_stop, spend: row.spend })) };
  }), true);
  assert.equal(report.totals?.spend, 10);
  assert.equal(report.totals?.clicks, null, 'unrequested metrics must not be invented');
  assert.deepEqual(calls.map(call => call.path), ['act_123', 'act_123/insights']);
  assert.equal(calls[1].params.level, 'account');
  assert.equal(calls[1].params.time_increment, 'all_days');
  for (const change of [{ account_id: 'other' }, { account_currency: 'USD' }, { date_start: until }]) {
    await assert.rejects(readMetaBusinessOverview('123', 7, adapter(value => ({ data: value.data.map((row: any) => ({ ...row, ...change })) })), true), /不完整/);
  }
  await assert.rejects(readMetaBusinessOverview('123', 7, adapter(value => ({ ...value, paging: { next: 'https://example.invalid' } })), true), /不完整/);
  const since30 = new Date(Date.parse(`${until}T12:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
  const report30 = await readMetaBusinessOverview('123', 30, adapter(value => ({ data: value.data.map((row: any) => ({ ...row, date_start: since30 })) })), true);
  assert.equal(report30.window.since, since30);
  assert.equal(report30.window.until, until);
  const date = '2020-10-27';
  const singleDay = await readMetaBusinessOverview('123', date, adapter(value => ({ data: value.data.map((row: any) => ({ ...row, date_start: date, date_stop: date })) })), true);
  assert.deepEqual(singleDay.window, { since: date, until: date });
  await assert.rejects(readMetaBusinessOverview('123', '2999-10-27', adapter(), true), /有效的历史日期/);
});
test('privacy or unsupported audience breakdowns do not replace data with CRM/targeting', async () => {
  const report = await readMetaBusinessOverview('123', 7, adapter((value, params) => { if (params.breakdowns) throw Error('privacy threshold'); return value; }));
  assert.ok(report.audiences.every(item => !item.available && item.rows.length === 0));
  assert.equal(report.totals?.impressions, 100);
});
test('rejects wrong account, currency, partial totals, duplicate dates and unsafe pagination', async () => {
  for (const change of [{ account_id: 'other' }, { account_currency: 'USD' }, { date_start: until }]) {
    await assert.rejects(readMetaBusinessOverview('123', 7, adapter(value => ({ data: value.data.map((row: any) => ({ ...row, ...change })) }))), /不完整/);
  }
  await assert.rejects(readMetaBusinessOverview('123', 7, adapter((value, params) => params.time_increment === 1 ? { data: [value.data[0], value.data[0]] } : value)), /不完整/);
  await assert.rejects(readMetaBusinessOverview('123', 7, adapter(value => ({ ...value, paging: { next: 'https://untrusted.invalid/?access_token=secret' } }))), /不完整/);
});
test('does not show unverified media as a complete top-video ranking', async () => {
  const reader = adapter();
  const report = await readMetaBusinessOverview('123', 7, { request: async (p, q) => { if (p === '900') throw Error('unverified asset'); return reader.request(p, q); } });
  assert.equal(report.videoRankingComplete, false); assert.equal(report.topVideos.length, 0); assert.ok(report.warnings.length);
});
test('validates period and tenant grant before requesting another account', async () => {
  assert.equal(overviewDays({}), 7); assert.equal(overviewDays({ days: '30' }), 30);
  assert.throws(() => overviewDays({ days: '365' })); assert.throws(() => overviewDays({ access_token: 'no' }));
  await assert.rejects(getMetaBusinessOverview('foreign', 'missing', '123', {}), /未找到/);
});
test('cached spend cannot outlive a revoked or replaced connection', async () => {
  process.env.META_ADS_API_VERSION = 'v99.0';
  const connection = await store.create('platform_ad_connections', { tenant_id: 'cache-tenant', provider: 'meta', accountId: '123', currency: 'CNY', updatedAt: '2026-10-01', tokenCipher: encryptSecret('fixture-token'), authorization: { status: 'healthy', reasonCode: 'AUTH_VALID' } });
  assert.ok(connection);
  const original = globalThis.fetch;
  let calls = 0, spend = '10', release: (() => void) | undefined, started: (() => void) | undefined;
  let hold = false;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const parsed = new URL(String(url));
    if (parsed.hostname !== 'graph.facebook.com') return original(url);
    calls++;
    if (parsed.pathname.endsWith('/insights')) {
      if (hold) await new Promise<void>(resolve => { release = resolve; started?.(); });
      return Response.json({ data: [{ ...base, spend }] });
    }
    return Response.json({ id: 'act_123', name: 'Test account', currency: 'CNY', timezone_name: 'Asia/Shanghai' });
  }) as typeof fetch;
  try {
    assert.equal((await getMetaAccountSpend('cache-tenant', connection.id, '123', {})).totals?.spend, 10);
    assert.equal((await getMetaAccountSpend('cache-tenant', connection.id, '123', {})).totals?.spend, 10);
    assert.equal(calls, 2, 'unchanged authorization can reuse the account and insights response');
    await store.update('platform_ad_connections', connection.id, { authorization: { status: 'revoked', reasonCode: 'AUTH_REVOKED' } });
    await assert.rejects(getMetaAccountSpend('cache-tenant', connection.id, '123', {}), /授权已失效/);
    await store.update('platform_ad_connections', connection.id, { tokenCipher: encryptSecret('new-fixture-token'), authorization: { status: 'healthy', reasonCode: 'AUTH_VALID' } });
    spend = '20';
    assert.equal((await getMetaAccountSpend('cache-tenant', connection.id, '123', {})).totals?.spend, 20, 'a replacement grant does not reuse the prior grant’s data');
    await store.update('platform_ad_connections', connection.id, { tokenCipher: encryptSecret('third-fixture-token') });
    hold = true;
    const requestStarted = new Promise<void>(resolve => { started = resolve; });
    const pending = getMetaAccountSpend('cache-tenant', connection.id, '123', {});
    await requestStarted;
    await store.update('platform_ad_connections', connection.id, { authorization: { status: 'revoked', reasonCode: 'AUTH_REVOKED' } });
    release!();
    await assert.rejects(pending, /授权已失效/, 'late responses cannot cross a revocation');
  } finally { globalThis.fetch = original; }
});
test.after(() => rmSync(temp, { recursive: true, force: true }));
