import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createPersonSwapRouter } from './personSwap.js';
import { ff, prepareSwapVideo, inspectSwapVideo, finishSwapVideo, RunwaySwapClient } from '../lib/runwaySwap.js';
import { publicIPv4 } from '../lib/swapDownload.js';
import type { DataStore } from '../storage/datastore.js';

test('short-video pipeline, ownership, cost confirmation, persistent tasks and duplicate paid submission protection', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'person-swap-test-'));
  await ff(['-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1', '-c:v', 'libx264', '-c:a', 'aac', path.join(root, 'fixture.mp4')]);
  await ff(['-f', 'lavfi', '-i', 'color=c=red:s=320x240', '-frames:v', '1', path.join(root, 'fixture.png')]);
  const video = await fs.readFile(path.join(root, 'fixture.mp4')), image = await fs.readFile(path.join(root, 'fixture.png'));
  let imageCalls = 0, videoCalls = 0, uncertain = false;
  const client = {
    upload: async (file: string) => `runway://${path.basename(file)}`,
    keyframe: async () => { imageCalls++; if (uncertain) throw Error('lost response'); return 'image-task'; },
    video: async () => { videoCalls++; return 'video-task'; },
    status: async (id: string) => ({ status: 'SUCCEEDED', output: [id === 'image-task' ? 'https://example.test/image' : 'https://example.test/video'] }),
  } as unknown as RunwaySwapClient;
  const store = { list: async (_c: string, q: any) => ({ items: q.where.tenant_id === 'A' ? [{ payload: { presenters: [{ id: 'person', name: '企业人物', authorized: true, imageUrl: 'https://example.test/person' }] } }] : [] }) } as unknown as DataStore;
  const opts = { root: path.join(root, 'jobs'), client, config: () => ({ enabled: true, reason: '', image: 1, rate: 2, limit: 6 }), download: async (url: string) => url.endsWith('/video') ? video : image };
  const app = express(); app.use(express.json({ limit: '10mb' })); app.use((req, res, next) => { res.locals.tenantId = req.headers['x-tenant'] || 'A'; next(); }); app.use(createPersonSwapRouter(store, opts));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (route: string, body?: unknown, tenant = 'A') => {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'x-tenant': tenant }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  try {
    const payload = { presenterId: 'person', video: `data:video/mp4;base64,${video.toString('base64')}` };
    assert.equal((await request('/jobs', payload, 'B')).status, 400);
    const created = await request('/jobs', payload); assert.equal(created.status, 200); const id = created.data.id;
    assert.equal(created.data.duration, 1); assert.equal(created.data.generationDuration, 2); assert.equal(created.data.status, 'ready');
    assert.equal((await request(`/jobs/${id}/image`, { confirmed: true, maxCostCny: 0 })).status, 400); assert.equal(imageCalls, 0);
    assert.equal((await request(`/jobs/${id}/image`, { confirmed: true, maxCostCny: 1 }, 'B')).status, 400);
    assert.equal((await request(`/jobs/${id}/image`, { confirmed: true, maxCostCny: 1 })).data.status, 'image_pending');
    await request(`/jobs/${id}/image`, { confirmed: true, maxCostCny: 1 }); assert.equal(imageCalls, 1);
    assert.equal((await request(`/jobs/${id}/refresh`, {})).data.status, 'preview');
    assert.equal((await request(`/jobs/${id}/video`, { confirmed: true, maxCostCny: 4 })).data.status, 'video_pending');
    await request(`/jobs/${id}/video`, { confirmed: true, maxCostCny: 4 }); assert.equal(videoCalls, 1);
    const completed = await request(`/jobs/${id}/refresh`, {}); assert.equal(completed.data.status, 'completed', completed.data.error);
    assert.equal((await request('/jobs', undefined, 'B')).data.length, 0);
    assert.equal((await fetch(`${base}/jobs/${id}/media/output.mp4`, { headers: { 'x-tenant': 'B' } })).status, 400);
    assert.equal((await fetch(`${base}/jobs/${id}/media/output.mp4`)).status, 200);
    uncertain = true;
    const j2 = (await request('/jobs', payload)).data.id;
    assert.equal((await request(`/jobs/${j2}/image`, { confirmed: true, maxCostCny: 1 })).data.status, 'uncertain');
    await request(`/jobs/${j2}/image`, { confirmed: true, maxCostCny: 1 }); await request(`/jobs/${j2}/refresh`, {}); assert.equal(imageCalls, 2);
    const j3 = (await request('/jobs', payload)).data.id;
    assert.match((await request(`/jobs/${j3}/image`, { confirmed: true, maxCostCny: 1 })).data.error, /预算不足/); assert.equal(imageCalls, 2);
  } finally { await new Promise<void>(r => server.close(() => r())); await fs.rm(root, { recursive: true, force: true }); }
});

test('reject overlong or invalid media; silent source remains silent; download IP filter', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'person-swap-media-'));
  try {
    await ff(['-f', 'lavfi', '-i', 'color=s=320x240:r=30', '-t', '10.1', '-c:v', 'libx264', path.join(dir, 'source.mp4')]);
    await assert.rejects(prepareSwapVideo(dir), /10 秒/);
    await fs.writeFile(path.join(dir, 'source.mp4'), 'not a movie'); await assert.rejects(prepareSwapVideo(dir));
    await ff(['-f', 'lavfi', '-i', 'color=s=320x240:r=30', '-t', '10', '-c:v', 'libx264', path.join(dir, 'source.mp4')]);
    const info = await prepareSwapVideo(dir); assert.equal(info.duration, 10); assert.equal(info.hasAudio, false);
    await fs.copyFile(path.join(dir, 'input.mp4'), path.join(dir, 'generated.mp4')); await finishSwapVideo(dir, 10);
    assert.equal((await inspectSwapVideo(path.join(dir, 'output.mp4'))).hasAudio, false);
    for (const ip of ['127.0.0.1', '169.254.169.254', '10.0.0.1', '192.168.1.1', '172.16.1.1', '100.64.0.1', '224.0.0.1']) assert.equal(publicIPv4(ip), false);
    assert.equal(publicIPv4('8.8.8.8'), true);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('Runway official request schema uses videoUri and timestamped keyframe; never retries failed POST', async () => {
  const calls: any[] = [];
  const client = new RunwaySwapClient('test', (async (_url: string, init: RequestInit) => { calls.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ id: 'task' })); }) as typeof fetch);
  await client.video('runway://video', 'runway://frame'); assert.equal(calls[0].model, 'aleph2'); assert.equal(calls[0].videoUri, 'runway://video'); assert.deepEqual(calls[0].keyframes, [{ uri: 'runway://frame', seconds: 0 }]);
  await client.keyframe('scene', 'person', '1024:1024'); assert.equal(calls[1].referenceImages[1].tag, 'person');
  let n = 0; const failed = new RunwaySwapClient('test', (async () => { n++; throw Error('timeout'); }) as typeof fetch); await assert.rejects(failed.video('v', 'k')); assert.equal(n, 1);
});
