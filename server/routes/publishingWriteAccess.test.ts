import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { publishingWriteAccessDecision } from './publishingWriteAccess.js';

assert.equal(publishingWriteAccessDecision({ method: 'GET', supportAccess: true, role: null }), 'allow');
assert.equal(publishingWriteAccessDecision({ method: 'HEAD', supportAccess: false, role: null }), 'allow');
assert.equal(publishingWriteAccessDecision({ method: 'POST', supportAccess: true, role: 'super_admin' }), 'support_read_only');
assert.equal(publishingWriteAccessDecision({ method: 'DELETE', supportAccess: false, role: 'customer_service' }), 'publishing_write_forbidden');
assert.equal(publishingWriteAccessDecision({ method: 'POST', supportAccess: false, role: 'social_operator' }), 'allow');
assert.equal(publishingWriteAccessDecision({ method: 'POST', supportAccess: false, role: 'admin' }), 'allow');

for (const [filename, routerName] of [['social.ts', 'socialRouter'], ['youtube.ts', 'youtubeRouter']] as const) {
  const source = fs.readFileSync(fileURLToPath(new URL(filename, import.meta.url)), 'utf8');
  const authIndex = source.indexOf(`${routerName}.use(requireAuth);`);
  const guardIndex = source.indexOf(`${routerName}.use(requirePublishingWriteAccess);`);
  assert.ok(authIndex >= 0 && guardIndex > authIndex, `${filename} must install the global write guard after authentication`);
  const mutation = new RegExp(`${routerName}\\.(?:post|put|patch|delete)\\(`, 'g');
  for (const match of source.matchAll(mutation)) {
    assert.ok((match.index ?? -1) > guardIndex, `${filename} mutation at ${match.index} bypasses the global write guard`);
  }
  assert.match(source, /valid idempotencyKey is required/, `${filename} direct upload must require a stable idempotency key`);
  assert.match(source, /idempotencyKey[,\s]/, `${filename} must pass the idempotency key into the publisher`);
}

console.log('publishing write access and global route guard contract tests passed');
