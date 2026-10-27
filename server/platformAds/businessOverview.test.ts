import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const temp = mkdtempSync(path.join(tmpdir(), 'meta-business-overview-'));
Object.assign(process.env, { LOCAL_STORE_DIR: temp, PB_URL: 'http://127.0.0.1:1', NODE_ENV: 'test', ENABLE_LOCAL_DEV_FALLBACK: 'true' });
const { readMetaBusinessOverview, getMetaBusinessOverview, overviewDays } = await import('./businessOverview');
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
test.after(() => rmSync(temp, { recursive: true, force: true }));
