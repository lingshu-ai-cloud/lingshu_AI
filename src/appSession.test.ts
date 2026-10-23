import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPage } from './appSession';

test('ordinary entry opens content creation without restoring a previous page', () => {
  const originalWindow = globalThis.window;
  const originalStorage = globalThis.localStorage;
  const location = { pathname: '/', search: '' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => 'digitalEmployees' },
  });
  try {
    assert.equal(loadPage(), 'strategy');
    location.search = '?page=digitalEmployees';
    assert.equal(loadPage(), 'digitalEmployees', 'an explicit deep link remains available');
    location.search = '?page=agentMemory';
    assert.equal(loadPage(), 'strategy', 'a removed page cannot be mounted through an old link');
    location.search = '?page=organizationPermissions';
    assert.equal(loadPage(), 'strategy');
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
  }
});
