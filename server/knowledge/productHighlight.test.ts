import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { draftProductHighlight } from './productHighlight.js';
import { normalizeProfile } from '../routes/enterpriseProfileStore.js';
import type { EnterpriseProfile } from '../routes/enterpriseProfileContracts.js';
import { createEnterpriseProductHighlightRouter } from '../routes/enterpriseProductHighlight.js';

function profile() {
  return { ...normalizeProfile({ company: { name: '验收企业' }, products: { items: [
    { id: 'chosen', name: '验收变压器', category: '变压器', material: '铜', highlights: '原卖点' },
    { id: 'other', name: '其他产品', highlights: 'OTHER_PRIVATE_MATERIAL' },
  ] } } as EnterpriseProfile), factVersion: { id: 'v1', contentHash: 'hash1', revision: 1, confirmedAt: '', confirmedBy: 'test' } };
}
test('distillation uses only the chosen product, returns an editable single point and does not mutate facts', async () => {
  const p = profile(), before = JSON.stringify(p);
  const draft = await draftProductHighlight(p, 'chosen', 'hash1', async prompt => {
    assert.match(prompt, /验收变压器/); assert.doesNotMatch(prompt, /OTHER_PRIVATE_MATERIAL/);
    return JSON.stringify({ highlight: '铜材质变压器，面向需要该规格产品的采购客户。' });
  });
  assert.equal(draft.productId, 'chosen'); assert.equal(draft.previousHighlight, '原卖点');
  assert.equal(JSON.stringify(p), before);
  for (const output of ['bad-json', '{"highlight":""}', '{"highlight":"第一条\n第二条"}']) await assert.rejects(draftProductHighlight(p, 'chosen', 'hash1', async () => output));
  await assert.rejects(draftProductHighlight(p, 'foreign-id', 'hash1', async () => { throw Error('must not call'); }), /所选产品/);
  await assert.rejects(draftProductHighlight(p, 'chosen', 'old', async () => { throw Error('must not call'); }), /已更新/);
  p.dataGovernance = { ...p.dataGovernance, aiAccessEnabled: false };
  await assert.rejects(draftProductHighlight(p, 'chosen', 'hash1', async () => { throw Error('must not call'); }), /关闭AI/);
});
test('HTTP route binds tenant scope, validates the request and rejects changes during generation', async () => {
  let changed = false, calls = 0;
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { res.locals.tenantId = req.header('x-test-tenant'); next(); });
  app.use(createEnterpriseProductHighlightRouter({ read: async tenant => tenant === 'tenant-a'
    ? { ...profile(), factVersion: { ...profile().factVersion, contentHash: changed ? 'hash2' : 'hash1' } } : null,
    generate: async () => { calls += 1; return '{"highlight":"铜材质变压器，满足对应规格采购需求。"}'; } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const request = (body: unknown, tenant = 'tenant-a') => fetch(`http://127.0.0.1:${port}/product-highlight`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-tenant': tenant }, body: JSON.stringify(body) });
  try {
    const input = { productId: 'chosen', factVersion: 'hash1' };
    const ok = await request(input); assert.equal(ok.status, 200); assert.equal((await ok.json()).draft.productId, 'chosen');
    assert.equal((await request(input, '')).status, 401);
    assert.equal((await request(input, 'tenant-b')).status, 404);
    assert.equal((await request({ ...input, highlight: 'forged' })).status, 400);
    assert.equal((await request({ ...input, factVersion: 'old' })).status, 409);
    assert.equal(calls, 1);
    const racing = express(); racing.use(express.json()); racing.use((_, res, next) => { res.locals.tenantId = 'tenant-a'; next(); });
    racing.use(createEnterpriseProductHighlightRouter({ read: async () => ({ ...profile(), factVersion: { ...profile().factVersion, contentHash: changed ? 'hash2' : 'hash1' } }), generate: async () => { changed = true; return '{"highlight":"一条候选卖点"}'; } }));
    const raceServer = racing.listen(0, '127.0.0.1'); await new Promise<void>(resolve => raceServer.once('listening', resolve));
    try { const r = await fetch(`http://127.0.0.1:${(raceServer.address() as { port: number }).port}/product-highlight`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); assert.equal(r.status, 409); }
    finally { await new Promise<void>(resolve => raceServer.close(() => resolve())); }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
