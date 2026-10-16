import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAssistantFilesRouter } from './assistantFiles';

test('files are actual bytes, scoped to tenant and user, replayable, and failed render has no success receipt', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-export-test-')); let calls = 0;
  const app = express(); app.use(express.json());
  app.use(createAssistantFilesRouter({ root, authorize: (req, res, next) => { res.locals = { tenantId: req.header('x-tenant') || 'a', userId: req.header('x-user') || 'u' }; next(); }, render: async input => { calls++; if (input.content === 'fail') throw new Error('渲染失败'); return input.format === 'pdf' ? Buffer.from('%PDF-1.4\ntest') : Buffer.from([255, 216, 255, 217]); } }));
  const server = app.listen(0); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const create = (content = '支持范围及时间安排', format = 'pdf') => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '双语摘要', content, format }) });
  try {
    const result = await create(); assert.equal(result.status, 201); const { file } = await result.json();
    const download = await fetch(`${base}/${file.id}/content`); assert.equal(download.headers.get('content-type'), 'application/pdf'); assert.match(await download.text(), /^%PDF-/);
    assert.equal((await fetch(`${base}/${file.id}`, { headers: { 'x-tenant': 'b' } })).status, 404);
    assert.equal((await fetch(`${base}/${file.id}`, { headers: { 'x-user': 'v' } })).status, 404);
    assert.equal((await create()).status, 200); assert.equal(calls, 1);
    const jpg = await create('业务路线图', 'jpg'); assert.equal(jpg.status, 201);
    const jpeg = await fetch(`${base}/${(await jpg.json()).file.id}/content`); assert.equal(jpeg.headers.get('content-type'), 'image/jpeg');
    const failed = await create('fail'); assert.equal(failed.status, 503); assert.equal((await failed.json()).file, undefined);
    assert.equal((await create('正文', 'exe')).status, 400);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(root, { recursive: true, force: true }); }
});
