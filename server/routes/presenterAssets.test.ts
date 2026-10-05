import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { DataStore } from '../storage/datastore.js';
import { createPresenterAssetsRouter } from './presenterAssets.js';
import { validateHeyGenPresenterRecord } from '../lib/presenterAssetTrust.js';
import { HeyGenPresenterClient } from '../lib/heygenPresenters.js';

test('presenter creation, consent, import, tenant isolation, pagination and uncertain requests', async () => {
  const rows = new Map<string, any>(); let seq = 0, failWrites = false, lost = false, approved = false, budgetBlocked = false, trimCalls = 0, frameCalls = 0;
  const store: DataStore = {
    async getById<T>(c: string, id: string) { return structuredClone(rows.get(`${c}/${id}`) || null) as T | null; },
    async create<T>(c: string, value: Record<string, unknown>) { if (failWrites) return null; const row = { ...value, id: `r${++seq}` }; rows.set(`${c}/${row.id}`, structuredClone(row)); return row as T; },
    async update(c, id, patch) { if (failWrites || !rows.has(`${c}/${id}`)) return false; rows.set(`${c}/${id}`, { ...rows.get(`${c}/${id}`), ...structuredClone(patch) }); return true; },
    async delete(c, id) { return rows.delete(`${c}/${id}`); },
    async list<T>(c: string, q = {}) { const where = (q as any).where || {}; const items = [...rows.entries()].filter(([k, v]) => k.startsWith(`${c}/`) && Object.entries(where).every(([key, expected]) => v[key] === expected)).map(([, v]) => structuredClone(v) as T); return { items, totalItems: items.length, totalPages: 1, page: 1, perPage: 100 }; },
  };
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const look = { id: 'public1', name: 'Public presenter', avatar_type: 'studio_avatar', group_id: 'group-public', default_voice_id: 'voice1', preview_image_url: 'https://files.heygen.ai/p.png', image_width: 1080, image_height: 1920 };
  const client = new HeyGenPresenterClient('test-secret', (async (rawUrl: string, init: RequestInit) => {
    const url = new URL(rawUrl), body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url: rawUrl, init, body });
    let data: any = null, meta = {};
    if (url.pathname === '/v3/assets') data = { asset_id: 'uploaded1' };
    else if (url.pathname === '/v3/voices') { data = [{ voice_id: 'voice1', name: 'Sara', language: 'English', type: 'public', preview_audio_url: 'https://files.heygen.ai/s.mp3' }]; meta = { has_more: true, next_token: 'page2' }; }
    else if (url.pathname === '/v3/avatars/looks' && url.searchParams.get('ownership') === 'public') { data = [look]; meta = { has_more: true, next_token: 'page2' }; }
    else if (url.pathname === '/v3/avatars' && init.method === 'POST') { if (lost) throw new Error('response lost'); data = { avatar_group: { id: 'created-group' }, avatar_item: { ...look, id: 'private1', group_id: 'created-group', status: 'processing' } }; }
    else if (url.pathname === '/v3/avatars/created-group') data = { id: 'created-group', status: 'completed', consent_status: approved ? 'accepted' : 'pending' };
    else if (url.pathname === '/v3/avatars/looks/private1') data = { ...look, id: 'private1', status: 'completed', group_id: 'created-group' };
    else if (url.pathname === '/v3/avatars/looks/public1') data = look;
    else if (url.pathname === '/v3/avatars/created-group/consent') data = { avatar_group: { id: 'created-group' }, url: 'https://app.heygen.com/consent/test' };
    else throw new Error(`Unexpected test request ${rawUrl}`);
    return new Response(JSON.stringify({ data, ...meta }));
  }) as typeof fetch);
  const locks = new Map<string, Promise<unknown>>();
  const exclusive = async <T>(key: string, fn: () => Promise<T>): Promise<T> => { const next = (locks.get(key) || Promise.resolve()).catch(() => {}).then(fn); locks.set(key, next); return next; };
  const app = express(); app.use(express.json()); app.use((req, res, next) => { res.locals.tenantId = req.headers['x-tenant'] || 'A'; next(); });
  app.use(createPresenterAssetsRouter(store, exclusive, { client, configured: () => true, enabled: () => true, directConsent: () => false, reserve: async () => { if (budgetBlocked) throw new Error('预算不足'); }, trimVideo: async (_bytes, seconds) => { trimCalls++; assert.equal(seconds, 7); return Buffer.from([0,0,0,0,102,116,121,112,1,2,3,4]); }, extractFrame: async (_bytes, seconds) => { frameCalls++; assert.equal(seconds, 1); return Buffer.from([255,216,255,224,0,16,74,70,73,70,0,1,255,217]); }, inspectVideo: async () => ({ duration: 60, width: 1080, height: 1920, fps: 30, hasAudio: true }) }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (url: string, body?: any, tenant = 'A') => fetch(root + url, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'x-tenant': tenant }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const upload = (requestId: string, bytes = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0])) => fetch(`${root}/uploads?mime=image/png&requestId=${requestId}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
  const creates = () => calls.filter(c => c.url === 'https://api.heygen.com/v3/avatars').length;
  try {
    const capabilities = await (await request('/capabilities')).json();
    assert.equal(capabilities.photoCreationEnabled, true);
    assert.equal(capabilities.digitalTwinCreationEnabled, true);
    const voices = await (await request('/voices?token=abc')).json(); assert.equal(voices.nextToken, 'page2'); assert.equal(voices.items[0].id, 'voice1');
    assert.match(calls.at(-1)!.url, /type=public/); assert.match(calls.at(-1)!.url, /token=abc/);
    const beforePrivate = calls.length;
    assert.equal((await request('/catalog?scope=private', undefined, 'B')).status, 403);
    assert.equal(calls.length, beforePrivate);
    assert.equal((await upload('bad', Buffer.from('not a valid picture'))).status, 400);
    const videoBytes = Buffer.from([0,0,0,0,102,116,121,112,9,8,7,6]);
    const trimmed = await (await fetch(`${root}/uploads?mime=video/quicktime&requestId=video-trim&trimSeconds=7`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: videoBytes })).json();
    assert.equal(trimmed.processedDurationSeconds, 7); assert.equal(trimCalls, 1);
    assert.equal(rows.get(`studio_presenter_assets/${trimmed.id}`).payload.mime, 'video/mp4');
    const extracted = await (await fetch(`${root}/uploads?mime=video/quicktime&requestId=video-frame&frameAtSeconds=1`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: videoBytes })).json();
    assert.equal(extracted.extractedFrame, true); assert.equal(frameCalls, 1);
    assert.equal(rows.get(`studio_presenter_assets/${extracted.id}`).payload.mime, 'image/jpeg');
    const training = await (await fetch(`${root}/uploads?mime=video/quicktime&requestId=training-video&trainingVideo=true`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: videoBytes })).json();
    assert.equal(training.trainingInfo.duration, 60); assert.equal(training.trainingInfo.hasAudio, true);
    failWrites = true; const before = calls.length; assert.equal((await upload('save-failed')).status, 400); assert.equal(calls.length, before); failWrites = false;
    const asset = await (await upload('upload1')).json(); assert.ok(asset.id);
    const assetsBeforeRepeat = calls.filter(c => c.url.endsWith('/assets')).length;
    assert.equal((await (await upload('upload1')).json()).id, asset.id); assert.equal(calls.filter(c => c.url.endsWith('/assets')).length, assetsBeforeRepeat);
    const input = { name: 'Our presenter', type: 'photo', voiceId: 'voice1', uploadId: asset.id, requestId: 'creation1', authorized: true, confirmed: true };
    assert.equal((await request('/creations', { ...input, authorized: false })).status, 400);
    assert.equal((await request('/creations', input, 'B')).status, 400); assert.equal(creates(), 0);
    const pair = await Promise.all([request('/creations', input), request('/creations', input)]); const first = await pair[0].json();
    assert.equal((await pair[1].json()).id, first.id); assert.equal(creates(), 1); assert.equal(first.status, 'pending_consent');
    assert.equal(first.uploadId, undefined); assert.equal(first.fingerprint, undefined);
    assert.deepEqual(calls.find(c => c.url === 'https://api.heygen.com/v3/avatars')!.body.file, { type: 'asset_id', asset_id: 'uploaded1' });
    assert.equal((await request('/creations', { ...input, name: 'changed' })).status, 400);
    assert.equal((await request('/creations', { ...input, requestId: 'duplicate-file' })).status, 400);
    const duplicateUpload = await (await upload('same-file-new-upload-id')).json();
    assert.equal((await request('/creations', { ...input, uploadId: duplicateUpload.id, requestId: 'same-bytes-new-request' })).status, 400);
    assert.equal(creates(), 1);
    assert.deepEqual(await (await request('/creations', undefined, 'B')).json(), []);
    assert.equal((await request(`/creations/${first.id}/refresh`, {}, 'B')).status, 400);
    assert.equal((await request(`/creations/${first.id}/consent`, { requestId: 'c1' }, 'B')).status, 400);
    assert.equal((await request(`/creations/${first.id}/consent`, { requestId: 'c1', uploadId: asset.id })).status, 400);
    const consent = await (await request(`/creations/${first.id}/consent`, { requestId: 'c1' })).json(); assert.match(consent.consentUrl, /heygen.com/); assert.ok(consent.consentRequestedAt);
    const bind = { creationId: first.id, voiceId: 'voice1', authorized: true, reviewed: true };
    assert.equal((await request('/import', bind)).status, 400);
    approved = true;
    const ready = await (await request(`/creations/${first.id}/refresh`, {})).json(); assert.equal(ready.status, 'completed'); assert.equal(ready.consentUrl, undefined); assert.equal(creates(), 1);
    const saved = await (await request('/import', bind)).json(); assert.equal(saved.presenters.length, 1); assert.equal(saved.presenters[0].nativeOrientation, 'portrait'); assert.equal(saved.presenters[0].supportsAlpha, false); assert.equal(saved.presenters[0].creationMode, 'quick');
    assert.equal(validateHeyGenPresenterRecord(saved.presenters[0]).ok, true, 'verified import satisfies the existing generation gate');
    assert.equal((await (await request('/import', bind)).json()).presenters.length, 1);
    assert.equal((await request('/import', bind, 'B')).status, 400);
    assert.equal((await request('/import', { lookId: 'private-other', authorized: true, reviewed: true })).status, 400);
    const catalog = await (await request('/catalog')).json(); assert.equal(catalog.items[0].id, 'public1'); assert.equal(catalog.nextToken, 'page2');
    const stock = await (await request('/import', { lookId: 'public1', authorized: true, reviewed: true })).json(); assert.equal(stock.presenters.length, 2);
    const previousPrivateTenant = process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID;
    try {
      process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID = 'A';
      const samePersonAsset = await (await upload('same-person-new-look', Buffer.from([137,80,78,71,13,10,26,10,0,0,0,2]))).json();
      const reuseInput = { ...input, uploadId: samePersonAsset.id, requestId: 'same-person-reuse', reusePresenterId: saved.presenters[0].id, samePersonConfirmed: true };
      assert.equal((await request('/creations', { ...reuseInput, samePersonConfirmed: false })).status, 400);
      assert.equal((await request('/creations', reuseInput, 'B')).status, 400);
      assert.equal(creates(), 1, 'invalid reuse cannot call the paid provider endpoint');
      const reused = await (await request('/creations', reuseInput)).json();
      assert.equal(reused.status, 'completed', 'accepted consent on the same group is reused');
      assert.equal(creates(), 2);
      assert.equal(calls.filter(c => c.url === 'https://api.heygen.com/v3/avatars').at(-1)?.body.avatar_group_id, 'created-group');
      assert.equal(calls.filter(c => c.url.endsWith('/created-group/consent')).length, 1, 'no second HeyGen consent request');
    } finally {
      if (previousPrivateTenant === undefined) delete process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID;
      else process.env.HEYGEN_PRIVATE_ASSET_TENANT_ID = previousPrivateTenant;
    }
    budgetBlocked = true;
    const secondAsset = await (await upload('upload2', Buffer.from([137,80,78,71,13,10,26,10,0,0,0,1]))).json();
    assert.equal((await request('/creations', { ...input, uploadId: secondAsset.id, requestId: 'budget-denied' })).status, 400); assert.equal(creates(), 2); budgetBlocked = false;
    lost = true;
    const uncertainInput = { ...input, uploadId: secondAsset.id, requestId: 'lost-response' };
    const uncertain = await (await request('/creations', uncertainInput)).json(); assert.equal(uncertain.status, 'uncertain'); assert.equal(creates(), 3);
    assert.equal((await (await request('/creations', uncertainInput)).json()).id, uncertain.id);
    assert.equal((await request(`/creations/${uncertain.id}/refresh`, {})).status, 400); assert.equal(creates(), 3);
    assert.equal((await request('/creations', { ...uncertainInput, requestId: 'new-id-same-file' })).status, 400);
    assert.ok(calls.every(c => c.init.redirect === 'error'));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('adapter submits direct consent with an asset source and never exposes upstream secret-bearing errors', async () => {
  let received: any;
  const client = new HeyGenPresenterClient('secret', (async (_url: string, init: RequestInit) => { received = JSON.parse(String(init.body)); return new Response(JSON.stringify({ data: { avatar_group: { id: 'g' } } })); }) as typeof fetch);
  await client.consent('g', 'req', 'asset'); assert.deepEqual(received, { consent_video: { type: 'asset_id', asset_id: 'asset' } });
  const denied = new HeyGenPresenterClient('secret', (async () => new Response(JSON.stringify({ error: { message: 'key=secret' } }), { status: 403 })) as typeof fetch);
  await assert.rejects(() => denied.looks(), /403：当前账号未开通此接口权限/);
});

test('adapter safely retries transient read failures and localizes exhausted network errors', async () => {
  let attempts = 0;
  const recovered = new HeyGenPresenterClient('secret', (async () => {
    attempts += 1;
    if (attempts < 3) throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ data: { id: 'group-1', status: 'processing' } }));
  }) as typeof fetch);
  assert.equal((await recovered.group('group-1')).status, 'processing');
  assert.equal(attempts, 3);

  const unavailable = new HeyGenPresenterClient('secret', (async () => { throw new TypeError('fetch failed'); }) as typeof fetch);
  await assert.rejects(() => unavailable.group('group-1'), /HeyGen 网络连接失败，请稍后刷新原任务/);
});


test('large person videos finish direct upload before becoming usable and do not leak the API key', async () => {
  const calls: string[] = [];
  const client = new HeyGenPresenterClient('private-test-key', async (url, options) => {
    calls.push(String(url));
    if (String(url).endsWith('direct-uploads')) return new Response(JSON.stringify({ data: { asset_id: 'asset-large', upload_url: 'https://files.heygen.ai/upload', upload_headers: { 'Content-Type': 'video/mp4' } } }));
    if (String(url) === 'https://files.heygen.ai/upload') { assert.equal(new Headers(options?.headers).has('x-api-key'), false); assert.equal(options?.method, 'PUT'); return new Response('', { status: 200 }); }
    assert.match(String(url), /asset-large\/complete$/);
    return new Response(JSON.stringify({ data: { asset_id: 'asset-large' } }));
  });
  assert.equal(await client.upload(Buffer.alloc(32 * 1024 * 1024 + 1), 'video/mp4', 'large-upload'), 'asset-large');
  assert.equal(calls.length, 3);
});

test('local photo ingress persists exact bytes once and isolates identical uploads by tenant', async () => {
  const fs = await import('node:fs/promises'); const os = await import('node:os'); const path = await import('node:path');
  const { dataAuthorityRequestScope, bindDataAuthority } = await import('../storage/dataAuthority.js');
  const { readLocalMaterials } = await import('../lib/materialLibrary.js');
  const previousCwd = process.cwd(), previousDriver = process.env.OBJECT_STORAGE_DRIVER;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lingshu-photo-ingress-'));
  process.chdir(directory); process.env.OBJECT_STORAGE_DRIVER = 'local';
  const app=express(); app.use(dataAuthorityRequestScope); app.use((req,res,next)=>{bindDataAuthority(req.headers['x-authority']==='pocketbase'?'pocketbase':'local');res.locals.tenantId=req.headers['x-tenant']||'A';next();});
  app.use(createPresenterAssetsRouter({} as DataStore,async(_key,operation)=>operation()));
  const server=app.listen(0,'127.0.0.1'); await new Promise<void>(resolve=>server.once('listening',resolve));
  const root=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR0cAAAAASUVORK5CYII=','base64');
  const upload=(tenant='A',body=bytes,authority='local')=>fetch(`${root}/photo-materials?mime=image/png`,{method:'POST',headers:{'Content-Type':'application/octet-stream','x-tenant':tenant,'x-authority':authority},body});
  try {
    assert.equal((await upload('A',Buffer.from('invalid'))).status,400);
    assert.equal((await upload('A',bytes,'pocketbase')).status,409);
    const first=await (await upload()).json(),repeat=await (await upload()).json(),other=await (await upload('B')).json();
    assert.equal(first.ok,true);assert.equal(first.material.id,repeat.material.id);assert.notEqual(first.material.id,other.material.id);
    assert.deepEqual(await fs.readFile(path.join(directory,'data/media',first.material.file)),bytes);
    assert.equal(readLocalMaterials().length,2);assert.equal(readLocalMaterials().find(row=>row.id===other.material.id)?.tenantId,'B');
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));process.chdir(previousCwd);
    if(previousDriver===undefined)delete process.env.OBJECT_STORAGE_DRIVER;else process.env.OBJECT_STORAGE_DRIVER=previousDriver;
    await fs.rm(directory,{recursive:true,force:true});
  }
});
