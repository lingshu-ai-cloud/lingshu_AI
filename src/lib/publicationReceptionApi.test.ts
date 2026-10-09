import assert from 'node:assert/strict';
import test from 'node:test';
import { publicationReceptionApi } from './publicationReceptionApi';
const storage = { getItem: () => 'test-token' };
test('binding POST scopes IDs, preserves numeric next version and cannot mutate the package', async () => {
  const previousFetch = globalThis.fetch; const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), '/api/overseas/social-programs/program%2Fa/operating-packages/package%2Fb/publications/video%2Fc/reception-binding');
    assert.equal(init?.method, 'POST'); assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-token');
    const body = JSON.parse(String(init?.body)); assert.equal(body.packageVersion, 4); assert.equal(body.enterpriseFactHash, 'confirmed-facts'); assert.equal(body.tenantId, undefined);
    return Response.json({ item: { bindingId: 'binding', bindingHash: 'hash' }, planningRevisionRequired: true });
  };
  try { assert.equal((await publicationReceptionApi.save({ programId: 'program/a', packageId: 'package/b', packageVersion: 4, publicationId: 'video/c', cta: 'Ask', enterpriseFactHash: 'confirmed-facts', targets: [] })).bindingId, 'binding'); }
  finally { globalThis.fetch = previousFetch; Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage }); }
});
test('unconfirmed enterprise facts and malformed personnel responses fail explicitly', async () => {
  const previousFetch = globalThis.fetch; const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  globalThis.fetch = async () => Response.json({ version: {}, profile: {} });
  try { await assert.rejects(publicationReceptionApi.facts(), /企业确认资料/); await assert.rejects(publicationReceptionApi.employees(), /人员目录/); }
  finally { globalThis.fetch = previousFetch; Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage }); }
});
