import assert from 'node:assert/strict';
import test from 'node:test';
import { socialProgramApi, SocialProgramRequestError } from './socialProgramApi.js';

const storage = {
  getItem: () => 'test-token',
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
} satisfies Storage;

test('social program API rejects an HTML fallback instead of crashing the page', async () => {
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  globalThis.fetch = async () => new Response('<!doctype html><title>stale backend</title>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=UTF-8' },
  });
  try {
    await assert.rejects(
      () => socialProgramApi.list(),
      (error: unknown) => error instanceof SocialProgramRequestError && error.code === 'social_program_invalid_response',
    );
  } finally {
    globalThis.fetch = previousFetch;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage });
  }
});

test('social program API accepts a valid project list', async () => {
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  globalThis.fetch = async () => Response.json({ items: [] });
  try {
    assert.deepEqual(await socialProgramApi.list(), []);
  } finally {
    globalThis.fetch = previousFetch;
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousStorage });
  }
});
