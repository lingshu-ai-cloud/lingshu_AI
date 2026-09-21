import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { DataStore } from '../storage/datastore.js';
import { HeyGenClient } from '../lib/heygen.js';
import { createProductionRouter } from './production.js';
import { newShotProduction, shotFingerprint } from '../../src/lib/shotProduction.js';
import { createProjectRevisionGuard, projectRevisionMatches } from '../lib/projectRevision.js';

test('draft revisions serialize competing saves and reject stale snapshots', async () => {
  const guard = createProjectRevisionGuard(); let revision = 'v1';
  const save = () => guard('tenant:draft', async () => { if (!projectRevisionMatches('v1', revision, true)) return false; await Promise.resolve(); revision = 'v2'; return true; });
  assert.deepEqual(await Promise.all([save(), save()]), [true, false]);
  assert.equal(projectRevisionMatches(undefined, 'v2', true), false);
  assert.equal(projectRevisionMatches(undefined, 'v2', false), true);
  assert.equal(await guard('tenant:draft', async () => projectRevisionMatches('v2', revision, true)), true);
});

test('production router persists jobs, never resubmits uncertain operations, isolates tenants, and never overwrites a draft', async () => {
  const rows = new Map<string, any>(); let seq = 0; let failWrites = false;
  const store: DataStore = {
    async getById<T>(collection: string, id: string) { return structuredClone(rows.get(`${collection}/${id}`) || null) as T | null; },
    async create<T>(collection: string, value: Record<string, unknown>) { if (failWrites) return null; const row = { ...value, id: `r${++seq}` }; rows.set(`${collection}/${row.id}`, structuredClone(row)); return row as T; },
    async update(collection, id, patch) { if (failWrites || !rows.has(`${collection}/${id}`)) return false; rows.set(`${collection}/${id}`, { ...rows.get(`${collection}/${id}`), ...structuredClone(patch) }); return true; },
    async delete(collection, id) { return rows.delete(`${collection}/${id}`); },
    async list<T>(collection: string, query = {}) { const where = (query as { where?: Record<string, unknown> }).where || {}; const items = [...rows.entries()].filter(([key, value]) => key.startsWith(`${collection}/`) && Object.entries(where).every(([field, expected]) => value[field] === expected)).map(([, value]) => structuredClone(value) as T); return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 500 }; },
  };
  const calls: { url: string; body: any; key: string }[] = []; let loseResponse = false;
  const client = new HeyGenClient('unit-test-key', (async (url: string, init: RequestInit) => {
    calls.push({ url, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body, key: (init.headers as Record<string, string>)['Idempotency-Key'] });
    if (loseResponse) { loseResponse = false; throw new Error('network response lost'); }
    if (url.endsWith('/assets')) return new Response(JSON.stringify({ data: { asset_id: 'audio1' } }));
    return new Response(JSON.stringify({ data: init.method === 'POST' ? { video_id: 'remote1' } : { status: 'completed', video_url: 'https://files.heygen.ai/video/test.mp4', duration: 3 } }));
  }) as typeof fetch);
  const context = 'ctx'; const shot = { ...newShotProduction('hello', 'alice'), source: 'avatar' as const, sound: 'source' as const, performancePreset: 'surprise_marketing' as const, emotionIntensity: 0.8 };
  const project = { id: 'draft', tenant_id: 'A', status: 'draft', spec: { ratio: '9:16', shotProductions: { 'video-1:shot1': shot }, shotProductionContext: context, storyboardAssignments: { 'slot-1': 'keep-existing' } } };
  rows.set('studio_projects/draft', project);
  rows.set('studio_production_defaults/defaults', { id: 'defaults', tenant_id: 'A', payload: { preference: 'avatar', defaultPresenterId: 'alice', presenters: [{ id: 'alice', name: 'Alice', avatarId: 'avatar1', voiceId: 'voice1', authorized: true }] } });
  let imports = 0; let budgetDenied = false; let importRejected = true; const audioRefs: Array<{ start: number; duration: number }> = [];
  const app = express(); app.use(express.json()); app.use((req, res, next) => { res.locals.tenantId = req.headers['x-tenant'] || 'A'; next(); });
  app.use(createProductionRouter(store, async () => { if (importRejected) throw new Error('数字人文件缺少音轨'); imports++; return 'new-material'; }, { client, enabled: () => true, reserve: async () => { if (budgetDenied) throw new Error('预算余额不足'); }, prepareAudio: async ref => { audioRefs.push(ref); return new Uint8Array([1, 2, 3]); } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path: string, body?: unknown, tenant = 'A') => fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'x-tenant': tenant }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const input = { projectId: 'draft', assemblyId: 'video-1', shotId: 'shot1', fingerprint: shotFingerprint(shot, context), ratio: '9:16', requestId: 'req1', confirmed: true };
  const previousRate = process.env.HEYGEN_ESTIMATED_CNY_PER_SECOND;
  const previousCap = process.env.HEYGEN_SINGLE_TEST_CAP_CNY;
  const previousMotion = process.env.HEYGEN_MOTION_PROMPT_ENABLED;
  try {
    process.env.HEYGEN_MOTION_PROMPT_ENABLED = 'true';
    assert.equal((await request('/jobs', { ...input, confirmed: false })).status, 400); assert.equal(calls.length, 0);
    const cinematic = { ...shot, avatarMode: 'cinematic' as const };
    project.spec.shotProductions['video-1:shot1'] = cinematic;
    const cinematicResponse = await request('/jobs', { ...input, requestId: 'cinematic', fingerprint: shotFingerprint(cinematic, context) });
    assert.equal(cinematicResponse.status, 400); assert.match((await cinematicResponse.json()).error, /Cinematic \/ Avatar Shots/); assert.equal(calls.length, 0);
    project.spec.shotProductions['video-1:shot1'] = shot;
    assert.equal((await request('/jobs', input)).status, 400); assert.equal(calls.length, 0);
    rows.get('studio_production_defaults/defaults').payload.presenters[0].nativeOrientation = 'landscape';
    assert.equal((await request('/jobs', input)).status, 400); assert.equal(calls.length, 0);
    rows.get('studio_production_defaults/defaults').payload.presenters[0].nativeOrientation = 'portrait';
    process.env.HEYGEN_ESTIMATED_CNY_PER_SECOND = '0.58'; process.env.HEYGEN_SINGLE_TEST_CAP_CNY = '5';
    (project.spec as any).shootingSlots = [{ id: 'shot1', duration: 9 }]; rows.set('studio_projects/draft', project);
    const overCap = await request('/jobs', { ...input, requestId: 'over-cap' });
    assert.equal(overCap.status, 400); assert.match((await overCap.json()).error, /超过单次测试上限 ¥5\.00/); assert.equal(calls.length, 0);
    (project.spec as any).shootingSlots = [{ id: 'shot1', duration: 4 }]; rows.set('studio_projects/draft', project);
    budgetDenied = true; assert.equal((await request('/jobs', input)).status, 400); assert.equal(calls.length, 0); budgetDenied = false;
    assert.equal((await request('/jobs', input, 'B')).status, 400); assert.equal(calls.length, 0);
    failWrites = true; assert.equal((await request('/jobs', input)).status, 400); assert.equal(calls.length, 0); failWrites = false;
    const first = await (await request('/jobs', input)).json(); assert.equal(first.status, 'pending');
    const duplicate = await (await request('/jobs', input)).json(); assert.equal(duplicate.id, first.id); assert.equal(calls.length, 1);
    assert.equal((await request('/jobs', { ...input, requestId: 'parallel-new-id' })).status, 400); assert.equal(calls.length, 1);
    assert.equal(calls[0].body.script, 'hello'); assert.equal(calls[0].body.avatar_id, 'avatar1');
    assert.deepEqual(calls[0].body.engine, { type: 'avatar_iv' }); assert.equal(calls[0].body.expressiveness, 'high'); assert.match(calls[0].body.motion_prompt, /raise eyebrows.*never stretch lips.*original mouth and teeth shape/i);
    assert.deepEqual(await (await request('/jobs?projectId=draft', undefined, 'B')).json(), []);
    assert.equal((await request(`/jobs/${first.id}/refresh`, {}, 'B')).status, 400);
    const rejected = await (await request(`/jobs/${first.id}/refresh`, {})).json();
    assert.equal(rejected.status, 'pending'); assert.equal(rejected.materialId, undefined); assert.match(rejected.error, /技术检查未通过/);
    assert.equal(rows.get(`studio_avatar_jobs/${first.id}`).payload.error, rejected.error);
    assert.equal(calls.filter(call => call.body?.type === 'avatar').length, 1);
    importRejected = false;
    const completed = await (await request(`/jobs/${first.id}/refresh`, {})).json(); assert.equal(completed.materialId, 'new-material'); assert.equal(imports, 1);
    assert.equal(calls.filter(call => call.body?.type === 'avatar').length, 1, 'technical check retry must not create a paid generation');
    await request(`/jobs/${first.id}/refresh`, {}); assert.equal(imports, 1);
    assert.equal(rows.get('studio_projects/draft').spec.storyboardAssignments['slot-1'], 'keep-existing');
    loseResponse = true;
    const uncertain = await (await request('/jobs', { ...input, requestId: 'req2' })).json(); assert.equal(uncertain.status, 'uncertain');
    const beforeRefresh = calls.length;
    const recovered = await (await request(`/jobs/${uncertain.id}/refresh`, {})).json(); assert.equal(recovered.status, 'failed');
    assert.match(recovered.error, /未创建任务，可重新生成/);
    assert.equal(calls.length, beforeRefresh + 1, 'reconciliation may only read the provider task list');
    assert.equal((await request('/jobs', { ...input, requestId: 'reconciled-retry' })).status, 200);
    const shared = { ...shot, sound: 'voiceover' }; project.spec.shotProductions['video-1:shot1'] = shared as typeof shot;
    rows.get('studio_production_defaults/defaults').payload.presenters[0].creationMode = 'expert';
    Object.assign(project.spec, { voiceoverMode: 'upload', voiceoverUrl: '/tts/shared.wav', shootingSlots: [{ id: 'shot1', duration: 3 }] }); rows.set('studio_projects/draft', project);
    const beforeUnaligned = calls.length;
    assert.equal((await request('/jobs', { ...input, requestId: 'unaligned', fingerprint: shotFingerprint(shared as typeof shot, context) })).status, 400);
    assert.equal(calls.length, beforeUnaligned);
    Object.assign(project.spec, { lang: 'en', voiceoverDur: 3, voiceoverAudios: { en: { alignmentSource: 'manual_confirmed', cues: [{ text: 'hello', start: 0.5, end: 2.5 }] } } });
    await request('/jobs', { ...input, requestId: 'req3', fingerprint: shotFingerprint(shared as typeof shot, context) });
    assert.equal(calls.at(-1)!.body.audio_asset_id, 'audio1'); assert.equal(calls.at(-1)!.body.script, undefined);
    assert.deepEqual(calls.at(-1)!.body.engine, { type: 'avatar_v' }); assert.equal(calls.at(-1)!.body.expressiveness, undefined);
    assert.equal(audioRefs.at(-1)?.start, 0.5); assert.equal(audioRefs.at(-1)?.duration, 2);
  } finally {
    if (previousRate === undefined) delete process.env.HEYGEN_ESTIMATED_CNY_PER_SECOND; else process.env.HEYGEN_ESTIMATED_CNY_PER_SECOND = previousRate;
    if (previousCap === undefined) delete process.env.HEYGEN_SINGLE_TEST_CAP_CNY; else process.env.HEYGEN_SINGLE_TEST_CAP_CNY = previousCap;
    if (previousMotion === undefined) delete process.env.HEYGEN_MOTION_PROMPT_ENABLED; else process.env.HEYGEN_MOTION_PROMPT_ENABLED = previousMotion;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
