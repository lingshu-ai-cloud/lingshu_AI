import assert from 'node:assert/strict';
import test from 'node:test';
import { readImportedAdIssues } from './metaImportedDelivery.js';

const ad = { id: '10', account_id: '123', campaign_id: '456', issues_info: [] };
test('imported campaign checks the owned ads for provider issues', async () => {
  const calls: string[] = [];
  const adapter = { request: async (path: string, params: Record<string, unknown>) => {
    calls.push(path);
    return params.after ? { data: [{ ...ad, id: '11', issues_info: [{ error_code: 1, error_summary: '付款异常 https://example.com/?access_token=secret' }] }] } : { data: [ad], paging: { next: 'ignored', cursors: { after: 'cursor' } } };
  } };
  assert.deepEqual(await readImportedAdIssues(adapter, '123', '456'), { found: true, messages: ['付款异常 [链接]'] });
  assert.deepEqual(calls, ['456/ads', '456/ads']);
  assert.deepEqual(await readImportedAdIssues({ request: async () => ({ data: [ad] }) }, '123', '456'), { found: false, messages: [] });
  assert.deepEqual(await readImportedAdIssues({ request: async () => ({ data: [] }) }, '123', '456'), { found: null, messages: [] });
  assert.deepEqual(await readImportedAdIssues({ request: async () => ({ data: [{ ...ad, issues_info: undefined }] }) }, '123', '456'), { found: null, messages: [] });
});
test('foreign ads, duplicate ads and unsafe pagination are rejected', async () => {
  for (const rows of [[{ ...ad, account_id: '999' }], [{ ...ad, campaign_id: '999' }], [ad, ad]]) {
    await assert.rejects(readImportedAdIssues({ request: async () => ({ data: rows }) }, '123', '456'), /归属/);
  }
  await assert.rejects(readImportedAdIssues({ request: async () => ({ data: [], paging: { next: 'untrusted-url' } }) }, '123', '456'), /分页/);
});
