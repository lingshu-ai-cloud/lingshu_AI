import assert from 'node:assert/strict';
import { pluginApiRequest } from './pluginApi';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (key: string) => key === 'overseas_token' ? 'internal-admin-token' : null },
});

try {
  let captured: { url: string; init?: RequestInit } | null = null;
  const success: typeof fetch = async (url, init) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  assert.deepEqual(await pluginApiRequest<{ ok: boolean }>('/shopify/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, success), { ok: true });
  const capturedRequest = captured as { url: string; init?: RequestInit } | null;
  assert.equal(capturedRequest?.url, '/api/overseas/plugins/shopify/install');
  const headers = new Headers(capturedRequest?.init?.headers);
  assert.equal(headers.get('authorization'), 'Bearer internal-admin-token');
  assert.equal(headers.get('content-type'), 'application/json');

  const forbidden: typeof fetch = async () => new Response(JSON.stringify({ error: 'admin_required' }), { status: 403 });
  await assert.rejects(pluginApiRequest('/', {}, forbidden), /admin_required/);
  const plainError: typeof fetch = async () => new Response('upstream unavailable', { status: 502 });
  await assert.rejects(pluginApiRequest('/translate/run', {}, plainError), /upstream unavailable/);
  const invalidSuccess: typeof fetch = async () => new Response('<html>', { status: 200 });
  await assert.rejects(pluginApiRequest('/', {}, invalidSuccess), /返回格式无效/);
} finally {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
}

console.log('plugin API client security fixtures passed');
