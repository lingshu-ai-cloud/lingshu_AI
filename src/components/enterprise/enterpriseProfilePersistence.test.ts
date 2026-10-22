import assert from 'node:assert/strict';
import test from 'node:test';
import { saveEnterpriseProfileAndVerify } from './enterpriseProfilePersistence';
import { DEFAULT } from './enterpriseProfileState';

const profile = {
  ...DEFAULT,
  products: { ...DEFAULT.products, items: [{ name: '精华液 A', sku: 'A-1' }] },
  factVersion: { id: 'fact-1', revision: 3, contentHash: 'hash-3', confirmedAt: '2026-10-22', confirmedBy: 'user-1' },
};

test('save uses optimistic version and only succeeds after read-back verifies products', async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Response.json(calls.length === 1 ? { ok: true } : profile);
  }) as typeof fetch;
  const confirmed = await saveEnterpriseProfileAndVerify(profile, fetcher, () => ({ Authorization: 'Bearer test' }));
  assert.equal(confirmed.products.items?.[0]?.name, '精华液 A');
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, '/api/overseas/enterprise/profile');
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.equal((calls[0]?.init?.headers as Record<string, string>)['If-Match'], '"hash-3"');
  assert.equal((calls[0]?.init?.headers as Record<string, string>)['x-enterprise-save-source'], 'enterprise_center');
  assert.equal(calls[1]?.url, '/api/overseas/enterprise/profile');
  assert.equal(calls[1]?.init?.method, undefined);
});

test('a successful POST without matching read-back is not treated as saved', async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return Response.json(calls === 1 ? { ok: true } : { ...profile, products: { ...profile.products, items: [] } });
  }) as typeof fetch;
  await assert.rejects(saveEnterpriseProfileAndVerify(profile, fetcher, () => ({})), /产品资料保存后校验失败/);
  assert.equal(calls, 2);
});

test('failed write does not proceed to read-back', async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return Response.json({ error: '版本冲突' }, { status: 409 });
  }) as typeof fetch;
  await assert.rejects(saveEnterpriseProfileAndVerify(profile, fetcher, () => ({})), /版本冲突/);
  assert.equal(calls, 1);
});
