import assert from 'node:assert/strict';
import { readHistoryAccounts } from './historyAccounts.js';
const calls: Array<{ path: string; params: Record<string, unknown> }> = [];
function reader(pages: any[]) {
  let page = 0;
  return { request: async (path: string, params: Record<string, unknown> = {}, method = 'GET') => {
    assert.equal(method, 'GET'); calls.push({ path, params }); return pages[page++];
  } };
}
const accounts = await readHistoryAccounts(reader([{ data: [{ id: 'act_123', name: 'Original', currency: 'CNY' }], paging: { next: 'https://evil.invalid/?access_token=secret', cursors: { after: 'second' } } }, { data: [{ id: 'act_456', name: 'Previously undiscovered', currency: 'CNY' }] }]));
assert.equal(accounts.length, 2); assert.equal(accounts[1].accountId, '456');
assert.equal(calls[1].params.after, 'second'); assert.ok(calls.every(c => c.path === 'me/adaccounts'));
assert.deepEqual(await readHistoryAccounts(reader([{ data: [] }])), []);
for (const bad of [{ id: 'evil', currency: 'CNY' }, { id: 'act_123', currency: '' }]) await assert.rejects(readHistoryAccounts(reader([{ data: [bad] }])), /异常/);
await assert.rejects(readHistoryAccounts(reader([{ data: [], paging: { next: 'bad' } }])), /不完整/);
console.log('read-only authorized account discovery, IDs and cursor tests passed');
