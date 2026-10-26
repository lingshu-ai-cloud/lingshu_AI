import assert from 'node:assert/strict';
import test from 'node:test';
import { saveProductHighlight } from './productHighlightApi';

test('confirmation patches only the selected product with If-Match and verifies readback; conflict never overwrites', async () => {
  const original = globalThis.fetch, storage = globalThis.localStorage;
  Object.assign(globalThis, { localStorage: { getItem: () => null } });
  const snapshot = { factVersion: { contentHash: 'v1' }, products: { items: [{ id: 'a', name: 'A', highlights: 'old' }, { id: 'b', name: 'B', highlights: 'keep' }] } };
  const draft = { productId: 'a', productName: 'A', factVersion: 'v1', previousHighlight: 'old', highlight: 'candidate' };
  let calls = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      calls += 1;
      if (init?.method === 'PATCH') {
        assert.equal((init.headers as Record<string, string>)['If-Match'], 'v1');
        const body = JSON.parse(String(init.body)); assert.deepEqual(Object.keys(body), ['products']);
        assert.deepEqual(body.products.items[1], snapshot.products.items[1]); assert.equal(body.products.items[0].highlights, 'edited');
        return Response.json({ ok: true });
      }
      return Response.json({ ...snapshot, products: { items: [{ ...snapshot.products.items[0], highlights: 'edited' }, snapshot.products.items[1]] } });
    };
    await saveProductHighlight(snapshot, draft, 'edited'); assert.equal(calls, 2);
    calls = 0; globalThis.fetch = async () => { calls += 1; return Response.json({ message: '资料已更新' }, { status: 409 }); };
    await assert.rejects(saveProductHighlight(snapshot, draft, 'edited'), /已更新/); assert.equal(calls, 1);
    await assert.rejects(saveProductHighlight(snapshot, draft, 'edited', () => false), /登录状态/); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; Object.assign(globalThis, { localStorage: storage }); }
});

test('a successful write without matching readback never reports confirmation', async () => {
  const original = globalThis.fetch, storage = globalThis.localStorage;
  Object.assign(globalThis, { localStorage: { getItem: () => null } });
  const snapshot = { factVersion: { contentHash: 'v1' }, products: { items: [{ id: 'a', name: 'A', highlights: 'old' }] } };
  const draft = { productId: 'a', productName: 'A', factVersion: 'v1', previousHighlight: 'old', highlight: 'candidate' };
  try {
    globalThis.fetch = async (_url, init) => Response.json(init?.method === 'PATCH' ? { ok: true } : snapshot);
    await assert.rejects(saveProductHighlight(snapshot, draft, 'edited'), /暂未确认回填结果/);
    globalThis.fetch = async (_url, init) => {
      if (init?.method === 'PATCH') return Response.json({ ok: true });
      throw new Error('readback unavailable');
    };
    await assert.rejects(saveProductHighlight(snapshot, draft, 'edited'), /readback unavailable/);
  } finally { globalThis.fetch = original; Object.assign(globalThis, { localStorage: storage }); }
});
