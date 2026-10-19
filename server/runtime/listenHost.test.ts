import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveListenHost } from './listenHost.js';

test('unset host preserves existing deployed bind behavior', () => {
  assert.equal(resolveListenHost(undefined), '0.0.0.0');
});

test('explicit host permits only literal loopback interfaces', () => {
  assert.equal(resolveListenHost('127.0.0.1'), '127.0.0.1');
  assert.equal(resolveListenHost('::1'), '::1');
  for (const unsafe of ['', ' ', 'localhost', '0.0.0.0', '::', '192.168.1.2', '127.0.0.2', '127.0.0.1 ', '[::1]']) {
    assert.throws(() => resolveListenHost(unsafe), /LINGSHU_LISTEN_HOST must be a literal loopback address/);
  }
});
