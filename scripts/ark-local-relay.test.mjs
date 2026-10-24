import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createArkLocalRelay } from './ark-local-relay.mjs';

test('temporary Ark relay denies application, auth and unsigned asset routes', async () => {
  const server = createArkLocalRelay().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/api/overseas/health', '/api/overseas/auth/local-preview-session', '/media/object-storage/test.jpg', '/?arkVerification=complete&next=/api']) {
      const result = await fetch(base + path);
      assert.equal(result.status, 404, path);
    }
    const callback = await fetch(`${base}/?arkVerification=complete`);
    assert.equal(callback.status, 200);
    assert.match(await callback.text(), /返回灵枢本地预览/);
    const mutation = await fetch(`${base}/?arkVerification=complete`, { method: 'POST' });
    assert.equal(mutation.status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
