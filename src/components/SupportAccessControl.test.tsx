import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import SupportAccessControl from './SupportAccessControl';
import { getSupportAccessSetting } from '../lib/supportAccessApi';

const html = renderToStaticMarkup(<SupportAccessControl />);
assert.match(html, /正在读取授权状态/);
assert.doesNotMatch(html, />默认授权<\/button>/);
assert.doesNotMatch(html, />授权关闭<\/button>/);

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'owner-token' } });
try {
  const allowed: typeof fetch = async (_url, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer owner-token');
    return new Response(JSON.stringify({ defaultAuthorized: false }), { status: 200 });
  };
  assert.equal(await getSupportAccessSetting(allowed), false);
  const missing: typeof fetch = async () => new Response('{}', { status: 200 });
  await assert.rejects(getSupportAccessSetting(missing), /授权状态无效/);
  const forbidden: typeof fetch = async () => new Response(JSON.stringify({ error: 'owner_required', message: '只有企业负责人可以操作' }), { status: 403 });
  await assert.rejects(getSupportAccessSetting(forbidden), /只有企业负责人/);
  const offline: typeof fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(getSupportAccessSetting(offline), /offline/);
} finally {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
}

console.log('support access control fail-closed fixtures passed');
