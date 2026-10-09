import assert from 'node:assert/strict';
import test from 'node:test';
import { createReceptionPublicUrlProbe, receptionPublicAddress } from './publicationReceptionUrlProbe.js';

const body = async function* () { yield Buffer.from('live resource'); };
test('blocks private, loopback, metadata and IPv6 transition addresses before any connection', async () => {
  const unsafe = ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '100.64.0.1', '::1', 'fc00::1', 'fec0::1', '::ffff:127.0.0.1', '2002:7f00:1::1', '2001:0:1::1'];
  for (const address of unsafe) assert.equal(receptionPublicAddress(address), false, address);
  let called = false;
  const probe = createReceptionPublicUrlProbe({ resolve: async () => [{ address: '169.254.169.254', family: 4 }], transport: async () => { called = true; throw Error('must not connect'); } });
  await assert.rejects(probe('https://public.test/'), /private_address/); assert.equal(called, false);
});
test('pins exactly the validated address and checks every redirected hostname', async () => {
  const resolutions: string[] = []; const connections: string[] = [];
  const probe = createReceptionPublicUrlProbe({ resolve: async hostname => { resolutions.push(hostname); return [{ address: hostname === 'destination.test' ? '10.0.0.1' : '93.184.216.34', family: 4 }]; }, transport: async (url, pinned) => { connections.push(`${url.hostname}:${pinned.address}`); return { status: 302, location: 'https://destination.test/spec', body: body(), close() {} }; } });
  await assert.rejects(probe('https://source.test/'), /private_address/);
  assert.deepEqual(resolutions, ['source.test', 'destination.test']); assert.deepEqual(connections, ['source.test:93.184.216.34']);
});
test('public redirect returns evidence for original checked URL and bounded successful body', async () => {
  let calls = 0; let closed = 0;
  const probe = createReceptionPublicUrlProbe({ resolve: async () => [{ address: '93.184.216.34', family: 4 }], transport: async () => ++calls === 1 ? { status: 302, location: '/spec.pdf', body: body(), close() { closed++; } } : { status: 200, body: body(), close() { closed++; } } });
  const result = await probe('https://example.test/'); assert.equal(result.accessible, true); assert.equal(result.checkedUrl, 'https://example.test/'); assert.match(result.evidenceId, /^reception_http_[a-f0-9]{64}$/); assert.equal(closed, 2);
});
test('HTTPS credentials, literal addresses and unsafe redirect schemes are rejected', async () => {
  const probe = createReceptionPublicUrlProbe({ resolve: async () => [{ address: '93.184.216.34', family: 4 }], transport: async () => ({ status: 302, location: 'http://localhost/', body: body(), close() {} }) });
  for (const url of ['http://example.test/', 'https://user:secret@example.test/', 'https://127.0.0.1/', 'https://[::1]/', 'https://example.test:8443/']) await assert.rejects(probe(url), /unsafe/);
  await assert.rejects(probe('https://example.test/'), /unsafe/);
});
test('one total timeout bounds stalled DNS and response body', async () => {
  await assert.rejects(createReceptionPublicUrlProbe({ timeoutMs: 5, resolve: () => new Promise(() => {}) })('https://example.test/'), /timeout/);
  let closed = false;
  const probe = createReceptionPublicUrlProbe({ timeoutMs: 5, resolve: async () => [{ address: '93.184.216.34', family: 4 }], transport: async () => ({ status: 200, body: { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }, close() { closed = true; } }) });
  await assert.rejects(probe('https://example.test/'), /timeout/); assert.equal(closed, true);
});
test('404, empty bodies and oversized declared or streamed bodies cannot pass', async () => {
  const run = (status: number, contentLength?: string, maxBytes = 100) => createReceptionPublicUrlProbe({ maxBytes, resolve: async () => [{ address: '93.184.216.34', family: 4 }], transport: async () => ({ status, contentLength, body: body(), close() {} }) })('https://example.test/');
  assert.equal((await run(404)).accessible, false); await assert.rejects(run(200, '101'), /too_large/); await assert.rejects(run(200, undefined, 1), /too_large/);
  const empty = createReceptionPublicUrlProbe({ resolve: async () => [{ address: '93.184.216.34', family: 4 }], transport: async () => ({ status: 200, body: (async function* () {})(), close() {} }) });
  assert.equal((await empty('https://example.test/')).accessible, false);
});
test('mixed public and private DNS and redirect loops never pass', async () => {
  const mixed = createReceptionPublicUrlProbe({ resolve: async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }] });
  await assert.rejects(mixed('https://example.test/'), /private_address/);
  let calls = 0;
  const loop = createReceptionPublicUrlProbe({ resolve: async () => [{ address: '93.184.216.34', family: 4 }], transport: async () => { calls++; return { status: 302, location: '/again', body: body(), close() {} }; } });
  await assert.rejects(loop('https://example.test/'), /redirect_limit/); assert.equal(calls, 4);
});
