import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  authorizeRenderRequests,
  REQUIRED_LANGUAGES,
  type Language,
  type RenderRequest,
  type StudioApiClient,
} from './orchestrate-digital-human-p1.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrate-render-batch-'));
const receipt = path.join(root, 'authorization.jsonl');
const requests = Object.fromEntries(REQUIRED_LANGUAGES.map(language => [language, {
  language, duration: 15, ratio: '9:16', materials: [`clip-${language}`], timeline: [],
}])) as Record<Language, RenderRequest>;
const calls: Array<{ pathname: string; body: any }> = [];
const api = {
  async post(pathname: string, body: any) {
    calls.push({ pathname, body });
    return {
      ok: true,
      batchKey: body.batchKey,
      batchFingerprint: 'a'.repeat(64),
      sourceProjectId: body.sourceProjectId,
      reused: false,
      authorizations: REQUIRED_LANGUAGES.map(language => ({
        language,
        token: `secret-${language}`,
        expiresAt: '2030-01-01T00:00:00.000Z',
        manifest: { jobId: `job-${language}`, sourceProjectId: body.sourceProjectId, spec: { language } },
      })),
    };
  },
} as unknown as StudioApiClient;

try {
  await authorizeRenderRequests(api, requests, receipt, 'project-1');
  assert.equal(calls.length, 1, 'all three languages must use one atomic authorization call');
  assert.equal(calls[0]!.pathname, 'render/authorizations/trilingual');
  assert.deepEqual(calls[0]!.body.renders.map((item: any) => item.language), ['zh', 'en', 'es']);
  const records = fs.readFileSync(receipt, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(records.filter(record => record.type === 'batch').length, 1);
  assert.equal(records.filter(record => record.type === 'authorization').length, 3);
  assert.equal(records.some(record => record.type === 'failure'), false);
  console.log('orchestrate digital-human render batch tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
