import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const temp = mkdtempSync(path.join(tmpdir(), 'meta-history-'));
process.env.LOCAL_STORE_DIR = temp;
process.env.PB_URL = 'http://127.0.0.1:1';
process.env.NODE_ENV = 'test';
process.env.ENABLE_LOCAL_DEV_FALLBACK = 'true';
const { readMetaAccountHistory, getMetaAccountHistory } = await import('./accountHistory.js');

const account = { id: 'act_123', name: 'Real account', currency: 'CNY', timezone_name: 'Asia/Shanghai', amount_spent: '0' };
const row = { account_id: '123', account_currency: 'CNY', campaign_id: '456', campaign_name: 'Historical campaign', ad_id: '789', ad_name: 'Historical ad', date_start: '2025-01-01', date_stop: '2025-02-01', spend: '12.30', impressions: '150', actions: [{ action_type: 'lead', value: '2' }], purchase_roas: [{ action_type: 'omni_purchase', value: '1.5' }] };
const calls: Array<{ path: string; params: Record<string, unknown>; method: string }> = [];
function reader(pages: any[], options: { billingFails?: boolean; account?: any } = {}) {
  let page = 0;
  return { request: async (path: string, params: Record<string, unknown> = {}, method = 'GET') => {
    calls.push({ path, params, method }); assert.equal(method, 'GET');
    if (path.endsWith('/insights')) return pages[page++];
    if (params.fields === 'id,is_prepay_account') { if (options.billingFails) throw new Error('denied'); return { id: 'act_123', is_prepay_account: false }; }
    return options.account || account;
  } };
}
const empty = await readMetaAccountHistory('123', reader([{ data: [] }]));
assert.equal(empty.hasAccountSpend, false); assert.equal(empty.items.length, 0); assert.equal(empty.complete, true);
assert.equal(empty.billing.prepay, false); assert.ok(!JSON.stringify(empty).includes('token'));
const history = await readMetaAccountHistory('123', reader([{ data: [row], paging: { next: 'https://untrusted.invalid/?access_token=secret', cursors: { after: 'page-2' } } }, { data: [{ ...row, ad_id: '790' }] }]));
assert.equal(history.items.length, 2); assert.equal(history.items[0].metrics.spend, 12.3);
assert.equal(history.items[0].metrics.leads, 2); assert.equal(history.items[0].metrics.messagingConversations, null);
assert.equal(history.items[0].metrics.purchaseRoas, 1.5);
assert.equal(calls.at(-1)?.params.after, 'page-2'); assert.ok(calls.every(c => !c.path.includes('://')));
assert.equal(calls.at(-1)?.params.action_report_time, 'impression');
for (const bad of [{ ...row, account_id: 'other' }, { ...row, account_currency: 'USD' }, { ...row, spend: '0' }, { ...row, date_stop: '2099-01-01' }]) {
  await assert.rejects(readMetaAccountHistory('123', reader([{ data: [bad] }])), /不一致/);
}
await assert.rejects(readMetaAccountHistory('123', reader([{ data: [row, row] }])), /不一致/);
await assert.rejects(readMetaAccountHistory('123', reader([{ data: [], paging: { next: 'https://untrusted.invalid' } }])), /分页/);
const denied = await readMetaAccountHistory('123', reader([{ data: [row] }], { billingFails: true }));
assert.equal(denied.billing.prepay, null); assert.ok(denied.billing.error); assert.equal(denied.items.length, 1);
// Missing connection fails before any provider request; tenant authority is resolved by existing credential guard.
await assert.rejects(getMetaAccountHistory('other-tenant', 'missing'), /未找到/);
rmSync(temp, { recursive: true, force: true });
console.log('account history read-only, ownership, native metrics, pagination and billing tests passed');
