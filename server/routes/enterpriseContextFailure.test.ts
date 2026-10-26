import assert from 'node:assert/strict';
import { enterpriseRouter } from './enterprise.js';
import { store } from '../storage/index.js';
const original = store.list;
const originalLog = console.error;
try {
  store.list = async () => { throw new Error('isolated storage failure'); };
  console.error = () => {};
  const route = (enterpriseRouter as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }> }).stack.find(layer => layer.route?.path === '/context')!.route!;
  let status = 200, body: unknown;
  const res = { locals: { tenantId: 'context-failure-test' }, status(code: number) { status = code; return this; }, json(value: unknown) { body = value; return this; } };
  await route.stack[0].handle({}, res, () => {});
  assert.equal(status, 503);
  assert.deepEqual(body, { error: 'tenant_profile_storage_unavailable', message: '企业资料暂时无法读取，请稍后重试' });
  console.log('Enterprise context storage failure is handled without an unhandled rejection or fabricated profile.');
} finally { store.list = original; console.error = originalLog; }
