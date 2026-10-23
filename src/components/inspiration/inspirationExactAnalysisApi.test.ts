import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TrendVideo } from '../../lib/inspirationTypes';
import { pauseExactAnalysis, readExactAnalysisRecord, submitExactAnalysis } from './inspirationExactAnalysisApi';

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: () => null },
});

const video = {
  id: 'material-material-1',
  title: 'Reference',
  platform: 'youtube',
  duration: 15,
} as TrendVideo;

test('material exact analysis uses the existing authenticated submission route', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({ status: 'pending', id: 'record-1' }), { status: 202 });
  };
  try {
    assert.equal((await submitExactAnalysis(video)).id, 'record-1');
    assert.equal(request?.url, '/api/overseas/videos/material-exact-analysis');
    assert.equal(request?.init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(request?.init?.body)), {
      materialId: 'material-1', title: 'Reference', platform: 'youtube', duration: 15,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('record exact analysis preserves the force flag and visible server error', async () => {
  const originalFetch = globalThis.fetch;
  let body: unknown;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ error: 'approval required' }), { status: 409 });
  };
  try {
    await assert.rejects(submitExactAnalysis({ ...video, recordId: 'record-2' }, true), /approval required/);
    assert.deepEqual(body, { analysisMode: 'exact', force: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('polling keeps a non-OK response pending and pause surfaces its failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  try {
    assert.equal(await readExactAnalysisRecord('record-3'), null);
    await assert.rejects(pauseExactAnalysis('record-3'), /not found/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
