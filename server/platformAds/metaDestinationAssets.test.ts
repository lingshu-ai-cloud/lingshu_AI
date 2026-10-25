import assert from 'node:assert/strict';
import test from 'node:test';
import { MetaAdsAdapter } from './metaAdapter.js';
import { readMetaDestinationAssets } from './metaDestinationAssets.js';
process.env.META_ADS_API_VERSION = 'v25.0';
test('destination discovery reads only page-scoped active forms with cursor pagination and strips credentials', async () => {
  const reads: string[] = [];
  const adapter = new MetaAdsAdapter('account-secret', (async (url, init) => {
    assert.equal(init?.method, 'GET'); const u = new URL(String(url)); reads.push(u.pathname);
    if (u.searchParams.get('fields') === 'id,access_token') return Response.json({ id: '1', access_token: 'page-secret' });
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer page-secret');
    if (u.pathname.endsWith('/1')) return Response.json({ id: '1', leadgen_tos_accepted: true });
    if (u.searchParams.has('after')) return Response.json({ data: [{ id: '3', name: '报价', status: 'ACTIVE', locale: 'en_US', questions: [{ label: '工作邮箱' }], access_token: 'never-return' }] });
    return Response.json({ data: [{ id: '2', name: '旧表单', status: 'ARCHIVED' }], paging: { next: 'https://untrusted.invalid/?access_token=secret', cursors: { after: 'cursor' } } });
  }) as typeof fetch);
  const result = await readMetaDestinationAssets(adapter, '5', '1', 'forms');
  assert.deepEqual(result.forms, [{ id: '3', name: '报价', locale: 'en_US', questions: ['工作邮箱'] }]);
  assert.equal(result.termsAccepted, true); assert.equal(reads.length, 4);
  assert.doesNotMatch(JSON.stringify(result), /secret|access_token|never-return/);
});
test('permission failures are not converted into an empty successful directory', async () => {
  const adapter = new MetaAdsAdapter('secret', (async () => Response.json({ error: { code: 200, message: 'Permission denied' } }, { status: 403 })) as typeof fetch);
  await assert.rejects(readMetaDestinationAssets(adapter, '5', '1', 'forms'), /Permission denied/);
});
test('website discovery does not require a Page token or form permission', async () => {
  const adapter = new MetaAdsAdapter('secret', (async (url, init) => {
    assert.equal(init?.method, 'GET'); assert.ok(new URL(String(url)).pathname.endsWith('/act_5/adspixels'));
    return Response.json({ data: [{ id: '9', name: '官网', access_token: 'private' }] });
  }) as typeof fetch);
  const result = await readMetaDestinationAssets(adapter, '5', '1', 'pixels');
  assert.deepEqual(result.pixels, [{ id: '9', name: '官网' }]);
});
