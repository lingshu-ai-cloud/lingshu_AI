import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sameAssistantRequestIdentity, withAssistantIdleTimeout } from './assistantRequestLifecycle';

const scope = { userId: 'user', tenantId: 'tenant' };
const token = (claims: object) => `local-demo.v1.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
test('same principal refresh keeps response; logout, account or tenant change cannot', () => {
  const initial = token({ sub: 'user', tenantId: 'tenant', iat: 1 });
  assert.equal(sameAssistantRequestIdentity(initial, token({ sub: 'user', tenantId: 'tenant', iat: 2 }), scope), true);
  for (const changed of [null, 'opaque-other', token({ sub: 'other', tenantId: 'tenant' }), token({ sub: 'user', tenantId: 'other' })]) {
    assert.equal(sameAssistantRequestIdentity(initial, changed, scope), false);
  }
  assert.equal(sameAssistantRequestIdentity('opaque', 'opaque', scope), true);
  assert.equal(sameAssistantRequestIdentity('opaque', 'different', scope), false);
});
test('PocketBase identity refresh retains user isolation', () => {
  const jwt = (claims: object) => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  assert.equal(sameAssistantRequestIdentity(jwt({ id: 'user', collectionId: 'users', exp: 1 }), jwt({ id: 'user', collectionId: 'users', exp: 2 }), scope), true);
  assert.equal(sameAssistantRequestIdentity(jwt({ id: 'user', collectionId: 'users' }), jwt({ id: 'user', collectionId: 'admins' }), scope), false);
});
test('idle timeout rejects stalled operation and aborts transport', async () => {
  const controller = new AbortController();
  await assert.rejects(withAssistantIdleTimeout(new Promise(() => {}), controller, 5), /等待时间较长/);
  assert.equal(controller.signal.aborted, true);
});
test('completed operation clears idle timer', async () => {
  const controller = new AbortController();
  assert.equal(await withAssistantIdleTimeout(Promise.resolve('chunk'), controller, 5), 'chunk');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(controller.signal.aborted, false);
});
