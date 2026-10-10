import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import ffmpeg from 'ffmpeg-static';
import { prepareWeeklyQualityAuditFixture } from '../runtime/weeklyContentQualityAudit.fixture.js';
import { createExactShotMaterializationService } from '../lib/referenceExactShotMaterialization.js';
import { socialRequestHash } from '../starter198/socialContentValidation.js';
import { registerReferenceExactShotMaterializationRoutes } from './referenceExactShotMaterialization.js';

test('registered HTTP command extracts real owned shots and rejects auth, scope and stale analysis', async t => {
  assert.ok(ffmpeg);
  const f = await prepareWeeklyQualityAuditFixture(); t.after(f.cleanup);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reference-shot-http-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'tenants/t/reference-videos'); await fs.mkdir(folder, { recursive: true });
  const source = path.join(folder, 'http-source.mp4');
  await promisify(execFile)(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'testsrc2=size=160x180:rate=10', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', source]);
  const sha = createHash('sha256').update(await fs.readFile(source)).digest('hex');
  const analysis = { analysisMode: 'exact', analysisQuality: 'video', analysisRunId: 'http-analysis', contentSha256: sha,
    gemini: { scriptDetails15s: [{ time: '0-1', visual: 'actual test video' }] } };
  await f.store.create('trend_videos', { id: 'http-source', tenantId: 't',
    videoFileId: 'tenants/t/reference-videos/http-source.mp4', aiAnalysis: JSON.stringify(analysis) });
  const app = express(); app.use(express.json());
  // Controlled auth adapter; the command derives scope from auth locals, never request JSON.
  app.use((req, res, next) => { res.locals.tenantId = req.headers['x-test-tenant']; next(); });
  const router = express.Router();
  registerReferenceExactShotMaterializationRoutes(router, f.store,
    { service: createExactShotMaterializationService(f.store, { mediaRoot: root }) });
  app.use('/videos', router);
  const server = app.listen(0); t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/videos/http-source/exact-shot-materialization`;
  const body = { expectedSourceSha256: sha, expectedAnalysisRunId: 'http-analysis', expectedAnalysisHash: socialRequestHash(analysis) };
  const post = (value: unknown, tenant?: string) => fetch(url, { method: 'POST', headers: {
    'Content-Type': 'application/json', ...(tenant ? { 'x-test-tenant': tenant } : {}),
  }, body: JSON.stringify(value) });
  assert.equal((await post(body)).status, 401);
  assert.equal((await post({ ...body, tenantId: 'foreign' }, 't')).status, 400);
  assert.equal((await post(body, 'foreign')).status, 409);
  assert.equal((await post({ ...body, expectedAnalysisHash: '0'.repeat(64) }, 't')).status, 409);
  const response = await post(body, 't'); assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const result = await response.json(); assert.equal(result.item.status, 'materialized'); assert.equal(result.item.shots.length, 1);
  assert.equal((await post({ ...body, expectedAnalysisHash: result.item.analysisHash }, 't')).status, 200);
  assert.equal(f.tables.starter_usage_ledger?.length ?? 0, 0);
  assert.equal(f.tables.content_execution_jobs?.length ?? 0, 0);
});
